// Jarvis Voz: centro de mando en el navegador. Sin librerías.
'use strict';
const $ = (id) => document.getElementById(id);

let nombre = 'Jarvis';
let ws = null;
let ctx = null; // un solo AudioContext para micrófono y parlante
let analizadorSalida = null;
let activo = false; // el usuario encendió la conversación
let conectado = false; // voz lista del lado del servidor
let proximo = 0;
let fuentes = [];
let nivelTu = 0;
let ultimo = { quien: null, el: null };
let tareasLista = [];
let recordatoriosLista = [];
let cerrandoPorOtra = false;

// ---- Escala del tablero (dibujado en 1920x1080) ---------------------------------
function escalar() {
    const e = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.setProperty('--escala', String(e));
}
addEventListener('resize', escalar);
escalar();

// Ondas de la barra de abajo (40 barras de cada lado)
for (const id of ['wave-tu', 'wave-jarvis']) for (let i = 0; i < 40; i++) $(id).append(document.createElement('span'));
const forma = Array.from({ length: 40 }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21)));

// ---- Inicio --------------------------------------------------------------------------
async function inicio() {
    let r;
    try { r = await fetch('/api/estado', { cache: 'no-store' }); } catch { return setTimeout(inicio, 2500); }
    if (r.status === 401) { location.reload(); return; }
    const d = await r.json();
    nombre = d.nombre || 'Jarvis';
    document.title = `${nombre} · Centro de mando`;
    const mitad = Math.ceil(nombre.length / 2);
    $('logo').innerHTML = '';
    $('logo').append(nombre.slice(0, mitad).toUpperCase(), Object.assign(document.createElement('em'), { textContent: nombre.slice(mitad).toUpperCase() }));
    $('nombre-core').textContent = nombre.toUpperCase();
    $('talk-titulo').textContent = `HÁBLALE A ${nombre.toUpperCase()}`;
    $('chip-voz').textContent = `Voz: ${d.voz} · ${d.modelo}`;
    $('pie').textContent = `Jarvis Voz ${d.version}`;
    mostrarUso(d.uso);
    sistema(d.sistema);
    equipo(d.equipo);
    recordatoriosLista = d.recordatorios || [];
    pintarTareas(d.tareas);
    $('historial').innerHTML = '';
    for (const l of d.conversacion || []) burbuja(l.quien.startsWith('Tú') ? 'yo' : 'jarvis', l.texto);
    if (!d.conversacion?.length) nota(`Haz clic en el micrófono (o presiona la barra espaciadora) y háblale a ${nombre}.`);
    abrirWs();
    pintar();
}

function abrirWs() {
    if (ws && ws.readyState <= 1) return;
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return reproducir(e.data);
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        mensaje(m);
    };
    ws.onclose = () => {
        conectado = false;
        pintar();
        if (cerrandoPorOtra) return;
        setTimeout(() => { abrirWs(); }, 2500);
    };
}
const enviar = (obj) => { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)); };

