import type { Page } from '@playwright/test';
import { test, expect, expectA11y, stimulusControllers, turboVisitDone, markDocument } from './fixtures';
import { viewports } from './inventory';

/*
 * /lab/section-nav/<section>: a SectionNav rendered by every page (marked by the server), one inside a
 * data-turbo-permanent element (marked by its controller from the URL), and vertical Tabs that switch panels in
 * place. The state checked after each transition (a click, a key, a Turbo visit, Back, Forward, a reload) is the
 * whole state: the current section of both navigations, the selected tab, the tab list's one Tab stop and the panel
 * shown.
 */

const sections = ['Profile', 'Account', 'Notifications', 'Billing', 'Security', 'Integrations'] as const;
const nav = (page: Page) => page.getByRole('navigation', { name: 'Account settings' });
const permanent = (page: Page) => page.getByRole('navigation', { name: 'Permanent sections' });
const tablist = (page: Page) => page.getByRole('tablist', { name: 'Preferences' });
const tab = (page: Page, name: string) => tablist(page).getByRole('tab', { name, exact: true });

/** The whole state: each navigation's current links, the selected tabs, the Tab stops, the panels shown. */
async function state(page: Page) {
    return page.evaluate(() => {
        const current = (label: string) =>
            [...document.querySelectorAll(`nav[aria-label="${label}"] a`)].filter((link) => 'page' === link.getAttribute('aria-current')).map((link) => link.textContent!.trim());
        const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
        return {
            current: current('Account settings'),
            permanent: current('Permanent sections'),
            selected: tabs.filter((element) => 'true' === element.getAttribute('aria-selected')).map((element) => element.textContent!.trim()),
            tabStops: tabs.filter((element) => '0' === element.getAttribute('tabindex')).map((element) => element.textContent!.trim()),
            panels: [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter((panel) => panel.getClientRects().length > 0).map((panel) => panel.id),
        };
    });
}

async function expectState(page: Page, section: string, selected: string) {
    await expect
        .poll(() => state(page))
        .toEqual({ current: [section], permanent: [section], selected: [selected], tabStops: [selected], panels: [`lab-tab-${selected.toLowerCase()}-description`] });
    await expect(page.getByRole('tabpanel', { name: selected })).toBeVisible();
}

async function visit(page: Page, link: string, heading: string) {
    await page.getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByTestId('page')).toHaveText(heading);
    await turboVisitDone(page);
}

