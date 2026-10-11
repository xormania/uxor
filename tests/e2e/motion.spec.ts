import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

/*
 * Motion: every transition in a recipe names the properties it animates (never `all`, never a layout property it does
 * not need) and stops under `prefers-reduced-motion: reduce`; an animation that is the content (a spinner, a skeleton's
 * pulse) runs slower there. A control that waits for its fade before hiding or removing an element still finishes
 * under reduced motion, at once, without a fade left to wait for.
 */

type Motion = 'reduce' | 'no-preference';

const preview = (id: string) => `/preview/${id}?theme=light`;

async function open(page: Page, id: string, motion: Motion) {
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto(preview(id));
}

/** The computed transition of an element or of one of its pseudo-elements. */
const transitionOf = (locator: Locator, pseudo?: string) =>
    locator.evaluate((element, pseudo) => {
        const style = getComputedStyle(element, pseudo);
        return { property: style.transitionProperty, duration: style.transitionDuration };
    }, pseudo ?? null);

const animationDurationOf = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).animationDuration);

const LAYOUT = ['all', 'width', 'height', 'padding', 'margin', 'inset', 'top', 'left', 'right', 'bottom', 'inline-size', 'block-size', 'gap', 'flex', 'grid'];

/** The properties of a transition-property value. */
const properties = (value: string) => value.split(',').map((property) => property.trim());

/** Each transitioning element of a recipe's preview: what it animates without a preference, and how to find it. */
const transitions: { name: string; id: string; target: (page: Page) => Locator; pseudo?: string; animates: string[] }[] = [
    { name: 'tabs trigger', id: 'tabs/default', target: (page) => page.getByRole('tab', { name: 'Profile' }), animates: ['color', 'background-color', 'border-color'] },
    { name: 'tabs trigger (underline)', id: 'tabs/tabs-with-underline', target: (page) => page.getByRole('tab', { name: 'Profile' }), animates: ['color', 'background-color', 'border-color'] },
    { name: 'tabs trigger (pills)', id: 'tabs/pills-tabs', target: (page) => page.getByRole('tab', { name: 'Profile' }), animates: ['color', 'background-color', 'border-color'] },
    { name: 'toggle knob', id: 'toggle/default', target: (page) => page.locator('input.peer + div').first(), pseudo: '::after', animates: ['translate', 'border-color'] },
    { name: 'sidebar width', id: 'sidebar/default', target: (page) => page.locator('#sidebar-preview'), animates: ['width'] },
    { name: 'sidebar collapse chevron', id: 'sidebar/default', target: (page) => page.locator('#sidebar-preview [data-sidebar-target="toggle"] svg').first(), animates: ['transform', 'translate', 'scale', 'rotate'] },
    { name: 'nav menu chevron', id: 'nav-menu/default', target: (page) => page.locator('[data-nav-menu-target="button"] svg.transition-transform').first(), animates: ['transform', 'translate', 'scale', 'rotate'] },
    { name: 'side nav chevron', id: 'side-nav/default', target: (page) => page.locator('[data-side-nav-toggle] svg.transition-transform').first(), animates: ['transform', 'translate', 'scale', 'rotate'] },
    { name: 'table row hover', id: 'table/default', target: (page) => page.locator('tbody tr').first(), animates: ['color', 'background-color', 'border-color'] },
    { name: 'toast fade', id: 'toast/default', target: (page) => page.locator('[data-controller="toast"]').first(), animates: ['opacity'] },
    { name: 'modal backdrop', id: 'modal/default', target: (page) => page.locator('dialog').first(), pseudo: '::backdrop', animates: ['color', 'background-color'] },
];

for (const { name, id, target, pseudo, animates } of transitions) {
    test(`${name}: animates only what it names, and nothing under reduced motion`, async ({ page }) => {
        await open(page, id, 'no-preference');
        const free = await transitionOf(target(page), pseudo);
        expect(properties(free.property), `${name}: transition-property without a preference`).toEqual(expect.arrayContaining(animates));
        // a layout property only when it is the point: the sidebar's width
        for (const property of properties(free.property).filter((property) => !animates.includes(property))) {
            expect(LAYOUT, `${name}: transitions ${property}`).not.toContain(property);
        }

        await open(page, id, 'reduce');
        const reduced = await transitionOf(target(page), pseudo);
        expect(reduced.property, `${name}: transition-property under reduced motion`).toBe('none');
    });
}

