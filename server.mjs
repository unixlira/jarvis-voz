// Jarvis Voz: tu asistente de voz en el navegador de tu computadora.
//
//   Navegador (micrófono y parlante)  <->  este servidor (en tu PC)  <->  Gemini Live (voz)
//                                                  |
//                                                  +-> Tareas en segundo plano: Claude Code
//                                                      (o Codex / Gemini CLI) en la carpeta
//                                                      "espacio", con tu equipo de especialistas.
//
// La voz escucha y habla en tiempo real. Todo trabajo de verdad (investigar, escribir,
// crear archivos, programar, usar internet) se convierte en una TAREA que corre en tu
// PC con la IA que ya usas. Cuando termina, Jarvis te avisa hablando.
//
// Uso:  node server.mjs                 inicia el servidor (solo escucha en 127.0.0.1)
//       node server.mjs --diagnostico   revisa la configuración y sale
//       node server.mjs --enlace        imprime el enlace local para abrir la página
//
// Licencia: MIT (ver LICENSE). Sin dependencias externas salvo "ws" (incluida).

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const VERSION = fs.existsSync(path.join(RAIZ, 'VERSION')) ? fs.readFileSync(path.join(RAIZ, 'VERSION'), 'utf8').trim() : '2.0.0';
const WINDOWS = process.platform === 'win32';

// ---- Configuración (.env junto a este archivo) ------------------------------
function leerEnv() {
    const env = {};
    const archivo = path.join(RAIZ, '.env');
    if (fs.existsSync(archivo)) {
        for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
            const l = linea.trim();
            if (!l || l.startsWith('#') || !l.includes('=')) continue;
            const i = l.indexOf('=');
            env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        }
    }
    return { ...env, ...process.env };
}
const env = leerEnv();
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
const si = (v, d) => (v === undefined || v === '' ? d : /^(si|sí|s|yes|true|1)$/i.test(String(v)));

const CFG = {
    puerto: num(env.PUERTO, 8787),
    llave: env.LLAVE_LOCAL || '',
    geminiKey: env.GEMINI_API_KEY || '',
    modelo: env.VOZ_MODELO || 'gemini-3.8-live',
    modeloReserva: env.VOZ_MODELO_RESERVA || 'gemini-3.1-flash-live-preview',
    voz: env.VOZ_NOMBRE || 'Charon',
    idiomaVoz: env.VOZ_IDIOMA || 'es-US',
    nombre: env.ASISTENTE_NOMBRE || 'Jarvis',
    usuario: env.USUARIO_NOMBRE || '',
    zona: env.ZONA_HORARIA || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    minutosDia: num(env.MINUTOS_POR_DIA, 30),
    pausaSeg: num(env.PAUSA_SIN_ACTIVIDAD_SEG, 120),
    avisarPorVoz: si(env.AVISAR_POR_VOZ, true),
    motores: String(env.MOTORES || 'claude,codex,gemini').split(',').map((m) => m.trim().toLowerCase()).filter(Boolean),
    modeloClaude: env.MODELO_CLAUDE || '',
    modeloCodex: env.MODELO_CODEX || '',
    modeloGemini: env.MODELO_GEMINI || '',
    simultaneas: Math.max(1, num(env.TAREAS_SIMULTANEAS, 3)),
    tareaMaxMin: num(env.TAREA_MAX_MIN, 30),
    permitirComandos: si(env.PERMITIR_COMANDOS, true),
    espacio: path.resolve(RAIZ, env.ESPACIO || 'espacio'),
    guardarConversacion: si(env.GUARDAR_CONVERSACION, true),
    grabarAudio: si(env.GRABAR_AUDIO, false),
    // Precio por 1 millón de tokens (USD), página oficial de precios de la Gemini API
    // (Gemini 3.8 Live / 3.1 Flash Live, plan pago, consultada el 19/11/2026). Solo para la estimación en pantalla.
    precio: {
        textoEntrada: num(env.PRECIO_TEXTO_ENTRADA, 0.75),
        audioEntrada: num(env.PRECIO_AUDIO_ENTRADA, 3.0),
        textoSalida: num(env.PRECIO_TEXTO_SALIDA, 4.5),
        audioSalida: num(env.PRECIO_AUDIO_SALIDA, 12.0),
    },
};

const DATOS = path.join(RAIZ, 'datos');
fs.mkdirSync(DATOS, { recursive: true, mode: 0o700 });
const LOG = path.join(DATOS, 'jarvis-voz.log');
const ahoraTexto = () => new Date().toLocaleString('sv-SE', { timeZone: CFG.zona });
const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: CFG.zona });
function log(...m) {
    const linea = `[${ahoraTexto()}] ${m.join(' ')}`;
    console.log(linea);
    try { fs.appendFileSync(LOG, linea + '\n', { mode: 0o600 }); } catch {}
}
const escribirJson = (archivo, obj) => {
    const tmp = archivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, archivo);
};
const leerJson = (archivo, defecto) => { try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { return defecto; } };
const sinAcentos = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ---- Carpeta de trabajo ("espacio") -------------------------------------------
// Aquí trabajan las tareas: reglas (CLAUDE.md / AGENTS.md / GEMINI.md), memoria,
// especialistas (.claude/skills/<nombre>/SKILL.md) y entregas.
function prepararEspacio() {
    const modelo = path.join(RAIZ, 'espacio-modelo');
    fs.mkdirSync(CFG.espacio, { recursive: true });
    const copiar = (orig, dest) => {
        for (const e of fs.readdirSync(orig, { withFileTypes: true })) {
            const o = path.join(orig, e.name);
            const d = path.join(dest, e.name);
            if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copiar(o, d); } else if (!fs.existsSync(d)) fs.copyFileSync(o, d);
        }
    };
    if (fs.existsSync(modelo)) copiar(modelo, CFG.espacio);
    for (const d of ['entregas', 'memoria', '.claude/skills', 'papelera']) fs.mkdirSync(path.join(CFG.espacio, d), { recursive: true });
    const mem = path.join(CFG.espacio, 'memoria', 'MEMORIA.md');
    if (!fs.existsSync(mem)) fs.writeFileSync(mem, '# Memoria\n\nDatos que el usuario pidió recordar. Una línea por dato.\n\n');
}
prepararEspacio();

