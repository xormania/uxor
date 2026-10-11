import type { Page } from '@playwright/test';
import { test, expect, expectA11y, turboVisitDone } from './fixtures';
import { back, forward, shown, visit } from './transitions';

/*
 * The SideNav tree on /lab/side-nav/<page> (rendered by every page) and in the demo's data-turbo-permanent Sidebar.
 * The state checked after each transition (a click, a key, a Turbo visit, Back, Forward, a reload) is the whole tree:
 * which branches are open, which item is the current page, which treeitem holds the Tab stop, and where the focus is.
 */

const tree = (page: Page) => page.getByRole('tree', { name: 'Guide' });
const treeitem = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true });
const branches = ['Guides', 'Advanced', 'Reference'] as const;

/** The tree's state: each branch's `aria-expanded` (null when hidden), the current item, the one Tab stop. */
async function treeState(page: Page) {
    return tree(page).evaluate((element) => {
        const items = [...element.querySelectorAll<HTMLElement>('[role="treeitem"]')];
        const name = (item: HTMLElement) => (item.getAttribute('aria-label') ?? item.textContent ?? '').trim();
        return {
            open: items.filter((item) => item.hasAttribute('aria-expanded') && 'true' === item.getAttribute('aria-expanded')).map(name),
            current: items.filter((item) => 'page' === item.getAttribute('aria-current')).map(name),
            tabStops: items.filter((item) => '0' === item.getAttribute('tabindex')).map(name),
            shown: items.filter((item) => item.getClientRects().length > 0).map(name),
        };
    });
}

async function expectTree(page: Page, expected: { open: string[]; current: string[]; tabStop: string }) {
    await expect.poll(() => treeState(page)).toMatchObject({ open: expected.open, current: expected.current, tabStops: [expected.tabStop] });
    for (const branch of branches) {
        const item = treeitem(page, branch);
        if (await item.isVisible()) {
            await expect(item).toHaveAttribute('aria-expanded', String(expected.open.includes(branch)));
        }
    }
}

test('the tree has the ARIA tree structure, and the branch of the current page renders open', async ({ page }) => {
    await page.goto('/lab/side-nav/three');
    await expect(tree(page)).toBeVisible();
    await expectTree(page, { open: ['Guides', 'Advanced'], current: ['Deep page'], tabStop: 'Deep page' });
    expect((await treeState(page)).shown).toEqual(['Overview', 'Guides', 'Getting started', 'Advanced', 'Deep page', 'Reference']);
    await expect(treeitem(page, 'Advanced').getByRole('group')).toBeVisible();
    await expect(treeitem(page, 'Reference')).toHaveAttribute('aria-expanded', 'false');
    await expect(treeitem(page, 'Reference').getByRole('group')).toBeHidden();
    // the server opened them: the page's HTML, before any controller
    const html = await (await page.request.get('/lab/side-nav/three')).text();
    expect(html).toMatch(/aria-label="Guides" aria-expanded="false"/); // the lab marks the current page from the URL only
    const demo = await (await page.request.get('/demo/settings/profile')).text();
    expect(demo).toMatch(/aria-label="Settings" aria-expanded="true"/); // `route` marks it on the server
});

