import type { APIResponse, Page, Response } from '@playwright/test';
import { test, expect, recordDarkAtFirstBody } from './fixtures';
import { png } from './files';

/*
 * The demo's browser hardening headers and its enforced Content Security Policy
 * (demo/src/EventListener/SecurityHeadersListener.php). The fixtures fail every test on a policy violation, so the
 * whole suite runs the kit under this policy; these tests check the policy itself, and what a blocked inline script
 * or style would silently break: the theme before the first paint, Turbo's progress bar, the Progress bars.
 */
const pages = ['/', '/r/button', '/preview/button/default?theme=light', '/preview/dropdown/default?theme=light', '/demo', '/demo/login', '/lab/live-table', '/lab/popover-turbo', '/preview/popover/default?theme=light', '/lab/calendar-turbo', '/preview/calendar/default?theme=light', '/lab/date-picker-turbo', '/preview/date-picker/default?theme=light', '/lab/chart-turbo', '/preview/chart/default?theme=light', '/lab/dropzone-turbo', '/preview/dropzone/default?theme=light', '/forms', '/lab/dropzone-form', '/lab/live-dropzone', '/lab/editor-turbo', '/preview/editor/default?theme=light', '/lab/markdown-turbo', '/preview/markdown-editor/default?theme=light', '/lab/side-nav', '/preview/side-nav/default?theme=light', '/lab/mobile-nav', '/preview/mobile-nav/default?theme=light', '/lab/nav-menu', '/preview/nav-menu/default?theme=light', '/lab/dropdown-turbo', '/lab/modal-turbo', '/lab/drawer-turbo', '/lab/section-nav', '/preview/section-nav/default?theme=light', '/preview/tabs/vertical?theme=light', '/demo/settings/notifications'];

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

for (const path of pages) {
    test(`${path} answers with the hardening headers and a nonce-based policy its scripts carry`, async ({ page }) => {
        const { script, style, policy } = await gotoAndCheckPolicy(page, path);
        expect(script).not.toEqual(style);
        // style attributes: none at all, README previews included (tools/docs-lint.mjs keeps them out of the examples)
        expect(policy.has('style-src-attr')).toBe(false);

        const inPage = await page.evaluate(() => ({
            scripts: [...document.scripts].map((element) => element.nonce),
            meta: (document.querySelector('meta[name="csp-nonce"]') as HTMLElement | null)?.nonce,
        }));
        expect(inPage.scripts.length).toBeGreaterThan(0);
        expect(new Set(inPage.scripts)).toEqual(new Set([script]));
        expect(inPage.meta).toBe(style);
    });
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

test('a picked image shows its preview under the policy (img-src data:)', async ({ page }) => {
    const { policy } = await gotoAndCheckPolicy(page, '/preview/dropzone/default?theme=light');
    expect(policy.get('img-src')).toContain('data:');
    await page.locator('input[type="file"]').setInputFiles(png('tiny.png'));
    const image = page.locator('[data-symfony--ux-dropzone--dropzone-target="previewImage"]');
    await expect(image).toBeVisible();
    // the image loads: its natural size, read the way the browser loads a CSS background (the fixtures fail on a violation)
    const loaded = await image.evaluate(async (element) => {
        const url = getComputedStyle(element).backgroundImage.slice(5, -2);
        const probe = new Image();
        probe.src = url;
        await probe.decode();

        return { scheme: url.slice(0, 15), width: probe.naturalWidth };
    });
    expect(loaded).toEqual({ scheme: 'data:image/png;', width: 1 });
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
