import { Controller } from '@hotwired/stimulus';
import { place, viewportSize } from '../lib/uxor-floating.js';

/**
 * Shows a `Tooltip` while its trigger is hovered or focused, hides it on leave, blur or Escape,
 * and places it next to the trigger, flipping to the opposite side and shifting along it to stay in
 * the viewport. The trigger (the first element child) gets `aria-describedby` pointing at the tooltip.
 * Listeners are Stimulus actions on the wrapper, so it keeps working after the markup moves. On connect it is hidden
 * unless the focus is already inside, so Turbo's copy of a page never brings back a tooltip shown when the page was left.
 *
 * @target tooltip   The tooltip element.
 * @value  placement Where the tooltip opens: `top`, `bottom`, `left` or `right`.
 * @action show      Shows and places the tooltip.
 * @action hide      Hides the tooltip once its trigger is neither hovered nor focused, or at once on Escape.
 */
export default class extends Controller {
    static targets = ['tooltip'];
    static values = { placement: { type: String, default: 'top' } };

    // Starts from what the page shows now, not from the markup: Turbo restores its copy of the page (Back, Forward, a
    // frame visit promoted to history) as it was when left, a tooltip shown then included. Only the focus can already
    // be inside (a data-turbo-permanent element moved by a visit); a hover shows the tooltip with the next mouseenter.
    connect() {
        this.hovered = false;
        this.focused = this.element.matches(':focus-within');
        if (this.focused) {
            this.show();
        } else {
            this.describe();
            this.tooltipTarget.hidden = true;
        }
    }

    disconnect() {
        this.hide();
    }

    // Points the trigger's aria-describedby at the tooltip, again on each show: a re-render (Live, Turbo)
    // may have replaced the trigger or the tooltip's id while the controller stayed connected.
    describe() {
        const trigger = this.trigger();
        if (!trigger) {
            return;
        }
        const ids = new Set((trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
        if (this.describedBy && this.describedBy !== this.tooltipTarget.id) {
            ids.delete(this.describedBy);
        }
        this.describedBy = this.tooltipTarget.id;
        ids.add(this.describedBy);
        trigger.setAttribute('aria-describedby', [...ids].join(' '));
    }

    trigger() {
        return [...this.element.children].find((child) => child !== this.tooltipTarget) ?? null;
    }

    show(event) {
        if ('mouseenter' === event?.type) {
            this.hovered = true;
        } else if ('focusin' === event?.type) {
            this.focused = true;
        }
        this.describe();
        const tooltip = this.tooltipTarget;
        tooltip.hidden = false;

        // the kit's shared placement and flip (`assets/lib/uxor-floating.js`, the `floating` recipe), 8px away
        const reference = this.element.getBoundingClientRect();
        const size = { width: tooltip.offsetWidth, height: tooltip.offsetHeight };
        const viewport = viewportSize();
        const side = ['top', 'bottom', 'left', 'right'].includes(this.placementValue) ? this.placementValue : 'top';
        const point = place(reference, size, { side, offset: 8, viewport });
        // clamped into the viewport on both axes, unlike a menu shifted along its trigger
        point.x = Math.min(Math.max(point.x, 0), Math.max(0, viewport.width - size.width));
        point.y = Math.min(Math.max(point.y, 0), Math.max(0, viewport.height - size.height));

        // relative to the wrapper (position: relative)
        tooltip.style.left = `${Math.round(point.x - reference.left)}px`;
        tooltip.style.top = `${Math.round(point.y - reference.top)}px`;
        tooltip.dataset.placement = point.side;
    }

    hide(event) {
        if ('mouseleave' === event?.type) {
            this.hovered = false;
        } else if ('focusout' === event?.type) {
            this.focused = this.element.contains(event.relatedTarget);
        } else {
            // Escape, disconnect: hide until the next hover or focus
            this.hovered = this.focused = false;
        }
        if (!this.hovered && !this.focused) {
            this.tooltipTarget.hidden = true;
        }
    }
}
