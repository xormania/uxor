import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Locator, type Page, type Request } from '@playwright/test';
import { startJsCoverage } from './coverage';

const PLACEHOLDER_IMAGE = fileURLToPath(new URL('./examples/placeholder.png', import.meta.url));

type CollectedError = { message: string; httpStatus?: number; url?: string };

/** A request a test cancels on purpose: its exact URL, method, `Turbo-Frame` header, and how many times at most. */
export type CancelledRequest = { url: string; method: 'GET' | 'POST'; frame: string; count: number };

type Guard = Awaited<ReturnType<typeof guardPage>>;

/**
 * The slow network of the harsh conditions: Chrome DevTools' "Slow 4G" preset (150 ms of latency, 1.6 Mbit/s down,
 * 750 kbit/s up, with DevTools' own adjustment factors), on every request of the page.
 */
export const HARSH_NETWORK = { offline: false, latency: 150 * 3.75, downloadThroughput: (1.6 * 1024 * 1024 * 0.9) / 8, uploadThroughput: (750 * 1024 * 0.9) / 8 };

/** How each engine names a request the page cancelled (an aborted fetch, a navigation away): Chromium, Firefox, WebKit. */
const CANCELLED = ['net::ERR_ABORTED', 'NS_BINDING_ABORTED', 'Load request cancelled'];

/**
 * WebKit's rejection of a fetch the document still runs when a full load replaces it (a reload, a `goto`): Turbo's
 * prefetch of a link under the pointer rethrows it, unhandled. Dropped in WebKit only, from the full load's request
 * until its document replaces the one on screen; a navigation that fails or leaves the document in place (a 204) ends
 * that window. Calibrated in smoke.spec.ts ("the page guard").
 */
// "Fetch API cannot load <url> due to access control checks.", which Playwright cuts at the URL's "://"
const FETCH_CANCELLED_BY_UNLOAD = [/TypeError: Load failed$/, / due to access control checks\.$/];

/**
 * Firefox's rejection of Turbo's prefetch (a link under the pointer) when a full load cancels its request: Turbo
 * (8.0.23, `PrefetchCache.putLater`) runs `request.perform()` with no catch, and `perform()` rethrows every error but
 * an AbortError, so the TypeError Firefox gives the document's fetches at unload is unhandled. Dropped in Firefox
 * only, for this exact message thrown from Turbo's prefetch (`perform` called by `putLater`, in Turbo's module of the
 * demo), when, as it is thrown, the rejection is its own request's: no prefetch request still runs, and the last one to
 * end failed as cancelled, on the document on screen (after its last commit), never paired before. Firefox reports
 * the error before or after the full load's request, so check() then asks for that load: a main-frame navigation
 * request after that commit, and the document it commits. Calibrated in smoke.spec.ts ("the page guard").
 */
const PREFETCH_CANCELLED_BY_UNLOAD = 'NetworkError when attempting to fetch resource.';
/** Thrown by Turbo's `perform()` (its first frame), from the timer of `putLater` (Turbo's module of the demo). */
const fromTurboPrefetch = (stack: string, baseURL: string | undefined) => {
    const frames = stack.split('\n').map((line) => line.trim());
    const inTurbo = (frame: string, fn: string) => frame.startsWith(`at ${fn} (${baseURL}/assets/vendor/@hotwired/turbo/`);
    return inTurbo(frames[1] ?? '', 'perform') && frames.some((frame) => inTurbo(frame, 'setTimeout handler*putLater'));
};

/**
 * Records every Content Security Policy violation of the page and its frames. The demo enforces a strict policy
 * (demo/src/EventListener/SecurityHeadersListener.php): a violation means some markup needs `'unsafe-inline'`.
 * Chromium also logs each one as a console error.
 */
export async function recordCspViolations(page: Page): Promise<string[]> {
    const violations: string[] = [];
    await page.exposeBinding('__recordCspViolation', (_source, violation: string) => void violations.push(violation));
    await page.addInitScript(() => {
        document.addEventListener(
            'securitypolicyviolation',
            (event) => {
                const blocked = event.blockedURI || 'inline';
                const sample = event.sample ? `: ${event.sample}` : '';
                (window as any).__recordCspViolation(`${event.effectiveDirective} blocked ${blocked} on ${event.documentURI}${sample}`);
            },
            true,
        );
    });

    return violations;
}

