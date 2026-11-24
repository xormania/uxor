import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const images = join(root, 'tools/ci/images');
const roles = {
    demo: {
        own: ['demo/composer.lock', 'demo/src'],
        excluded: ['website', 'packages/uxor', 'tools/tests/fixtures/fresh-app', 'button/tests'],
    },
    toolkit: {
        own: ['manifest.json', 'button/manifest.json', 'tools/tests/fresh-install.sh', 'tools/tests/fixtures/fresh-app'],
        excluded: ['demo', 'website', 'packages/uxor'],
    },
    package: {
        own: ['composer.lock', 'packages/uxor/src', 'packages/uxor/tests'],
        excluded: ['demo', 'website', 'button'],
    },
    docs: {
        own: ['website/composer.lock', 'website/src', 'website/tests'],
        excluded: ['demo', 'packages/uxor/dev', 'packages/uxor/src', 'button/tests'],
    },
};

function temporaryDirectory(t) {
    const path = mkdtempSync(join(tmpdir(), 'uxor-image-pipeline-'));
    t.after(() => rmSync(path, { recursive: true, force: true }));
    return path;
}

function stage(cwd, role, destination, env = process.env) {
    return spawnSync(process.execPath, [join(cwd, 'tools/ci/images/stage.mjs'), role, destination], {
        cwd, encoding: 'utf8', timeout: 30000, env,
    });
}

function git(cwd, env, ...args) {
    const command = spawnSync('git', [
        '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgSign=false', ...args,
    ], { cwd, encoding: 'utf8', env });
    assert.equal(command.status, 0, command.stderr);
}

