import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { generate, T, W, H, CI, CJ, idx, inb } from './world.js';
import { connect } from './net.js';

// ================= НАСТРОЙКИ =================
const TS = 2, FH = 1.3;
const CAM_OFF = new THREE.Vector3(30, 30, 30);
const FWD = new THREE.Vector3(-1, 0, -1).normalize(), RIGHT = new THREE.Vector3(1, 0, -1).normalize();
let VIEW_H = 26;
const world = generate(parseInt(new URLSearchParams(location.search).get('seed') || '7', 10) || 7);
const X = i => i * TS, Z = j => j * TS;
// высота земли в мировых координатах (билинейно по вершинам)
function hAt(x, z) { const fx = x / TS, fz = z / TS; const c = Math.max(0, Math.min(W - 1, Math.floor(fx))), r = Math.max(0, Math.min(H - 1, Math.floor(fz))); const u = Math.max(0, Math.min(1, fx - c)), v = Math.max(0, Math.min(1, fz - r)); const g = (cc, rr) => world.hgt[rr * (W + 1) + cc]; return (g(c, r) * (1 - u) + g(c + 1, r) * u) * (1 - v) + (g(c, r + 1) * (1 - u) + g(c + 1, r + 1) * u) * v; }
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
const GROUND = { [T.GRASS]: '#cfe0a3', [T.ROAD]: '#c8b088', [T.MAIN]: '#a8a196', [T.WATER]: '#6fb0c8', [T.BANK]: '#dfcf9e', [T.RAIL]: '#b8ad97', [T.FOREST]: '#9cbf7e', [T.FIELD]: '#e3cf8a', [T.DIRT]: '#cfb489', [T.PLAZA]: '#dcd2bd', [T.YARD]: '#c7d99a', [T.ROCK]: '#a9a49a', [T.MEADOW]: '#d9e29a' };
const shadeHex = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = v => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f(n >> 8 & 255)},${f(n & 255)})`; };
{
  const r = (() => { let s = 99; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  const isRoad = (a, b) => inb(a, b) && [T.ROAD, T.MAIN, T.DIRT, T.RAIL, T.PLAZA].includes(world.tiles[idx(a, b)]);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const t = world.tiles[idx(i, j)]; let c = GROUND[t];
    const h = hIJ(i + .5, j + .5);
    if (t == T.GRASS || t == T.FOREST || t == T.MEADOW || t == T.YARD) c = shadeHex(c, 1 - Math.min(.25, h * .03) + (r() - .5) * .06);
    g2.fillStyle = c; g2.fillRect(i * PX, j * PX, PX, PX);
    if (t == T.GRASS || t == T.FOREST || t == T.YARD || t == T.MEADOW) { for (let q = 0; q < 4; q++) { g2.fillStyle = `rgba(90,140,60,${.06 + r() * .1})`; g2.fillRect(i * PX + r() * PX, j * PX + r() * PX, 3, 2); } }
    if (t == T.MAIN) { g2.fillStyle = '#d8d0c0'; if (!isRoad(i, j - 1)) g2.fillRect(i * PX, j * PX, PX, 3); if (!isRoad(i, j + 1)) g2.fillRect(i * PX, j * PX + PX - 3, PX, 3); if (!isRoad(i - 1, j)) g2.fillRect(i * PX, j * PX, 3, PX); if (!isRoad(i + 1, j)) g2.fillRect(i * PX + PX - 3, j * PX, 3, PX); }
    if (t == T.ROAD) { g2.fillStyle = 'rgba(70,50,20,.18)'; if (!isRoad(i, j - 1)) g2.fillRect(i * PX, j * PX, PX, 1); if (!isRoad(i, j + 1)) g2.fillRect(i * PX, j * PX + PX - 1, PX, 1); if (!isRoad(i - 1, j)) g2.fillRect(i * PX, j * PX, 1, PX); if (!isRoad(i + 1, j)) g2.fillRect(i * PX + PX - 1, j * PX, 1, PX); }
    if (t == T.DIRT) { g2.fillStyle = 'rgba(120,90,50,.2)'; g2.fillRect(i * PX + 2, j * PX + 5, 3, 1); g2.fillRect(i * PX + 7, j * PX + 7, 3, 1); }
    if (t == T.FIELD) { g2.fillStyle = 'rgba(120,90,40,.3)'; for (let q = 2; q < PX; q += 4) g2.fillRect(i * PX, j * PX + q, PX, 1); }
    if (t == T.ROCK) { g2.fillStyle = 'rgba(60,60,60,.25)'; g2.fillRect(i * PX + r() * 8, j * PX + r() * 8, 4, 3); }
  }
  const ri = world.railI; g2.fillStyle = '#8a7460'; for (let j = 0; j < H; j++) for (let q = 1; q < PX; q += 4) g2.fillRect(ri * PX + 2, j * PX + q, PX - 4, 2);
  g2.fillStyle = '#5a4a3a'; g2.fillRect(ri * PX + 4, 0, 1.5, H * PX); g2.fillRect(ri * PX + PX - 5.5, 0, 1.5, H * PX);
}
const groundTex = new THREE.CanvasTexture(gc); groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.anisotropy = 8;
const groundGeo = new THREE.PlaneGeometry(W * TS, H * TS, W, H);
{ const p = groundGeo.attributes.position; for (let r = 0; r <= H; r++) for (let c = 0; c <= W; c++) p.setZ(r * (W + 1) + c, world.hgt[r * (W + 1) + c]); groundGeo.computeVertexNormals(); }
const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: groundTex }));
ground.rotation.x = -Math.PI / 2; ground.position.set(W * TS / 2, 0, H * TS / 2); ground.receiveShadow = true; scene.add(ground);
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
for (const b of world.buildings) building(b);
for (const f of world.fences) { const x0 = X(f.i), x1 = X(f.i + f.w), z0 = Z(f.j), z1 = Z(f.j + f.d); const hor = f.side == 'N' || f.side == 'S'; const z = f.side == 'N' ? z0 + .1 : z1 - .1, x = f.side == 'W' ? x0 + .1 : x1 - .1;
  parts.push(hor ? box(x1 - x0, .06, .05, (x0 + x1) / 2, .35, z, '#f3ead6') : box(.05, .06, z1 - z0, x, .35, (z0 + z1) / 2, '#f3ead6'));
  const n = Math.round((hor ? x1 - x0 : z1 - z0) / .5); for (let q = 0; q <= n; q++) { const u = q / n; parts.push(hor ? box(.07, .5, .07, x0 + (x1 - x0) * u, 0, z, '#f3ead6') : box(.07, .5, .07, x, 0, z0 + (z1 - z0) * u, '#f3ead6')); } }
for (const p of world.props) {
  if (p.t == 'bridge') { parts.push(box(TS, .14, TS, X(p.i + .5), -.02, Z(p.j + .5), '#8a6b52')); if (p.edge == 'N') parts.push(box(TS, .5, .1, X(p.i + .5), .1, Z(p.j) + .05, '#7a5b42')); if (p.edge == 'S') parts.push(box(TS, .5, .1, X(p.i + .5), .1, Z(p.j + 1) - .05, '#7a5b42')); }
  if (p.t == 'trestle') { parts.push(box(TS, .3, TS, X(p.i + .5), -.2, Z(p.j + .5), '#6a5440')); parts.push(box(.2, .9, .2, X(p.i + .25), -.9, Z(p.j + .5), '#5a4636')); parts.push(box(.2, .9, .2, X(p.i + .75), -.9, Z(p.j + .5), '#5a4636')); }
  if (p.t == 'ford') { parts.push(box(TS, .2, TS, X(p.i + .5), -.55, Z(p.j + .5), '#bdb39a')); }
  if (p.t == 'crossing') { parts.push(box(.1, 2.2, .1, X(p.i) - .3, 0, Z(p.j) - .3, '#f0f0f0')); parts.push(box(.6, .12, .06, X(p.i) - .3, 2.0, Z(p.j) - .3, '#c0392b')); }
}
const lampHeads = [];
for (const l of world.lamps) { parts.push(box(.08, 2.6, .08, X(l.i), 0, Z(l.j), '#3a3a3a')); lampHeads.push(new THREE.Vector3(X(l.i), 2.7, Z(l.j))); }
// камни
for (const r of world.rocks) { const y = hAt(X(r.i), Z(r.j)); parts.push(colored(new THREE.DodecahedronGeometry(r.r * TS * .45, 0).translate(X(r.i), y + r.r * .3, Z(r.j)), '#9d9890')); }
// деревья
const trunk = new THREE.CylinderGeometry(.08, .12, 1, 5), cone = new THREE.ConeGeometry(1, 1.6, 7), ball = new THREE.SphereGeometry(1, 7, 5);
const treeParts = [];
for (const t of world.trees) { const x = X(t.i), z = Z(t.j), y = hAt(x, z), r = t.r * TS * .5;
  treeParts.push(colored(trunk.clone().scale(1, r * 1.2, 1).translate(x, y + r * .6, z), '#6e4a30'));
  if (t.pine) { treeParts.push(colored(cone.clone().scale(r, r * 1.1, r).translate(x, y + r * 1.2, z), '#6f9a5a')); treeParts.push(colored(cone.clone().scale(r * .7, r, r * .7).translate(x, y + r * 2.1, z), '#7fa863')); }
  else { treeParts.push(colored(ball.clone().scale(r * .8, r * .7, r * .8).translate(x, y + r * 1.4, z), '#7fae62')); treeParts.push(colored(ball.clone().scale(r * .6, r * .55, r * .6).translate(x + r * .3, y + r * 1.9, z - r * .2), '#93c070')); }
}
const cityMesh = new THREE.Mesh(mergeGeometries(parts), mat); cityMesh.castShadow = cityMesh.receiveShadow = true; scene.add(cityMesh);
// деревья кусками по 4000 — чтобы не строить один гигантский буфер
for (let k = 0; k < treeParts.length; k += 12000) { const m = new THREE.Mesh(mergeGeometries(treeParts.slice(k, k + 12000)), mat); m.castShadow = m.receiveShadow = true; scene.add(m); }
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
function mkPlayer() {
  const g = new THREE.Group(); const add = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lamb(c)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const lL = add(.18, .5, .2, -.12, .25, 0, '#3a4a6a'), lR = add(.18, .5, .2, .12, .25, 0, '#3a4a6a');
  add(.5, .55, .3, 0, .78, 0, '#5a6a8a'); add(.56, .2, .32, 0, 1.0, 0, '#c9a56b');
  const aL = add(.14, .5, .16, -.34, .8, 0, '#c9a56b'), aR = add(.14, .5, .16, .34, .8, 0, '#c9a56b');
  add(.32, .32, .3, 0, 1.28, 0, '#e8c39e'); add(.5, .06, .5, 0, 1.46, 0, '#6b4a2a'); add(.32, .16, .32, 0, 1.55, 0, '#6b4a2a');
  g.userData = { lL, lR, aL, aR }; return g;
}
function mkCar(color) {
  const g = new THREE.Group(); const add = (w, h, d, x, y, z, c, geo) => { const m = new THREE.Mesh(geo || new THREE.BoxGeometry(w, h, d), lamb(c)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  add(2.4, .45, 1.1, 0, .55, 0, color); add(1.0, .7, 1.05, -.25, 1.1, 0, color); add(.9, .06, 1.15, -.25, 1.5, 0, '#222');
  add(.7, .35, 1.0, .8, .9, 0, color); add(.05, .5, .95, .3, 1.15, 0, '#8fb2c0');
  for (const [x, z] of [[-.8, .6], [.8, .6], [-.8, -.6], [.8, -.6]]) add(0, 0, 0, x, .32, z, '#222', new THREE.CylinderGeometry(.32, .32, .18, 12).rotateX(Math.PI / 2));
  const hl = []; for (const z of [-.35, .35]) hl.push(add(.1, .18, .18, 1.22, .75, z, '#fff8d0'));
  const spot = new THREE.SpotLight('#ffe9b0', 0, 18, .6, .5, 1); spot.position.set(1.2, .8, 0); spot.target.position.set(8, 0, 0); g.add(spot); g.add(spot.target);
  g.userData = { hl, spot }; return g;
}
const player = { pos: new THREE.Vector3(X(world.start.i), 0, Z(world.start.j)), mesh: mkPlayer(), yaw: 0, t: 0, inCar: false };
scene.add(player.mesh);
const car = { pos: new THREE.Vector3(X(world.carStart.i), 0, Z(world.carStart.j)), yaw: 0, speed: 0, mesh: mkCar('#2b2b2b'), cap: 30 }; scene.add(car.mesh);
const ai = [];
{ const mainI = []; for (let i = 0; i < W; i++) { const t = world.tiles[idx(i, CJ)]; if (t == T.MAIN) mainI.push(i); }
  ai.push({ mesh: mkCar('#5a3a2a'), fixed: Z(CJ - .3), from: X(mainI[0] + 1), to: X(mainI[mainI.length - 1]), t: .2, v: .03 });
  ai.push({ mesh: mkCar('#1f2a3a'), fixed: Z(CJ + 1.8), from: X(mainI[0] + 1), to: X(mainI[mainI.length - 1]), t: .7, v: -.035 });
  for (const a of ai) scene.add(a.mesh); }

// ================= ЭКОНОМИКА (минимальная петля) =================
const eco = { cash: 0, jugs: 0, carJugs: 0 };
// ================= СЕТЬ (общий мир на всех) =================
const myName = (() => { const q = new URLSearchParams(location.search).get('name'); if (q) { localStorage.setItem('moon_name', q); return q; } let n = localStorage.getItem('moon_name'); if (!n) { n = 'Bootlegger' + Math.floor(100 + Math.random() * 900); localStorage.setItem('moon_name', n); } return n; })();
let myId = null, netTime = 6.5, netDay = 1, heat = 0;
const remote = new Map(); // id -> { walk, car, tx, tz, tyaw, inCar, name }
const REMOTE_COLORS = ['#7a3a3a', '#3a5a7a', '#5a7a3a', '#7a5a2a', '#5a3a7a', '#2a6a6a'];
function mergeStills(list) { for (const it of list) { const s = world.stills.find(x => x.id === it.id); if (s) Object.assign(s, { step: it.step, stage: it.stage, mash: it.mash, gallons: it.gallons }); } }
function ensureRemote(id, name) { let r = remote.get(id); if (!r) { const col = REMOTE_COLORS[id % REMOTE_COLORS.length]; const walk = mkPlayer(); const carM = mkCar(col); carM.visible = false; scene.add(walk); scene.add(carM);
    const cnv = document.createElement('canvas'); cnv.width = 128; cnv.height = 32; const cx = cnv.getContext('2d'); cx.fillStyle = 'rgba(30,20,10,.75)'; cx.fillRect(0, 4, 128, 22); cx.fillStyle = '#f2e6c8'; cx.font = 'bold 16px Georgia'; cx.textAlign = 'center'; cx.fillText(name, 64, 20);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cnv), depthTest: false })); tag.scale.set(2, .5, 1); tag.position.y = 2.6; walk.add(tag);
    r = { walk, car: carM, tx: 0, tz: 0, tyaw: 0, inCar: false, name }; remote.set(id, r); }
  return r; }
function applyPlayers(list) { const seen = new Set(); for (const p of list) { if (p.id === myId) continue; seen.add(p.id); const r = ensureRemote(p.id, p.name); r.tx = p.x; r.tz = p.z; r.tyaw = p.yaw; r.inCar = p.inCar; }
  for (const [id, r] of remote) if (!seen.has(id)) { scene.remove(r.walk); scene.remove(r.car); remote.delete(id); } }
const net = connect(myName);
net.on('welcome', msg => { myId = msg.id; netTime = msg.time; netDay = msg.day; heat = msg.heat; eco.cash = msg.cash; Object.assign(inv, msg.inv); eco.jugs = msg.jugs; eco.carJugs = msg.carJugs; mergeStills(msg.stills); applyPlayers(msg.players); });
net.on('you', msg => { eco.cash = msg.cash; Object.assign(inv, msg.inv); eco.jugs = msg.jugs; eco.carJugs = msg.carJugs; });
net.on('stills', msg => mergeStills(msg.list));
net.on('players', msg => applyPlayers(msg.list));
net.on('world', msg => { netTime = msg.time; netDay = msg.day; heat = msg.heat; });
net.on('msg', msg => say(msg.text));
let offline = false; let welcomed = false;
net.on('welcome', () => { welcomed = true; });
setTimeout(() => { if (!welcomed) { offline = true; eco.cash = 120; say('Сервер недоступен — играем в одиночном режиме (без общего мира)'); } }, 2500);

const inv = { copper: 0, pot: 0, worm: 0, barrel: 0, planks: 0, stone: 0, wood: 0, corn: 0, cornmeal: 0, sugar: 0, yeast: 0 }; // зеркало серверного инвентаря — сюда пишут только сообщения 'you'/'welcome'
const ITEM = { copper: 'медный лист', pot: 'медный котёл', worm: 'змеевик', barrel: 'бочка', planks: 'доски', stone: 'камень', wood: 'дрова', corn: 'кукуруза', cornmeal: 'кукурузная мука', sugar: 'сахар', yeast: 'дрожжи' };
const HEAVY = new Set(['copper', 'pot', 'worm', 'barrel', 'planks', 'stone']);
const SHOPS = { 'HARDWARE': [['copper', 6]], 'GROCERY': [['sugar', 2], ['yeast', 1]], 'FEED & SEED': [['corn', 1.5], ['barrel', 4]], 'Мельница': [['planks', 2]] };
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

// ================= КОЛЛИЗИИ =================
const treeBuckets = new Map(); for (const t of world.trees) { const k = idx(Math.floor(t.i), Math.floor(t.j)); if (!treeBuckets.has(k)) treeBuckets.set(k, []); treeBuckets.get(k).push(t); }
for (const r of world.rocks) { const k = idx(Math.floor(r.i), Math.floor(r.j)); if (!treeBuckets.has(k)) treeBuckets.set(k, []); treeBuckets.get(k).push(r); }
function blockedAt(x, z) { const i = Math.floor(x / TS), j = Math.floor(z / TS); if (!inb(i, j)) return true; if (world.solid[idx(i, j)]) return true;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const b = treeBuckets.get(idx(i + di, j + dj)); if (!b) continue; for (const t of b) { const dx = X(t.i) - x, dz = Z(t.j) - z; if (dx * dx + dz * dz < .16) return true; } }
  return false; }
function tryMove(pos, dx, dz, r) { const ok = (x, z) => !blockedAt(x + r, z) && !blockedAt(x - r, z) && !blockedAt(x, z + r) && !blockedAt(x, z - r); if (ok(pos.x + dx, pos.z)) pos.x += dx; if (ok(pos.x, pos.z + dz)) pos.z += dz; }
function carBlocked(x, z, yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); for (const [lx, lz] of [[1.2, .5], [1.2, -.5], [-1.2, .5], [-1.2, -.5], [0, 0]]) { if (blockedAt(x + lx * c - lz * s, z - lx * s - lz * c)) return true; } return false; }

// ================= ВВОД =================
const keys = {}; addEventListener('keydown', e => { keys[e.code] = true; if (e.code == 'KeyE') interact(); if (e.code == 'KeyT') fast = !fast; if (/^Digit[1-3]$/.test(e.code)) buy(+e.code[5] - 1); }); addEventListener('keyup', e => keys[e.code] = false);

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
function nearStill() { const f = player.inCar ? car.pos : player.pos; let best = null; for (const s of world.stills) { const d = Math.hypot(X(s.i) - f.x, Z(s.j) - f.z); if (d < 3.5 && (!best || d < best.d)) best = { d, s }; } return best && best.s; }
function nearSpeak() { if (!speak) return false; const f = player.inCar ? car.pos : player.pos; return Math.hypot(X(speak.i + speak.w / 2) - f.x, Z(speak.j + speak.d / 2) - f.z) < 4.5; }
function nearBuilding(name, r = 5) { const f = player.inCar ? car.pos : player.pos; for (const b of world.buildings) if (b.name == name) { const d = Math.hypot(X(b.i + b.w / 2) - f.x, Z(b.j + b.d / 2) - f.z); if (d < r) return b; } return null; }
function nearTile(types, r = 2) { const f = player.inCar ? car.pos : player.pos; const i0 = Math.round(f.x / TS), j0 = Math.round(f.z / TS); for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (inb(i0 + di, j0 + dj) && types.includes(world.tiles[idx(i0 + di, j0 + dj)])) return true; return false; }
function curShop() { for (const n of Object.keys(SHOPS)) if (nearBuilding(n)) return n; return null; }
function buy(n) { const shop = curShop(); if (!shop) return; const it = SHOPS[shop][n]; if (!it) return; const [k, price] = it;
  if (!shopOpen()) return say('Закрыто. Лавки работают с 8 до 18');
  if (HEAVY.has(k) && !carNear()) return say(`${ITEM[k]} на руках не унести — подгони машину`);
  if (eco.cash < price) return say(`Не хватает денег: ${ITEM[k]} стоит $${price}`);
  if (offline) { eco.cash -= price; inv[k]++; return say(`Куплено: ${ITEM[k]} (-$${price})`); }
  net.send({ t: 'buy', shop, idx: n }); }
function interact() {
  if (work) return;
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
  if (nearSpeak()) { const n = player.inCar ? eco.carJugs : eco.jugs; if (n <= 0) return say('Хозяин бильярдной: «Привози, возьму по $5 за галлон. Лучше ночью»');
    if (offline) { const night = nightF() > .5; const price = night ? SELL_PRICE : SELL_PRICE - 1; eco.cash += n * price; if (player.inCar) eco.carJugs = 0; else eco.jugs = 0; return say(`Продано ${n} гал. по $${price}`); }
    return net.send({ t: 'sell', inCar: player.inCar }); }
  if (nearBuilding('GARAGE')) { if (!shopOpen()) return say('Гараж закрыт до утра');
    if (inv.copper >= 4 && !inv.pot) return startWork('Куём медный котёл из четырёх листов', 2, () => { if (offline) { inv.copper -= 4; inv.pot++; say('Медный котёл готов'); } else net.send({ t: 'craft', kind: 'pot' }); });
    if (inv.copper >= 2) return startWork('Гнём медную трубку в змеевик', 1.5, () => { if (offline) { inv.copper -= 2; inv.worm++; say('Змеевик готов'); } else net.send({ t: 'craft', kind: 'worm' }); });
    return say('В гараже можно выковать котёл (4 листа меди) и змеевик (2 листа). Медь — в HARDWARE'); }
  if (nearBuilding('Мельница')) { if (inv.corn > 0) return startWork('Мелем кукурузу', .8, () => { if (offline) { inv.cornmeal += inv.corn; inv.corn = 0; say('Кукурузная мука готова'); } else net.send({ t: 'mill' }); }); }
  if (nearTile([T.ROCK], 2)) { if (!carNear()) return say('Камни тяжёлые — подгони машину'); return startWork('Собираем камни для очага', .5, () => { if (offline) { inv.stone += 3; say('+3 камня'); } else net.send({ t: 'gather', kind: 'stone' }); }); }
  if (nearTile([T.FOREST], 1)) { return startWork('Рубим дрова', .5, () => { if (offline) { inv.wood += 3; say('+3 дров'); } else net.send({ t: 'gather', kind: 'wood' }); }); }
  if (!player.inCar) { if (player.pos.distanceTo(car.pos) < 3) { player.inCar = true; player.mesh.visible = false; if (eco.jugs) { const mv = Math.min(eco.jugs, car.cap - eco.carJugs); eco.carJugs += mv; eco.jugs -= mv; } } }
  else { const c = Math.cos(car.yaw), s2 = Math.sin(car.yaw); const px = car.pos.x - s2 * 1.3, pz = car.pos.z - c * 1.3; if (!blockedAt(px, pz)) { player.inCar = false; player.pos.set(px, 0, pz); player.mesh.visible = true; car.speed = 0; } }
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
function drawMap(focus) { mm.drawImage(gc, 0, 0, 192, 192); const sc = 192 / (W * TS); mm.fillStyle = '#c0392b'; mm.beginPath(); mm.arc(focus.x * sc, focus.z * sc, 3, 0, 7); mm.fill(); if (!player.inCar) { mm.fillStyle = '#222'; mm.fillRect(car.pos.x * sc - 2, car.pos.z * sc - 2, 4, 4); }
  for (const s of world.stills) { mm.fillStyle = s.built ? '#c8873f' : 'rgba(200,60,40,.7)'; mm.fillRect(X(s.i) * sc - 1.5, Z(s.j) * sc - 1.5, 3, 3); }
  if (speak) { mm.fillStyle = '#2b3a4a'; mm.fillRect(X(speak.i) * sc - 2, Z(speak.j) * sc - 2, 4, 4); } }

// ================= ЦИКЛ =================
const camTarget = player.pos.clone(); let last = performance.now(); let netSendT = 0;
const placeEl = document.getElementById('place');
function loop(now) {
  if (document.hidden) setTimeout(() => loop(performance.now()), 16); else requestAnimationFrame(loop);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  // Зум = скорость мира: вблизи ×1, на самом дальнем плане ×2. Подшаги — чтобы машина не проскакивала сквозь стены.
  const sc = timeScale(); const sub = Math.ceil(sc); for (let k = 0; k < sub; k++) update(dt * sc / sub);
  renderer.render(scene, camera);
}
const ZOOM_MIN = 12, ZOOM_MAX = 70;
function timeScale() { const u = (VIEW_H - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN); return 1 + Math.max(0, Math.min(1, u)) * 1; }   // вдали максимум ×2
function update(dt) {
  const hoursDt = dt * (work ? 1.8 : fast ? 1.5 : .1); time += hoursDt; if (time >= 24) { time -= 24; day++; } applyTime();
  if (work) { work.left -= hoursDt; if (work.left <= 0) { const d = work.done; work = null; d(); } }
  updateLeaves(dt, camTarget, performance.now() / 1000);
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
    const moving = !work && mv.lengthSq() > 0; const sp = (keys.ShiftLeft || touchJoy.mag > .85) ? 7 : 4.2;
    if (moving) { mv.normalize(); tryMove(player.pos, mv.x * sp * dt, mv.z * sp * dt, .3); player.yaw = Math.atan2(mv.x, mv.z); player.t += dt * 9; }
    const u = player.mesh.userData, sw = moving ? Math.sin(player.t) * .6 : 0; u.lL.rotation.x = sw; u.lR.rotation.x = -sw; u.aL.rotation.x = -sw; u.aR.rotation.x = sw;
    player.pos.y = hAt(player.pos.x, player.pos.z); player.mesh.position.copy(player.pos); player.mesh.rotation.y = player.yaw; focus = player.pos;
  } else {
    const thr = work ? 0 : Math.max(-1, Math.min(1, (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? .6 : 0) + touchJoy.y));
    car.speed += thr * 9 * dt; car.speed -= car.speed * (thr ? .25 : 1.2) * dt; car.speed = Math.max(-4, Math.min(14, car.speed));
    const steer = Math.max(-1, Math.min(1, (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0) - touchJoy.x));
    car.yaw += steer * Math.min(1, Math.abs(car.speed) / 4) * 2.2 * dt * Math.sign(car.speed || 1);
    const nx = car.pos.x + Math.cos(car.yaw) * car.speed * dt, nz = car.pos.z - Math.sin(car.yaw) * car.speed * dt;
    if (!carBlocked(nx, nz, car.yaw)) { car.pos.x = nx; car.pos.z = nz; } else car.speed *= -.3;
    focus = car.pos;
  }
  car.pos.y = hAt(car.pos.x, car.pos.z); car.mesh.position.copy(car.pos); car.mesh.rotation.y = car.yaw;
  // наклон машины по рельефу
  { const c = Math.cos(car.yaw), s = Math.sin(car.yaw); const hf = hAt(car.pos.x + c, car.pos.z - s), hb = hAt(car.pos.x - c, car.pos.z + s); car.mesh.rotation.z = Math.atan2(hf - hb, 2); car.mesh.rotation.order = 'YZX'; }
  for (const a of ai) { a.t += a.v * dt; if (a.t > 1) { a.t = 1; a.v = -a.v; } if (a.t < 0) { a.t = 0; a.v = -a.v; } a.mesh.position.set(a.from + (a.to - a.from) * a.t, 0, a.fixed); a.mesh.rotation.y = a.v > 0 ? 0 : Math.PI; }
  camTarget.lerp(focus, .1); camera.position.copy(camTarget).add(CAM_OFF); camera.lookAt(camTarget);
  sun.target.position.copy(camTarget); sun.position.add(camTarget);
  // сеть: шлём свою позицию, плавно ведём чужих
  netSendT -= dt; if (netSendT <= 0) { netSendT = .1; const p = player.inCar ? car.pos : player.pos, y = player.inCar ? car.yaw : player.yaw; net.send({ t: 'move', x: p.x, z: p.z, yaw: y, inCar: player.inCar }); }
  for (const r of remote.values()) { r.walk.visible = !r.inCar; r.car.visible = r.inCar; const m = r.inCar ? r.car : r.walk;
    m.position.x += (r.tx - m.position.x) * Math.min(1, dt * 8); m.position.z += (r.tz - m.position.z) * Math.min(1, dt * 8); m.position.y = hAt(m.position.x, m.position.z);
    let dy = r.tyaw - m.rotation.y; dy = ((dy + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; m.rotation.y += dy * Math.min(1, dt * 8); }
  // подпись места и подсказки
  let near = null; for (const b of world.buildings) if (b.name) { const d = Math.hypot(X(b.i + b.w / 2) - focus.x, Z(b.j + b.d / 2) - focus.z); if (d < 5 && (!near || d < near.d)) near = { d, name: b.speakeasy ? 'BILLIARDS · спикизи в подвале (E — продать)' : b.name }; }
  const shop = curShop(); if (shop) near = { d: 0, name: `${shop}${shopOpen() ? '' : ' (закрыто до 8:00)'} · ` + SHOPS[shop].map(([k, p], n) => `${n + 1} — ${ITEM[k]} $${p}`).join(' · ') + (shop == 'Мельница' && inv.corn ? ' · E — смолоть кукурузу' : '') };
  if (nearBuilding('GARAGE')) near = { d: 0, name: 'GARAGE · E — ковать котёл (4 меди) / змеевик (2 меди)' };
  const ns = nearStill(); if (ns) { const st = BUILD_STEPS[ns.step]; near = { d: 0, name: `${ns.creek} · укрытие ${Math.round(ns.cover * 100)}% · глушь ${Math.round(ns.remote * 100)}% · вода ${Math.round(ns.flow * 100)}% · ` + (ns.stage == 'build' ? `сборка ${ns.step}/${BUILD_STEPS.length}: ${st.name} (нужно: ${Object.entries(st.need).map(([k, n]) => ITEM[k] + ' ' + inv[k] + '/' + n).join(', ')})` : { empty: 'аппарат готов — E: заложить брагу (мука 2, сахар 2, дрожжи 1)', ferment: 'брага бродит ' + Math.round(ns.mash / FERMENT_H * 100) + '%', ready: 'брага готова — E: гнать (дрова 3)', run: 'перегон ' + Math.round(ns.mash / RUN_H * 100) + '%', done: 'готово ' + ns.gallons + ' гал — E: забрать' }[ns.stage]) }; }
  else if (!shop && !near && nearTile([T.ROCK], 2)) near = { d: 0, name: 'Скалы · E — набрать камней (нужна машина рядом)' };
  else if (!shop && !near && nearTile([T.FOREST], 1)) near = { d: 0, name: 'Лес · E — нарубить дров' };
  if (work) near = { d: 0, name: `${work.name}… ${Math.round((1 - work.left / work.total) * 100)}%` };
  placeEl.style.display = near ? 'block' : 'none'; if (near) placeEl.textContent = near.name;
  document.getElementById('status').textContent = `$${eco.cash} · ${player.inCar ? `в машине ${eco.carJugs}/${car.cap} гал · ${Math.round(Math.abs(car.speed) * 4)} mph` : `в руках ${eco.jugs}/${WALK_CAP} гал` + (player.pos.distanceTo(car.pos) < 3 ? ' · E — сесть' : '')}`;
  document.getElementById('net').textContent = `${net.connected ? 'В сети' : 'Подключение…'} · ${myName} · игроков ${remote.size + 1} · округ: день ${netDay} ${String(Math.floor(netTime)).padStart(2, '0')}:${String(Math.floor(netTime % 1 * 60)).padStart(2, '0')} · подозрение ${Math.round(heat)}%`;
  document.getElementById('inv').textContent = Object.entries(inv).filter(([, n]) => n > 0).map(([k, n]) => `${ITEM[k]} ×${n}`).join(' · ') || 'пусто';
  drawMap(focus);
}
applyTime(); requestAnimationFrame(loop);
window.__game = { player, car, world, eco, inv, setTime: t => { time = t; }, blockedAt, carBlocked, keys, update, interact, buy, hAt, camTarget, getWork: () => work, BUILD_STEPS, timeScale, setZoom: v => { VIEW_H = v; resize(); }, remote, net, touchJoy };
