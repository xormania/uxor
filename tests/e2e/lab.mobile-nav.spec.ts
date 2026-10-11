import type { Page } from '@playwright/test';
import { test, expect, expectA11y, markDocument } from './fixtures';
import { shown } from './transitions';

/*
 * The MobileNav on /lab/mobile-nav/<page>: a menu button in a Navbar opens a modal Drawer holding a SideNav, and the same
 * tree is beside the page on wide screens. The state checked after each transition (the button, Escape, the backdrop,
 * the close button, a link, a Turbo visit, Back, Forward, a reload, the screen growing or shrinking) is the whole
 * drawer: open or not, modal, the button's `aria-expanded`, where the focus is, and the tree inside.
 */

const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 800 };

const menu = (page: Page) => page.getByRole('button', { name: 'Open menu' });
const drawer = (page: Page) => page.locator('dialog#drawer-lab-mobile-nav');
const drawerTree = (page: Page) => drawer(page).getByRole('tree', { name: 'Lab pages' });
const sideTree = (page: Page) => page.getByTestId('side-tree').getByRole('tree', { name: 'Lab pages' });
const toggle = (tree: ReturnType<typeof drawerTree>, branch: string) =>
    tree.getByRole('treeitem', { name: branch, exact: true }).locator(':scope > [data-side-nav-toggle]');

