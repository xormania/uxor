/*
 * The current page of a pager, in both themes: one character, which axe marks "incomplete" and passes, so its
 * contrast is measured here (contrast.ts). a11y.spec.ts measures every text of every README example the same way,
 * in Chromium; this one runs in every engine.
 */
import { expect, test } from './fixtures';
import { previewUrl } from './inventory';
import { textContrast } from './contrast';

const pagers = [
    ['pagination', 'default'],
    ['pagination', 'as-icon'],
    ['data-table', 'default'],
    ['data-table-live', 'default'],
] as const;

for (const [recipe, id] of pagers) {
    for (const theme of ['light', 'dark'] as const) {
        test(`the current page of ${recipe}/${id} reads at 4.5:1 or more in ${theme}`, async ({ page }) => {
            await page.emulateMedia({ colorScheme: theme });
            await page.goto(previewUrl(recipe, id, theme));
            const current = page.locator('[aria-current="page"]');
            await expect(current.first()).toBeVisible();

            const measured = await textContrast(current);
            expect(measured.length, 'the current page has a text measured').toBeGreaterThan(0);
            for (const contrast of measured) {
                expect(contrast.ratio, `page "${contrast.text}": ${contrast.color} on ${contrast.background}`).toBeGreaterThanOrEqual(4.5);
            }
        });
    }
}
