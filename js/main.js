import { PARAMS, MODES, WIDTHS, INPUT_MODES, defaultState, toEngine, rainTimeToX, tailSeconds } from './params.js';
import { FACTORY_PRESETS, loadUserPresets, saveUserPresets, encodeState, decodeState } from './presets.js';
import { Knob, Fader, ModeSelector, Toggle3, Footswitch } from './ui/controls.js';
import { Display } from './ui/display.js';
import { Engine } from './audio/engine.js';
import { DEMOS } from './audio/demo.js';

const $ = (id) => document.getElementById(id);

// ---------------- Zustand ----------------
const live = { bypass: false, sustain: false };
let state = defaultState();
const engine = new Engine();
const ui = { knobs: {}, faders: {} };
let srcKind = 'demo';
let demoId = 'arp';
let playing = false;
let presetName = '';

// ---------------- Pedal-Oberfläche ----------------
const display = new Display($('display'));

for (const id of ['decay', 'filter', 'depth', 'mix']) {
  const p = PARAMS[id];
  const k = new Knob($('main-knobs'), { id, label: p.label, long: p.long, def: p.def, fmt: p.fmt, bipolar: p.bipolar });
  k.onChange = onParam;
  ui.knobs[id] = k;
}
const modeSel = new ModeSelector($('main-knobs'), MODES, state.mode);
modeSel.onChange = onParam;

for (const id of ['x', 'y', 'stretch']) {
  const p = PARAMS[id];
  const f = new Fader($('faders'), { id, label: p.label, def: p.def, fmt: p.fmt });
  f.onChange = onParam;
  ui.faders[id] = f;
}

// Kippschalter zeigt von oben nach unten Wide · Medium · Narrow; state.width zählt 0 = Narrow … 2 = Wide
const widthSw = new Toggle3($('width-switch'), { id: 'width', label: 'WIDTH', options: ['W', 'M', 'N'], titles: [WIDTHS[2], WIDTHS[1], WIDTHS[0]], value: 2 - state.width });
widthSw.onChange = (id, v) => onParam('width', 2 - v);

const fsBypass = new Footswitch($('fs-bypass'), { id: 'bypass', label: 'ON / OFF' });
const fsSustain = new Footswitch($('fs-sustain'), { id: 'sustain', label: 'SUSTAIN', momentary: true, ledClass: 'led-sustain' });
fsBypass.onChange = (id, engaged) => setBypass(!engaged);
fsSustain.onChange = (id, on) => setSustain(on);
fsBypass.set(true);

// ---------------- Erweiterte Regler ----------------
const ADV = {
  'g-room': ['predelay', 'size', 'diffusion', 'damping'],
  'g-tone': ['rate', 'lowcut', 'lofi'],
  'g-dyn': ['duck', 'sens'],
  'g-level': ['inGain', 'outGain'],
};
for (const [host, ids] of Object.entries(ADV)) {
  for (const id of ids) {
    const p = PARAMS[id];
    const k = new Knob($(host), { id, label: p.label, long: p.long, def: p.def, fmt: p.fmt, size: 'sm', bipolar: id === 'inGain' });
    k.onChange = onParam;
    ui.knobs[id] = k;
  }
}
for (const m of INPUT_MODES) {
  const o = document.createElement('option');
  o.value = String(m.id);
  o.textContent = m.label;
  $('input-mode').appendChild(o);
}
$('input-mode').addEventListener('change', (e) => onParam('inputMode', Number(e.target.value)));
$('trails').addEventListener('change', (e) => onParam('trails', e.target.checked ? 1 : 0));
$('kill-dry').addEventListener('change', (e) => onParam('killDry', e.target.checked ? 1 : 0));
$('clear-btn').addEventListener('click', () => {
  engine.clearTail();
  display.showValue('HALL', 'GELEERT');
});

// Tap-Tempo für Rain
let taps = [];
$('tap-btn').addEventListener('click', () => {
  const now = performance.now();
  taps = taps.filter((t) => now - t < 2500);
  taps.push(now);
  if (taps.length >= 2) {
    const iv = [];
    for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]);
    const ms = iv.reduce((a, b) => a + b, 0) / iv.length;
    if (state.mode !== 3) onParam('mode', 3);
    onParam('x', rainTimeToX(ms / 1000));
    ui.faders.x.set(state.x);
  } else {
    display.showValue('TAP', 'WEITER TIPPEN …');
  }
});

