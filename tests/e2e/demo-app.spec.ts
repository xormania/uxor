import type { Page } from '@playwright/test';
import { test, expect, expectA11y, controllersConnected, turboVisitDone, markDocument, stubPreviewFrames, type CancelledRequest } from './fixtures';
import { observeTurbo, turboOperation } from './transitions';
import { demoRoutePaths, previewUrl, recipes } from './inventory';

/**
 * Call before the step that opens a signed-in page; returns a wait for that page's avatar, a 190 KB GIF in the
 * stylesheet, to have arrived. Leaving the page before then cancels it, which the page guard reports: WebKit cancels it
 * before the next document is requested, and only that next document asks for it again.
 */
function avatarArrival(page: Page): () => Promise<void> {
    const avatar = page.waitForResponse((response) => /\/assets\/images\/xor\/mascot-[^/]+\.gif$/.test(response.url()));
    return async () => {
        await (await avatar).finished();
    };
}

test('the login block signs in through form_login and shows the authentication error', async ({ page }) => {
    await page.goto('/demo/login');
    await page.getByRole('textbox', { name: 'Email' }).fill('demo@example.com');
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid credentials.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue('demo@example.com');

    await page.getByLabel('Password').fill('demo');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

test('the signup block shows server-side errors, then a flash toast after the redirect', async ({ page, allowHttpError }) => {
    allowHttpError(/\/demo\/signup$/, 422);
    await page.goto('/demo/signup');
    // skip the browser's own validation to reach the server's
    await page.locator('form[name="registration"]').evaluate((form: HTMLFormElement) => (form.noValidate = true));
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');

    await page.getByRole('textbox', { name: 'Name' }).fill('Ada Lovelace');
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.com');
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('checkbox', { name: 'I accept the terms' }).check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Welcome aboard!')).toBeVisible();
});

test('the forgot-password block confirms without telling whether the account exists', async ({ page }) => {
    await page.goto('/demo/forgot-password');
    await page.getByRole('textbox', { name: 'Email' }).fill('nobody@example.com');
    await page.getByRole('button', { name: 'Send the reset link' }).click();
    await expect(page.getByText('If an account exists for that email address')).toBeVisible();
});

test('the settings layout marks the current section and the profile block saves', async ({ page }) => {
    await page.goto('/demo/settings/profile');
    await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('treeitem', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('treeitem', { name: 'Settings' })).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Profile saved.')).toBeVisible();
});

// EventSource.close() on a terminal message can finish the GET as cancelled in Chromium and WebKit.
function closedRevenueStream(page: Page, prompt: string): CancelledRequest {
    const url = new URL('/demo/revenue-assistant', page.url());
    url.searchParams.set('prompt', prompt);
    return { url: url.href, method: 'GET', accept: 'text/event-stream', count: 1 };
}

test('a revenue request can be retried and opens its chart and data table through Turbo', async ({ page, allowCancelledRequest }) => {
    await page.goto('/demo/revenue-assistant');
    await controllersConnected(page);
    const sameDocument = await markDocument(page);
    const prompt = page.getByRole('textbox', { name: 'Revenue request' });
    const submit = page.getByRole('button', { name: 'Show revenue' });
    allowCancelledRequest(closedRevenueStream(page, 'Show monthly revenue'));
    await prompt.fill('Show monthly revenue');
    await submit.click();
    await expect(page.locator('form').getByRole('status')).toContainText('Choose weekly, yearly or all-time revenue');
    await expect(page).toHaveURL(/\/demo\/revenue-assistant$/);

    allowCancelledRequest(closedRevenueStream(page, 'Show weekly revenue'));
    await prompt.fill('Show weekly revenue');
    await turboOperation(page, { url: '/demo?revenue=week' }, () => submit.click());
    await sameDocument.expectKept();
    await expect(page.getByRole('tab', { name: 'This week', selected: true })).toBeVisible();
    const panel = page.getByRole('tabpanel', { name: 'This week' });
    await expect(panel.getByRole('img', { name: 'Revenue this week' })).toBeVisible();
    await panel.getByText('Show the data as a table').click();
    const table = panel.getByRole('table', { name: 'Revenue this week' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveText(['Day', 'Revenue ($)']);
    await expect(table.getByRole('rowheader')).toHaveText(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
});

for (const [failure, ending] of [
    ['malformed JSON', 'data: {\n\n'],
    ['an interrupted stream', ''],
    ['a different run finishing', 'data: {"type":"RUN_FINISHED","threadId":"revenue","runId":"other"}\n\n'],
]) {
    test(`a revenue request stays on the form after ${failure}`, async ({ page, allowCancelledRequest }) => {
        await page.goto('/demo/revenue-assistant');
        await controllersConnected(page);
        await page.route('**/demo/revenue-assistant?*', (route) => route.fulfill({
            contentType: 'text/event-stream',
            body: 'data: {"type":"RUN_STARTED","threadId":"revenue","runId":"trial"}\n\n'
                + 'data: {"type":"STATE_SNAPSHOT","snapshot":{"revenuePeriod":"week"}}\n\n'
                + ending,
        }));
        allowCancelledRequest(closedRevenueStream(page, 'Show weekly revenue'));
        await page.getByRole('textbox', { name: 'Revenue request' }).fill('Show weekly revenue');
        await page.getByRole('button', { name: 'Show revenue' }).click();
        await expect(page.locator('form').getByRole('status')).toHaveText('The revenue request did not finish. Try again.');
        await expect(page).toHaveURL(/\/demo\/revenue-assistant$/);
    });
}

test('leaving a pending revenue request closes its stream and Back restores a form that can retry', async ({ page }) => {
    await page.addInitScript(() => {
        // Hold the stream open until the controller closes it. No server delay or reconnect is needed.
        const streams: { closed: boolean }[] = [];
        Object.assign(window, {
            revenueStreams: streams,
            EventSource: class {
                private state = { closed: false };
                constructor() {
                    streams.push(this.state);
                }
                close() {
                    this.state.closed = true;
                }
            },
        });
    });
    const streamStates = () => page.evaluate(() => (
        window as Window & { revenueStreams: { closed: boolean }[] }
    ).revenueStreams.map(({ closed }) => closed));

    await page.goto('/demo/revenue-assistant');
    await controllersConnected(page);
    const sameDocument = await markDocument(page);
    const prompt = page.getByRole('textbox', { name: 'Revenue request' });
    const submit = page.getByRole('button', { name: 'Show revenue' });
    const status = page.locator('form').getByRole('status');
    await prompt.fill('Show weekly revenue');
    await submit.click();
    await expect(status).toHaveText('Looking up revenue…');
    expect(await streamStates()).toEqual([false]);

    const dashboard = page.getByRole('navigation', { name: 'Main' }).getByRole('treeitem', { name: 'Dashboard' });
    await turboOperation(page, { url: '/demo' }, () => dashboard.press('Enter'));
    expect(await streamStates()).toEqual([true]);
    await turboOperation(page, { url: '/demo/revenue-assistant' }, () => page.goBack());
    await sameDocument.expectKept();
    await controllersConnected(page);
    await expect(status).toHaveText('');

    await prompt.fill('Show yearly revenue');
    await submit.click();
    await expect(status).toHaveText('Looking up revenue…');
    expect(await streamStates()).toEqual([true, false]);
});

test('the dashboard defers autocomplete until a Turbo visit adds a field', async ({ page }) => {
    const vendorRequests: string[] = [];
    page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        // Modulepreload and runtime imports both reach this listener.
        if (/^\/assets\/(?:@symfony\/ux-autocomplete|vendor\/(?:tom-select|@orchidjs))\//.test(path)) {
            vendorRequests.push(path);
        }
    });
    await page.goto('/demo');
    await controllersConnected(page);
    expect(vendorRequests, 'autocomplete assets requested on the dashboard').toEqual([]);
    await expect(page.locator('link[rel=stylesheet][href*="/ux-live-component/"]')).toHaveCount(0);

    await page.goto('/lab');
    await controllersConnected(page);
    expect(vendorRequests, 'unused vendor assets requested before opening a scenario').toEqual([]);
    const sameDocument = await markDocument(page);
    await turboOperation(page, { url: '/lab/live-autocomplete' }, () => page.getByRole('link', { name: 'live-autocomplete', exact: true }).click());
    await sameDocument.expectKept();
    await controllersConnected(page);
    const country = page.locator('#autocomplete_demo_country + .ts-wrapper');
    await country.locator('.ts-control').click();
    await expect(country.getByRole('combobox', { name: 'Country' })).toHaveAttribute('aria-expanded', 'true');
    await country.getByRole('combobox', { name: 'Country' }).press('Escape');
    await page.getByRole('button', { name: 'Re-render' }).click();
    await expect(page.getByTestId('renders')).toHaveText('1');
});

test('on a desktop the app layout hides the menu button, and its pages use no id twice', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const path of ['/demo', '/demo/settings/profile']) {
        await page.goto(path);
        await expect(page.locator('#sidebar')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();
        const duplicates = await page.evaluate(() => {
            const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
            return ids.filter((id, index) => ids.indexOf(id) !== index);
        });
        expect(duplicates, path).toEqual([]);
    }
});

test('on a desktop the navbar menu marks the current page, opens its submenus and visits their links', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/demo/settings/profile');
    const menu = page.getByRole('navigation', { name: 'Site' });
    const account = menu.getByRole('button', { name: 'Account' });
    await expect(account).toHaveAttribute('aria-expanded', 'false');
    await expect(account).toHaveCSS('font-weight', '600'); // it holds the current page
    await account.click();
    await expect(account).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    await menu.getByRole('button', { name: 'Sign-in pages' }).click();
    await menu.getByRole('link', { name: 'Sign up' }).click();
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();

    await page.goto('/demo');
    await menu.getByRole('button', { name: 'Showcase' }).click();
    await menu.getByRole('button', { name: 'Lab' }).click();
    await menu.getByRole('link', { name: 'Navbar menus' }).click();
    await expect(page).toHaveURL(/\/lab\/nav-menu$/);
});

// the drawer's own behavior (Escape, the backdrop, the focus given back, a link closing it, Back): lab.mobile-nav
test('on a phone the drawer holds the sidebar navigation, then the navbar menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo/settings/profile');
    await expect(page.locator('#sidebar')).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Site' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Main' });
    // the sidebar's navigation, the same tree and brand, focused on the current page
    await expect(drawer.getByRole('link', { name: 'xor' })).toBeVisible();
    const nav = drawer.getByRole('navigation', { name: 'Main' }).getByRole('tree', { name: 'xor' });
    await expect(nav.getByRole('treeitem', { name: 'Profile' })).toBeFocused();
    await expect(nav.getByRole('treeitem', { name: 'Settings' })).toHaveAttribute('aria-expanded', 'true');
    const account = drawer.getByRole('button', { name: 'Account' });
    await account.click();
    await expect(account).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    await drawer.getByRole('button', { name: 'Showcase' }).click();
    await expect(account).toHaveAttribute('aria-expanded', 'false');
    await drawer.getByRole('link', { name: 'Recipes' }).click();
    await expect(page).toHaveURL(/\/$/);
});

