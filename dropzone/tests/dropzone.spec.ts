import { describeRecipe, expect, testState } from '../../../../assets/test/browser/fixtures';

// a 4×4 PNG, all blue
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOQSfkERwzEcQBMMhch8Z3BJwAAAABJRU5ErkJggg==', 'base64');
const text = (name: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(`${name}\n`) });

describeRecipe('uxor/dropzone', () => {
    testState('shows a picked image', {
        example: 'default',
        state: 'picked-image',
        act: async (page) => {
            await page.locator('input[type="file"]').setInputFiles({ name: 'profile-picture.png', mimeType: 'image/png', buffer: PNG });

            const image = page.locator('[data-symfony--ux-dropzone--dropzone-target="previewImage"]');
            await expect(image).toBeVisible();
            await expect.poll(() => image.evaluate((element) => getComputedStyle(element).backgroundImage)).toMatch(/^url\("data:image\/png/);
            await expect(page.getByRole('button', { name: 'Remove profile-picture.png' })).toBeVisible();
        },
    });

    testState('lists three picked files', {
        example: 'multiple-files',
        state: 'picked-three',
        act: async (page) => {
            const input = page.locator('input[type="file"]');
            await input.setInputFiles([text('report.txt'), text('notes.txt')]);
            await input.setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: PNG });

            await expect(page.locator('.dropzone-preview-list-item')).toHaveCount(3);
            const image = page.locator('.dropzone-preview-list-item .dropzone-preview-image').nth(2);
            await expect.poll(() => image.evaluate((element) => getComputedStyle(element).backgroundImage)).toMatch(/^url\("data:image\/png/);
        },
    });

    testState('marks the zone while a file is dragged over it', {
        example: 'default',
        state: 'dragging',
        act: async (page) => {
            await page.locator('input[type="file"]').dispatchEvent('dragenter');

            await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveAttribute('data-dragging', '');
        },
    });
});
