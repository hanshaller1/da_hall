import { defaultState } from './params.js';

// Werkspresets. Werte sind normalisierte Reglerstellungen (0..1), mode: 0 Dark · 1 Rise · 2 Dream · 3 Rain · 4 Light.
const P = (name, desc, v) => ({ name, desc, state: Object.assign(defaultState(), v), factory: true });

export const FACTORY_PRESETS = [
  P('Slow Cathedral', 'Langes, weiches Dream-Pad mit leichtem Bloom', {
    mode: 2, decay: 0.76, mix: 0.5, filter: 0.4, depth: 0.32, x: 0.25, y: 0.42, stretch: 0.35, predelay: 0.28, damping: 0.5,
  }),
  P('Tide', 'Rise: Hall und Gitarre schwellen gemeinsam an', {
    mode: 1, decay: 0.66, mix: 0.55, filter: 0.42, depth: 0.3, x: 0.55, y: 0.75, stretch: 0.25, predelay: 0.15,
  }),
  P('Northern Light', 'Klassischer Oktav-Shimmer', {
    mode: 4, decay: 0.72, mix: 0.5, filter: 0.45, depth: 0.3, x: 0.55, y: 0.5, stretch: 0.2, damping: 0.3, lowcut: 0.5,
  }),
  P('Rain on Glass', 'Diffuse Ping-Pong-Tropfen, die im Hall verschwimmen', {
    mode: 3, decay: 0.55, mix: 0.5, filter: 0.4, depth: 0.4, x: 0.52, y: 0.55, stretch: 0.1,
  }),
  P('Abyss', 'Dunkler Riesenraum mit Sub-Oktave', {
    mode: 0, decay: 0.86, mix: 0.52, filter: 0.3, depth: 0.25, x: 0.6, y: 0.5, stretch: 0.3, damping: 0.62, size: 0.95,
  }),
  P('Tape Memory', 'Verwaschenes Pad mit Wow, Flutter und Sättigung', {
    mode: 2, decay: 0.6, mix: 0.5, filter: 0.36, depth: 0.45, x: 0.55, y: 0.3, stretch: 0.2, lofi: 0.55,
  }),
  P('Infinite Bloom', 'Shimmer in der Duodezime, sehr langsamer Aufbau', {
    mode: 4, decay: 0.9, mix: 0.6, filter: 0.44, depth: 0.35, x: 0.38, y: 0.7, stretch: 0.85, damping: 0.35,
  }),
  P('Small Glow', 'Kurzer, heller Raum für Akkorde', {
    mode: 4, decay: 0.3, mix: 0.32, filter: 0.5, depth: 0.2, x: 0.15, y: 0.5, stretch: 0, size: 0.32, predelay: 0.12,
  }),
  P('Ducked Pad', 'Hält sich zurück, solange du spielst', {
    mode: 2, decay: 0.8, mix: 0.6, filter: 0.42, depth: 0.3, x: 0.2, y: 0.4, stretch: 0.3, duck: 0.75,
  }),
  P('Sub Drone', 'Zwei Oktaven tiefer, endlose Fahne', {
    mode: 0, decay: 0.92, mix: 0.55, filter: 0.32, depth: 0.2, x: 0.85, y: 0.8, stretch: 0.45, damping: 0.55,
  }),
];

const KEY = 'da-hall:user-presets';

export function loadUserPresets() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((p) => p && p.name && p.state) : [];
  } catch {
    return [];
  }
}

export function saveUserPresets(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Zustand ↔ kompakter Text für Teilen-Links (#p590-430-…). */
export function encodeState(state) {
  const keys = Object.keys(defaultState());
  return 'p' + keys.map((k) => Math.round((state[k] ?? 0) * 1000)).join('-');
}

export function decodeState(str) {
  const keys = Object.keys(defaultState());
  const m = /^p([0-9-]+)$/.exec(String(str));
  if (!m) return null;
  const parts = m[1].split('-').map(Number);
  if (parts.length !== keys.length || parts.some((n) => !Number.isFinite(n))) return null;
  const s = defaultState();
  keys.forEach((k, i) => {
    s[k] = parts[i] / 1000;
  });
  for (const k of ['mode', 'width', 'inputMode', 'trails', 'killDry']) s[k] = Math.round(s[k]);
  return s;
}
