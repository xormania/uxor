import { test as base, expect } from '@playwright/test';

const upgraded = process.env.PILOT_RELEASE === '0.0.2';
const identifier = 'xormania--uxor-pilot--data-table';
const test = base.extend({
    page: async ({ page }, use) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('response', (response) => {
            if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`);
        });
        await use(page);
        expect(errors, 'browser errors and failed app resources').toEqual([]);
    },
});

async function open(page, url = '/orders?campaign=fixture') {
    await page.goto(url);
    await expect.poll(() => page.evaluate((identifier) => window.Stimulus?.controllers.filter((controller) => controller.identifier === identifier).length, identifier)).toBe(1);
}

const sortLink = (page) => page.getByRole('columnheader').first().getByRole('link');
const invoice = (page) => page.locator('[data-invoice]');

test('application colors, typography and radius apply in both identities and color modes', async ({ page }) => {
    await open(page);
    for (const identity of ['brand', 'contrast']) {
        for (const dark of [false, true]) {
            await page.evaluate(({ identity, dark }) => {
                document.documentElement.dataset.fixtureTheme = identity;
                document.documentElement.classList.toggle('dark', dark);
            }, { identity, dark });
            const color = identity === 'brand' ? (dark ? 'rgb(167, 139, 250)' : 'rgb(109, 40, 217)') : (dark ? 'rgb(110, 231, 183)' : 'rgb(4, 120, 87)');
            await expect(page.getByRole('button', { name: 'Apply' })).toHaveCSS('border-radius', identity === 'brand' ? '4px' : '10px');
            await expect(page.locator('body')).toHaveCSS('font-family', identity === 'brand' ? /Georgia/ : /monospace/);
            await page.getByRole('searchbox', { name: 'Search', exact: true }).focus();
            await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toHaveCSS('border-top-color', color);
            if (upgraded) {
                await sortLink(page).press('Tab');
                await sortLink(page).focus();
                await expect(sortLink(page)).toHaveCSS('outline-color', color);
                await expect(sortLink(page)).toHaveCSS('outline-width', '2px');
            }
        }
    }
});

test('the compatible release brings sort labels and keyboard focus while custom cells survive', async ({ page }) => {
    await open(page);
    const sort = sortLink(page);
    if (upgraded) await expect(sort).toHaveAttribute('aria-label', 'Sort by Order, ascending');
    else await expect(sort).not.toHaveAttribute('aria-label');
    await sort.focus();
    await sort.press('Enter');
    await expect(page).toHaveURL(/sort=number.*dir=asc/);
    await expect(page.getByRole('columnheader').first()).toHaveAttribute('aria-sort', 'ascending');
    if (upgraded) {
        await expect(sortLink(page)).toHaveAttribute('aria-label', 'Sort by Order, descending');
        await expect(sortLink(page)).toBeFocused();
        await sortLink(page).press('Enter');
        await expect(page.getByRole('columnheader').first()).toHaveAttribute('aria-sort', 'descending');
        await expect(sortLink(page)).toBeFocused();
        await expect(invoice(page)).toHaveText('ORD-002');
    } else {
        await expect(sortLink(page)).not.toBeFocused();
        await expect(invoice(page)).toHaveText('ORD-001');
    }
    await expect(invoice(page)).toHaveAttribute('href', /\/invoice\/[12]$/);
    await expect(page.locator('[data-customer]')).toHaveCount(1);
    await expect(page.locator('[data-wrong-local-button]')).toHaveCount(0);
});

test('the upgraded sort outline has at least 3 to 1 contrast in the default light and dark themes', async ({ page }) => {
    await open(page);
    if (!upgraded) {
        await expect(sortLink(page)).not.toHaveClass(/uxor-table-sort-link/);
        return;
    }
    for (const dark of [false, true]) {
        await page.evaluate((dark) => {
            document.documentElement.dataset.fixtureTheme = 'default';
            document.documentElement.classList.toggle('dark', dark);
        }, dark);
        await sortLink(page).press('Tab');
        await sortLink(page).focus();
        await expect(sortLink(page)).toHaveCSS('outline-width', '2px');
        const contrast = await sortLink(page).evaluate((link) => {
            const context = document.createElement('canvas').getContext('2d', { colorSpace: 'srgb' });
            const luminance = (color) => {
                context.clearRect(0, 0, 1, 1);
                context.fillStyle = color;
                context.fillRect(0, 0, 1, 1);
                const pixel = context.getImageData(0, 0, 1, 1).data;
                if (pixel[3] !== 255) throw new Error('Contrast probe requires opaque colors');
                const channels = [...pixel.slice(0, 3)].map((byte) => {
                    const value = byte / 255;
                    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
                });
                return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
            };
            const ring = luminance(getComputedStyle(link).outlineColor);
            const background = luminance(getComputedStyle(link.closest('thead')).backgroundColor);
            return (Math.max(ring, background) + 0.05) / (Math.min(ring, background) + 0.05);
        });
        expect(contrast, `${dark ? 'dark' : 'light'} default sort focus contrast`).toBeGreaterThanOrEqual(3);
    }
});

test('a response does not reclaim sort focus after the user moved to another control', async ({ page }) => {
    await open(page);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let received;
    const requested = new Promise((resolve) => { received = resolve; });
    await page.route('**/orders?*sort=number*', async (route) => {
        received();
        await held;
        await route.continue();
    });
    await sortLink(page).focus();
    await sortLink(page).press('Enter');
    await requested;
    await page.getByRole('searchbox', { name: 'Search', exact: true }).focus();
    release();
    await expect(page.getByRole('columnheader').first()).toHaveAttribute('aria-sort', 'ascending');
    await expect(sortLink(page)).not.toBeFocused();
});

test('pagination and search restore through history, and repeated visits keep one controller', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.fixtureDocument = 'original'; });
    await page.getByRole('link', { name: 'Page 2', exact: true }).click();
    await expect(invoice(page)).toHaveText('ORD-002');
    await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('Bob');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/q=Bob/);
    await expect(page.getByRole('status')).toContainText('of 1');
    await page.goBack();
    await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toHaveValue('');
    await expect(invoice(page)).toHaveText('ORD-002');
    await page.goBack();
    await expect(invoice(page)).toHaveText('ORD-001');
    await page.goForward();
    await expect(invoice(page)).toHaveText('ORD-002');
    expect(await page.evaluate(() => window.fixtureDocument)).toBe('original');
    for (let visit = 0; visit < 3; visit++) {
        await page.getByRole('link', { name: 'Other page', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Other page' })).toBeVisible();
        await expect.poll(() => page.evaluate((identifier) => window.Stimulus.controllers.filter((controller) => controller.identifier === identifier).length, identifier)).toBe(0);
        await page.goBack();
        await expect(invoice(page)).toHaveText('ORD-002');
        await expect.poll(() => page.evaluate((identifier) => window.Stimulus.controllers.filter((controller) => controller.identifier === identifier).length, identifier)).toBe(1);
    }
});
