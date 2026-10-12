/*
 * Port of symfony/ux src/Toolkit/assets/test/browser/fixtures.ts (f152d0b) for this repository:
 * same page setup, clock, request blocking and error checks, so screenshots match the upstream
 * baselines copied into <recipe>/tests/screenshots/. Differences:
 * - gotoExample('<kit>/<recipe>/<example>') opens this demo's /preview/<recipe>/<example>
 *   (the kit segment, e.g. "flowbite-4" in upstream specs, is ignored);
 * - screenshot names drop the kit segment: <recipe>/tests/screenshots/<file>.png;
 * - the page checks are the smoke project's (tests/e2e/fixtures.ts guardPage()): a Content Security Policy
 *   violation (the demo enforces a strict policy) and a failed local request fail the test too.
 */
import { expect, test as base, type Page } from '@playwright/test';
import { startJsCoverage } from '../coverage';
import { guardPage } from '../fixtures';
import { previewUrl } from '../inventory';

export type Theme = 'light' | 'dark';

export const themes: Theme[] = ['light', 'dark'];

type GotoExampleOptions = {
    theme?: Theme;
    timers?: 'real' | 'fake';
};

type Fixtures = {
    gotoExample: (path: string, options?: GotoExampleOptions) => Promise<void>;
    failOnPageErrors: void;
    /** The status the page's own document is expected to answer with (e.g. 404 for an error page). */
    documentStatus: number;
};

type StateOptions = {
    example: string;
    state: string;
    act: (page: Page) => Promise<void>;
};

/** A screenshot test's details: its baseline, and the @screenshot tag that keeps it out of Firefox and WebKit (playwright.config.ts). */
export const screenshotAnnotation = (name: string[]) => ({
    tag: '@screenshot',
    annotation: { type: 'screenshot', description: name.join('/') },
});

const FIXED_TIME = new Date('2026-03-15T10:00:00Z');

/** '<kit>/<recipe>/<example>' or '<recipe>/<example>' => ['<recipe>', '<example>'] */
const recipeAndExample = (path: string): [string, string] => {
    const parts = path.split('/');

    return [parts[parts.length - 2], parts[parts.length - 1]];
};

/** '<kit>/<recipe>' or '<recipe>' => '<recipe>' */
const recipeName = (recipe: string): string => recipe.split('/').pop() as string;

export const test = base.extend<Fixtures>({
    documentStatus: [200, { option: true }],

    // tests/e2e/fixtures.ts guardPage(): remote requests blocked (remote images change and load at their own pace:
    // screenshots show a local placeholder), and the same failures as the smoke project
    failOnPageErrors: [
        async ({ page, baseURL, documentStatus }, use, testInfo) => {
            const guard = await guardPage(page, baseURL);
            guard.allowHttpError('document', documentStatus);
            const stopCoverage = await startJsCoverage(page, testInfo); // JS_COVERAGE only (monthly job)
            await use();
            await stopCoverage();
            guard.check();
        },
        { auto: true },
    ],

    gotoExample: async ({ page }, use) => {
        await use(async (path, { theme = 'light', timers = 'real' } = {}) => {
            const [recipe, example] = recipeAndExample(path);

            // reduced motion: charts draw at once instead of animating into place
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            // Any Playwright clock fakes requestAnimationFrame, which then fires without a real render.
            if ('fake' === timers) {
                await page.clock.install({ time: FIXED_TIME });
            }

            await page.goto(previewUrl(recipe, example, theme));
            await page.evaluate(async () => {
                await document.fonts.ready;
            });

            if ('fake' === timers) {
                await page.clock.runFor(1000);
            }
            // lazy controllers load after the page: an editor replaces its server-rendered content once mounted
            await expect(page.locator('[data-editor-target="preview"]')).toHaveCount(0);
        });
    },
});

let currentRecipe: string | null = null;

/**
 * Groups the tests of a recipe spec, so `--grep <kit>/<recipe>` selects them and `testState()` knows the recipe.
 */
export function describeRecipe(recipe: string, callback: () => void): void {
    test.describe(recipe, () => {
        currentRecipe = recipe;
        try {
            callback();
        } finally {
            currentRecipe = null;
        }
    });
}

/**
 * Screenshots a state that only an interaction reaches, in every theme.
 *
 * It opens `example` of the recipe, runs `act` (the interaction and its assertions),
 * then compares the page with `<recipe>/tests/screenshots/<example>-<state>-<theme>.png`.
 */
export function testState(title: string, { example, state, act }: StateOptions): void {
    const recipe = currentRecipe;
    if (null === recipe) {
        throw new Error('testState() must be called inside describeRecipe().');
    }

    for (const theme of themes) {
        const name = [recipeName(recipe), 'tests', 'screenshots', `${example}-${state}-${theme}.png`];

        test(`${title} (${theme})`, screenshotAnnotation(name), async ({ page, gotoExample }) => {
            await gotoExample(`${recipe}/${example}`, { theme });
            await act(page);

            await expect(page).toHaveScreenshot(name, { fullPage: true });
        });
    }
}

export { expect };
