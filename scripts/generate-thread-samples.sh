#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../tools/thread-dump-generator" && pwd)
OUT="$ROOT/out"
SNAPSHOT_COUNT=${SNAPSHOTS:-3}
TESTDATA="$ROOT/../../testdata/thread-dumps"
SINGLE_SAMPLE="$TESTDATA/real-java-all-1-snapshot.txt"
MULTI_SAMPLE="$TESTDATA/real-java-all-${SNAPSHOT_COUNT}-snapshots.txt"
FRONTEND_SAMPLE="$ROOT/../../frontend/assets/javautils/tda/samples/real-java-all-3-snapshots.txt"
JAVA_BIN=${JAVA_HOME:+$JAVA_HOME/bin/java}
JAVAC_BIN=${JAVA_HOME:+$JAVA_HOME/bin/javac}
JCMD_BIN=${JAVA_HOME:+$JAVA_HOME/bin/jcmd}
JAVA_BIN=${JAVA_BIN:-java}
JAVAC_BIN=${JAVAC_BIN:-javac}
JCMD_BIN=${JCMD_BIN:-jcmd}

mkdir -p "$OUT" "$TESTDATA" "$(dirname -- "$FRONTEND_SAMPLE")"
find "$ROOT/src/main/java" -name '*.java' -print0 | xargs -0 "$JAVAC_BIN" -encoding UTF-8 -d "$OUT"

if [ "${PORTABLE:-}" ]; then
  "$JAVA_BIN" -cp "$OUT" com.robbanhoglund.jvmscope.samples.threaddump.ThreadScenarioRunner \
    --scenario all --snapshots 1 --warmup-ms "${WARMUP_MS:-800}" \
    --portable --output "$SINGLE_SAMPLE"
  "$JAVA_BIN" -cp "$OUT" com.robbanhoglund.jvmscope.samples.threaddump.ThreadScenarioRunner \
    --scenario all --snapshots "$SNAPSHOT_COUNT" \
    --interval-ms "${INTERVAL_MS:-1500}" --warmup-ms "${WARMUP_MS:-800}" \
    --portable --output "$MULTI_SAMPLE"
else
  TMP_DIR=$(mktemp -d)
  RUNNER_PID=
  cleanup() {
    if [ -n "$RUNNER_PID" ]; then
      kill "$RUNNER_PID" 2>/dev/null || true
      wait "$RUNNER_PID" 2>/dev/null || true
    fi
    rm -rf "$TMP_DIR"
  }
  trap cleanup EXIT INT TERM

  "$JAVA_BIN" -cp "$OUT" com.robbanhoglund.jvmscope.samples.threaddump.ThreadScenarioRunner \
    --scenario all --warmup-ms "${WARMUP_MS:-800}" --hold \
    >"$TMP_DIR/stdout" 2>"$TMP_DIR/stderr" &
  RUNNER_PID=$!

  READY=
  ATTEMPT=0
  while [ "$ATTEMPT" -lt 200 ]; do
    if grep -q READY "$TMP_DIR/stdout" 2>/dev/null; then
      READY=1
      break
    fi
    if ! kill -0 "$RUNNER_PID" 2>/dev/null; then
      break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    sleep 0.1
  done
  if [ -z "$READY" ]; then
    printf 'Scenario runner did not become ready:\n' >&2
    cat "$TMP_DIR/stderr" >&2
    exit 1
  fi

  "$JAVA_BIN" -cp "$OUT" com.robbanhoglund.jvmscope.samples.threaddump.ThreadDumpCollector \
    --pid "$RUNNER_PID" --snapshots 1 --jcmd "$JCMD_BIN" --output "$SINGLE_SAMPLE"
  "$JAVA_BIN" -cp "$OUT" com.robbanhoglund.jvmscope.samples.threaddump.ThreadDumpCollector \
    --pid "$RUNNER_PID" --snapshots "$SNAPSHOT_COUNT" \
    --interval-ms "${INTERVAL_MS:-1500}" --jcmd "$JCMD_BIN" --output "$MULTI_SAMPLE"
fi

if [ "$SNAPSHOT_COUNT" -eq 3 ]; then
  cp "$MULTI_SAMPLE" "$FRONTEND_SAMPLE"
else
  printf 'Frontend sample not replaced: exactly three snapshots are required.\n' >&2
fi
printf 'Generated %s\n' "$SINGLE_SAMPLE" "$MULTI_SAMPLE"
