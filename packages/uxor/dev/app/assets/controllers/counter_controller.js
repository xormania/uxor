import { Controller } from '@hotwired/stimulus';

export default class extends Controller {
    static targets = ['output'];

    increment() {
        this.outputTarget.textContent = String(Number(this.outputTarget.textContent) + 1);
    }
}
