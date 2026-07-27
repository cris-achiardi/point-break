/**
 * All procedural, no asset files. Three noise beds whose filters and gains track the ride:
 *   rumble  — the wave behind you, loudest when you sit right in the pocket
 *   hiss    — the rail cutting, tracks turn rate and speed
 *   roar    — the lip throwing, and it closes right down when you get barrelled
 */
const NOISE_SEC = 3;

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    const buf = ctx.createBuffer(1, ctx.sampleRate * NOISE_SEC, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;      // brown-ish
      d[i] = last * 3.2 + w * 0.35;
    }
    this.buf = buf;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    const bed = (type, freq, q, gain) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      return { src, f, g };
    };

    this.rumble = bed('lowpass', 260, 0.7, 0.0);
    this.hiss = bed('bandpass', 2400, 1.1, 0.0);
    this.roar = bed('bandpass', 700, 0.6, 0.0);

    this.ready = true;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, ctx.currentTime, 0.4);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.15);
    return this.muted;
  }

  /** One-shot noise burst for impacts. */
  hit(freq = 300, dur = 0.6, gain = 0.5, q = 0.8) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.buf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  /** Short bright blip for scoring events. */
  blip(freq = 660, dur = 0.16, gain = 0.16) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  update(surfer) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, k = 0.08;
    const spd = surfer.vWater, pw = surfer.pocket;
    const foam = Math.min(1, Math.max(0, -(surfer.d) / 6));
    const tube = surfer.barreled ? 1 : 0;

    // A single NaN anywhere in the physics would otherwise throw here every frame and bury
    // the console, which is a miserable way to find out something upstream went wrong.
    const set = (p, v) => { if (Number.isFinite(v)) p.setTargetAtTime(v, t, k); };
    if (!Number.isFinite(spd) || !Number.isFinite(pw)) return;

    set(this.rumble.g.gain, 0.16 + pw * 0.30 + foam * 0.42);
    set(this.rumble.f.frequency, tube ? 150 : 240 + spd * 6);

    set(this.hiss.g.gain, Math.min(0.30, Math.abs(surfer.turnRate) * 0.16 * Math.min(1, spd / 9)
      + spd * 0.0055));
    // Ceiling matters now that a snap drives turnRate to ~10 rad/s: unclamped that lands at
    // 10 kHz, and the source is heavily integrated brown noise with almost no energy up
    // there — so the rail would go THIN and vanish at the exact moment it should tear.
    set(this.hiss.f.frequency,
      Math.min(5200, 1500 + spd * 130 + Math.abs(surfer.turnRate) * 900));

    set(this.roar.g.gain, (0.05 + pw * 0.20 + tube * 0.35) * (1 - foam * 0.3));
    set(this.roar.f.frequency, tube ? 260 : 640 + pw * 340);
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
}
