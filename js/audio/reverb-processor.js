/*
 * DA HALL – Ambient Reverb DSP
 * AudioWorkletProcessor, ohne Abhängigkeiten.
 *
 * Signalfluss (pro Kanal):
 *   Input ─┬─► Dry (Rise: 3 ms Lookahead + Swell)
 *          └─► Send ─► [Dark: Sub-Oktave] ─► [Rain: Ping-Pong-Delay]
 *                    ─► [Light: Shimmer-Feedback] ─► [Dream: Latch-Delay]
 *                    ─► Pre-Delay ─► Stretch (Bloom) ─► Diffusion
 *                    ─► 16-Kanal-FDN (moduliert, frequenzabhängiges Decay)
 *                    ─► Vibrato/Wow ─► Lo-Fi ─► Filter ─► Ducking ─► Width ─► Mix
 *
 * Alle Parameter kommen in realen Einheiten über den MessagePort (siehe js/params.js).
 */

const N = 16; // FDN-Ordnung
const FDN_MS = [
  29.7, 33.1, 37.9, 41.3, 45.7, 50.3, 55.1, 59.9,
  64.7, 70.1, 75.7, 81.3, 87.1, 93.7, 100.3, 107.9,
];
const MAX_SIZE = 1.6;
const CHUNK = 32; // Koeffizienten-Update-Raster (Samples)
const STRETCH_TAPS = 24;
const STRETCH_MAX = 3.0; // s
const LATCH_SEC = 0.15; // Dream: Clear-Zeit vor dem neuen Pad
const LOOKAHEAD_SEC = 0.003; // Rise: Lookahead, damit der Anschlag nicht durchrutscht
const DIFF_MS_L = [3.21, 2.43, 8.59, 6.28];
const DIFF_MS_R = [3.53, 2.17, 7.93, 6.71];
const BLOOM_MS_L = [61.3, 97.1];
const BLOOM_MS_R = [67.9, 89.3];
const WETMOD_BASE_SEC = 0.009;

// Indizes der pro Sample geglätteten Größen
const S_IN = 0, S_OUT = 1, S_DRY = 2, S_WET = 3, S_SEND = 4, S_BP = 5, S_FZ = 6,
  S_OCT = 7, S_RAIN = 8, S_SHIM = 9, S_RISE = 10, S_LATCH = 11, S_PRE = 12,
  S_RAINT = 13, S_RAINFB = 14, S_VIB = 15, S_WOW = 16, S_DRYSWELL = 17, S_COUNT = 18;

const DEFAULTS = {
  decay: 6, mix: 0.45, filter: -0.15, depth: 0.35, mode: 2, stretch: 0.2,
  width: 1, sustain: 0, bypass: 0, predelay: 0.02, size: 1, rate: 0.5,
  damping: 0.45, lowcut: 90, diffusion: 0.8, duck: 0, lofi: 0, sens: 0.55,
  inGain: 1, outGain: 1, inputMode: 0, trails: 1, killDry: 0,
  octLevel: 0.5, octSemis: -12, swellTime: 0.45, drySwell: 0, vibDepth: 0.4,
  vibRate: 2.1, rainTime: 0.22, rainFb: 0.45, shimmer: 0.5, shimSemis: 12,
};

const MODE_DARK = 0, MODE_RISE = 1, MODE_DREAM = 2, MODE_RAIN = 3, MODE_LIGHT = 4;

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function hadamardSign(row, col) {
  let x = row & col, c = 0;
  while (x) { c ^= x & 1; x >>= 1; }
  return c ? -1 : 1;
}

class Delay {
  constructor(len) {
    this.size = nextPow2(Math.ceil(len) + 8);
    this.mask = this.size - 1;
    this.buf = new Float32Array(this.size);
    this.w = 0;
  }
  push(x) {
    this.buf[this.w] = x;
    this.w = (this.w + 1) & this.mask;
  }
  /** d = 0 liefert das zuletzt geschriebene Sample. */
  tap(d) {
    return this.buf[(this.w - 1 - d) & this.mask];
  }
  /** 4-Punkt-Hermite, d >= 1 (fraktional). */
  tapH(d) {
    const i = d | 0, f = d - i, m = this.mask, b = this.buf, base = this.w - 1 - i;
    const x0 = b[(base + 1) & m], x1 = b[base & m], x2 = b[(base - 1) & m], x3 = b[(base - 2) & m];
    const c1 = 0.5 * (x2 - x0);
    const c2 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
    const c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);
    return ((c3 * f + c2) * f + c1) * f + x1;
  }
  clear() {
    this.buf.fill(0);
  }
}

