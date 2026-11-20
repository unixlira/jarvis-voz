#!/usr/bin/env bash
# Instalador de Jarvis Voz para Mac y Linux.
# Se puede correr varias veces: no borra tu configuración, tu memoria ni tus entregas.
#
#   1) Node.js (servidor local)        -> el del sistema si es 18.17+, si no Homebrew (Mac) o copia portátil
#   2) Claude Code (método oficial) y entrar en tu cuenta de Claude (se abre el navegador)
#   3) Clave de Gemini (voz), con el enlace para crearla gratis
#   4) Baja la última versión desde GitHub, configura, crea el acceso directo,
#      prueba y abre la página.
#
# Opciones (para pruebas): JARVIS_CARPETA, JARVIS_ZIP (zip local), JARVIS_GEMINI_KEY,
# JARVIS_SIN_CLAUDE=1, JARVIS_SIN_PREGUNTAS=1
set -euo pipefail
REPO="unixlira/jarvis-voz"
CARPETA="${JARVIS_CARPETA:-$HOME/JarvisVoz}"
SIN_PREGUNTAS="${JARVIS_SIN_PREGUNTAS:-0}"
SO="$(uname -s)"
VERDE=$'\e[32m'; MORADO=$'\e[35m'; GRIS=$'\e[90m'; AMARILLO=$'\e[33m'; ROJO=$'\e[31m'; CIAN=$'\e[36m'; FIN=$'\e[0m'
paso() { printf '\n%s[%s/5] %s%s\n' "$MORADO" "$1" "$2" "$FIN"; }
ok() { printf '  %sOK%s  %s\n' "$VERDE" "$FIN" "$1"; }
info() { printf '  %s... %s%s\n' "$GRIS" "$1" "$FIN"; }
aviso() { printf '  %s!   %s%s\n' "$AMARILLO" "$1" "$FIN"; }
falla() { printf '\n  %sX   %s%s\n\n' "$ROJO" "$1" "$FIN"; exit 1; }
tiene() { command -v "$1" >/dev/null 2>&1; }
# Las preguntas leen del teclado aunque el script venga por "curl | bash".
preguntar() { local r; if [ "$SIN_PREGUNTAS" = 1 ]; then echo ""; return; fi; read -r -p "$1" r < /dev/tty; echo "$r"; }
preguntar_secreto() { local r; read -r -s -p "$1" r < /dev/tty; echo >&2; echo "$r"; }
abrir() { if [ "$SO" = Darwin ]; then open "$1"; elif grep -qi microsoft /proc/version 2>/dev/null; then /mnt/c/Windows/System32/cmd.exe /c start "" "$1" >/dev/null 2>&1 || true; else xdg-open "$1" >/dev/null 2>&1 || true; fi; }
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

cat <<EOF

  ${MORADO}=============================================${FIN}
     ${VERDE}JARVIS VOZ${FIN}  ·  instalador para $( [ "$SO" = Darwin ] && echo Mac || echo Linux )
  ${MORADO}=============================================${FIN}
  Solo te voy a pedir dos cosas: entrar en tu cuenta de Claude y
  pegar tu clave de Gemini. Todo lo demás lo hago yo.
  Carpeta: $CARPETA
EOF
mkdir -p "$CARPETA"

# ---- 1) Node.js ---------------------------------------------------------------------
paso 1 'Node.js (motor del servidor local)'
NODE=""
version_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>18||(a===18&&b>=17)?0:1)' 2>/dev/null; }
if tiene node && version_ok node; then NODE="$(command -v node)"; ok "Node.js $(node --version) ya está instalado"
elif [ -x "$CARPETA/node/bin/node" ]; then NODE="$CARPETA/node/bin/node"; ok "Node.js portátil ya está en la carpeta de Jarvis Voz"
else
  if [ "$SO" = Darwin ] && tiene brew; then info 'brew install node...'; brew install node >/dev/null && NODE="$(command -v node)"; fi
  if [ -z "$NODE" ]; then
    info 'Bajo Node.js portátil desde nodejs.org (solo para Jarvis Voz, sin tocar el sistema)...'
    LTS=$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v[0-9.]*"[^}]*"lts":"[A-Za-z]*"' | head -1 | grep -o 'v[0-9.]*')
    case "$(uname -m)" in x86_64|amd64) ARQ=x64;; arm64|aarch64) ARQ=arm64;; *) falla "Procesador $(uname -m) no soportado";; esac
    PLAT=$([ "$SO" = Darwin ] && echo darwin || echo linux)
    TMP=$(mktemp -d)
    curl -fsSL "https://nodejs.org/dist/$LTS/node-$LTS-$PLAT-$ARQ.tar.gz" | tar -xz -C "$TMP"
    rm -rf "$CARPETA/node"; mv "$TMP"/node-* "$CARPETA/node"; rm -rf "$TMP"
    NODE="$CARPETA/node/bin/node"
  fi
  [ -x "$NODE" ] || falla 'No pude instalar Node.js. Instálalo desde https://nodejs.org y corre este instalador de nuevo.'
  ok "Node.js $("$NODE" --version)"
