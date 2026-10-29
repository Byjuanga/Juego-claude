// Todo lo que se dibuja: escena 3D, personajes, efectos.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HALF, BOXES, PICKUP_SPOTS, PICKUP_INFO, CHARACTERS, MAX_HP } from './config.js';
import { F } from './sim.js';

const AIM_Y = 1.1;

// Altura real del modelo (las mallas con esqueleto se miden con los huesos aplicados)
function measureHeight(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) { o.computeBoundingBox(); tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld); }
    else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); }
    box.union(tmp);
  });
  return (box.max.y - box.min.y) || 1;
}

// Calidad recomendada según la tarjeta gráfica (solo se usa la primera vez)
export function detectQuality() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return 'patata';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|softpipe|software/i.test(name)) return 'patata';
    if (/Intel/i.test(name) && /(^|[^U])HD Graphics|Sandybridge|Ivybridge|Haswell|Bay ?Trail|GMA/i.test(name)) return 'patata';
    if (/Intel/i.test(name)) return 'baja'; // UHD / Iris integradas
    return 'alta';
  } catch (e) { return 'media'; }
}

export class Renderer {
  constructor(canvas, quality = 'alta') {
    this.canvas = canvas;
    this.aa = quality !== 'patata';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.aa, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05060d');
    this.scene.fog = new THREE.Fog('#05060d', 45, 90);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTex;
    this.particleScale = 1;
    this.lowMats = new WeakMap();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    this.camera.position.set(0, 40, 30);
    this.camTarget = new THREE.Vector3();
    this.shake = 0;
    this.avatars = new Map();
    this.bulletMeshes = new Map();
    this.bulletPool = [];
    this.raycaster = new THREE.Raycaster();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_Y);
    this.clock = 0;
    this.chars = {};

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.35, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildArena();
    this.buildParticles();
    this.setQuality(quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  async load(onProgress) {
    const loader = new GLTFLoader();
    for (const c of CHARACTERS) {
      const gltf = await loader.loadAsync(c.url, e => e.total && onProgress && onProgress(e.loaded / e.total));
      const h = measureHeight(gltf.scene);
      gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
      this.chars[c.id] = { cfg: c, gltf, scale: c.scale || c.height / h };
    }
  }

  // alta: todo · media: resolución normal · baja: sin sombras ni brillo
  // patata: además menos resolución, materiales simples, sin luces extra ni reflejos
  // Devuelve true si el cambio completo necesita recargar la página (suavizado de bordes).
  setQuality(q) {
    this.quality = q;
    const potato = q === 'patata', cheap = q === 'baja' || potato;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'alta' ? Math.min(dpr, 2) : potato ? 0.6 : 1);
    this.renderer.shadowMap.enabled = !cheap;
    this.sun.castShadow = !cheap;
    this.useBloom = !cheap;
    for (const l of this.cornerLights) l.visible = !potato;
    this.hemi.intensity = potato ? 1.7 : 0.9; // compensa las luces que se quitan
    this.scene.environment = potato ? null : this.envTex;
    this.particleScale = potato ? 0.35 : cheap ? 0.6 : 1;
    this.scene.traverse(o => { if (o.isMesh) potato ? this.toLow(o) : this.toHigh(o); });
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    this.resize();
    return this.aa !== !potato;
  }

