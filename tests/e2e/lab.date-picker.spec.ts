import type { Page } from '@playwright/test';
import { test, expect, turboVisitDone, countEvents } from './fixtures';
import { back, recordFirstFrames, reloadFrames, stepFromCode, visit } from './transitions';
import { day } from './calendar';

const pick = async (page: Page, label: string, date: string) => {
    await page.getByRole('button', { name: `${label}: choose date` }).click();
    await day(page.getByRole('dialog', { name: 'Choose a date' }), date).click();
};
// the change events of the calendars' hidden inputs, from now on
const countChanges = (page: Page) => countEvents(page, ['change'], '[data-calendar-target="input"]');

test('a pick is submitted by the form; the day buttons never submit it', async ({ page }) => {
    await page.goto('/lab/date-picker-turbo');
    const url = page.url();
    await pick(page, 'Due date', '2026-03-12');
    expect(page.url()).toBe(url);
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('Mar 12, 2026');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.getByTestId('submitted')).toHaveText('due=2026-03-12');
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('Mar 12, 2026');
});

test('repeated Turbo visits leave one controller per picker and one change per pick', async ({ page }) => {
    await page.goto('/lab/date-picker-turbo');
    for (let visit = 0; visit < 3; visit++) {
        await page.getByRole('link', { name: /Go to page/ }).click();
        await turboVisitDone(page);
    }
    await expect(page.locator('[data-controller~="date-picker"]')).toHaveCount(3);
    const changes = await countChanges(page);
    await pick(page, 'Due date', '2026-03-11');
    await expect(page.locator('input[name="due"]')).toHaveValue('2026-03-11');
    expect(await changes()).toEqual({ change: 1 });
});

test('inside a data-turbo-permanent element and a Turbo Frame reloaded three times, the pickers work', async ({ page }) => {
    await page.goto('/lab/date-picker-turbo');
    await visit(page, 'Go to page two', 'Page two');
    await pick(page, 'Kept date', '2026-03-05');
    await expect(page.getByLabel('Kept date', { exact: true })).toHaveValue('Mar 5, 2026');

    await reloadFrames(page);
    await pick(page, 'Framed date', '2026-03-06');
    await expect(page.getByLabel('Framed date', { exact: true })).toHaveValue('Mar 6, 2026');
});

test('in a Live form, a pick reaches the server and the end date follows the start', async ({ page }) => {
    await page.goto('/lab/live-date-picker');
    await page.getByRole('button', { name: 'Choose date' }).first().click();
    await day(page.getByRole('dialog'), '2026-03-10').click();
    await expect(page.getByTestId('start')).toHaveText('2026-03-10');

    // the end's calendar now starts on the 10th
    await page.getByRole('button', { name: 'Choose date' }).nth(1).click();
    const endDialog = page.getByRole('dialog');
    await expect(day(endDialog, '2026-03-09')).toBeDisabled();
    await day(endDialog, '2026-03-12').click();
    await expect(page.getByTestId('end')).toHaveText('2026-03-12');
    await expect(page.getByRole('textbox', { name: 'End' })).toHaveValue('Mar 12, 2026');
    await expect(page.getByRole('textbox', { name: 'Start' })).toHaveValue('Mar 10, 2026');
    await expect(page.locator('[data-calendar-target="input"]')).toHaveCount(2);
});

