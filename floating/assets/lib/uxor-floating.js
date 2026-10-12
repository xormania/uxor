/**
 * The kit's positioning of a floating element (a menu, a popover, a tooltip) next to the element it belongs to: the
 * one implementation that `dropdown`, `popover` (so `date-picker`) and `tooltip` import, ported from Popper as Flowbite
 * configures it, so the elements land on the same pixels as Flowbite's. No dependency, no style attribute in markup:
 * it writes `element.style` (the CSSOM), which a Content Security Policy without `'unsafe-inline'` allows.
 */

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** The viewport's size without its scrollbars, as Popper measures it. */
export function viewportSize() {
    return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
}

/**
 * Where an element of `size` goes on `side` of `reference` (a viewport rect), `offset` pixels away and aligned on
 * `align` (`start`, `end` or `center`): on `side` when it fits there, else on the opposite side when it fits there;
 * an element on the left or right that fits on neither (a phone) goes below the reference, else above it, when it
 * fits there; when nothing fits it stays on `side`. Viewport coordinates: `{ side, x, y }`, `side` the one chosen.
 */
export function place(reference, size, { side, align = 'center', offset = 0, viewport = viewportSize() }) {
    const vertical = 'top' === side || 'bottom' === side;
    const at = (s) => {
        const point = { x: 0, y: 0 };
        if ('top' === s || 'bottom' === s) {
            point.y = 'bottom' === s ? reference.bottom + offset : reference.top - size.height - offset;
            point.x = 'start' === align ? reference.left : 'end' === align ? reference.right - size.width : reference.left + reference.width / 2 - size.width / 2;
        } else {
            point.x = 'right' === s ? reference.right + offset : reference.left - size.width - offset;
            point.y = 'start' === align ? reference.top : 'end' === align ? reference.bottom - size.height : reference.top + reference.height / 2 - size.height / 2;
        }
        return point;
    };
    const overflows = (s, point) =>
        ({ top: -point.y, bottom: point.y + size.height - viewport.height, left: -point.x, right: point.x + size.width - viewport.width })[s] > 0;

    // Popper's flip, then the other axis for a side placement: a page scrolls down, not sideways
    const candidates = vertical ? [side, OPPOSITE[side]] : [side, OPPOSITE[side], 'bottom', 'top'];
    const fits = candidates.find((s) => !overflows(s, at(s))) ?? side;
    return { side: fits, ...at(fits) };
}

/**
 * Places `floating` next to `reference` like Popper does for Flowbite: absolute, `translate(x, y)`, `offset` pixels
 * away, flipped (`place()`), then shifted along the reference to stay in the viewport without leaving the reference,
 * rounded to device pixels. `placement` is `top`, `bottom`, `left` or `right`, optionally with `-start` or `-end`.
 * Returns the placement used, the side after the flip: the caller writes it where its CSS reads it.
 */
export function position(floating, reference, { placement, offset }) {
    // absolute first: the size to place is the element's own (w-fit), not the width it takes in flow
    Object.assign(floating.style, { position: 'absolute', inset: '0px auto auto 0px', margin: '0px' });
    const [side, align = 'center'] = (placement || 'bottom').split('-');
    const rect = reference.getBoundingClientRect();
    const size = { width: floating.offsetWidth, height: floating.offsetHeight };
    const viewport = viewportSize();
    const point = place(rect, size, { side, align, offset, viewport });
    const vertical = 'top' === point.side || 'bottom' === point.side;

    // shift along the reference to stay in the viewport, without leaving the reference
    const axis = vertical ? 'x' : 'y';
    const length = vertical ? size.width : size.height;
    const [refStart, refEnd] = vertical ? [rect.left, rect.right] : [rect.top, rect.bottom];
    const limit = vertical ? viewport.width : viewport.height;
    point[axis] = Math.min(Math.max(point[axis], 0), limit - length);
    point[axis] = Math.min(Math.max(point[axis], refStart - length), refEnd);
    // fitting on no side, a left or right element still never pushes the page sideways: over its reference instead
    if (!vertical) {
        point.x = Math.min(Math.max(point.x, 0), Math.max(0, viewport.width - size.width));
    }

    const box = origin(floating.offsetParent);
    const dpr = window.devicePixelRatio || 1;
    const round = (value) => Math.round(value * dpr) / dpr || 0;

    floating.style.transform = `translate(${round(point.x - box.x)}px, ${round(point.y - box.y)}px)`;
    return 'center' === align ? point.side : `${point.side}-${align}`;
}

/**
 * Where `container`, an element's containing block, starts in viewport coordinates: its padding edge, inside its
 * border and less its scroll, or the page's origin for the body, the root or none. A floating element
 * placed in viewport coordinates goes at `point - origin(container)` in its containing block's.
 */
export function origin(container) {
    if (!container || container === document.body || container === document.documentElement) {
        return { x: -window.scrollX, y: -window.scrollY };
    }
    const box = container.getBoundingClientRect();
    return { x: box.left + container.clientLeft - container.scrollLeft, y: box.top + container.clientTop - container.scrollTop };
}

/**
 * Calls `reposition` on every scroll (any scrolling element: capture on the window) and resize, until the returned
 * function is called: open, a floating element follows its reference; call it when the element closes or its
 * controller disconnects, so nothing stays listening.
 */
export function follow(reposition) {
    const listener = () => reposition();
    window.addEventListener('scroll', listener, true);
    window.addEventListener('resize', listener);
    return () => {
        window.removeEventListener('scroll', listener, true);
        window.removeEventListener('resize', listener);
    };
}
