import { Controller } from '@hotwired/stimulus';
import { getComponent } from '@symfony/ux-live-component';
import { isKeptOnCache } from '../lib/uxor-turbo.js';

/**
 * The row selection of a `DataTableLive` belongs to the visit, not to the URL: leaving the page drops it. Back and
 * Forward show the copy of the page Turbo cached, whose Live Component still holds the selection in its properties
 * (they are signed by the server, so the browser cannot change them in the copy): before Turbo copies the page, the
 * table is marked, and a marked table clears its selection on the server (its `clearSelection` action) as it connects.
 * A table inside a `data-turbo-permanent` element keeps its selection (Turbo moves it into the next page), and so does
 * one beside a frame visit promoted to history (the page stays on screen).
 *
 * @action cache On `turbo:before-cache`: marks the table, for the copy Turbo takes of the page.
 */
export default class extends Controller {
    connect() {
        if (!this.element.hasAttribute('data-data-table-live-copy')) {
            return;
        }
        this.element.removeAttribute('data-data-table-live-copy');
        getComponent(this.element).then((component) => {
            if (this.element.isConnected && component.getData('selectedIds')?.length > 0) {
                component.action('clearSelection');
            }
        });
    }

    cache() {
        if (isKeptOnCache(this.element)) {
            return;
        }
        // Turbo copies the page once this event's listeners have run, also after the table disconnected: the mark stays
        this.element.setAttribute('data-data-table-live-copy', '');
    }
}
