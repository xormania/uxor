import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const guideSlugs = Object.keys(read('../../../packages/uxor/resources/guides.json'));
const kit = read('../../../manifest.json');
const examples: Record<string, string[]> = JSON.parse(execFileSync(process.env.PHP_BINARY ?? 'php', [
    fileURLToPath(new URL('./catalog.php', import.meta.url)),
], { encoding: 'utf8' }));
const recipes = Object.keys(examples).sort();
const pages = ['', ...guideSlugs.map((slug) => slug + '/'), ...recipes.map((name) => `r/${name}/`)];
const previewPaths = new Set(recipes.flatMap((recipe) => examples[recipe].flatMap((example) =>
    ['light', 'dark'].map((theme) => `/uxor/preview/${recipe}/${example}/${theme}/`))));

const test = base.extend({
    page: async ({ page, baseURL }, use) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('response', (response) => {
            if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
        });
        await page.route('**/*', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin !== new URL(baseURL!).origin) {
                errors.push(`External request: ${url}`);
                return route.abort();
            }
            // Preview documents belong to the separately built runtime. Only a known example's
            // iframe gets a stand-in. The assembled release checks the actual preview files.
            if (request.isNavigationRequest() && request.frame().parentFrame() && previewPaths.has(url.pathname)) {
                return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Preview</title>' });
            }
            return route.continue();
        });
        await use(page);
        expect(errors, 'website browser errors').toEqual([]);
    },
});

