import type { Page, Request, Route } from '@playwright/test';
import { test, expect, markDocument, type SameDocument } from './fixtures';
import { follow } from './transitions';

/*
 * Back pressed while a change of the data table is still on its way: the table's frame visit is promoted to history
 * (`<turbo-frame data-turbo-action="advance">`), and Turbo 8.0.23 runs it in phases (docs/TESTING.md, *Back during a
 * frame visit promoted to history*):
 *
 *   1. the request is out, no response yet: nothing changed but the control the user set;
 *   2. the response is in and history changed (pushState), the frame not rendered yet;
 *   3. the frame rendered, the page visit that completes the promotion (`turbo:load`) not over yet.
 *
 * Each test holds one phase deterministically, presses Back there, releases it, and waits until Turbo is quiet. The
 * guarantee is consistency, not that the change survives: the URL, the rows, the status line and every control agree
 * (the same as a fresh load of that URL), also after Forward and Back over the entries left, and the table still takes
 * the next change. Losing the change is fine; new rows at the old URL, or an old URL with a control showing the new
 * value, are not.
 */

const FRAME = 'orders';

/*
 * Each Turbo 8.0.23 defect these tests found is worked around by the data-table controller (docs/NOTES.md), and the
 * comment in the test names it. Also without an interruption, the copy of the page Back restores keeps the text typed
 * in the search field: the promotion caches the page as it was when the frame visit started, the user's edit
 * included, then puts back the frame's old content from FrameController#willRenderFrame (`cloneNode(true)` of the
 * frame just before it renders: it carries an input's value, not a select's selection). The controller resets the
 * form as it connects.
 */
const PATH = '/lab/data-table-frame';

type Change = { name: string; param: [string, string]; apply: (page: Page) => Promise<void> };

const changes: Change[] = [
    {
        name: 'page size',
        param: ['size', '25'],
        apply: async (page) => {
            await page.getByLabel('Rows per page').selectOption('25');
            await page.getByRole('button', { name: 'Apply' }).click();
        },
    },
    {
        name: 'search',
        param: ['q', 'bonnie'],
        apply: async (page) => {
            await page.getByLabel('Search', { exact: true }).fill('bonnie');
            await page.getByLabel('Search', { exact: true }).press('Enter');
        },
    },
    {
        name: 'filter',
        param: ['f[status]', 'paid'],
        apply: async (page) => {
            await page.getByLabel('Status').selectOption('paid');
            await page.getByRole('button', { name: 'Apply' }).click();
        },
    },
    {
        // from the keyboard: a pointer over a link makes Turbo prefetch it, and the click would then reuse that request
        name: 'page link',
        param: ['page', '3'],
        apply: (page) => follow(page, 'Page 3'),
    },
];

/*
 * Records, in order, Turbo's events, the history changes and popstate in `window.__log`, and holds a phase when asked:
 * `__hold = 'frame-render'` cancels the next `turbo:before-frame-render` (phase 2), `__hold = 'promotion'` the next
 * `turbo:before-render` of the visit that promotes a frame visit, the one that renders nothing (phase 3); both keep
 * `event.detail.resume` in `__resume`, Turbo's supported way to pause a render.
 */
async function instrument(page: Page) {
    await page.addInitScript(() => {
        const w = window as any;
        w.__log = [];
        w.__hold = null;
        w.__resume = null;
        const log = (entry: string) => w.__log.push(entry);
        for (const method of ['pushState', 'replaceState'] as const) {
            const original = history[method];
            history[method] = function (state: unknown, unused: string, url?: string | URL | null) {
                log(`${method} ${url}`);
                return original.call(this, state, unused, url);
            };
        }
        addEventListener('popstate', () => log(`popstate ${location.href}`));
        const types = [
            'turbo:before-fetch-request', 'turbo:before-fetch-response', 'turbo:fetch-request-error', 'turbo:submit-end',
            'turbo:before-frame-render', 'turbo:frame-render', 'turbo:frame-load',
            'turbo:visit', 'turbo:before-cache', 'turbo:before-render', 'turbo:render', 'turbo:load',
        ];
        for (const type of types) {
            document.addEventListener(
                type,
                (event: any) => {
                    const target = event.target;
                    const where = target instanceof Element && target !== document.documentElement ? ` #${target.id}` : '';
                    log(`${type}${where} ${event.detail?.url ?? ''}`.trim());
                    if ('turbo:before-frame-render' === type && 'frame-render' === w.__hold) {
                        w.__hold = null;
                        event.preventDefault();
                        w.__resume = event.detail.resume;
                        log('held');
                    }
                    if ('turbo:before-render' === type && 'promotion' === w.__hold && false === w.Turbo?.session?.navigator?.currentVisit?.willRender) {
                        w.__hold = null;
                        event.preventDefault();
                        w.__resume = event.detail.resume;
                        log('held');
                    }
                },
                true,
            );
        }
    });
}

