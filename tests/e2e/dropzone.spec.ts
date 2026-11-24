import type { Locator, Page } from '@playwright/test';
import { test, expect, expectA11y, countEvents, decodedBackgroundImage, dropFiles, dropzoneAddEvents, fileNames, recordDropzoneEvents } from './fixtures';
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

/**
 * Expects no message about the files left out: UX Dropzone 3.8 writes its `accept_message` and `max_files_message` into a
 * `feedback` target, a task after the `dropzone:reject`, and the kit's zone has no such target and passes neither message.
 */
async function expectNoRejectMessage(page: Page) {
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
    await expect(zone(page).locator('[data-symfony--ux-dropzone--dropzone-target="feedback"], .dropzone-feedback, [role="status"]')).toHaveCount(0);
    await expect(zone(page)).not.toContainText(/not accepted|too many files|not added/i);
}

/** Dispatches a drag event, with no file, on `target`; returns whether it was cancelled. */
const drag = (target: Locator, type: string) =>
    target.evaluate((element, type) => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
        element.dispatchEvent(event);

        return event.defaultPrevented;
    }, type);

/** Dispatches a drag event carrying a file on `target`, as a drag from the desktop: its types hold `Files`. */
const fileDrag = (target: Locator, type: string) =>
    target.evaluate((element, type) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File(['dragged'], 'dragged.png', { type: 'image/png' }));
        element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
    }, type);

/**
 * Dispatches a drag event carrying a file on `target`, as `fileDrag` does; returns whether it was cancelled and the
 * drop effect its listeners left (`none`: the browser refuses the drop).
 */
const fileDragOn = (target: Locator, type: string) =>
    target.evaluate((element, type) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File(['dragged'], 'dragged.png', { type: 'image/png' }));
        const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
        element.dispatchEvent(event);

        return { prevented: event.defaultPrevented, dropEffect: dataTransfer.dropEffect };
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
    await expect.poll(async () => (await decodedBackgroundImage(image))?.width).toBe(1);
    expect(await changes()).toEqual({ 'dropzone:change': 1 });
    // picked without the input focused: the focus stays where it was
    await expect(page.locator('body')).toBeFocused();

    await page.getByRole('button', { name: 'Remove tiny.png' }).click();
    await expect(page.getByLabel('Profile picture')).toBeFocused();
    await input(page).setInputFiles(text('notes.txt'));
    await expect(page.getByText('notes.txt')).toBeVisible();
    await expect(page.locator('[data-symfony--ux-dropzone--dropzone-target="preview"]')).toBeVisible();
    await expect(image).toBeHidden();
    expect(await changes()).toEqual({ 'dropzone:change': 2 });
    await expectA11y(page, { impact: 'serious' });
});

test('a text file picked first shows its name and its Remove button, and no image preview', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'default'));
    await input(page).setInputFiles(text('notes.txt'));

    await expect(page.getByRole('button', { name: 'Remove notes.txt' })).toBeVisible();
    await expect(page.getByText('notes.txt')).toBeVisible();
    await expect(page.getByText('Drag and drop or browse')).toBeHidden();
    // shown or not, the box shows no image for a file that is not one
    await expect(page.locator('[data-symfony--ux-dropzone--dropzone-target="previewImage"]')).toBeHidden();
    expect(await fileCount(page)).toBe(1);
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

test('after a file drag enters and leaves the empty zone, a pick shows its preview, focus and Remove as a first pick does', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'default'));
    const fileInput = page.getByLabel('Profile picture');

    await fileDrag(fileInput, 'dragenter');
    // UX Dropzone took it for a file drag, not only the kit's controller
    await expect(zone(page)).toHaveAttribute('data-state', 'dragging');
    await expect(zone(page)).toHaveAttribute('data-dragging', '');
    await fileDrag(fileInput, 'dragleave');
    await expect(zone(page)).toHaveAttribute('data-state', 'empty');
    await expect(zone(page)).not.toHaveAttribute('data-dragging');
    // the timers the drag's listeners set have run: a timeout set now runs after them
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
    await expect(page.getByText('Drag and drop or browse')).toBeVisible();

    // then a pick from the keyboard, on the same zone, never reconnected
    await fileInput.focus();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(png('tiny.png'));

    const remove = page.getByRole('button', { name: 'Remove tiny.png' });
    await expect(remove).toBeFocused();
    await expect(remove).toBeVisible();
    await expect(page.getByText('tiny.png')).toBeVisible();
    await expect(page.locator('[data-symfony--ux-dropzone--dropzone-target="previewImage"]')).toBeVisible();
    await expect(page.getByText('Drag and drop or browse')).toBeHidden();
    await expect(zone(page)).toHaveAttribute('data-state', 'filled');

    await page.keyboard.press('Enter');
    await expect(fileInput).toBeFocused();
    await expect(page.getByText('Drag and drop or browse')).toBeVisible();
    expect(await fileCount(page)).toBe(0);
});

