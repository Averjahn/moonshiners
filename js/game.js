import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { generate, T, W, H, CI, CJ, idx, inb, FUEL } from './world.js';
import { connect } from './net.js';
import { buildInterior, PLACES, clerkFigure } from './interior.js';
import { createFire, ignite as igniteFire, stepFire, tickMirror, applyChanges, fireDamageAt, nearestFuelCell, intensity as fireIntensity, S as FS, FUEL_PROPS } from './fire.js';
import { setupDesigner } from './designer.js';
import { CARS, ECON, SERVICES, JOBS, DEALERS, dealerModels, resale, repairCost, fairRent } from './economy.js';
import { createVoice } from './voice.js';

// ================= НАСТРОЙКИ =================
const TS = 2, FH = 1.3;
const CAM_OFF = new THREE.Vector3(30, 30, 30);
const FWD = new THREE.Vector3(-1, 0, -1).normalize(), RIGHT = new THREE.Vector3(1, 0, -1).normalize();
let VIEW_H = 26;
const world = generate(parseInt(new URLSearchParams(location.search).get('seed') || '7', 10) || 7);
const X = i => i * TS, Z = j => j * TS;
// высота земли в мировых координатах (билинейно по вершинам)
// Высота рельефа — сплайн Катмулла–Рома по узлам сетки: склоны и берега без изломов по клеткам.
// По этой же функции ставятся дома, деревья, машины, поэтому земля и предметы не расходятся.
function hAt(x, z) {
  const fx = Math.max(0, Math.min(W, x / TS)), fz = Math.max(0, Math.min(H, z / TS));
  const c = Math.min(W - 1, Math.floor(fx)), r = Math.min(H - 1, Math.floor(fz)), u = fx - c, v = fz - r;
  const g = (cc, rr) => world.hgt[Math.max(0, Math.min(H, rr)) * (W + 1) + Math.max(0, Math.min(W, cc))];
  const cr = (p0, p1, p2, p3, t) => p1 + .5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = rr => cr(g(c - 1, rr), g(c, rr), g(c + 1, rr), g(c + 2, rr), u);
  return cr(row(r - 1), row(r), row(r + 1), row(r + 2), v);
}
const hIJ = (i, j) => hAt(X(i), Z(j));

// ================= СЦЕНА =================
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.fog = new THREE.Fog('#dfe9d3', 120, 260);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 400);
function resize() { renderer.setSize(innerWidth, innerHeight, false); const a = innerWidth / innerHeight; camera.left = -VIEW_H * a / 2; camera.right = VIEW_H * a / 2; camera.top = VIEW_H / 2; camera.bottom = -VIEW_H / 2; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
addEventListener('wheel', e => { VIEW_H = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, VIEW_H * (e.deltaY > 0 ? 1.1 : 1 / 1.1))); resize(); }, { passive: true });

const hemi = new THREE.HemisphereLight('#cfe6ff', '#8a7a55', 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4d6', 1.6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -45; sun.shadow.camera.right = 45; sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45; sun.shadow.camera.near = 1; sun.shadow.camera.far = 200; sun.shadow.bias = -0.0015; sun.shadow.normalBias = 0.03;
scene.add(sun); scene.add(sun.target);
const moon = new THREE.DirectionalLight('#9fb0e0', 0); moon.position.set(-30, 40, -20); scene.add(moon);

// ---- земля: текстура тайлов + рельеф вершин
const PX = 12;
const gc = document.createElement('canvas'); gc.width = W * PX; gc.height = H * PX; const g2 = gc.getContext('2d');
const GROUND = { [T.GRASS]: '#cfe0a3', [T.ROAD]: '#c8b088', [T.MAIN]: '#a8a196', [T.WATER]: '#6fb0c8', [T.BANK]: '#dfcf9e', [T.RAIL]: '#b8ad97', [T.FOREST]: '#9cbf7e', [T.FIELD]: '#e3cf8a', [T.DIRT]: '#cfb489', [T.PLAZA]: '#dcd2bd', [T.YARD]: '#c7d99a', [T.ROCK]: '#a9a49a', [T.MEADOW]: '#d9e29a', [T.CLEARING]: '#d8e4aa', [T.FALLOW]: '#bfa478' };
const shadeHex = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = v => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f(n >> 8 & 255)},${f(n & 255)})`; };
{
  // Земля без «клеток». Каждое покрытие рисуем через маску: клетки этого типа → маска 4 px на клетку →
  // два прохода размытия → мягкий порог. Прямые углы скругляются, лесенки на диагоналях становятся
  // плавными линиями, улицы — лентами со скруглёнными бордюрами на перекрёстках.
  const t0 = performance.now();
  const MS = 4, MW = W * MS, MH = H * MS, gw = gc.width, gh = gc.height;
  const rnd = (() => { let q = 99; return () => (q = (q * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  const buf = new Float32Array(MW * MH), tmpB = new Float32Array(MW * MH);
  function blur(r) {   // разделимое скользящее среднее — O(N) при любом радиусе
    const inv = 1 / (2 * r + 1);
    for (let y = 0; y < MH; y++) { const row = y * MW; let acc = 0; for (let x = -r; x <= r; x++) acc += buf[row + Math.min(MW - 1, Math.max(0, x))];
      for (let x = 0; x < MW; x++) { tmpB[row + x] = acc * inv; acc += buf[row + Math.min(MW - 1, x + r + 1)] - buf[row + Math.max(0, x - r)]; } }
    for (let x = 0; x < MW; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmpB[Math.min(MH - 1, Math.max(0, y)) * MW + x];
      for (let y = 0; y < MH; y++) { buf[y * MW + x] = acc * inv; acc += tmpB[Math.min(MH - 1, y + r + 1) * MW + x] - tmpB[Math.max(0, y - r) * MW + x]; } }
  }
  const mc = document.createElement('canvas'); mc.width = MW; mc.height = MH; const mx = mc.getContext('2d'); const mimg = mx.createImageData(MW, MH);
  function mask(test, r, thr) {
    buf.fill(0);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (test(world.tiles[idx(i, j)])) for (let y = 0; y < MS; y++) { const row = (j * MS + y) * MW + i * MS; for (let x = 0; x < MS; x++) buf[row + x] = 1; }
    blur(r); blur(r);
    const e0 = thr - .13, k = 1 / .26;
    for (let q = 0; q < buf.length; q++) { let t = (buf[q] - e0) * k; t = t < 0 ? 0 : t > 1 ? 1 : t; mimg.data[q * 4 + 3] = t * t * (3 - 2 * t) * 255; }
    mx.putImageData(mimg, 0, 0); return mc;
  }
  const tmp = document.createElement('canvas'); tmp.width = gw; tmp.height = gh; const tx = tmp.getContext('2d');
  function layer(m, paint) { tx.globalCompositeOperation = 'source-over'; tx.clearRect(0, 0, gw, gh); paint(tx);
    tx.globalCompositeOperation = 'destination-in'; tx.imageSmoothingEnabled = true; tx.imageSmoothingQuality = 'high'; tx.drawImage(m, 0, 0, gw, gh); g2.drawImage(tmp, 0, 0); }
  const is = (...types) => t => types.includes(t);
  const fill = col => x => { x.fillStyle = col; x.fillRect(0, 0, gw, gh); };
  const dots = (col, n, sz) => x => { x.fillStyle = col; for (let q = 0; q < n; q++) { const d = sz * (.5 + rnd()); x.beginPath(); x.ellipse(rnd() * gw, rnd() * gh, d, d * .7, rnd() * 3, 0, 7); x.fill(); } };
  const furrows = (col, step) => x => { x.save(); x.strokeStyle = col; x.lineWidth = 1.3; x.translate(gw / 2, gh / 2); x.rotate(.12);
    for (let q = -gw; q < gw; q += step) { x.beginPath(); x.moveTo(-gw, q); x.quadraticCurveTo(0, q + Math.sin(q * .013) * 6, gw, q); x.stroke(); } x.restore(); };
  const both = (...fs) => x => fs.forEach(f => f(x));

  g2.fillStyle = GROUND[T.GRASS]; g2.fillRect(0, 0, gw, gh);
  layer(mask(is(T.MEADOW), 6, .5), fill(GROUND[T.MEADOW]));
  layer(mask(is(T.FOREST), 5, .5), both(fill(GROUND[T.FOREST]), dots('rgba(70,110,50,.16)', 9000, 5)));
  layer(mask(is(T.CLEARING), 3, .36), fill(GROUND[T.CLEARING]));
  layer(mask(is(T.YARD), 4, .5), fill(GROUND[T.YARD]));
  layer(mask(is(T.FIELD), 3, .5), both(fill(GROUND[T.FIELD]), furrows('rgba(120,90,40,.28)', 4)));
  layer(mask(is(T.FALLOW), 3, .38), both(fill(GROUND[T.FALLOW]), furrows('rgba(90,60,30,.32)', 3)));
  layer(mask(is(T.ROCK), 5, .5), both(fill(GROUND[T.ROCK]), dots('rgba(60,60,60,.22)', 4000, 6)));
  layer(mask(is(T.BANK, T.WATER), 4, .4), both(fill(GROUND[T.BANK]), dots('rgba(160,140,100,.2)', 2500, 3)));
  layer(mask(is(T.WATER), 3, .5), fill(GROUND[T.WATER]));
  layer(mask(is(T.PLAZA), 3, .5), both(fill(GROUND[T.PLAZA]), dots('rgba(0,0,0,.05)', 3000, 4)));
  layer(mask(is(T.RAIL), 2, .45), fill(GROUND[T.RAIL]));
  // тротуар вокруг городских улиц; грунтовки ложатся поверх него на въездах, асфальт — поверх грунтовок
  layer(mask(is(T.ROAD, T.MAIN), 3, .3), fill('#d8d0c0'));
  layer(mask(is(T.DIRT), 4, .33), fill('#b99d72'));
  layer(mask(is(T.DIRT), 4, .5), both(fill(GROUND[T.DIRT]), dots('rgba(120,90,50,.2)', 7000, 3)));
  layer(mask(is(T.ROAD, T.MAIN), 3, .5), fill(GROUND[T.ROAD]));
  layer(mask(is(T.MAIN), 3, .52), both(fill(GROUND[T.MAIN]), dots('rgba(0,0,0,.07)', 9000, 3)));
  // тень рельефа — плавно, а не по клеткам
  { const hc = document.createElement('canvas'); hc.width = W + 1; hc.height = H + 1; const hx = hc.getContext('2d'), im = hx.createImageData(W + 1, H + 1);
    for (let q = 0; q < (W + 1) * (H + 1); q++) im.data[q * 4 + 3] = Math.min(.24, Math.max(0, world.hgt[q]) * .028) * 255;
    hx.putImageData(im, 0, 0); g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high'; g2.drawImage(hc, -PX / 2, -PX / 2, gw + PX, gh + PX); }
  // травинки россыпью только там, где зелень
  for (let q = 0; q < 60000; q++) { const x = rnd() * gw, y = rnd() * gh, t = world.tiles[idx(Math.floor(x / PX), Math.floor(y / PX))];
    if (t !== T.GRASS && t !== T.FOREST && t !== T.MEADOW && t !== T.YARD && t !== T.CLEARING) continue;
    g2.fillStyle = `rgba(90,140,60,${.06 + rnd() * .1})`; g2.beginPath(); g2.ellipse(x, y, 1.8, 1, rnd() * 3, 0, 7); g2.fill(); }
  const ri = world.railI; g2.fillStyle = '#8a7460'; for (let j = 0; j < H; j++) for (let q = 1; q < PX; q += 4) g2.fillRect(ri * PX + 2, j * PX + q, PX - 4, 2);
  g2.fillStyle = '#5a4a3a'; g2.fillRect(ri * PX + 4, 0, 1.5, H * PX); g2.fillRect(ri * PX + PX - 5.5, 0, 1.5, H * PX);
  window.__groundMs = Math.round(performance.now() - t0);
}
const groundTex = new THREE.CanvasTexture(gc); groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.anisotropy = 8;
// сетка рельефа вдвое мельче клетки, высоты — по тому же сплайну: берега и холмы округлые
const GSUB = 2, groundGeo = new THREE.PlaneGeometry(W * TS, H * TS, W * GSUB, H * GSUB);
{ const p = groundGeo.attributes.position, cols = W * GSUB + 1; for (let r = 0; r <= H * GSUB; r++) for (let c = 0; c <= W * GSUB; c++) p.setZ(r * cols + c, hAt(c * TS / GSUB, r * TS / GSUB)); groundGeo.computeVertexNormals(); }
const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: groundTex }));
ground.rotation.x = -Math.PI / 2; ground.position.set(W * TS / 2, 0, H * TS / 2); ground.receiveShadow = true; scene.add(ground);

// ================= ПОЖАРЫ: состояние и слои =================
// Сетка горения — та же, что на сервере (fire.js). В сети клиент только зеркалит дельты,
// в одиночной игре считает огонь сам. Гарь рисуется отдельным слоем 192×192 поверх земли:
// одна клетка — один пиксель, обновлять его дёшево, в отличие от большой текстуры земли.
const fire = createFire(world);
let wind = { x: .6, z: -.8, s: .35 }, hp = 100, hurt = 0, hurtShown = 0, showZones = false, fireFx = null;
const fc = document.createElement('canvas'); fc.width = W; fc.height = H; const fcx = fc.getContext('2d');
// Клетки — только логика. Состояние клеток идёт в текстуру 192×192, а рисует его шейдер: край гари
// сдвинут шумом примерно на клетку в разные стороны, пятна пепла разного тона, угли мерцают пятнами —
// горящий участок не выглядит набором квадратов. Миникарта по-прежнему берёт логические клетки.
const fireData = new Uint8Array(W * H * 4), fireStateTex = new THREE.DataTexture(fireData, W, H, THREE.RGBAFormat);
fireStateTex.magFilter = fireStateTex.minFilter = THREE.LinearFilter; fireStateTex.needsUpdate = true;
function paintFireCell(k) { const i = k % W, j = (k / W) | 0, st = fire.state[k];
  fcx.clearRect(i, j, 1, 1); if (st) { fcx.fillStyle = st === FS.BURNING ? 'rgba(220,90,20,.9)' : 'rgba(40,32,26,.85)'; fcx.fillRect(i, j, 1, 1); }
  const o = ((H - 1 - j) * W + i) * 4;   // строка 0 текстуры — низ плоскости, то есть последний ряд клеток
  fireData[o] = st === FS.BURNING ? 255 : 0; fireData[o + 1] = st === FS.BURNT ? 255 : 0; fireData[o + 2] = world.fuel[k] === FUEL.HOUSE ? 255 : 0; fireData[o + 3] = 255; }
const ashMat = new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uState: { value: null }, uTime: { value: 0 } }]),
  vertexShader: `varying vec2 vUv;
    #include <fog_pars_vertex>
    void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `uniform sampler2D uState; uniform float uTime; varying vec2 vUv;
    #include <fog_pars_fragment>
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
    void main() {
      vec2 cell = vUv * 192.0;
      vec2 warp = vec2(fbm(cell * 0.33 + 3.1), fbm(cell * 0.33 + 17.7)) - 0.5;
      vec4 st = texture2D(uState, vUv + warp * (2.4 / 192.0));
      float grain = fbm(cell * 1.6);
      float burnt = smoothstep(0.32, 0.62, st.g + (grain - 0.5) * 0.55);
      float flick = fbm(cell * 1.15 + vec2(uTime * 0.8, -uTime * 1.2));
      float burning = smoothstep(0.28, 0.6, st.r + (grain - 0.5) * 0.65);
      vec3 ash = mix(vec3(0.09, 0.075, 0.062), vec3(0.24, 0.2, 0.16), fbm(cell * 3.2));
      vec3 ember = mix(vec3(0.32, 0.07, 0.02), vec3(1.0, 0.47, 0.09), smoothstep(0.42, 0.85, flick));
      float a = max(burnt * mix(0.72, 0.9, st.b), burning * (0.5 + 0.4 * flick));
      if (a < 0.01) discard;
      gl_FragColor = vec4(mix(ash, ember, burning), a);
      #include <fog_fragment>
    }`,
  transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
ashMat.uniforms.uState.value = fireStateTex;
function hsl(h, sat, l) { const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [(r + m) * 255, (g + m) * 255, (b + m) * 255]; }
// карта пожарных отсеков (клавиша B): каждый отсек своим цветом, просеки и пар — белым, дома — тёмным
const zc = document.createElement('canvas'); zc.width = W; zc.height = H;
{ const zx = zc.getContext('2d'), img = zx.createImageData(W, H);
  for (let k = 0; k < W * H; k++) { const z = world.zone[k], t = world.tiles[k]; let px = [0, 0, 0, 0];
    if (z >= 0) px = [...hsl((z * 137.508) % 360, .7, world.fuel[k] === FUEL.HOUSE ? .22 : .55), 165];
    else if (t === T.CLEARING || t === T.FALLOW) px = [255, 255, 255, 215];
    img.data.set(px.map(Math.round), k * 4); }
  zx.putImageData(img, 0, 0); }
