import { describeRecipe, expect, test } from '../../../../assets/test/browser/fixtures';

describeRecipe('uxor/social-login', () => {
    test('presents the registration choices and route back to sign-in', async ({ page, gotoExample }) => {
        await gotoExample('uxor/social-login/registration');

        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your account');
        await expect(page.getByRole('list', { name: 'Registration providers' }).getByRole('link')).toHaveCount(2);
        await expect(page.getByRole('link', { name: 'Already have an account? Sign in' })).toBeVisible();
    });

    test('keeps provider choices available after cancellation feedback', async ({ page, gotoExample }) => {
        await gotoExample('uxor/social-login/password-and-provider-sign-in');

        await expect(page.getByRole('alert')).toHaveText('Sign-in was cancelled. Choose a provider to try again.');
        await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible();
    });
});
