import type { Page } from '@playwright/test';
import { test, expect, guardPage } from './fixtures';
import { kitName, recipes } from './inventory';

// Every page answering 200 with its heading: a11y.spec.ts, which opens each of them. The theme toggle: theme-toggle.spec.ts.

test('the index lists every recipe of the kit', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(kitName);
    await expect(page.getByTestId('recipe-count')).toHaveText(`(${recipes.length})`);
    // grouped by type (components, then blocks), each group sorted by name
    expect((await page.getByTestId('recipe-list').getByRole('link').allTextContents()).sort()).toEqual(recipes);
});

test('links navigate with Turbo Drive (no full page load)', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => 'Turbo' in window);
    await page.evaluate(() => ((window as any).__sameDocument = true));

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Lab' }).click();
    await expect(page).toHaveURL(/\/lab$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lab');
    expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);
});

test('unknown recipes are 404', async ({ page, allowHttpError }) => {
    allowHttpError(/\/r\/does-not-exist$/, 404); // the 404 document itself, nothing else
    const response = await page.goto('/r/does-not-exist');
    expect(response?.status()).toBe(404);
});

/*
 * The guard's one exception for page errors (guardPage, FETCH_CANCELLED_BY_UNLOAD): WebKit's rejection of a fetch the
 * document still runs when a full load replaces it. Calibrated with planted errors carrying those exact messages, on
 * a page of its own with a guard of its own (the test's own page keeps the usual guard): dropped in WebKit while a
 * full load replaces the document, reported anywhere else and in the other engines, which never throw them.
 */
