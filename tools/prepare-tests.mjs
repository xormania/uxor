#!/usr/bin/env node
/*
 * What the browser tests need before they run, made idempotent and safe to run from several processes at once:
 *
 * - The recipe specs. Each <recipe>/tests/*.spec.ts, copied from upstream byte-identical, imports
 *   '../../../../assets/test/browser/fixtures', a path inside the symfony/ux repository. They run as copies in
 *   tests/e2e/examples/recipes/ (gitignored) with that import pointed at our port, tests/e2e/examples/fixtures.ts.
 *   The copies are built in a temporary directory, then each new or changed one is renamed into place and each one
 *   no recipe has any more is deleted: a process listing the tests meanwhile sees every file whole, old or new, and
 *   nothing is written when nothing changed.
 * - The demo's Tailwind CSS, rebuilt unless it was built from the same sources: those it scans
 *   (demo/assets/styles/app.css: `@source "../../.."`, the repository minus what git ignores), identified by a SHA-256
 *   of their paths and content hashes (`git hash-object`), recorded next to the build. So no screenshot is taken
 *   against stale CSS, whoever runs the tests, and nothing is rebuilt when nothing changed. The record is read and
 *   written by PHP_BINARY's PHP: in the Docker demo, demo/var/ lives in the container.
 *
 * Each step holds a lock (a directory in tests/.prepare/, gitignored) while it runs, so a second process waits for the
 * first and then finds nothing to do. A lock whose process is gone is taken over.
 *
 * playwright.config.ts runs both: the specs when it loads (`--list` needs them), the CSS as its globalSetup (only
 * before tests run). By hand, or as CI's own step before the tests: `node tools/prepare-tests.mjs`.
 * Test: node --test tools/tests/prepare-tests.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const LOCK_TIMEOUT_MS = 10 * 60_000;

/** The generated copy of each recipe spec: { '<recipe>.<name>.spec.ts': content }. */
export function recipeSpecs(root = repository) {
    const specs = {};
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const testsDir = join(root, entry.name, 'tests');
        if (!entry.isDirectory() || !existsSync(join(root, entry.name, 'manifest.json')) || !existsSync(testsDir)) {
            continue;
        }
        for (const file of readdirSync(testsDir).filter((name) => name.endsWith('.spec.ts')).sort()) {
            const source = readFileSync(join(testsDir, file), 'utf8');
            const spec = source.replace(/(['"])(?:\.\.\/)+assets\/test\/browser\/fixtures\1/g, "'../fixtures'");
            specs[`${entry.name}.${file}`] = `// Generated from ${entry.name}/tests/${file} by tools/prepare-tests.mjs: do not edit.\n${spec}`;
        }
    }
    return specs;
}

/** Brings tests/e2e/examples/recipes/ to recipeSpecs(); returns the names it wrote or deleted. */
export function syncRecipeSpecs(root = repository) {
    const target = join(root, 'tests/e2e/examples/recipes');
    return withLock(root, 'specs', () => {
        const specs = recipeSpecs(root);
        mkdirSync(target, { recursive: true });
        const current = new Set(readdirSync(target));
        const changed = Object.keys(specs).filter((name) => !current.has(name) || readFileSync(join(target, name), 'utf8') !== specs[name]);
        const stale = [...current].filter((name) => !(name in specs));
        if (changed.length > 0) {
            // the same filesystem as the target, outside every test directory: a rename, not a copy
            const temporary = join(root, 'tests/.prepare', `specs-${process.pid}-${randomBytes(4).toString('hex')}`);
            mkdirSync(temporary, { recursive: true });
            try {
                for (const name of changed) {
                    writeFileSync(join(temporary, name), specs[name]);
                }
                for (const name of changed) {
                    renameSync(join(temporary, name), join(target, name));
                }
            } finally {
                rmSync(temporary, { recursive: true, force: true });
            }
        }
        for (const name of stale) {
            rmSync(join(target, name), { recursive: true, force: true });
        }
        return [...changed, ...stale];
    });
}

/** SHA-256 of the paths and content hashes of every file git does not ignore: what the demo's Tailwind build scans. */
export function cssSourcesDigest(root = repository) {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
        .split('\0')
        .filter((file) => file && existsSync(join(root, file)));
    const hashes = execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: root, encoding: 'utf8', input: files.join('\n'), maxBuffer: 64 * 1024 * 1024 })
        .trim()
        .split('\n');
    return createHash('sha256')
        .update(files.map((file, index) => `${hashes[index]} ${file}`).join('\n'))
        .digest('hex');
}

