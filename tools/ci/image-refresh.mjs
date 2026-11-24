#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const BROWSER_IMAGE = 'mcr.microsoft.com/playwright';
const BROWSER_DOCKERFILE = 'packages/uxor/resources/browser/Dockerfile';
const ROOT_BROWSER_PIN = 'tools/playwright-image.json';
const BROWSER_CLIENTS = [
    ['packages/uxor/resources/browser', 'dependencies', 'playwright-core'],
    ['packages/uxor/dev', 'devDependencies', '@playwright/test'],
];
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PATCH_VERSION = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/;
const UPSTREAM = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*:[0-9A-Za-z_][0-9A-Za-z_.-]{0,127}$/;

function command(program, args, options = {}) {
    return execFileSync(program, args, {
        encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, ...options,
    }).trim();
}

function regularFile(root, path) {
    const file = join(root, path);
    if (!realpathSync(file).startsWith(root + sep) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) {
        throw new Error(`Expected a regular file in the candidate checkout: ${path}`);
    }
    return file;
}

function read(root, path) {
    return readFileSync(regularFile(root, path), 'utf8');
}

function ownedFiles(root) {
    return new Set([
        BROWSER_DOCKERFILE, ROOT_BROWSER_PIN,
        ...BROWSER_CLIENTS.flatMap(([directory]) => ['package.json', 'package-lock.json'].map((file) => posix.join(directory, file))),
    ]);
}

function platformKey(descriptor) {
    const { os, architecture, variant } = descriptor;
    if (!(os && architecture) || os === 'unknown' || architecture === 'unknown') return null;
    return [os, architecture, variant].filter(Boolean).join('/');
}

export function inspectRegistry(reference) {
    const args = ['buildx', 'imagetools', 'inspect', reference, '--format'];
    const metadata = JSON.parse(command('docker', [...args, '{{json .Manifest}}']));
    if (!DIGEST.test(metadata?.digest)) throw new Error(`No registry digest: ${reference}`);
    const platforms = Array.isArray(metadata.manifests)
        ? metadata.manifests
            .filter((entry) => entry.annotations?.['vnd.docker.reference.type'] !== 'attestation-manifest')
            .map((entry) => platformKey(entry.platform ?? {}))
        : [platformKey(JSON.parse(command('docker', [...args, '{{json .Image}}'])) ?? {})];
    return { digest: metadata.digest, platforms: new Set(platforms.filter(Boolean)) };
}

export function refresher(inspect = inspectRegistry) {
    const seen = new Map();
    const get = (reference) => {
        if (!seen.has(reference)) seen.set(reference, inspect(reference));
        return seen.get(reference);
    };
    return (tag, digest, nextTag = tag) => {
        if (!UPSTREAM.test(tag) || !UPSTREAM.test(nextTag) || !DIGEST.test(digest)) {
            throw new Error(`Unsupported image pin: ${tag}`);
        }
        const next = get(nextTag);
        if (!DIGEST.test(next?.digest)) throw new Error(`Invalid registry digest: ${nextTag}`);
        if (next.digest === digest && tag === nextTag) return `${tag}@${digest}`;
        const prior = get(`${tag}@${digest}`);
        if (prior.digest !== digest || !prior.platforms.size || !next.platforms.has('linux/amd64')
            || [...prior.platforms].some((platform) => !next.platforms.has(platform))) {
            throw new Error(`Registry update loses an existing or required platform: ${tag} → ${nextTag}`);
        }
        return `${nextTag}@${next.digest}`;
    };
}

export function updateDockerfile(content, refresh) {
    // Docker stage aliases and named build contexts are not upstream references.
    return content.replace(
        /^([ \t]*(?:FROM[ \t]+(?:--platform=[^\s]+[ \t]+)?|ARG[ \t]+[A-Za-z_][A-Za-z0-9_]*=))([\w./:-]+)@(sha256:[0-9a-f]{64})(?=[ \t\r\n]|$)/gm,
        (_original, start, tag, digest) => start + refresh(tag, digest),
    );
}

function lockedVersion(lock, name) {
    return lock.packages?.[`node_modules/${name}`]?.version;
}

function readClients(root) {
    return BROWSER_CLIENTS.map(([directory, kind, name]) => {
        const manifestFile = posix.join(directory, 'package.json');
        const lockFile = posix.join(directory, 'package-lock.json');
        const manifest = read(root, manifestFile);
        const lock = read(root, lockFile);
        const version = JSON.parse(manifest)[kind]?.[name];
        if (!PATCH_VERSION.test(version) || lockedVersion(JSON.parse(lock), name) !== version) {
            throw new Error(`Browser client and lock disagree: ${directory}`);
        }
        return { manifestFile, lockFile, manifest, lock, name, kind, version };
    });
}

