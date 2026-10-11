// .github/workflows/release.yml's release job, run step by step on a scratch repository whose main merges release pull
// requests from dev, with `gh`, `git push` and tools/tests/docker-install.sh stubbed: which versions get an install
// check, a tag and a Release, in which order, which one stays "Latest", and whether the job ends green so that the
// gallery (`pages`, needs: release) is published. Each run step runs as GitHub runs it: bash --noprofile --norc -eo
// pipefail. Our workflow's layout only (a mapping per step, `run: |` blocks), not YAML at large.
// Run: node --test tools/tests/*.test.mjs
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();

const indent = (line) => line.length - line.trimStart().length;
const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2');

/** The steps of a job: name, id, if, env, continue-on-error, uses and run. */
function steps(text, job) {
    const lines = text.split('\n');
    const start = lines.findIndex((line) => line === `    ${job}:`);
    assert.ok(start >= 0, `no job ${job}`);
    const head = lines.findIndex((line, i) => i > start && /^ {8}steps:\s*$/.test(line));
    const list = [];
    let step = null;
    for (let i = head + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() && indent(line) <= 8) break;
        if (/^ {12}- /.test(line)) list.push((step = { env: {} }));
        const key = /^ {12}(?:- | {2})([a-z-]+):\s?(.*)$/.exec(line);
        if (!key) continue;
        const [, name, value] = key;
        if (name === 'run' && /^\|/.test(value)) {
            const block = [];
            while (i + 1 < lines.length && (!lines[i + 1].trim() || indent(lines[i + 1]) > 14)) block.push(lines[++i]);
            const depth = Math.min(...block.filter((l) => l.trim()).map(indent));
            step.run = block.map((l) => l.slice(depth)).join('\n').replace(/\n+$/, '\n');
        } else if (name === 'env' || name === 'with') {
            while (i + 1 < lines.length && (!lines[i + 1].trim() || indent(lines[i + 1]) > 14)) {
                const entry = /^\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(lines[++i]);
                if (entry && name === 'env') step.env[entry[1]] = unquote(entry[2].replace(/\s+#.*$/, ''));
            }
        } else {
            step[name] = unquote(value.replace(/\s+#.*$/, ''));
        }
    }
    return list;
}

/** `${{ steps.<id>.outputs.<name> }}` and the like, from the outputs so far. */
function expand(value, outputs) {
    return value.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expression) => {
        if (/^github\.token$/.test(expression)) return 'token';
        const output = /^steps\.([a-z0-9_-]+)\.outputs\.([a-z0-9_-]+)$/.exec(expression);
        assert.ok(output, `unknown expression ${expression}`);
        return outputs[output[1]]?.[output[2]] ?? '';
    });
}

/** A step's `if:`, the subset this job uses: success(), failure(), always(), !cancelled(), an output compared. */
function holds(condition, outputs, failed) {
    if (condition === undefined) return !failed;
    const terms = condition.replace(/^\$\{\{\s*|\s*\}\}$/g, '').split(/\s*&&\s*/);
    let status = null;
    const values = terms.map((term) => {
        if (term === 'failure()') return (status = failed);
        if (term === 'success()') return (status = !failed);
        if (term === 'always()' || term === '!cancelled()') return (status = true);
        const compare = /^steps\.([a-z0-9_-]+)\.outputs\.([a-z0-9_-]+)\s*(==|!=)\s*'(.*)'$/.exec(term);
        assert.ok(compare, `unknown condition ${term}`);
        const value = outputs[compare[1]]?.[compare[2]] ?? '';
        return compare[3] === '==' ? value === compare[4] : value !== compare[4];
    });
    return (status === null ? !failed : true) && values.every(Boolean);
}

const g = (cwd, ...args) => {
    const run = spawnSync(realGit, ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'tag.gpgSign=false', '-c', 'commit.gpgSign=false', ...args], { cwd, encoding: 'utf8' });
    assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
    return run.stdout.trim();
};

/**
 * A scratch repository like main after the 0.2.0 release: 0.1.0's and 0.2.0's release pull requests merged (newest
 * first in CHANGELOG.md), with tools/release-plan.sh, a stubbed tools/tests/docker-install.sh and manifest.json.
 */
