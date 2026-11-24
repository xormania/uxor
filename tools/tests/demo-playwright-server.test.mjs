import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function freePort() {
    const socket = createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const { port } = socket.address();
    await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
    return port;
}

function configFixture(dir) {
    for (const file of ['playwright.config.ts', 'tools/prepare-tests.mjs', 'tools/playwright-image.mjs', 'tools/plant-router.php']) {
        const path = join(dir, file);
        mkdirSync(dirname(path), { recursive: true });
        copyFileSync(join(root, file), path);
    }
    // Load the actual config with only the Playwright API surface it uses. Tool tests do not install npm packages.
    const playwright = join(dir, 'node_modules/@playwright/test');
    mkdirSync(playwright, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    writeFileSync(join(playwright, 'package.json'), '{"version":"fixture"}');
    writeFileSync(join(playwright, 'index.js'), `
exports.defineConfig = (config) => config;
exports.devices = { 'Pixel 7': { viewport: { width: 384, height: 854 } } };
`);
    return (env) => JSON.parse(execFileSync(process.execPath, [
        '--experimental-strip-types', '--input-type=module', '-e',
        "import config from './playwright.config.ts'; console.log(JSON.stringify(config.webServer));",
    ], {
        cwd: dir,
        encoding: 'utf8',
        env: {
            ...process.env,
            DEMO_URL: '',
            PW_BROWSER_SERVER: 'unused',
            PW_BROWSER_WS_ENDPOINT: '',
            TEST_WORKER_INDEX: '0',
            ...env,
        },
    }));
}

test('the local Playwright server routes directory-shaped URLs to PHP and serves static files directly', { timeout: 12_000 }, async (t) => {
    const configuredPhp = process.env.PHP_BINARY || 'php';
    const phpBinary = configuredPhp.includes('/') ? resolve(root, configuredPhp) : configuredPhp;
    const probe = spawnSync(phpBinary, ['--version'], { cwd: root, encoding: 'utf8', timeout: 5_000 });
    if (!process.env.PHP_BINARY && probe.error?.code === 'ENOENT') {
        t.skip('PHP CLI is unavailable. Set PHP_BINARY to run the native server check.');
        return;
    }
    assert.ifError(probe.error);
    assert.equal(probe.status, 0, probe.stderr);

    const dir = mkdtempSync(join(tmpdir(), 'uxor playwright server '));
    let stopServer;
    t.after(async () => {
        await stopServer?.();
        rmSync(dir, { recursive: true, force: true });
    });
    const configs = configFixture(dir);
    const publicDir = join(dir, 'demo/public');
    mkdirSync(join(publicDir, 'lab'), { recursive: true });
    writeFileSync(join(publicDir, 'lab/plain.css'), '.lab { color: black; }');
    writeFileSync(join(publicDir, 'index.php'), `<?php
echo parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH).' served by '.$_SERVER['SCRIPT_NAME'];
`);

    const port = await freePort();
    const baseURL = `http://127.0.0.1:${port}`;
    const binary = join(dir, 'selected php');
    const receipt = join(dir, 'php-receipt');
    writeFileSync(binary, '#!/bin/sh\nprintf "selected\\n" > "$UXOR_TEST_PHP_RECEIPT"\nexec "$UXOR_TEST_PHP_EXECUTABLE" "$@"\n', { mode: 0o755 });
    const env = {
        DEMO_PORT: String(port), PHP_BINARY: binary, UXOR_TEST_PHP_EXECUTABLE: phpBinary, UXOR_TEST_PHP_RECEIPT: receipt,
    };
    const [native] = configs(env);
    const php = spawn('sh', ['-c', `exec ${native.command}`], { cwd: dir, env: { ...process.env, ...env } });
    const ended = once(php, 'close');
    stopServer = async () => {
        php.kill();
        await ended;
    };

    let log = '';
    await new Promise((resolve, reject) => {
        php.stderr.on('data', (data) => {
            log += data;
            if (log.includes('Development Server') && log.includes('started')) resolve();
        });
        php.once('error', reject);
        php.once('close', (code) => reject(new Error(`PHP exited with ${code}: ${log}`)));
    });

    const lab = await fetch(`${baseURL}/lab`, { redirect: 'manual' });
    assert.equal(lab.status, 200, 'the physical lab directory still routes to Symfony');
    assert.equal(await lab.text(), '/lab served by /index.php');
    const asset = await fetch(`${baseURL}/lab/plain.css?version=1`);
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), '.lab { color: black; }');
    assert.equal(readFileSync(receipt, 'utf8'), 'selected\n');
    assert.equal(native.url, `${baseURL}/lab/autocomplete`);
    assert.equal(native.reuseExistingServer, false);
    const external = configs({ ...env, DEMO_URL: 'https://provided.invalid' });
    assert.deepEqual(external.map(({ command }) => command), ['unused'], 'DEMO_URL suppresses the PHP server only');
    assert.equal(external[0].reuseExistingServer, false, 'the managed browser does not adopt an occupied port');
    assert.deepEqual(configs({ ...env, PW_BROWSER_WS_ENDPOINT: 'ws://127.0.0.1:9900/' }), [native], 'an explicit browser endpoint suppresses the browser server only');
});
