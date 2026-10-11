import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { trackCounts } from './counts';
import { turboOperation } from './transitions';

/*
 * Tier 2 of docs/PLAN-test-tiers.md, the gates on what each key interaction costs: the requests it makes, by kind, the
 * Stimulus controllers it connects and disconnects (a controller connected twice shows there), the event listeners it
 * adds and removes (an open overlay's, none left once it closes), and the bytes of its responses under a budget. Each
 * test runs its steps once uncounted (warmUp), then counts them; the numbers are the same on every run of the same
 * build (docs/TESTING.md, *Interaction counts*, says how to read and update them).
 *
 * Links are followed from the keyboard: a pointer over a link makes Turbo prefetch it, and the click would then reuse
 * that request, or not, depending on timing.
 */

const follow = async (page: Page, name: string) => {
    await page.getByRole('link', { name, exact: true }).focus();
    await page.keyboard.press('Enter');
};
const tableStatus = (page: Page) => page.getByRole('status').filter({ hasText: /Showing|No rows/ });

// what an open dropdown or date picker (a popover) adds to the document and the window, and closing it removes: the
// outside click, and repositioning on scroll and resize (dropdown_controller.js, popover_controller.js)
const FLOATING_OPEN = { 'document click capture': 1, 'window resize': 1, 'window scroll capture': 1 };
const FLOATING_CLOSED = { 'document click capture': -1, 'window resize': -1, 'window scroll capture': -1 };
const NOTHING = { requests: {}, connected: {}, disconnected: {}, listeners: {}, maxBytes: 0 };

for (const { recipe, name, role, open, close } of [
    { recipe: 'dropdown', name: 'Actions', role: 'menu', open: FLOATING_OPEN, close: FLOATING_CLOSED },
    // a native <dialog>: the browser handles the outside, Escape and the top layer
    { recipe: 'modal', name: 'Details', role: 'dialog', open: {}, close: {} },
    { recipe: 'drawer', name: 'Details', role: 'dialog', open: {}, close: {} },
] as const) {
    test(`${recipe}: opening and closing make no request and leave no listener`, async ({ page }) => {
        const counts = await trackCounts(page);
        await page.goto(`/lab/${recipe}-turbo`);
        const panel = page.getByRole(role, { name });
        const openIt = async () => {
            await page.getByRole('button', { name, exact: true }).click();
            await expect(panel).toBeVisible();
        };
        const closeIt = async () => {
            await page.keyboard.press('Escape');
            await expect(panel).toBeHidden();
        };
        await counts.warmUp(openIt, closeIt);

        await counts.expect(`${recipe} open`, openIt, { ...NOTHING, listeners: open });
        await counts.expect(`${recipe} close`, closeIt, { ...NOTHING, listeners: close });
    });
}

test('data-table in a Turbo Frame: sort, page and filter each make one frame request', async ({ page }) => {
    const counts = await trackCounts(page);
    await page.goto('/lab/data-table-frame');
    // each a frame visit promoted to history: the frame's request, then the page visit, which requests nothing
    const sort = (dir: 'ascending' | 'descending') => async () => {
        await turboOperation(page, { frame: 'orders' }, () => follow(page, 'Customer'));
        await expect(page.getByRole('columnheader', { name: 'Customer' })).toHaveAttribute('aria-sort', dir);
    };
    const toPage = (number: number, status: string) => async () => {
        await turboOperation(page, { frame: 'orders' }, () => follow(page, `Page ${number}`));
        await expect(tableStatus(page)).toHaveText(status);
    };
    const filter = (value: string, status: string) => async () => {
        await turboOperation(page, { frame: 'orders' }, async () => {
            await page.getByLabel('Status').selectOption(value);
            await page.getByRole('button', { name: 'Apply' }).click();
        });
        await expect(tableStatus(page)).toHaveText(status);
    };
    await counts.warmUp(sort('ascending'), toPage(2, 'Showing 11–20 of 57'), filter('paid', 'Showing 1–10 of 19'));

    const oneFetch = { requests: { fetch: 1 }, connected: {}, disconnected: {}, listeners: {} };
    await counts.expect('data-table sort', sort('descending'), { ...oneFetch, maxBytes: 39_000 });
    await counts.expect('data-table page', toPage(2, 'Showing 11–19 of 19'), { ...oneFetch, maxBytes: 38_000 });
    await counts.expect('data-table filter', filter('pending', 'Showing 1–10 of 19'), { ...oneFetch, maxBytes: 39_000 });
});