fi

# ---- 2) Claude Code + cuenta ------------------------------------------------------------
paso 2 'Claude Code (las "manos" de Jarvis: hace las tareas en tu computadora)'
if [ "${JARVIS_SIN_CLAUDE:-0}" = 1 ]; then aviso 'Saltado. Jarvis usará Codex o Gemini CLI si los tienes.'
else
  if ! tiene claude; then
    info 'Instalando Claude Code con el instalador oficial (claude.ai/install.sh)...'
    curl -fsSL https://claude.ai/install.sh | bash || aviso 'El instalador oficial falló.'
    export PATH="$HOME/.local/bin:$PATH"
  fi
  tiene claude || falla 'No pude instalar Claude Code. Mira https://code.claude.com/docs/en/setup y corre este instalador de nuevo.'
  ok "Claude Code $(claude --version 2>/dev/null | head -1)"
  logueado() { claude auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; }
  if logueado; then ok 'Ya entraste en tu cuenta de Claude'
  elif [ "$SIN_PREGUNTAS" = 1 ]; then aviso 'Falta entrar en la cuenta de Claude (modo sin preguntas).'
  else
    printf '\n  %sAhora vas a entrar en tu cuenta de Claude (plan Pro, Max o superior).%s\n' "$CIAN" "$FIN"
    echo '  Se abre el navegador: entra, autoriza y, si te muestra un código, cópialo y pégalo aquí.'
    preguntar '  Presiona Enter para abrir el navegador ' >/dev/null
    for _ in 1 2 3; do logueado && break; claude auth login < /dev/tty || true; done
    if logueado; then ok 'Cuenta de Claude conectada'; else aviso 'No quedó conectada. Puedes hacerlo después con:  claude auth login'; fi
  fi
fi

# ---- 3) Clave de Gemini ---------------------------------------------------------------------
paso 3 'Clave de Gemini (la voz en tiempo real)'
ENV="$CARPETA/.env"
CLAVE="${JARVIS_GEMINI_KEY:-}"
[ -z "$CLAVE" ] && [ -f "$ENV" ] && CLAVE=$(grep -E '^GEMINI_API_KEY=.+' "$ENV" | head -1 | cut -d= -f2- | tr -d '"\r ' || true)
valida() { [ -n "$1" ] && curl -fs -m 20 -o /dev/null "https://generativelanguage.googleapis.com/v1beta/models?key=$1"; }
if valida "$CLAVE"; then ok 'Clave de Gemini válida'
elif [ "$SIN_PREGUNTAS" = 1 ]; then falla 'Falta la clave de Gemini (JARVIS_GEMINI_KEY).'
else
  printf '\n  %sCrea tu clave GRATIS en Google AI Studio (botón "Create API key"):%s\n     https://aistudio.google.com/apikey\n' "$CIAN" "$FIN"
  echo '  La clave queda solo en tu computadora; no se envía a nadie más que a Google.'
  abrir 'https://aistudio.google.com/apikey'
  CLAVE=""
  for _ in 1 2 3 4 5; do
    CLAVE=$(preguntar_secreto '  Pega aquí tu clave de Gemini (no se ve al pegar) y presiona Enter: ' | tr -d '[:space:]')
    valida "$CLAVE" && { ok 'Clave válida'; break; }
    aviso 'Google no aceptó esa clave. Revisa que la copiaste completa.'; CLAVE=""
  done
  [ -n "$CLAVE" ] || falla 'Sin clave de Gemini no hay voz. Corre el instalador de nuevo cuando la tengas.'
fi