for (const [role, { own, excluded }] of Object.entries(roles)) {
    test(`${role} builds from the shared runtime and tests in its own checkout`, (t) => {
        const destination = join(temporaryDirectory(t), role);
        const run = stage(root, role, destination);
        assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);

        const build = join(destination, 'build');
        assert.deepEqual(readdirSync(build), ['Dockerfile'], 'application content stays outside the Docker build context');
        const definition = readFileSync(join(build, 'Dockerfile'), 'utf8');
        assert.match(definition, /^FROM uxor-runtime\s*(?:#.*)?$/im, 'uses the normalized PHP runtime context');
        assert.doesNotMatch(definition, /^FROM\s+\S*xorder\S*$/im);
        assert.deepEqual(readFileSync(join(destination, 'test.sh')), readFileSync(join(images, role, 'test.sh')));

        const checkout = join(destination, 'test');
        for (const path of own) assert.ok(existsSync(join(checkout, path)), `${role} needs its own ${path}`);
        for (const path of [...excluded, '.git', '.github', 'vendor', 'node_modules']) {
            assert.ok(!existsSync(join(checkout, path)), `${role} must run without ${path}`);
        }
    });
}

test('context staging rejects paths outside the repository, tracked symlinks and private sibling source', (t) => {
    const work = temporaryDirectory(t);
    const repository = join(work, 'repository');
    const fixtures = join(repository, 'fixture');
    const roleDir = join(repository, 'tools/ci/images/toolkit');
    mkdirSync(fixtures, { recursive: true });
    mkdirSync(roleDir, { recursive: true });
    mkdirSync(join(repository, 'tools/ci/images/base'));
    mkdirSync(join(repository, 'demo'));
    for (const file of readdirSync(images, { withFileTypes: true }).filter((entry) => entry.isFile())) {
        copyFileSync(join(images, file.name), join(roleDir, '..', file.name));
    }
    copyFileSync(join(images, 'toolkit/Dockerfile'), join(roleDir, 'Dockerfile'));
    copyFileSync(join(images, 'toolkit/test.sh'), join(roleDir, 'test.sh'));
    copyFileSync(join(images, 'base/Dockerfile'), join(roleDir, '..', 'base/Dockerfile'));
    writeFileSync(join(work, 'outside.txt'), 'unrelated source\n');
    writeFileSync(join(fixtures, 'input.txt'), 'allowed source\n');
    writeFileSync(join(repository, 'demo/input.txt'), 'private sibling source\n');
    symlinkSync(join(work, 'outside.txt'), join(fixtures, 'link.txt'));
    const env = { ...process.env };
    delete env.GIT_INDEX_FILE;
    git(repository, env, 'init', '-q');

    const scenarios = [
        { entry: 'fixture/input.txt', status: 0 },
        { entry: '../outside.txt', status: 1 },
        { entry: 'fixture/link.txt', status: 1 },
        { entry: 'demo/', status: 1 },
    ];
    for (const [index, { entry, status }] of scenarios.entries()) {
        writeFileSync(join(roleDir, 'paths.json'), JSON.stringify({ php: '8.4', test: [entry] }));
        git(repository, env, 'add', '.');
        git(repository, env, 'commit', '-qm', 'Change declared fixture');
        const destination = join(work, `staged-${index}`);
        const run = stage(repository, 'toolkit', destination, env);
        assert.equal(run.status, status, `${entry}: ${run.stdout}${run.stderr}`);
        if (status === 0) {
            assert.equal(readFileSync(join(destination, 'test', entry), 'utf8'), 'allowed source\n');
        }
        assert.ok(!existsSync(join(destination, 'test/fixture/link.txt')));
        assert.ok(!existsSync(join(destination, 'test/demo')));
        assert.ok(!existsSync(join(destination, 'outside.txt')));
    }
});

test('an image definition validates its role and common build changes validate all roles', async () => {
    const { changedRoles } = await import('../ci/images/plan.mjs');
    assert.deepEqual(changedRoles(['README.md']), []);
    assert.deepEqual(changedRoles(['tools/ci/images/toolkit/paths.json']), ['toolkit']);
    assert.deepEqual(changedRoles(['tools/ci/images/docs/Dockerfile', 'tools/ci/images/demo/test.sh']), ['demo', 'docs']);
    for (const path of ['tools/ci/images/base/Dockerfile', 'tools/ci/images/plan.mjs', '.github/workflows/images.yml']) {
        assert.deepEqual(changedRoles([path]), Object.keys(roles), path);
    }
});

test('Bake composes one shared foundation per matching runtime with digest-only scoped cache imports', (t) => {
    const repository = 'example/uxor';
    const revision = 'a'.repeat(40);
    const php84 = `sha256:${'b'.repeat(64)}`;
    const toolkit = `sha256:${'c'.repeat(64)}`;
    const work = temporaryDirectory(t);
    const receipt = join(work, 'receipt.json');
    writeFileSync(receipt, JSON.stringify({ repository, commit: 'd'.repeat(40), cache: { php84, toolkit } }));
    const bake = (runDirectory) => spawnSync(process.execPath, [join(images, 'bake.mjs'), runDirectory, Object.keys(roles).join(' '), receipt], {
        cwd: root, encoding: 'utf8', timeout: 30000,
        env: { ...process.env, GITHUB_REPOSITORY: repository, IMAGE_COMMIT: revision },
    });
    const destination = join(work, 'all');
    const run = bake(destination);
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    const { group, target } = JSON.parse(readFileSync(join(destination, 'bake.json'), 'utf8'));
    assert.deepEqual(group.default.targets, Object.keys(roles));
    const foundations = new Set();
    for (const role of Object.keys(roles)) {
        const manifest = JSON.parse(readFileSync(join(images, role, 'paths.json'), 'utf8'));
        const foundation = `php${manifest.php.replace('.', '')}`;
        foundations.add(foundation);
        assert.equal(target[role].contexts['uxor-runtime'], `target:${foundation}`);
        assert.equal(target[foundation].args.PHP_BASE, foundation);
        assert.equal(target[role].context, join(destination, role, 'build'));
        assert.deepEqual(target[role].output, [`type=oci,dest=${join(destination, role, 'image.tar')}`]);
        assert.equal(target[role].labels['org.opencontainers.image.revision'], revision);
    }
    assert.deepEqual(Object.keys(target).sort(), [...Object.keys(roles), ...foundations].sort());
    assert.deepEqual(target.php84['cache-from'], [`type=registry,ref=ghcr.io/${repository}-image-cache@${php84}`]);
    assert.deepEqual(target.toolkit['cache-from'], [`type=registry,ref=ghcr.io/${repository}-image-cache@${toolkit}`]);
    for (const role of ['demo', 'docs', 'package', 'php85']) assert.deepEqual(target[role]['cache-from'], []);

    writeFileSync(receipt, JSON.stringify({ repository: 'fork/uxor', commit: 'd'.repeat(40), cache: { php84 } }));
    assert.notEqual(bake(join(work, 'foreign')).status, 0, 'another repository cannot supply the receipt');
    writeFileSync(receipt, JSON.stringify({ repository, commit: 'd'.repeat(40), cache: { php84: 'latest' } }));
    assert.notEqual(bake(join(work, 'mutable')).status, 0, 'a receipt cannot name a mutable cache tag');
});

test('publication admits only the current protected main commit with successful push evidence from this repo', async () => {
    const { publishCandidate } = await import('../ci/images/plan.mjs');
    const repository = 'example/uxor';
    const sha = 'a'.repeat(40);
    const checkout = { repository, sha, ref: 'refs/heads/main', protectedRef: true };
    const repo = { full_name: repository, default_branch: 'main' };
    const pass = {
        id: 120,
        run_attempt: 1,
        name: 'CI',
        path: '.github/workflows/ci.yml',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        head_branch: 'main',
        head_sha: sha,
        repository: repo,
        head_repository: repo,
    };
    const event = { action: 'completed', repository: repo, workflow_run: pass };
    assert.equal(publishCandidate('workflow_run', event, checkout), sha);
    assert.equal(publishCandidate('schedule', { repository: repo, ci: pass }, checkout), sha);
    assert.equal(publishCandidate('schedule', { repository: repo }, checkout), null);

    for (const overrides of [
        { path: '.github/workflows/other.yml' },
        { event: 'pull_request' },
        { status: 'in_progress', conclusion: null },
        { conclusion: 'failure' },
        { head_branch: 'dev' },
        { head_sha: 'b'.repeat(40) },
        { repository: { full_name: 'fork/uxor' } },
        { head_repository: { full_name: 'fork/uxor' } },
    ]) {
        const changed = { ...pass, ...overrides };
        assert.equal(publishCandidate('workflow_run', { ...event, workflow_run: changed }, checkout), null, JSON.stringify(overrides));
        assert.equal(publishCandidate('schedule', { repository: repo, ci: changed }, checkout), null, JSON.stringify(overrides));
    }

    assert.equal(publishCandidate('workflow_run', event, { ...checkout, protectedRef: false }), null);
    assert.equal(publishCandidate('workflow_run', event, { ...checkout, ref: 'refs/pull/12/merge' }), null);
    for (const name of ['push', 'pull_request', 'workflow_dispatch']) {
        assert.equal(publishCandidate(name, event, checkout), null, `${name} may validate images only`);
    }
});

test('the planner selects an unexpired cache receipt only from a verified publisher', (t) => {
    const work = temporaryDirectory(t);
    const bin = join(work, 'bin');
    mkdirSync(bin);
    const repository = 'xormania/uxor';
    const revision = 'a'.repeat(40);
    const repo = { full_name: repository };
    const push = {
        id: 30, run_attempt: 2, event: 'push', status: 'completed', conclusion: 'success',
        path: '.github/workflows/ci.yml', head_branch: 'main',
        head_sha: revision, repository: repo, head_repository: repo,
    };
    const publisher = { ...push, path: '.github/workflows/images.yml', event: 'workflow_run' };
    const event = join(work, 'event.json');
    const fixtures = join(work, 'gh.json');
    const rootAPI = `repos/${repository}/actions`;
    writeFileSync(event, JSON.stringify({ repository: repo, workflow_run: push, before: '0'.repeat(40) }));
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\njq -ce --arg route "$2" \'.[$route]\' "$IMAGE_GH_FIXTURES"\n', { mode: 0o755 });

    const listing = `${rootAPI}/workflows/images.yml/runs?branch=main&status=success&per_page=12`;
    const artifactPath = (run) => `${rootAPI}/runs/${run}/artifacts?name=uxor-image-cache-receipt`;
    const receipt = (expired) => ({ artifacts: [{ name: 'uxor-image-cache-receipt', expired }] });
    const sourceAttempt = `${rootAPI}/runs/30/attempts/2/jobs?per_page=100`;
    const api = {
        [listing]: { workflow_runs: [
            { ...publisher, id: 10, event: 'workflow_dispatch' },
            { ...publisher, id: 11, head_repository: { full_name: 'fork/uxor' } },
            { ...publisher, id: 12, path: '.github/workflows/other.yml' },
            { ...publisher, id: 13, conclusion: 'failure' },
            { ...publisher, id: 14 },
            { ...publisher, id: 15 },
        ] },
        [artifactPath(14)]: receipt(true),
        [artifactPath(15)]: receipt(false),
        [`${rootAPI}/workflows/ci.yml/runs?branch=main&event=push&head_sha=${revision}&status=success&per_page=10`]: { workflow_runs: [push] },
        [sourceAttempt]: { jobs: [{ name: 'CI result', status: 'completed', conclusion: 'success' }] },
    };
    writeFileSync(fixtures, JSON.stringify(api));

    const plan = (eventName, label, overrides = {}) => {
        const output = join(work, `outputs-${label}.txt`);
        const run = spawnSync(process.execPath, [join(images, 'plan.mjs')], {
            cwd: root, encoding: 'utf8', timeout: 30000,
            env: {
                ...process.env, PATH: `${bin}:${process.env.PATH}`, IMAGE_GH_FIXTURES: fixtures,
                GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: repository,
                GITHUB_OUTPUT: output, GITHUB_SHA: revision, GITHUB_REF: 'refs/heads/main', PROTECTED_REF: 'true',
                ...overrides,
            },
        });
        assert.equal(run.status, 0, `${eventName}: ${run.stdout}${run.stderr}`);
        const actual = new Map(readFileSync(output, 'utf8').trim().split('\n').map((line) => line.split('=')));
        assert.equal(actual.has('commit'), false, `${eventName} relies on GitHub's workflow revision`);
        return actual;
    };

    for (const [eventName, cacheRun, cold] of [['workflow_run', 15, false], ['schedule', '', true]]) {
        const actual = plan(eventName, eventName);
        assert.equal(actual.get('roles'), Object.keys(roles).join(' '));
        assert.equal(actual.get('publish'), 'true');
        assert.equal(actual.get('cache-run'), String(cacheRun));
        assert.equal(actual.get('cold'), String(cold));
    }

    for (const [eventName, selected] of [['push', Object.keys(roles).join(' ')], ['workflow_dispatch', 'docs']]) {
        const actual = plan(eventName, eventName, {
            GITHUB_REF: 'refs/heads/feature', PROTECTED_REF: 'false', SELECT_ROLE: 'docs',
        });
        assert.equal(actual.get('roles'), selected);
        assert.equal(actual.get('publish'), 'false');
        assert.equal(actual.get('cache-run'), '15');
        assert.equal(actual.get('cold'), 'false');
    }

    api[sourceAttempt].jobs[0].conclusion = 'skipped';
    writeFileSync(fixtures, JSON.stringify(api));
    const rejected = plan('workflow_run', 'missing-verdict');
    assert.equal(rejected.get('publish'), 'false');
    assert.equal(rejected.get('cache-run'), '');
});

