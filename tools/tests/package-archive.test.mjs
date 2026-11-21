// Exercise the actual checker against committed source files and Git's separate export rules.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const checker = 'packages/uxor/tools/check-package.py';
const alertAction = 'alert/templates/components/Alert/Action.html.twig';

function fixture(t) {
    const scratch = mkdtempSync(join(tmpdir(), 'uxor-archive-test-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const checkout = join(scratch, 'checkout');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', root, checkout]);

    function git(...args) {
        return execFileSync('git', ['-C', checkout, ...args]);
    }

    git('checkout', '--quiet', '--detach', head);
    mkdirSync(dirname(join(checkout, checker)), { recursive: true });
    cpSync(join(root, checker), join(checkout, checker));

    function commit(...paths) {
        git('add', '--', ...paths);
        git('-c', 'user.name=Archive fixture', '-c', 'user.email=archive-fixture@example.test', '-c', 'commit.gpgSign=false',
            'commit', '--quiet', '--no-verify', '-m', 'Fixture change');
    }

    return {
        checkout,
        commit,
        exclude(path) {
            appendFileSync(join(checkout, '.gitattributes'), `\n/${path} export-ignore\n`);
            commit('.gitattributes');
            git('cat-file', '-e', `HEAD:${path}`);
            const archive = git('archive', '--format=tar.gz', 'HEAD');
            const exported = execFileSync('tar', ['-tzf', '-'], { input: archive, encoding: 'utf8' });
            assert.ok(!exported.split('\n').includes(path), `${path} is absent from the archive and present in HEAD`);
        },
        check() {
            const result = spawnSync('python3', [checker], {
                cwd: checkout,
                encoding: 'utf8',
                env: { ...process.env, TMPDIR: scratch },
                timeout: 30_000,
            });
            assert.ifError(result.error);
            return result;
        },
    };
}

test('an export exclusion cannot drop a tracked Twig file from a declared recipe directory', (t) => {
    const kit = fixture(t);
    kit.exclude(alertAction);
    const result = kit.check();

    assert.notEqual(result.status, 0, result.stdout);
    assert.ok(result.stderr.includes(alertAction), result.stderr);
});

test('a declared recipe copy source must be a directory even when the file itself is exported', (t) => {
    const kit = fixture(t);
    const manifestPath = 'alert/manifest.json';
    const manifestFile = join(kit.checkout, manifestPath);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const file = 'proof.css';
    const source = `alert/${file}`;
    manifest['copy-files'][file] = 'assets/styles/';
    writeFileSync(join(kit.checkout, source), '/* extra source */\n');
    writeFileSync(manifestFile, JSON.stringify(manifest));
    kit.commit(manifestPath, source);

    const result = kit.check();
    assert.notEqual(result.status, 0, result.stdout);
    assert.ok(result.stderr.includes(file), result.stderr);
    assert.match(result.stderr, /copy-files.*directory/i);
});

test('a nested copy source is checked independently of its renamed destination', (t) => {
    const kit = fixture(t);
    const manifestPath = 'alert/manifest.json';
    const manifestFile = join(kit.checkout, manifestPath);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const sourceDirectory = 'extras/release/';
    const source = `alert/${sourceDirectory}skin.css`;
    manifest['copy-files'][sourceDirectory] = 'assets/styles/renamed/';
    mkdirSync(dirname(join(kit.checkout, source)), { recursive: true });
    writeFileSync(join(kit.checkout, source), '/* extra source */\n');
    writeFileSync(manifestFile, JSON.stringify(manifest));
    kit.commit(manifestPath, source);

    const complete = kit.check();
    assert.equal(complete.status, 0, complete.stderr);
    kit.exclude(source);

    const result = kit.check();
    assert.notEqual(result.status, 0, result.stdout);
    assert.ok(result.stderr.includes(source), result.stderr);
});

test('the archive checker reads committed recipe manifests, independent of local edits', (t) => {
    const kit = fixture(t);
    const manifestFile = join(kit.checkout, 'alert/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    manifest['copy-files']['local-only.css'] = 'assets/styles/local-only.css';
    writeFileSync(manifestFile, JSON.stringify(manifest));
    writeFileSync(join(kit.checkout, 'alert/templates/local-only.html.twig'), '<p>Local only.</p>\n');

    const result = kit.check();
    assert.equal(result.status, 0, result.stderr);
});
