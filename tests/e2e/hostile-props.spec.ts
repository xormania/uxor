import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/*
 * The props that shape markup, given hostile values: `bin/console app:hostile-props`
 * (demo/src/Command/HostilePropsCommand.php) renders the components through the demo's Twig, and the browser
 * parses each rendering. No value may add an element or an event handler, `as` renders only the tags a component
 * accepts, a link prop keeps a relative, http(s), mailto or tel URL, any other rendering `#`, and no component renders
 * an attribute named `on…` (docs/GUIDE.md, Security).
 * The server-only rules behind the Editor and the MarkdownEditor (what EditorHtmlPolicy and MarkdownRenderer return)
 * are PHPUnit tests: demo/tests/Editor/EditorHtmlPolicyTest.php, demo/tests/MarkdownEditor/MarkdownRendererTest.php.
 */
type TagCase = { component: string; input: string; expected: string; html: string };
type UrlCase = { component: string; prop: string; link: string; input: string; text: string; hostile: boolean; html: string };
type ImageCase = { component: string; prop: string; input: string; text: string; html: string };
type HandlerCase = { component: string; set: number; bag: boolean; html: string };
type LegitCase = { component: string; expected: Record<string, string>; html: string };
type Cases = {
    tags: TagCase[];
    attributes: { expected: Record<string, string>; absent: string[]; html: string };
    urls: UrlCase[];
    images: ImageCase[];
    handlers: { cases: HandlerCase[]; legit: LegitCase[] };
    calendar: { html: string };
    chart: { html: string };
    editor: { html: string };
    markdown: { html: string };
    sidebar: { path: string; html: string };
};

const root = fileURLToPath(new URL('../..', import.meta.url));
// the command renders every component under several hostile sets: well past PHP's default 128M
const cases: Cases = JSON.parse(
    execFileSync(process.env.PHP_BINARY ?? 'php', ['-d', 'memory_limit=512M', 'bin/console', 'app:hostile-props'], {
        cwd: join(root, 'demo'),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    }),
);
const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];
// relative links resolve against this address; nothing is requested (no link is followed)
const BASE = 'https://app.example/dir/page';
// elements a payload could add to run script, load content or swallow the page
const UNSAFE_ELEMENTS = ['script', 'img', 'svg', 'iframe', 'object', 'embed', 'style', 'textarea', 'template', 'form', 'base', 'meta', 'link'];

type Parsed = {
    ran: unknown;
    handlers: string[];
    urlAttributes: string[];
    elements: string[];
    root: { tag: string; type: string | null } | null;
    legends: number;
    links: { href: string | null; protocol: string }[];
    image: { src: string | null; protocol: string } | null;
    textProtocol: string;
    /** The attributes of the element marked `data-testid="root"`, or null. */
    rootAttributes: Record<string, string> | null;
    /** Every URL attribute of the document, whatever the case of its name, read as the browser resolves it. */
    resolvedUrls: { tag: string; name: string; value: string; protocol: string }[];
};

/**
 * What the browser built from one case's document. It runs in the page and receives the document to read: the
 * page's own (parse), or a case's frame (parseAll). It is passed by its source, so it uses nothing from outside.
 */
