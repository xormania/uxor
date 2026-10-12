import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { reloadFrames, visit } from './transitions';

/*
 * Markdown editors under Turbo: a form posts the Markdown (303) or shows its errors (422), and the stored rendering is
 * the preview's; repeated visits leave one editor per field; a frame reloaded three times gives a fresh one each time.
 * Back, Forward, a promoted frame visit, a permanent element and Streams, with the preview after each:
 * lab.value-matrix (`a markdown editor in a POST form`).
 */

const editors = (page: Page) => page.locator('[data-controller~="markdown-editor"]');
const tab = (page: Page, field: string, name: string) => page.locator(`#${field}_${name.toLowerCase()}_tab`);
const panel = (page: Page, field: string) => page.locator(`#${field}_preview`);

test('a form posts the Markdown through Turbo, or answers 422 with the field errors; the stored rendering is the preview', async ({ page, allowHttpError }) => {
    allowHttpError(/\/lab\/markdown-turbo$/, 422);
    await page.goto('/lab/markdown-turbo');
    await page.getByRole('button', { name: 'Publish' }).click();
    const body = page.getByRole('textbox', { name: 'Body' });
    await expect(body).toHaveAttribute('aria-invalid', 'true');
    await expect(body).toHaveAccessibleDescription('At most 200 characters. This value should not be blank.');

    await body.fill('x'.repeat(201));
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByRole('textbox', { name: 'Body' })).toHaveAccessibleDescription(/This text is too long: it holds more than 200 characters\.$/);
    // the content comes back as typed, to be shortened
    await expect(page.getByRole('textbox', { name: 'Body' })).toHaveValue('x'.repeat(201));

    const markdown = '## Big news\n\nWe **ship** [today](/news) <script>x()</script> [bad](javascript:alert(1))';
    await page.getByRole('textbox', { name: 'Body' }).fill(markdown);
    await tab(page, 'markdown_demo_body', 'Preview').click();
    await expect(panel(page, 'markdown_demo_body').getByRole('heading', { name: 'Big news' })).toBeVisible();
    const previewed = await panel(page, 'markdown_demo_body').innerHTML();

    // the textarea submits while the Preview tab is open
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByTestId('saved-markdown')).toHaveText(markdown);
    expect(await page.getByTestId('saved-rendered').innerHTML()).toBe(previewed);
    await expect(page.getByTestId('saved-rendered').getByRole('link', { name: 'today' })).toHaveAttribute('href', '/news');
    expect(previewed).not.toMatch(/<script|javascript:/i);
    expect(new URL(page.url()).searchParams.get('saved')).toBe('1');
});

test('repeated visits leave one markdown editor per field', async ({ page }) => {
    await page.goto('/lab/markdown-turbo');
    for (let round = 0; round < 3; round++) {
        await visit(page, 'Go to page two', 'Page two');
        await expect(editors(page)).toHaveCount(3);
        await visit(page, 'Go to page one', 'Page one');
        await expect(editors(page)).toHaveCount(3);
    }
    await expect(page.getByRole('tablist')).toHaveCount(3);
});

test('a Turbo Frame reloaded three times gives a fresh markdown editor each time', async ({ page }) => {
    await page.goto('/lab/markdown-turbo');
    await reloadFrames(page, {
        before: () => page.getByRole('textbox', { name: 'Framed notes' }).fill('changed'),
        after: async () => {
            await expect(page.getByRole('textbox', { name: 'Framed notes' })).toHaveValue('In a **frame**.');
            await tab(page, 'framed', 'Preview').click();
            await expect(panel(page, 'framed').locator('strong')).toHaveText('frame');
            await tab(page, 'framed', 'Write').click();
            await expect(editors(page)).toHaveCount(3);
        },
    });
});
