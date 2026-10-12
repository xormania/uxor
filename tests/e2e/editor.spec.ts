import type { Page } from '@playwright/test';
import { test, expect, expectA11y } from './fixtures';
import { previewUrl } from './inventory';

/*
 * The Editor component: Tiptap mounted over the server-rendered content, the toolbar (one tab stop, arrow keys,
 * aria-pressed), the link dialog and its URL policy, the hidden textarea's HTML, the counter, and pasted HTML reduced
 * to the preset.
 */

/** Opens a preview and waits for its editors to mount (the controller is lazy: Tiptap loads after the page). */
async function open(page: Page, id: string) {
    await page.goto(previewUrl('editor', id));
    await expect(page.locator('[data-editor-target="preview"]')).toHaveCount(0);
}
const value = (page: Page, name: string) => page.locator(`textarea[name="${name}"]`).inputValue();

/**
 * Pastes `html` into the focused editor, as a browser clipboard paste. The data is set on the event as its own
 * property: Firefox gives a constructed ClipboardEvent an empty clipboardData of its own, whatever the init passes.
 */
const paste = (page: Page, html: string) =>
    page.evaluate((html) => {
        const data = new DataTransfer();
        data.setData('text/html', html);
        data.setData('text/plain', 'pasted');
        const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: data });
        document.activeElement!.dispatchEvent(event);
    }, html);

test('the editor replaces the server-rendered content, named by its label, with no style element added', async ({ page }) => {
    const before = await page.request.get(previewUrl('editor', 'default')).then((response) => response.text());
    expect(before).toContain('<strong>spring collection</strong>');
    await open(page, 'default');
    const editor = page.getByRole('textbox', { name: 'Description' });
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(editor).toHaveAttribute('aria-multiline', 'true');
    await expect(editor.locator('strong')).toHaveText('spring collection');
    await expect(page.locator('[data-editor-target="preview"]')).toHaveCount(0);
    // Tiptap's own CSS (a <style> with ProseMirror's rules) is never injected
    expect(await page.locator('style').evaluateAll((styles) => styles.filter((style) => style.textContent!.includes('ProseMirror')).length)).toBe(0);
    await expect(page.locator('[data-editor-target="counter"]')).toHaveText(/^\d+ \/ 20000 characters$/);
});