// ---- Equipo (especialistas) -------------------------------------------------------
// Cada especialista es una carpeta con SKILL.md (el mismo formato de skills de Claude Code).
// Los 8 conocidos tienen nombre, rol y color fijos; cualquier otra skill también se acepta.
const CONOCIDOS = [
    { skill: 'vendedora', nombre: 'Valentina', rol: 'Ventas', color: '#A3FF12' },
    { skill: 'copywriter', nombre: 'Mateo', rol: 'Copywriter', color: '#C084FC' },
    { skill: 'programador', nombre: 'Leo', rol: 'Programador', color: '#38BDF8' },
    { skill: 'investigadora', nombre: 'Sofía', rol: 'Investigadora', color: '#FBBF24' },
    { skill: 'contenido', nombre: 'Lucas', rol: 'Contenido', color: '#F472B6' },
    { skill: 'atencion', nombre: 'Camila', rol: 'Atención', color: '#2DD4BF' },
    { skill: 'trafico', nombre: 'Diego', rol: 'Tráfico pago', color: '#FB923C' },
    { skill: 'disenadora', nombre: 'Paula', rol: 'Diseño', color: '#F87171' },
    { skill: 'videos', nombre: 'Nico', rol: 'Videos virales', color: '#F43F5E' },
    { skill: 'redes', nombre: 'Martina', rol: 'Publicaciones', color: '#818CF8' },
];
const DIR_SKILLS = () => path.join(CFG.espacio, '.claude', 'skills');
function leerFrontmatter(texto) {
    const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const datos = {};
    if (m) for (const l of m[1].split(/\r?\n/)) { const k = l.match(/^(name|description):\s*(.*)$/); if (k) datos[k[1]] = k[2].replace(/^["']|["']$/g, '').trim(); }
    return { datos, cuerpo: m ? texto.slice(m[0].length).trim() : texto };
}
function equipo() {
    const instalados = new Map();
    try {
        for (const e of fs.readdirSync(DIR_SKILLS(), { withFileTypes: true })) {
            const archivo = path.join(DIR_SKILLS(), e.name, 'SKILL.md');
            if (!e.isDirectory() || !fs.existsSync(archivo)) continue;
            const { datos } = leerFrontmatter(fs.readFileSync(archivo, 'utf8'));
            instalados.set(datos.name || e.name, { carpeta: path.join(DIR_SKILLS(), e.name), descripcion: datos.description || '' });
        }
    } catch {}
    const lista = CONOCIDOS.map((c) => ({ ...c, instalado: instalados.has(c.skill), ...(instalados.get(c.skill) || {}) }));
    for (const [skill, info] of instalados) {
        if (CONOCIDOS.some((c) => c.skill === skill)) continue;
        if (skill.startsWith('jarvis-') || skill === 'conexiones-google') continue; // habilidades que no son personas
        const nombre = (info.descripcion.split(':')[0] || skill).trim().slice(0, 24);
        lista.push({ skill, nombre, rol: 'Especialista', color: '#94A3B8', instalado: true, ...info });
    }
    return lista;
}
function buscarEspecialista(texto) {
    const t = sinAcentos(texto).trim();
    if (!t) return null;
    return equipo().find((e) => [e.nombre, e.skill, e.rol].some((x) => sinAcentos(x) === t || t.includes(sinAcentos(e.nombre))));
}

// ---- Uso del día (minutos y costo estimado de la voz) ---------------------------
const ARCHIVO_USO = path.join(DATOS, 'uso.json');
const usoVacio = () => ({ fecha: hoy(), segundos: 0, costo: 0, tokens: { textoEntrada: 0, audioEntrada: 0, textoSalida: 0, audioSalida: 0 } });
let uso = leerJson(ARCHIVO_USO, usoVacio());
if (uso.fecha !== hoy()) uso = usoVacio();
const usoDeHoy = () => { if (uso.fecha !== hoy()) uso = usoVacio(); return uso; };
let usoSucio = false;
setInterval(() => { if (usoSucio) { usoSucio = false; escribirJson(ARCHIVO_USO, uso); } }, 5000).unref();
const limiteSeg = () => CFG.minutosDia * 60;
const resumenUso = () => { const u = usoDeHoy(); return { minutos: +(u.segundos / 60).toFixed(1), limite: CFG.minutosDia, costo: +u.costo.toFixed(4) }; };
function sumarTokens(meta) {
    const u = usoDeHoy();
    const por = (lista) => { const r = { TEXT: 0, AUDIO: 0, OTRO: 0 }; for (const d of lista || []) r[d.modality === 'TEXT' || d.modality === 'AUDIO' ? d.modality : 'OTRO'] += d.tokenCount || 0; return r; };
    const ent = por(meta.promptTokensDetails);
    const sal = por(meta.responseTokensDetails);
    const t = { textoEntrada: ent.TEXT + ent.OTRO, audioEntrada: ent.AUDIO, textoSalida: sal.TEXT + sal.OTRO + (meta.thoughtsTokenCount || 0), audioSalida: sal.AUDIO };
    for (const k of Object.keys(t)) { u.tokens[k] += t[k]; u.costo += (t[k] / 1e6) * CFG.precio[k]; }
    usoSucio = true;
}

// ---- Conversación guardada (solo en tu PC) -----------------------------------------
// Un archivo por día: datos/conversaciones/AAAA-MM-DD.jsonl  {h, quien, texto}
const DIR_CONV = path.join(DATOS, 'conversaciones');
function anotar(quien, texto) {
    if (!CFG.guardarConversacion || !texto?.trim()) return;
    fs.mkdirSync(DIR_CONV, { recursive: true, mode: 0o700 });
    const h = new Date().toLocaleTimeString('es', { timeZone: CFG.zona, hour12: false, hour: '2-digit', minute: '2-digit' });
    fs.appendFileSync(path.join(DIR_CONV, `${hoy()}.jsonl`), JSON.stringify({ h, quien, texto: texto.trim() }) + '\n', { mode: 0o600 });
}
function conversacionDe(dia) {
    const archivo = path.join(DIR_CONV, `${dia}.jsonl`);
    if (!fs.existsSync(archivo)) return [];
    return fs.readFileSync(archivo, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// ---- Memoria (lo que el usuario pide recordar) -----------------------------------------
const ARCHIVO_MEMORIA = () => path.join(CFG.espacio, 'memoria', 'MEMORIA.md');
const leerMemoria = () => { try { return fs.readFileSync(ARCHIVO_MEMORIA(), 'utf8'); } catch { return ''; } };
const datosEnMemoria = () => leerMemoria().split('\n').filter((l) => /^\s*-\s+\S/.test(l)).length;

// ---- Motores de tareas (la "mano" del asistente) ---------------------------------------------
// Igual que el asistente de referencia: cada tarea es una IA de línea de comandos corriendo
// en segundo plano en la carpeta "espacio". Si un motor llega al límite de su plan, la tarea
// sigue en el siguiente de la lista (MOTORES).
const SIN_CUOTA = {
    claude: /usage limit|limit reached|hit your (usage )?limit|out of (extra )?usage|rate.?limit|\b429\b|overloaded|credit balance/i,
    codex: /usage limit|limit reached|hit your (usage )?limit|rate.?limit|\b429\b|quota|too many requests/i,
    gemini: /quota|RESOURCE_EXHAUSTED|rate.?limit|\b429\b|too many requests|usage limit/i,
};
const NOMBRE_MOTOR = { claude: 'Claude Code', codex: 'Codex (ChatGPT)', gemini: 'Gemini CLI' };
const sinCuotaHasta = {};
const motoresInfo = {}; // motor -> { ruta, version }

function buscarEnPath(nombre) {
    const extensiones = WINDOWS ? ['.exe', '.cmd', '.bat', ''] : [''];
    const carpetas = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
    // Lugares donde los instaladores oficiales dejan el programa aunque no esté en el PATH del servicio.
    const extra = WINDOWS
        ? [path.join(os.homedir(), '.local', 'bin'), path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links')]
        : [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
    for (const dir of [...carpetas, ...extra]) {
        for (const ext of extensiones) {
            const ruta = path.join(dir, nombre + ext);
            try { if (fs.statSync(ruta).isFile()) return ruta; } catch {}
        }
    }
    if (WINDOWS && nombre === 'claude') {
        // winget instala Claude Code en una carpeta de paquetes sin enlace en algunos equipos.
        const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
        try {
            for (const d of fs.readdirSync(base)) if (/^Anthropic\.ClaudeCode/i.test(d)) { const r = path.join(base, d, 'claude.exe'); if (fs.existsSync(r)) return r; }
        } catch {}
    }
    return null;
}
// En Windows, los .cmd (instalados con npm) necesitan pasar por cmd.exe.
function lanzar(ruta, args, opciones) {
    if (WINDOWS && /\.(cmd|bat)$/i.test(ruta)) {
        const q = (a) => `"${String(a).replace(/"/g, '""')}"`;
        return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[q(ruta), ...args.map(q)].join(' ')}"`], { ...opciones, windowsVerbatimArguments: true });
    }
    return spawn(ruta, args, opciones);
}
async function detectarMotores() {
    for (const m of ['claude', 'codex', 'gemini']) {
        const ruta = buscarEnPath(m);
        if (!ruta) { delete motoresInfo[m]; continue; }
        const version = await new Promise((ok) => {
            const p = lanzar(ruta, ['--version'], { windowsHide: true });
            let out = '';
            p.stdout?.on('data', (d) => { out += d; });
            p.on('error', () => ok(''));
            p.on('close', () => ok(out.trim().split('\n')[0].slice(0, 60)));
            setTimeout(() => { try { p.kill(); } catch {} ok(out.trim()); }, 15000);
        });
        motoresInfo[m] = { ruta, version };
    }
}
const motoresDisponibles = () => CFG.motores.filter((m) => motoresInfo[m]);

// Herramientas que una tarea de Claude Code puede usar sin pedir permiso. Lo irreversible
// lo bloquean las reglas del espacio (la tarea se detiene con NECESITO_TU_OK) y esta lista.
const PERMITIDAS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite', 'Task', 'Skill', ...(CFG.permitirComandos ? ['Bash'] : [])];
const PROHIBIDAS = ['Bash(rm -rf:*)', 'Bash(sudo:*)', 'Bash(git push --force:*)', 'Bash(git push -f:*)', 'Bash(shutdown:*)', 'Bash(reboot:*)', 'Bash(mkfs:*)', 'Bash(dd:*)', 'Bash(format:*)', 'Bash(del /s:*)', 'Bash(rd /s:*)', 'Bash(Remove-Item -Recurse:*)'];

function argumentosMotor(motor, tarea, archivoSalida) {
    if (motor === 'claude') {
        // Complemento Conexiones: con su habilidad instalada, las tareas pueden usar los conectores
        // de Google (Calendar, Gmail, Drive) que la persona conectó en claude.ai.
        const conexiones = fs.existsSync(path.join(DIR_SKILLS(), 'conexiones-google', 'SKILL.md'))
            ? ['mcp__claude_ai_Google_Calendar', 'mcp__claude_ai_Gmail', 'mcp__claude_ai_Google_Drive'] : [];
        const a = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
            '--allowedTools', [...PERMITIDAS, ...conexiones].join(','), '--disallowedTools', PROHIBIDAS.join(',')];
        if (CFG.modeloClaude) a.push('--model', CFG.modeloClaude);
        if (tarea.sesion && tarea.motor === 'claude') a.push('--resume', tarea.sesion);
        return a;
    }
    if (motor === 'codex') {
        const a = ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-o', archivoSalida];
        if (CFG.modeloCodex) a.push('-m', CFG.modeloCodex);
        a.push('-');
        return a;
    }
    // gemini: el texto de la tarea llega por la entrada estándar y -p agrega la orden final.
    return [...(CFG.modeloGemini ? ['-m', CFG.modeloGemini] : []), '--approval-mode', CFG.permitirComandos ? 'yolo' : 'auto_edit', '-o', 'text', '-p', 'Haz la tarea descrita arriba.'];
}

function describirPaso(uso) {
    const e = uso.input || {};
    const corto = (s, n = 70) => String(s || '').replace(/\s+/g, ' ').slice(0, n);
    switch (uso.name) {
        case 'Read': return `Lee ${path.basename(e.file_path || '')}`;
        case 'Write': return `Escribe ${path.basename(e.file_path || '')}`;
        case 'Edit': return `Edita ${path.basename(e.file_path || '')}`;
        case 'WebSearch': return `Busca: ${corto(e.query)}`;
        case 'WebFetch': return `Lee la página ${corto(e.url, 60)}`;
        case 'Bash': return `Comando: ${corto(e.description || e.command)}`;
        case 'Glob': case 'Grep': return 'Busca en archivos';
        case 'Task': case 'Agent': return `Ayudante: ${corto(e.description)}`;
        case 'Skill': return `Usa la habilidad ${corto(e.skill || e.name)}`;
        case 'TodoWrite': return 'Organiza los pasos';
        default: return corto(uso.name, 40);
    }
}

// ---- Tareas ---------------------------------------------------------------------------------------
const DIR_TAREAS = path.join(DATOS, 'tareas');
fs.mkdirSync(DIR_TAREAS, { recursive: true, mode: 0o700 });
const tareas = new Map(); // id -> tarea
const procesos = new Map(); // id -> proceso
let ultimoId = 0;
for (const f of fs.readdirSync(DIR_TAREAS)) {
    const t = leerJson(path.join(DIR_TAREAS, f), null);
    if (!t?.id) continue;
    ultimoId = Math.max(ultimoId, t.id);
    if (['en_curso', 'en_cola'].includes(t.estado)) { t.estado = 'fallo'; t.resultado = 'El servidor de Jarvis Voz se reinició mientras esta tarea corría. Pídela de nuevo.'; escribirJson(path.join(DIR_TAREAS, f), t); }
    if (Date.now() - new Date(t.creada).getTime() < 7 * 86400e3 && !t.archivada) tareas.set(t.id, t);
}
const guardarTarea = (t) => { t.actualizada = new Date().toISOString(); escribirJson(path.join(DIR_TAREAS, `${t.id}.json`), t); };
const ACTIVAS = ['en_cola', 'en_curso', 'esperando'];
function listarTareas(completo = false) {
    return [...tareas.values()].sort((a, b) => b.id - a.id).slice(0, 30).map((t) => ({
        id: t.id, titulo: t.titulo, estado: t.estado, especialista: t.especialista, motor: t.motor,
        creada: t.creada, actualizada: t.actualizada, terminada: t.terminada,
        pasos: (t.pasos || []).slice(completo ? -30 : -3),
        resumen: t.resumen || '', pregunta: t.pregunta || '',
        ...(completo ? { pedido: t.pedido, resultado: t.resultado } : { resultado: String(t.resultado || '').slice(0, 1200) }),
    }));
}
function resumenTareasParaVoz() {
    const activas = [...tareas.values()].filter((t) => ACTIVAS.includes(t.estado));
    const recientes = [...tareas.values()].filter((t) => !ACTIVAS.includes(t.estado)).sort((a, b) => b.id - a.id).slice(0, 4);
    return [...activas, ...recientes].map((t) => `- Tarea ${t.id} "${t.titulo}"${t.especialista ? ` (${t.especialista})` : ''}: ${t.estado}${t.resumen ? ` · ${t.resumen.slice(0, 160)}` : ''}`).join('\n');
}

// Misma tarea pedida dos veces seguidas: el asistente de referencia abría el mismo pedido hasta 8 veces.
const palabras = (s) => new Set(sinAcentos(s).match(/[a-z0-9]{4,}/g) || []);
function parecida(titulo, pedido) {
    const A = palabras(`${titulo} ${pedido}`);
    if (!A.size) return null;
    for (const t of tareas.values()) {
        const viva = ACTIVAS.includes(t.estado) || (t.terminada && Date.now() - new Date(t.terminada).getTime() < 3 * 60e3);
        if (!viva) continue;
        const B = palabras(`${t.titulo} ${t.pedidoCorto || ''}`);
        let n = 0;
        for (const w of A) if (B.has(w)) n++;
        if (B.size && n / Math.min(A.size, B.size) >= 0.6) return t;
    }
    return null;
}

const COMPATIBILIDAD = [
    'Notas para esta habilidad (fue escrita también para otro agente):',
    '- "~/jarvis/" y sus subcarpetas = la carpeta de trabajo actual. Guarda archivos en entregas/ salvo que la habilidad pida otra subcarpeta de aquí.',
    '- "memoria del Jarvis" = el archivo memoria/MEMORIA.md.',
    '- "delegate_task" = tus subagentes (herramienta Task), si tu entorno los tiene; si no, haz el trabajo por partes tú mismo.',
    '- "el dueño" = el usuario. No le hablas directamente: tu respuesta final se le entrega.',
].join('\n');

function armarPrompt(t) {
    const esp = t.skill ? equipo().find((e) => e.skill === t.skill && e.instalado) : null;
    let habilidad = '';
    if (esp) {
        const { cuerpo } = leerFrontmatter(fs.readFileSync(path.join(esp.carpeta, 'SKILL.md'), 'utf8'));
        const refs = path.join(esp.carpeta, 'references');
        const listaRefs = fs.existsSync(refs) ? fs.readdirSync(refs).map((f) => `- ${path.relative(CFG.espacio, path.join(refs, f))}`).join('\n') : '';
        habilidad = `\n\n=== HABILIDAD DE ${esp.nombre.toUpperCase()} (${esp.rol}) — síguela al pie de la letra ===\n${cuerpo}\n${listaRefs ? `\nArchivos de referencia de esta habilidad (léelos cuando la habilidad lo indique):\n${listaRefs}\n` : ''}\n${COMPATIBILIDAD}\n=== FIN DE LA HABILIDAD ===`;
    }
    return [
        `Eres ${CFG.nombre}, el asistente personal${CFG.usuario ? ` de ${CFG.usuario}` : ''}, trabajando en segundo plano en su computadora. Fecha y hora: ${new Date().toLocaleString('es', { timeZone: CFG.zona, dateStyle: 'full', timeStyle: 'short' })} (${CFG.zona}).`,
        esp ? `En esta tarea trabajas como ${esp.nombre}, ${esp.rol.toLowerCase()} del equipo.` : '',
        'Sigue las reglas de la carpeta de trabajo (CLAUDE.md / AGENTS.md / GEMINI.md).',
        `\nTAREA ${t.id}: ${t.titulo}\nPEDIDO: ${t.pedido}`,
        t.transcripcion ? `\nTRANSCRIPCIÓN LITERAL de lo que dijo el usuario (si un número, nombre o enlace del pedido no coincide con esto, vale esto; si hay duda real, pregunta con NECESITO_TU_OK):\n"${t.transcripcion}"` : '',
        habilidad,
        '\nFORMATO DE LA RESPUESTA FINAL (obligatorio):',
        '1) Primera línea: "RESUMEN: " + 1 o 2 frases cortas que se leerán en voz alta (números exactos, sin enlaces).',
        '2) Después, el resultado completo, listo para usar. Si creaste archivos, di solo la ruta relativa (ej.: entregas/2026-11-20-anuncios.md), sin la ruta completa de la computadora.',
        '3) Si necesitas una decisión, un dato que falta o una autorización para algo irreversible (borrar, pagar, publicar, enviar, instalar), NO lo hagas: termina con una línea "NECESITO_TU_OK: <pregunta concreta>".',
        '4) Nunca inventes resultados, cifras, testimonios ni fuentes. Si algo no se pudo, dilo.',
    ].filter(Boolean).join('\n');
}

let avisarEvento = () => {};
function crearTarea({ titulo, pedido, especialista, transcripcion }) {
    const esp = especialista ? buscarEspecialista(especialista) : null;
    const t = {
        id: ++ultimoId,
        titulo: String(titulo || 'Tarea').slice(0, 80),
        pedido: String(pedido || '').trim(),
        pedidoCorto: String(pedido || '').trim().slice(0, 400),
        transcripcion: String(transcripcion || '').slice(0, 2500),
        especialista: esp?.instalado ? esp.nombre : null,
        skill: esp?.instalado ? esp.skill : null,
        pidioEspecialista: especialista ? (esp?.nombre || especialista) : null,
        estado: 'en_cola',
        creada: new Date().toISOString(),
        pasos: [],
        motor: null,
        sesion: null,
    };
    tareas.set(t.id, t);
    guardarTarea(t);
    log(`tarea ${t.id} creada${t.especialista ? ` para ${t.especialista}` : ''}: ${t.titulo}`);
    siguienteEnCola();
    return t;
}
function siguienteEnCola() {
    for (const t of [...tareas.values()].filter((x) => x.estado === 'en_cola').sort((a, b) => a.id - b.id)) {
        if (procesos.size >= CFG.simultaneas) { avisarEvento(t); return; }
        correr(t, armarPrompt(t));
    }
}
function correr(t, prompt, motoresProbados = []) {
    const motor = motoresDisponibles().find((m) => !motoresProbados.includes(m) && (sinCuotaHasta[m] || 0) < Date.now());
    if (!motor) {
        t.estado = 'fallo';
        t.resultado = motoresDisponibles().length
            ? 'Todos los motores de tareas están sin cupo ahora. Prueba más tarde.'
            : 'No hay ningún motor de tareas instalado (Claude Code, Codex o Gemini CLI). Corre el instalador de nuevo.';
        t.terminada = new Date().toISOString();
        guardarTarea(t);
        avisarEvento(t, true);
        return;
    }
    const archivoSalida = path.join(DATOS, `salida-${t.id}.txt`);
    t.estado = 'en_curso';
    if (t.motor && t.motor !== motor) t.pasos.push(`${NOMBRE_MOTOR[t.motor]} sin cupo: sigue en ${NOMBRE_MOTOR[motor]}`);
    t.motor = motor;
    t.inicio = t.inicio || new Date().toISOString();
    guardarTarea(t);
    avisarEvento(t);
    const proc = lanzar(motoresInfo[motor].ruta, argumentosMotor(motor, t, archivoSalida), {
        cwd: CFG.espacio, windowsHide: true, detached: !WINDOWS,
        // Gemini CLI solo corre sin preguntar en carpetas marcadas como confiables.
        env: {
            ...process.env,
            // El Node que corre Jarvis Voz (puede ser el portátil de la carpeta) también para las tareas.
            PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`,
            JARVIS_VOZ_TAREA: String(t.id),
            // Claves de complementos guardadas en .env (p. ej. Publicaciones automáticas).
            ...Object.fromEntries(Object.entries(env).filter(([k, v]) => /^ZERNIO_/.test(k) && v)),
            ...(motor === 'gemini' ? { GEMINI_CLI_TRUST_WORKSPACE: 'true' } : {}),
        },
    });
    procesos.set(t.id, proc);
    proc.stdin.on('error', () => {});
    proc.stdin.end(prompt);
    let salida = '';
    let errores = '';
    let final = null;
    let buffer = '';
    proc.stdout.on('data', (d) => {
        const txt = d.toString();
        if (motor !== 'claude') { salida += txt; return; }
        buffer += txt;
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
            const linea = buffer.slice(0, i).trim();
            buffer = buffer.slice(i + 1);
            if (!linea) continue;
            let ev;
            try { ev = JSON.parse(linea); } catch { continue; }
            if (ev.session_id) t.sesion = ev.session_id;
            if (ev.type === 'assistant') {
                for (const c of ev.message?.content || []) if (c.type === 'tool_use') t.pasos.push(describirPaso(c));
                t.pasos = t.pasos.slice(-40);
                avisarEvento(t);
            }
            if (ev.type === 'result') final = ev;
        }
    });
    proc.stderr.on('data', (d) => { errores = (errores + d.toString()).slice(-4000); });
    const reloj = setTimeout(() => { t.pasos.push(`Pasó el límite de ${CFG.tareaMaxMin} min: detenida`); t.porTiempo = true; matar(proc); }, CFG.tareaMaxMin * 60e3);
    proc.on('error', (e) => { errores += `\n${e.message}`; });
    proc.on('close', (codigo) => {
        clearTimeout(reloj);
        procesos.delete(t.id);
        if (t.estado === 'cancelada') { guardarTarea(t); avisarEvento(t, true); return siguienteEnCola(); }
        let texto = motor === 'claude' ? String(final?.result || '') : motor === 'codex' ? (fs.existsSync(archivoSalida) ? fs.readFileSync(archivoSalida, 'utf8') : salida) : salida;
        try { fs.rmSync(archivoSalida, { force: true }); } catch {}
        texto = texto.trim();
        const fallo = (motor === 'claude' ? !final || final.is_error : codigo !== 0) || !texto;
        if (fallo && SIN_CUOTA[motor].test(`${texto}\n${errores}`)) {
            sinCuotaHasta[motor] = Date.now() + 60 * 60e3;
            log(`motor ${motor} sin cupo; tarea ${t.id} pasa al siguiente`);
            t.sesion = null;
            return correr(t, prompt, [...motoresProbados, motor]);
        }
        t.terminada = new Date().toISOString();
        if (fallo) {
            t.estado = 'fallo';
            t.resultado = t.porTiempo ? `La tarea pasó el límite de ${CFG.tareaMaxMin} minutos y se detuvo.` : (texto || errores.trim().split('\n').slice(-4).join(' ') || `El motor terminó con código ${codigo}.`).slice(0, 2000);
        } else {
            const pregunta = texto.match(/NECESITO_TU_OK:\s*(.+)/i);
            const resumen = texto.match(/^\s*\**RESUMEN:?\**:?\s*(.+)$/im);
            t.resumen = (resumen ? resumen[1] : texto.split('\n').find((l) => l.trim()) || '').replace(/[*_`#]/g, '').trim().slice(0, 400);
            t.resultado = texto.slice(0, 20000);
            t.estado = pregunta ? 'esperando' : 'hecha';
            t.pregunta = pregunta ? pregunta[1].trim().slice(0, 500) : '';
        }
        log(`tarea ${t.id} ${t.estado} (${motor})`);
        guardarTarea(t);
        avisarEvento(t, true);
        siguienteEnCola();
    });
}
function matar(proc) {
    try {
        if (WINDOWS) execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => {});
        else process.kill(-proc.pid, 'SIGTERM');
    } catch { try { proc.kill(); } catch {} }
}
function cancelarTarea(id) {
    const t = tareas.get(Number(id));
    if (!t || !ACTIVAS.includes(t.estado)) return false;
    t.estado = 'cancelada';
    t.terminada = new Date().toISOString();
    const p = procesos.get(t.id);
    if (p) matar(p); else { guardarTarea(t); avisarEvento(t, true); }
    return true;
}
function responderTarea(id, respuesta) {
    const t = tareas.get(Number(id));
    if (!t) return { ok: false, error: `La tarea ${id} no existe.` };
    if (t.estado !== 'esperando') return { ok: false, error: `La tarea ${t.id} ("${t.titulo}") está ${t.estado}, no esperando respuesta.` };
    t.pasos.push(`Respuesta del usuario: ${respuesta.slice(0, 120)}`);
    t.estado = 'en_cola';
    t.pregunta = '';
    guardarTarea(t);
    const prompt = t.motor === 'claude' && t.sesion
        ? `Respuesta del usuario a tu pregunta: "${respuesta}". Continúa la tarea ${t.id} con eso, con el mismo formato de respuesta final (RESUMEN: ...).`
        : `${armarPrompt(t)}\n\nLO QUE YA HICISTE ANTES (otra sesión):\n${String(t.resultado || '').slice(0, 6000)}\n\nRESPUESTA DEL USUARIO A TU PREGUNTA: "${respuesta}". Continúa desde ahí.`;
    if (!(t.motor === 'claude' && t.sesion)) t.sesion = null;
    if (procesos.size >= CFG.simultaneas) { t.promptPendiente = prompt; avisarEvento(t); return { ok: true, id: t.id, titulo: t.titulo, enCola: true }; }
    correr(t, prompt);
    return { ok: true, id: t.id, titulo: t.titulo };
}

// ---- Recordatorios ---------------------------------------------------------------------------
// "Recuérdame pagar la luz el día 5 a las 9": se guardan aquí y, a la hora, Jarvis avisa
// hablando (si la página está abierta) o en cuanto la abras.
const ARCHIVO_RECORDATORIOS = path.join(DATOS, 'recordatorios.json');
let recordatorios = leerJson(ARCHIVO_RECORDATORIOS, []);
const guardarRecordatorios = () => escribirJson(ARCHIVO_RECORDATORIOS, recordatorios);
// "2026-12-05T09:00" en la zona del usuario -> fecha real (sin librerías).
function localAFecha(texto) {
    const m = String(texto || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
    if (!m) return null;
    const [, a, me, d, h, mi] = m.map(Number);
    const supuesto = Date.UTC(a, me - 1, d, h, mi);
    const enZona = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: CFG.zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); };
    const desfase = enZona(supuesto) - supuesto;
    const fecha = new Date(supuesto - desfase);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
}
const fechaTexto = (iso) => new Date(iso).toLocaleString('es', { timeZone: CFG.zona, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const pendientesRecordatorios = () => recordatorios.filter((r) => !r.avisado).sort((a, b) => a.cuando.localeCompare(b.cuando));
function listaRecordatorios() { return pendientesRecordatorios().slice(0, 20).map((r) => ({ id: r.id, texto: r.texto, cuando: r.cuando, cuandoTexto: fechaTexto(r.cuando) })); }
setInterval(() => {
    let cambio = false;
    for (const r of recordatorios) {
        if (r.avisado || new Date(r.cuando).getTime() > Date.now()) continue;
        r.avisado = new Date().toISOString();
        cambio = true;
        log('recordatorio:', r.texto);
        difundir({ t: 'recordatorio', texto: r.texto });
        const aviso = `[AVISO DEL SISTEMA] Recordatorio programado para ahora: "${r.texto}". Díselo al usuario en una frase.`;
        if (conversacionActiva && !conversacionActiva.cerrada) conversacionActiva.hablarConGemini(aviso); else avisosPendientes.push(aviso);
    }
    if (cambio) { recordatorios = recordatorios.filter((r) => !r.avisado || Date.now() - new Date(r.avisado).getTime() < 7 * 86400e3); guardarRecordatorios(); difundir({ t: 'recordatorios', lista: listaRecordatorios() }); }
}, 15000).unref();

// ---- Estado del sistema (PC) -------------------------------------------------------------
let cpuAntes = os.cpus();
let cpuPct = 0;
setInterval(() => {
    const ahora = os.cpus();
    let ocupado = 0, total = 0;
    ahora.forEach((c, i) => {
        const a = cpuAntes[i]?.times || c.times;
        const d = Object.fromEntries(Object.keys(c.times).map((k) => [k, c.times[k] - a[k]]));
        const t = Object.values(d).reduce((x, y) => x + y, 0);
        total += t; ocupado += t - d.idle;
    });
    cpuAntes = ahora;
    cpuPct = total ? Math.round((ocupado / total) * 100) : 0;
}, 3000).unref();
function estadoSistema() {
    let disco = null;
    try { const s = fs.statfsSync(CFG.espacio); disco = Math.round((1 - s.bavail / s.blocks) * 100); } catch {}
    return {
        cpu: cpuPct,
        memoria: Math.round((1 - os.freemem() / os.totalmem()) * 100),
        disco,
        encendido: os.uptime(),
        so: `${{ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || process.platform}`,
        motores: Object.fromEntries(Object.entries(motoresInfo).map(([k, v]) => [k, v.version || 'instalado'])),
        orden: motoresDisponibles(),
        trabajando: procesos.size,
        memoriaDatos: datosEnMemoria(),
        servidorDesde: Math.round(process.uptime()),
    };
}

// ---- Voz (Gemini Live) --------------------------------------------------------------------
const URL_GEMINI = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
let modeloActual = CFG.modelo;
let enReservaDesde = 0;
// Gemini 3.1 Flash Live solo acepta funciones síncronas; los demás modelos Live, asíncronas.
const asincrona = () => !/3\.1-flash-live/.test(modeloActual);

function instrucciones() {
    const fecha = new Date().toLocaleString('es', { timeZone: CFG.zona, dateStyle: 'full', timeStyle: 'short' });
    const leer = (a) => { try { return fs.readFileSync(a, 'utf8'); } catch { return ''; } };
    const eq = equipo();
    const instalados = eq.filter((e) => e.instalado);
    const faltan = eq.filter((e) => !e.instalado);
    return [
        leer(path.join(CFG.espacio, 'persona', 'PERSONA.md')).replaceAll('{ASISTENTE}', CFG.nombre).replaceAll('{USUARIO}', CFG.usuario || 'el usuario'),
        `## Ahora\n${fecha} (zona ${CFG.zona}). Para la hora exacta en cualquier momento usa que_hora_es.`,
        '## Tu equipo',
        instalados.length ? `Instalados: ${instalados.map((e) => `${e.nombre} (${e.rol})`).join(', ')}. Cuando el usuario le hable a uno de ellos ("Mateo, escribe…") o pida algo de su área, usa encargar_tarea con especialista = su nombre.` : 'Todavía no hay especialistas instalados.',
        faltan.length ? `No instalados (complementos): ${faltan.map((e) => `${e.nombre} (${e.rol})`).join(', ')}. Si el usuario le habla a uno de ellos, encarga la tarea igual (especialista = su nombre): la harás tú mismo, y avisa en una frase que ${faltan.length > 1 ? 'esos especialistas son complementos' : 'ese especialista es un complemento'} que se puede agregar.` : '',
        fs.existsSync(path.join(DIR_SKILLS(), 'conexiones-google', 'SKILL.md'))
            ? '## Conexiones (complemento instalado)\nLas tareas pueden leer y crear eventos en Google Calendar, leer correos y crear borradores en Gmail, y buscar archivos en Google Drive (con la cuenta Google que el usuario conectó en claude.ai). Para agenda, correo o Drive usa encargar_tarea. Enviar un correo o invitar a otras personas: solo después de que el usuario confirme el texto exacto.'
            : 'No tienes acceso a la agenda, al correo ni a Google Drive del usuario (eso es el complemento Conexiones). Si te lo piden, dilo en una frase; puedes ofrecer un recordatorio.',
        '## Lo que el usuario te pidió recordar (memoria)',
        leer(ARCHIVO_MEMORIA()).slice(-4000) || '(vacío)',
        '## Recordatorios pendientes',
        listaRecordatorios().slice(0, 10).map((r) => `- ${r.id}: ${r.texto} · ${r.cuandoTexto}`).join('\n') || 'Ninguno.',
        '## Tareas en curso o recientes',
        resumenTareasParaVoz() || 'Ninguna.',
    ].filter(Boolean).join('\n\n');
}

function funciones() {
    const nb = asincrona() ? { behavior: 'NON_BLOCKING' } : {};
    return [
        {
            name: 'encargar_tarea',
            description: 'Crea una TAREA de verdad que corre en segundo plano en la computadora (investigar en internet, escribir textos, crear o leer archivos, programar, analizar datos). Úsala para todo lo que no sea solo conversar. Vuelve al instante con el número de la tarea; el resultado llega después como aviso del sistema.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    pedido: { type: 'STRING', description: 'Lo que el usuario pidió, con SUS palabras. Números, nombres, montos y enlaces copiados exactamente. No agregues nada que no pidió. Si falta un dato esencial, pregúntalo antes.' },
                    titulo: { type: 'STRING', description: 'Título corto de la tarea, hasta 6 palabras.' },
                    especialista: { type: 'STRING', description: 'Nombre del especialista si el usuario le habló a uno o el pedido es de su área (Valentina, Mateo, Leo, Sofía, Lucas, Camila, Diego, Paula). Vacío = la haces tú.' },
                    mesmo_asi: { type: 'BOOLEAN', description: 'Solo true si la llamada fue rechazada como repetida Y el usuario pidió algo DIFERENTE.' },
                },
                required: ['pedido', 'titulo'],
            },
        },
        {
            name: 'responder_tarea',
            description: 'Continúa una tarea que se detuvo esperando una decisión o autorización del usuario. Pasa la respuesta del usuario con sus palabras.',
            parameters: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, respuesta: { type: 'STRING' } }, required: ['id', 'respuesta'] },
        },
        {
            name: 'ver_tarea',
            description: 'Lee el resultado COMPLETO de una tarea y sus últimos pasos. Úsala siempre que el usuario pregunte un detalle (número, valor, texto) de una tarea; habla solo de lo que esté escrito aquí.',
            parameters: { type: 'OBJECT', properties: { id: { type: 'INTEGER' } }, required: ['id'] },
        },
        { name: 'listar_tareas', description: 'Lista las tareas recientes y su estado.', parameters: { type: 'OBJECT', properties: {} } },
        { name: 'cancelar_tarea', description: 'Detiene una tarea en curso.', parameters: { type: 'OBJECT', properties: { id: { type: 'INTEGER' } }, required: ['id'] } },
        {
            name: 'recordar',
            description: 'Guarda para siempre un dato, preferencia o decisión del usuario (vale para las próximas conversaciones y para las tareas). Nunca guardes contraseñas, tokens ni claves.',
            parameters: { type: 'OBJECT', properties: { dato: { type: 'STRING' } }, required: ['dato'] },
        },
        {
            name: 'ver_conversacion',
            description: 'Lee lo que se HABLÓ de verdad con el usuario (guardado por día). Úsala antes de decir "me pediste", "dijiste" o "quedamos". Sin término: lo último del día.',
            parameters: { type: 'OBJECT', properties: { fecha: { type: 'STRING', description: 'AAAA-MM-DD; vacío = hoy' }, termino: { type: 'STRING' } } },
        },
        {
            name: 'abrir_en_navegador',
            description: 'Abre un sitio o enlace en el navegador de la computadora del usuario, en una pestaña nueva. Solo abre; para trabajar en el sitio usa encargar_tarea.',
            parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' } }, required: ['url'] },
        },
        { name: 'que_hora_es', description: 'Fecha y hora exactas del usuario.', parameters: { type: 'OBJECT', properties: {} } },
        {
            name: 'crear_recordatorio',
            description: 'Programa un recordatorio: a la hora indicada, tú se lo dices al usuario en voz alta (si la página está cerrada, en cuanto la abra). Calcula la fecha con que_hora_es si dice "mañana", "el viernes", "el día 5". Si no dijo la hora, pregúntala.',
            parameters: { type: 'OBJECT', properties: { texto: { type: 'STRING', description: 'Qué recordar, con las palabras del usuario.' }, fecha_hora: { type: 'STRING', description: 'AAAA-MM-DDTHH:MM en la hora local del usuario.' } }, required: ['texto', 'fecha_hora'] },
        },
        { name: 'ver_recordatorios', description: 'Lista los recordatorios pendientes (lo que el usuario tiene programado). Úsala cuando pregunte qué tiene hoy, mañana o pendiente.', parameters: { type: 'OBJECT', properties: {} } },
        { name: 'borrar_recordatorio', description: 'Borra un recordatorio pendiente.', parameters: { type: 'OBJECT', properties: { id: { type: 'INTEGER' } }, required: ['id'] } },
    ].map((f) => (['encargar_tarea', 'responder_tarea', 'cancelar_tarea'].includes(f.name) ? f : { ...f, ...nb }));
}

function abrirUrl(url) {
    if (WINDOWS) execFile('cmd.exe', ['/c', 'start', '""', url.replace(/&/g, '^&')], { windowsHide: true }, () => {});
    else if (process.platform === 'darwin') execFile('open', [url], () => {});
    else if (fs.existsSync('/proc/version') && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'))) execFile('/mnt/c/Windows/System32/cmd.exe', ['/c', 'start', '""', url.replace(/&/g, '^&')], { cwd: '/mnt/c' }, () => {});
    else execFile('xdg-open', [url], () => {});
}

const avisosPendientes = []; // avisos de tareas que llegaron sin ninguna página abierta

async function ejecutarFuncion(nombre, args, conv) {
    switch (nombre) {
        case 'que_hora_es':
            return { ahora: new Date().toLocaleString('es', { timeZone: CFG.zona, dateStyle: 'full', timeStyle: 'short' }), zona: CFG.zona };
        case 'crear_recordatorio': {
            const fecha = localAFecha(args.fecha_hora);
            const texto = String(args.texto || '').trim();
            if (!texto || !fecha) return { ok: false, error: 'Falta el texto o la fecha_hora (AAAA-MM-DDTHH:MM).' };
            if (fecha.getTime() < Date.now() - 60e3) return { ok: false, error: `Esa hora ya pasó (${fechaTexto(fecha.toISOString())}). Pregunta al usuario.` };
            const r = { id: (recordatorios.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1, texto, cuando: fecha.toISOString(), creado: new Date().toISOString() };
            recordatorios.push(r);
            guardarRecordatorios();
            difundir({ t: 'recordatorios', lista: listaRecordatorios() });
            return { ok: true, id: r.id, cuando: fechaTexto(r.cuando), aviso: 'Confirma en una frase con el día y la hora exactos de "cuando".' };
        }
        case 'ver_recordatorios':
            return { recordatorios: listaRecordatorios().map((r) => ({ id: r.id, texto: r.texto, cuando: r.cuandoTexto })), ahora: new Date().toLocaleString('es', { timeZone: CFG.zona, dateStyle: 'full', timeStyle: 'short' }) };
        case 'borrar_recordatorio': {
            const antes = recordatorios.length;
            recordatorios = recordatorios.filter((r) => r.id !== Number(args.id) || r.avisado);
            guardarRecordatorios();
            difundir({ t: 'recordatorios', lista: listaRecordatorios() });
            return { ok: recordatorios.length < antes };
        }
        case 'encargar_tarea': {
            const pedido = String(args.pedido || '').trim();
            if (!pedido) return { ok: false, error: 'pedido vacío' };
            if (!motoresDisponibles().length) return { ok: false, error: 'No hay motor de tareas instalado (Claude Code, Codex o Gemini CLI). Díselo al usuario en una frase.' };
            const liberada = args.mesmo_asi && Date.now() - (conv.rechazoRepetidaEn || 0) < 3 * 60e3;
            const igual = !liberada && parecida(args.titulo, pedido);
            if (igual) {
                conv.rechazoRepetidaEn = Date.now();
                return {
                    ok: false, repetida: true, id: igual.id, estado: igual.estado,
                    error: igual.estado === 'esperando' ? `La tarea ${igual.id} sobre esto espera al usuario: usa responder_tarea.`
                        : igual.estado === 'hecha' ? `La tarea ${igual.id} sobre esto acaba de terminar: cuenta su resultado (ver_tarea). Solo si pidió algo DIFERENTE, llama de nuevo con mesmo_asi=true.`
                        : `La tarea ${igual.id} sobre esto ya está en curso: no abras otra; avisa al usuario. Solo si pidió algo DIFERENTE, llama de nuevo con mesmo_asi=true.`,
                };
            }
            const t = crearTarea({ titulo: args.titulo, pedido, especialista: args.especialista, transcripcion: conv.falaReciente() });
            const nota = t.pidioEspecialista && !t.especialista
                ? `${t.pidioEspecialista} no está instalado en este equipo (es un complemento que se puede agregar). La tarea ${t.id} la hace ${CFG.nombre} mismo. Dilo en una frase.`
                : `Tarea ${t.id} creada${t.especialista ? ` para ${t.especialista}` : ''}. Avisa en una frase y sigue la conversación; el resultado llega después.`;
            return { ok: true, id: t.id, especialista: t.especialista || CFG.nombre, aviso: nota };
        }
        case 'responder_tarea': {
            const respuesta = String(args.respuesta || '').trim();
            if (!respuesta) return { ok: false, error: 'falta la respuesta' };
            const r = responderTarea(args.id, respuesta);
            return r.ok ? { ok: true, aviso: `Di en una frase: "Le pasé tu respuesta a la tarea ${r.id}, ${r.titulo}".` } : { ok: false, error: `NO entregada: ${r.error} Díselo al usuario; no digas que lo vas a hacer.` };
        }
        case 'ver_tarea': {
            const t = tareas.get(Number(args.id)) || leerJson(path.join(DIR_TAREAS, `${Number(args.id)}.json`), null);
            if (!t) return { ok: false, error: `La tarea ${args.id} no existe. No inventes.` };
            return { id: t.id, titulo: t.titulo, estado: t.estado, especialista: t.especialista, resultado: String(t.resultado || '').slice(0, 6000), pregunta: t.pregunta || '', ultimosPasos: (t.pasos || []).slice(-8), aviso: 'Números y valores: di solo los que están escritos aquí, iguales.' };
        }
        case 'listar_tareas':
            return { tareas: listarTareas().map((t) => ({ id: t.id, titulo: t.titulo, estado: t.estado, especialista: t.especialista, resumen: t.resumen })) };
        case 'cancelar_tarea':
            return { ok: cancelarTarea(args.id) };
        case 'recordar': {
            const dato = String(args.dato || '').trim().replace(/\s+/g, ' ');
            if (!dato || /(contraseñ|password|token|api[_ -]?key|clave secreta)/i.test(dato)) return { ok: false, error: 'eso no lo guardo' };
            fs.appendFileSync(ARCHIVO_MEMORIA(), `- ${hoy()}: ${dato}\n`);
            difundir({ t: 'sistema', sistema: estadoSistema() });
            return { ok: true };
        }
        case 'ver_conversacion': {
            const dia = /^\d{4}-\d{2}-\d{2}$/.test(args.fecha || '') ? args.fecha : hoy();
            const termino = sinAcentos(args.termino || '');
            const lineas = conversacionDe(dia).map((l) => `[${l.h}] ${l.quien}: ${l.texto}`);
            const encontradas = termino ? lineas.filter((l) => sinAcentos(l).includes(termino)) : lineas;
            return { dia, conversacion: encontradas.join('\n').slice(-6000) || '(nada)', aviso: termino && !encontradas.length ? `El usuario NO habló de "${args.termino}" ese día. No inventes.` : undefined };
        }
        case 'abrir_en_navegador': {
            const url = String(args.url || '').trim();
            if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'la url tiene que empezar con http(s)://' };
            abrirUrl(url);
            log('abrió', url);
            return { ok: true };
        }
        default:
            return { ok: false, error: `función desconocida: ${nombre}` };
    }
}

// ---- Una conversación (una página abierta) ------------------------------------------------
let conversacionActiva = null;
const clientes = new Set(); // todas las páginas abiertas (paneles)
const difundir = (obj) => { const s = JSON.stringify(obj); for (const c of clientes) if (c.readyState === WebSocket.OPEN) c.send(s); };

class Conversacion {
    constructor(ws) {
        this.ws = ws;
        this.live = null;
        this.listo = false;
        this.n = 0;
        this.handle = null;
        this.handleEn = 0;
        this.pausada = true;
        this.cerrada = false;
        this.ultimaActividad = Date.now();
        this.guardados = [];
        this.turnoUsuario = '';
        this.turnoCerrado = true;
        this.bufUsuario = '';
        this.bufVoz = '';
        this.falas = []; // transcripción literal de los últimos 3 minutos
        this.reloj = setInterval(() => this.tic(), 1000);
        if (CFG.grabarAudio) this.grabacion = { t0: Date.now(), entrada: [], salida: [], salidaMuestras: 0 };
    }
    enviar(obj) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj)); }
    estado() { this.enviar({ t: 'estado', conectado: this.listo, pausada: this.pausada, modelo: modeloActual, uso: resumenUso() }); }
    falaReciente() {
        const ahora = Date.now();
        this.falas = this.falas.filter((f) => ahora - f.en < 3 * 60e3);
        return this.falas.map((f) => f.texto).join('').replace(/\s+/g, ' ').trim();
    }
    tic() {
        if (!this.live || this.pausada) return;
        const u = usoDeHoy();
        u.segundos += 1;
        usoSucio = true;
        if (u.segundos % 10 === 0) this.enviar({ t: 'uso', uso: resumenUso() });
        if (u.segundos >= limiteSeg()) return this.pausar('limite');
        if (CFG.pausaSeg > 0 && (Date.now() - this.ultimaActividad) / 1000 > CFG.pausaSeg) this.pausar('inactividad');
    }
    iniciar() {
        if (usoDeHoy().segundos >= limiteSeg()) {
            this.enviar({ t: 'aviso', tipo: 'limite', texto: `Llegaste al límite de ${CFG.minutosDia} minutos de voz de hoy (MINUTOS_POR_DIA en el archivo .env).` });
            return this.estado();
        }
        this.pausada = false;
        this.ultimaActividad = Date.now();
        if (!this.live) this.conectar();
        this.estado();
        if (avisosPendientes.length) { const a = avisosPendientes.splice(0); for (const x of a) this.hablarConGemini(x); }
    }
    pausar(motivo) {
        if (this.pausada) return;
        this.pausada = true;
        log('pausa:', motivo);
        const textos = { inactividad: 'En pausa para no gastar: nadie habló en un rato. Haz clic en el micrófono para seguir.', limite: `Llegaste al límite de ${CFG.minutosDia} minutos de voz de hoy.`, usuario: 'En pausa.' };
        this.enviar({ t: 'aviso', tipo: motivo, texto: textos[motivo] || 'En pausa.' });
        this.cerrarLive();
        this.estado();
    }
    cerrarLive() { const l = this.live; this.live = null; this.listo = false; try { l?.close(); } catch {} }
    conectar() {
        if (this.live || this.cerrada) return;
        if (!CFG.geminiKey) { this.enviar({ t: 'aviso', tipo: 'error', texto: 'Falta GEMINI_API_KEY en el archivo .env. Corre el instalador de nuevo.' }); this.pausada = true; return this.estado(); }
        if (modeloActual !== CFG.modelo && Date.now() - enReservaDesde > 30 * 60e3) { modeloActual = CFG.modelo; this.handle = null; }
        if (this.handle && Date.now() - this.handleEn > 90 * 60e3) this.handle = null;
        const n = ++this.n;
        const live = new WebSocket(`${URL_GEMINI}?key=${encodeURIComponent(CFG.geminiKey)}`);
        this.live = live;
        this.listo = false;
        this.enviar({ t: 'conectando' });
        live.on('open', () => {
            live.send(JSON.stringify({
                setup: {
                    model: `models/${modeloActual}`,
                    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: CFG.voz } }, languageCode: CFG.idiomaVoz } },
                    systemInstruction: { parts: [{ text: instrucciones() }] },
                    tools: [{ functionDeclarations: funciones() }],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    // Menos sensible al ruido de fondo (música, TV): con el valor por defecto, el ruido cortaba la voz.
                    realtimeInputConfig: { automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_LOW', prefixPaddingMs: 200, silenceDurationMs: 700 } },
                    // Sin esto Google corta la sesión de audio a los 15 minutos.
                    contextWindowCompression: { slidingWindow: {} },
                    sessionResumption: this.handle ? { handle: this.handle } : {},
                },
            }));
        });
        live.on('message', (d) => {
            if (n !== this.n) return;
            let m;
            try { m = JSON.parse(d.toString()); } catch { return; }
            this.mensaje(m).catch((e) => log('error en mensaje de Gemini:', e.message));
        });
        live.on('close', (codigo, razon) => {
            if (n !== this.n) return;
            const r = String(razon || '');
            log('gemini cerró', codigo, r.slice(0, 200));
            this.live = null;
            this.listo = false;
            if (/expired|invalid|handle|resum/i.test(r)) this.handle = null;
            if (/quota|exhausted|billing|RESOURCE_EXHAUSTED/i.test(r)) {
                if (modeloActual !== CFG.modeloReserva && CFG.modeloReserva) {
                    modeloActual = CFG.modeloReserva; enReservaDesde = Date.now(); this.handle = null;
                    this.enviar({ t: 'aviso', tipo: 'info', texto: `Se acabó la cuota del modelo de voz principal; sigo con ${modeloActual}.` });
                } else {
                    this.pausada = true;
                    this.enviar({ t: 'aviso', tipo: 'error', texto: 'Tu clave de Gemini se quedó sin cuota. Revisa la facturación y los límites en Google AI Studio.' });
                }
            } else if (codigo === 1007 || (codigo === 1008 && /API key|permission|not found|not supported/i.test(r))) {
                this.pausada = true;
                this.enviar({ t: 'aviso', tipo: 'error', texto: `Gemini rechazó la conexión: ${r.slice(0, 160)}` });
            }
            this.estado();
            if (!this.cerrada && !this.pausada) setTimeout(() => this.conectar(), 700);
        });
        live.on('error', (e) => log('error gemini', e.message));
    }
    async mensaje(m) {
        if (m.setupComplete) {
            this.listo = true;
            log('voz conectada', modeloActual, this.handle ? '(reanudada)' : '');
            this.estado();
            const p = this.guardados.splice(0);
            for (const x of p) this.hablarConGemini(x);
            return;
        }
        if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) { this.handle = m.sessionResumptionUpdate.newHandle; this.handleEn = Date.now(); }
        if (m.goAway) {
            log('goAway: reconectando con reanudación');
            const l = this.live; this.live = null; this.listo = false;
            try { l?.close(); } catch {}
            if (!this.pausada) setTimeout(() => this.conectar(), 300);
            return;
        }
        if (m.usageMetadata) sumarTokens(m.usageMetadata);
        const sc = m.serverContent;
        if (sc) {
            for (const parte of sc.modelTurn?.parts || []) {
                if (parte.inlineData?.data && this.ws.readyState === WebSocket.OPEN) {
                    const pcm = Buffer.from(parte.inlineData.data, 'base64');
                    this.ultimaActividad = Date.now();
                    this.ws.send(pcm);
                    if (this.grabacion) this.grabarSalida(pcm);
                }
            }
            if (sc.interrupted) { this.enviar({ t: 'interrumpido' }); this.cerrarVoz(); if (this.grabacion) this.cortarSalida(); }
            if (sc.inputTranscription?.text) {
                const tx = sc.inputTranscription.text;
                this.ultimaActividad = Date.now();
                if (this.bufVoz) this.cerrarVoz();
                this.bufUsuario += tx;
                this.falas.push({ en: Date.now(), texto: tx });
                this.enviar({ t: 'usuario', texto: tx });
            }
            if (sc.outputTranscription?.text) {
                if (this.bufUsuario) this.cerrarUsuario();
                this.bufVoz += sc.outputTranscription.text;
                this.enviar({ t: 'asistente', texto: sc.outputTranscription.text });
            }
            if (sc.turnComplete) { this.cerrarUsuario(); this.cerrarVoz(); this.enviar({ t: 'fin_turno' }); }
        }
        if (m.toolCall?.functionCalls?.length) {
            for (const llamada of m.toolCall.functionCalls) this.funcion(llamada);
        }
    }
    cerrarUsuario() { if (this.bufUsuario.trim()) anotar('Tú', this.bufUsuario); this.bufUsuario = ''; }
    cerrarVoz() { if (this.bufVoz.trim()) anotar(CFG.nombre, this.bufVoz); this.bufVoz = ''; }
    async funcion({ id, name, args = {} }) {
        log('función', name, JSON.stringify(args).slice(0, 300));
        this.ultimaActividad = Date.now();
        this.enviar({ t: 'funcion', nombre: name, args });
        let respuesta;
        try { respuesta = await ejecutarFuncion(name, args, this); } catch (e) { respuesta = { ok: false, error: String(e.message || e) }; }
        if (this.live && this.listo) {
            const extra = asincrona() && !['encargar_tarea', 'responder_tarea', 'cancelar_tarea'].includes(name) ? { scheduling: 'INTERRUPT' } : {};
            this.live.send(JSON.stringify({ toolResponse: { functionResponses: [{ id, name, response: { ...respuesta, ...extra } }] } }));
        }
    }
    // Texto que no se puede perder: sin conexión se guarda y se manda al reconectar.
    hablarConGemini(texto) {
        if (this.live && this.listo) {
            this.live.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: texto }] }], turnComplete: true } }));
        } else {
            this.guardados.push(texto);
            if (this.pausada && CFG.avisarPorVoz && usoDeHoy().segundos < limiteSeg()) { this.pausada = false; this.ultimaActividad = Date.now(); this.conectar(); this.estado(); }
        }
    }
    audio(pcm) {
        if (this.pausada || !this.live || !this.listo) return;
        if (pcm.length % 2) pcm = pcm.subarray(0, pcm.length - 1);
        this.live.send(JSON.stringify({ realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }));
        if (this.grabacion) this.grabacion.entrada.push({ t: Date.now(), pcm: Buffer.from(pcm) });
    }
    comando(msg) {
        if (msg.t === 'iniciar') this.iniciar();
        else if (msg.t === 'pausar') this.pausar('usuario');
        else if (msg.t === 'actividad') this.ultimaActividad = Date.now();
        else if (msg.t === 'texto' && msg.texto) {
            const texto = String(msg.texto).slice(0, 2000);
            this.ultimaActividad = Date.now();
            this.falas.push({ en: Date.now(), texto: ` ${texto}` });
            anotar('Tú (escrito)', texto);
            if (this.pausada) this.iniciar();
            this.hablarConGemini(texto);
        }
    }
    // ---- Grabación de diagnóstico (GRABAR_AUDIO=si): datos/grabaciones/*.wav
    grabarSalida(pcm) {
        const g = this.grabacion;
        const enReloj = Math.round(((Date.now() - g.t0) / 1000) * 24000);
        if (g.salidaMuestras < enReloj) { g.salida.push(Buffer.alloc((enReloj - g.salidaMuestras) * 2)); g.salidaMuestras = enReloj; }
        g.salida.push(pcm);
        g.salidaMuestras += pcm.length / 2;
    }
    cortarSalida() {
        const g = this.grabacion;
        const enReloj = Math.round(((Date.now() - g.t0) / 1000) * 24000);
        if (g.salidaMuestras <= enReloj) return;
        g.salida = [Buffer.concat(g.salida).subarray(0, enReloj * 2)];
        g.salidaMuestras = enReloj;
    }
    guardarGrabacion() {
        const g = this.grabacion;
        if (!g || (!g.entrada.length && !g.salida.length)) return;
        const carpeta = path.join(DATOS, 'grabaciones');
        fs.mkdirSync(carpeta, { recursive: true, mode: 0o700 });
        const nombre = new Date(g.t0).toISOString().replace(/[:.]/g, '-');
        const entrada = [];
        let muestras = 0;
        for (const { t, pcm } of g.entrada) {
            const pos = Math.round(((t - g.t0) / 1000) * 16000) - pcm.length / 2;
            if (pos > muestras) { entrada.push(Buffer.alloc((pos - muestras) * 2)); muestras = pos; }
            entrada.push(pcm);
            muestras += pcm.length / 2;
        }
        const wav = (pcm, rate) => {
            const h = Buffer.alloc(44);
            h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
            h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
            return Buffer.concat([h, pcm]);
        };
        fs.writeFileSync(path.join(carpeta, `${nombre}-tu-voz.wav`), wav(Buffer.concat(entrada), 16000), { mode: 0o600 });
        fs.writeFileSync(path.join(carpeta, `${nombre}-asistente.wav`), wav(Buffer.concat(g.salida), 24000), { mode: 0o600 });
        fs.writeFileSync(path.join(carpeta, `${nombre}-inicio.txt`), String(g.t0));
    }
    cerrar() {
        this.cerrada = true;
        clearInterval(this.reloj);
        this.cerrarUsuario(); this.cerrarVoz();
        this.cerrarLive();
        if (this.grabacion) { try { this.guardarGrabacion(); } catch (e) { log('no pude guardar la grabación', e.message); } }
    }
}