const log = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__log);

/** The demo's requests in flight, per page (start() tracks them). */
const inFlight = new WeakMap<Page, Set<Request>>();

function trackRequests(page: Page) {
    const pending = new Set<Request>();
    inFlight.set(page, pending);
    page.on('request', (request) => void pending.add(request));
    page.on('requestfinished', (request) => void pending.delete(request));
    page.on('requestfailed', (request) => void pending.delete(request));
}

/*
 * Waits until Turbo is quiet: no request of the page in flight (but `except`, a request held on purpose), then no new
 * event or history change for 20 animation frames in a row (Turbo's longest step, a frame render, spans three) and no
 * page visit running (`<html aria-busy>`, unless `busy`: Back waiting on a render held on purpose). Bounded: fails
 * with what was still going on after 10 s.
 *
 * Not a frame's `busy` attribute: Turbo 8.0.23's copy restored on Back keeps one for good unless the data-table
 * controller clears it (the busy test below).
 */
async function quiet(page: Page, { busy = false, except }: { busy?: boolean; except?: Request } = {}) {
    const deadline = Date.now() + 10_000;
    for (;;) {
        const requests = [...inFlight.get(page)!].filter((request) => request !== except);
        // a request pending for good must not outlast the deadline: the check below reports it
        await Promise.race([
            Promise.all(requests.map((request) => request.response().then((response) => response?.finished()).catch(() => null))),
            new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now()))),
        ]);
        const still = await page.evaluate(
            (busy) =>
                new Promise<string | null>((resolve) => {
                    const w = window as any;
                    let seen = -1;
                    let frames = 0;
                    let count = 0;
                    const tick = () => {
                        const visit = !busy && document.documentElement.hasAttribute('aria-busy');
                        count = w.__log.length === seen && !visit ? count + 1 : 0;
                        seen = w.__log.length;
                        if (count >= 20) {
                            resolve(null);
                        } else if (++frames > 120) {
                            resolve(`${visit ? 'a visit running; ' : ''}last events: ${w.__log.slice(-6).join(' | ')}`);
                        } else {
                            requestAnimationFrame(tick);
                        }
                    };
                    requestAnimationFrame(tick);
                }),
            busy,
        );
        const pending = [...inFlight.get(page)!].filter((request) => request !== except);
        if (null === still && 0 === pending.length) {
            return;
        }
        if (Date.now() > deadline) {
            expect({ still, pending: pending.map((request) => request.url()) }, 'Turbo quiet').toEqual({ still: null, pending: [] });
        }
    }
}

/** Runs `act`, then waits for this frame visit's promotion to end: the frame loaded, then `turbo:load` at the new URL. */
async function promoted(page: Page, act: () => Promise<void>, [key, value]: [string, string]) {
    const from = (await log(page)).length;
    await act();
    await expect
        .poll(async () => {
            const entries = (await log(page)).slice(from);
            const frameLoaded = entries.indexOf(`turbo:frame-load #${FRAME}`);
            return frameLoaded >= 0 && entries.slice(frameLoaded).some((entry) => entry.startsWith('turbo:load ') && new URL(entry.slice(11)).searchParams.get(key) === value);
        })
        .toBe(true);
    expect(new URL(page.url()).searchParams.get(key)).toBe(value);
}

/*
 * What the user sees of the table: the status line, the rows, the current page, the sorted column and every control
 * of the form, read from the page, and from a fresh load of the page's URL rendered by the server.
 */
async function consistency(page: Page) {
    return page.evaluate(async () => {
        const read = (root: ParentNode) => ({
            status: [...root.querySelectorAll('[role="status"]')].map((el) => el.textContent?.replace(/\s+/g, ' ').trim()).find((text) => /Showing|No rows/.test(text ?? '')),
            rows: [...root.querySelectorAll('[data-testid="order-number"]')].map((el) => el.textContent),
            currentPage: root.querySelector('[aria-current="page"]')?.textContent?.trim() ?? null,
            sorted: [...root.querySelectorAll('th[aria-sort]')].map((th) => `${th.textContent?.trim()} ${th.getAttribute('aria-sort')}`),
            controls: Object.fromEntries(
                [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#orders form [name]')].map((control) => [
                    control.name,
                    control instanceof HTMLSelectElement ? [...control.options].filter((option) => option.selected).map((option) => option.value).join() : control.value,
                ]),
            ),
        });
        const url = location.href;
        const fresh = new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/html');
        // a parsed document reports each select's `selected` attributes, the live one what the user sees
        return { url, shown: read(document), server: read(fresh) };
    });
}

