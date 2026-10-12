import type { Page } from '@playwright/test';

export type ChartState = { id: number; labels: unknown[]; data: unknown[][]; colors: unknown[]; grid: unknown; animation: unknown } | null;

// the chart drawn on the canvas inside #<id>, read through Chart.js's own registry
export const chartState = (page: Page, id: string) =>
    page.evaluate(async (id) => {
        const { Chart } = await import('chart.js');
        const canvas = document.querySelector(`#${id} canvas`);
        const chart = canvas ? Chart.getChart(canvas as HTMLCanvasElement) : undefined;
        if (!chart) {
            return null;
        }
        const scales = (chart.config.options?.scales ?? {}) as Record<string, { grid?: { color?: unknown } }>;

        return {
            id: chart.id,
            labels: [...(chart.data.labels ?? [])],
            data: chart.data.datasets.map((dataset) => [...dataset.data]),
            colors: chart.data.datasets.map((dataset) => dataset.backgroundColor),
            grid: scales.x?.grid?.color ?? scales.r?.grid?.color,
            animation: chart.config.options?.animation,
        };
    }, id) as Promise<ChartState>;

// how many charts Chart.js holds: a chart that was not destroyed stays in the registry
export const chartCount = (page: Page) =>
    page.evaluate(async () => {
        const { Chart } = await import('chart.js');

        return Object.keys(Chart.instances).length;
    });

// a role of the theme as the browser paints it, the way the chart controller reads it
export const roleColor = (page: Page, role: string) =>
    page.evaluate((role) => {
        const css = getComputedStyle(document.documentElement).getPropertyValue(`--color-${role}`).trim();
        const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
        context.fillStyle = css;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;

        return `rgb(${r}, ${g}, ${b})`;
    }, role);

export const toggleDark = (page: Page) => page.evaluate(() => document.documentElement.classList.toggle('dark'));
