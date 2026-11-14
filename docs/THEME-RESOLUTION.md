# Theme resolution machinery

The Composer package exposes a pure PHP presentation resolver under `Xormania\UXor\Theme`.
It establishes the first theme policy boundary from the reusable UX machinery plan. It does not yet
register a Symfony bundle, change current recipe rendering, or apply CSS in the browser.

`ThemeDefinition` describes an installed identity, an opaque revision, supported modes, its default mode,
and optional component-to-template references. Definitions are immutable and reject malformed metadata.
`ThemeCatalog` is the outgoing port: callers supply installed definitions by identity. The included
`InMemoryThemeCatalog` accepts explicit definitions and rejects duplicate identities; Symfony configuration
can supply those definitions without changing the resolver.

`ThemeResolver` takes a catalog and the configured default theme identity. Each call receives a fresh
`ThemeContext` and optional application template overrides. It reads no requests, cookies, environment,
files, or global active-theme state. Application adapters remain responsible for obtaining preferences.

## Resolution rules

1. The configured default theme must exist. A missing default is a configuration error, even if the request
   names another installed theme.
2. No requested identity selects the default. An unavailable requested identity selects the default and
   records `theme_unavailable`; this supports preferences saved before a theme was removed.
3. A declared requested mode wins. No requested mode uses the selected theme's default. An unavailable mode
   uses that default and records `mode_unavailable`. A browser's system preference must be resolved by the
   application adapter to a supported mode before it is passed here.
4. For each component, an application template override wins, then the selected theme's template, then the
   package default theme's template. A component absent from all three remains absent. References are
   opaque: an invalid configured template is a rendering error for the adapter to report, not a reason
   to silently hide an installation defect by falling back.
5. Results sort template keys for deterministic output. Each reference carries its source (`application`,
   `theme`, or `default`) and, for installed themes, its identity and revision.

`ResolvedTheme` carries the selected identity, revision, mode, template references, origins, and fallback
reason codes. It reports decisions only: it does not establish that a template exists or renders correctly.
There is no theme inheritance graph in this slice; the fallback is the explicit three-level precedence above.

## Integration still to prove

The next adapter must connect these references to native Twig Component rendering and verify embedded blocks,
original-template access, and Live rerenders. Asset preparation, tokens, form-theme registration, density,
and browser theme changes remain separate work. Definition revision is diagnostic provenance, not a complete
rendered-fragment cache key: an adapter must also account for fallback templates, application overrides,
request-dependent content, and every other input that changes its rendered output.

`packages/uxor/tests/ThemeResolverTest.php` exercises precedence, missing defaults, stale preferences,
mode ownership, duplicate/invalid definitions, deterministic output, and consecutive independent calls.
The test uses no Symfony kernel, HTTP request, Twig engine, or installed application filesystem. It runs
through the existing package PHPUnit suite with `composer test`.
