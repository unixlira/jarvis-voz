#!/usr/bin/env bash
# Desinstalador de Jarvis Voz para Mac y Linux. No desinstala Node.js ni Claude Code.
CARPETA="${JARVIS_CARPETA:-$HOME/JarvisVoz}"
echo "Desinstalando Jarvis Voz de $CARPETA"
PUERTO=$(grep -E '^PUERTO=[0-9]+' "$CARPETA/.env" 2>/dev/null | cut -d= -f2); PUERTO=${PUERTO:-8787}
LLAVE=$(grep -E '^LLAVE_LOCAL=' "$CARPETA/.env" 2>/dev/null | cut -d= -f2 | tr -d '"\r ')
curl -fs -m 3 -X POST "http://127.0.0.1:$PUERTO/apagar?llave=$LLAVE" >/dev/null 2>&1; sleep 1
echo "  OK  servidor detenido"
rm -rf "$HOME/Desktop/Jarvis Voz.app" "$HOME/Desktop/Jarvis Voz.command" "$HOME/.local/share/applications/jarvis-voz.desktop" \
  "$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")/jarvis-voz.desktop" "$HOME/.config/autostart/jarvis-voz.desktop" \
  "$HOME/Library/LaunchAgents/com.jarvisvoz.servidor.plist" 2>/dev/null
echo "  OK  accesos directos quitados"
if [ -n "${JARVIS_BORRAR_TODO:-}" ]; then R=$([ "$JARVIS_BORRAR_TODO" = 1 ] && echo s || echo n)
else read -r -p "  ¿Borrar también tus entregas, memoria y conversaciones? (s/N) " R < /dev/tty || R=n; fi
if [[ "$R" =~ ^[sSyY] ]]; then rm -rf "$CARPETA"; echo "  OK  carpeta borrada"
else find "$CARPETA" -mindepth 1 -maxdepth 1 ! -name espacio ! -name datos -exec rm -rf {} +; echo "  OK  programa borrado; tus entregas quedaron en $CARPETA/espacio"; fi
echo "Listo."
