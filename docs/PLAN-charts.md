---
status: shipped
recipes: chart
---

# Plan: E1. Charts

_2026-10-08. This plan implements the E1 decision in [`ROADMAP.md`](ROADMAP.md): UX Chart.js, a theme bridge that reads the theme's CSS variables into the chart options and redraws on light/dark, an accessible data table with every chart, and the CSP, Turbo, Live and teardown gates. It adds one recipe, `chart`, plus six chart color roles in the theme. Decided with the user on 2026-10-08: every recommended answer to the open questions at the end._

## Sources read

`symfony/ux-chartjs` **v3.5.1** (published 2026-09-20). It is not in `demo/vendor/` yet; its files were read at the `v3.5.1` tag of `github.com/symfony/ux-chartjs`. Its constraints match the demo's other `^3.5` UX packages: PHP ≥ 8.4, Symfony `^7.4|^8.0`, `symfony/stimulus-bundle ^2.9.1|^3.0`.

| Piece | What it does |
|---|---|
| `ChartBuilderInterface::createChart(string $type): Chart` | Service alias `chartjs.builder`. `ChartBuilder` only does `new Chart($type)` |
| `Model\Chart` (`@final`) | Type constants `TYPE_LINE`, `TYPE_BAR`, `TYPE_RADAR`, `TYPE_PIE`, `TYPE_DOUGHNUT`, `TYPE_POLAR_AREA`, `TYPE_BUBBLE`, `TYPE_SCATTER`. Setters `setData`, `setOptions`, `setAttributes`; getters `getType`, `getData`, `getOptions`, `getAttributes`, `getDataController`. `createView()` returns `{type, data, options}` |
| `render_chart(chart, attributes = {})` (`Twig\ChartExtension`) | Prints `<canvas data-controller="[custom] symfony--ux-chartjs--chart" data-symfony--ux-chartjs--chart-view-value="{json}" …attributes>` through `StimulusHelper`. A `data-controller` in the attributes is put **before** the ux-chartjs controller. Nothing else: no wrapper, no fallback content, no ARIA |
| Stimulus controller `@symfony/ux-chartjs/chart`, i.e. `symfony--ux-chartjs--chart` (`assets/dist/controller.js`) | Module level: `Chart.register(...registerables)` and a one-time `chartjs:init` `{Chart}`. **`connect()`:** throws unless the element is a `<canvas>`; turns `options: []` into `{}`; dispatches `chartjs:pre-connect` `{options, config}` (the very objects passed on, so they can be changed in place); runs `new Chart(ctx, payload)`; dispatches `chartjs:connect` `{chart}`. **`disconnect()`:** dispatches `chartjs:disconnect` `{chart}`, then `chart.destroy()`. **`viewValueChanged()`** (the Live Component path): dispatches `chartjs:view-value-change` with `{data, options}` **before** assigning them to `chart.data`/`chart.options`, so it can be changed in place; calls `chart.update()`; nudges `parentElement.style.width` by 1px for a tick (through the CSSOM). Events bubble and use the `chartjs:` prefix |
| `package.json` `symfony` | Controller `chart`, `fetch: eager`. Importmap peer `chart.js: "^3.4.1 \|\| ^4.0"` |
| `ChartjsExtension::prepend` | Maps `assets/dist` as `@symfony/ux-chartjs` in AssetMapper (also with Symfony 8.2's standalone `AssetMapperBundle`) |
| `doc/index.rst` | Recommends a custom controller on the canvas through `render_chart(chart, {'data-controller': 'mychart'})`, listening to `chartjs:pre-connect` / `chartjs:connect`. Plugins are registered on `chartjs:init` |

**Assumptions to check when the work starts** (not verifiable from the sandbox):

- The Flex recipe for `symfony/ux-chartjs` registers the bundle and adds `@symfony/ux-chartjs` to `assets/controllers.json`. Flex's package.json sync then runs `importmap:require chart.js`, which brings in `@kurkle/color`. This needs jsDelivr, which the sandbox cannot reach (the same limit as Tom Select). The browser tests of charts therefore run in CI only, as for autocomplete.
- Chart.js 4.5.x is what `importmap:require` resolves.
- Chart.js 4's DOM platform sizes the canvas through the CSSOM (`canvas.style.*`, plus `width`/`height` attributes) and injects no `<style>` (Chart.js 2 did). So it should need nothing more under the demo's CSP.

**Found in this repo:**

- **Dark mode** is the `dark` class on `<html>`:
  - set before first paint by the inline script in `layouts/templates/layouts/base.html.twig:18`;
  - toggled by `theme_toggle_controller.js`, which also follows `prefers-color-scheme` when the user made no choice;
  - set server-side by `demo/templates/preview.html.twig` (`?theme=dark`).

  `theme_toggle_controller.js` already watches it with a `MutationObserver` on `document.documentElement` (`attributeFilter: ['class']`). The bridge uses the same pattern.
- **Tailwind 4.3.3 writes a theme variable to `:root` only when it is used.** In `demo/var/tailwind/app.built.css`, the light `--color-purple`, `--color-teal` and `--color-sky` are absent; only their `.dark` copies (plain CSS in `kit.css`) are there. A bridge reading `getComputedStyle(...).getPropertyValue('--color-purple')` would get `''` in light mode. The recipe template must use every role it reads (see *Theme bridge*).
- **Role values are `oklch(…)`.** The canvas can draw them, but Chart.js's color helper (`@kurkle/color`, used for hover colors and for alpha) cannot parse them. The bridge therefore converts every color to `rgb()`/`rgba()`.
- **`ux-toolkit-kit-lint`:**
  - `js.import.undeclared`: an `import 'chart.js'` must be declared as `dependencies.importmap`. The manifest schema supports `"importmap": ["…"]`.
  - `stimulus.controller.missing`: a literal `data-controller="… symfony--ux-chartjs--chart"` would warn. Use a variable, as `Autocomplete.html.twig` does, or StimulusBundle's `stimulus_controller()`.
- **`tools/contrast/check.mjs`** reads only `--color-*` in `kit.css` (`@theme` and `.dark`). Chart colors can be contrast-checked only if they are roles in `kit.css`.
- **Screenshot fixture** (`tests/e2e/examples/fixtures.ts`): `gotoExample` installs a fake clock (rAF fires without a real frame), then `runFor(1000)`. Chart.js animates for 1000 ms from the moment it connects, so it is not reliably finished at the screenshot.

## Palette (validated)

Six categorical roles, in a fixed order. They are never cycled, and the 7th series and beyond get "other" gray (decision 6). Validated with the dataviz validator (lightness band, chroma floor, adjacent-pair CVD ΔE, normal-vision ΔE, ≥ 3:1 against the surface). Both modes pass every check, including dark against gray-950, gray-900 and gray-800.

| Role | Light (`@theme`) | Dark (`.dark`) | Light on white / gray-50 | Dark on gray-950 / 900 / 800 |
|---|---|---|---|---|
| `chart-1` | blue-700 | blue-500 | 6.8 / 6.5 | 5.4 / 4.7 / 3.9 |
| `chart-2` | orange-600 | orange-600 | 3.6 / 3.4 | 5.6 / 4.9 / 4.1 |
| `chart-3` | teal-600 | teal-600 | 3.7 / 3.5 | 5.5 / 4.9 / 4.0 |
| `chart-4` | purple-600 | purple-500 | 5.5 / 5.3 | 4.9 / 4.3 / 3.6 |
| `chart-5` | pink-600 | pink-500 | 4.5 / 4.4 | 5.6 / 5.0 / 4.1 |
| `chart-6` | lime-700 | lime-600 | 5.0 / 4.8 | 6.6 / 5.8 / 4.8 |
| `chart-other` | gray-500 | gray-500 | 4.8 / 4.6 | 4.2 / 3.7 / 3.0 |

Light was validated as `#1447e6,#f54900,#009689,#9810fa,#e60076,#497d00`, dark as `#2b7fff,#f54900,#009689,#ad46ff,#f6339a,#5ea500`. The order matters: putting pink next to teal fails deutan CVD (ΔE 4.5).

The axes and chrome use existing roles:

| Part | Role |
|---|---|
| Ticks, legend | `body` |
| Titles | `heading` |
| Grid | `default` |
| Axis line | `default-medium` |
| Tooltip | `neutral-primary-medium` background, `default-medium` border, `heading` title, `body` text |

---

## Deliverable: a `chart` recipe, plus chart roles in the theme

### Theme (`kit.css` and `theme/assets/styles/uxor.css`, which stay identical)

- Add `--color-chart-1` … `--color-chart-6` and `--color-chart-other` to `@theme` and to `.dark`, with the values above and a `/* chart series: categorical order, validated for CVD */` comment.
- This also gives `bg-chart-N` utilities, which the table swatches use.

`tools/contrast/pairs.json` gets 14 rows, `min: 3`, both themes:

| fg | bg | usage |
|---|---|---|
| `chart-1` … `chart-6`, `chart-other` | `neutral-primary` | chart series on the page |
| `chart-1` … `chart-6`, `chart-other` | `neutral-primary-soft` | chart series in a card |

Add `body`/`neutral-primary-medium` (4.5, "chart tooltip text") if no row covers it yet.

### Recipe files

```
chart/
  manifest.json
  README.md
  templates/components/Chart.html.twig
  assets/controllers/chart_controller.js
  tests/screenshots/*.png            (recorded with --update-snapshots=missing)
```

### `chart/manifest.json`

- This kit's `$schema` line.
- `type: component`, `name: Chart`.
- `copy-files`: `{"assets/": "assets/", "templates/": "templates/"}`.
- `dependencies`:
  - `recipe`: `["table", "theme"]`;
  - `composer`: `symfony/ux-chartjs:^3.5`, `symfony/ux-twig-component:^3.5`, `twig/html-extra:^3.24.0`, `twig/extra-bundle`, `tales-from-a-dev/twig-tailwind-extra:^1.3.0`. Add `symfony/stimulus-bundle:^3.5` if the lint's `composer.symbol-undeclared` flags `stimulus_controller`;
  - `importmap`: `["chart.js"]`, because the bridge imports `Chart` for `Chart.getChart()` (decision 4).

  Single ranges only, no `|`.

### `Chart.html.twig`: the component an agent writes

It is anonymous (no PHP class), so it works in README previews and needs no app code.

**Props**, each with a `## <type> <description>` line:

| Prop | Type, default | Notes |
|---|---|---|
| `title` | string | **Required.** It names the chart (`figcaption`), the canvas (`aria-labelledby`) and the table (`<caption>`) |
| `type` | string, `'bar'` | Allowlist: `line`, `bar`, `pie`, `doughnut`, `radar`, `polarArea`, `scatter`, `bubble`. Anything else falls back to `bar` (checked prop, CONTRIBUTING *Props that shape markup*) |
| `labels` | array, `[]` | The category labels |
| `datasets` | array, `[]` | Chart.js datasets: `label`, `data`, and any Chart.js dataset option |
| `options` | array, `{}` | Chart.js options, merged over `{responsive: true, maintainAspectRatio: false}` |
| `chart` | `Symfony\UX\Chartjs\Model\Chart`\|null, `null` | A chart built with `ChartBuilderInterface`. When set, `type`, `labels`, `datasets` and `options` come from it (`getType()`, `getData()`, `getOptions()`). Its `getAttributes()` go on the canvas; a `data-controller` among them goes before the ux-chartjs controller, as `render_chart` does |
| `description` | string\|null | A one-sentence takeaway ("Sales doubled in March"). It is shown under the title and referenced by `aria-describedby` |
| `size` | string, `'md'` | `sm`/`md`/`lg`/`xl` → `h-48`/`h-64`/`h-80`/`h-96` on the canvas box (`html_cva`) |
| `table` | string, `'details'` | `details` (collapsible, the default), `visible`, or `hidden` (`sr-only`) |
| `tableLabel` | string, `'Show the data as a table'` | The `<summary>` text |
| `labelsHeader` | string, `'Label'` | The header of the label column, e.g. "Month" |
| `id` | string\|null | The base of the ids (`-title`, `-description`, `-table`). It is generated when missing; the README says to pass one inside Live Components and Turbo Frames, as for `Tooltip` |
| `hideTitle` | boolean, `false` | Keeps the caption for screen readers only (`sr-only`) |

**Markup:**

```twig
<figure {{ attributes.defaults({class: '…'|tailwind_classes, 'data-controller': 'chart', 'data-action': 'chartjs:pre-connect->chart#configure chartjs:connect->chart#adopt chartjs:view-value-change->chart#reconfigure'}) }} id="{{ id }}">
  <figcaption id="{{ id }}-title" class="text-base font-semibold text-heading">…</figcaption>
  {# optional <p id="{{ id }}-description" class="text-sm text-body"> #}
  <div class="relative {{ size class }}">            {# Chart.js: a positioned box holding only the canvas #}
    <canvas data-chart-target="canvas" role="img" aria-labelledby="{{ id }}-title" [aria-describedby]
            {{ stimulus_controller('@symfony/ux-chartjs/chart', {view: view}) }}>
      {{ title }}: the data is in the table below.     {# fallback content #}
    </canvas>
  </div>
  <details class="mt-3"> <summary class="text-sm text-fg-brand … focus-visible:ring-brand-medium">{{ tableLabel }}</summary>
    <twig:Table id="{{ id }}-table"> …
  </details>
</figure>
```

- `view` is `{type, data: {labels, datasets}, options: {responsive: true, maintainAspectRatio: false}|merge(options)}`.
- Empty `options` is printed as `{}`, never `[]`. ux-chartjs fixes only the top-level case, so nested empty arrays are not fixed: the README says so.

**Table** (`Table`, `Table:Head`, `Table:Body`, `Table:Row`, `Table:Header`, `Table:Cell` from the `table` recipe):

- `<caption class="sr-only">{{ title }}</caption>`.
- **Category charts** (line, bar, radar, pie, doughnut, polarArea): one row per label (`<th scope="row">`), one column per dataset (`<th scope="col">` with the dataset `label`). Each header has a swatch `<span aria-hidden="true" data-chart-target="swatch" data-index="N" class="inline-block size-2.5 rounded-full bg-chart-N">`.
- **Point charts** (scatter, bubble): rows of series, x, y (and r).
- Values are printed as given, inside a `{##- … -#}`-documented block `value`, which receives `value`, `dataset` and `label`. An agent formats values by overriding it: `<twig:block name="value">{{ value|number_format(2) }} €</twig:block>`.

**Tailwind emission:** a `{#- … -#}` comment in the template names every role the bridge reads, so Tailwind's scanner writes their variables:

```
bg-chart-1 bg-chart-2 bg-chart-3 bg-chart-4 bg-chart-5 bg-chart-6 bg-chart-other text-body text-heading border-default border-default-medium bg-neutral-primary-medium
```

- **CSP:** no `style` attribute and no `<style>` element.

### `chart_controller.js`: the theme bridge

- Identifier `chart`. It sits on the `<figure>`; `chartjs:*` events bubble up from the canvas.
- `@target canvas`, `@target swatch`, `@action configure`, `@action adopt`, `@action reconfigure`, each with a description that starts with a capital letter and ends with a period.
- It imports `{ Chart } from 'chart.js'`, the same module instance ux-chartjs uses through the import map, only for `Chart.getChart(canvas)`.

**`connect()`**
- Creates a `MutationObserver` on `document.documentElement`, `attributeFilter: ['class']`, which calls `#retheme()`.
- Reads `matchMedia('(prefers-reduced-motion: reduce)')`.
- If ux-chartjs connected first (lazy loading, or a different order), `Chart.getChart(canvas)` already returns a chart: call `#retheme()` at once. This removes the dependency on controller order. In the normal case the figure, an ancestor, connects first and catches `pre-connect`, so there is no flash of unthemed colors.

**`disconnect()`**
- Disconnects the observer and drops references.
- It never destroys the chart: ux-chartjs's `disconnect()` does that.

**`configure({detail: {config}})`**, on `chartjs:pre-connect`: applies the theme layer to `config` in place.

**`adopt({detail: {chart}})`**, on `chartjs:connect`: paints the swatches.

**`reconfigure({detail})`**, on `chartjs:view-value-change`, after a Live re-render: applies the layer to `detail.data` and `detail.options` in place. ux-chartjs then assigns them, so a Live update keeps the theme.

**`#retheme()`**
- Reads the tokens again.
- Applies the layer to `chart.config.options` and `chart.config.data` **in place**, so callbacks other controllers added in `pre-connect` survive.
- Calls `chart.update('none')` and paints the swatches.
- Dispatches `chart:themed` `{chart}`, which the specs count.

**Theme layer: one pure function, `#apply(target, pristine, tokens, type)`.**

`pristine` is `JSON.parse` of the canvas's `data-symfony--ux-chartjs--chart-view-value`, i.e. the server's payload. The rules, which make it idempotent and repeatable on every theme switch:

1. **Fill only what the server left unset.** Every path the layer owns is written only where `pristine` has no value at that path. On a switch the same paths are rewritten, and the server's own colors are never touched.
2. **Theme roles from PHP.** Any string in `pristine` (datasets or options) matching `^var\(--[\w-]+\)$` is resolved to the current theme's color at the same path, and resolved again on every switch. So PHP can write `'borderColor' => 'var(--color-fg-success)'` and still follow light/dark.

**Paths the layer owns:**

- **Root:**
  - `color` (`body`), `borderColor` (`default`);
  - `font.family` (the figure's computed `font-family`);
  - `animation: false` under reduced motion.
- **Scales:** the ids in `pristine.options.scales`, plus `x`/`y` for cartesian types or `r` for radar/polarArea.
  - `ticks.color`, `grid.color`, `border.color`, `title.color`;
  - for radial scales also `angleLines.color`, `pointLabels.color`, `ticks.backdropColor` (surface).
- **Plugins:**
  - `legend.labels.color`, `title.color`, `subtitle.color`;
  - `tooltip`: `backgroundColor`, `titleColor`, `bodyColor`, `footerColor`, `borderColor`, `borderWidth: 1`.
- **Datasets:** by `dataset.type ?? type`, with series index `i` → `chart-(i+1)`, and `chart-other` from the 7th series on.
  - line/radar: `borderColor` cᵢ, `backgroundColor` cᵢ at 0.15 alpha, `pointBackgroundColor` cᵢ, `borderWidth` 2;
  - bar: `backgroundColor` cᵢ, `borderColor` cᵢ, `borderRadius` 4, `maxBarThickness` 40;
  - pie/doughnut/polarArea: `backgroundColor` = one color per data index, `borderColor` = surface, `borderWidth` 2;
  - scatter/bubble: `backgroundColor` cᵢ at 0.6, `borderColor` cᵢ.

**Tokens**
- Read with `getComputedStyle(figure).getPropertyValue('--color-…')`, from the figure, so a container can override them in scope.
- **Surface** is the computed `background-color` of the nearest ancestor that is not transparent: the page or a card.
- Every value is converted to `rgb(a)` by painting it on a 1×1 off-DOM canvas and reading `getImageData` (`willReadFrequently`). That is exact for `oklch`, hex and named colors, gamut-clipped as the browser paints them. Results are cached per apply.
- An empty variable leaves the path unset (Chart.js's default) and logs one `console.warn` naming the variable. The fixtures fail on `error`, not on `warn`.

**Swatches**
- `swatch.style.backgroundColor = resolved color` through the CSSOM (allowed under CSP), only for datasets whose color the server set. Otherwise the `bg-chart-N` class already matches.

**No global state:**
- no `Chart.defaults`;
- no `chartjs:init` listener;
- no `document`/`window` listeners.

The `matchMedia` object is used read-only. Running `connect()` again is safe: the layer is idempotent, and the observer is re-created after `disconnect()`.

**`render_chart()` users** (decision 8): if the controller's element is itself a `<canvas>`, it uses that element as the canvas. Then `{{ render_chart(chart, {'data-controller': 'chart'}) }}` gets the theme but no table or ARIA. The README shows this as the lower-level path.

### What an agent writes

Without PHP chart code (the data comes from the controller as arrays):

```twig
<twig:Chart type="bar" title="Revenue by month" labelsHeader="Month"
    :labels="months" :datasets="[{label: '2025', data: revenue2025}, {label: '2026', data: revenue2026}]" />
```

With `ChartBuilderInterface` (existing UX Chart.js code keeps working):

```php
$chart = $chartBuilder->createChart(Chart::TYPE_LINE)
    ->setData(['labels' => $days, 'datasets' => [['label' => 'Visits', 'data' => $visits]]])
    ->setOptions(['scales' => ['y' => ['beginAtZero' => true]]]);
```

```twig
<twig:Chart :chart="chart" title="Visits this week" />
```

There are no colors in either: the theme supplies them. To use a role, write `'var(--color-fg-danger)'`.

### README (`chart/README.md`, house order)

**Opening:**
- `# Chart`, then the summary: "Charts with Symfony UX Chart.js in the theme's colors, light and dark, each with its data as a table."
- The first preview example: a two-series bar chart.

**`## Installation`** holds only `::: installation`. Then:
1. Run the printed `composer require`. Flex registers the bundle and the controller, and adds `chart.js` to the import map.
2. If `importmap.php` has no `chart.js`, run `php bin/console importmap:require chart.js`.
3. No stylesheet: the colors are the theme's `chart-*` roles. Re-install `theme` if `uxor.css` predates them.

**`## Usage`**:
- arrays versus `ChartBuilderInterface`;
- theme roles through `var(--color-…)`;
- `render_chart` with `data-controller: 'chart'`;
- plugins through `chartjs:init` (the UX Chart.js docs' pattern);
- the "six series" rule.

**Previews** (`{"preview":true}`):
- bar (2 series);
- line;
- doughnut;
- horizontal bar (`indexAxis: 'y'`);
- `table="visible"`;
- `size="sm"` in a `Card`;
- a role through `var(--color-fg-success)`.

**`### With Turbo and Live Components`**:
- Visits, Back, Frames, Streams and permanent elements create and destroy the chart.
- In a Live Component, the chart updates in place when its data changes, and the table re-renders. Pass `id`.

**`### Accessibility`**:
- what screen readers get (canvas name, description, table);
- the `description` prop;
- "no information by color alone": legend, table and labels;
- reduced motion turns animation off.

**`### Security`**:
- `type`/`size`/`table` are allowlisted;
- labels are escaped in the table, and the JSON is escaped by StimulusBundle;
- callbacks cannot come from PHP (JSON only).

---

## Gates

### CSP (`demo/src/EventListener/SecurityHeadersListener.php` unchanged)

- `chart.js`, `@kurkle/color` and the ux-chartjs controller are same-origin modules loaded by the nonced import map (`'strict-dynamic'`).
- The view is a `data-*` JSON attribute.
- Chart.js and ux-chartjs write only through the CSSOM (`canvas.style`, `parent.style.width`); so do the bridge's swatches. The template has no `style=""`.
- **Risk to check:** a Turbo snapshot clones the canvas together with the `style` attribute Chart.js gave it. Tom Select's styled elements already pass the autocomplete Back spec with no violation, which suggests clones are not checked. If `lab.chart-turbo.spec.ts` shows a `style-src-attr` violation on Back, add `turbo:before-cache@document->chart#release`. It is a Stimulus action in the markup, like the popover's `closeSilently`. It calls `chart.destroy()` (which restores the canvas's attributes) before the snapshot. Chart.js's `destroy()` is safe to call twice, since ux-chartjs calls it again on disconnect. Contingency only.
- `tests/e2e/csp.spec.ts`: add `/lab/chart-turbo` and `/preview/chart/default?theme=light` to `pages`.

### Turbo gate (lab specs)

- **Teardown probe (demo only, not shipped):** `demo/assets/controllers/lab_chart_probe_controller.js`.
  - It imports `Chart` and has a button "Probe charts".
  - The button writes JSON to `<output data-testid="chart-probe">`: `Object.keys(Chart.instances).length`, and per canvas id: `labels`, the first dataset's `backgroundColor`, the x grid color, `canvas.width`, and whether `canvas.$chartjs` is set.
  - `Chart.instances` is the real leak check, because a destroyed chart leaves it.
  - It goes on the lab pages and on `/lab/turbo-nav/two`.
- **Event counter:** an `addInitScript` listener in the specs counts the `chartjs:connect`, `chartjs:disconnect` and `chart:themed` events (they bubble to `document`).

**Scenarios** (`LabController::SCENARIOS` and routes):

| Scenario | Content |
|---|---|
| `chart-turbo/{page}` (one\|two) | Three charts: a bar, a doughnut in a `Card`, and a line inside `data-turbo-permanent` (`id="lab-permanent-chart"`, on both pages). Also a `<turbo-frame id="chart-frame">` holding a chart, with a "Reload the frame" link (`load` counter) |
| `chart-stream` (GET/POST `action=replace\|update`) | `#streamed-chart`; `chart_stream.stream.html.twig` re-renders it with a counter and new data |
| `live-chart` | `Lab:LiveChart` (`demo/src/Twig/Lab/LiveChart.php` plus `demo/templates/lab/components/LiveChart.html.twig`). LiveProps: `range` (writable, `7`\|`30` through a select with `data-model`) and `sales` (array). A `#[LiveAction] addSale` and a `renders` counter. Served by the existing `live()` route |

**`tests/e2e/lab.chart-turbo.spec.ts`**
1. **Cache snapshot and Back:** visit page two, then Back.
   - Each canvas has a live chart (`$chartjs`), `Chart.instances` equals the charts on the page, and the canvas size equals the size before the visit.
   - The table's `<details>` state is as left.
   - No console error or CSP violation (fixtures).
2. **Repeated visits:** three round trips.
   - `chartjs:connect − chartjs:disconnect` equals the charts on screen.
   - Then toggle the theme once: `chart:themed` fires once per chart on screen, so no stale observers remain.
   - Page two's probe shows only the permanent chart's instance.
3. **Permanent:**
   - The permanent canvas is the same node (an expando set before the visits).
   - There is one instance for it, and it follows a theme toggle made on page two.
4. **Frame:** reload the frame three times. One instance for the framed canvas, and the old ones are destroyed.
5. **Theme switch:**
   - Light, then toggle (`theme-toggle` in the layout), then dark: the dataset color equals the resolved dark `--color-chart-1`, the grid equals dark `--color-default`, and a sampled canvas pixel inside the first bar matches.
   - Then switch back to light.
   - A dataset color set by the server stays unchanged.

**`tests/e2e/lab.chart-stream.spec.ts`**
- After a `replace` and an `update`: the new chart is drawn and themed, the instance count is unchanged (the old chart was destroyed), and the counter shows 1.

**`tests/e2e/lab.live-chart.spec.ts`**
1. Change `range`. Then:
   - `renders` increments;
   - the table rows show the new labels;
   - the probe shows new `labels` on the **same** instance (updated, not recreated: `chartjs:connect` count unchanged);
   - colors are still themed (the `view-value-change` path);
   - `canvas.width` is unchanged, so Live kept the attributes Chart.js set.
2. Toggle dark, then `addSale`: the updated chart uses dark colors.
3. Ten quick re-renders: one instance, no errors.

**`tests/e2e/chart.spec.ts`** (on `/preview/chart/...`)
- **Names:** the canvas has `role=img` with the title as its name, and a description when given.
- **Table:**
  - `<summary>` opens the table by keyboard (Enter);
  - rows and columns match the data;
  - point charts get x/y columns;
  - the `value` block override is applied.
- **Swatch** colors equal the series colors.
- **Reduced motion** (`page.emulateMedia({reducedMotion: 'reduce'})`): `chart.options.animation === false`.
- **Bad `type`** renders a bar chart.

**a11y and hostile props**
- `a11y.spec.ts` `labPages`: add `chart-turbo`, `chart-turbo/two`, `chart-stream`, `live-chart`. Every README example is scanned through the previews already.
- `HostilePropsCommand` and `hostile-props.spec.ts`:
  - `type`, `size` and `table` with hostile values fall back to their defaults;
  - a dataset `label` of `"><svg onload=window.__xss=1>` is escaped in the table header;
  - a hostile `id` is escaped.

### Accessibility

- The `<figure>`/`<figcaption>` pair, and a canvas with `role="img"`, `aria-labelledby` (title) and `aria-describedby` (description), plus fallback text.
- The table is the accessible equivalent: canvas tooltips cannot be reached by keyboard, and the table covers WCAG 1.1.1 and 1.4.1.
- `<details>`/`<summary>` is native, so it needs no JS, keeps its state in Turbo snapshots and is keyboard-operable; it gets the kit's focus ring.
- Series colors are ≥ 3:1 against the surfaces (1.4.11). The legend and table give the series' names in text, not by color alone.
- Animation is off under `prefers-reduced-motion`.

### Screenshots

- **Determinism:** the bridge turns animation off under reduced motion, so `new Chart` draws synchronously. The examples project then emulates reduced motion (decision 5):
  - add `reducedMotion: 'reduce'` to `page.emulateMedia` in `gotoExample`;
  - run the full `--project=examples` and confirm that **no existing baseline changes**;
  - if one does, emulate it only when the recipe is `chart`.
- Other sources of variation:
  - fixed data in the examples;
  - `deviceScaleFactor: 1` (already);
  - the browser runs in the pinned Playwright Docker image (already);
  - the font is the computed `font-family`, with no web font to wait for.
- Run `npx playwright test --project=examples --update-snapshots=missing` and look at each `chart/tests/screenshots/*-{light,dark}.png`. Never update existing baselines.

### Fresh-install checks

- `tools/tests/fresh-install.sh`: add `chart` to the recipe loop. Its `composer require symfony/ux-chartjs` runs through Flex, which needs jsDelivr: fine in CI.
- `tools/tests/fixtures/fresh-app/`:
  - `src/Controller/ChartsController.php`: route `/charts`. It renders one `<twig:Chart>` from arrays and one from `ChartBuilderInterface` (`:chart`);
  - `templates/charts/index.html.twig`.
- `tools/tests/check-fresh-app.sh`: `/charts` answers 200 and contains:
  - `data-controller="chart"`;
  - `symfony--ux-chartjs--chart`;
  - a `view-value` holding the labels;
  - `role="img"`;
  - `<table`;
  - `bg-chart-1`.

  Also check that `importmap.php` has `chart.js` and `assets/controllers.json` has `@symfony/ux-chartjs`, so Flex did its part. `docker-install.sh` gets the same through the shared check.

## Demo wiring

- **`demo/composer.json`:** `"symfony/ux-chartjs": "^3.5"`. `config/bundles.php` gets `ChartjsBundle` (Flex).
- **`demo/importmap.php`:**
  - `'@symfony/ux-chartjs' => ['path' => './vendor/symfony/ux-chartjs/assets/dist/controller.js']`;
  - `chart.js` (4.5.x) and `@kurkle/color`, through `importmap:require` in CI or Docker.
- **`demo/assets/controllers.json`:** `"@symfony/ux-chartjs": {"chart": {"enabled": true, "fetch": "eager"}}`.
- **`/demo` dashboard** (optional, decision 9): no change in this PR.
- **`tools/sync-demo`** copies `chart_controller.js` and the template. Then run `tailwind:build`; `playwright.config.ts` rebuilds automatically when sources change.

## Docs

- **`README.md`:**
  - *More components* row: `| [`chart`](chart/README.md) ✦ | Charts with Symfony UX Chart.js in the theme's colors, light and dark, each with an accessible data table; arrays or `ChartBuilderInterface`, updated in place by Live Components. |`;
  - *Turbo and Live Components*: one bullet ("charts are destroyed and redrawn by their controllers; inside Live they update in place");
  - *Requirements → Assets*: "`chart` needs `chart.js` in the import map".
- **`llms.txt`:** regenerate with `node tools/llms-txt.mjs`; CI checks it.
- **`FOR-AGENTS.md`** *Which recipe*: `| A chart of numbers, with its data table | `chart` |`, plus a line under the rules: "no colors in chart data; use `var(--color-…)` for a role".
- **`docs/PROJECT-AGENTS-SNIPPET.md`:** a bullet:

  > Charts: `ux:install chart`, then `<twig:Chart type="…" title="…" :labels="…" :datasets="[{label, data}]" />` or `<twig:Chart :chart="chart" title="…" />` with `ChartBuilderInterface`. Always a `title`; no colors (the theme's `chart-*` roles apply; for a role write `'var(--color-…)'`); at most six series; format table values in `<twig:block name="value">`; pass `id` inside Live Components and Turbo Frames. Never write Chart.js `new Chart()` or `Chart.defaults` code.
- **`CHANGELOG.md`** `[Unreleased]`:
  - `### Added`: "`chart`: …";
  - `### Changed`: "`theme`: chart series roles `chart-1` … `chart-6`, `chart-other`, validated for contrast and color blindness".
- **`NOTICE`:** no entry. `symfony/ux-chartjs` and Chart.js are dependencies installed by Composer and the import map; nothing is copied or derived.
- **`theme/README.md`:** list the new roles.

## Checks

- Kit lint on the exported archive: no `js.import.undeclared` and no `stimulus.controller.missing`.
- `ux-toolkit-kit-debug .`.
- `node tools/contrast/check.mjs` and `cmp kit.css theme/assets/styles/uxor.css`.
- PHPStan on `demo/src/Twig/Lab/LiveChart.php` (the demo's `src/Demo` path is already covered) and the fixture controller.
- `fresh-install.sh` / `docker-install.sh`.
- `npx playwright test` (smoke plus examples).

## Sequence (one pull request, commits in this order)

1. `feat(theme): add chart series roles` (kit.css, theme copy, pairs.json, theme README).
2. `feat(chart): add the chart recipe with its theme bridge and data table`.
3. `test(chart): lab pages and specs for Turbo, streams, Live and teardown`.
4. `test(chart): screenshots of the README examples` (plus the fixture's reduced-motion line, only if decision 5 holds).
5. `test(chart): fresh installs render charts`.
6. `docs(chart): README row, agent docs, changelog`.

Request the Codex review at the first green CI.

## Out of scope

- Chart.js plugins shipped by the kit (zoom, annotations, data labels);
- sequential and diverging palettes (heatmaps);
- dual axes;
- texture fills;
- streaming or real-time charts (Mercure);
- sparklines inside `StatCard` (possible later);
- keyboard exploration of data points on the canvas;
- Turbo 8 refresh morph.

## Open questions (with recommended answers)

1. **Where do the chart colors live?**
   - (a) `chart-1` … `chart-6` and `chart-other` roles in `kit.css`. The contrast check covers them, `bg-chart-N` utilities exist, and every theme install gets them.
   - (b) A recipe stylesheet defining `--chart-*` from existing roles. This does not touch the theme, but the contrast tool cannot check it, and `--color-purple` and the like may not be written in light mode.

   **Recommended: (a).**
2. **Default table presentation:** `details` (collapsed, visible on demand), `visible`, or `hidden` (`sr-only`)? **Recommended: `details`.** Sighted keyboard and low-vision users can read the values too, and it costs no space.
3. **Names:** recipe `chart`, component `Chart`, controller `chart` (no clash with `symfony--ux-chartjs--chart`, and events use `chart:` versus `chartjs:`). **Recommended: yes.**
4. **The bridge imports `chart.js`** (only `Chart.getChart`, so it works whatever order controllers connect in) and declares `importmap: ["chart.js"]`. `ux:install` then also suggests `importmap:require chart.js`, which is harmless if Flex already added it. The alternative is reading ux-chartjs's private `chart` field. **Recommended: import it.**
5. **Screenshot determinism:** emulate `reducedMotion: 'reduce'` for all README screenshots, provided no existing baseline changes; otherwise only for `chart`. **Recommended: all, verified.** It mirrors a real user setting, and the bridge honors it.
6. **More than six series:** the 7th series and later get `chart-other` gray, and the README says to fold them into "Other" or split the chart. No generated hues, no cycling. **Recommended: yes.**
7. **Value formatting in the table:** raw values plus an overridable `value` block (no `intl` dependency). The alternative is a `format`/`locale` prop through `twig/intl-extra`. **Recommended: the block.** Chart.js's own tick and tooltip formatting stays in `options`.
8. **Theme `render_chart()` output too**, through `{'data-controller': 'chart'}` on the canvas: theme only, no table. **Recommended: yes,** documented as the lower-level path, so existing UX Chart.js code gets the theme with one attribute.
9. **Add a chart to the `/demo` dashboard and the `dashboard-home` block?** **Recommended: not in this PR.** `dashboard-home` would gain a Composer dependency for every user. A follow-up can add an opt-in example.
10. **Turbo snapshot and Chart.js's `style` attribute:** build the `turbo:before-cache` release only if the Back spec shows a violation, as with autocomplete's double-wrapper fix. **Recommended: yes, contingency only.**
