# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.3.x | yes |
| 0.2.x | yes |
| 0.1.x | yes |

## Reporting a vulnerability

Report it privately through GitHub: **Security** › **Report a vulnerability**
(<https://github.com/xormania/uxor/security/advisories/new>). Do not open a public issue.

Name the affected recipe or package operation, the UXor version, the relevant input and the observed browser
or server behavior. Include a minimal reproduction when possible; omit credentials and private application data.

The Toolkit route copies recipes, `kit.css` and `kit.js` into an application. The optional Composer package
`xormania/uxor` installs agent guidance and development tools under `vendor/xormania/uxor/`; its operations,
reference handling and execution boundaries are also in scope for vulnerability reports. The demo application,
repository tests and maintainer tooling are development infrastructure and are not shipped in that package.
Report repository or release-workflow vulnerabilities through the same private channel.

The *Security* section of [`docs/GUIDE.md`](docs/GUIDE.md#security) describes the components' checks and application
responsibilities. [`packages/uxor/OPERATIONS.md`](packages/uxor/OPERATIONS.md) describes the development package's
trust and execution boundaries.