test('the not-found block answers 404 and passes axe', async ({ page, allowHttpError }) => {
    allowHttpError(/\/demo\/not-found$/, 404);
    const response = await page.goto('/demo/not-found');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expectA11y(page, { impact: 'serious' });
});

test('the app layout scrolls the document, so the keyboard scrolls it and Turbo restores it on Back', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto('/demo');
    await page.keyboard.press('PageDown');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect(page.locator('#sidebar')).toBeInViewport();

    // Chromium animates the keyboard scroll: let it stop, so it does not move the position set next
    await page.evaluate(() => new Promise<void>((resolve) => {
        let last = -1;
        const check = () => (window.scrollY === last ? resolve() : ((last = window.scrollY), setTimeout(check, 100)));
        check();
    }));
    await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
    const main = page.getByRole('navigation', { name: 'Main' });
    await main.getByRole('treeitem', { name: 'Settings' }).locator(':scope > [data-side-nav-toggle]').click();
    await main.getByRole('treeitem', { name: 'Profile' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    // the visit's scroll to the top is delivered with the next frame: WebKit can dispatch its scroll event after a Back
    // sent at once, and Turbo then records it as the restored page's position (0)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.goBack();
    await turboVisitDone(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
});

test('the dashboard passes axe at phone width, its channel bars are meters', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo');
    await expect(page.getByRole('meter', { name: 'Online store' })).toHaveAttribute('aria-valuenow', '64');
    await expect(page.getByRole('region', { name: 'Recent orders' })).toHaveAttribute('tabindex', '0');
    await expectA11y(page, { impact: 'serious' });
});

test('flash messages show on every layout: the logout notice on the auth layout, not later on the dashboard', async ({ page }) => {
    await page.goto('/demo/login');
    await page.getByRole('textbox', { name: 'Email' }).fill('demo@example.com');
    await page.getByLabel('Password').fill('demo');
    const avatarArrived = avatarArrival(page);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await avatarArrived();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/demo\/login$/);
    await expect(page.getByRole('region', { name: 'Notifications' }).getByText('You are signed out.')).toBeVisible();
    // the login form's csrf-protection controller is lazy: leaving before its module arrived cancels the request (a
    // failed request, and the loader's console error in Firefox), so the next visit waits for the page to have loaded it
    await expect
        .poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((entry) => entry.name.includes('/csrf_protection_controller-'))))
        .toBe(true);

    await page.goto('/demo');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('You are signed out.')).toHaveCount(0);
});

