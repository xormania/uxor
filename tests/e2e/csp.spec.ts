import type { APIResponse, Page, Response } from '@playwright/test';
import { test, expect, decodedBackgroundImage, recordDarkAtFirstBody } from './fixtures';
import { jpeg, png, svg } from './files';

/*
 * The demo's browser hardening headers and its enforced Content Security Policy
 * (demo/src/EventListener/SecurityHeadersListener.php). The fixtures fail every test on a policy violation, so the
 * whole suite runs the kit under this policy. Each page's headers, policy and nonced markup are a PHPUnit test
 * (demo/tests/Security/SecurityHeadersTest.php); these tests check what only a browser shows: fresh nonces per response,
 * and what a blocked inline script or style would silently break (the theme before the first paint, Turbo's progress
 * bar, the Progress bars).
 */

type Policy = Map<string, string[]>;

function policyOf(response: Response | APIResponse | null): Policy {
    const header = response?.headers()['content-security-policy'] ?? '';

    return new Map(header.split(';').map((directive) => directive.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...sources]) => [name, sources]));
}

function nonceOf(sources: string[] | undefined): string {
    const nonces = (sources ?? []).filter((source) => /^'nonce-[\w-]+'$/.test(source));
    expect(nonces, `one nonce in ${sources?.join(' ')}`).toHaveLength(1);

    return nonces[0].slice("'nonce-".length, -1);
}

async function gotoAndCheckPolicy(page: Page, path: string): Promise<{ script: string; style: string; policy: Policy }> {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    const headers = response!.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    // not no-referrer: same-origin POSTs would send `Origin: null`, which the stateless CSRF check rejects
    expect(headers['referrer-policy']).toBe('same-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['content-security-policy-report-only']).toBeUndefined();

    const policy = policyOf(response);
    expect(policy.get('frame-ancestors')).toEqual(["'self'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
    const scriptSources = policy.get('script-src');
    expect(scriptSources).toHaveLength(2);
    expect(scriptSources).toContain("'strict-dynamic'");
    const styleSources = policy.get('style-src');
    expect(styleSources).toHaveLength(2);
    expect(styleSources).toContain("'self'");

    return { script: nonceOf(scriptSources), style: nonceOf(styleSources), policy };
}

test('every response gets its own nonces', async ({ page }) => {
    const first = await gotoAndCheckPolicy(page, '/demo/login');
    const second = await gotoAndCheckPolicy(page, '/demo/login');
    expect(second.script).not.toEqual(first.script);
    expect(second.style).not.toEqual(first.style);
});

test.describe('system in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('the layout sets the theme before the first paint', async ({ page }) => {
        const darkAtFirstBody = await recordDarkAtFirstBody(page);
        // the auth layout has no theme toggle: only the inline script sets the theme
        await page.goto('/demo/login');
        expect(await darkAtFirstBody()).toBe(true);
    });
});

test("Turbo's progress bar gets its style and the brand color", async ({ page }) => {
    await page.goto('/demo/login');
    await page.waitForFunction(() => 'Turbo' in window);
    const bar = await page.evaluate(() => {
        const element = document.createElement('div');
        element.className = 'turbo-progress-bar';
        const brand = document.createElement('div');
        brand.className = 'bg-brand';
        document.body.append(element, brand);
        const style = getComputedStyle(element);

        return { position: style.position, height: style.height, color: style.backgroundColor, brand: getComputedStyle(brand).backgroundColor };
    });
    // position and height come from Turbo's own <style>, which needs the nonce of <meta name="csp-nonce">
    expect(bar.position).toBe('fixed');
    expect(bar.height).toBe('3px');
    expect(bar.color).toBe(bar.brand);
});

test('the Progress bars keep their width', async ({ page }) => {
    await page.goto('/demo');
    const bars = await page.locator('[role="meter"], [role="progressbar"]').evaluateAll((tracks) =>
        tracks.map((track) => ({
            value: Number(track.getAttribute('aria-valuenow')),
            width: (100 * track.firstElementChild!.getBoundingClientRect().width) / track.getBoundingClientRect().width,
        })),
    );
    expect(bars.length).toBeGreaterThan(0);
    for (const { value, width } of bars) {
        expect(width).toBeCloseTo(value, 0);
    }
});

test("the Dropzone markup is the kit's: no style attribute, never UX Dropzone's own form theme", async ({ page }) => {
    for (const path of ['/lab/dropzone-turbo', '/preview/dropzone/multiple-files?theme=light', '/forms', '/lab/dropzone-form', '/lab/live-dropzone']) {
        const response = await page.request.get(path);
        expect(response.status()).toBe(200);
        const html = await response.text();
        expect(html).toContain('data-controller="symfony--ux-dropzone--dropzone dropzone-assist"');
        expect(html, path).not.toContain('dropzone-container');
        expect(html, path).not.toMatch(/\sstyle=/);
    }
});

