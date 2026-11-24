# Use and update recipes

Once you've [set up UXor with Composer](../packages/uxor/README.md) or [installed Toolkit directly](../INSTALL.md),
you can add recipes, customize their files and update them when you choose. Run the commands below in your
Symfony application's PHP environment.

## Installing recipes

`ux:install` also installs the recipes a recipe depends on. Run the printed `composer require` and
`importmap:require` commands for the recipe's packages. If the importmap command repeats the Flowbite stylesheet
from [setup](../INSTALL.md), run it for any additional packages it lists, such as the editor's Tiptap modules.
`ux:install dashboard-home` brings the layouts and every component the dashboard uses.
Install the `theme` during setup and use the dashboard recipe's README for the controller and template.

## Updating

Recipes are copies you own, so an update is a change you review like any other. Preserve local changes using
the application's normal workflow, then reinstall the recipe from the newer version with `--force`:

```bash
php bin/console ux:install <recipe> --kit=https://github.com/xormania/uxor:<version> --force
```

`--force` replaces every file of the recipe and of every recipe it depends on: `ux:install dashboard-home --force`
also replaces the layouts and every component the dashboard uses. Without it, the command asks about each existing
file of those recipes, but a "yes" replaces only files older than the kit's commit: a file you edited, or any file
of a fresh clone, is kept even though the command lists it as installed. Review the result with `git diff` and
bring back your own changes where you need them (`git checkout -p`). Pinning a version installs the same files on
every machine.

## Turbo and Live Components

How the recipes behave with Turbo and Live Components, and what your own pages and controllers must do:

- **Stimulus only.** A controller connects to new markup (Turbo visits, Turbo Frames, Live re-renders,
  Turbo Streams) and cleans up everything in `disconnect()`: a dropdown stays open through a Live re-render,
  a `<dialog>` (modal, drawer) stays modal, tooltips and dropdowns keep working in re-sorted Live rows.
- **`data-turbo-permanent` keeps the node, not its scroll.** The sidebar restores its scroll position and
  collapsed state itself; the app layout scrolls the document, which Turbo restores on Back/Forward.
- **Live Components work inside a `data-turbo-permanent` element**: they keep their state and stay live.
- **Toasts go through Turbo Streams.** The toast region (`<twig:ToastRegion>`, `id="toasts"`) is
  `data-turbo-permanent`: on a Turbo visit, Turbo keeps the region already on screen and drops the new page's copy,
  with any toast written inside it. Render each toast with `<twig:Toast:Stream>` instead, in the page or in a Turbo
  Stream response. The `layouts` recipe does this for flash messages in `templates/layouts/base.html.twig`, so
  every kit layout shows them.
- **Your form controllers answer 303 or 422.** Turbo Drive rejects a 200 after a form submit. On success,
  redirect with `$this->redirectToRoute('…', [], Response::HTTP_SEE_OTHER)` (the default is 302). On errors,
  render the form with `$this->render(…, ['form' => $form])`, which answers 422 when the submitted form is invalid.
- **Charts are drawn and destroyed by their controllers** on every Turbo visit, Frame or Stream; inside a Live
  Component, new data updates a chart in place.
