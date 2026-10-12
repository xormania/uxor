import type { Page } from '@playwright/test';
import { describeRecipe, expect, test } from '../../../../assets/test/browser/fixtures';

/*
 * The drawer's own interactions, as modal's spec has them: open on load, the backdrop and its content, the close
 * buttons, and a move in the DOM (Turbo, Live re-renders), open and closed. The preview renders it open.
 */

/** Takes the drawer out of the DOM and puts it back in place a moment later, as Turbo and Live morphs do. */
async function moveInTheDom(page: Page): Promise<void> {
    await page.locator('[data-controller="drawer"]').evaluate(async (element) => {
        const parent = element.parentNode!;
        const next = element.nextSibling;
        element.remove();
        await new Promise((resolve) => setTimeout(resolve, 50));
        parent.insertBefore(element, next);
    });
}

describeRecipe('flowbite-4/drawer', () => {
    test('is open on page load when asked to, as a modal', async ({ page, gotoExample }) => {
        await gotoExample('flowbite-4/drawer/default');
        const dialog = page.getByRole('dialog', { name: 'Filters' });
        const trigger = page.getByRole('button', { name: 'Filters' });

        await expect(dialog).toBeVisible();
        expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(true);
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');

        await page.keyboard.press('Escape');

        await expect(dialog).toBeHidden();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    test('closes on a click on the backdrop, not on a click on its content', async ({ page, gotoExample }) => {
        await gotoExample('flowbite-4/drawer/default');
        const dialog = page.getByRole('dialog', { name: 'Filters' });
        await expect(dialog).toBeVisible();

        await page.getByText('Narrow the list down').click();
        await expect(dialog).toBeVisible();

        // the drawer is docked to the left: the right edge of the viewport is backdrop
        const viewport = page.viewportSize()!;
        await page.mouse.click(viewport.width - 5, viewport.height / 2);

        await expect(dialog).toBeHidden();
        await expect(page.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'false');
    });

    test('closes with its close button and with a Drawer:Close button, and opens again from its trigger', async ({ page, gotoExample }) => {
        await gotoExample('flowbite-4/drawer/default');
        const dialog = page.getByRole('dialog', { name: 'Filters' });
        const trigger = page.getByRole('button', { name: 'Filters' });

        await dialog.getByRole('button', { name: 'Close' }).click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');

        await trigger.click();
        await expect(dialog).toBeVisible();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');

        await dialog.getByRole('button', { name: 'Apply' }).click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    test('stays open and modal after being moved in the DOM', async ({ page, gotoExample }) => {
        await gotoExample('flowbite-4/drawer/default');
        const dialog = page.getByRole('dialog', { name: 'Filters' });
        await expect(dialog).toBeVisible();

        await moveInTheDom(page);

        await expect(dialog).toBeVisible();
        expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(true);
        await expect(page.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
    });

    test('stays closed after being moved in the DOM once closed, though rendered open', async ({ page, gotoExample }) => {
        await gotoExample('flowbite-4/drawer/default');
        const dialog = page.getByRole('dialog', { name: 'Filters' });
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();

        await moveInTheDom(page);

        await expect(page.getByRole('dialog')).toBeHidden();
        await expect(page.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'false');
    });
});
