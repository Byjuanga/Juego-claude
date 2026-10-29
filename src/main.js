// Neón Arena: menús, partidas, red y bucle principal.
import {
  STEP, SNAP_EVERY, MAX_PLAYERS, COLORS, BOT_NAMES, DIFFICULTY, KILL_OPTIONS, HALF, BOXES, PICKUP_SPOTS,
  PICKUP_INFO, PLAYER_R, SPEED, SPEED_BOOST, DASH_SPEED, DASH_TIME, DASH_CD, FIRE_CD, BULLET_SPEED, BULLET_LIFE,
  BULLET_R, MAX_HP, CHARACTERS,
} from './config.js';
import { Game, moveCircle, pointBlocked, F } from './sim.js';
import { Renderer } from './render.js';
import { initAudio, sfx, setVolume, setMusic, startMusic, stopMusic } from './audio.js';

const PREFIX = 'neonarena-v1-';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3200); }
function show(id) { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id); }
function hideScreens() { for (const s of document.querySelectorAll('.screen')) s.classList.remove('active'); }

// ================== Ajustes del jugador ==================
const prefs = {
  name: store('na.name') || '',
  color: +(store('na.color') || 0),
  bots: +(store('na.bots') || 5),
  diff: store('na.diff') || 'normal',
  kills: +(store('na.kills') || 15),
  quality: store('na.quality') || 'alta',
  volume: store('na.volume') != null ? +store('na.volume') : 0.6,
  music: store('na.music') !== '0',
};
function savePrefs() { for (const [k, v] of Object.entries(prefs)) store('na.' + k, typeof v === 'boolean' ? (v ? '1' : '0') : v); }
const myName = () => ($('name').value.trim() || 'Jugador').slice(0, 14);

// ================== Estado de sesión ==================
const S = {
  mode: null,          // 'solo' | 'host' | 'guest'
  phase: 'menu',       // 'menu' | 'lobby' | 'playing' | 'over'
  myId: null,
  roster: [],          // [{id, name, color, bot, char}]
  settings: { killLimit: 15, difficulty: 'normal' },
  game: null,          // solo / anfitrión
  peer: null, conns: new Map(), hostConn: null, code: '', guestSeq: 0, botSeq: 0,
  paused: false,
};

let renderer;
const view = { players: new Map(), bullets: [], pickups: PICKUP_SPOTS.map(() => 1), time: 0, timeLimit: 300, state: 'playing', focus: null, victory: null };

// ================== Entrada ==================
const input = { keys: new Set(), mx: innerWidth / 2, my: innerHeight / 2, fire: false, dash: false, aim: 0 };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  input.keys.add(e.code);
  if (S.phase === 'playing' || S.phase === 'over') {
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { input.dash = true; input.dashNet = true; e.preventDefault(); }
    if (e.code === 'Tab') { e.preventDefault(); renderScoreboard(); $('scoreboard').hidden = false; }
    if (e.code === 'Escape' && S.phase === 'playing') togglePause();
  }
});
addEventListener('keyup', e => { input.keys.delete(e.code); if (e.code === 'Tab') $('scoreboard').hidden = true; });
addEventListener('mousemove', e => { input.mx = e.clientX; input.my = e.clientY; const c = $('crosshair'); c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; });
addEventListener('mousedown', e => { if (e.button === 0 && S.phase === 'playing' && !S.paused && !e.target.closest('.panel')) input.fire = true; });
addEventListener('mouseup', e => { if (e.button === 0) input.fire = false; });
addEventListener('contextmenu', e => { if (S.phase === 'playing') e.preventDefault(); });
addEventListener('blur', () => { input.keys.clear(); input.fire = false; });
for (const ev of ['keydown', 'keyup', 'mousedown', 'mouseup']) addEventListener(ev, e => { if (!e.repeat) setTimeout(sendGuestInput, 0); });

function moveVec() {
  const k = input.keys;
  let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  let z = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
  if (S.paused) x = z = 0;
  const l = Math.hypot(x, z);
  return l > 0 ? [x / l, z / l] : [0, 0];
}
function updateAim(me) {
  const g = renderer.groundPoint(input.mx, input.my);
  if (g && me) {
    input.aim = Math.atan2(g.x - me.x, g.z - me.z);
    const ax = Math.max(-4, Math.min(4, (g.x - me.x) * 0.2)), az = Math.max(-3, Math.min(3, (g.z - me.z) * 0.2));
    return [ax, az];
  }
  return [0, 0];
}

// ================== Simulación local (solo y anfitrión) ==================
let acc = 0, lastTick = 0, stepCount = 0, pendingEvents = [], endSent = false;
const tickWorker = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),1000/60)'], { type: 'text/javascript' })));
tickWorker.onmessage = () => hostTick();

