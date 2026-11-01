// VFD-artige Anzeige im Pedal: Modus, letzte Reglerbewegung, Spektrum, Pegel, Status.

export class Display {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.mode = { name: '', desc: '' };
    this.readout = null; // { label, value, until }
    this.status = { bypass: false, sustain: false, latch: false, swell: 1, onsetAt: 0, playing: false, live: false };
    this.meter = { inL: 0, inR: 0, outL: 0, outR: 0 };
    this.hold = { inL: 0, inR: 0, outL: 0, outR: 0 };
    this.analyser = null;
    this.spec = null;
    this.smooth = null;
    this.hint = 'DEMO ABSPIELEN, UM ZU HÖREN';
    const css = getComputedStyle(document.documentElement);
    this.col = {
      fg: css.getPropertyValue('--vfd').trim() || '#ffc46b',
      dim: css.getPropertyValue('--vfd-dim').trim() || '#7a5a2a',
      bg: css.getPropertyValue('--vfd-bg').trim() || '#120c05',
      hot: css.getPropertyValue('--vfd-hot').trim() || '#fff1d6',
    };
    this.font = css.getPropertyValue('--font-mono').trim() || 'monospace';
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(10, r.width);
    this.h = Math.max(10, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setAnalyser(a) {
    this.analyser = a;
    this.spec = new Float32Array(a.frequencyBinCount);
  }

  showValue(label, value) {
    this.readout = { label, value, until: performance.now() + 1600 };
  }

  setMeter(m) {
    for (const k of ['inL', 'inR', 'outL', 'outR']) {
      this.meter[k] = Math.max(m[k], this.meter[k] * 0.6);
      this.hold[k] = Math.max(m[k], this.hold[k] * 0.97);
    }
    this.status.latch = m.latch;
    this.status.swell = m.swell;
    if (m.onset) this.status.onsetAt = performance.now();
  }

  draw() {
    const g = this.ctx2d, w = this.w, h = this.h, c = this.col;
    const now = performance.now();
    g.clearRect(0, 0, w, h);
    g.fillStyle = c.bg;
    g.fillRect(0, 0, w, h);
    const pad = Math.max(10, w * 0.035);
    const meterW = 34;
    const plotR = w - pad - meterW - 10;

    // ---- Spektrum ----
    const top = h * 0.42, bottom = h - pad - 4;
    if (this.analyser && this.status.playing !== null) {
      this.analyser.getFloatFrequencyData(this.spec);
      const sr = this.analyser.context.sampleRate;
      const bins = this.spec.length;
      const pts = 96;
      if (!this.smooth) this.smooth = new Float32Array(pts).fill(-120);
      for (let i = 0; i < pts; i++) {
        const f = 30 * Math.pow(16000 / 30, i / (pts - 1));
        const b = Math.min(bins - 1, Math.round((f / (sr / 2)) * bins));
        const b2 = Math.min(bins - 1, Math.round(((f * 1.06) / (sr / 2)) * bins));
        let m = -140;
        for (let k = b; k <= b2; k++) m = Math.max(m, this.spec[k]);
        // leichte Tilt-Kompensation (+3 dB/Oktave), damit Höhen sichtbar bleiben
        m += 3 * Math.log2(f / 1000);
        this.smooth[i] += (m - this.smooth[i]) * (this.reduced ? 1 : 0.35);
      }
    }
    // Raster
    g.strokeStyle = c.dim;
    g.globalAlpha = 0.35;
    g.lineWidth = 1;
    g.setLineDash([2, 4]);
    for (const f of [100, 1000, 10000]) {
      const x = pad + ((plotR - pad) * Math.log(f / 30)) / Math.log(16000 / 30);
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x, bottom);
      g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    g.font = `500 9px ${this.font}`;
    g.fillStyle = c.dim;
    g.textBaseline = 'alphabetic';
    for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k']]) {
      const x = pad + ((plotR - pad) * Math.log(f / 30)) / Math.log(16000 / 30);
      g.fillText(t, x + 3, bottom - 2);
    }
    if (this.smooth) {
      g.beginPath();
      for (let i = 0; i < this.smooth.length; i++) {
        const x = pad + ((plotR - pad) * i) / (this.smooth.length - 1);
        const v = Math.min(1, Math.max(0, (this.smooth[i] + 100) / 80));
        const y = bottom - v * (bottom - top);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = c.fg;
      g.lineWidth = 1.6;
      g.shadowColor = c.fg;
      g.shadowBlur = 8;
      g.stroke();
      g.shadowBlur = 0;
      g.lineTo(plotR, bottom);
      g.lineTo(pad, bottom);
      g.closePath();
      g.globalAlpha = 0.12;
      g.fillStyle = c.fg;
      g.fill();
      g.globalAlpha = 1;
    }

    // ---- Pegel (IN L/R, OUT L/R) ----
    const mx = w - pad - meterW;
    const mTop = pad + 2, mBot = h - pad - 14;
    const bars = [['inL', 'I'], ['inR', ''], ['outL', 'O'], ['outR', '']];
    bars.forEach(([k, lab], i) => {
      const x = mx + i * 8 + (i >= 2 ? 4 : 0);
      const dbv = 20 * Math.log10(this.meter[k] + 1e-9);
      const v = Math.min(1, Math.max(0, (dbv + 60) / 60));
      const hv = Math.min(1, Math.max(0, (20 * Math.log10(this.hold[k] + 1e-9) + 60) / 60));
      g.fillStyle = c.dim;
      g.globalAlpha = 0.3;
      g.fillRect(x, mTop, 5, mBot - mTop);
      g.globalAlpha = 1;
      const segs = 20;
      for (let s = 0; s < segs; s++) {
        if (s / segs >= v) break;
        g.fillStyle = s >= segs - 2 ? c.hot : c.fg;
        const sh = (mBot - mTop) / segs;
        g.fillRect(x, mBot - (s + 1) * sh + 1, 5, sh - 1.5);
      }
      g.fillStyle = c.hot;
      g.fillRect(x, mBot - hv * (mBot - mTop), 5, 1.5);
      if (lab) {
        g.fillStyle = c.dim;
        g.font = `600 9px ${this.font}`;
        g.fillText(lab, x + 4, h - pad + 1);
      }
    });

    // ---- Text ----
    const big = Math.min(30, Math.max(18, w * 0.055));
    const ro = this.readout && this.readout.until > now ? this.readout : null;
    g.textBaseline = 'top';
    g.fillStyle = c.fg;
    g.shadowColor = c.fg;
    g.shadowBlur = 10;
    if (ro) {
      g.font = `600 11px ${this.font}`;
      g.fillStyle = c.dim;
      g.shadowBlur = 0;
      g.fillText(ro.label, pad, pad);
      g.fillStyle = c.fg;
      g.shadowBlur = 10;
      g.font = `600 ${big}px ${this.font}`;
      g.fillText(ro.value, pad, pad + 16);
    } else {
      g.font = `600 ${big}px ${this.font}`;
      g.fillText(this.mode.name, pad, pad + 2);
      g.shadowBlur = 0;
      g.font = `500 11px ${this.font}`;
      g.fillStyle = c.dim;
      g.fillText(this.status.playing ? this.mode.desc.toUpperCase() : this.hint, pad, pad + big + 8);
    }
    g.shadowBlur = 0;

    // Status-Chips rechts oben (vor den Metern)
    const chips = [];
    if (this.status.bypass) chips.push('BYPASS');
    if (this.status.sustain) chips.push('SUSTAIN ∞');
    if (this.status.latch) chips.push('LATCH');
    if (this.status.swell < 1) chips.push(`SWELL ${Math.round(this.status.swell * 100)}%`);
    if (this.status.live) chips.push('LIVE');
    g.font = `600 10px ${this.font}`;
    let cx = mx - 10;
    for (const t of chips) {
      const tw = g.measureText(t).width + 10;
      cx -= tw;
      g.strokeStyle = c.fg;
      g.lineWidth = 1;
      g.strokeRect(cx + 0.5, pad + 0.5, tw, 16);
      g.fillStyle = c.fg;
      g.fillText(t, cx + 5, pad + 4);
      cx -= 6;
    }
    // Anschlag-Punkt
    const age = now - this.status.onsetAt;
    if (age < 160) {
      g.fillStyle = c.hot;
      g.beginPath();
      g.arc(mx - 16, h - pad - 6, 3, 0, Math.PI * 2);
      g.fill();
    }

    // Scanlines für den VFD-Look
    g.globalAlpha = 0.07;
    g.fillStyle = '#000';
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
    g.globalAlpha = 1;
  }
}
