import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

// Compare two environments of this checkout using the repository's Playwright server.
const [baseURL, devURL] = process.argv.slice(2);
if (!baseURL || !devURL) throw new Error('Usage: node tools/experiments/inspect-turbo.mjs <inspector-origin> <ordinary-dev-origin>');
const browser = await chromium.connect('ws://127.0.0.1:3000/', { exposeNetwork: '<loopback>' });
try {
    const page = await browser.newPage({ baseURL, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
        window.inspectorTrial = { blocked: [], events: [] };
        document.addEventListener('securitypolicyviolation', (event) => {
            if (event.disposition === 'enforce' && event.blockedURI === new URL('/_ux/inspector.js', location.href).href) {
                window.inspectorTrial.blocked.push(event.effectiveDirective);
            }
        });
        for (const type of ['turbo:visit', 'turbo:render', 'turbo:load']) {
            document.addEventListener(type, () => window.inspectorTrial.events.push(type));
        }
    });

    const dashboard = await page.goto('/demo');
    assert.equal(dashboard.status(), 200, 'the opt-in dashboard renders');
    await expect(page.locator('script[type="module"][src="/_ux/inspector.js"]')).toHaveCount(1);
    await expect(page.locator('ux-inspector')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.inspectorTrial.blocked)).toContain('script-src-elem');
    assert.equal(await page.evaluate(() => Boolean(customElements.get('ux-inspector'))), false);

    await expect.poll(() => page.evaluate(() => window.inspectorTrial.events)).toContain('turbo:load');
    const original = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.inspectorTrial.events.length = 0; });
    const nav = page.getByRole('navigation', { name: 'Site', exact: true });
    await nav.getByRole('button', { name: 'Account' }).click();
    await nav.getByRole('link', { name: 'Profile' }).click();
    await expect(page).toHaveURL(new URL('/demo/settings/profile', baseURL).href);
    await expect.poll(() => page.evaluate(() => window.inspectorTrial.events)).toContain('turbo:load');
    assert.equal(await original.evaluate((previous) => previous === document), true);
    const events = await page.evaluate(() => window.inspectorTrial.events);
    for (const type of ['turbo:visit', 'turbo:render', 'turbo:load']) assert.ok(events.includes(type), type);
    console.log('Turbo kept the document from Dashboard to Profile:', events.join(', '));

    await page.reload();
    await expect.poll(() => page.evaluate(() => window.inspectorTrial.events)).toContain('turbo:load');
    assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type), 'reload');
    assert.deepEqual(await page.evaluate(() => window.inspectorTrial.events), ['turbo:load']);
    console.log('A full reload of Profile produced only turbo:load.');

    const frame = await page.request.get('/demo', { headers: { 'Turbo-Frame': 'trial' } });
    assert.equal(frame.status(), 200);
    const inspectorMarkup = /<ux-inspector\b|src="\/_ux\/inspector\.js"/;
    assert.doesNotMatch(await frame.text(), inspectorMarkup);

    const devDashboard = await page.request.get(new URL('/demo', devURL).href);
    assert.equal(devDashboard.status(), 200);
    assert.doesNotMatch(await devDashboard.text(), inspectorMarkup);
    const devModule = await page.request.get(new URL('/_ux/inspector.js', devURL).href);
    assert.equal(devModule.status(), 404);
    console.log('CSP blocked Inspector in the opt-in environment. Frame responses omit it; ordinary dev omits both the panel and the route.');
} finally {
    await browser.close();
}
