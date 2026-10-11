# Changelog

All notable changes to UXor. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/) as git tags (`X.Y.Z`, no `v`).

## [Unreleased]

### Added

- `data-table`: a server-driven table (search, filters, sortable columns, page size, pages) in a Turbo Frame, with
  the PHP classes a table extends (`AbstractDataTable`) copied into `src/UXor/DataTable/`. A table counts its
  rows (`countRows()`), then loads one page once (`loadRows()`); no page starts past `maxRows()` rows (10,000), so a
  request never makes the database skip more. `Filter::choice()` takes `array<int|string, string>` choices. Back and
  Forward walk every state, and the `data-table` controller makes the form show the URL's state in every field; Back
  pressed while a change is still loading cancels the change, so the URL and the table never disagree. Its checks of
  Turbo's cached copies are the `turbo` recipe's module, which it installs with it.
- `data-table-live`: `data-table` as a Live Component (`AbstractLiveDataTable`), with row selection for bulk actions;
  its state is in the URL. The selection holds at most `maxSelection()` ids (1,000) of at most 128 characters,
  enforced on what the browser sends before anything uses it; leaving the page drops it, and Back and Forward do not
  bring it back. Its checks of Turbo's cached copies are the `turbo` recipe's module, which it installs with it.
- `autocomplete`: searchable selects with Symfony UX Autocomplete (Tom Select), styled with the theme, through the
  form theme (`'autocomplete' => true`) or the `Autocomplete` component. Its `autocomplete-sync` controller keeps Tom
  Select showing the `<select>`'s value after a Live re-render, a form reset and Back, and the hidden `<select>` keeps
  its label's name (`aria-labelledby`).
- `popover`: free content anchored to a button, in a non-modal dialog; it closes on Escape, a click outside or when
  the focus leaves it, and before Turbo caches the page. Beside a frame visit promoted to history (a data table's
  pages) it stays open, and Back shows it closed. Its checks of Turbo's cached copies are the `turbo` recipe's module,
  which it installs with it.
- `calendar`: pick a date, several dates or a range, with hidden inputs for forms (dispatching `input` and `change`)
  and a `model` prop for Live Components; invalid dates are ignored, and a range never spans a disabled day. It
  follows a reset of its form, unless a listener cancels the reset.
- `date-picker`: a `Calendar` in a `Popover`, opened from a button or a field where the date can be typed; a
  `DateType` with `'block_prefix' => 'flowbite_date_picker'` renders as one through the form theme.
- `dropzone`: file uploads with Symfony UX Dropzone, styled with the theme: drag and drop or browse, a preview of
  the picked image, several files that add up across picks; focus follows a pick or a removal, and a file dropped
  outside the input is refused. In a POST form, the file picked shows again after Back and Forward. Its checks of
  Turbo's cached copies are the `turbo` recipe's module, which it installs with it.
- `chart`: charts drawn with Symfony UX Chart.js in the theme's colors, light and dark, each with its data as a table;
  from arrays or a `ChartBuilderInterface` chart, updated in place by Live Components.