function inspect(doc: Document, link: string, text: string): Parsed {
    const win = doc.defaultView as any;
    const ran = win.__xss;
    delete win.__xss;
    // the whole document: a payload's <style>, <meta> or <base> would land in <head>
    const all = [...doc.querySelectorAll('*')];
    const elements = all.filter((element) => !['html', 'head', 'body'].includes(element.localName));
    const root = doc.querySelector('[data-testid="root"]');
    const protocolOf = (url: string) => {
        try {
            // the browser's own reading of the value, as a link would resolve it
            return new URL(url, doc.baseURI).protocol;
        } catch {
            return 'invalid';
        }
    };
    const image = root && 'img' === root.localName ? (root as HTMLImageElement) : null;

    return {
        ran: ran ?? null,
        // an event handler, or a name that would be one but for leading spaces (printed escaped, `&#x20;on…`)
        handlers: elements.flatMap((element) =>
            element
                .getAttributeNames()
                .filter((name) => /^(?:&#x?[0-9a-f]+;|[\x00-\x20])*on/i.test(name))
                .map((name) => `<${element.localName} ${name}>`),
        ),
        urlAttributes: elements.flatMap((element) =>
            ['href', 'src', 'action', 'formaction', 'data', 'xlink:href'].filter((name) => element.hasAttribute(name)).map((name) => `<${element.localName} ${name}>`),
        ),
        elements: [...new Set(elements.map((element) => element.localName))],
        root: root ? { tag: root.localName, type: root.getAttribute('type') } : null,
        legends: doc.querySelectorAll('legend').length,
        links: [...doc.querySelectorAll('a')]
            .filter((a) => a.textContent?.trim() === link)
            .map((a) => ({ href: a.getAttribute('href'), protocol: a.protocol })),
        image: image ? { src: image.getAttribute('src'), protocol: image.src ? new URL(image.src).protocol : '' } : null,
        textProtocol: protocolOf(text),
        rootAttributes: root ? Object.fromEntries(root.getAttributeNames().map((name) => [name, root.getAttribute(name)!])) : null,
        resolvedUrls: all.flatMap((element) =>
            element
                .getAttributeNames()
                .filter((name) => ['href', 'formaction', 'src', 'srcset', 'ping', 'xlink:href'].includes(name))
                .map((name) => ({ tag: element.localName, name, value: element.getAttribute(name)!, protocol: protocolOf(element.getAttribute(name)!) })),
        ),
    };
}

/**
 * Loads `html` as the whole page and reports what the browser built from it, once the rendering after the load has
 * run (two animation frames): an `autofocus` element is focused there, after the load, and its `onfocus` runs then.
 */
async function parse(page: Page, html: string, link = '', text = ''): Promise<Parsed> {
    await page.setContent(html);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    return page.evaluate(`(${inspect})(document, ${JSON.stringify(link)}, ${JSON.stringify(text)})`);
}

/** A case for parseAll(): its markup, and the link text and URL text inspect() reads. */
type Item = { html: string; link?: string; text?: string };
const BATCH = 50;

/**
 * Loads each case as a document of its own, a frame's (`srcdoc`), `BATCH` frames to a page, and reports what the
 * browser built from each, read in one call per page instead of a page load and a call per case. A case's document is
 * its own: its markup, `<base>`, scripts and handlers reach no other case. A page's frames have all loaded (their
 * images too, so the handlers have run) before they are read, as a loaded page is.
 */
async function parseAll(page: Page, items: Item[]): Promise<Parsed[]> {
    const found: Parsed[] = [];
    for (let start = 0; start < items.length; start += BATCH) {
        const chunk = items.slice(start, start + BATCH).map(({ html, link = '', text = '' }) => ({ html, link, text }));
        await page.setContent('<!doctype html><title>Cases</title>');
        found.push(
            ...(await page.evaluate<Parsed[]>(`(async (inspect, chunk) => {
                const frames = chunk.map(({ html }) => Object.assign(document.createElement('iframe'), { srcdoc: html }));
                const loaded = frames.map((frame) => new Promise((resolve) => frame.addEventListener('load', resolve, { once: true })));
                document.body.append(...frames);
                await Promise.all(loaded);
                return frames.map((frame, index) => inspect(frame.contentDocument, chunk[index].link, chunk[index].text));
            })(${inspect}, ${JSON.stringify(chunk)})`)),
        );
    }

    return found;
}

/**
 * A case whose markup could run a handler that only one element of a page can trigger: `autofocus` focuses one element
 * per top-level page, its first candidate, so in a page of frames only one case's `onfocus` would run; an `accesskey`
 * belongs to the page too. Such a case is parsed alone, as the whole page, in a document of its own, where it runs as
 * it would on its own.
 */
const ONCE_PER_PAGE = /autofocus|accesskey/i;

/**
 * Checks every case and reports each case `problems` finds. A case of ONCE_PER_PAGE markup is parsed alone (parse);
 * the others in batches (parseAll). A batched case with problems is parsed again alone and reported with what that
 * finds, so a failure reads as it would on its own; a case that has problems only beside the others is reported too,
 * with those.
 */
async function check<C>(page: Page, cases: C[], item: (c: C) => Item, problems: (c: C, found: Parsed) => string[], name: (c: C) => string): Promise<string[]> {
    // a new document first: setContent() writes into the page's document, which runs its autofocus only once
    const alone = async (c: C) => {
        const { html, link, text } = item(c);
        await page.goto('about:blank');
        return problems(c, await parse(page, html, link, text));
    };
    const batchable = cases.filter((c) => !ONCE_PER_PAGE.test(item(c).html));
    const found = new Map((await parseAll(page, batchable.map(item))).map((parsed, index) => [batchable[index], parsed]));
    const failures: string[] = [];
    for (const c of cases) {
        const parsed = found.get(c);
        const batched = parsed ? problems(c, parsed) : await alone(c);
        if (!batched.length) {
            continue;
        }
        const own = parsed ? await alone(c) : batched;
        failures.push(`${name(c)}: ${(own.length ? own : [`only beside the other cases: ${batched.join('; ')}`]).join('; ')}`);
    }

    return failures;
}

/** Dismisses and records every dialog (`alert(…)` payloads). */
function recordDialogs(page: Page): string[] {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
    });

    return dialogs;
}

