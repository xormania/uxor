// The Tailwind CSS versions of the repository: the npm package the palette checks read (package-lock.json), and the
// standalone CLI that compiles the demo's and the consumer app's stylesheets (symfonycasts_tailwind's binary_version).
// They are one version, and the static build names the compiler it used.
// Run: node --test tools/tests/tailwind-versions.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const COMPILERS = ['demo/config/packages/symfonycasts_tailwind.yaml', 'packages/uxor/dev/app/config/packages/symfonycasts_tailwind.yaml'];

const npmVersion = (() => {
    const tailwind = JSON.parse(read('package-lock.json')).packages?.['node_modules/tailwindcss'];
    assert.ok(tailwind?.version, 'package-lock.json resolves tailwindcss');
    return tailwind.version;
})();

function binaryVersion(path) {
    // TailwindBundle puts the value in the release's download URL as written: Tailwind's tags start with v
    const match = /^\s*binary_version:\s*['"]?(v?)(\d+\.\d+\.\d+)['"]?\s*(?:#.*)?$/m.exec(read(path));
    assert.ok(match, `${path} pins binary_version`);
    assert.equal(match[1], 'v', `${path}: binary_version names Tailwind's release tag, v${match[2]}`);
    return match[2];
}

for (const path of COMPILERS) {
    test(`${path}'s standalone CLI is the tailwindcss version package-lock.json resolves`, () => {
        assert.equal(binaryVersion(path), npmVersion, `${path} binary_version against package-lock.json's tailwindcss ${npmVersion}`);
    });
}

test('tools/build-static.sh names the Tailwind compiler version it builds with, before tailwind:build', () => {
    const lines = read('tools/build-static.sh').split('\n');
    const build = lines.findIndex((line) => /bin\/console tailwind:build\b/.test(line) && !/^\s*#/.test(line));
    assert.ok(build >= 0, 'tools/build-static.sh runs tailwind:build');
    const logs = lines.slice(0, build).filter((line) => /^\s*(?:echo|printf)\b/.test(line) && /tailwind/i.test(line));
    assert.ok(logs.length > 0, 'a line printed before tailwind:build names the Tailwind compiler');
    // the version printed is the one found at build time, not a literal copied into the script
    assert.ok(
        logs.some((line) => /\$/.test(line) && !/\d+\.\d+\.\d+/.test(line)),
        `the printed Tailwind version comes from a variable or command, not a literal: ${logs.join(' | ')}`,
    );
});

/**
 * Runs tools/build-static.sh in a scratch root: the real tools/ (linked), a demo whose symfonycasts_tailwind.yaml is
 * `yaml`, and stand-ins for php and composer (PHP=, COMPOSER_BIN=) that record their arguments; php stops the script
 * at tailwind:build (exit 42), so nothing is installed or built. Returns the exit status, the output and php's calls.
 */
function buildStaticWith(yaml) {
    const scratch = mkdtempSync(join(tmpdir(), 'build-static-tailwind-'));
    try {
        symlinkSync(join(root, 'tools'), join(scratch, 'tools'));
        mkdirSync(join(scratch, 'demo/config/packages'), { recursive: true });
        writeFileSync(join(scratch, 'demo/config/packages/symfonycasts_tailwind.yaml'), yaml);
        const calls = join(scratch, 'php-calls.log');
        const php = join(scratch, 'php');
        writeFileSync(php, `#!/usr/bin/env bash\necho "$*" >> '${calls}'\ncase "$*" in *tailwind:build*) exit 42 ;; esac\nexit 0\n`);
        const composer = join(scratch, 'composer');
        writeFileSync(composer, '#!/usr/bin/env bash\nexit 0\n');
        chmodSync(php, 0o755);
        chmodSync(composer, 0o755);
        const git = (...args) => spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: scratch, encoding: 'utf8' });
        git('init', '-q');
        git('commit', '-q', '--allow-empty', '-m', 'scratch');
        const result = spawnSync('bash', [join(scratch, 'tools/build-static.sh'), join(scratch, 'site')], {
            cwd: scratch,
            encoding: 'utf8',
            env: { ...process.env, PHP: php, COMPOSER_BIN: composer },
            timeout: 30_000,
        });
        const output = `${result.stdout}${result.stderr}`;
        const phpCalls = existsSync(calls) ? readFileSync(calls, 'utf8') : '';
        return { status: result.status, output, phpCalls };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

// each case its own version, so only a script that reads the file prints the right one
const readable = {
    'single-quoted': ["symfonycasts_tailwind:\n    binary_version: 'v4.3.5'\n", 'v4.3.5'],
    'double-quoted': ['symfonycasts_tailwind:\n    binary_version: "v4.1.12"\n', 'v4.1.12'],
    unquoted: ['symfonycasts_tailwind:\n    binary_version: v4.2.0\n', 'v4.2.0'],
    'single-quoted, commented,': ["symfonycasts_tailwind:\n    # the CLI tailwind:build downloads\n    binary_version: 'v4.0.17' # pinned\n", 'v4.0.17'],
};

for (const [label, [yaml, version]] of Object.entries(readable)) {
    test(`tools/build-static.sh prints the ${label} binary_version before tailwind:build`, () => {
        const { status, output, phpCalls } = buildStaticWith(yaml);
        assert.match(phpCalls, /bin\/console tailwind:build/, `the script reached tailwind:build (exit ${status}):\n${output}`);
        assert.equal(status, 42, 'it stopped at the stand-in tailwind:build, not before');
        const line = output.split('\n').find((text) => /tailwind/i.test(text) && /\d+\.\d+\.\d+/.test(text));
        assert.ok(line, `a line names the Tailwind compiler's version:\n${output}`);
        assert.equal(line.match(/v?\d+\.\d+\.\d+/g)?.join(' '), version, `it names ${version}, the version configured: ${line}`);
        assert.doesNotMatch(output, /unknown/i, 'no version reported as unknown');
    });
}

const unreadable = {
    'no binary_version': "symfonycasts_tailwind:\n    input_css: 'assets/styles/app.css'\n",
    'an empty binary_version': "symfonycasts_tailwind:\n    binary_version: ''\n",
    'only a commented-out binary_version': "symfonycasts_tailwind:\n    # binary_version: 'v4.3.5'\n",
};

for (const [label, yaml] of Object.entries(unreadable)) {
    test(`tools/build-static.sh fails before tailwind:build on ${label}, with an error naming binary_version`, () => {
        const { status, output, phpCalls } = buildStaticWith(yaml);
        assert.doesNotMatch(phpCalls, /tailwind:build/, `tailwind:build never runs:\n${output}`);
        assert.notEqual(status, 0, 'the script fails');
        assert.doesNotMatch(output, /unknown/i, 'no version reported as unknown');
        assert.match(output, /binary_version/, `the error names binary_version:\n${output}`);
    });
}
