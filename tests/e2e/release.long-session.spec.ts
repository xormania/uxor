import type { Browser, CDPSession, Page } from '@playwright/test';
import { test, expect, controllersConnected } from './fixtures';
import { turboOperation } from './transitions';

/*
 * Release checks (docs/PLAN-test-tiers.md, tier 3), long sessions: 50 Turbo visits and Backs across the demo, then
 * Chromium's leak-detection counters back at their level after the first visits. A controller that keeps a listener,
 * a timer or a reference to its element after `disconnect()` keeps its whole detached page alive, which one visit hides
 * and fifty show (a window listener planted in the date picker's connect() without its removal: nodes 26,352 to
 * 106,182, listeners 46 to 96, the heap 7.0 to 12.6 MB; without it, nodes 6,907 to 6,907, listeners 34 to 34, the
 * heap 5.7 to 6.2 MB).
 *
 * Each counter is read after `Memory.prepareForLeakDetection` (which drops the caches that would hold DOM alive on
 * their own; see leakDetectorRuns) and a forced collection (`HeapProfiler.collectGarbage`): `Memory.getDOMCounters`
 * (documents, nodes, JS event listeners) and the JS heap in use (`Runtime.getHeapUsage`). The level is taken once every
 * page has been visited WARM_ROUNDS times (its modules loaded, its Turbo snapshot cached: up to 10 pages, these are 8),
 * so what is left is what a visit leaves behind. The tolerance (TOLERANCE below) absorbs what a collection leaves at
 * random and the heap's slow growth; a leak of one detached page per visit is far above it.
 */

// One layout family: Turbo replaces the page in place between them. A visit between the gallery and lab layout and the
// app layout of /demo is a full load (their tracked assets differ), which starts a new document and so leaks nothing.
const PAGES = [
    '/forms',
    '/lab/data-table-frame',
    '/lab/data-table-live',
    '/lab/editor-turbo',
    '/lab/markdown-turbo',
    '/lab/date-picker-turbo',
    '/lab/autocomplete',
    '/lab/modal-turbo',
];
const HOME = '/lab';
const VISITS = Number(process.env.LONG_SESSION_VISITS ?? 50);
/**
 * The rounds of visits before the level is taken. The JS heap grows on the first visits and then less and less
 * (compiled code and its feedback, Turbo's restoration data, interned strings: 4.9 MB after one round, 5.9 after two,
 * 6.2 after six, measured 2026-10-10), so the level is taken after two.
 */
const WARM_ROUNDS = 2;

/** How far each counter may end above its level: a part of the level, plus a fixed amount. */
const TOLERANCE = {
    documents: { ratio: 0, plus: 0 },
    nodes: { ratio: 0.05, plus: 200 },
    jsEventListeners: { ratio: 0.05, plus: 20 },
    jsHeapUsedSize: { ratio: 0.1, plus: 512 * 1024 },
} as const;

type Counters = Record<keyof typeof TOLERANCE, number>;

/**
 * Whether this browser runs Chromium's leak detector: `Memory.prepareForLeakDetection`, tried once in a page of its
 * own context, never the page under test. Chromium 145 (Playwright 1.58's build, headless shell and full) answers
 * "Failed to run leak detection" and its renderer crashes, so where it fails the same caches are dropped the way a
 * memory-pressure signal drops them (`Memory.simulatePressureNotification`), before the same forced collection; the
 * report says which ran.
 */
async function leakDetectorRuns(browser: Browser): Promise<boolean> {
    const context = await browser.newContext();
    try {
        const probe = await context.newPage();
        const cdp = await context.newCDPSession(probe);
        await cdp.send('Memory.prepareForLeakDetection');
        await probe.evaluate(() => 1); // the renderer survived it
        return true;
    } catch {
        return false;
    } finally {
        await context.close().catch(() => undefined);
    }
}

async function counters(cdp: CDPSession, leakDetector: boolean): Promise<Counters> {
    // the console's messages keep the objects they were given (DevTools holds them): none may keep a page alive
    await cdp.send('Runtime.discardConsoleEntries');
    if (leakDetector) {
        await cdp.send('Memory.prepareForLeakDetection');
    } else {
        await cdp.send('Memory.simulatePressureNotification', { level: 'critical' });
    }
    for (let i = 0; i < 3; i++) {
        await cdp.send('HeapProfiler.collectGarbage');
    }
    const { documents, nodes, jsEventListeners } = await cdp.send('Memory.getDOMCounters');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');

    return { documents, nodes, jsEventListeners, jsHeapUsedSize: usedSize };
}

const visitAndBack = async (page: Page, url: string) => {
    await turboOperation(page, { url }, () => page.evaluate((target) => (window as any).Turbo.visit(target), url));
    // still the first document: a full load would start afresh and hide any leak
    expect(await page.evaluate(() => (window as any).__longSession), `the visit to ${url} replaced the document`).toBe(true);
    // every controller of the page connected, its lazy modules loaded: Back does not cancel their requests
    await controllersConnected(page);
    await turboOperation(page, { url: HOME }, () => page.goBack());
};

test.describe('release long session', { tag: '@release' }, () => {
    test.skip(({ browserName }) => 'chromium' !== browserName, 'the leak-detection counters are Chromium\'s (CDP)');

    test(`${VISITS} Turbo visits and Backs leave the DOM counters and the JS heap at their level`, async ({ page, browser }) => {
        test.setTimeout(300_000);
        const leakDetector = await leakDetectorRuns(browser);
        const prepared = leakDetector ? 'Memory.prepareForLeakDetection' : 'Memory.simulatePressureNotification (the leak detector crashes this Chromium)';
        await page.goto(HOME);
        // The demo runs Symfony's dev environment, where Stimulus logs each connect with its element; with the console
        // recorded (as Playwright records it), every logged element and its detached page would stay alive. Off for the
        // session: what is measured is what the page keeps, not what a debug log keeps.
        await page.evaluate(() => {
            (window as any).__longSession = true;
            (window as any).Stimulus.debug = false;
        });
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('HeapProfiler.enable');

        for (let round = 0; round < WARM_ROUNDS; round++) {
            for (const url of PAGES) {
                await visitAndBack(page, url);
            }
        }
        const level = await counters(cdp, leakDetector);

        for (let visit = 0; visit < VISITS; visit++) {
            await visitAndBack(page, PAGES[visit % PAGES.length]);
        }
        const after = await counters(cdp, leakDetector);

        const report = Object.fromEntries(
            (Object.keys(TOLERANCE) as (keyof Counters)[]).map((key) => {
                const limit = Math.round(level[key] * (1 + TOLERANCE[key].ratio) + TOLERANCE[key].plus);
                return [key, { level: level[key], after: after[key], change: after[key] - level[key], limit }];
            }),
        );
        expect(await page.evaluate(() => (window as any).__longSession), 'the session stayed in its first document').toBe(true);
        test.info().annotations.push({ type: 'long-session', description: JSON.stringify({ prepared, ...report }) });
        console.log(`long session, ${VISITS} visits and Backs (caches dropped by ${prepared}): ${JSON.stringify(report)}`);

        for (const [key, { after: value, limit }] of Object.entries(report)) {
            expect(value, `${key} after ${VISITS} visits and Backs: level ${report[key].level}, limit ${limit}`).toBeLessThanOrEqual(limit);
        }
    });
});
