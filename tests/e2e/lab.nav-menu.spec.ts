import type { Locator, Page } from '@playwright/test';
import { test, expect, expectA11y, markDocument } from './fixtures';
import { holdUntilCopied, shown } from './transitions';

/*
 * The NavMenu on /lab/nav-menu/<page>: a disclosure navigation in a sticky Navbar, submenus nested two levels deep,
 * the same menu (vertical) in a MobileNav's drawer on phones, and an account menu at the right edge of a
 * data-turbo-permanent Navbar. The state checked after each transition (a click, Enter, Space, Escape, Tab, a click
 * outside, a link, a Turbo visit, Back, Forward, a reload, a scroll) is the whole menu: the expanded buttons, the
 * submenus shown, the current link, the highlighted buttons and the focus.
 */

const phone = { width: 390, height: 844 };
const desktop = { width: 1280, height: 800 };

const barMenu = (page: Page) => page.getByTestId('bar-menu');
const drawerMenu = (page: Page) => page.getByTestId('drawer-menu');
const accountMenu = (page: Page) => page.getByTestId('account-menu');
const button = (menu: Locator, name: string) => menu.getByRole('button', { name, exact: true });
const link = (menu: Locator, name: string) => menu.getByRole('link', { name, exact: true });
const mobileMenuButton = (page: Page) => page.getByRole('button', { name: 'Open menu' });
const drawer = (page: Page) => page.locator('dialog#drawer-lab-nav-menu');

/** The menu's state: expanded buttons, submenus shown (their ids), current links, highlighted buttons, and the focus. */
async function menuState(menu: Locator) {
    return menu.evaluate((root) => {
        const name = (element: Element) => (element.textContent ?? '').trim();
        const buttons = [...root.querySelectorAll('button[aria-controls]')];
        const active = document.activeElement;
        return {
            expanded: buttons.filter((button) => 'true' === button.getAttribute('aria-expanded')).map(name),
            shown: [...root.querySelectorAll('ul[id]')].filter((panel) => panel.getClientRects().length > 0).map((panel) => panel.id),
            current: [...root.querySelectorAll('a[aria-current="page"]')].map(name),
            highlighted: buttons.filter((button) => '600' === getComputedStyle(button).fontWeight).map(name),
            focus: active && root.contains(active) ? name(active) : 'outside',
        };
    });
}

async function expectMenu(menu: Locator, expected: Partial<Awaited<ReturnType<typeof menuState>>>) {
    await expect.poll(() => menuState(menu)).toMatchObject(expected);
}

async function duplicateIds(page: Page) {
    return page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
        return ids.filter((id, index) => ids.indexOf(id) !== index);
    });
}

