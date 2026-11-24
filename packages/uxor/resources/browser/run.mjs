import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBrowserDiagnostics } from './capture.mjs';

const source = dirname(fileURLToPath(import.meta.url));

function run(executable, args, cwd, timeout) {
    const child = spawnSync(executable, args, { cwd, stdio: ['ignore', 2, 2], timeout });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(`${executable} failed (${child.signal ?? child.status}).`);
}

async function nativeRuntime() {
    const lock = await readFile(join(source, 'package-lock.json'));
    const key = createHash('sha256').update(lock).digest('hex');
    const cache = process.env.XDG_CACHE_HOME;
    const parent = join(cache && isAbsolute(cache) ? cache : join(homedir(), '.cache'), 'uxor', 'browser');
    const destination = join(parent, key);
    if (await stat(destination).catch(error => {
        if (error.code === 'ENOENT') return false;
        throw error;
    })) return destination;

    await mkdir(parent, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(join(parent, '.install-'));
    try {
        for (const name of ['package.json', 'package-lock.json']) await copyFile(join(source, name), join(staging, name));
        console.error('Installing the UXor browser runtime in the user cache.');
        run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], staging, 120_000);
        try {
            await rename(staging, destination);
        } catch (error) {
            // A concurrent install can publish the same complete runtime before this one.
            if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        }
    } finally {
        await rm(staging, { force: true, recursive: true });
    }
    return destination;
}

async function launchBrowser(bundled) {
    const pkg = bundled ? source : await nativeRuntime();
    const require = createRequire(import.meta.url);
    const module = join(pkg, 'node_modules', 'playwright-core');
    const { chromium } = require(module);
    const executablePath = bundled ? undefined : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    const launch = () => chromium.launch({ headless: true, executablePath, timeout: 30_000 });
    try {
        return await launch();
    } catch (error) {
        if (bundled || executablePath || !error.message.includes("Executable doesn't exist")) throw error;
        console.error('Installing the Chromium headless shell for UXor.');
        run(process.execPath, [join(module, 'cli.js'), 'install', '--only-shell', 'chromium'], pkg, 300_000);
        return await launch();
    }
}

async function main() {
    const [mode, address, selector, rawTimeout] = process.argv.slice(2);
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Supply an HTTP or HTTPS URL without embedded credentials.');
    }
    const browser = await launchBrowser(mode === 'bundled');
    try {
        const context = await browser.newContext();
        const finish = startBrowserDiagnostics(context, url);
        const page = await context.newPage();
        const timeout = Number(rawTimeout);
        // Leave room for visit metadata within the reader's 1 MiB cap, including escaped control characters.
        const visit = { url: url.href.slice(0, 8192), status: null, error: null };
        try {
            const response = await page.goto(url.href, { waitUntil: 'load', timeout });
            if (response) {
                visit.url = response.url().slice(0, 8192);
                visit.status = response.status();
                console.error(`HTTP ${visit.status} ${JSON.stringify(visit.url)}`);
            }
            if (selector) await page.locator(selector).first().waitFor({ state: 'visible', timeout });
        } catch (error) {
            visit.error = error.message.slice(0, 8192);
            console.error(JSON.stringify(visit.error));
        }
        const evidence = { ...finish(), visit };
        const { pageErrors, requestFailures, dropped } = evidence;
        for (const error of pageErrors.slice(0, 3)) console.error('Page error:', JSON.stringify(error.message.slice(0, 400)));
        for (const request of requestFailures.slice(0, 3)) console.error('Failed request:', JSON.stringify(request.url.slice(0, 400)), JSON.stringify(request.error.slice(0, 200)));
        const errorCount = pageErrors.length + (dropped?.pageErrors ?? 0);
        const failureCount = requestFailures.length + (dropped?.requestFailures ?? 0);
        console.error(`${evidence.responses.length} profiled responses, ${errorCount} page errors, ${failureCount} failed requests.`);
        process.stdout.write(JSON.stringify(evidence) + '\n');
        process.exitCode = Number(visit.status >= 400 || visit.error !== null || errorCount > 0 || failureCount > 0);
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(`uxor-browser: ${error.message}`);
    process.exitCode = 2;
});