test('cache restoration keeps a downloaded receipt only when registry authentication succeeds', (t) => {
    const work = temporaryDirectory(t);
    const bin = join(work, 'bin');
    mkdirSync(bin);
    const login = join(work, 'login');
    writeFileSync(join(bin, 'gh'), `#!/bin/sh
while [ "$#" -gt 0 ]; do
    if [ "$1" = --dir ]; then
        mkdir -p "$2"
        if [ "$DOWNLOAD" != absent ]; then printf '{}' > "$2/receipt.json"; fi
        if [ "$DOWNLOAD" = partial ]; then exit 12; fi
        exit 0
    fi
    shift
done
exit 1
`, { mode: 0o755 });
    writeFileSync(join(bin, 'docker'), `#!/bin/sh
[ "$1" = login ] && [ "$2" = ghcr.io ] || exit 2
touch "$LOGIN"
[ "$REGISTRY_AUTH" = accepted ]
`, { mode: 0o755 });

    for (const [download, auth, hasReceipt, reachedLogin] of [
        ['complete', 'accepted', true, true],
        ['complete', 'denied', false, true],
        ['absent', 'accepted', false, false],
        ['partial', 'accepted', false, false],
    ]) {
        const destination = join(work, `${download}-${auth}`);
        rmSync(login, { force: true });
        const run = spawnSync('bash', [join(images, 'restore-cache.sh'), destination], {
            cwd: root, encoding: 'utf8', timeout: 30000,
            env: {
                ...process.env, PATH: `${bin}:${process.env.PATH}`, DOWNLOAD: download, REGISTRY_AUTH: auth, LOGIN: login,
                GITHUB_REPOSITORY: 'xormania/uxor', GITHUB_ACTOR: 'fixture', CACHE_RUN: '15', GH_TOKEN: 'fixture-token',
            },
        });
        assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
        assert.equal(existsSync(join(destination, 'previous/receipt.json')), hasReceipt, `${download} ${auth}`);
        assert.equal(existsSync(login), reachedLogin, `${download} ${auth}`);
        if (!hasReceipt) assert.match(run.stdout, /Building without it/);
    }
});

