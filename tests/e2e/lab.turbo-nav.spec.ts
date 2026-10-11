import type { Page } from '@playwright/test';
import { stimulusControllers, test, expect, markDocument } from './fixtures';
import { back, forward, reload, shown, visit, visitAndBack } from './transitions';

const phone = { width: 600, height: 800 };
const desktop = { width: 1280, height: 800 };
const sidebar = (page: Page) => page.locator('#lab-sidebar');
const current = (page: Page) => page.getByRole('navigation', { name: 'Lab' }).locator('[aria-current="page"]');
const menu = (page: Page) => page.getByRole('button', { name: 'Open menu' });

test('a data-turbo-permanent panel is kept across Turbo visits (not its scroll) and the theme persists', async ({ page }) => {
    await page.goto('/lab/turbo-nav');
    const panel = page.getByRole('complementary', { name: 'Permanent panel' });
    await panel.evaluate((element) => {
        element.scrollTop = 200;
        (element as any).__marker = 'kept';
    });
    const sameDocument = await markDocument(page);

    await visit(page, 'Go to page two', 'Page two');
    await sameDocument.expectKept();
    // Turbo moves the same node into the new page, but Chromium resets the scroll of a re-inserted
    // element: a permanent element that must keep its scroll restores it itself (sidebar controller).
    expect(await panel.evaluate((element) => [(element as any).__marker, element.scrollTop])).toEqual(['kept', 0]);

    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await visit(page, 'Go to page one', 'Page one');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    expect(await panel.evaluate((element) => (element as any).__marker)).toBe('kept');
});

