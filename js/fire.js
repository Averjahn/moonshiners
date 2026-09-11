// Огонь как в Far Cry 2: клеточный автомат на сетке тайлов карты.
// Каждая горючая клетка — «хитбокс на воспламенение»: копит жар от горящих соседей и
// вспыхивает, когда жар превысил порог своего топлива. Горящая клетка греет 8 соседей
// (сильнее по ветру), жжёт персонажей рядом и через время выгорает. Разметка отсеков
// (world.zone) сделана так, что соседей из другого отсека у клетки нет — за просеку огонь
// перебрасывает только искра, и у каждого пожара на это ограниченный бюджет.
// Модуль чистый: одинаково работает на сервере, в браузере и в тестах.
import { W, H, FUEL } from './world.js';

export const S = { UNBURNT: 0, BURNING: 1, BURNT: 2 };
// ignite — порог жара, heat — сколько жара клетка отдаёт соседу в секунду на пике,
// burn — секунд горит, dmg — урон персонажу в секунду прямо в огне.
export const FUEL_PROPS = {
  [FUEL.GRASS]:  { name: 'сухая трава', ignite: 1.0, heat: 1.0, burn: 5,  dmg: 5 },
  [FUEL.CROP]:   { name: 'кукуруза',    ignite: 0.7, heat: 1.4, burn: 7,  dmg: 7 },
  [FUEL.BRUSH]:  { name: 'кустарник',   ignite: 1.3, heat: 1.3, burn: 10, dmg: 8 },
  [FUEL.FOREST]: { name: 'лес',         ignite: 2.4, heat: 1.8, burn: 20, dmg: 11 },
  [FUEL.HOUSE]:  { name: 'деревянный дом', ignite: 3.2, heat: 2.4, burn: 45, dmg: 14 },   // занимается дольше всех, горит дольше всех
};
export const FIRE = {
  COOL: .2,             // жар остывает, если соседи перестали греть
  EMBERS_PER_FIRE: 1,   // сколько раз один пожар может перекинуться за просеку
  EMBER_RATE: .05,      // шанс искры в секунду с горящей лесной клетки при сильном ветре
  REGROW_H: 48,         // через сколько игровых часов гарь зарастает
};
const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, .7], [-1, 1, .7], [1, -1, .7], [-1, -1, .7]];

export function createFire(world) {
  const n = W * H;
  return { world, state: new Uint8Array(n), heat: new Float32Array(n), left: new Float32Array(n), fireOf: new Int32Array(n).fill(-1),
    burning: new Set(), warm: new Set(), burntAt: new Map(), embers: new Map(), nextFire: 1, changed: new Set(), jumps: [] };
}

// Поджечь клетку. fireId — к какому пожару она относится (для бюджета искр).
export function ignite(f, k, fireId) {
  const fuel = f.world.fuel[k]; if (!fuel || f.state[k] !== S.UNBURNT) return 0;
  const id = fireId > 0 ? fireId : f.nextFire++;
  if (!f.embers.has(id)) f.embers.set(id, FIRE.EMBERS_PER_FIRE);
  f.state[k] = S.BURNING; f.left[k] = FUEL_PROPS[fuel].burn; f.fireOf[k] = id; f.heat[k] = 0;
  f.warm.delete(k); f.burning.add(k); f.changed.add(k);
  return id;
}

// Сила огня клетки: разгорается, горит в полную силу, догорает.
export function intensity(f, k) {
  const p = FUEL_PROPS[f.world.fuel[k]]; if (!p || f.state[k] !== S.BURNING) return 0;
  const t = 1 - f.left[k] / p.burn; const ramp = t < .2 ? t / .2 : t > .8 ? (1 - t) / .2 : 1;
  return p.heat * (.5 + .5 * Math.max(0, ramp));
}

