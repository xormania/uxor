import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { previewUrl, viewports } from './inventory';

test('the trigger toggles the popover; opening focuses its first field, Escape closes it and focuses the trigger', async ({ page }) => {
    await page.goto(previewUrl('popover', 'default'));
    const trigger = page.getByRole('button', { name: 'Dimensions' });
    const dialog = page.getByRole('dialog', { name: 'Dimensions' });
    // rendered open (`open`): visible, placed under the trigger, without taking the focus
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog).not.toBeFocused();

    await trigger.click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('Width')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
});

test('a click outside closes the popover', async ({ page }) => {
    await page.goto(previewUrl('popover', 'default'));
    await page.mouse.click(5, 5);
    await expect(page.getByRole('dialog', { name: 'Dimensions' })).toBeHidden();
});

test('popovers of a group close each other', async ({ page }) => {
    await page.goto(previewUrl('popover', 'a-group'));
    await page.getByRole('button', { name: 'Owner' }).click();
    await expect(page.getByRole('dialog', { name: 'Owner' })).toBeVisible();
    // opened through its attribute (as a Live re-render or a script would): no outside click, no focus change
    await page.locator('#popover-status-trigger').evaluate((trigger) => trigger.closest('[data-controller="popover"]')!.setAttribute('data-popover-open-value', 'true'));
    await expect(page.getByRole('dialog', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Owner' })).toBeHidden();
});

const box = async (page: Page, name: string) => (await page.getByRole('dialog', { name }).boundingBox())!;

test('the content flips when it does not fit, stays in the viewport and follows the trigger on scroll', async ({ page }) => {
    await page.goto(previewUrl('popover', 'default'));
    const trigger = page.getByRole('button', { name: 'Dimensions' });
    const below = await box(page, 'Dimensions');
    expect(below.y).toBeGreaterThan((await trigger.boundingBox())!.y);

    // a viewport too short below the trigger: the content opens above it
    await page.evaluate(() => {
        document.body.style.paddingTop = `${window.innerHeight - 80}px`;
        window.dispatchEvent(new Event('resize'));
    });
    await expect(page.getByRole('dialog', { name: 'Dimensions' })).toHaveAttribute('data-placement', 'top-start');
    const above = await box(page, 'Dimensions');
    expect(above.y + above.height).toBeLessThanOrEqual((await trigger.boundingBox())!.y);

    // scrolling moves the trigger; the content stays next to it
    await page.evaluate(() => {
        document.body.style.paddingBottom = '2000px';
        window.scrollBy(0, 100);
    });
    await expect.poll(async () => Math.round((await box(page, 'Dimensions')).y + (await box(page, 'Dimensions')).height + 8 - (await trigger.boundingBox())!.y)).toBe(0);
});

test('the trigger does not submit a surrounding form', async ({ page }) => {
    await page.goto(previewUrl('popover', 'default'));
    await page.evaluate(() => {
        const form = document.createElement('form');
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            document.body.dataset.submitted = 'yes';
        });
        const popover = document.querySelector('[data-controller="popover"]')!;
        popover.replaceWith(form);
        form.append(popover);
    });
    await page.getByRole('button', { name: 'Dimensions' }).click();
    await page.getByRole('button', { name: 'Dimensions' }).click();
    await expect(page.locator('body')).not.toHaveAttribute('data-submitted', 'yes');
});

test('opening skips hidden controls, and a canceled popover:focus leaves the focus to the page', async ({ page }) => {
    await page.goto(previewUrl('popover', 'default'));
    const trigger = page.getByRole('button', { name: 'Dimensions' });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Dimensions' })).toBeHidden();
    // a hidden button and a button in a hidden part, both before the first field
    await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')!;
        const hidden = document.createElement('button');
        hidden.hidden = true;
        hidden.textContent = 'Hidden';
        const part = document.createElement('div');
        part.hidden = true;
        part.innerHTML = '<button>In a hidden part</button>';
        dialog.prepend(hidden, part);
    });
    await trigger.click();
    await expect(page.getByLabel('Width')).toBeFocused();

    await trigger.click();
    await page.evaluate(() => document.addEventListener('popover:focus', (event) => event.preventDefault()));
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Dimensions' })).toBeVisible();
    await expect(trigger).toBeFocused();
});

test('on a phone, a right-placed popover that fits on neither side opens below its trigger, inside the viewport', async ({ page }) => {
    await page.setViewportSize(viewports.mobile);
    await page.goto(previewUrl('popover', 'placements'));
    const dialog = page.getByRole('dialog', { name: 'Right' });
    await expect(dialog).toBeVisible();
    const trigger = (await page.getByRole('button', { name: 'Right' }).boundingBox())!;
    const content = (await dialog.boundingBox())!;
    const { innerWidth, scrollWidth } = await page.evaluate(() => ({ innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(content.x).toBeGreaterThanOrEqual(0);
    expect(content.x + content.width).toBeLessThanOrEqual(innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    await expect(dialog).toHaveAttribute('data-placement', 'bottom');
    expect(content.y).toBeGreaterThanOrEqual(trigger.y + trigger.height);
});