test('only the evidence-gated image publisher has registry write access', () => {
    const workflow = readFileSync(join(root, '.github/workflows/images.yml'), 'utf8');
    const start = workflow.indexOf('\njobs:\n');
    assert.ok(start > 0, 'image workflow has a jobs section');
    const jobs = workflow.slice(start);
    const first = /^ +([a-z][\w-]*): *$/m.exec(jobs);
    assert.ok(first, 'image workflow has jobs');
    const depth = first[0].length - first[0].trimStart().length;
    const headers = [...jobs.matchAll(new RegExp(`^ {${depth}}([a-z][\\w-]*): *$`, 'gm'))];
    const definitions = new Map(headers.map((header, index) => [
        header[1], jobs.slice(header.index, headers[index + 1]?.index),
    ]));
    assert.ok(definitions.has('plan'));
    assert.ok(definitions.has('validate'));
    assert.ok(definitions.has('publish'));
    assert.doesNotMatch(workflow.slice(0, start), /packages:\s*write\b/);
    assert.doesNotMatch(jobs, /^\s+(?:ref|repository):/m, 'checkouts use the workflow revision and repository');
    assert.doesNotMatch(jobs, /\b(?:steps|needs)\.plan\.outputs\.commit\b/, 'the planner cannot select source code');
    for (const [job, definition] of definitions) {
        assert.match(definition, /uses: actions\/checkout@/, job);
        if (job === 'validate' || job === 'publish') {
            assert.match(definition, /^\s+IMAGE_COMMIT:\s*\$\{\{ github\.sha \}\}\s*$/m, job);
        }
        if (job === 'publish') {
            assert.match(definition, /^\s+packages:\s*write\s*(?:#.*)?$/m);
            assert.match(definition, /^\s+needs:\s*.*\bplan\b/m);
            const gate = definition.slice(0, definition.indexOf('\n        concurrency:'));
            assert.match(gate, /\bneeds\.plan\.outputs\.publish\s*==\s*'true'/);
            assert.match(gate, /\bgithub\.event_name\s*==\s*'workflow_run'/);
            assert.match(gate, /\bgithub\.event_name\s*==\s*'schedule'/);
            assert.match(gate, /\bgithub\.ref\s*==\s*'refs\/heads\/main'/);
            assert.match(gate, /\bgithub\.ref_protected\b/);
        } else {
            assert.doesNotMatch(definition, /packages:\s*write\b/, job);
        }
    }
});

test('a failed role smoke test preserves every result without marking the failed images as tested', (t) => {
    const work = temporaryDirectory(t);
    const bin = join(work, 'bin');
    mkdirSync(bin);
    const smokes = ['demo', 'toolkit', 'package'];
    const config = Object.fromEntries(smokes.map((role, index) => [role, `sha256:${String(index + 1).repeat(64)}`]));
    writeFileSync(join(bin, 'docker'), `#!/bin/bash
set -euo pipefail
case "$1" in
    buildx)
        test "$2" = bake
        for role in $IMAGE_ROLES; do printf '%s archive\\n' "$role" > "$role/image.tar"; done
        echo '#1 CACHED'
        ;;
    image)
        test "$2" = inspect
        role=\${5#uxor-ci-}
        jq -er --arg role "\${role%:tested}" '.[$role]' <<< "$FIXTURE_CONFIG"
        ;;
    run)
        for arg in "$@"; do
            if [[ "$arg" == sha256:* ]]; then
                role=$(jq -er --arg id "$arg" 'to_entries[] | select(.value == $id) | .key' <<< "$FIXTURE_CONFIG")
                printf '%s\\n' "$role" >> "$SMOKE_RUNS"
                exit "$(jq -er --arg role "$role" '.[$role]' <<< "$SMOKE_RESULTS")"
            fi
        done
        exit 99
        ;;
    *) exit 99 ;;
esac
`, { mode: 0o755 });
    writeFileSync(join(bin, 'skopeo'), `#!/bin/bash
set -euo pipefail
case "$1" in
    inspect)
        test "$2" = --raw
        role=$(basename "$(dirname "\${3#oci-archive:}")")
        jq -ce --arg role "$role" '{config: {digest: .[$role]}}' <<< "$FIXTURE_CONFIG"
        ;;
    manifest-digest)
        digest=$(sha256sum "$2")
        printf 'sha256:%s\\n' "\${digest%% *}"
        ;;
    copy) test "\${3#docker-daemon:uxor-ci-}" != "$3" ;;
    *) exit 99 ;;
esac
`, { mode: 0o755 });

    for (const [name, results, status] of [
        ['mixed', { demo: 41, toolkit: 0, package: 52 }, 1],
        ['all-passed', { demo: 0, toolkit: 0, package: 0 }, 0],
    ]) {
        const destination = join(work, name);
        const summary = join(work, `${name}.md`);
        const calls = join(work, `${name}-calls.txt`);
        const run = spawnSync('bash', [join(images, 'build.sh'), destination], {
            cwd: root, encoding: 'utf8', timeout: 30000,
            env: {
                ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'xormania/uxor',
                IMAGE_COMMIT: 'a'.repeat(40), IMAGE_ROLES: smokes.join(' '), IMAGE_COLD: 'false',
                FIXTURE_CONFIG: JSON.stringify(config), SMOKE_RESULTS: JSON.stringify(results), SMOKE_RUNS: calls,
                GITHUB_STEP_SUMMARY: summary,
            },
        });
        assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), smokes, 'continue through all role tests');
        assert.equal(run.status, status, `${run.stdout}${run.stderr}`);
        const [, ...timings] = readFileSync(join(destination, 'timings.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
        assert.deepEqual(timings.map(({ role, test_exit_code }) => [role, test_exit_code]), Object.entries(results));
        const table = readFileSync(summary, 'utf8').split('\n');
        for (const [role, code] of Object.entries(results)) {
            const row = table.find((line) => line.startsWith(`| ${role} |`));
            assert.ok(row?.includes(code === 0 ? 'Passed' : `Failed (exit ${code})`), `${role} reports exit ${code}`);
            assert.equal(existsSync(join(destination, role, 'tested.sha256')), code === 0, `only passed ${role} can be published`);
        }
    }
});

test('a changed OCI archive fails verification before the publisher touches the registry', (t) => {
    const work = temporaryDirectory(t);
    const bin = join(work, 'bin');
    const role = join(work, 'toolkit');
    mkdirSync(bin);
    mkdirSync(role);
    const marker = join(work, 'registry-access');
    const archive = join(role, 'image.tar');
    const valid = 'tested image fixture';
    const hash = createHash('sha256').update(valid).digest('hex');
    writeFileSync(archive, valid);
    writeFileSync(join(role, 'tested.sha256'), `${hash}  ${archive}\n`);
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$IMAGE_COMMIT"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$1" >> "$REGISTRY_MARKER"\nexit 42\n', { mode: 0o755 });
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    assert.equal(revision.status, 0, revision.stderr);
    const sha = revision.stdout.trim();
    const publish = () => spawnSync('bash', [join(images, 'publish.sh'), work], {
        cwd: root, encoding: 'utf8', timeout: 30000,
        env: {
            ...process.env, PATH: `${bin}:${process.env.PATH}`, REGISTRY_MARKER: marker,
            GITHUB_REPOSITORY: 'xormania/uxor', GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true',
            GITHUB_EVENT_NAME: 'workflow_run', GITHUB_SHA: sha, IMAGE_COMMIT: sha, IMAGE_ROLES: 'toolkit',
            GH_TOKEN: 'fixture-token', GITHUB_ACTOR: 'fixture', DOCKER_CONFIG: join(work, 'docker-config'),
        },
    });
    const accepted = publish();
    assert.equal(accepted.status, 42, `${accepted.stdout}${accepted.stderr}`);
    assert.match(readFileSync(marker, 'utf8'), /^login$/m, 'control reaches the stubbed registry login');
    rmSync(marker);

    writeFileSync(archive, 'different image fixture');
    const rejected = publish();
    assert.equal(rejected.status, 1, `${rejected.stdout}${rejected.stderr}`);
    assert.match(rejected.stdout + rejected.stderr, /FAILED|did NOT match/i);
    assert.ok(!existsSync(marker), 'a rejected archive never reaches the registry');
});

test('image cache publication verifies the BuildKit manifest digest before writing a receipt', (t) => {
    const work = temporaryDirectory(t);
    const bin = join(work, 'bin');
    mkdirSync(bin);
    const role = join(work, 'toolkit');
    mkdirSync(role);
    const archive = join(role, 'image.tar');
    const contents = 'tested image fixture';
    const hash = (input) => createHash('sha256').update(input).digest('hex');
    writeFileSync(archive, contents);
    writeFileSync(join(role, 'tested.sha256'), `${hash(contents)}  ${archive}\n`);
    writeFileSync(join(role, 'manifest.json'), '{"fixture":"tested image"}\n');
    writeFileSync(join(work, 'bake.json'), JSON.stringify({ target: { toolkit: {} } }));
    const cacheManifest = '{"fixture":"BuildKit cache manifest"}';
    const digest = `sha256:${hash(cacheManifest)}`;
    const repository = 'xormania/uxor';
    const cacheRef = `docker://ghcr.io/${repository}-image-cache@${digest}`;
    const registryReads = join(work, 'cache-reads.txt');
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$IMAGE_COMMIT"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'docker'), `#!/bin/sh
set -eu
case "$1" in
    login) test "$2" = ghcr.io; cat >/dev/null ;;
    logout) test "$2" = ghcr.io ;;
    buildx)
        test "$2 $3 $4 $5 $6" = 'bake --file bake.json --progress=plain toolkit'
        case "$*" in *image-manifest=true*) ;; *) exit 99 ;; esac
        printf '%s\\n' "$BUILDKIT_PROGRESS" >&2
        ;;
    *) exit 99 ;;