function startLocalGame() {
  const g = new Game({ killLimit: S.settings.killLimit, difficulty: S.settings.difficulty });
  g.onEvent = e => { pendingEvents.push(e); handleEvent(e); };
  for (const r of S.roster) g.addPlayer(r.id, r.name, r.color, r.bot);
  S.game = g; acc = 0; lastTick = performance.now(); stepCount = 0; pendingEvents = []; endSent = false;
  view.timeLimit = g.timeLimit;
}

function hostTick() {
  const g = S.game;
  if (!g || (S.mode !== 'solo' && S.mode !== 'host')) return;
  const now = performance.now();
  acc += Math.min(0.25, (now - lastTick) / 1000); lastTick = now;
  if (S.paused && S.mode === 'solo') { acc = 0; return; }
  while (acc >= STEP) {
    acc -= STEP;
    const [mx, mz] = moveVec();
    g.setInput(S.myId, { mx, mz, a: input.aim, f: input.fire && !S.paused, d: input.dash });
    input.dash = false;
    g.step(STEP);
    stepCount++;
    if (S.mode === 'host' && stepCount % SNAP_EVERY === 0) {
      const snap = g.snapshot(); snap.ev = pendingEvents; pendingEvents = [];
      broadcast(snap);
    } else if (S.mode === 'solo') pendingEvents = [];
  }
  if (g.state === 'over' && !endSent) {
    endSent = true;
    const msg = { t: 'end', winner: g.winner, ranking: g.ranking() };
    if (S.mode === 'host') { const snap = g.snapshot(); snap.ev = pendingEvents; pendingEvents = []; broadcast(snap); broadcast(msg); }
    onEnd(msg);
  }
}

function viewFromGame() {
  const g = S.game;
  view.players.clear();
  for (const p of g.players.values()) {
    let f = 0;
    if (p.moving) f |= F.MOVING; if (p.dashT > 0) f |= F.DASH; if (p.shield > 0) f |= F.SHIELD;
    if (p.triple > 0) f |= F.TRIPLE; if (p.speed > 0) f |= F.SPEED; if (p.invul > 0) f |= F.INVUL;
    const r = S.roster.find(r => r.id === p.id) || {};
    view.players.set(p.id, {
      id: p.id, name: p.name, color: p.color, char: r.char, x: p.x, z: p.z, aim: p.aim, hp: Math.ceil(p.hp), alive: p.alive, flags: f,
      kills: p.kills, deaths: p.deaths, dashCd: Math.max(0, p.dashCd), triple: p.triple, speed: p.speed, shield: p.shield, respawnT: p.respawnT,
    });
  }
  view.bullets = g.bullets;
  view.pickups = g.pickups.map(k => k.active);
  view.time = g.time;
}

// ================== Cliente remoto (invitado) ==================
const G = { snaps: [], offset: null, pred: null, hist: [], lastSend: 0, localBullets: [], lb: 0, fireCd: 0, me: null };

function resetGuestState() {
  G.snaps = []; G.offset = null; G.pred = null; G.hist = []; G.localBullets = []; G.fireCd = 0; G.me = null;
}

function onSnapshot(s) {
  const now = performance.now() / 1000;
  const off = s.time - now;
  G.offset = G.offset == null ? off : (off > G.offset ? G.offset + (off - G.offset) * 0.05 : off);
  const players = new Map();
  for (const a of s.p) {
    const [id, x, z, aim, hp, alive, flags, kills, deaths, seq, dashCd, triple, speed, shield, respawnT] = a;
    players.set(id, { id, x, z, aim, hp, alive: !!alive, flags, kills, deaths, seq, dashCd, triple, speed, shield, respawnT });
  }
  const bullets = new Map();
  for (const [id, x, z, vx, vz, owner] of s.b) bullets.set(id, { id, x, z, vx, vz, owner });
  G.snaps.push({ time: s.time, players, bullets });
  while (G.snaps.length > 30) G.snaps.shift();
  view.pickups = s.k;
  view.time = s.time;

  // corrección de la predicción propia
  const me = players.get(S.myId);
  if (me) {
    G.me = me;
    if (!me.alive) G.pred = null;
    else if (!G.pred) G.pred = { x: me.x, z: me.z, dashT: 0, dashX: 0, dashZ: 0, dashCd: me.dashCd };
    else {
      const h = G.hist.find(h => h.seq === me.seq);
      if (h) {
        const ex = me.x - h.x, ez = me.z - h.z;
        if (Math.hypot(ex, ez) > 3) { G.pred.x = me.x; G.pred.z = me.z; G.hist = []; }
        else {
          const cx = ex * 0.4, cz = ez * 0.4;
          G.pred.x += cx; G.pred.z += cz;
          for (const k of G.hist) if (k.seq > me.seq) { k.x += cx; k.z += cz; }
        }
      }
      G.hist = G.hist.filter(k => k.seq > me.seq);
    }
  }
  for (const e of s.ev || []) handleEvent(e);
}

