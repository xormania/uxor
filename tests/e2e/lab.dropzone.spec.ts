import type { Locator, Page } from '@playwright/test';
import { test, expect, turboVisitDone, countEvents, zoneOf } from './fixtures';
import { png, text } from './files';
import { advanceFrame, back, forward, reloadFrames, sendStream, turboOperation, visit } from './transitions';

/*
 * Dropzones under Turbo: a zone that Turbo shows again (Back, a Stream) works, with one controller, and shows what its
 * input holds (one file: nothing); a multipart form inside a Turbo Frame posts its file; a controller passed to the
 * Dropzone gets its actions, values and target. A POST form's zone across each transition, a data-turbo-permanent one
 * included, and its Remove button after it: lab.value-matrix (`a dropzone in a POST form`).
 */

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

/** Each of the `?zones=<n>` zones shows its file `f<i>.png` and its input holds it. */
async function expectManyKept(page: Page, zones: number, step: string) {
    for (let i = 1; i <= zones; i++) {
        await expect(page.getByRole('button', { name: `Remove f${i}.png` }), `${step}: #many-${i}`).toBeVisible();
        expect(await fileCount(page.locator(`#many-${i}`)), `${step}: #many-${i}`).toBe(1);
    }
}

// The eleven zones of one copy, Back and then Forward: page one is reached by a Turbo visit from page two (the link
// to page one drops `?zones`), so Back goes to page two and Forward shows Turbo's copy of page one, taken as Back left it
test('after Back, and after Back and Forward, every file of a POST form with more zones than Turbo keeps copies comes back', async ({ page }) => {
    await page.goto('/lab/dropzone-turbo/two');
    const one = new URL('/lab/dropzone-turbo?zones=11', page.url()).href;
    await turboOperation(page, { url: one }, () => page.evaluate((href) => (window as any).Turbo.visit(href), one));
    await turboVisitDone(page);
    await expect(page.getByTestId('page')).toHaveText('Page one');
    for (let i = 1; i <= 11; i++) {
        await page.locator(`#many-${i}`).setInputFiles(png(`f${i}.png`));
        await expect(page.getByRole('button', { name: `Remove f${i}.png` })).toBeVisible();
    }

    await visit(page, 'Go to page two', 'Page two');
    await back(page, 'Page one');
    await expectManyKept(page, 11, 'Back');

    await back(page, 'Page two');
    await forward(page, 'Page one');
    await expectManyKept(page, 11, 'Forward');
    await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(15);

    // each zone still takes a Remove and a pick
    const events = await countDropzoneEvents(page);
    await page.getByRole('button', { name: 'Remove f1.png' }).click();
    await expectEmptySingle(page, 'many-1');
    await page.locator('#many-11').setInputFiles(png('again.png'));
    await expect(page.getByRole('button', { name: 'Remove again.png' })).toBeVisible();
    expect(await events()).toEqual({ 'dropzone:change': 1, 'dropzone:clear': 1, 'dropzone:remove': 0 });
});

/**
 * Records the object URLs the page revokes, from its first script on, in `window.__revokedUrls`: UX Dropzone revokes
 * the URL of a preview once it no longer shows it (Remove, a new pick, its controller disconnecting). A revoked blob:
 * URL that fails to load logs nothing the fixture sees, so what is shown is read instead: `window.__revokedIn(root)`
 * lists the zones (their input's id) of `root` with a visible element whose inline background is a revoked URL, and for
 * each body Turbo renders, `window.__revokedRenders` holds the zones whose copy holds one (shown or not) and those
 * showing one at the first animation frame after the body is in place, once the controllers have connected.
 */