const zoneTex = new THREE.CanvasTexture(zc); zoneTex.colorSpace = THREE.SRGBColorSpace;
const zoneMat = new THREE.MeshBasicMaterial({ map: zoneTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });   // логическая карта отсеков — клетками, как есть
const fireOverlay = new THREE.Mesh(groundGeo, ashMat);
fireOverlay.rotation.x = -Math.PI / 2; fireOverlay.position.set(W * TS / 2, .03, H * TS / 2); fireOverlay.renderOrder = 2; scene.add(fireOverlay);
const WIND_DIRS = ['на север', 'на северо-восток', 'на восток', 'на юго-восток', 'на юг', 'на юго-запад', 'на запад', 'на северо-запад'];
const windName = () => WIND_DIRS[Math.round(((Math.atan2(wind.x, -wind.z) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
function toggleZones() { showZones = !showZones; fireOverlay.material = showZones ? zoneMat : ashMat;
  const withH = world.zones.filter(z => z.houseCells).length;
  say(showZones ? `Пожарные отсеки: ${world.zones.length} групп, в ${withH} стоят дома. Белое — просеки и пар, огонь их не переходит` : 'Карта отсеков скрыта'); }
function igniteAction() {
  if (work) return; if (interior) return say('Внутри поджигать не станем');
  if (!offline && (inv.kerosene || 0) < 1) return say('Нужен керосин — он в скобяной лавке (HARDWARE)');
  const p = player.inCar ? car.pos : player.pos, k = nearestFuelCell(fire, p.x, p.z, TS, 1.8);
  if (k < 0) return say('Тут нечему гореть: дорога, вода, просека или уже гарь');
  startWork('Плещем керосин и чиркаем спичкой', .25, () => { if (offline) { igniteFire(fire, k); say(`Полыхнуло: ${FUEL_PROPS[world.fuel[k]].name}`); } else net.send({ t: 'ignite' }); }); }
function burnedTo(x, z, text) { if (player.inCar) { player.inCar = false; player.mesh.visible = true; car.speed = 0; } player.pos.set(x, 0, z); camTarget.copy(player.pos); hp = 100; say(text); }
const CROP_CHAR = new THREE.Color('#4a3a2a'), CROP_LIVE = new THREE.Color(1, 1, 1);
function setCrop(k, burnt) { const n0 = cropIndex[k]; if (n0 < 0 || !cropMesh) return; const arr = cropMesh.instanceMatrix.array;
  for (let q = 0; q < 4; q++) { const o = (n0 + q) * 16; for (let e = 0; e < 16; e++) arr[o + e] = cropBase[o + e];
    if (burnt) { const sy = .2 + ((k * 7 + q * 3) % 5) * .06; arr[o + 4] *= sy; arr[o + 5] *= sy; arr[o + 6] *= sy; }   // стебли разной высоты, а не ровный срез
    cropMesh.setColorAt(n0 + q, burnt ? CROP_CHAR : CROP_LIVE); } }
function initFireFx() {
  // пламя, дым и искры — по одному облаку точек на слой: сотни горящих клеток за четыре вызова отрисовки
  const layer = (n, blending) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4), 4)); g.setDrawRange(0, 0);
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTex, size: 10, vertexColors: true, transparent: true, depthWrite: false, blending, sizeAttenuation: false })); pts.frustumCulled = false; scene.add(pts); return pts; };
  const light = new THREE.PointLight('#ff8a3a', 0, 38, 1.4); scene.add(light);
  fireFx = { ground: layer(2600, THREE.AdditiveBlending), tongue: layer(900, THREE.AdditiveBlending), crown: layer(1400, THREE.AdditiveBlending), smoke: layer(700, THREE.NormalBlending), sparks: layer(600, THREE.AdditiveBlending), light };
}
function updateFire(dt) {
  if (!fireFx) initFireFx();
  if (offline) stepFire(fire, dt, wind, Math.random, day * 24 + time); else tickMirror(fire, dt);
  if (fire.changed.size) {
    for (const k of fire.changed) { paintFireCell(k); const st = fire.state[k];
      if (treeCell[k] && st !== FS.BURNING) { const ch = treeChunks.get(Math.floor((k % W) / TREE_CH) + ',' + Math.floor(((k / W) | 0) / TREE_CH)); if (ch) dirtyChunks.add(ch); }
      if (cropIndex[k] >= 0) setCrop(k, st === FS.BURNT); }
    fire.changed.clear(); fireStateTex.needsUpdate = true; if (cropMesh) { cropMesh.instanceMatrix.needsUpdate = true; if (cropMesh.instanceColor) cropMesh.instanceColor.needsUpdate = true; } }
  // кусок леса пересобираем не чаще раза в 1,5 с и не больше одного за кадр — пожар не должен тормозить
  { const now = performance.now(); for (const ch of dirtyChunks) { if (now - ch.builtAt < 1500) continue; buildTreeChunk(ch); dirtyChunks.delete(ch); break; } }
  for (const h of ruralHouses) { let burning = 0, burnt = 0; for (const k of h.cells) { const q = fire.state[k]; if (q === FS.BURNING) burning++; else if (q === FS.BURNT) burnt++; }
    const st = burning ? 1 : burnt * 2 >= h.cells.length ? 2 : 0;
    if (st !== h.state) { h.state = st; h.intact.visible = st !== 2; h.intact.material = st === 1 ? burningHouseMat : mat;
      if (st === 2 && !h.ruin) { h.ruin = ruinMesh(h.b); h.ruin.position.y = h.intact.position.y; scene.add(h.ruin); } if (h.ruin) h.ruin.visible = st === 2; } }
  const Rv = Math.max(34, VIEW_H * 1.4), cx = camTarget.x, cz = camTarget.z, tt = performance.now() / 1000;
  const G = fireFx.ground.geometry.attributes, Tg = fireFx.tongue.geometry.attributes, C = fireFx.crown.geometry.attributes, Sm = fireFx.smoke.geometry.attributes, K = fireFx.sparks.geometry.attributes;
  let ng = 0, nt = 0, nc = 0, ns = 0, nk = 0, lx = 0, lz = 0, ln = 0;
  // Клетка решает только «горит или нет». Огонь на экране рассыпан по клетке и чуть за её край,
  // у каждого языка своя частота и дрейф, верховое пламя — на настоящих кронах деревьев.
  const hr = (k, q) => { const v = Math.sin(k * 12.9898 + q * 78.233) * 43758.5453; return v - Math.floor(v); };
  if (!interior) for (const k of fire.burning) {
    const i = k % W, j = (k / W) | 0, cx0 = (i + .5) * TS, cz0 = (j + .5) * TS; if (Math.abs(cx0 - cx) > Rv || Math.abs(cz0 - cz) > Rv) continue;
    const fu = world.fuel[k], I = fireIntensity(fire, k) / FUEL_PROPS[fu].heat, y0 = hAt(cx0, cz0);
    for (let q = 0; q < 3 && ng < 2600; q++) { const ph = hr(k, q + 13) * 40, fl = .6 + .4 * Math.sin(tt * (8 + q * 3) + ph) * Math.sin(tt * 5.3 + ph * 1.7);
      const x = cx0 + (hr(k, q) - .5) * 2.5 + Math.sin(tt * .8 + ph) * .14, z = cz0 + (hr(k, q + 7) - .5) * 2.5 + Math.cos(tt * .7 + ph) * .14;
      G.position.setXYZ(ng, x, y0 + .3 + .25 * fl, z); G.color.setXYZW(ng, 1, .45 + .3 * fl, .15, Math.max(0, .9 * I * fl)); ng++; }
    if (hr(k, 21) < .6 && nt < 900) { const ph = hr(k, 24) * 30, fl = .55 + .45 * Math.sin(tt * 6.5 + ph);
      Tg.position.setXYZ(nt, cx0 + (hr(k, 22) - .5) * 2.2, y0 + .8 + .45 * fl, cz0 + (hr(k, 23) - .5) * 2.2); Tg.color.setXYZW(nt, 1, .38 + .25 * fl, .08, .75 * I * fl); nt++; }
    const trees = fu !== FUEL.HOUSE && cellTrees.get(k);
    if (trees) for (const tr of trees) { if (nc >= 1400) break; const ph = tr.x * 3.1 + tr.z * 1.7, fl = .6 + .4 * Math.sin(tt * 7 + ph) * Math.sin(tt * 4.1 + ph * .5);
      C.position.setXYZ(nc, tr.x + Math.sin(tt * 1.3 + ph) * .15, tr.y + tr.h * (.65 + .3 * fl), tr.z + Math.cos(tt * 1.1 + ph) * .15); C.color.setXYZW(nc, 1, .4 + .3 * fl, .1, .85 * I * fl); nc++; }
    if (fu === FUEL.HOUSE) for (let q = 0; q < 4 && nc < 1400; q++) { const f2 = .75 + .25 * Math.sin(tt * (9 + q * 2) + hr(k, q + 30) * 30 + q);
      C.position.setXYZ(nc, cx0 + (hr(k, q + 40) - .5) * 1.8, y0 + .9 + q * .75 + .4 * f2, cz0 + (hr(k, q + 50) - .5) * 1.8); C.color.setXYZW(nc, 1, .38 + .3 * f2, .1, Math.min(1, I * f2 * (1 - q * .12))); nc++; }
    if (hr(k, 60) < .55 && ns < 700) { const ph = (tt * (.16 + hr(k, 61) * .1) + hr(k, 62)) % 1, x = cx0 + (hr(k, 63) - .5) * 2.2, z = cz0 + (hr(k, 64) - .5) * 2.2, g = .28 + hr(k, 65) * .2;
      Sm.position.setXYZ(ns, x + wind.x * ph * 7 * (.4 + wind.s), y0 + 2 + ph * 10, z + wind.z * ph * 7 * (.4 + wind.s)); Sm.color.setXYZW(ns, g, g, g * .96, .32 * (1 - ph) * Math.min(1, I + .35)); ns++; }
    if (hr(k, 70) > .7 && nk < 600) { const ph = (tt * (.7 + hr(k, 71) * .4) + hr(k, 72)) % 1, x = cx0 + (hr(k, 73) - .5) * 2, z = cz0 + (hr(k, 74) - .5) * 2;
      K.position.setXYZ(nk, x + Math.sin(ph * 9 + k) * .5 + wind.x * ph * 3.5, y0 + .6 + ph * 5.5, z + Math.cos(ph * 7 + k) * .5 + wind.z * ph * 3.5); K.color.setXYZW(nk, 1, .72, .3, 1 - ph); nk++; }
    lx += cx0; lz += cz0; ln++;
  }
  for (const [pts, n] of [[fireFx.ground, ng], [fireFx.tongue, nt], [fireFx.crown, nc], [fireFx.smoke, ns], [fireFx.sparks, nk]]) { pts.geometry.setDrawRange(0, n); pts.geometry.attributes.position.needsUpdate = true; pts.geometry.attributes.color.needsUpdate = true; }
  const ppu = innerHeight / VIEW_H; fireFx.ground.material.size = 1.5 * ppu; fireFx.tongue.material.size = 2.8 * ppu; fireFx.crown.material.size = 2.6 * ppu; fireFx.smoke.material.size = 7 * ppu; fireFx.sparks.material.size = .35 * ppu;
  ashMat.uniforms.uTime.value = tt;
  if (ln) { fireFx.light.position.set(lx / ln, hAt(lx / ln, lz / ln) + 5, lz / ln); fireFx.light.intensity = Math.min(120, 20 + ln * 3) * (.85 + .15 * Math.sin(tt * 9)); } else fireFx.light.intensity = 0;
  // здоровье: в сети его ведёт сервер, в одиночке — считаем сами
  if (offline) { const p = player.inCar ? car.pos : player.pos, d = interior ? 0 : fireDamageAt(fire, p.x, p.z, TS) * (player.inCar ? .5 : 1); hurt = d;
    hp = d > 0 ? hp - d * dt : Math.min(100, hp + 6 * dt); if (hp <= 0) { eco.jugs = 0; burnedTo(X(world.start.i), Z(world.start.j), 'Обгорел — очнулся у доктора в городе'); } }
  else hurt *= Math.max(0, 1 - dt * 1.5);
  hurtShown += ((hurt > .5 ? Math.min(1, .35 + hurt / 40) : 0) - hurtShown) * Math.min(1, dt * 6);
  const bEl = document.getElementById('burn'), hEl = document.getElementById('hpfill'), wEl = document.getElementById('windTag');
  if (bEl) bEl.style.opacity = hurtShown.toFixed(2);
  if (hEl) { hEl.style.width = Math.max(0, hp).toFixed(0) + '%'; hEl.style.background = hp < 35 ? '#c0392b' : '#8a3a2a'; }
  if (wEl) { const p = interior ? interior.ret : (player.inCar ? car.pos : player.pos); const pk = idx(Math.max(0, Math.min(W - 1, Math.floor(p.x / TS))), Math.max(0, Math.min(H - 1, Math.floor(p.z / TS)))), zid = world.zone[pk];
    wEl.textContent = `· ветер ${windName()} ${Math.round(wind.s * 100)}%` + (fire.burning.size ? ` · горит клеток: ${fire.burning.size}` : '') +
      (showZones ? (zid >= 0 ? ` · отсек #${zid}: ${world.zones[zid].cells} кл.${world.zones[zid].houseCells ? ', есть дом' : ''}` : ' · здесь не горит') : ''); }
}
// вода: полупрозрачная плоскость, видна там, где рельеф ниже
const waterMat = new THREE.MeshLambertMaterial({ color: '#7fc0da', transparent: true, opacity: .78 });
const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(W * TS, H * TS), waterMat); waterMesh.rotation.x = -Math.PI / 2; waterMesh.position.set(W * TS / 2, -.32, H * TS / 2); scene.add(waterMesh);

// ---- геометрия с цветом вершин
const col = new THREE.Color();
function colored(geo, hex, k = 1) { const g = geo.index ? geo.toNonIndexed() : geo; g.deleteAttribute('uv'); col.set(hex).multiplyScalar(k); const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function box(w, h, d, x, y, z, hex, k) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); return colored(g, hex, k); }
function tri(a, b, c, out) { out.push(...a, ...b, ...c); }
function prism(x0, x1, z0, z1, h, rh, alongX, hex) {
  const pos = [];
  if (alongX) { const zm = (z0 + z1) / 2; const A = [x0, h, z0], B = [x1, h, z0], C = [x1, h, z1], D = [x0, h, z1], E = [x0, h + rh, zm], F = [x1, h + rh, zm]; tri(D, C, F, pos); tri(D, F, E, pos); tri(B, A, E, pos); tri(B, E, F, pos); tri(A, D, E, pos); tri(C, B, F, pos); }
  else { const xm = (x0 + x1) / 2; const A = [x0, h, z0], B = [x1, h, z0], C = [x1, h, z1], D = [x0, h, z1], E = [xm, h + rh, z0], F = [xm, h + rh, z1]; tri(C, D, F, pos); tri(B, C, F, pos); tri(B, F, E, pos); tri(A, B, E, pos); tri(D, A, E, pos); tri(D, E, F, pos); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return colored(g, hex);
}
const parts = [], glassLit = [], glassDark = [];
const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
const signs = [];
function building(b) {
  const x0 = X(b.i), x1 = X(b.i + b.w), z0 = Z(b.j), z1 = Z(b.j + b.d), h = b.f * FH, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  parts.push(box(x1 - x0, h, z1 - z0, cx, 0, cz, b.wall)); parts.push(box(x1 - x0 + .06, .25, z1 - z0 + .06, cx, 0, cz, b.wall, .6));
  const rh = Math.max(.7, Math.min(b.w, b.d) * .8), ov = .25;
  if (b.roof == 'flat') {
    parts.push(box(x1 - x0 + .1, .12, z1 - z0 + .1, cx, h, cz, b.roofc));
    for (const [w, d, x, z] of [[x1 - x0 + .1, .12, cx, z0 - .01], [x1 - x0 + .1, .12, cx, z1 + .01], [.12, z1 - z0 + .1, x0 - .01, cz], [.12, z1 - z0 + .1, x1 + .01, cz]]) parts.push(box(w, .35, d, x, h, z, b.wall, .9));
    if (b.kind == 'court') { parts.push(colored(new THREE.CylinderGeometry(.8, 1.1, .5, 12).translate(cx, h + .55, cz), '#c7c3b6')); parts.push(colored(new THREE.SphereGeometry(.9, 12, 8, 0, 6.3, 0, 1.6).translate(cx, h + .8, cz), '#e7e2d4')); parts.push(box(.1, .6, .1, cx, h + 1.6, cz, '#8c8a80')); }
  } else {
    parts.push(prism(x0 - ov, x1 + ov, z0 - ov, z1 + ov, h, rh, b.ridge == 'i', b.roofc));
    parts.push(prism(x0 + .02, x1 - .02, z0 + .02, z1 - .02, h - .01, rh - .01, b.ridge == 'i', b.wall));
    if (b.kind == 'church') { parts.push(box(.7, 2.4, .7, cx, h + rh - .3, z1 - .8, '#f4efe4')); parts.push(colored(new THREE.ConeGeometry(.5, 1.2, 4).translate(cx, h + rh + 2.7, z1 - .8), '#6f7f8a')); }
  }
  if (b.chimney) parts.push(box(.35, (b.roof == 'flat' ? .8 : rh + .6), .35, x0 + (x1 - x0) * .72, h - .1, z0 + (z1 - z0) * .3, '#8a5a48'));
  const faces = { S: { len: b.w, at: (u, y) => [x0 + u, y, z1 + .02], rot: 0 }, N: { len: b.w, at: (u, y) => [x1 - u, y, z0 - .02], rot: Math.PI }, E: { len: b.d, at: (u, y) => [x1 + .02, y, z1 - u], rot: Math.PI / 2 }, W: { len: b.d, at: (u, y) => [x0 - .02, y, z0 + u], rot: -Math.PI / 2 } };
  for (const side of 'SNEW') {
    const f = faces[side], n = Math.max(1, Math.round(f.len * 1.6)), L = f.len * TS;
    for (let fl = 0; fl < Math.floor(b.f + .4); fl++) for (let q = 0; q < n; q++) {
      const u = (q + .5) / n * L, y = fl * FH + FH * .55;
      const isDoor = fl == 0 && side == b.front && q == Math.floor(n / 2);
      if (isDoor) { const [px, py, pz] = f.at(u, FH * .4); const g = new THREE.BoxGeometry(.6, FH * .8, .08); g.rotateY(f.rot); g.translate(px, py, pz); parts.push(colored(g, '#5a3a26')); continue; }
      const big = b.kind == 'shop' && fl == 0 && side == b.front;
      const [px, py, pz] = f.at(u, big ? FH * .5 : y);
      const m = new THREE.Matrix4().makeRotationY(f.rot).setPosition(px, py, pz); m.scale(new THREE.Vector3(big ? 1.6 : 1, big ? 1.3 : 1, 1));
      (Math.random() < .8 ? glassLit : glassDark).push(m);
    }
  }
  if ((b.porch || b.awning) && b.front) {
    const f = faces[b.front], L = f.len * TS, dep = b.awning ? .7 : 1.1, y = b.awning ? FH - .15 : FH * .85;
    const [px, , pz] = f.at(L / 2, 0); const dir = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }[b.front]; const hor = b.front == 'S' || b.front == 'N';
    const g = new THREE.BoxGeometry(hor ? L : dep, .08, hor ? dep : L); g.translate(px + dir[0] * dep / 2, y, pz + dir[1] * dep / 2); parts.push(colored(g, b.awning ? ((b.i + b.j) % 2 ? '#b8503f' : '#4f6b8a') : b.roofc, .95));
    if (b.porch) { const fg = new THREE.BoxGeometry(hor ? L : dep, .18, hor ? dep : L); fg.translate(px + dir[0] * dep / 2, .09, pz + dir[1] * dep / 2); parts.push(colored(fg, b.wall, .8));
      for (const s of [-1, 1]) { const ox = hor ? s * (L / 2 - .15) : dir[0] * (dep - .1), oz = hor ? dir[1] * (dep - .1) : s * (L / 2 - .15); parts.push(box(.1, y, .1, px + ox, 0, pz + oz, '#f8f4ea')); } }
  }
  if (b.wheel) parts.push(colored(new THREE.CylinderGeometry(1, 1, .2, 12).rotateZ(Math.PI / 2).translate(x0 - .15, .9, cz), '#5c4a3a'));
  if (b.name && b.kind == 'shop') signs.push({ b, faces });
}
// Сельские постройки горят, поэтому у каждой свой меш: целый, обугленный на время пожара, пепелище.
const ruralHouses = [];
const burningHouseMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: '#8a6a5a', emissive: '#2a0c02' });
function spliceBuilding(b) { const p0 = parts.length, g0 = glassLit.length, d0 = glassDark.length, s0 = signs.length;
  building(b); const mine = parts.splice(p0); const wins = [...glassLit.splice(g0), ...glassDark.splice(d0)]; signs.splice(s0);
  for (const m of wins) mine.push(colored(new THREE.PlaneGeometry(.5, .62).applyMatrix4(m), '#8fb2c0'));
  return mine; }
