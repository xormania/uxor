import type { Locator, Page } from '@playwright/test';
import { test, expect, turboVisitDone } from './fixtures';

// Tom Select puts one .ts-wrapper after each <select> it enhances: a second one means it was set up twice
// the Tom Select fields of /lab/autocomplete: country, languages, customer and fruit; pet, colors and size (the pets form)
const fields = 7;
const wrappers = (page: Page) => page.locator('.ts-wrapper');
// Tom Select's input (the hidden <select> has the same name)
const control = (page: Page, name: string) => page.locator('.ts-wrapper').getByRole('combobox', { name });
// the options of Tom Select's listbox (the hidden <select>'s own options are in the accessibility tree too)
const listbox = async (page: Page, control: Locator) => page.locator(`#${await control.getAttribute('aria-controls')}`);
const pick = async (page: Page, control: Locator, typed: string, option: string) => {
    const list = await listbox(page, control);
    // UX Autocomplete rebuilds Tom Select when the <select> changes (remote results arriving, a Live re-render), which
    // drops what was typed: type again until the list shows the search applied (Tom Select applies it after a delay,
    // and a pick before that would be reopened)
    await expect(async () => {
        // click the field's box, as people do: with a chosen value, a single field moves its search input off-screen
        await control.locator('xpath=ancestor::div[contains(@class, "ts-control")]').click();
        await control.fill('');
        await page.keyboard.type(typed);
        await expect(control).toHaveValue(typed, { timeout: 1000 });
        await expect(list.locator('.highlight').first()).toBeVisible({ timeout: 1000 });
    }).toPass();
    await list.getByRole('option', { name: option, exact: true }).click();
    // leave the field, so its list does not cover the next one: a multiple field keeps it open, and search results
    // arriving late open it again while the field has the focus
    await control.press('Escape');
    await control.blur();
    await expect(control).toHaveAttribute('aria-expanded', 'false');
};

test('form fields: one choice, several choices and a remote search are submitted', async ({ page }) => {
    await page.goto('/lab/autocomplete');
    await expect(wrappers(page)).toHaveCount(fields);

    await pick(page, control(page, 'Country'), 'hai', 'Haiti');
    await pick(page, control(page, 'Languages'), 'fre', 'French');
    await pick(page, control(page, 'Languages'), 'hai', 'Haitian Creole');
    await expect(page.locator('#autocomplete_demo_languages')).toHaveValues(['fr', 'ht']);
    // the remote field asks the server for its options
    await pick(page, control(page, 'Customer'), 'bon', 'Bonnie Green');

    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByTestId('submitted')).toHaveText('Submitted: HT; fr,ht; Bonnie Green');
    await expect(wrappers(page)).toHaveCount(fields);
});

test('an invalid submit shows the error on the field, still enhanced once', async ({ page, allowHttpError }) => {
    allowHttpError(/\/lab\/autocomplete$/, 422);
    await page.goto('/lab/autocomplete');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('This value should not be blank.')).toBeVisible();
    await expect(wrappers(page)).toHaveCount(fields);
    await expect(page.locator('#autocomplete_demo_country')).toHaveAttribute('aria-invalid', 'true');
    await pick(page, control(page, 'Country'), 'ja', 'Japan');
    await expect(page.locator('#autocomplete_demo_country')).toHaveValue('JP');
});

test('the component outside a form creates a value from what is typed', async ({ page }) => {
    await page.goto('/lab/autocomplete');
    const fruit = control(page, 'Fruit (outside a form)');
    await fruit.click();
    await page.keyboard.type('kiwi');
    // Tom Select's "Add …" entry has no option role
    const create = (await listbox(page, fruit)).locator('.create');
    await expect(create).toHaveText('Add kiwi...');
    await create.click();
    await expect(page.locator('#fruit')).toHaveValue('kiwi');
});

