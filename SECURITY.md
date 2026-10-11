# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | yes |

## Reporting a vulnerability

Report it privately through GitHub: **Security** › **Report a vulnerability**
(<https://github.com/xormania/uxor/security/advisories/new>). Do not open a public issue.

Name the recipe and the kit version, the props or input, and what the browser or the server does with them.

The kit is what `ux:install` copies into an application: the recipes, `kit.css` and `kit.js`. The demo app, the tests
and the tools in this repository are not installed. The *Security* section of [`docs/GUIDE.md`](docs/GUIDE.md#security)
describes what the components check and what they leave to the application.