test('a handler only one element of a page can trigger (autofocus) is checked alone, where it runs', async ({ page }) => {
    // ordinary cases, then two whose button takes the focus as its page loads: in one page of frames only the first
    // candidate would get it, so both are parsed alone
    const planted = (run: number) => ({ name: `planted ${run}`, html: `<button autofocus onfocus="window.__xss=${run}">Go</button>` });
    const cases = [...['a', 'b', 'c'].map((text) => ({ name: text, html: `<p>${text}</p>` })), planted(1), planted(2)];
    const failures = await check(
        page,
        cases,
        ({ html }) => ({ html }),
        (_c, found) => (null !== found.ran ? [`ran a payload (${found.ran})`] : []),
        ({ name }) => name,
    );

    expect(failures).toEqual(['planted 1: ran a payload (1)', 'planted 2: ran a payload (2)']);
});

test('`as` renders only the tags each component accepts', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = recordDialogs(page);
    const failures = await check(
        page,
        cases.tags,
        ({ html }) => ({ html }),
        ({ component, expected }, found) => {
            const problems: string[] = [];
            if (found.root?.tag !== expected) {
                problems.push(`renders <${found.root?.tag ?? 'nothing'}>, expected <${expected}>`);
            }
            const unsafe = found.elements.filter((element) => UNSAFE_ELEMENTS.includes(element));
            if (unsafe.length) {
                problems.push(`adds ${unsafe.map((element) => `<${element}>`).join(', ')}`);
            }
            if (found.handlers.length) {
                problems.push(`adds handlers ${found.handlers.join(', ')}`);
            }
            // no case passes a URL: any is injected
            if (found.urlAttributes.length) {
                problems.push(`adds ${found.urlAttributes.join(', ')}`);
            }
            if (null !== found.ran) {
                problems.push(`ran a payload (${found.ran})`);
            }
            if ('Dropdown:Item' === component && 'button' === expected && 'button' !== found.root?.type) {
                problems.push('a button item without type="button"');
            }
            if ('FormField' === component && found.legends !== ('fieldset' === expected ? 1 : 0)) {
                problems.push(`${found.legends} <legend>`);
            }
            return problems;
        },
        ({ component, input }) => `${component} as=${input}`,
    );

    expect(failures).toEqual([]);
    expect(dialogs).toEqual([]);
});

