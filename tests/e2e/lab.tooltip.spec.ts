import type { Page } from '@playwright/test';
import { test, expect, trackGlobalListeners, turboVisitDone, markDocument } from './fixtures';
import { back, forward, reloadFrames, sendStream, shown } from './transitions';

/*
 * A tooltip is shown only while its trigger is hovered or focused. Turbo copies the page as it is when it is left,
 * a shown tooltip included, and Back, Forward and a frame visit promoted to history restore that copy: the tooltip
 * must come back hidden, still describe its trigger, and show again on hover and focus.
 */

const tooltip = (page: Page, name: string | RegExp) => page.getByRole('tooltip', { name, includeHidden: true });

// hover, leave, focus and Escape, from a pointer away from the trigger and the focus elsewhere; ends with the focus elsewhere
async function expectWorks(page: Page, trigger: ReturnType<Page['getByRole']>, name: string) {
    await page.mouse.move(0, 0);
    await expect(tooltip(page, name)).toBeHidden();
    await expect(trigger).toHaveAccessibleDescription(name);
    await trigger.hover();
    await expect(tooltip(page, name)).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(tooltip(page, name)).toBeHidden();
    await trigger.focus();
    await expect(tooltip(page, name)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tooltip(page, name)).toBeHidden();
    await trigger.blur();
}

test.beforeEach(async ({ page }) => {
    await page.mouse.move(0, 0);
});

test('a tooltip shown on the link that visits is hidden after Back, Forward and a reload, and still works', async ({ page }) => {
    await page.goto('/lab/tooltip-turbo');
    const sameDocument = await markDocument(page);
    const toTwo = page.getByRole('link', { name: 'Go to page two' });
    const toOne = page.getByRole('link', { name: 'Go to page one' });

    // shown by the focus, then the link visits from the keyboard
    await toTwo.focus();
    await expect(tooltip(page, 'Opens page two')).toBeVisible();
    await page.keyboard.press('Enter');
    await shown(page, 'Page two');

    // page two's link focused, and left with Back: Turbo copies page two with its tooltip shown
    await toOne.focus();
    await expect(tooltip(page, 'Opens page one')).toBeVisible();
    await back(page, 'Page one');
    await expect(tooltip(page, 'Opens page two')).toBeHidden();
    await expectWorks(page, toTwo, 'Opens page two');

    await forward(page, 'Page two');
    await expect(tooltip(page, 'Opens page one')).toBeHidden();
    await expectWorks(page, toOne, 'Opens page one');
    await sameDocument.expectKept();

    await toOne.focus();
    await page.reload();
    await expect(tooltip(page, 'Opens page one')).toBeHidden();
    await expectWorks(page, toOne, 'Opens page one');
});

test('a tooltip shown while a frame visit adds a history entry is hidden after Back', async ({ page }) => {
    await page.goto('/lab/tooltip-turbo');
    const remove = page.getByRole('button', { name: 'Delete' });
    const nextStep = page.getByRole('link', { name: 'Next step' });

    // one tooltip hovered outside the frame, the frame's own link focused and followed
    await remove.hover();
    await nextStep.focus();
    await expect(tooltip(page, 'Delete the draft')).toBeVisible();
    await expect(tooltip(page, 'Adds a history entry')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('history-step')).toHaveText('1');
    await expect.poll(() => new URL(page.url()).searchParams.get('step')).toBe('1');
    // the pointer did not move: the tooltip it hovers stays
    await expect(tooltip(page, 'Delete the draft')).toBeVisible();

    await page.mouse.move(0, 0);
    await back(page, { step: 0 });
    await expect(tooltip(page, 'Delete the draft')).toBeHidden();
    await expect(tooltip(page, 'Adds a history entry')).toBeHidden();
    await expectWorks(page, remove, 'Delete the draft');
    await expectWorks(page, nextStep, 'Adds a history entry');
});

test('repeated Turbo visits leave one tooltip per trigger and no document or window listener behind', async ({ page }) => {
    const listeners = await trackGlobalListeners(page);
    await page.goto('/lab/tooltip-turbo');
    let baseline = {};
    for (let visit = 0; visit < 4; visit++) {
        await page.getByRole('button', { name: 'Delete' }).hover();
        await page.getByRole('link', { name: /Go to page/ }).click();
        await turboVisitDone(page);
        if (0 === visit) {
            baseline = await listeners();
        }
    }
    await expect(page.locator('[data-controller~="tooltip"]')).toHaveCount(6);
    await expect(page.getByRole('tooltip', { includeHidden: true })).toHaveCount(6);
    expect(await listeners()).toEqual(baseline);
    await expectWorks(page, page.getByRole('button', { name: 'Delete' }), 'Delete the draft');
});

