# For agents

You are a coding agent, and your human just gave you this repository's URL. This page tells you what UXor
gives you, how to set a Symfony project up for it, and how to build pages with it while writing as little code as
possible. The same text, as plain markdown:
<https://raw.githubusercontent.com/xormania/uxor/main/FOR-AGENTS.md>. Every page of the kit, with one line
each: [`llms.txt`](llms.txt).

## What you get

UXor is a [Symfony UX Toolkit](https://symfony.com/bundles/ux-toolkit/current/index.html) kit: Twig
components, Stimulus controllers, a form theme, page layouts and blocks (ready-made parts of a page), styled with
Flowbite v4 and Tailwind CSS v4. Each one is a recipe: `php bin/console ux:install <recipe>` copies its files into
the project, which then owns them.

- Every behavior is a Stimulus controller, so components keep working through Turbo visits, Turbo Frames and
  Streams, and Live Component re-renders. There is no Flowbite JavaScript.
- Colors come from the theme's color roles, which switch with light and dark and pass contrast checks.
- The components print no inline script, style or event handler: they work under a strict Content Security Policy.
- Each recipe's README is written for you: its props, its examples, and what to do in forms, Live Components and
  Turbo Frames.

## Set your human's project up

Run these on a Symfony project (`composer create-project symfony/skeleton`), once, in this order. PHP 8.4 or later
with the `zip` extension is required. With Symfony Docker, run each command in the container
(`docker compose exec php composer …`, `docker compose exec php bin/console …`).

```bash
composer config extra.symfony.allow-contrib true
composer require symfony/twig-bundle symfony/ux-twig-component
composer require --dev symfony/ux-toolkit:^3.5 symfony/http-client
composer require symfony/asset-mapper symfony/stimulus-bundle
composer require symfonycasts/tailwind-bundle
php bin/console tailwind:init          # keep Tailwind's major version 4
php bin/console importmap:require "flowbite/dist/flowbite.min.css@^4.0.2"
php bin/console ux:install theme --kit=https://github.com/xormania/uxor
```

Then make `assets/styles/app.css` start with these imports, in this order:

```css
@import 'tailwindcss';
@import '../vendor/flowbite/dist/flowbite.min.css';
@import './uxor.css';
```

Keep `php bin/console tailwind:build --watch` running while you work, or run `tailwind:build` after each change.
[`INSTALL.md`](INSTALL.md) explains each step, and Webpack Encore.

## Your first moves

1. Paste the block in [`docs/PROJECT-AGENTS-SNIPPET.md`](docs/PROJECT-AGENTS-SNIPPET.md) into the project's
   `AGENTS.md` or `CLAUDE.md`, so every later session follows the same rules.
2. Install the recipes the task needs. `ux:install` brings the recipes a recipe depends on, then prints a
   `composer require` command: run it.

   ```bash
   php bin/console ux:install <recipe> --kit=https://github.com/xormania/uxor
   ```

3. Read the recipe's README before using it: `<recipe>/README.md` in this repository.
4. Pages extend `layouts/app.html.twig` (`ux:install layouts`), or `auth`, `settings`, `error` or `blank`. A block
   such as `dashboard-home` or `login` shows a whole page, controller included, in its README.

## Which recipe

Every recipe, as [`docs/RECIPES.md`](docs/RECIPES.md) lists it:

<!-- recipes:start: written by tools/llms-txt.mjs from docs/RECIPES.md's tables; edit those, then run it -->

**Theme**

| Install | What it is |
|---|---|
| [`theme`](theme/README.md) | Flowbite's color roles, with this kit's contrast fixes and its roles for text on a solid fill (`fg-on-*`), as one stylesheet to import in `assets/styles/app.css`. A role is a named color with a light and a dark value, used as a utility: `bg-brand`, `text-heading`, `border-default`. |
| [`theme-toggle`](theme-toggle/README.md) | A button switching between the light and dark themes, remembered in `localStorage` and following the system preference until the user chooses. |

**Shared code**

| Install | What it is |
|---|---|
| [`floating`](floating/README.md) | The positioning shared by `dropdown`, `popover` (so `date-picker`) and `tooltip`, one JavaScript module: a floating element placed next to the element it belongs to, flipped to the other side when it does not fit, kept in the viewport and following it on scroll and resize. |
| [`navigation`](navigation/README.md) | What the navigation recipes (`nav-menu`, `sidebar`, `side-nav`, `section-nav`, `mobile-nav`) share, one JavaScript module: the current page's link marked `aria-current="page"`, whether a click on a link navigates this tab, a navigation opened over the page closed once the screen grows. |
| [`turbo`](turbo/README.md) | What the recipes ask about Turbo's copies of a page, one JavaScript module: whether a `turbo:before-cache` leaves the page on screen (a frame visit promoted to history) or an element is moved into the next page (`data-turbo-permanent`), and whether a controller connects in a cached copy. |

**Basic components**

| Install | What it is |
|---|---|
| [`alert`](alert/README.md) | A message for information, success, a warning or an error, optionally dismissible. |
| [`avatar`](avatar/README.md) | A user's picture, with a fallback, in several sizes, round or with rounded corners. |
| [`badge`](badge/README.md) | A small label or count next to other content, such as a number of comments. |
| [`button`](button/README.md) | A button, or a link that looks like one, in several colors, sizes and styles. |
| [`button-group`](button-group/README.md) | Several buttons or links joined into one control. |
| [`card`](card/README.md) | A box grouping related content: text, images, a form. |
| [`checkbox`](checkbox/README.md) | A square box to select one or more options. |
| [`dropdown`](dropdown/README.md) | A menu that opens from a button and closes when the user clicks or focuses outside it. |
| [`indicator`](indicator/README.md) | A dot or number placed on another element: a status, a count, a loading label. |
| [`input`](input/README.md) | A single-line field for any input type: text, email, number, password, URL… |
| [`kbd`](kbd/README.md) | A keyboard key or shortcut shown in text. |
| [`label`](label/README.md) | A text element that identifies form controls and other content. |
| [`modal`](modal/README.md) | A dialog over the page, as a native `<dialog>`, with a close button. |
| [`pagination`](pagination/README.md) | Links to the pages of a long list. |
| [`radio`](radio/README.md) | A round button to choose one option among several. |
| [`select`](select/README.md) | A list to choose one or more options. |
| [`skeleton`](skeleton/README.md) | Placeholders shaped like the content that is loading. |
| [`spinner`](spinner/README.md) | A spinning indicator for a loading state. |
| [`table`](table/README.md) | Rows and columns of data. |
| [`tabs`](tabs/README.md) | Tabs that switch between panels in place, in a row or a column, with the arrow keys of the WAI-ARIA tabs pattern. |
| [`textarea`](textarea/README.md) | A multi-line text field, for a comment or a description. |
| [`toggle`](toggle/README.md) | A switch for an on/off setting. |

**More components**

| Install | What it is |
|---|---|
| [`breadcrumb`](breadcrumb/README.md) | A trail of links showing where the current page sits in the site hierarchy. |
| [`calendar`](calendar/README.md) | Pick a date, several dates or a range inline: keyboard navigation, disabled dates and bounds, several months, locales, right to left, hidden inputs for forms and a `model` prop for Live Components. |
| [`chart`](chart/README.md) | Charts with Symfony UX Chart.js in the theme's colors, light and dark, each with its data as a table; from arrays or `ChartBuilderInterface`, updated in place by Live Components. |
| [`data-table`](data-table/README.md) | A server-driven table: search, filters, sortable columns, page size and pages in a Turbo Frame, with Back and Forward through each state. Copies PHP classes into `src/UXor/`. |
| [`data-table-live`](data-table-live/README.md) | `data-table` as a Live Component: search while typing, filters, sorting, pages and row selection for bulk actions, its state in the URL. Copies PHP classes into `src/UXor/`. |
| [`date-picker`](date-picker/README.md) | A date or a range picked in a calendar that opens from a button or a typed field; a `DateType` opts in through the form theme. |
| [`drawer`](drawer/README.md) | A panel sliding over one side of the page, for navigation, filters or details, as a native `<dialog>`. |
| [`empty-state`](empty-state/README.md) | What a list or page shows when it has nothing yet, with a way forward. |
| [`mobile-nav`](mobile-nav/README.md) | The app's navigation on small screens: a menu button in the navbar opening a modal drawer that holds the side nav, closed by a link, Escape, the backdrop and every Turbo visit. |
| [`nav-menu`](nav-menu/README.md) | The navbar's menu: links and buttons opening submenus of links, nested at any depth, as a disclosure navigation; the current page and its submenus are marked, and the same menu opens in place in a mobile nav's drawer. |
| [`navbar`](navbar/README.md) | The bar on top of the app: brand, navigation menu, search, actions, and the menu button opening the sidebar or a mobile nav on small screens. |
| [`page-header`](page-header/README.md) | The top of a page: its title, a short description and the page's actions. |
| [`popover`](popover/README.md) | Free content anchored to a button (text, links, a small form) in a non-modal dialog that closes on Escape, a click outside or when the focus leaves it. |
| [`progress`](progress/README.md) | A bar showing how far a task has come. |
| [`section-nav`](section-nav/README.md) | Vertical tabs that navigate: one link per page of a group of pages (settings), the current one marked, a column on large screens and a strip that scrolls sideways on small ones. |
| [`side-nav`](side-nav/README.md) | A multi-level navigation tree: links in branches that open and close, at any depth, with the keyboard of an ARIA tree view; the open branches hold across Turbo visits, and the branch of the current page opens. |
| [`sidebar`](sidebar/README.md) | The app's main navigation: grouped links with icons and counts, collapsible to icons, opened over the page on small screens. |
| [`stat-card`](stat-card/README.md) | A key figure with its label and, optionally, how it changed over a period. |
| [`toast`](toast/README.md) | Short-lived notifications in a fixed region, added on page load or by Turbo Streams, dismissed after a timeout or by the user. |
| [`tooltip`](tooltip/README.md) | A short text shown while a control is hovered or focused, also announced as its description. |

**Forms**

| Install | What it is |
|---|---|
| [`form-theme`](form-theme/README.md) | A Symfony form theme that renders every row through `FormField` and every control through the kit's `Input`, `Select`, `Textarea`, `Checkbox`, `Radio`, `Label` and `Button` components. |
| [`form-field`](form-field/README.md) | A labelled form control with its help text and error message, wired by id (used by the form theme). |
| [`autocomplete`](autocomplete/README.md) | Searchable selects with Symfony UX Autocomplete (Tom Select), styled with the theme: one choice, several, values typed by the user, options searched on the server. Works through the form theme (`'autocomplete' => true`) and as an `Autocomplete` component outside forms. |
| [`dropzone`](dropzone/README.md) | File uploads with Symfony UX Dropzone, styled with the theme: drag and drop or browse, a preview of the picked image, several files that add up across picks, keyboard focus kept after a pick or a removal; a `DropzoneType` renders as one through the form theme. |
| [`editor`](editor/README.md) | A rich text editor (Tiptap) that stores restricted HTML: paragraphs, bold, italic, strike, code, headings, lists, quotes, links; a keyboard-friendly toolbar, a link dialog, a counter. `EditorType` sanitizes every submit (symfony/html-sanitizer), and `flowbite_editor_html` prints stored HTML. |
| [`markdown-editor`](markdown-editor/README.md) | A Markdown field: a native textarea with a small toolbar, and a Preview tab rendered on the server (a Live Component) exactly as the stored Markdown will print; raw HTML, images and unsafe links never reach the page. `MarkdownType` limits the source, and `flowbite_markdown_html` prints it. |

**Layouts**

| Install | What it is |
|---|---|
| [`layouts`](layouts/README.md) | Page layouts to extend: an app shell with sidebar, navbar with its menu, and mobile nav, a centered column for login, signup and password reset, settings, errors and a blank page. |

**Blocks**

| Install | What it is |
|---|---|
| [`dashboard-home`](dashboard-home/README.md) | A dashboard home: page header, key figures, two cards and a table of recent orders. |
| [`login`](login/README.md) | A sign-in card rendering a Symfony login form through the form theme, with the last authentication error. |
| [`signup`](signup/README.md) | A registration card rendering a Symfony form through the form theme. |
| [`forgot-password`](forgot-password/README.md) | A card asking for an email address to send a password reset link, then confirming it was sent. |
| [`settings-profile`](settings-profile/README.md) | A profile settings card: avatar, name and a Symfony form rendered through the form theme. |
| [`not-found`](not-found/README.md) | The content of a 404 (or any error) page: status, title, explanation and a way back. |

<!-- recipes:end -->

Where two recipes are close:

- **Navigation.** The app's shell is [`layouts`](layouts/README.md) (sidebar, navbar, mobile nav, flash toasts).
  Links more than one level deep: [`side-nav`](side-nav/README.md), in the `Sidebar`. Pages of one area, each its own
  URL (settings): [`section-nav`](section-nav/README.md). Panels switched in place on one page:
  [`tabs`](tabs/README.md). Menus in the top bar: [`nav-menu`](nav-menu/README.md), in the `Navbar`'s `nav` block
  (`layouts`: `navbar_nav`).
- **Lists of records.** [`data-table`](data-table/README.md) in a Turbo Frame; [`data-table-live`](data-table-live/README.md)
  as a Live Component for row selection, bulk actions or search while typing.
- **Next to a button.** A menu of actions: [`dropdown`](dropdown/README.md). Free content (text, links, a small
  form): [`popover`](popover/README.md). A hint on hover or focus: [`tooltip`](tooltip/README.md).
- **Text fields.** Rich text stored as HTML: [`editor`](editor/README.md). Markdown with a preview, for technical
  users: [`markdown-editor`](markdown-editor/README.md).

## Working well

- **Install a recipe, never write raw Flowbite HTML** for something the kit has. Never `import 'flowbite'` or call
  `initFlowbite()`.
- **Colors through the theme's roles only** (`bg-brand`, `text-heading`, `text-body`, `border-default`…), never
  palette colors such as `bg-blue-700` or `text-white`, and no `dark:` color overrides. Text on a solid fill uses that
  fill's on-fill role: `text-fg-on-brand` on `bg-brand`, and `fg-on-success`, `fg-on-danger`, `fg-on-warning`,
  `fg-on-dark` on theirs.
- **Icons from UX Icons' `flowbite` set**, each name written in full (`flowbite:check-circle-outline`), then
  `php bin/console ux:icons:lock` and commit `assets/icons/`.
- **Form controllers answer 303 or 422**: redirect with `Response::HTTP_SEE_OTHER` on success, render the invalid
  form (422) on errors. Turbo Drive rejects a 200 after a submit.
- **Opt form fields in, with no template code**: `'autocomplete' => true` on a choice field;
  `'widget' => 'single_text', 'block_prefix' => 'flowbite_date_picker'` on a `DateType`.
- **No colors in chart data**: the theme's chart roles apply; for a color of your own, write a role as
  `'var(--color-…)'`.
- **Stable ids in re-rendered markup**: inside a Live Component or a Turbo Frame, give `Tooltip`, `Popover`,
  `DatePicker` and `Chart` an explicit `id`.
- **Toasts go through Turbo Streams**: render `<twig:Toast:Stream>` in the page or in a Stream response, never
  inside the permanent toast region.
- **Back shows a GET form as the URL says, a POST form as the user left it**: the layouts' `<body>` carries
  `data-controller="form-reset"`; keep it in a layout of your own. Use GET for filters and searches, POST for edits.
- **One owner per region**: a Live Component or a Turbo Frame or Stream, not both.
- **Props and attributes are trusted input**: give `as`, attribute names and URLs values the code chose, never
  request or user data unchecked. Validate dates and bounds on the server: the calendar's only guide the user.
- **No inline `<script>`, `<style>`, `style="…"` or `onclick="…"`** in templates: behavior goes in Stimulus
  controllers, styles in Tailwind classes.
- **Check your work in a browser** in light and dark: the recipes' READMEs show what each example should look like.

## Updating

Recipes are copies the project owns. Commit first, then reinstall from a newer version with `--force` and review
`git diff`:

```bash
php bin/console ux:install <recipe> --kit=https://github.com/xormania/uxor:<version> --force
```

Versions are git tags `X.Y.Z` ([`CHANGELOG.md`](CHANGELOG.md)). Without a version, `ux:install` takes `main`, the last
release; `:dev` takes the work merged since.

## Quick reference

| You need | Read |
|---|---|
| Every page, one line each | [`llms.txt`](llms.txt) |
| The rules to paste into the project | [`docs/PROJECT-AGENTS-SNIPPET.md`](docs/PROJECT-AGENTS-SNIPPET.md) |
| Every recipe, one line each | [`docs/RECIPES.md`](docs/RECIPES.md) |
| A recipe's props and examples | `<recipe>/README.md` |
| Each setup step explained | [`INSTALL.md`](INSTALL.md) |
| Turbo, Live Components, security | [`docs/GUIDE.md`](docs/GUIDE.md#turbo-and-live-components) |
| Every example rendered, light and dark | <https://xormania.github.io/uxor/> |
| Testing an app built with the kit (Turbo, Live, CSP, request limits) | [`docs/TESTING.md`](docs/TESTING.md) |
| Changing the kit itself | [`CONTRIBUTING.md`](CONTRIBUTING.md), [`AGENTS.md`](AGENTS.md) |
