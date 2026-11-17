// Kit PHP's order in ci.yml: the cheap, deterministic checks (every tracked PHP file's syntax, every template the demo
// compiles) run before PHPUnit and report on their own, and neither PHPUnit nor PHPStan hides the other's failure.
// Run: node --test tools/tests/*.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