test('data-table-live: sort, page and filter each make one Live request', async ({ page }) => {
    const counts = await trackCounts(page);
    await page.goto('/lab/data-table-live');
    const sort = (dir: 'ascending' | 'descending') => async () => {
        await page.getByRole('button', { name: 'Customer' }).click();
        await expect(page.getByRole('columnheader', { name: 'Customer' })).toHaveAttribute('aria-sort', dir);
    };
    // its page links are Live actions (`href="#"`), which Turbo does not prefetch
    const toPage = (number: number, status: string) => async () => {
        await page.getByRole('link', { name: `Page ${number}`, exact: true }).click();
        await expect(tableStatus(page)).toHaveText(status);
    };
    const filter = (value: string, status: string) => async () => {
        await page.getByLabel('Status').selectOption(value);
        await expect(tableStatus(page)).toHaveText(status);
    };
    await counts.warmUp(sort('ascending'), toPage(2, 'Showing 11–20 of 57'), filter('paid', 'Showing 1–10 of 19'));

    const oneFetch = { requests: { fetch: 1 }, connected: {}, disconnected: {}, listeners: {} };
    await counts.expect('data-table-live sort', sort('descending'), { ...oneFetch, maxBytes: 21_000 });
    await counts.expect('data-table-live page', toPage(2, 'Showing 11–19 of 19'), { ...oneFetch, maxBytes: 20_000 });
    await counts.expect('data-table-live filter', filter('pending', 'Showing 1–10 of 19'), { ...oneFetch, maxBytes: 21_000 });
});

test('a Live action re-sorting rows makes one request and reconnects each row\'s dropdown and tooltip once', async ({ page }) => {
    const counts = await trackCounts(page);
    await page.goto('/lab/live-table');
    const rows = page.getByTestId('row');
    const sortByStock = (first: string) => async () => {
        await page.getByRole('button', { name: /^Stock/ }).click();
        await expect(rows.first()).toHaveAttribute('data-row', first);
    };
    await counts.warmUp(sortByStock('banana'), sortByStock('cherry'));

    // the rows move: Stimulus disconnects and connects the controllers of each moved element, the same instances
    const resorted = { requests: { fetch: 1 }, connected: { dropdown: 4, tooltip: 4 }, disconnected: { dropdown: 4, tooltip: 4 }, listeners: {} };
    await counts.expect('live-table sort', sortByStock('banana'), { ...resorted, maxBytes: 12_000 });
});

test('date-picker: opening and picking a date make no request and leave no listener', async ({ page }) => {
    const counts = await trackCounts(page);
    await page.goto('/lab/date-picker-turbo');
    const dialog = page.getByRole('dialog', { name: 'Choose a date' });
    const openIt = async () => {
        await page.getByRole('button', { name: 'Due date: choose date' }).click();
        await expect(dialog).toBeVisible();
    };
    const pick = (date: string) => async () => {
        await dialog.locator(`[data-slot="calendar-day"][data-day="${date}"] button`).click();
        await expect(dialog).toBeHidden();
        await expect(page.locator('input[name="due"]')).toHaveValue(date);
    };
    await counts.warmUp(openIt, pick('2026-03-12'));

    await counts.expect('date-picker open', openIt, { ...NOTHING, listeners: FLOATING_OPEN });
    await counts.expect('date-picker pick', pick('2026-03-13'), { ...NOTHING, listeners: FLOATING_CLOSED });
});

test('editor: typing makes no request, connects nothing and adds no listener', async ({ page }) => {
    const counts = await trackCounts(page);
    await page.goto('/lab/editor-turbo');
    await expect(page.locator('[data-editor-target="preview"]')).toHaveCount(0); // every editor mounted
    const field = page.locator('textarea[name="editor_demo[body]"]');
    await page.getByRole('textbox', { name: 'Body' }).click();
    const type = (text: string) => async () => {
        await page.keyboard.type(text);
        await expect(field).toHaveValue(new RegExp(`${text}</p>$`));
    };
    await counts.warmUp(type('Hello'));

    await counts.expect('editor typing', type(' world'), NOTHING);
});

test('measure: a step\'s duration runs to the frame presented after its update, an expensive frame included', async ({ page }) => {
    const counts = await trackCounts(page);
    await page.goto('/lab/turbo-nav/one');
    // the update lands in the action itself (the action's own completion); a frame after it costs 300 ms of script
    const { durationMs } = await counts.measure(async () => {
        await page.evaluate(() => {
            const note = Object.assign(document.createElement('p'), { textContent: 'updated' });
            note.dataset.testid = 'measure-update';
            document.body.append(note);
            // the next frame is cheap, the one after costs 300 ms: the step is observed complete before it
            requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                    const end = performance.now() + 300;
                    while (performance.now() < end) {
                        // a frame's expensive work
                    }
                }),
            );
        });
    });
    await expect(page.getByTestId('measure-update')).toBeVisible();
    expect(durationMs, 'the duration includes the frame that presents the update').toBeGreaterThanOrEqual(300);
});
