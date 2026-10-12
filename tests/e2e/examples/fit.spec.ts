/*
 * What users copy fits a phone: every README example at 390px, the navbar at 320px, and the stat cards' values at
 * tablet widths, where the dashboard's three columns are narrowest. A box that sticks out of the page scrolls it
 * sideways; a centered one (the preview centers its example) is also cut off on the left, out of reach.
 */
import type { Page } from '@playwright/test';
import { examples, previewUrl } from '../inventory';
import { expect, test } from './fixtures';

/**
 * The boxes of the page's layout that stick out of the viewport, left or right. Left out: the boxes in a scroll or
 * clip container (a table's `overflow-x-auto` wrapper scrolls on its own), and the floating layers (`absolute` or
 * `fixed`: popovers, tooltips, menus), placed by their own code and checked by their own specs.
 */
function overflowingBoxes(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const outside: string[] = [];
        const name = (el: Element) => [el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ''), ...[...el.classList].slice(0, 3)].join('.');
        const excluded = (el: Element) => {
            for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
                const style = getComputedStyle(node);
                if ('absolute' === style.position || 'fixed' === style.position) return true;
                if (node !== el && 'visible' !== style.overflowX) return true;
            }
            return false;
        };
        for (const el of document.body.querySelectorAll('*')) {
            const box = el.getBoundingClientRect();
            if (0 === box.width || (box.left >= -0.5 && box.right <= width + 0.5)) continue;
            if (!el.checkVisibility({ visibilityProperty: true }) || excluded(el)) continue;
            outside.push(`${name(el)}: ${Math.round(box.left)} to ${Math.round(box.right)} in ${width}px`);
        }

        return outside;
    });
}

test.describe('a phone, 390px wide', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    for (const { recipe, id } of examples) {
        test(`the README example ${recipe}/${id} fits`, async ({ page, gotoExample }) => {
            await gotoExample(`${recipe}/${id}`);

            expect(await overflowingBoxes(page), 'boxes outside the page').toEqual([]);
        });
    }
});

test.describe('a small phone, 320px wide', () => {
    test.use({ viewport: { width: 320, height: 640 } });

    test('the navbar keeps its brand, search and actions inside the bar', async ({ page, gotoExample }) => {
        await gotoExample('navbar/default');
        const header = page.locator('header');
        await expect(header.getByRole('button', { name: 'Sign in' })).toBeVisible();

        expect(await overflowingBoxes(page), 'boxes outside the page').toEqual([]);
        const bar = (await header.boundingBox())!;
        for (const part of await header.locator(':scope > *').all()) {
            if (!(await part.isVisible())) continue;
            const box = (await part.boundingBox())!;
            if (0 === box.width) continue;
            expect(box.x, 'a part of the bar starts inside it').toBeGreaterThanOrEqual(bar.x);
            expect(box.x + box.width, 'a part of the bar ends inside it').toBeLessThanOrEqual(bar.x + bar.width + 0.5);
        }
        const search = header.getByRole('searchbox', { name: 'Search' });
        await expect(search).toBeVisible();
        expect((await search.boundingBox())!.width, 'the search field is wide enough to type in').toBeGreaterThanOrEqual(160);
    });
});

for (const width of [640, 768, 1024]) {
    test.describe(`${width}px wide`, () => {
        test.use({ viewport: { width, height: 900 } });

        for (const [where, url] of [
            ['the dashboard', '/demo'],
            ['the stat card example', previewUrl('stat-card', 'default')],
            ['the dashboard-home example', previewUrl('dashboard-home', 'default')],
        ]) {
            test(`the stat cards of ${where} hold their values`, async ({ page }) => {
                await page.goto(url);
                const values = page.locator('p.tracking-tight.text-heading');
                await expect(values.first()).toBeVisible();

                const spilling = await values.evaluateAll((elements) =>
                    elements.filter((el) => el.scrollWidth > el.clientWidth || el.scrollWidth > el.parentElement!.clientWidth).map((el) => `${el.textContent?.trim()}: ${el.scrollWidth}px of text in ${el.clientWidth}px`),
                );
                expect(spilling, 'values wider than their card').toEqual([]);
                // a value too long for its card wraps (the guard of last resort): none of the kit's does at these widths
                const wrapped = await values.evaluateAll((elements) => elements.filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().height > 1.6 * parseFloat(getComputedStyle(el).lineHeight)).map((el) => el.textContent?.trim()));
                expect(wrapped, 'values broken over two lines').toEqual([]);
            });
        }
    });
}
