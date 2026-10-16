# Audit evidence

These receipts support the October 16 audit. They do not alter application behavior or represent a new installed consumer.

- `validation-summary.json`: exact current execution scope and excluded suites.
- `report-validation.json` and `report-checks.json`: final report integrity and documentation policy checks.
- `rulesets-observed.json`: safe field-only public UI metadata; hidden/null bypass information remains unknown.
- `workflow-run-sample.json`: 109 nonrandom public run rows, without opaque socket channels or credentials. Individual attempt/job/log detail is not implied by these list rows.
- `access-log*.json`, `packagist-release-access.json`: timestamped status/error observations for public/API endpoints.
- `controller-repro.mjs` / `controller-repro-output.txt`: actual reviewed method bodies in native Chromium with an empty Stimulus base and stub Chart registry. Original observed prerequisites are Playwright 1.58.2 in `/workspace/uxor/node_modules`, Chromium 154.0.8037.57 at `/usr/bin/chromium`, baseline sources at `/workspace/uxor`. Run only on an already trusted checkout. This is not Symfony/Twig/full-Stimulus or project-image screenshot execution; adapt explicit paths when using another machine.
- `e2e-fuzz-settle-repro.mjs`: isolated extracted-helper control-flow calibration; not a browser-suite pass.
- `mention-scissors-repro.json`: disposable Git commit evidence of the local hook's scissors handling; outbound CI still scans retained text.
- `classifier-migration-paths.json`, `schedule-summary-reproduction.txt`: existing helper executions against controlled future-path/event inputs.
- `static-link-probe-result.txt`: existing gallery checker accepted a complete synthetic page inventory with deliberately broken arbitrary local links/actions; no published gallery defect alleged.
- `node-tests.log`, `php-syntax-*.log`, `companion-*.log`, `contrast.log`: scoped current results; hashes of retained evidence are in the coverage source index.
- `dependency-install-blocker.txt`: minimal safe reproduction of the installation blocker; no process environment or credential values retained.
- `external-source-hashes.json`: hashes of retrieved official documentation/external action implementation evidence. Authoritative URLs and exact action pins are in the CI report; the prepared scratch sources are not required to discover the recommended work.

No secret values, credential files, raw process environment, web socket channels, publication bindings or authentication tokens are included.