// ---------------- Parameter-Logik ----------------
function onParam(id, v) {
  state[id] = v;
  if (id === 'mode') {
    modeSel.set(v);
    applyModeLabels();
  }
  presetName = '';
  updatePresetLabel();
  push();
  showParam(id);
  scheduleHash();
}

function showParam(id) {
  const m = MODES[state.mode];
  if (id === 'mode') return display.showValue('MODE', m.name);
  if (id === 'x' || id === 'y') return display.showValue(`${id.toUpperCase()} · ${m[id].label}`, m[id].fmt(state[id]));
  if (id === 'width') return display.showValue('WIDTH', WIDTHS[state.width]);
  const p = PARAMS[id];
  if (p) display.showValue(p.label, p.fmt(state[id]));
  else if (id === 'inputMode') display.showValue('EINGANG', INPUT_MODES[state.inputMode].label.toUpperCase());
  else if (id === 'trails') display.showValue('TRAILS', state.trails ? 'AN' : 'AUS');
  else if (id === 'killDry') display.showValue('KILL DRY', state.killDry ? 'AN' : 'AUS');
}

function applyModeLabels() {
  const m = MODES[state.mode];
  ui.faders.x.setSub(m.x.label, m.x.long);
  ui.faders.x.setFormatter(m.x.fmt);
  ui.faders.y.setSub(m.y.label, m.y.long);
  ui.faders.y.setFormatter(m.y.fmt);
  display.mode = m;
  $('tap-btn').classList.toggle('is-hot', state.mode === 3);
}

function push() {
  engine.setParams(toEngine(state, live));
}

function syncUI() {
  for (const [id, k] of Object.entries(ui.knobs)) k.set(state[id]);
  for (const [id, f] of Object.entries(ui.faders)) f.set(state[id]);
  modeSel.set(state.mode);
  widthSw.set(2 - state.width);
  $('input-mode').value = String(state.inputMode);
  $('trails').checked = !!state.trails;
  $('kill-dry').checked = !!state.killDry;
  applyModeLabels();
}

function setBypass(on) {
  live.bypass = on;
  display.status.bypass = on;
  fsBypass.set(!on);
  push();
}

function setSustain(on) {
  live.sustain = on;
  display.status.sustain = on;
  fsSustain.set(on);
  push();
}

// ---------------- Presets ----------------
let userPresets = loadUserPresets();

function applyPreset(p) {
  state = Object.assign(defaultState(), structuredClone(p.state));
  presetName = p.name;
  syncUI();
  push();
  updatePresetLabel();
  display.showValue('PRESET', p.name.toUpperCase());
  scheduleHash();
}

function updatePresetLabel() {
  $('preset-current').textContent = presetName ? `Aktiv: ${presetName}` : 'Eigene Einstellung';
  document.querySelectorAll('.preset-btn').forEach((b) => b.classList.toggle('is-on', b.dataset.name === presetName));
}

function renderPresets() {
  const fac = $('factory-presets');
  fac.innerHTML = '';
  FACTORY_PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset-btn';
    b.dataset.name = p.name;
    b.innerHTML = `<span class="pb-mode">${MODES[p.state.mode].name}</span><span class="pb-name"></span>`;
    b.querySelector('.pb-name').textContent = p.name;
    b.title = p.desc;
    b.addEventListener('click', () => applyPreset(p));
    fac.appendChild(b);
  });
  const us = $('user-presets');
  us.innerHTML = '';
  if (!userPresets.length) {
    us.innerHTML = '<p class="note">Eigene Presets erscheinen hier. Sie werden nur in diesem Browser gespeichert.</p>';
  }
  userPresets.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'user-row';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset-btn';
    b.dataset.name = p.name;
    b.innerHTML = `<span class="pb-mode">${MODES[p.state.mode ?? 2].name}</span><span class="pb-name"></span>`;
    b.querySelector('.pb-name').textContent = p.name;
    b.addEventListener('click', () => applyPreset(p));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn';
    del.setAttribute('aria-label', `Preset ${p.name} löschen`);
    del.textContent = '×';
    del.addEventListener('click', () => {
      userPresets.splice(i, 1);
      saveUserPresets(userPresets);
      renderPresets();
    });
    row.append(b, del);
    us.appendChild(row);
  });
  updatePresetLabel();
}

