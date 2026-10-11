import { test, expect, expectA11y, controllersConnected } from './fixtures';
import { examples, recipes } from './inventory';
import { lowContrastText } from './contrast';

// Every page of the demo: the shell pages, every lab scenario, and every README example in both themes.
const labPages = ['live-dropdown', 'live-modal', 'live-table', 'live-drawer', 'live-form', 'turbo-stream-toast', 'turbo-nav', 'turbo-nav/two', 'turbo-frame-detail', 'turbo-frame-detail/apple', 'permanent-plus-live', 'form-back/get', 'form-back/post', 'data-table-frame', 'data-table-live', 'data-table-live-frame', 'data-table-live-permanent', 'data-table-live-stream', 'autocomplete', 'autocomplete-frame', 'autocomplete-stream', 'live-autocomplete', 'popover-turbo', 'popover-turbo/two', 'popover-stream', 'live-popover', 'calendar-turbo', 'calendar-turbo/two', 'calendar-stream', 'live-calendar', 'date-picker-turbo', 'date-picker-turbo/two', 'date-picker-stream', 'live-date-picker', 'chart-turbo', 'chart-turbo/two', 'chart-stream', 'live-chart', 'chart-points', 'dropzone-turbo', 'dropzone-turbo/two', 'dropzone-stream', 'dropzone-events', 'dropzone-form', 'live-dropzone', 'editor-turbo', 'editor-turbo/two', 'editor-stream', 'live-editor', 'markdown-turbo', 'markdown-turbo/two', 'markdown-stream', 'turbo-restore', 'turbo-restore/two', 'side-nav', 'side-nav/three', 'mobile-nav', 'mobile-nav/three', 'nav-menu', 'nav-menu/three', 'tooltip-turbo', 'tooltip-turbo/two', 'tooltip-stream', 'dropdown-turbo', 'dropdown-turbo/two', 'dropdown-stream', 'modal-turbo', 'modal-turbo/two', 'modal-stream', 'drawer-turbo', 'drawer-turbo/two', 'drawer-stream', 'section-nav', 'section-nav/integrations', 'value-matrix', 'live-values'];

const pages = [
    '/',
    '/forms',
    '/forms/parity',
    '/demo',
    '/demo/login',
    '/demo/signup',
    '/demo/forgot-password',
    '/demo/settings/profile',
    '/demo/settings/notifications',
    '/demo/settings/billing',
    '/demo/blank',
    '/lab',
    ...labPages.map((name) => `/lab/${name}`),
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