function ruinMesh(b) {
  const x0 = X(b.i), x1 = X(b.i + b.w), z0 = Z(b.j), z1 = Z(b.j + b.d), h = b.f * FH, out = [];
  [[x0 + .12, z0 + .12, .8], [x1 - .12, z0 + .12, .55], [x0 + .12, z1 - .12, .95], [x1 - .12, z1 - .12, .65]].forEach(([x, z, k]) => out.push(box(.24, h * k, .24, x, 0, z, '#241e1a')));
  out.push(box(x1 - x0, .45, .2, (x0 + x1) / 2, 0, z1 - .1, '#2e2621')); out.push(box(.2, .65, z1 - z0, x0 + .1, 0, (z0 + z1) / 2, '#2e2621'));
  out.push(box(x1 - x0 - .3, .1, z1 - z0 - .3, (x0 + x1) / 2, 0, (z0 + z1) / 2, '#181310'));
  out.push(box(.42, h + .9, .42, x0 + (x1 - x0) * .72, 0, z0 + (z1 - z0) * .3, '#5a4a40'));   // уцелевшая печная труба
  const m = new THREE.Mesh(mergeGeometries(out), mat); for (const g of out) g.dispose(); m.castShadow = true; return m; }
for (const b of world.buildings) { if (!b.rural) { building(b); continue; }
  const geo = spliceBuilding(b), m = new THREE.Mesh(mergeGeometries(geo), mat); for (const g of geo) g.dispose();
  m.castShadow = m.receiveShadow = true; m.position.y = hIJ(b.i + b.w / 2, b.j + b.d / 2) - .05; scene.add(m);
  const cells = []; for (let y = b.j; y < b.j + b.d; y++) for (let x = b.i; x < b.i + b.w; x++) cells.push(idx(x, y));
  ruralHouses.push({ b, intact: m, ruin: null, state: 0, cells }); }
function mkHouse(kind, state = 'intact') { const q = { barn: ['#9c4436', 3, 1.7, 'j'], cabin: ['#8a6a48', 2, 1, 'i'], farmhouse: ['#e7d6b0', 2, 1.5, 'i'] }[kind] || ['#e7d6b0', 2, 1, 'i'];
  const b = { i: 0, j: 0, w: 2, d: q[1], f: q[2], kind, rural: true, front: 'S', roof: 'gable', ridge: q[3], wall: q[0], roofc: '#4f4237', chimney: true, porch: kind !== 'barn' };
  if (state === 'ruin') return ruinMesh(b);
  const geo = spliceBuilding(b), m = new THREE.Mesh(mergeGeometries(geo), state === 'burning' ? burningHouseMat : mat); for (const g of geo) g.dispose(); return m; }
// Модули городского набора — те же размеры, из которых собирает здания building(): по ним рисуется ТЗ города.
function mkKit(id) {
  const out = [], extra = [], wallC = '#c96f4f', roofC = '#7a7268';
  const plane = (w, h, x, y, z, hex) => colored(new THREE.PlaneGeometry(w, h).translate(x, y, z), hex);
  switch (id) {
    case 'wall': out.push(box(2, FH, 2, 0, 0, 0, wallC), box(2.06, .25, 2.06, 0, 0, 0, wallC, .6)); break;
    case 'window': out.push(box(2, FH, .2, 0, 0, 0, '#e8dfcf'), plane(.5, .62, 0, FH * .55, .101, '#8fb2c0')); break;
    case 'door': out.push(box(2, FH, .2, 0, 0, 0, '#e8dfcf'), box(.6, FH * .8, .08, 0, 0, .12, '#5a3a26')); break;
    case 'shopfront': {
      out.push(box(2, FH * 2, .2, 0, 0, 0, wallC), plane(.8, .81, -.45, FH * .5, .101, '#8fb2c0'), box(.6, FH * .8, .08, .5, 0, .12, '#5a3a26'), box(2, .08, .7, 0, FH - .15, .45, '#b8503f'));
      const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d'); x.fillStyle = '#2b3a4a'; x.fillRect(0, 0, 256, 48); x.fillStyle = '#f2e6c8'; x.font = 'bold 30px Georgia'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('GROCERY', 128, 26);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .55), new THREE.MeshBasicMaterial({ map: t })); sign.position.set(0, FH + .25, .13); extra.push(sign); break; }
    case 'roof_flat': out.push(box(2.1, .12, 2.1, 0, 0, 0, roofC)); for (const [w, d, x, z] of [[2.1, .12, 0, -1.04], [2.1, .12, 0, 1.04], [.12, 2.1, -1.04, 0], [.12, 2.1, 1.04, 0]]) out.push(box(w, .35, d, x, .12, z, '#e8dfcf', .9)); break;
    case 'roof_gable': out.push(prism(-1.25, 1.25, -1.25, 1.25, 0, 1.6, true, '#8a6b52'), prism(-.98, .98, -.98, .98, -.01, 1.59, true, '#f4efe4')); break;
    case 'chimney': out.push(box(.35, 1.2, .35, 0, 0, 0, '#8a5a48')); break;
    case 'porch': out.push(box(2, .18, 1.1, 0, 0, 0, '#e9d5b8', .8), box(2, .08, 1.1, 0, FH * .85, 0, '#8a6b52', .95), box(.1, FH * .85, .1, -.85, 0, .45, '#f8f4ea'), box(.1, FH * .85, .1, .85, 0, .45, '#f8f4ea')); break;
    case 'awning': out.push(box(2, .08, .7, 0, 0, 0, '#4f6b8a'), box(2, .08, .7, 0, .3, 1, '#b8503f')); break;
    case 'fence': out.push(box(2, .06, .05, 0, .35, 0, '#f3ead6')); for (let q = 0; q <= 4; q++) out.push(box(.07, .5, .07, -1 + q * .5, 0, 0, '#f3ead6')); break;
    case 'lamp': out.push(box(.08, 2.6, .08, 0, 0, 0, '#3a3a3a'), colored(new THREE.SphereGeometry(.13, 12, 8).translate(0, 2.7, 0), '#f0e6c8')); break;
    case 'bridge': out.push(box(TS, .14, TS, 0, 0, 0, '#8a6b52'), box(TS, .5, .1, 0, .1, -.95, '#7a5b42'), box(TS, .5, .1, 0, .1, .95, '#7a5b42')); break;
    case 'crossing': out.push(box(.1, 2.2, .1, 0, 0, 0, '#f0f0f0'), box(.6, .12, .06, 0, 2.0, 0, '#c0392b')); break;
    case 'dome': out.push(box(3, .12, 3, 0, 0, 0, '#8e8f87'), colored(new THREE.CylinderGeometry(.8, 1.1, .5, 16).translate(0, .3, 0), '#c7c3b6'), colored(new THREE.SphereGeometry(.9, 16, 10, 0, 6.3, 0, 1.6).translate(0, .55, 0), '#e7e2d4'), box(.1, .6, .1, 0, 1.35, 0, '#8c8a80')); break;
    case 'steeple': out.push(box(.7, 2.4, .7, 0, 0, 0, '#f4efe4'), colored(new THREE.ConeGeometry(.5, 1.2, 4).translate(0, 3, 0), '#6f7f8a')); break;
    case 'millwheel': out.push(colored(new THREE.CylinderGeometry(1, 1, .2, 20).rotateZ(Math.PI / 2).translate(0, 1, 0), '#5c4a3a')); break;
  }
  const g = new THREE.Group(); if (out.length) { g.add(new THREE.Mesh(mergeGeometries(out), mat)); for (const q of out) q.dispose(); } for (const e of extra) g.add(e); return g;
}
function mkTownBuilding(kind) { const src = world.buildings.find(q => q.kind === kind && !q.rural); if (!src) return null;
  const geo = spliceBuilding({ ...src, i: 0, j: 0 }), m = new THREE.Mesh(mergeGeometries(geo), mat); for (const g of geo) g.dispose(); return m; }
for (const f of world.fences) { const x0 = X(f.i), x1 = X(f.i + f.w), z0 = Z(f.j), z1 = Z(f.j + f.d); const hor = f.side == 'N' || f.side == 'S'; const z = f.side == 'N' ? z0 + .1 : z1 - .1, x = f.side == 'W' ? x0 + .1 : x1 - .1;
  parts.push(hor ? box(x1 - x0, .06, .05, (x0 + x1) / 2, .35, z, '#f3ead6') : box(.05, .06, z1 - z0, x, .35, (z0 + z1) / 2, '#f3ead6'));
  const n = Math.round((hor ? x1 - x0 : z1 - z0) / .5); for (let q = 0; q <= n; q++) { const u = q / n; parts.push(hor ? box(.07, .5, .07, x0 + (x1 - x0) * u, 0, z, '#f3ead6') : box(.07, .5, .07, x, 0, z0 + (z1 - z0) * u, '#f3ead6')); } }
for (const p of world.props) {
  if (p.t == 'bridge') { parts.push(box(TS, .14, TS, X(p.i + .5), -.02, Z(p.j + .5), '#8a6b52')); if (p.edge == 'N') parts.push(box(TS, .5, .1, X(p.i + .5), .1, Z(p.j) + .05, '#7a5b42')); if (p.edge == 'S') parts.push(box(TS, .5, .1, X(p.i + .5), .1, Z(p.j + 1) - .05, '#7a5b42')); }
  if (p.t == 'trestle') { parts.push(box(TS, .3, TS, X(p.i + .5), -.2, Z(p.j + .5), '#6a5440')); parts.push(box(.2, .9, .2, X(p.i + .25), -.9, Z(p.j + .5), '#5a4636')); parts.push(box(.2, .9, .2, X(p.i + .75), -.9, Z(p.j + .5), '#5a4636')); }
  if (p.t == 'ford') { parts.push(box(TS, .2, TS, X(p.i + .5), -.55, Z(p.j + .5), '#bdb39a')); }
  if (p.t == 'crossing') { parts.push(box(.1, 2.2, .1, X(p.i) - .3, 0, Z(p.j) - .3, '#f0f0f0')); parts.push(box(.6, .12, .06, X(p.i) - .3, 2.0, Z(p.j) - .3, '#c0392b')); }
  if (p.t == 'scarecrow') { const x = X(p.i), z = Z(p.j), y = hAt(x, z);          // пугало в кукурузе
    parts.push(box(.12, 1.9, .12, x, y, z, '#7a6242')); parts.push(box(1.5, .1, .1, x, y + 1.35, z, '#7a6242'));
    parts.push(box(.7, .55, .35, x, y + 1.0, z, '#9a5a4a')); parts.push(colored(new THREE.SphereGeometry(.24, 8, 6).translate(x, y + 1.75, z), '#d9c98e'));
    parts.push(colored(new THREE.ConeGeometry(.42, .3, 8).translate(x, y + 1.95, z), '#c9b478')); }
}
const lampHeads = [];
for (const l of world.lamps) { parts.push(box(.08, 2.6, .08, X(l.i), 0, Z(l.j), '#3a3a3a')); lampHeads.push(new THREE.Vector3(X(l.i), 2.7, Z(l.j))); }
// камни
for (const r of world.rocks) { const y = hAt(X(r.i), Z(r.j)); parts.push(colored(new THREE.IcosahedronGeometry(r.r * TS * .45, 1).scale(1, .7, 1).translate(X(r.i), y + r.r * .3, Z(r.j)), '#9d9890')); }
// деревья
const trunk = new THREE.CylinderGeometry(.08, .12, 1, 7), cone = new THREE.ConeGeometry(1, 1.6, 9), ball = new THREE.IcosahedronGeometry(1, 1);   // икосаэдр: крона круглая без острых полюсов при тех же треугольниках
// Породы: хвоя в горах, дуб и клён у города, берёза вдоль улиц, ива по берегам.
const TREE = {
  pine:   { trunk: '#6b4a30', a: '#5d8b50', b: '#6f9e61' },
  oak:    { trunk: '#6e4a30', a: '#6f9b57', b: '#86b46b' },
  maple:  { trunk: '#7a5236', a: '#c07f38', b: '#d9a24e' },
  birch:  { trunk: '#d6d1c2', a: '#93bf71', b: '#abd389' },
  willow: { trunk: '#7c6242', a: '#8ab774', b: '#a2c98a' },
};
// Деревья режем на куски 24×24 клетки: при пожаре пересобирается только кусок, где клетки
// выгорели (обугленные стволы вместо крон), а не все деревья карты.
const TREE_CH = 24, treeChunks = new Map(), dirtyChunks = new Set(), treeCell = new Uint8Array(W * H);
const cellOfTree = t => idx(Math.min(W - 1, Math.floor(t.i)), Math.min(H - 1, Math.floor(t.j)));
for (const t of world.trees) { const key = Math.floor(t.i / TREE_CH) + ',' + Math.floor(t.j / TREE_CH);
  if (!treeChunks.has(key)) treeChunks.set(key, { trees: [], mesh: null, builtAt: -1e9 }); treeChunks.get(key).trees.push(t); treeCell[cellOfTree(t)] = 1; }
function treeInto(out, t, st) {
  const x = X(t.i), z = Z(t.j), y = hAt(x, z), r = t.r * TS * .5, kind = t.kind || (t.pine ? 'pine' : 'oak');
  if (st === FS.BURNT) {   // обугленный ствол и огрызок кроны
    out.push(colored(trunk.clone().scale(1.15, r * 1.5, 1.15).translate(x, y + r * .75, z), '#2b2521'));
    if (kind === 'pine') out.push(colored(cone.clone().scale(r * .3, r * .6, r * .3).translate(x, y + r * 1.7, z), '#1f1a17'));
    else out.push(colored(trunk.clone().scale(.6, r * .7, .6).rotateZ(.7).translate(x + r * .25, y + r * 1.3, z), '#2a221d'));
    return; }
  const c = st === FS.BURNING ? { trunk: '#3a2a20', a: '#5f4a2e', b: '#7a5530' } : (TREE[kind] || TREE.oak);
  out.push(colored(trunk.clone().scale(kind === 'birch' ? .8 : 1, r * (kind === 'birch' ? 1.6 : 1.2), kind === 'birch' ? .8 : 1).translate(x, y + r * .6, z), c.trunk));
  if (kind === 'pine') { out.push(colored(cone.clone().scale(r, r * 1.1, r).translate(x, y + r * 1.2, z), c.a)); out.push(colored(cone.clone().scale(r * .7, r, r * .7).translate(x, y + r * 2.1, z), c.b)); }
  else if (kind === 'willow') { out.push(colored(ball.clone().scale(r * 1.1, r * .55, r * 1.1).translate(x, y + r * 1.5, z), c.a)); out.push(colored(ball.clone().scale(r * .8, r * .4, r * .8).translate(x, y + r * 1.9, z), c.b)); }
  else if (kind === 'birch') { out.push(colored(ball.clone().scale(r * .6, r * .8, r * .6).translate(x, y + r * 1.9, z), c.a)); out.push(colored(ball.clone().scale(r * .45, r * .55, r * .45).translate(x + r * .2, y + r * 2.4, z), c.b)); }
  else { out.push(colored(ball.clone().scale(r * .8, r * .7, r * .8).translate(x, y + r * 1.4, z), c.a)); out.push(colored(ball.clone().scale(r * .6, r * .55, r * .6).translate(x + r * .3, y + r * 1.9, z - r * .2), c.b)); }
}
function buildTreeChunk(ch) { if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); ch.mesh = null; }
  const out = []; for (const t of ch.trees) treeInto(out, t, fire.state[cellOfTree(t)]);
  if (out.length) { ch.mesh = new THREE.Mesh(mergeGeometries(out), mat); ch.mesh.castShadow = ch.mesh.receiveShadow = true; scene.add(ch.mesh); }
  for (const g of out) g.dispose(); ch.builtAt = performance.now(); }
// для верхового огня: настоящие точки крон в каждой клетке
const cellTrees = new Map();
for (const t of world.trees) { const k = cellOfTree(t), x = X(t.i), z = Z(t.j), y = hAt(x, z), r = t.r * TS * .5;
  if (!cellTrees.has(k)) cellTrees.set(k, []); cellTrees.get(k).push({ x, z, y, h: r * (t.kind === 'pine' ? 2.5 : 2.1) }); }