test('inside a data-turbo-permanent element, a tooltip shown by the focus stays shown through a visit, and keeps working', async ({ page }) => {
    await page.goto('/lab/tooltip-turbo');
    const kept = page.getByRole('button', { name: 'Kept' });
    await kept.focus();
    await expect(tooltip(page, 'In a permanent element')).toBeVisible();
    await page.evaluate(() => (window as any).Turbo.visit('/lab/tooltip-turbo/two'));
    await shown(page, 'Page two');

    // Turbo moves the permanent element into page two with the focus still on its trigger: the tooltip stays shown
    await expect(kept).toBeFocused();
    await expect(tooltip(page, 'In a permanent element')).toBeVisible();
    await kept.blur();
    await expectWorks(page, kept, 'In a permanent element');
});

test('inside a Turbo Frame reloaded three times from a link with a tooltip, the tooltips work', async ({ page }) => {
    await page.goto('/lab/tooltip-turbo');
    await reloadFrames(page, {
        activate: async (link) => {
            await link.focus();
            await expect(tooltip(page, 'Loads the frame again')).toBeVisible();
            await page.keyboard.press('Enter');
        },
    });
    await expect(tooltip(page, 'Loads the frame again')).toBeHidden();
    await expect(page.locator('[data-controller~="tooltip"]')).toHaveCount(6);
    await expectWorks(page, page.getByRole('button', { name: 'Framed' }), 'In a frame, load 3');
    await expectWorks(page, page.getByRole('link', { name: 'Reload the frame' }), 'Loads the frame again');
});

test('replaced or updated by a Turbo Stream while shown, the new tooltip is hidden, works, and no listener is left', async ({ page }) => {
    const listeners = await trackGlobalListeners(page);
    await page.goto('/lab/tooltip-stream');
    const streamed = page.getByRole('button', { name: 'Streamed' });
    let baseline = {};

    for (const action of ['replace', 'update', 'replace', 'update'] as const) {
        await streamed.focus();
        await expect(tooltip(page, /^Version /)).toBeVisible();
        // sent while the trigger keeps the focus, until the Stream removes it
        await sendStream(page, action, { from: 'code' });
        await expect(tooltip(page, `Version ${action}.`)).toBeHidden();
        await expectWorks(page, streamed, `Version ${action}.`);
        await expect(page.getByRole('tooltip', { includeHidden: true })).toHaveCount(1);
        if ('replace' === action && 0 === Object.keys(baseline).length) {
            baseline = await listeners();
        }
        expect(await listeners()).toEqual(baseline);
    }
});

test('a tooltip stays shown, in place, while the theme changes', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/lab/tooltip-turbo');
    const remove = page.getByRole('button', { name: 'Delete' });
    await remove.focus();
    await expect(tooltip(page, 'Delete the draft')).toBeVisible();
    const before = await tooltip(page, 'Delete the draft').boundingBox();

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(tooltip(page, 'Delete the draft')).toBeVisible();
    expect(await tooltip(page, 'Delete the draft').boundingBox()).toEqual(before);
    await expect(remove).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tooltip(page, 'Delete the draft')).toBeHidden();
});

test('a tooltip in a bordered wrapper at the right edge stays inside the viewport, 8 pixels from its trigger', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/lab/tooltip-turbo');
    const remove = page.getByRole('button', { name: 'Delete' });
    // the wrapper with a 2px border (as an avatar group draws one around `+9k`), against the right edge
    const wrapper = remove.locator('xpath=..');
    await wrapper.evaluate((element: HTMLElement) => Object.assign(element.style, { position: 'fixed', top: '200px', right: '0px', border: '2px solid' }));
    await remove.hover();
    await expect(tooltip(page, 'Delete the draft')).toBeVisible();

    const box = (await tooltip(page, 'Delete the draft').boundingBox())!;
    const reference = (await wrapper.boundingBox())!;
    const { clientWidth, scrollWidth } = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(box.x + box.width).toBeLessThanOrEqual(clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    await expect(tooltip(page, 'Delete the draft')).toHaveAttribute('data-placement', 'top');
    expect(Math.round(reference.y - (box.y + box.height))).toBe(8);
});