test.describe('on a desktop', () => {
    test.use({ viewport: desktop });

    test('the buttons control their submenus, the current page and its submenus are marked, and no id is used twice', async ({ page }) => {
        await page.goto('/lab/nav-menu/three');
        const menu = barMenu(page);
        await expect(menu).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Lab site' })).toBeVisible();
        await expect(mobileMenuButton(page)).toBeHidden();
        await expectMenu(menu, { expanded: [], shown: [], current: ['Deep page'], highlighted: ['Guides', 'Advanced'] });
        for (const [name, id] of [['Guides', 'lab-nav-guides'], ['Advanced', 'lab-nav-guides-advanced'], ['Reference', 'lab-nav-reference']]) {
            await expect(menu.locator('button[aria-controls]').filter({ hasText: name })).toHaveAttribute('aria-controls', id);
            await expect(menu.locator(`#${id}`)).toBeHidden();
        }
        // a link list, not an ARIA menu
        await expect(page.locator('[role^="menu"]')).toHaveCount(0);
        // the menu renders twice, in the bar and in the drawer, each with its own ids
        expect(await duplicateIds(page)).toEqual([]);
        await expect(drawerMenu(page).locator('[aria-controls="lab-nav-drawer-guides"]')).toHaveCount(1);
    });

    test('a click opens a submenu and closes the others; a nested one opens inside its parent; a click outside closes them all', async ({ page }) => {
        await page.goto('/lab/nav-menu');
        const menu = barMenu(page);
        await expectMenu(menu, { expanded: [], shown: [], current: ['Overview'], highlighted: [] });

        await button(menu, 'Guides').click();
        await expectMenu(menu, { expanded: ['Guides'], shown: ['lab-nav-guides'] });
        await button(menu, 'Advanced').click();
        await expectMenu(menu, { expanded: ['Guides', 'Advanced'], shown: ['lab-nav-guides', 'lab-nav-guides-advanced'] });
        // a nested one closes alone
        await button(menu, 'Advanced').click();
        await expectMenu(menu, { expanded: ['Guides'], shown: ['lab-nav-guides'] });
        await button(menu, 'Advanced').click();

        // another top-level submenu: the first closes, its nested one with it
        await button(menu, 'Reference').click();
        await expectMenu(menu, { expanded: ['Reference'], shown: ['lab-nav-reference'] });
        await button(menu, 'Reference').click();
        await expectMenu(menu, { expanded: [], shown: [] });

        // the other menu on the page: opening it closes this one (its click is outside)
        await button(menu, 'Guides').click();
        await button(accountMenu(page), 'Account').click();
        await expectMenu(menu, { expanded: [], shown: [] });
        await expectMenu(accountMenu(page), { expanded: ['Account'], shown: ['lab-account-account'] });

        // a click outside
        await page.getByTestId('page').click();
        await expectMenu(accountMenu(page), { expanded: [], shown: [] });
        // a click on a submenu's own padding keeps it open
        await button(menu, 'Guides').click();
        await page.locator('#lab-nav-guides').click({ position: { x: 3, y: 3 } });
        await expectMenu(menu, { expanded: ['Guides'], shown: ['lab-nav-guides'] });
    });

    test('the keyboard: Enter and Space toggle, Escape closes the innermost submenu and focuses its button, the focus leaving the menu closes them all', async ({ page }) => {
        await page.goto('/lab/nav-menu/three');
        const menu = barMenu(page);
        await link(menu, 'Overview').focus();
        await page.keyboard.press('Tab');
        await expectMenu(menu, { expanded: [], focus: 'Guides' });
        await page.keyboard.press('Enter');
        await expectMenu(menu, { expanded: ['Guides'], shown: ['lab-nav-guides'], focus: 'Guides' });
        await page.keyboard.press('Enter');
        await expectMenu(menu, { expanded: [], shown: [], focus: 'Guides' });
        await page.keyboard.press(' ');
        await expectMenu(menu, { expanded: ['Guides'], shown: ['lab-nav-guides'], focus: 'Guides' });

        // into the submenu, then the nested one
        await page.keyboard.press('Tab');
        await expectMenu(menu, { expanded: ['Guides'], focus: 'Getting started' });
        await page.keyboard.press('Tab');
        await expectMenu(menu, { focus: 'Advanced' });
        await page.keyboard.press(' ');
        await expectMenu(menu, { expanded: ['Guides', 'Advanced'], shown: ['lab-nav-guides', 'lab-nav-guides-advanced'], focus: 'Advanced' });
        await page.keyboard.press('Tab');
        await expectMenu(menu, { focus: 'Deep page', current: ['Deep page'] });

        // Escape, from the inside out
        await page.keyboard.press('Escape');
        await expectMenu(menu, { expanded: ['Guides'], shown: ['lab-nav-guides'], focus: 'Advanced' });
        await page.keyboard.press('Escape');
        await expectMenu(menu, { expanded: [], shown: [], focus: 'Guides' });
        await page.keyboard.press('Escape');
        await expectMenu(menu, { expanded: [], shown: [], focus: 'Guides' });

        // Escape on an expanded button closes its own submenu
        await page.keyboard.press('Enter');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await expectMenu(menu, { expanded: ['Guides', 'Advanced'], focus: 'Advanced' });
        await page.keyboard.press('Escape');
        await expectMenu(menu, { expanded: ['Guides'], focus: 'Advanced' });

        // Tab on to the next top-level button: the submenu stays open until another one opens
        await page.keyboard.press('Tab');
        await expectMenu(menu, { expanded: ['Guides'], focus: 'Reference' });
        await page.keyboard.press('Enter');
        await expectMenu(menu, { expanded: ['Reference'], shown: ['lab-nav-reference'], focus: 'Reference' });

        // the focus leaving the menu
        await page.keyboard.press('Tab');
        await expectMenu(menu, { expanded: ['Reference'], focus: 'API' });
        await page.keyboard.press('Tab');
        await expectMenu(menu, { expanded: [], shown: [], focus: 'outside' });
        // and backwards
        await button(menu, 'Guides').focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Shift+Tab');
        await expectMenu(menu, { expanded: ['Guides'], focus: 'Overview' });
        await page.keyboard.press('Shift+Tab');
        await expectMenu(menu, { expanded: [], shown: [], focus: 'outside' });
    });

    test('a submenu opens under its button, a nested one beside it, both follow the sticky bar on scroll; at the right edge they open towards the left', async ({ page }) => {
        await page.goto('/lab/nav-menu');
        const menu = barMenu(page);
        const box = async (locator: Locator) => (await locator.boundingBox())!;

        await button(menu, 'Guides').click();
        await button(menu, 'Advanced').click();
        const check = async () => {
            const guides = await box(button(menu, 'Guides'));
            const panel = await box(page.locator('#lab-nav-guides'));
            const advanced = await box(button(menu, 'Advanced'));
            const nested = await box(page.locator('#lab-nav-guides-advanced'));
            expect(panel.y).toBeGreaterThanOrEqual(guides.y + guides.height);
            expect(panel.y).toBeLessThan(guides.y + guides.height + 12);
            expect(Math.abs(panel.x - guides.x)).toBeLessThan(1);
            expect(nested.x).toBeGreaterThanOrEqual(advanced.x + advanced.width);
            expect(nested.x).toBeLessThan(panel.x + panel.width + 12);
            expect(Math.abs(nested.y - advanced.y)).toBeLessThan(16);
        };
        await check();
        await page.mouse.wheel(0, 400);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
        await expectMenu(menu, { expanded: ['Guides', 'Advanced'] });
        await check();

        // the account menu, at the right edge of the other bar
        await page.evaluate(() => window.scrollTo(0, 0));
        const account = accountMenu(page);
        await button(account, 'Account').click();
        await button(account, 'Preferences').click();
        await expectMenu(account, { expanded: ['Account', 'Preferences'], shown: ['lab-account-account', 'lab-account-account-preferences'] });
        const accountButton = await box(button(account, 'Account'));
        const panel = await box(page.locator('#lab-account-account'));
        const nested = await box(page.locator('#lab-account-account-preferences'));
        expect(Math.abs(panel.x + panel.width - (accountButton.x + accountButton.width))).toBeLessThan(1); // aligned on the button's end
        expect(nested.x + nested.width).toBeLessThanOrEqual(panel.x); // beside its parent, on the left
        expect(nested.x).toBeGreaterThanOrEqual(0);
        await expect(page.locator('#lab-account-account')).toHaveAttribute('data-flip', '');
        await expect(page.locator('#lab-account-account-preferences')).toHaveAttribute('data-flip', '');

        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expectMenu(account, { expanded: [], shown: [] });
        await expect(page.locator('#lab-account-account')).not.toHaveAttribute('data-flip');
    });

    test('a link inside visits its page and closes the submenus; a link to a fragment closes them too', async ({ page }) => {
        await page.goto('/lab/nav-menu');
        const sameDocument = await markDocument(page);
        const menu = barMenu(page);
        await button(menu, 'Guides').click();
        await link(menu, 'Getting started').click();
        await shown(page, 'Page two');
        await expectMenu(menu, { expanded: [], shown: [], current: ['Getting started'], highlighted: ['Guides'] });
        await sameDocument.expectKept();

        await button(menu, 'Guides').click();
        await button(menu, 'Advanced').click();
        await link(menu, 'Glossary').click();
        await expect(page).toHaveURL(/\/lab\/nav-menu\/two#glossary$/);
        await expectMenu(menu, { expanded: [], shown: [], current: ['Getting started'] });
    });

    test('a link opening another tab or window, a download or a modifier click leaves the submenu open', async ({ page }) => {
        await page.goto('/lab/nav-menu');
        const menu = barMenu(page);
        await button(menu, 'Guides').click();
        // links this tab does not follow; the page cancels them after the controller has seen the click (bubble order)
        await menu.evaluate((root) => {
            const panel = root.querySelector(`#${CSS.escape(root.querySelector('button[aria-controls]')!.getAttribute('aria-controls')!)}`)!;
            for (const [text, attribute, value] of [['Blank', 'target', '_blank'], ['Named', 'target', 'docs'], ['File', 'download', '']]) {
                const item = document.createElement('li');
                const link = document.createElement('a');
                link.href = '/lab/nav-menu/two';
                link.textContent = text;
                link.setAttribute(attribute, value);
                item.append(link);
                panel.append(item);
            }
            window.addEventListener('click', (event) => {
                if ((event.target as Element).closest('[target], [download]')) {
                    event.preventDefault();
                }
            });
        });
        for (const name of ['Blank', 'Named', 'File']) {
            await menu.getByRole('link', { name, exact: true }).click();
            await expectMenu(menu, { expanded: ['Guides'] });
        }
        await link(menu, 'Getting started').click({ modifiers: ['ControlOrMeta'] });
        await expectMenu(menu, { expanded: ['Guides'] });
    });

    test('a controller disconnected from a menu that stays gives the links back their rendered current state', async ({ page }) => {
        await page.goto('/lab/nav-menu/two');
        const menu = barMenu(page);
        await expectMenu(menu, { current: ['Getting started'] }); // marked from the URL, not rendered
        await menu.evaluate((root) => root.removeAttribute('data-controller'));
        await expectMenu(menu, { current: [] });
        await menu.evaluate((root) => root.setAttribute('data-controller', 'nav-menu'));
        await expectMenu(menu, { current: ['Getting started'] });
    });

    test('Back, Forward and a reload show every submenu closed, the copies Turbo cached included', async ({ page }) => {
        await page.addInitScript(() => {
            (window as any).__rendered = [];
            document.addEventListener('turbo:before-render', (event: any) => {
                const body = event.detail.newBody as HTMLElement;
                (window as any).__rendered.push(body.querySelectorAll('[aria-controls][aria-expanded="true"]').length);
            });
        });
        // page one waits for this stylesheet: Turbo copies page two before its controllers disconnect, as in production
        const held = await holdUntilCopied(page, '**/lab/slow.css');
        await page.goto('/lab/nav-menu/two');
        const menu = barMenu(page);
        await button(menu, 'Guides').click();
        await button(menu, 'Advanced').click();
        // a visit that leaves them open (a link closes them): one the page's own code starts
        await page.evaluate(() => (window as any).Turbo.visit('/lab/nav-menu'));
        await shown(page, 'Page one');
        expect(held(), 'page one waited for its stylesheet until Turbo had copied page two').toBe(1);
        await page.goBack();
        await shown(page, 'Page two');
        await expectMenu(menu, { expanded: [], shown: [], current: ['Getting started'], highlighted: ['Guides'] });

        await button(menu, 'Reference').click();
        await button(accountMenu(page), 'Account').click(); // the permanent bar's menu: in the copy too
        await page.goForward();
        await shown(page, 'Page one');
        await expectMenu(menu, { expanded: [], shown: [], current: ['Overview'], highlighted: [] });
        await expectMenu(accountMenu(page), { expanded: [], shown: [] });
        // every body rendered, the cached copies included, had every button collapsed
        expect(await page.evaluate(() => (window as any).__rendered)).toEqual([0, 0, 0]);

        await button(menu, 'Guides').click();
        await page.reload();
        await expectMenu(menu, { expanded: [], shown: [], current: ['Overview'] });
        await button(menu, 'Guides').click();
        await expectMenu(menu, { expanded: ['Guides'], shown: ['lab-nav-guides'] });
    });

    test('in a data-turbo-permanent navbar, the menu is kept across visits and marks each page', async ({ page }) => {
        await page.goto('/lab/nav-menu/four');
        const account = accountMenu(page);
        await account.evaluate((element) => ((element as any).__kept = true));
        await expectMenu(account, { current: ['Profile'], highlighted: ['Account'] });

        await button(account, 'Account').click();
        await button(account, 'Preferences').click();
        await link(account, 'Notifications').click();
        await shown(page, 'Page two');
        expect(await account.evaluate((element) => (element as any).__kept)).toBe(true);
        await expectMenu(account, { expanded: [], shown: [], current: ['Notifications'], highlighted: ['Account', 'Preferences'] });

        await page.goBack();
        await shown(page, 'Page four');
        expect(await account.evaluate((element) => (element as any).__kept)).toBe(true);
        await expectMenu(account, { expanded: [], shown: [], current: ['Profile'], highlighted: ['Account'] });
        await button(account, 'Account').click();
        await expectMenu(account, { expanded: ['Account'] });
    });

    test('repeated Turbo visits leave one controller on each menu', async ({ page }) => {
        await page.goto('/lab/nav-menu');
        const sameDocument = await markDocument(page);
        const menu = barMenu(page);
        for (const [name, heading] of [['Go to page two', 'Page two'], ['Go to page three', 'Page three'], ['Go to page one', 'Page one']]) {
            await page.getByRole('link', { name }).click();
            await shown(page, heading);
        }
        await button(menu, 'Guides').click();
        await link(menu, 'Getting started').click();
        await shown(page, 'Page two');
        await button(menu, 'Reference').click();
        await link(menu, 'API').click();
        await shown(page, 'Page four');
        await page.goBack();
        await shown(page, 'Page two');
        await page.goForward();
        await shown(page, 'Page four');
        await sameDocument.expectKept();
        await expect(page.locator('[data-controller~="nav-menu"]')).toHaveCount(3);

        // a click toggles once: a second controller would close what the first opened
        for (const target of [menu, accountMenu(page)]) {
            const name = target === menu ? 'Guides' : 'Account';
            await button(target, name).click();
            await expectMenu(target, { expanded: [name] });
            await button(target, name).click();
            await expectMenu(target, { expanded: [] });
        }
        // the actions of each controller are bound once: Escape from a link closes its submenu and focuses its button
        await button(menu, 'Guides').click();
        await link(menu, 'Getting started').focus();
        await page.keyboard.press('Escape');
        await expectMenu(menu, { expanded: [], focus: 'Guides' });
    });
});

test.describe('on a phone', () => {
    test.use({ viewport: phone });

    test('the bar hides the menu; the drawer holds it, its submenus opening in place, and Escape closes a submenu before the drawer', async ({ page }) => {
        await page.goto('/lab/nav-menu/three');
        await expect(barMenu(page)).toBeHidden();
        await expect(page.getByRole('navigation', { name: 'Lab site' })).toHaveCount(0);
        const menu = drawerMenu(page);
        await mobileMenuButton(page).click();
        await expect(drawer(page)).toBeVisible();
        // the current page is inside closed submenus: the focus goes to the first link
        await expectMenu(menu, { expanded: [], shown: [], current: ['Deep page'], highlighted: ['Guides', 'Advanced'], focus: 'Overview' });

        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await expectMenu(menu, { expanded: ['Guides'], shown: ['lab-nav-drawer-guides'], focus: 'Guides' });
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press(' ');
        await expectMenu(menu, { expanded: ['Guides', 'Advanced'], shown: ['lab-nav-drawer-guides', 'lab-nav-drawer-guides-advanced'], focus: 'Advanced' });
        // in place: in the flow of the drawer, under its button
        const advanced = (await button(menu, 'Advanced').boundingBox())!;
        const nested = (await page.locator('#lab-nav-drawer-guides-advanced').boundingBox())!;
        expect(nested.y).toBeGreaterThanOrEqual(advanced.y + advanced.height);
        expect(await page.locator('#lab-nav-drawer-guides-advanced').evaluate((element) => getComputedStyle(element).position)).toBe('static');

        await page.keyboard.press('Tab');
        await expectMenu(menu, { focus: 'Deep page' });
        await page.keyboard.press('Escape');
        await expectMenu(menu, { expanded: ['Guides'], focus: 'Advanced' });
        await expect(drawer(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expectMenu(menu, { expanded: [], focus: 'Guides' });
        await expect(drawer(page)).toBeVisible();
        // nothing open: Escape closes the drawer
        await page.keyboard.press('Escape');
        await expect(drawer(page)).toBeHidden();
        await expect(mobileMenuButton(page)).toBeFocused();
    });

    test('a link in the drawer visits its page and closes the drawer and the submenus; Back shows them closed', async ({ page }) => {
        await page.goto('/lab/nav-menu');
        const menu = drawerMenu(page);
        await mobileMenuButton(page).click();
        await button(menu, 'Guides').click();
        await link(menu, 'Getting started').click();
        await shown(page, 'Page two');
        await expect(drawer(page)).toBeHidden();
        await expectMenu(menu, { expanded: [], shown: [], current: ['Getting started'], highlighted: ['Guides'] });

        await mobileMenuButton(page).click();
        await button(menu, 'Reference').click();
        await expectMenu(menu, { expanded: ['Reference'] });
        await page.goBack();
        await shown(page, 'Page one');
        await expect(drawer(page)).toBeHidden();
        await expectMenu(menu, { expanded: [], shown: [], current: ['Overview'] });
        expect(await duplicateIds(page)).toEqual([]);
    });
});

for (const theme of ['light', 'dark'] as const) {
    test.describe(`${theme} theme`, () => {
        test.use({ colorScheme: theme });

        test('the menu passes axe, closed and open, on a desktop and in the drawer', async ({ page }) => {
            await page.setViewportSize(desktop);
            await page.goto('/lab/nav-menu/three');
            await expect(page.locator('html')).toHaveClass('dark' === theme ? /\bdark\b/ : /^(?!.*\bdark\b)/);
            await expectA11y(page, { impact: 'serious' }, 'closed');
            await button(barMenu(page), 'Guides').click();
            await button(barMenu(page), 'Advanced').click();
            await button(accountMenu(page), 'Account').click();
            await button(barMenu(page), 'Guides').click(); // the account menu closes
            await button(barMenu(page), 'Advanced').click();
            await expectMenu(barMenu(page), { expanded: ['Guides', 'Advanced'] });
            await expectA11y(page, { impact: 'serious' }, 'open');

            await page.setViewportSize(phone);
            await mobileMenuButton(page).click();
            await button(drawerMenu(page), 'Guides').click();
            await button(drawerMenu(page), 'Advanced').click();
            await expectMenu(drawerMenu(page), { expanded: ['Guides', 'Advanced'] });
            await expectA11y(page, { impact: 'serious', include: '#drawer-lab-nav-menu' }, 'open in the drawer');
        });
    });
}