async function recordRevokedUrls(page: Page) {
    await page.addInitScript(() => {
        const revoked = ((window as any).__revokedUrls = new Set<string>());
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.revokeObjectURL = (url: string) => {
            revoked.add(url);
            revoke(url);
        };
        const revokedIn = ((window as any).__revokedIn = (root: ParentNode, visibleOnly = true) =>
            [...root.querySelectorAll<HTMLElement>('[style*="blob:"]')]
                .filter((element) => revoked.has(element.style.backgroundImage.slice(5, -2)) && (!visibleOnly || element.checkVisibility()))
                .map((element) => element.closest('[data-controller~="dropzone-assist"]')?.querySelector('input')?.id ?? element.tagName));
        const renders: { copy: string[]; firstFrame: string[] | null }[] = ((window as any).__revokedRenders = []);
        document.addEventListener('turbo:before-render', (event: any) => {
            const body = event.detail.newBody;
            const render = { copy: revokedIn(body, false), firstFrame: null as string[] | null };
            renders.push(render);
            let frames = 0;
            const observe = () => {
                if (document.body !== body) {
                    if (++frames < 600) {
                        requestAnimationFrame(observe);
                    }
                    return;
                }
                render.firstFrame = revokedIn(document);
            };
            requestAnimationFrame(observe);
        });
    });
}

/**
 * The URL a zone's preview image shows, whether the page revoked it, and the width it decodes to in the page (0: it
 * does not load).
 */
const previewImageOf = (page: Page, id: string) =>
    zoneOf(page, id)
        .locator('[data-symfony--ux-dropzone--dropzone-target="previewImage"]')
        .evaluate(async (element) => {
            const url = getComputedStyle(element).backgroundImage.slice(5, -2);
            const probe = new Image();
            probe.src = url;
            const width = await probe.decode().then(() => probe.naturalWidth, () => 0);

            return { blob: url.startsWith('blob:'), revoked: (window as any).__revokedUrls.has(url), width };
        });

/** The zones showing a revoked object URL now. */
const revokedShown = (page: Page) => page.evaluate(() => (window as any).__revokedIn(document) as string[]);

// UX Dropzone 3.8 revokes a preview's object URL when its controller disconnects: Turbo's copy of the page, taken while
// the zones showed their files, holds elements whose background is a URL revoked by the time Back or Forward shows it.
// Restored (a POST form's zone through the kit, the permanent one moved into the page), each zone shows its file from a
// new URL that loads, from the first frame on; Remove hides the image and revokes its URL
test('after Back and after Forward, a restored PNG shows a preview that loads, from the first frame; Remove leaves no revoked image on screen', async ({ page }) => {
    await recordRevokedUrls(page);
    await page.goto('/lab/dropzone-turbo/two');
    const one = new URL('/lab/dropzone-turbo?zones=1', page.url()).href;
    await turboOperation(page, { url: one }, () => page.evaluate((href) => (window as any).Turbo.visit(href), one));
    await turboVisitDone(page);
    await expect(page.getByTestId('page')).toHaveText('Page one');
    await page.locator('#many-1').setInputFiles(png('f1.png'));
    await page.locator('#kept').setInputFiles(png('kept.png'));
    for (const name of ['f1.png', 'kept.png']) {
        await expect(page.getByRole('button', { name: `Remove ${name}` })).toBeVisible();
    }
    for (const id of ['many-1', 'kept']) {
        expect(await previewImageOf(page, id), `picked: #${id}`).toEqual({ blob: true, revoked: false, width: 1 });
    }

    const steps = [
        ['Back', async () => { await visit(page, 'Go to page two', 'Page two'); await back(page, 'Page one'); }],
        ['Forward', async () => { await back(page, 'Page two'); await forward(page, 'Page one'); }],
    ] as const;
    for (const [step, walk] of steps) {
        await walk();
        for (const [id, name] of [['many-1', 'f1.png'], ['kept', 'kept.png']]) {
            await expect(page.getByRole('button', { name: `Remove ${name}` }), `${step}: #${id}`).toBeVisible();
            await expect(zoneOf(page, id).locator('[data-symfony--ux-dropzone--dropzone-target="previewImage"]'), `${step}: #${id}`).toBeVisible();
            expect(await previewImageOf(page, id), `${step}: #${id}`).toEqual({ blob: true, revoked: false, width: 1 });
        }
        expect(await revokedShown(page), `${step}: zones showing a revoked URL`).toEqual([]);
    }
    // every render's first frame showed no revoked URL; the copies of page one Back and Forward showed held one
    let renders: { copy: string[]; firstFrame: string[] | null }[] = [];
    await expect.poll(async () => (renders = await page.evaluate(() => (window as any).__revokedRenders)).every((render) => null !== render.firstFrame)).toBe(true);
    expect(renders.map((render) => render.firstFrame), 'zones showing a revoked URL at the first frame').toEqual(renders.map(() => []));
    expect(renders.filter((render) => render.copy.includes('many-1')).length, 'copies holding a revoked URL in #many-1').toBe(2);

    for (const [id, name] of [['many-1', 'f1.png'], ['kept', 'kept.png']]) {
        const image = zoneOf(page, id).locator('[data-symfony--ux-dropzone--dropzone-target="previewImage"]');
        const url = await image.evaluate((element) => getComputedStyle(element).backgroundImage.slice(5, -2));
        await page.getByRole('button', { name: `Remove ${name}` }).click();
        await expectEmptySingle(page, id);
        await expect(image).toBeHidden();
        expect(await image.evaluate((element) => getComputedStyle(element).backgroundImage), `#${id}`).toBe('none');
        expect(await page.evaluate((url) => (window as any).__revokedUrls.has(url), url), `#${id}: its URL revoked`).toBe(true);
    }
    expect(await revokedShown(page)).toEqual([]);
});

