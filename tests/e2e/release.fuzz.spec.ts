import type { APIResponse, Page } from '@playwright/test';
import { test, expect, controllersConnected, stimulusControllers } from './fixtures';

/*
 * Release checks (docs/PLAN-test-tiers.md, tier 3), fuzzing: random requests against the data tables, seeded and under
 * a time budget. Each run prints its seed; `SEED=<seed>` replays it (FUZZ_BUDGET_MS sets the budget per target, 30 s by
 * default). A failure names the seed and the request, and becomes a tier 1 test once fixed.
 *
 * - Query strings: random parameters (the tables' own, nested, repeated, unknown) with random values (hostile markup,
 *   huge and negative numbers, long and odd strings) on each data table page: no 5xx, no response over RESPONSE_BUDGET_MS,
 *   no element or event attribute a value injected, and, loaded in the browser, no CSP violation or console error.
 * - Live props: random values for the writable props of the Live data table (`OrdersTable`), sent as the live
 *   controller sends them (the props and their checksum from `data-live-props-value`, the changed ones in `updated`):
 *   no 5xx, nothing injected; an accepted answer then replaces the component in the page, as the live controller's
 *   morph would, where the page's Content Security Policy and the same guard (console, failed requests) apply.
 * - Form posts: the POST forms of /forms and the lab's form pages, each field given a random value (long strings,
 *   unicode, markup, numbers) or the wrong type (an array, a nested key, left out), the CSRF field kept: no 5xx, no slow
 *   answer, nothing injected; one post in three goes through the page's own form in the browser (its CSRF script runs),
 *   where the CSP and the console are checked on what the server answers.
 * - UI runs: on the lab pages, random clicks, keys, Back and Forward, the theme toggle and the system theme, each
 *   followed by a wait for the page to settle: no console or page error, and one Stimulus controller per element and
 *   identifier.
 */

const BUDGET_MS = Number(process.env.FUZZ_BUDGET_MS ?? 30_000);
const RESPONSE_BUDGET_MS = 3_000;
const SEED = process.env.SEED ? Number(process.env.SEED) : Math.floor(Math.random() * 2 ** 31);
// a server error page or a refused form logs its status in the console; the status itself is checked where it is known
const HTTP_STATUS_LOG = /^Failed to load resource: the server responded with a status of 4\d\d/;

/** mulberry32: a small seeded generator, the same sequence for the same seed. */
function generator(seed: number) {
    let state = seed >>> 0;
    const next = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (max: number) => Math.floor(next() * max);
    const pick = <T>(items: readonly T[]): T => items[int(items.length)];

    return { next, int, pick };
}
type Random = ReturnType<typeof generator>;

// what an injected value would add: an element or an attribute named fuzz (none exists in the demo)
const MARKUP = [
    '<fuzz-x data-fuzz="1">',
    '"><fuzz-x data-fuzz="1">',
    "'><fuzz-x data-fuzz=1>",
    '" data-fuzz="1" x="',
    "' data-fuzz='1' x='",
    '<img src=x data-fuzz=1 onerror="window.__fuzz=1">',
    '<script>window.__fuzz=1</script>',
    '</textarea><fuzz-x data-fuzz>',
    '{{ 7*7 }}<fuzz-x data-fuzz>',
    'javascript:window.__fuzz=1',
];

function value(random: Random): string {
    switch (random.int(9)) {
        case 0: return random.pick(MARKUP);
        case 1: return String(random.pick([0, -1, 1, 2, 3, 57, 10_000, 2 ** 31, 2 ** 53, Number.MAX_SAFE_INTEGER * 1000]));
        case 2: return random.pick(['1e9', '-0', '1.5', '0x10', 'NaN', 'Infinity', '', ' ', '00', '+3', '1,000']);
        case 3: return random.pick(['asc', 'desc', 'ASC', 'Desc', 'customer', 'total', 'number', 'status', 'created', 'paid', 'pending', 'refunded', 'id']);
        case 4: return 'x'.repeat(random.pick([100, 101, 1_000, 5_000]));
        case 5: return random.pick(['é'.repeat(150), '\u0000', '‮', '😀'.repeat(60), '%', '%00', '\\', '../../etc/passwd', "' OR 1=1 --"]);
        case 6: return Array.from({ length: 1 + random.int(12) }, () => String.fromCharCode(32 + random.int(95))).join('');
        case 7: return random.pick(MARKUP) + random.pick(['', 'paid', '2']);
        default: return String(random.int(100));
    }
}