test.describe('the page guard', () => {
    const MESSAGES = ['TypeError: Load failed', 'Fetch API cannot load https://localhost/lab due to access control checks.'];
    /** Throws `message` from a task of the page, uncaught, and waits until Playwright has reported it. */
    const plant = async (page: Page, message: string) => {
        const reported = page.waitForEvent('pageerror', { predicate: (error) => error.message.endsWith(message) });
        await page.evaluate((message) => void setTimeout(() => { throw new Error(message); }), message);
        await reported;
    };
    const errorsOf = (guard: Awaited<ReturnType<typeof guardPage>>) => {
        try {
            guard.check();
            return '';
        } catch (error) {
            return String(error);
        }
    };
    const expectReported = (errors: string) => {
        for (const message of MESSAGES) {
            expect(errors).toContain(`pageerror: ${message}`);
        }
    };

    /** Holds the request Turbo's prefetch sends for `path` (X-Sec-Purpose: prefetch) until the returned function is called. */
    const holdPrefetch = async (page: Page, path: string) => {
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        await page.route(`**${path}`, async (route) => {
            if ('prefetch' === route.request().headers()['x-sec-purpose']) {
                await held;
            }
            await route.fallback().catch(() => undefined); // the page that sent it may be gone
        });
        return release;
    };

    test('a Turbo prefetch cancelled by a full load: fails nothing', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => 'Turbo' in window);
        const release = await holdPrefetch(page, '/lab');
        const prefetch = page.waitForRequest((request) => 'prefetch' === request.headers()['x-sec-purpose']);
        await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Lab' }).hover();
        await prefetch;
        // the prefetch is still running: the full load cancels it (Firefox rejects its fetch, which Turbo rethrows)
        await page.goto('/lab/turbo-nav');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        release();
    });

    test('a fetch cancelled while a full load replaces the document: dropped in WebKit only', async ({ page: helper, context, baseURL, browserName }) => {
        const page = await context.newPage();
        const guard = await guardPage(page, baseURL);
        await page.goto('/lab');
        await page.evaluate((messages) => {
            const channel = ((window as any).__guardCalibration = new BroadcastChannel('guard-calibration'));
            channel.onmessage = () => messages.forEach((message) => setTimeout(() => { throw new Error(message); }));
        }, MESSAGES);
        // the next document's request is held until the one on screen has thrown what WebKit throws, told to by
        // another page (Playwright cannot evaluate in a page whose navigation is pending, in Chromium)
        await helper.goto('/lab');
        await page.route('**/lab/turbo-nav', async (route) => {
            const reported = Promise.all(MESSAGES.map((message) => page.waitForEvent('pageerror', { predicate: (error) => error.message.endsWith(message) })));
            await helper.evaluate(() => new BroadcastChannel('guard-calibration').postMessage('throw'));
            await reported;
            await route.fallback();
        });
        await page.goto('/lab/turbo-nav');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        if ('webkit' === browserName) {
            expect(errorsOf(guard)).toBe('');
        } else {
            expectReported(errorsOf(guard));
        }
        await page.close();
    });

    test('the same messages outside a full load: reported', async ({ context, baseURL }) => {
        const page = await context.newPage();
        const guard = await guardPage(page, baseURL);
        await page.goto('/lab');
        for (const message of MESSAGES) {
            await plant(page, message);
        }
        expectReported(errorsOf(guard));
        await page.close();
    });

    test('the same messages after a navigation that left the document in place: reported', async ({ context, baseURL, browserName }) => {
        const page = await context.newPage();
        const guard = await guardPage(page, baseURL);
        await page.goto('/lab');
        // a 204 answer: the browser keeps the document on screen; Chromium and WebKit report the request failed (the
        // guard's end of the full load), Playwright reports no end of it in Firefox
        await page.route('**/lab/no-content', (route) => route.fulfill({ status: 204 }));
        const failed = 'firefox' === browserName ? null : page.waitForEvent('requestfailed', (request) => request.url().endsWith('/lab/no-content'));
        await page.evaluate(() => location.assign('/lab/no-content'));
        await failed;
        await expect(page.getByRole('heading', { level: 1, name: 'Lab' })).toBeVisible();
        for (const message of MESSAGES) {
            await plant(page, message);
        }
        expectReported(errorsOf(guard));
        await page.close();
    });

    /*
     * The guard's exception for Firefox (PREFETCH_CANCELLED_BY_UNLOAD): Turbo's prefetch, cancelled by a full load,
     * rejected with this message and rethrown by Turbo. Above, the real one: nothing reported. Below, the same message
     * where one of its conditions is missing: thrown by the page itself, outside a full load or during one; thrown by
     * Turbo's prefetch whose request failed without being cancelled, a full load after it; thrown by Turbo's prefetch
     * after a full load that cancelled another prefetch request, or after the page cancelled one of its own, a full
     * load after it; and Turbo's prefetch cancelled with no full load: by a navigation the server answers 204 (the
     * document stays) or by `window.stop()`. Each is reported.
     */
    const PREFETCH_MESSAGE = 'NetworkError when attempting to fetch resource.';

    test("Turbo's prefetch message outside a full load: reported", async ({ context, baseURL }) => {
        const page = await context.newPage();
        const guard = await guardPage(page, baseURL);
        await page.goto('/lab');
        await plant(page, PREFETCH_MESSAGE);
        expect(errorsOf(guard)).toContain(`pageerror: ${PREFETCH_MESSAGE}`);
        await page.close();
    });

    test("the page's own prefetch request cancelled by a full load, its rejection unhandled: reported", async ({ context, baseURL, browserName }) => {
        const page = await context.newPage();
        const guard = await guardPage(page, baseURL);
        await page.goto('/');
        const release = await holdPrefetch(page, '/lab');
        // a fetch like Turbo's (same header, same URL, cancelled by the same full load), from a script of the page
        const sent = page.waitForRequest((request) => 'prefetch' === request.headers()['x-sec-purpose']);
        await page.evaluate(() => void fetch('/lab', { headers: { 'X-Sec-Purpose': 'prefetch' } }));
        await sent;
        const rejected = 'firefox' === browserName ? page.waitForEvent('pageerror', { predicate: (error) => PREFETCH_MESSAGE === error.message }) : null;
        await page.goto('/lab/turbo-nav');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await rejected;
        release();
        if ('firefox' === browserName) {
            expect(errorsOf(guard)).toContain(`pageerror: ${PREFETCH_MESSAGE}`);
        }
        await page.close();
    });

    test("Turbo's prefetch failing without being cancelled, then a full load: reported", async ({ context, baseURL, browserName }) => {
        const page = await context.newPage();
        const guard = await guardPage(page, baseURL);
        await page.goto('/');
        await page.waitForFunction(() => 'Turbo' in window);
        await page.route('**/lab', (route) => ('prefetch' === route.request().headers()['x-sec-purpose'] ? route.abort('failed') : route.fallback()));
        const rejected = page.waitForEvent('pageerror');
        await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Lab' }).hover();
        await rejected;
        await page.goto('/lab/turbo-nav');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const errors = errorsOf(guard);
        expect(errors).toContain('pageerror: ');
        if ('firefox' === browserName) {
            expect(errors).toContain(`pageerror: ${PREFETCH_MESSAGE}`);
        }
        await page.close();
    });

    test("Turbo's prefetch failing after a full load cancelled another prefetch request: reported", async ({ context, baseURL, browserName }) => {
        const page = await context.newPage();
        const guard = await guardPage(page, baseURL);
        await page.goto('/');
        // a prefetch request the full load cancels, its rejection handled: no page error of its own
        const release = await holdPrefetch(page, '/forms');
        const sent = page.waitForRequest((request) => 'prefetch' === request.headers()['x-sec-purpose']);
        await page.evaluate(() => void fetch('/forms', { headers: { 'X-Sec-Purpose': 'prefetch' } }).catch(() => undefined));
        await sent;
        await page.goto('/lab/turbo-nav');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        release();
        // then, on the new document, Turbo's prefetch fails on its own
        await page.waitForFunction(() => 'Turbo' in window);
        await page.route('**/lab', (route) => ('prefetch' === route.request().headers()['x-sec-purpose'] ? route.abort('failed') : route.fallback()));
        const rejected = page.waitForEvent('pageerror');
        await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Lab' }).hover();
        await rejected;
        await page.goto('/');
        const errors = errorsOf(guard);
        expect(errors).toContain('pageerror: ');
        if ('firefox' === browserName) {
            expect(errors).toContain(`pageerror: ${PREFETCH_MESSAGE}`);
        }
        await page.close();
    });

    test("Turbo's prefetch failing after the page cancelled a prefetch request of its own, then a full load: reported", async ({ context, baseURL, browserName }) => {
        const page = await context.newPage();
        const guard = await guardPage(page, baseURL);
        await page.goto('/');
        // Turbo started: its history entry replaced (a commit of the same document, which must come before the cancel)
        await page.waitForFunction(() => undefined !== history.state?.turbo);
        // a prefetch request cancelled by the page, no full load: its AbortError handled, no page error of its own
        const release = await holdPrefetch(page, '/forms');
        const cancelled = page.waitForEvent('requestfailed', (request) => request.url().endsWith('/forms'));
        await page.evaluate(async () => {
            const controller = new AbortController();
            const sent = fetch('/forms', { headers: { 'X-Sec-Purpose': 'prefetch' }, signal: controller.signal }).catch(() => undefined);
            await new Promise((resolve) => setTimeout(resolve, 200));
            controller.abort();
            await sent;
        });
        await cancelled;
        release();
        // then Turbo's prefetch fails on its own, and a full load follows
        await page.route('**/lab', (route) => ('prefetch' === route.request().headers()['x-sec-purpose'] ? route.abort('failed') : route.fallback()));
        const rejected = page.waitForEvent('pageerror');
        await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Lab' }).hover();
        await rejected;
        await page.goto('/lab/turbo-nav');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const errors = errorsOf(guard);
        expect(errors).toContain('pageerror: ');
        if ('firefox' === browserName) {
            expect(errors).toContain(`pageerror: ${PREFETCH_MESSAGE}`);
        }
        await page.close();
    });

    for (const [how, leave] of [
        ['a navigation that left the document in place (a 204)', (page: Page) => page.evaluate(() => location.assign('/lab/no-content'))],
        ['window.stop(), no navigation', (page: Page) => page.evaluate(() => window.stop())],
    ] as const) {
        test(`Turbo's prefetch cancelled by ${how}: reported`, async ({ context, baseURL, browserName }) => {
            const page = await context.newPage();
            const guard = await guardPage(page, baseURL);
            await page.goto('/');
            await page.waitForFunction(() => 'Turbo' in window);
            await page.route('**/lab/no-content', (route) => route.fulfill({ status: 204 }));
            const release = await holdPrefetch(page, '/lab');
            const prefetch = page.waitForRequest((request) => 'prefetch' === request.headers()['x-sec-purpose']);
            await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Lab' }).hover();
            await prefetch;
            // Firefox cancels the prefetch, and Turbo rethrows the rejection, on a document that stays
            const rejected = 'firefox' === browserName ? page.waitForEvent('pageerror', { predicate: (error) => PREFETCH_MESSAGE === error.message }) : null;
            await leave(page);
            await rejected;
            release();
            await expect(page.getByRole('heading', { level: 1, name: kitName })).toBeVisible();
            if ('firefox' === browserName) {
                expect(errorsOf(guard)).toContain(`pageerror: ${PREFETCH_MESSAGE}`);
            }
            await page.close();
        });
    }
});