function mensaje(m) {
    if (!['usuario', 'asistente', 'uso', 'sistema'].includes(m.t)) window.__jvMarcas?.eventos.push([performance.now(), m.t, m.nombre || m.estado || m.tipo || '']);
    switch (m.t) {
        case 'estado':
            conectado = m.conectado;
            if (m.pausada) activo = false; else activo = true;
            if (m.modelo) $('chip-voz').textContent = $('chip-voz').textContent.replace(/·.*$/, `· ${m.modelo}`);
            if (m.uso) mostrarUso(m.uso);
            break;
        case 'conectando': conectado = false; break;
        case 'uso': mostrarUso(m.uso); break;
        case 'usuario': agregar('yo', m.texto); break;
        case 'asistente': agregar('jarvis', m.texto); break;
        case 'fin_turno': ultimo = { quien: null, el: null }; break;
        case 'interrumpido': callar(); ultimo = { quien: null, el: null }; break;
        case 'funcion':
            if (m.nombre === 'encargar_tarea') nota(`Encargando: ${m.args?.titulo || 'tarea'}${m.args?.especialista ? ` → ${m.args.especialista}` : ''}`);
            break;
        case 'tareas': pintarTareas(m.lista); break;
        case 'recordatorios': recordatoriosLista = m.lista || []; pintarTareas(tareasLista); break;
        case 'recordatorio': campana(); nota(`Recordatorio: ${m.texto}`); break;
        case 'equipo': equipo(m.equipo); break;
        case 'sistema': sistema(m.sistema); break;
        case 'aviso_tarea': if (m.estado === 'hecha' || m.estado === 'esperando') campana(); tarjetaTarea(m.id); break;
        case 'aviso':
            nota(m.texto);
            if (m.tipo === 'reemplazada') { cerrandoPorOtra = true; activo = false; }
            if (['inactividad', 'limite', 'error', 'usuario', 'reemplazada'].includes(m.tipo)) activo = false;
            if (m.tipo === 'error') $('st').className = 'st error';
            break;
    }
    pintar();
}

// ---- Micrófono y parlante -------------------------------------------------------------
async function prepararAudio() {
    if (ctx) { if (ctx.state !== 'running') await ctx.resume(); return; }
    ctx = new AudioContext();
    await ctx.resume();
    await ctx.audioWorklet.addModule('/captura.js');
    const flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const fuente = ctx.createMediaStreamSource(flujo);
    const nodo = new AudioWorkletNode(ctx, 'captura');
    const mudo = ctx.createGain();
    mudo.gain.value = 0;
    fuente.connect(nodo).connect(mudo).connect(ctx.destination);
    nodo.port.onmessage = ({ data }) => {
        nivelTu = Math.max(nivelTu, data.nivel);
        if (activo && conectado && ws?.readyState === 1) ws.send(data.pcm);
    };
    analizadorSalida = ctx.createAnalyser();
    analizadorSalida.fftSize = 512;
    analizadorSalida.connect(ctx.destination);
    animar();
}

async function encender() {
    try { await prepararAudio(); } catch (e) {
        nota(`No pude usar el micrófono. Permite el micrófono para esta página (ícono del candado o de la cámara en la barra de direcciones). (${e.message || e})`);
        return false;
    }
    activo = true;
    enviar({ t: 'iniciar' });
    pintar();
    return true;
}
function apagar() { activo = false; enviar({ t: 'pausar' }); callar(); pintar(); }
$('mic').addEventListener('click', async () => { if (activo) apagar(); else await encender(); });
document.addEventListener('keydown', async (e) => {
    if (e.code !== 'Space' || e.repeat || document.activeElement === $('texto') || $('detalle').open) return;
    e.preventDefault();
    if (activo) apagar(); else await encender();
});

$('form-texto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = $('texto').value.trim();
    if (!texto) return;
    $('texto').value = '';
    if (!activo) await encender();
    burbuja('yo', texto);
    ultimo = { quien: null, el: null };
    enviar({ t: 'texto', texto });
});

// Marcas de tiempo para medir latencia (usadas por las pruebas automáticas).
const marcas = (window.__jvMarcas = { audio: [], eventos: [] });
function reproducir(datos) {
    if (marcas.audio.length > 5000) marcas.audio.splice(0, 1000);
    marcas.audio.push(performance.now());
    if (!ctx) return;
    const pcm = new Int16Array(datos);
    const buf = ctx.createBuffer(1, pcm.length, 24000);
    const canal = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) canal[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(analizadorSalida);
    const ahora = ctx.currentTime;
    if (proximo < ahora + 0.03) proximo = ahora + 0.03;
    src.start(proximo);
    proximo += buf.duration;
    fuentes.push(src);
    src.onended = () => { fuentes = fuentes.filter((f) => f !== src); pintar(); };
    pintar();
}
function callar() { for (const f of fuentes) { try { f.stop(); } catch {} } fuentes = []; proximo = 0; }

