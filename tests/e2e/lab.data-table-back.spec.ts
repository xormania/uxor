import type { Page } from '@playwright/test';
import { test, expect, turboVisitDone } from './fixtures';
import { tableParams, tableStatus } from './data-table';

/*
 * Back and Forward show the state of the URL they land on, in every control of the table's form: never an edit the
 * user made before leaving. Turbo's copies keep edited fields (PageSnapshot.clone: cloneNode keeps an input's value,
 * and each select's choice is copied over). A frame visit promoted to history takes its copy once the form is
 * submitted, edits made, and swaps in a plain cloneNode of the frame (selects back to their `selected` attribute,
 * inputs still edited): without the data-table controller's reset, Back showed the next search at the earlier URL.
 */

const TABLE = '/lab/data-table-frame';

type State = { search: string; status: string; size: string };
const DEFAULTS: State = { search: '', status: '', size: '10' };

const search = (page: Page) => page.getByLabel('Search', { exact: true });
const statusFilter = (page: Page) => page.getByLabel('Status');
const size = (page: Page) => page.getByLabel('Rows per page');

/** Records every turbo:load and turbo:frame-load from now on, with the URL at that moment; `mark` says where to wait from. */
async function recordTurboEvents(page: Page): Promise<void> {
    await page.evaluate(() => {
        const events: { type: string; target: string; url: string }[] = ((window as any).__turboEvents = []);
        for (const type of ['turbo:load', 'turbo:frame-load']) {
            document.addEventListener(type, (event) => events.push({ type, target: (event.target as Element).id ?? '', url: location.href }));
        }
    });
}
const mark = (page: Page): Promise<number> => page.evaluate(() => (window as any).__turboEvents.length);
const eventsSince = (page: Page, since: number): Promise<{ type: string; target: string; url: string }[]> =>
    page.evaluate((since) => (window as any).__turboEvents.slice(since), since);
const sameParams = (url: string, expected: Record<string, string>) =>
    JSON.stringify(Object.fromEntries([...new URL(url).searchParams].sort())) === JSON.stringify(Object.fromEntries(Object.entries(expected).sort()));

/** Waits, from `since`, for the table's frame to load and then for the page visit that lands on `expected` params. */
async function frameVisitDone(page: Page, since: number, expected: Record<string, string>): Promise<void> {
    await expect
        .poll(async () => {
            const events = await eventsSince(page, since);
            const frame = events.findIndex((event) => 'turbo:frame-load' === event.type && 'orders' === event.target);
            return frame >= 0 && events.slice(frame + 1).some((event) => 'turbo:load' === event.type && sameParams(event.url, expected));
        }, { message: `frame load then turbo:load at ${JSON.stringify(expected)}` })
        .toBe(true);
    await turboVisitDone(page);
}

/** Waits, from `since`, for the page visit (a restoration on Back or Forward) that lands on `expected` params. */
async function pageVisitDone(page: Page, since: number, expected: Record<string, string>): Promise<void> {
    await expect
        .poll(async () => (await eventsSince(page, since)).some((event) => 'turbo:load' === event.type && sameParams(event.url, expected)), {
            message: `turbo:load at ${JSON.stringify(expected)}`,
        })
        .toBe(true);
    await turboVisitDone(page);
}

/**
 * From now on, records the form's values at the first animation frame of each page Turbo renders, a cached copy
 * included: what the user first sees, before any later fix.
 */
async function recordFirstFrameValues(page: Page): Promise<() => Promise<State[]>> {
    await page.evaluate(() => {
        const records: State[] = ((window as any).__firstFrameValues = []);
        document.addEventListener('turbo:before-render', (event: any) => {
            const body = event.detail.newBody;
            let frames = 0;
            const record = () => {
                // a frame visit promoted to history renders no body
                if (document.body !== body) {
                    return ++frames < 60 && requestAnimationFrame(record);
                }
                const value = (selector: string) => (document.querySelector(selector) as HTMLInputElement | HTMLSelectElement).value;
                records.push({ search: value('#orders-search'), status: value('#orders-filter-status'), size: value('#orders-size') });
            };
            requestAnimationFrame(record);
        });
    });

    return () => page.evaluate(() => (window as any).__firstFrameValues as State[]);
}

/** Every control of the form, the rows shown and the sort, against what the URL says. */
async function expectState(page: Page, state: State, rows: string | RegExp, rowCount: number): Promise<void> {
    // soft: a failure names every control that does not match
    await expect.soft(search(page), 'Search').toHaveValue(state.search);
    await expect.soft(statusFilter(page), 'Status').toHaveValue(state.status);
    await expect.soft(size(page), 'Rows per page').toHaveValue(state.size);
    await expect(tableStatus(page)).toHaveText(rows);
    await expect(page.locator('#orders tbody tr')).toHaveCount(rowCount);
    await expect(page.getByRole('columnheader', { name: 'Order' })).toHaveAttribute('aria-sort', 'descending');
}

const EDITS: { control: string; edit: (page: Page) => Promise<unknown>; state: State }[] = [
    { control: 'Rows per page', edit: (page) => size(page).selectOption('25'), state: { ...DEFAULTS, size: '25' } },
    { control: 'Status', edit: (page) => statusFilter(page).selectOption('paid'), state: { ...DEFAULTS, status: 'paid' } },
    { control: 'Search', edit: (page) => search(page).fill('bonnie'), state: { ...DEFAULTS, search: 'bonnie' } },
];

