import { test, expect } from './fixtures';
import { visit } from './transitions';

test('a Live Component inside a data-turbo-permanent element keeps its state and stays live', async ({ page }) => {
    await page.goto('/lab/permanent-plus-live');
    await page.getByRole('button', { name: 'Increment' }).click();
    await expect(page.getByTestId('count')).toHaveText('1');

    await visit(page, 'Go to page two', 'Page two');
    await expect(page.getByTestId('count')).toHaveText('1');

    await page.getByRole('button', { name: 'Increment' }).click();
    await expect(page.getByTestId('count')).toHaveText('2');

    await visit(page, 'Go to page one', 'Page one');
    await page.getByRole('button', { name: 'Increment' }).click();
    await expect(page.getByTestId('count')).toHaveText('3');
});