// Aviso sonoro corto cuando una tarea termina.
function campana() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, d] of [[880, 0], [1320, 0.12]]) {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.35);
        o.connect(g).connect(ctx.destination); o.start(t + d); o.stop(t + d + 0.4);
    }
}

// ---- Animación (núcleo y ondas con el nivel real del audio) ------------------------------
const datosSalida = new Uint8Array(256);
function animar() {
    let nivelJv = 0;
    if (analizadorSalida && fuentes.length) {
        analizadorSalida.getByteTimeDomainData(datosSalida);
        let s = 0;
        for (const v of datosSalida) s += ((v - 128) / 128) ** 2;
        nivelJv = Math.min(1, Math.sqrt(s / datosSalida.length) * 5);
    }
    const nt = activo ? Math.min(1, nivelTu * 7) : 0;
    nivelTu *= 0.55;
    document.documentElement.style.setProperty('--nivel-tu', nt.toFixed(3));
    document.documentElement.style.setProperty('--nivel-jv', nivelJv.toFixed(3));
    const t = performance.now() / 160;
    const barras = (id, n) => $(id).querySelectorAll('span').forEach((b, i) => {
        const vivo = 0.55 + 0.45 * Math.abs(Math.sin(t + i * 0.7));
        b.style.height = `${Math.max(4, Math.round(46 * n * forma[i] * vivo))}px`;
    });
    barras('wave-tu', nt);
    barras('wave-jarvis', nivelJv);
    requestAnimationFrame(animar);
}

// ---- Conversación ----------------------------------------------------------------------
function burbuja(quien, texto) {
    const el = document.createElement('div');
    el.className = `msg ${quien}`;
    el.textContent = texto;
    $('historial').append(el);
    bajar();
    return el;
}
function agregar(quien, texto) {
    if (ultimo.quien !== quien || !ultimo.el) ultimo = { quien, el: burbuja(quien, '') };
    ultimo.el.textContent += texto;
    bajar();
}
function nota(texto) { burbuja('sis', texto); ultimo = { quien: null, el: null }; }
function tarjetaTarea(id) {
    const t = tareasLista.find((x) => x.id === id);
    if (!t) return;
    const el = document.createElement('div');
    el.className = 'msg tarea';
    const b = document.createElement('b');
    b.textContent = `${t.especialista || nombre} · tarea ${t.id} · ${({ hecha: 'terminada', fallo: 'falló', esperando: 'necesita tu OK' })[t.estado] || t.estado}`;
    el.append(b, t.estado === 'esperando' ? t.pregunta : sinMarkdown(t.resumen || t.resultado || '').slice(0, 400));
    el.addEventListener('click', () => verTarea(t.id));
    $('historial').append(el);
    ultimo = { quien: null, el: null };
    bajar();
}
function bajar() { const h = $('historial'); h.scrollTop = h.scrollHeight; }

