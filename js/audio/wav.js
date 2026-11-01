// AudioBuffer → WAV (PCM, 24 Bit, interleaved).

export function encodeWav(buffer) {
  const ch = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const bytes = 3;
  const dataLen = n * ch * bytes;
  const out = new ArrayBuffer(44 + dataLen);
  const v = new DataView(out);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * bytes, true);
  v.setUint16(32, ch * bytes, true);
  v.setUint16(34, bytes * 8, true);
  str(36, 'data');
  v.setUint32(40, dataLen, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      let x = Math.round(s * 8388607);
      if (x < 0) x += 16777216;
      v.setUint8(o, x & 0xff);
      v.setUint8(o + 1, (x >> 8) & 0xff);
      v.setUint8(o + 2, (x >> 16) & 0xff);
      o += 3;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}