esac
`, { mode: 0o755 });
    writeFileSync(join(bin, 'skopeo'), `#!/bin/sh
set -eu
case "$1" in
    manifest-digest)
        checksum=$(sha256sum "$2")
        printf 'sha256:%s\\n' "\${checksum%% *}"
        ;;
    copy) test "$4" = --preserve-digests ;;
    inspect)
        test "$4" = --raw
        case "$5" in
            docker://ghcr.io/xormania/uxor-ci-toolkit:*) cat "$IMAGE_MANIFEST" ;;
            docker://ghcr.io/xormania/uxor-image-cache*)
                printf '%s\\n' "$5" >> "$REGISTRY_READS"
                test "$5" = "$EXPECTED_CACHE_REF"
                printf '%s' "$CACHE_MANIFEST"
                ;;
            *) exit 99 ;;
        esac
        ;;
    *) exit 99 ;;
esac
`, { mode: 0o755 });
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    assert.equal(revision.status, 0, revision.stderr);
    const sha = revision.stdout.trim();
    const publish = (progress) => spawnSync('bash', [join(images, 'publish.sh'), work], {
        cwd: root, encoding: 'utf8', timeout: 30000,
        env: {
            ...process.env, PATH: `${bin}:${process.env.PATH}`, BUILDKIT_PROGRESS: progress,
            GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true',
            GITHUB_EVENT_NAME: 'workflow_run', GITHUB_SHA: sha, IMAGE_COMMIT: sha, IMAGE_ROLES: 'toolkit',
            GITHUB_RUN_ID: '30', GITHUB_RUN_ATTEMPT: '2', GH_TOKEN: 'fixture-token', GITHUB_ACTOR: 'fixture',
            DOCKER_CONFIG: join(work, 'docker-config'), IMAGE_MANIFEST: join(role, 'manifest.json'),
            EXPECTED_CACHE_REF: cacheRef, REGISTRY_READS: registryReads, CACHE_MANIFEST: cacheManifest,
        },
    });
    const receipt = join(work, 'receipt.json');
    for (const progress of [
        `#9 writing cache image manifest ${digest}\n#9 writing cache image manifest ${digest} done`,
        `#9 writing cache manifest ${digest} 0.3s done`,
    ]) {
        const run = publish(progress);
        assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
        assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')), { repository, commit: sha, cache: { toolkit: digest } });
        assert.equal(readFileSync(registryReads, 'utf8'), `${cacheRef}\n`, 'the cache is fetched by the exporter digest');
        rmSync(receipt);
        rmSync(registryReads);
    }

    for (const progress of [
        '#9 exporting cache to registry done',
        `#9 writing cache image manifest ${digest} done\n#9 writing cache image manifest sha256:${'a'.repeat(64)} done`,
    ]) {
        const run = publish(progress);
        assert.notEqual(run.status, 0, progress);
        assert.ok(!existsSync(receipt), 'publication cannot write a receipt without one exporter digest');
        assert.ok(!existsSync(registryReads), 'publication rejects uncertain exporter output before fetching a cache');
    }
});

