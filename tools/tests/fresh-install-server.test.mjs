// Exercise the native launch and readiness path with real PHP and HTTP, without resolving Composer dependencies.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

function scratch(t) {
    const dir = mkdtempSync(join(tmpdir(), 'uxor-fresh-server-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function fixture(t) {
    const dir = scratch(t);
    const scripts = join(dir, 'tools/tests');
    mkdirSync(scripts, { recursive: true });
    cpSync(join(root, 'tools/tests/fresh-install.sh'), join(scripts, 'fresh-install.sh'));
    writeFileSync(join(scripts, 'install-scenario.sh'), `
require_kit_packages() { :; }
install_kit_recipes() { :; }
add_fresh_app() {
    mkdir -p public
    printf '%s\\n' '<?php http_response_code((int) getenv("UXOR_FIXTURE_STATUS")); echo getenv("UXOR_FIXTURE_ID");' > public/index.php
}
`);
    writeFileSync(join(scripts, 'check-fresh-app.sh'), `#!/usr/bin/env bash
set -euo pipefail
base="$1"
printf '%s\\n' "$base" > "$UXOR_FIXTURE_DIR/$UXOR_FIXTURE_ID.check"
if [ "$UXOR_FIXTURE_PEER" ]; then
    for i in {1..100}; do
        if [ -f "$UXOR_FIXTURE_DIR/$UXOR_FIXTURE_PEER.check" ]; then break; fi
        sleep 0.05
    done
    [ "$(curl -fsS --noproxy '*' --max-time 3 "$base/")" = "$UXOR_FIXTURE_ID" ]
fi
`, { mode: 0o755 });
    const composer = join(dir, 'composer');
    writeFileSync(composer, '#!/usr/bin/env bash\nif [ "$1" = create-project ]; then mkdir -p "${@: -1}"; fi\n', { mode: 0o755 });
    execFileSync('git', ['init', '-q', dir]);
    execFileSync('git', ['-C', dir, '-c', 'user.name=Fresh install fixture', '-c', 'user.email=fresh-install@example.test',
        '-c', 'commit.gpgSign=false', 'commit', '--quiet', '--allow-empty', '-m', 'Fixture']);

    async function start(id, { port, peer, status = 200 } = {}) {
        const env = {
            ...process.env,
            COMPOSER_BIN: composer,
            UXOR_FIXTURE_DIR: dir,
            UXOR_FIXTURE_ID: id,
            UXOR_FIXTURE_PEER: peer ?? '',
            UXOR_FIXTURE_STATUS: String(status),
        };
        if (port === undefined) delete env.PORT;
        else env.PORT = String(port);
        const child = spawn('bash', [join(scripts, 'fresh-install.sh')], { cwd: dir, env, timeout: 10_000 });
        let output = '';
        child.stdout.on('data', (data) => { output += data; });
        child.stderr.on('data', (data) => { output += data; });
        const [exitCode, signal] = await once(child, 'close');
        assert.equal(signal, null, output);
        return { status: exitCode, output };
    }

    return { dir, start };
}

test('a foreign listener answering 503 on the requested port never starts the install assertions', { timeout: 15_000 }, async (t) => {
    const setup = fixture(t);
    const occupied = createServer((request, response) => {
        response.writeHead(503).end('unrelated process');
    });
    occupied.listen(0, '127.0.0.1');
    await once(occupied, 'listening');
    t.after(() => new Promise((resolve) => occupied.close(resolve)));
    const { port } = occupied.address();

    const result = await setup.start('occupied', { port });
    assert.notEqual(result.status, 0, result.output);
    assert.equal(existsSync(join(setup.dir, 'occupied.check')), false, 'the checker never runs against the foreign listener');
    assert.match(result.output, /listen|bind|address already in use/i);
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 503, 'the unrelated process remains alive');
    await response.text();
});

test('an owned listener returning HTTP 503 is not ready for the install assertions', { timeout: 15_000 }, async (t) => {
    const setup = fixture(t);
    const result = await setup.start('unready', { status: 503 });
    assert.notEqual(result.status, 0, result.output);
    assert.equal(existsSync(join(setup.dir, 'unready.check')), false, 'the checker waits for successful HTTP readiness');
    assert.match(result.output, /503|not ready|readiness/i);
});

test('concurrent default installs check distinct loopback origins serving their own fixtures', { timeout: 15_000 }, async (t) => {
    const setup = fixture(t);
    const runs = await Promise.all([
        setup.start('one', { peer: 'two' }),
        setup.start('two', { peer: 'one' }),
    ]);

    for (const result of runs) assert.equal(result.status, 0, result.output);
    const endpoints = ['one', 'two'].map((id) => new URL(readFileSync(join(setup.dir, id + '.check'), 'utf8').trim()));
    assert.ok(endpoints.every(({ protocol, hostname, port }) => protocol === 'http:' && hostname === '127.0.0.1' && Number(port) > 0));
    assert.notEqual(endpoints[0].port, endpoints[1].port);
});

test('HTTP checks bound connection and response time while forwarding caller options', (t) => {
    const dir = scratch(t);
    const log = join(dir, 'curl-arguments');
    writeFileSync(join(dir, 'curl'), '#!/usr/bin/env bash\nprintf "%s\\n" "$@" >> "$UXOR_FIXTURE_CURL_LOG"\nprintf 503\n', { mode: 0o755 });
    const result = spawnSync('bash', [join(root, 'tools/tests/check-fresh-app.sh'), 'http://127.0.0.1:1', '--insecure'], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, UXOR_FIXTURE_CURL_LOG: log },
        encoding: 'utf8',
        timeout: 3000,
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    const options = readFileSync(log, 'utf8').trim().split('\n');
    for (const option of ['--connect-timeout', '--max-time']) {
        const index = options.indexOf(option);
        assert.ok(index >= 0 && Number(options[index + 1]) > 0, `a positive ${option} is passed to curl`);
    }
    assert.ok(options.includes('--insecure'));
});

test('the Docker smoke assertions exercise the installed pages, a controller asset and a Live request', async (t) => {
    const requests = [];
    let actionStatus = 200;
    const pages = new Map([
        ['GET /', '<h1>Dashboard</h1>Recent orders<aside id="sidebar" data-turbo-permanent><div id="toasts"></div>'
            + '<script type="importmap">{"imports":{"fixture":"/assets/controllers/fixture.js"}}</script>'],
        ['GET /register', '<input id="form_email" class="rounded-base"><label for="form_email" class="text-heading">Email</label>'
            + '<p id="form_plainPassword_help">At least 12 characters</p>'],
        ['GET /live-orders', '<div data-live-name-value="LiveOrders" data-live-props-value="{}"></div>'],
    ]);
    const server = createServer((request, response) => {
        const endpoint = `${request.method} ${request.url}`;
        requests.push(endpoint);
        if (pages.has(endpoint)) response.end(pages.get(endpoint));
        else if (endpoint === 'GET /assets/controllers/fixture.js') {
            response.writeHead(200, { 'Content-Type': 'text/javascript' }).end('export {};');
        } else if (endpoint === 'POST /_components/LiveOrders/goTo') {
            response.writeHead(actionStatus).end('Showing <span>11–20</span> of <span>25</span>');
        } else response.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const checker = join(root, 'tools/tests/check-fresh-app.sh');
    const base = `http://127.0.0.1:${server.address().port}`;
    async function check(...options) {
        const child = spawn('bash', [checker, ...options, base, '--noproxy', '*'], { timeout: 5000 });
        let output = '';
        child.stdout.on('data', (data) => { output += data; });
        child.stderr.on('data', (data) => { output += data; });
        const [status, signal] = await once(child, 'close');
        assert.equal(signal, null, output);
        return { status, output };
    }

    const smoke = await check('--smoke');
    assert.equal(smoke.status, 0, smoke.output);
    assert.deepEqual(requests, ['GET /', 'GET /assets/controllers/fixture.js', 'GET /register', 'GET /live-orders',
        'POST /_components/LiveOrders/goTo']);

    const full = await check();
    assert.notEqual(full.status, 0, full.output);
    assert.match(full.output, /\/orders\?.* answered 404/);

    actionStatus = 500;
    const broken = await check('--smoke');
    assert.notEqual(broken.status, 0, broken.output);
    assert.match(broken.output, /goTo action answered 500/);
});