test('Turbo visits away and Back leave one working Tom Select per field', async ({ page }) => {
    await page.goto('/lab/autocomplete');
    for (let visit = 0; visit < 3; visit++) {
        await page.getByRole('link', { name: 'Leave the page' }).click();
        await expect(page).toHaveURL(/\/lab\/turbo-nav\/two$/);
        await turboVisitDone(page);
        await page.goBack();
        await expect(page).toHaveURL(/\/lab\/autocomplete/);
        await turboVisitDone(page);
        await expect(wrappers(page)).toHaveCount(fields);
    }
    await pick(page, control(page, 'Country'), 'spa', 'Spain');
    await expect(page.locator('#autocomplete_demo_country')).toHaveValue('ES');
});

test('in a Live form, a re-render keeps the chosen values and one Tom Select per field', async ({ page }) => {
    await page.goto('/lab/live-autocomplete');
    await pick(page, control(page, 'Country'), 'ita', 'Italy');
    await pick(page, control(page, 'Languages'), 'spa', 'Spanish');
    await page.getByRole('button', { name: 'Re-render' }).click();
    await expect(page.getByTestId('renders')).toHaveText('1');
    await expect(wrappers(page)).toHaveCount(2);
    await expect(page.locator('#autocomplete_demo_country')).toHaveValue('IT');
    await expect(page.locator('#autocomplete_demo_languages')).toHaveValues(['es']);
    await pick(page, control(page, 'Country'), 'ger', 'Germany');
    await expect(page.locator('#autocomplete_demo_country')).toHaveValue('DE');
});

/*
 * A reset of the field's form (a reset button, form.reset()): the <select> takes back its selected options, and Tom
 * Select shows them, through the recipe's autocomplete-sync controller, with or without the layouts' form-reset
 * controller on <body> (?bare=1), silently (no input or change event).
 */

// Tom Select's items for the <select> of that id (a multiple field's items end with their Remove button's ×)
const items = (page: Page, id: string) => page.locator(`#${id} + .ts-wrapper .ts-control .item`);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type ResetField = { id: string; label: string; form: string; name: string; rendered: Record<string, string>; picks: [string, string][]; changed: Record<string, string> };
const symfonyForm = 'form[name="autocomplete_demo"]';
const resetFields: ResetField[] = [
    { id: 'autocomplete_demo_country', label: 'Country', form: symfonyForm, name: 'autocomplete_demo[country]', rendered: { FR: 'France' }, picks: [['jap', 'Japan']], changed: { JP: 'Japan' } },
    { id: 'autocomplete_demo_languages', label: 'Languages', form: symfonyForm, name: 'autocomplete_demo[languages][]', rendered: { en: 'English', fr: 'French' }, picks: [['spa', 'Spanish']], changed: { en: 'English', fr: 'French', es: 'Spanish' } },
    { id: 'pet', label: 'Pet', form: '#pets-form', name: 'pet', rendered: { dog: 'Dog' }, picks: [['fis', 'Fish']], changed: { fish: 'Fish' } },
    { id: 'colors', label: 'Colors', form: '#pets-form', name: 'colors[]', rendered: { red: 'Red', blue: 'Blue' }, picks: [['gre', 'Green']], changed: { red: 'Red', blue: 'Blue', green: 'Green' } },
    // outside the pets form, tied to it by its form attribute
    { id: 'size', label: 'Size (outside the form)', form: '#pets-form', name: 'size', rendered: { medium: 'Medium' }, picks: [['lar', 'Large']], changed: { large: 'Large' } },
];

