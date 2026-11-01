// Parameter-Definitionen: normalisierte Reglerwerte (0..1) ↔ reale Einheiten für die DSP.

const expMap = (min, max) => (v) => min * Math.pow(max / min, v);
const lin = (min, max) => (v) => min + (max - min) * v;

const fmtTime = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`);
const fmtHz = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`);
const fmtPct = (v) => `${Math.round(v * 100)} %`;
const fmtDb = (db) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;
const fmtSemis = (st) => `${st > 0 ? '+' : '−'}${Math.abs(st)} HT`;

const stepPick = (arr) => (v) => arr[Math.min(arr.length - 1, Math.floor(v * arr.length))];

export const DARK_INTERVALS = [-5, -7, -12, -24];
export const LIGHT_INTERVALS = [5, 7, 12, 19, 24];

/** Die fünf Algorithmen. x / y sind modusabhängige Regler. */
export const MODES = [
  {
    id: 'dark',
    name: 'DARK',
    desc: 'Dunkler Hall mit Sub-Oktave darunter',
    x: { label: 'SUB', long: 'Pegel der tiefen Oktave', fmt: (v) => fmtPct(v) },
    y: { label: 'INTERVALL', long: 'Intervall des Sub-Tons', fmt: (v) => fmtSemis(stepPick(DARK_INTERVALS)(v)), steps: DARK_INTERVALS.length },
  },
  {
    id: 'rise',
    name: 'RISE',
    desc: 'Hall schwillt nach jedem Anschlag an',
    x: { label: 'SWELL', long: 'Anschwellzeit', fmt: (v) => fmtTime(expMap(0.05, 4)(v)) },
    y: { label: 'DRY SWELL', long: 'Wie stark das Direktsignal mitschwillt', fmt: (v) => fmtPct(v) },
  },
  {
    id: 'dream',
    name: 'DREAM',
    desc: 'Latch-Pad: hält, bis du neu anschlägst',
    x: { label: 'VIBRATO', long: 'Vibrato-Tiefe auf der Fahne', fmt: (v) => fmtPct(v) },
    y: { label: 'VIB RATE', long: 'Vibrato-Geschwindigkeit', fmt: (v) => `${expMap(0.5, 9)(v).toFixed(1)} Hz` },
  },
  {
    id: 'rain',
    name: 'RAIN',
    desc: 'Diffuse Delays tropfen in den Hall',
    x: { label: 'TIME', long: 'Delay-Zeit', fmt: (v) => fmtTime(expMap(0.04, 1.2)(v)) },
    y: { label: 'REPEATS', long: 'Anzahl der Wiederholungen', fmt: (v) => fmtPct(v) },
  },
  {
    id: 'light',
    name: 'LIGHT',
    desc: 'Shimmer: Oktaven steigen in der Fahne auf',
    x: { label: 'SHIMMER', long: 'Anteil der Pitch-Rückkopplung', fmt: (v) => fmtPct(v) },
    y: { label: 'INTERVALL', long: 'Intervall des Shimmers', fmt: (v) => fmtSemis(stepPick(LIGHT_INTERVALS)(v)), steps: LIGHT_INTERVALS.length },
  },
];

export const RAIN_TIME = { min: 0.04, max: 1.2 };

export const WIDTHS = ['NARROW', 'MEDIUM', 'WIDE'];
export const INPUT_MODES = [
  { id: 0, label: 'Stereo' },
  { id: 1, label: 'Mono (linker Kanal)' },
  { id: 2, label: 'Mono (rechter Kanal)' },
  { id: 3, label: 'Summe L+R' },
];

/**
 * Kontinuierliche Regler. `def` ist der normalisierte Default.
 * `map` liefert den realen Wert, `fmt` den Anzeigetext.
 */
