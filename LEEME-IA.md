# LEEME para Claude Code / Codex: instalar o arreglar Jarvis Voz

Si eres un asistente de programación (Claude Code, Codex) ayudando a una persona con Jarvis Voz, este archivo es para ti. Habla con la persona en español, en frases simples, y no hagas nada irreversible sin su OK.

## Qué es
- `server.mjs`: servidor Node (18.17+) que escucha SOLO en 127.0.0.1:PUERTO. Sirve `web/` (centro de mando), hace de puente WebSocket con Gemini Live (voz) y corre tareas con `claude -p` / `codex exec` / `gemini -p` en la carpeta `espacio/`.
- `.env`: configuración (ver `env.ejemplo`). Nunca muestres `GEMINI_API_KEY` ni `LLAVE_LOCAL` en el chat.
- `espacio/`: carpeta de trabajo de las tareas (reglas `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`, `memoria/MEMORIA.md`, especialistas en `.claude/skills/<nombre>/SKILL.md`, resultados en `entregas/`).
- `datos/`: tareas, conversaciones, uso de voz, registro `jarvis-voz.log`.

## Instalar (si el instalador automático no funcionó)
1. Node.js 18.17+ (`node --version`).
2. Claude Code: `curl -fsSL https://claude.ai/install.sh | bash` (Mac/Linux) o `irm https://claude.ai/install.ps1 | iex` (Windows). Login: `claude auth login` (la persona entra en su cuenta en el navegador). Comprobar: `claude auth status`.
3. Bajar `https://github.com/unixlira/jarvis-voz/releases/latest/download/jarvis-voz.zip` y descomprimir en `~/JarvisVoz` (Windows: `%USERPROFILE%\JarvisVoz`).
4. `cp env.ejemplo .env` y completar `GEMINI_API_KEY` (la persona la crea en https://aistudio.google.com/apikey y la pega ella misma), `LLAVE_LOCAL` (48 caracteres hex aleatorios), `ZONA_HORARIA`. Permisos: `chmod 600 .env` (Windows: `icacls .env /inheritance:r /grant:r "%USERNAME%:(R,W)"`).
5. `node server.mjs --diagnostico` → todo con ✔.
6. Abrir: `./iniciar.sh` (Mac/Linux) o `iniciar.cmd` (Windows).

## Problemas comunes
| Síntoma | Qué revisar |
|---|---|
| La página dice "Abre Jarvis Voz desde el acceso directo" | Falta la cookie: abrir con `iniciar` (pasa `?llave=`). |
| "No pude usar el micrófono" | Permiso del navegador para `localhost`; otro programa usando el micrófono. |
| La voz no conecta / "sin cuota" | Clave de Gemini, límites en AI Studio, `VOZ_MODELO` disponible para la clave (`--diagnostico`). |
| Las tareas fallan al instante | `claude auth status`; `MOTORES` en `.env`; ver `datos/jarvis-voz.log`. |
| Un especialista no aparece | Debe existir `espacio/.claude/skills/<carpeta>/SKILL.md` con `name:` en el encabezado. |
| Puerto ocupado | Cambiar `PUERTO` en `.env` y abrir de nuevo con `iniciar`. |

## Reglas para ti
- No expongas el servidor a la red (no cambies el `listen` a 0.0.0.0, no abras puertos en el firewall).
- No borres `espacio/` ni `datos/` (son la memoria y el trabajo de la persona).
- No subas `.env` a ningún lado.