test('the daily image refresh is scheduled ahead of each weekly Dependabot version check', () => {
    const refresh = readFileSync(join(root, '.github/workflows/refresh-images.yml'), 'utf8');
    const dependabot = readFileSync(join(root, '.github/dependabot.yml'), 'utf8');
    const schedule = /^\s+- cron: ['"](\d{1,2}) (\d{1,2}) \* \* \*['"]\s*(?:#.*)?$/m.exec(refresh);
    assert.ok(schedule, 'there is a daily UTC refresh');
    const [, minute, hour] = schedule.map(Number);
    assert.ok(minute > 0 && minute < 60 && hour >= 0 && hour < 24, 'the refresh avoids the top of the hour');
    assert.match(refresh, /^\s+workflow_dispatch:/m, 'a manual refresh is available');

    const entries = dependabot.split(/^\s*- package-ecosystem: /m).slice(1);
    assert.ok(entries.length > 0);
    for (const entry of entries) {
        const ecosystem = entry.split('\n', 1)[0];
        assert.match(entry, /^\s+interval: weekly\s*$/m);
        assert.match(entry, /^\s+day: ['"]?monday['"]?\s*$/m);
        const time = /^\s+time: ['"]?(\d{2}):(\d{2})['"]?\s*$/m.exec(entry);
        assert.ok(time, `${ecosystem} has a configured weekly time`);
        const timezone = /^\s+timezone: ['"]?([^'"\s]+)['"]?\s*$/m.exec(entry);
        assert.ok(!timezone || timezone[1] === 'UTC', 'the two schedules use the same time zone');
        assert.ok(60 * Number(time[1]) + Number(time[2]) > 60 * hour + minute, `${ecosystem} runs after image refresh`);
    }
});

test('Dependabot and the image refresher have distinct ownership of version changes', () => {
    const dependabot = readFileSync(join(root, '.github/dependabot.yml'), 'utf8');
    const entries = dependabot.split(/^\s*- package-ecosystem: /m).slice(1);
    const legacyDocker = entries.filter((entry) => /^docker\s*$/m.test(entry));
    assert.equal(legacyDocker.length, 1);
    const directories = /\bdirectories: \[([^\]]+)\]/.exec(legacyDocker[0])?.[1].split(',').map((path) => path.trim()).sort();
    assert.deepEqual(directories, [
        '/demo', '/packages/uxor/dev/images/php', '/packages/uxor/dev/images/serena',
        '/packages/uxor/resources/mago', '/packages/uxor/resources/mago/serena',
    ]);

    const clients = [
        ['/', '@playwright/test'],
        ['/packages/uxor/dev', '@playwright/test'],
        ['/packages/uxor/resources/browser', 'playwright-core'],
    ];
    for (const [directory, name] of clients) {
        const entry = entries.find((item) => item.startsWith('npm\n') && item.includes(`directory: ${directory}\n`));
        assert.ok(entry, `Dependabot still handles other dependencies for ${directory}`);
        assert.ok(entry.split('\n').some((line) => line.trim().replace(/['"]/g, '') === `- dependency-name: ${name}`), `${name} pin from ${directory} is kept together with the image`);
    }
});
