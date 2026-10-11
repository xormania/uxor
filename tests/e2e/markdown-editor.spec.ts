import type { Page } from '@playwright/test';
import { test, expect, expectA11y } from './fixtures';
import { previewUrl } from './inventory';

/*
 * The MarkdownEditor component: a native textarea, a toolbar writing Markdown, Write and Preview tabs (the preview is
 * rendered by the server, raw HTML, images and unsafe links never reach it), the counter, read-only.
 */
const open = (page: Page, id: string) => page.goto(previewUrl('markdown-editor', id));
const tab = (page: Page, name: string) => page.getByRole('tab', { name });
const preview = (page: Page) => page.getByRole('tabpanel', { name: 'Preview' });

test('the preview tab renders the Markdown on the server, and Write comes back to the textarea', async ({ page }) => {
    await open(page, 'default');
    const source = page.getByRole('textbox', { name: 'Release notes' });
    await expect(source).toHaveValue(/^## Spring release/);
    await expect(tab(page, 'Write')).toHaveAttribute('aria-selected', 'true');
    await expect(preview(page)).toBeHidden();

    await tab(page, 'Preview').click();
    await expect(tab(page, 'Preview')).toHaveAttribute('aria-selected', 'true');
    await expect(preview(page).getByRole('heading', { level: 2, name: 'Spring release' })).toBeVisible();
    await expect(preview(page).locator('strong')).toHaveText('spring collection');
    await expect(preview(page).getByRole('link', { name: 'size guide' })).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    await expect(source).toBeHidden();
    // the toolbar is for writing only
    await expect(page.getByRole('toolbar')).toHaveCount(0);

    await tab(page, 'Write').click();
    await expect(source).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
});

test('the preview shows what was just typed, without raw HTML, images or unsafe links', async ({ page }) => {
    await open(page, 'placeholder-and-help');
    const source = page.getByRole('textbox', { name: 'Your message' });
    await source.fill(
        'Hello **world** ~~old~~\n\n<script>window.__xss=1</script><img src=x onerror="window.__xss=1">\n\n' +
            '![pic](https://example.com/a.png) [bad](javascript:alert(1)) [ok](/pricing) <b>raw</b>\n\n```\ncode <i>x</i>\n```',
    );
    await tab(page, 'Preview').click();
    const panel = preview(page);
    await expect(panel.locator('strong')).toHaveText('world');
    await expect(panel.locator('del')).toHaveText('old');
    await expect(panel.locator('pre code')).toHaveText('code <i>x</i>');
    await expect(panel.getByRole('link', { name: 'ok' })).toHaveAttribute('href', '/pricing');
    const html = await panel.innerHTML();
    expect(html).not.toMatch(/<script|<img|onerror|javascript:|<b>/i);
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

test('the toolbar writes Markdown around the selection or before the lines, with one tab stop', async ({ page }) => {
    await open(page, 'placeholder-and-help');
    const source = page.getByRole('textbox', { name: 'Your message' });
    const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
    await source.fill('Hello world');
    await source.press('End');
    await source.press('Shift+ArrowLeft');
    await source.press('Shift+ArrowLeft');
    await source.press('Shift+ArrowLeft');
    await source.press('Shift+ArrowLeft');
    await source.press('Shift+ArrowLeft');
    await toolbar.getByRole('button', { name: 'Bold' }).click();
    await expect(source).toHaveValue('Hello **world**');
    await expect(source).toBeFocused();
    // the selection is still the word: typing replaces it
    await page.keyboard.type('there');
    await expect(source).toHaveValue('Hello **there**');

    await toolbar.getByRole('button', { name: 'Heading' }).click();
    await expect(source).toHaveValue('## Hello **there**');
    await toolbar.getByRole('button', { name: 'Heading' }).click();
    await expect(source).toHaveValue('Hello **there**');

    await source.fill('one\ntwo');
    await source.press('ControlOrMeta+a');
    await toolbar.getByRole('button', { name: 'Numbered list' }).click();
    await expect(source).toHaveValue('1. one\n2. two');
    await toolbar.getByRole('button', { name: 'Bulleted list' }).click();
    await expect(source).toHaveValue('- one\n- two');

    await source.fill('See pricing');
    await source.press('End');
    for (let i = 0; i < 7; i++) {
        await source.press('Shift+ArrowLeft');
    }
    await toolbar.getByRole('button', { name: 'Link' }).click();
    await page.keyboard.type('/pricing');
    await expect(source).toHaveValue('See [pricing](/pricing)');

    // one tab stop, arrow keys between the buttons
    await source.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(toolbar.getByRole('button', { name: 'Heading' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(toolbar.getByRole('button', { name: 'Numbered list' })).toBeFocused();
    expect(await toolbar.locator('button[tabindex="0"]').count()).toBe(1);
});

test('the tabs switch with the arrow keys', async ({ page }) => {
    await open(page, 'default');
    await tab(page, 'Write').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Preview')).toBeFocused();
    await expect(tab(page, 'Preview')).toHaveAttribute('aria-selected', 'true');
    await expect(preview(page).getByRole('heading', { name: 'Spring release' })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 'Write')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('textbox', { name: 'Release notes' })).toBeVisible();
});

test('the counter turns red past maxChars', async ({ page }) => {
    await open(page, 'placeholder-and-help');
    const counter = page.locator('[data-markdown-editor-target="counter"]');
    await expect(counter).toHaveText('0 / 500 characters');
    await page.getByRole('textbox', { name: 'Your message' }).fill('x'.repeat(501));
    await expect(counter).toHaveText('501 / 500 characters');
    await expect(counter).toHaveAttribute('data-over', '');
});

test('a read-only editor has no toolbar, and its preview works', async ({ page }) => {
    await open(page, 'read-only');
    const source = page.getByRole('textbox', { name: 'Terms' });
    await expect(source).toHaveAttribute('readonly', '');
    await expect(page.getByRole('toolbar')).toHaveCount(0);
    await tab(page, 'Preview').click();
    await expect(preview(page).getByRole('link', { name: 'terms of sale' })).toHaveAttribute('href', '/terms');
});

test('the markdown editor has no serious accessibility issue, invalid or not, in either tab', async ({ page }) => {
    // four axe scans of the page and two loads: 2-5 s each scan in Firefox, more on a loaded runner, past the 30 s budget
    test.slow(true, 'four axe scans in one test');
    for (const id of ['default', 'invalid']) {
        await open(page, id);
        for (const name of ['Write', 'Preview']) {
            await tab(page, name).click();
            await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
            await expectA11y(page, { impact: 'serious' }, `${id} ${name}`);
        }
    }
    await tab(page, 'Write').click();
    await expect(page.getByRole('textbox', { name: 'Summary' })).toHaveAccessibleDescription('This value should not be blank.');
});
