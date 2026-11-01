// Bedienelemente: Drehregler, Fader, Modus-Wahlschalter, Kippschalter, Fußschalter.
// Alle Werte sind normalisiert (0..1). Bedienung per Maus/Touch (vertikal ziehen), Mausrad, Tastatur.
// Shift = Feinjustierung, Doppelklick = Default.

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

/** Gemeinsames Drag-/Tastatur-Verhalten für Regler. */
function attachValueInput(target, ctl, { axis = 'y', pixels = 220 } = {}) {
  let startPos = 0, startVal = 0, dragging = false;
  target.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    target.focus({ preventScroll: true });
    target.setPointerCapture(e.pointerId);
    dragging = true;
    startPos = axis === 'y' ? e.clientY : e.clientX;
    startVal = ctl.value;
    target.classList.add('is-active');
    ctl.onStart?.();
  });
  target.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const pos = axis === 'y' ? e.clientY : e.clientX;
    const delta = axis === 'y' ? startPos - pos : pos - startPos;
    const scale = e.shiftKey ? pixels * 5 : pixels;
    ctl.set(startVal + delta / scale, true);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    target.classList.remove('is-active');
    try { target.releasePointerCapture(e.pointerId); } catch { /* bereits freigegeben */ }
    ctl.onEnd?.();
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  target.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = e.shiftKey ? 0.002 : 0.012;
    ctl.set(ctl.value + (e.deltaY < 0 ? step : -step), true);
  }, { passive: false });
  target.addEventListener('dblclick', () => ctl.set(ctl.def, true));
  target.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 0.1 : 0.01;
    let v = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v = ctl.value + big;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v = ctl.value - big;
    else if (e.key === 'PageUp') v = ctl.value + 0.1;
    else if (e.key === 'PageDown') v = ctl.value - 0.1;
    else if (e.key === 'Home') v = 0;
    else if (e.key === 'End') v = 1;
    if (v !== null) {
      e.preventDefault();
      e.stopPropagation();
      ctl.set(v, true);
    }
  });
}

export class Knob {
  /**
   * @param {HTMLElement} host
   * @param {{id:string,label:string,long?:string,def:number,fmt:(v:number)=>string,size?:'lg'|'sm',bipolar?:boolean}} opts
   */
  constructor(host, opts) {
    this.id = opts.id;
    this.def = opts.def;
    this.fmt = opts.fmt;
    this.onChange = null;
    this.value = opts.def;
    const wrap = el('div', `knob-wrap knob-${opts.size || 'lg'}`, host);
    wrap.dataset.param = opts.id;
    const knob = el('div', 'knob', wrap);
    knob.tabIndex = 0;
    knob.setAttribute('role', 'slider');
    knob.setAttribute('aria-label', opts.long ? `${opts.label} – ${opts.long}` : opts.label);
    knob.setAttribute('aria-valuemin', '0');
    knob.setAttribute('aria-valuemax', '100');
    knob.title = opts.long || opts.label;
    knob.appendChild(scaleSvg(opts.bipolar));
    const cap = el('div', 'knob-cap', knob);
    el('div', 'knob-pointer', cap);
    const label = el('div', 'knob-label', wrap);
    label.textContent = opts.label;
    this.wrap = wrap;
    this.knob = knob;
    this.cap = cap;
    this.labelEl = label;
    attachValueInput(knob, this);
    this.render();
  }
  set(v, fromUser = false) {
    const nv = clamp01(v);
    if (nv === this.value && !fromUser) return;
    this.value = nv;
    this.render();
    if (fromUser) this.onChange?.(this.id, nv);
  }
  setLabel(text) {
    this.labelEl.textContent = text;
  }
  render() {
    const deg = -135 + 270 * this.value;
    this.cap.style.transform = `rotate(${deg}deg)`;
    this.knob.setAttribute('aria-valuenow', String(Math.round(this.value * 100)));
    this.knob.setAttribute('aria-valuetext', this.fmt(this.value));
  }
}