export const PARAMS = {
  // ---- Pedal-Oberfläche ----
  decay: { label: 'DECAY', long: 'Nachhallzeit', def: 0.59, map: expMap(0.4, 40), fmt: (v) => fmtTime(expMap(0.4, 40)(v)) },
  filter: {
    label: 'FILTER', long: 'Links: Tiefpass · Mitte: neutral · Rechts: Hochpass', def: 0.43, bipolar: true,
    map: (v) => v * 2 - 1,
    fmt: (v) => {
      const b = v * 2 - 1;
      if (Math.abs(b) < 0.03) return 'NEUTRAL';
      return b < 0 ? `LP ${fmtHz(20000 * Math.pow(300 / 20000, -b))}` : `HP ${fmtHz(20 * Math.pow(2500 / 20, b))}`;
    },
  },
  depth: { label: 'DEPTH', long: 'Modulationstiefe im Hall', def: 0.35, map: (v) => v, fmt: fmtPct },
  mix: { label: 'MIX', long: 'Dry/Wet (Mitte = beide voll)', def: 0.45, map: (v) => v, fmt: (v) => fmtPct(v) },
  x: { label: 'X', long: 'Modusabhängig', def: 0.5, map: (v) => v, fmt: fmtPct },
  y: { label: 'Y', long: 'Modusabhängig', def: 0.5, map: (v) => v, fmt: fmtPct },
  stretch: { label: 'STRETCH', long: 'Wie langsam sich der Hall aufbaut', def: 0.2, map: (v) => v, fmt: (v) => (v < 0.02 ? 'AUS' : `${fmtTime(0.06 + 2.6 * Math.pow(v, 1.6))} Bloom`) },

  // ---- Erweitert ----
  predelay: { label: 'PRE-DELAY', long: 'Verzögerung vor dem Hall', def: 0.2, map: (v) => 0.5 * v * v, fmt: (v) => `${Math.round(500 * v * v)} ms` },
  size: { label: 'SIZE', long: 'Raumgröße (Länge der Delay-Linien)', def: 0.69, map: expMap(0.35, 1.6), fmt: (v) => `${Math.round(expMap(0.35, 1.6)(v) * 100)} %` },
  rate: { label: 'MOD RATE', long: 'Geschwindigkeit der Modulation', def: 0.48, map: expMap(0.05, 6), fmt: (v) => `${expMap(0.05, 6)(v).toFixed(2)} Hz` },
  damping: { label: 'DAMPING', long: 'Wie schnell Höhen in der Fahne verklingen', def: 0.45, map: (v) => v, fmt: fmtPct },
  lowcut: { label: 'LOW CUT', long: 'Hochpass auf dem Hall', def: 0.41, map: expMap(20, 800), fmt: (v) => fmtHz(expMap(20, 800)(v)) },
  diffusion: { label: 'DIFFUSION', long: 'Dichte der frühen Reflexionen', def: 0.8, map: (v) => v, fmt: fmtPct },
  duck: { label: 'DUCK', long: 'Hall weicht zurück, solange du spielst', def: 0, map: (v) => v, fmt: fmtPct },
  lofi: { label: 'LO-FI', long: 'Bandbreite, Sättigung, Wow & Flutter', def: 0, map: (v) => v, fmt: fmtPct },
  sens: { label: 'TRIGGER', long: 'Anschlagempfindlichkeit für Rise und Dream', def: 0.55, map: (v) => v, fmt: fmtPct },
  inGain: { label: 'INPUT', long: 'Eingangspegel', def: 0.5, map: (v) => Math.pow(10, lin(-24, 24)(v) / 20), fmt: (v) => fmtDb(lin(-24, 24)(v)) },
  outGain: { label: 'OUTPUT', long: 'Ausgangspegel', def: 2 / 3, map: (v) => Math.pow(10, lin(-24, 12)(v) / 20), fmt: (v) => fmtDb(lin(-24, 12)(v)) },
};

/** Diskrete/boolesche Einstellungen mit Defaults. */
export const SWITCH_DEFAULTS = {
  mode: 2,
  width: 2,
  inputMode: 0,
  trails: 1,
  killDry: 0,
};

export function defaultState() {
  const s = {};
  for (const [k, d] of Object.entries(PARAMS)) s[k] = d.def;
  Object.assign(s, SWITCH_DEFAULTS);
  return s;
}

/** Normalisierter UI-Zustand → reale DSP-Parameter. */
export function toEngine(state, live = {}) {
  const P = PARAMS;
  const e = {};
  for (const k of Object.keys(P)) if (k !== 'x' && k !== 'y') e[k] = P[k].map(state[k]);
  e.mode = state.mode;
  e.width = state.width;
  e.inputMode = state.inputMode;
  e.trails = state.trails ? 1 : 0;
  e.killDry = state.killDry ? 1 : 0;
  e.sustain = live.sustain ? 1 : 0;
  e.bypass = live.bypass ? 1 : 0;

  const x = state.x, y = state.y;
  // alle modusabhängigen Werte werden immer gesendet; die DSP nutzt nur die des aktiven Modus
  e.octLevel = x;
  e.octSemis = stepPick(DARK_INTERVALS)(y);
  e.swellTime = expMap(0.05, 4)(x);
  e.drySwell = y;
  e.vibDepth = x;
  e.vibRate = expMap(0.5, 9)(y);
  e.rainTime = expMap(RAIN_TIME.min, RAIN_TIME.max)(x);
  e.rainFb = y * 0.92;
  e.shimmer = x;
  e.shimSemis = stepPick(LIGHT_INTERVALS)(y);
  return e;
}

/** Für Tap-Tempo: Zeit (s) → normalisierter X-Wert im Rain-Modus. */
export function rainTimeToX(sec) {
  let t = sec;
  while (t > RAIN_TIME.max) t /= 2;
  while (t < RAIN_TIME.min) t *= 2;
  return Math.log(t / RAIN_TIME.min) / Math.log(RAIN_TIME.max / RAIN_TIME.min);
}

/** Geschätzte Länge der Hallfahne (s) für den Offline-Export. */
export function tailSeconds(state) {
  const e = toEngine(state);
  const dec = e.decay * (e.mode === 2 ? 1.5 : 1);
  const extra = e.predelay + (state.stretch > 0.02 ? 0.06 + 2.6 * Math.pow(state.stretch, 1.6) : 0) + (e.mode === 3 ? e.rainTime * 6 : 0);
  return Math.min(45, dec * 1.1 + extra + 0.5);
}