/**
 * The checks every test of every project runs. Requests leaving the demo are blocked (images get a local placeholder),
 * and the test fails on a console error, an uncaught page error, a Content Security Policy violation, or a local
 * request that fails or answers >= 400.
 *
 * `allowHttpError(url, status)` accepts exactly that response, `url` being a RegExp or 'document' (the page's own
 * document, in the main frame): the response itself and Chromium's matching "Failed to load resource" console message
 * are dropped, nothing else.
 *
 * `allowCancelledRequest({ url, method, frame, count })` accepts at most `count` requests that fail as cancelled
 * (CANCELLED: each engine's text) and match all of: this exact URL (same origin), this method, and the `Turbo-Frame`
 * header naming `frame`. Only for a test that interrupts that request on purpose (Back while a frame visit runs: Turbo cancels its
 * fetch); any other failed request, or one more than `count`, still fails the test.
 */
export async function guardPage(page: Page, baseURL: string | undefined) {
    const errors: CollectedError[] = [];
    const allowed: { url: RegExp | 'document'; status: number }[] = [];
    const cancellable: CancelledRequest[] = [];
    const documents = new Set<string>(); // the URLs the main frame navigated to
    // a full load's request, from its start until its document replaces the one on screen (or it fails: no document)
    let pendingDocument: Request | null = null;
    const engine = page.context().browser()?.browserType().name();
    const webkit = 'webkit' === engine;
    // in order of the events: local prefetch requests (when each ended, cancelled or not), main-frame navigation
    // requests and documents (commits), and Turbo's prefetch rejections (PREFETCH_CANCELLED_BY_UNLOAD) with the request
    // each one ends, if any, and the last commit before it; check() asks for the full load after that commit
    type Prefetch = { ended?: number; cancelled?: boolean; paired?: boolean };
    let step = 0;
    const prefetches = new Map<Request, Prefetch>();
    const prefetchRejections: { request: Prefetch | null; previousCommit: number }[] = [];
    const navigations: number[] = [];
    const commits: number[] = [];
    const prefetchEnded = (request: Request, cancelled: boolean) => {
        const prefetch = prefetches.get(request);
        if (prefetch) {
            prefetch.ended = ++step;
            prefetch.cancelled = cancelled;
        }
    };
    const isLocal = (url: string) => url.startsWith(`${baseURL}/`);
    const cspViolations = await recordCspViolations(page);

    await page.route(
        (url) => !isLocal(url.href),
        (route) => ('image' === route.request().resourceType() ? route.fulfill({ path: PLACEHOLDER_IMAGE }) : route.abort()),
    );

    page.on('request', (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            documents.add(request.url());
            pendingDocument = request;
            navigations.push(++step);
        } else if ('prefetch' === request.headers()['x-sec-purpose'] && isLocal(request.url())) {
            prefetches.set(request, {});
        }
    });
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
            pendingDocument = null;
            commits.push(++step);
        }
    });
    page.on('console', (message) => {
        const url = message.location().url;
        // a blocked request leaving the demo logs its failure at its own URL
        if ('error' !== message.type() || (url && !isLocal(url))) {
            return;
        }
        const failedLoad = message.text().match(/^Failed to load resource: the server responded with a status of (\d+)/);
        errors.push({
            message: `console: ${message.text()}`,
            httpStatus: failedLoad ? Number(failedLoad[1]) : undefined,
            url: failedLoad ? url : undefined,
        });
    });
    page.on('pageerror', (error) => {
        // the document being replaced: what it still had running is cancelled, which nobody sees
        if (webkit && pendingDocument && FETCH_CANCELLED_BY_UNLOAD.some((pattern) => pattern.test(error.message))) {
            return;
        }
        if ('firefox' === engine && PREFETCH_CANCELLED_BY_UNLOAD === error.message && fromTurboPrefetch(error.stack ?? '', baseURL)) {
            // the request this rejection ends: none still running, the last to end, cancelled on this document
            const previousCommit = commits.at(-1) ?? 0;
            const requests = [...prefetches.values()];
            const last = requests.reduce<Prefetch | null>((latest, request) => ((request.ended ?? 0) > (latest?.ended ?? 0) ? request : latest), null);
            const own = requests.every((request) => undefined !== request.ended) && last?.cancelled && !last.paired && last.ended! > previousCommit ? last : null;
            if (own) {
                own.paired = true;
            }
            prefetchRejections.push({ request: own, previousCommit });
            return;
        }
        errors.push({ message: `pageerror: ${error.message}` });
    });
    page.on('requestfinished', (request) => prefetchEnded(request, false));
    page.on('response', (response) => {
        if (response.status() >= 400 && isLocal(response.url())) {
            errors.push({ message: `http ${response.status()}: ${response.url()}`, httpStatus: response.status(), url: response.url() });
        }
    });
    page.on('requestfailed', (request) => {
        if (request === pendingDocument) {
            pendingDocument = null; // the document on screen stays (a 204 answer, a download)
        }
        const aborted = CANCELLED.includes(request.failure()?.errorText ?? '');
        prefetchEnded(request, aborted);
        // Turbo 8 prefetches a link on hover and cancels the request when the pointer leaves it
        const cancelledPrefetch = 'prefetch' === request.headers()['x-sec-purpose'] && aborted;
        // a request the test interrupts on purpose (allowCancelledRequest), each allowance used at most `count` times
        const expected =
            aborted &&
            cancellable.find(
                (allowance) =>
                    allowance.count > 0 &&
                    allowance.url === request.url() &&
                    allowance.method === request.method() &&
                    allowance.frame === request.headers()['turbo-frame'],
            );
        if (expected) {
            expected.count--;
        } else if (isLocal(request.url()) && !cancelledPrefetch) {
            errors.push({ message: `requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}` });
        }
    });

    const isAllowed = ({ httpStatus, url }: CollectedError) =>
        undefined !== httpStatus &&
        undefined !== url &&
        allowed.some((a) => a.status === httpStatus && ('document' === a.url ? documents.has(url) : a.url.test(url)));

    return {
        allowHttpError: (url: RegExp | 'document', status: number) => void allowed.push({ url, status }),
        allowCancelledRequest: (allowance: CancelledRequest) => {
            if (!isLocal(allowance.url)) {
                throw new Error(`allowCancelledRequest: ${allowance.url} is not a URL of the demo`);
            }
            cancellable.push({ ...allowance });
        },
        check: () => {
            // each of Turbo's prefetch rejections, its own request cancelled, needs the full load that cancelled it: a
            // main-frame navigation request after the last commit before the rejection, and the document it commits
            const unmatchedRejections = prefetchRejections.filter(({ request, previousCommit }) => {
                const load = navigations.find((navigation) => navigation > previousCommit);
                return null === request || undefined === load || !commits.some((commit) => commit > load);
            });
            const unexpected = [
                ...errors.filter((error) => !isAllowed(error)).map(({ message }) => message),
                ...unmatchedRejections.map(() => `pageerror: ${PREFETCH_CANCELLED_BY_UNLOAD}`),
                ...cspViolations.map((violation) => `csp: ${violation}`),
            ];
            expect(unexpected, 'console errors, page errors, CSP violations or failed requests').toEqual([]);
        },
    };
}

