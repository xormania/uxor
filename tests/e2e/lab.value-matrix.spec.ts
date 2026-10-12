import type { Locator, Page } from '@playwright/test';
import { test, expect, listenerChanges, stimulusControllers, trackGlobalListeners, turboVisitDone, dialogState } from './fixtures';
import { advanceFrame, back, forward, observeTurbo, shown, turboOperation } from './transitions';
import { day } from './calendar';
import { selectionStatus, tableStatus } from './data-table';
import { png } from './files';

/*
 * The value matrix: what each widget holding a value or a state the user changes shows after each transition, as the
 * owner's policy says (decision 6b; 6a for Back and Forward). One row per component × transition, its expectation
 * read from POLICY below and nowhere else: a row changes the widget from what the server rendered, runs the
 * transition, and expects the state POLICY gives for the component's kind. A cell the policy or the component marks
 * `n/a` carries its reason, and the last test fails when a cell has neither an expectation nor a reason.
 *
 * Each check of a cell also holds what the widget owns (`check`): one controller per element, the listeners it adds only
 * while changed, the same document (no full load). After the transition the widget still answers the user
 * (`stillWorks`): shown as rendered, it takes the change again; shown changed, its undo takes the change back first.
 *
 * Where it runs: /lab/value-matrix/{one,two} holds every widget four times (rendered by the page, in a Turbo Frame, in
 * a region Turbo Streams replace, inside a data-turbo-permanent element), /lab/live-values the same widgets bound to a
 * Live Component; the data tables run on their own lab pages. Every transition is started from the page's code, so
 * no click or focus change closes what the user left open: the transition alone acts on the widget.
 */

// ---------------------------------------------------------------------------------------------------------------------
// The policy

type Transition = (typeof TRANSITIONS)[number];
const TRANSITIONS = [
    'back', // a Turbo visit away, then Back: the copy Turbo cached
    'forward', // changed on the page Back left, then Forward to it: its cached copy
    'frame-inside', // the Turbo Frame holding the widget reloads
    'frame-outside', // a Turbo Frame beside the widget reloads
    'frame-advance', // a Turbo Frame beside the widget makes a visit promoted to history, then Back and Forward
    'stream-replace', // a Turbo Stream replaces the region holding the widget
    'stream-update', // a Turbo Stream updates (replaces the content of) the region holding the widget
    'stream-rest', // a Turbo Stream replaces a region beside the widget
    'live', // the Live Component holding the widget re-renders
    'permanent', // inside a data-turbo-permanent element, a Turbo visit and Back
    'leave-return', // a Turbo visit away and a visit back (not Back)
] as const;

/**
 * What the policy is about, per component:
 * - `get-field`, `post-field`: a field of a GET form (it reflects the URL) or of a POST form (it holds the user's work);
 *   autocomplete and date picker follow their form (6a);
 * - `open-ui`: an overlay the user opened (dropdown, popover, modal, drawer);
 * - `chosen-ui`: a choice held in the page (the selected tab);
 * - `stored`: a choice the component saves in the browser's storage (the tree's open branches, the theme);
 * - `live-table-url`, `live-table-selection`: a Live data table's state in the URL, and its row selection.
 */
type Kind = 'get-field' | 'post-field' | 'open-ui' | 'chosen-ui' | 'stored' | 'live-table-url' | 'live-table-selection';

/**
 * - `url`: what the URL gives (a GET form shows the values the server rendered for it; a Live table, its URL state);
 * - `kept`: as the user left it;
 * - `fresh`: as a first load of that part shows it: what the server renders now, or, for a component that stores the
 *   choice, the choice stored;
 * - `server`: what the Live Component's properties say after the re-render; a value that is no property (files, an
 *   open overlay, the selected tab, the focus) is kept;
 * - `reset`: as rendered, the user's change dropped.
 */
type Rule = 'url' | 'kept' | 'fresh' | 'server' | 'reset' | { na: string };

const NEW_VISIT = { na: 'a visit (not Back) renders the page anew; the policy names this transition for the Live table selection only' };
const BACK_UI = 'fresh'; // the overlays' READMEs: Back and Forward show them closed (6a is about forms)
/*
 * `frame-advance` is the state after Back from the frame's visit promoted to history: Turbo shows the copy of the page it
 * took as the frame visit started, so Back is a Back (6a; the owner, 2026-10-10: "Back is an edge case — so as long as
 * it doesn't destroy state that's important"). The cell also expects the `frame-outside` state once the frame has
 * rendered (the page stays on screen) and the `forward` state after Forward.
 */

const POLICY: Record<Kind, Record<Transition, Rule>> = {
    // 6a: a GET form reflects the URL; Frame/Stream: the replaced part fresh, the rest untouched; Live: LiveProps from the server; permanent: all kept
    'get-field': { back: 'url', forward: 'url', 'frame-inside': 'fresh', 'frame-outside': 'kept', 'frame-advance': 'url', 'stream-replace': 'fresh', 'stream-update': 'fresh', 'stream-rest': 'kept', live: 'server', permanent: 'kept', 'leave-return': NEW_VISIT },
    // 6a: a POST form keeps the user's work
    'post-field': { back: 'kept', forward: 'kept', 'frame-inside': 'fresh', 'frame-outside': 'kept', 'frame-advance': 'kept', 'stream-replace': 'fresh', 'stream-update': 'fresh', 'stream-rest': 'kept', live: 'server', permanent: 'kept', 'leave-return': NEW_VISIT },
    // Live: open UI kept
    'open-ui': { back: BACK_UI, forward: BACK_UI, 'frame-inside': 'fresh', 'frame-outside': 'kept', 'frame-advance': BACK_UI, 'stream-replace': 'fresh', 'stream-update': 'fresh', 'stream-rest': 'kept', live: 'kept', permanent: 'kept', 'leave-return': NEW_VISIT },
    // the tabs' README: Back shows the tab that was selected
    'chosen-ui': { back: 'kept', forward: 'kept', 'frame-inside': 'fresh', 'frame-outside': 'kept', 'frame-advance': 'kept', 'stream-replace': 'fresh', 'stream-update': 'fresh', 'stream-rest': 'kept', live: 'kept', permanent: 'kept', 'leave-return': NEW_VISIT },
    // a choice the component stores holds wherever the component shows: a fresh render shows the stored choice
    'stored': { back: 'kept', forward: 'kept', 'frame-inside': 'fresh', 'frame-outside': 'kept', 'frame-advance': 'kept', 'stream-replace': 'fresh', 'stream-update': 'fresh', 'stream-rest': 'kept', live: 'kept', permanent: 'kept', 'leave-return': NEW_VISIT },
    // the Live table's state in the URL: Back and Forward show the URL's; Live: its properties from the server
    'live-table-url': { back: 'url', forward: 'url', 'frame-inside': 'fresh', 'frame-outside': 'kept', 'frame-advance': 'url', 'stream-replace': 'fresh', 'stream-update': 'fresh', 'stream-rest': 'kept', live: 'server', permanent: 'kept', 'leave-return': NEW_VISIT },
    // the Live table selection resets on leaving
    'live-table-selection': { back: 'reset', forward: 'reset', 'frame-inside': 'fresh', 'frame-outside': 'kept', 'frame-advance': 'reset', 'stream-replace': 'fresh', 'stream-update': 'fresh', 'stream-rest': 'kept', live: 'server', permanent: 'kept', 'leave-return': 'reset' },
};

