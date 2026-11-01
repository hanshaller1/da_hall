// Eingebaute Demo-Signale: synthetische Gitarre (erweitertes Karplus-Strong) und Impulse.
// Alles wird lokal berechnet, es werden keine Audiodateien geladen.

const m2f = (n) => 440 * Math.pow(2, (n - 69) / 12);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Eine gezupfte Saite. Fraktionale Stimmung über Allpass, Dämpfung über Mittelwertfilter.
 * @param {Float32Array[]} out  Stereo-Ziel
 */
function pluck(out, sr, start, midi, { amp = 0.3, decay = 3, bright = 0.6, pan = 0, len, mute = false, rand }) {
  const f = m2f(midi);
  const period = sr / f - 0.5; // Mittelwertfilter verzögert um 0,5 Samples
  const N = Math.floor(period);
  const frac = period - N;
  const C = (1 - frac) / (1 + frac);
  const buf = new Float32Array(N + 2);
  // Anregung: gefiltertes Rauschen (Helligkeit) mit Anschlagposition
  let lp = 0;
  const a = 0.15 + 0.8 * bright;
  for (let i = 0; i < N; i++) {
    lp += a * (rand() * 2 - 1 - lp);
    buf[i] = lp;
  }
  const pickPos = Math.max(1, Math.floor(N * 0.13));
  for (let i = N - 1; i >= pickPos; i--) buf[i] -= buf[i - pickPos] * 0.9;
  const t60 = mute ? 0.12 : decay * Math.pow(220 / f, 0.35);
  const rho = Math.pow(10, -3 / (f * t60));
  const total = Math.min(len ?? Math.round(sr * (t60 + 0.05)), out[0].length - start);
  const gl = amp * Math.cos((pan + 1) * Math.PI * 0.25);
  const gr = amp * Math.sin((pan + 1) * Math.PI * 0.25);
  let idx = 0, apX = 0, apY = 0, body = 0;
  const bodyA = 1 - Math.exp((-2 * Math.PI * 4200) / sr);
  const fadeIn = Math.round(sr * 0.0015), fadeOut = Math.round(sr * 0.03);
  for (let n = 0; n < total; n++) {
    const cur = buf[idx];
    const nxt = buf[idx + 1 < N ? idx + 1 : 0];
    const avg = 0.5 * (cur + nxt) * rho;
    // Allpass für die Feinstimmung
    const y = C * avg + apX - C * apY;
    apX = avg;
    apY = y;
    buf[idx] = y;
    idx = idx + 1 < N ? idx + 1 : 0;
    body += bodyA * (cur - body);
    let env = 1;
    if (n < fadeIn) env = n / fadeIn;
    if (n > total - fadeOut) env *= (total - n) / fadeOut;
    out[0][start + n] += body * gl * env;
    out[1][start + n] += body * gr * env;
  }
}

function makeBuffer(ctx, seconds) {
  const sr = ctx.sampleRate;
  const len = Math.round(sr * seconds);
  return { sr, len, data: [new Float32Array(len), new Float32Array(len)] };
}

function toAudioBuffer(ctx, { sr, len, data }) {
  // sanfte Normalisierung auf -6 dBFS Spitze
  let pk = 0;
  for (const ch of data) for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(ch[i]));
  const g = pk > 0 ? 0.5 / pk : 1;
  const ab = ctx.createBuffer(2, len, sr);
  data.forEach((ch, c) => {
    for (let i = 0; i < len; i++) ch[i] *= g;
    ab.copyToChannel(ch, c);
  });
  return ab;
}

const CHORDS = [
  [48, 55, 59, 64, 67, 71], // Cmaj7(9)
  [45, 52, 55, 60, 64, 71], // Am9
  [41, 48, 52, 57, 59, 64], // Fmaj7#11
  [43, 50, 57, 59, 62, 64], // G6/9
];

export const DEMOS = [
  { id: 'arp', name: 'Arpeggio', desc: 'Gezupfte Akkordzerlegung, 76 BPM' },
  { id: 'chords', name: 'Akkorde', desc: 'Langsam angeschlagene Akkorde mit Pausen' },
  { id: 'staccato', name: 'Staccato', desc: 'Kurze, gedämpfte Töne: der Hall wird deutlich hörbar' },
  { id: 'impulse', name: 'Impuls', desc: 'Klick alle 4 Sekunden: reine Hallfahne' },
];

export function renderDemo(ctx, id) {
  const rand = rng(1234);
  if (id === 'impulse') {
    const b = makeBuffer(ctx, 8);
    for (const t of [0.05, 4.05]) {
      const s = Math.round(b.sr * t);
      for (let i = 0; i < 48; i++) {
        const v = (rand() * 2 - 1) * Math.exp(-i / 8);
        b.data[0][s + i] += v;
        b.data[1][s + i] += v;
      }
    }
    return toAudioBuffer(ctx, b);
  }
  if (id === 'chords') {
    const b = makeBuffer(ctx, 16);
    CHORDS.forEach((ch, c) => {
      const t0 = 0.1 + c * 4;
      ch.forEach((n, s) => pluck(b.data, b.sr, Math.round(b.sr * (t0 + s * 0.028)), n, {
        amp: 0.22, decay: 3.2, bright: 0.5, pan: (s - 2.5) * 0.12, rand, len: Math.round(b.sr * 2.6),
      }));
    });
    return toAudioBuffer(ctx, b);
  }
  if (id === 'staccato') {
    const b = makeBuffer(ctx, 12.8);
    const line = [64, 67, 71, 74, null, 72, 71, null, 69, 67, 64, null, 62, 64, null, null];
    const beat = 60 / 75 / 2;
    for (let rep = 0; rep < 2; rep++) {
      line.forEach((n, i) => {
        if (n === null) return;
        const t = 0.05 + (rep * line.length + i) * beat;
        pluck(b.data, b.sr, Math.round(b.sr * t), n, { amp: 0.4, bright: 0.7, mute: true, rand, pan: 0.1 });
      });
    }
    return toAudioBuffer(ctx, b);
  }
  // Arpeggio
  const beat = 60 / 76 / 2;
  const pattern = [0, 2, 3, 4, 5, 4, 3, 2];
  const b = makeBuffer(ctx, CHORDS.length * pattern.length * beat + 0.05);
  CHORDS.forEach((ch, c) => {
    pattern.forEach((p, i) => {
      const t = 0.02 + (c * pattern.length + i) * beat;
      pluck(b.data, b.sr, Math.round(b.sr * t), ch[p], {
        amp: i === 0 ? 0.34 : 0.26, decay: 2.6, bright: 0.55 + 0.1 * (p / 5), pan: (p - 2.5) * 0.14, rand,
      });
    });
  });
  return toAudioBuffer(ctx, b);
}
