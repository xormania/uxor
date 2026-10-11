# Snippet for projects using UXor

Paste the block below into a project's `AGENTS.md` or `CLAUDE.md`. It tells agents (and people) working
on the project how to use the kit's recipes.

````markdown
## UI: UXor

The UI is built from the [UXor](https://github.com/xormania/uxor) Symfony UX Toolkit kit.
Its recipes are copied into `templates/components/`, `templates/layouts/`, `templates/form/`,
`assets/controllers/` and `assets/styles/uxor.css` (the theme's color roles); we own those files.

- **Use the kit's components, not raw Flowbite HTML.** `<twig:Button>`, `<twig:Modal>`, `<twig:Dropdown>`,
  `<twig:Toast:Stream>`, `<twig:FormField>`… A missing one is installed with
  `php bin/console ux:install <recipe> --kit=https://github.com/xormania/uxor` (the kit's
  `docs/RECIPES.md` lists them), not written by hand.
- **No Flowbite JavaScript.** Never `import 'flowbite'` or call `initFlowbite()`: behavior lives in the
  recipes' Stimulus controllers, which survive Turbo visits and Live Component re-renders.
- **Colors through the theme's roles only**: `bg-brand`, `text-heading`, `text-body`, `border-default`,
  `bg-neutral-primary-soft`, `text-fg-danger-strong`… Text on a solid fill uses that fill's on-fill role:
  `text-fg-on-brand` on `bg-brand`, `fg-on-success`, `fg-on-danger`, `fg-on-warning`, `fg-on-dark`. Never raw palette
  colors (`bg-blue-700`, `text-gray-500`, `text-white`) or `dark:` color overrides: the roles already switch with the
  theme and pass the contrast checks.
- **Icons with UX Icons from the `flowbite` set**: `<twig:ux:icon name="flowbite:check-circle-outline" />` or
  `ux_icon('flowbite:check-circle-outline')`. Write each name in full: `php bin/console ux:icons:lock` finds only
  those, downloads them into `assets/icons/`, and you commit that folder. A name built from a variable
  (`flowbite:arrow-{{ dir }}-outline`) is missed.
- **Toasts through Turbo Streams.** The toast region (`#toasts`) is `data-turbo-permanent`: Turbo keeps the
  one already on screen, so toasts rendered inside it on a later page are dropped. Render
  `<twig:Toast:Stream>` in the page body (every kit layout does it for flash messages) or in a Turbo Stream
  response.
- **Lists of records: `ux:install data-table`**, then one class per table extending
  `App\UXor\DataTable\AbstractDataTable` with `columns()`, `countRows(TableQuery): int` and
  `loadRows(TableQuery): array` (the page's rows, from `$query->offset()`); the
  controller passes `$table->handleRequest($request)` to `<twig:DataTable :table="table" id="…" />`. The query is
  already checked: sort by `$query->sortField`, never by a raw request value. Custom cells go in
  `<twig:block name="cell_<key>">` (not `{% block %}`, which does not compile `<twig:…>` inside a component).
  Keep `src/UXor/` as the recipe installed it. For row selection, bulk actions or search while typing,
  `ux:install data-table-live`: the same class extends `AbstractLiveDataTable` with
  `#[AsLiveComponent(name: '…', template: 'components/DataTableLive.html.twig')]`, rendered as
  `<twig:Name tableId="…" />` with no controller code; a bulk action is a `#[LiveAction]` reading `$this->selectedIds`
  (browser input: check each id). Back leaves a Live table; the plain one walks its states.
- **Dates inline: `ux:install calendar`** (`<twig:Calendar name="…" mode="single|multiple|range" />`; dates are
  `Y-m-d` strings, the form gets `name`, `name[]` or `name[from]`/`name[to]`). Inside a Live Component, bind with the
  `model` prop (`model="day"`, or `model="stay"` for a range array with `from`/`to`), never `data-model` on the
  `<twig:Calendar>`. `minDate`/`maxDate`/`disabled` only guide the user: validate on the server. PHP needs `intl`
  for locales other than `en`. Times: native `<input type="time">`.
- **A date field: `ux:install date-picker`**; in a form, `DateType` with `'widget' => 'single_text'` and
  `'block_prefix' => 'flowbite_date_picker'` (bounds from `'attr' => ['min' => …, 'max' => …]`, plus constraints),
  no template code. Outside a form: `<twig:DatePicker id="…" selected="…">` with `DatePicker:Trigger` (spread
  `date_picker_trigger_attrs` on its `Button`) or `DatePicker:Input` (spread `date_picker_input_attrs` on its `Input`),
  and `DatePicker:Content` holding a `<twig:Calendar name="…" />` with the same `selected`. The calendar's hidden
  input holds the value; the typed field has no `name`.
- **Charts: `ux:install chart`**, then `<twig:Chart type="bar|line|…" title="…" :labels="…" :datasets="[{label: '…', data: […]}]" />`,
  or `<twig:Chart :chart="chart" title="…" />` with a `ChartBuilderInterface` chart. Always a `title`; no colors (the
  theme's `chart-*` roles apply; for a role write `'var(--color-…)'`); at most six series; format the table's values in
  `<twig:block name="value">`; pass `id` inside Live Components and Turbo Frames. Never write `new Chart()` or
  `Chart.defaults` code.
- **Content next to a control: `ux:install popover`** (`<twig:Popover id="…">` with `Popover:Trigger`, spreading
  `popover_trigger_attrs` on its `Button`, and `Popover:Content`); menus of actions use `dropdown`. Pass a stable `id`
  inside Live Components and Turbo Frames.
- **Searchable selects: `ux:install autocomplete`**, then `'autocomplete' => true` on a choice field (`ChoiceType`,
  `EntityType`, `CountryType`…; `'multiple' => true` for several, `'tom_select_options' => ['create' => true]` for
  typed values). Options searched on the server: a field class with `#[AsAutocompleteField]` whose parent is
  `AutocompleteChoiceType` (or `#[AsEntityAutocompleteField]` with `BaseEntityAutocompleteType`); its search URL is
  public unless you set its `security` option. Outside a form: `<twig:Autocomplete id="…" name="…">` with
  `<option>`s inside, its label with a matching `for` and no `id` of its own. In a Live Component form, use the form
  option, not the component. Never import Tom Select's own stylesheet: the recipe's replaces it.
- **File uploads: `ux:install dropzone`**, then do the README's CSS import and `controllers.json` change (UX
  Dropzone's own stylesheet off). `<twig:Dropzone id="…" name="…" />` (`multiple` and `name="…[]"` for several) in a
  `method="post" enctype="multipart/form-data"` form; without the `enctype`, Turbo sends no file. Validate on the
  server (`File`/`Image`, `All` + `Count` for several), answer 303/422, and say that files are never kept after a 422.
  In a Symfony form, a `DropzoneType` (`'multiple' => true` for several) renders through the form theme, and a
  field says when its files were not kept. In a Live Component, never a `DropzoneType`: `<twig:Dropzone>` inside
  `data-live-ignore`, a wrapper id and an input id that change after each upload, and a `files(name)|action` button.
  Image previews need `img-src data:` in a Content Security Policy.
- **Rich text: `ux:install editor`**, run the printed `composer require` and `importmap:require` commands, and do the
  README's CSS import. In a form, `EditorType` (from `App\UXor\Editor`; `max_chars`, `max_bytes`): its data is
  sanitized HTML or `null`. Print stored HTML with `|flowbite_editor_html`, never `|raw`; HTML from another path
  goes through `EditorHtmlPolicy::sanitize()` before it is stored. Change the toolbar's formatting and the policy
  together. In a Live Component, `<twig:Editor model="on(change)|field">`, and bump its `reset` prop to replace the
  content from the server.
- **Markdown: `ux:install markdown-editor`**, and run the printed `composer require` command. In a form,
  `MarkdownType` (from `App\UXor\MarkdownEditor`; `max_chars`, `max_bytes`): its data is the Markdown or
  `null`. Print it with `|flowbite_markdown_html`, never `|raw` or another Markdown filter: the preview and the page
  render the same. The editor is its own Live Component: keep it out of another Live Component's re-rendered markup.
- **Navigation more than one level deep: `ux:install side-nav`**, then `<twig:SideNav label="…" storageKey="…">`
  holding `SideNav:Item`s (links: `href`, plus `route` so the server marks the current page and opens its branches)
  and `SideNav:Branch`es (`label`, nested at any depth), inside a `<nav>` or the `Sidebar`. It is an ARIA tree: the
  controller handles the keyboard and keeps the open branches across Turbo visits; never add click or key handlers
  of your own. One `storageKey` per tree; give a branch `name` when its label changes (a count).
- **Sections of one area, each its own page (settings): `ux:install section-nav`**, then
  `<twig:SectionNav label="…">` holding `SectionNav:Item`s (`href`, plus `route` so the server marks the current
  section). They are links, not tabs: never give them `role="tab"` or arrow keys. The `settings` layout renders one:
  fill its `settings_nav` block with the items. Panels switched in place on one page are `tabs`
  (`orientation="vertical"` for a column), with a distinct `idPrefix` per `Tabs` of a page.
- **The navigation on phones: `ux:install mobile-nav`** (the `layouts` app layout already has it): a
  `<twig:MobileNav>` in the `Navbar`'s `menu` block, holding the same `SideNav` as the `Sidebar`, with the same
  `storageKey`, and the brand in its `header` block. It is a modal `Drawer`; the controller focuses the current page
  and closes it on links, Escape, the backdrop and Turbo visits: add no handlers of your own, and no fixed `id`s in
  the navigation, which renders twice.
- **Menus in the top bar: `ux:install nav-menu`**: `<twig:NavMenu id="…">` in the `Navbar`'s `nav` block (with the
  `layouts` app layout, fill its `navbar_nav` block with the items only), holding `NavMenu:Link`s (`href`, plus
  `route` so the server marks the current page) and `NavMenu:Submenu`s (`label`, nested at any depth). It is a
  disclosure navigation, not an ARIA menu: never add `role="menu"`, click or key handlers of your own. On phones,
  include the same items in a `<twig:NavMenu orientation="vertical">` with another `id`, in the `MobileNav`.
- **Live Components may sit inside `data-turbo-permanent` elements**: they keep their state and stay live
  across visits. A permanent element keeps its node but not its scroll position: if it scrolls, restore the
  position yourself, as the kit's `Sidebar` does.
- **Forms answer 303 or 422.** A submitted form redirects (303) when it succeeds and re-renders with 422
  when it has errors; Turbo Drive rejects a 200. Forms render through the kit's form theme: set
  `twig.form_themes: ['form/flowbite_layout.html.twig']` for your own forms (`LoginForm`, `SignupForm`,
  `ForgotPasswordForm` and `SettingsProfile` apply it themselves).
- **Layouts:** pages extend `layouts/app.html.twig` (or `auth`, `settings`, `error`, `blank`). Inside a
  component's content (`<twig:Card>…</twig:Card>`), `block('x')` means the component's block: reach the
  page's own blocks with `block(outerBlocks.x)`.
- **Props and attributes are trusted input.** Give `as`, attribute names and URLs values the code chose
  (constants, `path()`, `url()`), never request or user data unchecked. `as` falls back to the component's default
  tag, and the kit's link props (`Sidebar:Item href`, `LoginForm forgotPasswordHref`…) render `#` for a URL that is
  not relative, http(s), mailto or tel; an `href` or `src` given as an attribute is not checked.
- **No inline script, style or event handler** (`<script>`, `<style>`, `style="…"`, `onclick="…"`) in
  templates: a Content Security Policy blocks them unless they carry its nonce or hash, and no nonce covers an
  attribute. Behavior goes in Stimulus controllers, styles in Tailwind classes or the stylesheet. Under a policy,
  set `csp_script_nonce` and `csp_style_nonce` for the layouts (the `layouts` README).
- **Stable ids inside Live Components and Turbo Frames**: give a `<twig:Tooltip>` an explicit `id`, e.g.
  `id="stock-{{ row.id }}"`; its generated id would change on every re-render.
- **CSS order:** `flowbite.min.css` is imported after Tailwind and has its own copies of common utilities
  (`flex`, `hidden`…). Coming last, they beat a responsive variant that Flowbite's file lacks: `flex max-md:hidden`
  stays `flex`, `hidden xl:flex` stays hidden. Mark the variant important (`max-md:hidden!`) and check the
  computed style in the browser. Its `max-w-2xl` is also 16rem, not 42rem: do not use it.
````
