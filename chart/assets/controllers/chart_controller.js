import { Controller } from '@hotwired/stimulus';
import { Chart } from 'chart.js';

const SERIES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];
const ROLES = [...SERIES, 'chart-other', 'body', 'heading', 'default', 'default-medium', 'neutral-primary-medium'];
const CARTESIAN = ['bar', 'line', 'scatter', 'bubble'];
const RADIAL = ['radar', 'polarArea'];
const SLICES = ['pie', 'doughnut', 'polarArea'];
const VAR = /^var\(--[\w-]+\)$/;
let colorContext;

/** Chart.js takes milliseconds; the theme supplies a CSS time on the chart or an ancestor. */
function motionDuration(style) {
    const time = style.getPropertyValue('--uxor-motion-duration-normal').trim().match(/^(\d*\.?\d+)(ms|s)$/i);
    if (!time) {
        return 150;
    }
    return Number(time[1]) * ('s' === time[2].toLowerCase() ? 1000 : 1);
}

/**
 * Gives a UX Chart.js chart the theme's colors: the series take the `chart-1` … `chart-6` roles (`chart-other` from
 * the seventh on), and the ticks, grid, legend and tooltip the text and border roles. It fills only what the server
 * left unset, and resolves a `var(--color-…)` the server wrote to the current theme's color. When the `dark` class of
 * `<html>` changes, it reads the roles again and redraws. Under `prefers-reduced-motion`, the chart does not animate.
 *
 * It sits on the chart's `<figure>`, above the canvas of UX Chart.js's controller, whose `chartjs:*` events it
 * listens to; it never creates or destroys the chart. On a `<canvas>` (`render_chart(chart, {'data-controller':
 * 'chart'})`), it themes that canvas.
 *
 * @target canvas      The canvas of the chart.
 * @target swatch      The color dot of a series in the data table (`data-index`), recolored when the server set the series' color.
 * @action configure   Themes the chart's configuration before UX Chart.js creates the chart.
 * @action adopt       Paints the table's swatches once the chart exists.
 * @action reconfigure Themes the new data and options a Live Component re-render gives the chart.
 */
export default class extends Controller {
    static targets = ['canvas', 'swatch'];

    #observer = null;
    #motion = null;
    #cache = new Map();

    connect() {
        this.#motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.#observer = new MutationObserver(() => this.#retheme());
        this.#observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        // UX Chart.js may have connected first (a lazy controller, another order): theme the chart it made
        if (this.#chart) {
            this.#retheme();
        }
    }

    disconnect() {
        this.#observer?.disconnect();
        this.#observer = null;
        this.#cache.clear();
    }

    configure({ detail }) {
        this.#apply(detail.config, this.#pristine());
    }

    adopt() {
        this.#paintSwatches(this.#pristine());
    }

    reconfigure({ detail }) {
        this.#apply(detail, this.#pristine());
    }

    get #canvas() {
        if (this.element instanceof HTMLCanvasElement) {
            return this.element;
        }