const npmOptions = [
    '--registry=https://registry.npmjs.org', '--ignore-scripts', '--no-audit', '--no-fund',
];

function compatiblePatches(name, version) {
    const value = JSON.parse(command('npm', ['view', `${name}@~${version}`, 'version', '--json', ...npmOptions]));
    return new Set(Array.isArray(value) ? value : [value]);
}

export function latestCommonPatch(version, available) {
    const [, major, minor, patch] = PATCH_VERSION.exec(version) ?? [];
    if (patch === undefined || !available.length) throw new Error(`Expected an exact browser client version: ${version}`);
    const versions = [...available[0]].filter((candidate) => {
        const [, nextMajor, nextMinor, nextPatch] = PATCH_VERSION.exec(candidate) ?? [];
        return nextMajor === major && nextMinor === minor && Number(nextPatch) >= Number(patch)
            && available.every((releases) => releases.has(candidate));
    });
    return versions.reduce((latest, item) => Number(item.split('.')[2]) > Number(latest.split('.')[2]) ? item : latest, version);
}

function rebuildLock(client, nextVersion) {
    const temp = mkdtempSync(join(tmpdir(), 'uxor-browser-lock-'));
    try {
        writeFileSync(join(temp, 'package.json'), client.manifest);
        writeFileSync(join(temp, 'package-lock.json'), client.lock);
        command('npm', [
            'install', '--package-lock-only', '--save-exact', `${client.name}@${nextVersion}`, ...npmOptions,
            client.kind === 'devDependencies' ? '--save-dev' : '--save-prod',
        ], { cwd: temp });
        const manifest = readFileSync(join(temp, 'package.json'), 'utf8');
        const lock = readFileSync(join(temp, 'package-lock.json'), 'utf8');
        const expected = JSON.parse(client.manifest);
        expected[client.kind][client.name] = nextVersion;
        if (JSON.stringify(JSON.parse(manifest)) !== JSON.stringify(expected)
            || lockedVersion(JSON.parse(lock), client.name) !== nextVersion) {
            throw new Error(`Npm produced an unexpected browser dependency change: ${client.manifestFile}`);
        }
        return { manifest, lock };
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
}

function browserPin(version) {
    return `${BROWSER_IMAGE}:v${version}-noble`;
}

const isBrowserTag = (tag) => tag.startsWith(BROWSER_IMAGE + ':v') && tag.endsWith('-noble');

function hasPackagedBrowser(root) {
    const providerFiles = [BROWSER_DOCKERFILE, ...['package.json', 'package-lock.json']
        .map((name) => posix.join(BROWSER_CLIENTS[0][0], name))];
    const present = providerFiles.filter((path) => existsSync(join(root, path)));
    if (!present.length) return false; // main may have released the provider before it rolls into dev.
    if (present.length !== providerFiles.length) throw new Error('Packaged Playwright provider files are incomplete');
    return true;
}

function validateBrowserGroup(root, updates = new Map()) {
    const load = (path) => updates.get(path) ?? read(root, path);
    const previousRoot = JSON.parse(read(root, 'package-lock.json'));
    const rootVersion = lockedVersion(previousRoot, '@playwright/test');
    const pinData = JSON.parse(load(ROOT_BROWSER_PIN));
    const rootPin = pinData.image;
    const [rootTag, rootDigest] = typeof rootPin === 'string' ? rootPin.split('@') : [];
    if (Object.keys(pinData).length !== 1 || !PATCH_VERSION.test(rootVersion)
        || rootTag !== browserPin(rootVersion) || !DIGEST.test(rootDigest) || rootPin !== `${rootTag}@${rootDigest}`) {
        throw new Error('Root Playwright image does not match its locked browser client');
    }
    if (!hasPackagedBrowser(root)) return;
    const installed = BROWSER_CLIENTS.map(([directory, kind, name]) => {
        const version = JSON.parse(load(posix.join(directory, 'package.json')))[kind]?.[name];
        const lock = JSON.parse(load(posix.join(directory, 'package-lock.json')));
        if (!PATCH_VERSION.test(version) || lockedVersion(lock, name) !== version) {
            throw new Error(`Browser client and lock disagree: ${directory}`);
        }
        return version;
    });
    const [providerTag, providerDigest] = /^FROM ([^\s@]+)@(sha256:[0-9a-f]{64})(?:[ \t]|\r?$)/m
        .exec(load(BROWSER_DOCKERFILE))?.slice(1) ?? [];
    if (installed[0] !== installed[1] || providerTag !== browserPin(installed[0]) || !DIGEST.test(providerDigest)) {
        throw new Error('Packaged Playwright clients and provider image do not match');
    }
}

function applyBrowserUpdates(root, changes, refresh, versions, lockClient) {
    validateBrowserGroup(root);
    // The screenshot suite has its own browser version. Its lock and baselines move in an explicit review.
    const [tag, digest] = JSON.parse(read(root, ROOT_BROWSER_PIN)).image.split('@');
    changes.set(ROOT_BROWSER_PIN, `${JSON.stringify({ image: refresh(tag, digest) }, null, 4)}\n`);
    if (!hasPackagedBrowser(root)) return;
    const clients = readClients(root);
    const current = clients[0].version;
    let candidate = latestCommonPatch(current, clients.map(({ name }) => versions(name, current)));
    const provider = read(root, BROWSER_DOCKERFILE);
    let updatedProvider;
    try {
        updatedProvider = updateDockerfile(provider, (tag, digest) => refresh(tag, digest, isBrowserTag(tag) ? browserPin(candidate) : tag));
    } catch (error) {
        // The image and npm releases may arrive separately. Try again tomorrow
        // once the registry has the same exact Playwright patch.
        if (candidate === current || !/(?:manifest unknown|not found)/i.test(error.stderr ?? '')) throw error;
        console.warn(`Waiting for the browser provider image at ${browserPin(candidate)}`);
        candidate = current;
        updatedProvider = updateDockerfile(provider, refresh);
    }
    for (const client of clients) {
        if (current === candidate) break;
        const { manifest, lock } = lockClient(client, candidate);
        changes.set(client.manifestFile, manifest);
        changes.set(client.lockFile, lock);
    }
    changes.set(BROWSER_DOCKERFILE, updatedProvider);
    validateBrowserGroup(root, changes);
}

const fingerprint = (value) => createHash('sha256').update(value).digest('hex');

function sameDockerfile(before, after) {
    const stripPins = (text) => updateDockerfile(text, (tag) => {
        return isBrowserTag(tag) ? 'browser-version@digest' : `${tag}@digest`;
    });
    return stripPins(before) === stripPins(after);
}

function validateChanges(root, updates) {
    validateBrowserGroup(root, updates);
    for (const [path, after] of updates) {
        if (path === BROWSER_DOCKERFILE && !sameDockerfile(read(root, path), after)) {
            throw new Error(`Image refresh may change only the Dockerfile pins: ${path}`);
        }
    }
    for (const client of hasPackagedBrowser(root) ? readClients(root) : []) {
        if (!(updates.has(client.manifestFile) || updates.has(client.lockFile))) continue;
        const manifest = JSON.parse(updates.get(client.manifestFile) ?? client.manifest);
        const version = manifest[client.kind]?.[client.name];
        const expected = JSON.parse(client.manifest);
        expected[client.kind][client.name] = version;
        if (latestCommonPatch(client.version, [new Set([version])]) !== version
            || JSON.stringify(manifest) !== JSON.stringify(expected)) {
            throw new Error(`Image refresh may change only the compatible browser client patch: ${client.manifestFile}`);
        }
    }
}

export function discover(root, { inspect = inspectRegistry, versions = compatiblePatches, lockClient = rebuildLock } = {}) {
    const checked = realpathSync(root);
    const refresh = refresher(inspect);
    const changes = new Map();
    applyBrowserUpdates(checked, changes, refresh, versions, lockClient);
    const base = command('git', ['rev-parse', 'HEAD'], { cwd: checked });
    return {
        base, files: [...changes].flatMap(([path, after]) => {
            const before = read(checked, path);
            return after === before ? [] : [{ path, before: fingerprint(before), after }];
        }),
    };
}

export function apply(root, plan) {
    const checked = realpathSync(root);
    const owned = ownedFiles(checked);
    if (!COMMIT.test(plan?.base) || command('git', ['rev-parse', 'HEAD'], { cwd: checked }) !== plan.base
        || !Array.isArray(plan.files) || plan.files.length > owned.size) {
        throw new Error('The proposal must apply to the exact candidate commit');
    }
    const updates = new Map();
    for (const { path, before, after } of plan.files) {
        if (!owned.has(path) || updates.has(path) || typeof after !== 'string' || after.length > 1024 * 1024
            || fingerprint(read(checked, path)) !== before || fingerprint(after) === before) {
            throw new Error(`Invalid or stale image pin update: ${path}`);
        }
        updates.set(path, after);
    }
    validateChanges(checked, updates);
    for (const [path, content] of updates) writeFileSync(regularFile(checked, path), content);
    return [...updates.keys()];
}

function api(...args) {
    return JSON.parse(command('gh', ['api', ...args]));
}

function send(method, path, payload) {
    return JSON.parse(command('gh', ['api', '-X', method, path, '--input', '-'], { input: JSON.stringify(payload) }));
}

export function propose(root, plan, { repository, appSlug }) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[\w-]+$/.test(appSlug ?? '')) {
        throw new Error('A repository and the installation App identity are required');
    }
    const checked = realpathSync(root);
    const owner = repository.split('/')[0];
    const repo = `repos/${repository}`;
    const updateBranch = 'maintenance/image-pins';
    const target = 'dev';
    const expected = api(`${repo}/git/ref/heads/${target}`).object.sha;
    if (expected !== plan?.base) throw new Error('Development moved during discovery; rerun against the new head');
    const files = apply(checked, plan);
    if (!files.length) return 'Image dependencies are current';
    const branches = api(`${repo}/git/matching-refs/heads/${updateBranch}`);
    const old = branches.find(({ ref }) => ref === `refs/heads/${updateBranch}`)?.object.sha;
    const member = `${appSlug}[bot]`;
    if (old && (!COMMIT.test(old) || api(`${repo}/commits/${old}`).author?.login !== member)) {
        throw new Error('The image proposal branch has a non-automation head');
    }
    const prs = api('-X', 'GET', `${repo}/pulls`, '-f', `head=${owner}:${updateBranch}`, '-f', 'state=all');
    const existing = prs.filter((pr) => pr.state === 'open');
    if (existing.length > 1 || existing.some((pr) => pr.user.login !== member || pr.base.ref !== target || pr.head.sha !== old)) {
        throw new Error('The image proposal branch has an unrelated open pull request');
    }
    const tree = send('POST', `${repo}/git/trees`, {
        base_tree: command('git', ['rev-parse', 'HEAD^{tree}'], { cwd: checked }),
        tree: files.map((path) => ({ path, mode: '100644', type: 'blob', content: read(checked, path) })),
    }).sha;
    if (!COMMIT.test(tree)) throw new Error('GitHub returned an invalid image proposal tree');
    const oldCommit = old && api(`${repo}/git/commits/${old}`);
    if (oldCommit?.tree.sha === tree) {
        if (existing.length) return existing[0].html_url;
        if (prs.some((pr) => pr.head.sha === old && pr.state === 'closed' && !pr.merged_at)) {
            return 'The previous proposal for this tree was closed';
        }
    } else {
        if (api(`${repo}/git/ref/heads/${target}`).object.sha !== expected) {
            throw new Error('Development moved while preparing the image proposal');
        }
        const parents = old && old !== expected ? [old, expected] : [expected];
        const commit = send('POST', `${repo}/git/commits`, { message: 'chore(ci): refresh image pins', tree, parents }).sha;
        if (!COMMIT.test(commit) || api(`${repo}/commits/${commit}`).author?.login !== member) {
            throw new Error('GitHub did not verify the new image proposal commit as authored by the App');
        }
        if (old) {
            send('PATCH', `${repo}/git/refs/heads/${updateBranch}`, { sha: commit, force: false });
        } else {
            send('POST', `${repo}/git/refs`, { ref: `refs/heads/${updateBranch}`, sha: commit });
        }
        if (existing.length) return existing[0].html_url;
    }
    return send('POST', `${repo}/pulls`, {
        base: target, head: updateBranch, title: 'chore(ci): refresh image pins',
        body: 'Refresh the Playwright image digests and any compatible packaged browser patch together. Review the candidate CI results before merging.',
    }).html_url;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const [action, ...args] = process.argv.slice(2);
    const { values } = parseArgs({
        args, options: { root: { type: 'string', default: '.' }, out: { type: 'string' }, plan: { type: 'string' } },
    });
    const root = resolve(values.root);
    if (action === 'plan' && values.out && !values.plan) {
        const report = discover(root);
        writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n');
        console.log(report.files.length ? `Image refresh: ${report.files.map(({ path }) => path).join(', ')}` : 'Image dependencies are current');
    } else if (values.plan && !values.out && (action === 'apply' || action === 'propose')) {
        const report = JSON.parse(readFileSync(values.plan, 'utf8'));
        console.log(action === 'apply' ? apply(root, report).join('\n')
            : propose(root, report, { repository: process.env.GITHUB_REPOSITORY, appSlug: process.env.IMAGE_REFRESH_APP_SLUG }));
    } else {
        throw new Error('Use plan --root <checkout> --out <plan> or apply/propose --root <checkout> --plan <plan>');
    }
}
