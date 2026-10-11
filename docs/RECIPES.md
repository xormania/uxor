# Recipes

Every recipe of the kit, by group: install one with
`php bin/console ux:install <recipe> --kit=https://github.com/xormania/uxor`, after the setup in the
[README](../README.md#install).

Recipes marked ✦ come with a Stimulus controller, copied to `assets/controllers/` and loaded by StimulusBundle.
Each recipe's README has its examples, props and usage.

## Theme

| Recipe | |
|---|---|
| [`theme`](../theme/README.md) | Flowbite's color roles, with this kit's contrast fixes and its roles for text on a solid fill (`fg-on-*`), as one stylesheet to import in `assets/styles/app.css`. A role is a named color with a light and a dark value, used as a utility: `bg-brand`, `text-heading`, `border-default`. |
| [`theme-toggle`](../theme-toggle/README.md) ✦ | A button switching between the light and dark themes, remembered in `localStorage` and following the system preference until the user chooses. |

## Shared code

Installed with the recipes that use it; install it yourself only for code of your own.

| Recipe | |
|---|---|
| [`floating`](../floating/README.md) | The positioning shared by `dropdown`, `popover` (so `date-picker`) and `tooltip`, one JavaScript module: a floating element placed next to the element it belongs to, flipped to the other side when it does not fit, kept in the viewport and following it on scroll and resize. |
| [`navigation`](../navigation/README.md) | What the navigation recipes (`nav-menu`, `sidebar`, `side-nav`, `section-nav`, `mobile-nav`) share, one JavaScript module: the current page's link marked `aria-current="page"`, whether a click on a link navigates this tab, a navigation opened over the page closed once the screen grows. |
| [`turbo`](../turbo/README.md) | What the recipes ask about Turbo's copies of a page, one JavaScript module: whether a `turbo:before-cache` leaves the page on screen (a frame visit promoted to history) or an element is moved into the next page (`data-turbo-permanent`), and whether a controller connects in a cached copy. |

## Basic components

| Recipe | |
|---|---|
| [`alert`](../alert/README.md) ✦ | A message for information, success, a warning or an error, optionally dismissible. |
| [`avatar`](../avatar/README.md) ✦ | A user's picture, with a fallback, in several sizes, round or with rounded corners. |
| [`badge`](../badge/README.md) | A small label or count next to other content, such as a number of comments. |
| [`button`](../button/README.md) | A button, or a link that looks like one, in several colors, sizes and styles. |
| [`button-group`](../button-group/README.md) | Several buttons or links joined into one control. |
| [`card`](../card/README.md) | A box grouping related content: text, images, a form. |
| [`checkbox`](../checkbox/README.md) | A square box to select one or more options. |
| [`dropdown`](../dropdown/README.md) ✦ | A menu that opens from a button and closes when the user clicks or focuses outside it. |
| [`indicator`](../indicator/README.md) | A dot or number placed on another element: a status, a count, a loading label. |
| [`input`](../input/README.md) | A single-line field for any input type: text, email, number, password, URL… |
| [`kbd`](../kbd/README.md) | A keyboard key or shortcut shown in text. |
| [`label`](../label/README.md) | A text element that identifies form controls and other content. |
| [`modal`](../modal/README.md) ✦ | A dialog over the page, as a native `<dialog>`, with a close button. |
| [`pagination`](../pagination/README.md) | Links to the pages of a long list. |
| [`radio`](../radio/README.md) | A round button to choose one option among several. |
| [`select`](../select/README.md) | A list to choose one or more options. |
| [`skeleton`](../skeleton/README.md) | Placeholders shaped like the content that is loading. |
| [`spinner`](../spinner/README.md) | A spinning indicator for a loading state. |
| [`table`](../table/README.md) | Rows and columns of data. |
| [`tabs`](../tabs/README.md) ✦ | Tabs that switch between panels in place, in a row or a column, with the arrow keys of the WAI-ARIA tabs pattern. |
| [`textarea`](../textarea/README.md) | A multi-line text field, for a comment or a description. |
| [`toggle`](../toggle/README.md) | A switch for an on/off setting. |

## More components

| Recipe | |
|---|---|
| [`breadcrumb`](../breadcrumb/README.md) | A trail of links showing where the current page sits in the site hierarchy. |
| [`calendar`](../calendar/README.md) ✦ | Pick a date, several dates or a range inline: keyboard navigation, disabled dates and bounds, several months, locales, right to left, hidden inputs for forms and a `model` prop for Live Components. |
| [`chart`](../chart/README.md) ✦ | Charts with Symfony UX Chart.js in the theme's colors, light and dark, each with its data as a table; from arrays or `ChartBuilderInterface`, updated in place by Live Components. |
| [`data-table`](../data-table/README.md) ✦ | A server-driven table: search, filters, sortable columns, page size and pages in a Turbo Frame, with Back and Forward through each state. Copies PHP classes into `src/UXor/`. |
| [`data-table-live`](../data-table-live/README.md) | `data-table` as a Live Component: search while typing, filters, sorting, pages and row selection for bulk actions, its state in the URL. Copies PHP classes into `src/UXor/`. |
| [`date-picker`](../date-picker/README.md) ✦ | A date or a range picked in a calendar that opens from a button or a typed field; a `DateType` opts in through the form theme. |
| [`drawer`](../drawer/README.md) ✦ | A panel sliding over one side of the page, for navigation, filters or details, as a native `<dialog>`. |
| [`empty-state`](../empty-state/README.md) | What a list or page shows when it has nothing yet, with a way forward. |
| [`mobile-nav`](../mobile-nav/README.md) ✦ | The app's navigation on small screens: a menu button in the navbar opening a modal drawer that holds the side nav, closed by a link, Escape, the backdrop and every Turbo visit. |
| [`nav-menu`](../nav-menu/README.md) ✦ | The navbar's menu: links and buttons opening submenus of links, nested at any depth, as a disclosure navigation; the current page and its submenus are marked, and the same menu opens in place in a mobile nav's drawer. |
| [`navbar`](../navbar/README.md) ✦ | The bar on top of the app: brand, navigation menu, search, actions, and the menu button opening the sidebar or a mobile nav on small screens. |
| [`page-header`](../page-header/README.md) | The top of a page: its title, a short description and the page's actions. |
| [`popover`](../popover/README.md) ✦ | Free content anchored to a button (text, links, a small form) in a non-modal dialog that closes on Escape, a click outside or when the focus leaves it. |
| [`progress`](../progress/README.md) | A bar showing how far a task has come. |
| [`section-nav`](../section-nav/README.md) ✦ | Vertical tabs that navigate: one link per page of a group of pages (settings), the current one marked, a column on large screens and a strip that scrolls sideways on small ones. |
| [`side-nav`](../side-nav/README.md) ✦ | A multi-level navigation tree: links in branches that open and close, at any depth, with the keyboard of an ARIA tree view; the open branches hold across Turbo visits, and the branch of the current page opens. |
| [`sidebar`](../sidebar/README.md) ✦ | The app's main navigation: grouped links with icons and counts, collapsible to icons, opened over the page on small screens. |
| [`stat-card`](../stat-card/README.md) | A key figure with its label and, optionally, how it changed over a period. |
| [`toast`](../toast/README.md) ✦ | Short-lived notifications in a fixed region, added on page load or by Turbo Streams, dismissed after a timeout or by the user. |
| [`tooltip`](../tooltip/README.md) ✦ | A short text shown while a control is hovered or focused, also announced as its description. |

## Forms

| Recipe | |
|---|---|
| [`form-theme`](../form-theme/README.md) | A Symfony form theme that renders every row through `FormField` and every control through the kit's `Input`, `Select`, `Textarea`, `Checkbox`, `Radio`, `Label` and `Button` components. |
| [`form-field`](../form-field/README.md) | A labelled form control with its help text and error message, wired by id (used by the form theme). |
| [`autocomplete`](../autocomplete/README.md) | Searchable selects with Symfony UX Autocomplete (Tom Select), styled with the theme: one choice, several, values typed by the user, options searched on the server. Works through the form theme (`'autocomplete' => true`) and as an `Autocomplete` component outside forms. |
| [`dropzone`](../dropzone/README.md) ✦ | File uploads with Symfony UX Dropzone, styled with the theme: drag and drop or browse, a preview of the picked image, several files that add up across picks, keyboard focus kept after a pick or a removal; a `DropzoneType` renders as one through the form theme. |
| [`editor`](../editor/README.md) ✦ | A rich text editor (Tiptap) that stores restricted HTML: paragraphs, bold, italic, strike, code, headings, lists, quotes, links; a keyboard-friendly toolbar, a link dialog, a counter. `EditorType` sanitizes every submit (symfony/html-sanitizer), and `flowbite_editor_html` prints stored HTML. |
| [`markdown-editor`](../markdown-editor/README.md) ✦ | A Markdown field: a native textarea with a small toolbar, and a Preview tab rendered on the server (a Live Component) exactly as the stored Markdown will print; raw HTML, images and unsafe links never reach the page. `MarkdownType` limits the source, and `flowbite_markdown_html` prints it. |

## Layouts

| Recipe | |
|---|---|
| [`layouts`](../layouts/README.md) | Page layouts to extend: an app shell with sidebar, navbar with its menu, and mobile nav, a centered column for login, signup and password reset, settings, errors and a blank page. |

## Blocks

A block is a ready-made part of a page, built from the components above. Each one is a Twig component with
its own name: `dashboard-home` renders as `<twig:DashboardHome>`, `login` as `<twig:LoginForm>`, `signup` as
`<twig:SignupForm>`, `forgot-password` as `<twig:ForgotPasswordForm>`, `settings-profile` as
`<twig:SettingsProfile>` and `not-found` as `<twig:NotFound>`.

| Recipe | |
|---|---|
| [`dashboard-home`](../dashboard-home/README.md) | A dashboard home: page header, key figures, two cards and a table of recent orders. |
| [`login`](../login/README.md) | A sign-in card rendering a Symfony login form through the form theme, with the last authentication error. |
| [`signup`](../signup/README.md) | A registration card rendering a Symfony form through the form theme. |
| [`forgot-password`](../forgot-password/README.md) | A card asking for an email address to send a password reset link, then confirming it was sent. |
| [`settings-profile`](../settings-profile/README.md) | A profile settings card: avatar, name and a Symfony form rendered through the form theme. |
| [`not-found`](../not-found/README.md) | The content of a 404 (or any error) page: status, title, explanation and a way back. |
