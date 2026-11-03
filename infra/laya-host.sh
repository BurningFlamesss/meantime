#!/usr/bin/env sh
# Run the real Laya server on the host when Docker is unavailable.
#
# Installs the pinned upstream package into a virtualenv (first run only) and
# starts `laya-serve` with the English checkpoint preloaded. The checkpoint is
# cached under HF_HOME; the first run downloads ~808 MB.
#
# Environment overrides: LAYA_VENV_DIR, HF_HOME, LAYA_HOST, LAYA_PORT,
# LAYA_DEVICE, LAYA_MODELS, LAYA_PRELOAD, OMP_NUM_THREADS.
set -eu

VENV_DIR="${LAYA_VENV_DIR:-$HOME/.local/share/meantime/laya-venv}"
HF_HOME="${HF_HOME:-$HOME/.local/share/meantime/hf}"
PY="$VENV_DIR/bin/python"

if [ ! -x "$PY" ]; then
  echo "creating Laya virtualenv at $VENV_DIR" >&2
  python3 -m venv "$VENV_DIR"
  "$PY" -m pip install --upgrade pip >/dev/null
fi

if ! "$PY" -c 'import laya, fastapi, uvicorn' >/dev/null 2>&1; then
  echo "installing laya[serve]==0.4.21 (CPU torch)" >&2
  # The CPU index avoids pulling several GB of CUDA wheels.
  "$PY" -m pip install --index-url https://download.pytorch.org/whl/cpu torch
  "$PY" -m pip install "laya[serve]==0.4.21"
fi

export HF_HOME
export LAYA_HOST="${LAYA_HOST:-127.0.0.1}"
export LAYA_PORT="${LAYA_PORT:-8000}"
export LAYA_DEVICE="${LAYA_DEVICE:-cpu}"
export LAYA_PRELOAD="${LAYA_PRELOAD:-1}"
export LAYA_MODELS="${LAYA_MODELS:-english}"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-4}"

exec "$VENV_DIR/bin/laya-serve"
