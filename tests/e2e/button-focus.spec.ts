import { test, expect } from './fixtures';
import { previewUrl } from './inventory';

/*
 * A keyboard user sees which button has the focus: its focus indicator has 3:1 against the colors next to it (WCAG
 * 1.4.11), on every variant, in both themes. A ring drawn right against the fill touches the fill and the page; an
 * outline drawn apart from the button (a positive offset) touches the page only.
 */
for (const theme of ['light', 'dark'] as const) {
    for (const example of ['default', 'outline-buttons']) {
        test(`every button of the ${example} example shows its keyboard focus at 3:1, ${theme} theme`, async ({ page }) => {
            await page.goto(previewUrl('button', example, theme));
            const buttons = page.getByRole('button');
            const count = await buttons.count();
            expect(count).toBeGreaterThan(3);
            for (let i = 0; i < count; i++) {
                const button = buttons.nth(i);
                // a key press first: the focus that follows is a keyboard user's, so :focus-visible applies
                await page.keyboard.press('Shift');
                await button.focus();
                const indicator = await button.evaluate((element) => {
                    const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
                    // any CSS color (rgb, oklch…) to sRGB through the canvas, with its alpha
                    const rgba = (color: string) => {
                        canvas.clearRect(0, 0, 1, 1);
                        canvas.fillStyle = '#000';
                        canvas.fillStyle = color;
                        canvas.fillRect(0, 0, 1, 1);
                        const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
                        return { rgb: [r, g, b], alpha: a / 255 };
                    };
                    const luminance = ([r, g, b]: number[]) =>
                        [r, g, b].map((c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, k) => sum + c * [0.2126, 0.7152, 0.0722][k], 0);
                    const contrast = (a: number[], b: number[]) => {
                        const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
                        return (l1 + 0.05) / (l2 + 0.05);
                    };
                    // the opaque background behind the button: its nearest ancestor with one
                    let ground: number[] | null = null;
                    for (let node = element.parentElement; node && !ground; node = node.parentElement) {
                        const background = rgba(getComputedStyle(node).backgroundColor);
                        if (background.alpha > 0.99) ground = background.rgb;
                    }
                    ground ??= [255, 255, 255];
                    const style = getComputedStyle(element);
                    const fill = rgba(style.backgroundColor);
                    const surface = fill.alpha > 0.99 ? fill.rgb : ground;

                    let color: string | null = null;
                    let width = 0;
                    let apart = false;
                    if ('none' !== style.outlineStyle && parseFloat(style.outlineWidth) > 0) {
                        color = style.outlineColor;
                        width = parseFloat(style.outlineWidth);
                        apart = parseFloat(style.outlineOffset) > 0;
                    } else {
                        // a ring: the box-shadow layer with no offset and no blur, the widest spread
                        for (const match of style.boxShadow.matchAll(/((?:rgba?|oklch|oklab|lab|lch|color|hsla?)\([^)]*\)|#[0-9a-f]+)\s+0px 0px 0px (\d+(?:\.\d+)?)px/gi)) {
                            if (+match[2] > width) [color, width] = [match[1], +match[2]];
                        }
                    }
                    if (!color) return { name: element.textContent!.trim(), width: 0, contrast: 0 };
                    const ring = rgba(color);
                    // what the indicator touches: the page on both sides when drawn apart, else the button too
                    const neighbours = apart ? [ground] : [ground, surface];

                    return { name: element.textContent!.trim(), width, contrast: Math.min(...neighbours.map((neighbour) => contrast(ring.rgb, neighbour))) };
                });
                expect(indicator.width, `${indicator.name}: the focus indicator's width`).toBeGreaterThanOrEqual(2);
                expect(indicator.contrast, `${indicator.name}: the focus indicator against what it touches`).toBeGreaterThanOrEqual(3);
            }
        });
    }
}
