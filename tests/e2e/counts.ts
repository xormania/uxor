import type { CDPSession, Page, Request } from '@playwright/test';
import { expect, test } from './fixtures';

/*
 * Tier 2 of docs/PLAN-test-tiers.md: what one key interaction costs, counted. Counts give the same numbers on every
 * run of the same build, so they gate like any other assertion; timings do not, and are reported elsewhere
 * (docs/TESTING.md, *Interaction counts*).
 *
 * What they do not measure: the listener change leaves out `{ once: true }` listeners and targets no longer in the
 * document, so a net zero is no proof that nothing is retained (and the tracker's own map holds references): it is not
 * a heap-leak check. Bytes are response bodies decoded, not the compressed size on the wire, and a body that cannot be
 * read counts as 0. `durationMs` includes Playwright's round trips to the browser, not the component's work alone, and
 * `inpMs` is one step's longest Event Timing entry under this synthetic workload, not a page's real-user INP.
 */

/** What one step of an interaction did, counted from its start until the page is quiet again. */
export type Counts = {
    /** requests started, by Playwright's resource type (`document`, `fetch`, `xhr`, `script`, `stylesheet`, `image`…) */
    requests: Record<string, number>;
    /** Stimulus controllers connected, by identifier (a re-render that reconnects a controller counts here) */
    connected: Record<string, number>;
    /** Stimulus controllers disconnected, by identifier */
    disconnected: Record<string, number>;
    /**
     * The change in event listeners on `document`, `window` and elements in the document, by `<target> <type>`, with
     * ` capture` for a capturing one (`document click capture`, `button click`, `window resize`): those added minus
     * those removed, the elements that left the document no longer counted (a listener on a detached element is not
     * seen, kept or not), `{ once: true }` ones never counted. `{}` when the step leaves the same listeners: the
     * listeners still reachable from the document, not proof that nothing is retained.
     */
    listeners: Record<string, number>;
};

/** What a step is expected to count, and a budget for its bytes. */
export type Expected = Counts & {
    /** the most bytes the step's responses may carry, bodies decoded (the HTML or JSON received, not its compressed size on the wire) */
    maxBytes: number;
};

/**
 * One step's counts, its response bytes (bodies decoded; one that cannot be read counts 0) and its timings, which are
 * reported, never gated: `durationMs` from the start of the step's action until the frame presented after the
 * action's own completion (the update it waits for has landed, then two animation frames; the wait for quiet after it
 * is not counted), Playwright's round trips included,
 * so not the component's time alone; `inpMs` the longest interaction the step caused, by the page's Event Timing
 * (Chromium and Firefox; `null` where the engine has none or the step had no interaction): one synthetic step's
 * longest entry, not the real-user INP of Core Web Vitals.
 */
export type Measured = { counts: Counts; bytes: number; durationMs: number; inpMs: number | null; tbtMs: number | null };

/**
 * What a timed step (`time`) adds, in Chromium only (`null` elsewhere): the change in Chromium's own counters over the
 * step (`Performance.getMetrics`: the time the renderer spent recalculating styles, in layout and running script),
 * read before the action and once the page is quiet again. A full page load resets them: such a step reports 0.
 */
export type RendererMetrics = { recalcStyleMs: number; layoutMs: number; scriptMs: number };

/** One timed step as the `timing` annotation records it (tools/monthly/timings.mjs, tools/ci/release-timings.mjs read it). */
export type Timing = { step: string; durationMs: number; inpMs: number | null; metrics?: Partial<Record<'tbtMs' | keyof RendererMetrics, number>> };

/*
 * The listeners every script of the page adds and removes, on document, window and every element, kept per target.
 * Playwright's own (added by scripts without a URL: the test's init scripts and evaluations) are left out, and so are
 * `{ once: true }` listeners (they remove themselves when they run); a listener added with an `AbortSignal` is removed
 * when the signal aborts.
 */