function scaleSvg(bipolar) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'knob-scale');
  svg.setAttribute('aria-hidden', 'true');
  const ticks = 11;
  for (let i = 0; i < ticks; i++) {
    const a = ((-135 + (270 * i) / (ticks - 1)) * Math.PI) / 180;
    const major = i === 0 || i === ticks - 1 || (bipolar && i === 5);
    const r1 = 46, r2 = major ? 39 : 42;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(50 + r1 * Math.sin(a)));
    line.setAttribute('y1', String(50 - r1 * Math.cos(a)));
    line.setAttribute('x2', String(50 + r2 * Math.sin(a)));
    line.setAttribute('y2', String(50 - r2 * Math.cos(a)));
    line.setAttribute('class', major ? 'tick tick-major' : 'tick');
    svg.appendChild(line);
  }
  return svg;
}

export class Fader {
  constructor(host, opts) {
    this.id = opts.id;
    this.def = opts.def;
    this.fmt = opts.fmt;
    this.value = opts.def;
    this.onChange = null;
    const wrap = el('div', 'fader-wrap', host);
    wrap.dataset.param = opts.id;
    const fader = el('div', 'fader', wrap);
    fader.tabIndex = 0;
    fader.setAttribute('role', 'slider');
    fader.setAttribute('aria-orientation', 'vertical');
    fader.setAttribute('aria-label', opts.label);
    fader.setAttribute('aria-valuemin', '0');
    fader.setAttribute('aria-valuemax', '100');
    el('div', 'fader-slot', fader);
    for (let i = 0; i < 9; i++) el('span', 'fader-tick', fader).style.setProperty('--i', String(i));
    this.cap = el('div', 'fader-cap', fader);
    const label = el('div', 'fader-label', wrap);
    label.textContent = opts.label;
    this.sub = el('div', 'fader-sub', wrap);
    this.sub.textContent = opts.sub || '';
    this.fader = fader;
    this.wrap = wrap;
    // Klick auf die Schiene setzt den Wert direkt (vor dem Drag-Handler registriert,
    // damit das anschließende Ziehen vom neuen Wert aus startet)
    fader.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target === this.cap) return;
      const r = fader.getBoundingClientRect();
      const v = 1 - (e.clientY - r.top - 14) / (r.height - 28);
      this.set(v, true);
    });
    attachValueInput(fader, this, { pixels: 140 });
    this.render();
  }
  set(v, fromUser = false) {
    const nv = clamp01(v);
    this.value = nv;
    this.render();
    if (fromUser) this.onChange?.(this.id, nv);
  }
  setSub(text, long) {
    this.sub.textContent = text;
    this.fader.setAttribute('aria-label', `${this.wrap.querySelector('.fader-label').textContent} – ${long || text}`);
    this.fader.title = long || text;
  }
  setFormatter(fmt) {
    this.fmt = fmt;
    this.render();
  }
  render() {
    this.cap.style.setProperty('--v', String(this.value));
    this.fader.setAttribute('aria-valuenow', String(Math.round(this.value * 100)));
    this.fader.setAttribute('aria-valuetext', this.fmt(this.value));
  }
}

/** Rastender Wahlschalter für die fünf Modi; Beschriftungen sind anklickbar. */
export class ModeSelector {
  constructor(host, modes, value) {
    this.modes = modes;
    this.value = value;
    this.onChange = null;
    const wrap = el('div', 'mode-wrap', host);
    const knob = el('div', 'knob mode-knob', wrap);
    knob.tabIndex = 0;
    knob.setAttribute('role', 'slider');
    knob.setAttribute('aria-label', 'Modus');
    knob.setAttribute('aria-valuemin', '0');
    knob.setAttribute('aria-valuemax', String(modes.length - 1));
    const cap = el('div', 'knob-cap', knob);
    el('div', 'knob-pointer', cap);
    this.labels = modes.map((m, i) => {
      const b = el('button', 'mode-label', wrap);
      b.type = 'button';
      b.textContent = m.name;
      b.title = m.desc;
      const a = this.angle(i);
      const rad = (a * Math.PI) / 180;
      b.style.setProperty('--lx', `${Math.sin(rad) * 64}px`);
      b.style.setProperty('--ly', `${-Math.cos(rad) * 64}px`);
      b.addEventListener('click', () => this.set(i, true));
      return b;
    });
    const label = el('div', 'knob-label', wrap);
    label.textContent = 'MODE';
    this.knob = knob;
    this.cap = cap;
    // Ziehen in Rasterschritten
    let startY = 0, startV = 0, drag = false;
    knob.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      knob.focus({ preventScroll: true });
      knob.setPointerCapture(e.pointerId);
      drag = true;
      startY = e.clientY;
      startV = this.value;
    });
    knob.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const steps = Math.round((startY - e.clientY) / 28);
      this.set(startV + steps, true);
    });
    const end = () => { drag = false; };
    knob.addEventListener('pointerup', end);
    knob.addEventListener('pointercancel', end);
    knob.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.set(this.value + (e.deltaY < 0 ? 1 : -1), true);
    }, { passive: false });
    knob.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowRight'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); this.set(this.value + 1, true); }
      if (['ArrowDown', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); this.set(this.value - 1, true); }
    });
    this.render();
  }
  angle(i) {
    return -120 + (240 * i) / (this.modes.length - 1);
  }
  set(i, fromUser = false) {
    const ni = Math.min(this.modes.length - 1, Math.max(0, Math.round(i)));
    const changed = ni !== this.value;
    this.value = ni;
    this.render();
    if (fromUser && changed) this.onChange?.('mode', ni);
  }
  render() {
    this.cap.style.transform = `rotate(${this.angle(this.value)}deg)`;
    this.knob.setAttribute('aria-valuenow', String(this.value));
    this.knob.setAttribute('aria-valuetext', this.modes[this.value].name);
    this.labels.forEach((b, i) => b.classList.toggle('is-on', i === this.value));
  }
}

