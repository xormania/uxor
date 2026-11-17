import type { Locator, Page } from '@playwright/test';
import { test, expect, countEvents } from './fixtures';
import { png, text } from './files';
import { back, sendStream, visit } from './transitions';

/*
 * The options of UX Dropzone 3.7 through the kit's Dropzone: a cap on the number of files (`maxFiles`, multiple zones;
 * `max_files` on a DropzoneType), and a preview made from a template (one file, several files). Files left out come with
 * `dropzone:reject` and their reason. A template zone keeps the kit's focus contract: a keyboard pick focuses its Remove
 * button, named "Remove <file>", and Remove puts the focus back on the input.
 */

const zoneOf = (page: Page, id: string) => page.locator(`[data-controller~="dropzone-assist"]:has(#${id})`);
const names = (input: Locator) => input.evaluate((element: HTMLInputElement) => [...(element.files ?? [])].map((file) => file.name));

/** Records every `dropzone:reject` from now on, as its reason and the names of its files. */
async function recordRejects(page: Page): Promise<() => Promise<{ reason: string; files: string[] }[]>> {
    await page.evaluate(() => {
        const rejected: { reason: string; files: string[] }[] = ((window as any).rejected = []);
        document.addEventListener('dropzone:reject', (event) => {
            const { reason, files } = (event as CustomEvent).detail;
            rejected.push({ reason, files: [...files].map((file: File) => file.name) });
        });
    });

    return () => page.evaluate(() => (window as any).rejected);
}

/** Drops files on the input as the browser does: the drop event, then the files set on the input and its change event. */
const dropFiles = (target: Locator, files: { name: string; type: string }[]) =>
    target.evaluate((element: HTMLInputElement, files) => {
        const dataTransfer = new DataTransfer();
        for (const { name, type } of files) {
            dataTransfer.items.add(new File([name], name, { type }));
        }
        element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
        element.files = dataTransfer.files;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }, files);

/** Picks files from the keyboard: the input focused, the chooser opened with Enter. */
async function pickFromKeyboard(page: Page, input: Locator, files: Parameters<typeof png>[0][]) {
    await input.focus();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(files.map((name) => (name.endsWith('.png') ? png(name) : text(name))));
}

// ---------------------------------------------------------------------------------------------------------------------
// The cap

test('a zone capped at two files keeps two of three picked at once and leaves the third out with dropzone:reject', async ({ page }) => {
    await page.goto('/lab/dropzone-options');
    // `maxFiles` with `multiple`: the cap on the wrapper, where UX Dropzone reads it
    await expect(zoneOf(page, 'capped')).toHaveAttribute('data-symfony--ux-dropzone--dropzone-max-files-value', '2');
    const events = await countEvents(page, ['dropzone:change', 'dropzone:reject']);
    const rejects = await recordRejects(page);

    await page.locator('#capped').setInputFiles([text('a.txt'), text('b.txt'), text('c.txt')]);
    await expect(zoneOf(page, 'capped').locator('.dropzone-preview-list-item')).toHaveCount(2);
    expect(await names(page.locator('#capped'))).toEqual(['a.txt', 'b.txt']);
    await expect.poll(rejects).toEqual([{ reason: 'max_files', files: ['c.txt'] }]);
    expect(await events()).toEqual({ 'dropzone:change': 1, 'dropzone:reject': 1 });
});

