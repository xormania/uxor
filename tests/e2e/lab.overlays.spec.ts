import type { Page } from '@playwright/test';
import { test, expect, stimulusControllers, trackGlobalListeners, turboVisitDone, markDocument } from './fixtures';
import { back, forward, holdUntilCopied, recordFirstFrames, reloadFrames, sendStream, stepFromCode, visit } from './transitions';

/*
 * The dropdown, modal and drawer beyond Back and Live (lab.turbo-restore, lab.live-*): what Turbo Drive, Frames and
 * Streams do to them while they are open. Each runs the same steps on its own lab pages, `/lab/<recipe>-turbo` (pages
 * one and two, a Kept copy inside a data-turbo-permanent element, a Framed copy inside a Turbo Frame) and
 * `/lab/<recipe>-stream`. Page two links a stylesheet page one lacks: held until Turbo has copied page one
 * (`holdUntilCopied`), it makes Turbo copy page one before its controllers disconnect, the order a slow stylesheet
 * gives in production. Page one also holds the `history-steps`
 * frame, whose visits are promoted to history: Turbo copies the page as such a visit starts, then dispatches
 * `turbo:before-cache` with the page still on screen. What one transition leaves of an overlay open (its state, one
 * controller, closing it and opening it again), a data-turbo-permanent one and a Live re-render included:
 * lab.value-matrix (`a dropdown left open`, `a modal left open`, `a drawer left open`); here, the order of the copy, the
 * first frame, the focus and repeated steps.
 */

type Overlay = {
    recipe: string;
    /** the Stimulus identifier */
    controller: string;
    /** the id prefix of the panel: `<prefix>-<id>` */
    prefix: string;
    /** the main overlay of the turbo pages: its id, and the name of its trigger and of its panel */
    main: { id: string; name: string };
    /** the link inside the open main overlay that visits the other page */
    visitLink: (page: Page, other: string) => ReturnType<Page['getByRole']>;
    /** the link inside the open main overlay that steps the `history-steps` frame to step 5 */
    stepLink: (page: Page) => ReturnType<Page['getByRole']>;
    /** the link inside the open Framed overlay that reloads its frame */
    reloadLink: (page: Page) => ReturnType<Page['getByRole']>;
    /** the overlay's panel, by the name of its trigger */
    panel: (page: Page, name: string) => ReturnType<Page['getByRole']>;
};

const overlays: Overlay[] = [
    {
        recipe: 'dropdown',
        controller: 'dropdown',
        prefix: 'dropdown',
        main: { id: 'actions', name: 'Actions' },
        visitLink: (page, other) => page.getByRole('menuitem', { name: `Page ${other} from the menu` }),
        stepLink: (page) => page.getByRole('menuitem', { name: 'Step 5 from the menu' }),
        reloadLink: (page) => page.getByRole('menuitem', { name: 'Reload the frame' }),
        panel: (page, name) => page.getByRole('menu', { name, includeHidden: true }),
    },
    {
        recipe: 'modal',
        controller: 'flowbite-modal',
        prefix: 'modal',
        main: { id: 'details', name: 'Details' },
        visitLink: (page, other) => page.getByRole('link', { name: `Page ${other} from the dialog` }),
        stepLink: (page) => page.getByRole('link', { name: 'Step 5 from the dialog' }),
        reloadLink: (page) => page.getByRole('link', { name: 'Reload the frame' }),
        panel: (page, name) => page.getByRole('dialog', { name, includeHidden: true }),
    },
    {
        recipe: 'drawer',
        controller: 'drawer',
        prefix: 'drawer',
        main: { id: 'details', name: 'Details' },
        visitLink: (page, other) => page.getByRole('link', { name: `Page ${other} from the dialog` }),
        stepLink: (page) => page.getByRole('link', { name: 'Step 5 from the dialog' }),
        reloadLink: (page) => page.getByRole('link', { name: 'Reload the frame' }),
        panel: (page, name) => page.getByRole('dialog', { name, includeHidden: true }),
    },
];

const trigger = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

// a menu is open when shown; a dialog, when open and modal (a dialog open but not modal leaves the page usable behind it)
const panelState = (page: Page, overlay: Overlay, name: string) =>
    overlay.panel(page, name).evaluate((panel) =>
        panel instanceof HTMLDialogElement ? { open: panel.open, modal: panel.matches(':modal') } : { open: !panel.classList.contains('hidden'), modal: false },
    );

async function expectOpen(page: Page, overlay: Overlay, name: string) {
    await expect.poll(() => panelState(page, overlay, name)).toEqual({ open: true, modal: 'dropdown' !== overlay.recipe });
    await expect(overlay.panel(page, name)).toBeVisible();
    await expect(trigger(page, name)).toHaveAttribute('aria-expanded', 'true');
}