// Cambios de una tarea: la pantalla siempre; la voz al terminar o cuando necesita al usuario.
avisarEvento = (t, fin = false) => {
    difundir({ t: 'tareas', lista: listarTareas() });
    difundir({ t: 'equipo', equipo: equipoParaPantalla() });
    if (!fin || !['hecha', 'fallo', 'esperando'].includes(t.estado)) return;
    const quien = t.especialista || CFG.nombre;
    const texto = t.estado === 'esperando'
        ? `[AVISO DEL SISTEMA] La tarea ${t.id} ("${t.titulo}", de ${quien}) se detuvo y necesita al usuario: ${t.pregunta}\nPregúntaselo de forma corta. Cuando responda, usa responder_tarea con id ${t.id}.`
        : t.estado === 'hecha'
        ? `[AVISO DEL SISTEMA] ${t.especialista ? `${t.especialista} terminó` : 'Terminaste (tú mismo)'} la tarea ${t.id} ("${t.titulo}"). Resumen: ${t.resumen}\nResultado completo (ya está en la pantalla):\n${String(t.resultado).slice(0, 3000)}\nCuéntaselo al usuario en 1 o 2 frases habladas${t.especialista ? `, empezando por "${t.especialista} terminó…"` : ' (en primera persona: "Listo, …")'}. Números exactamente como están. No leas enlaces ni el texto entero: di que el detalle está en la pantalla.`
        : `[AVISO DEL SISTEMA] La tarea ${t.id} ("${t.titulo}") falló: ${String(t.resultado).slice(0, 600)}\nDíselo al usuario en una frase, con honestidad.`;
    difundir({ t: 'aviso_tarea', id: t.id, estado: t.estado });
    if (!CFG.avisarPorVoz) return;
    if (conversacionActiva && !conversacionActiva.cerrada) conversacionActiva.hablarConGemini(texto);
    else avisosPendientes.push(texto);
};

