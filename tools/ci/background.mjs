#!/usr/bin/env node
/*
 * A command started in the background of a CI job, so it runs beside the steps that come after it, and waited for in
 * the step that needs its result. The browser jobs pull the Playwright image this way while the demo builds and starts.
 *
 *   node tools/ci/background.mjs start <name> -- <command> [args…]
 *       starts the command, detached, and returns at once; its output goes to $RUNNER_TEMP/background/<name>/log
 *   node tools/ci/background.mjs wait <name> --timeout <seconds>
 *       waits for it, then prints its output; writes <name>-seconds (how long the command ran) and <name>-wait-seconds
 *       (how long this wait took) to $GITHUB_OUTPUT
 *
 * A wait is never a pass it has not seen: it exits with the command's own status when the command failed (127 when it
 * could not run), 1 with an error annotation when the command did not finish within the timeout (and stops it), and 2
 * with a warning when no command of that name was started, so the step can run it in the foreground instead.
 * Exit status 64 on a usage error.
 * Test: node --test tools/tests/background.test.mjs
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TAIL = 40;
const usage = (message) => {
    console.error(`background.mjs: ${message}`);
    console.error('usage: background.mjs start <name> -- <command> [args…] | wait <name> --timeout <seconds>');
    process.exit(64);
};

const [action, name, ...rest] = process.argv.slice(2);
if (!['start', 'wait'].includes(action)) usage(`unknown action "${action ?? ''}"`);
if (!/^[a-z0-9][a-z0-9-]*$/.test(name ?? '')) usage(`"${name ?? ''}" is not a name (lower-case letters, digits, dashes)`);

const dir = join(process.env.RUNNER_TEMP || tmpdir(), 'background', name);
const files = { log: join(dir, 'log'), started: join(dir, 'started'), status: join(dir, 'status'), pid: join(dir, 'pid') };
const now = () => Math.floor(Date.now() / 1000);

if ('start' === action) {
    if ('--' !== rest[0] || rest.length < 2) usage('start needs -- and a command');
    mkdirSync(dir, { recursive: true });
    writeFileSync(files.started, `${now()}\n`);
    // sh records the command's exit status (127 when it cannot run) and the time it ended, written whole by a rename
    const wrapper = '"$@" > "$LOG" 2>&1; code=$?; printf "%s %s\\n" "$code" "$(date +%s)" > "$STATUS.tmp"; mv "$STATUS.tmp" "$STATUS"';
    const child = spawn('sh', ['-c', wrapper, 'sh', ...rest.slice(1)], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, LOG: files.log, STATUS: files.status },
    });
    writeFileSync(files.pid, `${child.pid}\n`);
    child.unref();
    console.log(`started ${name} in the background: ${rest.slice(1).join(' ')}`);
    process.exit(0);
}

if ('--timeout' !== rest[0] || !/^\d+$/.test(rest[1] ?? '')) usage('wait needs --timeout <seconds>');
const timeout = Number(rest[1]);
const begin = Date.now();

const output = (key, value) => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};
const tail = () => {
    try {
        return readFileSync(files.log, 'utf8').trimEnd().split('\n').slice(-TAIL).join('\n');
    } catch {
        return '(no output)';
    }
};

if (!existsSync(files.started)) {
    console.log(`::warning::${name} was not started in the background: run it here instead`);
    process.exit(2);
}

while (!existsSync(files.status)) {
    if (Date.now() - begin >= timeout * 1000) {
        console.log(tail());
        try {
            process.kill(-Number(readFileSync(files.pid, 'utf8')), 'SIGTERM');
        } catch {}
        console.log(`::error::${name} did not finish in ${timeout} s: stopped`);
        process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
}

const [code, ended] = readFileSync(files.status, 'utf8').trim().split(' ').map(Number);
const started = Number(readFileSync(files.started, 'utf8'));
output(`${name}-seconds`, ended - started);
output(`${name}-wait-seconds`, Math.round((Date.now() - begin) / 1000));
console.log(tail());
if (0 !== code) {
    console.log(`::error::${name} failed in the background with exit status ${code}`);
    process.exit(code || 1);
}
console.log(`${name} done: ran ${ended - started} s, waited ${Math.round((Date.now() - begin) / 1000)} s`);