// ---------------------------------------------------------------------------------------------------------------------
// The components

/** What a widget can show: as the server rendered it, as the user changed it, or as a Live action of the server set it. */
type State = 'rendered' | 'changed' | 'server';

type Component = {
    row: string;
    kind: Kind;
    site: Site;
    /** The widget's key on the value matrix's pages (`?only=<key>` renders it alone). */
    widget?: string;
    /** What the URL holds once the widget changed: `rendered` (a field not submitted) unless said. */
    url?: State;
    /** What a fresh render shows: `rendered` unless the component stores the choice. */
    fresh?: State;
    /** Whether the Live Component holds the widget's value in a property: true unless said (files are not). */
    liveProp?: boolean;
    /** Cells that do not apply to this component, with the reason. */
    na?: Partial<Record<Transition, string>>;
    change: (scope: Locator) => Promise<void>;
    shows: (scope: Locator, state: State) => Promise<void>;
    /** The Live re-render of this row, when not the site's server action. */
    rerender?: (page: Page, scope: Locator) => Promise<void>;
    /**
     * Checked when a transition left the widget in place and kept it (the Live re-render, a frame or a Stream beside it,
     * the step of a promoted frame visit): what the policy keeps beside the value (the focus).
     */
    keeps?: (scope: Locator) => Promise<void>;
    /**
     * Takes the user's change back, from `changed` to `rendered`, as the user would (closes, removes, unselects).
     * `afterChange`: it follows the user's own change on this page, not a state the transition handed over.
     */
    undo?: (scope: Locator, afterChange: boolean) => Promise<void>;
    /** The Stimulus identifiers of the widget's controllers: each check expects one controller per element carrying one. */
    controllers?: string[];
    /** The `document` and `window` listeners the widget adds while changed (an open popover) and removes otherwise. */
    listeners?: Record<string, number>;
};

const group = (scope: Locator, name: 'get' | 'post' | 'ui') => scope.locator(`[data-vm-group="${name}"]`);
/** The user moves on: the focus leaves the field just changed (a form holding the focus is one `form-reset` leaves alone). */
const leaveField = (scope: Locator) => scope.page().evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const pick = <T>(state: State, values: Record<State, T>) => values[state];

function textField(method: 'get' | 'post'): Pick<Component, 'change' | 'shows'> {
    const field = (scope: Locator) => group(scope, method).getByRole('textbox', { name: 'Name', exact: true });
    return {
        change: async (scope) => {
            await field(scope).fill('Grace');
            await field(scope).blur();
        },
        shows: async (scope, state) => expect(field(scope)).toHaveValue(pick(state, { rendered: 'Ada', changed: 'Grace', server: 'Server' })),
    };
}

function checkbox(method: 'get' | 'post', name: string): Pick<Component, 'change' | 'shows'> {
    const box = (scope: Locator) => group(scope, method).getByRole('checkbox', { name });
    return {
        // a label click: the Toggle's input is visually hidden
        change: async (scope) => {
            await group(scope, method).locator('label').filter({ hasText: name }).click();
            await expect(box(scope)).toBeChecked();
            await leaveField(scope);
        },
        shows: async (scope, state) => expect(box(scope)).toBeChecked({ checked: 'changed' === state }),
    };
}

function autocomplete(method: 'get' | 'post'): Pick<Component, 'change' | 'shows'> {
    const control = (scope: Locator) => group(scope, method).locator('.ts-wrapper').getByRole('combobox', { name: 'Fruit' });
    return {
        change: async (scope) => {
            await control(scope).locator('xpath=ancestor::div[contains(@class, "ts-control")]').click();
            await scope.page().locator(`#${await control(scope).getAttribute('aria-controls')}`).getByRole('option', { name: 'Banana', exact: true }).click();
            await control(scope).press('Escape');
            await control(scope).blur();
            await expect(group(scope, method).locator('select:has(option[value="banana"])')).toHaveValue('banana');
        },
        shows: async (scope, state) => {
            const [value, label] = pick(state, { rendered: ['apple', 'Apple'], changed: ['banana', 'Banana'], server: ['cherry', 'Cherry'] });
            await expect(group(scope, method).locator('select:has(option[value="banana"])')).toHaveValue(value);
            // Tom Select's own display of the choice, once, on screen
            await expect(group(scope, method).locator('.ts-wrapper')).toHaveCount(1);
            // not hidden as the `<select>` is (a Tom Select set up on a copy of the page took the classes Tom Select gave it)
            await expect.poll(() => group(scope, method).locator('.ts-wrapper').evaluate((wrapper) => wrapper.getBoundingClientRect().width)).toBeGreaterThan(100);
            await expect(group(scope, method).locator('.ts-wrapper .ts-control .item')).toHaveText([label]);
            // in the Tab order (a copy's `<select>` carries the tabindex="-1" Tom Select gave it)
            expect(await control(scope).evaluate((element) => (element as HTMLElement).tabIndex)).toBeGreaterThanOrEqual(0);
        },
    };
}

const DATES: Record<State, [string, string]> = { rendered: ['2026-03-10', 'Mar 10, 2026'], changed: ['2026-03-12', 'Mar 12, 2026'], server: ['2026-03-20', 'Mar 20, 2026'] };