test('the keyboard moves through the shown treeitems, opens and closes branches and follows links', async ({ page }) => {
    // the type-ahead's timer on Playwright's clock: runFor() moves it on at once
    await page.clock.install();
    await page.goto('/lab/side-nav');
    await expectTree(page, { open: [], current: ['Overview'], tabStop: 'Overview' });
    await page.getByTestId('page').click();
    await page.keyboard.press('Shift+Tab'); // back from the page into the tree: its one Tab stop
    await expect(treeitem(page, 'Overview')).toBeFocused();

    const press = async (key: string, focused: string) => {
        await page.keyboard.press(key);
        await expect(treeitem(page, focused)).toBeFocused();
        expect((await treeState(page)).tabStops).toEqual([focused]);
    };
    await press('ArrowUp', 'Overview');
    await press('ArrowDown', 'Guides');
    await press('ArrowRight', 'Guides');
    await expect(treeitem(page, 'Guides')).toHaveAttribute('aria-expanded', 'true');
    await press('ArrowRight', 'Getting started');
    await press('ArrowDown', 'Advanced');
    await press('ArrowRight', 'Advanced');
    await press('ArrowRight', 'Deep page');
    await press('ArrowRight', 'Deep page'); // a link has nothing to open
    await press('ArrowLeft', 'Advanced');
    await expect(treeitem(page, 'Advanced')).toHaveAttribute('aria-expanded', 'true');
    await press('ArrowLeft', 'Advanced');
    await expect(treeitem(page, 'Advanced')).toHaveAttribute('aria-expanded', 'false');
    await press('ArrowLeft', 'Guides');
    await press('End', 'Reference');
    await press('Enter', 'Reference');
    await expect(treeitem(page, 'Reference')).toHaveAttribute('aria-expanded', 'true');
    await press('End', 'Glossary');
    await press('Home', 'Overview');
    // type-ahead: the same letter again moves on to the next match, several letters refine it
    await press('g', 'Guides');
    await press('g', 'Getting started');
    await press('g', 'Glossary');
    await page.clock.runFor(600); // the typed letters are forgotten after 500 ms
    await press('a', 'Advanced');
    await press('p', 'API');
    await press('Home', 'Overview');
    await page.keyboard.type('re');
    await expect(treeitem(page, 'Reference')).toBeFocused();
    await press(' ', 'Reference');
    await expect(treeitem(page, 'Reference')).toHaveAttribute('aria-expanded', 'false');

    // closing the branch that holds the focus brings the focus up to it
    await press('Home', 'Overview');
    await press('ArrowDown', 'Guides');
    await press('ArrowRight', 'Getting started');
    await treeitem(page, 'Guides').locator(':scope > [data-side-nav-toggle]').click();
    await expect(treeitem(page, 'Guides')).toBeFocused();
    await expect(treeitem(page, 'Guides')).toHaveAttribute('aria-expanded', 'false');
    expect((await treeState(page)).tabStops).toEqual(['Guides']);

    // Enter follows a link, as a Turbo visit
    await page.evaluate(() => ((window as any).__sameDocument = true));
    await press('ArrowRight', 'Guides');
    await press('ArrowRight', 'Getting started');
    await page.keyboard.press('Enter');
    await shown(page, 'Page two');
    expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);
    await expectTree(page, { open: ['Guides'], current: ['Getting started'], tabStop: 'Getting started' });
});

test('the open branches hold across Turbo visits, Back, Forward and a reload, over the cached copy of the page', async ({ page }) => {
    await page.goto('/lab/side-nav');
    await page.evaluate(() => ((window as any).__sameDocument = true));
    await treeitem(page, 'Reference').locator(':scope > [data-side-nav-toggle]').click();
    await expectTree(page, { open: ['Reference'], current: ['Overview'], tabStop: 'Reference' });

    // the branch of the new page opens, the one opened before stays open
    await visit(page, 'Go to page two', 'Page two');
    await expectTree(page, { open: ['Guides', 'Reference'], current: ['Getting started'], tabStop: 'Getting started' });

    // closed after Turbo cached page one open: Back shows the saved state, not the copy's
    await treeitem(page, 'Reference').locator(':scope > [data-side-nav-toggle]').click();
    await expectTree(page, { open: ['Guides'], current: ['Getting started'], tabStop: 'Reference' });
    await back(page, 'Page one');
    await expectTree(page, { open: ['Guides'], current: ['Overview'], tabStop: 'Overview' });

    await forward(page, 'Page two');
    await expectTree(page, { open: ['Guides'], current: ['Getting started'], tabStop: 'Getting started' });
    expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);

    await page.reload();
    await expectTree(page, { open: ['Guides'], current: ['Getting started'], tabStop: 'Getting started' });

    // a branch closed on its own page opens again on the next visit to it
    await treeitem(page, 'Guides').locator(':scope > [data-side-nav-toggle]').click();
    await visit(page, 'Go to page four', 'Page four');
    await expectTree(page, { open: ['Reference'], current: ['API'], tabStop: 'API' });
    await visit(page, 'Go to page three', 'Page three');
    await expectTree(page, { open: ['Guides', 'Advanced', 'Reference'], current: ['Deep page'], tabStop: 'Deep page' });
});

