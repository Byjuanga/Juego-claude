// Simulación del juego (la ejecuta el anfitrión). Sin dependencias de dibujo.
import {
  HALF, PLAYER_R, MAX_HP, SPEED, SPEED_BOOST, DASH_SPEED, DASH_TIME, DASH_CD, FIRE_CD,
  BULLET_SPEED, BULLET_DMG, BULLET_LIFE, BULLET_R, RESPAWN_TIME, SPAWN_SHIELD, POWER_TIME,
  PICKUP_RESPAWN, BOXES, SPAWNS, PICKUP_SPOTS, DIFFICULTY, TIME_LIMIT,
} from './config.js';

// ---------- Geometría compartida (también la usa la predicción del cliente) ----------
export function moveCircle(x, z, dx, dz, r) {
  x += dx; z += dz;
  for (let it = 0; it < 2; it++) {
    for (const b of BOXES) {
      const hx = b.w / 2, hz = b.d / 2;
      const cx = Math.max(b.x - hx, Math.min(x, b.x + hx));
      const cz = Math.max(b.z - hz, Math.min(z, b.z + hz));
      let ox = x - cx, oz = z - cz;
      const d2 = ox * ox + oz * oz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = r - d;
          x += ox / d * push; z += oz / d * push;
        } else {
          // centro dentro de la caja: salir por el lado más cercano
          const px = hx - Math.abs(x - b.x) + r, pz = hz - Math.abs(z - b.z) + r;
          if (px < pz) x += Math.sign(x - b.x || 1) * px; else z += Math.sign(z - b.z || 1) * pz;
        }
      }
    }
  }
  const lim = HALF - r;
  x = Math.max(-lim, Math.min(lim, x));
  z = Math.max(-lim, Math.min(lim, z));
  return [x, z];
}

export function pointBlocked(x, z, pad = 0) {
  if (Math.abs(x) > HALF - pad || Math.abs(z) > HALF - pad) return true;
  for (const b of BOXES) {
    if (Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad) return true;
  }
  return false;
}

// ¿Hay línea de visión entre dos puntos? (método de las losas sobre cada caja)
export function lineOfSight(x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  for (const b of BOXES) {
    let tmin = 0, tmax = 1;
    const mins = [b.x - b.w / 2, b.z - b.d / 2], maxs = [b.x + b.w / 2, b.z + b.d / 2];
    const o = [x1, z1], d = [dx, dz];
    let hit = true;
    for (let i = 0; i < 2; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mins[i] || o[i] > maxs[i]) { hit = false; break; } }
      else {
        let t1 = (mins[i] - o[i]) / d[i], t2 = (maxs[i] - o[i]) / d[i];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) { hit = false; break; }
      }
    }
    if (hit) return false;
  }
  return true;
}

// Bit flags que viajan en los snapshots
export const F = { MOVING: 1, DASH: 2, SHIELD: 4, TRIPLE: 8, SPEED: 16, INVUL: 32 };

// ---------- Juego ----------
export class Game {
  constructor({ killLimit = 15, difficulty = 'normal', timeLimit = TIME_LIMIT } = {}) {
    this.killLimit = killLimit;
    this.timeLimit = timeLimit;
    this.difficulty = difficulty;
    this.players = new Map();
    this.bullets = [];
    this.pickups = PICKUP_SPOTS.map((s, i) => ({ id: i, ...s, active: true, t: 0 }));
    this.time = 0;
    this.state = 'playing';
    this.winner = null;
    this.nextBullet = 1;
    this.onEvent = () => {};
  }

  addPlayer(id, name, color, bot = false) {
    const p = {
      id, name, color, bot,
      x: 0, z: 0, aim: 0, hp: MAX_HP, alive: false, respawnT: 0.5,
      kills: 0, deaths: 0, fireCd: 0, dashCd: 0, dashT: 0, dashX: 0, dashZ: 0,
      triple: 0, speed: 0, shield: 0, invul: 0, moving: false,
      input: { mx: 0, mz: 0, a: 0, f: false, d: false, seq: 0 },
      ai: bot ? { t: 0, target: null, strafe: 1, strafeT: 0, goal: null, stuckT: 0, lx: 0, lz: 0, wander: 0, fireHold: 0 } : null,
    };
    this.players.set(id, p);
    this.respawn(p);
    return p;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.bullets = this.bullets.filter(b => b.owner !== id);
  }