/** The calendar shows `state`'s date selected, and its hidden input holds it. */
async function expectSelectedDay(calendar: Locator, state: State) {
    const [date] = DATES[state];
    await expect(calendar.locator('input[type="hidden"]')).toHaveValue(date);
    for (const [other] of Object.values(DATES)) {
        await expect(day(calendar, other)).toHaveAttribute('data-selected-single', String(other === date));
    }
}

function datePicker(method: 'get' | 'post'): Pick<Component, 'change' | 'shows'> {
    const picker = (scope: Locator) => group(scope, method).locator('[data-controller~="date-picker"]');
    return {
        change: async (scope) => {
            await picker(scope).getByRole('button', { name: 'Due date: choose date' }).click();
            await day(picker(scope), DATES.changed[0]).click();
            await expect(picker(scope).getByRole('dialog')).toHaveCount(0);
            await leaveField(scope);
        },
        shows: async (scope, state) => {
            await expect(group(scope, method).getByRole('textbox', { name: 'Due date' })).toHaveValue(DATES[state][1]);
            await expect(picker(scope).getByRole('dialog')).toHaveCount(0);
            await expectSelectedDay(picker(scope), state);
        },
    };
}

function calendar(method: 'get' | 'post'): Pick<Component, 'change' | 'shows'> {
    const calendarOf = (scope: Locator) => group(scope, method).locator('[data-vm="day"]');
    return {
        change: async (scope) => {
            await day(calendarOf(scope), DATES.changed[0]).click();
            await expectSelectedDay(calendarOf(scope), 'changed');
            await leaveField(scope);
        },
        shows: async (scope, state) => expectSelectedDay(calendarOf(scope), state),
    };
}

const editor: Pick<Component, 'change' | 'shows' | 'undo'> = {
    change: async (scope) => {
        const box = group(scope, 'post').getByRole('textbox', { name: 'Body' });
        await expect(group(scope, 'post').locator('[data-editor-target="preview"]')).toHaveCount(0);
        await box.click();
        await box.press('ControlOrMeta+End');
        await box.pressSequentially(' Changed');
        await box.blur();
    },
    shows: async (scope, state) => {
        const text = pick(state, { rendered: 'Draft.', changed: 'Draft. Changed', server: 'Set by the server.' });
        await expect(group(scope, 'post').locator('[data-editor-target="preview"]')).toHaveCount(0);
        // one editor, with its one toolbar: an editor set up twice shows two
        await expect(group(scope, 'post').locator('.ProseMirror')).toHaveCount(1);
        await expect(group(scope, 'post').getByRole('toolbar', { name: 'Formatting' })).toHaveCount(1);
        await expect(group(scope, 'post').getByRole('textbox', { name: 'Body' })).toHaveText(text);
        // what the form sends
        await expect(group(scope, 'post').locator('textarea[name="body"]')).toHaveValue(`<p>${text}</p>`);
    },
    // the editor still takes typing, and the form what it typed
    undo: async (scope) => {
        const box = group(scope, 'post').getByRole('textbox', { name: 'Body' });
        await box.click();
        await box.press('ControlOrMeta+a');
        await box.pressSequentially('Draft.');
        await box.blur();
    },
};

const markdownEditor: Pick<Component, 'change' | 'shows' | 'undo'> = {
    change: async (scope) => {
        await group(scope, 'post').getByRole('textbox', { name: 'Notes' }).fill('Changed.');
        await group(scope, 'post').getByRole('textbox', { name: 'Notes' }).blur();
    },
    // its value is a property of its own Live Component: after a re-render, the server's value is the draft sent
    shows: async (scope, state) => expect(group(scope, 'post').getByRole('textbox', { name: 'Notes' })).toHaveValue(pick(state, { rendered: 'Draft.', changed: 'Changed.', server: 'Changed.' })),
    // its preview still renders what the field holds, then the field takes typing
    undo: async (scope) => {
        const notes = group(scope, 'post').locator('[data-controller~="markdown-editor"]');
        await notes.getByRole('tab', { name: 'Preview' }).click();
        await expect(notes.getByRole('tabpanel')).toContainText('Changed.');
        await notes.getByRole('tab', { name: 'Write' }).click();
        await group(scope, 'post').getByRole('textbox', { name: 'Notes' }).fill('Draft.');
        await group(scope, 'post').getByRole('textbox', { name: 'Notes' }).blur();
    },
};

const dropzone: Pick<Component, 'change' | 'shows' | 'undo'> = {
    change: async (scope) => {
        await group(scope, 'post').locator('input[type="file"]').setInputFiles(png('changed.png'));
        await expect(group(scope, 'post').getByRole('button', { name: 'Remove changed.png' })).toBeVisible();
        await leaveField(scope);
    },
    shows: async (scope, state) => {
        const input = group(scope, 'post').locator('input[type="file"]');
        const picked = 'rendered' !== state;
        await expect(group(scope, 'post').getByRole('button', { name: 'Remove changed.png' })).toHaveCount(picked ? 1 : 0);
        expect(await input.evaluate((element: HTMLInputElement) => [...(element.files ?? [])].map((file) => file.name)), 'the files the input holds').toEqual(picked ? ['changed.png'] : []);
    },
    // its Remove button empties the zone and gives the focus to the input
    undo: async (scope) => {
        await group(scope, 'post').getByRole('button', { name: 'Remove changed.png' }).click();
        await expect(group(scope, 'post').locator('input[type="file"]')).toBeFocused();
        await leaveField(scope);
    },
};

