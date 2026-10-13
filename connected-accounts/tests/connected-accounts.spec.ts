import { describeRecipe, expect, test } from '../../../../assets/test/browser/fixtures';

describeRecipe('uxor/connected-accounts', () => {
    test('explains why the last sign-in method cannot be disconnected', async ({ page, gotoExample }) => {
        await gotoExample('uxor/connected-accounts/keep-a-usable-sign-in-method');

        const button = page.getByRole('button', { name: 'Disconnect GitHub', exact: true });
        await expect(button).toBeDisabled();
        await expect(button).toHaveAccessibleDescription('Add another sign-in method before disconnecting GitHub.');
        await expect(page.locator('form')).toHaveCount(0);
        await expect(page.locator('input[name="_csrf_token"]')).toHaveCount(0);
    });

    test('provides distinct POST forms with a token and the disconnected subject', async ({ page, gotoExample }) => {
        await gotoExample('uxor/connected-accounts/default');

        await expect(page.getByText('Connected as alex@example.com', { exact: true })).toBeVisible();
        await expect(page.getByText('Not connected', { exact: true })).toBeVisible();
        await expect(page.getByRole('button')).toHaveCount(3);
        const forms = page.locator('form');
        await expect(forms).toHaveCount(2);
        for (const form of await forms.all()) {
            await expect(form).toHaveAttribute('method', 'post');
            await expect(form).toHaveAttribute('data-turbo', 'false');
            await expect(form).toHaveAttribute('data-turbo-prefetch', 'false');
            await expect(form.locator('input[name="_csrf_token"]')).toHaveAttribute('value', 'preview-only');
        }
        await expect(forms.first().locator('input[name="subject"]')).toHaveAttribute('value', 'demo-google');
        await expect(forms.last().locator('input[name="subject"]')).toHaveCount(0);
    });
});