// Шаг симуляции. wind = { x, z, s }: направление (куда дует) в клетках и сила 0..1.
export function stepFire(f, dt, wind, rnd, nowHours = 0) {
  const { fuel, zone } = f.world; const lights = [];
  for (const k of f.burning) {
    const i = k % W, j = (k / W) | 0, I = intensity(f, k);
    for (const [di, dj, w] of N8) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const n = jj * W + ii; if (!fuel[n] || f.state[n] !== S.UNBURNT) continue;
      const along = (di * wind.x + dj * wind.z) / Math.hypot(di, dj);
      f.heat[n] += I * w * Math.max(.25, 1 + wind.s * along * .9) * dt; f.warm.add(n);
      if (f.heat[n] >= FUEL_PROPS[fuel[n]].ignite) lights.push(n, f.fireOf[k]);
    }
    // верховой пожар: при ветре искра летит через просеку в соседний отсек — но редко и по бюджету
    if (fuel[k] === FUEL.FOREST && wind.s > .35) {
      const id = f.fireOf[k], budget = f.embers.get(id) || 0;
      if (budget > 0 && rnd() < FIRE.EMBER_RATE * wind.s * dt) {
        const d = 2.5 + rnd() * 2.5, ti = Math.round(i + wind.x * d + (rnd() - .5) * 2), tj = Math.round(j + wind.z * d + (rnd() - .5) * 2);
        if (ti >= 0 && tj >= 0 && ti < W && tj < H) { const tk = tj * W + ti;
          if (fuel[tk] && f.state[tk] === S.UNBURNT && zone[tk] !== zone[k]) { f.embers.set(id, budget - 1); lights.push(tk, id); f.jumps.push({ from: k, to: tk }); } }
      }
    }
    f.left[k] -= dt;
  }
  for (let q = 0; q < lights.length; q += 2) ignite(f, lights[q], lights[q + 1]);
  for (const k of [...f.burning]) if (f.left[k] <= 0) { f.burning.delete(k); f.state[k] = S.BURNT; f.left[k] = 0; f.burntAt.set(k, nowHours); f.changed.add(k); }
  for (const n of f.warm) { if (f.state[n] !== S.UNBURNT) { f.warm.delete(n); continue; } f.heat[n] -= FIRE.COOL * dt; if (f.heat[n] <= 0) { f.heat[n] = 0; f.warm.delete(n); } }
  if (!f.burning.size) f.embers.clear();
}

// Гарь зарастает — иначе за неделю живого сервера карта станет чёрной.
export function regrow(f, nowHours) {
  for (const [k, t] of f.burntAt) if (nowHours - t >= FIRE.REGROW_H) { f.burntAt.delete(k); f.state[k] = S.UNBURNT; f.heat[k] = 0; f.fireOf[k] = -1; f.changed.add(k); }
}

// Урон огнём в секунду для персонажа в мировой точке (TS — размер клетки в метрах мира).
export function fireDamageAt(f, x, z, TS = 2) {
  const ci = Math.floor(x / TS), cj = Math.floor(z / TS); let dmg = 0;
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue;
    const k = j * W + i; if (f.state[k] !== S.BURNING) continue;
    const d = Math.hypot((i + .5) * TS - x, (j + .5) * TS - z) / TS;
    const fall = d < .8 ? 1 : d < 1.6 ? .45 : d < 2.5 ? .12 : 0; if (!fall) continue;
    const p = FUEL_PROPS[f.world.fuel[k]]; dmg += p.dmg * (intensity(f, k) / p.heat) * fall;
  }
  return dmg;
}

// Ближайшая горючая целая клетка к точке — куда плеснуть керосин.
export function nearestFuelCell(f, x, z, TS = 2, radius = 1.6) {
  const ci = Math.floor(x / TS), cj = Math.floor(z / TS); let best = -1, bd = 1e9; const R = Math.ceil(radius);
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue;
    const k = j * W + i; if (!f.world.fuel[k] || f.state[k] !== S.UNBURNT) continue;
    const d = Math.hypot((i + .5) * TS - x, (j + .5) * TS - z) / TS; if (d <= radius && d < bd) { bd = d; best = k; } }
  return best;
}

// Сеть: изменения тройками [клетка, состояние, остаток горения ×10].
export function takeChanges(f) { const out = []; for (const k of f.changed) out.push(k, f.state[k], Math.round(f.left[k] * 10)); f.changed.clear(); return out; }
export function snapshot(f) { const out = []; for (const k of f.burning) out.push(k, S.BURNING, Math.round(f.left[k] * 10)); for (const k of f.burntAt.keys()) out.push(k, S.BURNT, 0); return out; }
export function applyChanges(f, arr, nowHours = 0) {
  for (let q = 0; q < arr.length; q += 3) { const k = arr[q], st = arr[q + 1];
    f.state[k] = st; f.changed.add(k);
    if (st === S.BURNING) { f.left[k] = arr[q + 2] / 10; f.burning.add(k); f.burntAt.delete(k); }
    else if (st === S.BURNT) { f.left[k] = 0; f.burning.delete(k); f.burntAt.set(k, nowHours); }
    else { f.burning.delete(k); f.burntAt.delete(k); f.heat[k] = 0; } }
}
// Клиент-зеркало: пламя догорает плавно между пакетами, но гаснет только по слову сервера.
export function tickMirror(f, dt) { for (const k of f.burning) f.left[k] = Math.max(.3, f.left[k] - dt); }
