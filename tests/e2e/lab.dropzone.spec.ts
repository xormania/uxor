import type { Locator, Page } from '@playwright/test';
import { test, expect, turboVisitDone, countEvents } from './fixtures';
import { png, text } from './files';
import { advanceFrame, back, forward, reloadFrames, sendStream, turboOperation, visit } from './transitions';

/*
 * Dropzones under Turbo: a zone that Turbo shows again (Back, a Stream) works, with one controller, and shows what its
 * input holds (one file: nothing); a multipart form inside a Turbo Frame posts its file; a controller passed to the
 * Dropzone gets its actions, values and target. A POST form's zone across each transition, a data-turbo-permanent one
 * included, and its Remove button after it: lab.value-matrix (`a dropzone in a POST form`).
 */

const zoneOf = (page: Page, id: string) => page.locator(`[data-controller~="dropzone-assist"]:has(#${id})`);
const fileCount = (input: Locator) => input.evaluate((element: HTMLInputElement) => element.files?.length ?? 0);

/** Counts the `dropzone:change`, `dropzone:clear` and `dropzone:remove` events from now on, by type. */
const countDropzoneEvents = (page: Page) => countEvents(page, ['dropzone:change', 'dropzone:clear', 'dropzone:remove']);

/** The zone of one file shows its box and no file. */
async function expectEmptySingle(page: Page, id: string) {
    const zone = zoneOf(page, id);
    await expect(zone.locator('[data-symfony--ux-dropzone--dropzone-target="placeholder"]')).toBeVisible();
    await expect(zone.locator('[data-symfony--ux-dropzone--dropzone-target="preview"]')).toBeHidden();
    await expect(page.locator(`#${id}`)).toBeVisible();
    expect(await fileCount(page.locator(`#${id}`))).toBe(0);
}

test('after a Turbo visit and Back, the zones are empty, have one controller each, and take a new pick', async ({ page }) => {
    await page.goto('/lab/dropzone-turbo');
    await page.locator('#photo').setInputFiles(png('tiny.png'));
    await page.locator('#attachments').setInputFiles([text('a.txt'), text('b.txt')]);
    await expect(page.getByRole('button', { name: 'Remove tiny.png' })).toBeVisible();
    await expect(page.locator('.dropzone-preview-list-item')).toHaveCount(2);

    await visit(page, 'Go to page two', 'Page two');
    await back(page, 'Page one');

    await expectEmptySingle(page, 'photo');
    // Turbo's copy of the page may hold the files of an input (Chromium copies them): the list shows what it holds
    const kept = await fileCount(page.locator('#attachments'));
    await expect(page.locator('.dropzone-preview-list-item')).toHaveCount(kept);
    await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(4);
    await expect(page.locator('[data-controller~="dropzone-assist"][data-dragging]')).toHaveCount(0);

    const events = await countDropzoneEvents(page);
    await page.locator('#photo').setInputFiles(png('again.png'));
    await expect(page.getByRole('button', { name: 'Remove again.png' })).toBeVisible();
    await page.locator('#attachments').setInputFiles(text('c.txt'));
    await expect(page.locator('.dropzone-preview-list-item')).toHaveCount(kept + 1);
    expect(await fileCount(page.locator('#attachments'))).toBe(kept + 1);
    expect((await events())['dropzone:change']).toBe(2);
});

test('after a visit and Back, every file of a POST form comes back, also with more zones than Turbo keeps copies', async ({ page }) => {
    // 11 single-file zones in one copy of the page: the files are kept per copy, not per zone (Turbo keeps 10 copies)
    await page.goto('/lab/dropzone-turbo?zones=11');
    for (let i = 1; i <= 11; i++) {
        await page.locator(`#many-${i}`).setInputFiles(png(`f${i}.png`));
        await expect(page.getByRole('button', { name: `Remove f${i}.png` })).toBeVisible();
    }

    await visit(page, 'Go to page two', 'Page two');
    await back(page, 'Page one');

    for (let i = 1; i <= 11; i++) {
        await expect(page.getByRole('button', { name: `Remove f${i}.png` })).toBeVisible();
        expect(await fileCount(page.locator(`#many-${i}`)), `#many-${i}`).toBe(1);
    }
});

