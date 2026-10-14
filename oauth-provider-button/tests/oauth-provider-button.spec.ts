import { describeRecipe, expect, test } from '../../../../assets/test/browser/fixtures';

describeRecipe('uxor/oauth-provider-button', () => {
    test('provides named keyboard links with a native provider handoff', async ({ page, gotoExample }) => {
        await gotoExample('uxor/oauth-provider-button/default');

        const providers = ['Google', 'Facebook', 'GitHub'];
        for (const provider of providers) {
            const link = page.getByRole('link', { name: `${provider === 'Google' ? 'Sign in' : 'Continue'} with ${provider}`, exact: true });
            await expect(link).toHaveAttribute('target', '_self');
            await expect(link).toHaveAttribute('data-turbo', 'false');
            await expect(link).toHaveAttribute('data-turbo-prefetch', 'false');
            await link.focus();
            await expect(link).toBeFocused();
        }
    });

    for (const theme of ['light', 'dark'] as const) {
        const system = theme === 'light' ? 'dark' : 'light';

        test(`Google artwork follows the selected ${theme} theme when the system prefers ${system}`, async ({ page, gotoExample }) => {
            await gotoExample('uxor/oauth-provider-button/default', { theme });
            await page.emulateMedia({ colorScheme: system });

            await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
            const link = page.getByRole('link', { name: 'Sign in with Google', exact: true });
            await expect(link.locator(`img[src*="uxor-oauth-google-${theme}"]`)).toBeVisible();
            await expect(link.locator(`img[src*="uxor-oauth-google-${system}"]`)).toBeHidden();
        });
    }
});
