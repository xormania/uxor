// Xdebug in the demo's containers: off unless a developer asks for it. Its develop mode aborts deep call stacks under
// the browser tests' concurrent requests and answers 500, so a demo started with the defaults must not run it.
//
// - demo/compose.override.yaml: the php service's XDEBUG_MODE resolves to off when the variable is unset, and to the
//   developer's value when it is set (an interpolation default, not a hard-coded off);
// - every workflow job that starts the demo with `docker compose up` pins XDEBUG_MODE off (ci.yml, monthly.yml and
//   release-checks.yml today), so CI does not depend on the override's default;
// - the consumer harness (packages/uxor/dev/compose.yaml) runs with it off.
//
// The values are read as text and resolved the way Compose interpolates `${VAR}`, `${VAR:-default}` and
// `${VAR-default}`: no Docker, so Tool tests runs it.
// Run: node --test tools/tests/*.test.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

/** A Compose value with its variables resolved from `env`: `${VAR}`, `${VAR:-default}` (unset or empty), `${VAR-default}` (unset). */
function interpolate(value, env) {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?-)([^}]*))?\}/g, (_, name, operator, fallback) => {
        const set = Object.hasOwn(env, name);
        if (':-' === operator) {
            return set && '' !== env[name] ? env[name] : fallback;
        }
        if ('-' === operator) {
            return set ? env[name] : fallback;
        }
        return set ? env[name] : '';
    });
}

/** The value YAML gives a scalar written on one line: unquoted, or in single or double quotes, a trailing comment dropped. */
function scalar(raw) {
    const text = raw.trim();
    const quoted = text.match(/^(['"])(.*?)\1(?:\s+#.*)?$/);
    return quoted ? quoted[2] : text.replace(/\s+#.*$/, '');
}

/** The XDEBUG_MODE values of a Compose file's php service, as written. */
function phpXdebugModes(path) {
    const text = read(path);
    const service = text.match(/^ {2}php:\n((?:^(?: {4}.*)?\n)*)/m);
    assert.ok(service, `${path}: no php service`);
    return [...service[1].matchAll(/^\s+XDEBUG_MODE:\s*(.+)$/gm)].map(([, value]) => scalar(value));
}

test('the demo starts with Xdebug off unless XDEBUG_MODE is set, and takes the value set', () => {
    const modes = phpXdebugModes('demo/compose.override.yaml');
    assert.equal(modes.length, 1, `demo/compose.override.yaml: one XDEBUG_MODE for the php service, found ${modes.length}`);
    const [mode] = modes;
    assert.equal(interpolate(mode, {}), 'off', `demo/compose.override.yaml: XDEBUG_MODE: "${mode}" with the variable unset`);
    assert.equal(interpolate(mode, { XDEBUG_MODE: 'debug' }), 'debug', `demo/compose.override.yaml: XDEBUG_MODE: "${mode}" ignores a developer's XDEBUG_MODE=debug`);
    assert.equal(interpolate(mode, { XDEBUG_MODE: 'develop,debug' }), 'develop,debug');
});

/** The jobs of a workflow, by name, as their text (the lines under `jobs:` indented once). */
function jobs(text) {
    const body = text.split(/^jobs:\s*$/m)[1] ?? '';
    const found = new Map();
    let name = null;
    for (const line of body.split('\n')) {
        const header = line.match(/^ {4}([\w-]+):\s*$/);
        if (header) {
            name = header[1];
            found.set(name, '');
        } else if (name && (line.startsWith('     ') || '' === line.trim())) {
            found.set(name, found.get(name) + line + '\n');
        } else if (/^\S/.test(line)) {
            name = null;
        }
    }
    return found;
}

test('every workflow job that starts the demo with docker compose up pins XDEBUG_MODE off', () => {
    const dir = join(root, '.github/workflows');
    const starting = [];
    for (const file of readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
        for (const [job, text] of jobs(readFileSync(join(dir, file), 'utf8'))) {
            if (!/docker compose\b[^\n]*\bup\b/.test(text)) {
                continue;
            }
            starting.push(file);
            const modes = [...text.matchAll(/^\s+XDEBUG_MODE:\s*(.+)$/gm)].map(([, value]) => scalar(value));
            assert.ok(modes.length > 0, `${file} › ${job}: starts the demo without setting XDEBUG_MODE`);
            for (const mode of modes) {
                assert.equal(interpolate(mode, {}), 'off', `${file} › ${job}: XDEBUG_MODE: ${mode}`);
            }
        }
    }
    // the jobs that start the demo today: a parser that finds none would pass on nothing
    for (const file of ['ci.yml', 'monthly.yml', 'release-checks.yml']) {
        assert.ok(starting.includes(file), `${file}: no job found starting the demo with docker compose up`);
    }
});

test('the consumer harness runs with Xdebug off', () => {
    const modes = phpXdebugModes('packages/uxor/dev/compose.yaml');
    assert.equal(modes.length, 1, `packages/uxor/dev/compose.yaml: one XDEBUG_MODE for the php service, found ${modes.length}`);
    assert.equal(interpolate(modes[0], {}), 'off', `packages/uxor/dev/compose.yaml: XDEBUG_MODE: ${modes[0]}`);
});

test('the interpolation reads Compose defaults as Compose does', () => {
    assert.equal(interpolate('${X:-off}', {}), 'off');
    assert.equal(interpolate('${X:-off}', { X: '' }), 'off');
    assert.equal(interpolate('${X-off}', { X: '' }), '');
    assert.equal(interpolate('${X:-off}', { X: 'debug' }), 'debug');
    assert.equal(interpolate('${X}', {}), '');
    assert.equal(interpolate('off', { X: 'debug' }), 'off');
    assert.equal(scalar(`'off' # a comment`), 'off');
    assert.equal(scalar('"${XDEBUG_MODE:-develop}"'), '${XDEBUG_MODE:-develop}');
});
