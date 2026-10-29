// Configuración general de Neón Arena

export const HALF = 30;               // la arena va de -HALF a +HALF en X y Z
export const STEP = 1 / 60;           // paso fijo de la simulación (s)
export const SNAP_EVERY = 3;          // cada cuántos pasos se envía un snapshot (20 Hz)
export const MAX_PLAYERS = 8;

export const PLAYER_R = 0.6;
export const MAX_HP = 100;
export const SPEED = 7.5;
export const SPEED_BOOST = 1.45;
export const DASH_SPEED = 24;
export const DASH_TIME = 0.16;
export const DASH_CD = 2.2;
export const FIRE_CD = 0.2;
export const BULLET_SPEED = 32;
export const BULLET_DMG = 12;
export const BULLET_LIFE = 1.1;
export const BULLET_R = 0.22;
export const RESPAWN_TIME = 3;
export const SPAWN_SHIELD = 1.5;
export const POWER_TIME = 8;
export const PICKUP_RESPAWN = 12;

export const KILL_OPTIONS = [10, 15, 25];
export const TIME_LIMIT = 300; // 5 minutos

export const COLORS = ['#00e5ff', '#ff2bd6', '#ffd400', '#39ff6a', '#ff6a1f', '#8f5bff', '#ff3355', '#ffffff'];
export const COLOR_NAMES = ['Cian', 'Magenta', 'Amarillo', 'Verde', 'Naranja', 'Violeta', 'Rojo', 'Blanco'];
export const BOT_NAMES = ['Voltio', 'Píxel', 'Turbo', 'Chispa', 'Néctar', 'Óxido', 'Cromo', 'Byte', 'Láser', 'Rayo'];

export const DIFFICULTY = {
  facil:   { label: 'Fácil',   aimError: 0.30, react: 0.55, fireChance: 0.45, dash: 0.2 },
  normal:  { label: 'Normal',  aimError: 0.14, react: 0.30, fireChance: 0.75, dash: 0.5 },
  dificil: { label: 'Difícil', aimError: 0.05, react: 0.12, fireChance: 1.0,  dash: 0.9 },
};

// Personajes. Para añadir uno nuevo: copia el .glb en assets/models y añade una entrada.
// - tint: material del modelo que se pinta con el color del jugador
// - anims: nombre de las animaciones dentro del .glb
export const CHARACTERS = [
  {
    id: 'robot',
    name: 'Robot',
    url: 'assets/models/RobotExpressive.glb',
    height: 1.9,
    tint: 'Main',
    anims: { idle: 'Idle', run: 'Running', death: 'Death', victory: 'Dance', hit: 'No' },
  },
];

// Mapa: obstáculos simétricos (x, z = centro; w, d = tamaño; h = altura)
function mirror(list) {
  const out = [];
  for (const b of list) {
    const seen = new Set();
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const k = (b.x * sx) + ',' + (b.z * sz);
      if (seen.has(k)) continue; seen.add(k);
      out.push({ ...b, x: b.x * sx, z: b.z * sz });
    }
  }
  return out;
}
export const BOXES = mirror([
  { x: 0, z: 0, w: 4, d: 4, h: 3 },
  { x: 14, z: 20, w: 8, d: 1.5, h: 2 },
  { x: 20, z: 14, w: 1.5, d: 8, h: 2 },
  { x: 8, z: 8, w: 2, d: 2, h: 2.5 },
  { x: 0, z: 15, w: 10, d: 1.5, h: 1.6 },
  { x: 15, z: 0, w: 1.5, d: 10, h: 1.6 },
  { x: 25, z: 5, w: 3, d: 3, h: 1.2 },
  { x: 5, z: 25, w: 3, d: 3, h: 1.2 },
]);

export const SPAWNS = [
  [-26, -26], [26, 26], [26, -26], [-26, 26], [0, -26], [0, 26], [-26, 0], [26, 0],
];

export const PICKUP_SPOTS = [
  { x: 0, z: 8, type: 'health' }, { x: 0, z: -8, type: 'health' },
  { x: 8, z: 0, type: 'triple' }, { x: -8, z: 0, type: 'triple' },
  { x: 23, z: -11, type: 'speed' }, { x: -23, z: 11, type: 'speed' },
  { x: 11, z: 23, type: 'shield' }, { x: -11, z: -23, type: 'shield' },
];
export const PICKUP_INFO = {
  health: { label: 'Vida +40', color: '#39ff6a' },
  triple: { label: 'Disparo triple', color: '#ff6a1f' },
  speed:  { label: 'Velocidad', color: '#00e5ff' },
  shield: { label: 'Escudo', color: '#8f5bff' },
};
