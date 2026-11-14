// The demo's production image (demo/Dockerfile, target frankenphp_prod) is built and started by CI, not only read as text
// (demo/tests/Security/ProductionConfigurationTest.php): a lane that runs for a change to demo/Dockerfile or the
// Compose files (ci.yml's Changes job and tools/ci-changes.sh, or a workflow's pull_request paths), and a lane of the
// release checks. Each lane names the target it builds, builds it from the repository root with demo/Dockerfile (the
// kit's files the image needs sit beside the demo; demo/Dockerfile.dockerignore, an allow-list, chooses them) and states
// its one platform, linux/amd64. The development image keeps the repository bind-mounted, as on disk.
// Run: node --test tools/tests/prod-image-workflow.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflowsDir = '.github/workflows';
const TRIGGERS = ['demo/Dockerfile', 'demo/Dockerfile.dockerignore', 'demo/compose.yaml', 'demo/compose.override.yaml', 'demo/frankenphp/Caddyfile', 'demo/frankenphp/docker-entrypoint.sh'];
/** Changes that leave the image's build inputs alone: a guide, a recipe's template, a browser spec. */
const UNRELATED = ['docs/GUIDE.md', 'alert/templates/components/Alert.html.twig', 'tests/e2e/smoke.spec.ts'];

const workflows = readdirSync(join(root, workflowsDir))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => ({ path: `${workflowsDir}/${name}`, text: readFileSync(join(root, workflowsDir, name), 'utf8') }));