const tabs: Pick<Component, 'change' | 'shows' | 'keeps' | 'undo'> = {
    change: async (scope) => {
        await group(scope, 'ui').getByRole('tab', { name: 'Second' }).click();
        await expect(group(scope, 'ui').getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true');
    },
    shows: async (scope, state) => {
        const second = 'rendered' !== state;
        await expect(group(scope, 'ui').getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', String(second));
        await expect(group(scope, 'ui').getByRole('tab', { name: 'First' })).toHaveAttribute('aria-selected', String(!second));
        await expect(group(scope, 'ui').getByText(second ? 'Second panel.' : 'First panel.')).toBeVisible();
        await expect(group(scope, 'ui').getByText(second ? 'First panel.' : 'Second panel.')).toBeHidden();
    },
    keeps: (scope) => expect(group(scope, 'ui').getByRole('tab', { name: 'Second' })).toBeFocused(),
    undo: (scope) => group(scope, 'ui').getByRole('tab', { name: 'First' }).click(),
};

function overlay(trigger: string, open: (scope: Locator) => Locator): Pick<Component, 'change' | 'shows' | 'undo'> {
    const button = (scope: Locator) => group(scope, 'ui').getByRole('button', { name: trigger, exact: true });
    return {
        // as handed over by the transition, its trigger closes it: one toggle per click (a second controller would open
        // it again); opened by the user, Escape closes it and gives the focus back to the trigger
        undo: async (scope, afterChange) => {
            if (!afterChange) {
                return button(scope).click();
            }
            await scope.page().keyboard.press('Escape');
            await expect(open(scope)).toBeHidden();
            await expect(button(scope)).toBeFocused();
        },
        change: async (scope) => {
            await button(scope).click();
            await expect(open(scope)).toBeVisible();
        },
        shows: async (scope, state) => {
            const isOpen = 'rendered' !== state;
            await expect(open(scope)).toBeVisible({ visible: isOpen });
            // a closed overlay's trigger may carry no aria-expanded at all (the modal's, until first opened)
            await (isOpen ? expect(button(scope)) : expect(button(scope)).not).toHaveAttribute('aria-expanded', 'true');
        },
    };
}

/** A <dialog> open as a modal, or closed: the overlay's own check, beside the visibility. */
function dialog(trigger: string, text: string): Pick<Component, 'change' | 'shows' | 'undo'> {
    const element = (scope: Locator) => group(scope, 'ui').locator('dialog').filter({ hasText: text });
    const base = overlay(trigger, element);
    return {
        change: base.change,
        // Escape closes it (the page behind is inert); opened from its trigger, it gives the focus back to it (one moved
        // into another page open, inside a data-turbo-permanent element, has no opener left there)
        undo: async (scope, afterChange) => {
            await scope.page().keyboard.press('Escape');
            await expect(element(scope)).toBeHidden();
            if (afterChange) {
                await expect(group(scope, 'ui').getByRole('button', { name: trigger, exact: true })).toBeFocused();
            }
        },
        shows: async (scope, state) => {
            await base.shows(scope, state);
            expect(await dialogState(element(scope))).toEqual(
                'rendered' === state ? { open: false, modal: false } : { open: true, modal: true },
            );
        },
    };
}

const popover: Pick<Component, 'change' | 'shows' | 'keeps' | 'undo' | 'listeners'> = {
    ...overlay('Popover', (scope) => group(scope, 'ui').getByRole('dialog', { name: 'Popover' })),
    // opening it focused its field
    keeps: (scope) => expect(group(scope, 'ui').getByRole('textbox', { name: 'Popover note' })).toBeFocused(),
    // popover_controller.js, while open
    listeners: { 'document click capture': 1, 'window scroll capture': 1, 'window resize': 1 },
};

const sideNav: Pick<Component, 'change' | 'shows' | 'undo'> = {
    change: async (scope) => {
        await group(scope, 'ui').getByRole('treeitem', { name: 'Branch' }).locator(':scope > [data-side-nav-toggle]').click();
        await expect(group(scope, 'ui').getByRole('treeitem', { name: 'Branch' })).toHaveAttribute('aria-expanded', 'true');
    },
    shows: async (scope, state) => {
        const open = 'rendered' !== state;
        await expect(group(scope, 'ui').getByRole('treeitem', { name: 'Branch' })).toHaveAttribute('aria-expanded', String(open));
        await expect(group(scope, 'ui').getByRole('treeitem', { name: 'Leaf' })).toBeVisible({ visible: open });
    },
    undo: (scope) => group(scope, 'ui').getByRole('treeitem', { name: 'Branch' }).locator(':scope > [data-side-nav-toggle]').click(),
};

const themeToggle: Pick<Component, 'change' | 'shows' | 'undo'> = {
    change: async (scope) => {
        await group(scope, 'ui').getByRole('button', { name: 'Toggle dark mode' }).click();
        await expect(scope.page().locator('html')).toHaveClass(/\bdark\b/);
    },
    shows: async (scope, state) => {
        const dark = 'rendered' !== state;
        await expect(scope.page().locator('html')).toHaveClass(dark ? /\bdark\b/ : /^(?!.*\bdark\b)/);
        await expect(group(scope, 'ui').getByRole('button', { name: 'Toggle dark mode' })).toHaveAttribute('aria-pressed', String(dark));
    },
    undo: (scope) => group(scope, 'ui').getByRole('button', { name: 'Toggle dark mode' }).click(),
};

// ---------------------------------------------------------------------------------------------------------------------
// The sites: where each transition runs, and how

type Cell = (page: Page, component: Component, expected: State) => Promise<void>;
type Site = { name: string; cells: Partial<Record<Transition, Cell>> };

/** Starts a Turbo Drive visit from the page's code and waits until it has rendered `heading` (or `url`'s page). */
async function visitFromCode(page: Page, url: string, heading?: string) {
    await turboOperation(page, { url }, () => page.evaluate((url) => (window as any).Turbo.visit(url), url));
    if (heading) {
        await shown(page, heading);
    } else {
        await turboVisitDone(page);
    }
}

/** Reloads the frame `id` from the page's code (Turbo.visit with `frame`), and waits for its load counter. */
async function reloadFrame(page: Page, id: string, url: string) {
    const frame = page.locator(`turbo-frame#${id}`);
    const load = Number(await frame.getByTestId('frame-load').textContent()) + 1;
    const target = new URL(url, page.url());
    target.searchParams.set('load', String(load));
    await page.evaluate(({ id, href }) => (window as any).Turbo.visit(href, { frame: id }), { id, href: target.href });
    await expect(frame.getByTestId('frame-load')).toHaveText(String(load));
    await expect(frame).not.toHaveAttribute('busy');
    await expect(frame).not.toHaveAttribute('aria-busy');
}

/** Posts `action` (replace or update) to `url` and renders the Turbo Stream it answers, from the page's code. */
async function streamFromCode(page: Page, url: string, action: 'replace' | 'update', marker: Locator, fields: Record<string, string> = {}) {
    await page.evaluate(
        async ({ url, body }) => {
            const response = await fetch(url, { method: 'POST', body: new URLSearchParams(body), headers: { Accept: 'text/vnd.turbo-stream.html' } });
            (window as any).Turbo.renderStreamMessage(await response.text());
        },
        { url, body: { ...fields, action } },
    );
    await expect(marker).toHaveText(action);
}

/** Calls the action `name` of the Live Component `root` from the page's code. */
async function liveAction(root: Locator, name: string, args: Record<string, unknown> = {}) {
    await root.evaluate(
        async (element, { name, args }) => {
            const { getComponent } = await import('@symfony/ux-live-component');
            await (await getComponent(element as HTMLElement)).action(name, args);
        },
        { name, args },
    );
}

/** Waits until the widgets of the page are set up: the editors mounted, one Tom Select on each autocomplete field. */
async function settled(page: Page) {
    await expect
        .poll(() =>
            page.evaluate(() => {
                const selects = [...document.querySelectorAll<HTMLSelectElement>('select[data-controller~="symfony--ux-autocomplete--autocomplete"]')];
                return selects.every((select) => (select as any).tomselect) && document.querySelectorAll('.ts-wrapper').length === selects.length && !document.querySelector('[data-editor-target="preview"]');
            }),
            { message: 'the widgets are set up: one Tom Select per autocomplete field, the editors mounted' },
        )
        .toBe(true);
}

const MATRIX = { one: '/lab/value-matrix', two: '/lab/value-matrix/two', live: '/lab/live-values' };
const region = (page: Page, name: 'plain' | 'framed' | 'streamed' | 'kept') => page.getByTestId(`region-${name}`);
/** The value matrix's page `one` or `two` with the component's widget alone. */
const matrixPage = (component: Component, which: 'one' | 'two' = 'one') => `${MATRIX[which]}?only=${component.widget}`;

async function openMatrix(page: Page, component: Component) {
    await page.goto(matrixPage(component));
    await settled(page);
}

/**
 * The widget in `scope` shows `state`, and holds what it owns: one controller per element, the listeners it adds while
 * changed and no others (counted from the cell's start), in the document the cell started in (no full load).
 */
async function check(component: Component, scope: Locator, state: State) {
    await component.shows(scope, state);
    const page = scope.page();
    expect(await page.evaluate(() => Boolean((window as any).__vmStart)), 'the document the cell started in: no full load').toBe(true);
    for (const identifier of component.controllers ?? []) {
        await expect
            .poll(async () => {
                const { controllers, elements, distinctElements } = await stimulusControllers(page, identifier);
                return { 'controllers beyond one per element': controllers - elements, 'elements without one': elements - distinctElements };
            }, { message: `one ${identifier} controller per element` })
            .toEqual({ 'controllers beyond one per element': 0, 'elements without one': 0 });
    }
    if (component.listeners) {
        const names = Object.keys(component.listeners);
        const [start, now] = await page.evaluate(() => [(window as any).__vmStart.listeners, (window as any).__globalListeners()]);
        const only = (counts: Record<string, number>) => Object.fromEntries(Object.entries(counts).filter(([name]) => names.includes(name)));
        expect(listenerChanges(only(start), only(now)), `the listeners it holds, ${state}`).toEqual('changed' === state ? component.listeners : {});
    }
}

/**
 * After the transition the widget still answers the user: shown as rendered, it takes the change again; shown changed,
 * its undo (when it has one) takes the change back, the change is made again, and undone again. A widget showing the
 * server's values is left as it is.
 */
async function stillWorks(component: Component, scope: Locator, shown: State, { leaveChanged = false } = {}) {
    if ('server' === shown || ('changed' === shown && !component.undo)) {
        return;
    }
    if ('changed' === shown) {
        await component.undo!(scope, false);
        await check(component, scope, 'rendered');
    }
    await component.change(scope);
    await check(component, scope, 'changed');
    if ('changed' === shown && !leaveChanged) {
        await component.undo!(scope, true);
        await check(component, scope, 'rendered');
    }
}

type RunOptions = {
    /** The scope the widget is in after the transition: `scope` by default. */
    after?: () => Locator;
    /** The transition leaves the widget in place: a kept widget also keeps what `keeps` checks. */
    inPlace?: boolean;
    /** Whether the cell ends here, with `stillWorks`: true unless the cell goes on. */
    last?: boolean;
};

/** Changes the widget in `scope`, runs `transition`, expects `expected` in the scope `after` gives, and that it still works. */
async function runCell(component: Component, scope: Locator, expected: State, transition: () => Promise<void>, { after = () => scope, inPlace = false, last = true }: RunOptions = {}) {
    await scope.page().evaluate(() => ((window as any).__vmStart = { listeners: (window as any).__globalListeners?.() ?? {} }));
    await check(component, scope, 'rendered');
    await component.change(scope);
    await check(component, scope, 'changed');
    await transition();
    await check(component, after(), expected);
    if (inPlace && 'changed' === expected) {
        await component.keeps?.(after());
    }
    if (last) {
        await stillWorks(component, after(), expected);
    }
}

const matrixSite: Site = {
    name: 'value-matrix',
    cells: {
        back: async (page, component, expected) => {
            await openMatrix(page, component);
            await runCell(component, region(page, 'plain'), expected, async () => {
                await visitFromCode(page, matrixPage(component, 'two'), 'Page two');
                await back(page, 'Page one');
                await settled(page);
            });
        },
        forward: async (page, component, expected) => {
            await openMatrix(page, component);
            await visitFromCode(page, matrixPage(component, 'two'), 'Page two');
            await settled(page);
            await runCell(component, region(page, 'plain'), expected, async () => {
                await back(page, 'Page one');
                await forward(page, 'Page two');
                await settled(page);
            });
        },
        'frame-inside': async (page, component, expected) => {
            await openMatrix(page, component);
            await runCell(component, region(page, 'framed'), expected, async () => {
                await reloadFrame(page, 'value-matrix-frame', matrixPage(component));
                await settled(page);
            });
        },
        'frame-outside': async (page, component, expected) => {
            await openMatrix(page, component);
            await runCell(component, region(page, 'plain'), expected, () => reloadFrame(page, 'value-matrix-frame', matrixPage(component)), { inPlace: true });
        },
        'frame-advance': async (page, component, expected) => {
            await openMatrix(page, component);
            const scope = region(page, 'plain');
            const before = page.url();
            await runCell(component, scope, expectation(component, 'frame-outside'), () => advanceFrame(page, 'value-matrix-frame', matrixPage(component)), { inPlace: true, last: false });
            const advanced = page.url();
            await turboOperation(page, { url: before }, () => page.goBack());
            await shown(page, 'Page one');
            await settled(page);
            await check(component, scope, expected);
            await turboOperation(page, { url: advanced }, () => page.goForward());
            await shown(page, 'Page one');
            await settled(page);
            const afterForward = expectation(component, 'forward');
            await check(component, scope, afterForward);
            await stillWorks(component, scope, afterForward);
        },
        'stream-replace': async (page, component, expected) => {
            await openMatrix(page, component);
            await runCell(component, region(page, 'streamed'), expected, async () => {
                await streamFromCode(page, MATRIX.one, 'replace', region(page, 'streamed').getByTestId('stream-action'), { only: component.widget! });
                await settled(page);
            });
        },
        'stream-update': async (page, component, expected) => {
            await openMatrix(page, component);
            await runCell(component, region(page, 'streamed'), expected, async () => {
                await streamFromCode(page, MATRIX.one, 'update', region(page, 'streamed').getByTestId('stream-action'), { only: component.widget! });
                await settled(page);
            });
        },
        'stream-rest': async (page, component, expected) => {
            await openMatrix(page, component);
            await runCell(
                component,
                region(page, 'plain'),
                expected,
                () => streamFromCode(page, MATRIX.one, 'replace', region(page, 'streamed').getByTestId('stream-action'), { only: component.widget! }),
                { inPlace: true },
            );
        },
        live: async (page, component, expected) => {
            if (component.rerender) {
                // a component that is a Live Component itself re-renders on the matrix page
                await openMatrix(page, component);
                await runCell(component, region(page, 'plain'), expected, () => component.rerender!(page, region(page, 'plain')), { inPlace: true });
                return;
            }
            await page.goto(MATRIX.live);
            await settled(page);
            const root = page.getByTestId('live-values');
            await runCell(
                component,
                root,
                expected,
                async () => {
                    await liveAction(root, 'serverValues');
                    await expect(root.getByTestId('renders')).toHaveText('1');
                    await settled(page);
                },
                { inPlace: true },
            );
        },
        permanent: async (page, component, expected) => {
            await openMatrix(page, component);
            await runCell(component, region(page, 'kept'), expected, async () => {
                await visitFromCode(page, matrixPage(component, 'two'), 'Page two');
                await settled(page);
                await check(component, region(page, 'kept'), expected);
                // moved into page two, it answers there too (a controller that left its listeners behind would answer
                // twice), and is left changed again for Back
                await stillWorks(component, region(page, 'kept'), expected, { leaveChanged: true });
                await back(page, 'Page one');
                await settled(page);
            });
        },
    },
};

const DT = { table: '/lab/data-table-frame', away: '/lab/turbo-nav/two' };
const dataTableSite: Site = {
    name: 'data-table-frame',
    cells: {
        back: async (page, component, expected) => {
            await page.goto(DT.table);
            await runCell(component, page.locator('main'), expected, async () => {
                await visitFromCode(page, DT.away);
                await turboOperation(page, { url: DT.table }, () => page.goBack());
                await turboVisitDone(page);
            });
        },
        forward: async (page, component, expected) => {
            await page.goto(DT.away);
            await visitFromCode(page, DT.table);
            await runCell(component, page.locator('main'), expected, async () => {
                await turboOperation(page, { url: DT.away }, () => page.goBack());
                await turboOperation(page, { url: DT.table }, () => page.goForward());
                await turboVisitDone(page);
            });
        },
        'frame-inside': async (page, component, expected) => {
            await page.goto(DT.table);
            await runCell(component, page.locator('main'), expected, async () => {
                // the table's own frame visit, promoted to history (its pager's link, from the page's code)
                const observer = await observeTurbo(page, { frame: 'orders', url: (url) => '2' === url.searchParams.get('page') });
                const href = await page.getByRole('link', { name: 'Page 2' }).getAttribute('href');
                await page.evaluate((href) => (window as any).Turbo.visit(href, { frame: 'orders', action: 'advance' }), href);
                await observer.done();
                await turboVisitDone(page);
            });
        },
    },
};

/*
 * The Live table's page at the URL its Live Component writes (it replaces the URL with every property mapped to it): Turbo
 * caches the page under the URL it was opened at, so Back to the URL Live wrote would miss the cache and load the page
 * anew, which shows nothing of what the copy holds.
 */
const DTL = { table: '/lab/data-table-live?q=&sort=number&dir=desc&page=1&size=10', away: '/lab/turbo-nav/two', frame: '/lab/data-table-live-frame', stream: '/lab/data-table-live-stream', kept: '/lab/data-table-live-permanent' };
const liveTable = (page: Page) => page.locator('[data-controller~="live"]').filter({ has: page.getByRole('table') });
const dataTableLiveSite: Site = {
    name: 'data-table-live',
    cells: {
        back: async (page, component, expected) => {
            await page.goto(DTL.table);
            await runCell(component, page.locator('main'), expected, async () => {
                await visitFromCode(page, DTL.away);
                await page.goBack();
                await expect(page).toHaveURL(/\/lab\/data-table-live/);
                await turboVisitDone(page);
            });
        },
        forward: async (page, component, expected) => {
            await page.goto(DTL.away);
            await visitFromCode(page, DTL.table);
            await runCell(component, page.locator('main'), expected, async () => {
                await turboOperation(page, { url: DTL.away }, () => page.goBack());
                await page.goForward();
                await expect(page).toHaveURL(/\/lab\/data-table-live/);
                await turboVisitDone(page);
            });
        },
        'frame-inside': async (page, component, expected) => {
            await page.goto(DTL.frame);
            await runCell(component, page.locator('main'), expected, () => reloadFrame(page, 'live-table-frame', DTL.frame));
        },
        'frame-outside': async (page, component, expected) => {
            await page.goto(DTL.table);
            await runCell(component, page.locator('main'), expected, () => reloadFrame(page, 'beside-table-frame', DTL.table));
        },
        'stream-replace': async (page, component, expected) => {
            await page.goto(DTL.stream);
            await runCell(component, page.locator('main'), expected, () => streamFromCode(page, DTL.stream, 'replace', page.getByTestId('stream-action')));
        },
        'stream-update': async (page, component, expected) => {
            await page.goto(DTL.stream);
            await runCell(component, page.locator('main'), expected, () => streamFromCode(page, DTL.stream, 'update', page.getByTestId('stream-action')));
        },
        'stream-rest': async (page, component, expected) => {
            await page.goto(DTL.table);
            await runCell(component, page.locator('main'), expected, () => streamFromCode(page, DTL.table, 'replace', page.getByTestId('stream-action')));
        },
        live: async (page, component, expected) => {
            await page.goto(DTL.table);
            await runCell(component, page.locator('main'), expected, () => component.rerender!(page, page.locator('main')), { inPlace: true });
        },
        permanent: async (page, component, expected) => {
            await page.goto(DTL.kept);
            await runCell(component, page.locator('main'), expected, async () => {
                await visitFromCode(page, '/lab/data-table-live-permanent/two', 'Page two');
                await check(component, page.locator('main'), expected);
                await stillWorks(component, page.locator('main'), expected, { leaveChanged: true });
                await back(page, 'Page one');
            });
        },
        'leave-return': async (page, component, expected) => {
            await page.goto(DTL.table);
            await runCell(component, page.locator('main'), expected, async () => {
                await visitFromCode(page, DTL.away);
                await visitFromCode(page, DTL.table);
            });
        },
    },
};

const LIVE_TABLE_ADVANCE = 'a frame beside it whose visits are promoted to history writes its own URL over the one the Live table wrote: two owners of one URL, which no recipe documents';

const GET_IN_LIVE = 'a Live Component binds its fields to properties, whatever form holds them: the POST row\'s Live cell runs this widget';

const COMPONENTS: Component[] = [
    { row: 'a text field in a GET form (input)', widget: 'get-name', kind: 'get-field', site: matrixSite, ...textField('get'), na: { live: GET_IN_LIVE } },
    { row: 'a checkbox in a GET form (checkbox)', widget: 'get-agree', kind: 'get-field', site: matrixSite, ...checkbox('get', 'Agree') },
    { row: 'an autocomplete in a GET form', widget: 'get-fruit', kind: 'get-field', site: matrixSite, ...autocomplete('get'), controllers: ['symfony--ux-autocomplete--autocomplete', 'autocomplete-sync'], na: { live: GET_IN_LIVE } },
    { row: 'a date picker in a GET form', widget: 'get-due', kind: 'get-field', site: matrixSite, ...datePicker('get'), controllers: ['date-picker', 'calendar'], na: { live: GET_IN_LIVE } },
    { row: 'a calendar in a GET form', widget: 'get-day', kind: 'get-field', site: matrixSite, ...calendar('get'), controllers: ['calendar'] },
    { row: 'a text field in a POST form (input)', widget: 'post-name', kind: 'post-field', site: matrixSite, ...textField('post') },
    { row: 'a toggle in a POST form', widget: 'post-notify', kind: 'post-field', site: matrixSite, ...checkbox('post', 'Notify me') },
    { row: 'an autocomplete in a POST form', widget: 'post-fruit', kind: 'post-field', site: matrixSite, ...autocomplete('post'), controllers: ['symfony--ux-autocomplete--autocomplete', 'autocomplete-sync'] },
    { row: 'a date picker in a POST form', widget: 'post-due', kind: 'post-field', site: matrixSite, ...datePicker('post'), controllers: ['date-picker', 'calendar'] },
    { row: 'an editor in a POST form', widget: 'post-body', kind: 'post-field', site: matrixSite, ...editor, controllers: ['editor'] },
    {
        row: 'a markdown editor in a POST form', widget: 'post-notes',
        kind: 'post-field',
        site: matrixSite,
        ...markdownEditor,
        controllers: ['markdown-editor', 'live'],
        // it is a Live Component itself: its Preview tab re-renders it
        rerender: async (_page, scope) => {
            const notes = group(scope, 'post').locator('[data-controller~="markdown-editor"]');
            await notes.getByRole('tab', { name: 'Preview' }).click();
            await expect(notes.getByRole('tabpanel')).toContainText('Changed.');
            await notes.getByRole('tab', { name: 'Write' }).click();
        },
    },
    { row: 'a dropzone in a POST form', widget: 'post-file', kind: 'post-field', site: matrixSite, ...dropzone, controllers: ['symfony--ux-dropzone--dropzone', 'dropzone-assist'], liveProp: false },
    { row: 'tabs (the selected tab)', widget: 'tabs', kind: 'chosen-ui', site: matrixSite, ...tabs, controllers: ['tabs'] },
    { row: 'a dropdown left open', widget: 'menu', kind: 'open-ui', site: matrixSite, ...overlay('Menu', (scope) => group(scope, 'ui').getByRole('menuitem', { name: 'Menu item' })), controllers: ['dropdown'] },
    { row: 'a popover left open', widget: 'popover', kind: 'open-ui', site: matrixSite, ...popover, controllers: ['popover'] },
    { row: 'a modal left open', widget: 'dialog', kind: 'open-ui', site: matrixSite, ...dialog('Dialog', 'In a modal.'), controllers: ['flowbite-modal'] },
    { row: 'a drawer left open', widget: 'drawer', kind: 'open-ui', site: matrixSite, ...dialog('Drawer', 'In a drawer.'), controllers: ['drawer'] },
    { row: 'a side-nav branch opened', widget: 'tree', kind: 'stored', site: matrixSite, ...sideNav, controllers: ['side-nav'], fresh: 'changed' },
    { row: 'the theme toggle', widget: 'theme', kind: 'stored', site: matrixSite, ...themeToggle, controllers: ['theme-toggle'], fresh: 'changed' },
    {
        row: 'a data table form edited and not applied (data-table)',
        kind: 'get-field',
        site: dataTableSite,
        controllers: ['data-table'],
        // every control of the table's form: the search, the filter and the page size
        change: async (scope) => {
            await scope.getByLabel('Search', { exact: true }).fill('bonnie');
            await scope.getByLabel('Status').selectOption('paid');
            await scope.getByLabel('Rows per page').selectOption('50');
            await leaveField(scope);
        },
        shows: async (scope, state) => {
            const [search, status, size] = 'changed' === state ? ['bonnie', 'paid', '50'] : ['', '', '10'];
            // soft: a failure names every control that does not match
            await expect.soft(scope.getByLabel('Search', { exact: true }), 'Search').toHaveValue(search);
            await expect.soft(scope.getByLabel('Status'), 'Status').toHaveValue(status);
            await expect(scope.getByLabel('Rows per page'), 'Rows per page').toHaveValue(size);
        },
        na: {
            'frame-outside': 'the table is its Turbo Frame: no part of it sits outside',
            'frame-advance': 'the table is its Turbo Frame, whose own visits are promoted to history: the frame-inside cell',
            'stream-replace': 'its region is its Turbo Frame, one owner per region: a Stream replaces the frame or the page, the frame-inside cell',
            'stream-update': 'its region is its Turbo Frame, one owner per region: a Stream replaces the frame or the page, the frame-inside cell',
            'stream-rest': 'its region is its Turbo Frame, one owner per region: a Stream beside it is a frame-outside cell, which has no part',
            live: 'not a Live Component: data-table-live is',
            permanent: 'its state is the URL\'s: the recipe documents its frame, a permanent table would show another page\'s URL state',
        },
    },
    {
        row: 'a Live data table page (data-table-live, in the URL)',
        kind: 'live-table-url',
        site: dataTableLiveSite,
        controllers: ['data-table-live', 'live'],
        na: { 'frame-advance': LIVE_TABLE_ADVANCE },
        url: 'changed',
        change: async (scope) => {
            await scope.getByRole('link', { name: 'Page 2' }).click();
            await expect(tableStatus(scope)).toHaveText('Showing 11–20 of 57');
            await expect.poll(() => new URL(scope.page().url()).searchParams.get('page')).toBe('2');
        },
        shows: async (scope, state) => expect(tableStatus(scope)).toHaveText(pick(state, { rendered: 'Showing 1–10 of 57', changed: 'Showing 11–20 of 57', server: 'Showing 1–25 of 57' })),
        // the table is still live: its pager loads the first page
        undo: async (scope) => {
            await scope.getByRole('link', { name: 'Page 1', exact: true }).click();
            await expect.poll(() => new URL(scope.page().url()).searchParams.get('page')).toBe('1');
        },
        // a page size change: the server goes back to the first page
        rerender: async (page, scope) => {
            await scope.getByLabel('Rows per page').selectOption('25');
            await expect(scope.getByLabel('Rows per page')).toHaveValue('25');
        },
    },
    {
        row: 'a Live data table selection (data-table-live)',
        kind: 'live-table-selection',
        site: dataTableLiveSite,
        controllers: ['data-table-live', 'live'],
        na: { 'frame-advance': LIVE_TABLE_ADVANCE },
        change: async (scope) => {
            await scope.getByRole('checkbox', { name: 'Select row 57' }).check();
            await expect(selectionStatus(scope)).toHaveText('1 selected');
        },
        shows: async (scope, state) => {
            const selected = 'changed' === state;
            await expect(selectionStatus(scope)).toHaveText(selected ? '1 selected' : '0 selected');
            await expect(scope.getByRole('checkbox', { name: 'Select row 57' })).toBeChecked({ checked: selected });
        },
        undo: async (scope) => {
            await scope.getByRole('checkbox', { name: 'Select row 57' }).uncheck();
            await expect(selectionStatus(scope)).toHaveText('0 selected');
        },
        // the server clears the selection
        rerender: (page) => liveAction(liveTable(page), 'clearSelection'),
    },
];

// ---------------------------------------------------------------------------------------------------------------------
// The matrix

// independent cells: run them in parallel, and let --shard split this file
test.describe.configure({ mode: 'parallel' });

/** The policy's word for the cell (`url`, `kept`, …), for the test's title. */
const ruleOf = (component: Component, transition: Transition) => String(POLICY[component.kind][transition]);

/** The cell of `component` × `transition`: the state the policy expects, or why it does not apply. */
function cell(component: Component, transition: Transition): State | { na: string } {
    const reason = component.na?.[transition];
    if (reason) {
        return { na: reason };
    }
    const rule = POLICY[component.kind][transition];
    switch (rule) {
        case 'url':
            return component.url ?? 'rendered';
        case 'kept':
            return 'changed';
        case 'fresh':
            return component.fresh ?? 'rendered';
        case 'server':
            return false === component.liveProp ? 'changed' : 'server';
        case 'reset':
            return 'rendered';
        default:
            return rule;
    }
}

/** The state the cell of `component` × `transition` expects, for a cell that runs another transition's steps too. */
function expectation(component: Component, transition: Transition): State {
    const expected = cell(component, transition);
    if ('object' === typeof expected) {
        throw new Error(`${component.row} × ${transition} is n/a: ${expected.na}`);
    }
    return expected;
}

for (const component of COMPONENTS) {
    test.describe(component.row, () => {
        for (const transition of TRANSITIONS) {
            const expected = cell(component, transition);
            if ('object' === typeof expected) {
                continue; // n/a, with its reason: listed by the completeness test below
            }
            test(`${transition}: ${ruleOf(component, transition)}, shows it ${expected}`, async ({ page }) => {
                if (component.listeners) {
                    await trackGlobalListeners(page);
                }
                await component.site.cells[transition]!(page, component, expected);
            });
        }
    });
}

test('every cell of the matrix is an expectation the site runs, or n/a with a reason', () => {
    // a check of the definitions above, the same in every engine: it runs once, in the Chromium project
    test.skip('smoke' !== test.info().project.name, 'checks no browser: run in the smoke project only');
    const problems: string[] = [];
    for (const component of COMPONENTS) {
        for (const transition of TRANSITIONS) {
            const expected = cell(component, transition);
            if ('object' === typeof expected) {
                if (!expected.na.trim()) {
                    problems.push(`${component.row} × ${transition}: n/a without a reason`);
                }
            } else if (!component.site.cells[transition]) {
                problems.push(`${component.row} × ${transition}: expects ${expected}, but ${component.site.name} cannot run ${transition}`);
            } else if (component.site === matrixSite && !component.widget) {
                problems.push(`${component.row}: no widget key for the value matrix's pages`);
            } else if ('live' === transition && component.site !== matrixSite && !component.rerender) {
                problems.push(`${component.row} × live: no re-render`);
            }
        }
    }
    expect(problems).toEqual([]);
});
