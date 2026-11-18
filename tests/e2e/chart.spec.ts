import { test, expect } from './fixtures';
import { chartState, roleColor, toggleDark } from './chart-helpers';

test('a chart is an image named by its title, with its data in a table behind a toggle', async ({ page }) => {
    await page.goto('/preview/chart/default?theme=light');
    await expect(page.getByRole('img', { name: 'Revenue by month' })).toBeVisible();
    await expect(page.getByRole('figure', { name: 'Revenue by month' })).toBeVisible();

    const table = page.getByRole('table', { name: 'Revenue by month' });
    await expect(table).toBeHidden();
    await page.getByText('Show the data as a table').focus();
    await page.keyboard.press('Enter');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveText(['Month', '2025', '2026']);
    await expect(table.getByRole('rowheader')).toHaveText(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']);
    await expect(table.getByRole('row', { name: /^Mar/ }).getByRole('cell')).toHaveText(['14', '18']);
});

test('the series take the chart roles and follow the theme; the swatches match', async ({ page }) => {
    await page.goto('/preview/chart/default?theme=light');
    await expect.poll(async () => (await chartState(page, 'chart-revenue'))?.colors).toEqual([await roleColor(page, 'chart-1'), await roleColor(page, 'chart-2')]);
    const light = await chartState(page, 'chart-revenue');
    expect(light!.grid).toBe(await roleColor(page, 'default'));

    await toggleDark(page);
    const dark = [await roleColor(page, 'chart-1'), await roleColor(page, 'chart-2')];
    expect(dark).not.toEqual(light!.colors);
    await expect.poll(async () => (await chartState(page, 'chart-revenue'))?.colors).toEqual(dark);
    expect((await chartState(page, 'chart-revenue'))!.grid).toBe(await roleColor(page, 'default'));
    // the same chart, redrawn
    expect((await chartState(page, 'chart-revenue'))!.id).toBe(light!.id);

    await expect(page.locator('#chart-revenue [data-chart-target="swatch"]').first()).toHaveClass(/\bbg-chart-1\b/);
});

test('a role the data gives as var(--color-…) resolves in each theme; the description describes the canvas', async ({ page }) => {
    await page.goto('/preview/chart/a-color-of-your-own?theme=light');
    await expect(page.getByRole('img', { name: 'Sign-ups' })).toHaveAccessibleDescription('Sign-ups grew every week.');
    await expect.poll(async () => (await chartState(page, 'chart-signups'))?.colors).toEqual([await roleColor(page, 'fg-success')]);
    await toggleDark(page);
    await expect.poll(async () => (await chartState(page, 'chart-signups'))?.colors).toEqual([await roleColor(page, 'fg-success')]);
    const swatch = page.locator('#chart-signups [data-chart-target="swatch"]');
    await expect(swatch).toHaveCSS('background-color', await roleColor(page, 'fg-success'));
});

test('a translucent color is sampled on its own and an invalid color falls back to black', async ({ page }) => {
    await page.goto('/preview/chart/default?theme=light');
    await page.locator('#chart-revenue').evaluate((figure) => {
        figure.style.setProperty('--color-chart-1', 'red');
        figure.style.setProperty('--color-chart-2', 'rgb(0 0 255 / 80%)');
    });
    await toggleDark(page);
    const colors = async () => (await chartState(page, 'chart-revenue'))?.colors;
    await expect.poll(colors).toEqual(['rgb(255, 0, 0)', 'rgba(0, 0, 255, 0.8)']);

    await page.locator('#chart-revenue').evaluate((figure) => figure.style.setProperty('--color-chart-2', 'invalid-color'));
    await toggleDark(page);
    await expect.poll(colors).toEqual(['rgb(255, 0, 0)', 'rgb(0, 0, 0)']);
});

test('under prefers-reduced-motion the chart does not animate', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/preview/chart/default?theme=light');
    await expect.poll(async () => (await chartState(page, 'chart-revenue'))?.animation).toBe(false);
});

test('the chart reads its animation duration from the theme, including a scoped duration of zero', async ({ page }) => {
    await page.goto('/preview/chart/default?theme=light');
    const animation = async () => (await chartState(page, 'chart-revenue'))?.animation;
    await expect.poll(animation).toMatchObject({ duration: 150 });

    const figure = page.locator('#chart-revenue');
    for (const [cssTime, duration] of [['.24s', 240], ['0ms', 0]] as const) {
        await figure.evaluate((element, value) => element.style.setProperty('--uxor-motion-duration-normal', value), cssTime);
        await toggleDark(page);
        await expect.poll(animation).toMatchObject({ duration });
    }
});

test('an updated Chart.js animation option takes precedence over the theme', async ({ page }) => {
    await page.goto('/preview/chart/default?theme=light');
    const animation = async () => (await chartState(page, 'chart-revenue'))?.animation;
    await expect.poll(animation).toMatchObject({ duration: 150 });

    for (const value of [{ easing: 'linear', duration: 425 }, false]) {
        await page.locator('#chart-revenue canvas').evaluate((canvas, option) => {
            const attribute = 'data-symfony--ux-chartjs--chart-view-value';
            const view = JSON.parse(canvas.getAttribute(attribute)!);
            view.options = { ...view.options, animation: option };
            canvas.setAttribute(attribute, JSON.stringify(view));
        }, value);
        await expect.poll(animation).toEqual(value);
        await toggleDark(page);
        await expect.poll(animation).toEqual(value);
    }
});

test('a doughnut colors each slice; a table can be always visible', async ({ page }) => {
    await page.goto('/preview/chart/doughnut?theme=light');
    const roles = await Promise.all(['chart-1', 'chart-2', 'chart-3', 'chart-4'].map((role) => roleColor(page, role)));
    await expect.poll(async () => (await chartState(page, 'chart-traffic'))?.colors).toEqual([roles]);

    await page.goto('/preview/chart/in-a-card-with-its-table-shown?theme=light');
    await expect(page.getByRole('table', { name: 'Orders' })).toBeVisible();
});
