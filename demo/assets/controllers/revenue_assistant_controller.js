/* stimulusFetch: 'lazy' */
import { Controller } from '@hotwired/stimulus';
import { visit } from '@hotwired/turbo';

export default class extends Controller {
    static values = { dashboard: String };
    static targets = ['status'];

    submit(event) {
        event.preventDefault();
        this.cancel();
        const url = new URL(this.element.action);
        url.searchParams.set('prompt', new FormData(this.element).get('prompt'));
        const stream = new EventSource(url);
        this.stream = stream;
        this.statusTarget.textContent = 'Looking up revenue…';
        let run;
        let period;
        const fail = () => {
            this.cancel();
            this.statusTarget.textContent = 'The revenue request did not finish. Try again.';
        };
        stream.onerror = fail;
        stream.onmessage = ({ data }) => {
            let message;
            try {
                message = JSON.parse(data);
            } catch {
                return fail();
            }
            switch (message?.type) {
                case 'RUN_STARTED':
                    if (run || ![message.runId, message.threadId].every(id => typeof id === 'string' && id.length > 0)) {
                        return fail();
                    }
                    run = message;
                    break;
                case 'STATE_SNAPSHOT':
                    if (!run || !['week', 'year', 'all'].includes(message.snapshot?.revenuePeriod)) {
                        return fail();
                    }
                    period = message.snapshot.revenuePeriod;
                    break;
                case 'RUN_FINISHED': {
                    if (!period || message.runId !== run.runId || message.threadId !== run.threadId) {
                        return fail();
                    }
                    this.cancel();
                    const dashboard = new URL(this.dashboardValue, document.baseURI);
                    dashboard.searchParams.set('revenue', period);
                    visit(dashboard.href);
                    break;
                }
                case 'RUN_ERROR':
                    this.cancel();
                    this.statusTarget.textContent = typeof message.message === 'string' ? message.message : 'Request failed.';
                    break;
                default:
                    fail();
            }
        };
    }

    cancel() {
        if (this.stream) {
            this.stream.onmessage = null;
            this.stream.onerror = null;
            this.stream.close();
            this.stream = null;
        }
    }

    beforeCache() {
        this.cancel();
        this.statusTarget.textContent = '';
    }

    disconnect() {
        this.cancel();
    }
}