for (const [viewportName, viewport] of Object.entries(viewports)) {
    test.describe(viewportName, () => {
        test.use({ viewport });

        test('the section nav is a landmark of links, the tabs a vertical tab list, each in its server state', async ({ page }) => {
            await page.goto('/lab/section-nav/billing');
            await expectState(page, 'Billing', 'General');
            await expect(nav(page).getByRole('link')).toHaveText([...sections]);
            await expect(nav(page).getByRole('link', { name: 'Billing' })).toHaveAttribute('aria-current', 'page');
            // links, never tabs: no tab role, no roving tabindex in the navigations
            await expect(page.getByRole('navigation').getByRole('tab')).toHaveCount(0);
            await expect(page.locator('nav a[tabindex]')).toHaveCount(0);
            await expect(tablist(page)).toHaveAttribute('aria-orientation', 'vertical');
            await expect(tab(page, 'General')).toHaveAttribute('aria-controls', 'lab-tab-general-description');
            await expect(page.getByRole('tabpanel', { name: 'General' })).toHaveAttribute('aria-labelledby', 'lab-tab-general');
            await expect(tab(page, 'Archived')).toBeDisabled();

            // the server marked the current section and the selected tab: the page's HTML, before any controller
            const html = await (await page.request.get('/lab/section-nav/billing')).text();
            expect(html).toMatch(/aria-current="page"[^>]*>Billing</);
            expect(html).toMatch(/role="tablist"\s+aria-orientation="vertical"/);
            // the permanent navigation is marked from the URL only
            expect(html.match(/aria-current="page"/g)).toHaveLength(1);

            // no horizontal scroll of the page, whatever the width
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        });

        test('Turbo visits, Back, Forward and a reload show the section and the tab of the page shown', async ({ page }) => {
            await page.goto('/lab/section-nav');
            const sameDocument = await markDocument(page);
            await expectState(page, 'Profile', 'General');

            await tab(page, 'Privacy').click();
            await expectState(page, 'Profile', 'Privacy');

            // a section is a page: a visit, with its own default tab
            await nav(page).getByRole('link', { name: 'Security' }).click();
            await expect(page.getByTestId('page')).toHaveText('Section security');
            await turboVisitDone(page);
            await expect(page).toHaveURL(/\/lab\/section-nav\/security$/);
            await expectState(page, 'Security', 'General');
            await tab(page, 'Advanced').click();
            await expectState(page, 'Security', 'Advanced');

            // Back: the copy Turbo cached, with the tab selected when the page was left
            await page.goBack();
            await expect(page.getByTestId('page')).toHaveText('Section profile');
            await turboVisitDone(page);
            await expectState(page, 'Profile', 'Privacy');

            await page.goForward();
            await expect(page.getByTestId('page')).toHaveText('Section security');
            await turboVisitDone(page);
            await expectState(page, 'Security', 'Advanced');

            // the permanent navigation went along: the same element, following the URL
            await page.evaluate(() => ((window as any).__permanent = document.getElementById('lab-permanent-section-nav')));
            await permanent(page).getByRole('link', { name: 'Notifications' }).click();
            await expect(page.getByTestId('page')).toHaveText('Section notifications');
            await turboVisitDone(page);
            await expectState(page, 'Notifications', 'General');
            expect(await page.evaluate(() => (window as any).__permanent === document.getElementById('lab-permanent-section-nav'))).toBe(true);
            await sameDocument.expectKept();

            // a reload starts from the server's default tab
            await tab(page, 'Advanced').click();
            await page.reload();
            await expectState(page, 'Notifications', 'General');
        });

        test('a link to a fragment of the page is never the current section', async ({ page }) => {
            await page.goto('/lab/section-nav/account');
            await permanent(page).getByRole('link', { name: 'Fragment' }).click();
            await expect(page).toHaveURL(/\/lab\/section-nav\/account#lab-tab-general$/);
            await page.reload();
            await expectState(page, 'Account', 'General');
            await expect(permanent(page).getByRole('link', { name: 'Fragment' })).not.toHaveAttribute('aria-current');
        });

        test('repeated Turbo visits leave one controller per navigation and tab list', async ({ page }) => {
            await page.goto('/lab/section-nav');
            for (const [link, heading] of [['Go to account', 'Section account'], ['Go to billing', 'Section billing'], ['Go to profile', 'Section profile'], ['Go to integrations', 'Section integrations'], ['Go to profile', 'Section profile']]) {
                await visit(page, link, heading);
            }
            await page.goBack();
            await expect(page.getByTestId('page')).toHaveText('Section integrations');
            await turboVisitDone(page);
            expect(await stimulusControllers(page, 'section-nav')).toEqual({ controllers: 2, elements: 2, distinctElements: 2 });
            expect(await stimulusControllers(page, 'tabs')).toEqual({ controllers: 1, elements: 1, distinctElements: 1 });
            // one step per key
            await tab(page, 'General').focus();
            await page.keyboard.press('ArrowDown');
            await expect(tab(page, 'Privacy')).toBeFocused();
            await expectState(page, 'Integrations', 'Privacy');
        });
    });
}

test('the vertical tabs follow the keyboard of the tabs pattern: Up, Down, Home, End, a roving Tab stop', async ({ page }) => {
    await page.goto('/lab/section-nav/account');
    await page.getByTestId('page').click();
    // Tab goes through the page's links, then to the selected tab only, then into its panel
    await page.keyboard.press('Tab');
    for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
    }
    await expect(tab(page, 'General')).toBeFocused();

    const press = async (key: string, selected: string) => {
        await page.keyboard.press(key);
        await expect(tab(page, selected)).toBeFocused();
        await expectState(page, 'Account', selected);
    };
    await press('ArrowDown', 'Privacy');
    await press('ArrowDown', 'Advanced'); // the disabled tab is skipped
    await press('ArrowDown', 'General'); // wraps around
    await press('ArrowUp', 'Advanced');
    await press('ArrowRight', 'Advanced'); // the horizontal keys do nothing in a vertical list
    await press('ArrowLeft', 'Advanced');
    await press('Home', 'General');
    await press('End', 'Advanced');
    expect(await page.evaluate(() => window.scrollX)).toBe(0);

    // Tab moves on to the panel (a Tab stop of its own, as the pattern's panels are), then into it
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tabpanel', { name: 'Advanced' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tabpanel', { name: 'Advanced' }).getByRole('link')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(tab(page, 'Advanced')).toBeFocused();

    // a tab disabled in place (a Live morph) hands the Tab stop on to an enabled tab
    await tab(page, 'General').click();
    await tab(page, 'General').evaluate((trigger) => trigger.setAttribute('disabled', ''));
    await expect(tablist(page).locator('[role="tab"][tabindex="0"]')).toHaveText(['Privacy']);
    // and the selection with it: the Tab stop is the selected tab, its panel shown
    await expect(tab(page, 'Privacy')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Privacy' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'General' })).toBeHidden();
});

