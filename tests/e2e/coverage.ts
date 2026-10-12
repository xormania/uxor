import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Opt-in V8 coverage of the kit's Stimulus controllers, for the monthly job (.github/workflows/monthly.yml, docs/TESTING.md,
 * *Monthly job*). Off unless JS_COVERAGE names an output directory: then each test's page records Chromium's precise
 * coverage (Playwright's page.coverage, Chromium only; other browsers record nothing) and writes the scripts served from
 * /assets/controllers/ to <JS_COVERAGE>/<test id>-<retry>.json: their URL, the SHA-256 of the served source and V8's
 * functions with their ranges and counts. tools/monthly/js-coverage.mjs merges the files and maps them to
 * <recipe>/assets/controllers/*.js; vendor and importmap packages are never written. A page the test opens itself
 * (context.newPage()) is not recorded.
 */
const outputDir = process.env.JS_COVERAGE;
const CONTROLLER_URL = /\/assets\/controllers\/[^/]+\.js(?:\?|$)/;

export async function startJsCoverage(page: Page, testInfo: TestInfo): Promise<() => Promise<void>> {
    if (!outputDir || 'chromium' !== page.context().browser()?.browserType().name()) {
        return async () => {};
    }
    // a Turbo Drive visit is no navigation, but a full load (page.goto, a form without Turbo) is: keep counting across it
    await page.coverage.startJSCoverage({ resetOnNavigation: false });

    return async () => {
        let entries: Awaited<ReturnType<Page['coverage']['stopJSCoverage']>>;
        try {
            entries = await page.coverage.stopJSCoverage();
        } catch {
            return; // the test closed its page: nothing left to read
        }
        const scripts = entries
            .filter((entry) => CONTROLLER_URL.test(entry.url))
            .map(({ url, source, functions }) => ({
                url,
                sha256: createHash('sha256').update(source ?? '').digest('hex'),
                length: (source ?? '').length,
                functions,
            }));
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(
            join(outputDir, `${testInfo.testId}-${testInfo.retry}.json`),
            JSON.stringify({ test: testInfo.titlePath.join(' › '), project: testInfo.project.name, status: testInfo.status, scripts }),
        );
    };
}
