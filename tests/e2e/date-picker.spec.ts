import { test, expect } from './fixtures';
import { day } from './calendar';

test('the trigger opens the calendar on the selected day; a pick closes it and shows the date', async ({ page }) => {
    await page.goto('/preview/date-picker/default?theme=light');
    // named by its label; the date is its value
    const trigger = page.getByRole('button', { name: 'Due date' });
    const value = page.locator('[data-date-picker-target="value"]');
    await expect(value).toHaveText('Mar 12, 2026');
    const dialog = page.getByRole('dialog', { name: 'Choose a date' });
    // rendered open (`open`): close it, then open it from the trigger
    await trigger.click();
    await expect(dialog).toBeHidden();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(day(dialog, '2026-03-12')).toBeFocused();

    await day(dialog, '2026-03-18').click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(value).toHaveText('Mar 18, 2026');
    await expect(page.locator('input[name="due"]')).toHaveValue('2026-03-18');

    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
});

test('a typed date selects it; an emptied field clears it; text that is not a date the calendar accepts is invalid', async ({ page }) => {
    await page.goto('/preview/date-picker/typing-a-date?theme=light');
    const field = page.getByLabel('Start date');
    const hidden = page.locator('input[name="start"]');
    await expect(field).toHaveValue('Mar 12, 2026');

    await field.fill('2026-03-20');
    await expect(hidden).toHaveValue('2026-03-20');
    await field.fill('3/22/2026');
    await expect(hidden).toHaveValue('2026-03-22');
    await field.press('Tab');
    await expect(field).toHaveValue('Mar 22, 2026');

    await field.fill('');
    await expect(hidden).toHaveValue('');

    // the formatted text of a date that is not selected, into an empty field and over another date
    await field.fill('Mar 20, 2026');
    await field.press('Tab');
    await expect(hidden).toHaveValue('2026-03-20');
    await expect(field).not.toHaveAttribute('aria-invalid');
    await field.fill('mar 25,  2026');
    await field.press('Tab');
    await expect(hidden).toHaveValue('2026-03-25');
    await expect(field).toHaveValue('Mar 25, 2026');
    await field.fill('');
    await expect(hidden).toHaveValue('');

    // before minDate: refused
    await field.fill('2026-02-15');
    await field.press('Tab');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(hidden).toHaveValue('');
    await expect(field).toHaveValue('2026-02-15');

    await field.fill('not a date');
    await field.press('Tab');
    await expect(field).toHaveAttribute('aria-invalid', 'true');

    // a valid pick clears the invalid state
    await page.getByRole('button', { name: 'Choose date' }).click();
    await day(page.getByRole('dialog'), '2026-03-10').click();
    await expect(field).toHaveValue('Mar 10, 2026');
    await expect(field).not.toHaveAttribute('aria-invalid');
    await expect(hidden).toHaveValue('2026-03-10');
});

test('ArrowDown in the field opens the calendar; a range closes after both ends', async ({ page }) => {
    await page.goto('/preview/date-picker/typing-a-date?theme=light');
    await page.getByLabel('Start date').press('ArrowDown');
    await expect(page.getByRole('dialog', { name: 'Choose a date' })).toBeVisible();

    await page.goto('/preview/date-picker/range?theme=light');
    const dialog = page.getByRole('dialog', { name: 'Choose dates' });
    await expect(dialog).toBeVisible();
    await day(dialog, '2026-03-16').click();
    await expect(dialog).toBeVisible();
    await day(dialog, '2026-03-19').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: /Mar 16 – 19, 2026|Mar 16, 2026 – Mar 19, 2026/ })).toBeVisible();
    await expect(page.locator('input[name="stay[from]"]')).toHaveValue('2026-03-16');
    await expect(page.locator('input[name="stay[to]"]')).toHaveValue('2026-03-19');
});
