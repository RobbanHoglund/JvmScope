# Default Railway build: docker build -t jvmscope-slim .
# Keep build directives in sync with slim/Dockerfile for existing custom-path services.
# scripts/local-dev.test.mjs verifies both entry points and the CI build path.
FROM node:24-bookworm-slim AS frontend
WORKDIR /workspace
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend
COPY . .
ARG GITHUB_SHA
RUN npm run build:slim --prefix frontend

# Jammy's glibc baseline is compatible with the Bookworm runtime below.
FROM eclipse-temurin:25-jdk-jammy AS java-build
WORKDIR /workspace
COPY . .
COPY --from=frontend /workspace/slim/build/frontend ./slim/build/frontend
# Frontend tests ran in the Node stage. No Node installation in this stage.
RUN bash ./scripts/gradlew -p slim assembleSlim -x npmInstall -x npmBuild --no-daemon --console=plain

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 zlib1g \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=java-build /workspace/slim/build/package/ ./
ENV HOST=0.0.0.0 PORT=23873 \
    JAVA_TOOL_OPTIONS="-Xms8m -Xmx64m -XX:+UseSerialGC -Xss256k"
USER 10001:10001
EXPOSE 23873
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/runtime/bin/java", "--add-modules", "jdk.httpserver", "-jar", "/app/app.jar"]
