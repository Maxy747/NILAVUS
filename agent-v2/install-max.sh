#!/bin/sh
# Install or update M.A.X. core on Dosimeter, from a checkout of this repo:
#
#   sudo sh agent-v2/install-max.sh              # public via Tailscale Funnel at /ai (default)
#   sudo MAX_EXPOSE=tailnet sh agent-v2/install-max.sh   # only devices on the tailnet
#   sudo MAX_EXPOSE=none sh agent-v2/install-max.sh      # leave Tailscale config alone
#
# Idempotent: re-running it updates max_core.py and the service, and only downloads
# llama.cpp or the model if they're missing. The model (1.9 GB) is never kept in Git;
# it is always verified against the checksum below.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

SRC=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MAX_USER=dosimeter                       # must match User= in nilavu-max.service
LLM_DIR=/home/$MAX_USER/llm              # must match paths in nilavu-max.service / max_core.py
LLAMA_TAG=b11149
LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_TAG/llama-$LLAMA_TAG-bin-ubuntu-x64.tar.gz"
MODEL_NAME=Llama-3.2-3B-Instruct-Q4_K_M.gguf
MODEL_URL="https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/$MODEL_NAME"
MODEL_SHA256=6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff
EXPOSE=${MAX_EXPOSE:-public}

id "$MAX_USER" >/dev/null 2>&1 || { echo "User $MAX_USER does not exist." >&2; exit 1; }
install -d -o "$MAX_USER" -g "$MAX_USER" "$LLM_DIR" "$LLM_DIR/models"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# 1. llama.cpp (CPU build)
if [ ! -x "$LLM_DIR/llama-$LLAMA_TAG/llama-server" ]; then
  echo "Downloading llama.cpp $LLAMA_TAG ..."
  curl -4 -fL --retry 3 -o "$tmp/llama.tar.gz" "$LLAMA_URL"
  tar -xzf "$tmp/llama.tar.gz" -C "$LLM_DIR"
  chown -R "$MAX_USER:$MAX_USER" "$LLM_DIR/llama-$LLAMA_TAG"
fi
"$LLM_DIR/llama-$LLAMA_TAG/llama-server" --version >/dev/null 2>&1 || { echo "llama-server does not run on this machine." >&2; exit 1; }

# 2. Model: download if missing (resumable), always verify.
model="$LLM_DIR/models/$MODEL_NAME"
if [ ! -f "$model" ]; then
  echo "Downloading $MODEL_NAME (about 2 GB) ..."
  curl -4 -fL -C - --retry 5 -o "$model.part" "$MODEL_URL"
  mv "$model.part" "$model"
  chown "$MAX_USER:$MAX_USER" "$model"
fi
echo "Verifying model checksum ..."
echo "$MODEL_SHA256  $model" | sha256sum -c - || { echo "Model checksum mismatch: delete $model and re-run." >&2; exit 1; }

# 3. Code and service
python3 -m py_compile "$SRC/max_core.py"
install -m 0644 -o "$MAX_USER" -g "$MAX_USER" "$SRC/max_core.py" "$LLM_DIR/max_core.py"
install -m 0644 -o "$MAX_USER" -g "$MAX_USER" "$SRC/max_eval.py" "$LLM_DIR/max_eval.py"
install -m 0644 "$SRC/nilavu-max.service" /etc/systemd/system/nilavu-max.service
systemctl daemon-reload
systemctl enable nilavu-max.service >/dev/null
systemctl restart nilavu-max.service

# 4. Exposure through Tailscale (/max belongs to another project; M.A.X. lives at /ai)
case "$EXPOSE" in
  public)  tailscale funnel --bg --set-path /ai http://127.0.0.1:8098 ;;
  tailnet) tailscale serve --bg --set-path /ai http://127.0.0.1:8098 ;;
  none)    ;;
  *) echo "MAX_EXPOSE must be public, tailnet or none." >&2; exit 2 ;;
esac

# 5. Verify
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8098/health >/dev/null 2>&1; then
    echo "M.A.X. core is running ($(systemctl is-active nilavu-max.service), exposure: $EXPOSE)."
    exit 0
  fi
  sleep 1
done
echo "M.A.X. core did not answer on 127.0.0.1:8098; see: journalctl -u nilavu-max.service" >&2
exit 1