test('every layout keeps the same toast region: a toast closed on another layout does not come back on Back', async ({ page }) => {
    await page.goto('/demo/settings/profile');
    await page.getByRole('button', { name: 'Save changes' }).click();
    const region = page.getByRole('region', { name: 'Notifications' });
    await expect(region.getByText('Profile saved.')).toBeVisible();

    // the toast dismisses itself 5 s after it appears, and a slow visit used that up before the check below (WebKit in
    // CI): hovered, it is paused, so the keyboard opens the branch and follows the link while the pointer stays on it.
    // The visit moves the region, so the toast connects again on the blank page and counts down its time left from there
    await region.locator('[data-controller="toast"]', { hasText: 'Profile saved.' }).hover();
    const main = page.getByRole('navigation', { name: 'Main' });
    const pages = main.getByRole('treeitem', { name: 'Pages' });
    await pages.press('Enter');
    await expect(pages).toHaveAttribute('aria-expanded', 'true');
    await main.getByRole('treeitem', { name: 'Blank page' }).press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'A blank page' })).toBeVisible();
    await expect(region.getByText('Profile saved.')).toBeVisible();
    await region.getByRole('button', { name: 'Close' }).click();
    await expect(region.getByText('Profile saved.')).toHaveCount(0);

    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Profile saved.')).toHaveCount(0);
});

