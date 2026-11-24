import { test, expect, expectA11y, controllersConnected } from './fixtures';
import { demoRoutePaths, examples } from './inventory';
import { lowContrastText } from './contrast';
import labPages from './lab-pages.json' with { type: 'json' };

// The runtime's public app pages, form examples, lab scenarios and README examples in both themes.
const pages = [
    '/forms',
    '/forms/parity',
    ...demoRoutePaths.filter((path) => path !== '/demo/not-found'), // demo-app.spec.ts checks the 404 page with axe
    ...labPages,
    ...examples.flatMap(({ recipe, id }) => ['light', 'dark'].map((theme) => `/preview/${recipe}/${id}?theme=${theme}`)),
];

// independent pages: run them in parallel, and let --shard split this file between CI's shards
test.describe.configure({ mode: 'parallel' });

for (const path of pages) {
    const details = demoRoutePaths.includes(path) ? { tag: '@demo-app' } : {};
    test(`a11y ${path}`, details, async ({ page }) => {
        // every widget in every state on one page: axe alone takes 13-18 s on it in each engine, too close to the 30 s
        // budget on a loaded runner
        test.slow('/lab/value-matrix' === path, 'the value matrix holds every widget: axe scans it for 13-18 s');
        const response = await page.goto(path);
        expect(response?.status()).toBe(200);
        if (!path.startsWith('/preview/')) {
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        }
        // the widgets mounted: the scan reads what their controllers render (a dropzone's preview list, a picker's
        // input), not the server's markup before them
        await controllersConnected(page);
        await expectA11y(page, { impact: 'serious' });
        // axe passes the contrast of short text it cannot judge (a one-character page number): every text of a README
        // example, in both themes, measured from its computed colors (contrast.ts)
        if (path.startsWith('/preview/')) {
            const ids = await page.locator('[id]').evaluateAll((elements) => elements.map((element) => element.id));
            expect(ids, 'each id in the rendered README example is unique').toEqual([...new Set(ids)]);
            // Inspect ordinary section links. Empty fragments, #top and text fragments can work without an element.
            const missing = await page.locator('a[href^="#"]').evaluateAll((links) => links
                .map((link) => decodeURIComponent(link.getAttribute('href')!.slice(1).split(':~:')[0]))
                .filter((id) => id && id.toLowerCase() !== 'top' && !document.getElementById(id)
                    && !Array.from(document.getElementsByName(id)).some((element) => element.tagName === 'A')));
            expect(missing, 'the example contains the linked sections').toEqual([]);
            expect(await lowContrastText(page), 'text below WCAG AA contrast').toEqual([]);
        }
    });
}