/** Builds the demo's Tailwind CSS unless the record says it was built from the current sources; true when it built. */
export function buildCssIfStale(root = repository) {
    const binary = process.env.PHP_BINARY ?? (process.env.DEMO_URL ? join(root, 'tools/demo-php') : 'php');
    const php = (args, stdio = 'pipe') => execFileSync(binary, args, { cwd: join(root, 'demo'), encoding: 'utf8', stdio });
    const record = 'var/tailwind/sources.sha256';
    return withLock(root, 'css', () => {
        const digest = cssSourcesDigest(root);
        const recorded = php(['-r', `echo is_file('var/tailwind/app.built.css') ? @file_get_contents('${record}') : '';`]);
        if (recorded.trim() === digest) {
            return false;
        }
        console.log("Building the demo's Tailwind CSS: its sources changed since the last build");
        php(['bin/console', 'tailwind:build'], 'inherit');
        php(['-r', `file_put_contents('${record}', $argv[1].PHP_EOL);`, '--', digest]);
        return true;
    });
}

/*
 * Runs fn while holding tests/.prepare/<name>.lock, a directory (mkdir is atomic) holding its owner's host and pid.
 * A lock whose owner is a process gone from this host is taken over; one held longer than LOCK_TIMEOUT_MS fails.
 */
export function withLock(root, name, fn, { timeoutMs = LOCK_TIMEOUT_MS } = {}) {
    const lock = join(root, 'tests/.prepare', `${name}.lock`);
    mkdirSync(join(root, 'tests/.prepare'), { recursive: true });
    const deadline = Date.now() + timeoutMs;
    let waiting = false;
    for (;;) {
        try {
            mkdirSync(lock);
            break;
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
        if (abandoned(lock)) {
            // renamed away first, so two processes that both found it abandoned do not both take it
            rmSync(`${lock}.abandoned-${process.pid}`, { recursive: true, force: true });
            try {
                renameSync(lock, `${lock}.abandoned-${process.pid}`);
                rmSync(`${lock}.abandoned-${process.pid}`, { recursive: true, force: true });
            } catch {}
            continue;
        }
        if (Date.now() > deadline) {
            throw new Error(`${lock} is held by ${owner(lock) ?? 'another process'} for more than ${timeoutMs / 1000}s: delete it if that process is gone`);
        }
        if (!waiting) {
            console.log(`Waiting for ${owner(lock) ?? 'another process'} to finish preparing (${name})`);
            waiting = true;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    try {
        writeFileSync(join(lock, 'owner'), `${hostname()} ${process.pid}\n`);
        return fn();
    } finally {
        rmSync(lock, { recursive: true, force: true });
    }
}

function owner(lock) {
    try {
        return readFileSync(join(lock, 'owner'), 'utf8').trim() || null;
    } catch {
        return null;
    }
}

function abandoned(lock) {
    const [host, pid] = (owner(lock) ?? '').split(' ');
    if (!pid) {
        // its owner has not written its name yet, or died first: abandoned once it is old
        try {
            return Date.now() - statSync(lock).mtimeMs > 30_000;
        } catch {
            return false;
        }
    }
    if (host !== hostname()) {
        return false;
    }
    try {
        process.kill(Number(pid), 0);
        return false;
    } catch (error) {
        return error.code === 'ESRCH';
    }
}

/** playwright.config.ts's globalSetup: the CSS, once per test run, before the tests (never for `--list`). */
export default function globalSetup() {
    buildCssIfStale();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const written = syncRecipeSpecs();
    console.log(written.length > 0 ? `Recipe specs: ${written.length} written or deleted` : 'Recipe specs: up to date');
    console.log(buildCssIfStale() ? 'CSS: built' : 'CSS: up to date');
}
