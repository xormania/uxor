# Layouts

Page layouts to extend: an app shell with sidebar, navbar with its menu, and mobile nav, a centered column for login, signup and password reset, settings, errors and a blank page.

## Installation

::: installation

## Usage

The recipe copies six templates to `templates/layouts/`. Extend one from a page:

```twig
{% extends 'layouts/app.html.twig' %}

{% block title %}Orders{% endblock %}
{% block brand %}<a href="{{ path('app_home') }}">Acme</a>{% endblock %}
{% block sidebar %}
    <twig:Sidebar:Group label="Overview">
        <twig:Sidebar:Item href="{{ path('app_orders') }}" route="app_orders">Orders</twig:Sidebar:Item>
    </twig:Sidebar:Group>
{% endblock %}
{% block page_title %}Orders{% endblock %}
{% block page_description %}Every order placed in the last 30 days.{% endblock %}
{% block content %}…{% endblock %}
```

`title` fills the browser tab. `page_title` and `page_description` fill the page header, which is left out when `page_title` is empty.

| Layout | For | Blocks |
|--------|-----|--------|
| `base.html.twig` | every other layout: meta, the `theme-toggle` snippet that sets the theme before the first paint, the `app` importmap entrypoint with `data-turbo-track="reload"`, the `ToastRegion` and flash messages as toasts, Content Security Policy nonces (below). The Turbo progress bar takes the brand color from the `theme` recipe | `title`, `head`, `stylesheets`, `javascripts`, `body_class`, `toasts`, `body` |
| `app.html.twig` | the application: `Sidebar` (`data-turbo-permanent`, so it keeps its scroll and collapsed state across Turbo visits), `Navbar`, a `NavMenu` in the navbar from `md` (the `navbar_nav` block: `NavMenu:Link`s and `NavMenu:Submenu`s), a `MobileNav` (small screens: the menu button opens the `brand`, `sidebar` and `navbar_nav` blocks in a modal drawer), `PageHeader` | `brand`, `sidebar`, `navbar_nav`, `navbar_search`, `navbar_actions` (theme toggle by default), `page_title`, `page_description`, `page_before`, `page_actions`, `content` |
| `auth.html.twig` | login, signup, password reset: a centered column | `brand`, `content` |
| `settings.html.twig` | settings pages: the app shell with a `SectionNav` of the settings pages and the panels | `settings_nav`, `settings_nav_label`, `settings_content` (and the `app` blocks) |
| `error.html.twig` | error pages, e.g. `templates/bundles/TwigBundle/Exception/error404.html.twig` | `content` |
| `blank.html.twig` | anything else | `content` |

Fill `settings_nav` with one `SectionNav:Item` per settings page (the `section-nav` recipe, installed with the layouts). The item of the current route gets `aria-current="page"`, which highlights it; below the `lg` breakpoint the sections are a row that scrolls sideways:

```twig
{% block settings_nav %}
    {% for route, name in {app_settings_profile: 'Profile', app_settings_password: 'Password'} %}
        <twig:SectionNav:Item href="{{ path(route) }}" :route="route">{{ name }}</twig:SectionNav:Item>
    {% endfor %}
{% endblock %}
```

Flash messages added with `$this->addFlash('success', '…')` (also `warning`, `danger`, anything else as `info`) appear as toasts on the next page, whatever its layout, Turbo visit or not.

## Back and forms

`base.html.twig` puts `data-controller="form-reset"` on `<body>`. After Back and Forward, Turbo shows the copy of the
page it cached, with the fields as the user left them. The controller applies the kit's rule to every form of the page:

- a GET form reflects the URL, so it goes back to the values the server rendered (`form.reset()`);
- a POST form (any method but GET) holds the user's work, so it keeps what was typed and picked.

Autocomplete fields (Tom Select) and calendars and date pickers follow their form. A GET form is left alone while the
focus is inside it (text typed before the page's scripts ran) and inside a `data-turbo-permanent` element. The
`data-table` search form resets itself as well, so a table works without this recipe. In a layout of your own, put
the same attribute on `<body>`.

`form-reset` leaves a form inside a `data-turbo-permanent` element alone with the check of the `turbo` recipe's module
(`assets/lib/uxor-turbo.js`), which `ux:install layouts` installs with it.

## Content Security Policy

`base.html.twig` has one inline script, the theme snippet, and `importmap()` prints three more. Under a Content
Security Policy that restricts scripts, they need the page's nonce, and Turbo needs a style nonce for the `<style>` of
its progress bar, which it adds to every page. Set `csp_script_nonce` and `csp_style_nonce`, as Twig globals or as
variables of the page, to a string or to a `Stringable` returning the current request's nonce. The layout prints the
script nonce on its script and on the `importmap()` scripts, and the style nonce in `<meta name="csp-nonce">`, where
Turbo reads it; unset or empty, it prints no nonce. With
[NelmioSecurityBundle](https://github.com/nelmio/NelmioSecurityBundle), write the two `set` lines at the top of
`<head>` in your copy of `base.html.twig` this way:

```twig
{%- set csp_script_nonce = csp_nonce('script') -%}
{%- set csp_style_nonce = csp_nonce('style') -%}
```

A policy these layouts work with:

```
script-src 'nonce-{script nonce}' 'strict-dynamic'; style-src 'self' 'nonce-{style nonce}'; object-src 'none'; base-uri 'none'
```

- `'strict-dynamic'` lets the nonced importmap scripts load the modules, the `<link rel="modulepreload">` ones
  included (they carry no nonce), and the `data:` modules that import CSS. Browsers ignore `'unsafe-inline'` in a
  policy with a nonce: it does not help.
- Turbo also gives the nonce of `<meta name="csp-nonce">` to the scripts it runs from fetched HTML. The layout puts
  the style nonce there: keep the script nonce a different one.
- With a nonce per request, a Turbo visit keeps the policy of the page first loaded. Turbo compares `<head>` elements
  without their nonce, so the layout's scripts are not run again. An inline `<script>` in `<body>` would be, with a
  nonce the policy does not know, and Turbo reports the inline `<style>` of every page it fetches: the layouts have
  none, the progress bar takes the brand color from the `theme` recipe's stylesheet.
- The components print no inline script, style or event handler: `Avatar:Image` is shown by its controller, and
  `Progress` sizes its bar without a `style` attribute. Style attributes you write yourself need
  `style-src-attr 'unsafe-inline'`, or `'unsafe-hashes'` with their hashes.