/** Expects the native <select>, what its form sends, and Tom Select's items, to hold `values` (value => label). */
const expectField = async (page: Page, field: ResetField, values: Record<string, string>) => {
    const select = page.locator(`#${field.id}`);
    const multiple = await select.evaluate((element) => (element as HTMLSelectElement).multiple);
    if (multiple) {
        await expect(select).toHaveValues(Object.keys(values));
    } else {
        await expect(select).toHaveValue(Object.keys(values)[0]);
    }
    await expect(items(page, field.id)).toHaveText(Object.values(values).map((label) => new RegExp(`^${escape(label)}`)));
    expect(await items(page, field.id).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-value')))).toEqual(Object.keys(values));
    expect(await page.evaluate(([form, name]) => new FormData(document.querySelector(form) as HTMLFormElement).getAll(name), [field.form, field.name])).toEqual(Object.keys(values));
};

// counts the input and change events on the page's <select> elements, from now on
const countSelectEvents = (page: Page) =>
    page.evaluate(() => {
        const counts = { input: 0, change: 0 };
        for (const type of ['input', 'change'] as const) {
            document.addEventListener(type, (event) => (event.target as Element).matches('select') && counts[type]++, true);
        }
        (window as any).__selectEvents = counts;
    });
const selectEvents = (page: Page) => page.evaluate(() => (window as any).__selectEvents as { input: number; change: number });
// lets the events of a reset run, and the tasks after them
const settle = (page: Page, ms = 100) => page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms)), ms);

const change = async (page: Page) => {
    for (const field of resetFields) {
        for (const [typed, option] of field.picks) {
            await pick(page, control(page, field.label), typed, option);
        }
        await expectField(page, field, field.changed);
    }
};

for (const bare of [false, true]) {
    const url = `/lab/autocomplete?defaults=1${bare ? '&bare=1' : ''}`;
    const composition = bare ? 'without the layouts\' form-reset controller' : 'with the layouts\' form-reset controller';

    test(`${composition}, a reset button puts back the values rendered, in the field and in Tom Select, silently`, async ({ page }) => {
        await page.goto(url);
        if (bare) {
            await expect(page.locator('body')).not.toHaveAttribute('data-controller');
        } else {
            await expect(page.locator('body')).toHaveAttribute('data-controller', 'form-reset');
        }
        await expect(wrappers(page)).toHaveCount(fields);
        for (const field of resetFields) {
            await expectField(page, field, field.rendered);
        }
        await change(page);

        await countSelectEvents(page);
        // the Symfony form's reset reaches its own fields only
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        for (const field of resetFields) {
            await expectField(page, field, symfonyForm === field.form ? field.rendered : field.changed);
        }
        await page.getByRole('button', { name: 'Reset the pets' }).click();
        for (const field of resetFields) {
            await expectField(page, field, field.rendered);
        }
        await settle(page);
        expect(await selectEvents(page)).toEqual({ input: 0, change: 0 });
        await expect(wrappers(page)).toHaveCount(fields);
    });

    test(`${composition}, a reset cancelled in a capture listener changes nothing; the next one, from form.reset(), puts back the values`, async ({ page }) => {
        await page.goto(url);
        await change(page);
        await page.evaluate(() => {
            (window as any).__cancelReset = true;
            window.addEventListener('reset', (event) => (window as any).__cancelReset && event.preventDefault(), true);
        });
        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        await page.getByRole('button', { name: 'Reset the pets' }).click();
        await page.evaluate(() => {
            (document.querySelector('form[name="autocomplete_demo"]') as HTMLFormElement).reset();
            (document.getElementById('pets-form') as HTMLFormElement).reset();
        });
        await settle(page);
        for (const field of resetFields) {
            await expectField(page, field, field.changed);
        }

        await countSelectEvents(page);
        await page.evaluate(() => {
            (window as any).__cancelReset = false;
            (document.querySelector('form[name="autocomplete_demo"]') as HTMLFormElement).reset();
            (document.getElementById('pets-form') as HTMLFormElement).reset();
        });
        for (const field of resetFields) {
            await expectField(page, field, field.rendered);
        }
        await settle(page);
        expect(await selectEvents(page)).toEqual({ input: 0, change: 0 });
    });
}