async function expectConsistent(page: Page, url?: string) {
    const { url: actual, shown, server } = await consistency(page);
    expect(shown, `the table shown at ${actual} is the one the server renders for that URL`).toEqual(server);
    if (url) {
        expect(actual).toBe(url);
    }
}

/** The request of the frame visit (not a prefetch) to a URL whose `key` is `value`. */
const frameVisitRequest = (request: Request, [key, value]: [string, string]) =>
    'GET' === request.method() &&
    FRAME === request.headers()['turbo-frame'] &&
    undefined === request.headers()['x-sec-purpose'] &&
    new URL(request.url()).pathname === PATH &&
    new URL(request.url()).searchParams.get(key) === value;

/** Opens the table and moves to page 2 with a promoted frame visit: Back from the change has an entry to go to. */
async function start(page: Page): Promise<{ first: string; second: string; sameDocument: SameDocument }> {
    trackRequests(page);
    await instrument(page);
    await page.goto(PATH);
    const sameDocument = await markDocument(page);
    const first = page.url();
    await promoted(page, () => follow(page, 'Page 2'), ['page', '2']);
    await quiet(page);
    await expectConsistent(page);
    return { first, second: page.url(), sameDocument };
}

/*
 * After the interruption: Forward goes to `forward` (the entry after the one Back went to) and Back returns to
 * `back`, each consistent; then the table takes another change (rows per page 50), all in the document `start` marked.
 */
async function afterwards(page: Page, { back, forward, sameDocument }: { back: string; forward: string; sameDocument: SameDocument }) {
    await page.goForward();
    await quiet(page);
    await expectConsistent(page, forward);
    await page.goBack();
    await quiet(page);
    await expectConsistent(page, back);

    await promoted(
        page,
        async () => {
            await page.getByLabel('Rows per page').selectOption('50');
            await page.getByRole('button', { name: 'Apply' }).click();
        },
        ['size', '50'],
    );
    await quiet(page);
    await expectConsistent(page);
    await expect(page.getByLabel('Rows per page')).toHaveValue('50');
    await sameDocument.expectKept();
}