test("the Editor's markup has no style attribute, and the mounted editor adds no <style> element", async ({ page }) => {
    for (const path of ['/lab/editor-turbo', '/lab/live-editor', '/preview/editor/default?theme=light']) {
        const response = await page.request.get(path);
        expect(response.status()).toBe(200);
        const html = await response.text();
        expect(html, path).toContain('data-controller="editor"');
        expect(html, path).not.toMatch(/\sstyle=/);
    }
    await gotoAndCheckPolicy(page, '/preview/editor/default?theme=light');
    await expect(page.locator('.ProseMirror')).toHaveCount(1);
    expect(await page.locator('style').evaluateAll((styles) => styles.filter((style) => style.textContent!.includes('ProseMirror')).length)).toBe(0);
});

// UX Dropzone 3.8 uses object URLs for PNG and JPEG previews. SVG previews still load from data URLs.
for (const theme of ['light', 'dark']) {
    test(`in the ${theme} theme, a picked PNG or JPEG shows its preview from a blob: URL, an SVG from a data: URL, under the policy`, async ({ page }) => {
        const { policy } = await gotoAndCheckPolicy(page, `/preview/dropzone/default?theme=${theme}`);
        expect(policy.get('img-src')).toEqual(expect.arrayContaining(['blob:', 'data:']));
        const input = page.locator('input[type="file"]');
        const image = page.locator('[data-symfony--ux-dropzone--dropzone-target="previewImage"]');
        for (const [file, scheme] of [
            [png('tiny.png'), /^blob:/],
            [jpeg('tiny.jpg'), /^blob:/],
            [svg('tiny.svg'), /^data:image\/svg\+xml;/],
        ] as const) {
            const previous = await decodedBackgroundImage(image);
            await input.setInputFiles(file);
            await expect(page.getByText(file.name, { exact: true })).toBeVisible();
            await expect(image).toBeVisible();
            await expect.poll(async () => {
                const preview = await decodedBackgroundImage(image);

                return preview?.url === previous?.url ? null : preview;
            }, { message: file.name }).toEqual({
                url: expect.stringMatching(scheme),
                width: 1,
            });
        }
    });
}

// the same in the dark theme, walked as the user does: a keyboard pick shows the name, the image and Remove, focused;
// Remove empties the zone and puts the focus back on the input
test('in the dark theme, a picked image shows its name, its preview under the policy and Remove, focused; Remove empties the zone', async ({ page }) => {
    const { policy } = await gotoAndCheckPolicy(page, '/preview/dropzone/default?theme=dark');
    expect(policy.get('img-src')).toEqual(expect.arrayContaining(['blob:', 'data:']));
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
    const input = page.getByLabel('Profile picture');
    await input.focus();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(png('dark.png'));

    const remove = page.getByRole('button', { name: 'Remove dark.png' });
    await expect(remove).toBeFocused();
    await expect(remove).toBeVisible();
    await expect(page.getByText('dark.png', { exact: true })).toBeVisible();
    await expect(page.getByText('Drag and drop or browse')).toBeHidden();
    const image = page.locator('[data-symfony--ux-dropzone--dropzone-target="previewImage"]');
    await expect(image).toBeVisible();
    const box = await image.boundingBox();
    expect(box && box.width > 0 && box.height > 0).toBe(true);
    // the image loads from its object URL (the fixtures fail on a violation)
    await expect.poll(() => decodedBackgroundImage(image)).toEqual({ url: expect.stringMatching(/^blob:/), width: 1 });

    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();
    await expect(image).toBeHidden();
    await expect(remove).toBeHidden();
    await expect(page.getByText('Drag and drop or browse')).toBeVisible();
    expect(await input.evaluate((element: HTMLInputElement) => element.files?.length ?? 0)).toBe(0);
});

test("Symfony's error pages keep the hardening headers without a policy on scripts and styles", async ({ page, allowHttpError }) => {
    // an exception's page; in debug, Symfony also removes the whole header from it
    allowHttpError(/\/r\/does-not-exist$/, 404);
    // the error page preview of the dev environment, an ordinary response
    allowHttpError(/\/_error\/404$/, 404);
    for (const path of ['/r/does-not-exist', '/_error/404']) {
        const response = await page.goto(path);
        expect(response?.status()).toBe(404);
        expect(response?.headers()['x-content-type-options']).toBe('nosniff');
        const policy = policyOf(response);
        for (const directive of ['default-src', 'script-src', 'style-src']) {
            expect(policy.has(directive), `${path}: ${directive}`).toBe(false);
        }
    }
    expect(policyOf(await page.goto('/_error/404')).get('frame-ancestors')).toEqual(["'self'"]);
    // Symfony's inline styles apply
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
});