test('a link to a fragment of the page is never the current page', async ({ page }) => {
    await page.goto('/lab/side-nav');
    await treeitem(page, 'Reference').locator(':scope > [data-side-nav-toggle]').click();
    await treeitem(page, 'Glossary').click();
    await expect(page).toHaveURL(/\/lab\/side-nav#glossary$/);
    await page.reload();
    await expectTree(page, { open: ['Reference'], current: ['Overview'], tabStop: 'Overview' });
});

test('repeated Turbo visits leave one controller on the tree', async ({ page }) => {
    await page.goto('/lab/side-nav');
    for (const [link, heading] of [['Go to page two', 'Page two'], ['Go to page three', 'Page three'], ['Go to page one', 'Page one'], ['Go to page four', 'Page four'], ['Go to page one', 'Page one']]) {
        await visit(page, link, heading);
    }
    await expect(page.locator('[data-controller~="side-nav"]')).toHaveCount(1);
    // one toggle per click and one step per key: a second controller would close it again, or move twice
    await treeitem(page, 'Guides').locator(':scope > [data-side-nav-toggle]').click();
    await expect(treeitem(page, 'Guides')).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowDown');
    await expect(treeitem(page, 'Reference')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(treeitem(page, 'Reference')).toHaveAttribute('aria-expanded', 'false');
    await expect(treeitem(page, 'Reference')).toBeFocused();
});

test('in the demo\'s data-turbo-permanent sidebar, the tree follows the current page across visits', async ({ page }) => {
    await page.goto('/demo');
    const nav = page.getByRole('tree', { name: 'xor' });
    await page.evaluate(() => ((window as any).__sidebar = document.getElementById('sidebar')));
    await expect(nav.getByRole('treeitem', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('treeitem', { name: 'Settings' })).toHaveAttribute('aria-expanded', 'false');

    const settings = nav.getByRole('treeitem', { name: 'Settings' });
    await settings.locator(':scope > [data-side-nav-toggle]').click();
    await nav.getByRole('treeitem', { name: 'Profile' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await turboVisitDone(page);
    expect(await page.evaluate(() => (window as any).__sidebar === document.getElementById('sidebar'))).toBe(true);
    await expect(nav.getByRole('treeitem', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('treeitem', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    await expect(nav.getByRole('treeitem', { name: 'Profile' })).toHaveAttribute('tabindex', '0');

    await settings.locator(':scope > [data-side-nav-toggle]').click();
    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await nav.getByRole('treeitem', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await turboVisitDone(page);
    await expect(nav.getByRole('treeitem', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('treeitem', { name: 'Settings' })).toHaveAttribute('aria-expanded', 'false');
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await turboVisitDone(page);
    await expect(nav.getByRole('treeitem', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('treeitem', { name: 'Settings' })).toHaveAttribute('aria-expanded', 'true');
});

test('collapsing the demo\'s sidebar moves the Tab stop off a hidden current item to its shown branch', async ({ page }) => {
    await page.goto('/demo/settings/profile');
    const nav = page.getByRole('tree', { name: 'xor' });
    await expect(nav.getByRole('treeitem', { name: 'Profile' })).toHaveAttribute('tabindex', '0');

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(nav.getByRole('treeitem', { name: 'Profile' })).toBeHidden();
    await expect(nav.getByRole('treeitem', { name: 'Settings' })).toHaveAttribute('tabindex', '0');
    await expect(nav.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
    await nav.getByRole('treeitem', { name: 'Settings' }).focus();
    await expect(nav.getByRole('treeitem', { name: 'Settings' })).toBeFocused();

    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(nav.getByRole('treeitem', { name: 'Profile' })).toBeVisible();
    await expect(nav.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
});

for (const system of ['light', 'dark'] as const) {
    for (const theme of ['light', 'dark'] as const) {
        test.describe(`system ${system}, ${theme} theme chosen`, () => {
            test.use({ colorScheme: system });

            test('the tree passes axe, its current item and focus ring in the theme\'s colors', async ({ page }) => {
                await page.goto('/lab/side-nav/three');
                await page.evaluate((chosen) => localStorage.setItem('theme', chosen), theme);
                await page.reload();
                if ('dark' === theme) {
                    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
                } else {
                    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
                }
                await treeitem(page, 'Reference').locator(':scope > [data-side-nav-toggle]').click();
                await page.keyboard.press('ArrowUp'); // a visible focus ring on the current item
                await expect(treeitem(page, 'Deep page')).toBeFocused();
                await expectA11y(page, { impact: 'all', include: '[role="tree"]' });

                // the page's own text follows the chosen theme, not the system (no `dark:` class of flowbite.min.css)
                const colors = await page.evaluate(() => {
                    const probe = document.createElement('span');
                    probe.className = 'text-body';
                    document.body.append(probe);
                    const body = getComputedStyle(probe).color;
                    probe.remove();
                    return { body, description: getComputedStyle(document.querySelector('main h1 + p')!).color };
                });
                expect(colors.description).toBe(colors.body);
            });
        });
    }
}
