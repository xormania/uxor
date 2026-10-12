import type { Locator, Page } from '@playwright/test';
import { expect, turboVisitDone } from './fixtures';

/*
 * The Turbo transitions of the lab scaffold (`demo/templates/lab/`), each waiting until Turbo has completed the
 * operation it starts: a visit, Back, Forward, a reload, and a step of a frame whose visits are promoted to history.
 *
 * A lab page names itself in its `data-testid="page"` heading (`Page one`, `Page two`), links the next page with
 * `Go to page two`, and may hold the `history-steps` frame (`lab/_history_steps.html.twig`): its `Next step` link
 * advances the frame, adds `?step=<n>` to the URL and shows the step in `data-testid="history-step"`.
 *
 * Every step arms a Turbo observer before acting (`observeTurbo`), waits for the completion that operation must newly
 * produce, then for what the page shows and for no visit to be running (`turboVisitDone`).
 */

/**
 * What a Turbo operation must complete with, observed from Turbo's own events:
 * - a Drive visit, Back or Forward (a restoration visit), a reload: a new `turbo:load` for `url`;
 * - a frame visit promoted to history (`data-turbo-action="advance"`, `Turbo.visit(url, { frame, action })`): a new
 *   `turbo:frame-load` of `frame`, then a new `turbo:load` for `url`, the page visit Turbo starts once the frame has
 *   rendered. The URL changes before the frame renders, and `<html aria-busy>` is absent until that page visit
 *   starts: neither tells the operation is over.
 *
 * `url` is a URL or a path, resolved against the page's URL when the observer is armed and compared without the
 * fragment, its query parameters in any order; a RegExp tested against the full URL; or a predicate. Without it any
 * URL matches.
 */
export type TurboCompletion = {
    url?: string | RegExp | ((url: URL) => boolean);
    frame?: string;
    /** Milliseconds, 10 seconds by default. */
    timeout?: number;
};

/** A Turbo event the observer recorded, numbered in the order the page dispatched them. */
type TurboEvent = { seq: number; type: string; url: string; location: string; frame?: string; newDocument?: boolean };

const DONE = 'completed';

/*
 * Records, in each document of the page, the Turbo events telling an operation's progress, numbered. Installed as an
 * init script (a document loaded later records from its start) and in the current document; runs once per document.
 * Its listeners come from Playwright's scripts, which trackGlobalListeners() leaves out.
 */
function installTurboRecorder() {
    const w = window as any;
    if (w.__turboEvents) {
        return;
    }
    const recorder = (w.__turboEvents = { doc: `${Date.now()}-${Math.random()}`, seq: 0, events: [] as unknown[] });
    const record = (type: string, url: string, frame?: string) => {
        recorder.events.push({ seq: ++recorder.seq, type, url, location: location.href, frame });
        if (recorder.events.length > 500) {
            recorder.events.shift();
        }
    };
    const types = ['turbo:visit', 'turbo:before-render', 'turbo:render', 'turbo:load', 'turbo:frame-render', 'turbo:frame-load', 'turbo:fetch-request-error', 'turbo:frame-missing'];
    for (const type of types) {
        document.addEventListener(
            type,
            (event: any) => {
                const target = event.target as Element | null;
                record(type, event.detail?.url ?? location.href, 'TURBO-FRAME' === target?.tagName ? target.id : undefined);
            },
            true,
        );
    }
    window.addEventListener('popstate', () => record('popstate', location.href), true);
}

const recorded = new WeakSet<Page>();

async function readTurboEvents(page: Page): Promise<{ doc: string; seq: number; events: TurboEvent[] } | null> {
    try {
        return await page.evaluate(() => {
            const recorder = (window as any).__turboEvents;
            return recorder ? { doc: recorder.doc, seq: recorder.seq, events: recorder.events } : null;
        });
    } catch {
        return null; // the document is being replaced: read again
    }
}

