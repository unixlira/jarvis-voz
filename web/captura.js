// Micrófono -> PCM 16 bits, 16 kHz, mono (formato de Gemini Live), en trozos de ~40 ms.
class Captura extends AudioWorkletProcessor {
    constructor() {
        super();
        this.razon = sampleRate / 16000;
        this.acumulado = [];
        this.pos = 0;
    }
    process(entradas) {
        const canal = entradas[0]?.[0];
        if (!canal) return true;
        let suma = 0;
        for (let i = 0; i < canal.length; i++) suma += canal[i] * canal[i];
        // Remuestreo simple (promedio del intervalo) a 16 kHz.
        while (this.pos < canal.length) {
            const ini = Math.floor(this.pos);
            const fin = Math.min(canal.length, Math.floor(this.pos + this.razon));
            let s = 0;
            for (let i = ini; i < Math.max(fin, ini + 1); i++) s += canal[i];
            this.acumulado.push(s / Math.max(1, fin - ini));
            this.pos += this.razon;
        }
        this.pos -= canal.length;
        if (this.acumulado.length >= 640) {
            const pcm = new Int16Array(this.acumulado.length);
            for (let i = 0; i < pcm.length; i++) {
                const v = Math.max(-1, Math.min(1, this.acumulado[i]));
                pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
            }
            this.port.postMessage({ pcm: pcm.buffer, nivel: Math.sqrt(suma / canal.length) }, [pcm.buffer]);
            this.acumulado = [];
        }
        return true;
    }
}
registerProcessor('captura', Captura);
