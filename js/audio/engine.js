// Audio-Graph: Quelle → AudioWorklet (DA HALL) → Analyser → Ausgang (+ Recorder).
// Live-Eingang: getUserMedia → ChannelSplitter → (Kanalwahl) → ChannelMerger → Worklet.

import { renderDemo } from './demo.js';
import { encodeWav } from './wav.js';

const PROCESSOR_URL = new URL('./reverb-processor.js', import.meta.url);

export class Engine {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.params = {};
    this.source = null; // { kind: 'buffer'|'live', node, stream? }
    this.buffers = new Map();
    this.fileBuffer = null;
    this.onMeter = null;
    this.onSourceEnded = null;
    this.recorder = null;
    this.onRebuild = null; // Kontext wurde (z. B. wegen anderer Abtastrate) neu aufgebaut
    this.onLiveEnded = null; // Eingangsgerät wurde getrennt
    this.sinkId = '';
    this.channelSel = 'p0';
    this.built = false;
  }

  get ready() {
    return !!this.node;
  }

  /**
   * Startet (oder reaktiviert) den Audio-Kontext. Mit `sampleRate` wird der Kontext bei Bedarf
   * mit dieser Rate neu aufgebaut, damit ein Eingangsgerät ohne Resampling läuft
   * (Firefox verlangt das sogar, Chrome spart sich damit Latenz).
   */
  async init({ sampleRate } = {}) {
    if (this.ctx && sampleRate && this.ctx.sampleRate !== sampleRate) await this.teardown();
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    let ctx;
    try {
      ctx = new AudioContext(sampleRate ? { latencyHint: 'interactive', sampleRate } : { latencyHint: 'interactive' });
    } catch {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(PROCESSOR_URL);
    this.node = new AudioWorkletNode(ctx, 'da-hall-reverb', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { params: this.params },
    });
    this.node.port.onmessage = (e) => {
      if (e.data && e.data.type === 'meter') this.onMeter?.(e.data);
    };
    this.input = ctx.createGain();
    this.input.connect(this.node);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.8;
    this.node.connect(this.analyser);
    this.node.connect(ctx.destination);
    if (this.sinkId) await this.applySink().catch(() => {});
    if (ctx.state !== 'running') await ctx.resume();
    if (this.built) this.onRebuild?.();
    this.built = true;
  }

  async teardown() {
    this.stopSource();
    if (this.recorder) {
      try { this.recorder.rec.stop(); } catch { /* bereits gestoppt */ }
      this.recorder = null;
    }
    this.recDest = null;
    this.buffers.clear(); // Demo-Puffer sind an die Abtastrate gebunden
    const ctx = this.ctx;
    this.ctx = null;
    this.node = null;
    try { await ctx.close(); } catch { /* bereits geschlossen */ }
  }

  setParams(p) {
    this.params = p;
    this.node?.port.postMessage({ type: 'params', params: p });
  }

  clearTail() {
    this.node?.port.postMessage({ type: 'clear' });
  }

  /** Geschätzte Gesamtlatenz in ms (Ausgang + ggf. Eingang des Live-Geräts). */
  get latencyMs() {
    if (!this.ctx) return null;
    const out = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
    const inp = this.source && this.source.kind === 'live' ? this.liveInfo?.latency || 0 : 0;
    return (out + inp) * 1000;
  }

  // ---------- Quellen ----------

  stopSource() {
    const s = this.source;
    if (!s) return;
    this.source = null;
    try {
      if (s.kind === 'buffer') {
        s.node.onended = null;
        s.node.stop();
      }
      s.node.disconnect();
      s.splitter?.disconnect();
      s.merger?.disconnect();
    } catch { /* bereits gestoppt */ }
    if (s.stream) for (const t of s.stream.getTracks()) t.stop();
  }

  demoBuffer(id) {
    if (!this.buffers.has(id)) this.buffers.set(id, renderDemo(this.ctx, id));
    return this.buffers.get(id);
  }

  playBuffer(buffer, { loop = true } = {}) {
    this.stopSource();
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = loop;
    node.connect(this.input);
    node.onended = () => {
      if (this.source && this.source.node === node) {
        this.source = null;
        this.onSourceEnded?.();
      }
    };
    node.start();
    this.source = { kind: 'buffer', node };
  }

  async decodeFile(file) {
    const data = await file.arrayBuffer();
    this.fileBuffer = await this.ctx.decodeAudioData(data);
    return this.fileBuffer;
  }

  async listInputs() {
    return this.listDevices('audioinput');
  }

  async listOutputs() {
    return this.listDevices('audiooutput');
  }

  async listDevices(kind) {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter((d) => d.kind === kind);
    } catch {
      return [];
    }
  }

  /** Fragt einmal die Freigabe an, damit Gerätenamen sichtbar werden. */
  async requestDeviceAccess() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
  }

  /**
   * Startet ein Eingangsgerät. Liefert { label, channels, sampleRate, latency }.
   * Alle Browser-Aufbereitungen (Echo, Rauschen, Pegelautomatik) sind aus.
   */
  async startLive(deviceId) {
    this.stopSource();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 32 },
        latency: { ideal: 0 },
      },
    });
    const track = stream.getAudioTracks()[0];
    const st = (track && track.getSettings && track.getSettings()) || {};
    try {
      if (st.sampleRate && this.ctx.sampleRate !== st.sampleRate) await this.init({ sampleRate: st.sampleRate });
      const src = this.ctx.createMediaStreamSource(stream);
      const channels = Math.max(1, st.channelCount || 2);
      const splitter = this.ctx.createChannelSplitter(Math.max(2, channels));
      const merger = this.ctx.createChannelMerger(2);
      src.connect(splitter);
      merger.connect(this.input);
      this.source = { kind: 'live', node: src, stream, splitter, merger, channels };
      this.routeChannels(this.channelSel);
    } catch (err) {
      for (const t of stream.getTracks()) t.stop();
      throw err;
    }
    track?.addEventListener('ended', () => {
      if (this.source && this.source.stream === stream) {
        this.stopSource();
        this.onLiveEnded?.();
      }
    });
    this.liveInfo = {
      label: track?.label || '',
      channels: this.source.channels,
      sampleRate: st.sampleRate || this.ctx.sampleRate,
      latency: typeof st.latency === 'number' ? st.latency : 0,
    };
    return this.liveInfo;
  }

  /**
   * Kanalwahl für den Live-Eingang: `p<k>` = Paar k+1/k+2 (Stereo), `m<k>` = Kanal k+1 auf beide Seiten.
   * Kann während des Spielens umgeschaltet werden.
   */
  routeChannels(sel) {
    this.channelSel = sel;
    const s = this.source;
    if (!s || s.kind !== 'live') return;
    const m = /^([pm])(\d+)$/.exec(sel) || [sel, 'p', '0'];
    const n = s.channels;
    let a = Math.min(Number(m[2]), n - 1);
    let b = a;
    if (m[1] === 'p' && n > 1) {
      a = Math.min(a, n - 2);
      b = a + 1;
    }
    s.splitter.disconnect();
    s.splitter.connect(s.merger, a, 0);
    s.splitter.connect(s.merger, b, 1);
  }

  /** Auswahl-Optionen für `channels` Eingangskanäle. */
  static channelOptions(channels) {
    if (channels <= 1) return [{ value: 'm0', label: 'Mono' }];
    const opts = [];
    for (let k = 0; k + 1 < channels; k += 2) opts.push({ value: `p${k}`, label: `${k + 1} + ${k + 2} (Stereo)` });
    for (let k = 0; k < channels; k++) opts.push({ value: `m${k}`, label: `Kanal ${k + 1} (Mono)` });
    return opts;
  }

  // ---------- Ausgabegerät ----------

  get canSelectOutput() {
    return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
  }

  async setOutput(deviceId) {
    this.sinkId = deviceId || '';
    if (this.ctx) await this.applySink();
  }

  applySink() {
    return this.ctx.setSinkId ? this.ctx.setSinkId(this.sinkId) : Promise.resolve();
  }

  // ---------- Aufnahme (Live-Ausgang) ----------

  get canRecord() {
    return typeof MediaRecorder !== 'undefined';
  }

  startRecording() {
    if (!this.recDest) {
      this.recDest = this.ctx.createMediaStreamDestination();
      this.node.connect(this.recDest);
    }
    const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const rec = new MediaRecorder(this.recDest.stream, mimeType ? { mimeType, audioBitsPerSecond: 256000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    this.recorder = { rec, chunks, mimeType: rec.mimeType || mimeType || 'audio/webm' };
    rec.start(250);
  }

  stopRecording() {
    const r = this.recorder;
    if (!r) return Promise.resolve(null);
    this.recorder = null;
    return new Promise((resolve) => {
      r.rec.onstop = () => resolve(new Blob(r.chunks, { type: r.mimeType }));
      r.rec.stop();
    });
  }

  // ---------- Offline-Export ----------

  /**
   * Rendert ein AudioBuffer mit den aktuellen Einstellungen inklusive Hallfahne als WAV (24 Bit).
   * @returns {Promise<Blob>}
   */
  async renderWav(buffer, params, tailSec) {
    const sr = buffer.sampleRate;
    const length = Math.ceil(buffer.length + tailSec * sr);
    const off = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: sr });
    await off.audioWorklet.addModule(PROCESSOR_URL);
    const node = new AudioWorkletNode(off, 'da-hall-reverb', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { params: { ...params, sustain: 0, bypass: 0 } },
    });
    const src = off.createBufferSource();
    src.buffer = buffer;
    src.connect(node);
    node.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return encodeWav(rendered);
  }
}