test('a tabs trigger animates its colors only, no layout property, without a preference', async ({ page }) => {
    await open(page, 'tabs/default', 'no-preference');
    const { property, duration } = await transitionOf(page.getByRole('tab', { name: 'Profile' }));
    expect(property).not.toBe('all');
    for (const animated of properties(property)) {
        expect(LAYOUT, `transitions ${animated}`).not.toContain(animated);
    }
    expect(duration).not.toBe('0s');
});

test('the spinner and the skeleton pulse run three times slower under reduced motion', async ({ page }) => {
    await open(page, 'spinner/default', 'no-preference');
    await expect.poll(() => animationDurationOf(page.locator('svg.animate-spin').first())).toBe('1s');
    await open(page, 'spinner/default', 'reduce');
    await expect.poll(() => animationDurationOf(page.locator('svg.animate-spin').first())).toBe('3s');

    await open(page, 'skeleton/default', 'no-preference');
    await expect.poll(() => animationDurationOf(page.locator('.animate-pulse').first())).toBe('2s');
    await open(page, 'skeleton/default', 'reduce');
    await expect.poll(() => animationDurationOf(page.locator('.animate-pulse').first())).toBe('6s');
});

// every animated element of the skeleton and spinner previews, the README examples' own classes included (a card that
// pulses around its skeletons): slowed three times under reduced motion, spin 1 s → 3 s, pulse 2 s → 6 s
for (const id of ['skeleton/default', 'skeleton/card-placeholder', 'spinner/default', 'spinner/spinner-with-card', 'spinner/buttons']) {
    test(`every animation in ${id} is slowed under reduced motion`, async ({ page }) => {
        await open(page, id, 'reduce');
        await expect(page.locator('.animate-pulse, .animate-spin').first()).toBeAttached();
        const durations = await page
            .locator('.animate-pulse, .animate-spin')
            .evaluateAll((elements) => elements.map((element) => `${element.classList.contains('animate-spin') ? 'spin' : 'pulse'} ${getComputedStyle(element).animationDuration}`));
        for (const duration of durations) {
            expect(['spin 3s', 'pulse 6s'], duration).toContain(duration);
        }
    });
}

/*
 * Dismissing: the alert hides and the toast leaves the DOM after their fade. Under reduced motion there is no fade:
 * both finish at once, within the click (checked in the same task, before any timer could run).
 */
for (const motion of ['reduce', 'no-preference'] as const) {
    test(`an alert dismissed with ${motion} motion is hidden`, async ({ page }) => {
        await open(page, 'alert/dismissing', motion);
        const alert = page.getByRole('alert').filter({ hasText: 'A simple info alert' });
        await alert.getByRole('button', { name: 'Close' }).click();
        await expect(alert).toBeHidden();
    });

    test(`a toast closed with ${motion} motion leaves the DOM`, async ({ page }) => {
        await open(page, 'toast/default', motion);
        const toasts = page.locator('[data-controller="toast"]');
        await expect(toasts).toHaveCount(2);
        await toasts.first().getByRole('button', { name: 'Close' }).click();
        await expect(toasts).toHaveCount(1);
    });

    test(`a modal opened and closed with ${motion} motion updates its trigger and hides`, async ({ page }) => {
        await open(page, 'modal/default', motion);
        const trigger = page.getByRole('button', { name: 'Open Modal' });
        const dialog = page.locator('dialog').first();
        await trigger.click();
        await expect(dialog).toBeVisible();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await expect(dialog).toHaveAttribute('aria-hidden', 'false');

        await dialog.getByRole('button', { name: 'Decline' }).click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(dialog).toHaveAttribute('aria-hidden', 'true');
    });
}

/*
 * The modal's backdrop fades: in as the dialog opens, and out before it closes, the dialog still open (and modal) while
 * it fades. A transition the browser never runs (a ::backdrop that appears and goes with its dialog in one frame) fires
 * no event: the check is the transitionrun on the dialog's ::backdrop, and whether the dialog was still open then.
 * Engines differ in what they run on a ::backdrop: Chromium both fades; WebKit the fade in (its events name no pseudo-
 * element, and the controller waits only for a transition it knows is the backdrop's, so it closes at once); Firefox
 * neither, so its backdrop comes and goes at once, as before.
 */
const BACKDROP_FADES: Record<string, { in: boolean; out: boolean }> = {
    chromium: { in: true, out: true },
    webkit: { in: true, out: false },
    firefox: { in: false, out: false },
};

