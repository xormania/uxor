# Dashboard Home

A dashboard home: page header, key figures, two cards and a table of recent orders.

```twig {"preview":true}
<div class="w-full">
    <twig:DashboardHome />
</div>
```

## Installation

::: installation

## Usage

Without props, it shows sample data. Installing it also installs the `layouts` recipe, so a route and a template are all you need to see it:

```php
// src/Controller/DashboardController.php
#[Route('/', name: 'app_home')]
public function index(): Response
{
    return $this->render('dashboard/index.html.twig');
}
```

```twig
{# templates/dashboard/index.html.twig #}
{% extends 'layouts/app.html.twig' %}

{% block title %}Dashboard{% endblock %}
{% block content %}
    <twig:DashboardHome />
{% endblock %}
```

`DashboardHome` renders its own page header from its `title` and `description` props: leave the layout's `page_title` block empty, or the page shows two headers.

Then pass your own data. Each prop is a list of arrays, and text values are shown as given, so format them first:

- `stats`: `{label, value, trend, change, period}`, as for `StatCard`; the cards take three columns once the block is
  42rem wide (a container query: the room beside a sidebar counts, not the screen), their values a step smaller in a
  narrow column;
- `channels`: `{label, value}`, the value from 0 to 100;
- `activity`: `{text, time}`;
- `orders`: `{id, customer, status, total}`, the status `paid`, `pending` or `refunded`.

For example:

```twig
<twig:DashboardHome
    :stats="[{label: 'Revenue', value: '$' ~ revenue|number_format, trend: 'up', change: '12%', period: 'vs last month'}]"
    :channels="channels"
    :activity="activity"
    :orders="orders"
>
    <twig:block name="actions"><twig:Button as="a" href="{{ path('app_report') }}">Download report</twig:Button></twig:block>
</twig:DashboardHome>
```
