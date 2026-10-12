import { Controller } from '@hotwired/stimulus';

/**
 * Dismisses an `Alert`: fades it out, then hides it, like Flowbite's `Dismiss` (which this
 * controller replaces so no global Flowbite code runs).
 *
 * @target alert The element to hide, the alert itself.
 * @action close Fades the alert out over 300 ms, then hides it; under `prefers-reduced-motion`, hides it at once.
 */
export default class extends Controller {
    static targets = ['alert'];

    disconnect() {
        clearTimeout(this.hideTimeout);
    }

    close() {
        clearTimeout(this.hideTimeout);
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.alertTarget.classList.add('hidden');
            return;
        }
        this.alertTarget.classList.add('transition-opacity', 'duration-300', 'ease-out', 'opacity-0');
        this.hideTimeout = setTimeout(() => this.alertTarget.classList.add('hidden'), 300);
    }
}