// The eleven zones beside a frame visit promoted to history: Turbo copies the page as the visit starts, so each zone's
// file goes under the key it carried then (the case below, with eleven zones in the copy instead of two)
test('beside a frame visit promoted to history, Back and Forward keep every file of a POST form with more zones than Turbo keeps copies', async ({ page }) => {
    await page.goto('/lab/dropzone-turbo?zones=11');
    for (let i = 1; i <= 11; i++) {
        await page.locator(`#many-${i}`).setInputFiles(png(`f${i}.png`));
        await expect(page.getByRole('button', { name: `Remove f${i}.png` })).toBeVisible();
    }
    const before = page.url();

    await advanceFrame(page, 'dropzone-frame');
    const advanced = page.url();
    await expectManyKept(page, 11, 'frame visit');

    for (const [step, action, url] of [['Back', () => page.goBack(), before], ['Forward', () => page.goForward(), advanced]] as const) {
        await turboOperation(page, { url }, action);
        await turboVisitDone(page);
        await expectManyKept(page, 11, step);
        await expect(page.locator('[data-controller~="dropzone-assist"]')).toHaveCount(15);
    }

    const events = await countDropzoneEvents(page);
    await page.getByRole('button', { name: 'Remove f11.png' }).click();
    await expectEmptySingle(page, 'many-11');
    expect(await events()).toEqual({ 'dropzone:change': 0, 'dropzone:clear': 1, 'dropzone:remove': 0 });
});