test('the permanent sidebar keeps its scroll, collapsed state and current item across Turbo visits', async ({ page }) => {
    await page.goto('/lab/turbo-nav');
    const sidebar = page.locator('#lab-sidebar');
    const nav = page.getByRole('navigation', { name: 'Lab' });
    await expect(nav.getByRole('link', { name: 'Page one' })).toHaveAttribute('aria-current', 'page');
    await nav.evaluate((element) => {
        element.scrollTop = 150;
        (element as any).__marker = 'kept';
    });
    expect(await nav.evaluate((element) => element.scrollTop)).toBe(150);

    await visit(page, 'Go to page two', 'Page two');
    expect(await nav.evaluate((element) => [(element as any).__marker, element.scrollTop])).toEqual(['kept', 150]);
    await expect(nav.getByRole('link', { name: 'Page two' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Page one' })).not.toHaveAttribute('aria-current');

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(sidebar).toHaveAttribute('data-collapsed');
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');

    await visit(page, 'Go to page one', 'Page one');
    await expect(sidebar).toHaveAttribute('data-collapsed');
    await expect(nav.getByRole('link', { name: 'Page one' })).toHaveAttribute('aria-current', 'page');

    await page.reload();
    await expect(sidebar).toHaveAttribute('data-collapsed');
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(sidebar).not.toHaveAttribute('data-collapsed');
});

test('a flash toast written as a Turbo Stream shows once across Turbo visits', async ({ page }) => {
    await page.goto('/lab/turbo-nav');
    const sameDocument = await markDocument(page);
    const toasts = page.getByRole('region', { name: 'Notifications' }).locator('[data-controller="toast"]');

    await page.getByRole('button', { name: 'Save settings' }).click();
    await shown(page, 'Page two');
    await expect(toasts).toHaveCount(1);
    await expect(toasts).toHaveText('Settings saved.');

    await visit(page, 'Go to page one', 'Page one');
    await visitAndBack(page);
    await expect(toasts).toHaveCount(1);
    await sameDocument.expectKept();
});

test('on a small screen the navbar button opens the sidebar over the page', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto('/lab/turbo-nav');
    const sidebar = page.locator('#lab-sidebar');
    const menu = page.getByRole('button', { name: 'Open menu' });
    await expect(sidebar).toBeHidden();

    await menu.click();
    await expect(sidebar).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar.getByRole('link', { name: 'Page one' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(sidebar).toBeHidden();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();

    await menu.click();
    await sidebar.getByRole('link', { name: 'Page two' }).click();
    await shown(page, 'Page two');
    await expect(sidebar).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false');
});

test('Back and Forward mark the current item of the page shown in the permanent sidebar', async ({ page }) => {
    await page.goto('/lab/turbo-nav');
    await expect(current(page)).toHaveText('Page one');

    await visit(page, 'Go to page two', 'Page two');
    await expect(current(page)).toHaveText('Page two');

    // the cached copy of page one comes back around the same sidebar element: it marks page one again
    await back(page, 'Page one');
    await expect(current(page)).toHaveCount(1);
    await expect(current(page)).toHaveText('Page one');

    await forward(page, 'Page two');
    await expect(current(page)).toHaveCount(1);
    await expect(current(page)).toHaveText('Page two');
    expect(await stimulusControllers(page, 'sidebar')).toEqual({ controllers: 1, elements: 1, distinctElements: 1 });
});

// localStorage throws (blocked site data, some private modes): the collapse cannot be saved, and lasts the page
test('with localStorage blocked, the sidebar stays collapsed across Turbo visits, Back and Forward, until a reload', async ({ page }) => {
    await page.addInitScript(() => {
        const blocked = () => {
            throw new DOMException('blocked', 'SecurityError');
        };
        Object.defineProperty(window, 'localStorage', { get: blocked });
    });
    await page.goto('/lab/turbo-nav');
    const collapsed = async () => {
        await expect(sidebar(page)).toHaveAttribute('data-collapsed');
        await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
    };

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await collapsed();

    await visit(page, 'Go to page two', 'Page two');
    await collapsed();
    await back(page, 'Page one');
    await collapsed();
    await forward(page, 'Page two');
    await collapsed();

    // nothing was saved: a new page load starts expanded
    await reload(page, 'Page two');
    await expect(sidebar(page)).not.toHaveAttribute('data-collapsed');
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true');
});

test('on a small screen, the sidebar open over the page is closed after Back, and after Forward to its page', async ({ page }) => {
    await page.setViewportSize(phone);
    await page.goto('/lab/turbo-nav');
    await visit(page, 'Go to page two', 'Page two');
    await menu(page).click();
    await expect(sidebar(page)).toBeVisible();
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'true');

    await back(page, 'Page one');
    await expect(sidebar(page)).toBeHidden();
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');

    // the copy of page two was taken with the sidebar open over it: its menu button must not say so
    await forward(page, 'Page two');
    await expect(sidebar(page)).toBeHidden();
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'false');

    await menu(page).click();
    await expect(sidebar(page)).toBeVisible();
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'true');
});

test('the sidebar open over the page closes when the screen grows to a desktop, and opens again with one click', async ({ page }) => {
    await page.setViewportSize(phone);
    await page.goto('/lab/turbo-nav');
    await menu(page).click();
    await expect(sidebar(page)).toBeVisible();

    // the menu button is hidden there, so out of the accessibility tree: found by the sidebar it controls
    await page.setViewportSize(desktop);
    const hiddenMenu = page.locator('[data-sidebar-trigger="lab-sidebar"]');
    await expect(sidebar(page)).toBeVisible();
    await expect(hiddenMenu).toBeHidden();
    await expect(hiddenMenu).toHaveAttribute('aria-expanded', 'false');

    await page.setViewportSize(phone);
    await expect(sidebar(page)).toBeHidden();
    await menu(page).click();
    await expect(sidebar(page)).toBeVisible();
    await expect(menu(page)).toHaveAttribute('aria-expanded', 'true');
});

// storage full: reads work, writes throw; the collapse cannot be saved, and lasts the page instead of the stored value
test('with localStorage writes failing, a collapse lasts across Turbo visits, Back and Forward', async ({ page }) => {
    await page.addInitScript(() => {
        Storage.prototype.setItem = () => {
            throw new DOMException('full', 'QuotaExceededError');
        };
    });
    await page.goto('/lab/turbo-nav');
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(sidebar(page)).toHaveAttribute('data-collapsed');

    await visit(page, 'Go to page two', 'Page two');
    await expect(sidebar(page)).toHaveAttribute('data-collapsed');
    await back(page, 'Page one');
    await expect(sidebar(page)).toHaveAttribute('data-collapsed');
    await forward(page, 'Page two');
    await expect(sidebar(page)).toHaveAttribute('data-collapsed');
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
});