test('a selected tab already disabled when the controller connects hands the selection on', async ({ page }) => {
    await page.goto('/preview/tabs/default?theme=light');
    const list = page.locator('[data-controller="tabs"]').first();
    const handle = await list.elementHandle();
    await expect(page.getByRole('tab', { name: 'Profile', exact: true })).toHaveAttribute('aria-selected', 'true');
    // disabled while no controller watches (rendered so), then connected
    await handle!.evaluate((element) => element.removeAttribute('data-controller'));
    await expect(page.locator('[role="tab"][tabindex]')).toHaveCount(0); // disconnected
    await handle!.evaluate((element) => element.querySelector('[role="tab"]')!.setAttribute('disabled', ''));
    await handle!.evaluate((element) => element.setAttribute('data-controller', 'tabs'));
    const dashboard = page.getByRole('tab', { name: 'Dashboard', exact: true });
    await expect(dashboard).toHaveAttribute('aria-selected', 'true');
    await expect(dashboard).toHaveAttribute('tabindex', '0');
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
});

test('a panel with no focusable content is a Tab stop after its tab', async ({ page }) => {
    await page.goto('/preview/tabs/default?theme=light');
    await page.getByRole('tab', { name: 'Profile', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tabpanel', { name: 'Profile' })).toBeFocused();
});

test('horizontal tabs take Left and Right instead, and a list without a selected tab keeps a Tab stop', async ({ page }) => {
    await page.goto('/preview/tabs/default?theme=light');
    const list = page.getByRole('tablist');
    await expect(list).toHaveAttribute('aria-orientation', 'horizontal');
    const named = (name: string) => list.getByRole('tab', { name, exact: true });
    await named('Profile').focus();
    for (const [key, name] of [['ArrowRight', 'Dashboard'], ['ArrowLeft', 'Profile'], ['ArrowLeft', 'Contact'], ['ArrowRight', 'Profile'], ['ArrowDown', 'Profile'], ['ArrowUp', 'Profile'], ['End', 'Contact'], ['Home', 'Profile']] as const) {
        await page.keyboard.press(key);
        await expect(named(name)).toBeFocused();
        await expect(named(name)).toHaveAttribute('aria-selected', 'true');
        await expect(list.locator('[role="tab"][tabindex="0"]')).toHaveText([name]);
        await expect(page.getByRole('tabpanel', { name })).toBeVisible();
    }

    // a selected value matching no tab: the first enabled tab is the Tab stop
    await page.goto('/preview/tabs/tabs-with-underline?theme=light');
    await page.locator('[data-controller="tabs"]').evaluate((element) => element.setAttribute('data-tabs-active-tab-value', 'none'));
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveText(['Profile']);
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(0);

    // the selected tab removed (a Stream or a Live re-render) while the list stays: the first enabled tab is the Tab stop
    await page.goto('/preview/tabs/default?theme=light');
    await page.getByRole('tab', { name: 'Profile', exact: true }).evaluate((trigger) => trigger.remove());
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveText(['Dashboard']);

    // the controller disconnected from a list that stays: the tabs get back their rendered tabindex (none), all reachable
    await page.goto('/preview/tabs/default?theme=light');
    await expect(page.locator('[role="tab"][tabindex="-1"]')).not.toHaveCount(0);
    await page.locator('[data-controller="tabs"]').evaluate((element) => element.removeAttribute('data-controller'));
    await expect(page.locator('[role="tab"][tabindex]')).toHaveCount(0);
});

test('a controller disconnected from a navigation that stays gives the links back their rendered current state', async ({ page }) => {
    await page.goto('/lab/section-nav/billing');
    const nav = permanent(page); // the <nav> carries the controller
    await expect(nav.locator('a[aria-current="page"]')).toHaveText(['Billing']); // marked from the URL, not rendered
    await nav.evaluate((element) => element.removeAttribute('data-controller'));
    await expect(nav.locator('a[aria-current="page"]')).toHaveCount(0);
    await nav.evaluate((element) => element.setAttribute('data-controller', 'section-nav'));
    await expect(nav.locator('a[aria-current="page"]')).toHaveText(['Billing']);
});

test('the section nav is plain links in the Tab order, and Enter follows one as a Turbo visit', async ({ page }) => {
    await page.goto('/lab/section-nav');
    const sameDocument = await markDocument(page);
    await nav(page).getByRole('link', { name: 'Profile' }).focus();
    for (const name of sections.slice(1)) {
        await page.keyboard.press('Tab');
        await expect(nav(page).getByRole('link', { name })).toBeFocused();
    }
    await page.keyboard.press('Shift+Tab');
    await expect(nav(page).getByRole('link', { name: 'Security' })).toBeFocused();
    await page.keyboard.press('ArrowDown'); // no arrow keys: the focus stays
    await expect(nav(page).getByRole('link', { name: 'Security' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('page')).toHaveText('Section security');
    await turboVisitDone(page);
    await sameDocument.expectKept();
    await expectState(page, 'Security', 'General');
});

test.describe('phone', () => {
    test.use({ viewport: viewports.mobile });

    test('the section nav is a strip that scrolls sideways, with the current section scrolled into view', async ({ page }) => {
        await page.goto('/lab/section-nav/integrations');
        const list = nav(page).getByRole('list');
        const box = async () =>
            list.evaluate((element) => {
                const current = element.querySelector('[aria-current="page"]')!.getBoundingClientRect();
                const strip = element.getBoundingClientRect();
                const links = [...element.querySelectorAll('a')].map((link) => link.getBoundingClientRect().top);
                return {
                    overflows: element.scrollWidth > element.clientWidth,
                    scrolled: element.scrollLeft,
                    currentShown: current.left >= strip.left - 1 && current.right <= strip.right + 1,
                    oneRow: links.every((top) => top === links[0]),
                };
            });
        await expect.poll(box).toMatchObject({ overflows: true, currentShown: true, oneRow: true });
        expect((await box()).scrolled).toBeGreaterThan(0);
        // the page itself does not scroll sideways, and a visit to the first section shows it at the start
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.getByRole('link', { name: 'Go to profile' }).click();
        await expect(page.getByTestId('page')).toHaveText('Section profile');
        await turboVisitDone(page);
        await expect.poll(box).toMatchObject({ currentShown: true, scrolled: 0 });
    });
});

test('on a desktop the section nav is a column', async ({ page }) => {
    await page.setViewportSize(viewports.desktop);
    await page.goto('/lab/section-nav/integrations');
    const tops = await nav(page).getByRole('link').evaluateAll((links) => links.map((link) => link.getBoundingClientRect().top));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    expect(new Set(tops).size).toBe(sections.length);
});

test('the demo\'s settings pages mark their section on the server and visit each other', async ({ page }) => {
    await page.goto('/demo/settings/profile');
    const settings = page.getByRole('navigation', { name: 'Settings' });
    const sameDocument = await markDocument(page);
    await expect(settings.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    for (const [name, heading] of [['Notifications', 'Notifications'], ['Billing', 'Billing']]) {
        await settings.getByRole('link', { name }).click();
        await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
        await turboVisitDone(page);
        await expect(settings.locator('[aria-current="page"]')).toHaveText([name]);
    }
    await page.goBack();
    await turboVisitDone(page);
    await expect(settings.locator('[aria-current="page"]')).toHaveText(['Notifications']);
    await sameDocument.expectKept();

    // the notification preferences save through Turbo (303)
    await page.getByRole('checkbox', { name: 'Product news' }).check();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Preferences saved.')).toBeVisible();
    await expect(settings.locator('[aria-current="page"]')).toHaveText(['Notifications']);
});

for (const system of ['light', 'dark'] as const) {
    for (const theme of ['light', 'dark'] as const) {
        test.describe(`system ${system}, ${theme} theme chosen`, () => {
            test.use({ colorScheme: system });

            for (const [viewportName, viewport] of Object.entries(viewports)) {
                test(`the section nav and the tabs pass axe, focused, at ${viewportName} width`, async ({ page }) => {
                    await page.setViewportSize(viewport);
                    await page.goto('/lab/section-nav/billing');
                    await page.evaluate((chosen) => localStorage.setItem('theme', chosen), theme);
                    await page.reload();
                    if ('dark' === theme) {
                        await expect(page.locator('html')).toHaveClass(/\bdark\b/);
                    } else {
                        await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
                    }
                    await nav(page).getByRole('link', { name: 'Billing' }).focus(); // a visible focus ring on the current section
                    await expectA11y(page, { impact: 'all' }, 'the current section focused');
                    await tab(page, 'Privacy').click();
                    await expect(tab(page, 'Privacy')).toBeFocused(); // and on the selected tab
                    await expectA11y(page, { impact: 'all', include: '[data-testid="tabs"]' }, 'the selected tab focused');
                });
            }
        });
    }
}