function urlMatcher(expected: TurboCompletion['url'], base: string): { test: (url: string) => boolean; describe: string } {
    if (undefined === expected) {
        return { test: () => true, describe: 'any URL' };
    }
    if (expected instanceof RegExp) {
        return { test: (url) => expected.test(url), describe: String(expected) };
    }
    if ('function' === typeof expected) {
        return { test: (url) => expected(new URL(url)), describe: `a URL for which ${expected.name || 'the predicate'} holds` };
    }
    const want = new URL(expected, base);
    // the decoded pairs, compared as pairs: an encoded `&` or `=` inside a value is not a boundary
    const params = (url: URL) => JSON.stringify([...url.searchParams].sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1)));
    return {
        test: (url) => {
            const actual = new URL(url);
            return actual.origin === want.origin && actual.pathname === want.pathname && params(actual) === params(want);
        },
        describe: want.href,
    };
}

/**
 * Arms an observer of the Turbo operation the next action starts; `done()` waits until that operation has newly
 * completed as `completion` says. Arm it before the action: an event of an earlier operation, the old URL or a
 * missing `aria-busy` cannot satisfy it, and an operation that completes before `done()` is called is not missed.
 * On timeout it fails with what it expected and every Turbo event recorded since it was armed.
 *
 * ```ts
 * const loaded = await observeTurbo(page, { frame: 'orders', url: '/lab/data-table-frame?page=2' });
 * await page.getByRole('link', { name: 'Page 2' }).click();
 * await loaded.done();
 * ```
 */
