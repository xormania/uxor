// Kit PHP's order in ci.yml: the cheap, deterministic checks (every tracked PHP file's syntax, every template the demo
// compiles) run before PHPUnit and report on their own, and neither PHPUnit nor PHPStan hides the other's failure.
// Run: node --test tools/tests/*.test.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const job = workflow.split(/\n(?= {4}[a-z0-9-]+:\n)/).find((text) => /^ {4}php:\n {8}name: Kit PHP$/m.test(text));
const steps = job.split(/\n(?= {12}- )/).slice(1);
const named = (name) => {
    const index = steps.findIndex((step) => step.includes(`- name: ${name}\n`));
    assert.ok(index >= 0, `Kit PHP has a step named ${name}`);
    return { index, text: steps[index], if: steps[index].match(/^ {14}if: (.+)$/m)?.[1] ?? '' };
};

test('Kit PHP and the comparison install the same analyzer and extensions from the committed lock', () => {
    const comparison = readFileSync(new URL('../../.github/workflows/php-analysis-comparison.yml', import.meta.url), 'utf8');
    for (const source of [named('Install PHPStan').text, comparison]) {
        for (const extension of ['json', 'lock']) {
            assert.ok(source.includes(`git show "$GITHUB_SHA:tools/ci/phpstan-composer.${extension}" > "$RUNNER_TEMP/phpstan/composer.${extension}"`));
        }
        assert.ok(source.includes('composer install --working-dir="$RUNNER_TEMP/phpstan"'));
    }
});

test('Kit PHP checks the syntax of every tracked PHP file, and the PHP scripts without an extension, before PHPUnit', () => {
    const syntax = named('Syntax');
    assert.match(syntax.text, /git ls-files -z '\*\.php'/, 'every tracked .php file, not only the recipes\' src');
    for (const script of ['demo/bin/console', 'packages/uxor/bin/uxor', 'tools/sync-demo']) {
        assert.ok(syntax.text.includes(script), `${script} (PHP without an extension)`);
    }
    assert.match(syntax.text, /php -l/);
    assert.ok(syntax.index < named('PHPUnit').index, 'before PHPUnit');
});

test('Kit PHP compiles every template the demo renders, its own and the recipes\', before PHPUnit, even when the syntax check failed', () => {
    const twig = named('Twig syntax');
    assert.match(twig.text, /bin\/console lint:twig templates /, "the demo's templates");
    assert.match(twig.text, /\*\/templates/, "and each recipe's templates, by the path the demo reads them from");
    assert.ok(twig.index < named('PHPUnit').index, 'before PHPUnit');
    assert.match(twig.if, /!cancelled\(\)/, 'it runs after a failed step before it');
    assert.match(twig.if, /steps\.demo-install\.outcome == 'success'/, 'only once the demo is installed: it boots the demo\'s Twig');
});

test('PHPUnit and PHPStan each run once the demo is installed, whatever the other found', () => {
    const install = named('Install the demo');
    assert.match(install.text, /^ {14}id: demo-install$/m);
    assert.match(install.if, /!cancelled\(\)/, 'the install runs after a failed syntax check, so the checks after it still report');
    for (const name of ['PHPUnit', 'Install PHPStan', 'PHPStan']) {
        const step = named(name);
        assert.match(step.if, /!cancelled\(\)/, `${name} runs after a failed step before it`);
        assert.match(step.if, /steps\.demo-install\.outcome == 'success'/, `${name} needs the installed demo`);
        assert.doesNotMatch(step.if, /phpunit/i, `${name} is not conditional on PHPUnit`);
    }
    assert.match(named('PHPStan').if, /steps\.phpstan-install\.outcome == 'success'/, 'PHPStan runs once installed');
});

test('the checks after the PHP setup run only on that PHP: a failed setup is not followed by checks on the runner\'s own', () => {
    const setup = steps.findIndex((step) => /uses: shivammathur\/setup-php@/.test(step));
    assert.ok(setup >= 0, 'Kit PHP sets PHP up');
    assert.match(steps[setup], /^ {14}id: php-setup$/m);
    const download = steps.findIndex((step) => /name: importmap-packages/.test(step));
    for (const [what, step] of [['the importmap packages\' download', steps[download]], ['Install the demo', named('Install the demo').text]]) {
        assert.match(step.match(/^ {14}if: (.+)$/m)?.[1] ?? '', /steps\.php-setup\.outcome == 'success'/, `${what} runs only after the PHP setup passed`);
    }
});

test('PHPStan reads the paths it analyses in its own step, not from a file an earlier step could rewrite', () => {
    const phpstan = named('PHPStan');
    assert.match(phpstan.text, /\*\/manifest\.json/, 'it finds the recipes\' src directories itself');
    assert.doesNotMatch(job, /php-dirs/, 'no file of paths passed between steps');
});