test('signing out requires POST: a direct GET to the logout URL does not sign the user out', async ({ page, allowHttpError }) => {
    allowHttpError(/\/demo\/logout$/, 405);
    await page.goto('/demo/login');
    const avatarArrived = avatarArrival(page);
    await page.getByRole('textbox', { name: 'Email' }).fill('demo@example.com');
    await page.getByLabel('Password').fill('demo');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await avatarArrived();

    // A typed URL is always GET. The route rejects it before the firewall can consider a logout request.
    const response = await page.goto('/demo/logout');
    expect(response?.status()).toBe(405);
    await page.goto('/demo');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

type MainWithEntrance = HTMLElement & { observedEntrance?: string[] };

async function observePageEntrance(page: Page) {
    await page.addInitScript(() => {
        document.addEventListener('transitionrun', ({ target, propertyName }) => {
            if (!(target instanceof HTMLElement) || !['opacity', 'translate'].includes(propertyName)) return;
            if (target.matches('main')) {
                // A property on the element keeps Turbo's cached clone from inheriting an earlier event.
                ((target as MainWithEntrance).observedEntrance ??= []).push(propertyName);
            } else if (target.matches('html, body, #sidebar, header[data-controller~="navbar"]')) {
                document.documentElement.dataset.shellTransition = propertyName;
            }
        });
    });
}

async function expectPageEntrance(page: Page, properties: string[]) {
    const main = page.locator('main');
    // Give a newly inserted main a render opportunity before checking that no transition started.
    await main.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(() => main.evaluate((el: MainWithEntrance) => (el.observedEntrance ?? []).slice().sort())).toEqual(properties);
    await expect(main).toHaveCSS('pointer-events', 'auto');
    await expect(page.locator('html')).not.toHaveAttribute('data-shell-transition');
}

for (const motion of ['no-preference', 'reduce'] as const) {
    test(`dashboard and settings enter on load, a forward visit and Back with ${motion} motion`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: motion });
        await observePageEntrance(page);
        await page.goto('/demo');
        const onArrival = motion === 'reduce' ? [] : ['opacity', 'translate'];
        await expectPageEntrance(page, onArrival);

        const sameDocument = await markDocument(page);
        const site = page.getByRole('navigation', { name: 'Site' });
        await site.getByRole('button', { name: 'Account' }).click();
        await turboOperation(page, { url: '/demo/settings/profile' }, () => site.getByRole('link', { name: 'Profile' }).click());
        await expectPageEntrance(page, onArrival);

        await turboOperation(page, { url: '/demo' }, () => page.goBack());
        await expectPageEntrance(page, motion === 'reduce' ? [] : ['opacity']);
        await sameDocument.expectKept();
    });
}

