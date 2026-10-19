#!/bin/sh
# Hostinger's builder reports many CPUs but refuses extra threads (EAGAIN).
# Pin the build to one core so SWC/Tokio do not try to spawn a huge pool.
export TOKIO_WORKER_THREADS=1
export RAYON_NUM_THREADS=1
if command -v taskset >/dev/null 2>&1; then
  exec taskset -c 0 next build --webpack
fi
exec next build --webpack