/** A query string: the tables' parameters and unknown ones, plain, nested or repeated, each value random. */
function queryString(random: Random): string {
    // the tables' own parameters twice as often as the odd ones
    const known = ['q', 'sort', 'dir', 'page', 'size', 'f[status]'];
    const names = [...known, ...known, 'f', 'f[]', 'page[]', 'q[x]', 'sort[0]', 'f[status][]', 'orders[page]', 'zz', 'f[unknown]', '_'];
    const pairs: string[] = [];
    for (let i = 0, count = 1 + random.int(6); i < count; i++) {
        pairs.push(`${encodeURIComponent(random.pick(names)).replace(/%5B/g, '[').replace(/%5D/g, ']')}=${encodeURIComponent(value(random))}`);
    }
    return pairs.join('&');
}

/** What a response body would hold if a value were injected as markup, parsed by the browser. */
async function injected(page: Page, html: string): Promise<string[]> {
    return page.evaluate((source) => {
        const document = new DOMParser().parseFromString(source, 'text/html');
        const found: string[] = [];
        for (const element of document.querySelectorAll('*')) {
            if ('fuzz-x' === element.localName || element.hasAttribute('data-fuzz')) {
                found.push(element.outerHTML.slice(0, 200));
            }
            for (const name of element.getAttributeNames()) {
                if (/^on/i.test(name) && /fuzz/.test(element.getAttribute(name) ?? '')) {
                    found.push(`<${element.localName} ${name}>`);
                }
            }
            if ('script' === element.localName && /__fuzz/.test(element.textContent ?? '')) {
                found.push(element.outerHTML.slice(0, 200));
            }
        }
        return found;
    }, html);
}

async function timed(request: () => Promise<APIResponse>): Promise<{ response: APIResponse; ms: number }> {
    const start = Date.now();
    const response = await request();
    return { response, ms: Date.now() - start };
}