function mkTree(kind, st = 0) { const out = []; treeInto(out, { i: 0, j: 0, r: .62, kind }, st); const m = new THREE.Mesh(mergeGeometries(out), mat); for (const g of out) g.dispose(); return m; }
const cityMesh = new THREE.Mesh(mergeGeometries(parts), mat); cityMesh.castShadow = cityMesh.receiveShadow = true; scene.add(cityMesh);
let cornStalkGeo = null, cropMesh = null, cropBase = null; const cropIndex = new Int32Array(W * H).fill(-1);
// ---- кукуруза: по несколько стеблей на каждую клетку поля, одним InstancedMesh
{
  const stalk = cornStalkGeo = mergeGeometries([
    new THREE.CylinderGeometry(.03, .045, 1.25, 5).translate(0, .62, 0),
    new THREE.BoxGeometry(.5, .05, .08).rotateZ(.5).translate(.2, .95, 0),
    new THREE.BoxGeometry(.5, .05, .08).rotateZ(-.5).translate(-.2, .8, 0),
  ]);
  const cells = []; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (world.tiles[idx(i, j)] === T.FIELD) cells.push([i, j]);
  const per = 4, im = new THREE.InstancedMesh(stalk, new THREE.MeshLambertMaterial({ color: '#9db757' }), cells.length * per);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), sc4 = new THREE.Vector3();
  let n = 0; const rnd = (() => { let v = 12345; return () => (v = (v * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  for (const [i, j] of cells) { cropIndex[idx(i, j)] = n; for (let k = 0; k < per; k++) {
    const x = X(i + .2 + rnd() * .6), z = Z(j + .2 + rnd() * .6), y = hAt(x, z);
    e4.set(0, rnd() * 6.28, 0); q4.setFromEuler(e4); sc4.set(.9 + rnd() * .5, .8 + rnd() * .7, .9 + rnd() * .5);
    m4.compose(new THREE.Vector3(x, y, z), q4, sc4); im.setMatrixAt(n++, m4);
  } }
  im.castShadow = true; im.receiveShadow = true; scene.add(im); cropMesh = im; cropBase = im.instanceMatrix.array.slice();
  { const live = new THREE.Color(1, 1, 1); for (let q = 0; q < n; q++) im.setColorAt(q, live); im.instanceColor.needsUpdate = true; }
}
// ---- фермеры на полях: машут тяпкой, пока светло
function mkFarmer(tool = 'hoe') {
  const g = new THREE.Group();
  const mesh = (geo, col, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, lamb(col)); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const limb = (x, y, r, len, col) => { const pivot = new THREE.Group(); pivot.position.set(x, y, 0); g.add(pivot); mesh(new THREE.CapsuleGeometry(r, len, 4, 10), col, 0, -(len / 2 + r), 0, pivot); return pivot; };
  limb(-.11, .48, .08, .3, '#4d5a6e'); limb(.11, .48, .08, .3, '#4d5a6e');
  const torso = mesh(new RoundedBoxGeometry(.46, .52, .28, 3, .11), '#b9a26f', 0, .75, 0);
  const armL = limb(-.3, 1.0, .06, .32, '#c9b183'), armR = limb(.3, 1.0, .06, .32, '#c9b183');
  mesh(new THREE.SphereGeometry(.155, 16, 12), '#e0b58c', 0, 1.22, 0);
  mesh(new THREE.ConeGeometry(.42, .24, 20), '#d6c188', 0, 1.46, 0);
  if (tool === 'hoe') { const t1 = mesh(new THREE.CylinderGeometry(.03, .03, 1.1, 8), '#7a5a3a', .4, .75, .1); t1.rotation.z = .5; mesh(new RoundedBoxGeometry(.3, .07, .1, 2, .03), '#5a5550', .72, .28, .1); }
  else mesh(new THREE.CylinderGeometry(.24, .18, .26, 16), '#a98a52', .42, .55, .12);
  g.userData = { armL, armR, torso };
  return { g, armL, armR, torso };
}
function mkScarecrow() { const out = [box(.12, 1.9, .12, 0, 0, 0, '#7a6242'), box(1.5, .1, .1, 0, 1.35, 0, '#7a6242'), box(.7, .55, .35, 0, 1.0, 0, '#9a5a4a'),
    colored(new THREE.SphereGeometry(.24, 8, 6).translate(0, 1.75, 0), '#d9c98e'), colored(new THREE.ConeGeometry(.42, .3, 8).translate(0, 1.95, 0), '#c9b478')];
  const m = new THREE.Mesh(mergeGeometries(out), mat); for (const q of out) q.dispose(); return m; }
const farmers = [];
for (const f of world.farmers) { const fm = mkFarmer(f.tool), x = X(f.i), z = Z(f.j); fm.g.position.set(x, hAt(x, z), z); fm.g.rotation.y = f.phase; scene.add(fm.g);
  farmers.push({ ...fm, phase: f.phase, k: idx(Math.floor(f.i), Math.floor(f.j)) }); }
for (const ch of treeChunks.values()) buildTreeChunk(ch);
const winGeo = new THREE.PlaneGeometry(.5, .62);
const glassMat = new THREE.MeshLambertMaterial({ color: '#8fb2c0', emissive: '#000000', side: THREE.DoubleSide });
const glassMat2 = new THREE.MeshLambertMaterial({ color: '#7fa0ae', side: THREE.DoubleSide });
function inst(list, m) { const im = new THREE.InstancedMesh(winGeo, m, list.length); list.forEach((mx, k) => im.setMatrixAt(k, mx)); scene.add(im); return im; }
inst(glassLit, glassMat); inst(glassDark, glassMat2);
for (const { b, faces } of signs) { const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d'); x.fillStyle = (b.i * 7 + b.j) % 3 ? '#2b3a4a' : '#7a2a1f'; x.fillRect(0, 0, 256, 48); x.fillStyle = '#f2e6c8'; x.font = 'bold 30px Georgia'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(b.name, 128, 26);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; const f = faces[b.front], L = f.len * TS; const [px, py, pz] = f.at(L / 2, FH + .25);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(L * .9, 3.2), .55), new THREE.MeshBasicMaterial({ map: tex })); m.position.set(px, py, pz); m.rotation.y = f.rot; m.position.x += Math.sin(f.rot) * .03; m.position.z += Math.cos(f.rot) * .03; scene.add(m); }
const headMat = new THREE.MeshBasicMaterial({ color: '#f0e6c8' });
const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(.13, 8, 6), headMat, lampHeads.length); lampHeads.forEach((p, k) => heads.setMatrixAt(k, new THREE.Matrix4().setPosition(p))); scene.add(heads);
const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,220,140,.9)'); gr.addColorStop(.4, 'rgba(255,200,120,.35)'); gr.addColorStop(1, 'rgba(255,200,120,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
for (const p of lampHeads) { const s = new THREE.Sprite(glowMat); s.position.copy(p); s.scale.set(5, 5, 1); scene.add(s); }

// ================= СТИЛЛЫ (перегонные кубы у ручьёв) =================
// Технология 1920-х: медный котёл на каменном очаге, «thump keg» (бочонок-отстойник), медный змеевик «worm»
// в бочке, через которую течёт вода ручья. Чем сильнее поток — тем быстрее гонится.
const stillMeshes = [];
const smokeMat = new THREE.SpriteMaterial({ map: glowTex, color: '#ffffff', transparent: true, opacity: .35, depthWrite: false });
const fireMat = new THREE.SpriteMaterial({ map: glowTex, color: '#ff9a3a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
// Шаги сборки аппарата (технология 1920-х). Каждый шаг — свои материалы и своя деталь на сцене.
const BUILD_STEPS = [
  { key: 'furnace', name: 'Каменный очаг', need: { stone: 6 }, hours: 1.5 },
  { key: 'pot', name: 'Медный котёл на очаг', need: { pot: 1 }, hours: .5 },
  { key: 'thump', name: 'Thump keg — бочонок-отстойник', need: { barrel: 1 }, hours: .7 },
  { key: 'worm', name: 'Бочка со змеевиком в ручье', need: { barrel: 1, worm: 1 }, hours: 1 },
  { key: 'trough', name: 'Жёлоб для воды из ручья', need: { planks: 2 }, hours: .5 },
  { key: 'mash', name: 'Бродильная бочка', need: { barrel: 1 }, hours: .5 },
];
for (const s of world.stills) {
  const x = X(s.i), z = Z(s.j), y = hAt(x, z); const g = new THREE.Group(); g.position.set(x, y, z);
  s.step = 0; s.stage = 'build';
  const m = (geo, c, px, py, pz, parent = g) => { const mm = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: c })); mm.position.set(px, py, pz); mm.castShadow = true; parent.add(mm); return mm; };
  const ring = m(new THREE.TorusGeometry(.5, .12, 6, 12).rotateX(Math.PI / 2), '#8a8078', 0, .08, 0); // примятая поляна: кольцо камней от старого костра
  const parts = {};
  const grp = k => { const gg = new THREE.Group(); gg.visible = false; g.add(gg); parts[k] = gg; return gg; };
  let P = grp('furnace'); m(new THREE.CylinderGeometry(.55, .5, .35, 10), '#6a625a', 0, .18, 0, P); for (let k = 0; k < 6; k++) m(new THREE.DodecahedronGeometry(.16, 0), '#7d766e', Math.cos(k) * .5, .1, Math.sin(k) * .5, P);
  P = grp('pot'); m(new THREE.CylinderGeometry(.42, .5, .8, 12), '#c8873f', 0, .75, 0, P); m(new THREE.SphereGeometry(.42, 12, 8), '#c8873f', 0, 1.15, 0, P); m(new THREE.CylinderGeometry(.12, .16, .5, 8), '#c8873f', 0, 1.7, 0, P);
  P = grp('thump'); m(new THREE.CylinderGeometry(.3, .3, .8, 10), '#7a5a3a', 1.2, .4, 0, P); m(new THREE.CylinderGeometry(.06, .06, 1.2, 6).rotateZ(Math.PI / 2), '#c8873f', .6, 1.85, 0, P); m(new THREE.CylinderGeometry(.06, .06, 1, 6), '#c8873f', 1.2, 1.3, 0, P);
  P = grp('worm'); m(new THREE.CylinderGeometry(.42, .42, .9, 12), '#8a6a4a', 2.2, .45, 0, P); m(new THREE.TorusGeometry(.25, .04, 5, 12), '#c8873f', 2.2, .95, 0, P); m(new THREE.CylinderGeometry(.06, .06, .8, 6).rotateZ(Math.PI / 2), '#c8873f', 1.7, 1.2, 0, P); m(new THREE.CylinderGeometry(.04, .04, .5, 6).rotateX(Math.PI / 3), '#c8873f', 2.55, .35, .25, P);
  P = grp('trough'); m(new THREE.BoxGeometry(.5, .2, 1.6), '#6a5a4a', 2.4, .55, -1.0, P); m(new THREE.BoxGeometry(.1, .6, .1), '#5a4a3a', 2.4, .3, -1.7, P);
  P = grp('mash'); const barrel = m(new THREE.CylinderGeometry(.35, .35, .75, 10), '#7a5a3a', -1.3, .38, -.3, P);
  P = grp('jugs'); for (let k = 0; k < 3; k++) m(new THREE.CylinderGeometry(.22, .22, .5, 8), '#a08050', -1.1 + k * .45, .25, .9, P);
  P = grp('wood'); m(new THREE.BoxGeometry(.9, .3, .5), '#7a5a3a', -1.2, .15, 1.6, P);
  const fire = new THREE.Sprite(fireMat.clone()); fire.position.set(0, .45, 0); fire.scale.set(1.6, 1.6, 1); g.add(fire);
  const smokes = []; for (let k = 0; k < 4; k++) { const sm = new THREE.Sprite(smokeMat.clone()); sm.position.set(0, 2, 0); sm.userData = { t: k / 4 }; sm.visible = false; g.add(sm); smokes.push(sm); }
  const glow = new THREE.Sprite(glowMat); glow.position.set(0, .8, 0); glow.scale.set(4, 4, 1); glow.visible = false; g.add(glow);
  scene.add(g); stillMeshes.push({ s, g, parts, ring, fire, smokes, glow, barrel });
}
// вывеска-подсказка у бильярдной = спикизи
const speak = world.speakeasy;

// ================= ЛИСТВА =================
const LEAF_N = 420; const leafGeo = new THREE.PlaneGeometry(.22, .16);
const leafMesh = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, vertexColors: false }), LEAF_N);
const leaves = []; const leafCols = ['#e0a04a', '#d8783a', '#c9b24e', '#b85a3a', '#e6c65a'];
for (let k = 0; k < LEAF_N; k++) { leaves.push({ p: new THREE.Vector3(), v: 0, ph: Math.random() * 6.28, rot: Math.random() * 6.28, live: false }); leafMesh.setColorAt(k, new THREE.Color(leafCols[k % leafCols.length])); }
leafMesh.instanceColor.needsUpdate = true; scene.add(leafMesh);
const leafM = new THREE.Matrix4(), leafQ = new THREE.Quaternion(), leafE = new THREE.Euler(), leafS = new THREE.Vector3(1, 1, 1);
function spawnLeaf(l, around) { const a = Math.random() * 6.28, r = 6 + Math.random() * 26; l.p.set(around.x + Math.cos(a) * r, around.y + 6 + Math.random() * 8, around.z + Math.sin(a) * r); l.v = .8 + Math.random() * .9; l.live = true;
  const i = Math.floor(l.p.x / TS), j = Math.floor(l.p.z / TS); if (!inb(i, j) || (world.tiles[idx(i, j)] != T.FOREST && Math.random() < .8)) l.live = false; }
function updateLeaves(dt, around, t) {
  for (let k = 0; k < LEAF_N; k++) { const l = leaves[k];
    if (!l.live) { if (Math.random() < .03) spawnLeaf(l, around); if (!l.live) { leafM.makeScale(0, 0, 0); leafMesh.setMatrixAt(k, leafM); continue; } }
    l.p.y -= l.v * dt; l.p.x += Math.sin(t * 1.7 + l.ph) * .9 * dt + .35 * dt; l.p.z += Math.cos(t * 1.3 + l.ph) * .7 * dt; l.rot += dt * 2.5;
    if (l.p.y < hAt(l.p.x, l.p.z) + .05 || l.p.distanceTo(around) > 40) { l.live = false; continue; }
    leafE.set(l.rot, l.ph + t * .6, l.rot * .5); leafQ.setFromEuler(leafE); leafM.compose(l.p, leafQ, leafS); leafMesh.setMatrixAt(k, leafM); }
  leafMesh.instanceMatrix.needsUpdate = true;
}

