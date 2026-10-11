import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { previewUrl } from './inventory';

/*
 * The dropdown's keyboard beyond ArrowDown and Escape (recipe:dropdown has those), its submenus, and where the menu
 * lands: flipped to the other side when it does not fit, shifted back into the viewport along its trigger, following
 * the trigger on scroll. On the README previews, rendered open.
 */

const trigger = (page: Page) => page.getByRole('button', { name: 'Dropdown button' });
const menu = (page: Page) => page.getByRole('menu', { name: 'Dropdown button' });
const item = (page: Page, name: string) => page.getByRole('menuitem', { name, exact: true });

/** Closes the menu the preview renders open, then opens it from the keyboard: the first item focused. */
async function openWithKeyboard(page: Page): Promise<void> {
    await trigger(page).click();
    await expect(menu(page)).toBeHidden();
    await trigger(page).press('ArrowDown');
    await expect(item(page, 'Dashboard')).toBeFocused();
}

test('Home and End move to the first and last item, the arrows wrap, ArrowUp on the trigger opens on the last item', async ({ page }) => {
    await page.goto(previewUrl('dropdown', 'default'));
    await openWithKeyboard(page);

    await page.keyboard.press('End');
    await expect(item(page, 'Sign out')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(item(page, 'Dashboard')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(item(page, 'Sign out')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item(page, 'Dashboard')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await trigger(page).press('ArrowUp');
    await expect(item(page, 'Sign out')).toBeFocused();
});

test('Tab and Shift+Tab from an item close the menu and move on from its trigger', async ({ page }) => {
    await page.goto(previewUrl('dropdown', 'default'));
    // a control on each side of the dropdown, so where the focus goes is the page's next and previous Tab stop
    await page.locator('[data-controller="dropdown"]').evaluate((dropdown) => {
        const button = (name: string) => Object.assign(document.createElement('button'), { type: 'button', textContent: name });
        dropdown.before(button('Before'));
        dropdown.after(button('After'));
    });

    await openWithKeyboard(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(menu(page)).toBeHidden();
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'After' })).toBeFocused();

    await trigger(page).press('ArrowDown');
    await expect(item(page, 'Dashboard')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(menu(page)).toBeHidden();
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Before' })).toBeFocused();
});

test('a submenu opens with ArrowRight on its item, keeps the arrows to its own items, and closes with ArrowLeft and Escape', async ({ page }) => {
    await page.goto(previewUrl('dropdown', 'multi-level-dropdown'));
    const settings = item(page, 'Settings');
    const submenu = page.getByRole('menu', { name: 'Settings' });
    const subItems = submenu.getByRole('menuitem');
    await openWithKeyboard(page);
    await expect(settings).toHaveAttribute('aria-haspopup', 'menu');

    await page.keyboard.press('ArrowDown');
    await expect(settings).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(submenu).toBeVisible();
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
    await expect(subItems.first()).toBeFocused();

    // the arrows, Home and End stay in the submenu: two items, wrapping
    await page.keyboard.press('ArrowDown');
    await expect(subItems.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(subItems.first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(subItems.nth(1)).toBeFocused();

    // ArrowLeft closes the submenu only, back on its item
    await page.keyboard.press('ArrowLeft');
    await expect(submenu).toBeHidden();
    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await expect(settings).toBeFocused();
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(item(page, 'Earnings')).toBeFocused();

    // Escape in the submenu closes it only; Escape on the parent menu's item closes that menu, on its trigger
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(subItems.first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(submenu).toBeHidden();
    await expect(settings).toBeFocused();
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
});

test('ArrowRight on the item of a submenu already open by a click moves into it, and does not close it', async ({ page }) => {
    await page.goto(previewUrl('dropdown', 'multi-level-dropdown'));
    const settings = item(page, 'Settings');
    const submenu = page.getByRole('menu', { name: 'Settings' });

    await settings.click();
    await expect(submenu).toBeVisible();
    // Safari does not focus a clicked button: the focus is put there as the other engines do
    await settings.focus();
    await page.keyboard.press('ArrowRight');

    await expect(submenu.getByRole('menuitem').first()).toBeFocused();
    await expect(submenu).toBeVisible();
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
});

const box = async (page: Page) => (await menu(page).boundingBox())!;

test('the menu flips above its trigger when it does not fit below', async ({ page }) => {
    await page.goto(previewUrl('dropdown', 'default'));
    await expect(menu(page)).toHaveAttribute('data-popper-placement', 'bottom');
    const below = await box(page);
    expect(below.y).toBeGreaterThan((await trigger(page).boundingBox())!.y);

    // a viewport too short below the trigger: the menu opens above it
    await page.evaluate(() => {
        document.body.style.paddingTop = `${window.innerHeight - 80}px`;
        window.dispatchEvent(new Event('resize'));
    });
    await expect(menu(page)).toHaveAttribute('data-popper-placement', 'top');
    const above = await box(page);
    expect(above.y + above.height).toBeLessThanOrEqual((await trigger(page).boundingBox())!.y);
});

test('the menu follows its trigger when a scrolling box around them scrolls', async ({ page }) => {
    await page.goto(previewUrl('dropdown', 'default'));
    // a box that scrolls and is not the menu's containing block: the menu does not move with it on its own
    await page.locator('[data-controller="dropdown"]').evaluate((dropdown) => {
        const scroller = Object.assign(document.createElement('div'), { tabIndex: 0 });
        Object.assign(scroller.style, { overflow: 'auto', height: '300px' });
        const spacer = document.createElement('div');
        spacer.style.height = '1000px';
        dropdown.before(scroller);
        scroller.append(dropdown, spacer);
    });
    await expect(menu(page)).toBeVisible();
    // the menu's top, its offset (10px) below the trigger's bottom
    const gap = async () => {
        const trigger_ = (await trigger(page).boundingBox())!;
        return Math.round((await box(page)).y - (trigger_.y + trigger_.height));
    };
    await expect.poll(gap).toBe(10);

    await page.locator('[data-controller="dropdown"]').evaluate((dropdown) => (dropdown.parentElement!.scrollTop = 50));
    await expect.poll(gap).toBe(10);
});

test('a menu wider than the room beside its trigger is shifted back into the viewport, along the trigger', async ({ page }) => {
    await page.goto(previewUrl('dropdown', 'default'));
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    // a menu wider than its trigger, centered under it (`bottom`), with the trigger at either edge of the viewport
    const place = (edge: 'left' | 'right') =>
        page.locator('[data-controller="dropdown"]').evaluate((dropdown, edge) => {
            const content = dropdown.querySelector<HTMLElement>('[role="menu"]')!;
            content.style.minWidth = '400px';
            Object.assign((dropdown as HTMLElement).style, { position: 'fixed', top: '100px', left: 'left' === edge ? '0px' : '', right: 'right' === edge ? '0px' : '' });
            window.dispatchEvent(new Event('resize'));
        }, edge);

    await place('left');
    await expect.poll(async () => Math.round((await box(page)).x)).toBe(0);
    const left = await box(page);
    const leftTrigger = (await trigger(page).boundingBox())!;
    expect(left.x + left.width).toBeGreaterThan(leftTrigger.x + leftTrigger.width);

    await place('right');
    await expect.poll(async () => Math.round((await box(page)).x + (await box(page)).width)).toBe(width);
    const right = await box(page);
    const rightTrigger = (await trigger(page).boundingBox())!;
    expect(right.x).toBeLessThan(rightTrigger.x);
    await expect(menu(page)).toHaveAttribute('data-popper-placement', 'bottom');
});
