#!/bin/bash
# tools/batch_send.sh — queue a job for the gaming-PC worker, and read results
# back. Dev-machine side of the lane (S14, D25).
#
#   bash tools/batch_send.sh sweep 300        # balance census
#   bash tools/batch_send.sh mirror 300       # world mirrored (geometry vs doctrine)
#   bash tools/batch_send.sh firmswap 300     # personalities trade seats
#   bash tools/batch_send.sh pacing 300       # D11/D19 columns (slice 6e)
#   bash tools/batch_send.sh size128 100      # D26 capability battery
#   bash tools/batch_send.sh update           # worker: git pull + re-exec
#   bash tools/batch_send.sh resync           # after a REBASE: hard-reset to origin
#   bash tools/batch_send.sh sendresults      # resend everything on the worker's disk
#   bash tools/batch_send.sh collect          # deliver + settle results
#   bash tools/batch_send.sh board            # who is doing what
#
# CONTENTION (D25): the PC is shared with firepower. Run `board` in BOTH repos
# before queueing anything large — both workers shard to every core.
set -eu
cd "$(dirname "$0")/.."
AM="python3 tools/agent-mail.py"
Q() { $AM queue add --for batch-pc --as dev --body "$1"; }

case "${1:-}" in
  sweep)    Q "{\"kind\":\"sweep\",\"count\":${2:-100}}" ;;
  mirror)   Q "{\"kind\":\"mirror\",\"count\":${2:-100}}" ;;
  firmswap) Q "{\"kind\":\"firmswap\",\"count\":${2:-100}}" ;;
  pacing)   Q "{\"kind\":\"pacing\",\"count\":${2:-100},\"ticks\":${3:-36000}}" ;;
  size128)  Q "{\"kind\":\"size128\",\"count\":${2:-100}}" ;;
  heat)     Q "{\"kind\":\"heat\",\"mul\":${2:-1},\"count\":${3:-100}}" ;;
  update)   Q '{"kind":"update"}' ;;
  resync)   Q '{"kind":"resync"}' ;;
  sendresults) Q '{"kind":"sendresults"}' ;;
  collect)  $AM inbox --as dev --tag done --ack; python3 tools/batch_collect.py ;;
  board)    $AM status; $AM queue list ;;
  *) echo "usage: batch_send.sh sweep|mirror|firmswap|pacing|size128|heat|update|resync|sendresults|collect|board [count]"; exit 1 ;;
esac
