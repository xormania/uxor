#!/usr/bin/env node
/*
 * What the browser tests need before they run, made idempotent and safe to run from several processes at once:
 *
 * - UXor's recipe specs in <recipe>/tests/*.spec.ts. Some retain a fixture import path from the initial
 *   symfony/ux reference. They run as copies in tests/e2e/examples/recipes/ (gitignored), with that inherited import
 *   pointed at tests/e2e/examples/fixtures.ts. Maintain the source specs for UXor's behavior and contracts.
 *   The copies are built in a temporary directory, then each new or changed one is renamed into place and each one
 *   no recipe has any more is deleted: a process listing the tests meanwhile sees every file whole, old or new, and
 *   nothing is written when nothing changed.
 * - The demo's Tailwind CSS, rebuilt unless it was built from the same sources: those it scans
 *   (demo/assets/styles/app.css declares the demo's scan and exclusions), identified by a SHA-256
 *   of their paths and file contents, recorded next to the build. So no screenshot is taken
 *   against stale CSS, whoever runs the tests, and nothing is rebuilt when nothing changed. The record is read and
 *   written by PHP_BINARY's PHP: in the Docker demo, demo/var/ lives in the container.
 *
 * Each step holds a lock (a populated directory in tests/.prepare/, gitignored) while it runs, so a second process
 * waits for the first and then finds nothing to do. A local lock whose process is gone is taken over.
 *
 * playwright.config.ts runs both: the specs when it loads (`--list` needs them), the CSS as its globalSetup (only
 * before tests run). By hand, or as CI's own step before the tests: `node tools/prepare-tests.mjs`.
 * Test: node --test tools/tests/prepare-tests.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
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

/** Bound Git's search to the same UI source directories as app.css, including local untracked UI edits. */
export function cssSourcesDigest(root = repository) {
    const candidates = ['templates', 'assets', 'src', 'config', 'README.md', 'manifest.json'];
    const controls = ['.gitignore', '.gitattributes', '.ignore'];
    const paths = [
        ...controls, 'kit.css', 'kit.js', 'tools/sync-demo', 'tools/prepare-tests.mjs',
        'demo/composer.json', 'demo/composer.lock', 'demo/importmap.php', 'demo/symfony.lock',
    ];
    const outside = new Set(['docs', 'node_modules', 'packages', 'tests', 'tools', 'vendor', 'website']);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && !outside.has(entry.name)) {
            for (const file of [...candidates, ...controls]) paths.push(`${entry.name}/${file}`);
        }
    }
    const listed = execFileSync('git', ['--literal-pathspecs', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...paths],
        { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    // Git ignores installed dependencies. The stylesheet imports these exact CSS files and scans
    // the two Twig layouts inherited by the demo form theme; include their installed bytes too.
    const files = new Set(listed.split('\0').filter(Boolean));
    for (const path of [
        'demo/assets/vendor/flowbite/dist/flowbite.min.css',
        'demo/vendor/symfony/ux-live-component/assets/dist/live.min.css',
        'demo/vendor/symfony/twig-bridge/Resources/views/Form/tailwind_2_layout.html.twig',
        'demo/vendor/symfony/twig-bridge/Resources/views/Form/form_div_layout.html.twig',
    ]) files.add(path);
    const digest = createHash('sha256');
    for (const file of [...files].sort()) {
        const path = join(root, file);
        if (!existsSync(path)) continue;
        digest.update(file).update('\0').update(createHash('sha256').update(readFileSync(path)).digest());
    }
    return digest.digest('hex');
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
 * Publish a nonempty lock directory atomically. Each acquisition has a unique owner file, so a waiter can remove
 * the exact stale owner it observed without touching a successor. An empty lock can be removed or replaced safely.
 */
export function withLock(root, name, fn, { timeoutMs = LOCK_TIMEOUT_MS } = {}) {
    const lock = join(root, 'tests/.prepare', `${name}.lock`);
    mkdirSync(join(root, 'tests/.prepare'), { recursive: true });
    const candidate = mkdtempSync(`${lock}-`);
    const marker = `owner-${randomBytes(16).toString('hex')}`;
    const deadline = Date.now() + timeoutMs;
    let waiting = false;
    try {
        writeFileSync(join(candidate, marker), `${hostname()} ${process.pid}\n`);
        for (;;) {
            try {
                renameSync(candidate, lock);
                break;
            } catch (error) {
                if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
            }
            const holder = lockOwner(lock);
            if (holder && abandoned(holder.identity)) {
                releaseLock(lock, holder.marker);
                continue;
            }
            if (Date.now() > deadline) {
                throw new Error(`${lock} is held by ${holder?.identity ?? 'another process'} for more than ${timeoutMs / 1000}s: delete it if that process is gone`);
            }
            if (!waiting) {
                console.log(`Waiting for ${holder?.identity ?? 'another process'} to finish preparing (${name})`);
                waiting = true;
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        }
        try {
            return fn();
        } finally {
            releaseLock(lock, marker);
        }
    } finally {
        rmSync(candidate, { recursive: true, force: true });
    }
}

function lockOwner(lock) {
    try {
        const [marker, unexpected] = readdirSync(lock);
        // Accept the simple marker of a lock created by an older checkout, too.
        if (unexpected || !marker || (marker !== 'owner' && !marker.startsWith('owner-'))) return null;
        const identity = readFileSync(join(lock, marker), 'utf8').trim();
        return { marker, identity };
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return null; // the owner released the lock between reading the directory and its marker
    }
}

function releaseLock(lock, marker) {
    try {
        unlinkSync(join(lock, marker));
        rmdirSync(lock);
    } catch (error) {
        // The observed generation is already gone, or another process published its populated lock after unlink.
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
}

function abandoned(identity) {
    const [host, pid] = identity.split(' ');
    if (host !== hostname() || !/^[1-9]\d*$/.test(pid) || !Number.isSafeInteger(Number(pid))) return false;
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
