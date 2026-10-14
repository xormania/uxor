import { test, expect, expectA11y, markDocument, turboVisitDone, controllersConnected } from './fixtures';
import { turboOperation } from './transitions';

const providers = [
    { key: 'github', name: 'GitHub', label: 'Continue with GitHub' },
    { key: 'google', name: 'Google', label: 'Sign in with Google' },
    { key: 'facebook', name: 'Facebook', label: 'Continue with Facebook' },
];

async function approve(page: Parameters<typeof markDocument>[0], name: string) {
    await expect(page.getByRole('heading', { name: `${name} demonstration` })).toBeVisible();
    await page.waitForLoadState('load');
    await controllersConnected(page);
    await page.getByRole('button', { name: 'Continue as Ada' }).click();
    await expect(page).toHaveURL(/\/oauth-demo\/account$/);
    await expect(page.locator('#oauth-identity')).toContainText('Signed in as Ada Example');
    await page.waitForLoadState('load');
    await controllersConnected(page);
}

for (const provider of providers) {
    test(`${provider.name} signs in through the real Symfony session and Turbo resumes`, async ({ page }) => {
        await page.goto('/oauth-demo/login');
        const document = await markDocument(page);
        await page.getByRole('link', { name: provider.label }).click();
        await document.expectReplaced();
        await approve(page, provider.name);
        await expect(page.locator('#oauth-identity')).toContainText(`${provider.key}@example.test`);

        const authenticatedDocument = await markDocument(page);
        await turboOperation(page, { url: '/oauth-demo/account?visit=again' }, () => page.getByRole('link', { name: 'Refresh account page' }).click());
        await authenticatedDocument.expectKept();
        await page.getByRole('link', { name: 'Refresh protected content' }).click();
        await expect(page.locator('#oauth-demo-private')).toContainText('The Symfony session grants access');
        await expectA11y(page, { impact: 'serious' });

        await page.getByRole('button', { name: 'Sign out of provider demo' }).click();
        await expect(page).toHaveURL(/\/oauth-demo\/login$/);
        await page.waitForLoadState('load');
        await controllersConnected(page);
        await page.goto('/oauth-demo/account');
        await expect(page).toHaveURL(/\/oauth-demo\/login$/);
    });
}

test('provider cancellation returns useful feedback and the same block can retry', async ({ page }) => {
    await page.goto('/oauth-demo/login');
    await page.getByRole('link', { name: 'Continue with GitHub' }).click();
    await page.waitForLoadState('load');
    await controllersConnected(page);
    await page.getByRole('button', { name: 'Cancel sign-in' }).click();
    await expect(page).toHaveURL(/\/oauth-demo\/login$/);
    await page.waitForLoadState('load');
    await controllersConnected(page);
    await expect(page.getByText('Sign-in was cancelled. You can choose a provider and try again.')).toBeVisible();
    await expectA11y(page, { impact: 'all', include: 'main' });
    await page.getByRole('link', { name: 'Continue with GitHub' }).click();
    await approve(page, 'GitHub');
});

test('provider login inside a Turbo Frame navigates the whole browser', async ({ page }) => {
    await page.goto('/oauth-demo/login');
    // Move the installed block into a Frame; do not change its navigation attributes.
    await page.locator('main').evaluate((main) => {
        const frame = document.createElement('turbo-frame');
        frame.id = 'oauth-start-frame';
        while (main.firstChild) frame.append(main.firstChild);
        main.append(frame);
    });
    const document = await markDocument(page);
    await page.getByRole('link', { name: 'Sign in with Google' }).click();
    await document.expectReplaced();
    await expect(page.locator('#oauth-start-frame')).toHaveCount(0);
    await approve(page, 'Google');
});

test('an expired session during a Frame request replaces the whole page with login', async ({ page, context }) => {
    await page.goto('/oauth-demo/login');
    await page.getByRole('link', { name: 'Continue with GitHub' }).click();
    await approve(page, 'GitHub');
    const document = await markDocument(page);
    await context.clearCookies();
    await page.getByRole('link', { name: 'Refresh protected content' }).click();
    await expect(page).toHaveURL(/\/oauth-demo\/login$/);
    await document.expectReplaced();
    await turboVisitDone(page);
    await page.waitForLoadState('load');
    await controllersConnected(page);
    await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible();
    await expect(page.locator('#oauth-demo-private')).toHaveCount(0);
});