        return this.hasCanvasTarget ? this.canvasTarget : null;
    }

    get #chart() {
        return this.#canvas ? Chart.getChart(this.#canvas) : undefined;
    }

    /** The server's view: what the chart was given before any theming, read again from the canvas's attribute. */
    #pristine() {
        try {
            return JSON.parse(this.#canvas?.getAttribute('data-symfony--ux-chartjs--chart-view-value') ?? '{}');
        } catch {
            return {};
        }
    }

    #retheme() {
        const chart = this.#chart;
        if (!chart) {
            return;
        }
        this.#cache.clear();
        const pristine = this.#pristine();
        this.#apply({ type: chart.config.type, data: chart.config.data, options: chart.config.options }, pristine);
        chart.update('none');
        this.dispatch('themed', { detail: { chart } });
    }

    /** Applies the theme to `target` ({type?, data, options}) in place, writing only the paths `pristine` leaves unset. */
    #apply(target, pristine) {
        const style = getComputedStyle(this.element);
        const tokens = this.#tokens(style);
        const type = pristine.type ?? target.type ?? 'bar';
        target.options ??= {};
        target.data ??= {};
        const options = target.options;
        const fixed = pristine.options ?? {};
        const fill = (object, path, value, base) => {
            if (undefined === value || '' === value || undefined !== this.#get(base, path)) {
                return;
            }
            this.#set(object, path, value);
        };

        // var(--color-…) the server wrote: the current theme's color, at the same path
        this.#resolveVariables(target.options, fixed);
        this.#resolveVariables(target.data, pristine.data ?? {});

        fill(options, 'color', tokens.body, fixed);
        fill(options, 'borderColor', tokens.default, fixed);
        fill(options, 'font.family', style.fontFamily, fixed);
        if (this.#motion?.matches) {
            fill(options, 'animation', false, fixed);
        } else if (false !== options.animation && null !== options.animation) {
            fill(options, 'animation.duration', motionDuration(style), fixed);
        }

        const scales = new Set(Object.keys(fixed.scales ?? {}));
        if (CARTESIAN.includes(type)) {
            ['x', 'y'].forEach((id) => scales.add(id));
        }
        if (RADIAL.includes(type)) {
            scales.add('r');
        }
        for (const id of scales) {
            fill(options, `scales.${id}.ticks.color`, tokens.body, fixed);
            fill(options, `scales.${id}.grid.color`, tokens.default, fixed);
            fill(options, `scales.${id}.border.color`, tokens['default-medium'], fixed);
            fill(options, `scales.${id}.title.color`, tokens.heading, fixed);
            if (RADIAL.includes(type)) {
                fill(options, `scales.${id}.angleLines.color`, tokens.default, fixed);
                fill(options, `scales.${id}.pointLabels.color`, tokens.body, fixed);
                fill(options, `scales.${id}.ticks.backdropColor`, tokens.surface, fixed);
            }
        }

        fill(options, 'plugins.legend.labels.color', tokens.body, fixed);
        fill(options, 'plugins.title.color', tokens.heading, fixed);
        fill(options, 'plugins.subtitle.color', tokens.body, fixed);
        fill(options, 'plugins.tooltip.backgroundColor', tokens['neutral-primary-medium'], fixed);
        fill(options, 'plugins.tooltip.titleColor', tokens.heading, fixed);
        fill(options, 'plugins.tooltip.bodyColor', tokens.body, fixed);
        fill(options, 'plugins.tooltip.footerColor', tokens.body, fixed);
        fill(options, 'plugins.tooltip.borderColor', tokens['default-medium'], fixed);
        fill(options, 'plugins.tooltip.borderWidth', 1, fixed);

        const datasets = target.data.datasets ?? [];
        const given = pristine.data?.datasets ?? [];
        datasets.forEach((dataset, index) => {
            const base = given[index] ?? {};
            const kind = base.type ?? type;
            const color = tokens.series[index] ?? tokens['chart-other'];
            if (SLICES.includes(kind)) {
                const count = (dataset.data ?? []).length;
                fill(dataset, 'backgroundColor', Array.from({ length: count }, (_, i) => tokens.series[i] ?? tokens['chart-other']), base);
                fill(dataset, 'borderColor', tokens.surface, base);
                fill(dataset, 'borderWidth', 2, base);
            } else if ('line' === kind || 'radar' === kind) {
                fill(dataset, 'borderColor', color, base);
                fill(dataset, 'backgroundColor', this.#alpha(color, 0.15), base);
                fill(dataset, 'pointBackgroundColor', color, base);
                fill(dataset, 'borderWidth', 2, base);
            } else if ('scatter' === kind || 'bubble' === kind) {
                fill(dataset, 'backgroundColor', this.#alpha(color, 0.6), base);
                fill(dataset, 'borderColor', color, base);
            } else {
                fill(dataset, 'backgroundColor', color, base);
                fill(dataset, 'borderColor', color, base);
                fill(dataset, 'borderRadius', 4, base);
                fill(dataset, 'maxBarThickness', 40, base);
            }
        });

        this.#paintSwatches(pristine);
    }

    /** Swatches of series whose color the server set take that color; the others keep their `bg-chart-N` class. */
    #paintSwatches(pristine) {
        const given = pristine.data?.datasets ?? [];
        for (const swatch of this.swatchTargets) {
            const base = given[Number(swatch.dataset.index)] ?? {};
            const color = [base.borderColor, base.backgroundColor].find((value) => 'string' === typeof value);
            swatch.style.backgroundColor = color ? this.#color(color) ?? '' : '';
        }
    }

    #resolveVariables(target, base, path = '') {
        if (null === base || 'object' !== typeof base) {
            return;
        }
        for (const [key, value] of Object.entries(base)) {
            const at = path ? `${path}.${key}` : key;
            if ('string' === typeof value && VAR.test(value)) {
                const color = this.#color(value);
                if (color) {
                    this.#set(target, at, color);
                }
            } else if (null !== value && 'object' === typeof value) {
                this.#resolveVariables(target, value, at);
            }
        }
    }

    /** The roles as `rgb()`/`rgba()` strings, which Chart.js can mix (it cannot parse `oklch()`). */
    #tokens(style) {
        const tokens = {};
        for (const role of ROLES) {
            const value = style.getPropertyValue(`--color-${role}`).trim();
            if ('' === value) {
                console.warn(`chart: the theme has no --color-${role}; import the theme recipe's stylesheet.`);
            }
            tokens[role] = '' === value ? undefined : this.#color(value);
        }
        tokens.series = SERIES.map((role) => tokens[role]);
        tokens.surface = this.#surface();

        return tokens;
    }

    #surface() {
        for (let element = this.element; element; element = element.parentElement) {
            const background = getComputedStyle(element).backgroundColor;
            if (background && 'transparent' !== background && !/^rgba\(.*,\s*0\)$/.test(background)) {
                return this.#color(background);
            }
        }

        return this.#color(getComputedStyle(document.body).backgroundColor);
    }

    /** Any CSS color (`oklch()`, a variable, a name) as the `rgb()`/`rgba()` the browser paints. */
    #color(value) {
        if (!value) {
            return undefined;
        }
        const key = value;
        if (this.#cache.has(key)) {
            return this.#cache.get(key);
        }
        let css = value;
        const variable = value.match(/^var\((--[\w-]+)\)$/);
        if (variable) {
            css = getComputedStyle(this.element).getPropertyValue(variable[1]).trim();
            if ('' === css) {
                return undefined;
            }
        }
        if (!colorContext) {
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            colorContext = canvas.getContext('2d', { willReadFrequently: true });
        }
        colorContext.clearRect(0, 0, 1, 1);
        colorContext.fillStyle = '#000';
        colorContext.fillStyle = css;
        colorContext.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = colorContext.getImageData(0, 0, 1, 1).data;
        const color = 255 === a ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
        this.#cache.set(key, color);

        return color;
    }

    #alpha(color, alpha) {
        const match = color?.match(/^rgba?\((\d+), (\d+), (\d+)/);

        return match ? `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})` : color;
    }

    #get(object, path) {
        return path.split('.').reduce((value, key) => (null !== value && 'object' === typeof value ? value[key] : undefined), object);
    }

    #set(object, path, value) {
        const keys = path.split('.');
        const last = keys.pop();
        let node = object;
        for (const key of keys) {
            if (null === node[key] || 'object' !== typeof node[key]) {
                node[key] = {};
            }
            node = node[key];
        }
        node[last] = value;
    }
}