function sendGuestInput() {
  if (S.mode !== 'guest' || !S.hostConn || !S.hostConn.open || S.phase !== 'playing') return;
  G.lastSend = performance.now() / 1000;
  const [mx, mz] = moveVec();
  const seq = ++S.guestSeq;
  S.hostConn.send({ t: 'in', seq, mx, mz, a: +input.aim.toFixed(3), f: input.fire && !S.paused, d: !!input.dashNet });
  if (G.pred) G.hist.push({ seq, x: G.pred.x, z: G.pred.z });
  if (G.hist.length > 120) G.hist.shift();
  input.dashNet = false;
}

function guestFrame(dt) {
  const now = performance.now() / 1000;
  const [mx, mz] = moveVec();
  const me = G.me;
  // predicción del movimiento propio
  if (G.pred && me && me.alive && S.phase === 'playing') {
    const p = G.pred;
    p.dashCd -= dt;
    if (input.dash && p.dashCd <= 0) {
      input.dash = false;
      let dx = mx, dz = mz;
      if (Math.hypot(dx, dz) < 0.1) { dx = Math.sin(input.aim); dz = Math.cos(input.aim); }
      const l = Math.hypot(dx, dz); p.dashX = dx / l; p.dashZ = dz / l; p.dashT = DASH_TIME; p.dashCd = DASH_CD;
    }
    let vx, vz;
    if (p.dashT > 0) { p.dashT -= dt; vx = p.dashX * DASH_SPEED; vz = p.dashZ * DASH_SPEED; }
    else { const sp = SPEED * ((me.flags & F.SPEED) ? SPEED_BOOST : 1); vx = mx * sp; vz = mz * sp; }
    p.moving = Math.abs(vx) + Math.abs(vz) > 0.1;
    [p.x, p.z] = moveCircle(p.x, p.z, vx * dt, vz * dt, PLAYER_R);
    // balas propias (solo visuales; el daño lo decide el anfitrión)
    G.fireCd -= dt;
    if (input.fire && G.fireCd <= 0) {
      G.fireCd = FIRE_CD;
      const r = S.roster.find(r => r.id === S.myId);
      for (const da of (me.flags & F.TRIPLE) ? [-0.16, 0, 0.16] : [0]) {
        const a = input.aim + da;
        G.localBullets.push({ id: 'L' + (++G.lb), x: p.x + Math.sin(a) * 0.8, z: p.z + Math.cos(a) * 0.8, vx: Math.sin(a) * BULLET_SPEED, vz: Math.cos(a) * BULLET_SPEED, life: BULLET_LIFE, color: r ? r.color : '#fff' });
      }
      handleEvent({ e: 'shot', id: S.myId, local: true });
    }
  }
  input.dash = false;
  // enviar entrada a 30 Hz
  if (now - G.lastSend > 1 / 30) sendGuestInput();

  // interpolación de los demás (100 ms de retraso)
  if (G.offset == null || !G.snaps.length) return;
  const rt = now + G.offset - 0.1;
  let a = G.snaps[0], b = G.snaps[G.snaps.length - 1];
  for (let i = 0; i < G.snaps.length - 1; i++) {
    if (G.snaps[i].time <= rt && G.snaps[i + 1].time >= rt) { a = G.snaps[i]; b = G.snaps[i + 1]; break; }
  }
  const t = b.time > a.time ? Math.max(0, Math.min(1, (rt - a.time) / (b.time - a.time))) : 1;
  const lerp = (u, v) => u + (v - u) * t;
  const lerpA = (u, v) => { let d = v - u; d = Math.atan2(Math.sin(d), Math.cos(d)); return u + d * t; };
  view.players.clear();
  for (const pb of b.players.values()) {
    const pa = a.players.get(pb.id) || pb;
    const r = S.roster.find(r => r.id === pb.id) || { name: '?', color: '#fff' };
    const latest = G.snaps[G.snaps.length - 1].players.get(pb.id) || pb;
    const v = {
      ...latest, name: r.name, color: r.color, char: r.char,
      x: lerp(pa.x, pb.x), z: lerp(pa.z, pb.z), aim: lerpA(pa.aim, pb.aim), flags: pb.flags,
    };
    if (pb.id === S.myId) {
      v.aim = input.aim;
      if (G.pred && latest.alive) { v.x = G.pred.x; v.z = G.pred.z; v.flags = (latest.flags & ~(F.MOVING | F.DASH)) | (G.pred.moving ? F.MOVING : 0) | (G.pred.dashT > 0 ? F.DASH : 0); v.alive = true; }
      else { v.x = latest.x; v.z = latest.z; v.alive = latest.alive; }
    }
    view.players.set(pb.id, v);
  }
  // balas: las ajenas interpoladas, las propias simuladas en local
  const bl = [];
  for (const bb of b.bullets.values()) {
    if (bb.owner === S.myId) continue;
    const ba = a.bullets.get(bb.id);
    const r = S.roster.find(r => r.id === bb.owner);
    const x = ba ? lerp(ba.x, bb.x) : bb.x - bb.vx * (b.time - rt);
    const z = ba ? lerp(ba.z, bb.z) : bb.z - bb.vz * (b.time - rt);
    bl.push({ id: bb.id, x, z, vx: bb.vx, vz: bb.vz, color: r ? r.color : '#fff' });
  }
  G.localBullets = G.localBullets.filter(lb => {
    lb.x += lb.vx * dt; lb.z += lb.vz * dt; lb.life -= dt;
    if (lb.life <= 0) return false;
    if (pointBlocked(lb.x, lb.z, BULLET_R * 0.5)) { renderer.burst(lb.x, 1.1, lb.z, lb.color, 10, 4, 3); return false; }
    for (const p of view.players.values()) if (p.id !== S.myId && p.alive && Math.hypot(p.x - lb.x, p.z - lb.z) < PLAYER_R + BULLET_R) return false;
    bl.push(lb); return true;
  });
  view.bullets = bl;
}

