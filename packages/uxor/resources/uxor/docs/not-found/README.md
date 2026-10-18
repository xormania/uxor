# Not Found

The content of a 404 (or any error) page: status, title, explanation and a way back.

```twig {"preview":true}
<twig:NotFound homeHref="#" />
```

## Installation

::: installation

## Usage

In production, Symfony renders `templates/bundles/TwigBundle/Exception/error404.html.twig` for a 404. In dev, preview it at `/_error/404`. The page below extends the `layouts` recipe's `error.html.twig` (`ux:install layouts`); extend your own base template otherwise:

```twig
{# templates/bundles/TwigBundle/Exception/error404.html.twig #}
{% extends 'layouts/error.html.twig' %}

{% block title %}Page not found{% endblock %}
{% block content %}
    <twig:NotFound homeHref="{{ path('app_home') }}" />
{% endblock %}
```

For other errors, Symfony renders `templates/bundles/TwigBundle/Exception/error.html.twig`, where `status_code` holds the HTTP status. Extend the same layout and use this as its `content` block:

```twig
<twig:NotFound :status="status_code" title="Something went wrong" message="Please try again in a moment." homeHref="{{ path('app_home') }}">
    <twig:block name="actions"><twig:Button as="a" href="mailto:support@example.com" variant="outline">Contact support</twig:Button></twig:block>
</twig:NotFound>
```
