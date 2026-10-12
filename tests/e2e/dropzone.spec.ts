import type { Locator, Page } from '@playwright/test';
import { test, expect, expectA11y, countEvents } from './fixtures';
import { png, text } from './files';
import { previewUrl } from './inventory';

/*
 * The Dropzone component: UX Dropzone's controller with the kit's markup, and the kit's dropzone-assist controller
 * (focus after a pick, Remove and a removed file; drag-over state; drops outside the input refused).
 */
const zone = (page: Page) => page.locator('[data-controller~="dropzone-assist"]');
const input = (page: Page) => page.locator('input[type="file"]');
const listItems = (page: Page) => page.locator('.dropzone-preview-list-item');
const fileCount = (page: Page) => input(page).evaluate((element: HTMLInputElement) => element.files?.length ?? 0);

/** Dispatches a drag event, with no file, on `target`; returns whether it was cancelled. */
const drag = (target: Locator, type: string) =>
    target.evaluate((element, type) => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
        element.dispatchEvent(event);

        return event.defaultPrevented;
    }, type);

test('the keyboard reaches the input, opens the chooser, moves to Remove after a pick and back after Remove', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'default'));
    // connecting moves no focus
    await expect(page.locator('body')).toBeFocused();

    await page.keyboard.press('Tab');
    const fileInput = page.getByLabel('Profile picture');
    await expect(fileInput).toBeFocused();
    const box = page.locator('[data-controller~="dropzone-assist"] > div').first();
    expect(await box.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');

    for (const key of ['Space', 'Enter']) {
        const chooser = page.waitForEvent('filechooser');
        await page.keyboard.press(key);
        const fileChooser = await chooser;
        if ('Enter' === key) {
            await fileChooser.setFiles(png('tiny.png'));
        }
    }

    const remove = page.getByRole('button', { name: 'Remove tiny.png' });
    await expect(remove).toBeFocused();
    await expect(fileInput).toBeHidden();

    await page.keyboard.press('Enter');
    await expect(fileInput).toBeFocused();
    await expect(page.getByText('Drag and drop or browse')).toBeVisible();
    await expect(remove).toBeHidden();
    expect(await fileCount(page)).toBe(0);
});

test('a picked image shows its name and its preview; a text file shows no image', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'default'));
    const changes = await countEvents(page, ['dropzone:change']);
    await input(page).setInputFiles(png('tiny.png'));

    await expect(page.getByText('tiny.png')).toBeVisible();
    await expect(page.getByText('Drag and drop or browse')).toBeHidden();
    const image = page.locator('[data-symfony--ux-dropzone--dropzone-target="previewImage"]');
    await expect(image).toBeVisible();
    expect(await image.evaluate((element) => getComputedStyle(element).backgroundImage)).toMatch(/^url\("data:image\/png/);
    expect(await changes()).toEqual({ 'dropzone:change': 1 });
    // picked without the input focused: the focus stays where it was
    await expect(page.locator('body')).toBeFocused();

    await page.getByRole('button', { name: 'Remove tiny.png' }).click();
    await expect(page.getByLabel('Profile picture')).toBeFocused();
    await input(page).setInputFiles(text('notes.txt'));
    await expect(page.getByText('notes.txt')).toBeVisible();
    await expect(image).toBeHidden();
    expect(await changes()).toEqual({ 'dropzone:change': 2 });
    await expectA11y(page, { impact: 'serious' });
});

test('several files add up across picks, once each; Remove focuses the next file, then the input', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'multiple-files'));
    const changes = await countEvents(page, ['dropzone:change']);
    await input(page).setInputFiles([text('a.txt'), text('b.txt')]);
    await expect(listItems(page)).toHaveCount(2);
    await input(page).setInputFiles(png('c.png'));
    await expect(listItems(page)).toHaveCount(3);
    expect(await fileCount(page)).toBe(3);
    expect(await changes()).toEqual({ 'dropzone:change': 2 });

    // a file picked again (same name, size and date) is kept once
    await input(page).evaluate((element: HTMLInputElement) => {
        const files = new DataTransfer();
        files.items.add(new File(['d'], 'd.txt', { type: 'text/plain', lastModified: 1 }));
        element.files = files.files;
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.files = files.files;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(listItems(page)).toHaveCount(4);
    expect(await fileCount(page)).toBe(4);

    for (const name of ['a.txt', 'b.txt', 'c.png', 'd.txt']) {
        await expect(page.getByRole('button', { name: `Remove ${name}` })).toBeVisible();
    }
    await expectA11y(page, { impact: 'serious' });

    await page.getByRole('button', { name: 'Remove b.txt' }).click();
    await expect(listItems(page)).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Remove c.png' })).toBeFocused();
    expect(await fileCount(page)).toBe(3);

    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Remove d.txt' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Remove a.txt' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(listItems(page)).toHaveCount(0);
    await expect(page.getByLabel('Attachments')).toBeFocused();
    expect(await fileCount(page)).toBe(0);
});

test('a drag over the zone marks it until it leaves or drops; a drop outside the input is refused', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'default'));
    const fileInput = input(page);
    await drag(fileInput, 'dragenter');
    await expect(zone(page)).toHaveAttribute('data-dragging', '');
    await drag(fileInput, 'dragleave');
    await expect(zone(page)).not.toHaveAttribute('data-dragging');
    // a drag leaving without a drop shows the empty box again, not an empty preview
    await expect(page.getByText('Drag and drop or browse')).toBeVisible();
    await expect(fileInput).toBeVisible();
    await expect(page.locator('[data-symfony--ux-dropzone--dropzone-target="preview"]')).toBeHidden();

    await drag(fileInput, 'dragover');
    await expect(zone(page)).toHaveAttribute('data-dragging', '');
    // a drop on the input is the browser's: it sets the files
    expect(await drag(fileInput, 'drop')).toBe(false);
    await expect(zone(page)).not.toHaveAttribute('data-dragging');

    await page.goto(previewUrl('dropzone', 'multiple-files'));
    const list = page.locator('[data-dropzone-assist-target="list"]');
    expect(await drag(list, 'dragover')).toBe(true);
    expect(await drag(list, 'drop')).toBe(true);
    await expect(zone(page)).not.toHaveAttribute('data-dragging');
});

test('an invalid zone is red and described by its error', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'invalid'));
    const fileInput = page.getByLabel('Profile picture');
    await expect(fileInput).toHaveAttribute('aria-invalid', 'true');
    await expect(fileInput).toHaveAccessibleDescription(/PNG or JPG, up to 1 MB\. The file is too large/);
    const box = page.locator('[data-controller~="dropzone-assist"] > div').first();
    const danger = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-danger-soft'));
    expect(danger).not.toBe('');
    expect(await box.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
        await page.evaluate(() => {
            const probe = document.createElement('div');
            probe.className = 'bg-danger-soft';
            document.body.append(probe);

            return getComputedStyle(probe).backgroundColor;
        }),
    );
    // axe on this state, mounted, in both themes: a11y.spec.ts (/preview/dropzone/invalid)
});

test('a disabled zone is disabled and described by its hint', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'disabled'));
    await expect(page.getByLabel('Contract')).toBeDisabled();
    await expect(page.getByLabel('Contract')).toHaveAccessibleDescription('Uploads are closed');
});