function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'release-workflow-'));
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'tools/tests'), { recursive: true });
    copyFileSync(join(root, 'tools/release-plan.sh'), join(repo, 'tools/release-plan.sh'));
    // today's install check fails on what it cannot install (DOCKER_FAIL: refs), like the recipes 0.1.0 lacks
    writeFileSync(join(repo, 'tools/tests/docker-install.sh'), `#!/usr/bin/env bash
set -euo pipefail
echo "docker-install $KIT_REF" >> "$CALLS"
for ref in \${DOCKER_FAIL:-}; do
    if [ "$ref" = "$KIT_REF" ]; then echo "install of $KIT_REF failed: no recipe data-table" >&2; exit 1; fi
done
`);
    chmodSync(join(repo, 'tools/tests/docker-install.sh'), 0o755);
    writeFileSync(join(repo, 'manifest.json'), '{ "name": "UXor" }\n');
    const changelog = (body) => writeFileSync(join(repo, 'CHANGELOG.md'), `# Changelog\n\n## [Unreleased]\n${body}`);
    g(dir, 'init', '-q', '-b', 'main', repo);
    changelog('\n### Added\n\n- first\n');
    g(repo, 'add', '-A');
    g(repo, 'commit', '-qm', 'start');
    g(repo, 'checkout', '-qb', 'dev');
    changelog('\n## [0.1.0] - 2026-10-01\n\n### Added\n\n- first\n');
    g(repo, 'commit', '-qam', 'chore: release 0.1.0');
    g(repo, 'checkout', '-q', 'main');
    g(repo, 'merge', '-q', '--no-ff', 'dev', '-m', 'Merge pull request #1: release 0.1.0');
    const rel1 = g(repo, 'rev-parse', 'HEAD');
    g(repo, 'checkout', '-q', 'dev');
    g(repo, 'merge', '-q', 'main');
    changelog('\n## [0.2.0] - 2026-10-11\n\n### Added\n\n- second\n\n## [0.1.0] - 2026-10-01\n\n### Added\n\n- first\n');
    g(repo, 'commit', '-qam', 'chore: release 0.2.0');
    g(repo, 'checkout', '-q', 'main');
    g(repo, 'merge', '-q', '--no-ff', 'dev', '-m', 'Merge pull request #2: release 0.2.0');
    const rel2 = g(repo, 'rev-parse', 'HEAD');

    // gh: `release view` finds the versions of GH_RELEASED; `release create` logs its arguments, fails for GH_FAIL
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
    'release view') for v in \${GH_RELEASED:-}; do [ "$v" = "$3" ] && exit 0; done; echo 'release not found' >&2; exit 1 ;;
    'release create')
        shift 2
        echo "gh release create $*" >> "$CALLS"
        for v in \${GH_FAIL:-}; do [ "$v" = "$1" ] && { echo "HTTP 422: $1 failed" >&2; exit 1; }; done
        exit 0 ;;
esac
echo "gh: unexpected $*" >&2; exit 2
`);
    // git: a push is logged, not sent
    writeFileSync(join(bin, 'git'), `#!/usr/bin/env bash
