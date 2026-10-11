import type { Page } from '@playwright/test';
import { test, expect, countEvents } from './fixtures';
import { day, dayCell } from './calendar';

// counts the input and change events the calendar in `selector` dispatches on its hidden inputs
const countInputEvents = (page: Page, selector: string) => countEvents(page, ['input', 'change'], `${selector} [data-calendar-target="input"]`);

test('arrow, Home, End and Page keys move the focus; right to left swaps the arrows', async ({ page }) => {
    await page.goto('/preview/calendar/default?theme=light');
    const calendar = page.getByRole('group', { name: 'Calendar' });
    await day(calendar, '2026-03-12').focus();
    await page.keyboard.press('ArrowRight');
    await expect(day(calendar, '2026-03-13')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(day(calendar, '2026-03-20')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(day(calendar, '2026-03-15')).toBeFocused();
    await page.keyboard.press('End');
    await expect(day(calendar, '2026-03-21')).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect(day(calendar, '2026-04-21')).toBeFocused();
    await expect(calendar.getByRole('grid')).toHaveAccessibleName('April 2026');
    // one day takes the Tab focus
    await expect(calendar.locator('[data-slot="calendar-day"] button[tabindex="0"]')).toHaveCount(1);

    await page.evaluate(() => (document.documentElement.dir = 'rtl'));
    await page.keyboard.press('ArrowLeft');
    await expect(day(calendar, '2026-04-22')).toBeFocused();
});

test('the month and year dropdowns move the calendar', async ({ page }) => {
    await page.goto('/preview/calendar/default?theme=light');
    const calendar = page.getByRole('group', { name: 'Calendar' });
    await calendar.getByLabel('Month', { exact: true }).selectOption('7');
    await calendar.getByLabel('Year', { exact: true }).selectOption('2027');
    await expect(calendar.getByRole('grid')).toHaveAccessibleName('July 2027');
    await calendar.getByRole('button', { name: 'Previous month' }).click();
    await expect(calendar.getByRole('grid')).toHaveAccessibleName('June 2027');
});

test('the dropdowns stay within startMonth and endMonth', async ({ page }) => {
    await page.goto('/preview/calendar/default?theme=light');
    const calendar = page.getByRole('group', { name: 'Calendar' });
    await calendar.evaluate((node) => {
        node.setAttribute('data-calendar-start-month-value', '2026-06-01');
        node.setAttribute('data-calendar-end-month-value', '2026-09-01');
    });
    await calendar.getByLabel('Month', { exact: true }).selectOption('12');
    await expect(calendar.getByRole('grid')).toHaveAccessibleName('September 2026');
    await calendar.getByLabel('Month', { exact: true }).selectOption('1');
    await expect(calendar.getByRole('grid')).toHaveAccessibleName('June 2026');
});

test('a modifier gone from a re-render leaves no attribute on the days', async ({ page }) => {
    await page.goto('/preview/calendar/default?theme=light');
    const calendar = page.getByRole('group', { name: 'Calendar' });
    await calendar.evaluate((node) => node.setAttribute('data-calendar-modifiers-value', '{"booked":["2026-03-12"]}'));
    await expect(calendar.locator('[data-day="2026-03-12"][data-booked="true"]')).toHaveCount(1);
    await calendar.evaluate((node) => node.setAttribute('data-calendar-modifiers-value', '{}'));
    await expect(calendar.locator('[data-booked]')).toHaveCount(0);
});

test('a date that does not exist is never selected', async ({ page }) => {
    await page.goto('/lab/calendar-turbo');
    const calendar = page.getByRole('group', { name: 'Day' });
    const input = page.locator('input[name="day"]');
    await calendar.evaluate((node) => node.setAttribute('data-calendar-selected-value', '["2026-02-31"]'));
    await calendar.evaluate((node) => node.setAttribute('data-calendar-selected-value', '["2026-03-11"]'));
    await expect(input).toHaveValue('2026-03-11');
    await calendar.evaluate((node) => node.setAttribute('data-calendar-selected-value', '["2026-02-30"]'));
    await expect(input).toHaveValue('');
});

test('each mode submits its inputs; day buttons never submit the form', async ({ page }) => {
    await page.goto('/lab/calendar-turbo');
    const url = page.url();
    const dayCalendar = page.getByRole('group', { name: 'Day' });
    const stay = page.getByRole('group', { name: 'Stay' });
    const dates = page.getByRole('group', { name: 'Dates' });

    await day(dayCalendar, '2026-03-12').click();
    await day(stay, '2026-03-02').click();
    await day(stay, '2026-03-05').click();
    await day(dates, '2026-03-10').click();
    await day(dates, '2026-03-03').click();
    expect(page.url()).toBe(url);

    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.getByTestId('submitted')).toHaveText('day=2026-03-12 stay=2026-03-02..2026-03-05 dates=2026-03-03,2026-03-10');
    // the page rendered from the submitted values shows them selected
    await expect(day(page.getByRole('group', { name: 'Day' }), '2026-03-12')).toHaveAttribute('data-selected-single', 'true');
});

test('a pick dispatches one input and one change event on the hidden input', async ({ page }) => {
    await page.goto('/lab/calendar-turbo');
    const counts = await countInputEvents(page, '#cal-day');
    const calendar = page.getByRole('group', { name: 'Day' });
    await day(calendar, '2026-03-12').click();
    await expect.poll(() => counts()).toEqual({ input: 1, change: 1 });
    await expect(calendar.locator('input[name="day"]')).toHaveValue('2026-03-12');
    // the keyboard selects too, and a second pick of the same day clears it
    await day(calendar, '2026-03-12').press('Enter');
    await expect.poll(() => counts()).toEqual({ input: 2, change: 2 });
    await expect(calendar.locator('input[name="day"]')).toHaveValue('');
    // a disabled day takes no click
    await day(calendar, '2026-03-20').click({ force: true });
    await expect.poll(() => counts()).toEqual({ input: 2, change: 2 });
});

test('a range never spans a disabled day: a click past one starts a new range', async ({ page }) => {
    await page.goto('/lab/calendar-turbo');
    const stay = page.getByRole('group', { name: 'Stay' });
    await day(stay, '2026-03-18').click();
    await day(stay, '2026-03-22').click();
    await expect(stay.locator('input[name="stay[from]"]')).toHaveValue('2026-03-22');
    await expect(stay.locator('input[name="stay[to]"]')).toHaveValue('');
    await day(stay, '2026-03-25').click();
    await expect(stay.locator('input[name="stay[to]"]')).toHaveValue('2026-03-25');
    await expect(stay.locator('[data-range-middle="true"]')).toHaveCount(2 * 2);
});

test('in multiple mode, the inputs keep their attributes and order as dates come and go', async ({ page }) => {
    await page.goto('/lab/calendar-turbo');
    const dates = page.getByRole('group', { name: 'Dates' });
    const inputs = dates.locator('[data-slot="calendar-inputs"] input');
    await day(dates, '2026-03-10').click();
    await day(dates, '2026-03-03').click();
    await day(dates, '2026-03-17').click();
    await day(dates, '2026-03-10').click();
    await expect(inputs).toHaveCount(2);
    expect(await inputs.evaluateAll((nodes) => nodes.map((node) => [(node as HTMLInputElement).name, (node as HTMLInputElement).value, node.getAttribute('data-kept')]))).toEqual([
        ['dates[]', '2026-03-03', 'yes'],
        ['dates[]', '2026-03-17', 'yes'],
    ]);

    // deselecting the last date changes no remaining input: the events come from the removed one
    const counts = await countInputEvents(page, '#cal-dates');
    await day(dates, '2026-03-17').click();
    await expect(inputs).toHaveCount(1);
    expect(await counts()).toEqual({ input: 1, change: 1 });
});

test('a calendar whose inputs belong to a form outside it, with no date yet, follows that form\'s reset', async ({ page }) => {
    await page.goto('/lab/calendar-turbo');
    // the multiple calendar moved out of its form, its inputs tied to it by the form attribute (inputAttr: {form: …}):
    // no input is rendered yet, only the prototype, and no form encloses the calendar
    await page.evaluate(() => {
        const calendar = document.getElementById('cal-dates')!;
        const form = calendar.closest('form')!;
        form.id = 'external-dates-form';
        calendar.querySelector('template')!.content.querySelector('input')!.setAttribute('form', form.id);
        document.querySelector('main')!.append(calendar);
    });
    const dates = page.getByRole('group', { name: 'Dates' });
    const inputs = dates.locator('[data-slot="calendar-inputs"] input');
    await expect(inputs).toHaveCount(0);
    await day(dates, '2026-03-10').click();
    await expect(inputs).toHaveCount(1);
    expect(await inputs.evaluate((input) => (input as HTMLInputElement).form?.id)).toBe('external-dates-form');

    await page.evaluate(() => (document.getElementById('external-dates-form') as HTMLFormElement).reset());
    await expect(inputs).toHaveCount(0);
    await expect(dayCell(dates, '2026-03-10')).toHaveAttribute('aria-selected', 'false');
});

// the `reset` event is cancelable and comes before the fields are reset: the calendar acts on the window, after the
// form's listeners, in the same task (hidden inputs are not reset by the browser), and undoes it if a later one cancels
test('a reset another listener cancels leaves the selection; the next one brings back the date rendered, with the source reset', async ({ page }) => {
    await page.goto('/lab/calendar-turbo?day=2026-03-10');
    const calendar = page.getByRole('group', { name: 'Day' });
    const input = page.locator('#cal-day input[name="day"]');
    await day(calendar, '2026-03-12').click();
    await expect(input).toHaveValue('2026-03-12');
    await page.evaluate(() => {
        const element = document.getElementById('cal-day')!;
        const form = element.closest('form')!;
        (window as any).__sources = [];
        element.addEventListener('calendar:select', (event) => (window as any).__sources.push((event as CustomEvent).detail.source));
        (window as any).__cancel = 'capture';
        // a capture listener on the window, and one on the form added after the calendar's: the calendar's runs first
        window.addEventListener('reset', (event) => 'capture' === (window as any).__cancel && event.preventDefault(), true);
        form.addEventListener('reset', (event) => 'later' === (window as any).__cancel && event.preventDefault());
        const button = document.createElement('button');
        button.type = 'reset';
        button.textContent = 'Reset the calendars';
        form.append(button);
    });
    const sources = () => page.evaluate(() => (window as any).__sources as string[]);
    // the calendar acts on the window's `reset`, then a task later (undone if a later listener cancelled): armed before a
    // reset, resolves once that task has run, from a listener after the calendar's and a task queued after its own
    const armReset = () =>
        page.evaluate(() => {
            (window as any).__resetOver = new Promise((resolve) => window.addEventListener('reset', () => setTimeout(resolve), { once: true }));
        });
    const resetOver = () => page.evaluate(() => (window as any).__resetOver);
    const expectSelected = async (date: string, other: string) => {
        await expect(input).toHaveValue(date);
        await expect(dayCell(calendar, date)).toHaveAttribute('aria-selected', 'true');
        await expect(dayCell(calendar, other)).toHaveAttribute('aria-selected', 'false');
    };

    // cancelled in a capture listener, from form.reset() and from the reset button
    await armReset();
    await page.evaluate(() => document.getElementById('cal-day')!.closest('form')!.reset());
    await resetOver();
    await armReset();
    await page.getByRole('button', { name: 'Reset the calendars' }).click();
    await resetOver();
    await expectSelected('2026-03-12', '2026-03-10');
    // cancelled by a listener after the calendar's, on a click of the reset button (microtasks run between listeners)
    await page.evaluate(() => ((window as any).__cancel = 'later'));
    await armReset();
    await page.getByRole('button', { name: 'Reset the calendars' }).click();
    await resetOver();
    await expectSelected('2026-03-12', '2026-03-10');
    expect(await sources()).toEqual([]);

    // not cancelled: back to the date rendered, as the README lists it (`calendar:select` with the source `reset`)
    await page.evaluate(() => ((window as any).__cancel = null));
    await page.getByRole('button', { name: 'Reset the calendars' }).click();
    await expectSelected('2026-03-10', '2026-03-12');
    expect(await sources()).toEqual(['reset']);

    // form.reset() resets the hidden inputs in the same task: a FormData taken right after it holds the date rendered
    await day(calendar, '2026-03-12').click();
    await expect(input).toHaveValue('2026-03-12');
    expect(
        await page.evaluate(() => {
            const form = document.getElementById('cal-day')!.closest('form')!;
            form.reset();
            return new FormData(form).getAll('day');
        })
    ).toEqual(['2026-03-10']);
    await expectSelected('2026-03-10', '2026-03-12');

    // cancelled by a window listener added after the calendar's: once the event is over, the calendar shows its dates again
    await day(calendar, '2026-03-12').click();
    await expect(input).toHaveValue('2026-03-12');
    await armReset();
    await page.evaluate(() => {
        (window as any).__sources = [];
        window.addEventListener('reset', (event) => event.preventDefault());
        document.getElementById('cal-day')!.closest('form')!.reset();
    });
    await resetOver();
    await expectSelected('2026-03-12', '2026-03-10');
    expect(await sources()).toEqual(['reset', 'reset']);
});

/*
 * The native month and year menus follow the page's theme, not the system's: with the system dark and the light theme
 * chosen (and the other way round), each document and each select uses the page's color scheme, and every option's
 * text contrasts with the menu behind it. A menu shows the option's background, else the select's, else the canvas of
 * the select's color scheme; under `normal` that canvas is the system's (macOS draws the menu natively in the system's
 * appearance), which is how the light theme under a dark system showed dark text on a dark menu.
 */
for (const system of ['dark', 'light'] as const) {
    const theme = 'dark' === system ? 'light' : 'dark';

    test.describe(`system ${system}, ${theme} theme chosen`, () => {
        test.use({ colorScheme: system });

        test(`the month and year options are readable: the page and the ${theme} preview use the ${theme} color scheme`, async ({ page }) => {
            await page.goto('/');
            await page.evaluate((theme) => localStorage.setItem('theme', theme), theme);
            await page.goto('/r/calendar');
            await expect(page.locator('html')).toHaveClass('dark' === theme ? /\bdark\b/ : /^(?!.*\bdark\b)/);
            expect.soft(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'page color-scheme').toBe(theme);

            const example = page.getByTestId('example').first();
            const frame = example.locator(`iframe[title$="(${theme})"]`).contentFrame();
            const calendar = frame.getByRole('group', { name: 'Calendar' });
            await expect(calendar.getByLabel('Month', { exact: true })).toBeAttached();

            const result = await frame.locator('html').evaluate((html, system) => {
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d', { willReadFrequently: true })!;
                // any CSS color (oklch included) as sRGB with alpha, through a canvas
                const rgba = (color: string) => {
                    context.clearRect(0, 0, 1, 1);
                    context.fillStyle = '#00000000';
                    context.fillStyle = color;
                    context.fillRect(0, 0, 1, 1);
                    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
                    return { r, g, b, a };
                };
                const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
                    const [R, G, B] = [r, g, b].map((v) => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
                    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
                };
                const canvasOf = (scheme: string) => {
                    const probe = document.createElement('div');
                    probe.style.colorScheme = 'light' === scheme || 'dark' === scheme ? scheme : system;
                    probe.style.backgroundColor = 'Canvas';
                    document.body.append(probe);
                    const color = getComputedStyle(probe).backgroundColor;
                    probe.remove();
                    return color;
                };
                const selects = [...document.querySelectorAll<HTMLSelectElement>('[data-slot="calendar-dropdown-root"] select')];
                return {
                    html: getComputedStyle(html).colorScheme,
                    selects: selects.map((select) => {
                        const selectStyle = getComputedStyle(select);
                        const options = [...select.options].map((option) => {
                            const style = getComputedStyle(option);
                            const background = [style.backgroundColor, selectStyle.backgroundColor].find((color) => 255 === rgba(color).a) ?? canvasOf(selectStyle.colorScheme);
                            const [l1, l2] = [luminance(rgba(style.color)), luminance(rgba(background))].sort((a, b) => b - a);
                            return { ratio: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100, colors: `${style.color} on ${background}` };
                        });
                        const worst = options.reduce((a, b) => (b.ratio < a.ratio ? b : a));
                        return { label: select.getAttribute('aria-label'), colorScheme: selectStyle.colorScheme, minRatio: worst.ratio, colors: worst.colors };
                    }),
                };
            }, system);

            expect.soft(result.html, 'preview color-scheme').toBe(theme);
            expect(result.selects.map(({ label }) => label)).toEqual(['Month', 'Year']);
            for (const select of result.selects) {
                expect.soft(select.colorScheme, `${select.label} color-scheme`).toBe(theme);
                expect.soft(select.minRatio, `${select.label} options' contrast: ${select.colors}`).toBeGreaterThanOrEqual(4.5);
            }
        });
    });
}
