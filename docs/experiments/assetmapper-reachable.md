# AssetMapper reachable import map entries

Should the demo render only the reachable import map entries, a Symfony 8.2 AssetMapper option? Not yet: keep
`importmap_entries: all`.

## Finding

On November 18, 2026, with Symfony FrameworkBundle and AssetMapper 8.2.0-BETA2, `reachable` saved about 670 bytes of
gzipped dashboard HTML but prevented the dashboard's JavaScript from starting. Revisit after AssetMapper recognizes
Chart.js's minified import and the dashboard and lazy Turbo paths pass with the stable Symfony 8.2 release.
[Symfony AssetMapper documentation](https://symfony.com/blog/new-in-symfony-8-2-assetmapper-improvements#rendering-only-the-reachable-import-map-entries)

## Measurements

Both servers ran the same checkout with PHP 8.4.27 and Chromium 145.0.7632.6. Each mode got a fresh browser context.
Sizes are in bytes. The probe gzipped the response body and the inline import map JSON independently with Node's
default gzip settings.

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
Chart.js's missing Kurkle Color dependency. Chromium could not resolve the package's bare specifier and Stimulus never
started. The installed jsDelivr Chart.js 4.5.1 module begins with a static `import{Color as Mi}from` statement.
Matching that statement against AssetMapper's `JavaScriptImportPathCompiler::IMPORT_PATTERN` captured no specifier.
Adding a space after `import` made the same pattern capture it.

In `all` mode, the lab index also made zero autocomplete vendor requests. A Turbo click from the lab index to
`/lab/live-autocomplete` kept the document and triggered four JavaScript requests for the Symfony UX Autocomplete
controller, Tom Select, Sifter and Unicode Variants. The Country combobox opened and the Live Component re-rendered.

The demo renders the shared `app` entrypoint, whose literal imports reach the generated Stimulus registry and its lazy
import chains. The `reachable` map preserved the Tom Select entry and omitted the bare entries for Symfony UX
Autocomplete, Sifter and Unicode Variants. The dashboard failure leaves resolution of the whole lazy chain open.
Stimulus controls when the browser fetches the controller. Other entrypoints may prune different entries. Before
enabling the mode for an application with multiple Turbo entrypoints, test transitions to pages that need imports
absent from the initial map, and inventory any computed dynamic import specifiers, which the reachability analysis
skips.

## Checks at the time

The demo's 446 PHPUnit tests passed on Symfony 8.1.11 and 8.2.0-BETA2. The stable static build exported 453 pages and
passed recipe and example coverage. The existing Chromium dashboard lazy-load smoke test in
`tests/e2e/demo-app.spec.ts` passed in `all` and reproduced the startup failure in `reachable`. The browser
measurements cover debug-mode asset serving in Chromium, the dashboard, and one Turbo transition followed by a Live
re-render.

## Repeat the trial

The trial code is not on `dev`. It is on the branch `claude/wo-symfony-trials--assetmapper` at commit
[`8f9987f`](https://github.com/xormania/uxor/tree/8f9987fc33f54eeb7706b5dcb559f40bcff18052), from
[pull request 249](https://github.com/xormania/uxor/pull/249). That commit holds:

- an alternate Composer file and lock for the demo, `demo/composer.assetmapper-trial.json` and its lock, that install
  Symfony 8.2.0-BETA2 while the ordinary Composer files keep Symfony 8.1;
- two environments in `demo/config/packages/asset_mapper.yaml`, `assetmapper_all` and `assetmapper_reachable`, each
  setting `importmap_entries` literally, as the 8.2 enum requires;
- `tools/assetmapper-trial.mjs`, a Playwright probe that takes the two servers' URLs, prints both measurements and
  exits 1 when the `reachable` dashboard has the startup failure.

In a separate checkout of that commit, with PHP 8.4.1 or newer, Composer and the repository's Playwright server on
port 3000, install the demo with `COMPOSER=composer.assetmapper-trial.json` and build its Tailwind stylesheet. Serve
each environment with the native PHP server on its own loopback port, with `APP_DEBUG=1`, a throwaway `APP_SECRET`
(the lab's Live Component needs it for its checksum), `-d variables_order=EGPCS` and the front controller
`demo/public/index.php` passed explicitly so `/lab/` requests reach Symfony. Then run the probe with the two URLs. The
commit's own copy of this note gives the exact commands, an unused import map entry to confirm that each server
renders its mode, and how to return the checkout to Symfony 8.1.

With the stable 8.2 release, the alternate Composer files are no longer needed: set `importmap_entries: reachable` in
the demo's AssetMapper configuration and run the dashboard lazy-load smoke test and a Turbo transition to the lab's
live autocomplete page.
