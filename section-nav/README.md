# Section nav

Vertical tabs that navigate: one link per page of a group of pages (settings, an account, a project), the current one marked, a column on large screens and a strip that scrolls sideways on small ones.

```twig {"preview":true}
<div class="w-full max-w-56">
    <twig:SectionNav label="Settings" orientation="vertical">
        <twig:SectionNav:Item href="#profile" :active="true">Profile</twig:SectionNav:Item>
        <twig:SectionNav:Item href="#notifications" :active="false">Notifications</twig:SectionNav:Item>
        <twig:SectionNav:Item href="#billing" :active="false">Billing</twig:SectionNav:Item>
        <twig:SectionNav:Item href="#security" :active="false">Security</twig:SectionNav:Item>
    </twig:SectionNav>
</div>
```

## Installation

::: installation

## Usage

```twig
<twig:SectionNav label="Settings">
    <twig:SectionNav:Item href="{{ path('app_settings_profile') }}" route="app_settings_profile">Profile</twig:SectionNav:Item>
    <twig:SectionNav:Item href="{{ path('app_settings_password') }}" route="app_settings_password">Password</twig:SectionNav:Item>
</twig:SectionNav>
```

The `layouts` recipe's `settings.html.twig` renders one: fill its `settings_nav` block with `SectionNav:Item`s.

- **Links, not tabs.** Each section is its own page and each item a link, followed as a Turbo visit. The
  navigation is a `<nav>` landmark named by `label`, holding a list of links; the current one has
  `aria-current="page"`. It has no `tablist` role: tabs switch panels within a page, which is what the `tabs` recipe
  does (with `orientation="vertical"` for a vertical list).
- **Keyboard:** the links are in the Tab order, as in any navigation; Enter follows one. There are no arrow keys,
  which would make the links behave unlike every other link of the page.
- **Current section:** `route` marks the item when it is the current route, on the server; `:active` forces the
  state. An item given neither is marked by the controller when its link has the current URL's path, on every
  connect: use that when the navigation is inside a `data-turbo-permanent` element, whose markup Turbo keeps from the
  first page. A link to a fragment of the page (`#…`) is never marked from the URL.
- **Small screens:** with the default `orientation="responsive"`, the list is a row below the `lg` breakpoint that
  scrolls sideways when it does not fit, and a column from it. The controller scrolls the current section into the
  row's view on every connect. The links stay links: one tap to a section, opening one in a new tab works, and no
  script is needed to navigate. `vertical` is always a column and `horizontal` always a row.
- **Turbo:** each page renders its own navigation, so a visit, Back, Forward, a reload and the copy Turbo cached all
  show the section of the page shown.

### Always a row

```twig {"preview":true}
<div class="w-full max-w-xs">
    <twig:SectionNav label="Project" orientation="horizontal">
        <twig:SectionNav:Item href="#overview" :active="false">Overview</twig:SectionNav:Item>
        <twig:SectionNav:Item href="#members" :active="true">Members</twig:SectionNav:Item>
        <twig:SectionNav:Item href="#integrations" :active="false">Integrations</twig:SectionNav:Item>
        <twig:SectionNav:Item href="#danger-zone" :active="false">Danger zone</twig:SectionNav:Item>
    </twig:SectionNav>
</div>
```

Marking the current section and giving the links their rendered `aria-current` back on disconnect are the `navigation`
recipe's module (`assets/lib/uxor-navigation.js`), which `ux:install section-nav` installs with it.
