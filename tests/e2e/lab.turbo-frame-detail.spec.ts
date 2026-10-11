import { test, expect, markDocument } from './fixtures';

test('a dropdown inside a Turbo Frame works after every frame reload', async ({ page }) => {
    await page.goto('/lab/turbo-frame-detail');
    const sameDocument = await markDocument(page);

    for (const item of ['Apple', 'Banana', 'Apple']) {
        await page.getByRole('navigation', { name: 'Items' }).getByRole('link', { name: item }).click();
        await expect(page.getByTestId('detail-title')).toHaveText(item);

        const trigger = page.getByRole('button', { name: `Options for ${item}` });
        await trigger.click();
        await expect(page.getByRole('menuitem', { name: `Edit ${item}` })).toBeVisible();
        await trigger.click();
        await expect(page.getByRole('menuitem', { name: `Edit ${item}` })).toBeHidden();
    }
    await sameDocument.expectKept();
});
