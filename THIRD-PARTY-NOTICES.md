# Third-party notices

JvmScope's own license does not replace the licenses of bundled dependencies,
build tools, JVMs or operating-system packages. Keep their notices when distributing
source, JARs, portable packages or container images.

JvmScope's project terms are in [LICENSE](LICENSE), with attribution in
[NOTICE](NOTICE). Every frontend build includes those files and this document
under `assets/legal/`. The Java JAR also carries copies in `META-INF/`; portable
packages and containers include the root files beside the application JAR.
Those application notices do not replace the runtime's `runtime/legal/` tree.

## Vendored browser library

`frontend/public/assets/js/d3.min.js` is D3 7.9.0, Copyright 2010–2023 Mike Bostock,
under the ISC license. Its complete upstream permission and disclaimer are in
[`d3-LICENSE.txt`](frontend/public/assets/legal/d3-LICENSE.txt). Vite copies that
file into preview and application builds at `/assets/legal/d3-LICENSE.txt`.
The vendored file matches upstream 7.9.0 after line-ending/final newline normalization.
[Upstream license](https://github.com/d3/d3/blob/v7.9.0/LICENSE).

## Gradle wrapper and development tools

The Gradle wrapper JAR and scripts are Apache-2.0; their original script copyright
headers are retained. The full license is included in
[`Apache-2.0.txt`](frontend/public/assets/legal/Apache-2.0.txt).
[Gradle license](https://github.com/gradle/gradle/blob/v9.1.0/LICENSE).

Vite and Playwright are development dependencies, locked in
`frontend/package-lock.json` (Vite MIT, Playwright Apache-2.0). Their npm packages
carry their own licenses. Vite's build tooling and Chromium used by tests are not
shipped in the Slim application runtime.

## Java distributions

Slim's server has no external Java library dependencies. Its portable package and
container include a linked JDK runtime. **Retain the complete `runtime/legal/`
tree and `runtime/release` metadata**. They contain the runtime's GPLv2 with
Classpath Exception terms, assembly exception and included native-component notices.
The application license does not relicense those components.

The container builds its runtime from Eclipse Temurin 25. Packages built locally
use the configured JDK 25 vendor. Distribution obligations, upstream source and
notices follow that actual vendor/build; use `runtime/release` information and
the vendor's corresponding source distribution when redistributing it.
[Temurin licensing](https://adoptium.net/docs/faq).

Spring Boot delivery and its dependencies have been removed. Root and standalone
Gradle builds both produce the dependency-free server. Verify the current Java
library graph with `scripts/gradlew :slim:dependencies --configuration runtimeClasspath`.
Old Spring binaries from an earlier checkout are not current release artifacts;
do not redistribute them using these notices. The dated dependency findings
remain recorded in the [publication review](docs/PUBLICATION-REVIEW.md).

The Debian container includes operating-system components with their own
licenses. Preserve their `/usr/share/doc/` copyright information. Node, Gradle
and the full JDK used during the container build are build-stage tools.