export async function observeTurbo(page: Page, completion: TurboCompletion = {}): Promise<{ done: () => Promise<void> }> {
    if (!recorded.has(page)) {
        recorded.add(page);
        await page.addInitScript(installTurboRecorder);
    }
    await page.evaluate(installTurboRecorder);
    const armed = await readTurboEvents(page);
    if (!armed) {
        throw new Error('observeTurbo: no Turbo event recorder in the page');
    }
    const url = urlMatcher(completion.url, page.url());
    const expected = completion.frame
        ? `a new turbo:frame-load of #${completion.frame}, then a new turbo:load for ${url.describe}`
        : `a new turbo:load for ${url.describe}`;

    // the events after the armed one: all of a document loaded since
    const since = (read: NonNullable<Awaited<ReturnType<typeof readTurboEvents>>>) =>
        read.doc === armed.doc ? read.events.filter(({ seq }) => seq > armed.seq) : read.events.map((event) => ({ ...event, newDocument: true }));
    const completed = (events: TurboEvent[]) => {
        const frameLoad = completion.frame ? events.findIndex((event) => 'turbo:frame-load' === event.type && event.frame === completion.frame) : -1;
        if (completion.frame && frameLoad < 0) {
            return false;
        }
        return events.slice(frameLoad + 1).some((event) => 'turbo:load' === event.type && url.test(event.url));
    };

    return {
        done: async () => {
            let events: TurboEvent[] = [];
            await expect
                .poll(
                    async () => {
                        const read = await readTurboEvents(page);
                        if (read) {
                            events = since(read);
                        }
                        if (completed(events)) {
                            return DONE;
                        }
                        const seen = events.map((event) => `${event.newDocument ? '(new document) ' : ''}${event.type} ${event.frame ? `#${event.frame} ` : ''}${event.url}`).join('\n  ') || '(none)';
                        return `waiting for ${expected}\nat ${page.url()}, Turbo events since the observer was armed:\n  ${seen}`;
                    },
                    { message: `Turbo operation did not complete: expected ${expected}`, timeout: completion.timeout ?? 10_000, intervals: [25, 50, 100, 250] },
                )
                .toBe(DONE);
        },
    };
}

/** Starts an operation with `action` and waits until it has completed as `completion` says (`observeTurbo`). */
export async function turboOperation(page: Page, completion: TurboCompletion, action: () => Promise<unknown>): Promise<void> {
    const observer = await observeTurbo(page, completion);
    await action();
    await observer.done();
}

/** A page of the scaffold by its heading (`'Page two'`), or a step of its `history-steps` frame (`{ step: 1 }`). */
export type Shown = string | { step: number };

const stepIs = (step: number) => Object.defineProperty((url: URL) => Number(url.searchParams.get('step') ?? 0) === step, 'name', { value: `step=${step}` });

/** The completion leading to `then`: a frame visit of `history-steps` promoted to history, or any page visit. */
function completionOf(then: Shown, { frame }: { frame: boolean }): TurboCompletion {
    if ('string' === typeof then) {
        return {};
    }
    return frame ? { frame: 'history-steps', url: stepIs(then.step) } : { url: stepIs(then.step) };
}

/**
 * Waits until the page shows `shown` and no Turbo visit is running. On its own it does not tell that the operation
 * which led there is over (an earlier page, a URL changed before the frame rendered): the driver's steps observe the
 * operation first; after any other action, use `turboOperation`.
 */
export async function shown(page: Page, shown: Shown): Promise<void> {
    if ('string' === typeof shown) {
        await expect(page.getByTestId('page')).toHaveText(shown);
    } else {
        await expect(page.getByTestId('history-step')).toHaveText(String(shown.step));
        await expect.poll(() => Number(new URL(page.url()).searchParams.get('step') ?? 0)).toBe(shown.step);
    }
    await turboVisitDone(page);
}

/**
 * Clicks a link, by its exact accessible name, a pattern or a locator, and waits for `then`: a page visit, or for a
 * step, the frame visit promoted to history.
 */
export async function visit(page: Page, link: string | RegExp | Locator, then: Shown): Promise<void> {
    const target = 'string' === typeof link || link instanceof RegExp ? page.getByRole('link', { name: link, exact: 'string' === typeof link }) : link;
    await turboOperation(page, completionOf(then, { frame: true }), () => target.click());
    await shown(page, then);
}

/** Goes Back, a restoration visit from Turbo's cached copy, and waits for `then`. */
export async function back(page: Page, then: Shown): Promise<void> {
    await turboOperation(page, completionOf(then, { frame: false }), () => page.goBack());
    await shown(page, then);
}

/** Goes Forward and waits for `then`. */
export async function forward(page: Page, then: Shown): Promise<void> {
    await turboOperation(page, completionOf(then, { frame: false }), () => page.goForward());
    await shown(page, then);
}

/** Reloads the page, a full load Turbo is not part of, and waits for `then` (the new document's first `turbo:load`). */
export async function reload(page: Page, then: Shown): Promise<void> {
    await turboOperation(page, completionOf(then, { frame: false }), () => page.reload());
    await shown(page, then);
}

/**
 * Holds each request of the page for `url`, a stylesheet the next page links and the page it leaves lacks, until Turbo
 * has copied the page it leaves into its cache: the order a slow stylesheet gives in production, on every run. Turbo
 * dispatches `turbo:before-cache`, copies the page on the next task, and renders the new page once its new stylesheets
 * have loaded; held, the stylesheet keeps the page it leaves on screen, its controllers connected, until the copy is
 * taken. A request of a document Turbo has not copied (its own load, a reload) goes on at once. Returns how many
 * requests went on only once Turbo had copied the page: 0 means the order was not forced.
 */
export async function holdUntilCopied(page: Page, url: string): Promise<() => number> {
    await page.addInitScript(() => {
        const copies = ((window as any).__turboCopies = { started: 0, done: 0 });
        document.addEventListener('turbo:before-cache', () => {
            copies.started++;
            // Turbo copies the page in a task it queues once this listener has returned: done two tasks from here
            setTimeout(() => setTimeout(() => copies.done++));
        });
    });
    let held = 0;
    await page.route(url, async (route) => {
        // during a document's load there is nothing to evaluate in yet, and no copy to wait for
        const copying = await page.evaluate(() => (window as any).__turboCopies?.started > 0).catch(() => false);
        if (copying) {
            await page.waitForFunction(() => {
                const copies = (window as any).__turboCopies;
                return copies.done === copies.started;
            });
            held++;
        }
        await route.fallback();
    });
    return () => held;
}

/** Visits page two from page one with `Go to page two`, then goes Back: the scaffold's most common round trip. */
export async function visitAndBack(page: Page, { link = 'Go to page two', there = 'Page two', here = 'Page one' } = {}): Promise<void> {
    await visit(page, link, there);
    await back(page, here);
}

/**
 * Starts a visit of the `history-steps` frame to `?step=<step>` from the page's code, as a debounced search or a poll
 * would, and waits for it: no click or focus change reaches what is open beside the frame. The visit is promoted to
 * history like the frame's own links.
 */
export async function stepFromCode(page: Page, step: number): Promise<void> {
    await turboOperation(page, completionOf({ step }, { frame: true }), () =>
        page.evaluate((step) => {
            const url = new URL(location.href);
            url.searchParams.set('step', String(step));
            (window as any).Turbo.visit(url.href, { frame: 'history-steps', action: 'advance' });
        }, step),
    );
    await shown(page, { step });
}

/**
 * Visits the frame `id` with a visit promoted to history (`Turbo.visit` with `frame` and `action: 'advance'`, as a link
 * with `data-turbo-action="advance"` does) from the page's code, so no click or focus change reaches what is open
 * beside it, and waits for the page visit Turbo starts once the frame has rendered. The lab's reloading frames show
 * their `?load=<n>` in `data-testid="frame-load"`: the visit goes to `url` (the page's URL by default) with the next
 * load. Turbo copies the page as the frame visit starts; Back from the new history entry shows that copy.
 */
export async function advanceFrame(page: Page, id: string, url: string = page.url()): Promise<void> {
    const frame = page.locator(`turbo-frame#${id}`);
    const load = Number(await frame.getByTestId('frame-load').textContent()) + 1;
    const target = new URL(url, page.url());
    target.searchParams.set('load', String(load));
    await turboOperation(page, { frame: id, url: target.href }, () =>
        page.evaluate(({ id, href }) => (window as any).Turbo.visit(href, { frame: id, action: 'advance' }), { id, href: target.href }),
    );
    await expect(frame.getByTestId('frame-load')).toHaveText(String(load));
    await expect(page).toHaveURL(target.href);
    await turboVisitDone(page);
}

/** What the first animation frame of one render showed: `visible` is null for a body replaced before any frame. */
export type FirstFrame = { render: number; url: string; visible: Record<string, boolean> | null };

/**
 * From now on, records for each page Turbo renders (a cached copy included) which of `selectors` match a visible
 * element at the first animation frame after the new body is in place: what the user first sees, once the page's
 * controllers have connected. That is the DOM at the first observed animation frame, not every frame the compositor
 * presents.
 *
 * Returns a reader: `firstFrames(count)` waits until `count` renders have been observed, and returns each one's
 * number (from 1, in render order), its URL (path and query) and `visible`, `{ [name]: visible }`. A render whose
 * body was replaced before its first frame comes with `visible: null`; the page visit that follows a frame visit
 * promoted to history renders no body and is not one. Fewer observations than `count` fail with every render recorded
 * so far and how far it got.
 */
export async function recordFirstFrames(page: Page, selectors: Record<string, string>): Promise<(count: number) => Promise<FirstFrame[]>> {
    await page.evaluate((selectors) => {
        type Record = { render: number; url: string; state: 'waiting' | 'observed' | 'replaced' | 'not shown'; frames: number; visible: { [name: string]: boolean } | null };
        const records: Record[] = ((window as any).__firstFrames = []);
        (window as any).__firstFramesNoRender = 0;
        document.addEventListener('turbo:before-render', (event: any) => {
            // the page visit of a frame visit promoted to history announces a render it does not do (Turbo 8)
            if (false === (window as any).Turbo?.session?.navigator?.currentVisit?.willRender) {
                (window as any).__firstFramesNoRender++;
                return;
            }
            const body = event.detail.newBody;
            const record: Record = { render: records.length + 1, url: '', state: 'waiting', frames: 0, visible: null };
            records.push(record);
            const observe = () => {
                record.frames++;
                if (document.body !== body) {
                    // not in place yet (a paused render), or another render replaced it before any frame
                    if (records[records.length - 1] !== record) {
                        record.state = 'replaced';
                    } else if (record.frames < 600) {
                        requestAnimationFrame(observe);
                    } else {
                        record.state = 'not shown';
                    }
                    return;
                }
                record.url = location.pathname + location.search;
                record.visible = Object.fromEntries(
                    Object.entries(selectors).map(([name, selector]) => [name, [...document.querySelectorAll(selector)].some((element) => element.checkVisibility())]),
                );
                record.state = 'observed';
            };
            requestAnimationFrame(observe);
        });
    }, selectors);

    return async (count) => {
        type Read = { render: number; url: string; state: string; frames: number; visible: Record<string, boolean> | null };
        let records: Read[] = [];
        const settled = (record: Read) => 'observed' === record.state || 'replaced' === record.state;
        await expect
            .poll(
                async () => {
                    let noRender: number;
                    [records, noRender] = await page.evaluate(() => [(window as any).__firstFrames, (window as any).__firstFramesNoRender]);
                    if (records.length >= count && records.every(settled)) {
                        return count;
                    }
                    const renders = records.length
                        ? records.map((record) => `render ${record.render} ${record.url || '(no URL yet)'}: ${record.state} after ${record.frames} frame(s)`).join('; ')
                        : 'no render since recording started';
                    return `${renders} (and ${noRender} page visit(s) of a promoted frame visit, which render nothing)`;
                },
                { message: `first-frame observations of ${count} render(s)`, timeout: 10_000 },
            )
            .toBe(count);

        return records.map(({ render, url, visible }) => ({ render, url, visible }));
    };
}

/**
 * Follows the link named `name` (exactly) from the keyboard: focused, then Enter. A pointer over a link makes Turbo
 * prefetch it, and a click would then reuse that request, or not, depending on timing. Only follows it: the caller
 * waits for what the visit must show (`turboOperation`).
 */
export async function follow(page: Page, name: string): Promise<void> {
    await page.getByRole('link', { name, exact: true }).focus();
    await page.keyboard.press('Enter');
}

/** One reload of the lab's reloading frame, as `reloadFrames` runs it, with what a spec does around it. */
export type FrameReload = {
    /** How many times, 3 by default: the first reload connects new controllers, the next ones replace them. */
    times?: number;
    /** The link reloading the frame, `Reload the frame` by default (a menu item inside a dropdown). */
    link?: (page: Page) => Locator;
    /** How the link is activated, a click by default. */
    activate?: (link: Locator) => Promise<unknown>;
    /** Runs before each reload, `load` being the load it starts (1 to `times`): opens what must be open meanwhile. */
    before?: (load: number) => Promise<unknown>;
    /** Runs once the frame shows `load`. */
    after?: (load: number) => Promise<unknown>;
};

/**
 * Reloads the lab's reloading frame `times` times from its own link: a frame visit not promoted to history, the URL
 * kept. Each lab `<recipe>-turbo` page holds one, showing its `?load=<n>` in `data-testid="frame-load"` (0 as the page
 * loads); each reload waits until the frame shows its load.
 */
export async function reloadFrames(page: Page, { times = 3, link = (page) => page.getByRole('link', { name: 'Reload the frame' }), activate = (link) => link.click(), before, after }: FrameReload = {}): Promise<void> {
    for (let load = 1; load <= times; load++) {
        await before?.(load);
        await activate(link(page));
        await expect(page.getByTestId('frame-load')).toHaveText(String(load));
        await after?.(load);
    }
}

/**
 * Sends the lab's Turbo Stream `action` from a `<recipe>-stream` page and waits until the region it rendered shows it
 * (`data-testid="stream-action"`). By default its button is clicked (`Replace the chart`, `Update the chart`); `from:
 * 'code'` submits the form with that button from the page's code instead, so no click or focus change reaches what is
 * open on the page (an open menu, a shown tooltip).
 */
export async function sendStream(page: Page, action: 'replace' | 'update', { from = 'click' }: { from?: 'click' | 'code' } = {}): Promise<void> {
    if ('code' === from) {
        await page.locator('form').evaluate((form: HTMLFormElement, value) => form.requestSubmit(form.querySelector<HTMLButtonElement>(`button[value="${value}"]`)), action);
    } else {
        await page.getByRole('button', { name: new RegExp(`^${action[0].toUpperCase()}${action.slice(1)} the `) }).click();
    }
    await expect(page.getByTestId('stream-action')).toHaveText(action);
}
