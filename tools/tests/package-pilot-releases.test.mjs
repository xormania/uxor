import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportPilotSources } from '../package-pilot-releases.mjs';

test('baseline export reads committed inputs even when archive rules hide them and working copies changed', (t) => {
    const work = mkdtempSync(join(tmpdir(), 'uxor-releases-'));
    t.after(() => rmSync(work, { recursive: true, force: true }));
    const repository = join(work, 'repository');
    mkdirSync(join(repository, 'packages/uxor-pilot'), { recursive: true });
    writeFileSync(join(repository, '.gitattributes'), '/packages export-ignore\n');
    writeFileSync(join(repository, 'packages/uxor-pilot/composer.json'), '{"baseline":true}\n');
    const git = (...args) => execFileSync('git', args, { cwd: repository, stdio: 'pipe' });
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline');
    writeFileSync(join(repository, 'packages/uxor-pilot/composer.json'), '{"candidate":true}\n');
    const output = join(work, 'baseline');
    const sha = exportPilotSources('HEAD', output, repository);
    assert.match(sha, /^[a-f0-9]{40}$/);
    assert.equal(readFileSync(join(output, 'packages/uxor-pilot/composer.json'), 'utf8'), '{"baseline":true}\n');
    assert.throws(() => exportPilotSources('HEAD', output, repository), /must not exist/);
});
