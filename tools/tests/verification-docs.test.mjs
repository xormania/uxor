import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('the test inventory diagnoses a missing consumer browser or runtime check', (t) => {
    const scratch = mkdtempSync(join(tmpdir(), 'uxor-inventory-test-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const checkout = join(scratch, 'checkout');
    execFileSync('git', ['clone', '--quiet', '--shared', root, checkout]);
    for (const path of ['tools/test-inventory.mjs', 'docs/TEST-INVENTORY.md']) {
        cpSync(join(root, path), join(checkout, path));
    }

    const verify = () => {
        const result = spawnSync(process.execPath, ['tools/test-inventory.mjs'], {
            cwd: checkout, encoding: 'utf8', timeout: 15_000,
        });
        assert.ifError(result.error);
        return result;
    };

    const baseline = verify();
    assert.equal(baseline.status, 0, baseline.stderr);
    const checks = [
        'packages/uxor/dev/e2e/customer-workflow.spec.mjs',
        'packages/uxor/dev/check-workflow-runtime.php',
    ];
    for (const path of checks) rmSync(join(checkout, path));

    const absent = verify();
    assert.notEqual(absent.status, 0, 'inventory verification rejects missing consumer checks');
    for (const path of checks) {
        assert.ok(absent.stderr.includes(path), `the diagnostic names ${path}:\n${absent.stderr}`);
    }
});

test('the kit archive contains the relative inline link and image targets of its entry pages', () => {
    const archive = execFileSync('git', ['archive', '--format=tar.gz', 'HEAD'], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    const members = new Set(execFileSync('tar', ['-tzf', '-'], { input: archive, encoding: 'utf8' }).trim().split('\n'));
    const broken = [];
    for (const path of ['README.md', 'INSTALL.md']) {
        assert.ok(members.has(path), `${path} ships in the archive`);
        const markdown = readFileSync(join(root, path), 'utf8');
        for (const [, angle, bare] of markdown.matchAll(/!?\[[^\]\n]+\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/g)) {
            const target = angle ?? bare;
            if (/^(?:[#?]|\/\/|[a-z][a-z0-9+.-]*:)/i.test(target)) continue;
            const destination = posix.join(posix.dirname(path), decodeURIComponent(target.split(/[?#]/, 1)[0]));
            if (!members.has(destination) && !members.has(destination + '/')) broken.push(`${path} → ${target}`);
        }
    }
    assert.deepEqual(broken, [], 'relative links and images work when browsing the distribution archive');
});