function equipoParaPantalla() {
    const activas = [...tareas.values()].filter((t) => ACTIVAS.includes(t.estado));
    const terminadas = [...tareas.values()].filter((t) => t.estado === 'hecha').sort((a, b) => b.id - a.id);
    return equipo().map((e) => {
        const suya = activas.find((t) => t.especialista === e.nombre);
        const ultima = terminadas.find((t) => t.especialista === e.nombre);
        return {
            skill: e.skill, nombre: e.nombre, rol: e.rol, color: e.color, instalado: e.instalado,
            estado: !e.instalado ? 'no_instalado' : suya ? (suya.estado === 'esperando' ? 'esperando' : 'trabajando') : 'disponible',
            detalle: suya ? `${suya.estado === 'esperando' ? 'Espera tu OK' : 'Trabajando'}: ${suya.titulo}` : ultima ? `Última: ${ultima.titulo}` : e.instalado ? 'Disponible' : 'Complemento · no instalado',
            tarea: suya?.id || null,
        };
    });
}

// ---- Acceso: solo esta computadora, con llave local ------------------------------------------------
// El servidor solo escucha en 127.0.0.1 (nada queda expuesto a internet). Además, la página
// pide una llave local: el acceso directo del escritorio la pasa una vez y queda en una cookie.
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const ARCHIVO_SESIONES = path.join(DATOS, 'sesiones.json');
let sesiones = leerJson(ARCHIVO_SESIONES, {});
function leerCookie(req, nombre) {
    for (const parte of String(req.headers.cookie || '').split(';')) { const [k, ...v] = parte.trim().split('='); if (k === nombre) return decodeURIComponent(v.join('=')); }
    return '';
}
const autenticado = (req) => { const t = leerCookie(req, 'jv'); return Boolean(t && sesiones[hash(t)] > Date.now()); };
const llaveOk = (intento) => CFG.llave && crypto.timingSafeEqual(Buffer.from(hash(intento || '')), Buffer.from(hash(CFG.llave)));
const hostLocal = (h) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(h || ''));

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function cabeceras(res) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
}
const json = (res, codigo, obj, extra = {}) => { res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(obj)); };