// ---- Paneles -------------------------------------------------------------------------------
function mostrarUso(u) {
    if (!u) return;
    const costo = u.costo < 0.01 ? '< US$ 0,01' : `≈ US$ ${u.costo.toFixed(2).replace('.', ',')}`;
    $('uso').textContent = `${String(u.minutos).replace('.', ',')} de ${u.limite} min · ${costo}`;
}
function sistema(s) {
    if (!s) return;
    const pct = (id, v) => { $(id).textContent = v == null ? '—' : `${v}%`; $(`${id}-b`).style.width = `${v || 0}%`; };
    pct('cpu', s.cpu); pct('mem', s.memoria); pct('disco', s.disco);
    $('so').textContent = s.so;
    const nombres = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' };
    $('motor').textContent = s.orden?.length ? s.orden.map((m) => nombres[m]).join(' → ') : 'ninguno instalado';
    $('motor').style.color = s.orden?.length ? '#A3FF12' : '#F87171';
    $('chip-mem').textContent = `Memoria: ${s.memoriaDatos} ${s.memoriaDatos === 1 ? 'dato' : 'datos'}`;
}
function equipo(lista) {
    if (!lista) return;
    const cont = $('equipo');
    cont.innerHTML = '';
    const instalados = lista.filter((e) => e.instalado);
    $('eq-n').textContent = `${instalados.length} de ${lista.length} instalados`;
    const filas = [{ nombre, rol: 'Asistente', color: '#A78BFA', instalado: true, estado: tareasLista.some((t) => !t.especialista && ['en_curso', 'en_cola'].includes(t.estado)) ? 'trabajando' : 'disponible', detalle: tareasLista.some((t) => !t.especialista && ['en_curso', 'en_cola'].includes(t.estado)) ? 'Trabajando en una tarea' : 'Coordina al equipo' }, ...instalados, ...lista.filter((e) => !e.instalado)];
    for (const e of filas) {
        const div = document.createElement('div');
        div.className = `eq ${e.instalado ? e.estado : 'no'}`;
        const av = document.createElement('div');
        av.className = 'av';
        av.textContent = e.nombre[0];
        Object.assign(av.style, { background: `${e.color}22`, borderColor: e.color, color: e.color });
        const t = document.createElement('div');
        t.className = 'eqt';
        const b = document.createElement('b'); b.textContent = e.nombre;
        const r = document.createElement('span'); r.textContent = ` · ${e.rol}`; r.style.color = e.color;
        const s = document.createElement('small'); s.textContent = e.detalle;
        t.append(b, r, s);
        const dot = document.createElement('i');
        dot.className = 'dot';
        if (e.instalado) { dot.style.background = e.color; dot.style.boxShadow = `0 0 10px ${e.color}`; }
        div.append(av, t, dot);
        if (e.tarea) { div.style.cursor = 'pointer'; div.addEventListener('click', () => verTarea(e.tarea)); }
        cont.append(div);
    }
}
const ETIQUETA = { en_cola: 'en cola', en_curso: 'en curso', esperando: 'espera tu OK', hecha: 'hecha', fallo: 'falló', cancelada: 'cancelada' };
const hace = (iso) => {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    return s < 60 ? `hace ${Math.round(s)} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`;
};
function pintarTareas(lista) {
    if (!lista) return;
    tareasLista = lista;
    const cont = $('tareas');
    cont.innerHTML = '';
    for (const r of recordatoriosLista) {
        const row = document.createElement('div');
        row.className = 'row';
        row.title = 'Recordatorio';
        const ic = document.createElement('span');
        ic.className = 'ic recordatorio';
        ic.textContent = '⏰';
        const d = document.createElement('div');
        const b = document.createElement('b'); b.textContent = r.texto;
        const s = document.createElement('small'); s.textContent = `Recordatorio · ${r.cuandoTexto}`;
        d.append(b, s);
        row.append(ic, d);
        cont.append(row);
    }
    if (!lista.length && !recordatoriosLista.length) cont.innerHTML = '<div class="vacio">Sin tareas todavía. Pídele algo de trabajo de verdad: "Mateo, escribe 3 anuncios para…" o "recuérdame pagar la luz el viernes a las 9".</div>';
    for (const t of lista) {
        const row = document.createElement('div');
        row.className = 'row';
        const ic = document.createElement('span');
        ic.className = `ic ${t.estado}`;
        ic.textContent = { hecha: '✓', fallo: '!', cancelada: '×', esperando: '?' }[t.estado] || '';
        const d = document.createElement('div');
        const b = document.createElement('b'); b.textContent = `${t.id}. ${t.titulo}`;
        const s = document.createElement('small');
        const paso = ['en_curso', 'en_cola'].includes(t.estado) && t.pasos?.length ? ` · ${t.pasos[t.pasos.length - 1]}` : '';
        s.textContent = `${t.especialista || nombre} · ${ETIQUETA[t.estado] || t.estado} · ${hace(t.terminada || t.creada)}${paso}`;
        d.append(b, s);
        row.append(ic, d);
        row.addEventListener('click', () => verTarea(t.id));
        cont.append(row);
    }
    const enCurso = lista.filter((t) => ['en_curso', 'en_cola'].includes(t.estado)).length;
    $('chip-tareas').textContent = enCurso ? `${enCurso} ${enCurso === 1 ? 'tarea' : 'tareas'} en curso` : `${lista.filter((t) => t.estado === 'hecha').length} tareas hechas`;
}
setInterval(() => pintarTareas(tareasLista), 15000);
$('limpiar').addEventListener('click', () => fetch('/api/tareas/limpiar', { method: 'POST' }));
$('btn-entregas').addEventListener('click', () => fetch('/api/entregas/abrir', { method: 'POST' }));