test('a cached settings preview stays still and the fresh response enters', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await observePageEntrance(page);
    await page.goto('/demo/settings/profile');
    await expectPageEntrance(page, ['opacity', 'translate']);
    const settings = page.getByRole('navigation', { name: 'Settings' });
    await turboOperation(page, { url: '/demo/settings/notifications' }, () => settings.getByRole('link', { name: 'Notifications' }).press('Enter'));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/demo/settings/profile', async (route) => {
        await gate;
        await route.continue();
    }, { times: 1 });

    const loaded = await observeTurbo(page, { url: '/demo/settings/profile' });
    try {
        await settings.getByRole('link', { name: 'Profile' }).press('Enter');
        await expect(page.locator('html')).toHaveAttribute('data-turbo-preview');
        await expectPageEntrance(page, []);
    } finally {
        release();
    }
    await loaded.done();
    await expectPageEntrance(page, ['opacity', 'translate']);
});

// The layouts mark the importmap `data-turbo-track="reload"` (UX Turbo's bundle sets the same default; the layout's
// value wins): Turbo loads a page in full when its tracked elements differ from the current page's, so a page from a
// new deploy never runs beside the old scripts
test('a page whose tracked importmap changed between two visits, as after a deploy, is loaded in full', async ({ page }) => {
    await page.goto('/demo/settings/profile');
    const settings = page.getByRole('navigation', { name: 'Settings' });
    const sameDocument = await markDocument(page);

    // the same assets: Turbo renders the next page in the same document
    await turboOperation(page, { url: '/demo/settings/notifications' }, () => settings.getByRole('link', { name: 'Notifications' }).click());
    await sameDocument.expectKept();

    // the billing page names another URL for the app's entrypoint (a new digest after a deploy), a URL that loads
    await page.route('**/demo/settings/billing', async (route) => {
        // uncompressed: Firefox accepts zstd, which Playwright does not decode
        const response = await route.fetch({ headers: { ...route.request().headers(), 'accept-encoding': 'identity' } });
        const body = (await response.text()).replace(/("app": "[^"?]+)"/, '$1?deploy=2"');
        await route.fulfill({ response, body });
    });
    await settings.getByRole('link', { name: 'Billing' }).click();

    await expect(page).toHaveURL(/\/demo\/settings\/billing$/);
    await sameDocument.expectReplaced();
    // the new document, as it parses, carries the new importmap
    await expect.poll(() => page.evaluate(() => document.querySelector('script[type="importmap"]')?.textContent ?? '')).toContain('?deploy=2');
    await expect(settings.getByRole('link', { name: 'Billing' })).toHaveAttribute('aria-current', 'page');
    await turboVisitDone(page);
});

// a phone shows no horizontal scroll on the gallery's pages: a code block scrolls inside its box instead of widening the page
for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`${colorScheme} theme at phone width`, () => {
        test.use({ viewport: { width: 390, height: 844 }, colorScheme });

        for (const path of ['/', '/r/button', '/r/data-table', '/demo', '/demo/login', '/demo/settings/profile']) {
            test(`${path} does not scroll sideways`, async ({ page }) => {
                await page.goto(path);
                await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
                const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
                expect(widths.scroll).toBeLessThanOrEqual(widths.client);
            });
        }
    });
}

