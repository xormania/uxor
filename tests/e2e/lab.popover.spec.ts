import { test, expect, listenerChanges, stimulusControllers, trackGlobalListeners, turboVisitDone } from './fixtures';
import { back, recordFirstFrames, reloadFrames, shown, stepFromCode, visit } from './transitions';

/*
 * The popover beyond what one transition leaves of it (lab.value-matrix, `a popover left open`: Back, Forward, a promoted
 * frame visit, a Stream, a data-turbo-permanent element and a Live re-render, with its focus, its listeners and one
 * controller): the focus leaving it, repeated visits and frame loads, the first frame after Back, the order of
 * turbo:before-cache, a DOM move and a popover rendered open.
 */

// the listeners an open popover adds to the document and the window, and closing it removes (popover_controller.js)
const OPEN = { 'document click capture': 1, 'window scroll capture': 1, 'window resize': 1 };
let listeners: () => Promise<Record<string, number>>;
test.beforeEach(async ({ page }) => {
    listeners = await trackGlobalListeners(page, Object.keys(OPEN));
});
// the popover listeners added since `baseline` minus those removed
const listenersSince = async (baseline: Record<string, number>) => listenerChanges(baseline, await listeners());

test('the focus leaving the popover closes it', async ({ page }) => {
    await page.goto('/lab/popover-turbo');
    await page.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByRole('link', { name: 'Open the order' })).toBeFocused();
    // past its last link, to the next button of the page
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Owner' })).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Details' })).toBeHidden();
});

test('repeated Turbo visits leave one controller per popover and no document or window listener behind', async ({ page }) => {
    await page.goto('/lab/popover-turbo');
    const baseline = await listeners();
    for (let visit = 0; visit < 3; visit++) {
        await page.getByRole('button', { name: 'Owner' }).click();
        await page.getByRole('link', { name: /Go to page/ }).click();
        await turboVisitDone(page);
    }
    await expect(page.locator('[data-controller~="popover"]')).toHaveCount(6);
    expect(await stimulusControllers(page, 'popover')).toEqual({ controllers: 6, elements: 6, distinctElements: 6 });
    expect(await listenersSince(baseline)).toEqual({});

    // one toggle per click: a second controller would open and close it again
    await page.getByRole('button', { name: 'Owner' }).click();
    await expect(page.getByRole('dialog', { name: 'Owner' })).toBeVisible();
    await page.getByRole('button', { name: 'Owner' }).click();
    await expect(page.getByRole('dialog', { name: 'Owner' })).toBeHidden();
});

test('inside a Turbo Frame reloaded three times, the popover works', async ({ page }) => {
    await page.goto('/lab/popover-turbo');
    await reloadFrames(page, { before: () => page.getByRole('button', { name: 'Framed' }).click() });
    await page.getByRole('button', { name: 'Framed' }).click();
    await expect(page.getByLabel('Note')).toBeFocused();
    await expect(page.locator('[data-controller~="popover"]')).toHaveCount(6);
});

test('a popover whose link steps a frame promoted to history stays open with the focus, and Back shows it closed', async ({ page }) => {
    await page.goto('/lab/popover-turbo');
    const baseline = await listeners();
    const firstFrames = await recordFirstFrames(page, { steps: '#steps-content' });
    const trigger = page.getByRole('button', { name: 'Steps' });
    const dialog = page.getByRole('dialog', { name: 'Steps' });
    await trigger.click();
    await expect(page.getByRole('link', { name: 'Go to step 5' })).toBeFocused();

    // Turbo copies the page as the frame visit starts, then dispatches turbo:before-cache with the page still shown
    await visit(page, 'Go to step 5', { step: 5 });
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('link', { name: 'Go to step 5' })).toBeFocused();
    expect(await listenersSince(baseline)).toEqual(OPEN);

    // the copy holds the popover open: Back shows it closed from the first frame, and it works
    await back(page, { step: 0 });
    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(await firstFrames(1)).toEqual([{ render: 1, url: '/lab/popover-turbo', visible: { steps: false } }]);
    expect(await listenersSince(baseline)).toEqual({});
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.getByRole('heading', { level: 1 }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-controller~="popover"]')).toHaveCount(6);
});

test('turbo:before-cache closes an open popover before a Turbo visit copies the page, and not when a frame visit is promoted to history', async ({ page }) => {
    await page.goto('/lab/popover-turbo');
    // the open value of the Details popover in each copy Turbo renders, and on screen right after each turbo:before-cache
    await page.evaluate(() => {
        const w = window as any;
        w.__copies = [];
        w.__afterBeforeCache = [];
        document.addEventListener('turbo:before-render', (event: any) =>
            w.__copies.push(event.detail.newBody.querySelector('#plain-trigger')?.closest('[data-controller~="popover"]')?.dataset.popoverOpenValue),
        );
        // after every listener of the event, the popover's included
        document.addEventListener('turbo:before-cache', () =>
            queueMicrotask(() => w.__afterBeforeCache.push(document.querySelector('#plain-trigger')!.closest<HTMLElement>('[data-controller~="popover"]')!.dataset.popoverOpenValue)),
        );
    });
    const dialog = page.getByRole('dialog', { name: 'Details' });
    await page.getByRole('button', { name: 'Details' }).click();

    await stepFromCode(page, 1);
    await expect(dialog).toBeVisible();

    // a full visit started while it is open (from the page's code: a click outside would close it first)
    await page.evaluate(() => (window as any).Turbo.visit('/lab/popover-turbo/two'));
    await shown(page, 'Page two');
    await back(page, { step: 1 });
    await expect(dialog).toBeHidden();
    // the frame step left it open, the visit closed it; then Back cached page two, its own popover closed
    expect(await page.evaluate(() => (window as any).__afterBeforeCache)).toEqual(['true', 'false', 'false']);
    // the last body rendered is the copy of step 1, taken after turbo:before-cache: closed before any controller connects
    expect((await page.evaluate(() => (window as any).__copies as string[])).at(-1)).toBe('false');
});

test('a popover opened by the user and moved in the DOM stays open, with one controller and its listener', async ({ page }) => {
    await page.goto('/lab/popover-turbo');
    const baseline = await listeners();
    const trigger = page.getByRole('button', { name: 'Details' });
    const dialog = page.getByRole('dialog', { name: 'Details' });
    await trigger.click();
    await expect(dialog).toBeVisible();

    // detached and inserted again, as a DOM move or a morph does: the same controller reconnects
    await trigger.evaluate((element) => {
        const popover = element.closest('[data-controller~="popover"]')!;
        popover.parentElement!.append(popover);
    });
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await stimulusControllers(page, 'popover')).toEqual({ controllers: 6, elements: 6, distinctElements: 6 });
    expect(await listenersSince(baseline)).toEqual(OPEN);
    await trigger.click();
    await expect(dialog).toBeHidden();
    expect(await listenersSince(baseline)).toEqual({});
});

test('a popover rendered open beside a frame visit promoted to history stays open; Back shows it closed', async ({ page }) => {
    await page.goto('/lab/popover-turbo?open=1');
    const trigger = page.getByRole('button', { name: 'Steps' });
    const dialog = page.getByRole('dialog', { name: 'Steps' });
    await expect(dialog).toBeVisible();

    await stepFromCode(page, 1);
    await expect(dialog).toBeVisible();

    // the copy was taken open as the frame visit started: Back shows it closed, as after any Turbo cache
    await back(page, { step: 0 });
    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(dialog).toBeVisible();
});
