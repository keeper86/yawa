#!/bin/sh
set -eu

MODEL='embeddinggemma:300m'

if [ "${1:-}" = '--check' ]; then
    exec ollama show "$MODEL" >/dev/null 2>&1
fi

ollama serve &
server_pid=$!

trap 'kill -TERM "$server_pid" 2>/dev/null || true; exit 0' TERM INT

attempts=0
until ollama list >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 60 ]; then
        echo 'Ollama did not become ready within 60 seconds.' >&2
        exit 1
    fi
    sleep 1
done

if ollama show "$MODEL" >/dev/null 2>&1; then
    echo "Model $MODEL is already available."
else
    echo "Pulling model $MODEL."
    ollama pull "$MODEL"
fi

wait "$server_pid"
