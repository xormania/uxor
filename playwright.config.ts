import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { playwrightImage } from './tools/playwright-image.mjs';
import { syncRecipeSpecs } from './tools/prepare-tests.mjs';

const require = createRequire(import.meta.url);
const { version } = require('@playwright/test/package.json');
const isCI = !!process.env.CI;
const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.DEMO_PORT ?? 8000);
/*
 * DEMO_URL points the tests at a demo already running, e.g. https://localhost from Docker (demo/compose.yaml);
 * the specs then run PHP in its container. Without it, Playwright serves the demo with PHP's built-in server.
 */
const demoURL = process.env.DEMO_URL?.replace(/\/$/, '');
const baseURL = demoURL ?? `http://127.0.0.1:${port}`;
if (demoURL) {
    process.env.PHP_BINARY ??= join(root, 'tools/demo-php');
}

/*
 * The browser runs in the same Docker image as upstream's toolkit tests (symfony/ux
 * src/Toolkit/assets/playwright.config.ts), so screenshots match the baselines copied from upstream. It is pinned by
 * digest in tools/playwright-image.json, whose tag must be this @playwright/test version (tools/playwright-image.mjs).
 * PW_BROWSER_SERVER overrides the command (e.g. `--network host` where port publishing is unavailable).
 */
const browserServer =
    process.env.PW_BROWSER_SERVER ??
    [
        'docker run --rm --init -p 127.0.0.1:3000:3000',
        playwrightImage(version),
        `npx -y playwright@${version} run-server --port 3000 --host 0.0.0.0`,
    ].join(' ');

/*
 * tools/prepare-tests.mjs prepares what the tests need, safely when several Playwright processes share this checkout:
 * the recipe specs' runnable copies in tests/e2e/examples/recipes/ (gitignored), which discovery (`--list`) needs, here
 * in the main process (workers load this config too; nothing is written when nothing changed), and the demo's CSS,
 * rebuilt when its sources changed, as the globalSetup: before the tests run, never for `--list`.
 */
if (!process.env.TEST_WORKER_INDEX) {
    syncRecipeSpecs();
}

/*
 * Two projects per browser: `smoke` (tests/e2e/*.spec.ts, desktop viewport) and `examples` (every README example and
 * the upstream recipe specs, at upstream's 800x600 viewport; screenshots live in <recipe>/tests/screenshots/). Chromium's
 * keep their plain names; Firefox's and WebKit's are suffixed: smoke-firefox, examples-webkit...
 *
 * Firefox and WebKit run the behavior tests only: every test tagged @screenshot (it compares pixels: a baseline, or two
 * screenshots with each other) is left out, as the baselines are Chromium's. PW_SCREENSHOTS=all turns them around: they
 * run the tagged tests only, compared with the same Chromium baselines, to report how far the other engines render
 * from them. Any difference fails that run, so its exit status is no verdict: the caller runs it apart from the
 * behavior tests and reports it, never gates on it (the baselines are never written from another browser).
 */