function installListenerTracker() {
    const w = window as any;
    if (w.__countListeners) {
        return;
    }
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const byTarget = new Map<EventTarget, Map<string, Set<unknown>>>();
    const keyOf = (type: string, options?: boolean | AddEventListenerOptions) =>
        `${type}${('boolean' === typeof options ? options : Boolean(options?.capture)) ? ' capture' : ''}`;
    const fromPage = () => /\bhttps?:\/\//.test(new Error().stack ?? '');
    const forget = (target: EventTarget, key: string, listener: unknown) => byTarget.get(target)?.get(key)?.delete(listener);

    EventTarget.prototype.addEventListener = function (type: string, listener: any, options?: any) {
        if (listener && !(options && 'object' === typeof options && options.once) && fromPage()) {
            const key = keyOf(type, options);
            const keys = byTarget.get(this) ?? byTarget.set(this, new Map()).get(this)!;
            (keys.get(key) ?? keys.set(key, new Set()).get(key)!).add(listener);
            const signal: AbortSignal | undefined = options && 'object' === typeof options ? options.signal : undefined;
            signal?.addEventListener('abort', () => forget(this, key, listener), { once: true });
        }
        return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type: string, listener: any, options?: any) {
        forget(this, keyOf(type, options), listener);
        return remove.call(this, type, listener, options);
    };
    // the longest interaction (Event Timing, `interactionId` set) since the step was armed; where the engine has no
    // Event Timing, null
    if (PerformanceObserver.supportedEntryTypes?.includes('event')) {
        const observer = new PerformanceObserver((list) => record(list.getEntries()));
        const record = (entries: PerformanceEntryList) => {
            for (const entry of entries as PerformanceEventTiming[]) {
                if (entry.interactionId && entry.startTime >= w.__stepArmedAt) {
                    w.__stepInp = Math.max(w.__stepInp ?? 0, entry.duration);
                }
            }
        };
        observer.observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
        w.__readInp = () => {
            record(observer.takeRecords());
            return w.__stepInp ?? null;
        };
    } else {
        w.__readInp = () => null;
    }
    // total blocking time since the step was armed: each long task's time over 50 ms (Long Tasks API, Chromium);
    // where the engine has none, null
    if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        const observer = new PerformanceObserver((list) => record(list.getEntries()));
        const record = (entries: PerformanceEntryList) => {
            for (const entry of entries) {
                if (entry.startTime >= w.__stepArmedAt) {
                    w.__stepTbt = (w.__stepTbt ?? 0) + Math.max(0, entry.duration - 50);
                }
            }
        };
        observer.observe({ type: 'longtask', buffered: true });
        w.__readTbt = () => {
            record(observer.takeRecords());
            return w.__stepTbt ?? 0;
        };
    } else {
        w.__readTbt = () => null;
    }
    w.__countListeners = () => {
        const counts: Record<string, number> = {};
        for (const [target, keys] of byTarget) {
            const name = target === document ? 'document' : target === window ? 'window' : target instanceof Element && target.isConnected ? target.localName : null;
            if (null === name) {
                continue;
            }
            for (const [key, listeners] of keys) {
                if (listeners.size) {
                    counts[`${name} ${key}`] = (counts[`${name} ${key}`] ?? 0) + listeners.size;
                }
            }
        }
        return counts;
    };
}

/*
 * Arms the counters of the current document for one step: the listeners as they are, and each Stimulus connect and
 * disconnect from now on, by identifier, through the application's `logDebugActivity`, which Stimulus calls for every
 * controller of every module, lazy ones included. Reads the demo's application (`window.Stimulus`,
 * demo/assets/stimulus_bootstrap.js).
 */
function armStep() {
    const w = window as any;
    const app = w.Stimulus;
    if (!app) {
        throw new Error('no Stimulus application on window.Stimulus');
    }
    if (!app.__countsLog) {
        const log = (app.__countsLog = [] as string[]);
        const original = app.logDebugActivity;
        app.logDebugActivity = (identifier: string, functionName: string, detail?: object) => {
            if ('connect' === functionName || 'disconnect' === functionName) {
                log.push(`${functionName} ${identifier}`);
            }
            return original.call(app, identifier, functionName, detail);
        };
    }
    app.__countsLog.length = 0;
    w.__countsListenersBefore = w.__countListeners();
    w.__stepArmedAt = performance.now();
    w.__stepInp = null;
    w.__stepTbt = 0;
}

/** What the step did in the page: the controllers connected and disconnected, the change in listeners. */
function readStep() {
    const w = window as any;
    const app = w.Stimulus;
    const tally = (prefix: string) => {
        const counts: Record<string, number> = {};
        for (const entry of app.__countsLog as string[]) {
            if (entry.startsWith(prefix)) {
                const id = entry.slice(prefix.length);
                counts[id] = (counts[id] ?? 0) + 1;
            }
        }
        return counts;
    };
    const before: Record<string, number> = w.__countsListenersBefore;
    const after: Record<string, number> = w.__countListeners();
    const listeners: Record<string, number> = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const change = (after[key] ?? 0) - (before[key] ?? 0);
        if (change) {
            listeners[key] = change;
        }
    }
    return { connected: tally('connect '), disconnected: tally('disconnect '), listeners, inpMs: w.__readInp(), tbtMs: w.__readTbt() };
}

const sorted = (counts: Record<string, number>) => Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * Counts what the steps of the page's interactions do. Call it before the first `goto`: it installs the listener
 * tracker as an init script.
 *
 * `measure(action)` runs one step: `action` performs it and waits for its own completion (a Turbo operation, Live's
 * response, the overlay shown); the counters then wait until no request is in flight and two animation frames have
 * passed, and read. `expect(name, action, expected)` measures the step and fails, naming it, on any count that differs
 * and on bytes over the budget. `warmUp(...actions)` runs steps uncounted. `measure` is the one place a step is
 * observed, its timings included: with PW_TIMINGS set, `expect` records each step's as a `timing` annotation of the
 * test, which the monthly job's timings report reads (tools/monthly/timings.mjs); they never fail a test.
 */