/**
 * The checks of guardPage() on every test; a test expecting an HTTP error allows it with `allowHttpError`, a test
 * interrupting a frame visit on purpose allows its cancelled request with `allowCancelledRequest`.
 */
export const test = base.extend<{
    pageGuard: Guard;
    allowHttpError: (url: RegExp, status: number) => void;
    allowCancelledRequest: (allowance: CancelledRequest) => void;
    harshConditions: boolean;
    harsh: void;
}>({
    /**
     * The release checks' harsh conditions (docs/PLAN-test-tiers.md, tier 3; the `release-harsh` project of
     * playwright.config.ts): the page's CPU 4 times slower and a slow network (HARSH_NETWORK), set before the test
     * starts, in Chromium (CDP). The project adds a phone's viewport and touch.
     */
    harshConditions: [false, { option: true }],
    harsh: [
        async ({ page, harshConditions, browserName }, use) => {
            if (harshConditions && 'chromium' === browserName) {
                const cdp = await page.context().newCDPSession(page);
                await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
                await cdp.send('Network.enable');
                await cdp.send('Network.emulateNetworkConditions', HARSH_NETWORK);
            }
            await use();
        },
        { auto: true },
    ],
    pageGuard: [
        async ({ page, baseURL }, use, testInfo) => {
            const guard = await guardPage(page, baseURL);
            const stopCoverage = await startJsCoverage(page, testInfo); // JS_COVERAGE only (monthly job)
            await use(guard);
            await stopCoverage();
            guard.check();
        },
        { auto: true },
    ],
    allowHttpError: async ({ pageGuard }, use) => use(pageGuard.allowHttpError),
    allowCancelledRequest: async ({ pageGuard }, use) => use(pageGuard.allowCancelledRequest),
});