const crossBrowserScreenshots = 'all' === process.env.PW_SCREENSHOTS;
const desktop = { chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' } as const;

function browserProjects(browser: keyof typeof desktop) {
    const suffix = 'chromium' === browser ? '' : `-${browser}`;
    const other = 'chromium' !== browser;
    const select = {
        grep: other && crossBrowserScreenshots ? /@screenshot/ : undefined,
        grepInvert: other && !crossBrowserScreenshots ? /@screenshot/ : undefined,
    };

    return [
        {
            name: `smoke${suffix}`,
            testDir: './tests/e2e',
            // each test is its own unit for the shards (no spec shares state between its tests), so they balance
            fullyParallel: true,
            // the broad axe scans (a11y.spec.ts) run in Chromium only: Firefox and WebKit run the behavior; the
            // release checks' own specs (release.*.spec.ts) run in the `release` project only (below)
            testIgnore: other ? ['examples/**', 'a11y.spec.ts', 'release.*.spec.ts'] : ['examples/**', 'release.*.spec.ts'],
            ...select,
            use: { ...devices[desktop[browser]] },
        },
        {
            name: `examples${suffix}`,
            testDir: './tests/e2e/examples',
            fullyParallel: true,
            ...select,
            snapshotPathTemplate: '{testDir}/../../../{arg}{ext}',
            use: { browserName: browser, viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 },
        },
    ];
}

/*
 * The release checks (docs/PLAN-test-tiers.md, tier 3; docs/TESTING.md, *Release checks*), Chromium only (CDP, and the
 * timings' metrics), in three projects that exist only with RELEASE_CHECKS set, so CI and a plain local run never
 * select them. They are chosen by file and project, never by a tag: a tag starts with an at-sign, and that text, copied
 * into a commit message or a pull request, reads as a GitHub account reference.
 * - `release`: the release checks' own specs (release.*.spec.ts: timings, long session, fuzzing), which `smoke` ignores;
 * - `release-dark`: the overlay and editor specs in the dark theme (the system's, which the theme follows when nothing
 *   is chosen; `smoke` runs them in the light one);
 * - `release-harsh`: the heavy recipes' transitions (data tables, editor, date picker, autocomplete, chart) with the
 *   CPU 4 times slower, a slow network (tests/e2e/fixtures.ts, `harshConditions`) and a phone's viewport: their
 *   behavior still holds.
 * None compares screenshots: the baselines are the light theme's, at desktop and example sizes.
 */
const releaseSpecs = (names: string[]) => names.map((name) => `${name}.spec.ts`);
const releaseProjects = [
    {
        name: 'release',
        testDir: './tests/e2e',
        testMatch: 'release.*.spec.ts',
        fullyParallel: true,
        grepInvert: /@screenshot/,
        use: { ...devices['Desktop Chrome'] },
    },
    {
        name: 'release-dark',
        testDir: './tests/e2e',
        testMatch: releaseSpecs([
            'lab.overlays', 'dropdown', 'lab.popover', 'popover', 'lab.tooltip', 'lab.live-modal', 'lab.live-drawer',
            'lab.editor', 'editor', 'lab.markdown-editor', 'markdown-editor',
        ]),
        fullyParallel: true,
        grepInvert: /@screenshot/,
        use: { ...devices['Desktop Chrome'], colorScheme: 'dark' as const },
    },
    {
        name: 'release-harsh',
        testDir: './tests/e2e',
        testMatch: releaseSpecs(['lab.data-table-frame', 'lab.data-table-live', 'lab.editor', 'lab.date-picker', 'date-picker', 'lab.autocomplete', 'chart', 'lab.chart']),
        fullyParallel: true,
        grepInvert: /@screenshot/,
        timeout: 120_000,
        expect: { timeout: 20_000 },
        use: {
            // a phone (Pixel 7's viewport, scale and touch), launched as Chromium, as every project here
            viewport: devices['Pixel 7'].viewport,
            deviceScaleFactor: devices['Pixel 7'].deviceScaleFactor,
            isMobile: devices['Pixel 7'].isMobile,
            hasTouch: devices['Pixel 7'].hasTouch,
            userAgent: devices['Pixel 7'].userAgent,
            browserName: 'chromium' as const,
            harshConditions: true,
            actionTimeout: 20_000,
            navigationTimeout: 60_000,
        },
    },
];

export default defineConfig({
    globalSetup: './tools/prepare-tests.mjs',
    forbidOnly: isCI,
    retries: isCI ? 1 : 0,
    // Baselines are committed: never write screenshots unless asked with --update-snapshots.
    updateSnapshots: 'none',
    // CI also writes every test's attempts and outcome to playwright-results/results.json, uploaded green or red
    reporter: isCI ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'playwright-results/results.json' }]] : 'list',

    expect: {
        toHaveScreenshot: { animations: 'disabled', caret: 'hide' },
    },

    use: {
        baseURL,
        // Caddy's local certificate authority signs https://localhost
        ignoreHTTPSErrors: !!demoURL,
        connectOptions: { wsEndpoint: 'ws://127.0.0.1:3000/', exposeNetwork: '<loopback>' },
        trace: 'retain-on-failure',
    },

    projects: [
        // Chromium: every test, the screenshots included
        ...browserProjects('chromium'),
        // Firefox and WebKit: every behavior test, no screenshot comparison
        ...browserProjects('firefox'),
        ...browserProjects('webkit'),
        // the release checks (above): only with RELEASE_CHECKS set, so a plain local run stays the behavior suite
        // (release-checks.yml sets it)
        ...(process.env.RELEASE_CHECKS ? releaseProjects : []),
    ],

    webServer: [
        ...(demoURL
            ? []
            : [
                  {
                      // Serves the demo with PHP's built-in server; reuses one already listening. The upload limits are
                      // pinned so the upload specs' too-large cases do not depend on the machine's php.ini.
                      command: `php -d upload_max_filesize=2M -d post_max_size=8M -S 127.0.0.1:${port} -t demo/public`,
                      url: baseURL,
                      reuseExistingServer: true,
                      timeout: 30_000,
                  },
              ]),
        {
            command: browserServer,
            url: 'http://127.0.0.1:3000/',
            reuseExistingServer: true,
            timeout: 5 * 60_000,
        },
    ],
});
