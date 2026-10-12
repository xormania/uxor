import type { Page } from '@playwright/test';
import { test, expect, markDocument } from './fixtures';
import { back, visit } from './transitions';

/*
 * `Avatar:Image` starts hidden behind its `Avatar:Fallback`: the avatar controller shows it once it has loaded, also
 * when it loaded before the controller connected, and shows the fallback again when it fails. The README examples
 * and the turbo-nav lab page load remote pictures, which the fixtures answer with a local placeholder. Routing
 * requests turns the browser's HTTP cache off, so no test here loads a picture from it.
 */
const PICTURE = /\/profile-picture-5\.jpg$/;

async function expectImagesShown(page: Page, count: number): Promise<void> {
    await expect(page.locator('img[data-avatar-image]')).toHaveCount(count);
    for (const image of await page.locator('img[data-avatar-image]').all()) {
        await expect(image).toBeVisible();
    }
    for (const fallback of await page.locator('[data-avatar-fallback]').all()) {
        await expect(fallback).toBeHidden();
    }
}

test('shows the image instead of the fallback once it has loaded', async ({ page }) => {
    await page.goto('/preview/avatar/default?theme=light');
    await expectImagesShown(page, 2);
});

test('shows an image that loaded before the controller connected', async ({ page }) => {
    await page.goto('/preview/avatar/default?theme=light');
    await expectImagesShown(page, 2);
    const avatar = page.locator('.group\\/avatar').first();
    const image = avatar.locator('img');

    // disconnecting puts the markup's state back: image hidden, fallback shown
    await image.evaluate((element) => element.removeAttribute('data-controller'));
    await expect(image).toBeHidden();
    await expect(avatar.locator('[data-avatar-fallback]')).toBeVisible();

    // the image is complete when the controller connects again: no load event follows
    await image.evaluate((element) => element.setAttribute('data-controller', 'avatar'));
    await expect(image).toBeVisible();
    await expect(avatar.locator('[data-avatar-fallback]')).toBeHidden();
});

test('shows the picture of a page reached by a Turbo visit or restored from its cache', async ({ page }) => {
    const picture = page.getByRole('img', { name: 'Lab user' });
    const fallback = page.getByText('LU', { exact: true });
    await page.goto('/lab/turbo-nav/one');
    await expect(picture).toBeVisible();
    await expect(fallback).toBeHidden();
    const sameDocument = await markDocument(page);

    await visit(page, 'Go to page two', 'Page two');
    await expect(picture).toBeVisible();
    await expect(fallback).toBeHidden();

    await back(page, 'Page one');
    await expect(picture).toBeVisible();
    await expect(fallback).toBeHidden();
    await sameDocument.expectKept();
});

test('keeps the fallback when the image fails to load', async ({ page, allowHttpError }) => {
    allowHttpError(PICTURE, 404);
    await page.route(PICTURE, (route) => route.fulfill({ status: 404, body: '' }));
    await page.goto('/preview/avatar/default?theme=light');

    await expect(page.locator('[data-avatar-fallback]')).toHaveCount(2);
    for (const fallback of await page.locator('[data-avatar-fallback]').all()) {
        await expect(fallback).toBeVisible();
    }
    for (const image of await page.locator('img[data-avatar-image]').all()) {
        await expect(image).toBeHidden();
    }
});

test('shows the fallback again when a new image fails to load', async ({ page, allowHttpError }) => {
    const missing = /\/missing-picture\.jpg$/;
    allowHttpError(missing, 404);
    await page.route(missing, (route) => route.fulfill({ status: 404, body: '' }));
    await page.goto('/preview/avatar/default?theme=light');
    await expectImagesShown(page, 2);

    // what a Live Component re-render with another picture does
    const avatar = page.locator('.group\\/avatar').first();
    await avatar.locator('img').evaluate((image: HTMLImageElement) => (image.src = 'https://flowbite.com/missing-picture.jpg'));
    await expect(avatar.locator('[data-avatar-fallback]')).toBeVisible();
    await expect(avatar.locator('img')).toBeHidden();
});
