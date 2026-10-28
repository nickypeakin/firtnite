// Synthesized sound effects (WebAudio, no asset files).

const MAX_VOICES = 28;

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.voices = 0;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(x, y, z, yaw) {
    const L = this.listener;
    L.x = x; L.y = y; L.z = z; L.yaw = yaw;
  }

  // Returns [gain, pan] for a world position, or null when inaudible.
  spatial(pos, range = 260) {
    if (!pos) return [1, 0];
    const L = this.listener;
    const dx = pos.x - L.x, dy = pos.y - L.y, dz = pos.z - L.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > range) return null;
    const g = 1 / (1 + d * d * 0.0012) * (1 - d / range);
    // Listener right vector for yaw: (cos, -sin).
    const pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d)) : 0;
    return [g, pan * 0.8];
  }

  out(gain, pan, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    let node = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.master);
    } else {
      g.connect(this.master);
    }
    this.voices++;
    setTimeout(() => {
      this.voices--;
      g.disconnect();
    }, (dur + 0.1) * 1000);
    return node;
  }

  noiseBurst(dest, t, dur, freq, type = 'lowpass', q = 0.7, vol = 1, attack = 0.002) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(dest, t, dur, f0, f1, type = 'sine', vol = 1, attack = 0.003) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name, pos = null, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (this.voices > MAX_VOICES && pos) return;
    const sp = this.spatial(pos, name === 'sniper' || name === 'explosion' ? 420 : 260);
    if (!sp) return;
    const gain = sp[0] * vol;
    if (gain < 0.015) return;
    const t = this.ctx.currentTime + 0.005;
    const dur = 1.3;
    const o = this.out(gain, sp[1], dur);
    switch (name) {
      case 'ar':
        this.noiseBurst(o, t, 0.16, 2600, 'lowpass', 0.8, 0.9);
        this.tone(o, t, 0.1, 160, 60, 'triangle', 0.7);
        break;
      case 'smg':
        this.noiseBurst(o, t, 0.08, 3600, 'lowpass', 0.8, 0.7);
        this.tone(o, t, 0.06, 220, 90, 'triangle', 0.4);
        break;
      case 'pistol':
        this.noiseBurst(o, t, 0.12, 3200, 'lowpass', 1, 0.8);
        this.tone(o, t, 0.08, 260, 90, 'triangle', 0.5);
        break;
      case 'shotgun':
        this.noiseBurst(o, t, 0.45, 1400, 'lowpass', 0.6, 1);
        this.tone(o, t, 0.25, 110, 40, 'sine', 1);
        this.noiseBurst(o, t + 0.35, 0.08, 2500, 'bandpass', 3, 0.3);
        this.noiseBurst(o, t + 0.5, 0.06, 2000, 'bandpass', 3, 0.3);
        break;
      case 'sniper':
        this.noiseBurst(o, t, 0.6, 4800, 'lowpass', 0.5, 1);
        this.tone(o, t, 0.35, 90, 35, 'sine', 1);
        this.noiseBurst(o, t + 0.04, 0.9, 900, 'lowpass', 0.5, 0.4, 0.05);
        break;
      case 'rocket':
        this.noiseBurst(o, t, 0.7, 700, 'lowpass', 0.6, 0.8, 0.02);
        this.tone(o, t, 0.5, 300, 120, 'sawtooth', 0.15, 0.02);
        break;
      case 'explosion':
        this.noiseBurst(o, t, 1.2, 500, 'lowpass', 0.5, 1, 0.005);
        this.tone(o, t, 0.8, 70, 30, 'sine', 1);
        break;
      case 'pickaxe':
        this.tone(o, t, 0.12, 320, 160, 'triangle', 0.4);
        break;
      case 'harvest_wood':
        this.tone(o, t, 0.12, 240, 140, 'triangle', 0.8);
        this.noiseBurst(o, t, 0.08, 1200, 'bandpass', 2, 0.5);
        break;
      case 'harvest_stone':
        this.noiseBurst(o, t, 0.12, 2400, 'highpass', 1, 0.7);
        this.tone(o, t, 0.08, 500, 300, 'square', 0.15);
        break;
      case 'harvest_metal':
        this.tone(o, t, 0.4, 880, 860, 'sine', 0.4);
        this.tone(o, t, 0.3, 1320, 1300, 'sine', 0.25);
        break;
      case 'build':
        this.tone(o, t, 0.08, 420, 200, 'triangle', 0.7);
        this.tone(o, t + 0.07, 0.09, 300, 150, 'triangle', 0.6);
        break;
      case 'break':
        this.noiseBurst(o, t, 0.35, 1000, 'lowpass', 0.8, 0.8);
        this.tone(o, t, 0.2, 150, 60, 'triangle', 0.5);
        break;
      case 'hit':
        this.tone(o, t, 0.06, 1500, 1300, 'sine', 0.5);
        break;
      case 'shieldhit':
        this.tone(o, t, 0.08, 2200, 1800, 'sine', 0.35);
        this.noiseBurst(o, t, 0.06, 6000, 'highpass', 1, 0.2);
        break;
      case 'headshot':
        this.tone(o, t, 0.3, 1900, 1900, 'sine', 0.55);
        this.tone(o, t, 0.25, 2850, 2850, 'sine', 0.3);
        break;
      case 'hurt':
        this.tone(o, t, 0.15, 180, 90, 'square', 0.25);
        this.noiseBurst(o, t, 0.1, 900, 'lowpass', 1, 0.4);
        break;
      case 'shieldbreak':
        this.noiseBurst(o, t, 0.4, 5000, 'highpass', 1, 0.6);
        this.tone(o, t, 0.4, 1600, 400, 'sine', 0.4);
        break;
      case 'chest':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(o, t + i * 0.07, 0.35, f, f, 'triangle', 0.4));
        break;
      case 'pickup':
        this.tone(o, t, 0.12, 500, 900, 'sine', 0.45);
        break;
      case 'reload':
        this.noiseBurst(o, t, 0.05, 3000, 'bandpass', 4, 0.6);
        this.noiseBurst(o, t + 0.18, 0.05, 2200, 'bandpass', 4, 0.6);
        break;
      case 'heal':
        this.tone(o, t, 0.5, 600, 900, 'sine', 0.3, 0.05);
        break;
      case 'elim':
        [392, 494, 587, 784].forEach((f, i) => this.tone(o, t + i * 0.05, 0.5, f, f, 'triangle', 0.35));
        break;
      case 'storm':
        this.tone(o, t, 0.5, 70, 50, 'sawtooth', 0.25, 0.05);
        this.noiseBurst(o, t, 0.5, 400, 'lowpass', 1, 0.3, 0.05);
        break;
      case 'jump':
        this.noiseBurst(o, t, 0.12, 700, 'lowpass', 1, 0.25);
        break;
      case 'land':
        this.noiseBurst(o, t, 0.15, 400, 'lowpass', 1, 0.5);
        break;
      case 'step':
        this.noiseBurst(o, t, 0.07, 500 + Math.random() * 300, 'lowpass', 1, 0.3);
        break;
      case 'glider':
        this.noiseBurst(o, t, 0.6, 1200, 'bandpass', 0.8, 0.5, 0.1);
        break;
      case 'horn':
        this.tone(o, t, 0.35, 330, 330, 'square', 0.18, 0.02);
        this.tone(o, t, 0.35, 415, 415, 'square', 0.14, 0.02);
        this.tone(o, t + 0.45, 0.5, 330, 330, 'square', 0.18, 0.02);
        this.tone(o, t + 0.45, 0.5, 415, 415, 'square', 0.14, 0.02);
        break;
      case 'click':
        this.tone(o, t, 0.04, 900, 700, 'square', 0.15);
        break;
      case 'victory':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(o, t + i * 0.12, 0.8, f, f, 'triangle', 0.35));
        break;
    }
  }
}
