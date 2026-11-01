import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProcessor, rms, db, rt60, noise } from './harness.mjs';

const FS = 48000;
const WET_ONLY = { mix: 1, killDry: 1, stretch: 0, predelay: 0.001, filter: 0, lowcut: 20, width: 2 };

function impulse(n) {
  const x = new Float32Array(n);
  x[0] = 1;
  return x;
}

function peak(a) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
}

test('RT60 folgt dem Decay-Regler (±20 %)', () => {
  for (const decay of [1, 3, 8]) {
    const h = loadProcessor(FS, { ...WET_ONLY, decay, mode: 4, shimmer: 0, damping: 0 });
    const [L] = h.run(impulse(Math.round(FS * (decay * 1.6 + 1))));
    const est = rt60(L, FS);
    assert.ok(Math.abs(est - decay) / decay < 0.2, `decay ${decay}s → gemessen ${est.toFixed(2)}s`);
  }
});

test('alle Modi bleiben bei Extremwerten stabil und endlich', () => {
  for (let mode = 0; mode < 5; mode++) {
    const h = loadProcessor(FS, {
      mode, decay: 40, mix: 1, depth: 1, stretch: 1, diffusion: 1, damping: 0, size: 1.6,
      octLevel: 1, octSemis: -24, shimmer: 1, shimSemis: 12, rainFb: 0.93, rainTime: 0.05,
      vibDepth: 1, vibRate: 0.5, lofi: 1, duck: 1, swellTime: 0.05, drySwell: 1, inGain: 4,
    });
    const x = noise(FS * 8, 0.9, mode + 1);
    const [L, R] = h.run(x, noise(FS * 8, 0.9, mode + 11));
    for (const ch of [L, R]) {
      assert.ok(ch.every(Number.isFinite), `Modus ${mode}: NaN/Inf im Ausgang`);
      assert.ok(peak(ch) <= 1.0 + 1e-6, `Modus ${mode}: Ausgang über 0 dBFS (${peak(ch)})`);
    }
    // Nach dem Signal muss die Fahne ausklingen und darf nicht explodieren
    const [tL] = h.run(new Float32Array(FS * 4));
    assert.ok(tL.every(Number.isFinite));
    assert.ok(rms(tL, FS * 3) < 0.6, `Modus ${mode}: Fahne schaukelt sich auf`);
  }
});

test('Shimmer-Feedback schaukelt sich auch bei langem Decay nicht auf', () => {
  const h = loadProcessor(FS, { ...WET_ONLY, mode: 4, decay: 40, damping: 0, shimmer: 1, shimSemis: 12 });
  h.run(noise(FS * 2, 0.5, 3));
  const [L] = h.run(new Float32Array(FS * 20));
  const late = rms(L, FS * 15, FS * 20);
  assert.ok(late < 0.35, `RMS am Ende ${late}`);
});

test('Sustain hält die Fahne, Loslassen lässt sie ausklingen', () => {
  const h = loadProcessor(FS, { ...WET_ONLY, mode: 4, shimmer: 0, decay: 1.5 });
  h.run(noise(FS, 0.3, 5));
  h.set({ sustain: 1 });
  const [a] = h.run(new Float32Array(FS * 6));
  const early = rms(a, FS * 0.5, FS * 1.5);
  const late = rms(a, FS * 5, FS * 6);
  assert.ok(early > 1e-3, 'Sustain hat nichts eingefangen');
  assert.ok(db(late) - db(early) > -3, `Sustain verliert zu viel Pegel: ${(db(late) - db(early)).toFixed(1)} dB`);
  // neue Noten gehen im Sustain nicht in den Tank
  h.set({ sustain: 0 });
  const [b] = h.run(new Float32Array(FS * 5));
  assert.ok(rms(b, FS * 4, FS * 5) < late * 0.01, 'nach dem Loslassen klingt die Fahne nicht aus');
});