const servidor = http.createServer((req, res) => {
    cabeceras(res);
    // Bloquea DNS rebinding: solo se atiende a "localhost" / 127.0.0.1.
    if (!hostLocal(req.headers.host)) { res.writeHead(403); return res.end('Solo acceso local'); }
    const url = new URL(req.url, 'http://localhost');
    try {
        if (url.pathname === '/salud') return json(res, 200, { ok: true, version: VERSION });
        // Para el instalador/desinstalador: detener el servidor (solo con la llave local).
        if (url.pathname === '/apagar' && req.method === 'POST') {
            if (!llaveOk(url.searchParams.get('llave'))) return json(res, 403, { error: 'llave' });
            json(res, 200, { ok: true });
            log('apagado por el instalador');
            setTimeout(() => process.kill(process.pid, 'SIGTERM'), 200);
            return;
        }
        if (url.searchParams.has('llave')) {
            if (!llaveOk(url.searchParams.get('llave'))) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Llave incorrecta. Abre Jarvis Voz desde el acceso directo del escritorio.'); }
            const token = crypto.randomBytes(32).toString('hex');
            sesiones[hash(token)] = Date.now() + 365 * 86400e3;
            escribirJson(ARCHIVO_SESIONES, sesiones);
            res.writeHead(302, { Location: '/', 'Set-Cookie': `jv=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${365 * 86400}` });
            return res.end();
        }
        if (url.pathname.startsWith('/api/')) {
            if (!autenticado(req)) return json(res, 401, { error: 'sin sesión' });
            if (url.pathname === '/api/estado') {
                return json(res, 200, { nombre: CFG.nombre, usuario: CFG.usuario, version: VERSION, modelo: modeloActual, voz: CFG.voz, uso: resumenUso(), sistema: estadoSistema(), equipo: equipoParaPantalla(), tareas: listarTareas(), recordatorios: listaRecordatorios(), conversacion: conversacionDe(hoy()).slice(-60) });
            }
            if (url.pathname === '/api/tarea') {
                const t = tareas.get(Number(url.searchParams.get('id'))) || leerJson(path.join(DIR_TAREAS, `${Number(url.searchParams.get('id'))}.json`), null);
                return t ? json(res, 200, { ...t, pasos: t.pasos }) : json(res, 404, { error: 'no existe' });
            }
            if (url.pathname === '/api/tarea/cancelar' && req.method === 'POST') return json(res, 200, { ok: cancelarTarea(url.searchParams.get('id')) });
            if (url.pathname === '/api/tareas/limpiar' && req.method === 'POST') {
                for (const t of tareas.values()) if (!ACTIVAS.includes(t.estado)) { t.archivada = true; guardarTarea(t); tareas.delete(t.id); }
                difundir({ t: 'tareas', lista: listarTareas() });
                return json(res, 200, { ok: true });
            }
            if (url.pathname === '/api/entregas/abrir' && req.method === 'POST') { abrirUrl(path.join(CFG.espacio, 'entregas')); return json(res, 200, { ok: true }); }
            return json(res, 404, { error: 'no existe' });
        }
        if (!autenticado(req) && (url.pathname === '/' || url.pathname === '/index.html')) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            return fs.createReadStream(path.join(RAIZ, 'web', 'sin-llave.html')).pipe(res);
        }
        let archivo = url.pathname === '/' ? '/index.html' : url.pathname;
        const ruta = path.join(RAIZ, 'web', path.normalize(archivo).replace(/^(\.\.[/\\])+/, ''));
        if (!ruta.startsWith(path.join(RAIZ, 'web')) || !fs.existsSync(ruta) || fs.statSync(ruta).isDirectory()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
        res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        fs.createReadStream(ruta).pipe(res);
    } catch (e) {
        log('error http', e.message);
        if (!res.headersSent) json(res, 500, { error: 'error interno' });
    }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
servidor.on('upgrade', (req, socket, cabeza) => {
    const url = new URL(req.url, 'http://localhost');
    let origenOk = false;
    try { const o = new URL(String(req.headers.origin || '')); origenOk = hostLocal(o.host) && o.host === req.headers.host; } catch {}
    if (url.pathname !== '/ws' || !hostLocal(req.headers.host) || !origenOk || !autenticado(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, cabeza, (ws) => wss.emit('connection', ws, req));
});
wss.on('connection', (ws) => {
    clientes.add(ws);
    // Una conversación de voz a la vez: la página más nueva toma el micrófono.
    if (conversacionActiva) { conversacionActiva.pausar('usuario'); conversacionActiva.enviar({ t: 'aviso', tipo: 'reemplazada', texto: 'Jarvis Voz se abrió en otra pestaña o ventana; esta quedó solo como panel.' }); conversacionActiva.cerrar(); }
    const conv = new Conversacion(ws);
    conversacionActiva = conv;
    log('página conectada');
    conv.estado();
    ws.on('message', (dato, binario) => {
        if (binario) return conversacionActiva === conv && conv.audio(Buffer.isBuffer(dato) ? dato : Buffer.from(dato));
        let msg;
        try { msg = JSON.parse(dato.toString()); } catch { return; }
        if (conversacionActiva === conv) conv.comando(msg);
    });
    ws.on('close', () => {
        clientes.delete(ws);
        if (conversacionActiva === conv) { conv.cerrar(); conversacionActiva = null; }
        log('página cerrada');
    });
});
setInterval(() => difundir({ t: 'sistema', sistema: estadoSistema() }), 5000).unref();

// ---- Diagnóstico ------------------------------------------------------------------------------
async function diagnostico() {
    let ok = true;
    const linea = (bien, texto, grave = true) => { console.log(`${bien ? '✔' : grave ? '✘' : '!'} ${texto}`); if (!bien && grave) ok = false; };
    console.log(`Jarvis Voz ${VERSION} · Node ${process.version} · ${process.platform}`);
    linea(Number(process.versions.node.split('.')[0]) >= 18, 'Node.js 18 o más nuevo');
    linea(CFG.llave.length >= 24, `LLAVE_LOCAL ${CFG.llave.length >= 24 ? 'definida' : 'falta (el instalador la crea)'}`);
    linea(Boolean(CFG.geminiKey), `GEMINI_API_KEY ${CFG.geminiKey ? 'definida' : 'falta'}`);
    if (CFG.geminiKey) {
        try {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CFG.modelo}?key=${encodeURIComponent(CFG.geminiKey)}`);
            linea(r.ok, r.ok ? `Gemini acepta la clave y el modelo de voz ${CFG.modelo}` : `Gemini respondió ${r.status} para ${CFG.modelo} (¿clave o modelo incorrecto?)`);
        } catch (e) { linea(false, `No pude llegar a Gemini: ${e.message}`); }
    }
    await detectarMotores();
    const disp = motoresDisponibles();
    for (const m of ['claude', 'codex', 'gemini']) linea(Boolean(motoresInfo[m]), `${NOMBRE_MOTOR[m]}: ${motoresInfo[m] ? `${motoresInfo[m].version || 'instalado'}${CFG.motores.includes(m) ? '' : ' (no está en MOTORES)'}` : 'no instalado'}`, false);
    linea(disp.length > 0, disp.length ? `Motor de tareas: ${disp.map((m) => NOMBRE_MOTOR[m]).join(' → ')}` : 'Ningún motor de tareas instalado (instala Claude Code, Codex o Gemini CLI)');
    if (motoresInfo.claude) {
        const estado = await new Promise((ok) => {
            let out = '';
            const p = lanzar(motoresInfo.claude.ruta, ['auth', 'status', '--json'], { windowsHide: true });
            p.stdout?.on('data', (d) => { out += d; });
            p.on('error', () => ok(null));
            p.on('close', () => ok(out));
            setTimeout(() => { try { p.kill(); } catch {} ok(out); }, 20000);
        });
        const dentro = /"loggedIn"\s*:\s*true/.test(estado || '');
        linea(dentro, dentro ? 'Claude Code: entraste en tu cuenta de Claude' : 'Claude Code sin cuenta: en una terminal corre  claude auth login', disp.length > 1);
    }
    const eq = equipo().filter((e) => e.instalado);
    console.log(`Equipo: ${eq.length ? eq.map((e) => e.nombre).join(', ') : 'ningún especialista instalado (opcional)'}`);
    console.log(`Carpeta de trabajo: ${CFG.espacio}`);
    console.log(`Límite de voz: ${CFG.minutosDia} min/día · pausa sin actividad: ${CFG.pausaSeg} s · voz: ${CFG.voz}`);
    console.log(ok ? '\nTodo listo.' : '\nCorrige lo marcado con ✘ y vuelve a probar.');
    process.exit(ok ? 0 : 1);
}

if (process.argv.includes('--diagnostico')) {
    await diagnostico();
} else if (process.argv.includes('--enlace')) {
    console.log(`http://localhost:${CFG.puerto}/?llave=${CFG.llave}`);
} else {
    if (CFG.llave.length < 24) { console.error('Falta LLAVE_LOCAL en el archivo .env (el instalador la crea). Sin llave, Jarvis Voz no arranca.'); process.exit(78); }
    await detectarMotores();
    servidor.on('error', (e) => { log('no pude abrir el puerto', CFG.puerto, e.code || e.message); process.exit(e.code === 'EADDRINUSE' ? 98 : 1); });
    servidor.listen(CFG.puerto, '127.0.0.1', () => log(`Jarvis Voz ${VERSION} en http://localhost:${CFG.puerto} · voz ${CFG.modelo} · tareas: ${motoresDisponibles().map((m) => NOMBRE_MOTOR[m]).join(' → ') || 'ningún motor'}`));
    setInterval(detectarMotores, 10 * 60e3).unref();
    for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { try { escribirJson(ARCHIVO_USO, uso); } catch {} conversacionActiva?.cerrar(); for (const p of procesos.values()) matar(p); process.exit(0); });
    process.on('uncaughtException', (e) => log('ERROR no tratado:', e?.stack || e));
    process.on('unhandledRejection', (e) => log('promesa rechazada:', e?.stack || e));
}
