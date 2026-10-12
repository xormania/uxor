import { test, expect, dialogState } from './fixtures';

test('a non-modal drawer leaves the page usable', async ({ page }) => {
    await page.goto('/lab/live-drawer');
    const drawer = page.getByRole('dialog', { name: 'Side panel' });

    await page.getByRole('button', { name: 'Open side panel' }).click();
    await expect(drawer).toBeVisible();
    expect(await dialogState(drawer)).toEqual({ open: true, modal: false });

    await page.getByRole('button', { name: 'Re-render from the page' }).click();
    await expect(page.getByTestId('renders')).toHaveText('1');
    await expect(drawer).toBeVisible();

    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open side panel' })).toHaveAttribute('aria-expanded', 'false');
});

// the fixtures fail the test on any console or page error: the old controller must disconnect without its targets
test('a drawer whose container a Live re-render replaces is torn down cleanly, and the new one opens and closes', async ({ page }) => {
    await page.goto('/lab/live-drawer');
    const trigger = page.getByRole('button', { name: 'Open replaced drawer' });
    const drawer = page.getByRole('dialog', { name: 'Replaced drawer' });
    const openDialogs = () => page.evaluate(() => document.querySelectorAll('dialog[open]').length);

    // open: the morph moves the dialog into the new container, the old controller disconnects without it
    await trigger.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Re-render and replace' }).click();
    await expect(page.getByTestId('renders')).toHaveText('1');
    await expect(page.locator('#replaced-drawer-1')).toBeAttached();
    await expect(page.locator('#replaced-drawer-0')).toHaveCount(0);
    // the new controller starts as its `open` value says, like a cached copy: closed, the page not left inert
    await expect(drawer).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(await openDialogs()).toBe(0);

    // closed: the page is usable and the new instance opens and closes
    await page.getByRole('button', { name: 'Re-render from the page' }).click();
    await expect(page.getByTestId('renders')).toHaveText('2');
    await expect(page.locator('#replaced-drawer-2')).toBeAttached();
    await expect(drawer).toBeHidden();
    expect(await openDialogs()).toBe(0);
    await trigger.click();
    await expect(drawer).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await dialogState(drawer)).toEqual({ open: true, modal: true });
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    expect(await openDialogs()).toBe(0);
});