// ================= ПЕРСОНАЖ И МАШИНА =================
function lamb(c) { return new THREE.MeshLambertMaterial({ color: c }); }
const SKIN = {
  shiner: { legs: '#3a4a6a', torso: '#5a6a8a', shirt: '#c9a56b', arms: '#c9a56b', hat: '#6b4a2a', car: '#2b2b2b' },
  law:    { legs: '#242c3c', torso: '#2d3a52', shirt: '#dfe4ee', arms: '#2d3a52', hat: '#1b2233', car: '#141c2b' },
};
function mkPlayer(role = 'shiner') {
  const c = SKIN[role] || SKIN.shiner, g = new THREE.Group();
  const mesh = (geo, col, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, lamb(col)); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  // руки и ноги — капсулы, подвешенные к шарниру у бедра и плеча: шаг выглядит как шаг, а не как качание бруска
  const limb = (x, y, r, len, col) => { const pivot = new THREE.Group(); pivot.position.set(x, y, 0); g.add(pivot); mesh(new THREE.CapsuleGeometry(r, len, 4, 10), col, 0, -(len / 2 + r), 0, pivot); return pivot; };
  const lL = limb(-.11, .5, .085, .3, c.legs), lR = limb(.11, .5, .085, .3, c.legs);
  mesh(new RoundedBoxGeometry(.46, .5, .28, 3, .11), c.torso, 0, .76, 0);
  mesh(new RoundedBoxGeometry(.5, .2, .3, 3, .09), c.shirt, 0, .98, 0);
  const aL = limb(-.31, 1.02, .065, .34, c.arms), aR = limb(.31, 1.02, .065, .34, c.arms);
  mesh(new THREE.SphereGeometry(.17, 18, 14), '#e8c39e', 0, 1.27, 0);
  mesh(new THREE.CylinderGeometry(.27, .27, .04, 24), c.hat, 0, 1.43, 0);          // поля шляпы
  mesh(new THREE.CylinderGeometry(.14, .17, .17, 18), c.hat, 0, 1.53, 0);          // тулья
  if (role === 'law') { const star = mesh(new THREE.CylinderGeometry(.055, .055, .02, 5), '#e8c24a', -.13, .9, .15); star.rotation.x = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(.19, .2, .06, 20), '#0e141f', 0, 1.46, 0); }                 // звезда и околыш фуражки
  g.userData = { lL, lR, aL, aR }; return g;
}
// Машины по кузовам. Перед машины — по +X, ось колёс — по Z. mkCar('#цвет') — старый вызов, это Model T.
const BODY = {
  sedan: { len: 2.3, cabL: 1.05, cabH: .74, hood: .84, wheel: .31, track: .56 },
  coupe: { len: 2.6, cabL: .9,  cabH: .6,  hood: 1.1, wheel: .33, track: .58 },
  long:  { len: 2.8, cabL: 1.35, cabH: .76, hood: 1.0, wheel: .33, track: .6 },
  limo:  { len: 3.2, cabL: 1.5, cabH: .82, hood: 1.25, wheel: .35, track: .62 },
  truck: { len: 3.1, cabL: .95, cabH: .8,  hood: .8,  wheel: .38, track: .64 },
  panel: { len: 2.9, cabL: .9,  cabH: .8,  hood: .78, wheel: .34, track: .6 },
};
function mkCar(kind = 'model_t', colorOverride) {
  let model = kind; if (typeof kind === 'string' && kind[0] === '#') { colorOverride = kind; model = 'model_t'; }
  const spec = CARS[model] || CARS.model_t, B = BODY[spec.body] || BODY.sedan, color = colorOverride || spec.color;
  const g = new THREE.Group();
  const mesh = (geo, c, x, y, z) => { const m = new THREE.Mesh(geo, lamb(c)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const L = B.len, front = L / 2, W = B.track * 1.8, chrome = '#b8b4a8';
  mesh(new RoundedBoxGeometry(L, .32, W, 4, .14), color, 0, .58, 0);                                              // рама с подножками
  const hoodX = front - B.hood / 2 - .08;
  mesh(new RoundedBoxGeometry(B.hood, .42, W * .82, 4, .18), color, hoodX, .86, 0);                             // капот
  mesh(new RoundedBoxGeometry(.1, .5, W * .5, 3, .04), spec.body === 'limo' || spec.body === 'long' ? chrome : '#3a3a3a', front - .02, .9, 0);   // решётка
  const cabX = hoodX - B.hood / 2 - B.cabL / 2 + .02;
  mesh(new RoundedBoxGeometry(B.cabL, B.cabH, W * .92, 4, .2), color, cabX, .75 + B.cabH / 2, 0);             // кабина
  mesh(new RoundedBoxGeometry(B.cabL + .08, .09, W * .98, 3, .045), '#222', cabX, .78 + B.cabH, 0);             // крыша
  mesh(new RoundedBoxGeometry(.05, B.cabH * .7, W * .8, 2, .02), '#8fb2c0', cabX + B.cabL / 2 + .01, .8 + B.cabH * .5, 0);   // лобовое стекло
  const rearX = cabX - B.cabL / 2, rearLen = rearX + L / 2;
  if (spec.body === 'truck') {   // грузовая платформа с дощатыми бортами
    mesh(new RoundedBoxGeometry(rearLen, .12, W * 1.02, 2, .03), '#6a5038', rearX - rearLen / 2, .82, 0);
    for (const z of [-W * .5, W * .5]) mesh(new RoundedBoxGeometry(rearLen, .38, .06, 2, .02), '#7a5a3a', rearX - rearLen / 2, 1.07, z);
    mesh(new RoundedBoxGeometry(.06, .38, W, 2, .02), '#7a5a3a', -L / 2 + .03, 1.07, 0);
  } else if (spec.body === 'panel') {   // закрытый кузов-фургон: груз не видно
    mesh(new RoundedBoxGeometry(rearLen, 1.05, W * .98, 4, .16), color, rearX - rearLen / 2, 1.22, 0);
    mesh(new RoundedBoxGeometry(rearLen * .7, .3, .02, 2, .01), '#e8dfcf', rearX - rearLen / 2, 1.3, W * .5);
  } else {                               // легковой: багажник и запаска
    mesh(new RoundedBoxGeometry(Math.max(.3, rearLen - .05), .46, W * .88, 4, .2), color, rearX - rearLen / 2 + .02, .9, 0);
    const spare = mesh(new THREE.TorusGeometry(B.wheel * .85, .08, 8, 20), '#222', -L / 2 - .05, .92, 0); spare.rotation.y = Math.PI / 2;
  }
  const axles = spec.body === 'truck' ? [front - .55, -L / 2 + .6, -L / 2 + 1.05] : [front - .55, -L / 2 + .55];
  for (const x of axles) for (const z of [-B.track, B.track]) {
    const w = mesh(new THREE.CylinderGeometry(B.wheel, B.wheel, .18, 22), '#222', x, B.wheel + .01, z); w.rotation.x = Math.PI / 2;
    const hub = mesh(new THREE.CylinderGeometry(B.wheel * .35, B.wheel * .35, .2, 14), spec.body === 'limo' ? '#e8e4da' : '#8a8a82', x, B.wheel + .01, z); hub.rotation.x = Math.PI / 2;
    if (spec.body === 'limo') { const ww = mesh(new THREE.TorusGeometry(B.wheel * .72, .045, 6, 22), '#f2efe6', x, B.wheel + .01, z + Math.sign(z) * .09); }   // белые боковины
    mesh(new THREE.TorusGeometry(B.wheel + .07, .07, 8, 22, Math.PI), color, x, B.wheel + .03, z);             // крыло над колесом
  }
  const hl = []; for (const z of [-W * .36, W * .36]) hl.push(mesh(new THREE.SphereGeometry(.1, 14, 10), '#fff8d0', front - .05, .98, z));
  const spot = new THREE.SpotLight('#ffe9b0', 0, 18, .6, .5, 1); spot.position.set(front, .9, 0); spot.target.position.set(front + 7, 0, 0); g.add(spot); g.add(spot.target);
  g.userData = { hl, spot, model }; return g;
}
const player = { pos: new THREE.Vector3(X(world.start.i), 0, Z(world.start.j)), mesh: mkPlayer(), yaw: 0, t: 0, inCar: false };
scene.add(player.mesh);
const car = { pos: new THREE.Vector3(X(world.carStart.i), 0, Z(world.carStart.j)), yaw: 0, speed: 0, mesh: mkCar('model_t'), cap: 30, model: 'model_t' }; scene.add(car.mesh);
const ai = [];
{ const mainI = []; for (let i = 0; i < W; i++) { const t = world.tiles[idx(i, CJ)]; if (t == T.MAIN) mainI.push(i); }
  ai.push({ mesh: mkCar('#5a3a2a'), fixed: Z(CJ - .3), from: X(mainI[0] + 1), to: X(mainI[mainI.length - 1]), t: .2, v: .03 });
  ai.push({ mesh: mkCar('#1f2a3a'), fixed: Z(CJ + 1.8), from: X(mainI[0] + 1), to: X(mainI[mainI.length - 1]), t: .7, v: -.035 });
  for (const a of ai) scene.add(a.mesh); }

// ================= ЭКОНОМИКА (минимальная петля) =================
const eco = { cash: 0, jugs: 0, carJugs: 0 };
// ================= СЕТЬ (общий мир на всех) =================
const myName = (() => { const q = new URLSearchParams(location.search).get('name'); if (q) { localStorage.setItem('moon_name', q); return q; } let n = localStorage.getItem('moon_name'); if (!n) { n = 'Bootlegger' + Math.floor(100 + Math.random() * 900); localStorage.setItem('moon_name', n); } return n; })();
// ---- РОЛЬ. Самогонщик гонит и заметает следы, закон ищет улики и рубит кубы.
const qRole = new URLSearchParams(location.search).get('role');
let myRole = (qRole === 'law' || qRole === 'shiner') ? qRole : (localStorage.getItem('moon_role') || null);
const roleTitle = r => r === 'law' ? 'Федеральный агент' : 'Самогонщик';
function setRole(r, tell) {
  if (r !== 'law' && r !== 'shiner') return;
  const changed = myRole !== r; myRole = r; localStorage.setItem('moon_role', r);
  if (changed || !player.mesh.userData.role) {
    const vis = player.mesh.visible; scene.remove(player.mesh); player.mesh = mkPlayer(r); player.mesh.userData.role = r; player.mesh.visible = vis; scene.add(player.mesh);
    rebuildCar(eco.vehicle ? eco.vehicle.model : (r === 'law' ? 'police_a' : 'model_t'), true);
  }
  const bf = document.getElementById('btnF'); if (bf) bf.textContent = r === 'law' ? 'Осмотр' : 'Замести';
  const ov = document.getElementById('roleOverlay'); if (ov) ov.style.display = 'none';
  if (tell) net.send({ t: 'role', role: r });
}
let myId = null, netTime = 6.5, netDay = 1, heat = 0;
const remote = new Map(); // id -> { walk, car, buf: снимки с сервера, disp: что рисуем сейчас, inCar, name }
const REMOTE_COLORS = ['#7a3a3a', '#3a5a7a', '#5a7a3a', '#7a5a2a', '#5a3a7a', '#2a6a6a'];
function mergeStills(list) { for (const it of list) { const s = world.stills.find(x => x.id === it.id); if (s) Object.assign(s, { step: it.step, stage: it.stage, mash: it.mash, gallons: it.gallons }); } }
function ensureRemote(id, name, role) { let r = remote.get(id);
  if (r && r.role !== role) { scene.remove(r.walk); scene.remove(r.car); remote.delete(id); r = null; }   // сменил сторону — переодеваем
  if (!r) { const col = role === 'law' ? SKIN.law.car : REMOTE_COLORS[id % REMOTE_COLORS.length]; const walk = mkPlayer(role); const carM = mkCar(col); carM.visible = false; scene.add(walk); scene.add(carM);
    const cnv = document.createElement('canvas'); cnv.width = 128; cnv.height = 32; const cx = cnv.getContext('2d'); cx.fillStyle = 'rgba(30,20,10,.75)'; cx.fillRect(0, 4, 128, 22); cx.fillStyle = '#f2e6c8'; cx.font = 'bold 16px Georgia'; cx.textAlign = 'center'; cx.fillText(name, 64, 20);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cnv), depthTest: false })); tag.scale.set(2, .5, 1); tag.position.y = 2.6; walk.add(tag);
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#8fdcff', transparent: true, opacity: 0, depthTest: false })); ring.scale.set(1.3, 1.3, 1); ring.position.y = 3.05; ring.visible = false; walk.add(ring);   // горит, когда игрок говорит
    r = { walk, car: carM, inCar: false, name, role, buf: [], disp: null, phase: 0, ring, voice: 0, voiceOn: false }; remote.set(id, r); }
  return r; }
function applyPlayers(list, now, full = true) { const seen = new Set(), t = now || serverNow();
  for (const p of list) { if (p.id === myId) continue; seen.add(p.id); const r = ensureRemote(p.id, p.name, p.role);
    const last = r.buf[r.buf.length - 1];
    if (!last || t > last.t) { r.buf.push({ t, x: p.x, z: p.z, yaw: p.yaw, vx: p.vx || 0, vz: p.vz || 0 }); if (r.buf.length > 24) r.buf.shift(); }
    if (!r.disp) r.disp = { x: p.x, z: p.z, yaw: p.yaw };
    r.inCar = p.inCar; r.voiceOn = !!p.voice;
    if (p.car && r.carModel !== p.car) { const vis = r.car.visible; scene.remove(r.car); r.car = mkCar(p.car); r.car.visible = vis; scene.add(r.car); r.carModel = p.car; } }
  // частичные пакеты (только ближние) не удаляют дальних — удаляем лишь по полному списку
  if (full !== false) for (const [id, r] of remote) if (!seen.has(id)) { scene.remove(r.walk); scene.remove(r.car); remote.delete(id); } }
// ---- СЕТЕВОЕ ДВИЖЕНИЕ. Чужих рисуем с отставанием ~120 мс между двумя известными точками — движение
// гладкое при любом дрожании пакетов. Если пакеты перестали приходить, персонаж продолжает идти или ехать
// по последней скорости и плавно тормозит за полторы секунды: никаких рывков и замираний на месте.
let clockOffset = 0, clockSynced = false, rtt = 0;
const serverNow = () => Date.now() + clockOffset;
const INTERP_MS = 120, EXTRAP_FULL = 1, EXTRAP_STOP = 2, GAP_MS = 300;
const lerpAngle = (a, b, k) => { let d = b - a; d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * k; };
// досчёт по последней скорости: секунду идёт как шёл, следующую секунду плавно останавливается (путь = интеграл скорости)
function extrapolate(p, t) {
  const dt = Math.max(0, Math.min(EXTRAP_STOP, (t - p.t) / 1000)), span = EXTRAP_STOP - EXTRAP_FULL;
  const eff = dt <= EXTRAP_FULL ? dt : EXTRAP_FULL + (dt - EXTRAP_FULL) - (dt - EXTRAP_FULL) ** 2 / (2 * span);
  const fade = dt <= EXTRAP_FULL ? 1 : Math.max(0, 1 - (dt - EXTRAP_FULL) / span);
  return { x: p.x + p.vx * eff, z: p.z + p.vz * eff, yaw: p.yaw, vx: p.vx * fade, vz: p.vz * fade, stale: dt };
}
function sampleRemote(r, t) {
  const b = r.buf; if (!b.length) return null;
  if (t <= b[0].t) return { ...b[0], stale: 0 };
  for (let q = b.length - 1; q > 0; q--) { const a = b[q - 1], c = b[q];
    if (t >= a.t && t <= c.t) {
      // между пакетами дыра (обрыв): не тянем по хорде назад, а продолжаем досчёт — расхождение уберёт followDisplay
      if (c.t - a.t > GAP_MS) return extrapolate(a, t);
      const k = (t - a.t) / Math.max(1, c.t - a.t); return { x: a.x + (c.x - a.x) * k, z: a.z + (c.z - a.z) * k, yaw: lerpAngle(a.yaw, c.yaw, k), vx: c.vx, vz: c.vz, stale: 0 }; } }
  return extrapolate(b[b.length - 1], t);
}
// Показ ведём скоростью персонажа, а расхождение с расчётом (после обрыва досчёт разошёлся с правдой)
// убираем не быстрее 2 м/с + ¾ его собственной скорости — видно, как он «доворачивает», но не прыгает.
function followDisplay(disp, s, dt) {
  dt = Math.min(dt, .1);
  if (Math.hypot(s.x - disp.x, s.z - disp.z) > 25) { disp.x = s.x; disp.z = s.z; disp.yaw = s.yaw; return; }   // вход в здание, респаун — честный прыжок
  disp.x += s.vx * dt; disp.z += s.vz * dt;
  const ex = s.x - disp.x, ez = s.z - disp.z, err = Math.hypot(ex, ez);
  if (err > 1e-4) { const speed = Math.hypot(s.vx, s.vz), step = Math.min(err * Math.min(1, dt * 4), (2 + speed * .75) * dt) / err; disp.x += ex * step; disp.z += ez * step; }
  disp.yaw = lerpAngle(disp.yaw, s.yaw, Math.min(1, dt * 12));
}
function renderRemotes(realDt) {
  const t = serverNow() - INTERP_MS - Math.min(150, rtt * .5);
  for (const r of remote.values()) { const s = sampleRemote(r, t); if (!s || !r.disp) continue;
    followDisplay(r.disp, s, realDt);
    r.walk.visible = !r.inCar; r.car.visible = r.inCar; const m = r.inCar ? r.car : r.walk;
    m.position.set(r.disp.x, hAt(r.disp.x, r.disp.z), r.disp.z); m.rotation.y = r.disp.yaw;
    const speed = Math.hypot(s.vx, s.vz), u = r.walk.userData;
    if (!r.inCar && u.lL) { r.phase += realDt * Math.min(14, speed * 2.2); const sw = speed > .3 ? Math.sin(r.phase) * Math.min(.7, speed * .15) : 0; u.lL.rotation.x = sw; u.lR.rotation.x = -sw; u.aL.rotation.x = -sw; u.aR.rotation.x = sw; }
    r.ring.visible = r.voice > .02; r.ring.material.opacity = Math.min(.9, r.voice * 7); }
}
// свою позицию шлём 15 раз в секунду вместе со скоростью в реальном времени (зум ускоряет ход — скорость это учтёт)
let sendAcc = 0, lastPos = null; const velS = { x: 0, z: 0 };
function sendMove(realDt) {
  // внутри заведения серверу шлём УЛИЧНЫЕ координаты: остальные видят нас у двери, досмотр работает по месту
  const p = interior ? interior.ret : (player.inCar ? car.pos : player.pos), y = player.inCar ? car.yaw : player.yaw;
  if (lastPos && realDt > 0) { const vx = (p.x - lastPos.x) / realDt, vz = (p.z - lastPos.z) / realDt, k = Math.min(1, realDt * 10);
    if (Math.hypot(vx, vz) < 60) { velS.x += (vx - velS.x) * k; velS.z += (vz - velS.z) * k; } else { velS.x = 0; velS.z = 0; } }
  lastPos = { x: p.x, z: p.z };
  sendAcc += realDt; if (sendAcc < 1 / 15) return; sendAcc = 0;
  net.send({ t: 'move', x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +y.toFixed(3), vx: +velS.x.toFixed(2), vz: +velS.z.toFixed(2), inCar: !interior && player.inCar });
}
const net = connect(myName, myRole || 'shiner');
let evidence = [], cases = {};
net.on('welcome', msg => { myId = msg.id; netTime = msg.time; netDay = msg.day; heat = msg.heat; eco.cash = msg.cash; Object.assign(inv, msg.inv); eco.jugs = msg.jugs; eco.carJugs = msg.carJugs; eco.busted = msg.busted; eco.caught = msg.caught; mergeStills(msg.stills); applyPlayers(msg.players, msg.now); setRole(msg.role); });
net.on('you', msg => { eco.cash = msg.cash; Object.assign(inv, msg.inv); eco.jugs = msg.jugs; eco.carJugs = msg.carJugs; eco.busted = msg.busted; eco.caught = msg.caught; if (msg.role) setRole(msg.role); });
net.on('evidence', msg => { evidence = msg.list; cases = msg.cases || {}; syncEvidence(); });
// ---- экономика: гараж игрока, кредит, розыск и цены города приходят с сервера
let catalog = null, market = null, vehKey = '';
function rebuildCar(model, force) { if (!force && car.model === model && car.mesh) return;
  const vis = car.mesh ? car.mesh.visible : true; if (car.mesh) scene.remove(car.mesh);
  car.model = model; car.mesh = mkCar(model); car.mesh.visible = vis; car.cap = CARS[model].cap; scene.add(car.mesh); applyTime(); }
function applyEcon(msg) {
  for (const k of ['cars', 'activeCar', 'vehicle', 'loan', 'loanLimit', 'wanted', 'room', 'stash', 'workLeft', 'coffee', 'taxDebt']) if (k in msg) eco[k] = msg[k];
  if (msg.catalog) catalog = msg.catalog;
  const v = eco.vehicle, key = v ? `${v.model}|${v.rented}|${eco.activeCar}` : 'none';
  if (key === vehKey) return; const first = !vehKey; vehKey = key;
  if (!v) { if (player.inCar) { player.inCar = false; player.mesh.visible = true; player.pos.set(car.pos.x + 1.5, 0, car.pos.z + 1.5); } car.mesh.visible = false; return; }
  rebuildCar(v.model); car.mesh.visible = true;
  // новая, арендованная или сменённая машина подъезжает к игроку (к дверям, если он внутри)
  if (!first) { const o = interior ? interior.ret : player.pos; car.pos.set(o.x + 2.6, 0, o.z + 2.6); car.speed = 0; }
}
net.on('welcome', applyEcon); net.on('you', applyEcon);
net.on('car', msg => { eco.vehicle = msg.vehicle; });
net.on('econ', msg => { catalog = msg.catalog; });
net.on('market', msg => { market = msg; shopSig = ''; });
// часы сервера: смещение по пингу, чтобы все клиенты рисовали чужих в одном и том же моменте времени
net.on('welcome', msg => { if (msg.now) { clockOffset = msg.now - Date.now(); clockSynced = true; } });
net.on('pong', msg => { const nowC = Date.now(), r = nowC - msg.c; rtt = rtt ? rtt * .8 + r * .2 : r; const off = msg.s + r / 2 - nowC; clockOffset = clockSynced ? clockOffset * .8 + off * .2 : off; clockSynced = true; });
setInterval(() => { if (net.connected) net.send({ t: 'ping', c: Date.now() }); }, 2000);
// ---- голос рядом (voice.js): кого слышим — по позициям на карте, говорящих подсвечиваем
const voice = createVoice({ net, myId: () => myId,
  me: () => { const p = interior ? interior.ret : (player.inCar ? car.pos : player.pos); return { x: p.x, z: p.z }; },
  peers: () => [...remote.entries()].filter(([, r]) => r.disp && r.voiceOn).map(([id, r]) => ({ id, x: r.disp.x, z: r.disp.z })),
  onLevel: (id, lvl) => { const r = remote.get(id); if (r) r.voice = lvl; },
  onMyLevel: lvl => { const b = document.getElementById('voiceBtn'); if (b) b.style.boxShadow = lvl > .03 ? `0 0 0 ${Math.round(2 + lvl * 30)}px rgba(201,111,79,.45)` : 'none'; },
  onStatus: text => { const b = document.getElementById('voiceBtn'); if (b) b.textContent = text; } });
