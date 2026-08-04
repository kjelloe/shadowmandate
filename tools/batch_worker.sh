#!/bin/bash
# tools/batch_worker.sh — the gaming-PC job lane. Sits in a blocking flag-wait,
# takes queued jobs, runs them sharded across cores, and mails results home.
#
#   bash tools/batch_worker.sh              # loop forever
#   ONCE=1 bash tools/batch_worker.sh       # drain the queue once and exit
#   bash tools/batch_worker.sh --verbose    # narrate every decision
#
# THE RULES THIS ENCODES (all earned in the sibling project):
#  - REFUSE TO SERVE ON A RED SUITE. Results from a broken build are worse than
#    no results, because they look like data.
#  - NAME THE COMMIT IN EVERY RESULT. A stale worker produced confusing
#    verdicts for a day before anyone checked what it was running.
#  - MAIL FAILURE AS LOUDLY AS SUCCESS. A worker that dies quietly looks like a
#    worker with nothing to do.
set -u
cd "$(dirname "$0")/.."
AM="python3 tools/agent-mail.py"
ME=batch-pc
OUT=reports/sweeps
mkdir -p "$OUT"
VERBOSE=${VERBOSE:-0}
for a in "$@"; do [ "$a" = "--verbose" ] || [ "$a" = "-v" ] && VERBOSE=1; done

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$OUT/worker.log"; }
TAG=$(git describe --always --dirty 2>/dev/null || echo nogit)

fail_loud() {
  log "FAIL: $1"
  $AM send --to dev --as $ME --tag done --body "WORKER FAILURE on $TAG: $1" >/dev/null 2>&1
}

mail_file() {  # $1 path  $2 tag
  local path="$1" tag="$2" base
  base=$(basename "$path")
  [ -s "$path" ] || { fail_loud "refusing to mail empty $base"; return 1; }
  if ! $AM send --to dev --as $ME --tag "$tag" \
       --body "$(printf '#file:%s\n%s' "$base" "$(cat "$path")")" >/dev/null; then
    fail_loud "could not mail $base — will retry on the next job"
    return 1
  fi
  log "mailed $base (tag=$tag)"
}

run_sweep() {  # $1 label  $2 count  $3 env assignments
  local label="$1" count="$2" envs="$3"
  local cores; cores=$(nproc 2>/dev/null || echo 4)
  local shards=$((cores > 6 ? 6 : cores))
  log "running $label: count=$count shards=$shards env=[$envs] commit=$TAG"
  for i in $(seq 0 $((shards - 1))); do
    ( eval "env $envs SHARDS=$shards SHARD=$i node tools/sm_worldday.mjs $count" \
        > "$OUT/${label}_$i.csv" 2>"$OUT/${label}_$i.err" ) &
  done
  wait
  local head_written=0
  : > "$OUT/${label}.csv"
  for i in $(seq 0 $((shards - 1))); do
    if [ ! -s "$OUT/${label}_$i.csv" ]; then
      # A shard that dies silently would otherwise become a cheerful "0 rows".
      fail_loud "$label shard $i produced nothing: $(head -c 300 "$OUT/${label}_$i.err")"
      continue
    fi
    if [ $head_written -eq 0 ]; then
      cat "$OUT/${label}_$i.csv" >> "$OUT/${label}.csv"; head_written=1
    else
      grep -v '^#' "$OUT/${label}_$i.csv" | tail -n +2 >> "$OUT/${label}.csv"
    fi
    rm -f "$OUT/${label}_$i.csv" "$OUT/${label}_$i.err"
  done
  mail_file "$OUT/${label}.csv" csv
}

handle() {  # $1 = job body JSON
  local body="$1" kind count
  kind=$(echo "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("kind",""))' 2>/dev/null)
  count=$(echo "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("count",100))' 2>/dev/null)
  [ -n "$kind" ] || { fail_loud "unparseable job body: ${body:0:200}"; return; }
  log "job: $kind (count=$count)"

  case "$kind" in
    sweep)    run_sweep "sweep"    "$count" "" ;;
    mirror)   run_sweep "mirror"   "$count" "MIRROR=1" ;;
    firmswap) run_sweep "firmswap" "$count" "FIRMSWAP=1" ;;
    size128)  run_sweep "size128"  "$count" "SIZE=128" ;;
    pacing)
      local ticks
      ticks=$(echo "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("ticks",36000))')
      run_sweep "pacing" "$count" "TICKS=$ticks" ;;
    heat)
      local mul
      mul=$(echo "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("mul",1))')
      run_sweep "heat_$mul" "$count" "HEATMUL=$mul" ;;
    update)
      log "update: pulling"
      git stash -q 2>/dev/null
      if git pull --ff-only 2>&1 | tee -a "$OUT/worker.log"; then
        git stash pop -q 2>/dev/null || git checkout -- . 2>/dev/null
        $AM send --to dev --as $ME --tag done --body "worker updated to $(git describe --always)" >/dev/null
        exec bash "$0" "$@"
      else
        fail_loud "update failed — local commits? $(git log --oneline @{u}..HEAD 2>/dev/null | head -5)"
      fi ;;
    resync)
      git fetch origin && git reset --hard origin/"$(git rev-parse --abbrev-ref HEAD)"
      $AM send --to dev --as $ME --tag done --body "worker resynced to $(git describe --always)" >/dev/null
      exec bash "$0" "$@" ;;
    sendresults)
      for f in "$OUT"/*.csv; do [ -e "$f" ] && mail_file "$f" csv; done ;;
    *)
      # Never run arbitrary text. The refusal names this worker's commit, which
      # is also your version check.
      fail_loud "unknown job kind '$kind' — this worker is at $TAG and knows: sweep mirror firmswap pacing size128 heat update resync sendresults" ;;
  esac
  $AM send --to dev --as $ME --tag done --body "completed $kind on $TAG" >/dev/null
}

log "worker starting at $TAG"
if ! npm test > "$OUT/worker_suite.log" 2>&1; then
  fail_loud "npm test is RED on $TAG — refusing to serve. $(tail -5 "$OUT/worker_suite.log" | tr '\n' ' ')"
  exit 1
fi
log "suite green — serving"

while true; do
  # `queue take` prints "taken #N (added ... ):" before the body — strip it, or
  # the JSON parser sees the header and the job is discarded as unparseable.
  raw=$($AM queue take --as $ME 2>/dev/null)
  job=$(printf '%s\n' "$raw" | tail -n +2)
  if [ -n "$job" ]; then
    handle "$job"
  else
    [ "${ONCE:-0}" = "1" ] && { log "queue drained (ONCE)"; break; }
    $AM flag wait --as $ME --timeout 300 >/dev/null 2>&1 || sleep 5
  fi
done
