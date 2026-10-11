import type { Page } from '@playwright/test';
import { test, expect, expectA11y } from './fixtures';
import { examples } from './inventory';

const pairs = ['name', 'email', 'country', 'bio', 'photo', 'startsOn', 'plan', 'terms', 'save'];

/**
 * Largest per-channel difference between two element screenshots of the same size: rounded corners
 * anti-alias slightly differently at another x offset, a real style difference moves colors far more.
 */
async function maxChannelDelta(page: Page, a: Buffer, b: Buffer): Promise<number> {
    return page.evaluate(async ([a, b]) => {
        const load = (src: string) => new Promise<HTMLImageElement>((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.src = `data:image/png;base64,${src}`;
        });
        const pixels = (image: HTMLImageElement) => {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, image.width, image.height).data;
        };
        const [imageA, imageB] = await Promise.all([load(a), load(b)]);
        if (imageA.width !== imageB.width || imageA.height !== imageB.height) {
            return 255;
        }
        const [pixelsA, pixelsB] = [pixels(imageA), pixels(imageB)];
        let max = 0;
        for (let i = 0; i < pixelsA.length; i++) {
            max = Math.max(max, Math.abs(pixelsA[i] - pixelsB[i]));
        }
        return max;
    }, [a.toString('base64'), b.toString('base64')]);
}

// It compares pixels, so it is tagged @screenshot: Chromium only, with the baseline comparisons (playwright.config.ts)
for (const colorScheme of ['light', 'dark'] as const) {
    test(`rows rendered by the form theme look like the hand-written components (${colorScheme})`, { tag: '@screenshot' }, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto('/forms/parity');
        for (const pair of pairs) {
            const theme = await page.locator(`[data-pair="${pair}"][data-side="theme"]`).screenshot();
            const components = await page.locator(`[data-pair="${pair}"][data-side="components"]`).screenshot();
            expect(await maxChannelDelta(page, theme, components), `${pair} pair`).toBeLessThanOrEqual(24);
        }
    });
}

test('an empty submit shows the server-side errors, wired to the controls', async ({ page, allowHttpError }) => {
    allowHttpError(/\/forms$/, 422);
    await page.goto('/forms');
    await page.getByRole('button', { name: 'Create account' }).click();

    const name = page.getByRole('textbox', { name: 'Name' });
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAccessibleDescription('As it appears on your invoices. This value should not be blank.');
    await expect(page.getByRole('combobox', { name: 'Country' })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('group', { name: 'Plan' })).toHaveAccessibleDescription('You can change it later. This value should not be blank.');
    await expect(page.getByRole('checkbox', { name: 'I accept the terms' })).toHaveAccessibleDescription('You must accept the terms.');
    await expect(page.getByText('Pick at least one interest.')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Age' })).not.toHaveAttribute('aria-invalid');

    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expectA11y(page, { impact: 'serious' }, colorScheme);
    }
});

test('a valid submit redirects with a success message', async ({ page }) => {
    await page.goto('/forms');
    await page.getByRole('textbox', { name: 'Name' }).fill('Ada Lovelace');
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.com');
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('combobox', { name: 'Country' }).selectOption('fr');
    await page.getByRole('radio', { name: 'Pro' }).check();
    await page.getByRole('checkbox', { name: 'Engineering' }).check();
    await page.getByRole('checkbox', { name: 'I accept the terms' }).check();
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Account created.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('');
});

test('label_attr and help_attr reach the row label and help', async ({ page }) => {
    await page.goto('/forms');
    await expect(page.locator('label[for="demo_website"]')).toHaveAttribute('title', 'Your public site');
    await expect(page.getByTestId('website-help')).toHaveText('Shown on your profile.');
    await expect(page.getByTestId('website-help')).toHaveAttribute('id', 'demo_website_help');
    await expect(page.getByTestId('terms-label')).toHaveAttribute('for', 'demo_terms');
    await expect(page.getByTestId('terms-label')).toHaveClass(/\bselect-none\b/);
});