net.on('welcome', msg => { if (msg.fire) applyChanges(fire, msg.fire, 0); if (msg.wind) wind = msg.wind; if (msg.hp) hp = msg.hp; });
net.on('fire', msg => applyChanges(fire, msg.c, 0));
net.on('world', msg => { if (msg.wind) wind = msg.wind; });
net.on('hp', msg => { hp = msg.hp; hurt = msg.dmg || 0; });
net.on('burned', msg => burnedTo(msg.x, msg.z, msg.text));
net.on('stills', msg => mergeStills(msg.list));
net.on('players', msg => applyPlayers(msg.list, msg.now, msg.full));
net.on('world', msg => { netTime = msg.time; netDay = msg.day; heat = msg.heat; });
net.on('msg', msg => say(msg.text));
let offline = false; let welcomed = false;
net.on('welcome', () => { welcomed = true; });
setTimeout(() => { if (!welcomed) { offline = true; eco.cash = 120; say('Сервер недоступен — играем в одиночном режиме (без общего мира)'); } }, 2500);

const inv = { copper: 0, pot: 0, worm: 0, barrel: 0, planks: 0, stone: 0, wood: 0, corn: 0, cornmeal: 0, sugar: 0, yeast: 0, kerosene: 0 }; // зеркало серверного инвентаря — сюда пишут только сообщения 'you'/'welcome'
const ITEM = { copper: 'медный лист', pot: 'медный котёл', worm: 'змеевик', barrel: 'бочка', planks: 'доски', stone: 'камень', wood: 'дрова', corn: 'кукуруза', cornmeal: 'кукурузная мука', sugar: 'сахар', yeast: 'дрожжи', kerosene: 'керосин' };
const HEAVY = new Set(['copper', 'pot', 'worm', 'barrel', 'planks', 'stone']);
const SHOPS = { 'HARDWARE': [['copper', 6], ['kerosene', 3]], 'GROCERY': [['sugar', 2], ['yeast', 1]], 'FEED & SEED': [['corn', 1.5], ['barrel', 4]], 'Мельница': [['planks', 2]] };
const MASH_NEED = { cornmeal: 2, sugar: 2, yeast: 1 }, RUN_WOOD = 3;
const SELL_PRICE = 5, WALK_CAP = 2;
const FERMENT_H = 30, RUN_H = 6;
let work = null; // { name, left, total, done } — игрок занят делом, время идёт монтажом
function startWork(name, hours, done) { if (work) return; work = { name, left: hours, total: hours, done }; }
const carNear = (r = 6) => player.inCar || player.pos.distanceTo(car.pos) < r;
const has = need => Object.entries(need).every(([k, n]) => inv[k] >= n);
const missing = need => Object.entries(need).filter(([k, n]) => inv[k] < n).map(([k, n]) => `${ITEM[k]} ${inv[k]}/${n}`).join(', ');
const spend = need => { for (const [k, n] of Object.entries(need)) inv[k] -= n; };
const shopOpen = () => time >= 8 && time <= 18;

// ================= УЛИКИ (что видно на земле) =================
const EV_INFO = { smoke: 'дым над деревьями', tracks: 'колея', mash: 'выброшенная барда', jugs: 'пустые кувшины', ledger: 'запись о сахаре', kerosene: 'бутыль из-под керосина' };
const evMeshes = new Map();
function mkEvidence(e) {
  const g = new THREE.Group(); g.position.set(e.x, hAt(e.x, e.z), e.z);
  const rnd = ((e.id * 9301 + 49297) % 233280) / 233280;
  const add = (geo, col, x, y, z, op) => { const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col, transparent: op != null, opacity: op == null ? 1 : op })); m.position.set(x, y, z); g.add(m); return m; };
  if (e.type === 'tracks') { const t = new THREE.Group(); for (const off of [-.3, .3]) { const b = new THREE.Mesh(new THREE.BoxGeometry(3, .05, .22), new THREE.MeshLambertMaterial({ color: '#4a3a26', transparent: true, opacity: .85 })); b.position.set(0, .04, off); t.add(b); } t.rotation.y = rnd * 6.28; g.add(t); }
  else if (e.type === 'mash') { add(new THREE.ConeGeometry(.75, .5, 8), '#7a6033', 0, .22, 0); for (let k = 0; k < 3; k++) add(new THREE.SphereGeometry(.13, 6, 5), '#8d7343', Math.cos(k * 2 + rnd) * .9, .1, Math.sin(k * 2 + rnd) * .9); }
  else if (e.type === 'jugs') { for (let k = 0; k < 3; k++) { const j = add(new THREE.CylinderGeometry(.16, .18, .42, 8), '#9fb8a8', (k - 1) * .34, .21, rnd * .4); if (k === 2) j.rotation.z = 1.4; } }
  else if (e.type === 'ledger') { const b = add(new THREE.BoxGeometry(.55, .07, .4), '#efe8d4', 0, .9, 0); b.rotation.y = rnd * 3; }
  else if (e.type === 'kerosene') { const b = add(new THREE.CylinderGeometry(.14, .18, .5, 8), '#6d8a92', 0, .2, 0); b.rotation.z = 1.35; add(new THREE.CylinderGeometry(.05, .05, .16, 6), '#4a3a2a', .34, .2, 0).rotation.z = 1.35; }
  else if (e.type === 'smoke') { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#c4bfb6', transparent: true, opacity: .45, depthWrite: false })); sp.position.set(0, 3.4, 0); sp.scale.set(5, 5, 1); g.add(sp); }
  // булавка: сверху камеры сам след не разглядеть, нужен маркер
  const col = e.found ? '#4a90d9' : '#c0392b';
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 1.3, 4), new THREE.MeshBasicMaterial({ color: col })); stick.position.y = 1.4; g.add(stick);
  const head = new THREE.Mesh(new THREE.ConeGeometry(.24, .6, 6), new THREE.MeshBasicMaterial({ color: col })); head.rotation.x = Math.PI; head.position.y = 2.25; g.add(head);
  return g;
}
function syncEvidence() {
  const seen = new Set();
  for (const e of evidence) { seen.add(e.id); if (!evMeshes.has(e.id)) { const g = mkEvidence(e); scene.add(g); evMeshes.set(e.id, g); } }
  for (const [id, g] of evMeshes) if (!seen.has(id)) { scene.remove(g); evMeshes.delete(id); }
}

// ================= ИНТЕРЬЕРЫ ЗАВЕДЕНИЙ =================
// Комната стоит за краем карты: так она не мешает рельефу, а камера и свет работают как обычно.
const IN_ORIGIN = { x: -80, z: 60 };
let interior = null;
const ENTERABLE = [...new Set([...world.buildings.filter(b => b.business && b.name !== 'BILLIARDS').map(b => b.name), 'Мельница', 'Депо'])];
// Ближайшая дверь и расстояние до неё: расстояние нужно, чтобы E у припаркованной машины
// сажал в машину, а не затаскивал в лавку, когда та стоит вплотную к дверям.
function nearDoor() { const f = player.inCar ? car.pos : player.pos; let best = null;
  for (const n of ENTERABLE) { const b = nearBuilding(n, 5.5); if (!b) continue;
    const d = Math.hypot(X(b.i + b.w / 2) - f.x, Z(b.j + b.d / 2) - f.z); if (!best || d < best.d) best = { name: n, d }; }
  if (!best && nearSpeak()) best = { name: 'BILLIARDS', d: 0 };
  return best; }
// своя машина рядом и в неё можно сесть
function carBoardable() { return !player.inCar && car.mesh.visible && (offline || eco.vehicle) && player.pos.distanceTo(car.pos) < 3; }
function enterShop(name) {
  if (player.inCar) return say('Сначала выйди из машины');
  if (interior) return;
  const b = buildInterior(name); b.group.position.set(IN_ORIGIN.x, 0, IN_ORIGIN.z); scene.add(b.group);
  // шоурум: в зале стоят машины салона (или парк конторы проката), обходить их надо, как в жизни
  if (PLACES[name] && PLACES[name].showroom) { const models = DEALERS[name] ? dealerModels(name) : ['model_t', 'model_a', 'model_aa'], spots = [[-4.6, 1.0], [.4, 1.0], [5.0, 1.0], [-2.6, 3.7], [2.2, 3.7]];
    models.slice(0, spots.length).forEach((id, q) => { const m = mkCar(id), [x, z] = spots[q]; m.remove(m.userData.spot); m.remove(m.userData.spot.target); m.position.set(x, 0, z); b.group.add(m);
      const L = (BODY[CARS[id].body] || BODY.sedan).len; b.colliders.push({ x0: x - L / 2, x1: x + L / 2, z0: z - .95, z1: z + .95 }); }); }
  if (name === 'CAR RENTAL' && !offline) net.send({ t: 'biz', place: name, act: 'market' });
  interior = Object.assign({ name, ret: { x: player.pos.x, z: player.pos.z } }, b);
  player.pos.set(IN_ORIGIN.x + b.doorAt.x, 0, IN_ORIGIN.z + b.doorAt.z - 1.4); player.yaw = Math.PI;
  camTarget.copy(player.pos); shopSig = '';
  say(`${b.clerkName}: «${b.greet}»`);
}
function exitShop() { if (!interior) return; scene.remove(interior.group); player.pos.set(interior.ret.x, 0, interior.ret.z); camTarget.copy(player.pos); interior = null; document.getElementById('shop').style.display = 'none'; }
function interiorBlocked(x, z) { const lx = x - IN_ORIGIN.x, lz = z - IN_ORIGIN.z, b = interior.bounds;
  if (Math.abs(lx) > b.x || Math.abs(lz) > b.z) return true;
  for (const c of interior.colliders) if (lx > c.x0 && lx < c.x1 && lz > c.z0 && lz < c.z1) return true;
  return false; }
const atDoor = () => interior && Math.hypot(player.pos.x - (IN_ORIGIN.x + interior.doorAt.x), player.pos.z - (IN_ORIGIN.z + interior.doorAt.z)) < 2.2;
const atClerk = () => interior && Math.hypot(player.pos.x - (IN_ORIGIN.x + interior.clerkAt.x), player.pos.z - (IN_ORIGIN.z + interior.clerkAt.z)) < 3.2;
function interiorInteract() { if (atDoor()) return exitShop();
  if (atClerk()) return say(`${interior.clerkName}: «${interior.greet}»`);
  say('Подойди к прилавку — или к двери, чтобы выйти'); }

// Прилавок: покупки и местные работы одним списком, цифрами 1-5 или мышью/пальцем.
const BODY_RU = { sedan: 'седан', coupe: 'купе', long: 'длинный седан', limo: 'лимузин', truck: 'грузовик', panel: 'фургон' };
const money = v => '$' + (Math.round(v * 100) / 100).toFixed(Math.abs(v % 1) > .001 ? 2 : 0);
function bizSend(act, extra = {}) { if (offline) return say('Это работает только на общем сервере'); net.send({ t: 'biz', place: interior.name, act, ...extra }); }
function refreshMarket() { if (!offline) setTimeout(() => net.send({ t: 'biz', place: 'CAR RENTAL', act: 'market' }), 300); }
// Прилавок любого заведения: товары, машины, прокат, кредит, бензин, услуги и работа — одним списком.
function shopRows() {
  const name = interior.name, rows = [], cat = catalog, I = cat ? cat.I : 1, row = (label, run) => rows.push({ label, run });
  (SHOPS[name] || []).forEach(([k, p0], i) => row(`${ITEM[k]} — ${money(cat ? cat.goods[k] : p0)}`, () => buyFrom(name, i)));
  if (DEALERS[name]) {
    for (const id of dealerModels(name)) { const m = CARS[id];
      row(`${m.name} (${m.year}) — ${money(cat ? cat.cars[id].price : m.price)} · ${BODY_RU[m.body] || 'седан'} · багаж ${m.cap} гал · до ${Math.round(m.speed * 4)} mph`, () => bizSend('car_buy', { arg: id })); }
    for (const c of eco.cars || []) { const m = CARS[c.model]; if (m.issued || c.rentedTo || c.listing) continue;
      row(`Продать дилеру ${m.name} (состояние ${Math.round(c.cond * 100)}%) — ${money(resale(c, I))}`, () => bizSend('car_sell', { arg: c.id }));
      if (c.id !== eco.activeCar) row(`Пересесть на ${m.name}`, () => bizSend('car_active', { arg: c.id })); } }
  if (name === 'CAR RENTAL') {
    if (eco.vehicle && eco.vehicle.rented) row(`Вернуть арендованный ${CARS[eco.vehicle.model].name} (срок до дня ${eco.vehicle.until})`, () => { bizSend('rent_return'); refreshMarket(); });
    else { for (const n of market ? market.npc : []) row(`Взять у конторы ${CARS[n.model].name} на сутки — ${money(n.price)}`, () => { bizSend('rent_take', { npc: n.model, days: 1 }); refreshMarket(); });
      for (const l of (market ? market.listings : []).slice(0, 6)) row(`Взять ${CARS[l.model].name} у ${l.owner} на сутки — ${money(l.price)} (состояние ${Math.round(l.cond * 100)}%)`, () => { bizSend('rent_take', { owner: l.owner, carId: l.carId, days: 1 }); refreshMarket(); }); }
    for (const c of eco.cars || []) { const m = CARS[c.model]; if (m.issued) continue;
      if (c.rentedTo) row(`${m.name} сейчас у ${c.rentedTo} до дня ${c.rentUntil}`, () => say('Машина вернётся, когда закончится аренда'));
      else if (c.listing) row(`Снять с проката ${m.name} (${money(c.listing.price)}/сут, объявление до дня ${c.listing.until})`, () => { bizSend('rent_unlist', { arg: c.id }); refreshMarket(); });
      else { const fair = cat ? cat.cars[c.model].rent : fairRent(c.model, I);
        row(`Сдать ${m.name} по рынку — ${money(fair)}/сут`, () => { bizSend('rent_list', { arg: c.id, price: fair }); refreshMarket(); });
        row(`Сдать ${m.name} дёшево — ${money(fair * .75)}/сут (туристы берут охотнее)`, () => { bizSend('rent_list', { arg: c.id, price: fair * .75 }); refreshMarket(); }); } } }
  if (name === 'BANK') {
    if (eco.loan) { row(`Погасить кредит целиком — ${money(eco.loan.left)} (платёж в сутки ${money(eco.loan.due)}${eco.loan.missed ? `, просрочек ${eco.loan.missed}` : ''})`, () => bizSend('loan_pay', { arg: eco.loan.left }));
      row(`Внести ${money(Math.min(50, eco.loan.left))}`, () => bizSend('loan_pay', { arg: 50 })); }
    else if ((eco.loanLimit || 0) >= 10) { row(`Кредит на весь лимит — ${money(eco.loanLimit)} на ${ECON.LOAN_DAYS} дней`, () => bizSend('loan_take', { arg: eco.loanLimit }));
      row(`Кредит на половину — ${money(Math.floor(eco.loanLimit / 2))}`, () => bizSend('loan_take', { arg: Math.floor(eco.loanLimit / 2) })); }
    else row('Кредит не дают: залог — машины и наличные за вычетом долгов', () => say('Чем больше машин и денег, тем больше лимит')); }
  if (name === 'FILLING STATION') { const v = eco.vehicle;
    if (v) { const need = Math.max(0, CARS[v.model].tank - v.fuel); row(need > .01 ? `Залить полный бак — ${need.toFixed(1)} гал за ${money(need * (cat ? cat.fuel : ECON.FUEL_PRICE))}` : 'Бак полный', () => bizSend('fuel')); }
    else row('Машины нет — заправлять нечего', () => {}); }
  if (name === 'GARAGE') {
    row('Выковать медный котёл — 4 листа', () => { if (inv.copper < 4) return say(`Меди мало: ${inv.copper}/4`); startWork('Куём котёл', 2, () => offline ? (inv.copper -= 4, inv.pot++, say('Котёл готов')) : net.send({ t: 'craft', kind: 'pot' })); });
    row('Согнуть змеевик — 2 листа', () => { if (inv.copper < 2) return say(`Меди мало: ${inv.copper}/2`); startWork('Гнём змеевик', 1.5, () => offline ? (inv.copper -= 2, inv.worm++, say('Змеевик готов')) : net.send({ t: 'craft', kind: 'worm' })); });
    const v = eco.vehicle; if (v && !v.rented && v.cond < .995) row(`Отремонтировать ${CARS[v.model].name} (${Math.round(v.cond * 100)}%) — ${money(repairCost({ model: v.model, cond: v.cond }, I))}`, () => startWork('Ремонтируем машину', .8, () => bizSend('repair'))); }
  for (const [id, sv] of Object.entries(SERVICES)) if (sv.place === name) row(`${sv.name} — ${money(cat ? cat.services[id] : sv.price)}`, () => bizSend('service', { arg: id }));
  if (JOBS[name]) { const job = JOBS[name], left = eco.workLeft ?? ECON.WORK_CAP_H, h = Math.min(job.hours, left);
    row(h > 0 ? `${job.name}: ${h} ч за ${money((cat ? cat.wage : ECON.WAGE) * h)} (сегодня осталось ${left} ч)` : `${job.name}: на сегодня смены кончились`, () => { if (h <= 0) return say('Приходи завтра'); startWork(job.name, h, () => bizSend('work')); }); }
  if (name === 'HOTEL' && eco.room) { row(`Положить самогон в сейф номера (${eco.jugs + eco.carJugs} гал)`, () => bizSend('stash', { arg: 'put' })); if (eco.stash) row(`Забрать из сейфа (${eco.stash} гал)`, () => bizSend('stash', { arg: 'take' })); }
  if (name === 'Мельница') row(`Смолоть кукурузу (${inv.corn} меш.)`, () => { if (inv.corn <= 0) return say('Зерна нет'); startWork('Мелем кукурузу', .8, () => offline ? (inv.cornmeal += inv.corn, inv.corn = 0, say('Мука готова')) : net.send({ t: 'mill' })); });
  if (name === 'BILLIARDS') row(`Сдать самогон (${eco.jugs + eco.carJugs} гал) — хозяин платит сейчас около ${money(cat ? (nightF() > .5 ? cat.speak : cat.speakDay) : SELL_PRICE)} за галлон`, () => { const n = eco.jugs + eco.carJugs; if (n <= 0) return say('Пусто'); if (offline) { eco.cash += n * SELL_PRICE; eco.jugs = eco.carJugs = 0; return say('Продано'); } net.send({ t: 'sell', inCar: eco.carJugs > 0 }); });
  return rows;
}
let shopSig = '';
function renderShop() {
  const el = document.getElementById('shop'); if (!el) return; el.style.display = 'block';
  const rows = shopRows(); const sig = interior.name + '|' + eco.cash + '|' + rows.map(r => r.label).join('|') + '|' + (shopOpen() ? 1 : 0);
  if (sig === shopSig) return; shopSig = sig;
  document.getElementById('shopTitle').textContent = interior.title;
  document.getElementById('shopClerk').textContent = `${interior.clerkName}: «${interior.greet}»` + (shopOpen() ? '' : ' (закрыто, приходи с 8 до 18)');
  const box = document.getElementById('shopRows'); box.innerHTML = '';
  rows.forEach((r, i) => { const d = document.createElement('div'); d.className = 'shopRow'; d.textContent = `${i + 1}. ${r.label}`;
    d.addEventListener('click', () => { if (!work) r.run(); }); box.appendChild(d); });
  interior.rows = rows;
}
function shopKey(n) { if (interior) { const r = (interior.rows || shopRows())[n]; if (r && !work) r.run(); return; } buy(n); }

