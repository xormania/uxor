# Stat Card

A key figure with its label and, optionally, how it changed over a period.

```twig {"preview":true}
<div class="@container w-full">
    <div class="grid gap-4 @2xl:grid-cols-3">
        <twig:StatCard label="Revenue" value="$48,250" trend="up" change="12%" period="vs last month" />
        <twig:StatCard label="Refunds" value="$1,920" trend="down" change="3.4%" period="vs last month" />
        <twig:StatCard label="Active customers" value="1,284" />
    </div>
</div>
```

## Installation

::: installation

## Usage

```twig
<twig:StatCard label="Revenue" value="{{ revenue|format_currency('USD') }}" trend="up | down" change="12%" period="vs last month" />
```

The trend is announced to screen readers ("Increased by 12%"), not only shown by the arrow and color.

Lay the cards out by the room they get, not the screen's width: a page with a sidebar leaves a tablet little room
for three columns. The example above is a [container](https://tailwindcss.com/docs/responsive-design#container-queries)
(`@container`) whose grid takes three columns from `@2xl` (42rem) up. Inside a container narrower than `@3xs` (16rem),
such as a grid cell marked `@container`, the value is a step smaller (`text-2xl`); a value still too long for its card
wraps instead of spilling out of it.