test('FormField label and help attribute names cannot add attributes', async ({ page }) => {
    const dialogs = recordDialogs(page);
    const { expected, absent, html } = cases.attributes;
    const found = await parse(page, html);
    const label = page.locator('label');
    const help = page.locator('#field_help');
    await label.hover();
    await help.hover();

    for (const element of [label, help]) {
        const attributes = await element.evaluate((node) => Object.fromEntries(node.getAttributeNames().map((name) => [name, node.getAttribute(name)])));
        expect(attributes).toMatchObject(expected);
        expect(Object.keys(attributes).filter((name) => absent.includes(name) || /^(?:&#x?[0-9a-f]+;|[\x00-\x20])*on/i.test(name))).toEqual([]);
    }
    expect(found.handlers).toEqual([]);
    expect(found.elements.filter((element) => UNSAFE_ELEMENTS.includes(element))).toEqual([]);
    expect(await page.evaluate(() => (window as any).__xss ?? null)).toBeNull();
    expect(dialogs).toEqual([]);
});

test('link props keep only the schemes each component allows', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = recordDialogs(page);
    const failures = await check(
        page,
        cases.urls,
        ({ html, link, text }) => ({ html: `<base href="${BASE}">${html}`, link, text }),
        ({ component, hostile, link, text }, found) => {
            // what the browser reads the value as decides: kept as given when safe, "#" otherwise
            const protocols = ['OAuthProviderButton', 'SocialLogin'].includes(component) ? ['http:', 'https:'] : SAFE_PROTOCOLS;
            const expectedHref = protocols.includes(found.textProtocol) ? text : '#';
            const problems: string[] = [];
            if (!hostile && expectedHref !== text) {
                problems.push(`the browser reads this ordinary URL as ${found.textProtocol} (test data)`);
            }
            if (1 !== found.links.length) {
                problems.push(`${found.links.length} "${link}" links`);
            } else {
                const [{ href, protocol }] = found.links;
                if (!SAFE_PROTOCOLS.includes(protocol)) {
                    problems.push(`links to ${protocol}`);
                }
                if (href !== expectedHref) {
                    problems.push(`href ${JSON.stringify(href)}, expected ${JSON.stringify(expectedHref)}`);
                }
            }
            if (found.handlers.length) {
                problems.push(`adds handlers ${found.handlers.join(', ')}`);
            }
            if (null !== found.ran) {
                problems.push(`ran a payload (${found.ran})`);
            }
            return problems;
        },
        ({ component, prop, input }) => `${component} ${prop}=${input}`,
    );

    expect(failures).toEqual([]);
    expect(dialogs).toEqual([]);
});

test('image props keep only relative and http(s) URLs', async ({ page }) => {
    const dialogs = recordDialogs(page);
    const failures = await check(
        page,
        cases.images,
        ({ html, text }) => ({ html: `<base href="${BASE}">${html}`, text }),
        ({ text }, found) => {
            const expectedSrc = ['http:', 'https:'].includes(found.textProtocol) ? text : null;
            const problems: string[] = [];
            if (null === found.image) {
                problems.push('renders no image');
            } else {
                if (found.image.src !== expectedSrc) {
                    problems.push(`src ${JSON.stringify(found.image.src)}, expected ${JSON.stringify(expectedSrc)}`);
                }
                if (null !== expectedSrc && !['http:', 'https:'].includes(found.image.protocol)) {
                    problems.push(`loads ${found.image.protocol}`);
                }
            }
            if (found.handlers.length) {
                problems.push(`adds handlers ${found.handlers.join(', ')}`);
            }
            if (null !== found.ran) {
                problems.push(`ran a payload (${found.ran})`);
            }
            return problems;
        },
        ({ component, prop, input }) => `${component} ${prop}=${input}`,
    );

    expect(failures).toEqual([]);
    expect(dialogs).toEqual([]);
});

test('components drop attributes named on…, check URL attributes in any case, and render the others', async ({ page }) => {
    test.setTimeout(180_000);
    const dialogs = recordDialogs(page);
    const failures = await check(
        page,
        cases.handlers.cases,
        ({ html }) => ({ html: `<base href="${BASE}">${html}` }),
        ({ bag }, found) => {
            const problems: string[] = [];
            if (found.handlers.length) {
                problems.push(`renders ${found.handlers.join(', ')}`);
            }
            // every URL attribute in the page, whatever the case of its name, read as the browser resolves it
            for (const { tag, name, value, protocol } of found.resolvedUrls) {
                const allowed = 'src' === name ? ['http:', 'https:'] : ['srcset', 'ping'].includes(name) ? [] : SAFE_PROTOCOLS;
                if (!allowed.includes(protocol)) {
                    problems.push(`<${tag} ${name}=${JSON.stringify(value)}>`);
                }
            }
            // the ordinary attributes given with them still land, on the element taking the attributes
            const root = found.rootAttributes;
            if (bag && (root?.['data-extra'] !== 'ok' || root?.['aria-keyshortcuts'] !== 'k')) {
                problems.push(`renders the ordinary attributes as ${JSON.stringify(root)}`);
            }
            if (null !== found.ran) {
                problems.push(`ran a payload (${found.ran})`);
            }
            return problems;
        },
        ({ component, set }) => `${component} (set ${set})`,
    );
    failures.push(
        ...(await check(
            page,
            cases.handlers.legit,
            ({ html }) => ({ html: `<base href="${BASE}">${html}` }),
            ({ expected }, found) => {
                const root = found.rootAttributes;
                const problems: string[] = found.handlers.length ? [`renders ${found.handlers.join(', ')}`] : [];
                for (const [name, value] of Object.entries(expected)) {
                    const given = root?.[name] ?? null;
                    // `class` and `data-action` are merged with the component's own
                    if (['class', 'data-action'].includes(name) ? !given?.split(' ').includes(value) : given !== value) {
                        problems.push(`${name}=${JSON.stringify(given)}, expected ${JSON.stringify(value)}`);
                    }
                }
                return problems;
            },
            ({ component }) => `${component} (ordinary attributes)`,
        )),
    );

    expect(cases.handlers.cases.length).toBeGreaterThan(400);
    expect(failures).toEqual([]);
    expect(dialogs).toEqual([]);
});

test('the Calendar drops dates, modifier names and input attribute names it cannot trust', async ({ page }) => {
    const dialogs = recordDialogs(page);
    const found = await parse(page, cases.calendar.html);
    const root = page.getByTestId('root');
    // the one real date is kept, as the selection, the hidden input and a disabled day
    await expect(root).toHaveAttribute('data-calendar-selected-value', '["2026-03-12"]');
    await expect(root).toHaveAttribute('data-calendar-disabled-value', '["2026-03-12"]');
    await expect(root).toHaveAttribute('data-calendar-min-date-value', '');
    const input = page.locator('input[data-calendar-target="input"]');
    await expect(input).toHaveCount(1);
    expect(await input.evaluate((node) => Object.fromEntries(node.getAttributeNames().map((name) => [name, node.getAttribute(name)])))).toMatchObject({
        type: 'hidden',
        name: 'day',
        value: '2026-03-12',
        form: 'booking',
        'data-test': 'ok',
        title: 'Hint',
        'data-flag': '',
    });
    // a modifier keeps its own name only, on its real dates
    await expect(page.locator('[data-day="2026-03-12"][data-booked="true"]')).toHaveCount(1);
    const names = await page.evaluate(() => [...new Set([...document.querySelectorAll('*')].flatMap((node) => node.getAttributeNames()))]);
    expect(names.filter((name) => !/^[a-z][a-z0-9_.:-]*$/i.test(name))).toEqual([]);
    expect(names.filter((name) => ['hidden', 'autofocus'].includes(name) || /^on[a-z]+$/i.test(name))).toEqual(['hidden']);
    expect(found.handlers).toEqual([]);
    // the navigation's chevrons are the only <svg>: decorative icons
    expect(found.elements.filter((element) => UNSAFE_ELEMENTS.includes(element) && 'svg' !== element)).toEqual([]);
    await expect(page.locator('svg:not([aria-hidden="true"])')).toHaveCount(0);
    expect(found.ran).toBeNull();
    expect(dialogs).toEqual([]);
});

test('the Chart falls back to its defaults for hostile type, size and table, and prints text as text', async ({ page }) => {
    const dialogs = recordDialogs(page);
    const found = await parse(page, cases.chart.html);
    const figure = page.getByTestId('chart');
    const view = JSON.parse((await figure.locator('canvas').getAttribute('data-symfony--ux-chartjs--chart-view-value'))!);
    expect(view.type).toBe('bar');
    await expect(figure.locator('canvas').locator('..')).toHaveClass(/\bh-64\b/);
    await expect(figure.locator('details')).toHaveCount(1);
    await expect(figure).toHaveAttribute('id', 'c" onmouseover="window.__xss=1');
    await expect(figure.locator('figcaption')).toHaveText('"><svg onload=window.__xss=1>');
    await expect(figure.locator('tbody th').first()).toHaveText('<img src=x onerror=window.__xss=1>');
    await expect(figure.locator('tbody td').first()).toHaveText('<script>window.__xss=1</script>');
    expect(found.handlers).toEqual([]);
    expect(found.elements.filter((element) => UNSAFE_ELEMENTS.includes(element))).toEqual([]);
    expect(found.ran).toBeNull();
    expect(dialogs).toEqual([]);
});

test('a sidebar item whose link renders "#" is never the current page', async ({ page }) => {
    const { path, html } = cases.sidebar;
    await page.goto(path);
    await page.evaluate((sidebar) => document.body.insertAdjacentHTML('beforeend', sidebar), html);
    const nav = page.getByRole('navigation', { name: 'Hostile links' });

    // the controller has marked the current item…
    await expect(nav.getByRole('link', { name: 'Current' })).toHaveAttribute('aria-current', 'page');
    // …and not the rejected link, nor a "#…" placeholder, although they resolve to this page
    await expect(nav.getByRole('link', { name: 'Rejected' })).toHaveAttribute('href', '#');
    await expect(nav.getByRole('link', { name: 'Rejected' })).not.toHaveAttribute('aria-current');
    await expect(nav.getByRole('link', { name: 'Placeholder' })).not.toHaveAttribute('aria-current');
});

test('the MarkdownEditor prints a hostile value as text in its textarea', async ({ page }) => {
    const dialogs = recordDialogs(page);
    const found = await parse(page, cases.markdown.html);
    expect(found.handlers).toEqual([]);
    expect(found.elements.filter((element) => UNSAFE_ELEMENTS.includes(element) && !['textarea', 'svg'].includes(element))).toEqual([]);
    expect(found.ran).toBeNull();
    expect(await page.locator('textarea[name="body"]').inputValue()).toBe('</textarea><script>window.__xss=1</script><img src=x onerror="window.__xss=1">');
    expect(dialogs).toEqual([]);
});

test('the Editor prints a hostile value sanitized, in the editable area and the textarea', async ({ page }) => {
    const dialogs = recordDialogs(page);
    const found = await parse(page, cases.editor.html);
    expect(found.handlers).toEqual([]);
    // the icons are the template's own <svg>; the value adds no element beyond the preset
    expect(found.elements.filter((element) => UNSAFE_ELEMENTS.includes(element) && !['textarea', 'svg'].includes(element))).toEqual([]);
    expect(await page.getByTestId('editor').locator('[role="textbox"] svg, [role="textbox"] math, [role="textbox"] img').count()).toBe(0);
    expect(found.ran).toBeNull();
    expect(await page.locator('textarea[name="body"]').inputValue()).not.toMatch(/<script|onerror|javascript:/);
    expect(dialogs).toEqual([]);
});