test('a reset syncs the current Tom Select once, after the controller reconnects and after UX Autocomplete rebuilds Tom Select', async ({ page }) => {
    await page.goto('/lab/autocomplete?defaults=1');
    const pet = resetFields.find((field) => 'pet' === field.id)!;
    // counts the calls of sync() on the Tom Select the field has now
    const spySync = () =>
        page.evaluate(() => {
            const select = document.getElementById('pet') as any;
            (window as any).__syncs = 0;
            // wrapped once per Tom Select
            const sync = (select.tomselect.__unspiedSync ??= select.tomselect.sync);
            select.tomselect.sync = function (...args: unknown[]) {
                (window as any).__syncs++;
                return sync.apply(this, args);
            };
        });
    const syncs = () => page.evaluate(() => (window as any).__syncs as number);
    const resetPets = () => page.evaluate(() => (document.getElementById('pets-form') as HTMLFormElement).reset());
    const setControllers = (controllers: string) => page.evaluate((controllers) => document.getElementById('pet')!.setAttribute('data-controller', controllers), controllers);

    // the controller disconnected: a reset waiting for its event to end is dropped, and no later reset reaches it
    await spySync();
    await page.evaluate(() => {
        (document.getElementById('pets-form') as HTMLFormElement).reset();
        document.getElementById('pet')!.setAttribute('data-controller', 'symfony--ux-autocomplete--autocomplete');
    });
    await resetPets();
    await settle(page);
    expect(await syncs()).toBe(0);

    // connected again, twice: one listener
    await setControllers('symfony--ux-autocomplete--autocomplete autocomplete-sync');
    await setControllers('symfony--ux-autocomplete--autocomplete');
    await setControllers('symfony--ux-autocomplete--autocomplete autocomplete-sync');
    await pick(page, control(page, 'Pet'), 'fis', 'Fish');
    await spySync();
    await resetPets();
    await expectField(page, pet, pet.rendered);
    await settle(page);
    expect(await syncs()).toBe(1);

    // an option added to the <select>: UX Autocomplete builds a new Tom Select, which the next reset syncs
    await page.evaluate(() => {
        const select = document.getElementById('pet') as any;
        (window as any).__oldTomSelect = select.tomselect;
        select.append(new Option('Bird', 'bird'));
    });
    await expect.poll(() => page.evaluate(() => (document.getElementById('pet') as any).tomselect !== (window as any).__oldTomSelect)).toBe(true);
    await pick(page, control(page, 'Pet'), 'bir', 'Bird');
    await spySync();
    await resetPets();
    await expectField(page, pet, pet.rendered);
    await settle(page);
    expect(await syncs()).toBe(1);
    await expect(wrappers(page)).toHaveCount(fields);
});

test('in a Live form, a reset shows the values rendered in Tom Select and sends no Live request', async ({ page }) => {
    await page.goto('/lab/live-autocomplete');
    await expect(wrappers(page)).toHaveCount(2);
    // Germany chosen silently (a pick would re-render the component, which renders it as the default)
    await page.evaluate(() => (document.getElementById('autocomplete_demo_country') as any).tomselect.setValue('DE', true));
    await expect(page.locator('#autocomplete_demo_country')).toHaveValue('DE');
    await expect(items(page, 'autocomplete_demo_country')).toHaveText(['Germany']);

    await countSelectEvents(page);
    const requests: string[] = [];
    page.on('request', (request) => request.url().includes('/_components/') && requests.push(request.url()));
    await page.evaluate(() => (document.getElementById('autocomplete_demo_country') as HTMLSelectElement).form!.reset());
    await expect(page.locator('#autocomplete_demo_country')).toHaveValue('');
    await expect(items(page, 'autocomplete_demo_country')).toHaveCount(0);
    // longer than Live's debounce of a model update
    await settle(page, 500);
    expect(await selectEvents(page)).toEqual({ input: 0, change: 0 });
    expect(requests).toEqual([]);
});