// ================== Eventos (sonido, efectos y textos) ==================
const kf = [];
let lastKillAt = 0, streak = 0, firstBlood = false;
function handleEvent(e) {
  const players = view.players;
  if (e.e === 'shot' && e.id === S.myId && S.mode === 'guest' && !e.local) return; // ya se mostró en local
  renderer.fx(e, players, S.myId);
  const nameOf = id => { const r = S.roster.find(r => r.id === id); return r ? r : { name: '?', color: '#fff' }; };
  switch (e.e) {
    case 'shot': if (e.id === S.myId) sfx.shot(1); else { const p = players.get(e.id), me = players.get(S.myId); const d = p && me ? Math.hypot(p.x - me.x, p.z - me.z) : 20; if (d < 25) sfx.shot(Math.max(0.15, 1 - d / 25) * 0.6); } break;
    case 'hit':
      if (e.id === S.myId) { sfx.hurt(); flashDamage(); }
      else if (e.by === S.myId) sfx.hit();
      break;
    case 'kill': {
      sfx.kill();
      const k = nameOf(e.killer), v = nameOf(e.victim);
      addKillfeed(`<span style="color:${k.color}">${esc(k.name)}</span> ⚡ <span style="color:${v.color}">${esc(v.name)}</span>`, e.killer === S.myId || e.victim === S.myId);
      if (!firstBlood) { firstBlood = true; announce(e.killer === S.myId ? '¡Primera sangre!' : k.name + ': primera sangre'); }
      if (e.killer === S.myId) {
        sfx.myKill();
        const now = performance.now();
        streak = now - lastKillAt < 4000 ? streak + 1 : 1; lastKillAt = now;
        if (streak === 2) announce('¡Doble eliminación!'); else if (streak === 3) announce('¡Triple eliminación!'); else if (streak >= 4) announce('¡Imparable!');
      }
      break;
    }
    case 'pickup': if (e.id === S.myId) { sfx.pickup(); announce(PICKUP_INFO[e.type].label, 900); } break;
    case 'dash': if (e.id === S.myId) sfx.dash(); break;
    case 'spawn': if (e.id === S.myId) sfx.spawn(); break;
  }
}
function addKillfeed(html, mine) {
  const el = document.createElement('div'); el.innerHTML = html; if (mine) el.className = 'me';
  $('killfeed').prepend(el);
  while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
  setTimeout(() => el.remove(), 6000);
}
function announce(text, ms = 1600) {
  const el = $('announce'); el.textContent = text; el.classList.add('show');
  clearTimeout(announce.t); announce.t = setTimeout(() => el.classList.remove('show'), ms);
}
function flashDamage() { const v = $('vignette'); v.style.opacity = 0.55; clearTimeout(flashDamage.t); flashDamage.t = setTimeout(() => v.style.opacity = 0, 140); }