test('the date picker opt-in submits the pick; a date the server refuses comes back as typed, with its error', async ({ page, allowHttpError }) => {
    allowHttpError(/\/forms$/, 422);
    await page.goto('/forms');
    const field = page.getByRole('textbox', { name: 'Starts on' });
    const hidden = page.locator('input[name="demo[startsOn]"]');
    // empty, with a past minimum: the calendar opens on today's month, not the minimum's
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
    await page.getByRole('button', { name: 'Choose date' }).click();
    await expect(page.getByRole('dialog').getByRole('grid')).toHaveAccessibleName(new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(now));
    await page.getByRole('dialog').locator(`[data-slot="calendar-day"][data-day="${day}"] button`).click();
    await expect(hidden).toHaveValue(day);
    await expect(field).toHaveValue(new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`)));

    // below the bound, as a script could send it: the constraint decides
    await hidden.evaluate((input) => ((input as HTMLInputElement).value = '2025-06-01'));
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveValue('2025-06-01');
    await expect(field).toHaveAccessibleDescription(/^The first day of your subscription\. This value should be greater than or equal to/);
    await expect(page.locator('input[name="demo[startsOn]"]')).toHaveValue('');
});

// a 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const png = (name: string, size = PNG.length) => ({ name, mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.alloc(Math.max(0, size - PNG.length))]) });
const text = (name: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(`${name}\n`) });

/** Fills every required field of /forms with a valid value. */
async function fillValid(page: Page) {
    await page.getByRole('textbox', { name: 'Name' }).fill('Ada Lovelace');
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.com');
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('combobox', { name: 'Country' }).selectOption('fr');
    await page.getByRole('radio', { name: 'Pro' }).check();
    await page.getByRole('checkbox', { name: 'Engineering' }).check();
    await page.getByRole('checkbox', { name: 'I accept the terms' }).check();
}

test('a DropzoneType renders through the dropzone recipe, labelled and described, without the package theme', async ({ page }) => {
    await page.goto('/forms');
    const photo = page.getByLabel('Photo', { exact: true });
    await expect(photo).toHaveAttribute('type', 'file');
    await expect(photo).toHaveAttribute('name', 'demo[photo]');
    await expect(photo).toHaveAccessibleDescription('PNG or JPG, up to 1 MB.');
    await expect(page.locator('[data-controller~="dropzone-assist"]:has(#demo_photo)')).toContainText('Drop a photo or browse');
    const attachments = page.locator('#demo_attachments');
    await expect(attachments).toHaveAttribute('name', 'demo[attachments][]');
    await expect(attachments).toHaveAttribute('multiple', '');
    await expect(page.locator('form[name="demo"]')).toHaveAttribute('enctype', 'multipart/form-data');
    await expect(page.locator('.dropzone-container')).toHaveCount(0);
});

test('a file the server refuses comes back with its error on the file input', async ({ page, allowHttpError }) => {
    allowHttpError(/\/forms$/, 422);
    await page.goto('/forms');
    await fillValid(page);
    await page.locator('#demo_photo').setInputFiles(text('x.png'));
    await page.getByRole('button', { name: 'Create account' }).click();
    const photo = page.locator('#demo_photo');
    await expect(photo).toHaveAttribute('aria-invalid', 'true');
    await expect(photo).toHaveAccessibleDescription(/^PNG or JPG, up to 1 MB\. .*(valid image|mime type)/);

    await page.locator('#demo_photo').setInputFiles(png('big.png', 1_500_000));
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('#demo_photo')).toHaveAccessibleDescription(/too large/);
});

test('valid files sent back by other errors are named in the box: choose them again', async ({ page, allowHttpError }) => {
    allowHttpError(/\/forms$/, 422);
    await page.goto('/forms');
    await page.locator('#demo_photo').setInputFiles(png('tiny.png'));
    await page.locator('#demo_attachments').setInputFiles([text('a.txt'), text('b.txt')]);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
    const photo = page.locator('#demo_photo');
    await expect(photo).not.toHaveAttribute('aria-invalid');
    await expect(photo).toHaveAccessibleDescription('PNG or JPG, up to 1 MB. tiny.png was not kept: choose it again.');
    await expect(page.locator('#demo_attachments')).toHaveAccessibleDescription(/2 files were not kept: choose them again\.$/);
    expect(await photo.evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
});

test('a valid submit with a photo and two attachments redirects with the success message', async ({ page }) => {
    await page.goto('/forms');
    await fillValid(page);
    await page.locator('#demo_photo').setInputFiles(png('tiny.png'));
    await page.locator('#demo_attachments').setInputFiles([text('a.txt'), text('b.txt')]);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Account created.')).toBeVisible();
});

// A file over upload_max_filesize (2M) in a body under post_max_size (8M): PHP keeps the other fields and reports the
// file's upload error, which the field shows. A body over post_max_size is not tested: FrankenPHP's worker (CI's demo)
// fails the request with a fatal error before Symfony runs (the dropzone README's Limits).
test('a file over upload_max_filesize gives its field the size error', async ({ page, allowHttpError }) => {
    allowHttpError(/\/forms$/, 422);
    await page.goto('/forms');
    await fillValid(page);
    await page.locator('#demo_attachments').setInputFiles([text('a.txt'), { name: 'big.txt', mimeType: 'text/plain', buffer: Buffer.alloc(3 * 1024 * 1024, 'a') }]);
    await page.getByRole('button', { name: 'Create account' }).click();
    const attachments = page.locator('#demo_attachments');
    await expect(attachments).toHaveAttribute('aria-invalid', 'true');
    await expect(attachments).toHaveAccessibleDescription(/too large/);
    await expect(page.getByText(/CSRF token/i)).toHaveCount(0);
});

/*
 * The Input component's text starts at the same inline padding with or without a `type`: Flowbite's base rule pads
 * only `[type=text]`, `[type=email]` and the other typed fields, so an Input with no `type` (a text field all the
 * same) showed its text against the left border. Every text-like Input of every README example that renders one.
 */
test('every Input pads its text the same, with or without a type', async ({ page }) => {
    const recipes = ['input', 'form-field', 'date-picker', 'label', 'card', 'navbar', 'popover'];
    const measured: { example: string; id: string; type: string | null; start: number; end: number }[] = [];
    for (const { recipe, id } of examples.filter(({ recipe }) => recipes.includes(recipe))) {
        await page.goto(`/preview/${recipe}/${id}?theme=light`);
        const inputs = await page.locator('input.bg-neutral-secondary-medium.border-default-medium:is(:not([type]), [type=text], [type=email], [type=password], [type=search], [type=number], [type=tel], [type=url])').evaluateAll((inputs) =>
            inputs.map((input) => {
                const style = getComputedStyle(input);
                return { id: input.id, type: input.getAttribute('type'), start: parseFloat(style.paddingInlineStart), end: parseFloat(style.paddingInlineEnd) };
            }),
        );
        measured.push(...inputs.map((input) => ({ example: `${recipe}/${id}`, ...input })));
    }
    expect(measured.some(({ type }) => null === type), 'an Input with no type is measured').toBe(true);
    expect(measured.some(({ type }) => 'text' === type), 'an Input of type text is measured').toBe(true);
    expect(measured.filter(({ start, end }) => 12 !== start || 12 !== end)).toEqual([]);
});

/*
 * A Select's text stops before its chevron, on either side: Flowbite draws the chevron as the background image at
 * 0.75rem from the inline end, and the Select's own inline padding replaced the room Flowbite's base rule leaves for it,
 * so a long option ran under the chevron. In right to left the chevron and the room move to the left.
 */
for (const dir of ['ltr', 'rtl'] as const) {
    test(`a Select's text stops before its chevron (${dir})`, async ({ page }) => {
        await page.goto('/preview/select/default?theme=light');
        await page.evaluate((dir) => document.documentElement.setAttribute('dir', dir), dir);
        const select = page.locator('select:not([multiple])').first();
        const room = await select.evaluate((select) => {
            const style = getComputedStyle(select);
            const px = (value: string) => [...value.matchAll(/(-?[\d.]+)px/g)].map((match) => parseFloat(match[1]));
            const offset = px(style.backgroundPositionX).at(-1) ?? 0;
            const size = px(style.backgroundSize)[0] ?? 0;
            return { image: style.backgroundImage, offset, size, end: parseFloat(style.paddingInlineEnd), side: style.backgroundPositionX };
        });
        expect(room.image).toContain('svg');
        expect(room.size).toBeGreaterThan(0);
        expect(room.end, `padding-inline-end against the chevron at ${room.side}, ${room.size}px wide`).toBeGreaterThanOrEqual(room.offset + room.size + 4);
    });
}

/*
 * A multiple Select is a list box: no chevron (Flowbite's `[multiple]` rule that removes it loses to its own
 * `select:not([size])`), and its height shows whole rows, never an option cut in half at the bottom.
 */
test('a multiple Select shows no chevron and no option cut at the bottom', async ({ page }) => {
    await page.goto('/preview/select/multiple?theme=light');
    const select = page.locator('select[multiple]').first();
    const box = await select.evaluate((select: HTMLSelectElement) => {
        const style = getComputedStyle(select);
        // the options scroll inside the padding box: a row past the content shows in the bottom padding, cut at its edge
        const top = select.getBoundingClientRect().top + select.clientTop;
        const bottom = top + select.clientHeight;
        const rows = [...select.options].map((option) => option.getBoundingClientRect()).map(({ top, bottom }) => ({ top, bottom }));
        return { image: style.backgroundImage, top, bottom, rows };
    });
    expect.soft(box.image).toBe('none');
    const cut = box.rows.filter(({ top, bottom }) => top < box.bottom - 0.5 && bottom > box.bottom + 0.5);
    expect(cut, `rows ${JSON.stringify(box.rows)} in ${box.top}..${box.bottom}`).toEqual([]);
});
