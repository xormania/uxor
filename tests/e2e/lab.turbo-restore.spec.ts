import type { Page } from '@playwright/test';
import { test, expect, markDocument, dialogState } from './fixtures';
import { back, forward, holdUntilCopied, recordFirstFrames, visit, visitAndBack } from './transitions';

/*
 * Overlays left open when a link inside them visits another page, and a tooltip shown on such a link: Back shows them
 * closed, and they open again as they should (a menu's markup and state agree, a dialog is modal). Page two links a stylesheet page one lacks; held
 * until Turbo has copied page one (`holdUntilCopied`), it makes Turbo copy page one before its controllers disconnect, the order a slow stylesheet
 * gives in production.
 */

type Overlay = {
    name: string;
    open: (page: Page) => Promise<void>;
    link: (page: Page) => ReturnType<Page['getByRole']>;
    expectOpen: (page: Page) => Promise<void>;
    expectClosed: (page: Page) => Promise<void>;
};

const overlays: Overlay[] = [
    {
        name: 'a dropdown menu',
        open: (page) => page.getByRole('button', { name: 'Menu' }).click(),
        link: (page) => page.getByRole('menuitem', { name: 'Page two from the menu' }),
        expectOpen: async (page) => {
            await expect(page.getByRole('menuitem', { name: 'Page two from the menu' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'true');
        },
        expectClosed: async (page) => {
            await expect(page.getByRole('menuitem', { name: 'Page two from the menu', includeHidden: true })).toBeHidden();
            await expect(page.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
        },
    },
    {
        name: 'a modal',
        open: (page) => page.getByRole('button', { name: 'Open the modal' }).click(),
        link: (page) => page.getByRole('link', { name: 'Page two from the modal' }),
        expectOpen: async (page) => expect.poll(() => dialogState(page.locator('dialog#modal-restore-modal'))).toEqual({ open: true, modal: true }),
        expectClosed: async (page) => {
            await expect.poll(() => dialogState(page.locator('dialog#modal-restore-modal'))).toEqual({ open: false, modal: false });
            await expect(page.getByRole('button', { name: 'Open the modal' })).toHaveAttribute('aria-expanded', 'false');
        },
    },
    {
        name: 'a drawer',
        open: (page) => page.getByRole('button', { name: 'Open the drawer' }).click(),
        link: (page) => page.getByRole('link', { name: 'Page two from the drawer' }),
        expectOpen: async (page) => expect.poll(() => dialogState(page.locator('dialog#drawer-restore-drawer'))).toEqual({ open: true, modal: true }),
        expectClosed: async (page) => {
            await expect.poll(() => dialogState(page.locator('dialog#drawer-restore-drawer'))).toEqual({ open: false, modal: false });
            await expect(page.getByRole('button', { name: 'Open the drawer' })).toHaveAttribute('aria-expanded', 'false');
        },
    },
    {
        // shown while the pointer is on the link it describes, when that link visits
        name: 'a tooltip',
        open: async (page) => {
            await page.mouse.move(0, 0);
            await page.getByRole('link', { name: 'Page two from the tooltip link' }).hover();
        },
        link: (page) => page.getByRole('link', { name: 'Page two from the tooltip link' }),
        expectOpen: async (page) => {
            await expect(page.getByRole('tooltip', { name: 'Opens page two' })).toBeVisible();
            await expect(page.getByRole('link', { name: 'Page two from the tooltip link' })).toHaveAccessibleDescription('Opens page two');
        },
        expectClosed: async (page) => {
            await expect(page.getByRole('tooltip', { name: 'Opens page two', includeHidden: true })).toBeHidden();
            await expect(page.getByRole('link', { name: 'Page two from the tooltip link' })).toHaveAccessibleDescription('Opens page two');
        },
    },
];

for (const slow of [false, true]) {
    for (const overlay of overlays) {
        test(`${overlay.name} left open by a visit is closed after Back, and opens again${slow ? ', the next page waiting for a stylesheet' : ''}`, async ({ page }) => {
            const held = slow ? await holdUntilCopied(page, '**/lab/slow.css') : null;
            await page.goto('/lab/turbo-restore');
            const sameDocument = await markDocument(page);
            await overlay.open(page);
            await overlay.expectOpen(page);

            await visit(page, overlay.link(page), 'Page two');
            if (held) {
                expect(held(), 'page two waited for its stylesheet until Turbo had copied page one').toBe(1);
            }
            await back(page, 'Page one');

            await overlay.expectClosed(page);
            await overlay.open(page);
            await overlay.expectOpen(page);
            await sameDocument.expectKept();
        });
    }
}

test('a toast outside the permanent region is not shown again on Back', async ({ page }) => {
    await page.goto('/lab/turbo-restore');
    await expect(page.getByTestId('page-toast')).toHaveText('Saved on page one.');
    await visitAndBack(page);
    await expect(page.getByTestId('page-toast')).toHaveCount(0);

    // a full load renders the page's toast again
    await page.reload();
    await expect(page.getByTestId('page-toast')).toHaveText('Saved on page one.');
});

test('a toast moved into the permanent region stays across visits', async ({ page }) => {
    await page.goto('/lab/turbo-restore');
    const sameDocument = await markDocument(page);
    const toast = page.getByTestId('page-toast');
    await toast.evaluate((element) => document.getElementById('toasts')!.append(element));
    await visit(page, 'Go to page two', 'Page two');
    await expect(toast).toHaveText('Saved on page one.');
    await back(page, 'Page one');
    await expect(toast).toHaveCount(1);
    await sameDocument.expectKept();
});

test('a toast outside the permanent region stays shown while a frame visit is promoted to history, and Back does not show it again', async ({ page }) => {
    await page.goto('/lab/turbo-restore');
    const firstFrames = await recordFirstFrames(page, { toast: '[data-testid="page-toast"]' });
    const toast = page.getByTestId('page-toast');
    await expect(toast).toHaveText('Saved on page one.');

    // Turbo copies the page as the frame visit starts, then dispatches turbo:before-cache with the page still shown
    await visit(page, 'Next step', { step: 1 });
    await expect(toast).toHaveText('Saved on page one.');

    await back(page, { step: 0 });
    await expect(toast).toHaveCount(0);
    await forward(page, { step: 1 });
    await expect(toast).toHaveCount(0);
    expect(await firstFrames(2)).toEqual([
        { render: 1, url: '/lab/turbo-restore', visible: { toast: false } },
        { render: 2, url: '/lab/turbo-restore?step=1', visible: { toast: false } },
    ]);
});

test('a dropdown menu whose item steps a frame promoted to history stays open, and Back shows it closed', async ({ page }) => {
    await page.goto('/lab/turbo-restore');
    const menu = overlays[0];
    const firstFrames = await recordFirstFrames(page, { menu: '#dropdown-restore-menu' });
    await menu.open(page);
    await menu.expectOpen(page);

    await visit(page, page.getByRole('menuitem', { name: 'Step 5 from the menu' }), { step: 5 });
    await menu.expectOpen(page);
    await page.keyboard.press('Escape');
    await menu.expectClosed(page);
    await menu.open(page);

    await back(page, { step: 0 });
    await menu.expectClosed(page);
    expect(await firstFrames(1)).toEqual([{ render: 1, url: '/lab/turbo-restore', visible: { menu: false } }]);
    await menu.open(page);
    await menu.expectOpen(page);
    await page.getByRole('heading', { level: 1 }).click();
    await menu.expectClosed(page);
});