const recordBackdropTransitions = (dialog: Locator) =>
    dialog.evaluate((element: HTMLDialogElement) => {
        const seen: string[] = [];
        (window as unknown as { backdropTransitions: string[] }).backdropTransitions = seen;
        for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) {
            element.addEventListener(type, (event) => {
                const { pseudoElement, propertyName, target } = event as TransitionEvent;
                // the dialog itself transitions nothing: a background-color transition targeting it is its backdrop's
                if (target === element && 'background-color' === propertyName && ['::backdrop', ''].includes(pseudoElement)) {
                    seen.push(`${type} ${element.open ? 'open' : 'closed'}`);
                }
            });
        }
        element.addEventListener('close', () => seen.push('close'));
    });
const backdropTransitions = (page: Page) => page.evaluate(() => [...(window as unknown as { backdropTransitions: string[] }).backdropTransitions]);
const forgetBackdropTransitions = (page: Page) => page.evaluate(() => void ((window as unknown as { backdropTransitions: string[] }).backdropTransitions.length = 0));

/** Clicks the dialog's Decline button and says, within the click, whether the dialog is still open and fading out. */
const declineWithinTheClick = (dialog: Locator) =>
    dialog.evaluate((element: HTMLDialogElement) => {
        [...element.querySelectorAll('button')].find((button) => 'Decline' === button.textContent?.trim())!.click();
        return { open: element.open, closing: element.hasAttribute('data-closing') };
    });

test('the modal backdrop fades in as the dialog opens and out before it closes', async ({ page, browserName }) => {
    const fades = BACKDROP_FADES[browserName];
    await open(page, 'modal/default', 'no-preference');
    const trigger = page.getByRole('button', { name: 'Open Modal' });
    const dialog = page.locator('dialog').first();
    await recordBackdropTransitions(dialog);

    for (const time of ['first', 'again after a fade out']) {
        await forgetBackdropTransitions(page);
        await trigger.click();
        await expect(dialog).toBeVisible();
        if (fades.in) {
            await expect.poll(() => backdropTransitions(page), `the backdrop fades in (${time})`).toContain('transitionrun open');
        }

        await forgetBackdropTransitions(page);
        expect(await declineWithinTheClick(dialog), 'within the click: still open while the backdrop fades out').toEqual({ open: fades.out, closing: fades.out });
        if (fades.out) {
            // the fade out runs while the dialog is open, then the dialog closes
            await expect.poll(() => backdropTransitions(page), `the backdrop fades out, then the dialog closes (${time})`).toContain('close');
            // a fade in still running when the close starts is cancelled first, and the fade out starts from its color
            const seen = await backdropTransitions(page);
            const fadeOut = seen.indexOf('transitionrun open');
            expect(fadeOut, `the fade out ran while the dialog was open: ${seen}`).toBeGreaterThanOrEqual(0);
            expect(fadeOut, `before the dialog closed: ${seen}`).toBeLessThan(seen.indexOf('close'));
        }
        await expect(dialog).toBeHidden();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(dialog).toHaveAttribute('aria-hidden', 'true');
        await expect(trigger).toBeFocused();
        expect(await dialog.evaluate((element) => element.hasAttribute('data-closing')), 'no closing state left behind').toBe(false);
    }
});

test('under reduced motion the modal backdrop does not fade, and the dialog closes at once', async ({ page }) => {
    await open(page, 'modal/default', 'reduce');
    const trigger = page.getByRole('button', { name: 'Open Modal' });
    const dialog = page.locator('dialog').first();
    await recordBackdropTransitions(dialog);

    await trigger.click();
    await expect(dialog).toBeVisible();
    expect(await declineWithinTheClick(dialog), 'closed within the click').toEqual({ open: false, closing: false });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => backdropTransitions(page), 'closed, with no backdrop transition').toEqual(['close']);
});

test('under reduced motion an alert hides at once, without waiting for a fade', async ({ page }) => {
    await open(page, 'alert/dismissing', 'reduce');
    const hidden = await page.getByRole('alert').filter({ hasText: 'A simple info alert' }).evaluate((alert) => {
        (alert.querySelector('button') as HTMLButtonElement).click();
        return !alert.checkVisibility();
    });
    expect(hidden, 'hidden within the click').toBe(true);
});

test('under reduced motion a closed toast leaves the DOM at once, without waiting for a fade', async ({ page }) => {
    await open(page, 'toast/default', 'reduce');
    const connected = await page.locator('[data-controller="toast"]').first().evaluate((toast) => {
        (toast.querySelector('button') as HTMLButtonElement).click();
        return toast.isConnected;
    });
    expect(connected, 'still in the DOM after the click').toBe(false);
});