// an open overlay is kept through a Live re-render (6b), and the values follow the server's: the end's earliest day
// moves with the start the server now holds, while the end picker stays open with the focus on its day
test('a date picker open during a Live re-render stays the same open dialog with the focus on its day, keeps its date and takes the new bounds', async ({ page }) => {
    await page.goto('/lab/live-date-picker');
    const root = page.locator('[data-controller~="live"]');
    const endField = page.getByRole('textbox', { name: 'End' });
    const endInput = page.locator('input[name="stay[end]"]');
    await page.getByRole('button', { name: 'Choose date' }).first().click();
    await day(page.getByRole('dialog'), '2026-03-10').click();
    await expect(page.getByTestId('start')).toHaveText('2026-03-10');
    await page.getByRole('button', { name: 'Choose date' }).nth(1).click();
    await day(page.getByRole('dialog'), '2026-03-16').click();
    await expect(page.getByTestId('end')).toHaveText('2026-03-16');

    // open the end picker again, the focus moved to another day
    const trigger = page.getByRole('button', { name: 'Choose date' }).nth(1);
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Choose a date' });
    await expect(day(dialog, '2026-03-16')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(day(dialog, '2026-03-17')).toBeFocused();
    await expect(day(dialog, '2026-03-13')).toBeEnabled();
    await dialog.evaluate((element) => ((element as any).__before = true));

    // the server's start moves the end's earliest day to the 14th: a real re-render, started from the page's code
    await root.evaluate(async (element) => {
        const { getComponent } = await import('@symfony/ux-live-component');
        const component = await getComponent(element as HTMLElement);
        component.set('stay.start', '2026-03-14');
        await component.render();
    });
    await expect(page.getByTestId('start')).toHaveText('2026-03-14');
    await expect(page.getByRole('textbox', { name: 'Start' })).toHaveValue('Mar 14, 2026');

    // the same dialog, open, the focus on its day
    await expect(page.getByRole('dialog')).toHaveCount(1);
    expect(await dialog.evaluate((element) => (element as any).__before)).toBe(true);
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(day(dialog, '2026-03-17')).toBeFocused();
    // its date kept, in the field, the hidden input and the calendar; the new bounds
    await expect(page.getByTestId('end')).toHaveText('2026-03-16');
    await expect(endField).toHaveValue('Mar 16, 2026');
    await expect(endInput).toHaveValue('2026-03-16');
    await expect(day(dialog, '2026-03-16')).toHaveAttribute('data-selected-single', 'true');
    await expect(day(dialog, '2026-03-13')).toBeDisabled();
    await expect(day(dialog, '2026-03-14')).toBeEnabled();
    await expect(page.locator('[data-calendar-target="input"]')).toHaveCount(2);

    // the keys and a pick still work: one change, sent to the server
    const changes = await countChanges(page);
    await page.keyboard.press('ArrowRight');
    await expect(day(dialog, '2026-03-18')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(endField).toHaveValue('Mar 18, 2026');
    await expect(page.getByTestId('end')).toHaveText('2026-03-18');
    expect(await changes()).toEqual({ change: 1 });
});

test('a date picker open while the page code steps a frame promoted to history stays open on its day; Back shows it closed with the date of the URL', async ({ page }) => {
    await page.goto('/lab/date-picker-turbo');
    const firstFrames = await recordFirstFrames(page, { calendar: '#due-picker-content' });
    await pick(page, 'Due date', '2026-03-12');
    await page.getByRole('button', { name: 'Due date: choose date' }).click();
    const calendar = page.getByRole('dialog', { name: 'Choose a date' });
    await expect(day(calendar, '2026-03-12')).toBeFocused();

    await stepFromCode(page, 1);
    await expect(calendar).toBeVisible();
    await expect(day(calendar, '2026-03-12')).toBeFocused();
    await day(calendar, '2026-03-13').click();
    await expect(calendar).toBeHidden();
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('Mar 13, 2026');

    // the copy was taken as the frame visit started: open, on the first pick; its form is a GET form, so Back shows
    // the URL's date (none), not the pick
    await back(page, { step: 0 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Due date: choose date' })).toHaveAttribute('aria-expanded', 'false');
    expect(await firstFrames(1)).toEqual([{ render: 1, url: '/lab/date-picker-turbo', visible: { calendar: false } }]);
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('');
    await expect(page.locator('input[name="due"]')).toHaveValue('');
    await pick(page, 'Due date', '2026-03-05');
    await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('Mar 5, 2026');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // a click on the frame's own link closes the picker first, as any click outside it
    await page.getByRole('button', { name: 'Due date: choose date' }).click();
    await visit(page, 'Next step', { step: 1 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
});