// Markdown mínimo para leer el resultado (negrita, títulos y enlaces como texto).
function markdown(texto) {
    const esc = String(texto).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
        .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$)/g, '$1<i>$2</i>');
}
const sinMarkdown = (t) => String(t || '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1').replace(/[*#`_]/g, '');
let detalleId = null;
async function verTarea(id) {
    const r = await fetch(`/api/tarea?id=${id}`);
    if (!r.ok) return;
    const t = await r.json();
    detalleId = t.id;
    $('det-titulo').textContent = `${t.id}. ${t.titulo}`;
    $('det-meta').textContent = `${t.especialista || nombre} · ${ETIQUETA[t.estado] || t.estado} · ${t.motor || ''} · pedido: ${t.pedido}`;
    $('det-texto').innerHTML = markdown(t.resultado || (t.estado === 'en_curso' ? 'Trabajando…' : '—'));
    $('det-pasos').innerHTML = '';
    for (const p of t.pasos || []) $('det-pasos').append(Object.assign(document.createElement('li'), { textContent: p }));
    $('det-cancelar').hidden = !['en_curso', 'en_cola', 'esperando'].includes(t.estado);
    $('detalle').showModal();
}
$('det-cerrar').addEventListener('click', () => $('detalle').close());
$('det-copiar').addEventListener('click', () => navigator.clipboard?.writeText($('det-texto').innerText));
$('det-cancelar').addEventListener('click', async () => { await fetch(`/api/tarea/cancelar?id=${detalleId}`, { method: 'POST' }); $('detalle').close(); });

// ---- Estado visual ----------------------------------------------------------------------------
function pintar() {
    const hablando = fuentes.length > 0;
    const trabajando = tareasLista.some((t) => ['en_curso', 'en_cola'].includes(t.estado));
    const core = $('core');
    let clase, texto, sub;
    if (!activo) { clase = 'pausa'; texto = 'EN PAUSA'; sub = 'Clic en el micrófono o barra espaciadora'; }
    else if (!conectado) { clase = 'pensando'; texto = 'CONECTANDO'; sub = 'Conectando la voz…'; }
    else if (hablando) { clase = 'hablando'; texto = 'HABLANDO'; sub = 'Puedes interrumpir cuando quieras'; }
    else if (trabajando) { clase = 'escuchando pensando'; texto = 'ESCUCHANDO'; sub = 'Te escucho · el equipo está trabajando'; }
    else { clase = 'escuchando'; texto = 'ESCUCHANDO'; sub = 'Te escucho… (espacio para pausar)'; }
    core.className = `core ${clase}`;
    $('estado-core').textContent = `NÚCLEO DE IA · ${texto}`;
    $('talk-sub').textContent = sub;
    $('talk').className = `talk${activo ? '' : ' pausa'}`;
    const st = $('st');
    if (!st.classList.contains('error') || activo) st.className = `st${activo && conectado ? ' on' : ''}`;
    $('st-texto').textContent = activo && conectado ? 'Voz conectada' : activo ? 'Conectando…' : 'Voz en pausa';
}
setInterval(() => { $('hora').textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); }, 1000);
inicio();
