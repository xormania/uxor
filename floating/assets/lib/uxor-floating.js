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
 * `align` (`start`, `end` or `center`), flipped to the opposite side when it overflows the viewport on `side` and
 * fits on the other one. Viewport coordinates: `{ side, x, y }`, `side` the one chosen.
 */
export function place(reference, size, { side, align = 'center', offset = 0, viewport = viewportSize() }) {
    const vertical = 'top' === side || 'bottom' === side;
    const at = (s) => {
        const point = { x: 0, y: 0 };
        if (vertical) {
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

    let point = at(side);
    if (overflows(side, point) && !overflows(OPPOSITE[side], at(OPPOSITE[side]))) {
        side = OPPOSITE[side];
        point = at(side);
    }
    return { side, ...point };
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
    const vertical = 'top' === side || 'bottom' === side;
    const point = place(rect, size, { side, align, offset, viewport });

    // shift along the reference to stay in the viewport, without leaving the reference
    const axis = vertical ? 'x' : 'y';
    const length = vertical ? size.width : size.height;
    const [refStart, refEnd] = vertical ? [rect.left, rect.right] : [rect.top, rect.bottom];
    const limit = vertical ? viewport.width : viewport.height;
    point[axis] = Math.min(Math.max(point[axis], 0), limit - length);
    point[axis] = Math.min(Math.max(point[axis], refStart - length), refEnd);

    // viewport coordinates -> coordinates of the element's containing block
    const parent = floating.offsetParent;
    let origin = { x: -window.scrollX, y: -window.scrollY };
    if (parent && parent !== document.body && parent !== document.documentElement) {
        const box = parent.getBoundingClientRect();
        origin = { x: box.left + parent.clientLeft - parent.scrollLeft, y: box.top + parent.clientTop - parent.scrollTop };
    }
    const dpr = window.devicePixelRatio || 1;
    const round = (value) => Math.round(value * dpr) / dpr || 0;

    floating.style.transform = `translate(${round(point.x - origin.x)}px, ${round(point.y - origin.y)}px)`;
    return 'center' === align ? point.side : `${point.side}-${align}`;
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
