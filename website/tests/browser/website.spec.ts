import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const guides: Record<string, { title: string }> = read('../../../packages/uxor/resources/guides.json');
const guideSlugs = Object.keys(guides);
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
    const catalog = page.getByTestId('recipe-list');
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
    await expect(hero).toContainText('Symfony UX Toolkit');
    await expect(hero).toContainText('Mate');
    await expect(hero).toContainText('headless Chromium');
    await page.locator('#install').getByRole('link', { name: 'configured for Symfony UX Toolkit' }).click();
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
        test('the main navigation and content fit at narrow widths', async ({ page }) => {
            await page.goto('./');
            const nav = page.getByRole('navigation', { name: 'Main' });
            for (const width of [320, 390]) {
                await page.setViewportSize({ width, height: 844 });
                for (const name of ['Composer Dev Package', 'UXor Symfony UX Toolkit', 'Guides', 'Recipes', 'Demo app', 'GitHub']) {
                    const link = nav.getByRole('link', { name, exact: true });
                    await expect(link).toBeVisible();
                    const bounds = (await link.boundingBox())!;
                    expect(bounds.x).toBeGreaterThanOrEqual(0);
                    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
                }
            }
            for (const path of ['', 'r/button/', 'r/data-table/']) {
                await page.goto(path || './');
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
            }
        });
    });
}

test('the public guide directory connects every registered guide to its portable edition and indexes', async ({ page, request }) => {
    const publicSite = 'https://xormania.github.io/uxor';
    const sitemap = await (await request.get('sitemap.xml')).text();
    const llms = await (await request.get('llms.txt')).text();
    await page.goto('./');
    const directory = page.locator('#guides');
    expect(guideSlugs).toEqual(expect.arrayContaining(['composer', 'advanced', 'configuration', 'agent-onboarding', 'application-testing', 'install', 'guide']));
    for (const [slug, { title }] of Object.entries(guides)) {
        await expect(directory.getByRole('link', { name: title, exact: true })).toHaveAttribute('href', `/uxor/${slug}/`);
        const markdown = await request.get(`${slug}.md`);
        expect(markdown.status()).toBe(200);
        const heading = (await markdown.text()).split('\n')[0];
        expect(heading).toMatch(/^# .+/);
        const guide = await request.get(`${slug}/`);
        expect(guide.status()).toBe(200);
        expect(await guide.text()).toContain(`href="/uxor/${slug}.md"`);
        expect(sitemap).toContain(`<loc>${publicSite}/${slug}/</loc>`);
        expect(llms.split(`(${publicSite}/${slug}.md)`)).toHaveLength(2);
    }
});

test('the published configuration tables show the release requirements and provider image defaults', async ({ page, request }) => {
    const launcher = fileURLToPath(new URL('../../../packages/uxor/bin/uxor-mago', import.meta.url));
    await page.goto('configuration/');
    const markdown = await (await request.get('configuration.md')).text();
    const composer = read('../../../composer.json');
    const requirement = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'symfony/console', exact: true }) });
    await expect(requirement.getByRole('cell')).toHaveCount(2);
    await expect(requirement.getByRole('cell').nth(1)).toHaveText(composer.require['symfony/console']);
    for (const [provider, label] of [['cli', 'Mago CLI'], ['serena', 'Serena']]) {
        const image = execFileSync('sh', [launcher, 'image', provider], {
            encoding: 'utf8', env: { ...process.env, UXOR_MAGO_IMAGE: '' },
        }).trim();
        const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: label, exact: true }) });
        await expect(row.getByRole('cell', { name: image, exact: true })).toBeVisible();
        expect(markdown).toContain('| ' + label + ' | `' + image + '` |');
    }
});

test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('a visitor can skip to the content and navigate both products and the guide directory on a phone', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await page.goto('./');
        await page.keyboard.press('Tab');
        await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('main')).toBeFocused();
        const nav = page.getByRole('navigation', { name: 'Main' });
        for (const [name, path] of [
            ['Composer Dev Package', '/uxor/composer/'], ['UXor Symfony UX Toolkit', '/uxor/guide/'], ['Guides', '/uxor/#guides'],
        ]) {
            const link = nav.getByRole('link', { name, exact: true });
            await expect(link).toHaveAttribute('href', path);
            await link.click();
            await expect(page).toHaveURL((url) => url.pathname + url.hash === path);
        }
        const directory = page.locator('#guides');
        await directory.getByRole('link', { name: guides['configuration'].title, exact: true }).click();
        await expect(page).toHaveURL(/\/configuration\/$/);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByRole('link', { name: 'This guide as Markdown' })).toHaveAttribute('href', '/uxor/configuration.md');
    });

    for (const width of [320, 1280]) {
        test(`a reader can use the chapter contents with the keyboard at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            await page.goto('advanced/');
            const toc = page.getByRole('navigation', { name: 'On this page' });
            await expect(toc).toBeVisible();
            if (width === 320) {
                const summary = toc.locator('summary');
                await expect(toc.getByRole('link')).toHaveCount(0);
                await summary.focus();
                await page.keyboard.press('Enter');
            }
            const headings = page.getByTestId('guide').locator('h2[id]');
            const links = toc.getByRole('link');
            await expect(links).toHaveCount(await headings.count());
            const target = headings.nth(1);
            const id = await target.getAttribute('id');
            const link = links.nth(1);
            await expect(link).toHaveText((await target.textContent())!);
            await expect(link).toHaveAttribute('href', '#' + id);
            await link.focus();
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL((url) => url.hash === '#' + id);
            await expect(target).toBeInViewport();
        });
    }
});

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