/** The drawer's state: open, modal, the button's aria-expanded, and the focus (the button, a treeitem of the drawer, or elsewhere). */
async function drawerState(page: Page) {
    return page.evaluate(() => {
        const dialog = document.getElementById('drawer-lab-mobile-nav') as HTMLDialogElement;
        const button = document.querySelector('[aria-controls="drawer-lab-mobile-nav"]')!;
        const active = document.activeElement;
        const label = (element: Element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
        let focus = 'elsewhere';
        if (active === button) {
            focus = 'menu button';
        } else if (active && dialog.contains(active)) {
            focus = `drawer: ${label(active)}`;
        }
        return { open: dialog.open, modal: dialog.matches(':modal'), expanded: button.getAttribute('aria-expanded'), focus };
    });
}

async function expectDrawer(page: Page, open: boolean, focus?: string) {
    await expect.poll(() => drawerState(page)).toMatchObject({ open, modal: open, expanded: String(open), ...(focus ? { focus } : {}) });
    if (open) {
        await expect(drawerTree(page)).toBeVisible();
    } else {
        await expect(drawer(page)).toBeHidden();
    }
}

/** The tree's open branches and current item. */
async function treeState(tree: ReturnType<typeof drawerTree>) {
    return tree.evaluate((element) => {
        const items = [...element.querySelectorAll<HTMLElement>('[role="treeitem"]')];
        const name = (item: HTMLElement) => (item.getAttribute('aria-label') ?? item.textContent ?? '').trim();
        return {
            open: items.filter((item) => 'true' === item.getAttribute('aria-expanded')).map(name),
            current: items.filter((item) => 'page' === item.getAttribute('aria-current')).map(name),
        };
    });
}

test.describe('on a phone', () => {
    test.use({ viewport: phone });

    test('the menu button opens the drawer as a modal on the current page; Escape, the backdrop and the close button close it and give the focus back', async ({ page }) => {
        await page.goto('/lab/mobile-nav/three');
        await expect(menu(page)).toBeVisible();
        await expect(menu(page)).toHaveAttribute('aria-controls', 'drawer-lab-mobile-nav');
        await expect(menu(page)).toHaveAttribute('aria-haspopup', 'dialog');
        await expectDrawer(page, false);
        await expect(sideTree(page)).toBeHidden();

        // the click: the focus goes to the current page, in its open branches
        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Deep page');
        await expect(page.getByRole('dialog', { name: 'Lab app' })).toBeVisible();
        expect(await treeState(drawerTree(page))).toEqual({ open: ['Guides', 'Advanced'], current: ['Deep page'] });
        await page.keyboard.press('Escape');
        await expectDrawer(page, false, 'menu button');

        // the keyboard
        await page.keyboard.press('Enter');
        await expectDrawer(page, true, 'drawer: Deep page');
        await page.keyboard.press('ArrowUp'); // the tree's keys work inside the drawer
        await expectDrawer(page, true, 'drawer: Advanced');
        await page.keyboard.press('Escape');
        await expectDrawer(page, false, 'menu button');

        // the backdrop, right of the drawer (w-80)
        await page.keyboard.press(' ');
        await expectDrawer(page, true, 'drawer: Deep page');
        await page.mouse.click(phone.width - 20, phone.height / 2);
        await expectDrawer(page, false, 'menu button');

        // the close button
        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Deep page');
        await drawer(page).getByRole('button', { name: 'Close' }).click();
        await expectDrawer(page, false, 'menu button');
    });

    test('without a current page in the drawer, the focus goes to the tree\'s first item', async ({ page }) => {
        await page.goto('/lab/mobile-nav');
        await drawer(page).locator('[aria-current="page"]').evaluate((item) => item.removeAttribute('aria-current'));
        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Overview');
    });

    test('a link inside closes the drawer and visits the page; Back, Forward and a reload show it closed, its tree on the current page', async ({ page }) => {
        await page.goto('/lab/mobile-nav');
        const sameDocument = await markDocument(page);
        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Overview');
        await toggle(drawerTree(page), 'Guides').click();
        await drawerTree(page).getByRole('treeitem', { name: 'Getting started' }).click();
        await shown(page, 'Page two');
        await expectDrawer(page, false);
        await sameDocument.expectKept();

        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Getting started');
        expect(await treeState(drawerTree(page))).toEqual({ open: ['Guides'], current: ['Getting started'] });
        // a link to a fragment of the page closes it too
        await toggle(drawerTree(page), 'Reference').click();
        await drawerTree(page).getByRole('treeitem', { name: 'Glossary' }).click();
        await expect(page).toHaveURL(/\/lab\/mobile-nav\/two#glossary$/);
        await expectDrawer(page, false);

        await page.goBack(); // the fragment
        await page.goBack();
        await shown(page, 'Page one');
        await expectDrawer(page, false);
        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Overview');
        expect(await treeState(drawerTree(page))).toEqual({ open: ['Guides', 'Reference'], current: ['Overview'] });
        await page.keyboard.press('Escape');

        await page.goForward();
        await shown(page, 'Page two');
        await expectDrawer(page, false);
        await page.reload();
        await expectDrawer(page, false);
        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Getting started');
        expect(await treeState(drawerTree(page))).toEqual({ open: ['Guides', 'Reference'], current: ['Getting started'] });
        await sameDocument.expectReplaced(); // the reload was a full load
    });

    test('a link opening another tab or window, a download or a modifier click leaves the drawer open', async ({ page }) => {
        await page.goto('/lab/mobile-nav');
        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Overview');
        // links this tab does not follow; the page cancels them after the controller has seen the click (bubble order)
        await page.evaluate(() => {
            const dialog = document.getElementById(document.querySelector('[aria-haspopup="dialog"]')!.getAttribute('aria-controls')!)!;
            for (const [text, attribute, value] of [['Blank', 'target', '_blank'], ['Named', 'target', 'docs'], ['File', 'download', '']]) {
                const link = document.createElement('a');
                link.href = '/lab/mobile-nav/two';
                link.textContent = text;
                link.setAttribute(attribute, value);
                dialog.querySelector('nav')!.append(link);
            }
            window.addEventListener('click', (event) => {
                if ((event.target as Element).closest('[target], [download]')) {
                    event.preventDefault();
                }
            });
        });
        const dialog = page.getByRole('dialog');
        for (const name of ['Blank', 'Named', 'File']) {
            await dialog.getByRole('link', { name, exact: true }).click();
            await expect(page.getByRole('dialog')).toBeVisible();
        }
        await dialog.getByRole('treeitem', { name: 'Overview' }).click({ modifiers: ['ControlOrMeta'] });
        await expect(page.getByRole('dialog')).toBeVisible();
    });

    test('Back and Forward while the drawer is open: the copy Turbo cached shows it closed', async ({ page }) => {
        // the open state of the drawer in each page Turbo renders from its cache
        await page.addInitScript(() => {
            (window as any).__restored = [];
            document.addEventListener('turbo:before-render', (event: any) => {
                const body = event.detail.newBody;
                const open = body.querySelector('#drawer-lab-mobile-nav')?.hasAttribute('open');
                (window as any).__restored.push({ open, expanded: body.querySelector('[aria-controls="drawer-lab-mobile-nav"]')?.getAttribute('aria-expanded') });
            });
        });
        await page.goto('/lab/mobile-nav');
        await page.getByRole('link', { name: 'Go to page two' }).click();
        await shown(page, 'Page two');

        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Getting started');
        await page.goBack();
        await shown(page, 'Page one');
        await expectDrawer(page, false);

        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Overview');
        await page.goForward();
        await shown(page, 'Page two');
        await expectDrawer(page, false);
        // every page rendered so far, the cached copies included, had the drawer closed
        expect(await page.evaluate(() => (window as any).__restored)).toEqual(Array(3).fill({ open: false, expanded: 'false' }));

        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Getting started');
    });

    test('repeated Turbo visits leave one controller on the drawer', async ({ page }) => {
        await page.addInitScript(() => {
            (window as any).__focusCalls = 0;
            const focus = HTMLElement.prototype.focus;
            HTMLElement.prototype.focus = function (...args) {
                (window as any).__focusCalls++;
                return focus.apply(this, args);
            };
        });
        await page.goto('/lab/mobile-nav');
        const sameDocument = await markDocument(page);
        for (const [link, heading] of [['Go to page two', 'Page two'], ['Go to page three', 'Page three'], ['Go to page one', 'Page one']]) {
            await page.getByRole('link', { name: link }).click();
            await shown(page, heading);
        }
        for (const [item, heading] of [['Getting started', 'Page two'], ['Overview', 'Page one']]) {
            await menu(page).click();
            await drawerTree(page).getByRole('treeitem', { name: item }).click();
            await shown(page, heading);
        }
        await page.goBack();
        await shown(page, 'Page two');
        await page.goForward();
        await shown(page, 'Page one');
        await sameDocument.expectKept();
        await expect(page.locator('[data-controller~="mobile-nav"]')).toHaveCount(1);
        await expect(page.locator('dialog')).toHaveCount(1);

        // one opening focuses twice: the button, then the current page; a second controller would do it again
        await page.evaluate(() => ((window as any).__focusCalls = 0));
        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Overview');
        expect(await page.evaluate(() => (window as any).__focusCalls)).toBe(2);
        await page.keyboard.press('Escape');
        await expectDrawer(page, false, 'menu button');
    });

    test('the screen growing to the desktop width closes the drawer, and the tree beside the page shows its open branches', async ({ page }) => {
        await page.goto('/lab/mobile-nav');
        await menu(page).click();
        await toggle(drawerTree(page), 'Reference').click();
        await expectDrawer(page, true);

        await page.setViewportSize(desktop);
        await expectDrawer(page, false);
        await expect(menu(page)).toBeHidden();
        await expect(sideTree(page)).toBeVisible();
        await expect.poll(() => treeState(sideTree(page))).toEqual({ open: ['Reference'], current: ['Overview'] });

        // and back: a branch opened beside the page is open in the drawer
        await toggle(sideTree(page), 'Guides').click();
        await page.setViewportSize(phone);
        await expect(sideTree(page)).toBeHidden();
        await menu(page).click();
        await expectDrawer(page, true, 'drawer: Overview');
        await expect.poll(() => treeState(drawerTree(page))).toEqual({ open: ['Guides', 'Reference'], current: ['Overview'] });
    });
});

test.describe('on a desktop', () => {
    test.use({ viewport: desktop });

    test('the menu button is hidden, the tree is beside the page, and no id is used twice', async ({ page }) => {
        await page.goto('/lab/mobile-nav/two');
        await expect(menu(page)).toBeHidden();
        await expectDrawer(page, false);
        await expect(sideTree(page)).toBeVisible();
        await expect(sideTree(page).getByRole('treeitem', { name: 'Getting started' })).toHaveAttribute('aria-current', 'page');
        // the tree renders twice, in the drawer and beside the page
        await expect(page.getByRole('tree', { name: 'Lab pages', includeHidden: true })).toHaveCount(2);
        const duplicates = await page.evaluate(() => {
            const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
            return ids.filter((id, index) => ids.indexOf(id) !== index);
        });
        expect(duplicates).toEqual([]);
    });
});

for (const theme of ['light', 'dark'] as const) {
    test.describe(`${theme} theme`, () => {
        test.use({ viewport: phone, colorScheme: theme });

        test('the open drawer passes axe', async ({ page }) => {
            await page.goto('/lab/mobile-nav/three');
            if ('dark' === theme) {
                await expect(page.locator('html')).toHaveClass(/\bdark\b/);
            } else {
                await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
            }
            await expectA11y(page, { impact: 'serious' }, 'closed');
            await menu(page).click();
            await expectDrawer(page, true, 'drawer: Deep page');
            await expectA11y(page, { impact: 'all', include: '#drawer-lab-mobile-nav' }, 'open');
        });
    });
}