/** Dreistufiger Kippschalter (Width). */
export class Toggle3 {
  constructor(host, { id, label, options, titles = options, value }) {
    this.id = id;
    this.options = titles;
    this.value = value;
    this.onChange = null;
    const wrap = el('div', 'toggle-wrap', host);
    const sw = el('button', 'toggle', wrap);
    sw.type = 'button';
    sw.setAttribute('aria-label', `${label}: umschalten`);
    el('span', 'toggle-bat', sw);
    const list = el('div', 'toggle-options', wrap);
    this.optEls = options.map((o, i) => {
      const b = el('button', 'toggle-opt', list);
      b.type = 'button';
      b.textContent = o;
      b.title = titles[i];
      b.setAttribute('aria-label', `${label} ${titles[i]}`);
      b.addEventListener('click', () => this.set(i, true));
      return b;
    });
    const lab = el('div', 'knob-label', wrap);
    lab.textContent = label;
    sw.addEventListener('click', () => this.set((this.value + 1) % options.length, true));
    this.sw = sw;
    this.render();
  }
  set(i, fromUser = false) {
    this.value = i;
    this.render();
    if (fromUser) this.onChange?.(this.id, i);
  }
  render() {
    this.sw.style.setProperty('--pos', String(this.value));
    this.sw.setAttribute('aria-valuetext', this.options[this.value]);
    this.optEls.forEach((b, i) => {
      b.classList.toggle('is-on', i === this.value);
      b.setAttribute('aria-pressed', String(i === this.value));
    });
  }
}

/**
 * Fußschalter mit LED. Kurzer Tritt = umschalten.
 * Mit `momentary` wird bei langem Halten (> 450 ms) beim Loslassen wieder ausgeschaltet.
 */
export class Footswitch {
  constructor(host, { id, label, momentary = false, ledClass = '' }) {
    this.id = id;
    this.on = false;
    this.onChange = null;
    const wrap = el('div', 'foot-wrap', host);
    this.led = el('span', `led ${ledClass}`, wrap);
    const btn = el('button', 'footswitch', wrap);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', label);
    el('span', 'footswitch-top', btn);
    const lab = el('div', 'knob-label', wrap);
    lab.textContent = label;
    this.btn = btn;
    let downAt = 0, toggledOnDown = false;
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      btn.classList.add('is-down');
      downAt = performance.now();
      toggledOnDown = !this.on;
      this.set(!this.on, true);
    });
    const up = () => {
      if (!btn.classList.contains('is-down')) return;
      btn.classList.remove('is-down');
      if (momentary && toggledOnDown && performance.now() - downAt > 450) this.set(false, true);
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.set(!this.on, true);
      }
    });
  }
  set(on, fromUser = false) {
    this.on = !!on;
    this.btn.setAttribute('aria-pressed', String(this.on));
    this.led.classList.toggle('is-on', this.on);
    if (fromUser) this.onChange?.(this.id, this.on);
  }
}