// the dropzone README, Events: a reset of the form empties its zones, each with one `dropzone:clear`, one file or several
test('a reset of the form empties its zones, for one file and for several, with one dropzone:clear each and no change', async ({ page }) => {
    await page.goto('/lab/dropzone-form');
    const photo = page.locator('#upload_demo_photo');
    const attachments = page.locator('#upload_demo_attachments');
    await photo.setInputFiles(png('tiny.png'));
    await attachments.setInputFiles([text('a.txt'), text('b.txt')]);
    await expect(page.getByRole('button', { name: 'Remove tiny.png' })).toBeVisible();
    await expect(page.locator('.dropzone-preview-list-item')).toHaveCount(2);
    const clears = {
        photo: await countEvents(page, ['dropzone:clear', 'dropzone:change'], '[data-controller~="dropzone-assist"]:has(#upload_demo_photo)'),
        attachments: await countEvents(page, ['dropzone:clear', 'dropzone:change'], '[data-controller~="dropzone-assist"]:has(#upload_demo_attachments)'),
    };

    await photo.evaluate((element: HTMLInputElement) => element.form!.reset());
    await expectEmptySingle(page, 'upload_demo_photo');
    await expect(page.locator('.dropzone-preview-list-item')).toHaveCount(0);
    expect(await fileCount(attachments)).toBe(0);
    expect(await clears.photo()).toEqual({ 'dropzone:clear': 1, 'dropzone:change': 0 });
    expect(await clears.attachments()).toEqual({ 'dropzone:clear': 1, 'dropzone:change': 0 });

    // emptied zones take a new pick
    await photo.setInputFiles(png('again.png'));
    await expect(page.getByRole('button', { name: 'Remove again.png' })).toBeVisible();
    expect(await clears.photo()).toEqual({ 'dropzone:clear': 1, 'dropzone:change': 1 });
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
// Chromium's and Firefox's copy of a file input keeps its file inside a form as outside one (the input holds it as UX
// Dropzone connects; a POST form's zones come back in Chromium with the kit's restore turned off); WebKit's keeps none.
// In a GET form the layouts' form-reset resets the form once Turbo shows its copy, which empties the zone through UX
// Dropzone (with the kit's own clear turned off, it still starts empty in Chromium): this guards that contract.
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

// UX Dropzone 3.8 holds a form's submission while a `dropzone:pre-add` listener still processes picked files (its
// `waitUntil()` promise pending), and submits the form again once they are added; the submission that goes then
// dispatches `dropzone:pre-submit` on each zone of the form. Through Turbo, one request reaches the server, with the
// processed file, and the 422 and the 303 answers render as without the hold
test('a Turbo form submitted while a dropzone:pre-add listener processes a file sends one request, once processed: 422 with the errors, 303 to the result', async ({ page, allowHttpError }) => {
    allowHttpError(/\/lab\/dropzone-form$/, 422);
    await page.goto('/lab/dropzone-form');
    const posts: string[] = [];
    page.on('request', (request) => {
        if ('POST' === request.method() && '/lab/dropzone-form' === new URL(request.url()).pathname) {
            posts.push(request.url());
        }
    });
    const events = await countEvents(page, ['turbo:submit-start', 'dropzone:pre-submit', 'dropzone:change']);
    // every picked file is held until the test releases it, then added renamed `processed-<name>`
    await page.evaluate(() => {
        const held: (() => void)[] = ((window as any).__heldFiles = []);
        document.addEventListener('dropzone:pre-add', (event: any) => {
            event.detail.waitUntil(
                new Promise((resolve) =>
                    held.push(() => resolve(event.detail.files.map((file: File) => new File([file], `processed-${file.name}`, { type: file.type })))),
                ),
            );
        });
    });
    const release = () => page.evaluate(() => (window as any).__heldFiles.splice(0).forEach((resolve: () => void) => resolve()));
    const photo = zoneOf(page, 'upload_demo_photo');

    for (const [sent, outcome] of [[1, '422'], [2, '303']] as const) {
        // the counts so far: the earlier submission, if any
        const before = { 'turbo:submit-start': sent - 1, 'dropzone:pre-submit': 2 * (sent - 1), 'dropzone:change': sent - 1 };
        if ('303' === outcome) {
            await page.getByRole('textbox', { name: 'Title' }).fill('Trip');
        }
        await page.locator('#upload_demo_photo').setInputFiles(png('tiny.png'));
        await expect(photo).toHaveAttribute('data-state', 'processing');
        await page.getByRole('button', { name: 'Upload' }).click();
        // held: an animation frame later, nothing has gone, and the zone is still processing
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(posts, `${outcome}: held`).toHaveLength(sent - 1);
        expect(await events(), `${outcome}: held`).toEqual(before);
        await expect(photo).toHaveAttribute('data-state', 'processing');

        await release();
        if ('422' === outcome) {
            await expect(page.locator('#upload_demo_title')).toHaveAttribute('aria-invalid', 'true');
            await expect(page.locator('#upload_demo_photo')).toHaveAccessibleDescription('PNG or JPG, up to 1 MB. processed-tiny.png was not kept: choose it again.');
        } else {
            await expect(page.getByTestId('submitted')).toHaveText('photo=processed-tiny.png; attachments=');
        }
        await turboVisitDone(page);
        expect(posts, outcome).toHaveLength(sent);
        // one submission per answer; each dispatched `dropzone:pre-submit` on the two zones of the form
        expect(await events(), outcome).toEqual({ 'turbo:submit-start': sent, 'dropzone:pre-submit': 2 * sent, 'dropzone:change': sent });
    }
    expect(new URL(page.url()).searchParams.get('submitted')).toBe('photo=processed-tiny.png; attachments=');
    await expect(photo).toHaveCount(1);
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