export { expect };

/**
 * Waits until the current Turbo visit has rendered the server's response. A visit to a page Turbo has cached first
 * shows that snapshot as a preview (`data-turbo-preview` on <html>), so the new page's content is visible while its
 * request is still running, and going Back or away then cancels the request. Turbo marks <html> `aria-busy` from
 * the start of a visit to its end.
 */
export async function turboVisitDone(page: Page): Promise<void> {
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('aria-busy');
    await expect(html).not.toHaveAttribute('data-turbo-preview');
}

/**
 * The connected Stimulus controllers of `identifier`, and the elements carrying it: after repeated Turbo visits, each
 * element must have exactly one. Reads the demo's application (`window.Stimulus`, set in
 * demo/assets/stimulus_bootstrap.js).
 */
export async function stimulusControllers(page: Page, identifier: string): Promise<{ controllers: number; elements: number; distinctElements: number }> {
    return page.evaluate((id) => {
        const controllers = ((window as any).Stimulus.controllers as { identifier: string; element: Element }[]).filter((controller) => controller.identifier === id);
        return {
            controllers: controllers.length,
            elements: document.querySelectorAll(`[data-controller~="${id}"]`).length,
            distinctElements: new Set(controllers.map((controller) => controller.element)).size,
        };
    }, identifier);
}

/** The checks of a document markDocument() marked. */
export type SameDocument = { expectKept: () => Promise<void>; expectReplaced: () => Promise<void> };

/**
 * Marks the document on screen, to check that what follows kept it (Turbo rendered the next page in place) or replaced
 * it (a full load). `expectKept()` fails at once when the marker is gone: a link or form fell back to a full load (a
 * Turbo Drive regression, a `data-turbo="false"` too many, a 500 answered with a full load). `expectReplaced()` waits
 * for the full load the step started, a new document without the marker.
 */
export async function markDocument(page: Page): Promise<SameDocument> {
    await page.evaluate(() => ((window as any).__sameDocument = true));

    return {
        expectKept: async () => {
            expect(await page.evaluate(() => (window as any).__sameDocument), 'the document marked is still on screen: no full load').toBe(true);
        },
        expectReplaced: async () => {
            await expect.poll(() => page.evaluate(() => (window as any).__sameDocument), { message: 'a full load replaced the document marked' }).toBeUndefined();
        },
    };
}

/**
 * Records, in each document the page loads from now on, whether `<html>` has the `dark` class when `<body>` starts
 * parsing, i.e. before the first paint: a flash of the wrong theme reads as the other value. Call it before the
 * `goto`; the reader returns the value of the document on screen.
 */
export async function recordDarkAtFirstBody(page: Page): Promise<() => Promise<boolean | undefined>> {
    await page.addInitScript(() => {
        new MutationObserver((_, observer) => {
            if (document.body) {
                (window as any).__darkAtFirstBody = document.documentElement.classList.contains('dark');
                observer.disconnect();
            }
        }).observe(document, { childList: true, subtree: true });
    });

    return () => page.evaluate(() => (window as any).__darkAtFirstBody as boolean | undefined);
}

/**
 * Counts the events of each of `types` that reach `document` from now on (bubbling), only those whose target matches
 * the CSS selector `target` when given; the reader returns them by type, each type present (`{ change: 1 }`). Each
 * call counts on its own: a second one in the same document starts from zero and leaves the first one's numbers alone.
 * The current document only: Turbo visits keep it, a full load ends it (the reader then fails).
 */
export async function countEvents(page: Page, types: readonly string[], target?: string): Promise<() => Promise<Record<string, number>>> {
    const id = await page.evaluate(
        ({ types, target }) => {
            const counts: Record<string, number> = Object.fromEntries(types.map((type) => [type, 0]));
            for (const type of types) {
                document.addEventListener(type, (event) => {
                    if (!target || (event.target instanceof Element && event.target.matches(target))) {
                        counts[type]++;
                    }
                });
            }
            return ((window as any).__eventCounts ??= [] as Record<string, number>[]).push(counts) - 1;
        },
        { types, target },
    );

    return () => page.evaluate((id) => ({ ...(window as any).__eventCounts[id] }) as Record<string, number>, id);
}

