import { test, expect, dialogState } from './fixtures';

// the fixtures fail the test on any console or page error: the old controller must disconnect without its targets
test('a modal whose container a Live re-render replaces is torn down cleanly, and the new one opens and closes', async ({ page }) => {
    await page.goto('/lab/live-modal');
    const trigger = page.getByRole('button', { name: 'Open replaced modal' });
    const dialog = page.getByRole('dialog', { name: 'Replaced modal' });
    const openDialogs = () => page.evaluate(() => document.querySelectorAll('dialog[open]').length);

    // open: the morph moves the dialog into the new container, the old controller disconnects without it
    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Re-render and replace' }).click();
    await expect(page.getByTestId('renders')).toHaveText('1');
    await expect(page.locator('#replaced-modal-1')).toBeAttached();
    await expect(page.locator('#replaced-modal-0')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    expect(await dialogState(dialog)).toEqual({ open: true, modal: true });
    // the new container's trigger, rendered anew, says the modal it now holds is open (the page behind is inert)
    const newTrigger = page.locator('#replaced-modal-1 [data-flowbite-modal-target="trigger"]');
    await expect(newTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog).toHaveAttribute('aria-hidden', 'false');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await expect(newTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(await openDialogs()).toBe(0);

    // closed: the page is usable and the new instance opens and closes
    await page.getByRole('button', { name: 'Re-render from the page' }).click();
    await expect(page.getByTestId('renders')).toHaveText('2');
    await expect(page.locator('#replaced-modal-2')).toBeAttached();
    await expect(dialog).toBeHidden();
    expect(await openDialogs()).toBe(0);
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await dialogState(dialog)).toEqual({ open: true, modal: true });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(await openDialogs()).toBe(0);
});