  setInput(id, inp) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    const m = Math.hypot(inp.mx || 0, inp.mz || 0);
    p.input.mx = m > 1 ? inp.mx / m : (+inp.mx || 0);
    p.input.mz = m > 1 ? inp.mz / m : (+inp.mz || 0);
    if (Number.isFinite(inp.a)) p.input.a = inp.a;
    p.input.f = !!inp.f;
    if (inp.d) p.input.d = true;      // el dash se mantiene hasta consumirse
    if (Number.isInteger(inp.seq)) p.input.seq = inp.seq;
  }

  respawn(p) {
    // el punto de aparición más alejado de los enemigos vivos
    let best = SPAWNS[0], bestD = -1;
    const shuffled = SPAWNS.slice().sort(() => Math.random() - 0.5);
    for (const s of shuffled) {
      let dmin = 1e9;
      for (const q of this.players.values()) if (q !== p && q.alive) dmin = Math.min(dmin, Math.hypot(q.x - s[0], q.z - s[1]));
      if (dmin > bestD) { bestD = dmin; best = s; }
    }
    p.x = best[0]; p.z = best[1];
    p.aim = Math.atan2(-p.x, -p.z);
    p.hp = MAX_HP; p.alive = true; p.invul = SPAWN_SHIELD;
    p.triple = p.speed = p.shield = 0; p.dashT = 0;
    this.onEvent({ e: 'spawn', id: p.id, x: p.x, z: p.z });
  }

  step(dt) {
    if (this.state !== 'playing') return;
    this.time += dt;

    for (const p of this.players.values()) {
      if (!p.alive) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) this.respawn(p);
        continue;
      }
      if (p.bot) this.botThink(p, dt);
      const inp = p.input;
      p.aim = inp.a;
      p.fireCd -= dt; p.dashCd -= dt;
      for (const k of ['triple', 'speed', 'shield', 'invul']) if (p[k] > 0) p[k] = Math.max(0, p[k] - dt);

      // dash
      if (inp.d) {
        inp.d = false;
        if (p.dashCd <= 0) {
          let dx = inp.mx, dz = inp.mz;
          if (Math.hypot(dx, dz) < 0.1) { dx = Math.sin(p.aim); dz = Math.cos(p.aim); }
          const l = Math.hypot(dx, dz); p.dashX = dx / l; p.dashZ = dz / l;
          p.dashT = DASH_TIME; p.dashCd = DASH_CD;
          this.onEvent({ e: 'dash', id: p.id });
        }
      }
      let vx, vz;
      if (p.dashT > 0) { p.dashT -= dt; vx = p.dashX * DASH_SPEED; vz = p.dashZ * DASH_SPEED; }
      else {
        const sp = SPEED * (p.speed > 0 ? SPEED_BOOST : 1);
        vx = inp.mx * sp; vz = inp.mz * sp;
      }
      p.moving = Math.abs(vx) + Math.abs(vz) > 0.1;
      [p.x, p.z] = moveCircle(p.x, p.z, vx * dt, vz * dt, PLAYER_R);

      // disparo
      if (inp.f && p.fireCd <= 0) {
        p.fireCd = FIRE_CD;
        const angles = p.triple > 0 ? [-0.16, 0, 0.16] : [0];
        for (const da of angles) {
          const a = p.aim + da;
          const sx = Math.sin(a), sz = Math.cos(a);
          this.bullets.push({
            id: this.nextBullet++, owner: p.id, color: p.color,
            x: p.x + sx * 0.8, z: p.z + sz * 0.8, vx: sx * BULLET_SPEED, vz: sz * BULLET_SPEED, life: BULLET_LIFE,
          });
        }
        this.onEvent({ e: 'shot', id: p.id });
      }

      // objetos
      for (const k of this.pickups) {
        if (!k.active || Math.hypot(k.x - p.x, k.z - p.z) > 1.3) continue;
        if (k.type === 'health' && p.hp >= MAX_HP) continue;
        k.active = false; k.t = PICKUP_RESPAWN;
        if (k.type === 'health') p.hp = Math.min(MAX_HP, p.hp + 40);
        else p[k.type] = POWER_TIME;
        this.onEvent({ e: 'pickup', id: p.id, type: k.type, x: k.x, z: k.z });
      }
    }

    for (const k of this.pickups) if (!k.active && (k.t -= dt) <= 0) k.active = true;

    // balas
    const keep = [];
    for (const b of this.bullets) {
      const steps = 2;
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        b.x += b.vx * dt / steps; b.z += b.vz * dt / steps;
        if (pointBlocked(b.x, b.z, BULLET_R * 0.5)) {
          dead = true; this.onEvent({ e: 'impact', x: b.x, z: b.z, c: b.color }); break;
        }
        for (const p of this.players.values()) {
          if (!p.alive || p.id === b.owner) continue;
          if (Math.hypot(p.x - b.x, p.z - b.z) < PLAYER_R + BULLET_R) {
            dead = true; this.damage(p, b); break;
          }
        }
      }
      b.life -= dt;
      if (!dead && b.life > 0) keep.push(b);
    }
    this.bullets = keep;

    if (this.time >= this.timeLimit) this.finish();
  }

  damage(p, b) {
    if (p.invul > 0) { this.onEvent({ e: 'block', id: p.id, x: b.x, z: b.z }); return; }
    const dmg = p.shield > 0 ? BULLET_DMG * 0.4 : BULLET_DMG;
    p.hp -= dmg;
    this.onEvent({ e: 'hit', id: p.id, by: b.owner, x: b.x, z: b.z, c: b.color });
    if (p.ai) { p.ai.target = b.owner; p.ai.t = 0; }
    if (p.hp <= 0) {
      p.hp = 0; p.alive = false; p.deaths++; p.respawnT = RESPAWN_TIME;
      const k = this.players.get(b.owner);
      if (k) k.kills++;
      this.onEvent({ e: 'kill', killer: b.owner, victim: p.id, x: p.x, z: p.z });
      if (k && k.kills >= this.killLimit) this.finish();
    }
  }

  finish() {
    if (this.state !== 'playing') return;
    this.state = 'over';
    const rank = this.ranking();
    this.winner = rank[0] ? rank[0].id : null;
    this.onEvent({ e: 'end', winner: this.winner });
  }

  ranking() {
    return [...this.players.values()]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .map(p => ({ id: p.id, name: p.name, color: p.color, kills: p.kills, deaths: p.deaths, bot: p.bot }));
  }

  // ---------- IA ----------
  botThink(p, dt) {
    const ai = p.ai, sk = DIFFICULTY[this.difficulty] || DIFFICULTY.normal, inp = p.input;
    ai.t -= dt; ai.strafeT -= dt; ai.wander -= dt;

    // detectar atascos
    ai.stuckT += dt;
    if (ai.stuckT > 1) {
      if (Math.hypot(p.x - ai.lx, p.z - ai.lz) < 0.6 && ai.wander <= 0) {
        ai.wander = 1.2; ai.wx = (Math.random() - 0.5) * 2; ai.wz = (Math.random() - 0.5) * 2;
      }
      ai.stuckT = 0; ai.lx = p.x; ai.lz = p.z;
    }

    if (ai.t <= 0) {
      ai.t = sk.react * (0.7 + Math.random() * 0.6);
      // objetivo: el enemigo visible más cercano, o el más cercano en general
      let best = null, bd = 1e9, bestVis = null, bvd = 1e9;
      for (const q of this.players.values()) {
        if (q === p || !q.alive) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < bd) { bd = d; best = q; }
        if (d < 28 && d < bvd && lineOfSight(p.x, p.z, q.x, q.z)) { bvd = d; bestVis = q; }
      }
      const cur = this.players.get(ai.target);
      if (!(cur && cur.alive && lineOfSight(p.x, p.z, cur.x, cur.z))) ai.target = (bestVis || best || {}).id ?? null;
      ai.visible = !!bestVis || !!(cur && cur.alive && lineOfSight(p.x, p.z, cur.x, cur.z));

      // meta de movimiento
      ai.goal = null;
      const want = p.hp < 45 ? 'health' : (p.triple <= 0 && Math.random() < 0.3 ? 'triple' : null);
      if (want) {
        let kd = 1e9;
        for (const k of this.pickups) if (k.active && k.type === want) {
          const d = Math.hypot(k.x - p.x, k.z - p.z);
          if (d < kd && d < 30) { kd = d; ai.goal = [k.x, k.z]; }
        }
      }
      if (ai.strafeT <= 0) { ai.strafe = Math.random() < 0.5 ? 1 : -1; ai.strafeT = 0.8 + Math.random() * 1.5; }
    }

    const t = this.players.get(ai.target);
    let dx = 0, dz = 0;
    if (t && t.alive) {
      const tx = t.x - p.x, tz = t.z - p.z, d = Math.hypot(tx, tz) || 1;
      const vis = ai.visible;
      if (vis) {
        // apuntar con anticipación y error
        const lead = d / BULLET_SPEED;
        const ax = t.x + t.input.mx * SPEED * lead * 0.8 - p.x, az = t.z + t.input.mz * SPEED * lead * 0.8 - p.z;
        const err = (Math.random() - 0.5) * 2 * sk.aimError;
        inp.a = Math.atan2(ax, az) + err;
        ai.fireHold -= dt;
        if (ai.fireHold <= 0) { ai.fireHold = 0.25; ai.firing = Math.random() < sk.fireChance; }
        inp.f = ai.firing && d < 26;
        // moverse lateralmente manteniendo distancia
        const ideal = 9;
        const radial = d > ideal + 2 ? 1 : d < ideal - 3 ? -1 : 0;
        dx = tx / d * radial + (-tz / d) * ai.strafe;
        dz = tz / d * radial + (tx / d) * ai.strafe;
        if (Math.random() < sk.dash * dt * 0.6) inp.d = true;
      } else {
        inp.f = false;
        dx = tx; dz = tz;
        inp.a = Math.atan2(tx, tz);
      }
    } else { inp.f = false; dx = -p.x; dz = -p.z; }

    if (ai.goal) {
      const gx = ai.goal[0] - p.x, gz = ai.goal[1] - p.z;
      dx = dx * 0.3 + gx; dz = dz * 0.3 + gz;
    }
    if (ai.wander > 0) { dx = ai.wx; dz = ai.wz; }

    // esquivar obstáculos: elegir entre 16 direcciones la mejor
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) { inp.mx = inp.mz = 0; return; }
    dx /= l; dz /= l;
    let bx = 0, bz = 0, bs = -1e9;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, cx = Math.sin(a), cz = Math.cos(a);
      let s = cx * dx + cz * dz;
      if (pointBlocked(p.x + cx * 1.2, p.z + cz * 1.2, PLAYER_R)) s -= 5;
      else if (pointBlocked(p.x + cx * 2.6, p.z + cz * 2.6, PLAYER_R)) s -= 1.2;
      if (s > bs) { bs = s; bx = cx; bz = cz; }
    }
    inp.mx = bx; inp.mz = bz;
  }

  // ---------- Red ----------
  snapshot() {
    const r = n => Math.round(n * 100) / 100;
    const p = [];
    for (const q of this.players.values()) {
      let f = 0;
      if (q.moving) f |= F.MOVING;
      if (q.dashT > 0) f |= F.DASH;
      if (q.shield > 0) f |= F.SHIELD;
      if (q.triple > 0) f |= F.TRIPLE;
      if (q.speed > 0) f |= F.SPEED;
      if (q.invul > 0) f |= F.INVUL;
      p.push([q.id, r(q.x), r(q.z), r(q.aim), Math.ceil(q.hp), q.alive ? 1 : 0, f, q.kills, q.deaths, q.input.seq,
        r(Math.max(0, q.dashCd)), r(q.triple), r(q.speed), r(q.shield), r(Math.max(0, q.respawnT))]);
    }
    return {
      t: 's', time: r(this.time), st: this.state,
      p, b: this.bullets.map(b => [b.id, r(b.x), r(b.z), r(b.vx), r(b.vz), b.owner]),
      k: this.pickups.map(k => k.active ? 1 : 0),
    };
  }
}
