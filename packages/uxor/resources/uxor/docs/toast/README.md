# Toast

Short-lived notifications in a fixed region, added on page load or by Turbo Streams, dismissed after a timeout or by the user.

```twig {"preview":true}
<twig:ToastRegion class="static max-w-sm">
    <twig:Toast variant="success" timeout="0">Order #1042 has been shipped.</twig:Toast>
    <twig:Toast variant="danger" timeout="0">The payment could not be processed.</twig:Toast>
</twig:ToastRegion>
```

## Installation

::: installation

## Usage

Put one region in the base layout, so every page has it (the `layouts` recipe's `base.html.twig` already does). It is `data-turbo-permanent`: on a Turbo visit, Turbo keeps the region on screen, with its toasts:

```twig
<twig:ToastRegion />
```

Add a toast with `<twig:Toast:Stream>`. It renders a Turbo Stream that appends the toast to the region, so it works anywhere in the page body, in a `*.stream.html.twig` response or in a Mercure update. Flash messages use it in the page body:

```twig
{% for message in app.flashes('success') %}
    <twig:Toast:Stream variant="success">{{ message }}</twig:Toast:Stream>
{% endfor %}
```

A toast closes itself after 5 seconds. Set `timeout` in milliseconds, or `timeout="0"` to keep it until the user closes it. In the region, a toast stays across Turbo visits until then.

A toast placed outside a region belongs to its page: Back and Forward never show it again, and a frame visit promoted to history (`data-turbo-action="advance"`, a data table's pages) leaves it on screen.

Toasts written inside `<twig:ToastRegion>` show on a full page load only: on a Turbo Drive visit, Turbo keeps the region already on screen and drops the new page's copy, with its toasts. Use `<twig:Toast:Stream>` instead.

The region is a polite live region, so new toasts are announced (`danger` ones interrupt, with `role="alert"`). Toasts pause while hovered or focused and never move focus.

A closed toast fades out (`opacity`), then leaves the page; under `prefers-reduced-motion` it leaves at once.

Whether a toast connects in a cached copy of the page, and whether it sits in a `data-turbo-permanent` region, are
answered by the `turbo` recipe's module (`assets/lib/uxor-turbo.js`), which `ux:install toast` installs with
it.