  // Cambia un material realista (PBR) por uno mucho más barato de dibujar
  toLow(o) {
    const m = o.material;
    if (!m || !m.isMeshStandardMaterial) return;
    let low = this.lowMats.get(m);
    if (!low) {
      low = new THREE.MeshLambertMaterial({
        color: m.color, map: m.map, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity,
        transparent: m.transparent, opacity: m.opacity, side: m.side,
      });
      this.lowMats.set(m, low);
    }
    o.userData.hiMat = m;
    o.material = low;
  }
  toHigh(o) {
    if (!o.userData.hiMat) return;
    o.material = o.userData.hiMat;
    delete o.userData.hiMat;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- Arena ----------
  buildArena() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight('#7c86ff', '#120a1e', 0.9);
    s.add(this.hemi);
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(18, 40, 12);
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -36; sc.right = sc.top = 36; sc.near = 5; sc.far = 90;
    sun.shadow.bias = -0.0005;
    s.add(sun); this.sun = sun;
    this.cornerLights = [];
    for (const [x, z, c] of [[-HALF, -HALF, '#ff2bd6'], [HALF, HALF, '#00e5ff'], [HALF, -HALF, '#8f5bff'], [-HALF, HALF, '#00e5ff']]) {
      const l = new THREE.PointLight(c, 25, 30, 2); l.position.set(x * 0.8, 6, z * 0.8); s.add(l);
      this.cornerLights.push(l);
    }

    // suelo con rejilla dibujada en un canvas
    const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
    const g = cv.getContext('2d');
    g.fillStyle = '#0a0c1a'; g.fillRect(0, 0, 1024, 1024);
    const cells = HALF * 2 / 2, step = 1024 / cells;
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
      if ((i + j) % 2) { g.fillStyle = '#0c0f20'; g.fillRect(i * step, j * step, step, step); }
    }
    g.strokeStyle = '#1b2250'; g.lineWidth = 2;
    for (let i = 0; i <= cells; i++) {
      g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, 1024); g.stroke();
      g.beginPath(); g.moveTo(0, i * step); g.lineTo(1024, i * step); g.stroke();
    }
    g.strokeStyle = '#2b3a9a'; g.lineWidth = 4;
    g.beginPath(); g.arc(512, 512, 170, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(512, 512, 330, 0, Math.PI * 2); g.stroke();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.15 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: '#03040a' }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; s.add(outer);

    // muros perimetrales
    const wallMat = new THREE.MeshStandardMaterial({ color: '#12162e', metalness: 0.6, roughness: 0.4, envMapIntensity: 0.3 });
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#00e5ff').multiplyScalar(1.3), toneMapped: false });
    for (const [x, z, w, d] of [[0, -HALF - 0.5, HALF * 2 + 2, 1], [0, HALF + 0.5, HALF * 2 + 2, 1], [-HALF - 0.5, 0, 1, HALF * 2], [HALF + 0.5, 0, 1, HALF * 2]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), wallMat); m.position.set(x, 0.6, z); m.receiveShadow = true; s.add(m);
      const st = new THREE.Mesh(new THREE.BoxGeometry(w > 1 ? w : 0.18, 0.06, d > 1 ? d : 0.18), stripMat); st.position.set(x, 1.22, z); s.add(st);
    }

    // obstáculos con bordes de neón
    const boxMat = new THREE.MeshStandardMaterial({ color: '#1b2040', metalness: 0.7, roughness: 0.35, envMapIntensity: 0.35 });
    const edgeCols = ['#ff2bd6', '#00e5ff', '#8f5bff'];
    BOXES.forEach((b, i) => {
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      const m = new THREE.Mesh(geo, boxMat);
      m.position.set(b.x, b.h / 2, b.z); m.castShadow = m.receiveShadow = true; s.add(m);
      const col = edgeCols[(Math.abs(Math.round(b.x)) + Math.abs(Math.round(b.z))) % 3];
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2.5), toneMapped: false }));
      e.position.copy(m.position); s.add(e);
    });

    // objetos (power-ups)
    this.pickupObjs = PICKUP_SPOTS.map(sp => {
      const color = new THREE.Color(PICKUP_INFO[sp.type].color);
      const glow = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), toneMapped: false });
      const grp = new THREE.Group(); grp.position.set(sp.x, 0, sp.z);
      const item = new THREE.Group(); item.position.y = 1;
      if (sp.type === 'health') {
        item.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.28), glow));
        item.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, 0.28), glow));
      } else if (sp.type === 'triple') {
        for (const dx of [-0.35, 0, 0.35]) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), glow); m.position.x = dx; m.position.y = dx === 0 ? 0.2 : 0; item.add(m); }
      } else if (sp.type === 'speed') {
        const m = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 4), glow); m.rotation.z = -Math.PI / 2; item.add(m);
      } else {
        item.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.45), glow));
      }
      grp.add(item);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.9, 32),
        new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.5), toneMapped: false, transparent: true, opacity: 0.9 }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; grp.add(ring);
      s.add(grp);
      return { grp, item, ring };
    });
  }

  // ---------- Partículas ----------
  buildParticles() {
    const N = 4000;
    this.pN = N; this.pIdx = 0;
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pBase = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -100;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    const mat = new THREE.PointsMaterial({ size: 0.28, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  burst(x, y, z, color, n, speed = 6, up = 3) {
    n = Math.max(1, Math.round(n * this.particleScale));
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.pIdx = (this.pIdx + 1) % this.pN;
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      this.pVel[i * 3] = Math.cos(a) * s; this.pVel[i * 3 + 1] = (Math.random() * up); this.pVel[i * 3 + 2] = Math.sin(a) * s;
      this.pLife[i] = 0.35 + Math.random() * 0.4;
      this.pBase[i * 3] = c.r * 2; this.pBase[i * 3 + 1] = c.g * 2; this.pBase[i * 3 + 2] = c.b * 2;
    }
  }

  updateParticles(dt) {
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const l = Math.max(0, this.pLife[i]);
      this.pVel[i * 3 + 1] -= 9 * dt;
      for (let k = 0; k < 3; k++) { this.pPos[i * 3 + k] += this.pVel[i * 3 + k] * dt; this.pCol[i * 3 + k] = this.pBase[i * 3 + k] * l; }
      if (this.pPos[i * 3 + 1] < 0.05) { this.pPos[i * 3 + 1] = 0.05; this.pVel[i * 3 + 1] *= -0.4; this.pVel[i * 3] *= 0.7; this.pVel[i * 3 + 2] *= 0.7; }
      if (l === 0) this.pPos[i * 3 + 1] = -100;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  // ---------- Personajes ----------
  makeAvatar(info) {
    const ch = this.chars[info.char] || Object.values(this.chars)[0];
    const color = new THREE.Color(info.color);
    const root = new THREE.Group();
    const model = SkeletonUtils.clone(ch.gltf.scene);
    model.scale.setScalar(ch.scale);
    model.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.metalness = Math.min(o.material.metalness, 0.4);
      o.material.roughness = Math.max(o.material.roughness, 0.35);
      o.material.envMapIntensity = 0.6;
      if (o.material.name === ch.cfg.tint) {
        o.material.color = color.clone().multiplyScalar(0.8);
        o.material.emissive = color.clone().multiplyScalar(0.35);
      }
    });
    root.add(model);

    // cañón flotante en el hombro
    const gun = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.75), new THREE.MeshStandardMaterial({ color: '#1a1e38', metalness: 0.8, roughness: 0.3 }));
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3), toneMapped: false }));
    tip.rotation.x = Math.PI / 2; tip.position.z = 0.4;
    gun.add(body, tip); gun.position.set(-0.55, 1.45, 0.25); body.castShadow = true;
    root.add(gun);

    // aro en el suelo para reconocerte rápido
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 40),
      new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.8), toneMapped: false, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    root.add(ring);

    // escudo
    const shield = new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 16),
      new THREE.MeshBasicMaterial({ color: '#8f5bff', transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }));
    shield.position.y = 1; shield.visible = false; root.add(shield);

    // nombre y vida
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true }));
    label.scale.set(2.6, 0.65, 1); label.position.y = 2.7; label.renderOrder = 10;
    root.add(label);

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const [k, name] of Object.entries(ch.cfg.anims)) {
      const clip = THREE.AnimationClip.findByName(ch.gltf.animations, name);
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      if (k === 'death') { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
      actions[k] = a;
    }
    if (this.quality === 'patata') root.traverse(o => { if (o.isMesh) this.toLow(o); });
    this.scene.add(root);
    const av = { root, model, gun, ring, shield, label, cv, tex, mixer, actions, cur: null, color: info.color, name: info.name, hp: -1, alive: true, me: false, flash: 0 };
    this.play(av, 'idle');
    return av;
  }

  play(av, name, fade = 0.18) {
    if (av.cur === name || !av.actions[name]) return;
    const next = av.actions[name];
    const prev = av.actions[av.cur];
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    av.cur = name;
  }

  drawLabel(av, hp) {
    const g = av.cv.getContext('2d');
    g.clearRect(0, 0, 256, 64);
    g.font = '700 26px Rajdhani, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.75)';
    g.strokeText(av.name, 128, 20);
    g.fillStyle = av.color; g.fillText(av.name, 128, 20);
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(48, 42, 160, 12);
    const f = Math.max(0, hp) / MAX_HP;
    g.fillStyle = f > 0.5 ? '#39ff6a' : f > 0.25 ? '#ffd400' : '#ff3355';
    g.fillRect(50, 44, 156 * f, 8);
    av.tex.needsUpdate = true; av.hp = hp;
  }

  removeAvatar(id) {
    const av = this.avatars.get(id); if (!av) return;
    this.scene.remove(av.root);
    av.root.traverse(o => {
      if (!o.isMesh && !o.isSprite) return;
      o.geometry && o.geometry.dispose();
      o.material.dispose && o.material.dispose();
      if (o.userData.hiMat) o.userData.hiMat.dispose();
    });
    av.tex.dispose();
    this.avatars.delete(id);
  }

  clearAll() {
    for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
    for (const m of this.bulletMeshes.values()) { m.visible = false; this.bulletPool.push(m); }
    this.bulletMeshes.clear();
  }

  // ---------- Balas ----------
  bulletMesh(color) {
    let m = this.bulletPool.pop();
    if (!m) {
      m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }));
      m.scale.set(1, 1, 3.2);
      this.scene.add(m);
    }
    m.material.color.set(color).multiplyScalar(3);
    m.visible = true;
    return m;
  }

  // ---------- Fotograma ----------
  // view: { players: Map, bullets: [], pickups: [], focus: {x,z} | null, victory: id | null }
  update(view, dt, myId) {
    this.clock += dt;
    const seen = new Set();
    for (const p of view.players.values()) {
      seen.add(p.id);
      let av = this.avatars.get(p.id);
      if (!av) { av = this.makeAvatar(p); this.avatars.set(p.id, av); av.root.position.set(p.x, 0, p.z); }
      av.me = p.id === myId;
      if (p.name !== av.name || p.hp !== av.hp) { av.name = p.name; this.drawLabel(av, p.alive ? p.hp : 0); }
      // posición y rotación
      if (p.alive && !av.alive) { av.root.position.set(p.x, 0, p.z); this.burst(p.x, 1, p.z, p.color, 60, 4, 6); }
      av.root.position.x += (p.x - av.root.position.x) * Math.min(1, dt * 30);
      av.root.position.z += (p.z - av.root.position.z) * Math.min(1, dt * 30);
      let da = p.aim - av.root.rotation.y;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      av.root.rotation.y += da * Math.min(1, dt * 25);
      av.alive = p.alive;
      // animación
      if (view.victory != null) this.play(av, p.id === view.victory ? 'victory' : (p.alive ? 'idle' : 'death'));
      else if (!p.alive) this.play(av, 'death', 0.1);
      else this.play(av, (p.flags & F.MOVING) ? 'run' : 'idle');
      if (av.actions.run) av.actions.run.timeScale = (p.flags & F.SPEED) ? 1.5 : 1.1;
      av.mixer.update(dt);
      // extras visuales
      av.gun.visible = p.alive;
      av.label.visible = p.alive;
      av.ring.visible = p.alive;
      av.ring.material.opacity = av.me ? 0.95 : 0.55;
      const prot = p.flags & (F.SHIELD | F.INVUL);
      av.shield.visible = p.alive && !!prot;
      if (prot) {
        av.shield.material.color.set((p.flags & F.INVUL) ? '#ffffff' : '#8f5bff');
        av.shield.material.opacity = 0.16 + Math.sin(this.clock * 8) * 0.06;
      }
      av.gun.position.y = 1.45 + Math.sin(this.clock * 4 + p.id.length) * 0.05;
      if (av.flash > 0) { av.flash -= dt; }
      av.model.visible = p.alive || av.cur === 'death' || view.victory != null;
      if (p.flags & F.DASH && Math.random() < 0.8) this.burst(p.x, 0.6, p.z, p.color, 2, 1, 1);
    }
    for (const id of [...this.avatars.keys()]) if (!seen.has(id)) this.removeAvatar(id);

    // balas
    const live = new Set();
    for (const b of view.bullets) {
      live.add(b.id);
      let m = this.bulletMeshes.get(b.id);
      if (!m) { m = this.bulletMesh(b.color); this.bulletMeshes.set(b.id, m); }
      m.position.set(b.x, AIM_Y, b.z);
      m.rotation.y = Math.atan2(b.vx, b.vz);
    }
    for (const [id, m] of this.bulletMeshes) if (!live.has(id)) { m.visible = false; this.bulletPool.push(m); this.bulletMeshes.delete(id); }

    // objetos
    this.pickupObjs.forEach((o, i) => {
      const on = !!view.pickups[i];
      o.item.visible = on;
      o.ring.material.opacity = on ? 0.9 : 0.15;
      o.item.rotation.y += dt * 2;
      o.item.position.y = 1 + Math.sin(this.clock * 3 + i) * 0.15;
    });

    this.updateParticles(dt);

    // cámara
    if (view.focus) {
      const f = view.focus;
      const tx = f.x + (f.ax || 0), tz = f.z + (f.az || 0);
      this.camTarget.x += (tx - this.camTarget.x) * Math.min(1, dt * 6);
      this.camTarget.z += (tz - this.camTarget.z) * Math.min(1, dt * 6);
    }
    const orbit = view.victory != null;
    const off = orbit
      ? new THREE.Vector3(Math.sin(this.clock * 0.4) * 8, 6, Math.cos(this.clock * 0.4) * 8)
      : new THREE.Vector3(0, 17, 10);
    const want = this.camTarget.clone().add(off);
    this.camera.position.lerp(want, Math.min(1, dt * (orbit ? 2 : 8)));
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * 0.5;
      this.camera.position.x += (Math.random() - 0.5) * s; this.camera.position.z += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.camTarget.x, orbit ? 1.2 : 0, this.camTarget.z);

    if (this.useBloom) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
  }

  // punto del suelo (a la altura del arma) bajo el ratón
  groundPoint(mx, my) {
    const ndc = new THREE.Vector2(mx / window.innerWidth * 2 - 1, -(my / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.aimPlane, p) ? p : null;
  }

  // efectos por evento
  fx(ev, players, myId) {
    const p = players.get(ev.id);
    switch (ev.e) {
      case 'shot': {
        const av = this.avatars.get(ev.id);
        if (av && p) {
          const v = new THREE.Vector3(); av.gun.getWorldPosition(v);
          this.burst(v.x + Math.sin(p.aim) * 0.4, v.y, v.z + Math.cos(p.aim) * 0.4, p.color, 4, 2, 1);
        }
        break;
      }
      case 'impact': this.burst(ev.x, 1.1, ev.z, ev.c, 10, 4, 3); break;
      case 'block': this.burst(ev.x, 1.1, ev.z, '#ffffff', 8, 3, 2); break;
      case 'hit':
        this.burst(ev.x, 1.1, ev.z, ev.c, 16, 5, 4);
        if (ev.id === myId) this.shake = Math.min(1, this.shake + 0.35);
        break;
      case 'kill': {
        const v = players.get(ev.victim);
        const col = v ? v.color : '#ffffff';
        this.burst(ev.x, 1, ev.z, col, 70, 8, 7);
        this.burst(ev.x, 1, ev.z, '#ffffff', 20, 5, 5);
        if (ev.victim === myId) this.shake = 1;
        break;
      }
      case 'pickup': this.burst(ev.x, 1, ev.z, PICKUP_INFO[ev.type].color, 50, 3, 7); break;
    }
  }
}
