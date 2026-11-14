// The demo's production image (demo/Dockerfile, target frankenphp_prod) is built and started by CI, not only read as text
// (demo/tests/Security/ProductionConfigurationTest.php): a lane that runs for a change to demo/Dockerfile or the
// Compose files (ci.yml's Changes job and tools/ci-changes.sh, or a workflow's pull_request paths), and a lane of the
// release checks. Each lane names the target it builds and states its one platform, linux/amd64.
// Run: node --test tools/tests/prod-image-workflow.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflowsDir = '.github/workflows';
const TRIGGERS = ['demo/Dockerfile', 'demo/compose.yaml', 'demo/compose.override.yaml'];
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

/** Whether a lane runs for a change to each of TRIGGERS and for none of UNRELATED. */
function filteredToImageChanges(job) {
    const paths = /^ {4}pull_request:\n(?: {8}.*\n)*? {8}paths:\n((?: {12}- .*\n)+)/m.exec(job.workflow.text)?.[1];
    if (paths) {
        const listed = paths.split('\n').map((line) => line.trim().replace(/^- /, '').replace(/^['"]|['"]$/g, ''));
        return TRIGGERS.every((path) => listed.includes(path)) && !UNRELATED.some((path) => listed.includes(path));
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
