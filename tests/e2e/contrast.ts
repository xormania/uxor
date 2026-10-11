/*
 * WCAG contrast of the text on a page, measured from the computed colors. axe leaves short text (a page number, a
 * single letter) "incomplete" and passes it, so a one-character current page at 2.7:1 went through its scans.
 */
import type { Locator, Page } from '@playwright/test';

export type TextContrast = {
    text: string;
    /** The contrast ratio, rounded to two decimals. */
    ratio: number;
    /** WCAG AA's minimum for this text: 3 for large text (24px, or 18.66px bold), 4.5 otherwise. */
    min: number;
    color: string;
    background: string;
    element: string;
};

/**
 * Measures, in the page, the text of `elements`: each element with a text node of its own, visible, skipping the
 * text WCAG exempts or that is not painted: a disabled control's (`:disabled`, `aria-disabled`, the label of a disabled
 * control), the screen-reader-only, a canvas' fallback.
 *
 * The text color is composited on the first opaque ancestor background, through the semi-transparent ones (the page
 * white when none). Colors go through a canvas, so any CSS color the engine computes (oklch, color-mix) is read as
 * the sRGB it paints.
 */
function measure(elements: Element[]): TextContrast[] {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const rgba = (css: string): number[] => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
    };
    const over = (top: number[], bottom: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3]));
    const luminance = (rgb: number[]) => {
        const [r, g, b] = rgb.map((value) => {
            const c = value / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const exempt = (el: Element) =>
        null !== el.closest(':disabled, [aria-disabled="true"], .sr-only, canvas, svg, option') ||
        true === (el.closest('label') as HTMLLabelElement | null)?.control?.matches(':disabled');

    const results: TextContrast[] = [];
    for (const el of elements) {
        if (![...el.childNodes].some((node) => Node.TEXT_NODE === node.nodeType && node.textContent?.trim())) continue;
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || exempt(el)) continue;
        const layers: number[][] = [];
        for (let node: Element | null = el; node; node = node.parentElement) {
            const layer = rgba(getComputedStyle(node).backgroundColor);
            if (layer[3] > 0) {
                layers.push(layer);
                if (1 === layer[3]) break;
            }
        }
        let background = [255, 255, 255];
        for (const layer of layers.reverse()) background = over(layer, background);
        const style = getComputedStyle(el);
        const color = over(rgba(style.color), background);
        const [lighter, darker] = [luminance(color), luminance(background)].sort((a, b) => b - a);
        const size = parseFloat(style.fontSize);
        results.push({
            text: (el.textContent ?? '').trim().slice(0, 40),
            ratio: Math.floor(((lighter + 0.05) / (darker + 0.05)) * 100) / 100,
            min: size >= 24 || (Number(style.fontWeight) >= 700 && size >= 18.66) ? 3 : 4.5,
            color: `rgb(${color.map(Math.round).join(' ')})`,
            background: `rgb(${background.map(Math.round).join(' ')})`,
            element: [el.tagName.toLowerCase(), ...[...el.classList].slice(0, 4)].join('.'),
        });
    }

    return results;
}

/** The contrast of each element `locator` matches (see measure()). */
export function textContrast(locator: Locator): Promise<TextContrast[]> {
    return locator.evaluateAll(measure);
}

/** Every text of the page below WCAG AA's minimum (see measure()). */
export async function lowContrastText(page: Page): Promise<TextContrast[]> {
    const all = await page.locator('body, body *').evaluateAll(measure);

    return all.filter(({ ratio, min }) => ratio < min);
}
