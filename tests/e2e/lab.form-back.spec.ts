import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { back, turboOperation, visit } from './transitions';
import { day } from './calendar';

/*
 * What Back shows in a form (the `form-reset` controller of the layouts, on the demo's <body>) beyond the value matrix
 * (lab.value-matrix: each widget of a GET or a POST form changed, then Back): the month a date picker shows, text typed
 * before the page's scripts start, and Tom Select kept in step with the reset without an event.
 */

const rendered = '/lab/form-back/%s?name=Ada&fruit=apple&due=2026-03-10';

const autocomplete = {
    change: async (page: Page) => {
        const control = page.locator('.ts-wrapper').getByRole('combobox', { name: 'Fruit' });
        await control.locator('xpath=ancestor::div[contains(@class, "ts-control")]').click();
        await page.locator(`#${await control.getAttribute('aria-controls')}`).getByRole('option', { name: 'Banana', exact: true }).click();
        await control.press('Escape');
        await control.blur();
    },
    /** Expects the <select> and Tom Select's own display of the choice to show the rendered or the changed value. */
    shows: async (page: Page, which: 'rendered' | 'changed') => {
        const [value, label] = 'rendered' === which ? ['apple', 'Apple'] : ['banana', 'Banana'];
        await expect(page.locator('select#fruit')).toHaveValue(value);
        await expect(page.locator('.ts-wrapper .ts-control .item')).toHaveText([label]);
        await expect(page.locator('.ts-wrapper')).toHaveCount(1);
    },
};

test('a date picker in a GET form also goes back to the month rendered', async ({ page }) => {
    await page.goto(rendered.replace('%s', 'get'));
    await page.getByRole('button', { name: 'Due date: choose date' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Next month' }).click();
    await day(page.locator('form'), '2026-04-08').click();
    await expect(page.locator('input[name="due"]')).toHaveValue('2026-04-08');

    await visit(page, 'Go to page two', 'Page two');
    await back(page, 'Page one');

    await expect(page.locator('input[name="due"]')).toHaveValue('2026-03-10');
    await page.getByRole('button', { name: 'Due date: choose date' }).click();
    await expect(page.getByRole('dialog').getByRole('grid')).toHaveAccessibleName('March 2026');
    await expect(day(page.locator('form'), '2026-03-10')).toBeFocused();
});

// The page's scripts held back, so the user types before the controllers connect, as on a slow first load
for (const focused of [true, false]) {
    test(`a GET form ${focused ? 'holding' : 'not holding'} the focus when the page's scripts start ${focused ? 'keeps' : 'loses'} what was typed`, async ({ page }) => {
        let release: () => void = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        await page.route('**/assets/controllers/form_reset_controller*.js', async (route) => {
            await held;
            await route.fallback();
        });
        // module scripts hold DOMContentLoaded back too: the page is parsed and shown before it
        await page.goto(rendered.replace('%s', 'get'), { waitUntil: 'commit' });
        const name = page.getByRole('textbox', { name: 'Name' });
        await name.fill('Grace');
        if (!focused) {
            await name.blur();
        }
        // the first turbo:load comes once the scripts have run
        await turboOperation(page, {}, async () => release());
        await expect(page.locator('.ts-wrapper')).toHaveCount(1);
        await expect(name).toHaveValue(focused ? 'Grace' : 'Ada');
    });
}

// the layouts' form-reset syncs Tom Select after its reset, and the autocomplete's own controller syncs it too
test('a GET form after Back: the two syncs of Tom Select leave one item and no event; a later reset still syncs it', async ({ page }) => {
    await page.goto(rendered.replace('%s', 'get'));
    await autocomplete.change(page);
    await autocomplete.shows(page, 'changed');
    // on the document, which Turbo keeps across visits
    await page.evaluate(() => {
        const counts = { input: 0, change: 0 };
        for (const type of ['input', 'change'] as const) {
            document.addEventListener(type, (event) => (event.target as Element).matches('select') && counts[type]++, true);
        }
        (window as any).__selectEvents = counts;
    });

    await visit(page, 'Go to page two', 'Page two');
    await back(page, 'Page one');
    await autocomplete.shows(page, 'rendered');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    await autocomplete.shows(page, 'rendered');
    expect(await page.evaluate(() => (window as any).__selectEvents)).toEqual({ input: 0, change: 0 });

    await autocomplete.change(page);
    await autocomplete.shows(page, 'changed');
    await page.evaluate(() => {
        (window as any).__selectEvents.input = 0;
        (window as any).__selectEvents.change = 0;
        (document.getElementById('fruit') as HTMLSelectElement).form!.reset();
    });
    await autocomplete.shows(page, 'rendered');
    expect(await page.evaluate(() => (window as any).__selectEvents)).toEqual({ input: 0, change: 0 });
});