if [ "$1" = push ]; then echo "git $*" >> "$CALLS"; exit 0; fi
exec ${realGit} "$@"
`);
    chmodSync(join(bin, 'gh'), 0o755);
    chmodSync(join(bin, 'git'), 0o755);
    return { dir, repo, bin, rel1, rel2 };
}

/** The release job's run steps in order, as GitHub runs them: its result, the calls made, the log. */
function runJob(fx, env = {}) {
    const temp = join(fx.dir, 'runner-temp');
    mkdirSync(temp, { recursive: true });
    const calls = join(fx.dir, 'calls');
    writeFileSync(calls, '');
    const outputs = {};
    let failed = false;
    let log = '';
    const ran = [];
    for (const [index, step] of steps(workflow, 'release').entries()) {
        if (!holds(step.if, outputs, failed)) continue;
        if (step.uses) continue; // the checkout (the scratch repository is checked out) and the Jev diagnosis
        if (!step.run) continue;
        const script = join(temp, `step-${index}.sh`);
        const output = join(temp, `output-${index}`);
        writeFileSync(script, step.run);
        writeFileSync(output, '');
        const stepEnv = Object.fromEntries(Object.entries(step.env).map(([k, v]) => [k, expand(v, outputs)]));
        const run = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
            cwd: fx.repo,
            encoding: 'utf8',
            env: { PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.dir, RUNNER_TEMP: temp, GITHUB_OUTPUT: output, CALLS: calls, ...env, ...stepEnv },
        });
        log += `--- ${step.name} (exit ${run.status})\n${run.stdout}${run.stderr}`;
        ran.push(step.name);
        if (step.id) {
            outputs[step.id] = Object.fromEntries(readFileSync(output, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
        }
        if (run.status !== 0 && step['continue-on-error'] !== 'true') failed = true;
    }
    const versions = outputs.versions?.versions ?? '';
    return {
        failed,
        // pages: needs: release, if: needs.release.outputs.versions != ''
        pages: !failed && versions !== '',
        versions,
        calls: readFileSync(calls, 'utf8').split('\n').filter(Boolean),
        log,
        ran,
        notes: (version) => (existsSync(join(temp, 'notes', `${version}.md`)) ? readFileSync(join(temp, 'notes', `${version}.md`), 'utf8') : null),
    };
}

const creates = (calls) => calls.filter((c) => c.startsWith('gh release create '));
const installs = (calls) => calls.filter((c) => c.startsWith('docker-install '));

test('0.2.0 merged, 0.1.0 tagged without a Release: the install check, the tag and "Latest" are 0.2.0\'s; 0.1.0 is published from its notes, not Latest; the gallery follows', () => {
    const fx = fixture();
    try {
        g(fx.repo, 'tag', '-a', '0.1.0', fx.rel1, '-m', 'UXor 0.1.0');
        const job = runJob(fx, { DOCKER_FAIL: `0.1.0 ${fx.rel1}` });
        assert.equal(job.versions, '0.2.0 0.1.0', job.log);
        assert.deepEqual(installs(job.calls), [`docker-install ${fx.rel2}`], job.log);
        assert.deepEqual(job.calls.filter((c) => c.startsWith('git push')), ['git push origin refs/tags/0.2.0'], job.log);
        const made = creates(job.calls);
        assert.equal(made.length, 2, job.log);
        assert.match(made[0], /^gh release create 0\.2\.0 /, 'the newest version first');
        assert.doesNotMatch(made[0], /--latest=false/);
        assert.match(made[1], /^gh release create 0\.1\.0 .*--verify-tag/);
        assert.match(made[1], /--latest=false/, 'an older version never takes "Latest" from 0.2.0');
        assert.match(job.notes('0.1.0'), /^- first$/m);
        assert.equal(job.failed, false, job.log);
        assert.equal(job.pages, true);
        assert.equal(g(fx.repo, 'rev-parse', '0.2.0^{commit}'), fx.rel2);
    } finally {
        rmSync(fx.dir, { recursive: true, force: true });
    }
});

test("an older version's Release that cannot be published warns, and neither 0.2.0 nor the gallery waits on it", () => {
    const fx = fixture();
    try {
        g(fx.repo, 'tag', '-a', '0.1.0', fx.rel1, '-m', 'UXor 0.1.0');
        const job = runJob(fx, { GH_FAIL: '0.1.0' });
        assert.match(creates(job.calls)[0], /^gh release create 0\.2\.0 /, job.log);
        assert.match(job.log, /::warning::.*0\.1\.0/);
        assert.equal(job.failed, false, job.log);
        assert.equal(job.pages, true);
    } finally {
        rmSync(fx.dir, { recursive: true, force: true });
    }
});

test("an older version without a tag gets no install check and no tag: a warning says how to tag it by hand", () => {
    const fx = fixture();
    try {
        const job = runJob(fx, { DOCKER_FAIL: fx.rel1 });
        assert.deepEqual(installs(job.calls), [`docker-install ${fx.rel2}`], job.log);
        assert.deepEqual(job.calls.filter((c) => c.startsWith('git push')), ['git push origin refs/tags/0.2.0'], job.log);
        assert.deepEqual(creates(job.calls).map((c) => c.split(' ')[3]), ['0.2.0'], job.log);
        assert.match(job.log, new RegExp(`::warning::.*0\\.1\\.0.*${fx.rel1}`));
        assert.equal(job.failed, false, job.log);
        assert.equal(job.pages, true);
    } finally {
        rmSync(fx.dir, { recursive: true, force: true });
    }
});

test('the new version fails its install check: no tag, no Release, the job fails and the gallery waits', () => {
    const fx = fixture();
    try {
        g(fx.repo, 'tag', '-a', '0.1.0', fx.rel1, '-m', 'UXor 0.1.0');
        const job = runJob(fx, { DOCKER_FAIL: fx.rel2 });
        assert.deepEqual(installs(job.calls), [`docker-install ${fx.rel2}`], job.log);
        assert.deepEqual(job.calls.filter((c) => c.startsWith('git push')), [], job.log);
        assert.deepEqual(creates(job.calls), [], job.log);
        assert.equal(job.failed, true);
        assert.equal(job.pages, false);
    } finally {
        rmSync(fx.dir, { recursive: true, force: true });
    }
});

test('a re-run after the tag was pushed and before the Release: 0.2.0 is published, Latest, without a second install check', () => {
    const fx = fixture();
    try {
        g(fx.repo, 'tag', '-a', '0.1.0', fx.rel1, '-m', 'UXor 0.1.0');
        g(fx.repo, 'tag', '-a', '0.2.0', fx.rel2, '-m', 'UXor 0.2.0');
        const job = runJob(fx, { GH_RELEASED: '0.1.0' });
        assert.equal(job.versions, '0.2.0', job.log);
        assert.deepEqual(installs(job.calls), [], job.log);
        assert.deepEqual(job.calls.filter((c) => c.startsWith('git push')), [], job.log);
        const made = creates(job.calls);
        assert.equal(made.length, 1, job.log);
        assert.match(made[0], /^gh release create 0\.2\.0 .*--verify-tag/);
        assert.doesNotMatch(made[0], /--latest=false/);
        assert.equal(job.failed, false, job.log);
        assert.equal(job.pages, true);
    } finally {
        rmSync(fx.dir, { recursive: true, force: true });
    }
});

test('every version released: nothing runs, and no gallery', () => {
    const fx = fixture();
    try {
        const job = runJob(fx, { GH_RELEASED: '0.1.0 0.2.0' });
        assert.equal(job.versions, '');
        assert.deepEqual(job.calls, []);
        assert.equal(job.failed, false, job.log);
        assert.equal(job.pages, false);
    } finally {
        rmSync(fx.dir, { recursive: true, force: true });
    }
});
