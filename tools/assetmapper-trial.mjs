import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';

const autocomplete = /^\/assets\/(?:@symfony\/ux-autocomplete|vendor\/(?:tom-select|@orchidjs))\//;
const tomSelect = /^\/assets\/vendor\/tom-select\//;
const nonce = /\bnonce="[^"]+"/g;
const importMap = /<script type="importmap"[^>]*>([\s\S]*?)<\/script>/;

function sizes(source) {
    return { bytes: Buffer.byteLength(source), gzipBytes: gzipSync(source).length };
}

async function verifyAutocomplete(page, requests) {
    const lab = await page.goto('/lab', { waitUntil: 'networkidle' });
    assert.equal(lab.status(), 200);
    await page.waitForFunction(() => window.Stimulus?.controllers.length > 0 && !!window.Turbo?.visit);
    assert.deepEqual(requests.filter((path) => autocomplete.test(path)), []);
    const beforeVisit = requests.length;
    await page.evaluate(() => { window.assetmapperTrialDocument = true; });
    await page.getByRole('link', { name: 'live-autocomplete', exact: true }).click();

    await expect(page).toHaveURL('/lab/live-autocomplete');
    const country = page.locator('#autocomplete_demo_country + .ts-wrapper');
    await country.locator('.ts-control').click();
    const combobox = country.getByRole('combobox', { name: 'Country' });
    await expect(combobox).toHaveAttribute('aria-expanded', 'true');
    await combobox.press('Escape');
    await page.getByRole('button', { name: 'Re-render' }).click();
    await expect(page.getByTestId('renders')).toHaveText('1');
    assert.equal(await page.evaluate(() => window.assetmapperTrialDocument), true, 'Turbo kept the lab document');

    const lazyRequests = requests.slice(beforeVisit).filter((path) => autocomplete.test(path)).sort();
    assert.ok(lazyRequests.some((path) => tomSelect.test(path)), 'Tom Select loads after the field appears');
    return lazyRequests;
}

async function measure(browser, baseURL) {
    const context = await browser.newContext({ baseURL });
    context.setDefaultTimeout(8_000);
    const errors = [];
    try {
        const page = await context.newPage();
        const requests = [];
        const assetPath = (url) => {
            const parsed = new URL(url);
            return parsed.origin === baseURL && parsed.pathname.startsWith('/assets/') ? parsed.pathname : '';
        };
        page.on('request', (request) => {
            const path = assetPath(request.url());
            if (path.endsWith('.js') || path.endsWith('.mjs')) {
                requests.push(path);
            }
        });
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error') {
                errors.push(message.text());
            }
        });
        page.on('requestfailed', (request) => {
            if (assetPath(request.url())) {
                errors.push(`${request.failure()?.errorText} ${request.url()}`);
            }
        });
        page.on('response', (response) => {
            if (response.status() >= 400 && new URL(response.url()).origin === baseURL) {
                errors.push(`${response.status()} ${response.url()}`);
            }
        });

        const response = await page.goto('/demo', { waitUntil: 'networkidle' });
        assert.equal(response.status(), 200);
        await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
        const html = await response.text();
        const map = html.match(importMap)?.[1];
        assert.ok(map, 'dashboard response contains an inline import map');
        const imports = Object.keys(JSON.parse(map).imports).sort();
        const preloads = await page.locator('link[rel=modulepreload]').evaluateAll((links) =>
            links.map((link) => new URL(link.href).pathname).sort(),
        );
        const dashboardRequests = requests.slice().sort();
        assert.ok(dashboardRequests.length > 0, 'dashboard fetches script assets');
        const stimulusStarted = await page.evaluate(() => window.Stimulus?.controllers.length > 0);
        let autocompleteStatus = 'blocked by dashboard startup';
        let lazyRequests = null;
        if (stimulusStarted) {
            try {
                lazyRequests = await verifyAutocomplete(page, requests);
                autocompleteStatus = 'passed';
            } catch (error) {
                errors.push(error.message);
                autocompleteStatus = 'failed';
            }
        }
        return {
            imports,
            importMapPayload: map,
            preloads,
            dashboardRequests,
            lazyRequests,
            stimulusStarted,
            autocompleteStatus,
            errors,
            html: sizes(html),
            htmlWithFixedNonces: sizes(html.replaceAll(nonce, 'nonce="fixed"')),
            importMap: sizes(map),
        };
    } catch (error) {
        throw new Error([`AssetMapper probe failed at ${baseURL}`, ...errors].join('\n'), { cause: error });
    } finally {
        await context.close();
    }
}

function summarize(result) {
    const { imports, importMapPayload, preloads, dashboardRequests, lazyRequests, ...details } = result;
    return {
        ...details,
        importMapEntries: imports.length,
        modulePreloads: preloads.length,
        dashboardScriptRequests: dashboardRequests.length,
        autocompleteScriptRequestsOnDashboard: dashboardRequests.filter((path) => autocomplete.test(path)).length,
        autocompleteScriptRequestsAfterVisit: lazyRequests,
    };
}

const [allURL, reachableURL] = process.argv.slice(2);
assert.ok(allURL && reachableURL, 'Usage: node tools/assetmapper-trial.mjs ALL_URL REACHABLE_URL');
const browser = await chromium.connect(process.env.PW_WS_ENDPOINT ?? 'ws://127.0.0.1:3000/', {
    ...(process.env.PW_DIRECT_NETWORK ? {} : { exposeNetwork: '<loopback>' }),
});
try {
    const all = await measure(browser, new URL(allURL).origin);
    const reachable = await measure(browser, new URL(reachableURL).origin);
    const removedImports = all.imports.filter((entry) => !reachable.imports.includes(entry));
    console.log(JSON.stringify({
        chromium: browser.version(),
        all: summarize(all),
        reachable: summarize(reachable),
        removedImports,
        identicalImportMap: all.importMapPayload === reachable.importMapPayload,
        dashboardScriptPathsOnlyInAll: all.dashboardRequests.filter((path) => !reachable.dashboardRequests.includes(path)),
        dashboardScriptPathsOnlyInReachable: reachable.dashboardRequests.filter((path) => !all.dashboardRequests.includes(path)),
    }, null, 2));
    assert.ok(removedImports.length > 0, 'check that the two HTTP servers use different import map modes');
    assert.deepEqual(reachable.imports.filter((entry) => !all.imports.includes(entry)), [], 'reachable adds no import map entries');
    assert.deepEqual(reachable.preloads, all.preloads, 'modulepreload paths match');
    assert.deepEqual(all.errors, [], 'the default mode serves a working dashboard and autocomplete');
    assert.equal(all.autocompleteStatus, 'passed');
    if (reachable.autocompleteStatus !== 'passed' || reachable.errors.length > 0) {
        process.exitCode = 1;
    }
} finally {
    await browser.close();
}
