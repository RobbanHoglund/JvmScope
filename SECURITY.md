# Security policy

## Supported code

Security fixes target the current `main` branch. There are no maintained older
release branches or prebuilt binary releases. Self-hosted installations need a
rebuild and redeployment to receive fixes, including JDK and operating-system
updates. An already open browser tab continues to use its loaded code until
reloaded.

## Report a vulnerability privately

Use GitHub's **Report a vulnerability** form in this repository's Security tab:
[private vulnerability report](https://github.com/RobbanHoglund/JvmScope/security/advisories/new).
If the form is unavailable, do not put vulnerability details in
a public issue. An ordinary issue may ask the maintainer to enable private
reporting, without exposing the vulnerability or any private data.

Include the affected revision, reproduction steps, expected impact and a minimal
synthetic example. Do not include production captures, credentials, private
keys or personal data. There is no guaranteed response time or paid support.

## Privacy and boundaries

Thread dumps and TLS logs are analyzed in browser workers. The Java server only
delivers packaged static files and health checks; it has no upload or analysis
API. Example files are fetched from the application host. Display preferences
may be stored locally, while capture contents and sessions stay in memory.

Browser extensions, host access logs and other applications on a shared web
origin remain outside JvmScope's control. See [the README](README.md#privacy-and-scope)
and [hosting boundaries](docs/GITHUB-PAGES.md#publication-boundary-and-verification).

For a local source checkout, keep private captures outside the repository or in
ignored `captures/`. Do not upload them as Actions artifacts, screenshots, issues
or test fixtures. Dependency audits and tests reduce risk; they do not guarantee
that every vulnerability or incompatible input has been found.