class Allpass {
  constructor(lenSamples, modMax = 0) {
    this.len = Math.max(2, Math.round(lenSamples));
    this.d = new Delay(this.len + modMax + 8);
  }
  process(x, g) {
    const dl = this.d.tap(this.len - 1);
    const w = x + g * dl;
    this.d.push(w);
    return dl - g * w;
  }
  processMod(x, g, mod) {
    const dl = this.d.tapH(this.len - 1 + mod);
    const w = x + g * dl;
    this.d.push(w);
    return dl - g * w;
  }
  clear() {
    this.d.clear();
  }
}

/** Granularer Pitch-Shifter mit zwei überblendeten Lese-Köpfen. */
class Shifter {
  constructor(fs, winSec) {
    this.win = Math.round(winSec * fs);
    this.d = new Delay(this.win + 8);
    this.phase = Math.random();
  }
  process(x, ratio) {
    this.d.push(x);
    let p = this.phase + (1 - ratio) / this.win;
    p -= Math.floor(p);
    this.phase = p;
    let p2 = p + 0.5;
    if (p2 >= 1) p2 -= 1;
    const a = this.d.tapH(1 + p * this.win);
    const b = this.d.tapH(1 + p2 * this.win);
    return a * Math.sin(Math.PI * p) + b * Math.sin(Math.PI * p2);
  }
  clear() {
    this.d.clear();
  }
}

/** TPT-State-Variable-Filter (Simper), Koeffizienten werden extern gesetzt. */
function svfCoefs(out, fc, q, fs) {
  const g = Math.tan(Math.PI * Math.min(fc, fs * 0.49) / fs);
  const k = 1 / q;
  const a1 = 1 / (1 + g * (g + k));
  out[0] = a1;
  out[1] = g * a1;
  out[2] = g * g * a1;
  out[3] = k;
}

class DaHallProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const fs = sampleRate;
    this.fs = fs;
    this.p = Object.assign({}, DEFAULTS, (options && options.processorOptions && options.processorOptions.params) || {});

    // ---- FDN ----
    this.base = new Float64Array(N);
    this.lines = [];
    this.mdMax = 0.0062 * fs;
    for (let i = 0; i < N; i++) {
      this.base[i] = (FDN_MS[i] * fs) / 1000;
      this.lines.push(new Delay(this.base[i] * MAX_SIZE + 2 * this.mdMax + 16));
    }
    this.cL = new Float64Array(N);
    this.cR = new Float64Array(N);
    this.hL = new Float64Array(N);
    this.hR = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      this.cL[i] = hadamardSign(1, i);
      this.cR[i] = hadamardSign(2, i);
      this.hL[i] = hadamardSign(5, i);
      this.hR[i] = hadamardSign(10, i);
    }
    this.g = new Float64Array(N);
    this.gb = new Float64Array(N); // g * (1 - b)
    this.b = new Float64Array(N);
    this.lp = new Float64Array(N);
    this.dcx = new Float64Array(N);
    this.dcy = new Float64Array(N);
    this.f = new Float64Array(N);
    this.dA = new Float64Array(N);
    this.dB = new Float64Array(N);
    this.lfoPh = new Float64Array(N);
    this.lfoMul = new Float64Array(N);
    const order = [0, 9, 4, 13, 2, 11, 6, 15, 1, 8, 5, 12, 3, 10, 7, 14];
    for (let i = 0; i < N; i++) {
      this.lfoPh[i] = (i / N) * 2 * Math.PI * 3.7;
      this.lfoMul[i] = 0.71 + 0.58 * (order[i] / (N - 1));
    }
    this.dcR = 1 - (2 * Math.PI * 12) / fs;
    this.logT = Math.log(this.p.decay);
    this.size = this.p.size;
    this.md = 0;

    // ---- Eingangsstufe ----
    this.look = [new Delay(LOOKAHEAD_SEC * fs + 4), new Delay(LOOKAHEAD_SEC * fs + 4)];
    this.lookLen = Math.round(LOOKAHEAD_SEC * fs);
    this.latch = [new Delay(LATCH_SEC * fs + 4), new Delay(LATCH_SEC * fs + 4)];
    this.latchLen = Math.round(LATCH_SEC * fs);
    this.pre = [new Delay(0.55 * fs), new Delay(0.55 * fs)];
    this.str = [new Delay(STRETCH_MAX * 1.08 * fs + 8), new Delay(STRETCH_MAX * 1.08 * fs + 8)];
    this.tapL = new Int32Array(STRETCH_TAPS);
    this.tapR = new Int32Array(STRETCH_TAPS);
    this.tapT = new Float64Array(STRETCH_TAPS);
    this.tapW = new Float64Array(STRETCH_TAPS);
    for (let k = 0; k < STRETCH_TAPS; k++) {
      const t = STRETCH_MAX * Math.pow((k + 1) / STRETCH_TAPS, 1.45);
      this.tapT[k] = t;
      const j = k % 2 ? 1.045 : 0.957;
      this.tapL[k] = Math.round(t * fs);
      this.tapR[k] = Math.round(Math.min(STRETCH_MAX * 1.06, t * j) * fs);
    }
    this.stretchCached = -1;
    this.stretchMix = 0;
    this.bloom = [
      BLOOM_MS_L.map((ms) => new Allpass((ms * fs) / 1000, 0.003 * fs)),
      BLOOM_MS_R.map((ms) => new Allpass((ms * fs) / 1000, 0.003 * fs)),
    ];
    this.diff = [
      DIFF_MS_L.map((ms) => new Allpass((ms * fs) / 1000)),
      DIFF_MS_R.map((ms) => new Allpass((ms * fs) / 1000)),
    ];

    // ---- Mode-Bausteine ----
    this.oct = new Shifter(fs, 0.07);
    this.shim = new Shifter(fs, 0.055);
    this.shimPrev = 0;
    this.shimHp = 0;
    this.shimHpX = 0;
    this.shimLp = 0;
    this.shimAgc = 1;
    this.tankMs = 0;
    this.rain = [new Delay(1.25 * fs), new Delay(1.25 * fs)];
    this.rainAp = [new Allpass(0.0073 * fs), new Allpass(0.0111 * fs)];
    this.rainLp = [0, 0];
    this.wetMod = [new Delay(WETMOD_BASE_SEC * 2 * fs + 8), new Delay(WETMOD_BASE_SEC * 2 * fs + 8)];
    this.vibPh = 0;
    this.wowPh = 0;
    this.flutPh = 0;

    // ---- Filter ----
    this.lpC = new Float64Array(4);
    this.hpC = new Float64Array(4);
    this.svf = new Float64Array(8); // [lpL ic1, ic2, lpR ic1, ic2, hpL ic1, ic2, hpR ic1, ic2]
    this.fLp = 20000;
    this.fHp = 20;

    // ---- Dynamik ----
    this.envF = 0;
    this.envS = 0;
    this.holdoff = 0;
    this.swellPos = 1;
    this.latchTimer = 0;
    this.duckEnv = 0;
    this.duckG = 1;
    this.onsetFlag = false;

    // ---- Glättung ----
    this.sv = new Float64Array(S_COUNT);
    this.tv = new Float64Array(S_COUNT);
    this.sk = new Float64Array(S_COUNT);
    const k = (tau) => 1 - Math.exp(-1 / (tau * fs));
    this.sk.fill(k(0.03));
    this.sk[S_BP] = k(0.012);
    this.sk[S_FZ] = k(0.06);
    this.sk[S_PRE] = k(0.12);
    this.sk[S_RAINT] = k(0.18);
    this.sk[S_SEND] = k(0.02);
    this.computeTargets();
    this.sv.set(this.tv);
    this.cleared = false;
    this.rainOn = false;
    this.levelComp = 1;

    // ---- Meter ----
    this.meterCount = 0;
    this.meterEvery = Math.round(fs / 30);
    this.pk = new Float64Array(4);

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'params') {
      Object.assign(this.p, msg.params);
      this.computeTargets();
    } else if (msg.type === 'clear') {
      this.clearAll();
    }
  }

  computeTargets() {
    const p = this.p, tv = this.tv, fs = this.fs;
    const bp = p.bypass ? 1 : 0;
    const mix = Math.min(1, Math.max(0, p.mix));
    const dryMix = mix < 0.5 ? 1 : Math.cos((mix - 0.5) * Math.PI);
    const wetMix = mix < 0.5 ? Math.sin(mix * Math.PI) : 1;
    tv[S_IN] = p.inGain;
    tv[S_OUT] = p.outGain;
    tv[S_BP] = bp;
    tv[S_FZ] = p.sustain ? 1 : 0;
    tv[S_DRY] = p.killDry ? 0 : bp ? 1 : dryMix;
    tv[S_WET] = bp && !p.trails ? 0 : wetMix;
    tv[S_SEND] = 1 - bp;
    const m = p.mode | 0;
    tv[S_OCT] = m === MODE_DARK ? 1.35 * Math.pow(p.octLevel, 1.3) : 0;
    tv[S_RAIN] = m === MODE_RAIN ? 1 : 0;
    tv[S_SHIM] = m === MODE_LIGHT ? 0.62 * Math.pow(p.shimmer, 1.15) : 0;
    tv[S_RISE] = m === MODE_RISE ? 1 : 0;
    tv[S_LATCH] = m === MODE_DREAM ? 1 : 0;
    tv[S_PRE] = Math.max(1, p.predelay * fs);
    tv[S_RAINT] = Math.max(2, p.rainTime * fs);
    tv[S_RAINFB] = m === MODE_RAIN ? Math.min(0.93, p.rainFb) : 0;
    // Vibrato-Tiefe als Tonhöhenabweichung (max ±1.8 %) → Amplitude in Samples
    const vib = m === MODE_DREAM ? p.vibDepth * p.vibDepth * 0.018 : 0;
    tv[S_VIB] = Math.min(WETMOD_BASE_SEC * 0.7 * fs, (vib / (2 * Math.PI * Math.max(0.3, p.vibRate))) * fs);
    tv[S_WOW] = p.lofi * 0.0014 * fs;
    tv[S_DRYSWELL] = m === MODE_RISE ? p.drySwell : 0;
    this.octRatio = Math.pow(2, p.octSemis / 12);
    this.shimRatio = Math.pow(2, p.shimSemis / 12);
    this.swellInc = 1 / (Math.max(0.02, p.swellTime) * fs);
    const s = Math.min(1, Math.max(0, p.sens));
    this.onThr = Math.pow(10, (-30 - 30 * s) / 20);
    this.onRatio = 3.0 - 1.6 * s;
    this.inputMode = p.inputMode | 0;
    this.widthAmt = [0.22, 0.62, 1.0][Math.min(2, Math.max(0, p.width | 0))];
    this.diffG = 0.72 * Math.min(1, Math.max(0, p.diffusion));
    this.mode = m;
    if (!bp) this.cleared = false;
  }

  clearAll() {
    for (const l of this.lines) l.clear();
    this.lp.fill(0);
    this.dcx.fill(0);
    this.dcy.fill(0);
    for (const d of [...this.look, ...this.latch, ...this.pre, ...this.str, ...this.rain, ...this.wetMod]) d.clear();
    for (const ch of [...this.bloom, ...this.diff]) for (const a of ch) a.clear();
    for (const a of this.rainAp) a.clear();
    this.oct.clear();
    this.shim.clear();
    this.svf.fill(0);
    this.rainLp[0] = this.rainLp[1] = 0;
    this.shimPrev = this.shimHp = this.shimHpX = this.shimLp = 0;
    this.tankMs = 0;
  }

  /** Einmal pro CHUNK: Decay, Dämpfung, Modulation, Filter, Stretch-Gewichte. */
  updateChunk(len) {
    const p = this.p, fs = this.fs, sv = this.sv;
    const fz = sv[S_FZ];

    // Decay (log-Domäne geglättet), Dream-Latch-Clear
    let T = p.decay * (this.mode === MODE_DREAM ? 1.5 : 1);
    let kT = 1 - Math.exp(-len / (0.04 * fs));
    if (this.latchTimer > 0) {
      this.latchTimer -= len;
      T = 0.08;
      kT = 1 - Math.exp(-len / (0.006 * fs));
    } else if (this.logT < Math.log(T) - 0.05) {
      kT = 1 - Math.exp(-len / (0.02 * fs));
    }
    this.logT += (Math.log(Math.max(0.05, T)) - this.logT) * kT;
    const T60 = Math.exp(this.logT);
    // sanfte Pegelkompensation: lange Fahnen sollen nicht übermäßig lauter werden
    this.levelComp = Math.min(1.3, Math.max(0.55, Math.pow(T60 / 3, -0.17)));

    // Dämpfung: HF-Decay-Verhältnis (Jot), modusabhängige Färbung
    let damp = p.damping + (this.mode === MODE_DARK ? 0.22 : this.mode === MODE_LIGHT ? -0.18 : 0);
    damp = Math.min(1, Math.max(0, damp));
    const ratio = 1 - 0.93 * Math.pow(damp, 0.85);

    // Größe (langsam geglättet → leichtes Tape-Pitching beim Drehen)
    this.size += (p.size - this.size) * (1 - Math.exp(-len / (0.25 * fs)));
    const size = this.size;

    // Modulation
    const mdT = (0.00009 + p.depth * p.depth * 0.0052) * fs;
    this.md += (mdT - this.md) * (1 - Math.exp(-len / (0.05 * fs)));
    const md = Math.min(this.mdMax, this.md);
    const w = (2 * Math.PI * p.rate * len) / fs;

    for (let i = 0; i < N; i++) {
      const L = this.base[i] * size;
      const g = Math.pow(10, (-3 * L) / (fs * T60));
      const ghf = Math.pow(10, (-3 * L) / (fs * T60 * ratio));
      let b = (g - ghf) / (g + ghf);
      const ge = g + (1 - g) * fz;
      b *= 1 - fz;
      this.g[i] = ge;
      this.b[i] = b;
      this.gb[i] = ge * (1 - b);
      this.dA[i] = this.dB[i];
      this.lfoPh[i] += w * this.lfoMul[i];
      if (this.lfoPh[i] > 2 * Math.PI) this.lfoPh[i] -= 2 * Math.PI;
      this.dB[i] = L - 1 + md * (1 + Math.sin(this.lfoPh[i]));
      if (this.dA[i] === 0) this.dA[i] = this.dB[i];
    }

    // Filter: bipolarer Filter-Regler + Low Cut + Lo-Fi-Bandbreite
    const f = Math.min(1, Math.max(-1, p.filter));
    let lp = f < 0 ? 20000 * Math.pow(300 / 20000, -f) : 20000;
    let hp = f > 0 ? 20 * Math.pow(2500 / 20, f) : 20;
    hp = Math.max(hp, p.lowcut);
    if (p.lofi > 0) {
      lp = Math.min(lp, 20000 * Math.pow(2600 / 20000, p.lofi));
      hp = Math.max(hp, 20 * Math.pow(220 / 20, p.lofi));
    }
    const kf = 1 - Math.exp(-len / (0.03 * fs));
    this.fLp += (lp - this.fLp) * kf;
    this.fHp += (hp - this.fHp) * kf;
    svfCoefs(this.lpC, this.fLp, 0.75, fs);
    svfCoefs(this.hpC, this.fHp, 0.72, fs);

    // Stretch: Gewichte der Bloom-Taps
    const st = Math.min(1, Math.max(0, p.stretch));
    if (Math.abs(st - this.stretchCached) > 1e-4) {
      this.stretchCached = st;
      const Ts = 0.06 + 2.6 * Math.pow(st, 1.6);
      let e = 0;
      for (let k = 0; k < STRETCH_TAPS; k++) {
        const t = this.tapT[k];
        const prev = k ? this.tapT[k - 1] : 0;
        const r = t <= Ts ? Math.pow(t / Ts, 1.2) : Math.exp(-(t - Ts) / (0.3 * Ts));
        const wk = r * Math.sqrt(t - prev);
        this.tapW[k] = wk;
        e += wk * wk;
      }
      const nrm = e > 0 ? 1 / Math.sqrt(e) : 0;
      for (let k = 0; k < STRETCH_TAPS; k++) this.tapW[k] *= nrm;
    }
    const smT = st <= 0.02 ? 0 : Math.min(1, (st - 0.02) / 0.13);
    this.smA = this.stretchMix;
    this.stretchMix += (smT - this.stretchMix) * (1 - Math.exp(-len / (0.05 * fs)));

    // Shimmer-AGC gegen Aufschaukeln
    const rms = Math.sqrt(this.tankMs);
    const agcT = rms > 0.22 ? 0.22 / rms : 1;
    this.shimAgc += (agcT - this.shimAgc) * (agcT < this.shimAgc ? 0.2 : 0.01);

    // Ducking-Gain
    const duck = p.duck;
    if (duck > 0) {
      const lvl = 20 * Math.log10(this.duckEnv + 1e-9);
      const amt = Math.min(1, Math.max(0, (lvl + 54) / 30));
      const target = 1 - duck * 0.94 * amt;
      const kd = target < this.duckG ? 1 - Math.exp(-len / (0.015 * fs)) : 1 - Math.exp(-len / (0.45 * fs));
      this.duckG += (target - this.duckG) * kd;
    } else {
      this.duckG += (1 - this.duckG) * 0.05;
    }

    // Wet-Modulation (Vibrato / Wow & Flutter)
    this.vibW = (2 * Math.PI * p.vibRate) / fs;
    this.wowW = (2 * Math.PI * 0.55) / fs;
    this.flutW = (2 * Math.PI * 6.3) / fs;
    this.satD = 1 + 6 * p.lofi;
    this.satAmt = Math.min(1, p.lofi * 3);
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const oL = out[0], oR = out[1] || out[0];
    const n = oL.length;
    const inp = inputs[0];
    const has = inp && inp.length > 0;
    const iL = has ? inp[0] : null;
    const iR = has ? inp[1] || inp[0] : null;

    const fs = this.fs, sv = this.sv, tv = this.tv, sk = this.sk;
    const lines = this.lines, f = this.f, g = this.g, gb = this.gb, b = this.b;
    const lp = this.lp, dcx = this.dcx, dcy = this.dcy, cL = this.cL, cR = this.cR, hL = this.hL, hR = this.hR;
    const [lookL, lookR] = this.look, [latL, latR] = this.latch, [preL, preR] = this.pre, [strL, strR] = this.str;
    const [rainLd, rainRd] = this.rain, [wmL, wmR] = this.wetMod;
    const [diffL, diffR] = this.diff, [blL, blR] = this.bloom;
    const tapL = this.tapL, tapR = this.tapR, tapW = this.tapW;
    const svf = this.svf, lpC = this.lpC, hpC = this.hpC;
    const dcR = this.dcR, dcN = (1 + dcR) * 0.5;
    const kFa = 1 - Math.exp(-1 / (0.0003 * fs)), kFr = 1 - Math.exp(-1 / (0.025 * fs));
    const kS = 1 - Math.exp(-1 / (0.12 * fs));
    const kDa = 1 - Math.exp(-1 / (0.004 * fs)), kDr = Math.exp(-1 / (0.3 * fs));
    const kTank = 1 - Math.exp(-1 / (0.2 * fs));
    const shimHpA = Math.exp((-2 * Math.PI * 160) / fs);
    const shimLpA = 1 - Math.exp((-2 * Math.PI * 7000) / fs);
    const rainLpA = 1 - Math.exp((-2 * Math.PI * 5200) / fs);
    const wmBase = WETMOD_BASE_SEC * fs;
    const outScale = 0.34;
    let anti = 1e-20;

    for (let off = 0; off < n; off += CHUNK) {
      const end = Math.min(n, off + CHUNK);
      const len = end - off;
      this.updateChunk(len);
      const invLen = 1 / len;
      const diffG = this.diffG, smA = this.smA, smB = this.stretchMix;
      const satD = this.satD, satAmt = this.satAmt, width = this.widthAmt;
      const duckG = this.duckG;
      const a1 = lpC[0], a2 = lpC[1], a3 = lpC[2];
      const h1 = hpC[0], h2 = hpC[1], h3 = hpC[2], hk = hpC[3];
      const shimAgc = this.shimAgc, levelComp = this.levelComp;
      const active = !(this.cleared && sv[S_WET] < 1e-5);

      for (let i = off; i < end; i++) {
        const t = (i - off + 1) * invLen;
        // ---- Glättung ----
        for (let s = 0; s < S_COUNT; s++) sv[s] += (tv[s] - sv[s]) * sk[s];

        // ---- Eingang ----
        let xl = has ? iL[i] : 0, xr = has ? iR[i] : 0;
        const im = this.inputMode;
        if (im === 1) xr = xl;
        else if (im === 2) xl = xr;
        else if (im === 3) xl = xr = 0.5 * (xl + xr);
        xl *= sv[S_IN];
        xr *= sv[S_IN];
        const axl = xl < 0 ? -xl : xl, axr = xr < 0 ? -xr : xr;
        if (axl > this.pk[0]) this.pk[0] = axl;
        if (axr > this.pk[1]) this.pk[1] = axr;
        const am = axl > axr ? axl : axr;

        // ---- Onset-Erkennung (Rise / Dream) ----
        this.envF += (am > this.envF ? kFa : kFr) * (am - this.envF);
        this.envS += kS * (this.envF - this.envS);
        if (this.holdoff > 0) this.holdoff--;
        else if (this.envF > this.onThr && this.envF > this.envS * this.onRatio) {
          this.holdoff = (0.09 * fs) | 0;
          this.onsetFlag = true;
          if (sv[S_BP] < 0.5) {
            if (this.mode === MODE_RISE) this.swellPos = 0;
            if (this.mode === MODE_DREAM && sv[S_FZ] < 0.5) this.latchTimer = this.latchLen;
          }
        }
        // Ducking-Hüllkurve
        this.duckEnv = am > this.duckEnv ? this.duckEnv + (am - this.duckEnv) * kDa : this.duckEnv * kDr;

        // ---- Rise: Lookahead + Swell ----
        lookL.push(xl);
        lookR.push(xr);
        const rise = sv[S_RISE];
        const xdL = xl + (lookL.tap(this.lookLen) - xl) * rise;
        const xdR = xr + (lookR.tap(this.lookLen) - xr) * rise;
        if (this.swellPos < 1) this.swellPos += this.swellInc;
        const sp = this.swellPos < 1 ? Math.sin(this.swellPos * Math.PI * 0.5) : 1;
        const swellG = sp * sp;
        const sendRise = 1 - rise * (1 - swellG);
        const dryRise = 1 - sv[S_DRYSWELL] * (1 - swellG);
        const dryL = xdL * dryRise, dryR = xdR * dryRise;

        let wetL = 0, wetR = 0;
        if (active) {
          let sL = xdL * sendRise, sR = xdR * sendRise;

          // ---- Dark: Sub-Oktave ----
          if (sv[S_OCT] > 1e-5 || tv[S_OCT] > 0) {
            const oct = this.oct.process(0.5 * (xdL + xdR), this.octRatio) * sv[S_OCT];
            sL += oct;
            sR += oct;
          }

          // ---- Rain: diffundierendes Ping-Pong-Delay ----
          let rainOL = 0, rainOR = 0;
          if (sv[S_RAIN] > 1e-5 || tv[S_RAIN] > 0) {
            if (!this.rainOn) {
              this.rainOn = true;
              for (const d of this.rain) d.clear();
              for (const a of this.rainAp) a.clear();
              this.rainLp[0] = this.rainLp[1] = 0;
            }
            const rT = sv[S_RAINT];
            const rdL = rainLd.tapH(rT), rdR = rainRd.tapH(rT);
            const fb = sv[S_RAINFB];
            this.rainLp[0] += (rdR - this.rainLp[0]) * rainLpA;
            this.rainLp[1] += (rdL - this.rainLp[1]) * rainLpA;
            const rin = 0.5 * (sL + sR) * (1 - sv[S_BP]) * sv[S_RAIN];
            rainLd.push(rin + fb * this.rainAp[0].process(this.rainLp[0], 0.55) + anti);
            rainRd.push(fb * this.rainAp[1].process(this.rainLp[1], 0.55));
            rainOL = rdL * sv[S_RAIN];
            rainOR = rdR * sv[S_RAIN];
            sL += rainOL * 0.85;
            sR += rainOR * 0.85;
          } else {
            this.rainOn = false;
          }

          // ---- Light: Shimmer-Feedback ----
          if (sv[S_SHIM] > 1e-5 || tv[S_SHIM] > 0) {
            const shx = this.shimPrev;
            this.shimHp = shimHpA * (this.shimHp + shx - this.shimHpX);
            this.shimHpX = shx;
            let sh = this.shim.process(this.shimHp, this.shimRatio);
            this.shimLp += (sh - this.shimLp) * shimLpA;
            sh = this.shimLp * sv[S_SHIM] * shimAgc * (1 - sv[S_FZ]);
            if (sh > 0.8 || sh < -0.8) sh = 0.8 * Math.tanh(sh / 0.8);
            sL += sh;
            sR -= sh;
          }

          // ---- Dream: Latch-Delay (neues Pad nach dem Clear) ----
          latL.push(sL);
          latR.push(sR);
          const la = sv[S_LATCH];
          sL += (latL.tap(this.latchLen) - sL) * la;
          sR += (latR.tap(this.latchLen) - sR) * la;

          // ---- Send-Gain (Bypass / Sustain) ----
          const sg = sv[S_SEND] * (1 - sv[S_FZ]);
          sL *= sg;
          sR *= sg;

          // ---- Pre-Delay ----
          preL.push(sL);
          preR.push(sR);
          const pd = sv[S_PRE];
          let uL = preL.tapH(pd), uR = preR.tapH(pd);

          // ---- Stretch (Bloom) ----
          strL.push(uL);
          strR.push(uR);
          const sm = smA + (smB - smA) * t;
          if (sm > 1e-4) {
            let aL = 0, aR = 0;
            for (let k = 0; k < STRETCH_TAPS; k++) {
              const wk = tapW[k];
              aL += wk * strL.tap(tapL[k]);
              aR += wk * strR.tap(tapR[k]);
            }
            const bg = 0.5 * sm;
            const lfo = Math.sin(this.lfoPh[0]) * 0.0025 * fs;
            aL = blL[1].processMod(blL[0].processMod(aL, bg, 0.0025 * fs + lfo), bg, 0.0025 * fs - lfo);
            aR = blR[1].processMod(blR[0].processMod(aR, bg, 0.0025 * fs - lfo), bg, 0.0025 * fs + lfo);
            uL += (aL - uL) * sm;
            uR += (aR - uR) * sm;
          }

          // ---- Eingangs-Diffusion ----
          for (let k = 0; k < 4; k++) {
            uL = diffL[k].process(uL, diffG);
            uR = diffR[k].process(uR, diffG);
          }

          // ---- FDN ----
          let oLt = 0, oRt = 0;
          for (let k = 0; k < N; k++) {
            const d = this.dA[k] + (this.dB[k] - this.dA[k]) * t;
            const y = lines[k].tapH(d);
            oLt += cL[k] * y;
            oRt += cR[k] * y;
            // frequenzabhängige Dämpfung (One-Pole, DC-Gain g, Nyquist-Gain g_hf)
            const l = gb[k] * y + b[k] * lp[k];
            lp[k] = l;
            // DC-Blocker (Nyquist-normalisiert)
            const hy = dcN * (l - dcx[k]) + dcR * dcy[k];
            dcx[k] = l;
            dcy[k] = hy;
            f[k] = hy;
          }
          // schnelle Walsh-Hadamard-Transformation (orthogonal, /4)
          for (let h = 1; h < N; h <<= 1) {
            for (let a = 0; a < N; a += h << 1) {
              for (let j = a; j < a + h; j++) {
                const x0 = f[j], x1 = f[j + h];
                f[j] = x0 + x1;
                f[j + h] = x0 - x1;
              }
            }
          }
          anti = -anti;
          for (let k = 0; k < N; k++) {
            let v = f[k] * 0.25 + 0.5 * (uL * hL[k] + uR * hR[k]) + anti;
            if (v > 2.5 || v < -2.5) v = 2.5 * Math.tanh(v / 2.5);
            lines[k].push(v);
          }
          wetL = oLt * outScale * levelComp;
          wetR = oRt * outScale * levelComp;
          this.shimPrev = 0.5 * (wetL + wetR);
          this.tankMs += (0.5 * (wetL * wetL + wetR * wetR) - this.tankMs) * kTank;
          wetL += rainOL * 0.45;
          wetR += rainOR * 0.45;

          // ---- Vibrato / Wow & Flutter ----
          wmL.push(wetL);
          wmR.push(wetR);
          const vib = sv[S_VIB], wow = sv[S_WOW];
          if (vib > 0.01 || wow > 0.01) {
            this.vibPh += this.vibW;
            if (this.vibPh > 6.283185307179586) this.vibPh -= 6.283185307179586;
            this.wowPh += this.wowW;
            if (this.wowPh > 6.283185307179586) this.wowPh -= 6.283185307179586;
            this.flutPh += this.flutW;
            if (this.flutPh > 6.283185307179586) this.flutPh -= 6.283185307179586;
            const wv = wow * (Math.sin(this.wowPh) + 0.12 * Math.sin(this.flutPh));
            wetL = wmL.tapH(wmBase + vib * Math.sin(this.vibPh) + wv);
            wetR = wmR.tapH(wmBase + vib * Math.cos(this.vibPh) + wow * (Math.cos(this.wowPh * 0.93) + 0.12 * Math.cos(this.flutPh)));
          } else {
            wetL = wmL.tap(wmBase | 0);
            wetR = wmR.tap(wmBase | 0);
          }

          // ---- Lo-Fi-Sättigung ----
          if (satAmt > 0) {
            wetL += (Math.tanh(satD * wetL) / satD - wetL) * satAmt;
            wetR += (Math.tanh(satD * wetR) / satD - wetR) * satAmt;
          }

          // ---- Filter (SVF LP → HP) ----
          {
            let v3 = wetL - svf[1];
            let v1 = a1 * svf[0] + a2 * v3;
            let v2 = svf[1] + a2 * svf[0] + a3 * v3;
            svf[0] = 2 * v1 - svf[0];
            svf[1] = 2 * v2 - svf[1];
            wetL = v2;
            v3 = wetR - svf[3];
            v1 = a1 * svf[2] + a2 * v3;
            v2 = svf[3] + a2 * svf[2] + a3 * v3;
            svf[2] = 2 * v1 - svf[2];
            svf[3] = 2 * v2 - svf[3];
            wetR = v2;
            v3 = wetL - svf[5];
            v1 = h1 * svf[4] + h2 * v3;
            v2 = svf[5] + h2 * svf[4] + h3 * v3;
            svf[4] = 2 * v1 - svf[4];
            svf[5] = 2 * v2 - svf[5];
            wetL = wetL - hk * v1 - v2;
            v3 = wetR - svf[7];
            v1 = h1 * svf[6] + h2 * v3;
            v2 = svf[7] + h2 * svf[6] + h3 * v3;
            svf[6] = 2 * v1 - svf[6];
            svf[7] = 2 * v2 - svf[7];
            wetR = wetR - hk * v1 - v2;
          }

          // ---- Ducking & Width ----
          wetL *= duckG;
          wetR *= duckG;
          const mid = 0.5 * (wetL + wetR), side = 0.5 * (wetL - wetR) * width;
          wetL = mid + side;
          wetR = mid - side;
        }

        // ---- Mix & Ausgang ----
        const wg = sv[S_WET], dg = sv[S_DRY], og = sv[S_OUT];
        let yl = (dryL * dg + wetL * wg) * og;
        let yr = (dryR * dg + wetR * wg) * og;
        // weicher Sicherheits-Limiter ab -2 dBFS
        if (yl > 0.8 || yl < -0.8) yl = (yl > 0 ? 1 : -1) * (0.8 + 0.2 * Math.tanh((Math.abs(yl) - 0.8) / 0.2));
        if (yr > 0.8 || yr < -0.8) yr = (yr > 0 ? 1 : -1) * (0.8 + 0.2 * Math.tanh((Math.abs(yr) - 0.8) / 0.2));
        oL[i] = yl;
        if (oR !== oL) oR[i] = yr;
        const ayl = yl < 0 ? -yl : yl, ayr = yr < 0 ? -yr : yr;
        if (ayl > this.pk[2]) this.pk[2] = ayl;
        if (ayr > this.pk[3]) this.pk[3] = ayr;
      }
    }

    // Trails aus + Bypass: Tank leeren, sobald ausgeblendet
    if (this.p.bypass && !this.p.trails && !this.cleared && sv[S_WET] < 1e-4) {
      this.clearAll();
      this.cleared = true;
    }

    // NaN-Schutz
    if (!Number.isFinite(oL[n - 1]) || !Number.isFinite(oR[n - 1])) {
      this.clearAll();
      oL.fill(0);
      oR.fill(0);
    }

    this.meterCount += n;
    if (this.meterCount >= this.meterEvery) {
      this.meterCount = 0;
      this.port.postMessage({
        type: 'meter',
        inL: this.pk[0], inR: this.pk[1], outL: this.pk[2], outR: this.pk[3],
        tank: Math.sqrt(this.tankMs), onset: this.onsetFlag, freeze: sv[S_FZ], duck: this.duckG,
        swell: this.swellPos < 1 ? this.swellPos : 1, latch: this.latchTimer > 0,
      });
      this.pk.fill(0);
      this.onsetFlag = false;
    }
    return true;
  }
}

registerProcessor('da-hall-reverb', DaHallProcessor);
