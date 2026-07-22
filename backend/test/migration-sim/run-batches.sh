#!/usr/bin/env bash
# Fix-as-you-go batch loop: run 200-scenario batches, STOP at the first batch that
# surfaces any invariant violation (so the bug is fixed before advancing). Cycles
# stress profiles across batches over disjoint, reproducible seed ranges.
set -u
cd "$(dirname "$0")/../.."   # backend/

BATCH_SIZE=200
SEED0=${SEED0:-500000}       # fresh seed region (1..5000 already validated)
START_BATCH=${START_BATCH:-0}
NUM_BATCHES=${NUM_BATCHES:-40}

# Stress profiles cycled per batch (env passed to the generator).
profile() {
  case $(( $1 % 7 )) in
    0) echo "";;                                                   # broad default mix
    1) echo "SIM_CHAOS=1 SIM_EXTDEL=1";;                           # heavy external deletes
    2) echo "SIM_FAULT=0.6";;                                      # high transient faults
    3) echo "SIM_MAT_MAX=60";;                                     # very slow materialization
    4) echo "SIM_CHUNK=1 SIM_MIN_NODES=10 SIM_MAX_NODES=30";;      # big chunked trees
    5) echo "SIM_MIN_NODES=1 SIM_MAX_NODES=1";;                    # single-node
    6) echo "SIM_CHAOS=1 SIM_FAULT=0.5 SIM_MAT_MAX=50 SIM_EXTDEL=1";; # everything at once
  esac
}

cumulative=0
for b in $(seq "$START_BATCH" $((START_BATCH + NUM_BATCHES - 1))); do
  base=$(( SEED0 + b * BATCH_SIZE ))
  env=$(profile "$b")
  echo "==== BATCH $b | profile:[${env:-default}] | seeds ${base}..$((base+BATCH_SIZE-1)) ===="
  log=$(mktemp)
  env $env SIM_SCENARIOS=$BATCH_SIZE SIM_SEED_BASE=$base \
      npx jest --config ./test/jest-sim.json --runInBand > "$log" 2>&1
  code=$?
  grep -E "sim\]|seed [0-9]|INV|THREW" "$log" || true
  if [ "$code" -eq 0 ]; then
    cumulative=$(( cumulative + BATCH_SIZE ))
    echo "==== BATCH $b: CLEAN | cumulative clean scenarios: $cumulative ===="
    rm -f "$log"
  else
    echo "==== BATCH $b: FAILED — STOPPING (fix-gate). base seed=$base profile:[${env:-default}] ===="
    echo "Full log: $log"
    echo "REPRODUCE: cd backend && $env SIM_SCENARIOS=1 SIM_SEED_BASE=<seed> npx jest --config ./test/jest-sim.json --runInBand"
    exit 1
  fi
done
echo "==== ALL $NUM_BATCHES BATCHES CLEAN | cumulative clean scenarios: $cumulative ===="