/** Whether the `<dialog>` is open, and shown modal (`:modal`: the page behind it inert, the dialog in the top layer). */
export function dialogState(dialog: Locator): Promise<{ open: boolean; modal: boolean }> {
    return dialog.evaluate((element: HTMLDialogElement) => ({ open: element.open, modal: element.matches(':modal') }));
}

/**
 * Waits until every element of the page naming a controller in `data-controller` has that controller connected
 * (lazy ones loaded): the widgets are mounted, so a scan or a check reads what they render, not the server's markup
 * before them. Fails naming the elements and identifiers still waiting. Reads the demo's application
 * (`window.Stimulus`); a controller's own asynchronous work after `connect()` (an editor's mount) is the spec's to await.
 * `csrf-protection` is left out: Symfony's csrf_protection_controller.js is a module of document listeners whose
 * default export is a string, so no controller ever connects for it.
 */
export async function controllersConnected(page: Page): Promise<void> {
    await expect
        .poll(
            () =>
                page.evaluate(() => {
                    const app = (window as any).Stimulus;
                    if (!app) {
                        return ['no Stimulus application on window.Stimulus'];
                    }
                    const connected = new Map<Element, Set<string>>();
                    for (const { element, identifier } of app.controllers as { element: Element; identifier: string }[]) {
                        (connected.get(element) ?? connected.set(element, new Set()).get(element)!).add(identifier);
                    }
                    const waiting: string[] = [];
                    for (const element of document.querySelectorAll('[data-controller]')) {
                        for (const identifier of element.getAttribute('data-controller')!.split(/\s+/).filter((id) => id && 'csrf-protection' !== id)) {
                            if (!connected.get(element)?.has(identifier)) {
                                waiting.push(`${element.localName}${element.id ? `#${element.id}` : ''}: ${identifier}`);
                            }
                        }
                    }
                    return waiting;
                }),
            { message: 'controllers named in data-controller and not connected' },
        )
        .toEqual([]);
}

/*
 * The one listener tracker, an init script installed once per document whoever asks first: it wraps
 * `addEventListener` and `removeEventListener` and keeps, per target and per `<type>[ capture]`, the listeners the
 * page's scripts add (Playwright's own, added by scripts without a URL, the specs' init scripts and evaluations, are
 * left out). Two views, each with the rules its reader always had, so no count changes:
 *
 * - `__listenerCounts()` (trackCounts, counts.ts): `document`, `window` and the elements still in the document (an
 *   element by its tag name). `{ once: true }` listeners are left out (one still waiting at the end of a step, a
 *   dialog's `transitionend`, is there or not depending on timing, and a count that gates must not be), and a listener
 *   added with an `AbortSignal` leaves when the signal aborts.
 * - `__globalListeners()` (trackGlobalListeners): `document` and `window` only, every explicit add minus every explicit
 *   remove: `{ once: true }` listeners and `AbortSignal` removals are not followed.
 */
function installListenerTracker() {
    const w = window as any;
    if (w.__listenerCounts) {
        return;
    }
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    type Registry = Map<EventTarget, Map<string, Set<unknown>>>;
    const live: Registry = new Map();
    const all: Registry = new Map();
    const keyOf = (type: string, options?: boolean | AddEventListenerOptions) =>
        `${type}${('boolean' === typeof options ? options : Boolean(options?.capture)) ? ' capture' : ''}`;
    const fromPage = () => /\bhttps?:\/\//.test(new Error().stack ?? '');
    const keep = (registry: Registry, target: EventTarget, key: string, listener: unknown) => {
        const keys = registry.get(target) ?? registry.set(target, new Map()).get(target)!;
        (keys.get(key) ?? keys.set(key, new Set()).get(key)!).add(listener);
    };
    const forget = (registry: Registry, target: EventTarget, key: string, listener: unknown) => registry.get(target)?.get(key)?.delete(listener);
    const isGlobal = (target: EventTarget) => target === document || target === window;

    EventTarget.prototype.addEventListener = function (type: string, listener: any, options?: any) {
        if (listener && fromPage()) {
            const key = keyOf(type, options);
            const object = options && 'object' === typeof options ? (options as AddEventListenerOptions) : undefined;
            if (isGlobal(this)) {
                keep(all, this, key, listener);
            }
            if (!object?.once) {
                keep(live, this, key, listener);
                object?.signal?.addEventListener('abort', () => forget(live, this, key, listener), { once: true });
            }
        }
        return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type: string, listener: any, options?: any) {
        const key = keyOf(type, options);
        forget(live, this, key, listener);
        if (isGlobal(this) && fromPage()) {
            forget(all, this, key, listener);
        }
        return remove.call(this, type, listener, options);
    };
    const count = (registry: Registry) => {
        const counts: Record<string, number> = {};
        for (const [target, keys] of registry) {
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
    w.__listenerCounts = () => count(live);
    w.__globalListeners = () => count(all);
}

/**
 * Installs the listener tracker (above) in every document of the page from now on: call it before the first `goto`.
 * trackGlobalListeners() and trackCounts() (counts.ts) read it; both may install it in one page.
 */
export async function trackListeners(page: Page): Promise<void> {
    await page.addInitScript(installListenerTracker);
}

/**
 * Counts the listeners the page's scripts put on `document` and `window`, by `<target> <type>` (`document click`,
 * `window resize capture`): those added minus those removed, from the start of each page (the tracker's global view).
 * Call it before the first `goto`, take a baseline once the page has done each kind of step once (Turbo adds some of
 * its listeners on the first click or submit), and compare after more Turbo visits, Streams or re-renders: a controller
 * that leaves a listener behind shows as a count above the baseline. `only` declares the scope: the keys the reader
 * returns, those of the component under test (lab.popover), so the comparison holds no other script's listeners and
 * needs no warm-up step for them. It counts explicit adds and removes only: not `{ once: true }` or `AbortSignal`
 * removals, element or media-query listeners, observers or timers.
 */
export async function trackGlobalListeners(page: Page, only?: readonly string[]): Promise<() => Promise<Record<string, number>>> {
    await trackListeners(page);

    return async () => {
        const counts = await page.evaluate(() => (window as any).__globalListeners() as Record<string, number>);

        return only ? Object.fromEntries(Object.entries(counts).filter(([name]) => only.includes(name))) : counts;
    };
}

/**
 * What changed between two readings of trackGlobalListeners(): each `<target> <type>` whose count differs, with the
 * difference (`{ 'document click capture': 1 }`: one more). `{}` when nothing changed.
 */
export function listenerChanges(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
    return Object.fromEntries(
        [...new Set([...Object.keys(before), ...Object.keys(after)])]
            .map((name) => [name, (after[name] ?? 0) - (before[name] ?? 0)] as const)
            .filter(([, change]) => 0 !== change),
    );
}

/**
 * What an axe scan fails on: `impact` `serious` counts serious and critical violations (the suite's gate for whole
 * pages), `all` every violation (a component's own markup, scoped with `include`); `include` and `exclude` are CSS
 * selectors of the part scanned.
 */
export type A11yPolicy = { impact: 'serious' | 'all'; include?: string; exclude?: string };

/**
 * Scans the page as it is now with axe and fails on the violations the policy counts, each as
 * `<rule> (<impact>): <targets>`. The spec drives the state first (opened, focused, invalid, themed) and keeps its own
 * expectations of it; this owns only the scan, the policy and the report. Not a conformance claim: axe finds what
 * automated rules can find.
 */
export async function expectA11y(page: Page, policy: A11yPolicy, label?: string): Promise<void> {
    // the state the spec drove, settled: a color transition it started (a tab's fill on selection) is finished, or axe
    // can read its colors half-way. Endless (a spinner) and paused animations (a hovered toast's timer) are not awaited
    await page.evaluate(() =>
        Promise.all(
            document
                .getAnimations()
                .filter((animation) => 'running' === animation.playState && Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity))
                .map((animation) => animation.finished.catch(() => undefined)),
        ),
    );
    let builder = new AxeBuilder({ page });
    if (policy.include) {
        builder = builder.include(policy.include);
    }
    if (policy.exclude) {
        builder = builder.exclude(policy.exclude);
    }
    const results = await builder.analyze();
    const counted = results.violations
        .filter((violation) => 'all' === policy.impact || 'serious' === violation.impact || 'critical' === violation.impact)
        .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
    const scope = [policy.include && `in ${policy.include}`, policy.exclude && `without ${policy.exclude}`].filter(Boolean).join(' ');
    expect(counted, [label, `${'all' === policy.impact ? 'any' : 'serious/critical'} axe violations`, scope].filter(Boolean).join(': ')).toEqual([]);
}