// A drop the browser would hand the tab (outside the input) is refused: UX Dropzone adds files only from the input's
// change, so the input keeps its files, and the drag state its drop sets settles (UX Dropzone clears it a task later)
test('a file drop on the list or on the preview, outside the input, is refused: the files stay, the drag state settles to filled', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'multiple-files'));
    const fileInput = input(page);
    await fileInput.setInputFiles([text('a.txt'), text('b.txt')]);
    await expect(listItems(page)).toHaveCount(2);
    await expect(zone(page)).toHaveAttribute('data-state', 'filled');
    const events = await countEvents(page, ['dropzone:change', 'dropzone:clear', 'dropzone:remove', 'dropzone:reject']);

    const list = page.locator('[data-dropzone-assist-target="list"]');
    await fileDragOn(list, 'dragenter');
    await expect(zone(page)).toHaveAttribute('data-state', 'dragging');
    await expect(zone(page)).toHaveAttribute('data-dragging', '');
    expect(await fileDragOn(list, 'dragover')).toEqual({ prevented: true, dropEffect: 'none' });
    expect((await fileDragOn(list, 'drop')).prevented).toBe(true);

    await expect(zone(page)).toHaveAttribute('data-state', 'filled');
    await expect(zone(page)).not.toHaveAttribute('data-dragging');
    expect(await fileNames(fileInput)).toEqual(['a.txt', 'b.txt']);
    await expect(listItems(page)).toHaveCount(2);
    expect(await events()).toEqual({ 'dropzone:change': 0, 'dropzone:clear': 0, 'dropzone:remove': 0, 'dropzone:reject': 0 });

    // one file: the drag hides the preview (the input takes the drop), a drop that still lands on it is refused the same way
    await page.goto(previewUrl('dropzone', 'default'));
    await input(page).setInputFiles(png('tiny.png'));
    const remove = page.getByRole('button', { name: 'Remove tiny.png' });
    await expect(remove).toBeVisible();
    const preview = page.locator('[data-symfony--ux-dropzone--dropzone-target="preview"]');
    await fileDragOn(input(page), 'dragenter');
    await expect(zone(page)).toHaveAttribute('data-state', 'dragging');
    expect(await fileDragOn(preview, 'dragover')).toEqual({ prevented: true, dropEffect: 'none' });
    expect((await fileDragOn(preview, 'drop')).prevented).toBe(true);

    await expect(zone(page)).toHaveAttribute('data-state', 'filled');
    await expect(zone(page)).not.toHaveAttribute('data-dragging');
    expect(await fileNames(input(page))).toEqual(['tiny.png']);
    await expect(remove).toBeVisible();
    await expect(page.getByText('Drag and drop or browse')).toBeHidden();
});

test('a file dropped on the input: the zone settles to filled, its preview shown, for one file and for several', async ({ page }) => {
    for (const [example, name] of [['default', 'Profile picture'], ['multiple-files', 'Attachments']] as const) {
        await page.goto(previewUrl('dropzone', example));
        const fileInput = page.getByLabel(name);
        await fileDragOn(fileInput, 'dragenter');
        await expect(zone(page), example).toHaveAttribute('data-state', 'dragging');

        await dropFiles(fileInput, [{ name: 'dropped.png', type: 'image/png' }]);
        await expect(zone(page), example).toHaveAttribute('data-state', 'filled');
        await expect(zone(page), example).not.toHaveAttribute('data-dragging');
        await expect(page.getByRole('button', { name: 'Remove dropped.png' }), example).toBeVisible();
        expect(await fileNames(fileInput), example).toEqual(['dropped.png']);
        if ('default' === example) {
            await expect(fileInput).toBeHidden();
            await expect(page.getByText('Drag and drop or browse')).toBeHidden();
        } else {
            await expect(listItems(page)).toHaveCount(1);
        }
    }
});

