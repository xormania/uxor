import { test, expect, expectA11y, controllersConnected, stubPreviewFrames } from './fixtures';
import { demoRoutePaths, examples, recipes } from './inventory';
import { lowContrastText } from './contrast';
import labPages from './lab-pages.json' with { type: 'json' };

// Every page of the demo: the shell pages, every lab scenario, and every README example in both themes.
const pages = [
    '/',
    '/install',
    '/guide',
    '/forms',
    '/forms/parity',
    ...demoRoutePaths.filter((path) => path !== '/demo/not-found'), // demo-app.spec.ts checks the 404 page with axe
    ...labPages,
    ...recipes.map((recipe) => `/r/${recipe}`),
    ...examples.flatMap(({ recipe, id }) => ['light', 'dark'].map((theme) => `/preview/${recipe}/${id}?theme=${theme}`)),
];

// independent pages: run them in parallel, and let --shard split this file between CI's shards
test.describe.configure({ mode: 'parallel' });

for (const path of pages) {
    test(`a11y ${path}`, async ({ page }) => {
        // every widget in every state on one page: axe alone takes 13-18 s on it in each engine, too close to the 30 s
        // budget on a loaded runner
        test.slow('/lab/value-matrix' === path, 'the value matrix holds every widget: axe scans it for 13-18 s');
        if (path.startsWith('/r/')) {
            // the scan leaves the embedded previews out, and scans each of them on its own (/preview/…, below)
            await stubPreviewFrames(page);
        }
        const response = await page.goto(path);
        expect(response?.status()).toBe(200);
        if (!path.startsWith('/preview/')) {
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        }
        // the widgets mounted: the scan reads what their controllers render (a dropzone's preview list, a picker's
        // input), not the server's markup before them
        await controllersConnected(page);
        // the /r/ pages embed the previews, scanned on their own
        await expectA11y(page, { impact: 'serious', exclude: 'iframe' });
        // axe passes the contrast of short text it cannot judge (a one-character page number): every text of a README
        // example, in both themes, measured from its computed colors (contrast.ts)
        if (path.startsWith('/preview/')) {
            expect(await lowContrastText(page), 'text below WCAG AA contrast').toEqual([]);
        }
    });
}