test('the toolbar is one tab stop with arrow keys, and its buttons say what applies to the selection', async ({ page }) => {
    await open(page, 'placeholder-and-help');
    const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
    await page.getByRole('textbox', { name: 'Your message' }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(toolbar.getByRole('button', { name: 'Bold' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(toolbar.getByRole('button', { name: 'Italic' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(toolbar.getByRole('button', { name: 'Clear formatting' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(toolbar.getByRole('button', { name: 'Bold' })).toBeFocused();
    // the toolbar keeps a single tab stop
    expect(await toolbar.locator('button[tabindex="0"]').count()).toBe(1);
    // undo and redo start disabled, the list indent buttons outside a list
    await expect(toolbar.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect(toolbar.getByRole('button', { name: 'Increase indent' })).toBeDisabled();

    await page.getByRole('textbox', { name: 'Your message' }).click();
    await page.keyboard.type('Hello ');
    await toolbar.getByRole('button', { name: 'Bold' }).click();
    await expect(toolbar.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('world');
    expect(await value(page, 'message')).toBe('<p>Hello <strong>world</strong></p>');
    await expect(toolbar.getByRole('button', { name: 'Undo' })).toBeEnabled();
});

test('every toolbar command gives the preset HTML', async ({ page }) => {
    await open(page, 'placeholder-and-help');
    const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
    const editor = page.getByRole('textbox', { name: 'Your message' });
    await editor.click();
    await toolbar.getByRole('button', { name: 'Heading 2' }).click();
    await page.keyboard.type('Title');
    await page.keyboard.press('Enter');
    await toolbar.getByRole('button', { name: 'Bulleted list' }).click();
    await page.keyboard.type('one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('two');
    await toolbar.getByRole('button', { name: 'Increase indent' }).click();
    await page.keyboard.press('Enter');
    await toolbar.getByRole('button', { name: 'Decrease indent' }).click();
    await toolbar.getByRole('button', { name: 'Bulleted list' }).click();
    await toolbar.getByRole('button', { name: 'Quote' }).click();
    await page.keyboard.type('Said');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await toolbar.getByRole('button', { name: 'Strikethrough' }).click();
    await page.keyboard.type('gone');
    await toolbar.getByRole('button', { name: 'Strikethrough' }).click();
    await toolbar.getByRole('button', { name: 'Code' }).click();
    await page.keyboard.type('x');
    await toolbar.getByRole('button', { name: 'Code' }).click();
    await toolbar.getByRole('button', { name: 'Horizontal line' }).click();
    expect(await value(page, 'message')).toBe(
        '<h2>Title</h2><ul><li><p>one</p><ul><li><p>two</p></li></ul></li></ul><blockquote><p>Said</p></blockquote><p><s>gone</s><code>x</code></p><hr><p></p>',
    );
});

test('the link dialog sets allowed links, refuses other schemes, and removes links', async ({ page }) => {
    await open(page, 'placeholder-and-help');
    const editor = page.getByRole('textbox', { name: 'Your message' });
    await editor.click();
    await page.keyboard.type('See pricing');
    await page.keyboard.press('Shift+Home');
    await page.getByRole('button', { name: 'Link' }).click();
    const url = page.getByRole('textbox', { name: 'Link address' });
    await expect(url).toBeFocused();
    for (const refused of ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'ftp://example.com']) {
        await url.fill(refused);
        await url.press('Enter');
        await expect(url).toHaveAttribute('aria-invalid', 'true');
    }
    await url.fill('/pricing');
    await url.press('Enter');
    await expect(editor).toBeFocused();
    expect(await value(page, 'message')).toBe('<p><a rel="noopener noreferrer nofollow" href="/pricing">See pricing</a></p>');

    await page.getByRole('button', { name: 'Link' }).click();
    await expect(url).toHaveValue('/pricing');
    await page.getByRole('button', { name: 'Remove link' }).click();
    expect(await value(page, 'message')).toBe('<p>See pricing</p>');
});

test('pasted HTML keeps only the preset: no style, class, image, script or event attribute', async ({ page }) => {
    await open(page, 'placeholder-and-help');
    await page.getByRole('textbox', { name: 'Your message' }).click();
    await paste(
        page,
        '<p style="color:red" class="MsoNormal" onclick="window.__xss=1">Hello <b>bold</b> <span style="font-weight:700">heavy</span> <u>under</u></p>' +
            '<img src="x" onerror="window.__xss=1"><script>window.__xss=1</script>' +
            '<h1>Big</h1><table><tr><td>cell</td></tr></table><a href="javascript:alert(1)">bad</a> <a href="https://example.com" target="_blank">good</a>',
    );
    const html = await value(page, 'message');
    expect(html).not.toMatch(/style=|class=|<img|<script|onclick|onerror|javascript:|target=|<table|<h1/);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<u>under</u>');
    expect(html).toContain('<a rel="noopener noreferrer nofollow" href="https://example.com">good</a>');
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

test('the counter turns red past maxChars; an empty editor stores nothing', async ({ page }) => {
    await open(page, 'placeholder-and-help');
    const editor = page.getByRole('textbox', { name: 'Your message' });
    const counter = page.locator('[data-editor-target="counter"]');
    await expect(counter).toHaveText('0 / 500 characters');
    await editor.click();
    await page.keyboard.insertText('x'.repeat(501));
    await expect(counter).toHaveText('501 / 500 characters');
    await expect(counter).toHaveAttribute('data-over', '');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    expect(await value(page, 'message')).toBe('');
    await expect(counter).not.toHaveAttribute('data-over');
});

test('a read-only editor has no toolbar and cannot be changed; the label focuses an editable one', async ({ page }) => {
    await open(page, 'read-only');
    const editor = page.getByRole('textbox', { name: 'Terms' });
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await expect(editor).toHaveAttribute('aria-readonly', 'true');
    await expect(page.getByRole('toolbar')).toHaveCount(0);
    await expect(editor.getByRole('link', { name: 'terms of sale' })).toHaveAttribute('href', '/terms');

    await open(page, 'placeholder-and-help');
    await page.getByText('Your message', { exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Your message' })).toBeFocused();
});

test('the editor has no serious accessibility issue, invalid or not', async ({ page }) => {
    for (const id of ['default', 'invalid']) {
        await open(page, id);
        await expect(page.locator('.ProseMirror')).toHaveCount(1);
        await expectA11y(page, { impact: 'serious' }, id);
    }
    await expect(page.getByRole('textbox', { name: 'Summary' })).toHaveAccessibleDescription('This value should not be blank.');
});
