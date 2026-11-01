// Lädt den AudioWorklet-Prozessor in Node (ohne Browser), indem die Worklet-Globals simuliert werden.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SRC = readFileSync(fileURLToPath(new URL('../js/audio/reverb-processor.js', import.meta.url)), 'utf8');

export function loadProcessor(fs = 48000, params = {}) {
  let Ctor = null;
  const messages = [];
  class AudioWorkletProcessor {
    constructor() {
      this.port = { postMessage: (m) => messages.push(m), onmessage: null };
    }
  }
  const ctx = vm.createContext({
    sampleRate: fs,
    AudioWorkletProcessor,
    registerProcessor: (name, C) => { Ctor = C; },
    Math, Float32Array, Float64Array, Int32Array, Number, Object, Array,
  });
  vm.runInContext(SRC, ctx);
  const proc = new Ctor({ processorOptions: { params } });
  return {
    proc,
    messages,
    set(p) { proc.port.onmessage({ data: { type: 'params', params: p } }); },
    clear() { proc.port.onmessage({ data: { type: 'clear' } }); },
    /** Verarbeitet ein Stereo-Signal (Float32Arrays) in 128er-Blöcken. */
    run(inL, inR = inL) {
      const n = inL.length;
      const outL = new Float32Array(n), outR = new Float32Array(n);
      for (let off = 0; off < n; off += 128) {
        const len = Math.min(128, n - off);
        const a = new Float32Array(128), b = new Float32Array(128);
        a.set(inL.subarray(off, off + len));
        b.set(inR.subarray(off, off + len));
        const oa = new Float32Array(128), ob = new Float32Array(128);
        proc.process([[a, b]], [[oa, ob]]);
        outL.set(oa.subarray(0, len), off);
        outR.set(ob.subarray(0, len), off);
      }
      return [outL, outR];
    },
  };
}

export function rms(a, from = 0, to = a.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export const db = (x) => 20 * Math.log10(x + 1e-12);

/** Schätzt RT60 aus der Schroeder-Rückwärtsintegration (Fit zwischen -5 und -25 dB). */
export function rt60(sig, fs) {
  const n = sig.length;
  const e = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) { acc += sig[i] * sig[i]; e[i] = acc; }
  const e0 = e[0];
  let t5 = -1, t25 = -1;
  for (let i = 0; i < n; i++) {
    const d = 10 * Math.log10(e[i] / e0);
    if (t5 < 0 && d <= -5) t5 = i;
    if (t25 < 0 && d <= -25) { t25 = i; break; }
  }
  if (t5 < 0 || t25 < 0) return Infinity;
  return ((t25 - t5) / fs) * 3; // 20 dB → 60 dB
}

export function noise(n, amp = 0.3, seed = 1) {
  let s = seed >>> 0;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    a[i] = ((s / 4294967296) * 2 - 1) * amp;
  }
  return a;
}