// the form's hidden fields carry the sort
const urlParams = (state: State) => ({ sort: 'number', dir: 'desc', q: state.search, 'f[status]': state.status, size: state.size });

for (const { control, edit, state } of EDITS) {
    test(`Back after applying ${control} shows the earlier URL's value in every control, and Forward the applied one`, async ({ page }) => {
        await page.goto(TABLE);
        await recordTurboEvents(page);
        await expectState(page, DEFAULTS, 'Showing 1–10 of 57', 10);
        const firstFrames = await recordFirstFrameValues(page);

        await edit(page);
        let since = await mark(page);
        await page.getByRole('button', { name: 'Apply' }).click();
        await frameVisitDone(page, since, urlParams(state));
        await expect(search(page)).toHaveValue(state.search);
        await expect(statusFilter(page)).toHaveValue(state.status);
        await expect(size(page)).toHaveValue(state.size);
        const appliedRows = await tableStatus(page).textContent();
        const appliedCount = await page.locator('#orders tbody tr').count();

        since = await mark(page);
        await page.goBack();
        await pageVisitDone(page, since, {});
        expect(tableParams(page)).toEqual({});
        await expectState(page, DEFAULTS, 'Showing 1–10 of 57', 10);
        // the restored copy showed the earlier values from its first frame
        expect(await firstFrames()).toEqual([DEFAULTS]);

        since = await mark(page);
        await page.goForward();
        await pageVisitDone(page, since, urlParams(state));
        await expectState(page, state, appliedRows ?? '', appliedCount);
    });
}

test('Back after applying every control at once, twice, shows each URL\'s values', async ({ page }) => {
    await page.goto(TABLE);
    await recordTurboEvents(page);

    const first: State = { search: 'bo', status: '', size: '25' };
    await search(page).fill(first.search);
    await size(page).selectOption(first.size);
    let since = await mark(page);
    await page.getByRole('button', { name: 'Apply' }).click();
    await frameVisitDone(page, since, urlParams(first));
    const firstRows = await tableStatus(page).textContent();
    const firstCount = await page.locator('#orders tbody tr').count();

    const second: State = { search: 'bonnie', status: 'paid', size: '10' };
    await search(page).fill(second.search);
    await statusFilter(page).selectOption(second.status);
    await size(page).selectOption(second.size);
    since = await mark(page);
    await page.getByRole('button', { name: 'Apply' }).click();
    await frameVisitDone(page, since, urlParams(second));
    await expectState(page, second, 'Showing 1–2 of 2', 2);

    since = await mark(page);
    await page.goBack();
    await pageVisitDone(page, since, urlParams(first));
    await expectState(page, first, firstRows ?? '', firstCount);

    since = await mark(page);
    await page.goBack();
    await pageVisitDone(page, since, {});
    await expectState(page, DEFAULTS, 'Showing 1–10 of 57', 10);
});

test('a URL parameter named reset, kept as a hidden field, does not stop the form showing the URL\'s state on Back', async ({ page }) => {
    // the kept field shadows the form's reset() method as a named property
    await page.goto(`${TABLE}?reset=1`);
    await expect(page.locator('#orders form input[type=hidden][name=reset]')).toHaveCount(1);
    await recordTurboEvents(page);
    await search(page).fill('bonnie');
    await size(page).selectOption('50');

    await page.getByRole('link', { name: 'Leave the table' }).click();
    await expect(page).toHaveURL(/\/lab\/turbo-nav\/two$/);
    await turboVisitDone(page);

    const since = await mark(page);
    await page.goBack();
    await pageVisitDone(page, since, { reset: '1' });
    await expectState(page, DEFAULTS, 'Showing 1–10 of 57', 10);
});

/** The live table's controls against its URL, which holds only the values that differ from the defaults. */
async function expectControlsMatchUrl(page: Page): Promise<void> {
    const url = tableParams(page);
    await expect.soft(search(page), 'Search').toHaveValue(url.q ?? '');
    await expect.soft(statusFilter(page), 'Status').toHaveValue(url['f[status]'] ?? '');
    await expect.soft(size(page), 'Rows per page').toHaveValue(url.size ?? '10');
}

test('data-table-live: Back to the table shows the URL\'s state in every control, not a search typed before leaving', async ({ page }) => {
    // opened at its URL, so Turbo caches its copy under the URL Back returns to, and Back shows that copy
    await page.goto('/lab/data-table-live?size=25&f%5Bstatus%5D=paid');
    await expect(statusFilter(page)).toHaveValue('paid');
    const paidRows = await tableStatus(page).textContent();
    // a search typed and not sent yet when the page is left: set without an input event, so the live controller never
    // sends it (typing would, 300 ms later, racing the visit away)
    await search(page).evaluate((input: HTMLInputElement) => (input.value = 'bonnie'));
    await page.getByRole('link', { name: 'Leave the table' }).click();
    await expect(page).toHaveURL(/\/lab\/turbo-nav\/two$/);
    await turboVisitDone(page);

    const requests: string[] = [];
    page.on('request', (request) => request.url().includes('/lab/data-table-live') && requests.push(request.url()));
    await page.goBack();
    await expect(page).toHaveURL(/\/lab\/data-table-live\?/);
    await turboVisitDone(page);
    expect(requests, 'Back showed the cached copy').toEqual([]);
    expect(tableParams(page)).toEqual({ size: '25', 'f[status]': 'paid' });
    await expectControlsMatchUrl(page);
    await expect(tableStatus(page)).toHaveText(paidRows ?? '');
});