// ================== HUD ==================
let hudT = 0;
function updateHud(dt) {
  hudT -= dt;
  const me = view.players.get(S.myId);
  if (me) {
    const hp = me.alive ? me.hp : 0;
    $('hpbar').firstElementChild.style.width = (hp / MAX_HP * 100) + '%';
    $('hpbar').className = hp > 50 ? '' : hp > 25 ? 'mid' : 'low';
    $('hpnum').textContent = hp;
    const cd = S.mode === 'guest' && G.pred ? Math.max(0, G.pred.dashCd) : me.dashCd;
    $('dash').firstElementChild.style.width = ((1 - Math.min(1, cd / DASH_CD)) * 100) + '%';
    $('dash').classList.toggle('ready', cd <= 0);
    $('respawn').hidden = me.alive || S.phase !== 'playing';
    $('respawnT').textContent = Math.max(1, Math.ceil(me.respawnT || 0));
  }
  if (hudT > 0) return;
  hudT = 0.2;
  const rem = Math.max(0, view.timeLimit - view.time);
  $('timer').textContent = Math.floor(rem / 60) + ':' + String(Math.floor(rem % 60)).padStart(2, '0');
  $('goal').textContent = 'Objetivo: ' + S.settings.killLimit + ' bajas';
  const list = [...view.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  $('mini-board').innerHTML = list.slice(0, 5).map(p => `<div class="${p.id === S.myId ? 'me' : ''}" style="--c:${p.color}"><span>${esc(p.name)}</span><b>${p.kills}</b></div>`).join('');
  if (me) {
    const pw = [];
    if (me.triple > 0) pw.push(['Triple', me.triple, PICKUP_INFO.triple.color]);
    if (me.speed > 0) pw.push(['Velocidad', me.speed, PICKUP_INFO.speed.color]);
    if (me.shield > 0) pw.push(['Escudo', me.shield, PICKUP_INFO.shield.color]);
    $('powerups').innerHTML = pw.map(([n, t, c]) => `<div style="--c:${c}">${n} ${Math.ceil(t)}s</div>`).join('');
  }
  drawMinimap();
}

const mm = $('minimap').getContext('2d');
function drawMinimap() {
  const W = 200, s = W / (HALF * 2), X = x => (x + HALF) * s;
  mm.clearRect(0, 0, W, W);
  mm.fillStyle = '#2a3170';
  for (const b of BOXES) mm.fillRect(X(b.x - b.w / 2), X(b.z - b.d / 2), b.w * s, b.d * s);
  PICKUP_SPOTS.forEach((k, i) => { if (!view.pickups[i]) return; mm.fillStyle = PICKUP_INFO[k.type].color; mm.fillRect(X(k.x) - 2, X(k.z) - 2, 4, 4); });
  for (const p of view.players.values()) {
    if (!p.alive) continue;
    const me = p.id === S.myId;
    mm.beginPath(); mm.arc(X(p.x), X(p.z), me ? 5 : 3.5, 0, Math.PI * 2);
    mm.fillStyle = p.color; mm.fill();
    if (me) { mm.strokeStyle = '#fff'; mm.lineWidth = 2; mm.stroke(); }
  }
}

function renderScoreboard() {
  const list = [...view.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  $('scoreTable').innerHTML = '<tr><th>Jugador</th><th class="n">Bajas</th><th class="n">Muertes</th></tr>' +
    list.map(p => `<tr class="${p.id === S.myId ? 'me' : ''}"><td><span class="dot" style="--c:${p.color}"></span>${esc(p.name)}</td><td class="n">${p.kills}</td><td class="n">${p.deaths}</td></tr>`).join('');
}

// ================== Flujo de partida ==================
function enterGame() {
  S.phase = 'playing'; S.paused = false;
  view.victory = null; view.focus = null; view.players.clear(); view.bullets = [];
  firstBlood = false; streak = 0; $('killfeed').innerHTML = '';
  renderer.clearAll();
  hideScreens();
  $('hud').hidden = false; $('scoreboard').hidden = true;
  document.body.classList.add('playing');
  initAudio(); startMusic();
  announce('¡A luchar!', 1200);
}

function onEnd(msg) {
  S.phase = 'over';
  input.fire = false;
  view.victory = msg.winner;
  const won = msg.winner === S.myId;
  won ? sfx.win() : sfx.lose();
  stopMusic();
  const w = msg.ranking[0];
  $('endTitle').innerHTML = won ? '¡Has ganado!' : (w ? `<span style="color:${w.color}">${esc(w.name)}</span> gana` : 'Fin');
  $('endTable').innerHTML = '<tr><th>#</th><th>Jugador</th><th class="n">Bajas</th><th class="n">Muertes</th></tr>' +
    msg.ranking.map((p, i) => `<tr class="${p.id === S.myId ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="--c:${p.color}"></span>${esc(p.name)}</td><td class="n">${p.kills}</td><td class="n">${p.deaths}</td></tr>`).join('');
  const canRestart = S.mode !== 'guest';
  $('btnAgain').hidden = !canRestart;
  $('endHint').textContent = canRestart ? '' : 'Esperando a que el anfitrión pida revancha…';
  $('btnEndMenu').textContent = S.mode === 'solo' ? 'Menú' : 'Salir de la sala';
  setTimeout(() => {
    if (S.phase !== 'over') return;
    document.body.classList.remove('playing'); $('hud').hidden = true; show('end');
  }, 3500);
}

function togglePause() {
  const on = !$('pause').classList.contains('active');
  $('pause').classList.toggle('active', on);
  S.paused = on && S.mode === 'solo';
  document.body.classList.toggle('playing', !on);
  if (on) input.fire = false;
}

function leave(msg) {
  const peer = S.peer, hc = S.hostConn;
  S.peer = null; S.hostConn = null;
  for (const c of S.conns.values()) { try { c.close(); } catch (e) {} }
  S.conns.clear();
  try { hc && hc.close(); } catch (e) {}
  try { peer && peer.destroy(); } catch (e) {}
  S.mode = null; S.phase = 'menu'; S.game = null; S.roster = []; S.paused = false;
  resetGuestState();
  view.players.clear(); view.bullets = []; view.victory = null; view.focus = { x: 0, z: 0 };
  renderer.clearAll();
  $('hud').hidden = true; document.body.classList.remove('playing');
  stopMusic();
  show('menu');
  if (msg) toast(msg);
  if (location.search) history.replaceState(null, '', location.pathname);
}

// ---------- Solo ----------
function startSolo() {
  savePrefs();
  S.mode = 'solo'; S.myId = 'h';
  S.settings = { killLimit: prefs.kills, difficulty: prefs.diff };
  S.roster = [{ id: 'h', name: myName(), color: COLORS[prefs.color], bot: false, char: CHARACTERS[0].id }];
  for (let i = 0; i < prefs.bots; i++) addBotToRoster();
  enterGame();
  startLocalGame();
}

function addBotToRoster() {
  const used = new Set(S.roster.map(r => r.color));
  const names = new Set(S.roster.map(r => r.name));
  const color = COLORS.find(c => !used.has(c)) || COLORS[S.roster.length % COLORS.length];
  const name = BOT_NAMES.find(n => !names.has(n)) || 'Bot ' + (S.botSeq + 1);
  S.roster.push({ id: 'b' + (++S.botSeq), name, color, bot: true, char: CHARACTERS[S.botSeq % CHARACTERS.length].id });
}

// ---------- Anfitrión ----------
function peerOk() { if (window.Peer) return true; toast('No se pudo cargar el módulo online. Revisa tu conexión.'); return false; }
function genCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }

function createRoom() {
  if (!peerOk()) return;
  savePrefs(); initAudio();
  const code = genCode();
  $('waitText').textContent = 'Creando sala…'; show('wait');
  const p = new Peer(PREFIX + code, { debug: 0 });
  S.peer = p;
  p.on('open', () => {
    if (S.peer !== p) return;
    S.mode = 'host'; S.code = code; S.myId = 'h'; S.phase = 'lobby';
    S.settings = { killLimit: prefs.kills, difficulty: prefs.diff };
    S.roster = [{ id: 'h', name: myName(), color: COLORS[prefs.color], bot: false, char: CHARACTERS[0].id }];
    showLobby();
  });
  p.on('connection', conn => { if (S.peer === p) acceptGuest(conn); });
  p.on('disconnected', () => { if (S.peer === p && !p.destroyed) { try { p.reconnect(); } catch (e) {} } });
  p.on('error', e => {
    if (S.peer !== p) return;
    if (e.type === 'unavailable-id') { S.peer = null; p.destroy(); return createRoom(); }
    if (e.type === 'peer-unavailable') return;
    if (S.mode !== 'host') leave('No se pudo crear la sala (' + e.type + ')');
    else toast('Problema de conexión (' + e.type + ')');
  });
}

function broadcast(msg) { for (const c of S.conns.values()) if (c.open) { try { c.send(msg); } catch (e) {} } }

function sendLobby() {
  for (const [id, c] of S.conns) if (c.open) c.send({ t: 'lobby', roster: S.roster, you: id, code: S.code, settings: S.settings });
}

function acceptGuest(conn) {
  conn.on('data', m => {
    if (!m || typeof m !== 'object' || S.mode !== 'host') return;
    if (m.t === 'hello' && !conn.pid) {
      if (S.roster.length >= MAX_PLAYERS) {
        // si hay bots, se sustituye uno por el jugador
        const bi = S.roster.findIndex(r => r.bot);
        if (bi < 0) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); return; }
        const [bot] = S.roster.splice(bi, 1);
        if (S.game) S.game.removePlayer(bot.id);
      }
      const id = 'g' + (++S.guestSeq);
      conn.pid = id;
      const used = new Set(S.roster.map(r => r.color));
      let color = COLORS.includes(m.color) && !used.has(m.color) ? m.color : (COLORS.find(c => !used.has(c)) || COLORS[0]);
      const r = { id, name: String(m.name || 'Jugador').slice(0, 14), color, bot: false, char: CHARACTERS[0].id };
      S.roster.push(r); S.conns.set(id, conn);
      sfx.spawn();
      toast(r.name + ' se ha unido');
      if (S.phase === 'playing' || S.phase === 'over') {
        if (S.phase === 'playing') S.game.addPlayer(id, r.name, r.color, false);
        broadcast({ t: 'roster', roster: S.roster });
        conn.send({ t: 'start', roster: S.roster, you: id, settings: S.settings });
      } else showLobby();
    } else if (m.t === 'in' && conn.pid && S.game) {
      S.game.setInput(conn.pid, m);
    }
  });
  const drop = () => {
    if (!conn.pid || !S.conns.has(conn.pid)) return;
    S.conns.delete(conn.pid);
    const i = S.roster.findIndex(r => r.id === conn.pid);
    if (i >= 0) { toast(S.roster[i].name + ' ha salido'); S.roster.splice(i, 1); }
    if (S.game) S.game.removePlayer(conn.pid);
    if (S.phase === 'lobby') showLobby(); else broadcast({ t: 'roster', roster: S.roster });
  };
  conn.on('close', drop);
  conn.on('error', drop);
}

