# Symfony 8.2 AssetMapper trial

Keep `importmap_entries: all`. On November 18, 2026, `reachable` saved about 670 bytes of gzipped dashboard
HTML but prevented the dashboard's JavaScript from starting. Revisit after AssetMapper recognizes Chart.js's
minified import and the dashboard and lazy Turbo paths pass with the stable Symfony 8.2 release.

## Measurements

Both servers ran the same checkout with Symfony FrameworkBundle and AssetMapper 8.2.0-BETA2, PHP 8.4.27 and
Chromium 145.0.7632.6. Each mode got a fresh browser context. Sizes are in bytes. The probe gzips the response body
and the inline import map JSON independently with Node's default gzip settings.

| Dashboard measurement | `all` | `reachable` |
| --- | ---: | ---: |
| HTML, six responses | 255,530–255,536 | 252,481–252,487 |
| Gzipped HTML, six responses | 17,660–17,664 | 16,988–16,997 |
| Gzipped HTML with fixed CSP nonces, six responses | 17,613–17,616 | 16,943–16,949 |
| Inline import map JSON | 10,005 | 6,956 |
| Gzipped inline import map JSON | 2,048 | 1,386 |
| Import map entries | 97 | 65 |
| Modulepreload links | 43 | 43 |
| Same-origin JavaScript requests under `/assets/` | 44 | 43 |
| Autocomplete vendor JavaScript requests | 0 | 0 |
| Stimulus starts on the dashboard | Yes | Blocked by JavaScript module resolution |

Reachability removed 32 map entries and left the 43 modulepreload paths identical. The one fewer request was
Chart.js's missing Kurkle Color dependency. Chromium could not resolve the package's bare specifier and Stimulus
never started. The installed jsDelivr Chart.js 4.5.1 module begins with a static `import{Color as Mi}from` statement.
Matching that statement against AssetMapper's `JavaScriptImportPathCompiler::IMPORT_PATTERN` captured no specifier.
Adding a space after `import` made the same pattern capture it.

In `all` mode, the lab index also made zero autocomplete vendor requests. A Turbo click from the lab index
to `/lab/live-autocomplete` kept the document and triggered four JavaScript requests for the Symfony UX Autocomplete
controller, Tom Select, Sifter and Unicode Variants. The Country combobox opened and the Live Component re-rendered.

The demo renders the shared `app` entrypoint, whose literal imports reach the generated Stimulus registry and its
lazy import chains. The `reachable` map preserved the Tom Select entry and omitted the bare entries for Symfony UX
Autocomplete, Sifter and Unicode Variants. The dashboard failure leaves resolution of the whole lazy chain open.
Stimulus controls when the browser fetches the controller. Other entrypoints may prune different entries.
Before enabling the mode for an application with multiple Turbo entrypoints, test transitions to pages that need
imports absent from the initial map. Inventory any computed dynamic import specifiers, which the reachability
analysis skips. [Symfony AssetMapper documentation](https://symfony.com/blog/new-in-symfony-8-2-assetmapper-improvements#rendering-only-the-reachable-import-map-entries)

## Reproduce

Use a separate checkout of the trial with PHP 8.4.1 or newer, Composer, Node and the repository's Playwright server
listening on port 3000. The alternate Composer lock installs the beta into this checkout's demo vendor directory.
The ordinary `composer.json` and `composer.lock` still select Symfony 8.1.

```bash
npm ci
php tools/sync-demo
(cd demo && COMPOSER=composer.assetmapper-trial.json composer install --no-interaction)
(cd demo && php bin/console tailwind:build)
```

From the repository root, run the two loopback servers in separate terminals with the same PHP binary. Passing the
front controller explicitly sends requests under `/lab/` to Symfony even though a static `demo/public/lab/`
directory exists.

```bash
APP_SECRET="$(php -r 'echo bin2hex(random_bytes(32));')" APP_ENV=assetmapper_all APP_DEBUG=1 \
    php -d variables_order=EGPCS -S 127.0.0.1:8110 -t demo/public demo/public/index.php
APP_SECRET="$(php -r 'echo bin2hex(random_bytes(32));')" APP_ENV=assetmapper_reachable APP_DEBUG=1 \
    php -d variables_order=EGPCS -S 127.0.0.1:8111 -t demo/public demo/public/index.php
```

The lab's Live Component needs the throwaway secret for its checksum. Preserve `variables_order=EGPCS` so the
native PHP web server passes the trial environment through to Symfony. The enum needs literal values, so each
environment declares its mode directly. Check the generator's mode and run the browser probe.

```bash
for mode in assetmapper_all assetmapper_reachable; do
    (cd demo && APP_ENV="$mode" APP_DEBUG=1 php -d variables_order=EGPCS bin/console debug:container asset_mapper.importmap.generator)
done
node tools/assetmapper-trial.mjs http://127.0.0.1:8110 http://127.0.0.1:8111
```

The probe prints both measurements and exits 1 when the `reachable` dashboard has the startup failure. Run it
again for additional whole-HTML samples. To independently verify the HTTP modes, create a temporary
`demo/assets/assetmapper-trial-unused.js` containing `export {};` and add this entry to `demo/importmap.php`.

```php
'uxor-assetmapper-trial-unused' => ['path' => './assets/assetmapper-trial-unused.js'],
```

With the control, both dashboard responses returned HTTP 200. The `all` map contained the control and had 98
entries. The `reachable` map omitted it and had 65. Remove the entry and file before taking measurements.

To switch the trial checkout back to Symfony 8.1, stop both servers, clear the generated `demo/var/cache/`
and run ordinary `composer install` in `demo/`.

## Checks

The demo's 446 PHPUnit tests passed on Symfony 8.1.11 and 8.2.0-BETA2. The stable static build exported 453 pages
and passed recipe and example coverage. The existing Chromium dashboard lazy-load smoke test in
`tests/e2e/demo-app.spec.ts` passed in `all` and reproduced the startup failure in `reachable`.
Run it against either server with `DEMO_URL` set to its address and `PHP_BINARY=php`. The browser measurements
cover debug-mode asset serving in Chromium, the dashboard, and one Turbo transition followed by a Live re-render.