test('a full capped zone takes no more until a file is removed; a file picked again counts once', async ({ page }) => {
    await page.goto('/lab/dropzone-options');
    const input = page.locator('#capped');
    await input.setInputFiles([text('a.txt'), text('b.txt')]);
    await expect(zoneOf(page, 'capped').locator('.dropzone-preview-list-item')).toHaveCount(2);
    const events = await countEvents(page, ['dropzone:change', 'dropzone:reject']);
    const rejects = await recordRejects(page);

    await input.setInputFiles(text('c.txt'));
    await expect.poll(rejects).toEqual([{ reason: 'max_files', files: ['c.txt'] }]);
    expect(await names(input)).toEqual(['a.txt', 'b.txt']);
    expect(await events()).toEqual({ 'dropzone:change': 0, 'dropzone:reject': 1 });

    // a file the zone holds, picked again (same name, size and date): neither added nor left out
    await input.evaluate((element: HTMLInputElement) => {
        const again = new DataTransfer();
        again.items.add(element.files![0]);
        element.files = again.files;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(await names(input)).toEqual(['a.txt', 'b.txt']);
    expect(await events()).toEqual({ 'dropzone:change': 0, 'dropzone:reject': 1 });

    await page.getByRole('button', { name: 'Remove a.txt' }).click();
    await expect(page.getByRole('button', { name: 'Remove b.txt' })).toBeFocused();
    await input.setInputFiles(text('c.txt'));
    await expect(page.getByRole('button', { name: 'Remove c.txt' })).toBeVisible();
    expect(await names(input)).toEqual(['b.txt', 'c.txt']);
    // the Remove and the pick: one change each
    expect(await events()).toEqual({ 'dropzone:change': 2, 'dropzone:reject': 1 });
});

test('a drop over the cap with a file accept refuses: one reject for accept, one for max_files, each naming its files', async ({ page }) => {
    await page.goto('/lab/dropzone-options');
    const rejects = await recordRejects(page);
    await dropFiles(page.locator('#capped-images'), [
        { name: 'one.png', type: 'image/png' },
        { name: 'notes.txt', type: 'text/plain' },
        { name: 'two.png', type: 'image/png' },
        { name: 'three.png', type: 'image/png' },
    ]);

    await expect(zoneOf(page, 'capped-images').locator('.dropzone-preview-list-item')).toHaveCount(2);
    expect(await names(page.locator('#capped-images'))).toEqual(['one.png', 'two.png']);
    // upstream reports the files accept refused, then the ones over the cap
    await expect.poll(rejects).toEqual([
        { reason: 'accept', files: ['notes.txt'] },
        { reason: 'max_files', files: ['three.png'] },
    ]);
});

test('a DropzoneType with max_files caps its zone in the browser', async ({ page }) => {
    await page.goto('/lab/dropzone-form');
    const input = page.locator('#upload_demo_attachments');
    // UploadDemoType's attachments: `max_files: 3` (the lab's Turbo form test posts two)
    await expect(zoneOf(page, 'upload_demo_attachments')).toHaveAttribute('data-symfony--ux-dropzone--dropzone-max-files-value', '3');
    const rejects = await recordRejects(page);
    await input.setInputFiles([text('a.txt'), text('b.txt'), text('c.txt'), text('d.txt')]);
    expect(await names(input)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    await expect.poll(rejects).toEqual([{ reason: 'max_files', files: ['d.txt'] }]);
});

// ---------------------------------------------------------------------------------------------------------------------
// The preview template

test('a preview template for one file shows the picked file; its Remove, focused after a keyboard pick and named by the file, empties the zone', async ({ page }) => {
    await page.goto('/lab/dropzone-options');
    const input = page.getByLabel('Templated file', { exact: true });
    await pickFromKeyboard(page, input, ['photo.png']);

    const item = page.getByTestId('templated-item');
    await expect(item).toHaveCount(1);
    await expect(item.locator('[data-dropzone-slot="filename"]')).toHaveText('photo.png');
    // the image slot loads the picked image under the policy (img-src data:); the fixtures fail on a violation
    await expect(item.locator('[data-dropzone-slot="image"]')).toBeVisible();
    await expect(item.locator('[data-dropzone-slot="image"]')).toHaveAttribute('src', /^data:image\/png;/);

    const remove = page.getByRole('button', { name: 'Remove photo.png' });
    await expect(remove).toBeFocused();
    await page.keyboard.press('Enter');
    // the kit's capture of the remove slot's click: Remove gives the focus back to the input
    await expect(input).toBeFocused();
    await expect(page.getByTestId('templated-item')).toHaveCount(0);
    await expect(zoneOf(page, 'templated').locator('[data-symfony--ux-dropzone--dropzone-target="placeholder"]')).toBeVisible();
    expect(await names(input)).toEqual([]);
});

test('a preview template for several files: one item per file, each Remove named by its file, focus to the next, then the input', async ({ page }) => {
    await page.goto('/lab/dropzone-options');
    const input = page.locator('#templated-list');
    await input.setInputFiles([text('a.txt'), text('b.txt'), png('c.png')]);

    const items = page.getByTestId('templated-list-item');
    await expect(items).toHaveCount(3);
    await expect(items.locator('[data-dropzone-slot="filename"]')).toHaveText(['a.txt', 'b.txt', 'c.png']);
    expect(await names(input)).toEqual(['a.txt', 'b.txt', 'c.png']);

    await page.getByRole('button', { name: 'Remove b.txt' }).click();
    await expect(items).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Remove c.png' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Remove a.txt' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(items).toHaveCount(0);
    await expect(page.getByLabel('Templated files', { exact: true })).toBeFocused();
    expect(await names(input)).toEqual([]);
});

test('a templated zone in a POST form keeps its file and its template preview after Back; a Stream gives a fresh empty templated zone', async ({ page }) => {
    await page.goto('/lab/dropzone-options');
    await page.locator('#templated-post').setInputFiles(png('kept.png'));
    await expect(page.getByTestId('templated-post-item').locator('[data-dropzone-slot="filename"]')).toHaveText('kept.png');

    await visit(page, 'Go to page two', 'Page two');
    await back(page, 'Page one');
    await expect(page.getByTestId('templated-post-item')).toHaveCount(1);
    await expect(page.getByTestId('templated-post-item').locator('[data-dropzone-slot="filename"]')).toHaveText('kept.png');
    await expect(page.getByRole('button', { name: 'Remove kept.png' })).toBeVisible();
    expect(await names(page.locator('#templated-post'))).toEqual(['kept.png']);
    // one controller per zone: five on the page, one in the streamed region
    await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(6);

    for (const action of ['replace', 'update'] as const) {
        await page.locator('#streamed-templated').setInputFiles(png('streamed.png'));
        await expect(page.getByTestId('streamed-templated-item')).toHaveCount(1);
        await sendStream(page, action);
        await expect(page.getByTestId('streamed-templated-item')).toHaveCount(0);
        await expect(zoneOf(page, 'streamed-templated').locator('[data-symfony--ux-dropzone--dropzone-target="placeholder"]')).toBeVisible();
        expect(await names(page.locator('#streamed-templated'))).toEqual([]);
        await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(6);
    }

    const events = await countEvents(page, ['dropzone:change']);
    await page.locator('#streamed-templated').setInputFiles(png('new.png'));
    await expect(page.getByRole('button', { name: 'Remove new.png' })).toBeVisible();
    expect(await events()).toEqual({ 'dropzone:change': 1 });
});

// ---------------------------------------------------------------------------------------------------------------------
// The preview template: a click on the remove slot's icon, restoration, the form theme's block

test('a click on the icon inside a template\'s Remove: one file, the focus goes to the input; several, to the next Remove', async ({ page }) => {
    await page.goto('/lab/dropzone-options');
    const single = page.getByLabel('Templated file', { exact: true });
    await single.setInputFiles(png('photo.png'));
    await page.getByRole('button', { name: 'Remove photo.png' }).locator('svg').click();
    await expect(single).toBeFocused();
    await expect(page.getByTestId('templated-item')).toHaveCount(0);
    expect(await names(single)).toEqual([]);

    const list = page.locator('#templated-list');
    await list.setInputFiles([text('a.txt'), text('b.txt'), text('c.txt')]);
    await page.getByRole('button', { name: 'Remove b.txt' }).locator('svg').click();
    await expect(page.getByRole('button', { name: 'Remove c.txt' })).toBeFocused();
    await expect(page.getByTestId('templated-list-item')).toHaveCount(2);
    expect(await names(list)).toEqual(['a.txt', 'c.txt']);
});

// as for the default markup (lab.dropzone, restoring Back and Forward): a zone for one file outside a POST form starts
// empty in Turbo's copy; the kit clears it through UX Dropzone (one dropzone:clear) when the browser's copy of the input
// kept its file (Chromium, Firefox), and has nothing to clear when it did not (WebKit)
test('a templated zone for one file outside a form, after Back: no template item, no file, one dropzone:clear where the copy kept the file', async ({ page }) => {
    await page.goto('/lab/dropzone-options');
    await page.locator('#templated').setInputFiles(png('photo.png'));
    await expect(page.getByTestId('templated-item')).toHaveCount(1);
    const copyKeeps = await page.locator('#templated').evaluate((element: HTMLInputElement) => ((element.cloneNode(true) as HTMLInputElement).files?.length ?? 0) > 0);
    test.info().annotations.push({ type: 'copy of a file input', description: copyKeeps ? 'keeps its file' : 'loses its file' });
    const clears = await countEvents(page, ['dropzone:clear'], '[data-controller~="dropzone-assist"]:has(#templated)');

    await visit(page, 'Go to page two', 'Page two');
    await back(page, 'Page one');
    expect((await clears())['dropzone:clear']).toBe(copyKeeps ? 1 : 0);
    await expect(page.getByTestId('templated-item')).toHaveCount(0);
    await expect(zoneOf(page, 'templated').locator('[data-symfony--ux-dropzone--dropzone-target="placeholder"]')).toBeVisible();
    expect(await names(page.locator('#templated'))).toEqual([]);

    await page.locator('#templated').setInputFiles(png('again.png'));
    await expect(page.getByTestId('templated-item').locator('[data-dropzone-slot="filename"]')).toHaveText('again.png');
});

test('a templated zone for several files, after Back: one template item per file the input holds', async ({ page }) => {
    await page.goto('/lab/dropzone-options');
    await page.locator('#templated-list').setInputFiles([text('a.txt'), text('b.txt')]);
    await expect(page.getByTestId('templated-list-item')).toHaveCount(2);

    await visit(page, 'Go to page two', 'Page two');
    await back(page, 'Page one');
    // Turbo's copy of the input keeps its files in some engines (Chromium), not in others: the list shows what it holds
    const held = await names(page.locator('#templated-list'));
    await expect(page.getByTestId('templated-list-item')).toHaveCount(held.length);
    await expect(page.getByTestId('templated-list-item').locator('[data-dropzone-slot="filename"]')).toHaveText(held);
    await expect(page.locator('[data-controller~="dropzone-assist"]:has(#templated-list)')).toHaveCount(1);
});

test('a DropzoneType through the form theme\'s dropzone_preview_item: the item shows the file, Remove by name empties it, and the form posts the file (303)', async ({ page }) => {
    await page.goto('/lab/dropzone-options?form=1');
    const input = page.locator('#form_document');
    await input.setInputFiles(text('first.txt'));
    const item = page.getByTestId('themed-item');
    await expect(item).toHaveCount(1);
    await expect(item.locator('[data-dropzone-slot="filename"]')).toHaveText('first.txt');
    await page.getByRole('button', { name: 'Remove first.txt' }).click();
    await expect(input).toBeFocused();
    await expect(item).toHaveCount(0);
    expect(await names(input)).toEqual([]);

    await input.setInputFiles(text('report.txt'));
    await expect(item.locator('[data-dropzone-slot="filename"]')).toHaveText('report.txt');
    const posted = page.waitForResponse((response) => 'POST' === response.request().method() && response.url().includes('/lab/dropzone-options'));
    await page.getByRole('button', { name: 'Send the document' }).click();
    expect((await posted).status()).toBe(303);
    await expect(page.getByTestId('posted')).toHaveText('posted=report.txt');
    expect(new URL(page.url()).searchParams.get('posted')).toBe('report.txt');
});

// ---------------------------------------------------------------------------------------------------------------------
// The main line of a DropzoneType's box

// `placeholder: false` (the recipe's DropzonePlaceholderExtension tells the widget) shows the icon and no main line; a
// field given `attr` but no placeholder keeps the default one, which the extension exists to protect. A field's help is
// below its box, and describes its input.
test('a DropzoneType with placeholder false: an icon and no main line, the input named and described, a pick and Remove as on any zone', async ({ page }) => {
    await page.goto('/lab/dropzone-options?form=quiet');
    const input = page.getByLabel('Quiet file', { exact: true });
    await expect(input).toHaveAttribute('type', 'file');
    await expect(input).toHaveAccessibleDescription('PNG or JPG, up to 1 MB.');

    const box = zoneOf(page, 'form_quiet').locator('[data-symfony--ux-dropzone--dropzone-target="placeholder"]');
    await expect(box).toBeVisible();
    await expect(box.locator('svg')).toBeVisible();
    // no main line: the box holds the icon alone, not the default "Drag and drop or browse"
    await expect(box.locator('p')).toHaveCount(0);
    await expect(box).not.toContainText('Drag and drop or browse');

    // a pick from the keyboard and Remove, as on any zone
    await input.focus();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(png('quiet.png'));
    const remove = page.getByRole('button', { name: 'Remove quiet.png' });
    await expect(remove).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();
    await expect(box).toBeVisible();
    expect(await names(input)).toEqual([]);
});

test('a DropzoneType given attr and no placeholder keeps the default main line', async ({ page }) => {
    await page.goto('/lab/dropzone-options?form=quiet');
    const input = page.getByLabel('Plain file', { exact: true });
    await expect(input).toHaveAttribute('accept', 'image/png,image/jpeg');
    await expect(input).toHaveAccessibleDescription('PNG or JPG.');
    const box = zoneOf(page, 'form_plain').locator('[data-symfony--ux-dropzone--dropzone-target="placeholder"]');
    await expect(box.locator('p')).toHaveText(['Drag and drop or browse']);
    await expect(box.locator('svg')).toBeVisible();
});
