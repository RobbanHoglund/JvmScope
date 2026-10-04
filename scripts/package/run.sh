#!/usr/bin/env sh
set -eu
SLIM_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
: "${JAVA_TOOL_OPTIONS:=-Xms8m -Xmx64m -XX:+UseSerialGC -Xss256k}"
export JAVA_TOOL_OPTIONS
exec "$SLIM_ROOT/runtime/bin/java" --add-modules jdk.httpserver -jar "$SLIM_ROOT/app.jar" "$@"