export async function trackCounts(page: Page) {
    await page.addInitScript(installListenerTracker);

    const measure = async (action: () => Promise<unknown>): Promise<Measured> => {
        await page.evaluate(armStep);
        const requests: Record<string, number> = {};
        const inFlight = new Set<Request>();
        const bodies: Promise<number>[] = [];
        const started = (request: Request) => {
            requests[request.resourceType()] = (requests[request.resourceType()] ?? 0) + 1;
            inFlight.add(request);
        };
        const finished = (request: Request) => {
            inFlight.delete(request);
            if (['document', 'fetch', 'xhr'].includes(request.resourceType())) {
                bodies.push(
                    request
                        .response()
                        .then((response) => response?.body())
                        .then((body) => body?.length ?? 0)
                        .catch(() => 0), // a redirect has no body
                );
            }
        };
        const failed = (request: Request) => inFlight.delete(request);
        page.on('request', started);
        page.on('requestfinished', finished);
        page.on('requestfailed', failed);
        let durationMs = 0;
        try {
            const start = performance.now();
            await action();
            // completion: the frame presented after the update, so the rendering it costs counts (two animation frames:
            // the one that renders the update has run when the second starts)
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            durationMs = performance.now() - start;
            // quiet: nothing in flight, then still nothing after two animation frames (a render may start a request)
            await expect
                .poll(
                    async () => {
                        if (inFlight.size) {
                            return [...inFlight].map((request) => `${request.method()} ${request.url()}`).join(', ');
                        }
                        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                        return inFlight.size ? 'a request started' : 'quiet';
                    },
                    { message: 'requests still in flight after the step' },
                )
                .toBe('quiet');
        } finally {
            page.off('request', started);
            page.off('requestfinished', finished);
            page.off('requestfailed', failed);
        }
        const stimulus = await page.evaluate(readStep);
        const bytes = (await Promise.all(bodies)).reduce((sum, length) => sum + length, 0);

        return {
            counts: {
                requests: sorted(requests),
                connected: sorted(stimulus.connected),
                disconnected: sorted(stimulus.disconnected),
                listeners: sorted(stimulus.listeners),
            },
            bytes,
            durationMs,
            inpMs: stimulus.inpMs,
            tbtMs: stimulus.tbtMs,
        };
    };

    const round = (ms: number) => Math.round(ms * 10) / 10;
    const annotate = (timing: Timing) => test.info().annotations.push({ type: 'timing', description: JSON.stringify(timing) });

    // Chromium's renderer counters, in seconds, through a CDP session opened on the first timed step
    let cdp: CDPSession | null | undefined;
    const rendererCounters = async (): Promise<Record<string, number> | null> => {
        if (undefined === cdp) {
            cdp = 'chromium' === page.context().browser()?.browserType().name() ? await page.context().newCDPSession(page) : null;
            await cdp?.send('Performance.enable');
        }
        if (!cdp) {
            return null;
        }
        const { metrics } = await cdp.send('Performance.getMetrics');
        return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
    };

    return {
        measure,
        /**
         * Runs the steps once, counting nothing: Turbo adds some of its listeners on the first click and the first
         * submit of a document (and of a frame), and a lazy controller loads on first use.
         */
        warmUp: async (...actions: (() => Promise<unknown>)[]) => {
            for (const action of actions) {
                await measure(action);
            }
        },
        expect: async (name: string, action: () => Promise<unknown>, { maxBytes, ...expected }: Expected): Promise<Measured> => {
            const measured = await measure(action);
            expect(measured.counts, `${name}: requests by kind, Stimulus controllers connected and disconnected, listeners added minus removed`).toEqual({
                requests: sorted(expected.requests),
                connected: sorted(expected.connected),
                disconnected: sorted(expected.disconnected),
                listeners: sorted(expected.listeners),
            });
            expect(measured.bytes, `${name}: bytes of the responses, bodies decoded, at most ${maxBytes}`).toBeLessThanOrEqual(maxBytes);
            if (process.env.PW_TIMINGS) {
                annotate({ step: name, durationMs: round(measured.durationMs), inpMs: measured.inpMs });
            }

            return measured;
        },
        /**
         * Measures the step and records its timings as a `timing` annotation, always, gating nothing: the release
         * checks' timings (tests/e2e/release.timings.spec.ts). Besides `measure`'s duration and INP, the step's total
         * blocking time (long tasks) and, in Chromium, the renderer's style, layout and script time (RendererMetrics).
         */
        time: async (name: string, action: () => Promise<unknown>): Promise<Measured & { metrics: RendererMetrics | null }> => {
            const before = await rendererCounters();
            const measured = await measure(action);
            const after = await rendererCounters();
            const delta = (key: string) => (before && after ? round(Math.max(0, (after[key] ?? 0) - (before[key] ?? 0)) * 1000) : 0);
            const metrics = before && after ? { recalcStyleMs: delta('RecalcStyleDuration'), layoutMs: delta('LayoutDuration'), scriptMs: delta('ScriptDuration') } : null;
            annotate({
                step: name,
                durationMs: round(measured.durationMs),
                inpMs: measured.inpMs,
                metrics: { ...(null === measured.tbtMs ? {} : { tbtMs: round(measured.tbtMs) }), ...(metrics ?? {}) },
            });

            return { ...measured, metrics };
        },
    };
}
