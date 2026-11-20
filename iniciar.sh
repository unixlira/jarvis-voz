#!/usr/bin/env bash
# Jarvis Voz (Mac/Linux): inicia el servidor local si no está corriendo y abre la página.
cd "$(dirname "$0")" || exit 1
PUERTO=$(grep -E '^PUERTO=' .env 2>/dev/null | cut -d= -f2 | tr -d '"\r '); PUERTO=${PUERTO:-8787}
NODE=node; [ -x ./node/bin/node ] && NODE=./node/bin/node
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! curl -fs -m 2 "http://127.0.0.1:$PUERTO/salud" >/dev/null 2>&1; then
  mkdir -p datos
  nohup "$NODE" server.mjs >> datos/servidor.log 2>&1 < /dev/null &
  for _ in $(seq 1 40); do curl -fs -m 1 "http://127.0.0.1:$PUERTO/salud" >/dev/null 2>&1 && break; sleep 0.5; done
fi
[ "$1" = "--sin-abrir" ] && exit 0
URL=$("$NODE" server.mjs --enlace)
if grep -qi microsoft /proc/version 2>/dev/null; then
  /mnt/c/Windows/System32/cmd.exe /c start "" "${URL}" >/dev/null 2>&1   # WSL: navegador de Windows
elif [ "$(uname)" = "Darwin" ]; then
  if [ -d "/Applications/Google Chrome.app" ]; then open -na "Google Chrome" --args --app="$URL"; else open "$URL"; fi
else
  for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
    command -v "$b" >/dev/null && { nohup "$b" --app="$URL" >/dev/null 2>&1 & exit 0; }
  done
  xdg-open "$URL" >/dev/null 2>&1 &
fi
