import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { test, expect, guardPage, leavingTheDemo, markDocument } from './fixtures';
import { png } from './files';

test('links navigate with Turbo Drive (no full page load)', async ({ page }) => {
    await page.goto('/forms');
    await page.waitForFunction(() => 'Turbo' in window);
    const sameDocument = await markDocument(page);

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Lab' }).click();
    await expect(page).toHaveURL(/\/lab$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lab');
    await sameDocument.expectKept();
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
        await page.goto('/forms');
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
     * A local subresource the browser cancels and then requests again: Firefox, under Playwright's interception (the
     * guard's route), aborts a frame's images at a same-document navigation and re-issues them (the gallery's preview
     * frames). The guard excuses a cancelled request only when the same URL, from the same frame, is requested again
     * after it failed and that request succeeds; anything else is still reported. Calibrated on an image of the page
     * whose load the page itself cancels (its `src` dropped while the request is held), so the browser reports a
     * cancellation as it does for the real one. WebKit reports no failure for an image load the page cancels: it never
     * meets the condition, and these cases run in Chromium and Firefox.
     */
    const CALIBRATION = '/guard-calibration.png';
    /** Answers the calibration image's requests in order: `hold` keeps one until release(), `ok` serves it at once. */
    const serveCalibration = async (page: Page, plan: ('hold' | 'ok')[]) => {
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        let index = 0;
        await page.route(`**${CALIBRATION}`, async (route) => {
            if ('hold' === (plan[index++] ?? 'ok')) {
                await held;
            }
            await route.fulfill({ path: PLACEHOLDER }).catch(() => undefined); // its request may be cancelled
        });
        return release;
    };
    const PLACEHOLDER = fileURLToPath(new URL('./examples/placeholder.png', import.meta.url));
    /**
     * Adds an image of the calibration URL to `frame`'s document, under `id`, and waits until its request went out. A
     * `cors` image (crossOrigin) is a request of its own: the browser shares one load, or its cached image, between the
     * plain images of one URL, never with it.
     */
    const addImage = async (page: Page, id: string, frame = page.mainFrame(), cors = false) => {
        const sent = page.waitForRequest((request) => request.url().endsWith(CALIBRATION) && request.frame() === frame);
        await frame.evaluate(([id, url, cors]) => {
            const image = new Image();
            image.id = id;
            if (cors) {
                image.crossOrigin = 'anonymous';
            }
            image.src = url;
            document.body.append(image);
        }, [id, CALIBRATION, cors] as const);
        await sent;
    };
    /** Drops the `src` of image `id` while its request is held: the browser cancels the load, and reports it. */
    const cancelImage = async (page: Page, id: string, frame = page.mainFrame()) => {
        const failed = page.waitForEvent('requestfailed', (request) => request.url().endsWith(CALIBRATION) && request.frame() === frame);
        await frame.evaluate((id) => document.getElementById(id)!.removeAttribute('src'), id);
        expect(['net::ERR_ABORTED', 'NS_BINDING_ABORTED'], 'the browser reports a cancellation').toContain((await failed).failure()?.errorText);
    };
    /** Waits until the image `id` of `frame` has loaded. */
    const loaded = (frame: import('@playwright/test').Frame, id: string) =>
        frame.waitForFunction((id) => { const image = document.getElementById(id) as HTMLImageElement | null; return !!image && image.complete && image.naturalWidth > 0; }, id);
    const calibrationFailure = (errors: string) => errors.includes(`requestfailed: GET`) && errors.includes(CALIBRATION);

    test.describe('a cancelled local subresource', () => {
        test.beforeEach(({ browserName }) => {
            test.skip('webkit' === browserName, 'WebKit reports no failure for an image load the page cancels');
        });

        test('requested again from the same frame and received: fails nothing', async ({ context, baseURL }) => {
            const page = await context.newPage();
            const guard = await guardPage(page, baseURL);
            await page.goto('/lab');
            const release = await serveCalibration(page, ['hold', 'ok']);
            await addImage(page, 'first');
            await cancelImage(page, 'first');
            await addImage(page, 'again');
            await loaded(page.mainFrame(), 'again');
            release();
            expect(errorsOf(guard)).toBe('');
            await page.close();
        });

        test('never requested again: reported', async ({ context, baseURL }) => {
            const page = await context.newPage();
            const guard = await guardPage(page, baseURL);
            await page.goto('/lab');
            const release = await serveCalibration(page, ['hold']);
            await addImage(page, 'first');
            await cancelImage(page, 'first');
            release();
            expect(calibrationFailure(errorsOf(guard))).toBe(true);
            await page.close();
        });

        test('requested again and cancelled again: reported', async ({ context, baseURL }) => {
            const page = await context.newPage();
            const guard = await guardPage(page, baseURL);
            await page.goto('/lab');
            const release = await serveCalibration(page, ['hold', 'hold']);
            await addImage(page, 'first');
            await cancelImage(page, 'first');
            await addImage(page, 'again');
            await cancelImage(page, 'again');
            release();
            expect(calibrationFailure(errorsOf(guard))).toBe(true);
            await page.close();
        });

        test('requested again from another frame: reported', async ({ context, baseURL }) => {
            const page = await context.newPage();
            const guard = await guardPage(page, baseURL);
            await page.goto('/lab');
            const release = await serveCalibration(page, ['hold', 'ok']);
            await page.evaluate(() => new Promise<void>((resolve) => {
                const frame = document.createElement('iframe');
                frame.name = 'calibration';
                frame.addEventListener('load', () => resolve(), { once: true });
                frame.srcdoc = '<!doctype html><body></body>';
                document.body.append(frame);
            }));
            const other = page.frame({ name: 'calibration' })!;
            await addImage(page, 'first');
            await cancelImage(page, 'first');
            await addImage(page, 'again', other);
            await loaded(other, 'again');
            release();
            expect(calibrationFailure(errorsOf(guard))).toBe(true);
            await page.close();
        });

        test('received by a request that was already running when it was cancelled: reported', async ({ context, baseURL }) => {
            const page = await context.newPage();
            const guard = await guardPage(page, baseURL);
            await page.goto('/lab');
            // two images of the same URL, both requests held: one cancelled, the other then received. It was sent
            // before the cancellation, so it is no request made again, and the cancelled image shows nothing
            const release = await serveCalibration(page, ['hold', 'hold']);
            await addImage(page, 'first');
            await addImage(page, 'second', page.mainFrame(), true);
            await cancelImage(page, 'first');
            release();
            await loaded(page.mainFrame(), 'second');
            expect(calibrationFailure(errorsOf(guard))).toBe(true);
            await page.close();
        });

        test('received before it was cancelled: reported', async ({ context, baseURL }) => {
            const page = await context.newPage();
            const guard = await guardPage(page, baseURL);
            await page.goto('/lab');
            const release = await serveCalibration(page, ['ok', 'hold']);
            await addImage(page, 'earlier');
            await loaded(page.mainFrame(), 'earlier');
            await addImage(page, 'first', page.mainFrame(), true);
            await cancelImage(page, 'first');
            release();
            expect(calibrationFailure(errorsOf(guard))).toBe(true);
            await page.close();
        });

        test('requested again by the next document of the frame and received: reported', async ({ context, baseURL }) => {
            const page = await context.newPage();
            const guard = await guardPage(page, baseURL);
            await page.goto('/lab');
            const release = await serveCalibration(page, ['hold', 'ok']);
            // a page of the demo's origin whose document shows the same image
            await page.route('**/guard-calibration-page', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Calibration</title><img id="next" src="${CALIBRATION}">` }));
            await addImage(page, 'first');
            await cancelImage(page, 'first');
            // a full load of the frame: the next document requests the image again, and receives it
            await page.goto('/guard-calibration-page');
            await loaded(page.mainFrame(), 'next');
            release();
            expect(calibrationFailure(errorsOf(guard))).toBe(true);
            await page.close();
        });

        test('a fetch cancelled, then fetched again and received: reported (only images are excused)', async ({ context, baseURL }) => {
            const page = await context.newPage();
            const guard = await guardPage(page, baseURL);
            await page.goto('/lab');
            const release = await serveCalibration(page, ['hold', 'ok']);
            const failed = page.waitForEvent('requestfailed', (request) => request.url().endsWith(CALIBRATION));
            await page.evaluate((url) => {
                const controller = new AbortController();
                fetch(url, { signal: controller.signal }).catch(() => undefined);
                setTimeout(() => controller.abort(), 100);
            }, CALIBRATION);
            expect((await failed).resourceType()).toBe('fetch');
            await page.evaluate((url) => fetch(url).then((response) => response.blob()), CALIBRATION);
            release();
            expect(calibrationFailure(errorsOf(guard))).toBe(true);
            await page.close();
        });
    });

    /*
     * Only an image is excused: a stylesheet or a script the browser cancels and requests again is still reported (a
     * script requested twice can run twice). Cancelled here by `window.stop()` while its request is held, which every
     * engine reports as a cancellation; the request made again is received.
     */
    test.describe('a cancelled local stylesheet or script', () => {
        for (const kind of ['stylesheet', 'script'] as const) {
            test(`a ${kind} requested again from the same frame and received: reported`, async ({ context, baseURL }) => {
                const page = await context.newPage();
                const guard = await guardPage(page, baseURL);
                await page.goto('/lab');
                const url = 'stylesheet' === kind ? '/guard-calibration.css' : '/guard-calibration.js';
                let release!: () => void;
                const held = new Promise<void>((resolve) => (release = resolve));
                let index = 0;
                await page.route(`**${url}`, async (route) => {
                    if (0 === index++) {
                        await held;
                    }
                    const body = 'stylesheet' === kind ? 'body {}' : '';
                    await route.fulfill({ contentType: 'stylesheet' === kind ? 'text/css' : 'text/javascript', body }).catch(() => undefined);
                });
                const add = () => page.evaluate(([kind, url]) => {
                    const element = 'stylesheet' === kind ? Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url }) : Object.assign(document.createElement('script'), { src: url });
                    document.head.append(element);
                }, [kind, url] as const);
                const sent = page.waitForRequest((request) => request.url().endsWith(url));
                await add();
                await sent;
                const failed = page.waitForEvent('requestfailed', (request) => request.url().endsWith(url));
                await page.evaluate(() => window.stop());
                const cancelled = await failed;
                expect(cancelled.resourceType()).toBe(kind);
                expect(['net::ERR_ABORTED', 'NS_BINDING_ABORTED', 'Load request cancelled'], 'the browser reports a cancellation').toContain(cancelled.failure()?.errorText);
                const received = page.waitForEvent('requestfinished', (request) => request.url().endsWith(url));
                await add();
                await received;
                release();
                const errors = errorsOf(guard);
                expect(errors.includes('requestfailed: GET') && errors.includes(url)).toBe(true);
                await page.close();
            });
        }
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

    /*
     * Playwright matches requests leaving the demo on its server. App requests and in-browser images load normally.
     * Page events report the demo's failures, answers of 400 or more and policy violations.
     */
    test.describe('requests and violations', () => {
        const OUTSIDE = 'https://uxor-guard.invalid';

        test('the route takes outside requests and leaves app and in-browser URLs alone', ({ baseURL }) => {
            test.skip('smoke' !== test.info().project.name, 'checks no browser: run in the smoke project only');
            // the demo's addresses, and one made of every character a RegExp reads as syntax
            for (const base of [baseURL ?? 'http://127.0.0.1:8000', 'https://localhost', 'http://127.0.0.1:8000', 'https://a.b+c(d)[e]{f}|g$h^i?j*k\\l']) {
                const route = leavingTheDemo(base);
                const inside = [`${base}/`, `${base}/lab?q=1#top`, `${base}/assets/app-0a1b2c.js`, `blob:${base}/file`, 'data:image/png;base64,AA'];
                const outside = [`${base}x/`, `${base}.example.org/`, `${base}:8443/`, base, `${OUTSIDE}/${base}/`, `${OUTSIDE}/picture.png`];
                expect(inside.filter((url) => route.test(url)), `URLs intercepted under ${base}`).toEqual([]);
                expect(outside.filter((url) => !route.test(url)), `URLs let through under ${base}`).toEqual([]);
            }
        });

        test('a request leaving the demo never leaves: an image gets the placeholder, any other fails, and neither is reported', async ({ context, baseURL }) => {
            const page = await context.newPage();
            // registered before the guard, so it runs only for a request the guard's route lets through
            const reached: string[] = [];
            await page.route(`${OUTSIDE}/**`, (route) => {
                reached.push(route.request().url());
                return route.fulfill({ status: 200, contentType: 'text/plain', body: 'reached' });
            });
            const guard = await guardPage(page, baseURL);
            // a page of the demo's origin without the demo's policy, so the browser asks for what it names
            await page.route('**/guard-outside-page', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Outside</title><img id="outside" src="${OUTSIDE}/picture.png">` }));
            await page.goto('/guard-outside-page');
            await loaded(page.mainFrame(), 'outside');
            const blobWidth = await page.evaluate(async (bytes) => {
                const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
                const image = new Image();
                try {
                    image.src = url;
                    await image.decode();
                    return image.naturalWidth;
                } finally {
                    URL.revokeObjectURL(url);
                }
            }, [...png('guard.png').buffer]);
            expect(blobWidth).toBe(1);
            // no-cors: a cross-origin read Firefox would log as an error of the page, which is not what this checks
            const fetched = await page.evaluate((url) => fetch(url, { mode: 'no-cors' }).then((response) => response.text(), (error) => `rejected: ${error}`), `${OUTSIDE}/data.json`);
            expect(fetched).toMatch(/^rejected: /);
            expect(reached, 'requests the guard let leave').toEqual([]);
            expect(errorsOf(guard)).toBe('');
            await page.close();
        });

        test('a local answer of 400 or more, and a local request that fails: reported', async ({ context, baseURL }) => {
            const page = await context.newPage();
            const guard = await guardPage(page, baseURL);
            await page.goto('/lab');
            await page.route('**/guard-refused', (route) => route.abort('connectionrefused'));
            const answered = page.waitForResponse((response) => response.url().endsWith('/guard-missing'));
            const failed = page.waitForEvent('requestfailed', (request) => request.url().endsWith('/guard-refused'));
            await page.evaluate(() => Promise.allSettled([fetch('/guard-missing'), fetch('/guard-refused')]));
            expect((await answered).status()).toBe(404);
            await failed;
            const errors = errorsOf(guard);
            expect(errors).toContain(`http 404: ${baseURL}/guard-missing`);
            expect(errors).toContain(`requestfailed: GET ${baseURL}/guard-refused`);
            await page.close();
        });

        test('a Content Security Policy violation: reported', async ({ context, baseURL }) => {
            const page = await context.newPage();
            const guard = await guardPage(page, baseURL);
            await page.goto('/lab');
            // a <style> without the page's nonce
            await page.evaluate(() => document.head.append(Object.assign(document.createElement('style'), { textContent: 'body { outline: 0 }' })));
            await expect.poll(() => errorsOf(guard)).toContain('csp: style-src');
            await page.close();
        });
    });

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
        await page.goto('/forms');
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
        await page.goto('/forms');
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
        await page.goto('/forms');
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
        await page.goto('/forms');
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
        await page.goto('/forms');
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
            await page.goto('/forms');
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
            await expect(page.getByRole('heading', { level: 1, name: 'Form theme' })).toBeVisible();
            if ('firefox' === browserName) {
                expect(errorsOf(guard)).toContain(`pageerror: ${PREFETCH_MESSAGE}`);
            }
            await page.close();
        });
    }
});
