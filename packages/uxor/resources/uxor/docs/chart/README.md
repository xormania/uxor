# Chart

Charts drawn with Symfony UX Chart.js in the theme's colors, light and dark, each with its data as a table.

```twig {"preview":true}
<div class="w-full max-w-xl p-4">
    <twig:Chart
        id="chart-revenue"
        title="Revenue by month"
        labelsHeader="Month"
        :labels="['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']"
        :datasets="[{label: '2025', data: [12, 19, 14, 17, 22, 24]}, {label: '2026', data: [15, 21, 18, 25, 28, 31]}]"
    />
</div>
```

## Installation

::: installation

Run the `composer require` command `ux:install` prints: Symfony Flex registers UX Chart.js and its Stimulus controller,
and adds `chart.js` to the import map. If `importmap.php` has no `chart.js` entry afterwards, run
`php bin/console importmap:require chart.js`. There is no stylesheet: the colors are the theme's `chart-1` to
`chart-6` and `chart-other` roles (reinstall the `theme` recipe if your `uxor.css` has no `--color-chart-1`).

## Usage

Give the data, never colors: the series take the theme's chart roles in order, and the axes, legend and tooltip its
text and border roles. They follow light and dark as the theme switches.

```twig
<twig:Chart
    type="line"
    title="Visits this week"
    labelsHeader="Day"
    :labels="days"
    :datasets="[{label: 'Visits', data: visits}]"
/>
```

- `title` is required: it names the chart, its canvas and its data table. `description` adds one sentence saying what
  the chart shows; screen readers read it with the chart.
- `type`: `bar` (the default), `line`, `pie`, `doughnut`, `radar`, `polarArea`, `scatter` or `bubble`.
- `options` are Chart.js options, e.g. `{indexAxis: 'y'}` for horizontal bars or `{scales: {y: {beginAtZero: true}}}`.
- `size`: `sm`, `md` (the default), `lg` or `xl` sets the chart's height; it takes its container's width.
- `table`: `details` (the default) puts the data table behind a "Show the data as a table" toggle, `visible` always
  shows it, `hidden` keeps it for screen readers only.
- Up to six series get their own color; any series after the sixth is gray. Fold small series into an "Other" one, or
  split the chart.
- Category data may come as points instead of `labels` (`{x: 'Jan', y: 12}`, or `{y: 'Jan', x: 12}` with
  `indexAxis: 'y'`): the table takes its rows from the points, in order.
- Pass a stable `id` inside Live Components and Turbo Frames.

### With `ChartBuilderInterface`

Charts built in PHP with UX Chart.js keep working: pass the `Chart` object.

```php
use Symfony\UX\Chartjs\Builder\ChartBuilderInterface;
use Symfony\UX\Chartjs\Model\Chart;

$chart = $chartBuilder->createChart(Chart::TYPE_LINE)
    ->setData(['labels' => $days, 'datasets' => [['label' => 'Visits', 'data' => $visits]]])
    ->setOptions(['scales' => ['y' => ['beginAtZero' => true]]]);
```

```twig
<twig:Chart :chart="chart" title="Visits this week" />
```

`render_chart(chart, {'data-controller': 'chart'})` themes a chart drawn with UX Chart.js's own function, without the
title, description and table.

### A color of your own

A color the data gives is kept. To use a theme role, write it as a variable: it follows light and dark too.

```twig {"preview":true}
<div class="w-full max-w-xl p-4">
    <twig:Chart
        id="chart-signups"
        type="line"
        title="Sign-ups"
        description="Sign-ups grew every week."
        labelsHeader="Week"
        :labels="['W1', 'W2', 'W3', 'W4', 'W5']"
        :datasets="[{label: 'Sign-ups', data: [40, 52, 61, 70, 84], borderColor: 'var(--color-fg-success)', backgroundColor: 'var(--color-fg-success)'}]"
        :options="{scales: {y: {beginAtZero: true}}}"
    />
</div>
```

### Formatting the table's values

The table prints values as given. Format them in the `value` block, which gets `value`, its `dataset` and its `label`;
Chart.js formats the axes and tooltips through `options`.

```twig
<twig:Chart title="Revenue" :labels="months" :datasets="[{label: 'Revenue', data: revenue}]">
    <twig:block name="value">{{ value|number_format(0, '.', ',') }} €</twig:block>
</twig:Chart>
```

### Plugins

Register Chart.js plugins as UX Chart.js documents, on its `chartjs:init` event, in your own controller or
`assets/app.js`.

## Examples

### Doughnut

```twig {"preview":true}
<div class="w-full max-w-md p-4">
    <twig:Chart
        id="chart-traffic"
        type="doughnut"
        title="Traffic sources"
        labelsHeader="Source"
        :labels="['Search', 'Direct', 'Social', 'Email']"
        :datasets="[{label: 'Visits', data: [540, 310, 180, 90]}]"
    />
</div>
```

### Horizontal bars

```twig {"preview":true}
<div class="w-full max-w-xl p-4">
    <twig:Chart
        id="chart-tickets"
        title="Open tickets by team"
        labelsHeader="Team"
        size="sm"
        :labels="['Billing', 'Platform', 'Mobile', 'Web']"
        :datasets="[{label: 'Open', data: [7, 12, 4, 9]}, {label: 'Urgent', data: [1, 3, 0, 2]}]"
        :options="{indexAxis: 'y'}"
    />
</div>
```

### In a card, with its table shown

```twig {"preview":true}
<div class="w-full max-w-xl p-4">
    <twig:Card class="max-w-none">
        <twig:Chart
            id="chart-orders"
            type="line"
            title="Orders"
            labelsHeader="Day"
            table="visible"
            size="sm"
            :labels="['Mon', 'Tue', 'Wed', 'Thu', 'Fri']"
            :datasets="[{label: 'Orders', data: [18, 24, 21, 30, 27]}]"
        />
    </twig:Card>
</div>
```

## Turbo and Live Components

- Turbo visits, Back, Turbo Frames, Turbo Streams and `data-turbo-permanent` elements create and destroy the chart
  with its canvas, so no chart outlives its page.
- In a Live Component, a re-render with new data updates the chart in place, and the table re-renders. Pass a stable
  `id`.

## Accessibility

- The chart is a `<figure>` named by its title; the canvas is an image (`role="img"`) named by the title and described
  by `description`.
- The data table gives every value in text, for keyboard and screen reader users who cannot read the canvas; the
  legend and the table name each series, so no information depends on color alone.
- Every series color reaches 3:1 against the page and cards in both themes.
- Under `prefers-reduced-motion`, the chart does not animate.

## Security

`type`, `size` and `table` fall back to their defaults for any other value. Labels and values are printed escaped in
the table, and the chart's data reaches the canvas as JSON in an attribute: Chart.js callbacks cannot come from the
server.
