// Генерация мира: чистые данные без three.js. Большая карта 192×192: холмы, река Пигг, ручьи,
// город Роки-Маунт в долине, точки у ручьёв для перегонных кубов.
export const W = 192, H = 192, CI = 96, CJ = 96;
export const T = { GRASS: 0, ROAD: 1, MAIN: 2, WATER: 3, BANK: 4, RAIL: 5, FOREST: 6, FIELD: 7, DIRT: 8, PLAZA: 9, YARD: 10, ROCK: 11, MEADOW: 12 };
export const idx = (i, j) => j * W + i, inb = (i, j) => i >= 0 && j >= 0 && i < W && j < H;
export const CREEK_NAMES = ['Maggodee Creek', 'Gills Creek', 'Otter Creek', 'Story Creek', 'Teels Creek', 'Runnett Bag Creek', 'Chestnut Creek', 'Snow Creek'];

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function generate(seed = 7) {
  const rng = mulberry32(seed * 7919 + 13);
  const R = () => rng(), RI = (a, b) => a + Math.floor(rng() * (b - a + 1)), pick = a => a[Math.floor(rng() * a.length)];
  const NG = new Float32Array(64 * 64); for (let k = 0; k < NG.length; k++) NG[k] = rng();
  const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi; const g = (a, b) => NG[((a & 63) * 64 + (b & 63))]; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return (g(xi, yi) * (1 - sx) + g(xi + 1, yi) * sx) * (1 - sy) + (g(xi, yi + 1) * (1 - sx) + g(xi + 1, yi + 1) * sx) * sy; };
  const fbm = (x, y) => .5 * vnoise(x, y) + .25 * vnoise(x * 2 + 7, y * 2 + 3) + .125 * vnoise(x * 4 + 11, y * 4 + 5) + .125 * vnoise(x * 8 + 2, y * 8 + 9);

  const tiles = new Uint8Array(W * H), occ = new Uint8Array(W * H), inTown = new Uint8Array(W * H), solid = new Uint8Array(W * H), creekId = new Int8Array(W * H).fill(-1);
  const buildings = [], trees = [], props = [], lamps = [], stills = [], fences = [], creeks = [], rocks = [];
  // город: эллипс с рваным краем
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const dx = (i - CI) / 28, dy = (j - CJ) / 22; inTown[idx(i, j)] = (dx * dx + dy * dy) < 1 + (fbm(i / 9, j / 9) - .5) * .7 ? 1 : 0; }
  const townDist = (i, j) => { const dx = (i - CI) / 28, dy = (j - CJ) / 22; return Math.sqrt(dx * dx + dy * dy); };

  // ---- река Пигг: с севера на юг, меандры, ширина 3 клетки
  const riverX = []; for (let j = 0; j < H; j++) riverX[j] = CI - 22 + Math.sin(j / 17) * 7 + (fbm(3, j / 9) - .5) * 14;
  const water = (i, j, id) => { if (!inb(i, j)) return; const k = idx(i, j); tiles[k] = T.WATER; inTown[k] = 0; if (creekId[k] < 0) creekId[k] = id; };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const d = Math.abs(i - riverX[j]); if (d < 1.9) water(i, j, 99); else if (d < 3.2 && !tiles[idx(i, j)]) { tiles[idx(i, j)] = T.BANK; inTown[idx(i, j)] = 0; } }
  // ---- ручьи: из холмов к реке. Не заходят в город.
  const nCreeks = 8;
  for (let c = 0; c < nCreeks; c++) {
    let si, sj, tries = 0;
    do { si = RI(6, W - 7); sj = RI(6, H - 7); tries++; } while (tries < 500 && (townDist(si, sj) < 1.9 || Math.abs(si - riverX[sj]) < 30 || creeks.some(o => Math.hypot(o.src[0] - si, o.src[1] - sj) < 22)));
    const path = []; let x = si, y = sj, len = 0;
    // цель: ближайшая точка реки на той же широте ± дрейф
    while (len < 400) {
      const ty = Math.max(2, Math.min(H - 3, y + (fbm(x / 15 + c * 3, y / 15) - .5) * 1.5));
      const tx = riverX[Math.round(ty)]; const dx = tx - x, dy = ty - y; const d = Math.hypot(dx, dy); if (d < 2.2) break;
      const px = -dy / d, py = dx / d, wob = (fbm(len / 7 + c * 11, c * 5) - .5) * 2.2;
      x += (dx / d) * .75 + px * wob * .35; y += (dy / d) * .75 + py * wob * .35; len++;
      const ii = Math.round(x), jj = Math.round(y); if (!inb(ii, jj)) break;
      if (inTown[idx(ii, jj)]) { break; }
      path.push([x, y]);
    }
    if (path.length < 25) { c--; if (tries >= 500) break; continue; }
    const id = creeks.length; creeks.push({ id, name: CREEK_NAMES[id % CREEK_NAMES.length], src: [si, sj], path, spots: [] });
    for (const [px, py] of path) { const ii = Math.round(px), jj = Math.round(py); water(ii, jj, id); }
  }
  // берега ручьёв
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { if (tiles[idx(i, j)] != T.WATER) continue; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { if (!inb(i + a, j + b)) continue; const k = idx(i + a, j + b); if (!tiles[k]) { tiles[k] = T.BANK; inTown[k] = 0; } } }
  // ---- поле расстояний до воды (BFS) и высоты
  const wdist = new Int16Array(W * H).fill(9999); const q = []; for (let k = 0; k < W * H; k++) if (tiles[k] == T.WATER) { wdist[k] = 0; q.push(k); }
  for (let h = 0; h < q.length; h++) { const k = q[h], i = k % W, j = (k / W) | 0; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { if (!inb(i + a, j + b)) continue; const n = idx(i + a, j + b); if (wdist[n] > wdist[k] + 1) { wdist[n] = wdist[k] + 1; q.push(n); } } }
  const hills = (i, j) => fbm(i / 22 + 5, j / 22 + 9) * 1.15 + fbm(i / 7 + 1, j / 7 + 4) * .18;
  const heightAt = (i, j) => { // в клетках (может быть дробным)
    const ii = Math.max(0, Math.min(W - 1, Math.round(i))), jj = Math.max(0, Math.min(H - 1, Math.round(j)));
    const td = townDist(i, j), townF = Math.max(0, Math.min(1, (td - 1.05) / .7)); const tf = townF * townF * (3 - 2 * townF);
    const wd = Math.min(1, wdist[idx(ii, jj)] / 7); const wf = wd * wd * (3 - 2 * wd);
    return (Math.max(0, hills(i, j) - .28) * 11) * tf * (.12 + .88 * wf);
  };
  const hgt = new Float32Array((W + 1) * (H + 1)); // высоты вершин
  for (let r = 0; r <= H; r++) for (let c = 0; c <= W; c++) {
    let h = heightAt(c - .5, r - .5), wat = false, bank = false;
    for (const [a, b] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) { if (!inb(c + a, r + b)) continue; const t = tiles[idx(c + a, r + b)]; if (t == T.WATER) wat = true; else if (t == T.BANK) bank = true; }
    if (wat) h = -.75; else if (bank) h = Math.min(h, -.1);
    hgt[r * (W + 1) + c] = h;
  }
  // ---- железная дорога
  const railI = CI + 31;
  for (let j = 0; j < H; j++) { const k = idx(railI, j); if (tiles[k] == T.WATER) { props.push({ t: 'trestle', i: railI, j }); } tiles[k] = T.RAIL; inTown[k] = 0; inTown[idx(railI - 1, j)] = 0; inTown[idx(railI + 1, j)] = 0; }
  // ---- улицы
  const MI0 = CI + 3, MI1 = CI + 6, MJ0 = CJ - 1, MJ1 = CJ + 2;
  const cols = [-24, -14, -5, 4.5, 14, 24].map((o, k) => CI + o + ((k == 0 || k == 5) ? RI(-1, 1) : 0));
  const rows = [-19, -10, .5, 10, 19].map((o, k) => CJ + o + ((k == 0 || k == 4) ? RI(-1, 1) : 0));
  const road = (i, j, t) => { if (!inb(i, j)) return; const k = idx(i, j); if (tiles[k] == T.WATER || tiles[k] == T.BANK || tiles[k] == T.RAIL) return; tiles[k] = t; occ[k] = 1; };
  for (const c of cols) { const main = c == CI + 4.5; const i0 = main ? MI0 : c - 1, i1 = main ? MI1 : c + 1; for (let i = i0; i <= i1; i++) for (let j = 0; j < H; j++) if (inTown[idx(i, j)] || inTown[idx(main ? CI + 4 : c, j)]) road(i, j, main ? T.MAIN : T.ROAD); }
  for (const r of rows) { const main = r == CJ + .5; const j0 = main ? MJ0 : r - 1, j1 = main ? MJ1 : r + 1; for (let j = j0; j <= j1; j++) for (let i = 0; i < W; i++) if (inTown[idx(i, j)] || inTown[idx(i, main ? CJ : r)]) road(i, j, main ? T.MAIN : T.ROAD); }
  // грунтовки за город: полоса 3, через ручьи — броды
  const ford = (i, j) => { if (!inb(i, j)) return; const k = idx(i, j); if (tiles[k] == T.RAIL) return; if (tiles[k] == T.WATER) { props.push({ t: 'ford', i, j }); tiles[k] = T.DIRT; occ[k] = 1; return; } if (tiles[k] == T.BANK) { tiles[k] = T.DIRT; occ[k] = 1; return; } road(i, j, T.DIRT); };
  const band3 = (i, j, hor) => { for (let q = -1; q <= 1; q++) ford(hor ? i : i + q, hor ? j + q : j); };
  const wob = (t, s) => Math.round((fbm(t / 6 + s, s) - .5) * 6);
  let pj = CJ; for (let i = 0; i < W; i++) { const j = (inTown[idx(i, CJ)] || Math.abs(i - railI) <= 2) ? CJ + .5 : CJ + wob(i, 1.3); if (inTown[idx(i, CJ)]) { pj = CJ; continue; } const jj = Math.round(j); while (pj != jj) { pj += Math.sign(jj - pj); band3(i, pj, true); } band3(i, jj, true); }
  let pi = CI + 4; for (let j = 0; j < H; j++) { const i = inTown[idx(CI + 4, j)] ? CI + 4 : CI + 4 + wob(j, 4.1); if (inTown[idx(CI + 4, j)]) { pi = CI + 4; continue; } while (pi != i) { pi += Math.sign(i - pi); band3(pi, j, false); } band3(i, j, false); }
  // мост через реку по Main
  for (let i = 0; i < W; i++) for (let j = MJ0; j <= MJ1; j++) { const k = idx(i, j); if (tiles[k] == T.WATER || tiles[k] == T.BANK) { tiles[k] = T.MAIN; occ[k] = 1; props.push({ t: 'bridge', i, j, edge: j == MJ0 ? 'N' : j == MJ1 ? 'S' : null }); } }
  for (let j = MJ0; j <= MJ1; j++) tiles[idx(railI, j)] = T.RAIL; props.push({ t: 'crossing', i: railI, j: MJ0 });
  // ---- лес, луга, поля, скалы (по высоте)
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = idx(i, j); if (inTown[k] || tiles[k]) continue;
    const h = heightAt(i, j), n = fbm(i / 5 + 3, j / 5 + 8), td = townDist(i, j);
    if (h > 7.2 && n > .4) tiles[k] = T.ROCK;
    else if (h > 1.2 && n > .38) tiles[k] = T.FOREST;
    else if (h < 1.0 && td < 1.9 && fbm(i / 7 + 20, j / 7 + 2) > .52) tiles[k] = T.FIELD;
    else if (h > .5 && n < .3) tiles[k] = T.MEADOW;
  }
  // ---- здания города
  const dist = (i, j) => Math.hypot((i - CI - 4.5) / 1.3, (j - CJ - .5));
  const free = (i, j, w, d) => { for (let y = j; y < j + d; y++) for (let x = i; x < i + w; x++) { if (!inb(x, y)) return false; const k = idx(x, y); if (occ[k] || tiles[k] != T.GRASS || !inTown[k]) return false; } return true; };
  const take = (i, j, w, d, t) => { for (let y = j; y < j + d; y++) for (let x = i; x < i + w; x++) { occ[idx(x, y)] = 1; if (t != null) tiles[idx(x, y)] = t; } };
  const add = b => { buildings.push(b); take(b.i, b.j, b.w, b.d, T.YARD); for (let y = b.j; y < b.j + b.d; y++) for (let x = b.i; x < b.i + b.w; x++) solid[idx(x, y)] = 1; return b; };
  const court = { i: CI + 9, j: CJ - 6, w: 3, d: 3, f: 2, kind: 'court', front: 'S', roof: 'flat', wall: '#e8dfcf', roofc: '#8e8f87', ridge: 'i', name: 'Суд округа' };
  take(CI + 8, CJ - 7, 5, 5, T.PLAZA); add(court);
  for (let x = CI + 8; x < CI + 13; x++) for (let y = CJ - 7; y < CJ - 2; y++) if (!(x >= court.i && x < court.i + 3 && y >= court.j && y < court.j + 3)) { occ[idx(x, y)] = 1; tiles[idx(x, y)] = T.PLAZA; }
  const church = { i: CI - 12, j: CJ + 4, w: 2, d: 3, f: 1.6, kind: 'church', front: 'E', roof: 'gable', wall: '#f4efe4', roofc: '#6f7f8a', ridge: 'j', name: 'Церковь' };
  if (free(church.i, church.j, 2, 3)) add(church);
  for (let y = CJ + 4; y < CJ + 8; y++) for (let x = railI - 4; x < railI; x++) { occ[idx(x, y)] = 0; tiles[idx(x, y)] = T.GRASS; inTown[idx(x, y)] = 1; }
  const depot = { i: railI - 4, j: CJ + 4, w: 2, d: 4, f: 1, kind: 'depot', front: 'E', roof: 'gable', wall: '#b5563f', roofc: '#5c4a3a', ridge: 'j', name: 'Депо' };
  if (free(depot.i, depot.j, 2, 4)) add(depot);
  for (let j = CJ + 4; j < CJ + 18; j++) { const i = Math.round(riverX[j]) + 4; if (free(i, j, 2, 2)) { add({ i, j, w: 2, d: 2, f: 2, kind: 'mill', front: 'S', roof: 'gable', wall: '#b5563f', roofc: '#5c4a3a', ridge: 'i', wheel: true, name: 'Мельница' }); break; } }
  const roadTiles = []; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const t = tiles[idx(i, j)]; if ((t == T.ROAD || t == T.MAIN) && inTown[idx(i, j)]) roadTiles.push([i, j]); }
  roadTiles.sort((a, b) => dist(...a) - dist(...b));
  const SHOP_NAMES = ['DRUG STORE', 'HARDWARE', 'BANK', 'HOTEL', 'BARBER', 'GROCERY', 'FEED & SEED', 'CAFE', 'GARAGE', 'DRY GOODS', 'POST OFFICE', 'TAILOR', 'BILLIARDS', 'PHARMACY'];
  let speakeasy = null;
  for (const [ri, rj] of roadTiles) {
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const ni = ri + dx, nj = rj + dy; if (!inb(ni, nj)) continue;
      const dc = dist(ni, nj), onMain = tiles[idx(ri, rj)] == T.MAIN;
      let w, d, f, kind, roof, wall, roofc, i, j, ridge, front, name = null;
      const along = dx == 0;
      if (onMain && dc < 16) {
        kind = 'shop'; w = RI(1, 2); d = 2; if (!along) { w = 2; d = RI(1, 2); } f = dc < 8 && R() < .35 ? 3 : (R() < .7 ? 2 : 1); roof = R() < .8 ? 'flat' : 'gable';
        wall = pick(['#c96f4f', '#b8604a', '#d9a878', '#e8dfcf', '#c9a56b', '#9c6b52']); roofc = '#7a7268'; name = pick(SHOP_NAMES);
      } else if (dc < 24) {
        kind = 'house'; w = RI(1, 2); d = RI(1, 2); f = R() < .35 ? 2 : 1; roof = 'gable';
        wall = pick(['#f4efe4', '#f2e5c9', '#dfe6d3', '#e9d5b8', '#cfd8e0']); roofc = pick(['#8a6b52', '#6f7f8a', '#b8503f', '#5c6b4f']);
        if (R() < .35) { if (!free(ni, nj, 1, 1)) continue; take(ni, nj, 1, 1, T.YARD); if (R() < .6) trees.push({ i: ni + R(), j: nj + R(), r: .35 + R() * .25 }); continue; }
      } else {
        kind = 'cottage'; w = RI(1, 2); d = RI(1, 2); f = 1; roof = 'gable';
        wall = pick(['#e7d6b0', '#d8c39a', '#f4efe4', '#c9b58f']); roofc = pick(['#8a6b52', '#5c4a3a', '#7d7d70']);
        if (R() < .5) { if (!free(ni, nj, 1, 1)) continue; if (R() < .6) trees.push({ i: ni + R(), j: nj + R(), r: .4 + R() * .3 }); take(ni, nj, 1, 1, T.YARD); continue; }
      }
      const sb = kind == 'shop' ? 0 : 1;
      if (dy == 1) { i = ni - (along ? RI(0, w - 1) : 0); j = nj + sb; front = 'N'; ridge = 'i'; }
      else if (dy == -1) { i = ni; j = nj - d + 1 - sb; front = 'S'; ridge = 'i'; }
      else if (dx == 1) { i = ni + sb; j = nj; front = 'W'; ridge = 'j'; }
      else { i = ni - w + 1 - sb; j = nj; front = 'E'; ridge = 'j'; }
      if (!free(i, j, w, d)) continue;
      if (sb) {
        const yw = along ? w : 1, yd = along ? 1 : d; const yi0 = along ? i : ni, yj0 = along ? nj : j;
        if (!free(yi0, yj0, yw, yd)) continue; take(yi0, yj0, yw, yd, T.YARD);
        if (R() < .4) trees.push({ i: yi0 + R() * yw, j: yj0 + R() * yd, r: .3 + R() * .2 });
        fences.push({ i: yi0, j: yj0, w: yw, d: yd, side: front });
      }
      const b = add({ i, j, w, d, f, kind, roof, wall, roofc, ridge, front, name, porch: kind != 'shop' && R() < .7, chimney: R() < .8, awning: kind == 'shop' && R() < .6 });
      if (!speakeasy && name == 'BILLIARDS') { speakeasy = b; b.speakeasy = true; }
    }
  }
  if (!speakeasy) { const b = buildings.find(b => b.kind == 'shop'); if (b) { b.speakeasy = true; b.name = 'BILLIARDS'; speakeasy = b; } }
  // ---- деревья и камни
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = idx(i, j), t = tiles[k];
    if (t == T.WATER) solid[k] = 1;
    const nearRoad = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => inb(i + a, j + b) && [T.ROAD, T.MAIN, T.DIRT].includes(tiles[idx(i + a, j + b)]));
    if (nearRoad && !inTown[k]) continue;
    if (t == T.FOREST) { const n = (R() < .7 ? 1 : 0) + (fbm(i / 3, j / 3) > .6 ? 1 : 0); for (let q = 0; q < n; q++) trees.push({ i: i + R(), j: j + R(), r: .45 + R() * .35, pine: R() < .7 }); }
    else if (t == T.ROCK) { if (R() < .5) rocks.push({ i: i + R(), j: j + R(), r: .3 + R() * .5 }); if (R() < .2) trees.push({ i: i + R(), j: j + R(), r: .3 + R() * .2, pine: true }); }
    else if (t == T.BANK && !inTown[k] && R() < .25) trees.push({ i: i + R(), j: j + R(), r: .4 + R() * .3, pine: R() < .3 });
    else if (t == T.MEADOW && R() < .04) trees.push({ i: i + R(), j: j + R(), r: .4 + R() * .3 });
    else if (t == T.GRASS && !occ[k] && inTown[k] && R() < .05) trees.push({ i: i + R(), j: j + R(), r: .35 + R() * .3 });
    else if (t == T.GRASS && !occ[k] && !inTown[k] && R() < .03) trees.push({ i: i + R(), j: j + R(), r: .4 + R() * .3 });
  }
  for (const p of props) if (p.t == 'bridge' || p.t == 'ford') solid[idx(p.i, p.j)] = 0;
  // ---- фонари
  for (let i = 0; i < W; i++) if (tiles[idx(i, CJ)] == T.MAIN && inTown[idx(i, CJ)] && i % 4 == 0) lamps.push({ i: i + .5, j: (i % 8 == 0) ? MJ0 + .12 : MJ1 + .88 });
  for (let j = 0; j < H; j++) if (tiles[idx(CI + 4, j)] == T.MAIN && inTown[idx(CI + 4, j)] && j % 4 == 1 && (j < MJ0 || j > MJ1)) lamps.push({ i: (j % 8 == 1) ? MI0 + .12 : MI1 + .88, j: j + .5 });
  // ---- точки для стиллов: на берегу ручья, подальше от дорог, с лесным укрытием
  const roadDist = (i, j) => { let best = 99; for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) { if (!inb(i + di, j + dj)) continue; const t = tiles[idx(i + di, j + dj)]; if (t == T.DIRT || t == T.ROAD || t == T.MAIN) best = Math.min(best, Math.hypot(di, dj)); } return best; };
  const cover = (i, j) => { let n = 0, c = 0; for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { if (!inb(i + di, j + dj)) continue; c++; if (tiles[idx(i + di, j + dj)] == T.FOREST) n++; } return n / c; };
  for (const cr of creeks) {
    const cand = [];
    for (let s = 12; s < cr.path.length - 6; s += 5) { const [px, py] = cr.path[s]; const ci = Math.round(px), cj = Math.round(py);
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const i = ci + a * 2, j = cj + b * 2; if (!inb(i, j)) continue; const k = idx(i, j); if (tiles[k] != T.GRASS && tiles[k] != T.FOREST && tiles[k] != T.MEADOW && tiles[k] != T.BANK) continue; if (occ[k] || solid[k] || inTown[k]) continue;
        if (townDist(i, j) < 1.5) continue; cand.push({ i, j, cover: cover(i, j), remote: Math.min(1, roadDist(i, j) / 9), s }); } }
    cand.sort((a, b) => (b.cover + b.remote) - (a.cover + a.remote));
    for (const c of cand) { if (cr.spots.length >= 3) break; if (cr.spots.some(o => Math.hypot(o.i - c.i, o.j - c.j) < 14)) continue;
      const flow = .35 + .65 * Math.min(1, c.s / 80); // ниже по течению — больше воды для змеевика
      const sp = { id: stills.length, i: c.i + .5, j: c.j + .5, creek: cr.name, cover: c.cover, remote: c.remote, flow, built: false, mash: 0, stage: 'empty', gallons: 0 };
      cr.spots.push(sp); stills.push(sp); take(c.i, c.j, 1, 1, null); }
  }
  const start = { i: CI + 5, j: CJ - 2.5 }; const carStart = { i: CI + 1.5, j: CJ + .5 };
  return { W, H, tiles, solid, inTown, buildings, trees, rocks, props, lamps, stills, creeks, fences, start, carStart, railI, riverX, hgt, main: { MI0, MI1, MJ0, MJ1 }, speakeasy };
}
