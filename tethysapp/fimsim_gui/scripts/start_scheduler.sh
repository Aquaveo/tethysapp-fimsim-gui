#!/usr/bin/env bash
#
# Launch the Dask scheduler for FIMsim.
#
# This is the local Dask cluster that FIMsim's `dask_primary` scheduler setting
# (Tethys admin) points at. Run it once; then start a worker pool with the
# companion start_worker.sh. Defaults to port 8786 so a cluster shared with
# other local Tethys apps (e.g. FIMeval) keeps working — point both apps'
# dask_primary settings at tcp://127.0.0.1:8786.
#
# Bounds how many times a task is retried after a worker DIES (e.g. an OOM-kill)
# before it is marked errored — distributed.scheduler.allowed-failures. Dask's
# default is 3, so an OOM-looping task kills three workers (thrashing the pool
# and disrupting other jobs) before it errs. We default to 1: tolerate one
# transient worker loss, then fail the task fast so the UI reaches a terminal
# error quickly (FIMsim's own wall-clock deadline in jobs.py still applies).
#
#   FIMSIM_SCHEDULER_PORT    (default 8786)
#   FIMSIM_ALLOWED_FAILURES  (default 1)  -> distributed.scheduler.allowed-failures
#
# Pass --dry-run to print the composed command without launching.
#
# Usage:
#   ./tethysapp/fimsim_gui/scripts/start_scheduler.sh 2>&1 | tee /tmp/fimsim_scheduler.log
#
set -euo pipefail

PORT="${FIMSIM_SCHEDULER_PORT:-8786}"
export DASK_DISTRIBUTED__SCHEDULER__ALLOWED_FAILURES="${FIMSIM_ALLOWED_FAILURES:-1}"

echo "FIMsim scheduler: port ${PORT}, allowed-failures=${DASK_DISTRIBUTED__SCHEDULER__ALLOWED_FAILURES}" >&2

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "DASK_DISTRIBUTED__SCHEDULER__ALLOWED_FAILURES=${DASK_DISTRIBUTED__SCHEDULER__ALLOWED_FAILURES} dask scheduler --port ${PORT}"
  exit 0
fi
exec dask scheduler --port "$PORT"