function hostStart() {
  if (S.roster.length < 2) return;
  S.phase = 'playing';
  for (const [id, c] of S.conns) if (c.open) c.send({ t: 'start', roster: S.roster, you: id, settings: S.settings });
  enterGame();
  startLocalGame();
}

// ---------- Invitado ----------
function joinRoom(raw) {
  const code = raw.trim().toUpperCase();
  if (code.length !== 5) { toast('El código tiene 5 caracteres'); return; }
  if (!peerOk()) return;
  savePrefs(); initAudio();
  $('waitText').textContent = 'Conectando a la sala ' + code + '…'; show('wait');
  const p = new Peer({ debug: 0 });
  S.peer = p; S.mode = 'guest'; S.guestSeq = 0;
  const fail = setTimeout(() => { if (S.peer === p && !(S.hostConn && S.hostConn.open)) leave('No se pudo conectar. ¿Es correcto el código?'); }, 15000);
  p.on('open', () => {
    if (S.peer !== p) return;
    const c = p.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    S.hostConn = c;
    c.on('open', () => { clearTimeout(fail); S.code = code; c.send({ t: 'hello', name: myName(), color: COLORS[prefs.color] }); });
    c.on('data', m => { if (S.hostConn === c && m && typeof m === 'object') onHostData(m); });
    c.on('close', () => { if (S.hostConn === c) leave('Se perdió la conexión con el anfitrión'); });
  });
  p.on('error', e => {
    if (S.peer !== p) return;
    clearTimeout(fail);
    leave(e.type === 'peer-unavailable' ? 'Sala no encontrada' : 'Error de conexión (' + e.type + ')');
  });
}

