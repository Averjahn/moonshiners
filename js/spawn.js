// ВЫСАДКА У ЗАВЕДЕНИЯ. Телепорт обязан ставить игрока туда, откуда он может уйти:
// проверять одну точку мало — движение щупает четыре точки вокруг персонажа, и угол дома,
// свободный «по центру», зажимает его намертво. Модуль чистый, поэтому проверяется тестом
// по всем заведениям и фермам разом.
export const PLAYER_R = .3;      // тот же радиус, что и в движении
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [.7, .7], [-.7, .7], [.7, -.7], [-.7, -.7]];

// можно ли стоять: свободна и сама точка, и четыре пробы вокруг — как при ходьбе
export function canStand(blocked, x, z, r = PLAYER_R) {
  return !blocked(x, z) && !blocked(x + r, z) && !blocked(x - r, z) && !blocked(x, z + r) && !blocked(x, z - r);
}
// можно ли уйти: хотя бы три направления из восьми ведут на два метра в сторону.
// Так отсекаются карманы между стеной, забором и деревом, откуда формально «можно стоять».
export function canLeave(blocked, x, z, r = PLAYER_R, step = 2) {
  let ways = 0;
  for (const [dx, dz] of DIRS) {
    let ok = true;
    for (let t = .5; t <= step; t += .5) if (!canStand(blocked, x + dx * t, z + dz * t, r)) { ok = false; break; }
    if (ok && ++ways >= 3) return true;
  }
  return false;
}
// дверь заведения: со стороны фасада здания, а не всегда с юга
export function doorPoint(b, TS = 2, out = 2.4) {
  const cx = (b.i + b.w / 2) * TS, cz = (b.j + b.d / 2) * TS;
  const halfW = (b.w / 2) * TS, halfD = (b.d / 2) * TS;
  switch (b.front) {
    case 'N': return { x: cx, z: cz - halfD - out };
    case 'E': return { x: cx + halfW + out, z: cz };
    case 'W': return { x: cx - halfW - out, z: cz };
    default:  return { x: cx, z: cz + halfD + out };   // 'S' и всё, что не указано
  }
}
// Ищем место кольцами вокруг двери: сначала то, откуда точно можно уйти, и только если
// совсем ничего не нашлось — любое, где можно хотя бы стоять.
export function spawnNear(blocked, p, r = PLAYER_R, maxR = 16) {
  if (canStand(blocked, p.x, p.z, r) && canLeave(blocked, p.x, p.z, r)) return { ...p, ring: 0 };
  let fallback = null;
  for (let ring = 1; ring <= maxR; ring += .8) {
    const n = Math.max(8, Math.round(ring * 6));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, x = p.x + Math.cos(a) * ring, z = p.z + Math.sin(a) * ring;
      if (!canStand(blocked, x, z, r)) continue;
      if (canLeave(blocked, x, z, r)) return { x, z, ring };
      if (!fallback) fallback = { x, z, ring };
    }
  }
  return fallback || { ...p, ring: -1 };
}
// точка высадки у здания или у амбара фермы
export function spawnAtBuilding(blocked, b, TS = 2) { return spawnNear(blocked, doorPoint(b, TS)); }
export function spawnAtFarm(blocked, farm, TS = 2) { return spawnNear(blocked, { x: (farm.i + 1) * TS, z: (farm.j + 2.6) * TS }); }

// Препятствия мира без клиентской сцены: то же, что видит движение, — сетка solid и деревья.
export function worldBlocked(world, TS = 2) {
  const W = world.W, H = world.H;
  const buckets = new Map();
  for (const t of world.trees) { const k = Math.floor(t.j) * W + Math.floor(t.i); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(t); }
  return (x, z) => {
    const i = Math.floor(x / TS), j = Math.floor(z / TS);
    if (i < 0 || j < 0 || i >= W || j >= H) return true;
    if (world.solid[j * W + i]) return true;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const list = buckets.get((j + dj) * W + (i + di)); if (!list) continue;
      for (const t of list) { const dx = t.i * TS - x, dz = t.j * TS - z; if (dx * dx + dz * dz < .16) return true; }
    }
    return false;
  };
}