test('Bypass gibt das trockene Signal unverändert aus, Trails klingen weiter', () => {
  const h = loadProcessor(FS, { mode: 4, shimmer: 0, decay: 4, mix: 0.5, trails: 1 });
  h.run(noise(FS, 0.3, 9));
  h.set({ bypass: 1 });
  h.run(new Float32Array(FS * 0.1)); // Überblendung abwarten
  const x = noise(FS / 2, 0.1, 4);
  const [L] = h.run(x);
  // Trails: Wet-Anteil ist noch da → Differenz zum Dry > 0
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff += (L[i] - x[i]) ** 2;
  assert.ok(Math.sqrt(diff / x.length) > 1e-3, 'Trails fehlen');

  const h2 = loadProcessor(FS, { mode: 4, shimmer: 0, decay: 4, mix: 0.5, trails: 0 });
  h2.run(noise(FS, 0.3, 9));
  h2.set({ bypass: 1 });
  h2.run(new Float32Array(FS * 0.5)); // Ausblenden (30 ms Glättung) + Tank-Clear abwarten
  const [L2] = h2.run(x);
  let err = 0;
  for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(L2[i] - x[i]));
  assert.ok(err < 1e-6, `Bypass ohne Trails nicht transparent (max. Fehler ${err})`);
});

test('Kill Dry entfernt das Direktsignal', () => {
  const h = loadProcessor(FS, { ...WET_ONLY, predelay: 0.2, mode: 4, shimmer: 0 });
  const x = impulse(FS * 0.1);
  const [L] = h.run(x);
  assert.ok(Math.abs(L[0]) < 1e-6 && Math.abs(L[1]) < 1e-6);
});

test('Eingangsrouting: Mono L speist beide Seiten', () => {
  const h = loadProcessor(FS, { ...WET_ONLY, inputMode: 1, mode: 4, shimmer: 0 });
  const [L, R] = h.run(noise(FS, 0.3, 2), new Float32Array(FS));
  assert.ok(rms(R, FS / 2) > 0.3 * rms(L, FS / 2));
});

test('Rise: Swell lässt das Reverb nach einem Anschlag anschwellen', () => {
  const h = loadProcessor(FS, { ...WET_ONLY, mode: 1, swellTime: 1.2, decay: 3, sens: 0.6 });
  h.run(new Float32Array(FS / 10));
  // gezupfter Ton: kurzer Anschlag + ausklingendes Sinus-Sustain
  const n = FS * 2;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.exp(-i / (FS * 1.5)) * Math.sin((2 * Math.PI * 220 * i) / FS);
  const [L] = h.run(x);
  const first = rms(L, 0, FS * 0.15);
  const later = rms(L, FS * 1.0, FS * 1.4);
  assert.ok(later > first * 2, `kein Anschwellen: ${db(first).toFixed(1)} → ${db(later).toFixed(1)} dB`);
});

test('Dream: neuer Anschlag ersetzt das gehaltene Pad (Latch)', () => {
  const h = loadProcessor(FS, { ...WET_ONLY, mode: 2, decay: 12, vibDepth: 0, sens: 0.6 });
  const tone = (f, len) => {
    const a = new Float32Array(len);
    for (let i = 0; i < len; i++) a[i] = (i < 64 ? 0.9 : 0.3) * Math.exp(-i / (FS * 0.4)) * Math.sin((2 * Math.PI * f * i) / FS);
    return a;
  };
  h.run(tone(330, FS));
  h.run(new Float32Array(FS)); // Pad hält
  const [held] = h.run(new Float32Array(FS / 4));
  const heldLvl = rms(held);
  assert.ok(heldLvl > 1e-3, 'Pad hält nicht');
  // kurzer Klick löst Latch aus → altes Pad wird geleert, bevor das neue kommt
  const click = new Float32Array(FS / 2);
  click[0] = 0.9;
  click[1] = -0.9;
  const [after] = h.run(click);
  const dip = rms(after, Math.round(FS * 0.1), Math.round(FS * 0.14));
  assert.ok(dip < heldLvl * 0.3, `Latch leert das Pad nicht (${db(heldLvl).toFixed(1)} → ${db(dip).toFixed(1)} dB)`);
});

test('Clear-Nachricht leert den Hall sofort', () => {
  const h = loadProcessor(FS, { ...WET_ONLY, mode: 4, shimmer: 0, decay: 10 });
  h.run(noise(FS, 0.4, 1));
  h.clear();
  const [L] = h.run(new Float32Array(FS / 2));
  assert.ok(peak(L) < 1e-6);
});

test('funktioniert bei 44.1 kHz und 96 kHz', () => {
  for (const fs of [44100, 96000]) {
    const h = loadProcessor(fs, { ...WET_ONLY, decay: 2, mode: 4, shimmer: 0.5 });
    const [L] = h.run(impulse(fs * 3));
    assert.ok(L.every(Number.isFinite));
    const est = rt60(L, fs);
    assert.ok(est > 1.2 && est < 3.2, `${fs} Hz: RT60 ${est}`);
  }
});