// ================= КОЛЛИЗИИ =================
const treeBuckets = new Map(); for (const t of world.trees) { const k = idx(Math.floor(t.i), Math.floor(t.j)); if (!treeBuckets.has(k)) treeBuckets.set(k, []); treeBuckets.get(k).push(t); }
for (const r of world.rocks) { const k = idx(Math.floor(r.i), Math.floor(r.j)); if (!treeBuckets.has(k)) treeBuckets.set(k, []); treeBuckets.get(k).push(r); }
function blockedAt(x, z) { if (interior) return interiorBlocked(x, z);
  const i = Math.floor(x / TS), j = Math.floor(z / TS); if (!inb(i, j)) return true; if (world.solid[idx(i, j)]) return true;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const b = treeBuckets.get(idx(i + di, j + dj)); if (!b) continue; for (const t of b) { const dx = X(t.i) - x, dz = Z(t.j) - z; if (dx * dx + dz * dz < .16) return true; } }
  return false; }
function tryMove(pos, dx, dz, r) { const ok = (x, z) => !blockedAt(x + r, z) && !blockedAt(x - r, z) && !blockedAt(x, z + r) && !blockedAt(x, z - r); if (ok(pos.x + dx, pos.z)) pos.x += dx; if (ok(pos.x, pos.z + dz)) pos.z += dz; }
function carBlocked(x, z, yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); for (const [lx, lz] of [[1.2, .5], [1.2, -.5], [-1.2, .5], [-1.2, -.5], [0, 0]]) { if (blockedAt(x + lx * c - lz * s, z - lx * s - lz * c)) return true; } return false; }

// ================= ВВОД =================
const keys = {}; addEventListener('keydown', e => { if (window.__designerOpen) return; keys[e.code] = true; if (e.code == 'KeyE' && !(keys.KeyQ && keys.KeyW)) interact(); if (e.code == 'KeyF') roleAction(); if (e.code == 'KeyG') igniteAction(); if (e.code == 'KeyB') toggleZones(); if (e.code == 'KeyV') voice.ptt(true); if (e.code == 'KeyT') fast = !fast; if (/^Digit[1-9]$/.test(e.code)) shopKey(+e.code[5] - 1); if (e.code == 'Escape' && interior) exitShop(); }); addEventListener('keyup', e => { keys[e.code] = false; if (e.code == 'KeyV') voice.ptt(false); });

