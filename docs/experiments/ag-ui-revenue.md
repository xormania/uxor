# A revenue request through AG-UI events and Turbo

Open `/demo/revenue-assistant` on the running demo. Enter **Show weekly revenue**. The page should open the dashboard with **This week** selected. Open **Show the data as a table** to read the same seven daily values that the chart plots. The yearly and all-time requests select the dashboard's other two periods.

The PHP endpoint maps three explicit phrases to fixed periods. On an EventSource request it sends a run start, a state snapshot carrying `revenuePeriod`, and a matching run finish. The Stimulus controller validates the period and run identifiers, then asks Turbo to visit the existing dashboard. A plain HTML submission takes the same route through an HTTP redirect. An unknown phrase produces a recoverable error. [AG-UI event definitions](https://docs.ag-ui.com/concepts/events)

```sh
curl -NsS -G -H 'Accept: text/event-stream' --data-urlencode 'prompt=Show weekly revenue' http://127.0.0.1:8164/demo/revenue-assistant
```

This trial uses a deterministic local event producer. It establishes the UI contract for selecting a chart from application state. Connecting a real agent would separately require a transport for its run input and handling its additional events. Keep the adapter specific to the demo until a second dashboard interaction needs the same contract.