// A tracked path whose first part starts with a dash reaches PHP (or PHPStan) as an option when it is passed bare: today
// `-n.php` is a usage error and `-d/x.php` defines an INI entry and lints standard input, so neither file is linted and
// the second passes. Each check runs as written (the step's script, the documented command) in a scratch repository.
const BROKEN = '<?php\nfunction (\n';
const run = (script, cwd, env = {}) => spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });

function repository(files) {
    const dir = mkdtempSync(join(tmpdir(), 'kit-php-dash-'));
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(dir, dirname(path)), { recursive: true });
        writeFileSync(join(dir, path), text);
    }
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '--', ...Object.keys(files)], { cwd: dir });
    const temp = join(dir, '.runner-temp');
    mkdirSync(temp);
    return { dir, temp };
}

/** Whether PHP's lint reported a parse error in `path` (as given, or with ./ before it): whole lines, no pattern built from the path. */
const linted = (output, path) => output.split('\n').some((line) => line === `Errors parsing ${path}` || line === `Errors parsing ./${path}`);

const script = (step) => step.text.match(/^ {14}run: \|\n([\s\S]*)$/m)[1].replace(/^ {18}/gm, '');

test('Syntax lints a tracked file whose path starts with a dash as a file, never as PHP\'s options', () => {
    const { dir, temp } = repository({ '-n.php': BROKEN, '-d/x.php': BROKEN, 'ok.php': '<?php echo 1;\n' });
    const result = run(script(named('Syntax')), dir, { RUNNER_TEMP: temp });
    const output = result.stdout + result.stderr;
    assert.notEqual(result.status, 0, `two syntax errors fail the step:\n${output}`);
    for (const path of ['-n.php', '-d/x.php']) {
        assert.ok(linted(output, path), `${path} is linted:\n${output}`);
    }
    assert.doesNotMatch(output, /Standard input|Usage: php/, 'no path read as an option');
    assert.match(output, /^1 files without a syntax error$/m);
});

test('the documented local commands lint a tracked file whose path starts with a dash as a file', () => {
    const testing = readFileSync(join(root, 'docs/TESTING.md'), 'utf8');
    const local = testing.slice(testing.indexOf('```sh', testing.indexOf('**Twig syntax:**'))).split('\n')[1];
    assert.match(local, /git ls-files -z '\*\.php'/, 'docs/TESTING.md\'s Kit PHP syntax command');
    const contributing = readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8').split('\n').find((line) => /^find .*php -l/.test(line)).replace(/ +# .*$/, '');
    for (const [where, command, files, path] of [
        ['docs/TESTING.md', local, { '-d/x.php': BROKEN }, '-d/x.php'],
        ['CONTRIBUTING.md', contributing, { '-d/src/X.php': BROKEN, 'ok/src/Y.php': '<?php\n' }, '-d/src/X.php'],
    ]) {
        const { dir } = repository(files);
        const result = run(`${command} || true`, dir);
        const output = result.stdout + result.stderr;
        assert.ok(linted(output, path), `${where}: ${path} is linted:\n${output}`);
        assert.doesNotMatch(output, /Standard input|Usage: php|unknown predicate/, `${where}: no path read as an option`);
    }
});

test('PHPStan is given a recipe directory whose name starts with a dash as a path, never as its options', () => {
    const { dir, temp } = repository({ '-l/manifest.json': '{}', '-l/src/A.php': '<?php\n', 'ok/manifest.json': '{}', 'ok/src/B.php': '<?php\n', 'demo/bin/console': '#!/bin/sh\n' });
    chmodSync(join(dir, 'demo/bin/console'), 0o755);
    const stub = join(temp, 'phpstan/vendor/bin/phpstan');
    mkdirSync(dirname(stub), { recursive: true });
    writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" > "${temp}/args"\n`);
    chmodSync(stub, 0o755);
    const result = run(script(named('PHPStan')), dir, { RUNNER_TEMP: temp });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const args = readFileSync(join(temp, 'args'), 'utf8').trimEnd().split('\n');
    const end = args.indexOf('--');
    // as a Symfony Console command reads them: before `--`, an argument starting with a dash is an option
    const paths = args.filter((arg, index) => (end >= 0 && index > end) || (!arg.startsWith('-') && (end < 0 || index < end))).map((arg) => arg.replace(/^\.\//, ''));
    for (const path of ['-l/src', 'ok/src', 'demo/src/Demo', 'demo/tests']) {
        assert.ok(paths.includes(path), `${path} is a path PHPStan analyses: ${JSON.stringify(args)}`);
    }
});