for (const change of changes) {
    test(`${change.name}: Back before the response arrives leaves the table, the URL and the controls of the entry Back went to`, async ({ page, allowCancelledRequest }) => {
        // Turbo 8.0.23: Back restores the page and disconnects the frame, which cancels a frame `src` load (a link)
        // but not the frame's FormSubmission (FrameController#disconnect cancels #currentFetchRequest only). The form's
        // response then still runs #loadFrameResponse on the detached frame: changeHistory() pushes the new URL over
        // the restored page, which keeps showing the old rows and controls, and the promotion caches the old page under
        // the restored URL (Back then shows page 2 at the first URL). The controller stops the submission on
        // turbo:before-cache, and when the frame disconnects.
        // A link: the cancelled src load is right, but the page left by Back is cached with the frame's pending `src`;
        // Forward restores it, the frame reconnects, loads that src and shows page 3 at the page 2 URL. The controller
        // removes a pending `src` on turbo:before-cache, which also cancels its request.
        const { first, second, sameDocument } = await start(page);

        let held: { route: Route; request: Request } | undefined;
        const arrived = new Promise<void>((resolve) =>
            page.route(
                (url) => url.pathname === PATH,
                (route, request) => {
                    if (held || !frameVisitRequest(request, change.param)) {
                        return route.fallback();
                    }
                    held = { route, request };
                    resolve();
                },
            ),
        );
        const from = (await log(page)).length;
        await change.apply(page);
        await arrived;
        // Back cancels this request (Turbo a link's, the data-table controller a form's): no other failure is accepted
        allowCancelledRequest({ url: held!.request.url(), method: 'GET', frame: FRAME, count: 1 });
        expect(page.url(), 'phase 1: history not changed yet').toBe(second);
        expect((await log(page)).slice(from), 'phase 1: no response yet').not.toContain(`turbo:before-fetch-response #${FRAME}`);

        await page.goBack();
        await quiet(page, { except: held!.request });
        await expectConsistent(page, first);

        const ended = Promise.race([held!.request.response().then((response) => response?.finished()), page.waitForEvent('requestfailed', (request) => request === held!.request)]);
        await held!.route.continue().catch(() => {}); // a cancelled request cannot be continued
        await ended;
        await quiet(page);
        // Back wins: the change is lost, the user is where Back took them
        await expectConsistent(page, first);
        await afterwards(page, { back: first, forward: second, sameDocument });
    });

    test(`${change.name}: Back after history changed, before the frame rendered, leaves a consistent table`, async ({ page }) => {
        // The state ends consistent (the restoration fetches the old URL; the frame renders off the page), but for a
        // link the frame's src request is still Turbo's current one: Back disconnects the frame, which aborts it
        // (FrameController#disconnect), and once the render resumes, the promotion reads the response body again
        // (proposeVisitIfNavigatedWithAction: `await fetchResponse.responseHTML`, a new clone() of the aborted
        // response). FetchRequest#receive does not await the delegate, so the AbortError is uncaught: a page error.
        // The controller removes the frame's `src` before (a load still pending on turbo:before-cache, and a frame that
        // left the document), and the promotion proposes no visit without one.
        const { second, sameDocument } = await start(page);
        await page.evaluate(() => ((window as any).__hold = 'frame-render'));
        const from = (await log(page)).length;
        await change.apply(page);
        await expect.poll(() => page.evaluate(() => typeof (window as any).__resume)).toBe('function');
        const changed = page.url();
        expect(new URL(changed).searchParams.get(change.param[0]), 'phase 2: history changed').toBe(change.param[1]);
        expect((await log(page)).slice(from), 'phase 2: the frame not rendered').not.toContain(`turbo:frame-render #${FRAME}`);

        await page.goBack();
        await quiet(page);
        await expectConsistent(page, second);

        await page.evaluate(() => (window as any).__resume());
        await quiet(page);
        await expectConsistent(page, second);
        // the change entered history before Back: Forward shows it
        await afterwards(page, { back: second, forward: changed, sameDocument });
    });

    test(`${change.name}: Back after the frame rendered, before the promotion's turbo:load, leaves a consistent table`, async ({ page }) => {
        // the copy Back restores was cached as the promotion started, before the hold: the same as the control below
        const { second, sameDocument } = await start(page);
        await page.evaluate(() => ((window as any).__hold = 'promotion'));
        const from = (await log(page)).length;
        await change.apply(page);
        await expect.poll(() => page.evaluate(() => typeof (window as any).__resume)).toBe('function');
        const changed = page.url();
        const entries = (await log(page)).slice(from);
        expect(entries, 'phase 3: the frame rendered').toContain(`turbo:frame-load #${FRAME}`);
        expect(entries.filter((entry) => entry.startsWith('turbo:load')), 'phase 3: the promotion not over').toEqual([]);

        // Back's restoration waits for the held render (Visit#loadCachedSnapshot awaits view.renderPromise)
        await page.goBack();
        await quiet(page, { busy: true });
        await page.evaluate(() => (window as any).__resume());
        await quiet(page);
        await expectConsistent(page, second);
        await afterwards(page, { back: second, forward: changed, sameDocument });
    });
}

for (const change of changes) {
    test(`control, ${change.name}: left to finish, then Back and Forward, each show a consistent table`, async ({ page }) => {
        const { second } = await start(page);
        await promoted(page, () => change.apply(page), change.param);
        const changed = page.url();
        await quiet(page);
        await expectConsistent(page, changed);
        await page.goBack();
        await quiet(page);
        await expectConsistent(page, second);
        await page.goForward();
        await quiet(page);
        await expectConsistent(page, changed);
    });
}

test('Back after a form change restores the table not marked busy', async ({ page }) => {
    // Turbo 8.0.23 marks the frame busy when its form submission starts (FrameController#formSubmissionStarted), takes
    // the copy of the page that Back restores when the response arrives (formSubmissionSucceededWithResponse →
    // proposeVisitIfNavigatedWithAction), and clears the mark only after (formSubmissionFinished): the copy keeps
    // `busy` and `aria-busy="true"`, and nothing clears them once restored. A link's copy is taken before its request.
    // The controller clears both as the frame connects with no load of its own pending.
    const { second } = await start(page);
    await promoted(page, () => changes[0].apply(page), changes[0].param);
    await quiet(page);
    await page.goBack();
    await quiet(page);
    await expectConsistent(page, second);
    const frame = page.locator(`turbo-frame#${FRAME}`);
    await expect(frame).not.toHaveAttribute('aria-busy');
    await expect(frame).not.toHaveAttribute('busy');
    await expect(page.locator(`#${FRAME} form`)).not.toHaveAttribute('aria-busy');
    await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled();
});
