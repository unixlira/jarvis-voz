#!/usr/bin/env bash
# Arma los archivos de la versión (dist/): el programa y los instaladores por sistema.
set -euo pipefail
# zip con permisos (ejecutables) usando Python, para no depender del programa "zip".
zipar() { python3 - "$@" <<'PY'
import os, sys, zipfile, stat
destino, base, carpeta = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(destino, 'w', zipfile.ZIP_DEFLATED) as z:
    for raiz, dirs, archivos in os.walk(os.path.join(base, carpeta)):
        dirs.sort()
        for a in sorted(archivos):
            ruta = os.path.join(raiz, a)
            info = zipfile.ZipInfo.from_file(ruta, os.path.relpath(ruta, base))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | (0o755 if os.access(ruta, os.X_OK) else 0o644)) << 16
            with open(ruta, 'rb') as f: z.writestr(info, f.read())
PY
}
cd "$(dirname "$0")/.."
V=$(cat VERSION)
rm -rf dist && mkdir -p dist/stage/jarvis-voz
cp -R server.mjs VERSION package.json env.ejemplo iniciar.sh iniciar.ps1 iniciar.vbs iniciar.cmd README.md LEEME-IA.md LICENSE CHANGELOG.md web espacio-modelo node_modules instaladores dist/stage/jarvis-voz/
# PowerShell 5.1 (Windows) necesita BOM para leer bien los acentos.
for f in $(find dist/stage/jarvis-voz -name '*.ps1'); do printf '\xEF\xBB\xBF' | cat - "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done
for f in $(find dist/stage/jarvis-voz -name '*.bat' -o -name '*.cmd' -o -name '*.vbs'); do sed -i 's/\r\?$/\r/' "$f"; done
chmod +x dist/stage/jarvis-voz/iniciar.sh dist/stage/jarvis-voz/instaladores/mac-linux/*.sh
zipar dist/jarvis-voz.zip dist/stage jarvis-voz
# Instaladores sueltos (lo que la persona baja y abre con doble clic)
mkdir -p "dist/stage/win/Instalar Jarvis Voz" "dist/stage/mac/Instalar Jarvis Voz"
cp dist/stage/jarvis-voz/instaladores/windows/*.bat dist/stage/jarvis-voz/instaladores/windows/*.ps1 "dist/stage/win/Instalar Jarvis Voz/"
zipar dist/instalar-jarvis-voz-windows.zip dist/stage/win "Instalar Jarvis Voz"
cp dist/stage/jarvis-voz/instaladores/mac-linux/instalar-jarvis-voz.sh "dist/stage/mac/Instalar Jarvis Voz/instalar-jarvis-voz.command"
cp dist/stage/jarvis-voz/instaladores/mac-linux/desinstalar-jarvis-voz.sh "dist/stage/mac/Instalar Jarvis Voz/desinstalar-jarvis-voz.command"
chmod +x "dist/stage/mac/Instalar Jarvis Voz/"*.command
zipar dist/instalar-jarvis-voz-mac.zip dist/stage/mac "Instalar Jarvis Voz"
cp dist/stage/jarvis-voz/instaladores/mac-linux/instalar-jarvis-voz.sh dist/instalar-jarvis-voz-linux.sh
rm -rf dist/stage
(cd dist && sha256sum * > SHA256SUMS.txt)
ls -la dist
echo "Versión $V lista en dist/"