test.describe('release fuzz', { tag: '@release' }, () => {
    test.skip(({ browserName }) => 'chromium' !== browserName, 'Chromium only, as the other release checks');
    test.describe.configure({ timeout: BUDGET_MS * 4 + 60_000 });

    test.beforeEach(() => {
        console.log(`fuzz: SEED=${SEED} (replay with SEED=${SEED}), budget ${BUDGET_MS} ms per target`);
        test.info().annotations.push({ type: 'seed', description: String(SEED) });
    });

    test('random query strings on the data table pages: no 5xx, nothing injected, no CSP violation', async ({ page }) => {
        const random = generator(SEED);
        const errors: string[] = [];
        page.on('console', (message) => 'error' === message.type() && errors.push(message.text()));
        page.on('pageerror', (error) => errors.push(error.message));
        const pages = ['/lab/data-table-frame', '/lab/data-table-live', '/lab/data-table-live-frame'];
        const end = Date.now() + BUDGET_MS;
        let requests = 0;
        while (Date.now() < end) {
            const url = `${random.pick(pages)}?${queryString(random)}`;
            const replay = `SEED=${SEED}, request ${requests + 1}: GET ${url}`;
            const { response, ms } = await timed(() => page.request.get(url, { maxRedirects: 0 }));
            requests++;
            expect(response.status(), `${replay}: status`).toBeLessThan(500);
            expect(ms, `${replay}: answered in ${ms} ms`).toBeLessThanOrEqual(RESPONSE_BUDGET_MS);
            if (200 !== response.status()) {
                continue;
            }
            expect(await injected(page, await response.text()), `${replay}: injected markup`).toEqual([]);
            // in the browser too, one request in three: the page's scripts run on what the server rendered
            if (0 === requests % 3) {
                errors.length = 0;
                await page.goto(url);
                await page.waitForLoadState('networkidle');
                expect(await page.evaluate(() => (window as any).__fuzz ?? null), `${replay}: a script ran`).toBeNull();
                expect(await page.locator('fuzz-x, [data-fuzz]').count(), `${replay}: injected element`).toBe(0);
                expect(errors, `${replay}: console errors and CSP violations`).toEqual([]);
            }
        }
        console.log(`fuzz: ${requests} query strings, SEED=${SEED}`);
        expect(requests).toBeGreaterThan(0);
    });

    test('random values for the Live data table\'s writable props: no 5xx, nothing injected, no CSP violation', async ({ page }) => {
        // A value the server refuses (Live's 400 for a value it cannot set) is fine, a server error is not. The values go
        // from the test, not through the live controller in the page: it adds the page's bound fields to `updated`,
        // and in the demo's dev environment shows a refused request's error page in a modal, whose inline styles the
        // page's policy blocks.
        const random = generator(SEED + 1);
        const errors: string[] = [];
        page.on('console', (message) => 'error' === message.type() && errors.push(message.text()));
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto('/lab/data-table-live');
        const component = page.locator('[data-live-name-value="OrdersTable"]');
        await expect(component).toHaveCount(1);

        const send = async (updated: Record<string, unknown>) =>
            timed(async () =>
                page.request.post('/_components/OrdersTable', {
                    headers: { Accept: 'application/vnd.live-component+html', 'X-Requested-With': 'XMLHttpRequest' },
                    form: { data: JSON.stringify({ props: JSON.parse((await component.getAttribute('data-live-props-value')) ?? '{}'), updated, children: {}, propsFromParent: {} }) },
                    maxRedirects: 0,
                }),
            );
        // the request is the live controller's: a known update takes effect
        const known = await send({ filterValues: { status: 'paid' } });
        const status = await page.evaluate((html) => {
            const parsed = new DOMParser().parseFromString(html, 'text/html');
            return [...parsed.querySelectorAll('[role="status"]')].map((element) => element.textContent?.replace(/\s+/g, ' ').trim()).join(' | ');
        }, await known.response.text());
        expect(status, 'a crafted Live request applies its updated props').toContain('Showing 1–10 of 19');

        const props: [string, () => unknown][] = [
            ['search', () => random.pick([value(random), value(random), 42, null, ['x']])],
            ['filterValues', () => random.pick([{ status: value(random) }, { status: random.pick(['paid', 'pending', 'refunded']) }, { [value(random)]: value(random) }, value(random), [value(random)], null])],
            ['filterValues.status', () => random.pick([value(random), 'paid', null, 7])],
            ['sort', () => random.pick([value(random), 'customer', 'total', null, 3, ['customer']])],
            ['direction', () => random.pick([value(random), 'asc', 'desc', null, 1])],
            ['page', () => random.pick([random.int(10_000) - 10, Number(value(random)) || 0, 2 ** 31, value(random), null, 1.5])],
            ['pageSize', () => random.pick([10, 25, 50, 100, 0, -1, 7, value(random), null])],
            ['selectedIds', () => random.pick([[value(random)], Array.from({ length: random.int(50) }, () => value(random)), value(random), null, [['x']], [{ a: 1 }]])],
        ];

        const end = Date.now() + BUDGET_MS;
        let requests = 0;
        let accepted = 0;
        while (Date.now() < end) {
            const updated: Record<string, unknown> = {};
            for (let i = 0, count = 1 + random.int(3); i < count; i++) {
                const [name, make] = random.pick(props);
                updated[name] = make();
            }
            const replay = `SEED=${SEED}, Live request ${requests + 1}: updated ${JSON.stringify(updated).slice(0, 300)}`;
            const { response, ms } = await send(updated);
            requests++;
            expect(response.status(), `${replay}: status`).toBeLessThan(500);
            expect(ms, `${replay}: answered in ${ms} ms`).toBeLessThanOrEqual(RESPONSE_BUDGET_MS);
            if (200 !== response.status()) {
                continue;
            }
            expect(await injected(page, await response.text()), `${replay}: injected markup`).toEqual([]);

            // accepted: its HTML replaces the component in the page, as the live controller's morph would, under the
            // page's Content Security Policy (an inline style or handler it carried is a violation the guard reports)
            accepted++;
            errors.length = 0;
            await component.evaluate((element, html) => {
                element.outerHTML = html;
            }, await response.text());
            await expect(component).toHaveCount(1);
            expect(errors, `${replay}: console errors and CSP violations`).toEqual([]);
            expect(await page.evaluate(() => (window as any).__fuzz ?? null), `${replay}: a script ran`).toBeNull();
            expect(await page.locator('fuzz-x, [data-fuzz]').count(), `${replay}: injected element`).toBe(0);
        }
        console.log(`fuzz: ${requests} Live requests (${accepted} accepted and rendered in the page), SEED=${SEED}`);
        expect(requests).toBeGreaterThan(0);
    });

    test('random form posts on /forms and the lab forms: no 5xx, nothing injected, no CSP violation', async ({ page, allowHttpError }) => {
        const pages = ['/forms', '/lab/form-back/post', '/lab/editor-turbo', '/lab/markdown-turbo', '/lab/autocomplete', '/lab/value-matrix'];
        // a refused form answers 422 (its errors) or 400 (a malformed body): expected, a 5xx is not
        for (const status of [400, 422]) {
            allowHttpError(/\/(forms|lab\/[a-z\/-]+)(\?.*)?$/, status);
        }
        const random = generator(SEED + 2);
        const errors: string[] = [];
        page.on('console', (message) => 'error' === message.type() && !HTTP_STATUS_LOG.test(message.text()) && errors.push(message.text()));
        page.on('pageerror', (error) => errors.push(error.message));

        // a page fully loaded, its lazy modules too: leaving it earlier would cancel their requests
        const open = async (path: string) => {
            await page.goto(path);
            await page.waitForLoadState('networkidle');
            await controllersConnected(page);
        };
        type Form = { index: number; action: string; fields: { name: string; token: boolean; value: string }[] };
        const formsOf = new Map<string, Form[]>();
        const end = Date.now() + BUDGET_MS;
        let posts = 0;
        while (Date.now() < end) {
            const path = random.pick(pages);
            if (!formsOf.has(path)) {
                await open(path);
                formsOf.set(path, await page.evaluate(() =>
                    // attributes, not properties: a field named `action` or `method` shadows the form's own
                    [...document.forms].map((form, index) => ({ form, index })).filter(({ form }) => 'post' === (form.getAttribute('method') ?? '').toLowerCase()).map(({ form, index }) => ({
                        index,
                        action: new URL(form.getAttribute('action') || location.href, location.href).href,
                        fields: [...form.elements]
                            .filter((element): element is HTMLInputElement => 'name' in element && !!(element as HTMLInputElement).name && 'file' !== (element as HTMLInputElement).type)
                            .map((element) => ({ name: element.name, token: /_token\]?$|csrf/i.test(element.name), value: element.value })),
                    })),
                ));
            }
            const forms = formsOf.get(path)!;
            if (!forms.length) {
                continue;
            }
            const form = random.pick(forms);
            const data: Record<string, string> = {};
            for (const field of form.fields) {
                if (field.token) {
                    data[field.name] = field.value;
                    continue;
                }
                const base = field.name.replace(/\[\]$/, '');
                switch (random.int(8)) {
                    case 0: break; // left out
                    case 1: data[`${base}[]`] = value(random); break; // an array where a scalar is expected
                    case 2: data[`${base}[${random.pick(['x', '0', '_token'])}]`] = value(random); break;
                    default: data[field.name] = value(random);
                }
            }
            if (0 === random.int(4)) {
                data[random.pick(['extra', 'demo[extra]', '_method', 'demo'])] = value(random);
            }
            posts++;
            const replay = `SEED=${SEED}, post ${posts}: ${form.action} ${JSON.stringify(data).slice(0, 300)}`;
            const { response, ms } = await timed(() =>
                page.request.post(form.action, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    data: new URLSearchParams(data).toString(),
                    maxRedirects: 0,
                }),
            );
            expect(response.status(), `${replay}: status`).toBeLessThan(500);
            expect(ms, `${replay}: answered in ${ms} ms`).toBeLessThanOrEqual(RESPONSE_BUDGET_MS);
            // the app's own answers: a 2xx, a redirect, the form's errors (422). A 400 is Symfony's error page, whose
            // inline styles the page's policy reports even when only parsed (DOMParser): not the app's markup
            const rendered = [200, 302, 303, 422].includes(response.status());
            if (rendered && /html/.test(response.headers()['content-type'] ?? '')) {
                expect(await injected(page, await response.text()), `${replay}: injected markup`).toEqual([]);
            }

            // one post in three through the page's own form: its CSRF script runs, the browser renders the answer. Only
            // for an answer the app renders (a 2xx, a redirect, the form's 422): a 400 is the framework's error page
            if (0 === posts % 3 && rendered) {
                await open(path);
                errors.length = 0;
                // A body the controller cannot read (an array where it reads a string) is a 400, rendered by Symfony's
                // error page, whose inline styles the demo's policy blocks in the dev environment: not the app's markup.
                // The browser gets the status with an empty page instead; every other answer as the server sent it.
                const action = new URL(form.action);
                const submitted = (url: URL) => url.origin === action.origin && url.pathname === action.pathname;
                await page.route(submitted, async (route) => {
                    const answer = await route.fetch({ maxRedirects: 0 });
                    await (400 === answer.status()
                        ? route.fulfill({ status: 400, contentType: 'text/html', body: '<!doctype html><title>Bad Request</title>' })
                        : route.fulfill({ response: answer }));
                });
                const loaded = page.waitForEvent('load');
                await page.evaluate(({ index, data }) => {
                    const target = document.forms[index];
                    target.setAttribute('data-turbo', 'false');
                    target.setAttribute('novalidate', '');
                    for (const element of [...target.elements] as HTMLInputElement[]) {
                        if (element.name && !/_token\]?$|csrf/i.test(element.name)) {
                            element.removeAttribute('name');
                        }
                    }
                    for (const [name, value] of Object.entries(data)) {
                        if (!/_token\]?$|csrf/i.test(name)) {
                            const input = document.createElement('input');
                            Object.assign(input, { type: 'hidden', name, value });
                            target.append(input);
                        }
                    }
                    target.requestSubmit();
                }, { index: form.index, data });
                await loaded;
                await page.unroute(submitted);
                await page.waitForLoadState('networkidle');
                expect(await page.evaluate(() => (window as any).__fuzz ?? null), `${replay}: a script ran`).toBeNull();
                expect(await page.locator('fuzz-x, [data-fuzz]').count(), `${replay}: injected element`).toBe(0);
                expect(errors, `${replay}: console errors and CSP violations`).toEqual([]);
                formsOf.delete(path); // the page now holds a new CSRF field value
            }
        }
        console.log(`fuzz: ${posts} form posts, SEED=${SEED}`);
        expect(posts).toBeGreaterThan(0);
    });

    test('random clicks, keys, Back, Forward and theme switches on the lab pages: no error, one controller per element', async ({ page, allowHttpError }) => {
        test.setTimeout(BUDGET_MS * 3 + 60_000);
        const pages = [
            '/lab/dropdown-turbo', '/lab/modal-turbo', '/lab/drawer-turbo', '/lab/popover-turbo', '/lab/tooltip-turbo', '/lab/date-picker-turbo',
            '/lab/calendar-turbo', '/lab/editor-turbo', '/lab/markdown-turbo', '/lab/data-table-frame', '/lab/data-table-live', '/lab/autocomplete',
            '/lab/side-nav', '/lab/nav-menu', '/lab/section-nav', '/lab/mobile-nav', '/lab/turbo-nav', '/lab/chart-turbo', '/lab/live-table',
        ];
        // a form submitted empty by a random click is refused with its errors
        allowHttpError(/\/lab\//, 422);
        const random = generator(SEED + 3);
        const errors: string[] = [];
        page.on('console', (message) => 'error' === message.type() && !HTTP_STATUS_LOG.test(message.text()) && errors.push(message.text()));
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('popup', (popup) => void popup.close());
        const inFlight = new Set<object>();
        page.on('request', (request) => void inFlight.add(request));
        page.on('requestfinished', (request) => void inFlight.delete(request));
        page.on('requestfailed', (request) => void inFlight.delete(request));
        // nothing in flight, no visit or frame busy, then two frames: what the action started has landed
        const settle = async () => {
            for (let i = 0; i < 200 && inFlight.size; i++) {
                await page.waitForTimeout(50);
            }
            await page
                .waitForFunction(() => !document.documentElement.hasAttribute('aria-busy') && !document.querySelector('turbo-frame[busy]'), null, { timeout: 5_000 })
                .catch(() => undefined);
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))).catch(() => undefined);
        };
        // links that stay in the lab: a gallery page's preview frames would still be loading when the run leaves it
        const CLICKABLE = 'main :is(a[href^="/lab/"], a[href^="?"], a[href="#"], button, [role="tab"], [role="menuitem"], [role="option"], [role="treeitem"], summary, input[type="checkbox"], input[type="radio"], label)';
        const KEYS = ['Escape', 'Tab', 'Shift+Tab', 'Enter', 'Space', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'a'];

        const log: string[] = [];
        let scheme: 'light' | 'dark' = 'light';
        const end = Date.now() + BUDGET_MS;
        let steps = 0;
        while (Date.now() < end) {
            const url = new URL(page.url() === 'about:blank' ? 'http://x/' : page.url());
            if (!url.pathname.startsWith('/lab/') || 0 === random.int(40)) {
                const target = random.pick(pages);
                log.push(`goto ${target}`);
                await page.goto(target);
                await page.waitForLoadState('networkidle');
                await controllersConnected(page);
            }
            const kind = random.int(20);
            if (kind < 9) {
                const candidates = page.locator(CLICKABLE).filter({ visible: true });
                const count = await candidates.count();
                if (count) {
                    const index = random.int(count);
                    const label = await candidates.nth(index).evaluate((element) => `${element.localName} "${(element.textContent ?? '').trim().slice(0, 30)}"`).catch(() => '?');
                    log.push(`click ${label}`);
                    await candidates.nth(index).click({ timeout: 2_000 }).catch(() => undefined); // covered or gone: not a failure
                }
            } else if (kind < 14) {
                const key = random.pick(KEYS);
                log.push(`key ${key}`);
                await page.keyboard.press(key);
            } else if (kind < 16) {
                log.push('back');
                await page.goBack({ timeout: 10_000 }).catch(() => undefined);
            } else if (kind < 17) {
                log.push('forward');
                await page.goForward({ timeout: 10_000 }).catch(() => undefined);
            } else if (kind < 19) {
                log.push('theme toggle');
                await page.getByRole('button', { name: 'Toggle dark mode' }).first().click({ timeout: 2_000 }).catch(() => undefined);
            } else {
                scheme = 'light' === scheme ? 'dark' : 'light';
                log.push(`system ${scheme}`);
                await page.emulateMedia({ colorScheme: scheme });
            }
            await settle();
            steps++;
            const replay = `SEED=${SEED}, step ${steps} on ${page.url()}, last actions: ${log.slice(-8).join(' > ')}`;
            expect(errors, `${replay}: console and page errors`).toEqual([]);
            // one controller per element and identifier (a controller connected twice on one element shows here)
            const doubled = await page
                .evaluate(() => {
                    const seen = new Map<string, number>();
                    const ids = new WeakMap<Element, number>();
                    let next = 0;
                    for (const { identifier, element } of (window as any).Stimulus?.controllers ?? []) {
                        const id = ids.get(element) ?? (ids.set(element, ++next), next);
                        const key = `${identifier}#${id}`;
                        seen.set(key, (seen.get(key) ?? 0) + 1);
                    }
                    return [...seen].filter(([, count]) => count > 1).map(([key, count]) => `${key} ×${count}`);
                })
                .catch(() => []);
            expect(doubled, `${replay}: controllers connected more than once on one element`).toEqual([]);
        }
        // and every identifier on the page settled to one controller per element that declares it: each declared one
        // connected (an element whose controller never connects counts 0 controllers on 1 element), none twice
        await controllersConnected(page);
        const identifiers = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-controller]')].flatMap((element) => element.getAttribute('data-controller')!.split(/\s+/)))]);
        for (const identifier of identifiers.filter((id) => id && 'csrf-protection' !== id)) {
            const { controllers, elements, distinctElements } = await stimulusControllers(page, identifier);
            expect({ controllers, distinctElements }, `SEED=${SEED}: ${identifier}: one controller per element declaring it`).toEqual({ controllers: elements, distinctElements: elements });
        }
        console.log(`fuzz: ${steps} UI steps, SEED=${SEED}`);
        expect(steps).toBeGreaterThan(0);
    });
});