for (const path of pages) {
    test(`${path || '/'} is accessible and fits a 320px screen`, async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        const response = await page.goto(path || './');
        expect(response?.status()).toBe(200);
        const heading = page.getByRole('heading', { level: 1 });
        await expect(heading).toHaveCount(1);
        await expect(heading).toBeVisible();
        const violations = (await new AxeBuilder({ page }).setLegacyMode().exclude('iframe').analyze()).violations;
        expect(violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
            .map((v) => [v.id, v.nodes.map((node) => node.target)])).toEqual([]);
        await expect(page.locator('head link[rel~="icon"]')).toHaveCount(1);

        const text = await page.locator('main').evaluate((main) => {
            const copy = main.cloneNode(true) as HTMLElement;
            copy.querySelectorAll('pre, code, script, style').forEach((node) => node.remove());
            return copy.textContent ?? '';
        });
        expect(text).not.toMatch(/\]\(https?:|`[^`\n]+`/);
        if (path.startsWith('r/')) {
            const recipe = path.split('/')[1];
            const frames = await page.locator('iframe').evaluateAll((frames) => frames.map((f) => new URL(f.src).pathname));
            const expected = [...previewPaths].filter((src) => src.startsWith(`/uxor/preview/${recipe}/`));
            expect(frames.sort(), 'each README example has both named previews').toEqual(expected.sort());
            await heading.evaluate((element) => { element.textContent = 'ForgotPasswordForm'.repeat(3); });
        }
        const geometry = await heading.evaluate((element) => ({
            right: element.getBoundingClientRect().right,
            width: element.scrollWidth,
            available: element.clientWidth,
            page: document.documentElement.scrollWidth,
            viewport: document.documentElement.clientWidth,
        }));
        expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.width).toBeLessThanOrEqual(geometry.available);
        expect(geometry.page).toBeLessThanOrEqual(geometry.viewport);
    });
}

test('the index offers Composer first, the recipe catalog, and the visual demo', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(kit.name);
    const catalog = page.locator('#recipes');
    expect((await catalog.getByRole('link').allTextContents()).map((s) => s.trim()).sort()).toEqual(recipes);
    const hero = page.getByRole('heading', { level: 1 }).locator('xpath=ancestor::section[1]');
    const primary = hero.getByRole('link').first();
    await expect(primary).toHaveAccessibleName('Get started with Composer');
    await expect(primary).toHaveAttribute('href', '/uxor/composer/');
    const browse = hero.getByRole('link', { name: 'Browse the recipes' });
    const demo = hero.getByRole('link', { name: 'Open the demo app' });
    await expect(browse).toHaveAttribute('href', /#recipes$/);
    await expect(demo).toHaveAttribute('href', '/uxor/demo/');
    const secondary = await browse.getAttribute('class');
    expect(secondary).toBeTruthy();
    expect(await demo.getAttribute('class')).toBe(secondary);
    expect(await primary.getAttribute('class')).not.toBe(secondary);
    const install = page.locator('#install');
    const composer = install.locator('.columns > div').filter({ has: page.getByRole('link', { name: /Composer/ }) });
    await expect(composer).toContainText('Symfony UX Toolkit');
    await expect(composer).toContainText('Mate');
    await install.getByRole('link', { name: /recipes directly/ }).click();
    await expect(page).toHaveURL(/\/uxor\/install\/$/);
    await expect(page.locator('main')).toContainText('php bin/console ux:install');
    await page.goBack();

    await primary.click();
    await expect(page).toHaveURL(/\/uxor\/composer\/$/);
    const developmentInstall = page.locator('pre code').filter({ hasText: /composer require --dev/ });
    await expect(developmentInstall).toHaveCount(1);
    await expect(developmentInstall).toHaveText(/^composer require --dev ['"]?xormania\/uxor(?::[^'"\s]+)?['"]?\s*$/);
    await expect(page.locator('pre code').filter({ hasText: 'vendor/bin/mate tools:call uxor_catalog' })).toBeVisible();
});

for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`a phone with the ${colorScheme} theme`, () => {
        test.use({ colorScheme });
        test('the header stays on one row and content fits', async ({ page }) => {
            await page.goto('./');
            const nav = page.getByRole('navigation', { name: 'Main' });
            const row = (await nav.boundingBox())!.height;
            for (const width of [320, 390]) {
                await page.setViewportSize({ width, height: 844 });
                await expect.poll(async () => (await nav.boundingBox())!.height).toBe(row);
                await expect(nav.getByRole('link', { name: 'GitHub' })).toBeVisible();
            }
            for (const path of ['', 'r/button/', 'r/data-table/']) {
                await page.goto(path || './');
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
            }
        });
    });
}

test('the reader can change theme with the keyboard and retain it on another page', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('./');
    const toggle = page.getByRole('button', { name: /theme|dark mode/i });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.goto('composer/');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('keyboard navigation switches from a recipe preview to the documented source', async ({ page }) => {
    await page.goto('r/button/');
    const tabs = page.getByRole('tablist', { name: 'Preview or Code' }).first();
    const preview = tabs.getByRole('tab', { name: 'Preview' });
    const code = tabs.getByRole('tab', { name: 'Code' });
    await expect(preview).toHaveAttribute('aria-selected', 'true');
    await preview.focus();
    await page.keyboard.press('ArrowRight');
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Code' }).first().locator('code').first()).toBeVisible();
    await page.keyboard.press('Home');
    await expect(preview).toBeFocused();
    await expect(preview).toHaveAttribute('aria-selected', 'true');
});

test('an unknown recipe URL returns 404', async ({ request }) => {
    expect((await request.get('r/does-not-exist/')).status()).toBe(404);
});

test('recipe README links open a published recipe and leave unknown recipes in the catalog', async ({ page }) => {
    await page.goto('./?recipe=button#recipes');
    await expect(page).toHaveURL(/\/uxor\/r\/button\/$/);
    await page.goto('./?recipe=not-yet-published#recipes');
    await expect(page.getByRole('heading', { name: /^Recipes/ })).toBeVisible();
    await expect(page.locator('#recipes a.recipe-link').first()).toBeVisible();
    await expect(page).toHaveURL(/\?recipe=not-yet-published#recipes$/);
});

test.describe('recipe README links without JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('the published catalog offers normal links', async ({ page }) => {
        await page.goto('./?recipe=button#recipes');
        await page.locator('#recipes').getByRole('link', { name: 'button', exact: true }).click();
        await expect(page).toHaveURL(/\/uxor\/r\/button\/$/);
    });
});
