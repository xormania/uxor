import { Controller } from '@hotwired/stimulus';

/**
 * Tabs, as the WAI-ARIA tabs pattern describes them: one tab at a time is in the Tab order (roving `tabindex`), and
 * the arrow keys of the list's orientation move to the previous or next tab and select it (Left and Right in a
 * horizontal list, Up and Down in a vertical one), Home and End to the first and last; disabled tabs are skipped.
 *
 * The selected tab is the `activeTab` value, mirrored in the element's attribute, so the copy of the page Turbo
 * caches comes back on Back with the tab that was selected; a new visit or a reload starts from `defaultValue`.
 *
 * @target trigger The tabs (`role="tab"` buttons).
 * @target tab     The panels (`role="tabpanel"`), shown when their tab is selected.
 * @value  activeTab The value of the selected tab.
 * @action open    Selects the clicked tab.
 * @action keydown Moves to and selects another tab with the arrow keys, Home and End.
 */
export default class extends Controller {
    static targets = ['trigger', 'tab'];
    static values = { activeTab: String };

    initialize() {
        // each tab's tabindex as rendered, given back on disconnect
        this.renderedTabindex = new Map();
    }

    connect() {
        this.connected = true;
        // a tab disabled or enabled in place (a Live morph) moves the Tab stop
        this.disabledObserver = new MutationObserver(() => this.disabledChanged());
        this.disabledObserver.observe(this.element, { attributes: true, attributeFilter: ['disabled'], subtree: true });
        // a selected tab rendered disabled is handled as one disabled later
        this.disabledChanged();
    }

    disconnect() {
        this.disabledObserver.disconnect();
        // the targets disconnect after this: they must not pick a Tab stop again
        this.connected = false;
        this.renderedTabindex.forEach((value, trigger) => (null === value ? trigger.removeAttribute('tabindex') : trigger.setAttribute('tabindex', value)));
    }

    // A tab list without panels (e.g. used as navigation) must not point aria-controls at missing panels.
    triggerTargetConnected(trigger) {
        const panelId = trigger.getAttribute('aria-controls');
        if (panelId && !document.getElementById(panelId)) {
            trigger.removeAttribute('aria-controls');
        }
        this.updateTabStop();
    }

    // The selected tab removed (a Stream, a Live re-render) leaves the list without a Tab stop: pick one again.
    triggerTargetDisconnected() {
        if (this.connected) {
            this.updateTabStop();
        }
    }

    open(e) {
        this.activeTabValue = e.currentTarget.dataset.tabId;
    }

    keydown(event) {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
            return;
        }
        const vertical = 'vertical' === this.element.dataset.orientation;
        const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
        const next = vertical ? 'ArrowDown' : 'ArrowRight';
        const tabs = this.enabledTriggers();
        const index = tabs.indexOf(event.currentTarget);
        let target;
        switch (event.key) {
            case previous:
                target = tabs[(index - 1 + tabs.length) % tabs.length];
                break;
            case next:
                target = tabs[(index + 1) % tabs.length];
                break;
            case 'Home':
                target = tabs[0];
                break;
            case 'End':
                target = tabs[tabs.length - 1];
                break;
            default:
                return;
        }
        event.preventDefault();
        if (target) {
            this.activeTabValue = target.dataset.tabId;
            target.focus();
        }
    }

    activeTabValueChanged() {
        this.triggerTargets.forEach((trigger) => {
            const isActive = trigger.dataset.tabId === this.activeTabValue;
            trigger.dataset.state = isActive ? 'active' : 'inactive';
            trigger.ariaSelected = isActive;
        });

        this.tabTargets.forEach((tab) => {
            tab.dataset.state = tab.dataset.tabId === this.activeTabValue ? 'active' : 'inactive';
        });
        this.updateTabStop();
    }

    /** The selected tab disabled in place: the selection moves to the first enabled tab, which is the Tab stop. */
    disabledChanged() {
        const selected = this.triggerTargets.find((trigger) => trigger.dataset.tabId === this.activeTabValue);
        const fallback = this.enabledTriggers()[0];
        if (selected?.disabled && fallback) {
            this.activeTabValue = fallback.dataset.tabId; // updates the Tab stop too
        } else {
            this.updateTabStop();
        }
    }

    /** The selected tab is the list's one Tab stop; without one, the first enabled tab. */
    updateTabStop() {
        const enabled = this.enabledTriggers();
        const stop = enabled.find((trigger) => trigger.dataset.tabId === this.activeTabValue) ?? enabled[0];
        this.triggerTargets.forEach((trigger) => {
            if (!this.renderedTabindex.has(trigger)) {
                this.renderedTabindex.set(trigger, trigger.getAttribute('tabindex'));
            }
            trigger.setAttribute('tabindex', trigger === stop ? '0' : '-1');
        });
    }

    enabledTriggers() {
        return this.triggerTargets.filter((trigger) => !trigger.disabled);
    }
}