$('preset-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('preset-name').value.trim();
  if (!name) {
    $('preset-name').focus();
    return;
  }
  const existing = userPresets.findIndex((p) => p.name === name);
  const entry = { name, state: { ...state } };
  if (existing >= 0) userPresets[existing] = entry;
  else userPresets.push(entry);
  const ok = saveUserPresets(userPresets);
  presetName = name;
  $('preset-name').value = '';
  renderPresets();
  display.showValue('GESPEICHERT', name.toUpperCase());
  if (!ok) setNote('Speichern im Browser nicht möglich (privates Fenster?). Nutze „Presets exportieren“.');
});

$('export-presets').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'da-hall', version: 1, presets: userPresets.length ? userPresets : [{ name: 'Aktuell', state }] }, null, 2)], { type: 'application/json' });
  offerDownload(blob, 'da-hall-presets.json');
});

$('import-presets').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = (data.presets || []).filter((p) => p && typeof p.name === 'string' && p.state);
    for (const p of list) {
      const entry = { name: p.name.slice(0, 32), state: Object.assign(defaultState(), p.state) };
      const i = userPresets.findIndex((u) => u.name === entry.name);
      if (i >= 0) userPresets[i] = entry;
      else userPresets.push(entry);
    }
    saveUserPresets(userPresets);
    renderPresets();
    setNote(`${list.length} Preset(s) importiert.`);
  } catch {
    setNote('Die Datei ist keine gültige DA-HALL-Preset-Datei (JSON).');
  }
  e.target.value = '';
});

$('reset-btn').addEventListener('click', () => {
  state = defaultState();
  presetName = '';
  syncUI();
  push();
  updatePresetLabel();
  display.showValue('INIT', 'STANDARD');
  scheduleHash();
});

$('share-btn').addEventListener('click', async () => {
  writeHash();
  const url = location.href;
  const field = $('share-field');
  field.value = url;
  try {
    await navigator.clipboard.writeText(url);
    setNote('Link mit allen Einstellungen kopiert.');
    field.hidden = true;
  } catch {
    field.hidden = false;
    field.focus();
    field.select();
    setNote('Link markiert: mit Strg/Cmd + C kopieren.');
  }
});

let hashTimer = 0;
function scheduleHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(writeHash, 400);
}
function writeHash() {
  try {
    history.replaceState(null, '', `#${encodeState(state)}`);
  } catch { /* in eingebetteten Ansichten nicht erlaubt */ }
}

// ---------------- Quellen & Transport ----------------
function renderDemos() {
  const list = $('demo-list');
  DEMOS.forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.dataset.id = d.id;
    b.textContent = d.name;
    b.addEventListener('click', () => {
      demoId = d.id;
      updateDemoChips();
      if (playing && srcKind === 'demo') startSource();
    });
    list.appendChild(b);
  });
  updateDemoChips();
}
function updateDemoChips() {
  document.querySelectorAll('#demo-list .chip').forEach((b) => {
    const on = b.dataset.id === demoId;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  });
  $('demo-desc').textContent = DEMOS.find((d) => d.id === demoId).desc;
}

document.querySelectorAll('.seg [role=tab]').forEach((tab) => {
  tab.addEventListener('click', () => selectSource(tab.dataset.src));
});