// ================= МОБИЛЬНОЕ УПРАВЛЕНИЕ =================
// Один джойстик: пешком — направление, за рулём — газ/тормоз (Y) и руль (X). Кнопки Zoom меняют VIEW_H (и тем самым скорость времени).
const touchJoy = { x: 0, y: 0, mag: 0 };
(function setupTouch() {
  const base = document.getElementById('joyBase'), knob = document.getElementById('joyKnob'), btnE = document.getElementById('btnE');
  const zin = document.getElementById('zoomIn'), zout = document.getElementById('zoomOut');
  let touchId = null, cx = 0, cy = 0; const R = 46;
  const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px,${dy}px)`; };
  base.addEventListener('touchstart', e => { const t = e.changedTouches[0]; touchId = t.identifier; const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', e => { for (const t of e.changedTouches) { if (t.identifier !== touchId) continue; let dx = t.clientX - cx, dy = t.clientY - cy; const d = Math.hypot(dx, dy); if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      setKnob(dx, dy); touchJoy.x = dx / R; touchJoy.y = -dy / R; touchJoy.mag = Math.hypot(touchJoy.x, touchJoy.y); e.preventDefault(); } }, { passive: false });
  function endTouch(e) { for (const t of e.changedTouches) if (t.identifier === touchId) { touchId = null; setKnob(0, 0); touchJoy.x = touchJoy.y = touchJoy.mag = 0; } }
  addEventListener('touchend', endTouch); addEventListener('touchcancel', endTouch);
  btnE.addEventListener('touchstart', e => { e.preventDefault(); interact(); }, { passive: false });
  const btnF = document.getElementById('btnF'); if (btnF) btnF.addEventListener('touchstart', e => { e.preventDefault(); roleAction(); }, { passive: false });
  const btnG = document.getElementById('btnG'); if (btnG) btnG.addEventListener('touchstart', e => { e.preventDefault(); igniteAction(); }, { passive: false });
  const btnV = document.getElementById('btnV'); if (btnV) { btnV.addEventListener('touchstart', e => { e.preventDefault(); voice.ptt(true); }, { passive: false }); btnV.addEventListener('touchend', () => voice.ptt(false)); btnV.addEventListener('touchcancel', () => voice.ptt(false)); }
  const zoomBy = k => { VIEW_H = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, VIEW_H * k)); resize(); };
  zin.addEventListener('touchstart', e => { e.preventDefault(); zoomBy(1 / 1.25); }); zout.addEventListener('touchstart', e => { e.preventDefault(); zoomBy(1.25); });
  // пинч двумя пальцами по канвасу тоже меняет зум
  let pinch = null;
  canvas.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }, { passive: true });
  canvas.addEventListener('touchmove', e => { if (e.touches.length === 2 && pinch) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); zoomBy(pinch / d); pinch = d; } }, { passive: true });
  canvas.addEventListener('touchend', () => { pinch = null; });
})();
const msgEl = document.getElementById('msg'); let msgT = 0;
function say(t) { msgEl.textContent = t; msgEl.style.display = 'block'; msgT = 4; }
function nearStill(r = 3.5) { const f = player.inCar ? car.pos : player.pos; let best = null; for (const s of world.stills) { const d = Math.hypot(X(s.i) - f.x, Z(s.j) - f.z); if (d < r && (!best || d < best.d)) best = { d, s }; } return best && best.s; }
function nearestRemote(r = 7) { const f = player.inCar ? car.pos : player.pos; let best = null; for (const q of remote.values()) { if (!q.disp) continue; const d = Math.hypot(q.disp.x - f.x, q.disp.z - f.z); if (d < r && (!best || d < best.d)) best = { d, q }; } return best && best.q; }
function nearSpeak() { if (!speak) return false; const f = player.inCar ? car.pos : player.pos; return Math.hypot(X(speak.i + speak.w / 2) - f.x, Z(speak.j + speak.d / 2) - f.z) < 4.5; }
function nearBuilding(name, r = 5) { const f = player.inCar ? car.pos : player.pos; for (const b of world.buildings) if (b.name == name) { const d = Math.hypot(X(b.i + b.w / 2) - f.x, Z(b.j + b.d / 2) - f.z); if (d < r) return b; } return null; }
function nearTile(types, r = 2) { const f = player.inCar ? car.pos : player.pos; const i0 = Math.round(f.x / TS), j0 = Math.round(f.z / TS); for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (inb(i0 + di, j0 + dj) && types.includes(world.tiles[idx(i0 + di, j0 + dj)])) return true; return false; }
function curShop() { if (interior) return SHOPS[interior.name] ? interior.name : null; for (const n of Object.keys(SHOPS)) if (nearBuilding(n)) return n; return null; }
function buy(n) { const shop = curShop(); if (shop) buyFrom(shop, n); }
function buyFrom(shop, n) { const it = (SHOPS[shop] || [])[n]; if (!it) return; const k = it[0], price = catalog ? catalog.goods[k] : it[1];
  if (!shopOpen()) return say('Закрыто. Лавки работают с 8 до 18');
  if (HEAVY.has(k) && !carNear(interior ? 14 : 6)) return say(`${ITEM[k]} на руках не унести — подгони машину к дверям`);
  if (eco.cash < price) return say(`Не хватает денег: ${ITEM[k]} стоит $${price}`);
  if (offline) { eco.cash -= price; inv[k]++; return say(`Куплено: ${ITEM[k]} (-$${price})`); }
  net.send({ t: 'buy', shop, idx: n }); }
function toggleCar() {
  if (!player.inCar && !offline && !eco.vehicle && player.pos.distanceTo(car.pos) < 3) return say('Своей машины сейчас нет — купи в салоне или возьми в прокат');
  if (!player.inCar) { if (player.pos.distanceTo(car.pos) < 3) { player.inCar = true; player.mesh.visible = false; if (eco.jugs) { const mv = Math.min(eco.jugs, car.cap - eco.carJugs); eco.carJugs += mv; eco.jugs -= mv; } } }
  else { const c = Math.cos(car.yaw), s2 = Math.sin(car.yaw); const px = car.pos.x - s2 * 1.3, pz = car.pos.z - c * 1.3; if (!blockedAt(px, pz)) { player.inCar = false; player.pos.set(px, 0, pz); player.mesh.visible = true; car.speed = 0; } }
}
// Закон играет в другую игру: осмотр местности, дело против куба, облава и досмотр машин.
function lawInteract() {
  const s = nearStill(6);
  if (s) { if (s.step === 0) return say('Старое кострище — рубить нечего');
    const c = cases[s.id] || 0;
    if (c < 3 && s.stage !== 'run') return say(`Нет ордера: улик ${c}/3. Осмотрись вокруг (F)`);
    return startWork('Рубим аппарат топорами', .8, () => net.send({ t: 'raid', still: s.id })); }
  const t = nearestRemote(7);
  if (t) return startWork(`Досмотр: ${t.name}`, .4, () => net.send({ t: 'frisk' }));
  const e = nearDoor();   // закон тоже заходит внутрь — там книга покупок; но своя машина у дверей важнее
  if (e && !player.inCar && !(carBoardable() && player.pos.distanceTo(car.pos) < e.d)) return enterShop(e.name);
  toggleCar();
}
// F — главное действие роли: закон осматривает местность, самогонщик заметает следы.
function roleAction() {
  if (work) return;
  if (offline) return say('Роли и улики работают только на общем сервере');
  if (myRole === 'law') return startWork('Осматриваем местность', .5, () => net.send({ t: 'search' }));
  return startWork('Заметаем следы: ветки, зола, вода из ручья', .6, () => net.send({ t: 'sweep' }));
}
function interact() {
  if (work) return;
  if (interior) return interiorInteract();
  if (myRole === 'law') return lawInteract();
  const s = nearStill();
  if (s) {
    if (s.stage == 'build') { const st = BUILD_STEPS[s.step]; if (!carNear(8)) return say('Материалы в машине — подгони её к поляне');
      if (!has(st.need)) return say(`${st.name}: не хватает — ${missing(st.need)}`);
      return startWork(st.name, st.hours, () => { if (offline) { spend(st.need); s.step++; if (s.step >= BUILD_STEPS.length) { s.stage = 'empty'; say(`Аппарат на ${s.creek} собран. Заложи брагу (E)`); } else say(`Готово: ${st.name}`); } else net.send({ t: 'act', still: s.id, kind: 'build' }); }); }
    if (s.stage == 'empty') { if (!has(MASH_NEED)) return say(`Для браги нужно: ${missing(MASH_NEED)}`); return startWork('Заводим брагу: мука, сахар, дрожжи, вода из ручья', .6, () => { if (offline) { spend(MASH_NEED); s.stage = 'ferment'; s.mash = 0; say('Брага заложена'); } else net.send({ t: 'act', still: s.id, kind: 'mash' }); }); }
    if (s.stage == 'ferment') return say(`Брага бродит: ${Math.round(s.mash / FERMENT_H * 100)}%`);
    if (s.stage == 'ready') { if (inv.wood < RUN_WOOD) return say(`Нужно дров: ${inv.wood}/${RUN_WOOD}`); return startWork('Разжигаем очаг', .3, () => { if (offline) { inv.wood -= RUN_WOOD; s.stage = 'run'; s.mash = 0; say('Разожгли очаг. Гоним — дым видно издалека…'); } else net.send({ t: 'act', still: s.id, kind: 'burn' }); }); }
    if (s.stage == 'run') return say(`Перегон: ${Math.round(s.mash / RUN_H * 100)}%`);
    if (s.stage == 'done') { const cap = player.inCar ? car.cap - eco.carJugs : WALK_CAP - eco.jugs; if (cap <= 0) return say(player.inCar ? 'Машина полна' : 'Пешком унесёшь только 2 галлона — приезжай на машине');
      if (offline) { s.gallons -= cap; if (player.inCar) eco.carJugs += cap; else eco.jugs += cap; if (s.gallons <= 0) s.stage = 'empty'; return say(`Забрал ${cap} гал.`); }
      return net.send({ t: 'act', still: s.id, kind: 'take', inCar: player.inCar }); }
    return;
  }
  // к спикизи можно подъехать с грузом (сдать через заднюю дверь) или зайти внутрь пешком
  if (nearSpeak()) { if (player.inCar) { if (eco.carJugs <= 0) return say('Хозяин: «Привози товар, возьму по $5. Лучше ночью»');
      if (offline) { eco.cash += eco.carJugs * SELL_PRICE; eco.carJugs = 0; return say('Продано'); } return net.send({ t: 'sell', inCar: true }); }
    return enterShop('BILLIARDS'); }
  { const e = nearDoor();
    // машина у самых дверей лавки: E садит в неё, если она ближе двери. Из машины E просто высаживает.
    if (e && !(carBoardable() && player.pos.distanceTo(car.pos) < e.d)) {
      if (player.inCar) return toggleCar();
      return enterShop(e.name); } }
  if (nearTile([T.ROCK], 2)) { if (!carNear()) return say('Камни тяжёлые — подгони машину'); return startWork('Собираем камни для очага', .5, () => { if (offline) { inv.stone += 3; say('+3 камня'); } else net.send({ t: 'gather', kind: 'stone' }); }); }
  if (nearTile([T.FOREST], 1)) { return startWork('Рубим дрова', .5, () => { if (offline) { inv.wood += 3; say('+3 дров'); } else net.send({ t: 'gather', kind: 'wood' }); }); }
  toggleCar();
}

// ================= ВРЕМЯ =================
let time = 6.5, day = 1, fast = false;
const nightF = () => time >= 7.5 && time <= 17.5 ? 0 : (time >= 20 || time <= 5) ? 1 : time < 7.5 ? 1 - (time - 5) / 2.5 : (time - 17.5) / 2.5;
const cDay = new THREE.Color('#dfe9d3'), cNight = new THREE.Color('#1c2240'), cDusk = new THREE.Color('#e9b98a'), bg = new THREE.Color();
function applyTime() {
  const n = nightF(), dusk = Math.max(0, 1 - Math.abs(time - 18.4) / 1.5) + Math.max(0, 1 - Math.abs(time - 6.2) / 1.3);
  sun.intensity = 1.7 * (1 - n) + .05; sun.color.set('#fff4d6').lerp(cDusk, Math.min(1, dusk * .8));
  const a = ((time - 6) / 12) * Math.PI; sun.position.set(Math.cos(a) * 40, Math.max(8, Math.sin(a) * 50) + 10, 25);
  hemi.intensity = .9 * (1 - n) + .55; hemi.color.set('#cfe6ff').lerp(new THREE.Color('#5a6aa8'), n); hemi.groundColor.set('#8a7a55').lerp(new THREE.Color('#2a2e44'), n); moon.intensity = n * .5;
  bg.copy(cDay).lerp(cDusk, Math.min(1, dusk * .5)).lerp(cNight, n); scene.background = bg; scene.fog.color.copy(bg); renderer.setClearColor(bg);
  glassMat.emissive.set('#ffb86a').multiplyScalar(n * .9); headMat.color.set('#f0e6c8').lerp(new THREE.Color('#ffd27a'), n); glowMat.opacity = n * .9;
  waterMat.color.set('#7fc0da').lerp(new THREE.Color('#223a5a'), n * .8);
  car.mesh.userData.spot.intensity = n * 40; for (const h of car.mesh.userData.hl) h.material.color.set(n > .3 ? '#fff8d0' : '#c9c1a8');
  for (const a of ai) a.mesh.userData.spot.intensity = n * 25;
  document.getElementById('clock').textContent = `День ${day} · ${String(Math.floor(time)).padStart(2, '0')}:${String(Math.floor(time % 1 * 60)).padStart(2, '0')} · ×${timeScale().toFixed(1)}`;
}

// ================= МИНИКАРТА =================
const mm = document.getElementById('map').getContext('2d');
function drawMap(focus) { mm.drawImage(gc, 0, 0, 192, 192); mm.drawImage(showZones ? zc : fc, 0, 0, 192, 192); const sc = 192 / (W * TS); mm.fillStyle = '#c0392b'; mm.beginPath(); mm.arc(focus.x * sc, focus.z * sc, 3, 0, 7); mm.fill(); if (!player.inCar) { mm.fillStyle = '#222'; mm.fillRect(car.pos.x * sc - 2, car.pos.z * sc - 2, 4, 4); }
  for (const s of world.stills) { mm.fillStyle = s.built ? '#c8873f' : 'rgba(200,60,40,.7)'; mm.fillRect(X(s.i) * sc - 1.5, Z(s.j) * sc - 1.5, 3, 3); }
  if (speak) { mm.fillStyle = '#2b3a4a'; mm.fillRect(X(speak.i) * sc - 2, Z(speak.j) * sc - 2, 4, 4); }
  for (const e of evidence) { mm.fillStyle = e.found ? '#4a90d9' : '#c0392b'; mm.beginPath(); mm.arc(e.x * sc, e.z * sc, 2, 0, 7); mm.fill(); } }

// ================= ЦИКЛ =================
const camTarget = player.pos.clone(); let last = performance.now(); let netSendT = 0;
const placeEl = document.getElementById('place');
function loop(now) {
  if (document.hidden) setTimeout(() => loop(performance.now()), 16); else requestAnimationFrame(loop);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  // Зум = скорость мира: вблизи ×1, на самом дальнем плане ×2. Подшаги — чтобы машина не проскакивала сквозь стены.
  const sc = timeScale(); const sub = Math.ceil(sc); for (let k = 0; k < sub; k++) update(dt * sc / sub);
  sendMove(dt); renderRemotes(dt); voice.update();   // сеть и голос живут в реальном времени, а не в ускоренном зумом
  renderer.render(scene, camera);
}
const ZOOM_MIN = 12, ZOOM_MAX = 70;
function timeScale() { const u = (VIEW_H - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN); return 1 + Math.max(0, Math.min(1, u)) * 1; }   // вдали максимум ×2
function update(dt) {
  const hoursDt = dt * (work ? 1.8 : fast ? 1.5 : .1); time += hoursDt; if (time >= 24) { time -= 24; day++; } applyTime();
  if (work) { work.left -= hoursDt; if (work.left <= 0) { const d = work.done; work = null; d(); } }
  if (!interior) updateLeaves(dt, camTarget, performance.now() / 1000);
  updateFire(dt);
  msgT -= dt; if (msgT <= 0) msgEl.style.display = 'none';
  // стиллы
  for (const sm of stillMeshes) { const s = sm.s; BUILD_STEPS.forEach((st, k) => sm.parts[st.key].visible = s.step > k); sm.parts.jugs.visible = s.stage == 'done'; sm.parts.wood.visible = s.stage == 'ready' || s.stage == 'run'; sm.ring.visible = s.step == 0;
    if (offline) { if (s.stage == 'ferment') { s.mash += hoursDt; if (s.mash >= FERMENT_H) s.stage = 'ready'; } if (s.stage == 'run') { s.mash += hoursDt * (.6 + .8 * s.flow); if (s.mash >= RUN_H) { s.stage = 'done'; s.gallons = Math.round(8 + 6 * s.flow); } } }
    const burning = s.stage == 'run'; sm.fire.material.opacity = burning ? .8 + Math.sin(performance.now() / 90) * .15 : 0; sm.glow.visible = burning;
    for (const k of sm.smokes) { k.visible = burning; if (burning) { k.userData.t = (k.userData.t + dt * .3) % 1; const t = k.userData.t; k.position.set(Math.sin(t * 9) * .3, 2 + t * 3.5, 0); k.scale.setScalar(.6 + t * 2); k.material.opacity = .4 * (1 - t); } }
    sm.barrel.material.color.set(s.stage == 'ready' ? '#9a6a3a' : '#7a5a3a'); }
  let focus;
  if (!player.inCar) {
    const mv = new THREE.Vector3(); if (keys.KeyW || keys.ArrowUp) mv.add(FWD); if (keys.KeyS || keys.ArrowDown) mv.sub(FWD); if (keys.KeyD || keys.ArrowRight) mv.add(RIGHT); if (keys.KeyA || keys.ArrowLeft) mv.sub(RIGHT);
    if (touchJoy.mag > .12) mv.addScaledVector(FWD, touchJoy.y).addScaledVector(RIGHT, touchJoy.x);
    const moving = !work && mv.lengthSq() > 0; const sp = ((keys.ShiftLeft || touchJoy.mag > .85) ? 7 : 4.2) * (eco.coffee && eco.coffee > netDay * 24 + netTime ? 1.25 : 1);   // кофе из кафе — шаг бодрее
    if (moving) { mv.normalize(); tryMove(player.pos, mv.x * sp * dt, mv.z * sp * dt, .3); player.yaw = Math.atan2(mv.x, mv.z); player.t += dt * 9; }
    const u = player.mesh.userData, sw = moving ? Math.sin(player.t) * .6 : 0; u.lL.rotation.x = sw; u.lR.rotation.x = -sw; u.aL.rotation.x = -sw; u.aR.rotation.x = sw;
    player.pos.y = interior ? 0 : hAt(player.pos.x, player.pos.z); player.mesh.position.copy(player.pos); player.mesh.rotation.y = player.yaw; focus = player.pos;
  } else {
    const M = CARS[car.model] || CARS.model_t, empty = !offline && eco.vehicle && eco.vehicle.fuel <= 0;   // без бензина машина только катится
    const thr = work || empty ? 0 : Math.max(-1, Math.min(1, (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? .6 : 0) + touchJoy.y));
    car.speed += thr * M.accel * dt; car.speed -= car.speed * (thr ? .25 : 1.2) * dt; car.speed = Math.max(-4, Math.min(M.speed, car.speed));
    const steer = Math.max(-1, Math.min(1, (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0) - touchJoy.x));
    car.yaw += steer * Math.min(1, Math.abs(car.speed) / 4) * M.grip * dt * Math.sign(car.speed || 1);
    const nx = car.pos.x + Math.cos(car.yaw) * car.speed * dt, nz = car.pos.z - Math.sin(car.yaw) * car.speed * dt;
    if (!carBlocked(nx, nz, car.yaw)) { car.pos.x = nx; car.pos.z = nz; } else car.speed *= -.3;
    focus = car.pos;
  }
  car.pos.y = hAt(car.pos.x, car.pos.z); car.mesh.position.copy(car.pos); car.mesh.rotation.y = car.yaw;
  // наклон машины по рельефу
  { const c = Math.cos(car.yaw), s = Math.sin(car.yaw); const hf = hAt(car.pos.x + c, car.pos.z - s), hb = hAt(car.pos.x - c, car.pos.z + s); car.mesh.rotation.z = Math.atan2(hf - hb, 2); car.mesh.rotation.order = 'YZX'; }
  { const tt = performance.now() / 1000;   // фермеры наклоняются к грядкам, днём активнее
    const active = nightF() < .6 ? 1 : .15;
    for (const f of farmers) { f.g.visible = fire.state[f.k] === FS.UNBURNT;   // при пожаре фермер убегает
      const w = Math.sin(tt * 1.6 + f.phase) * .5 * active;
      f.armL.rotation.x = w; f.armR.rotation.x = -w * .6; f.torso.rotation.x = Math.max(0, w) * .35; } }
  for (const a of ai) { a.t += a.v * dt; if (a.t > 1) { a.t = 1; a.v = -a.v; } if (a.t < 0) { a.t = 0; a.v = -a.v; } a.mesh.position.set(a.from + (a.to - a.from) * a.t, 0, a.fixed); a.mesh.rotation.y = a.v > 0 ? 0 : Math.PI; }
  camTarget.lerp(focus, .1); camera.position.copy(camTarget).add(CAM_OFF); camera.lookAt(camTarget);
  sun.target.position.copy(camTarget); sun.position.add(camTarget);
  // сеть: шлём свою позицию, плавно ведём чужих
  // подпись места и подсказки
  if (interior) { renderShop();
    const hint = atDoor() ? 'E — выйти на улицу' : (atClerk() ? `${interior.clerkName} за прилавком · 1-5 — купить` : 'Подойди к прилавку · 1-5 — купить');
    placeEl.style.display = 'block'; placeEl.textContent = `${interior.title} · ${hint}`;
  } else { const sp = document.getElementById('shop'); if (sp) sp.style.display = 'none'; }
  let near = null; for (const b of world.buildings) if (b.name) { const d = Math.hypot(X(b.i + b.w / 2) - focus.x, Z(b.j + b.d / 2) - focus.z); if (d < 5 && (!near || d < near.d)) near = { d, name: b.speakeasy ? 'BILLIARDS · спикизи в подвале (E — продать)' : b.name }; }
  const shop = curShop(); if (shop) near = { d: 0, name: `${shop}${shopOpen() ? '' : ' (закрыто до 8:00)'} · ` + SHOPS[shop].map(([k, p], n) => `${n + 1} — ${ITEM[k]} $${p}`).join(' · ') + (shop == 'Мельница' && inv.corn ? ' · E — смолоть кукурузу' : '') };
  if (nearBuilding('GARAGE')) near = { d: 0, name: 'GARAGE · E — ковать котёл (4 меди) / змеевик (2 меди)' };
  if (myRole === 'law') {   // закону важны не рецепты, а состояние дела
    const ls = nearStill(6);
    if (ls) near = { d: 0, name: `${ls.creek} · ` + (ls.step === 0 ? 'старое кострище, пусто' : `аппарат ${ls.stage == 'run' ? 'ГОРИТ — брать на горячем (E)' : 'стоит'} · дело ${cases[ls.id] || 0}/3` + (cases[ls.id] >= 3 || ls.stage == 'run' ? ' · E — облава' : ' · F — осмотреться')) + (ls.hidden ? ' · прикрыт ветками' : '') };
    else { const t = nearestRemote(7); if (t) near = { d: 0, name: `${t.name} рядом · E — досмотр машины` };
      else near = { d: 0, name: `F — осмотреть местность · найдено улик: ${evidence.length}` }; }
    if (work) near = { d: 0, name: `${work.name}… ${Math.round((1 - work.left / work.total) * 100)}%` };
    if (!interior) { placeEl.style.display = 'block'; placeEl.textContent = near.name; }
    document.getElementById('status').textContent = `$${eco.cash} · ${roleTitle('law')} · облав ${eco.caught || 0}` + (player.inCar ? ` · ${Math.round(Math.abs(car.speed) * 4)} mph` : (player.pos.distanceTo(car.pos) < 3 ? ' · E — сесть' : ''));
    document.getElementById('inv').textContent = evidence.length ? evidence.slice(-4).map(e => EV_INFO[e.type]).join(' · ') : 'улик пока нет';
    document.getElementById('net').textContent = `${net.connected ? 'В сети' : 'Подключение…'} · ${myName} · игроков ${remote.size + 1} · округ: день ${netDay} ${String(Math.floor(netTime)).padStart(2, '0')}:${String(Math.floor(netTime % 1 * 60)).padStart(2, '0')} · подозрение ${Math.round(heat)}%`;
    drawMap(interior ? interior.ret : focus); return;
  }
  const ns = nearStill(); if (ns) { const st = BUILD_STEPS[ns.step]; near = { d: 0, name: `${ns.creek} · укрытие ${Math.round(ns.cover * 100)}% · глушь ${Math.round(ns.remote * 100)}% · вода ${Math.round(ns.flow * 100)}% · ` + (ns.stage == 'build' ? `сборка ${ns.step}/${BUILD_STEPS.length}: ${st.name} (нужно: ${Object.entries(st.need).map(([k, n]) => ITEM[k] + ' ' + inv[k] + '/' + n).join(', ')})` : { empty: 'аппарат готов — E: заложить брагу (мука 2, сахар 2, дрожжи 1)', ferment: 'брага бродит ' + Math.round(ns.mash / FERMENT_H * 100) + '%', ready: 'брага готова — E: гнать (дрова 3)', run: 'перегон ' + Math.round(ns.mash / RUN_H * 100) + '%', done: 'готово ' + ns.gallons + ' гал — E: забрать' }[ns.stage]) }; }
  else if (!shop && !near && nearTile([T.ROCK], 2)) near = { d: 0, name: 'Скалы · E — набрать камней (нужна машина рядом)' };
  else if (!shop && !near && nearTile([T.FOREST], 1)) near = { d: 0, name: 'Лес · E — нарубить дров' };
  if (work) near = { d: 0, name: `${work.name}… ${Math.round((1 - work.left / work.total) * 100)}%` };
  if (!interior) { placeEl.style.display = near ? 'block' : 'none'; if (near) placeEl.textContent = near.name; }
  { const v = eco.vehicle, M = CARS[car.model] || CARS.model_t;
    const carInfo = v ? ` · ${M.name}${v.rented ? ' (прокат)' : ''} · бензин ${v.fuel.toFixed(1)}/${M.tank}${v.fuel <= 0 ? ' — ПУСТО' : v.fuel < M.tank * .15 ? ' — мало' : ''}` : (offline ? '' : ' · без машины');
    document.getElementById('status').textContent = `$${eco.cash} · ${player.inCar ? `в машине ${eco.carJugs}/${car.cap} гал · ${Math.round(Math.abs(car.speed) * 4)} mph` : `в руках ${eco.jugs}/${WALK_CAP} гал` + (player.pos.distanceTo(car.pos) < 3 && car.mesh.visible ? ' · E — сесть' : '')}${carInfo}`
      + (eco.wanted ? ` · розыск ${eco.wanted}` : '') + (eco.loan ? ` · долг $${eco.loan.left}` : '') + (eco.room ? ' · номер в гостинице' : ''); }
  document.getElementById('net').textContent = `${net.connected ? 'В сети' : 'Подключение…'} · ${myName} · ${roleTitle(myRole)} · игроков ${remote.size + 1} · округ: день ${netDay} ${String(Math.floor(netTime)).padStart(2, '0')}:${String(Math.floor(netTime % 1 * 60)).padStart(2, '0')} · подозрение ${Math.round(heat)}%` + (evidence.length ? ` · твоих следов ${evidence.length} (F — замести)` : '') + (eco.busted ? ` · облав на тебя: ${eco.busted}` : '');
  document.getElementById('inv').textContent = Object.entries(inv).filter(([, n]) => n > 0).map(([k, n]) => `${ITEM[k]} ×${n}`).join(' · ') || 'пусто';
  drawMap(interior ? interior.ret : focus);
}
// выбор стороны при первом заходе (и кнопка «сменить сторону» в панели)
(function roleUI() {
  const ov = document.getElementById('roleOverlay'); if (!ov) return;
  ov.querySelectorAll('button[data-role]').forEach(b => b.addEventListener('click', () => setRole(b.dataset.role, true)));
  const btn = document.getElementById('roleBtn'); if (btn) btn.addEventListener('click', () => { ov.style.display = 'flex'; });
  ov.style.display = myRole ? 'none' : 'flex';
  const bf = document.getElementById('btnF'); if (bf) bf.textContent = myRole === 'law' ? 'Осмотр' : 'Замести';
})();

// справочник дизайнера: Q+W+E (на телефоне — три быстрых касания по названию города)
const GROUND_NAMES = { GRASS: 'Трава', ROAD: 'Городская улица', MAIN: 'Main Street', WATER: 'Вода', BANK: 'Песчаный берег', RAIL: 'Железная дорога', FOREST: 'Лесная подстилка', FIELD: 'Кукурузное поле (борозды)', DIRT: 'Грунтовка', PLAZA: 'Площадь у суда', YARD: 'Двор', ROCK: 'Скалы', MEADOW: 'Луг', CLEARING: 'Просека (не горит)', FALLOW: 'Пар между наделами (не горит)' };
const designer = setupDesigner({ CARS, mkPlayer, mkCar, mkFarmer, mkScarecrow, mkHouse, mkTownBuilding, mkTree, mkKit, clerkFigure, buildInterior, PLACES, SKIN, ITEM, SHOPS, glowTex, world, gc, PX, T, GROUND,
  mkEvidence: e => mkEvidence(Object.assign({ id: 7, x: 0, z: 0 }, e)), stillTemplate: () => stillMeshes[0] && stillMeshes[0].g,
  cornStalk: () => new THREE.Mesh(cornStalkGeo, new THREE.MeshLambertMaterial({ color: '#9db757' })),
  GROUND_SWATCHES: [...Object.entries(T).map(([k, v]) => [GROUND_NAMES[k] || k, GROUND[v]]), ['Гарь после пожара', '#2a221c'], ['Горящая земля', '#ff6919']] });
{ const vb = document.getElementById('voiceBtn'); if (vb) vb.addEventListener('click', () => voice.cycle()); }
{ let taps = []; const title = document.querySelector('#top b'); if (title) title.addEventListener('click', () => { const now = performance.now(); taps = taps.filter(q => now - q < 700); taps.push(now); if (taps.length >= 3) { taps = []; designer.open(); } }); }

applyTime(); requestAnimationFrame(loop);
window.__game = { player, car, world, eco, inv, setTime: t => { time = t; }, blockedAt, carBlocked, keys, update, interact, buy, hAt, camTarget, getWork: () => work, BUILD_STEPS, timeScale, setZoom: v => { VIEW_H = v; resize(); }, remote, net, touchJoy, roleAction, enterShop, exitShop, getInterior: () => interior, shopKey, getRole: () => myRole, setRole, getEvidence: () => evidence, getCases: () => cases, fire, igniteAction, toggleZones, designer, getHp: () => hp, voice, serverNow, sampleRemote, followDisplay, getRtt: () => rtt };