# ---- 4) Jarvis Voz desde GitHub -----------------------------------------------------------------
paso 4 "Bajando Jarvis Voz (github.com/$REPO) y configurando"
PUERTO_VIEJO=$(grep -E '^PUERTO=[0-9]+' "$ENV" 2>/dev/null | cut -d= -f2 || true); PUERTO_VIEJO=${PUERTO_VIEJO:-8787}
LLAVE_VIEJA=$(grep -E '^LLAVE_LOCAL=' "$ENV" 2>/dev/null | cut -d= -f2 | tr -d '"\r ' || true)
if [ -n "$LLAVE_VIEJA" ] && curl -fs -m 2 "http://127.0.0.1:$PUERTO_VIEJO/salud" >/dev/null 2>&1; then
  curl -fs -m 3 -X POST "http://127.0.0.1:$PUERTO_VIEJO/apagar?llave=$LLAVE_VIEJA" >/dev/null 2>&1 || true
  sleep 1
fi
TMP=$(mktemp -d)
if [ -n "${JARVIS_ZIP:-}" ]; then cp "$JARVIS_ZIP" "$TMP/j.zip"; else curl -fsSL "https://github.com/$REPO/releases/latest/download/jarvis-voz.zip" -o "$TMP/j.zip"; fi
if tiene unzip; then unzip -q -o "$TMP/j.zip" -d "$TMP/x"; else python3 -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$TMP/j.zip" "$TMP/x"; fi
ORIGEN="$TMP/x"; [ -f "$TMP/x/jarvis-voz/server.mjs" ] && ORIGEN="$TMP/x/jarvis-voz"
# Copia el programa nuevo; nunca toca .env, datos/ ni espacio/ (tu configuración, memoria y entregas).
cp -R "$ORIGEN"/. "$CARPETA"/
rm -rf "$TMP"
chmod +x "$CARPETA"/iniciar.sh "$CARPETA"/instaladores/mac-linux/*.sh 2>/dev/null || true
ok "Jarvis Voz $(cat "$CARPETA/VERSION") en $CARPETA"

# .env: crea o actualiza sin perder lo que ya tenías
[ -f "$ENV" ] || cp "$CARPETA/env.ejemplo" "$ENV"
poner() { if grep -qE "^#?\s*$1=" "$ENV"; then "$NODE" -e 'const fs=require("fs");const [f,k,v]=process.argv.slice(1);fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(new RegExp("^#?\\s*"+k+"=.*$","m"),k+"="+v))' "$ENV" "$1" "$2"; else printf '%s=%s\n' "$1" "$2" >> "$ENV"; fi; }
valor() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- | tr -d '"\r ' || true; }
[ "$(valor LLAVE_LOCAL | wc -c)" -gt 24 ] || poner LLAVE_LOCAL "$("$NODE" -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
poner GEMINI_API_KEY "$CLAVE"
[ -n "$(valor ZONA_HORARIA)" ] || poner ZONA_HORARIA "$("$NODE" -e 'console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)')"
[ -n "$(valor PUERTO)" ] || poner PUERTO 8787
chmod 600 "$ENV"
ok 'Configuración guardada (.env solo para tu usuario)'

if [ -f "$CARPETA/espacio/.claude/skills/conexiones-google/SKILL.md" ]; then
  printf '\n  %sTienes el complemento Conexiones. Para conectar tu cuenta Google:%s\n' "$CIAN" "$FIN"
  echo '  claude.ai > Personalizar > Conectores > conecta Google Calendar, Gmail y Google Drive.'
  [ "$SIN_PREGUNTAS" = 1 ] || abrir 'https://claude.ai/customize/connectors'
fi

if [ -f "$CARPETA/espacio/.claude/skills/videos/SKILL.md" ] && ! tiene ffmpeg; then
  if [ "$SO" = Darwin ] && tiene brew; then info 'Complemento Videos virales: brew install ffmpeg...'; brew install ffmpeg >/dev/null && ok 'ffmpeg instalado'
  else aviso 'El complemento Videos virales necesita ffmpeg: instálalo con  sudo apt install ffmpeg  (o brew install ffmpeg en Mac).'; fi
fi
if [ -f "$CARPETA/espacio/.claude/skills/redes/SKILL.md" ] && [ -z "$(valor ZERNIO_API_KEY)" ] && [ "$SIN_PREGUNTAS" != 1 ]; then
  printf '\n  %sTienes el complemento Publicaciones automáticas.%s Pega tu clave de Zernio (o Enter para ponerla después en .env).\n' "$CIAN" "$FIN"
  Z=$(preguntar_secreto '  Clave de Zernio: ' | tr -d '[:space:]')
  [ -n "$Z" ] && { poner ZERNIO_API_KEY "$Z"; ok 'Clave de Zernio guardada'; }
fi

# ---- 5) Acceso directo, prueba y apertura ---------------------------------------------------------
paso 5 'Acceso directo, prueba y apertura'
if [ "$SO" = Darwin ]; then
  APP="$HOME/Desktop/Jarvis Voz.app"
  if tiene osacompile; then
    rm -rf "$APP"
    osacompile -o "$APP" -e "do shell script quoted form of \"$CARPETA/iniciar.sh\" & \" >/dev/null 2>&1 &\"" >/dev/null
    if [ -f "$CARPETA/web/icono.icns" ]; then cp "$CARPETA/web/icono.icns" "$APP/Contents/Resources/applet.icns"; touch "$APP"; fi
  else
    printf '#!/bin/bash\n"%s/iniciar.sh"\n' "$CARPETA" > "$HOME/Desktop/Jarvis Voz.command"; chmod +x "$HOME/Desktop/Jarvis Voz.command"
  fi
  ok 'Acceso directo "Jarvis Voz" creado en el escritorio'
else
  ESC="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
  mkdir -p "$HOME/.local/share/applications"
  DESKTOP="[Desktop Entry]
Type=Application
Name=Jarvis Voz
Comment=Háblale a tu asistente
Exec=\"$CARPETA/iniciar.sh\"
Icon=$CARPETA/web/icono.png
Terminal=false
Categories=Utility;"
  printf '%s\n' "$DESKTOP" > "$HOME/.local/share/applications/jarvis-voz.desktop"
  if [ -d "$ESC" ]; then printf '%s\n' "$DESKTOP" > "$ESC/jarvis-voz.desktop"; chmod +x "$ESC/jarvis-voz.desktop"; gio set "$ESC/jarvis-voz.desktop" metadata::trusted true 2>/dev/null || true; fi
  ok 'Acceso directo "Jarvis Voz" creado (menú de aplicaciones y escritorio)'
fi

R=$(preguntar '  ¿Iniciar el servidor de Jarvis Voz al encender la computadora? (s/N) ')
if [[ "$R" =~ ^[sSyY] ]]; then
  if [ "$SO" = Darwin ]; then
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$HOME/Library/LaunchAgents/com.jarvisvoz.servidor.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>com.jarvisvoz.servidor</string><key>ProgramArguments</key><array><string>$CARPETA/iniciar.sh</string><string>--sin-abrir</string></array><key>RunAtLoad</key><true/></dict></plist>
PL
  else
    mkdir -p "$HOME/.config/autostart"
    printf '[Desktop Entry]\nType=Application\nName=Jarvis Voz (servidor)\nExec="%s/iniciar.sh" --sin-abrir\nX-GNOME-Autostart-enabled=true\n' "$CARPETA" > "$HOME/.config/autostart/jarvis-voz.desktop"
  fi
  ok 'Se iniciará al encender (sin abrir la página)'
fi

info 'Probando la instalación...'
(cd "$CARPETA" && "$NODE" server.mjs --diagnostico) || aviso 'El diagnóstico marcó algo con X (arriba). Jarvis Voz abre igual, pero corrígelo.'
"$CARPETA/iniciar.sh" --sin-abrir
PUERTO=$(valor PUERTO)
curl -fs -m 5 "http://127.0.0.1:$PUERTO/salud" >/dev/null || falla "El servidor no arrancó. Mira $CARPETA/datos/servidor.log"
ok "Servidor local funcionando en http://localhost:$PUERTO (solo esta computadora)"

printf '\n  %sLISTO. Jarvis Voz está instalado.%s\n' "$VERDE" "$FIN"
echo '  Para abrirlo: "Jarvis Voz" en el escritorio (o corre '"$CARPETA"'/iniciar.sh).'
echo '  En la página: clic en el micrófono (o barra espaciadora) y háblale.'
echo "  Tus archivos: $CARPETA/espacio/entregas"
[ "$SIN_PREGUNTAS" = 1 ] || "$CARPETA/iniciar.sh"