// Stimulus disconnects the controllers when the zone leaves the document and connects them when it comes back: neither
// UX Dropzone's `data-state` nor the kit's `data-dragging` stays from the drag that was going on
test('a zone disconnected during a file drag shows no drag state once connected again, and takes a pick', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'default'));
    const fileInput = page.getByLabel('Profile picture');
    await fileDragOn(fileInput, 'dragenter');
    await expect(zone(page)).toHaveAttribute('data-state', 'dragging');
    await expect(zone(page)).toHaveAttribute('data-dragging', '');

    // out of the document until its controllers have disconnected, then back in the same place
    await zone(page).evaluate((element) => {
        (window as any).__zone = { element, parent: element.parentElement, next: element.nextSibling };
        element.remove();
    });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
    expect(await page.evaluate(() => (window as any).__zone.element.hasAttribute('data-dragging')), 'disconnected').toBe(false);
    await page.evaluate(() => {
        const { element, parent, next } = (window as any).__zone;
        parent.insertBefore(element, next);
    });

    await expect(zone(page)).toHaveAttribute('data-state', 'empty');
    await expect(zone(page)).not.toHaveAttribute('data-dragging');
    await expect(page.getByText('Drag and drop or browse')).toBeVisible();
    await expect(fileInput).toBeVisible();

    await fileInput.focus();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(png('tiny.png'));
    const remove = page.getByRole('button', { name: 'Remove tiny.png' });
    await expect(remove).toBeFocused();
    await expect(remove).toBeVisible();
    await expect(zone(page)).toHaveAttribute('data-state', 'filled');
    await expect(page.locator('[data-symfony--ux-dropzone--dropzone-target="previewImage"]')).toBeVisible();
});

// the dropzone README, Events: `dropzone:remove` after its `dropzone:change` (the removed file), and `dropzone:clear`
// when the zone becomes empty, so after the last of several files only
test('removing several files one by one: a change, then a remove naming the file, each time; one clear, after the last', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'multiple-files'));
    await input(page).setInputFiles([text('a.txt'), text('b.txt'), text('c.txt')]);
    await expect(listItems(page)).toHaveCount(3);
    const events = await recordDropzoneEvents(page);

    await page.getByRole('button', { name: 'Remove b.txt' }).click();
    await expect(listItems(page)).toHaveCount(2);
    expect(await events()).toEqual(['change a.txt,c.txt', 'remove b.txt']);
    await page.getByRole('button', { name: 'Remove a.txt' }).click();
    await page.getByRole('button', { name: 'Remove c.txt' }).click();
    await expect(listItems(page)).toHaveCount(0);
    expect(await events()).toEqual(['change a.txt,c.txt', 'remove b.txt', 'change c.txt', 'remove a.txt', 'change', 'remove c.txt', 'clear']);
    expect(await fileCount(page)).toBe(0);
});

// the dropzone README, Events: with `multiple`, a pick that adds nothing dispatches no `dropzone:change`; a file is
// the same file when its name, size and date are (UX Dropzone), so the files are made here with a fixed date
test('a pick of files already listed, in a zone for several files with no cap, adds nothing and dispatches no change', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'multiple-files'));
    await expect(input(page)).not.toHaveAttribute('data-symfony--ux-dropzone--dropzone-max-files-value');
    await expect(zone(page)).not.toHaveAttribute('data-symfony--ux-dropzone--dropzone-max-files-value');
    const counts = await countEvents(page, ['change', 'dropzone:change', 'dropzone:reject']);
    const events = await recordDropzoneEvents(page);
    const pick = (names: string[]) =>
        input(page).evaluate((element: HTMLInputElement, names) => {
            const files = new DataTransfer();
            for (const name of names) {
                files.items.add(new File([name], name, { type: 'text/plain', lastModified: 1 }));
            }
            element.files = files.files;
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }, names);

    await pick(['a.txt', 'b.txt']);
    await expect(listItems(page)).toHaveCount(2);
    await pick(['a.txt', 'b.txt']);
    await pick(['b.txt']);
    // the input's change event for each pick, one dropzone:change only for the pick that added files
    await expect.poll(async () => (await counts())['change']).toBe(3);
    expect(await counts()).toEqual({ change: 3, 'dropzone:change': 1, 'dropzone:reject': 0 });
    await expect(listItems(page)).toHaveCount(2);
    expect(await fileNames(input(page))).toEqual(['a.txt', 'b.txt']);

    // a pick with one new file among listed ones: one change, the new file added once
    await pick(['b.txt', 'c.txt']);
    await expect(listItems(page)).toHaveCount(3);
    expect(await counts()).toEqual({ change: 4, 'dropzone:change': 2, 'dropzone:reject': 0 });
    expect(await fileNames(input(page))).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(await events()).toEqual(['change a.txt,b.txt', 'change a.txt,b.txt,c.txt']);
});

