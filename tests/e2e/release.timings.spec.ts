import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { trackCounts } from './counts';
import { turboOperation } from './transitions';

/*
 * Release checks (docs/PLAN-test-tiers.md, tier 3), timings: the key transitions of each scenario, each run RUNS times
 * on a fresh page, every step timed by the interaction-count harness (tests/e2e/counts.ts, `time`): its duration until
 * the update it waits for has landed, its longest interaction (INP), its total blocking time and, in Chromium, the
 * renderer's style, layout and script time. Report only: each step leaves a `timing` annotation that
 * tools/ci/release-timings.mjs reads (median over the runs, against tests/perf/baseline.json); no timing fails a test.
 * The steps' behavior still does: a step that does not complete fails.
 *
 * Links are followed from the keyboard, as in counts.spec.ts: a pointer over a link makes Turbo prefetch it.
 */

const RUNS = Number(process.env.TIMING_RUNS ?? 5);

test.describe('release timings', { tag: '@release' }, () => {
    test.skip(({ browserName }) => 'chromium' !== browserName, 'the renderer metrics are Chromium\'s');
    test.describe.configure({ timeout: 180_000 });

    const follow = async (page: Page, name: string) => {
        await page.getByRole('link', { name, exact: true }).focus();
        await page.keyboard.press('Enter');
    };
    const tableStatus = (page: Page) => page.getByRole('status').filter({ hasText: /Showing|No rows/ });

    /** RUNS fresh pages: `open` loads one, `steps` warm up once uncounted, then are timed in order. */
    async function timeRuns(page: Page, open: () => Promise<void>, steps: [string, () => Promise<unknown>][], warmUp = true) {
        const counts = await trackCounts(page);
        for (let run = 0; run < RUNS; run++) {
            await open();
            if (warmUp) {
                await counts.warmUp(...steps.map(([, step]) => step));
                await open();
            }
            for (const [name, step] of steps) {
                await counts.time(name, step);
            }
        }
    }

    test('data-table in a Turbo Frame: sort, page, filter', async ({ page }) => {
        await timeRuns(page, () => page.goto('/lab/data-table-frame').then(() => undefined), [
            ['data-table sort', async () => {
                await turboOperation(page, { frame: 'orders' }, () => follow(page, 'Customer'));
                await expect(page.getByRole('columnheader', { name: 'Customer' })).toHaveAttribute('aria-sort', 'ascending');
            }],
            ['data-table page', async () => {
                await turboOperation(page, { frame: 'orders' }, () => follow(page, 'Page 2'));
                await expect(tableStatus(page)).toHaveText('Showing 11–20 of 57');
            }],
            ['data-table filter', async () => {
                await turboOperation(page, { frame: 'orders' }, async () => {
                    await page.getByLabel('Status').selectOption('paid');
                    await page.getByRole('button', { name: 'Apply' }).click();
                });
                await expect(tableStatus(page)).toHaveText('Showing 1–10 of 19');
            }],
        ]);
    });

    test('data-table-live: sort, page, filter', async ({ page }) => {
        await timeRuns(page, () => page.goto('/lab/data-table-live').then(() => undefined), [
            ['data-table-live sort', async () => {
                await page.getByRole('button', { name: 'Customer' }).click();
                await expect(page.getByRole('columnheader', { name: 'Customer' })).toHaveAttribute('aria-sort', 'ascending');
            }],
            ['data-table-live page', async () => {
                await page.getByRole('link', { name: 'Page 2', exact: true }).click();
                await expect(tableStatus(page)).toHaveText('Showing 11–20 of 57');
            }],
            ['data-table-live filter', async () => {
                await page.getByLabel('Status').selectOption('paid');
                await expect(tableStatus(page)).toHaveText('Showing 1–10 of 19');
            }],
        ]);
    });

    test('editor: typing a sentence, then bold from the keyboard', async ({ page }) => {
        const field = page.locator('textarea[name="editor_demo[body]"]');
        await timeRuns(page, async () => {
            await page.goto('/lab/editor-turbo');
            await expect(page.locator('[data-editor-target="preview"]')).toHaveCount(0); // every editor mounted
            await page.getByRole('textbox', { name: 'Body' }).click();
        }, [
            ['editor typing', async () => {
                await page.keyboard.type('Hello world');
                await expect(field).toHaveValue(/Hello world<\/p>$/);
            }],
            // select all from ProseMirror's own keymap: a selection made by Shift+Home reaches the editor on the next
            // selectionchange, which Ctrl+B can beat
            ['editor bold', async () => {
                await page.keyboard.press('ControlOrMeta+a');
                await page.keyboard.press('ControlOrMeta+b');
                await expect(field).toHaveValue(/<strong>Hello world<\/strong><\/p>$/);
            }],
        ]);
    });

    test('markdown-editor: typing, then the preview', async ({ page }) => {
        const body = page.getByRole('textbox', { name: 'Body' });
        const preview = page.locator('#markdown_demo_body_preview');
        await timeRuns(page, async () => {
            await page.goto('/lab/markdown-turbo');
            await body.click();
        }, [
            ['markdown-editor typing', async () => {
                await page.keyboard.type('## Big news');
                await expect(body).toHaveValue(/## Big news$/);
            }],
            ['markdown-editor preview', async () => {
                await page.locator('#markdown_demo_body_preview_tab').click();
                await expect(preview.getByRole('heading', { name: 'Big news' })).toBeVisible();
            }],
        ]);
    });

    test('forms: an empty submit shows the server-side errors', async ({ page, allowHttpError }) => {
        allowHttpError(/\/forms$/, 422);
        await timeRuns(page, () => page.goto('/forms').then(() => undefined), [
            ['forms invalid submit', async () => {
                await page.getByRole('button', { name: 'Create account' }).click();
                await expect(page.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
            }],
        ]);
    });

    test('dashboard: a Turbo visit to the settings and Back', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const main = page.getByRole('navigation', { name: 'Main' });
        await timeRuns(page, () => page.goto('/demo').then(() => undefined), [
            ['dashboard visit', async () => {
                await turboOperation(page, { url: '/demo/settings/profile' }, async () => {
                    await main.getByRole('treeitem', { name: 'Settings' }).click();
                    await main.getByRole('treeitem', { name: 'Profile' }).focus();
                    await page.keyboard.press('Enter');
                });
                await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
            }],
            ['dashboard back', async () => {
                await turboOperation(page, { url: '/demo' }, () => page.goBack());
                await expect(page.getByRole('button', { name: 'Save changes' })).toBeHidden();
            }],
        ]);
    });
});