// the narrowest phone: every page of the gallery and of the demo fits, its heading wraps instead of overflowing, and a
// recipe's description shows its Markdown rendered, not as source
test.describe('at 320px', () => {
    test.use({ viewport: { width: 320, height: 640 } });

    for (const path of ['/', '/install', '/guide', ...recipes.map((recipe) => `/r/${recipe}`), ...demoRoutePaths]) {
        test(`${path} does not scroll sideways and shows no Markdown source`, async ({ page, allowHttpError, browserName }) => {
            allowHttpError(/\/demo\/not-found$/, 404); // the error page answers 404 on purpose
            if (path.startsWith('/r/') && 'chromium' === browserName) {
                // the embedded previews cannot widen the page and their text is theirs; in Firefox and WebKit they load,
                // since no other test there loads the dark ones
                await stubPreviewFrames(page);
            }
            await page.goto(path);
            const heading = page.getByRole('heading', { level: 1 }).first();
            await expect(heading).toBeVisible();
            const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
            expect(widths.scroll).toBeLessThanOrEqual(widths.client);
            const box = await heading.evaluate((element) => ({ right: element.getBoundingClientRect().right, scroll: element.scrollWidth, client: element.clientWidth }));
            expect(box.right, 'the heading ends inside the page').toBeLessThanOrEqual(widths.client);
            expect(box.scroll, 'the heading wraps its text').toBeLessThanOrEqual(box.client);
            // the page's text without its code: a recipe page shows the README's code blocks and inline code,
            // where backticks are what the code says (a Markdown example, a template literal)
            const text = await page.evaluate(() => {
                let rest = document.body.innerText;
                for (const code of document.querySelectorAll('pre, :not(pre) > code')) {
                    rest = rest.replace((code as HTMLElement).innerText, '');
                }
                return rest;
            });
            expect(text).not.toMatch(/\]\(https?:/);
            expect(text).not.toMatch(/`[^`\n]+`/);
            if (path.startsWith('/r/')) {
                // a recipe's name is one word as long as the recipe wants (ForgotPasswordForm): one wider than any
                // font makes it still breaks inside the page
                await heading.evaluate((element) => (element.textContent = 'ForgotPasswordForm'.repeat(3)));
                const wide = await heading.evaluate((element) => ({ right: element.getBoundingClientRect().right, page: document.documentElement.scrollWidth }));
                expect(wide.right, 'a long name breaks inside the page').toBeLessThanOrEqual(widths.client);
                expect(wide.page, 'a long name does not widen the page').toBeLessThanOrEqual(widths.client);
            }
        });
    }
});

test('every page of the gallery and of the demo names an icon, so a browser asks for no /favicon.ico', async ({ page }) => {
    // the markup is what matters, so each page is fetched rather than visited: a visit from page to page cancels the
    // last page's late requests (lazy controllers, their imports), which the page guard counts as failed
    for (const path of ['/', '/r/button', previewUrl('button', 'default'), ...demoRoutePaths]) {
        const response = await page.request.get(path);
        expect(response.status(), path).toBe(path.endsWith('/demo/not-found') ? 404 : 200); // the error page answers 404 on purpose
        const head = (await response.text()).match(/<head[\s\S]*?<\/head>/i)?.[0] ?? '';
        expect(head.match(/<link\b[^>]*\brel=["'][^"']*\bicon\b/gi) ?? [], path).toHaveLength(1);
    }
});

test("the gallery's header keeps one row on a phone, its GitHub link named", async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    const row = (await nav.boundingBox())!.height;
    for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await expect.poll(async () => (await nav.boundingBox())!.height, `${width}px`).toBe(row);
        await expect(nav.getByRole('link', { name: 'GitHub' })).toBeVisible();
        const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
        expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    }
});

test("the hero's two secondary links share one style", async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('.xor-hero');
    const install = await hero.getByRole('link', { name: 'Install' }).getAttribute('class');
    expect(await hero.getByRole('link', { name: 'Open the demo app' }).getAttribute('class')).toBe(install);
});