- `editor`: a rich text editor (Tiptap) storing restricted HTML, with a keyboard-friendly toolbar, a link dialog and
  a counter; `EditorType` sanitizes every submit with symfony/html-sanitizer and refuses too long input (a 422 with the
  field's error, never a cut value), and the `flowbite_editor_html` filter prints stored HTML. White space is stored as
  the editor shows it, and the server counts characters as the counter does. Back, also from a frame visit promoted to
  history, builds the editor again with its content.
- `markdown-editor`: a Markdown field, a native textarea with a toolbar writing Markdown and a Preview tab rendered on
  the server by a Live Component; `MarkdownType` refuses too long input, and the `flowbite_markdown_html` filter prints
  stored Markdown the same way (CommonMark without raw HTML or images, then sanitized). Back keeps what was typed.
- `side-nav`: a multi-level navigation tree (WAI-ARIA tree view): links in branches that open and close at any depth,
  arrow keys, Home, End and type-ahead, the branch of the current page open, and the open branches kept across Turbo
  visits, Back and Forward in `sessionStorage` (two trees sharing a `storageKey` agree). Its current-link marking is
  the `navigation` recipe's module, which it installs with it.
- `mobile-nav`: the app's navigation on small screens, in a modal `Drawer` opened by a menu button in the `Navbar`
  (`menu` block); the focus goes to the current page, and the drawer closes on a link, Escape, the backdrop, before
  Turbo caches the page and when the screen grows to the sidebar's width. Its link-follow check and its closing when
  the screen grows are the `navigation` recipe's module, which it installs with it.
- `nav-menu`: the navbar's menu, a disclosure navigation: links and buttons opening submenus of links, nested at any
  depth; opening one closes the others, Escape closes the innermost and focuses its button, a click outside, the
  focus leaving and Turbo caching the page close them all; the current page and its submenus are marked, a submenu
  near the edge opens towards the other side, and the same menu opens in place in a `MobileNav`. Its current-link
  marking and its link-follow check are the `navigation` recipe's module, which it installs with it.
- `section-nav`: vertical tabs that navigate between the pages of one area (settings): links with
  `aria-current="page"` marked by the server or from the URL, a column on large screens and a strip that scrolls
  sideways, with the current section in view, on small ones. Its current-link marking is the `navigation` recipe's
  module, which it installs with it.
- `floating`: the positioning that `dropdown`, `popover` (so `date-picker`) and `tooltip` share, one JavaScript
  module (`assets/lib/uxor-floating.js`) that those recipes install with them: placement, flip, shift into
  the viewport, following the trigger on scroll and resize.
- `turbo`: what the recipes ask about Turbo's copies of a page, one JavaScript module
  (`assets/lib/uxor-turbo.js`) that the recipes using it install with them: whether a `turbo:before-cache`
  comes from a frame visit promoted to history, whether an element is `data-turbo-permanent`, and whether a controller
  connects in a cached copy.
- `navigation`: what the navigation recipes share, one JavaScript module (`assets/lib/uxor-navigation.js`):
  marking the current page's link, giving the rendered `aria-current` back, whether a click on a link navigates this
  tab, closing a navigation opened over the page when the screen grows.
- `theme`: chart series roles `chart-1` to `chart-6` and `chart-other`, checked for contrast in both themes.
- A gallery of every recipe and every example of its README, light and dark, with its code and install command, on
  GitHub Pages (<https://xormania.github.io/uxor/>), published with each release.
- `FOR-AGENTS.md`, a page for the coding agent given the repository's URL (setup, which recipe for what, the rules,
  every recipe), and `llms.txt`, every page with one line, linking the files of this release. Both are written from
  `README.md`'s recipe tables and checked in CI.
- `SECURITY.md`: how to report a vulnerability privately.

### Changed

- **Breaking:** the kit is now UXor, at <https://github.com/xormania/uxor> (gallery:
  <https://xormania.github.io/uxor/>). `ux:install … --kit=` commands that name the old repository
  (`xormania/flowbite-xor`) stop working: the toolkit expects GitHub's archive to hold a folder named
  `<repository>-<version>`, and after the rename GitHub names it `uxor-<version>`. Reinstall with
  `--kit=https://github.com/xormania/uxor` (or `…/uxor:<version>`). The kit's own names change with it:
  - `theme`: `assets/styles/flowbite-xor.css` is now `assets/styles/uxor.css`. In `assets/styles/app.css`, replace
    `@import './flowbite-xor.css';` with `@import './uxor.css';`, then delete the old file (it is yours, so carry
    any change you made to it over first).
  - `autocomplete`, `dropzone`, `editor`: `assets/styles/flowbite-xor-autocomplete.css`, `flowbite-xor-dropzone.css`
    and `flowbite-xor-editor.css` are now `uxor-autocomplete.css`, `uxor-dropzone.css` and `uxor-editor.css`: change
    their `@import` in `app.css` the same way. The spinner's keyframes `flowbite-xor-autocomplete-spin` are now
    `uxor-autocomplete-spin`.
  - `floating`, `turbo`, `navigation`: `assets/lib/flowbite-xor-floating.js`, `flowbite-xor-turbo.js` and
    `flowbite-xor-navigation.js` are now `uxor-floating.js`, `uxor-turbo.js` and `uxor-navigation.js`; the recipes'
    controllers import the new names. A controller of your own that imports `../lib/flowbite-xor-<name>.js` imports
    `../lib/uxor-<name>.js`.
  - PHP: the namespace `App\FlowbiteXor\…` is now `App\UXor\…`, copied into `src/UXor/` instead of
    `src/FlowbiteXor/` (`data-table`, `data-table-live`, `editor`, `markdown-editor`). Replace every
    `use App\FlowbiteXor\` with `use App\UXor\` (tables extending `AbstractDataTable` or `AbstractLiveDataTable`,
    forms using `EditorType` or `MarkdownType`), then delete `src/FlowbiteXor/`.

  0.1.0 shipped only the theme's stylesheet under its old name; the other files above were renamed before their
  first release and matter only to a project that installed them from `dev`. After reinstalling, delete the old
  files, which `ux:install` does not remove.
- Installing without a version (`--kit=https://github.com/xormania/uxor`) installs `main`, which now holds
  the last release only; `--kit=https://github.com/xormania/uxor:dev` installs the work merged since.
- `theme`: on-fill roles in `uxor.css`, the color of text on a solid fill (`fg-on-brand`, `fg-on-success`,
  `fg-on-danger`, `fg-on-warning`, `fg-on-dark`) and of the toggle's knob (`knob`). All are white, so nothing looks
  different, and a project with a light brand color can set `fg-on-brand` to a dark one. `button`, `indicator`,
  `calendar`, `tabs` (pill), `tooltip`, `avatar` (group count) and `toggle` use them instead of `text-white` and
  `bg-white`. **Upgrading:** reinstall `theme` with those recipes, or those components lose their white text.
- Motion: transitions name the properties they animate and stop under `prefers-reduced-motion`. `tabs` triggers fade
  their colors only (was `transition-all`), the `toggle` knob animates `translate` and its border color (was
  `transition-all`), and the `modal` backdrop its color (was every property); these, the `sidebar` width and chevron,
  the `nav-menu` and `side-nav` chevrons, `table` row hovers and the `toast` fade change at once under reduced motion.
  There, a dismissed `alert` hides and a closed `toast` leaves the page at once, without waiting for the fade, and
  the `spinner` and the `skeleton` pulse run three times slower.
- `dropdown` and `tooltip` place their content with the `floating` recipe's module instead of a copy each, and depend
  on that recipe (`ux:install` adds `assets/lib/uxor-floating.js`). Where they place it does not change.
- `dropdown`, `modal`, `drawer`, `toast` and `layouts` (`form-reset`) use the `turbo` recipe's module instead of a
  copy of its checks each, and `sidebar` the `navigation` recipe's; each depends on that recipe (`ux:install` adds the
  module). What they do does not change.
