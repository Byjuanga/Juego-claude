// Efectos de sonido y música sintetizados (sin archivos de audio).
let ctx = null, master = null, musicGain = null, musicTimer = null;
let volume = 0.6, musicOn = true;

export function initAudio() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.18; musicGain.connect(master);
    } catch (e) { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setVolume(v) { volume = v; if (master) master.gain.value = v; }
export function setMusic(on) { musicOn = on; if (!on) stopMusic(); }

function tone(f, d, { type = 'square', vol = 0.15, f2 = null, at = 0, dest = null } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(dest || master); o.start(t); o.stop(t + d + 0.02);
}

function noise(d, { vol = 0.2, freq = 1200, q = 1, at = 0, type = 'bandpass' } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const len = Math.floor(ctx.sampleRate * d);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  src.connect(f).connect(g).connect(master); src.start(t);
}

export const sfx = {
  shot(near = 1) { tone(880, 0.09, { type: 'square', vol: 0.05 * near, f2: 220 }); },
  hit() { noise(0.08, { vol: 0.25, freq: 2500, q: 2 }); tone(200, 0.08, { type: 'sawtooth', vol: 0.06, f2: 80 }); },
  hurt() { tone(160, 0.25, { type: 'sawtooth', vol: 0.15, f2: 60 }); noise(0.15, { vol: 0.3, freq: 600 }); },
  kill() { noise(0.6, { vol: 0.45, freq: 400, type: 'lowpass' }); tone(300, 0.5, { type: 'sawtooth', vol: 0.12, f2: 30 }); },
  myKill() { tone(660, 0.1, { type: 'triangle', vol: 0.15 }); tone(990, 0.18, { type: 'triangle', vol: 0.15, at: 0.08 }); },
  pickup() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, { type: 'triangle', vol: 0.12, at: i * 0.06 })); },
  dash() { noise(0.25, { vol: 0.25, freq: 900, q: 0.7, type: 'bandpass' }); },
  spawn() { tone(220, 0.4, { type: 'sine', vol: 0.15, f2: 880 }); },
  click() { tone(1200, 0.04, { type: 'square', vol: 0.05 }); },
  win() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'square', vol: 0.08, at: i * 0.14 })); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.12, at: i * 0.2 })); },
};

// Música: un arpegio sintetizado en bucle
const BASS = [55, 55, 65.4, 49];
const ARP = [[220, 261.6, 329.6, 440], [220, 261.6, 329.6, 392], [261.6, 329.6, 392, 523.3], [196, 246.9, 293.7, 392]];
export function startMusic() {
  if (!ctx || !musicOn || musicTimer) return;
  let bar = 0;
  const beat = 60 / 118 / 2;
  const play = () => {
    const b = bar % 4;
    tone(BASS[b], beat * 7.5, { type: 'sawtooth', vol: 0.22, dest: musicGain });
    for (let i = 0; i < 8; i++) tone(ARP[b][i % 4] * (i >= 4 ? 2 : 1), beat * 0.9, { type: 'square', vol: 0.05, at: i * beat, dest: musicGain });
    for (let i = 0; i < 4; i++) noise(0.05, { vol: 0.08, freq: 7000, type: 'highpass', at: i * beat * 2 + beat });
    bar++;
  };
  play();
  musicTimer = setInterval(play, beat * 8 * 1000);
}
export function stopMusic() { clearInterval(musicTimer); musicTimer = null; }