function selectSource(kind) {
  if (kind === srcKind) return;
  if (playing) stopSource();
  srcKind = kind;
  document.querySelectorAll('.seg [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.src === kind)));
  document.querySelectorAll('.src-pane').forEach((p) => { p.hidden = p.dataset.pane !== kind; });
  if (kind === 'live') refreshDevices();
  updateTransport();
}

async function ensureEngine() {
  if (engine.ready) {
    await engine.init();
    return true;
  }
  setStatus('Audio wird gestartet …');
  try {
    engine.params = toEngine(state, live);
    await engine.init();
    display.setAnalyser(engine.analyser);
    engine.onMeter = (m) => display.setMeter(m);
    engine.onSourceEnded = () => {
      playing = false;
      updateTransport();
    };
    $('rec-btn').disabled = !engine.canRecord;
    updateStatus();
    return true;
  } catch (err) {
    console.error(err);
    setStatus('Audio konnte nicht starten. Dieser Browser unterstützt kein AudioWorklet.');
    return false;
  }
}

function updateStatus() {
  if (!engine.ctx) return;
  const sr = (engine.ctx.sampleRate / 1000).toFixed(1);
  const lat = engine.latencyMs;
  setStatus(`${sr} kHz${lat ? ` · Latenz ca. ${Math.round(lat)} ms` : ''}${playing ? ' · läuft' : ''}`);
}

async function startSource() {
  if (!(await ensureEngine())) return;
  try {
    if (srcKind === 'demo') {
      engine.playBuffer(engine.demoBuffer(demoId), { loop: true });
    } else if (srcKind === 'file') {
      if (!engine.fileBuffer) {
        setNote('Bitte zuerst eine Audiodatei wählen.');
        return;
      }
      engine.playBuffer(engine.fileBuffer, { loop: $('file-loop').checked });
    } else {
      await engine.startLive($('device-select').value || undefined);
      refreshDevices();
    }
    playing = true;
    setNote('');
  } catch (err) {
    console.error(err);
    playing = false;
    if (srcKind === 'live') {
      setNote(err && err.name === 'NotAllowedError'
        ? 'Zugriff auf den Eingang wurde verweigert. Erlaube das Mikrofon in den Browser-Einstellungen und versuche es erneut.'
        : 'Kein Audioeingang gefunden. Schließe ein Interface oder Mikrofon an und versuche es erneut.');
    } else {
      setNote('Wiedergabe fehlgeschlagen.');
    }
  }
  display.status.live = playing && srcKind === 'live';
  updateTransport();
}

function stopSource() {
  engine.stopSource();
  playing = false;
  display.status.live = false;
  updateTransport();
}

function updateTransport() {
  const btn = $('play-btn');
  const labels = { demo: ['Demo abspielen', 'Demo stoppen'], file: ['Datei abspielen', 'Datei stoppen'], live: ['Eingang starten', 'Eingang stoppen'] };
  btn.textContent = labels[srcKind][playing ? 1 : 0];
  btn.classList.toggle('is-playing', playing);
  btn.setAttribute('aria-pressed', String(playing));
  display.status.playing = playing;
  $('export-btn').disabled = !(srcKind === 'demo' || (srcKind === 'file' && engine.fileBuffer));
  updateStatus();
}

$('play-btn').addEventListener('click', () => (playing ? stopSource() : startSource()));

// Datei
async function loadFile(file) {
  if (!file) return;
  if (!(await ensureEngine())) return;
  $('file-name').textContent = 'Wird dekodiert …';
  try {
    await engine.decodeFile(file);
    $('file-name').textContent = `${file.name} · ${engine.fileBuffer.duration.toFixed(1)} s`;
    updateTransport();
    selectSource('file');
    startSource();
  } catch {
    engine.fileBuffer = null;
    $('file-name').textContent = 'Datei konnte nicht gelesen werden. Versuche WAV oder MP3.';
    updateTransport();
  }
}
$('file-input').addEventListener('change', (e) => loadFile(e.target.files[0]));
const drop = $('drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

// Geräte
async function refreshDevices() {
  const sel = $('device-select');
  const cur = sel.value;
  const devs = await engine.listInputs();
  sel.innerHTML = '<option value="">Standard-Eingang</option>';
  devs.forEach((d, i) => {
    if (!d.deviceId || d.deviceId === 'default') return;
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `Eingang ${i + 1}`;
    sel.appendChild(o);
  });
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
}
$('device-select').addEventListener('change', () => {
  if (playing && srcKind === 'live') startSource();
});

// Aufnahme
let recording = false;
$('rec-btn').addEventListener('click', async () => {
  if (!engine.ready) return;
  if (!recording) {
    try {
      engine.startRecording();
      recording = true;
      $('rec-btn').textContent = 'Aufnahme stoppen';
      $('rec-btn').classList.add('is-rec');
      setNote('Aufnahme läuft: Der Ausgang wird mitgeschnitten.');
    } catch {
      setNote('Aufnahme wird von diesem Browser nicht unterstützt.');
    }
  } else {
    recording = false;
    $('rec-btn').textContent = 'Aufnehmen';
    $('rec-btn').classList.remove('is-rec');
    const blob = await engine.stopRecording();
    if (blob) {
      const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
      offerDownload(blob, `da-hall-aufnahme.${ext}`);
    }
  }
});

// Offline-Render
$('export-btn').addEventListener('click', async () => {
  if (!(await ensureEngine())) return;
  const buffer = srcKind === 'file' ? engine.fileBuffer : engine.demoBuffer(demoId);
  if (!buffer) return;
  const btn = $('export-btn');
  btn.disabled = true;
  btn.textContent = 'Rendert …';
  try {
    const tail = tailSeconds(state);
    const blob = await engine.renderWav(buffer, toEngine(state, {}), tail);
    const base = srcKind === 'file' ? ($('file-input').files[0]?.name || 'datei').replace(/\.[^.]+$/, '') : `demo-${demoId}`;
    offerDownload(blob, `${base}-da-hall-${MODES[state.mode].id}.wav`);
  } catch (err) {
    console.error(err);
    setNote('Rendern fehlgeschlagen. Dieser Browser unterstützt kein Offline-AudioWorklet.');
  }
  btn.textContent = 'Als WAV rendern';
  btn.disabled = false;
});

let lastUrl = null;
function offerDownload(blob, name) {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(blob);
  const a = $('download-link');
  a.href = lastUrl;
  a.download = name;
  a.textContent = `${name} herunterladen (${(blob.size / 1048576).toFixed(1)} MB)`;
  a.hidden = false;
  setNote('Datei bereit.');
}

function setNote(t) {
  $('transport-note').textContent = t;
}
function setStatus(t) {
  $('engine-status').textContent = t;
}

// ---------------- Tastatur ----------------
let sDownAt = 0;
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  // Leertaste nur, wenn kein Button fokussiert ist (der würde sonst ausgelöst); B funktioniert immer
  if ((e.code === 'Space' && !e.target.closest('button')) || e.key === 'b' || e.key === 'B') {
    e.preventDefault();
    setBypass(!live.bypass);
  } else if (e.key === 's' || e.key === 'S') {
    if (e.repeat) return;
    sDownAt = performance.now();
    setSustain(!live.sustain);
  } else if (e.key >= '1' && e.key <= '5') {
    onParam('mode', Number(e.key) - 1);
  } else if (e.key === 'p' || e.key === 'P') {
    playing ? stopSource() : startSource();
  }
});
document.addEventListener('keyup', (e) => {
  if ((e.key === 's' || e.key === 'S') && live.sustain && performance.now() - sDownAt > 450) setSustain(false);
});

// ---------------- Anleitung ----------------
function renderManual() {
  const host = $('manual-modes');
  MODES.forEach((m, i) => {
    const d = document.createElement('div');
    d.className = 'mm';
    d.innerHTML = `<div class="mm-head"><kbd>${i + 1}</kbd><span class="mm-name"></span></div><p class="mm-desc"></p><p class="mm-xy"><span>X</span> <b class="x"></b> · <span>Y</span> <b class="y"></b></p>`;
    d.querySelector('.mm-name').textContent = m.name;
    d.querySelector('.mm-desc').textContent = m.desc;
    d.querySelector('.x').textContent = m.x.long;
    d.querySelector('.y').textContent = m.y.long;
    host.appendChild(d);
  });
}

// ---------------- Start ----------------
const fromHash = decodeState(location.hash.slice(1));
if (fromHash) {
  state = fromHash;
} else {
  state = structuredClone(FACTORY_PRESETS[0].state);
  presetName = FACTORY_PRESETS[0].name;
}
renderDemos();
renderPresets();
renderManual();
syncUI();
push();
updateTransport();
setStatus('Audio aus · Starte eine Quelle');
document.fonts?.ready.then(() => display.resize());
