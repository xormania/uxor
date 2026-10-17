import type { Browser, BrowserContext, CDPSession, Page, Request, Response } from '@playwright/test';
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

type DiagnosticPrimitive = string | number | boolean | null;
type DiagnosticFields = Record<string, DiagnosticPrimitive | DiagnosticPrimitive[] | Record<string, DiagnosticPrimitive>[]>;
type LongSessionDiagnostics = {
    phase: <T>(name: string, action: () => Promise<T>) => Promise<T>;
    probePage: (page: Page) => void;
    probeContext: (context: BrowserContext) => void;
    note: (event: string, fields: DiagnosticFields) => void;
    stop: () => void;
};

/** Temporary, opt-in driver telemetry. Never logs page objects or changes a browser command or its result. */
function longSessionDiagnostics(page: Page, browser: Browser): LongSessionDiagnostics {
    if ('1' !== process.env.LONG_SESSION_DIAGNOSTICS) {
        return { phase: (_name, action) => action(), probePage: () => {}, probeContext: () => {}, note: () => {}, stop: () => {} };
    }
    const started = performance.now();
    const info = test.info();
    const identity = { testedSha: process.env.TESTED_SHA ?? null, project: info.project.name, retry: info.retry, workerIndex: info.workerIndex };
    const cleanups: (() => void)[] = [];
    const pending = new Map<Request, string>();
    const phases: Record<string, DiagnosticPrimitive>[] = [];
    const requests = { requestsStarted: 0, responses: 0, requestsFinished: 0, requestsFailed: 0 };
    const lifecycle: Record<string, number> = {};
    let phase = 'start';
    let emitted = 0;
    let omitted = 0;
    let notices = 0;
    let heartbeats = 0;
    let stopped = false;
    let probeCloseRequested = false;
    const write = (text: string) => {
        try {
            console.log(text);
        } catch {
            // Telemetry must not replace an original browser error or decide the test's outcome.
        }
    };
    const pendingCount = () => Math.max(0, requests.requestsStarted - requests.requestsFinished - requests.requestsFailed);
    const path = (url: string) => {
        try {
            const parsed = new URL(url);
            return /^https?:$/.test(parsed.protocol) ? parsed.pathname.slice(0, 160) : `[${parsed.protocol}]`;
        } catch {
            return '[unavailable]';
        }
    };
    const clock = () => {
        const elapsedMs = Math.round(performance.now() - started);
        // Fixture time before this body is excluded. TestInfo.duration is zero until completion, not a live clock.
        return { utc: new Date().toISOString(), elapsedMs, remainingBudgetUpperBoundMs: Math.max(0, info.timeout - elapsedMs) };
    };
    const emit = (event: string, fields: DiagnosticFields = {}, final = false) => {
        if (emitted >= 96 && !final) {
            omitted++;
            return;
        }
        emitted++;
        write(`LONG_SESSION_DIAGNOSTIC ${JSON.stringify({ ...identity, ...clock(), phase, event, ...fields })}`);
    };
    const notice = (event: string, fields: DiagnosticFields = {}) => {
        if ('true' !== process.env.GITHUB_ACTIONS || notices >= 4) return;
        notices++;
        const text = JSON.stringify({ ...identity, ...clock(), phase, event, ...fields });
        write(`::notice title=Long session diagnostic::${text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
    };
    const observed = (label: string, event: string, fields: DiagnosticFields = {}) => {
        const key = `${label}.${event}`;
        lifecycle[key] = (lifecycle[key] ?? 0) + 1;
        emit('lifecycle', { label, kind: event, ...fields });
    };
    const watchPage = (target: Page, label: string) => {
        const crash = () => observed(label, 'crash');
        const close = () => observed(label, 'close', { intentionalProbeClose: 'probe' === label && probeCloseRequested });
        const dom = () => observed(label, 'domcontentloaded', { path: path(target.url()) });
        const load = () => observed(label, 'load', { path: path(target.url()) });
        const navigated = (frame: ReturnType<Page['mainFrame']>) => {
            if (frame === target.mainFrame()) observed(label, 'commit', { path: path(frame.url()) });
        };
        target.on('crash', crash);
        target.on('close', close);
        target.on('domcontentloaded', dom);
        target.on('load', load);
        target.on('framenavigated', navigated);
        cleanups.push(() => {
            target.off('crash', crash);
            target.off('close', close);
            target.off('domcontentloaded', dom);
            target.off('load', load);
            target.off('framenavigated', navigated);
        });
    };
    watchPage(page, 'main');
    const mainContext = page.context();
    const mainClosed = () => observed('main.context', 'close');
    const disconnected = () => observed('browser', 'disconnected');
    mainContext.on('close', mainClosed);
    browser.on('disconnected', disconnected);
    cleanups.push(() => mainContext.off('close', mainClosed), () => browser.off('disconnected', disconnected));
    const request = (value: Request) => {
        requests.requestsStarted++;
        if (pending.size < 64) pending.set(value, path(value.url()));
        if ('document' === value.resourceType()) emit('request.start', { method: value.method(), path: path(value.url()) });
    };
    const response = (value: Response) => {
        requests.responses++;
        if ('document' === value.request().resourceType()) emit('request.response', { path: path(value.url()), status: value.status() });
    };
    const finished = (value: Request) => {
        requests.requestsFinished++;
        pending.delete(value);
        if ('document' === value.resourceType()) emit('request.finished', { path: path(value.url()) });
    };
    const failed = (value: Request) => {
        requests.requestsFailed++;
        pending.delete(value);
        emit('request.failed', { method: value.method(), path: path(value.url()), resource: value.resourceType() });
    };
    page.on('request', request);
    page.on('response', response);
    page.on('requestfinished', finished);
    page.on('requestfailed', failed);
    cleanups.push(() => {
        page.off('request', request);
        page.off('response', response);
        page.off('requestfinished', finished);
        page.off('requestfailed', failed);
    });
    const heartbeat = setInterval(() => {
        if (heartbeats++ >= 10) return;
        emit('heartbeat', { pageClosed: page.isClosed(), path: path(page.url()), ...requests, pendingRequests: pendingCount(), pendingSample: [...pending.values()].slice(0, 6) });
    }, 30_000);
    heartbeat.unref();
    emit('start', { configuredTimeoutMs: info.timeout, budgetBasis: 'body-entry upper bound; fixture time excluded' });
    notice('start');
    return {
        phase: async (name, action) => {
            phase = name;
            if ('probe.context.close' === name) probeCloseRequested = true;
            const began = performance.now();
            let completed = false;
            emit('phase.begin');
            if ('main.goto' === name) notice('phase.begin');
            try {
                const result = await action();
                completed = true;
                return result;
            } finally {
                const fields = { completed, phaseElapsedMs: Math.round(performance.now() - began) };
                phases.push({ name, ...fields });
                emit('phase.end', fields);
                if ('probe.prepare' === name) notice('phase.end', fields);
            }
        },
        probePage: (probe) => watchPage(probe, 'probe'),
        probeContext: (context) => {
            emit('probe.context', { isMainContext: context === mainContext });
            const closed = () => observed('probe.context', 'close', { intentionalProbeClose: probeCloseRequested });
            context.on('close', closed);
            cleanups.push(() => context.off('close', closed));
        },
        note: emit,
        stop: () => {
            if (stopped) return;
            stopped = true;
            clearInterval(heartbeat);
            for (const cleanup of cleanups.splice(0)) cleanup();
            emit('summary', { ...requests, ...lifecycle, phases, pendingRequests: pendingCount(), pendingSample: [...pending.values()].slice(0, 12), pendingSampleTruncated: pendingCount() > Math.min(12, pending.size), omitted }, true);
            notice('summary', { ...requests, ...lifecycle, pendingRequests: pendingCount(), pendingSample: [...pending.values()].slice(0, 6), omitted });
            pending.clear();
            phases.length = 0;
        },
    };
}

/**
 * Whether this browser runs Chromium's leak detector: `Memory.prepareForLeakDetection`, tried once in a page of its
 * own context, never the page under test. Chromium 145 (Playwright 1.58's build, headless shell and full) answers
 * "Failed to run leak detection" and its renderer crashes, so where it fails the same caches are dropped the way a
 * memory-pressure signal drops them (`Memory.simulatePressureNotification`), before the same forced collection; the
 * report says which ran.
 */
async function leakDetectorRuns(browser: Browser, diagnostics: LongSessionDiagnostics): Promise<boolean> {
    const context = await diagnostics.phase('probe.context.create', () => browser.newContext());
    diagnostics.probeContext(context);
    try {
        const probe = await diagnostics.phase('probe.page.create', () => context.newPage());
        diagnostics.probePage(probe);
        const cdp = await diagnostics.phase('probe.cdp.create', () => context.newCDPSession(probe));
        await diagnostics.phase('probe.prepare', () => cdp.send('Memory.prepareForLeakDetection'));
        await diagnostics.phase('probe.evaluate', () => probe.evaluate(() => 1)); // the renderer survived it
        return true;
    } catch {
        return false;
    } finally {
        await diagnostics.phase('probe.context.close', () => context.close()).catch(() => undefined);
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

test.describe('release long session', () => {
    test.skip(({ browserName }) => 'chromium' !== browserName, 'the leak-detection counters are Chromium\'s (CDP)');

    test(`${VISITS} Turbo visits and Backs leave the DOM counters and the JS heap at their level`, async ({ page, browser }) => {
        test.setTimeout(300_000);
        const diagnostics = longSessionDiagnostics(page, browser);
        let leakDetector: boolean;
        try {
            leakDetector = await leakDetectorRuns(browser, diagnostics);
            diagnostics.note('probe.result', { available: leakDetector });
            await diagnostics.phase('main.goto', () => page.goto(HOME));
        } finally {
            // Drop driver listeners, request references and heartbeat before any warm-up or memory measurement.
            diagnostics.stop();
        }
        const prepared = leakDetector ? 'Memory.prepareForLeakDetection' : 'Memory.simulatePressureNotification (the leak detector crashes this Chromium)';
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
