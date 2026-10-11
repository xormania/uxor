import type { Page } from '@playwright/test';
import { test, expect, markDocument, recordDarkAtFirstBody } from './fixtures';

/*
 * The theme on screen for every system preference and saved choice, and how it moves: the toggle, the system
 * changing while the page is open, a Turbo visit, Back and a reload; and the toggle with `localStorage` blocked. The
 * state checked each time is the `dark` class before the first paint and after, `aria-pressed`, the icon shown and the
 * saved choice.
 */

type Scheme = 'light' | 'dark';

const toggle = (page: Page) => page.getByRole('button', { name: 'Toggle dark mode' });

async function expectTheme(page: Page, theme: Scheme) {
    const dark = 'dark' === theme;
    const icons = toggle(page).locator('svg');
    if (dark) {
        await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    } else {
        await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    }
    await expect(toggle(page)).toHaveAttribute('aria-pressed', String(dark));
    // the moon offers the dark theme, the sun the light one
    await expect(icons.nth(dark ? 1 : 0)).toBeVisible();
    await expect(icons.nth(dark ? 0 : 1)).toBeHidden();
}

const saved = (page: Page) => page.evaluate(() => localStorage.getItem('theme'));
// whether <html> is already dark when <body> starts parsing, i.e. before the first paint (set in the first beforeEach)
let darkAtFirstBody: () => Promise<boolean | undefined>;

test.beforeEach(async ({ page }) => {
    darkAtFirstBody = await recordDarkAtFirstBody(page);
});

for (const system of ['light', 'dark'] as const) {
    const other: Scheme = 'light' === system ? 'dark' : 'light';

    for (const choice of [null, 'light', 'dark'] as const) {
        test.describe(`system ${system}, ${choice ?? 'no'} choice saved`, () => {
            test.use({ colorScheme: system });

            const expected: Scheme = choice ?? system;
            const flipped: Scheme = 'light' === expected ? 'dark' : 'light';

            test.beforeEach(async ({ page }) => {
                await page.goto('/');
                if (null !== choice) {
                    await page.evaluate((theme) => localStorage.setItem('theme', theme), choice);
                    await page.reload();
                }
            });

            test('shows the expected theme from the first paint', async ({ page }) => {
                expect(await darkAtFirstBody()).toBe('dark' === expected);
                await expectTheme(page, expected);
                expect(await saved(page)).toBe(choice);
            });

            test(`the system switching to ${other} ${null === choice ? 'is followed' : 'is ignored'}`, async ({ page }) => {
                await page.emulateMedia({ colorScheme: other });
                await expectTheme(page, null === choice ? other : expected);
                await page.emulateMedia({ colorScheme: system });
                await expectTheme(page, expected);
            });

            test('the toggle switches the theme, saves it, and the choice holds across a Turbo visit, Back and a reload', async ({ page }) => {
                await toggle(page).click();
                await expectTheme(page, flipped);
                expect(await saved(page)).toBe(flipped);

                // a saved choice no longer follows the system
                await page.emulateMedia({ colorScheme: other });
                await expectTheme(page, flipped);
                await page.emulateMedia({ colorScheme: system });

                const sameDocument = await markDocument(page);
                await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Lab' }).click();
                await expect(page).toHaveURL(/\/lab$/);
                await expectTheme(page, flipped);
                await page.goBack();
                await expect(page).toHaveURL(/\/$/);
                await expectTheme(page, flipped);
                await sameDocument.expectKept();

                await page.reload();
                expect(await darkAtFirstBody()).toBe('dark' === flipped);
                await expectTheme(page, flipped);

                await toggle(page).click();
                await expectTheme(page, expected);
                expect(await saved(page)).toBe(expected);
            });
        });
    }
}

test.describe('storage blocked', () => {
    test.use({ colorScheme: 'light' });

    // localStorage throws (blocked site data, some private modes): the choice cannot be saved, and still holds
    test('the toggle switches the theme, and the choice holds across a Turbo visit without localStorage', async ({ page }) => {
        await page.addInitScript(() => {
            const blocked = () => {
                throw new DOMException('blocked', 'SecurityError');
            };
            Object.defineProperty(window, 'localStorage', { get: blocked });
        });
        await page.goto('/');
        await expectTheme(page, 'light');
        await toggle(page).click();
        await expectTheme(page, 'dark');

        await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Lab' }).click();
        await expect(page).toHaveURL(/\/lab$/);
        await expectTheme(page, 'dark');
    });
});

test.describe('a switch', () => {
    test.use({ colorScheme: 'light' });

    // colors change at once: a transition meant for hover (table rows) must not fade the page into the new theme
    for (const cause of ['the toggle', 'the system'] as const) {
        test(`by ${cause} runs no color transition`, async ({ page }) => {
            await page.goto('/demo');
            await expect(page.locator('tbody tr').first()).toBeVisible();
            // the transitions running in the frame the class changes in (they exist once styles are computed)
            await page.evaluate(() => {
                (window as any).__transitions = new Promise((resolve) =>
                    new MutationObserver((_, observer) => {
                        observer.disconnect();
                        getComputedStyle(document.body).color;
                        resolve(
                            document
                                .getAnimations()
                                .filter((animation) => animation instanceof CSSTransition)
                                .map((animation) => `${(animation.effect as KeyframeEffect).target?.nodeName} ${(animation as CSSTransition).transitionProperty}`),
                        );
                    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }),
                );
            });
            if ('the toggle' === cause) {
                await toggle(page).click();
            } else {
                await page.emulateMedia({ colorScheme: 'dark' });
            }
            await expect(page.locator('html')).toHaveClass(/\bdark\b/);
            expect(await page.evaluate(() => (window as any).__transitions)).toEqual([]);
        });
    }

    test('leaves a transition already running to finish on its own', async ({ page }) => {
        await page.goto('/demo');
        await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
        // the sidebar starts collapsing (a 200 ms width transition), then the theme switches in the same task
        const running = await page.evaluate(() => {
            document.querySelector<HTMLElement>('[data-action~="sidebar#toggle"]')!.click();
            getComputedStyle(document.body).width;
            document.querySelector<HTMLElement>('[data-controller~="theme-toggle"]')!.click();

            return document
                .getAnimations()
                .filter((animation) => animation instanceof CSSTransition && 'width' === animation.transitionProperty)
                .map((animation) => animation.playState);
        });
        expect(running).toEqual(['running']);
        await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    });
});