function onHostData(m) {
  switch (m.t) {
    case 'lobby':
      S.myId = m.you; S.roster = m.roster; S.settings = m.settings; S.code = m.code;
      if (S.phase !== 'lobby') { S.phase = 'lobby'; renderer.clearAll(); $('hud').hidden = true; document.body.classList.remove('playing'); stopMusic(); }
      showLobby();
      break;
    case 'start':
      if (m.you) S.myId = m.you;
      S.roster = m.roster; S.settings = m.settings;
      resetGuestState();
      view.timeLimit = 300;
      enterGame();
      break;
    case 'roster': S.roster = m.roster; break;
    case 's': if (S.phase === 'playing') onSnapshot(m); break;
    case 'end': onEnd(m); break;
    case 'full': leave('La sala está llena (máximo ' + MAX_PLAYERS + ')'); break;
  }
}

// ---------- Sala ----------
function showLobby() {
  S.phase = 'lobby';
  const isHost = S.mode === 'host';
  if (isHost) sendLobby();
  $('roomCode').textContent = S.code;
  $('rosterCount').textContent = `(${S.roster.length}/${MAX_PLAYERS})`;
  $('roster').innerHTML = S.roster.map(r => `<li style="--c:${r.color}"><i></i><span>${esc(r.name)}</span>` +
    `<em>${r.id === 'h' ? 'Anfitrión' : r.bot ? 'Bot' : ''}${r.id === S.myId ? ' · Tú' : ''}</em>` +
    (isHost && r.bot ? `<button data-rm="${r.id}" aria-label="Quitar bot">✕</button>` : '') + '</li>').join('');
  $('btnAddBot').hidden = !isHost; $('btnStart').hidden = !isHost;
  $('btnAddBot').disabled = S.roster.length >= MAX_PLAYERS;
  $('btnStart').disabled = S.roster.length < 2;
  renderSeg('lobDiff', Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]), S.settings.difficulty, isHost ? v => { S.settings.difficulty = v; prefs.diff = v; showLobby(); } : null);
  renderSeg('lobKills', KILL_OPTIONS.map(k => [k, String(k)]), S.settings.killLimit, isHost ? v => { S.settings.killLimit = v; prefs.kills = v; showLobby(); } : null);
  $('lobbyHint').textContent = isHost
    ? (S.roster.length < 2 ? 'Invita a tus amigos con el código o añade bots.' : 'Pulsa Empezar cuando estéis listos. Se puede entrar a mitad de partida.')
    : 'Esperando a que el anfitrión empiece la partida…';
  show('lobby');
}

// ================== Menús ==================
function renderSeg(id, opts, cur, onPick) {
  const el = $(id);
  el.innerHTML = opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}" ${onPick ? '' : 'disabled'}>${l}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button'); if (!b || !onPick) return; sfx.click(); const v = b.dataset.v; onPick(isNaN(+v) ? v : +v); };
}
function renderSoloSetup() {
  renderSeg('segBots', [1, 2, 3, 4, 5, 6, 7].map(n => [n, String(n)]), prefs.bots, v => { prefs.bots = v; renderSoloSetup(); });
  renderSeg('segDiff', Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]), prefs.diff, v => { prefs.diff = v; renderSoloSetup(); });
  renderSeg('segKills', KILL_OPTIONS.map(k => [k, String(k)]), prefs.kills, v => { prefs.kills = v; renderSoloSetup(); });
}
function renderSwatches() {
  $('swatches').innerHTML = COLORS.map((c, i) => `<button style="--c:${c}" class="${i === prefs.color ? 'on' : ''}" data-i="${i}" aria-label="Color ${i + 1}"></button>`).join('');
}

