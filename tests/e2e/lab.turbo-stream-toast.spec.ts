import { test, expect, pauseClock } from './fixtures';
import { visit } from './transitions';

test('a toast pushed by a Turbo Stream appears, dismisses itself and leaves focus alone', async ({ page }) => {
    await page.goto('/lab/turbo-stream-toast');
    const region = page.getByRole('region', { name: 'Notifications' });
    const timeout = page.getByLabel('Timeout (ms)');

    // submitted from the keyboard: the toast appears without taking focus
    await timeout.press('Enter');
    const toast = region.getByText('Notification 1 sent.');
    await expect(toast).toBeVisible();
    await expect(timeout).toBeFocused();
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(toast).toBeHidden({ timeout: 4000 });
    await expect(region.locator('[data-controller="toast"]')).toHaveCount(0);
});

/*
 * The pause tests run the toast's countdown on Playwright's clock (`page.clock`), paused once the page is ready
 * (pauseClock): only `runFor()` moves time, firing every timer due in between, so the countdown cannot run out
 * between two steps of a slow run (between the click that shows a toast and the hover that pauses it). Turbo renders
 * the Stream on an animation frame, which `runFor()` gives it. The others keep the real clock.
 */
/** Notify, then one animation frame at a time (16 ms of its countdown each) until Turbo has rendered the toast. */
const notify = async (page: import('@playwright/test').Page, toast: import('@playwright/test').Locator) => {
    await page.getByRole('button', { name: 'Notify' }).click();
    await expect
        .poll(async () => {
            await page.clock.runFor(16);
            return toast.count();
        }, { message: 'the toast rendered' })
        .toBe(1);
};
test('a toast pauses while hovered and closes from its button', async ({ page }) => {
    await page.clock.install();
    await page.goto('/lab/turbo-stream-toast');
    const region = page.getByRole('region', { name: 'Notifications' });
    await expect(page.getByRole('button', { name: 'Notify' })).toBeVisible();
    await pauseClock(page);

    const first = region.locator('[data-controller="toast"]', { hasText: 'Notification 1 sent.' });
    await notify(page, first);
    await first.hover();
    await page.clock.runFor(2000); // past its 1500 ms timeout
    await expect(first).toBeVisible();
    await page.mouse.move(0, 0);
    await page.clock.runFor(2000); // the time left, and the fade
    await expect(first).toBeHidden();

    await page.getByLabel('Timeout (ms)').fill('0');
    const second = region.locator('[data-controller="toast"]', { hasText: 'Notification 2 sent.' });
    await notify(page, second);
    await expect(second).toBeVisible();
    await second.getByRole('button', { name: 'Close' }).click();
    await page.clock.runFor(400); // the fade
    await expect(second).toBeHidden();
});

test('a toast stays paused while it is still hovered or focused', async ({ page }) => {
    await page.clock.install();
    await page.goto('/lab/turbo-stream-toast');
    const region = page.getByRole('region', { name: 'Notifications' });
    await expect(page.getByRole('button', { name: 'Notify' })).toBeVisible();
    await pauseClock(page);

    const toast = region.locator('[data-controller="toast"]', { hasText: 'Notification 1 sent.' });
    await notify(page, toast);
    const close = toast.getByRole('button', { name: 'Close' });
    await close.hover();
    await close.focus();
    await page.mouse.move(0, 0);
    await page.clock.runFor(2000);
    await expect(toast).toBeVisible();

    await toast.hover();
    await page.getByLabel('Timeout (ms)').focus();
    await page.clock.runFor(2000);
    await expect(toast).toBeVisible();

    await page.mouse.move(0, 0);
    await page.clock.runFor(2000);
    await expect(toast).toBeHidden();
});

test('a toast in the permanent region still dismisses itself after a Turbo visit', async ({ page }) => {
    await page.goto('/lab/turbo-stream-toast');
    const region = page.getByRole('region', { name: 'Notifications' });

    await page.getByLabel('Timeout (ms)').fill('2000');
    await page.getByRole('button', { name: 'Notify' }).click();
    const toast = region.locator('[data-controller="toast"]', { hasText: 'Notification 1 sent.' });
    await expect(toast).toBeVisible();

    await visit(page, 'Go to turbo-nav', 'Page one');
    await expect(toast).toBeVisible();
    await expect(toast).toBeHidden({ timeout: 4000 });
});
