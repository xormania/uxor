import { Controller } from '@hotwired/stimulus';

/** The edited row may leave this search/page. Restore focus to its action or the search control. */
export default class extends Controller {
    static values = { id: Number };

    connect() {
        const destination = document.getElementById(`edit-customer-${this.idValue}`)
            ?? document.getElementById('customers-search');
        destination?.focus();
    }
}