// Turbo copies the page as the frame visit starts, before its turbo:before-cache: Back and Forward follow the contract of
// any Back (the zones of one file in a POST form keep it, the others start empty, the permanent one keeps its file)
test('beside a frame visit promoted to history, Back and Forward keep the files of a POST form\'s zones and the permanent one; the others start empty', async ({ page }) => {
    await page.goto('/lab/dropzone-turbo?zones=2');
    await page.locator('#photo').setInputFiles(png('photo.png'));
    await page.locator('#attachments').setInputFiles([text('a.txt'), text('b.txt')]);
    await page.locator('#many-1').setInputFiles(png('f1.png'));
    await page.locator('#many-2').setInputFiles(png('f2.png'));
    await page.locator('#kept').setInputFiles(png('kept.png'));
    for (const name of ['photo.png', 'f1.png', 'f2.png', 'kept.png']) {
        await expect(page.getByRole('button', { name: `Remove ${name}` })).toBeVisible();
    }
    const before = page.url();

    await advanceFrame(page, 'dropzone-frame');
    const advanced = page.url();
    // beside the frame, every zone is left alone
    for (const [id, name] of [['photo', 'photo.png'], ['many-1', 'f1.png'], ['many-2', 'f2.png'], ['kept', 'kept.png']]) {
        await expect(page.getByRole('button', { name: `Remove ${name}` })).toBeVisible();
        expect(await fileCount(page.locator(`#${id}`)), id).toBe(1);
    }
    await expect(page.locator('.dropzone-preview-list-item')).toHaveCount(2);

    for (const [action, url] of [[() => page.goBack(), before], [() => page.goForward(), advanced]] as const) {
        await turboOperation(page, { url }, action);
        await turboVisitDone(page);
        for (const [id, name] of [['many-1', 'f1.png'], ['many-2', 'f2.png'], ['kept', 'kept.png']]) {
            await expect(page.getByRole('button', { name: `Remove ${name}` }), `${url}: #${id}`).toBeVisible();
            expect(await fileCount(page.locator(`#${id}`)), `${url}: #${id}`).toBe(1);
        }
        await expectEmptySingle(page, 'photo');
        // the list shows what the input holds (Chromium's copy of an input keeps its files)
        const kept = await fileCount(page.locator('#attachments'));
        await expect(page.locator('.dropzone-preview-list-item')).toHaveCount(kept);
        await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(6);
    }

    // the zones still take a pick: one change each
    const events = await countDropzoneEvents(page);
    await page.locator('#photo').setInputFiles(png('again.png'));
    await expect(page.getByRole('button', { name: 'Remove again.png' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove f1.png' }).click();
    await expectEmptySingle(page, 'many-1');
    expect((await events())['dropzone:change']).toBe(1);
    expect((await events())['dropzone:clear']).toBe(1);
});

// the dropzone README: a zone for one file in a GET form, which cannot send files, starts empty after Back and Forward.
// Chromium, Firefox and WebKit hand no kept file to an input inside a form when Turbo shows its copy of the page
// (Chromium and Firefox do outside one: the test below), so this guards the contract rather than reproducing a defect.
test('after Back and after Forward, the zone of one file in a GET form starts empty and takes a new pick', async ({ page }) => {
    // `?get=1` adds the GET form, on both pages: the links keep it
    await page.goto('/lab/dropzone-turbo/two?get=1');
    await visit(page, 'Go to page one', 'Page one');
    await page.locator('#searched').setInputFiles(png('searched.png'));
    await expect(page.getByRole('button', { name: 'Remove searched.png' })).toBeVisible();

    await visit(page, 'Go to page two', 'Page two');
    await back(page, 'Page one');
    await expectEmptySingle(page, 'searched');
    await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(5);

    // picked again, then Back to page two and Forward to this page: Turbo's copy of it, taken as Back left it
    await page.locator('#searched').setInputFiles(png('again.png'));
    await expect(page.getByRole('button', { name: 'Remove again.png' })).toBeVisible();
    await back(page, 'Page two');
    await forward(page, 'Page one');
    await expectEmptySingle(page, 'searched');
    await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(5);

    const events = await countDropzoneEvents(page);
    await page.locator('#searched').setInputFiles(png('third.png'));
    await expect(page.getByRole('button', { name: 'Remove third.png' })).toBeVisible();
    expect(await fileCount(page.locator('#searched'))).toBe(1);
    expect((await events())['dropzone:change']).toBe(1);
});

test('after Back and Forward, the zone of one file outside a form starts empty and takes a new pick', async ({ page }) => {
    await page.goto('/lab/dropzone-turbo/two');
    await visit(page, 'Go to page one', 'Page one');
    await page.locator('#photo').setInputFiles(png('tiny.png'));
    await expect(page.getByRole('button', { name: 'Remove tiny.png' })).toBeVisible();

    // Back leaves the page with the file picked: Forward shows Turbo's copy of it
    await back(page, 'Page two');
    await forward(page, 'Page one');
    await expectEmptySingle(page, 'photo');
    await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(4);

    const events = await countDropzoneEvents(page);
    await page.locator('#photo').setInputFiles(png('again.png'));
    await expect(page.getByRole('button', { name: 'Remove again.png' })).toBeVisible();
    expect(await fileCount(page.locator('#photo'))).toBe(1);
    expect((await events())['dropzone:change']).toBe(1);
});

// The kit empties a restored zone outside a POST form through UX Dropzone, which says so with one `dropzone:clear` (the
// dropzone README, Events), and only when the browser's copy of the input brought the file back: Chromium's and
// Firefox's copy of a file input keeps its files, WebKit's does not, so there is nothing to clear there. The engine's
// answer is read from the input itself (a clone, as Turbo copies the page), not from its name.
test('restoring Back and Forward, the zone outside a form that came back with its file dispatches one dropzone:clear and moves no focus; a POST form\'s zone and the permanent one none', async ({ page }) => {
    await page.goto('/lab/dropzone-turbo?zones=1');
    await page.locator('#photo').setInputFiles(png('photo.png'));
    await page.locator('#many-1').setInputFiles(png('f1.png'));
    await page.locator('#kept').setInputFiles(png('kept.png'));
    for (const name of ['photo.png', 'f1.png', 'kept.png']) {
        await expect(page.getByRole('button', { name: `Remove ${name}` })).toBeVisible();
    }
    const copyKeeps = await page.locator('#photo').evaluate((element: HTMLInputElement) => ((element.cloneNode(true) as HTMLInputElement).files?.length ?? 0) > 0);
    test.info().annotations.push({ type: 'copy of a file input', description: copyKeeps ? 'keeps its file' : 'loses its file' });
    // counted on `document`, which Turbo keeps across its visits: the zones the restored copy brings are counted too
    const clears = {
        photo: await countEvents(page, ['dropzone:clear'], '[data-controller~="dropzone-assist"]:has(#photo)'),
        post: await countEvents(page, ['dropzone:clear'], '[data-controller~="dropzone-assist"]:has(#many-1)'),
        kept: await countEvents(page, ['dropzone:clear'], '[data-controller~="dropzone-assist"]:has(#kept)'),
    };
    // the clear is the kit's, not the user's Remove: it moves no focus (the focus moves to the input only after Remove)
    const focused = await countEvents(page, ['focusin'], 'input[type="file"]');

    await visit(page, 'Go to page two', 'Page two');
    await back(page, 'Page one');
    expect((await clears.photo())['dropzone:clear'], 'Back: #photo').toBe(copyKeeps ? 1 : 0);
    expect((await clears.post())['dropzone:clear'], 'Back: #many-1').toBe(0);
    expect((await clears.kept())['dropzone:clear'], 'Back: #kept').toBe(0);
    expect((await focused())['focusin'], 'Back: focus moved to a file input').toBe(0);
    expect(await page.evaluate(() => document.activeElement?.matches('input[type="file"]') ?? false), 'Back: a file input has the focus').toBe(false);
    await expectEmptySingle(page, 'photo');
    expect(await fileCount(page.locator('#many-1'))).toBe(1);
    expect(await fileCount(page.locator('#kept'))).toBe(1);

    // Forward: page one again, its file picked, left by Back, then shown again from Turbo's copy
    await visit(page, 'Go to page two', 'Page two');
    await visit(page, 'Go to page one', 'Page one');
    await page.locator('#photo').setInputFiles(png('again.png'));
    await expect(page.getByRole('button', { name: 'Remove again.png' })).toBeVisible();
    const forwardClears = await countEvents(page, ['dropzone:clear'], '[data-controller~="dropzone-assist"]:has(#photo)');
    await back(page, 'Page two');
    await forward(page, 'Page one');
    expect((await forwardClears())['dropzone:clear'], 'Forward: #photo').toBe(copyKeeps ? 1 : 0);
    expect((await clears.kept())['dropzone:clear'], 'Forward: #kept').toBe(0);
    expect((await focused())['focusin'], 'Forward: focus moved to a file input').toBe(0);
    expect(await page.evaluate(() => document.activeElement?.matches('input[type="file"]') ?? false), 'Forward: a file input has the focus').toBe(false);
    await expectEmptySingle(page, 'photo');
    expect(await fileCount(page.locator('#kept'))).toBe(1);
});

test('repeated Turbo visits leave one controller per zone and one change per pick', async ({ page }) => {
    await page.goto('/lab/dropzone-turbo');
    for (let visitCount = 0; visitCount < 6; visitCount++) {
        await visit(page, /Go to page/, visitCount % 2 ? 'Page one' : 'Page two');
    }
    await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(4);
    const events = await countDropzoneEvents(page);
    await page.locator('#photo').setInputFiles(png('tiny.png'));
    await page.locator('#attachments').setInputFiles([text('a.txt'), text('b.txt')]);
    await expect(page.locator('.dropzone-preview-list-item')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Remove tiny.png' })).toBeVisible();
    expect((await events())['dropzone:change']).toBe(2);
});

test('a multipart form inside a Turbo Frame reloaded three times posts its file: 303 into the frame, 422 with the error', async ({ page, allowHttpError }) => {
    allowHttpError(/\/lab\/dropzone-turbo$/, 422);
    await page.goto('/lab/dropzone-turbo');
    const url = page.url();
    await reloadFrames(page);
    await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(4);

    // not an image: a 422 shows the error in the frame, the zone empty and invalid
    await page.locator('#framed').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.locator('#framed_error')).toBeVisible();
    await expect(page.locator('#framed')).toHaveAttribute('aria-invalid', 'true');
    await expectEmptySingle(page, 'framed');
    expect(page.url()).toBe(url);

    await page.locator('#framed').setInputFiles(png('tiny.png'));
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByTestId('framed')).toHaveText('framed=tiny.png');
    await expect(page.locator('#framed_error')).toHaveCount(0);
    await expectEmptySingle(page, 'framed');
    expect(page.url()).toBe(url);
    await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(4);
});

test('replaced or updated by a Turbo Stream, the new zone is empty, works, and has one controller', async ({ page }) => {
    await page.goto('/lab/dropzone-stream');
    for (const action of ['replace', 'update'] as const) {
        await page.locator('#streamed').setInputFiles(png('tiny.png'));
        await expect(page.getByRole('button', { name: 'Remove tiny.png' })).toBeVisible();
        await page.locator('#streamed').dispatchEvent('dragenter');
        await expect(page.locator('[data-controller~="dropzone-assist"][data-dragging]')).toHaveCount(1);

        await sendStream(page, action);
        await expectEmptySingle(page, 'streamed');
        await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(1);
        await expect(page.locator('[data-controller~="dropzone-assist"][data-dragging]')).toHaveCount(0);
    }

    const events = await countDropzoneEvents(page);
    await page.locator('#streamed').setInputFiles(png('new.png'));
    await expect(page.getByRole('button', { name: 'Remove new.png' })).toBeVisible();
    expect((await events())['dropzone:change']).toBe(1);
});

test('a controller passed to the Dropzone gets its actions, values and target', async ({ page }) => {
    await page.goto('/lab/dropzone-events');
    const zone = zoneOf(page, 'echoed');
    await expect(zone).toHaveAttribute('data-controller', 'symfony--ux-dropzone--dropzone dropzone-assist dropzone-echo');
    await expect(zone).toHaveAttribute('data-dropzone-echo-prefix-value', 'caller');
    await expect(page.locator('#echoed')).toHaveAttribute('data-dropzone-echo-target', 'input');
    await expect(page.locator('#echoed')).not.toHaveAttribute('data-action');

    await page.locator('#echoed').setInputFiles([png('a.png'), png('b.png')]);
    await expect(page.getByTestId('echo')).toHaveText('caller dropzone:change echoed[] 2');
    await page.getByRole('button', { name: 'Remove a.png' }).click();
    await expect(page.getByTestId('echo')).toHaveText('caller dropzone:remove echoed[] 1');
});

test('a Turbo form posts its DropzoneType files; a Live re-render beside it leaves the picked files alone', async ({ page, allowHttpError }) => {
    allowHttpError(/\/lab\/dropzone-form$/, 422);
    await page.goto('/lab/dropzone-form');
    await page.locator('#upload_demo_photo').setInputFiles(png('tiny.png'));
    await page.locator('#upload_demo_attachments').setInputFiles([text('a.txt'), text('b.txt')]);
    await page.getByRole('button', { name: 'Increment' }).click();
    await expect(page.getByTestId('count')).toHaveText('1');
    expect(await fileCount(page.locator('#upload_demo_photo'))).toBe(1);
    expect(await fileCount(page.locator('#upload_demo_attachments'))).toBe(2);

    // an empty title sends the valid files back: the boxes say so
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.locator('#upload_demo_title')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#upload_demo_photo')).toHaveAccessibleDescription('PNG or JPG, up to 1 MB. tiny.png was not kept: choose it again.');

    await page.getByRole('textbox', { name: 'Title' }).fill('Trip');
    await page.locator('#upload_demo_photo').setInputFiles(png('tiny.png'));
    await page.locator('#upload_demo_attachments').setInputFiles([text('a.txt'), text('b.txt')]);
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByTestId('submitted')).toHaveText('photo=tiny.png; attachments=a.txt,b.txt');
    expect(new URL(page.url()).searchParams.get('submitted')).toBe('photo=tiny.png; attachments=a.txt,b.txt');
    await expect(zoneOf(page, 'upload_demo_photo')).toHaveCount(1);
});

test('in a Live Component, files go up through a files action: re-renders keep them, each upload gives a fresh zone', async ({ page }) => {
    await page.goto('/lab/live-dropzone');
    const photos = page.getByLabel('Photos', { exact: true });
    await photos.setInputFiles([png('a.png'), png('b.png')]);
    await page.getByRole('textbox', { name: 'Note' }).fill('hello');
    await expect(page.getByTestId('note')).toHaveText('hello');
    await expect(page.locator('.dropzone-preview-list-item')).toHaveCount(2);
    expect(await fileCount(photos)).toBe(2);

    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByTestId('uploads').locator('li')).toHaveText([/^a\.png \(\d+ bytes\)$/, /^b\.png \(\d+ bytes\)$/]);
    await expect(photos).toHaveAttribute('id', 'photos-1');
    await expect(page.locator('.dropzone-preview-list-item')).toHaveCount(0);
    expect(await fileCount(photos)).toBe(0);
    await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(1);

    await photos.setInputFiles(text('notes.txt'));
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(photos).toHaveAttribute('aria-invalid', 'true');
    await expect(photos).toHaveAccessibleDescription(/not a valid image/);
    await expect(page.locator('.dropzone-preview-list-item')).toHaveCount(0);
    await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(1);
    await expect(page.getByTestId('uploads').locator('li')).toHaveCount(2);
});
