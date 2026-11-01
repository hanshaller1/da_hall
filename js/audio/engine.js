// Audio-Graph: Quelle → AudioWorklet (DA HALL) → Analyser → Ausgang (+ Recorder).

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
  }

  get ready() {
    return !!this.node;
  }

  async init() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
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
    if (ctx.state !== 'running') await ctx.resume();
  }

  setParams(p) {
    this.params = p;
    this.node?.port.postMessage({ type: 'params', params: p });
  }

  clearTail() {
    this.node?.port.postMessage({ type: 'clear' });
  }

  get latencyMs() {
    if (!this.ctx) return null;
    return ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000;
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
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter((d) => d.kind === 'audioinput');
    } catch {
      return [];
    }
  }

  async startLive(deviceId) {
    this.stopSource();
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
        latency: 0,
      },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.input);
    this.source = { kind: 'live', node, stream };
    return stream;
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