- **Files are never restored.** After a 422, a Turbo Stream or a Live re-render that replaces a file field, the
  user picks the files again (`dropzone` says so in the box). In a Live Component, upload through a `files` action
  first ([`dropzone`](../dropzone/README.md#in-a-live-component)).
- **Editors come back with their content.** Before Turbo caches a page, an `editor` saves its content and selection
  in the markup; Back builds a new editor from them (not its undo history), also after a frame visit promoted to
  history. In a Live Component it sits in `data-live-ignore`: re-renders never overwrite typing, and its `reset` prop
  replaces the content from the server. A `markdown-editor` keeps what was typed across Back too, and its preview
  renders it.
- **Navigation trees keep their open branches.** A `side-nav` saves which branches are open in `sessionStorage` and
  restores them after every Turbo visit, Back and Forward, over the copy Turbo cached; the branch of the current page
  opens.
- **Tabs and sections show the page shown.** A `tabs` list keeps its selected tab in an attribute, so Back shows the
  tab selected when the page was left; a visit or a reload starts from `defaultValue`. A `section-nav` marks the
  section of the page shown, also inside a `data-turbo-permanent` element.
- **The mobile nav closes before Turbo caches the page.** A `mobile-nav` drawer closes when a link inside it is
  followed and before every snapshot, so Back and Forward never show it open; its `side-nav` keeps its branches.
- **Navbar menus close before Turbo caches the page.** A `nav-menu` closes its submenus when a link inside is
  followed and before every snapshot, and marks the current page after every visit, in a `data-turbo-permanent`
  navbar too.
- **Back shows a GET form as the URL says, a POST form as the user left it.** A GET form reflects the URL, so after
  Back and Forward it shows the values the server rendered; a POST form keeps what was typed and picked. Autocomplete
  and date picker fields follow their form. The `form-reset` controller on the layouts' `<body>` does it: with a layout
  of your own, add `data-controller="form-reset"` to its `<body>` ([`layouts`](../layouts/README.md#back-and-forms)).
- **Overlays come back closed.** A dropdown, modal or drawer left open by a link inside it shows closed after Back,
  and opens again as before (a dialog as a modal).
- **Stable ids in re-rendered markup.** Give a `<twig:Tooltip>` an explicit `id` inside a Live Component or a
  Turbo Frame (`id="stock-{{ row.id }}"`): its generated id would change on every re-render.

## Security

Twig escapes what the components print, but escaping checks neither a tag name nor a URL. Props and attributes are
template input: give them values your code chose (constants, `path()`, `url()`), never request or stored user data
unchecked. On top of escaping, the components check what shapes their markup:

- **Tags.** An `as` prop renders only the tags its component lists: `Button` `button`, `a`; `Badge` `div`, `span`,
  `a`; `Avatar:GroupCount` `div`, `a`, `button`; `Card:Title` `span`, `div`, `p`, `h1`–`h6`; `Dropdown:Item` `a`,
  `button`; `FormField` `div`, `fieldset`. Any other value renders the default tag, without an error:
  `<twig:Button as="label">` is a `button`.
- **Link props.** The links of this kit's own recipes (`Button`, `Badge`, `Breadcrumb:Item`, `Dropdown:Item`,
  `Pagination:Link`, `Sidebar:Item`, `SideNav:Item`, `SectionNav:Item` and `NavMenu:Link` `href`, `LoginForm`
  `forgotPasswordHref` and `signupHref`, `ForgotPasswordForm` and `SignupForm` `loginHref`, and `NotFound` `homeHref`)
  keep a relative, `http(s)`, `mailto` or `tel` URL, read as browsers read it (in any case, after leading spaces and
  control characters, with tabs and newlines inside). Any other scheme, `javascript:` and `data:` but also `sms:` or
  an app's `slack://`, silently renders `#`, and a sidebar, side nav or section nav item linking to `#` is never marked as the current page.
  The value is printed as text, even a `Markup` one (`|raw`).
- **Image props.** `Avatar:Image` keeps a relative or `http(s)` `src`; another scheme renders no `src`, so the
  fallback stays shown.
- **Attributes.** Attributes given to a component, and `FormField`'s `labelAttr` and `helpAttr`, render with escaped
  names and values: a name cannot add another attribute. An inline event handler, any name starting with `on` (in
  any case, after leading spaces and control characters), silently renders nothing: behavior goes in a Stimulus
  controller, wired with `data-action`. A component's attributes are also read as a browser reads their names, in
  any case: `href` and `formaction` (`HREF`, `FormAction`…) keep a relative, `http(s)`, `mailto` or `tel` URL, any
  other rendering `#`; `src` keeps a relative or `http(s)` URL, any other rendering no `src`; `srcset` and `ping`
  render nothing, and a nested name such as `xlink:href` is never printed. Other attributes render as given: check
  another URL attribute (`action`, `data`, `poster`…) yourself.
- **Content Security Policy.** The components print no inline script, style or event handler, so they work under a
  strict policy (nonces and `'strict-dynamic'`, no `'unsafe-inline'`). The layouts print their inline script and the
  importmap with your nonces: see *Content Security Policy* in [`layouts/README.md`](../layouts/README.md).

`tests/e2e/hostile-props.spec.ts` renders each of these props with hostile values and checks what the browser parses.
The kit's demo enforces a strict Content Security Policy, and every browser test fails on a violation. Report a
vulnerability privately: see [`SECURITY.md`](https://github.com/xormania/uxor/blob/main/SECURITY.md).

## Verification

Check the application's actual integration and changed user journey with
[Testing an application using UXor](APPLICATION-TESTING.md). The demo is UXor's fixture; its setup and test commands
are examples for contributors, not the consuming application's environment.

## Versioning

Use a tagged release (`X.Y.Z`) of the kit for new work. Keep the version your application already uses until
you choose to update it. [Choosing a revision](../INSTALL.md#choosing-a-revision) explains how to pin a release
or a commit when testing unreleased work. UXor is in `0.x` development. Read the [changelog](../CHANGELOG.md)
for compatibility changes and migration steps before an update.