test('a dropped file that accept refuses is left out with dropzone:reject; a dropped image is taken', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'hint-and-accepted-types'));
    const fileInput = input(page);
    await expect(fileInput).toHaveAttribute('accept', 'image/png,image/jpeg');
    const order = await recordDropzoneEvents(page, dropzoneAddEvents);

    await dropFiles(fileInput, [{ name: 'notes.txt', type: 'text/plain' }]);
    // nothing left to add: no dropzone:pre-add, no dropzone:change; no message shown, none logged (the fixtures fail on
    // a console error)
    await expect.poll(order).toEqual(['reject accept notes.txt']);
    await expectNoRejectMessage(page);
    // the zone stays empty: no file in the input, the box shown, no Remove button
    expect(await fileCount(page)).toBe(0);
    await expect(page.getByText('Drop an image or browse')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(0);

    await dropFiles(fileInput, [{ name: 'cover.png', type: 'image/png' }]);
    await expect(page.getByRole('button', { name: 'Remove cover.png' })).toBeVisible();
    expect(await fileCount(page)).toBe(1);
    const accepted = ['reject accept notes.txt', 'pre-add cover.png', 'change cover.png'];
    await expect.poll(order).toEqual(accepted);

    // a drop of a file accept refuses and an image: UX Dropzone reports the refused file first, then offers the image
    // alone to dropzone:pre-add, then dispatches dropzone:change
    await dropFiles(fileInput, [
        { name: 'draft.txt', type: 'text/plain' },
        { name: 'photo.jpg', type: 'image/jpeg' },
    ]);
    await expect(page.getByRole('button', { name: 'Remove photo.jpg' })).toBeVisible();
    expect(await fileNames(fileInput)).toEqual(['photo.jpg']);
    await expect.poll(order).toEqual([
        ...accepted,
        'reject accept draft.txt',
        'pre-add photo.jpg',
        'change photo.jpg',
    ]);
    await expectNoRejectMessage(page);
});

test('several files dropped on a zone for one file: the first is taken, the others left out with dropzone:reject', async ({ page }) => {
    await page.goto(previewUrl('dropzone', 'default'));
    const fileInput = input(page);
    await expect(fileInput).not.toHaveAttribute('multiple');
    const order = await recordDropzoneEvents(page, dropzoneAddEvents);

    // UX Dropzone keeps one file in such a zone whether the files come by a drop or are set on the input (a pick): the
    // others are left out the same way, `max_files` the reason, `accept` not involved (this zone has none)
    await dropFiles(fileInput, [
        { name: 'first.png', type: 'image/png' },
        { name: 'second.png', type: 'image/png' },
        { name: 'third.txt', type: 'text/plain' },
    ]);
    await expect(page.getByRole('button', { name: 'Remove first.png' })).toBeVisible();
    expect(await input(page).evaluate((element: HTMLInputElement) => [...(element.files ?? [])].map((file) => file.name))).toEqual(['first.png']);
    // UX Dropzone leaves the extra files out before dropzone:pre-add, whose listeners get the first file alone, and
    // reports them before the change
    await expect.poll(order).toEqual(['reject max_files second.png,third.txt', 'pre-add first.png', 'change first.png']);
    await expectNoRejectMessage(page);
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