function wireMenus() {
  $('name').value = prefs.name;
  $('name').addEventListener('input', () => { prefs.name = $('name').value.trim(); savePrefs(); });
  renderSwatches();
  $('swatches').onclick = e => { const b = e.target.closest('button'); if (!b) return; prefs.color = +b.dataset.i; savePrefs(); renderSwatches(); };
  for (const id of ['quality', 'quality2']) {
    $(id).value = prefs.quality;
    $(id).onchange = () => { prefs.quality = $(id).value; $('quality').value = $('quality2').value = prefs.quality; renderer.setQuality(prefs.quality); savePrefs(); };
  }
  for (const id of ['volume', 'volume2']) {
    $(id).value = prefs.volume;
    $(id).oninput = () => { prefs.volume = +$(id).value; $('volume').value = $('volume2').value = prefs.volume; setVolume(prefs.volume); savePrefs(); };
  }
  $('music').checked = prefs.music;
  $('music').onchange = () => { prefs.music = $('music').checked; setMusic(prefs.music); savePrefs(); };
  setVolume(prefs.volume); setMusic(prefs.music);

  $('btnSolo').onclick = () => { initAudio(); sfx.click(); renderSoloSetup(); show('solo'); };
  $('btnSoloGo').onclick = startSolo;
  $('btnCreate').onclick = createRoom;
  $('btnJoin').onclick = () => joinRoom($('code').value);
  $('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom($('code').value); });
  for (const b of document.querySelectorAll('[data-back]')) b.onclick = () => { if (S.mode) leave(); else show('menu'); };
  $('btnAddBot').onclick = () => { if (S.mode !== 'host' || S.roster.length >= MAX_PLAYERS) return; addBotToRoster(); showLobby(); };
  $('roster').onclick = e => {
    const b = e.target.closest('[data-rm]'); if (!b || S.mode !== 'host') return;
    S.roster = S.roster.filter(r => r.id !== b.dataset.rm); showLobby();
  };
  $('btnStart').onclick = hostStart;
  $('btnCopy').onclick = async () => {
    const url = location.origin + location.pathname + '?sala=' + S.code;
    const text = `¡Únete a mi partida de Neón Arena! Código: ${S.code}\n${url}`;
    try { await navigator.clipboard.writeText(text); toast('Invitación copiada. Pégala en WhatsApp o Discord.'); }
    catch (e) { toast('Comparte este enlace: ' + url); }
  };
  $('btnResume').onclick = togglePause;
  $('btnLeave').onclick = () => { $('pause').classList.remove('active'); leave(); };
  $('btnEndMenu').onclick = () => leave();
  $('btnAgain').onclick = () => {
    if (S.mode === 'solo') { enterGame(); startLocalGame(); }
    else if (S.mode === 'host') {
      S.game = null; renderer.clearAll(); $('hud').hidden = true; document.body.classList.remove('playing'); stopMusic();
      showLobby();
    }
  };
}

// ================== Bucle principal ==================
let lastFrame = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  if (S.phase === 'playing' || S.phase === 'over') {
    if (S.mode === 'guest') guestFrame(dt);
    else if (S.game) viewFromGame();
    const me = view.players.get(S.myId);
    const [ax, az] = updateAim(me);
    if (view.victory != null) {
      const w = view.players.get(view.victory);
      if (w) view.focus = { x: w.x, z: w.z };
    } else if (me) view.focus = { x: me.x, z: me.z, ax: me.alive ? ax : 0, az: me.alive ? az : 0 };
    updateHud(dt);
  } else {
    // fondo del menú: la arena vacía girando
    view.players.clear(); view.bullets = [];
    view.focus = { x: Math.sin(now / 6000) * 6, z: Math.cos(now / 6000) * 6 };
  }
  renderer.update(view, dt, S.myId);
}

// ================== Arranque ==================
async function boot() {
  renderer = new Renderer($('scene'));
  renderer.setQuality(prefs.quality);
  try {
    await renderer.load(f => { $('loadBar').style.width = Math.round(f * 100) + '%'; });
  } catch (e) {
    $('loadText').textContent = 'No se pudieron cargar los modelos. Si abriste el archivo directamente, usa la web de GitHub Pages o un servidor local.';
    console.error(e);
    return;
  }
  try { await document.fonts.ready; } catch (e) {}
  wireMenus();
  show('menu');
  requestAnimationFrame(frame);
  const invite = new URLSearchParams(location.search).get('sala');
  if (invite) { $('code').value = invite.toUpperCase().slice(0, 5); toast('Te han invitado a la sala ' + $('code').value + '. Escribe tu nombre y pulsa Unirse.'); }
}
window.__na = { S, view, get renderer() { return renderer; } };
boot();