- `tabs`: the keyboard of the WAI-ARIA tabs pattern: the selected tab is the list's one Tab stop, the arrow keys of
  the list's orientation (Up and Down in a vertical list, which now has `aria-orientation`) select the previous and
  next tab, Home and End the first and last, skipping disabled tabs; Tab moves on to the panel, a Tab stop of its own,
  and a selected tab disabled in place (a Live re-render) hands the selection on. An `idPrefix` prop keeps two `Tabs`
  of a page from sharing ids.
- `layouts`: Back and Forward show a GET form with the values of the URL, and a POST form as the user left it; the
  `form-reset` controller on `<body>` resets each GET form of a restored page, and autocomplete fields, calendars and
  date pickers follow it. With a layout of your own, add `data-controller="form-reset"` to its `<body>`. The
  `data-table` search form keeps its own reset, so a table works without `layouts`.
- `layouts`: on small screens, the app layout's menu button opens the `sidebar` block's navigation in a `MobileNav`
  (a modal drawer) instead of the `Sidebar` over the page.
- `layouts`: a `navbar_nav` block, the navbar's menu (`NavMenu:Link`s and `NavMenu:Submenu`s), shown in the navbar
  from `md` and in the mobile nav's drawer below.
- `layouts`: the `settings` layout renders its navigation with `section-nav`; fill `settings_nav` with
  `SectionNav:Item`s (plain `<li><a>` items still render, without the controller's marking).
- `layouts` now depends on `section-nav`, `mobile-nav` and `nav-menu`, which `ux:install layouts` installs with it.
- `navbar`: a `menu` block, at the start of the bar, for a `MobileNav`, and a `nav` block after the brand, for a
  `NavMenu`, in a `<nav>` named by `navLabel` and shown from `md` up.
- `form-theme`: an `EditorType` renders as the `editor` recipe's `Editor`, a `MarkdownType` as the `markdown-editor`
  recipe's `MarkdownEditor`, and a `DropzoneType` as the `dropzone` recipe's `Dropzone`, never as UX Dropzone's own
  theme (a field whose valid files a 422 sent back says they were not kept); a single-text `DateType` opted in with
  `'block_prefix' => 'flowbite_date_picker'` renders as the `date-picker` recipe's picker.
- `dropdown`, `modal`, `drawer`: the README examples size their wrapper with `min-h-*` classes instead of a `style`
  attribute, which a Content Security Policy blocks.
- The docs no longer track the official `flowbite-4` kit, an initial reference only: `UPSTREAM.md` is removed, and
  its notes on toolkit and platform behavior moved to `docs/NOTES.md`. `NOTICE` keeps the credit.

### Fixed

- `dropdown`, `modal`, `drawer`: one left open when the page was left (a link inside it, Back, Forward) came back
  after Back open but not working (a dialog no longer modal, the page behind it usable), its trigger still
  `aria-expanded="true"`; it now closes and its trigger collapses before Turbo caches the page, and it opens again as
  before. A frame visit promoted to history (a data table's pages) keeps the page on screen: the menu or dialog stays
  open, and the copy Back shows is closed. A drawer reopened after a move in the DOM (a `data-turbo-permanent`
  element) no longer shows its trigger collapsed.
- `dropdown`: one open inside a `data-turbo-permanent` element closed when a visit moved it into the next page; it now
  stays open, as the user left it, like the modal and the drawer.
- `dropdown`: ArrowRight on a submenu's item opened the submenu but left the focus on the item, and closed a submenu
  already open (by a click); it now opens the submenu, or keeps it open, and focuses its first item.
- `modal`, `drawer`: a Live re-render that replaced the container of the component (a wrapper whose id changes)
  logged "Missing target element" errors. The old controller now disconnects without them; the new one works as
  before (an open modal stays open, its new trigger expanded; a drawer starts as its `open` value says).
- `modal`: in WebKit, an open modal whose container a Live re-render replaced closed (without `moveBefore`, the morph
  moves the `<dialog>` out of the top layer); it now shows that same dialog as a modal again.
- `tooltip`: a tooltip shown when its link visited another page (or when a frame visit was promoted to history) came
  back shown after Back or Forward, its trigger no longer hovered; it now comes back hidden. A tooltip in a
  `data-turbo-permanent` element stays shown through a visit while its trigger keeps the focus.
- `toast`: a toast outside the permanent `ToastRegion` came back on Back, for another full timeout; Back and Forward
  no longer show it again, and a frame visit promoted to history leaves it on screen. Toasts in the region still stay
  across visits until they time out or are closed.
- `sidebar`: with `localStorage` blocked, a Turbo visit expanded a collapsed sidebar; the collapse now lasts until the
  next page load. Forward to a page left with the sidebar open over it showed the menu button expanded on a closed
  sidebar, and the sidebar stayed open over the page when the screen grew to a desktop, so shrinking it again showed
  it open and the menu button took two clicks; the menu button now follows the sidebar on reconnect, and the sidebar
  closes where it sits beside the page.
- `theme-toggle`: with the system in dark mode and the light theme chosen, the button showed no icon
  (`flowbite.min.css` gates its own `dark:hidden` on `prefers-color-scheme`); it now shows the moon. A switch no
  longer fades table rows into the new theme: the color transitions it starts are finished at once.
- `input`: the "With Button" example shows the `flowbite` set's search icon (`flowbite:search-outline`), not
  `tabler:search`.
- `README.md` is a short introduction: what the kit is, how to install it, its requirements. The recipe list moved
  to `docs/RECIPES.md`, and the updating, Turbo and Live Components, security and versioning sections to
  `docs/GUIDE.md`.

## [0.1.0] - 2026-10-06

### Added

- `theme`: Flowbite's color roles for light and dark, with contrast fixes.
- `theme-toggle`: a button switching between light and dark; the choice is remembered per browser.
- 22 components from the official `flowbite-4` kit (`alert`, `avatar`, `badge`, `button`, `button-group`, `card`,
  `checkbox`, `dropdown`, `indicator`, `input`, `kbd`, `label`, `modal`, `pagination`, `radio`, `select`,
  `skeleton`, `spinner`, `table`, `tabs`, `textarea`, `toggle`), with Stimulus controllers instead of Flowbite's
  JavaScript.
- Components the official kit lacks: `breadcrumb`, `drawer`, `empty-state`, `navbar`, `page-header`, `progress`,
  `sidebar`, `stat-card`, `toast`, `tooltip`.
- `form-theme`, a Symfony form theme rendering through the kit's components, and `form-field`, the labelled control
  with help text and errors it renders each row with.
- `layouts`: base, app (sidebar, navbar, page header, toasts), auth, settings, error and blank.
- Blocks: `dashboard-home`, `login`, `signup`, `forgot-password`, `settings-profile`, `not-found`.

[Unreleased]: https://github.com/xormania/uxor/compare/0.1.0...HEAD
[0.1.0]: https://github.com/xormania/uxor/releases/tag/0.1.0