async function expectClosed(page: Page, overlay: Overlay, name: string) {
    await expect.poll(() => panelState(page, overlay, name)).toEqual({ open: false, modal: false });
    await expect(overlay.panel(page, name)).toBeHidden();
    // a modal's trigger has no aria-expanded until the modal first opens
    await expect(trigger(page, name)).not.toHaveAttribute('aria-expanded', 'true');
    // no dialog left in the top layer: the page behind is usable
    expect(await page.evaluate(() => document.querySelectorAll(':modal').length)).toBe(0);
}

// opens it from its trigger, checks it, closes it with Escape: the focus goes back to the trigger
async function expectWorks(page: Page, overlay: Overlay, name: string, content?: string) {
    await expectClosed(page, overlay, name);
    await trigger(page, name).click();
    await expectOpen(page, overlay, name);
    if (content) {
        await expect(overlay.panel(page, name)).toContainText(content);
    }
    await page.keyboard.press('Escape');
    await expectClosed(page, overlay, name);
    await expect(trigger(page, name)).toBeFocused();
}

for (const overlay of overlays) {
    const turboPage = (page: 'one' | 'two') => `/lab/${overlay.recipe}-turbo${'two' === page ? '/two' : ''}`;

    test.describe(overlay.recipe, () => {
        test('left open by Back, Forward or a visit from the page, every copy Turbo renders shows it closed', async ({ page }) => {
            // the main overlay's state in every page Turbo renders, its cached copies included
            await page.addInitScript(
                ({ selector, triggerSelector }) => {
                    (window as any).__rendered = [];
                    document.addEventListener('turbo:before-render', (event: any) => {
                        const body: HTMLElement = event.detail.newBody;
                        const panel = body.querySelector(selector);
                        (window as any).__rendered.push({
                            open: panel instanceof HTMLDialogElement ? panel.hasAttribute('open') : !panel?.classList.contains('hidden'),
                            expanded: body.querySelector(triggerSelector)?.getAttribute('aria-expanded') ?? null,
                        });
                    });
                },
                // the main overlay's trigger is the first of the page
                { selector: `#${overlay.prefix}-${overlay.main.id}`, triggerSelector: `[data-${overlay.controller}-target="trigger"]` },
            );
            const held = await holdUntilCopied(page, '**/lab/slow.css');
            await page.goto(turboPage('one'));
            const sameDocument = await markDocument(page);

            // left open by a visit from the page's code: page two waits for its stylesheet, Turbo copies page one first
            await trigger(page, overlay.main.name).click();
            await expectOpen(page, overlay, overlay.main.name);
            await page.evaluate((url) => (window as any).Turbo.visit(url), turboPage('two'));
            await expect(page.getByTestId('page')).toHaveText('Page two');
            await turboVisitDone(page);
            expect(held(), 'page two waited for its stylesheet until Turbo had copied page one').toBe(1);

            // left open by Back: renders the copy of page one
            await trigger(page, overlay.main.name).click();
            await expectOpen(page, overlay, overlay.main.name);
            await page.goBack();
            await expect(page.getByTestId('page')).toHaveText('Page one');
            await turboVisitDone(page);
            await expectWorks(page, overlay, overlay.main.name);

            // left open by Forward: renders the copy of page two
            await trigger(page, overlay.main.name).click();
            await expectOpen(page, overlay, overlay.main.name);
            await page.goForward();
            await expect(page.getByTestId('page')).toHaveText('Page two');
            await turboVisitDone(page);
            await expectWorks(page, overlay, overlay.main.name);

            // page two from the server, then the copies of page one and of page two
            const rendered = await page.evaluate(() => (window as any).__rendered as { open: boolean; expanded: string | null }[]);
            // (a modal's trigger has no aria-expanded until the modal first opens)
            expect(rendered.map(({ open, expanded }) => ({ open, expanded: 'true' === expanded }))).toEqual(Array(3).fill({ open: false, expanded: false }));
            await sameDocument.expectKept();
        });

        for (const from of ['a link inside it', "the page's code"] as const) {
            test(`open while ${from} steps a frame promoted to history, it stays open with the focus; Back and Forward show it closed from the first frame`, async ({ page }) => {
                await page.goto(turboPage('one'));
                const firstFrames = await recordFirstFrames(page, { panel: `#${overlay.prefix}-${overlay.main.id}` });
                await trigger(page, overlay.main.name).click();
                await expectOpen(page, overlay, overlay.main.name);
                const step = 'a link inside it' === from ? 5 : 1;
                if ('a link inside it' === from) {
                    await overlay.stepLink(page).focus();
                }
                // the focused element: the trigger, the dialog's first field or the link
                const focused = await page.evaluateHandle(() => document.activeElement);
                expect(await focused.evaluate((element) => element !== document.body)).toBe(true);

                // Turbo copies the page as the frame visit starts, then dispatches turbo:before-cache with the page still shown
                if ('a link inside it' === from) {
                    await visit(page, overlay.stepLink(page), { step });
                } else {
                    await stepFromCode(page, step);
                }
                await expectOpen(page, overlay, overlay.main.name);
                expect(await focused.evaluate((element) => element === document.activeElement)).toBe(true);

                // the copy taken as the visit started holds it open: Back shows it closed from the first frame, and so
                // does Forward (the copy of the step, taken as Back left it)
                await back(page, { step: 0 });
                await expectClosed(page, overlay, overlay.main.name);
                await forward(page, { step });
                await expectClosed(page, overlay, overlay.main.name);
                expect(await firstFrames(2)).toEqual([
                    { render: 1, url: turboPage('one'), visible: { panel: false } },
                    { render: 2, url: `${turboPage('one')}?step=${step}`, visible: { panel: false } },
                ]);
                await expectWorks(page, overlay, overlay.main.name);
                expect(await stimulusControllers(page, overlay.controller)).toEqual({ controllers: 3, elements: 3, distinctElements: 3 });
            });
        }

        test('repeated Turbo visits from inside the open overlay leave one controller per element and no document or window listener behind', async ({ page }) => {
            const listeners = await trackGlobalListeners(page);
            await page.goto(turboPage('one'));
            let baseline = {};
            for (let visit = 0; visit < 4; visit++) {
                const other = 0 === visit % 2 ? 'two' : 'one';
                await trigger(page, overlay.main.name).click();
                await expectOpen(page, overlay, overlay.main.name);
                await overlay.visitLink(page, other).click();
                await expect(page.getByTestId('page')).toHaveText(`Page ${other}`);
                await turboVisitDone(page);
                if (0 === visit) {
                    baseline = await listeners();
                }
            }
            // main, Kept, Framed
            expect(await stimulusControllers(page, overlay.controller)).toEqual({ controllers: 3, elements: 3, distinctElements: 3 });
            expect(await listeners()).toEqual(baseline);
            await expectWorks(page, overlay, overlay.main.name);
            // one toggle per click: a second controller on the trigger would open and close it again
            await trigger(page, overlay.main.name).click();
            await expectOpen(page, overlay, overlay.main.name);
            await page.keyboard.press('Escape');
            await expectClosed(page, overlay, overlay.main.name);
        });

        test('inside a Turbo Frame reloaded three times from inside the open overlay, the new one starts closed and works', async ({ page }) => {
            const listeners = await trackGlobalListeners(page);
            await page.goto(turboPage('one'));
            let baseline = {};
            await reloadFrames(page, {
                link: overlay.reloadLink,
                before: async () => {
                    await trigger(page, 'Framed').click();
                    await expectOpen(page, overlay, 'Framed');
                },
                after: async (load) => {
                    await expectClosed(page, overlay, 'Framed');
                    if (1 === load) {
                        baseline = await listeners();
                    }
                },
            });
            expect(await stimulusControllers(page, overlay.controller)).toEqual({ controllers: 3, elements: 3, distinctElements: 3 });
            expect(await listeners()).toEqual(baseline);
            await expectWorks(page, overlay, 'Framed', 'In a frame, load 3');
            // the page outside the frame is usable
            await expectWorks(page, overlay, overlay.main.name);
        });

        test('replaced or updated by a Turbo Stream while open, the new one starts closed, works, and no listener is left', async ({ page }) => {
            const listeners = await trackGlobalListeners(page);
            await page.goto(`/lab/${overlay.recipe}-stream`);
            let baseline = {};
            for (const action of ['replace', 'update', 'replace', 'update'] as const) {
                await trigger(page, 'Streamed').click();
                await expectOpen(page, overlay, 'Streamed');
                // sent while it stays open (a click on the page would close a menu, and a modal leaves it inert)
                await sendStream(page, action, { from: 'code' });
                await expectWorks(page, overlay, 'Streamed', `Version ${action}`);
                expect(await stimulusControllers(page, overlay.controller)).toEqual({ controllers: 1, elements: 1, distinctElements: 1 });
                if ('replace' === action && 0 === Object.keys(baseline).length) {
                    baseline = await listeners();
                }
                expect(await listeners()).toEqual(baseline);
            }
        });
    });
}
