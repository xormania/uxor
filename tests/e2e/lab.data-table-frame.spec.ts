import type { Page } from '@playwright/test';
import { test, expect, turboVisitDone, markDocument } from './fixtures';
import { tableParams, tableStatus } from './data-table';
import { turboOperation } from './transitions';

const firstOrder = (page: Page) => page.getByTestId('order-number').first();

type TableState = { params: Record<string, string>; status: string; current?: number };
const tableUrl = (state: TableState) => `/lab/data-table-frame${Object.keys(state.params).length ? `?${new URLSearchParams(state.params)}` : ''}`;

/** The URL, the rows and every control of the table show `state`: the search, filter and page size fields, the sort. */
async function expectTable(page: Page, { params: expected, status: text, current }: TableState) {
    expect(tableParams(page)).toEqual(expected);
    await expect(tableStatus(page)).toHaveText(text);
    // Turbo's copy of the page keeps the text typed before the search was submitted; the data-table controller
    // resets restored fields, so Back to the page before the search shows no search
    await expect(page.getByLabel('Search', { exact: true }), 'the search field shows the URL\'s search').toHaveValue(expected.q ?? '');
    await expect(page.getByLabel('Status')).toHaveValue(expected['f[status]'] ?? '');
    await expect(page.getByLabel('Rows per page'), 'rows per page shows the URL\'s page size').toHaveValue(expected.size ?? '10');
    // sorted by customer, or by default by order number, descending
    const [sorted, other] = 'customer' === expected.sort ? ['Customer', 'Order'] : ['Order', 'Customer'];
    await expect(page.getByRole('columnheader', { name: sorted })).toHaveAttribute('aria-sort', 'asc' === expected.dir ? 'ascending' : 'descending');
    await expect(page.getByRole('columnheader', { name: other })).not.toHaveAttribute('aria-sort');
    if (undefined !== current) {
        await expect(page.getByRole('link', { name: `Page ${current}` })).toHaveAttribute('aria-current', 'page');
    }
}

test('search, filter, sort, page and page size each add a history entry that Back and Forward walk through', async ({ page }) => {
    const initial: TableState = { params: {}, status: 'Showing 1–10 of 57', current: 1 };
    const sorted: TableState = { params: { sort: 'customer', dir: 'asc' }, status: 'Showing 1–10 of 57', current: 1 };
    const paged: TableState = { params: { sort: 'customer', dir: 'asc', page: '2' }, status: 'Showing 11–20 of 57', current: 2 };
    // the search form submits its filters and page size, and goes back to the first page, keeping the sort
    const searched: TableState = { params: { q: 'bonnie', sort: 'customer', dir: 'asc', 'f[status]': '', size: '10' }, status: 'Showing 1–7 of 7' };
    const filtered: TableState = { params: { ...searched.params, 'f[status]': 'paid' }, status: 'Showing 1–2 of 2' };
    const resized: TableState = { params: { ...filtered.params, size: '25' }, status: 'Showing 1–2 of 2' };

    await page.goto('/lab/data-table-frame');
    const sameDocument = await markDocument(page);
    await expectTable(page, initial);
    await expect(firstOrder(page)).toHaveText('#1057');

    // each change is a frame visit promoted to history: wait for the frame to load, then for the page visit Turbo
    // starts after it (the URL changes before the frame renders), then check the state
    const promoted = async (state: TableState, action: () => Promise<unknown>) => {
        await turboOperation(page, { frame: 'orders', url: tableUrl(state) }, action);
        await expectTable(page, state);
    };
    await promoted(sorted, () => page.getByRole('link', { name: 'Customer' }).click());
    await promoted(paged, () => page.getByRole('link', { name: 'Page 2' }).click());
    await promoted(searched, async () => {
        await page.getByLabel('Search', { exact: true }).fill('bonnie');
        await page.getByLabel('Search', { exact: true }).press('Enter');
    });
    await promoted(filtered, async () => {
        await page.getByLabel('Status').selectOption('paid');
        await page.getByRole('button', { name: 'Apply' }).click();
    });
    await promoted(resized, async () => {
        await page.getByLabel('Rows per page').selectOption('25');
        await page.getByRole('button', { name: 'Apply' }).click();
    });

    // Back walks every state, in the same document, and Forward again: each a restoration visit to wait for before
    // the next one (going Back again before it is over cancels its work); every control then shows the URL's state,
    // not the value the user had edited when Turbo copied the page
    const restored = async (state: TableState, action: () => Promise<unknown>) => {
        await turboOperation(page, { url: tableUrl(state) }, action);
        await turboVisitDone(page);
        await expectTable(page, state);
    };
    await restored(filtered, () => page.goBack());
    await restored(searched, () => page.goBack());
    await restored(paged, () => page.goBack());
    await restored(sorted, () => page.goBack());
    await restored(initial, () => page.goBack());
    await expect(firstOrder(page)).toHaveText('#1057');
    await restored(sorted, () => page.goForward());
    await restored(paged, () => page.goForward());

    await sameDocument.expectKept();
});

// what the server renders for a URL the table does not accept, a page number too large for an offset and a search
// matching nothing: DataTableRequestsTest (PHPUnit); lab.data-table-live keeps the journey using such a page

test('rows have stable ids and render the page cell blocks', async ({ page }) => {
    await page.goto('/lab/data-table-frame?sort=total&dir=asc');
    const row = page.locator('#orders-row-13');
    await expect(row.getByTestId('order-number')).toHaveText('#1013');
    await page.getByRole('link', { name: 'Total' }).click();
    await expect(page).toHaveURL(/sort=total&dir=desc/);
    await expect(page.locator('tbody tr').first()).not.toHaveId('orders-row-13');
});

test('Turbo visits away and back keep a single working table', async ({ page }) => {
    await page.goto('/lab/data-table-frame');
    for (let visit = 0; visit < 3; visit++) {
        await page.getByRole('link', { name: 'Leave the table' }).click();
        await expect(page).toHaveURL(/\/lab\/turbo-nav\/two$/);
        await turboVisitDone(page);
        await page.goBack();
        await expect(page).toHaveURL(/\/lab\/data-table-frame/);
        await turboVisitDone(page);
    }
    await expect(page.locator('turbo-frame#orders')).toHaveCount(1);
    await expect(page.getByRole('table')).toHaveCount(1);
    await page.getByRole('link', { name: 'Page 3' }).click();
    await expect(tableStatus(page)).toHaveText('Showing 21–30 of 57');
});