const code = (text) => text.split('\n').filter((line) => !/^\s*#/.test(line)).map((line) => line.replace(/\s+#.*$/, '')).join('\n');

/** The jobs of a workflow (jobs at 4 spaces), their comment lines left out. */
function jobs(workflow) {
    const at = workflow.text.indexOf('\njobs:\n');
    if (at < 0) return [];
    const body = workflow.text.slice(at);
    return [...body.matchAll(/^ {4}([a-z][a-z0-9_-]*):\n([\s\S]*?)(?=^ {4}[a-z][a-z0-9_-]*:\n|(?![\s\S]))/gm)].map(([, id, text]) => ({ workflow, id, text: code(text) }));
}

/** Whether a job builds the frankenphp_prod target, named in the job, with no development Compose override. */
const buildsProd = (job) => /frankenphp_prod\b(?!_)/.test(job.text) && /\b(?:docker\s+(?:buildx\s+)?(?:build|bake)|docker\/(?:bake|build-push)-action@|compose\s.*\bbuild\b|prod-image\.sh)/.test(job.text) && !/compose\.override\.yaml/.test(job.text);

/** Whether a job starts a container from the image it built: docker run, compose up on named files, or the harness. */
function startsIt(job) {
    if (/\bdocker\s+(?:container\s+)?run\b/.test(job.text) || /\btools\/tests\/prod-image\.sh\b/.test(job.text)) return true;
    const ups = job.text.split('\n').filter((line) => /\bdocker\s+compose\b.*\bup\b/.test(line));
    return ups.some((line) => /\s(?:-f|--file)[\s=]/.test(line)) || (ups.length > 0 && /\bCOMPOSE_FILE:/.test(job.text));
}

const prodLanes = () => workflows.flatMap(jobs).filter((job) => buildsProd(job) && startsIt(job));
const label = (job) => `${job.workflow.path} ${job.id}`;

/** The ci.yml jobs tools/ci-changes.sh selects for these changed paths. */
function selected(paths) {
    const result = spawnSync('bash', ['tools/ci-changes.sh'], { cwd: root, input: `${paths.join('\n')}\n`, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return new Set(result.stdout.split('\n').filter((line) => line.endsWith('=true')).map((line) => line.slice(0, -'=true'.length)));
}

/** Whether a pull_request path pattern (`*` within a directory, `**` across them) matches a path. */
const globMatches = (pattern, path) => new RegExp(`^${pattern.split('**').map((part) => part.split('*').map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`).test(path);

/** Whether a lane runs for a change to each of TRIGGERS and for none of UNRELATED. */
function filteredToImageChanges(job) {
    const paths = /^ {4}pull_request:\n(?: {8}.*\n)*? {8}paths:\n((?: {12}- .*\n)+)/m.exec(job.workflow.text)?.[1];
    if (paths) {
        const listed = paths.split('\n').map((line) => line.trim().replace(/^- /, '').replace(/^['"]|['"]$/g, ''));
        const runs = (path) => listed.some((pattern) => pattern && globMatches(pattern, path));
        return TRIGGERS.every(runs) && !UNRELATED.some(runs);
    }
    const gate = /^ {8}if:.*\bneeds\.changes\.outputs\.([a-z0-9_-]+)\b/m.exec(job.text)?.[1];
    if (job.workflow.path !== `${workflowsDir}/ci.yml` || !gate) return false;
    return TRIGGERS.every((path) => selected([path]).has(gate)) && UNRELATED.every((path) => !selected([path]).has(gate));
}

test('a CI lane builds and starts the production image when demo/Dockerfile or the Compose files change, and only then', () => {
    const lanes = prodLanes();
    assert.ok(lanes.length > 0, 'a workflow job builds the frankenphp_prod target and starts it');
    assert.ok(
        lanes.some(filteredToImageChanges),
        `a production-image lane runs for changes to ${TRIGGERS.join(', ')} and not for ${UNRELATED.join(', ')}; lanes: ${lanes.map(label).join(', ')}`,
    );
});

test('the release checks build and start the production image', () => {
    const lanes = prodLanes().filter((job) => job.workflow.path === `${workflowsDir}/release-checks.yml`);
    assert.ok(lanes.length > 0, `${workflowsDir}/release-checks.yml has a job that builds the frankenphp_prod target and starts it`);
});

test('every production-image lane states linux/amd64 as its one platform', () => {
    const lanes = prodLanes();
    assert.ok(lanes.length > 0, 'a workflow job builds the frankenphp_prod target and starts it');
    for (const job of lanes) {
        assert.match(job.text, /(?:platforms?[:=]\s*['"]?|--platform[\s=]+)linux\/amd64\b/, `${label(job)} states its platform, linux/amd64`);
        const platforms = [...job.text.matchAll(/\blinux\/[a-z0-9]+(?:\/v\d)?\b/g)].map((m) => m[0]);
        assert.deepEqual([...new Set(platforms)], ['linux/amd64'], `${label(job)} builds for linux/amd64 only`);
    }
});

test('every production-image lane builds from the repository root with demo/Dockerfile', () => {
    const lanes = prodLanes();
    assert.ok(lanes.length > 0, 'a workflow job builds the frankenphp_prod target and starts it');
    for (const job of lanes) {
        const cli = /(?:^|\s)(?:-f|--file)[\s=]+['"]?demo\/Dockerfile['"]?(?:\s.*)?\s['"]?\.\/?['"]?\s*$/m.test(job.text);
        const action = /^\s+file:\s*['"]?demo\/Dockerfile['"]?\s*$/m.test(job.text) && /^\s+context:\s*['"]?\.\/?['"]?\s*$/m.test(job.text);
        assert.ok(cli || action, `${label(job)} builds with -f demo/Dockerfile from the repository root`);
        assert.doesNotMatch(job.text, /(?:^|\s)['"]?\.?\/?demo['"]?\s*$|context:\s*['"]?\.?\/?demo['"]?\s*$/m, `${label(job)} does not build from demo/`);
    }
});

test('demo/Dockerfile.dockerignore is an allow-list, and demo/.dockerignore is gone', () => {
    const path = join(root, 'demo/Dockerfile.dockerignore');
    assert.ok(existsSync(path), 'demo/Dockerfile.dockerignore exists (BuildKit reads it for demo/Dockerfile in place of the context\'s .dockerignore)');
    const rules = readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    assert.ok(['*', '**'].includes(rules[0]), `it starts by excluding everything, so every file in the image is named: first rule ${JSON.stringify(rules[0])}`);
    assert.ok(rules.slice(1).every((rule) => rule.startsWith('!') || !/^\*\*?$/.test(rule)), 'no later rule excludes everything again');
    assert.ok(!existsSync(join(root, 'demo/.dockerignore')), 'demo/.dockerignore is gone: the context is the repository root');
});

test('the demo image builds in the workflows take the repository root as their source, not demo/', () => {
    for (const name of ['ci.yml', 'monthly.yml', 'release-checks.yml']) {
        const text = code(readFileSync(join(root, workflowsDir, name), 'utf8'));
        const sources = [...text.matchAll(/^\s+source:\s*(\S+)\s*$/gm)].map((m) => m[1].replace(/^['"]|['"]$/g, ''));
        assert.ok(sources.length > 0, `${name} builds the demo image with a bake source`);
        for (const source of sources) {
            assert.doesNotMatch(source, /(?:^|\/)demo\/?$/, `${name}: bake source ${source} is demo/, not the repository root`);
        }
        assert.match(text, /^\s+demo\/compose\.yaml\s*$/m, `${name}: the bake files name demo/compose.yaml from the root`);
    }
});

test('the development image still runs the repository bind-mounted, the app in /app/demo', () => {
    const override = code(readFileSync(join(root, 'demo/compose.override.yaml'), 'utf8'));
    assert.match(override, /^\s+target:\s*frankenphp_dev\s*$/m, 'it builds the frankenphp_dev target');
    assert.match(override, /^\s+-\s*['"]?\.\.\/:\/app['"]?\s*$/m, 'the repository is mounted at /app');
    assert.match(override, /^\s+working_dir:\s*\/app\/demo\s*$/m, 'the working directory is /app/demo');
    assert.match(override, /^\s+SERVER_ROOT:\s*['"]?\/app\/demo\/public['"]?\s*$/m, 'SERVER_ROOT is /app/demo/public');
});
