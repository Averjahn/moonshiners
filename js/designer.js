// СПРАВОЧНИК ДИЗАЙНЕРА (Q+W+E). Каталог всех объектов игры: живая заглушка из кода,
// габариты и палитра, снятые с неё же, состояния и анимации, которые нужно нарисовать.
// ТЗ в Markdown собирается из этого же каталога — оно не может разойтись с игрой.
import * as THREE from 'three';
import { CARS as ECARS, SERVICES as ESERV, JOBS as EJOBS, GOODS as EGOODS, DEALERS as EDEALERS, dealerModels } from './economy.js';

const GENERAL = `# Moonshiners · ТЗ для художника

Изометрическая 3D-игра (ортографическая камера сверху-сбоку, угол как в классической изометрии),
округ Франклин, Вирджиния, 1929 год. Стиль — светлый «акварельный юг»: тёплый низкополигональный,
мягкие тени, без фотореализма. Всё, что сейчас в игре, — заглушки из примитивов; их габариты,
пивоты и цвета ниже — это рабочий контракт, под который нужно рисовать.

## Общие требования
- Формат: glTF 2.0 бинарный (.glb), ось Y вверх, 1 единица = 1 метр.
- Пивот: центр основания объекта на земле (кроме эффектов — центр спрайта).
- Направление «вперёд»: персонажи смотрят по +Z, машины — капотом по +X.
- Текстуры: атлас 512×512 (персонажи, машины) или 256×256 (мелочь); допускаются vertex colors.
- Имена файлов: moon_<категория>_<id>.glb, клипы анимаций — точно как в таблицах ниже.
- Скелет персонажей общий (до 24 костей): можно переиспользовать анимации между самогонщиком, агентом, фермером и продавцом.
- Эффекты огня и дыма — спрайт-листы PNG с альфой, 4×4 кадра.
- Бюджет треугольников указан на каждый объект; камера далеко — мелкие детали не читаются.
`;

// палитра, габариты и треугольники — снимаем с живого объекта
function inspect(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj), size = new THREE.Vector3(); box.getSize(size);
  const colors = new Set(); let tris = 0; const c = new THREE.Color();
  obj.traverse(o => {
    const g = o.geometry; if (!g) return;
    if (!o.isSprite && !o.isPoints) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m && m.color && !m.vertexColors) colors.add('#' + m.color.getHexString());
    const col = g.attributes.color; if (col && mats[0]?.vertexColors) { const step = Math.max(3, Math.floor(col.count / 60)); for (let q = 0; q < col.count && colors.size < 18; q += step) { c.setRGB(col.getX(q), col.getY(q), col.getZ(q)); colors.add('#' + c.getHexString()); } }
  });
  return { w: size.x, h: size.y, d: size.z, tris: Math.round(tris), palette: [...colors].slice(0, 18) };
}
const fmt = v => (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '');

// ================= ГОРОД: всё считается с игровой карты =================
const KIND_LABEL = { shop: 'Лавка', house: 'Жилой дом', cottage: 'Домик на окраине', court: 'Суд округа', church: 'Церковь', depot: 'Депо', mill: 'Мельница' };
const KIND_COL = { shop: '#c96f4f', house: '#e9d5b8', cottage: '#d8c39a', court: '#e8dfcf', church: '#f4efe4', depot: '#b5563f', mill: '#8a5a3a' };
function townData(F) {
  const { world, T } = F, W = 192, H = 192;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (world.inTown[j * W + i]) { x0 = Math.min(x0, i); y0 = Math.min(y0, j); x1 = Math.max(x1, i + 1); y1 = Math.max(y1, j + 1); }
  x0 = Math.max(0, x0 - 3); y0 = Math.max(0, y0 - 3); x1 = Math.min(W, x1 + 3); y1 = Math.min(H, y1 + 3);
  const town = world.buildings.filter(b => !b.rural);
  const count = {}; for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) { const k = j * W + i; if (world.inTown[k]) count[world.tiles[k]] = (count[world.tiles[k]] || 0) + 1; }
  // кварталы — связные куски городской земли между улицами
  const street = t => t === T.ROAD || t === T.MAIN || t === T.RAIL || t === T.WATER || t === T.BANK || t === T.PLAZA || t === T.DIRT;
  const seen = new Uint8Array(W * H), blocks = [];
  for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) { const k0 = j * W + i; if (seen[k0] || !world.inTown[k0] || street(world.tiles[k0])) continue;
    let n = 0; const st = [k0]; seen[k0] = 1;
    while (st.length) { const k = st.pop(), ci = k % W, cj = (k / W) | 0; n++;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = ci + a, jj = cj + b; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const q = jj * W + ii;
        if (!seen[q] && world.inTown[q] && !street(world.tiles[q])) { seen[q] = 1; st.push(q); } } }
    if (n >= 6) blocks.push(n); }
  const runs = get => { let r = 0, on = false; for (let q = 0; q < W; q++) { const t = get(q), sx = t === T.ROAD || t === T.MAIN; if (sx && !on) r++; on = sx; } return r; };
  const nsStreets = runs(q => world.inTown[91 * W + q] ? world.tiles[91 * W + q] : -1);   // ряд между поперечными улицами
  const ewStreets = runs(q => world.inTown[q * W + 87] ? world.tiles[q * W + 87] : -1);   // столбец между продольными
  const ORDER = { court: 0, church: 1, depot: 2, mill: 3, shop: 4 };
  const named = town.filter(b => ORDER[b.kind] != null).sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || String(a.name).localeCompare(String(b.name)) || a.j - b.j || a.i - b.i);
  named.forEach((b, n) => { b._num = n + 1; });
  return { x0, y0, x1, y1, wM: (x1 - x0) * 2, hM: (y1 - y0) * 2, town, named, count, blocks, nsStreets, ewStreets,
    lamps: world.lamps.length, fences: world.fences.length, trees: world.trees.filter(t => world.inTown[Math.floor(t.j) * W + Math.floor(t.i)]).length,
    mainW: (world.main.MI1 - world.main.MI0 + 1) * 2 };
}
function drawPlan(F, td, cv) {
  const cell = F.PX, w = (td.x1 - td.x0) * cell, h = (td.y1 - td.y0) * cell, pad = 34;
  cv.width = w + pad * 2; cv.height = h + pad * 2 + 92; const c = cv.getContext('2d'); c.font = '11px Georgia';
  c.fillStyle = '#f6efdd'; c.fillRect(0, 0, cv.width, cv.height);
  c.drawImage(F.gc, td.x0 * F.PX, td.y0 * F.PX, w, h, pad, pad, w, h);                  // та же земля, что в игре
  c.fillStyle = 'rgba(255,250,235,.28)'; c.fillRect(pad, pad, w, h);
  const P = (i, j) => [pad + (i - td.x0) * cell, pad + (j - td.y0) * cell];
  for (const f of F.world.fences) { const [x, y] = P(f.i, f.j); c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1.5; c.strokeRect(x + 1, y + 1, f.w * cell - 2, f.d * cell - 2); }
  for (const b of td.town) { const [x, y] = P(b.i, b.j), bw = b.w * cell, bh = b.d * cell;
    c.fillStyle = KIND_COL[b.kind] || '#ccc'; c.fillRect(x, y, bw, bh); c.strokeStyle = '#3a2a1a'; c.lineWidth = 1.2; c.strokeRect(x + .5, y + .5, bw - 1, bh - 1);
    if (b.front) { c.fillStyle = '#3a2a1a'; const m = 3; const fx = { S: [x + bw / 2 - m, y + bh - 2, m * 2, 3], N: [x + bw / 2 - m, y - 1, m * 2, 3], E: [x + bw - 2, y + bh / 2 - m, 3, m * 2], W: [x - 1, y + bh / 2 - m, 3, m * 2] }[b.front]; if (fx) c.fillRect(...fx); }
    if (b._num) { const cx = x + bw / 2, cy = y + bh / 2; c.fillStyle = '#3a2a1a'; c.beginPath(); c.arc(cx, cy, 8, 0, 7); c.fill(); c.fillStyle = '#f6efdd'; c.font = 'bold 10px Georgia'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(b._num, cx, cy + .5); } }
  for (const l of F.world.lamps) { const [x, y] = P(l.i, l.j); c.fillStyle = '#ffd24a'; c.strokeStyle = '#3a2a1a'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 3.2, 0, 7); c.fill(); c.stroke(); }
  // рамка, север, масштаб, легенда
  c.strokeStyle = '#3a2a1a'; c.lineWidth = 2; c.strokeRect(pad, pad, w, h);
  c.fillStyle = '#3a2a1a'; c.font = 'bold 15px Georgia'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(`Роки-Маунт, округ Франклин · план ${td.wM} × ${td.hM} м`, pad, 22);
  c.beginPath(); c.moveTo(cv.width - pad - 10, pad + 34); c.lineTo(cv.width - pad - 2, pad + 12); c.lineTo(cv.width - pad + 6, pad + 34); c.fill(); c.font = 'bold 12px Georgia'; c.textAlign = 'center'; c.fillText('С', cv.width - pad - 2, pad + 48);
  const sy = pad + h + 20, s20 = 10 * cell; c.fillRect(pad, sy, s20, 5); c.fillStyle = '#fff'; c.fillRect(pad + s20 / 2, sy + 1, s20 / 2 - 1, 3); c.fillStyle = '#3a2a1a'; c.font = '11px Georgia'; c.textAlign = 'left'; c.fillText('0          10          20 м', pad, sy + 18);
  const lx0 = pad + s20 + 40; let lx = lx0, ly = sy + 4;
  for (const [k, lab] of Object.entries(KIND_LABEL)) { const wlab = c.measureText(lab).width + 34;
    if (lx + wlab > cv.width - pad) { lx = lx0; ly += 18; }
    c.fillStyle = KIND_COL[k]; c.fillRect(lx, ly - 5, 12, 12); c.strokeStyle = '#3a2a1a'; c.strokeRect(lx + .5, ly - 4.5, 11, 11); c.fillStyle = '#3a2a1a'; c.fillText(lab, lx + 16, ly + 5); lx += wlab; }
  const ny = ly + 26; c.fillStyle = '#ffd24a'; c.beginPath(); c.arc(pad + 6, ny - 4, 3.2, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#3a2a1a';
  c.fillText('фонарь · тёмная насечка на стене — вход с улицы · белый контур — двор со штакетником · номера — реестр зданий', pad + 16, ny);
}
// что внутри заведения — из тех же таблиц экономики, что и в игре
function bizWhat(F, b) { const n = b.name, parts = [];
  if (b.speakeasy) return 'подпольная продажа самогона хозяину — цена падает, когда он затоварен';
  if (EDEALERS[n]) return 'продажа: ' + dealerModels(n).map(id => `${ECARS[id].name} $${ECARS[id].price}`).join(', ') + '; выкуп машин у игроков';
  if (F.SHOPS[n]) parts.push(F.SHOPS[n].map(([k]) => `${F.ITEM[k]} $${EGOODS[k]}`).join(', '));
  if (b.kind === 'mill') parts.push('помол кукурузы в муку');
  if (n === 'GARAGE') parts.push('ковка медного котла и змеевика, ремонт машин');
  if (n === 'CAR RENTAL') parts.push('прокат: машины конторы и частные объявления игроков, сдача своей машины');
  if (n === 'BANK') parts.push('кредиты под залог машин, досрочное погашение');
  if (n === 'FILLING STATION') parts.push('бензин по галлону');
  const sv = Object.values(ESERV).filter(q => q.place === n).map(q => `${q.name} $${q.price}`); if (sv.length) parts.push(sv.join(', '));
  if (EJOBS[n]) parts.push(`работа: ${EJOBS[n].name} (${EJOBS[n].hours} ч)`);
  if (parts.length) return parts.join('; ');
  return ({ court: 'ориентир, площадь 10 × 10 м', church: 'ориентир, шпиль', depot: 'ориентир у железной дороги' }[b.kind] || 'витрина для вида'); }
const storeys = f => `${Math.max(1, Math.floor(f + .01))} эт. · ${(f * 1.3).toFixed(1)} м`;   // церковь 1,6 — это один высокий этаж, а не «1,6 этажа»
const chip = col => `<span class="sw" title="${col}" style="background:${col}"></span>`;
function townTable(F, td) {
  const { SHOPS, ITEM, PLACES } = F; const rows = [];
  for (const b of td.named) {
    const enter = b.speakeasy ? 'BILLIARDS' : (PLACES[b.name] ? b.name : null), what = bizWhat(F, b);
    rows.push([b._num, KIND_LABEL[b.kind], b.speakeasy ? 'BILLIARDS (спикизи в подвале)' : (b.name || '—'), storeys(b.f), `${b.w * 2} × ${b.d * 2}`, b.roof === 'flat' ? 'плоская с парапетом' : 'двускатная', { sw: [b.wall, b.roofc] },
      enter ? `да · ${(PLACES[enter] && PLACES[enter].title) || enter}` : 'нет', what]); }
  for (const kind of ['house', 'cottage']) { const hs = td.town.filter(b => b.kind === kind); if (!hs.length) continue;
    const pct = f => Math.round(hs.filter(f).length / hs.length * 100) + '%';
    rows.push([`×${hs.length}`, KIND_LABEL[kind], '—', [...new Set(hs.map(b => b.f))].sort().map(storeys).join(' / '), [...new Set(hs.map(b => `${b.w * 2}×${b.d * 2}`))].join(', '), 'двускатная',
      { sw: [...new Set(hs.map(b => b.wall)), ...new Set(hs.map(b => b.roofc))] }, 'нет', `крыльцо у ${pct(b => b.porch)}, печная труба у ${pct(b => b.chimney)}, двор со штакетником`]); }
  return { head: ['№', 'Тип', 'Вывеска / название', 'Этажность, высота стен', 'Габарит, м', 'Кровля', 'Стены и кровля', 'Внутрь', 'Что там'], rows };
}
function townSections(F, td) {
  const T = F.T, avgBlock = td.blocks.length ? Math.round(td.blocks.reduce((a, b) => a + b, 0) / td.blocks.length * 4) : 0;
  const lm = td.named.filter(b => b.kind !== 'shop').map(b => `№${b._num} ${KIND_LABEL[b.kind]}: ${b.w * 2} × ${b.d * 2} м, ${storeys(b.f)}` + ({ court: ', купол на плоской кровле, перед входом площадь 10 × 10 м', church: ', белые стены, шпиль над фронтоном', depot: ', красный кирпич, торцом к путям', mill: ', красный кирпич, водяное колесо со стороны реки' }[b.kind] || ''));
  return [
    { title: 'Общее', items: [`Габариты города: ${td.wM} × ${td.hM} м (${td.x1 - td.x0} × ${td.y1 - td.y0} клеток по 2 × 2 м), север на плане сверху`,
      'Центр — перекрёсток двух Main Street у площади суда', 'Западнее города — река Пигг, мост по Main Street; восточнее — железная дорога с переездом',
      `Кварталов: ${td.blocks.length}, в среднем ~${avgBlock} м²; зданий: ${td.town.length}`] },
    { title: 'Улицы', items: [`Main Street — ${td.mainW} м, брусчатка; две улицы крестом через центр`,
      `Остальные улицы — 6 м, укатанный грунт: ${td.nsStreets} с севера на юг и ${td.ewStreets} с запада на восток (вместе с Main Street)`,
      'Тротуар по кромке всех городских улиц; перекрёстки со скруглёнными бордюрами, радиус около 2 м',
      `Покрытие: ${(td.count[T.ROAD] || 0) * 4} м² улиц, ${(td.count[T.MAIN] || 0) * 4} м² Main Street, ${(td.count[T.PLAZA] || 0) * 4} м² площади`,
      'За городом улицы продолжаются грунтовками шириной 6 м с бродами через ручьи'] },
    { title: 'Застройка по зонам', items: ['Центр: лавки вплотную друг к другу вдоль Main Street, 1–3 этажа, плоские крыши с парапетом, маркизы и вывески, большие витрины',
      'Кольцо вокруг центра: жилые дома 1–2 этажа с отступом от улицы, двор с белым штакетником, крыльцо, печная труба',
      'Окраина: одноэтажные домики, больше деревьев и незастроенных участков'] },
    { title: 'Ориентиры', items: lm },
    { title: 'Уличное оборудование', items: [`Фонари: ${td.lamps} шт. по обочинам Main Street, через ~8 м попеременно по сторонам`,
      `Штакетник: ${td.fences} дворов`, `Деревья в городе: ${td.trees} — клён, дуб, берёза; аллеи вдоль улиц`,
      'Мост: дощатый настил во всю ширину Main Street, перила только по краям', 'Ж/д переезд: белый столб с красным шлагбаумом'] },
    { title: 'Правила для художника', items: ['План и габариты — контракт: здание занимает ровно свой участок (1 клетка = 2 × 2 м), вход — на стороне с насечкой на плане',
      'Высота этажа 1,3 м; дверь и витрина — на стороне, обращённой к улице',
      'Здания собираются из модульного набора: 3–4 варианта стен, 2 типа кровли, опции крыльца, трубы, маркизы — чтобы сотня домов не выглядела копиями',
      'Вывески — отдельная текстура 256×48 на каждое название; окна — отдельный материал, ночью светится около 80%',
      'Город не горит: пожары только в округе, поэтому для городских зданий состояния «горит / пепелище» не нужны'] },
  ];
}

function catalog(F) {
  const td = townData(F);
  const A = (clip, loop, sec, what) => ({ clip, loop, sec, what });
  const walkPlay = (o, t, clip) => { const u = o.userData; if (!u.lL) return; const sp = clip === 'run' ? 14 : clip === 'idle' ? 0 : 9; const sw = Math.sin(t * sp) * (clip === 'run' ? .9 : .6);
    u.lL.rotation.x = sw; u.lR.rotation.x = -sw; u.aL.rotation.x = -sw; u.aR.rotation.x = sw;
    if (/work|chop|raid|build|inspect|sweep|ignite|gather|mash/.test(clip)) { const w = Math.sin(t * 5); u.aL.rotation.x = -1.2 + w * .6; u.aR.rotation.x = -1.2 - w * .6; u.lL.rotation.x = u.lR.rotation.x = 0; } };
  const flicker = (o, t) => o.traverse(q => { if (q.isSprite) { q.material.opacity = .6 + .35 * Math.sin(t * 13 + q.id); q.scale.setScalar((q.userData.base || (q.userData.base = q.scale.x)) * (.9 + .15 * Math.sin(t * 9 + q.id))); } });
  const sway = (o, t) => { o.rotation.z = Math.sin(t * 1.4) * .04; };
  const sprite = (color, size, y = 0, blend = THREE.AdditiveBlending) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: F.glowTex, color, transparent: true, depthWrite: false, blending: blend })); s.scale.setScalar(size); s.position.y = y; return s; };
  const withFlames = (obj, n = 5, h = 2) => { const g = new THREE.Group(); g.add(obj); for (let q = 0; q < n; q++) { const s = sprite('#ff8a2a', 1.4 + q * .15, h * (.4 + q / n)); s.position.x = Math.sin(q * 2.1) * .6; s.position.z = Math.cos(q * 1.7) * .6; g.add(s); } return g; };
  const stillAt = steps => () => { const tpl = F.stillTemplate(); if (!tpl) return new THREE.Group(); const g = tpl.clone(true); g.position.set(0, 0, 0);
    const groups = g.children.filter(c => c.isGroup); // furnace, pot, thump, worm, trough, mash, jugs, wood
    groups.forEach((c, n) => { c.visible = n < 6 ? n < steps.built : (n === 6 ? !!steps.jugs : !!steps.wood); });
    g.children.filter(c => c.isMesh && c.geometry.type === 'TorusGeometry').forEach(r => r.visible = steps.built === 0);
    g.children.filter(c => c.isSprite).forEach(sp => { sp.visible = !!steps.fire; sp.material = sp.material.clone(); if (steps.fire) sp.material.opacity = .8; });
    return g; };
  const TREES = [['pine', 'Сосна'], ['oak', 'Дуб'], ['maple', 'Клён (осенний)'], ['birch', 'Берёза'], ['willow', 'Ива у воды']];
  const TOWN = [['shop', 'Лавка на Main Street (с вывеской)'], ['house', 'Городской дом'], ['cottage', 'Домик на окраине'], ['court', 'Суд округа (купол)'], ['church', 'Церковь (шпиль)'], ['depot', 'Депо у железной дороги'], ['mill', 'Мельница с колесом']];
  const EV = [['smoke', 'Дым над деревьями'], ['tracks', 'Колея от шин'], ['mash', 'Выброшенная барда'], ['jugs', 'Пустые кувшины'], ['ledger', 'Запись в книге лавки'], ['kerosene', 'Бутыль из-под керосина']];
  return [
    { id: 'player_shiner', cat: 'Персонажи', name: 'Самогонщик (игрок)', where: 'Главный герой стороны самогонщиков; так же выглядят все игроки этой стороны в сети (над головой — табличка с именем).',
      budget: 1800, tex: 'атлас 512, комбинезон, рубаха, фетровая шляпа', states: [{ id: 'base', label: 'Базовая модель', make: () => F.mkPlayer('shiner') }], play: walkPlay,
      anims: [A('idle', 'цикл', 2, 'стоит, дышит, поправляет шляпу'), A('walk', 'цикл', .7, 'ходьба'), A('run', 'цикл', .5, 'бег (Shift / джойстик до упора)'), A('work_chop', 'цикл', 1.2, 'рубит дрова в лесу'), A('work_gather', 'цикл', 1.4, 'набирает камни для очага'),
        A('work_build', 'цикл', 1.6, 'собирает аппарат у ручья'), A('work_mash', 'цикл', 1.5, 'засыпает муку и сахар в бочку'), A('sweep', 'цикл', 1.2, 'заметает следы веткой (F)'), A('ignite', 'один раз', 1.8, 'плещет керосин и чиркает спичкой (G)'),
        A('carry_jugs', 'поза', 0, 'несёт два кувшина'), A('buy_counter', 'один раз', 1, 'расплачивается у прилавка'), A('enter_car', 'один раз', .6, 'садится в машину'), A('exit_car', 'один раз', .6, 'выходит из машины'), A('drive_sit', 'цикл', 1, 'сидит за рулём'), A('burned_fall', 'один раз', 1.2, 'обгорел в огне и падает')] },
    { id: 'player_law', cat: 'Персонажи', name: 'Федеральный агент (игрок)', where: 'Сторона закона: осматривает местность, собирает дело, рубит кубы, досматривает машины.',
      budget: 1800, tex: 'атлас 512, тёмно-синяя форма, фуражка, звезда на груди', states: [{ id: 'base', label: 'Базовая модель', make: () => F.mkPlayer('law') }], play: walkPlay,
      anims: [A('idle', 'цикл', 2, 'стоит, руки за спиной'), A('walk', 'цикл', .7, 'ходьба'), A('run', 'цикл', .5, 'бег'), A('inspect', 'цикл', 2, 'осмотр местности: присел, разглядывает землю (F)'), A('raid_axe', 'цикл', 1, 'рубит аппарат топором при облаве'),
        A('frisk', 'один раз', 1.5, 'досмотр машины'), A('show_badge', 'один раз', .8, 'показывает значок'), A('ignite', 'один раз', 1.8, 'поджог (контролируемый отжиг)'), A('enter_car', 'один раз', .6, ''), A('exit_car', 'один раз', .6, ''), A('drive_sit', 'цикл', 1, ''), A('burned_fall', 'один раз', 1.2, 'обгорел')] },
    { id: 'farmer', cat: 'Персонажи', name: 'Фермер (NPC)', where: 'Работает на кукурузных полях у хуторов. При пожаре убегает, возвращается, когда гарь зарастёт.',
      budget: 1400, tex: 'атлас 256, соломенная шляпа, рабочая одежда', states: [{ id: 'hoe', label: 'С тяпкой', make: () => F.mkFarmer('hoe').g }, { id: 'basket', label: 'С корзиной', make: () => F.mkFarmer('basket').g }],
      play: (o, t) => { const u = o.userData; if (!u.armL) return; const w = Math.sin(t * 1.6) * .5; u.armL.rotation.x = w; u.armR.rotation.x = -w * .6; u.torso.rotation.x = Math.max(0, w) * .35; },
      anims: [A('hoe_swing', 'цикл', 2.4, 'рыхлит тяпкой междурядья'), A('basket_pick', 'цикл', 3, 'собирает початки в корзину'), A('wipe_brow', 'один раз', 3, 'протирает лоб'), A('flee_fire', 'цикл', .5, 'бежит от огня'), A('wave', 'один раз', 1.2, 'машет проезжающим')] },
    { id: 'clerk', cat: 'Персонажи', name: 'Продавец за прилавком (NPC)', where: 'Внутри каждой лавки, гаража, мельницы и спикизи. Бакалейщик записывает покупки сахара — это улика для закона.',
      budget: 1400, tex: 'атлас 256, рубаха, фартук', states: [{ id: 'day', label: 'Лавочник', make: () => F.clerkFigure(false) }, { id: 'dim', label: 'Хозяин спикизи', make: () => F.clerkFigure(true) }],
      anims: [A('idle_counter', 'цикл', 3, 'опирается на прилавок'), A('greet', 'один раз', 1, 'кивает входящему'), A('hand_goods', 'один раз', .8, 'подаёт товар'), A('write_ledger', 'цикл', 2, 'пишет в книгу покупок')] },
    { id: 'car', cat: 'Транспорт', name: 'Автомобили 1924–1932 (9 моделей)', where: 'Продаются в автосалонах Ford и «Эмпориум», сдаются в прокат; у закона — служебный Model A. Модель определяет багажник, скорость и расход бензина.',
      table: { head: ['Модель', 'Год', 'Где купить', 'Цена', 'Груз, гал', 'Скорость, mph', 'Бак, гал', 'Кузов'], rows: Object.values(ECARS).map(m => [m.name, m.year, m.dealer || 'выдаётся закону', m.dealer ? '$' + m.price : '—', m.cap, Math.round(m.speed * 4), m.tank, m.body]) },
      budget: 2500, tex: 'атлас 512; колёса — 4 отдельных узла wheel_fl/fr/rl/rr для вращения', notes: 'Фары — отдельные меши headlight_l/r (светятся ночью).',
      states: Object.keys(ECARS).map(k => ({ id: k, label: `${ECARS[k].name}${ECARS[k].dealer ? ' · $' + ECARS[k].price : ' · служебная'}`, make: () => F.mkCar(k) })),
      anims: [A('wheels_roll', 'процедурно', 0, 'вращение колёс по скорости'), A('steer', 'процедурно', 0, 'поворот передних колёс'), A('suspension', 'процедурно', 0, 'крен по рельефу и проседание под грузом'), A('engine_idle', 'цикл', .12, 'дрожь кузова на холостых'), A('door_open', 'один раз', .5, 'дверь водителя'), A('exhaust_puff', 'частицы', 1, 'выхлоп')] },
    { id: 'still', cat: 'Самогонный аппарат', name: 'Перегонный куб у ручья (сборка по шагам)', where: '23 поляны у ручьёв. Каждая часть появляется после своего шага сборки; облава или пожар сносит всё.',
      budget: 3000, tex: 'атлас 512: медь, дерево бочек, камень очага', notes: 'Каждая часть — отдельный узел: furnace, pot, thump_keg, worm_barrel, trough, mash_barrel, jugs, firewood.',
      states: [{ id: 's0', label: 'Пустая поляна', make: stillAt({ built: 0 }) }, { id: 's1', label: 'Очаг', make: stillAt({ built: 1 }) }, { id: 's2', label: '+ котёл', make: stillAt({ built: 2 }) }, { id: 's3', label: '+ thump keg', make: stillAt({ built: 3 }) },
        { id: 's4', label: '+ змеевик', make: stillAt({ built: 4 }) }, { id: 's5', label: '+ жёлоб', make: stillAt({ built: 5 }) }, { id: 's6', label: 'Собран', make: stillAt({ built: 6 }) }, { id: 'run', label: 'Перегон (огонь)', make: stillAt({ built: 6, fire: 1, wood: 1 }) }, { id: 'done', label: 'Готово (кувшины)', make: stillAt({ built: 6, jugs: 1 }) }],
      play: flicker, anims: [A('part_appear', 'один раз', .5, 'часть «встаёт» на место после шага сборки'), A('furnace_fire', 'цикл', .6, 'огонь в топке'), A('smoke_column', 'частицы', 2.5, 'столб дыма — видно издалека'), A('thump', 'цикл', 1.1, 'бочонок-отстойник вздрагивает'), A('worm_drip', 'цикл', .8, 'капает из змеевика в кувшин'), A('raid_destroy', 'один раз', 1.2, 'разлетается под топором'), A('burn_destroy', 'один раз', 2, 'сгорает в пожаре')] },
    { id: 'town_plan', cat: 'Город', name: 'План города Роки-Маунт', where: `План снят с игровой карты: положение и габариты зданий, улицы и фонари точные. ${td.wM} × ${td.hM} м.`,
      plan: cv => drawPlan(F, td, cv), sections: townSections(F, td) },
    { id: 'town_registry', cat: 'Город', name: 'Реестр зданий', where: `Все ${td.town.length} зданий города: ориентиры и лавки поштучно (номера как на плане), жилые дома сводно.`, table: townTable(F, td) },
    { id: 'town_kit', cat: 'Город', name: 'Модульный набор фасадов', where: 'Из этих модулей игра собирает все городские здания. Размеры модулей — точные размеры из кода.',
      budget: 400, tex: 'общий атлас 1024 на весь набор: 4 кирпича, 3 доски, 2 штукатурки; вывески отдельно 256×48', notes: 'Модули стыкуются по сетке 2 м по горизонтали и 1,3 м по вертикали.',
      states: [['wall', 'Стена этажа 2 × 2 м с цоколем'], ['window', 'Окно 0,5 × 0,62 м'], ['door', 'Дверь 0,6 × 1,04 м'], ['shopfront', 'Витрина лавки: окно, дверь, маркиза, вывеска'], ['awning', 'Маркизы (варианты)'],
        ['roof_flat', 'Плоская кровля с парапетом'], ['roof_gable', 'Двускатная кровля с фронтоном'], ['chimney', 'Печная труба'], ['porch', 'Крыльцо с навесом'], ['dome', 'Купол суда'], ['steeple', 'Шпиль церкви'], ['millwheel', 'Колесо мельницы']]
        .map(([id, label]) => ({ id, label, make: () => F.mkKit(id) })),
      anims: [A('window_night', 'процедурно', 0, 'окно зажигается тёплым светом вечером'), A('door_open', 'один раз', .5, 'дверь при входе игрока'), A('awning_flap', 'цикл', 3, 'край маркизы колышется'), A('mill_wheel_turn', 'цикл', 6, 'колесо мельницы вращается')] },
    { id: 'town_props', cat: 'Город', name: 'Уличное оборудование', where: 'Фонари, штакетник, мост, переезд.', budget: 300, tex: 'общий атлас 256',
      states: [['lamp', 'Фонарь (2,7 м)'], ['fence', 'Секция штакетника 2 м'], ['bridge', 'Секция моста 2 × 2 м'], ['crossing', 'Столб переезда']].map(([id, label]) => ({ id, label, make: () => F.mkKit(id) })),
      anims: [A('lamp_glow', 'процедурно', 0, 'ореол фонаря ночью, лёгкое мерцание'), A('crossing_bar', 'один раз', 1.5, 'шлагбаум опускается перед поездом (планируется)')] },
    { id: 'town_life', cat: 'Город', name: 'Свет и жизнь города', where: 'Что в городе меняется со временем суток и что в нём движется.',
      sections: [
        { title: 'Время суток', items: ['День: небо и туман #dfe9d3, солнце тёплое #fff4d6', 'Закат: тёплый тон #e9b98a, длинные тени', 'Ночь: небо #1c2240, окна светятся #ffb86a (около 80% окон), фонари — тёплый ореол, у машин — фары'] },
        { title: 'Движение', items: ['Две машины горожан ездят туда-обратно по Main Street', 'Игроки в сети: самогонщики и агенты, пешком и на машинах, над головой табличка с именем', 'Падающие осенние листья', 'Внутрь заходят в лавки, гараж, мельницу и бильярдную (спикизи)'] },
        { title: 'Состояния', items: ['Город не горит — пожары только в округе', 'Витрины и вывески статичны; маркизы и колесо мельницы — простые циклы'] },
      ] },
    { id: 'town_buildings', cat: 'Город', name: 'Здания города', where: 'Роки-Маунт: лавки вдоль Main Street, жилые дома, ориентиры. Город не горит.',
      budget: 2500, tex: 'атлас 512 на всё семейство, вывески — отдельная текстура 256×48', notes: 'Окна — отдельный материал window (ночью светится), двери — door.',
      states: TOWN.map(([id, label]) => ({ id, label, make: () => F.mkTownBuilding(id) })),
      anims: [A('windows_night', 'процедурно', 0, 'окна зажигаются вечером'), A('door_open', 'один раз', .5, 'дверь при входе игрока'), A('chimney_smoke', 'частицы', 3, 'дым из трубы'), A('sign_swing', 'цикл', 3, 'вывеска покачивается'), A('mill_wheel', 'цикл', 6, 'водяное колесо мельницы')] },
    { id: 'rural_houses', cat: 'Здания', name: 'Хутора, хижины и сараи (горят)', where: 'Разбросаны по округе внутри пожарных отсеков — сгорают вместе со своим отсеком и отстраиваются, когда гарь зарастёт.',
      budget: 1800, tex: 'атлас 512: бревно, доска, дранка, обугленная древесина', notes: 'Три состояния — три модели или одна с переключаемыми узлами: intact, burning (обугленный материал + точки для пламени), ruin.',
      states: [['cabin', 'Хижина'], ['farmhouse', 'Хутор'], ['barn', 'Сарай']].flatMap(([k, n]) => [
        { id: k + '_ok', label: n + ' · целый', make: () => F.mkHouse(k, 'intact') }, { id: k + '_fire', label: n + ' · горит', make: () => withFlames(F.mkHouse(k, 'burning'), 7, 2.6) }, { id: k + '_ruin', label: n + ' · пепелище', make: () => F.mkHouse(k, 'ruin') }]),
      play: flicker, anims: [A('burning', 'цикл', .6, 'пламя из окон и по кровле'), A('roof_collapse', 'один раз', 3, 'кровля проседает и рушится → пепелище'), A('smolder', 'цикл', 2.5, 'тлеет, дым от углей'), A('rebuild', 'один раз', 2, 'появление заново после зарастания гари')] },
    { id: 'interiors', cat: 'Интерьеры', name: 'Интерьеры заведений', where: 'Вход по E у двери. Камера смотрит с +X/+Z, поэтому стены только по дальним сторонам (-X и -Z), ближние — низкий бортик.',
      budget: 6000, tex: 'атлас 1024 на интерьер', notes: 'Коллизии: прилавок, полки, стены — отдельный простой меш collision.',
      states: Object.keys(F.PLACES).map(id => ({ id, label: F.PLACES[id].title, make: () => F.buildInterior(id).group })),
      anims: [A('lamp_sway', 'цикл', 4, 'лампа под потолком покачивается'), A('door_bell', 'один раз', .6, 'колокольчик над дверью'), A('shelf_goods', 'статично', 0, 'товар на полках свой в каждой лавке')] },
    { id: 'trees', cat: 'Природа', name: 'Деревья (5 пород × 3 состояния)', where: 'Лес в холмах (сосна, дуб, клён, берёза), ива по берегам, аллеи вдоль улиц. В пожаре горят и остаются обугленными до зарастания.',
      budget: 400, tex: 'общий атлас 256 на все породы; LOD не нужен', notes: 'Используется ~18 000 деревьев — только низкополигональные модели.',
      states: TREES.flatMap(([k, n]) => [{ id: k, label: n, make: () => F.mkTree(k, 0) }, { id: k + '_fire', label: n + ' · горит', make: () => withFlames(F.mkTree(k, 1), 4, 2.2) }, { id: k + '_burnt', label: n + ' · обугленное', make: () => F.mkTree(k, 2) }]),
      play: (o, t) => { sway(o, t); flicker(o, t); }, anims: [A('wind_sway', 'цикл', 4, 'покачивание по ветру'), A('catch_fire', 'один раз', 1, 'занимается огнём'), A('crown_fire', 'цикл', .6, 'верховой огонь'), A('char', 'один раз', 2, 'крона сгорает → обугленный ствол'), A('regrow', 'один раз', 3, 'появление молодого дерева'), A('leaves_fall', 'частицы', 3, 'осенние листья падают')] },
    { id: 'corn', cat: 'Природа', name: 'Кукуруза на поле', where: 'Кукурузные наделы у хуторов; сырьё для браги. Горит быстрее всего.', budget: 60, tex: 'vertex colors или атлас 128',
      states: [{ id: 'live', label: 'Стебель', make: () => F.cornStalk() }], play: sway,
      anims: [A('wind_sway', 'цикл', 3, 'волна по полю'), A('burn_out', 'один раз', 1.5, 'сгорает → стерня')] },
    { id: 'scarecrow', cat: 'Природа', name: 'Пугало', where: 'По одному на надел.', budget: 300, tex: 'атлас 128', states: [{ id: 'base', label: 'Пугало', make: () => F.mkScarecrow() }], play: sway,
      anims: [A('wind_sway', 'цикл', 3, 'рукава и шляпа на ветру')] },
    { id: 'rocks', cat: 'Природа', name: 'Камни и валуны', where: 'Скалы на вершинах холмов; оттуда берут камни для очага.', budget: 120, tex: 'атлас 256',
      states: [.4, .7, 1].map((r, n) => ({ id: 'r' + n, label: ['Малый', 'Средний', 'Валун'][n], make: () => new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), new THREE.MeshLambertMaterial({ color: '#9d9890' })) })), anims: [] },
    { id: 'evidence', cat: 'Улики', name: 'Улики (что оставляет самогонщик)', where: 'Видны самогонщику (свои, чтобы заметать) и агенту (найденные). Сверху — маркер-булавка.', budget: 300, tex: 'атлас 256',
      notes: 'Маркер: красный — свой ненайденный след, синий — улика в деле у закона.',
      states: EV.flatMap(([k, n]) => [{ id: k, label: n, make: () => F.mkEvidence({ type: k, found: false }) }, { id: k + '_found', label: n + ' · в деле', make: () => F.mkEvidence({ type: k, found: true }) }]),
      anims: [A('appear', 'один раз', .4, 'след появляется'), A('pin_bob', 'цикл', 1.5, 'булавка покачивается'), A('found_flash', 'один раз', .5, 'вспышка при находке агентом'), A('swept', 'один раз', .6, 'стирается при заметании')] },
    { id: 'fx_fire', cat: 'Эффекты', name: 'Огонь, дым, искры', where: 'Пожары по сетке клеток (как Far Cry 2), огонь в топке куба, дым над горящим кубом.', budget: 0, tex: 'спрайт-листы PNG 1024 (4×4 кадра по 256)',
      notes: 'Пламя по траве — низкое и широкое; верховое — высокое, для леса и домов; дым сносит по ветру.',
      states: [{ id: 'ground', label: 'Пламя по траве', make: () => { const g = new THREE.Group(); for (let q = 0; q < 6; q++) { const s = sprite('#ff9a3a', 1.1 + q * .1, .4); s.position.x = (q - 2.5) * .5; g.add(s); } return g; } },
        { id: 'crown', label: 'Верховое пламя', make: () => { const g = new THREE.Group(); for (let q = 0; q < 5; q++) g.add(sprite('#ff7a1a', 1.6 + q * .25, .6 + q * .6)); return g; } },
        { id: 'smoke', label: 'Дым', make: () => { const g = new THREE.Group(); for (let q = 0; q < 5; q++) { const s = sprite('#8a8580', 2 + q * .6, 1 + q * 1.2, THREE.NormalBlending); s.material.opacity = .5 - q * .08; s.position.x = q * .5; g.add(s); } return g; } },
        { id: 'sparks', label: 'Искры', make: () => { const g = new THREE.Group(); for (let q = 0; q < 12; q++) { const s = sprite('#ffc060', .18, .5 + q * .35); s.position.x = Math.sin(q * 2) * .7; s.position.z = Math.cos(q * 1.3) * .7; g.add(s); } return g; } }],
      play: flicker, anims: [A('flame_loop', 'цикл', .6, '16 кадров, спрайт-лист'), A('smoke_loop', 'цикл', 2.5, '16 кадров, расширяется и тает'), A('spark_rise', 'частицы', 1.2, 'летят по ветру через просеку'), A('ground_ash', 'текстура', 0, 'гарь на земле: тайлуемая 256, края рваные')] },
    { id: 'ground', cat: 'Земля', name: 'Тайлы земли', where: 'Карта 192×192 клетки по 2 м. Тайлы должны стыковаться без швов.', budget: 0, tex: 'тайлуемые 128×128 PNG',
      swatches: F.GROUND_SWATCHES, states: [], anims: [] },
    { id: 'ui_items', cat: 'Интерфейс', name: 'Иконки предметов инвентаря', where: 'Панель инвентаря и прилавок в лавке.', budget: 0, tex: 'PNG 64×64 с прозрачностью, контур в стиле гравюры',
      list: Object.entries(F.ITEM).map(([k, v]) => `${k} — ${v}`), states: [], anims: [] },
  ];
}

export function setupDesigner(F) {
  const items = catalog(F);
  const css = document.createElement('style');
  css.textContent = `
  #dz{position:fixed;inset:0;z-index:200;background:#efe6d0;display:none;font:13px Georgia,serif;color:#3a2e1e}
  #dz header{display:flex;align-items:center;gap:10px;padding:10px 16px;background:#3a2a1a;color:#f2e6c8}
  #dz header b{font-size:16px;flex:1}
  #dz header button{font:13px Georgia;background:#eadfc4;border:0;border-radius:5px;padding:5px 10px;cursor:pointer;color:#3a2e1e}
  #dz .body{display:flex;height:calc(100% - 44px)}
  #dz nav{width:250px;overflow:auto;border-right:1px solid #cbb891;background:#f6efdd}
  #dz nav h4{margin:10px 12px 4px;color:#8a6a48;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  #dz nav div{padding:6px 14px;cursor:pointer}
  #dz nav div.on{background:#e0d2b0;font-weight:bold}
  #dz main{flex:1;overflow:auto;padding:14px 18px}
  #dz .top{display:flex;gap:18px;flex-wrap:wrap}
  #dz canvas.pv{width:440px;height:340px;max-width:100%;background:linear-gradient(#dfe9d3,#cfdcbf);border:1px solid #cbb891;border-radius:8px}
  #dz .states button,#dz .clips button{font:12px Georgia;margin:2px;padding:3px 8px;border:1px solid #cbb891;border-radius:4px;background:#f3ead6;cursor:pointer}
  #dz .states button.on,#dz .clips button.on{background:#c96f4f;color:#fff}
  #dz table{border-collapse:collapse;margin-top:8px;width:100%;max-width:900px}
  #dz td,#dz th{border-bottom:1px solid #d8c8a4;padding:4px 8px;text-align:left;vertical-align:top}
  #dz .sw{display:inline-block;width:22px;height:22px;border-radius:4px;margin:2px;border:1px solid #0002;vertical-align:middle}
  #dz .meta td:first-child{color:#7a6a55;width:170px}
  #dz canvas.plan{max-width:100%;border:1px solid #cbb891;border-radius:8px;margin-top:8px}
  #dz .planbtns button{font:12px Georgia;margin:6px 6px 0 0;padding:4px 10px;border:1px solid #cbb891;border-radius:4px;background:#f3ead6;cursor:pointer}
  #dz .sec h3{margin:14px 0 4px}#dz .sec ul{margin:0;padding-left:20px}#dz .sec li{margin:2px 0}
  @media (max-width:760px){#dz .body{flex-direction:column}#dz nav{width:auto;height:30vh}}`;
  document.head.appendChild(css);
  const root = document.createElement('div'); root.id = 'dz';
  root.innerHTML = `<header><b>Справочник дизайнера · Moonshiners</b><button id="dzCopy">Скопировать ТЗ</button><button id="dzSave">Скачать ТЗ (.md)</button><button id="dzClose">Закрыть · Q+W+E</button></header>
    <div class="body"><nav id="dzNav"></nav><main id="dzMain"></main></div>`;
  document.body.appendChild(root);
  const nav = root.querySelector('#dzNav'), main = root.querySelector('#dzMain');

  let renderer = null, scene, camera, obj = null, cur = null, state = null, clip = null, raf = 0, t0 = 0;
  function ensureRenderer(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight('#fff6e0', '#8a7a55', 1.1)); const d = new THREE.DirectionalLight('#fff4d6', 1.4); d.position.set(5, 9, 6); scene.add(d);
    camera = new THREE.OrthographicCamera(-3, 3, 3, -3, -100, 100);
  }
  function show(make) {
    if (obj) scene.remove(obj);
    const o = make && make(); obj = new THREE.Group(); if (!o) return null;
    obj.add(o); o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o), c = new THREE.Vector3(), size = new THREE.Vector3(); box.getCenter(c); box.getSize(size);
    o.position.x -= c.x; o.position.z -= c.z; o.position.y -= box.min.y;       // пивот: центр основания на земле
    scene.add(obj);
    const r = Math.max(size.x, size.y * 1.3, size.z, .6) * .85; const aspect = 440 / 340;
    camera.left = -r * aspect; camera.right = r * aspect; camera.top = r * 1.05; camera.bottom = -r * .55; camera.updateProjectionMatrix();
    camera.position.set(r * 3, r * 2.6 + size.y * .4, r * 3); camera.lookAt(0, size.y * .45, 0);
    return o;
  }
  function loop(now) {
    if (root.style.display === 'none') return; raf = requestAnimationFrame(loop);
    const t = (now - t0) / 1000; if (obj) { obj.rotation.y = t * .35; const inner = obj.children[0]; if (inner && cur?.play) cur.play(inner, t, clip || 'walk'); }
    renderer.render(scene, camera);
  }
  function rowMeta(it, info) {
    const tr = [['Где в игре', it.where], ['Габариты заглушки', info ? `${fmt(info.w)} × ${fmt(info.h)} × ${fmt(info.d)} м (Ш × В × Г)` : '—'],
      ['Треугольников сейчас', info ? info.tris : '—'], ['Бюджет', it.budget ? `до ${it.budget} треугольников` : '—'], ['Текстура', it.tex || '—'], ['Пивот', 'центр основания на земле'], it.notes ? ['Заметки', it.notes] : null].filter(Boolean);
    return `<table class="meta">${tr.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
  }
  function open(it) {
    cur = it; clip = it.anims?.[0]?.clip || null; state = it.states?.[0]?.id || null;
    nav.querySelectorAll('div[data-id]').forEach(d => d.classList.toggle('on', d.dataset.id === it.id));
    const has3d = it.states && it.states.length;
    main.innerHTML = `<h2 style="margin:0 0 4px">${it.name}</h2><div style="color:#8a6a48;margin-bottom:10px">${it.cat} · moon_${it.id}</div>
      <div class="top">${has3d ? `<div><canvas class="pv" width="880" height="680"></canvas><div class="states"></div></div>` : ''}<div style="flex:1;min-width:280px" class="info"></div></div>
      ${it.anims?.length ? `<h3>Анимации</h3><div class="clips"></div><table><tr><th>Клип</th><th>Тип</th><th>Длительность</th><th>Что происходит</th></tr>${it.anims.map(a => `<tr><td><code>${a.clip}</code></td><td>${a.loop}</td><td>${a.sec ? a.sec + ' с' : '—'}</td><td>${a.what}</td></tr>`).join('')}</table>` : ''}
      ${it.swatches ? `<h3>Тайлы</h3><table>${it.swatches.map(([n, c]) => `<tr><td><span class="sw" style="background:${c}"></span></td><td>${n}</td><td><code>${c}</code></td></tr>`).join('')}</table>` : ''}
      ${it.list ? `<h3>Список</h3><ul>${it.list.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
      ${it.plan ? `<div class="planbtns"><button class="dlplan">Скачать план (PNG)</button><button class="dltown">Скачать ТЗ города (.md)</button></div><canvas class="plan"></canvas>` : ''}
      ${it.sections ? `<div class="sec">${it.sections.map(sec => `<h3>${sec.title}</h3><ul>${sec.items.map(x => `<li>${x}</li>`).join('')}</ul>`).join('')}</div>` : ''}
      ${it.table ? `<div style="overflow-x:auto"><table><tr>${it.table.head.map(h => `<th>${h}</th>`).join('')}</tr>${it.table.rows.map(r => `<tr>${r.map(c => `<td>${c && c.sw ? c.sw.map(chip).join('') : c}</td>`).join('')}</tr>`).join('')}</table></div>` : ''}`;
    const info = main.querySelector('.info');
    if (has3d) {
      const canvas = main.querySelector('canvas.pv'); if (renderer) renderer.dispose(); ensureRenderer(canvas); renderer.setSize(440, 340, false);
      const st = main.querySelector('.states');
      const pick = s => { state = s.id; st.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.id === s.id)); const o = show(s.make); const inf = o ? inspect(o) : null;
        info.innerHTML = rowMeta(it, inf) + (inf?.palette.length ? `<h4 style="margin:10px 0 4px">Палитра заглушки</h4>${inf.palette.map(c => `<span class="sw" title="${c}" style="background:${c}"></span>`).join('')}` : ''); };
      it.states.forEach(s => { const b = document.createElement('button'); b.textContent = s.label; b.dataset.id = s.id; b.onclick = () => pick(s); st.appendChild(b); });
      pick(it.states[0]);
      const cl = main.querySelector('.clips'); if (cl) it.anims.forEach(a => { const b = document.createElement('button'); b.textContent = a.clip; b.onclick = () => { clip = a.clip; cl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }; cl.appendChild(b); });
      cancelAnimationFrame(raf); t0 = performance.now(); raf = requestAnimationFrame(loop);
    } else info.innerHTML = `<p style="margin:0">${it.where}</p>`;
    if (it.plan) { const cv = main.querySelector('canvas.plan'); it.plan(cv);
      const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); };
      main.querySelector('.dlplan').onclick = () => cv.toBlob(b => save(b, 'moonshiners-plan-goroda.png'));
      main.querySelector('.dltown').onclick = () => save(new Blob([markdown('Город')], { type: 'text/markdown' }), 'moonshiners-tz-gorod.md'); }
  }
  let lastCat = ''; for (const it of items) { if (it.cat !== lastCat) { const h = document.createElement('h4'); h.textContent = it.cat; nav.appendChild(h); lastCat = it.cat; }
    const d = document.createElement('div'); d.textContent = it.name; d.dataset.id = it.id; d.onclick = () => open(it); nav.appendChild(d); }

  function markdown(onlyCat) {
    // для ТЗ снимаем габариты и палитру с каждой заглушки, во всех состояниях — первым
    if (!renderer) { const c = document.createElement('canvas'); ensureRenderer(c); }
    let md = onlyCat ? `# Moonshiners · ТЗ: ${onlyCat}\n\nОбщие требования к моделям — в полном ТЗ справочника (формат .glb, 1 единица = 1 м, пивот в центре основания).\n` : GENERAL;
    for (const it of items) { if (onlyCat && it.cat !== onlyCat) continue;
      md += `\n---\n\n## ${it.name}\n*${it.cat}* · файл \`moon_${it.id}.glb\`\n\n**Где в игре:** ${it.where}\n\n`;
      if (it.states?.length) { const o = it.states[0].make(); if (o) { const inf = inspect(o); md += `- Габариты заглушки: ${fmt(inf.w)} × ${fmt(inf.h)} × ${fmt(inf.d)} м (Ш × В × Г)\n- Треугольников в заглушке: ${inf.tris}\n- Палитра заглушки: ${inf.palette.join(', ')}\n`; } }
      if (it.budget) md += `- Бюджет: до ${it.budget} треугольников\n`; if (it.tex) md += `- Текстура: ${it.tex}\n`; if (it.notes) md += `- Заметки: ${it.notes}\n`;
      if (it.states?.length > 1) md += `\n**Состояния / варианты:** ${it.states.map(s => s.label).join(' · ')}\n`;
      if (it.anims?.length) md += `\n| Клип | Тип | Длительность | Что происходит |\n|---|---|---|---|\n` + it.anims.map(a => `| \`${a.clip}\` | ${a.loop} | ${a.sec ? a.sec + ' с' : '—'} | ${a.what} |`).join('\n') + '\n';
      if (it.swatches) md += '\n' + it.swatches.map(([n, c]) => `- ${n}: \`${c}\``).join('\n') + '\n';
      if (it.list) md += '\n' + it.list.map(x => `- ${x}`).join('\n') + '\n';
      if (it.plan) md += '\n*План города — PNG из справочника (кнопка «Скачать план»): 1 клетка = 12 px = 2 м, север сверху, номера зданий как в реестре.*\n';
      if (it.sections) md += '\n' + it.sections.map(sec => `### ${sec.title}\n` + sec.items.map(x => `- ${x}`).join('\n')).join('\n\n') + '\n';
      if (it.table) md += `\n| ${it.table.head.join(' | ')} |\n|${it.table.head.map(() => '---').join('|')}|\n` + it.table.rows.map(r => `| ${r.map(c => c && c.sw ? c.sw.join(', ') : String(c)).join(' | ')} |`).join('\n') + '\n';
    }
    return md;
  }
  root.querySelector('#dzCopy').onclick = async () => { const md = markdown(); try { await navigator.clipboard.writeText(md); root.querySelector('#dzCopy').textContent = 'Скопировано'; } catch { prompt('Скопируйте ТЗ', md.slice(0, 5000)); } };
  root.querySelector('#dzSave').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([markdown()], { type: 'text/markdown' })); a.download = 'moonshiners-tz-hudozhnik.md'; a.click(); };
  const close = () => { root.style.display = 'none'; window.__designerOpen = false; cancelAnimationFrame(raf); };
  const openDz = () => { root.style.display = 'block'; window.__designerOpen = true; open(cur || items[0]); };
  root.querySelector('#dzClose').onclick = close;
  const held = new Set();
  addEventListener('keydown', e => { held.add(e.code); if (held.has('KeyQ') && held.has('KeyW') && held.has('KeyE')) { held.clear(); root.style.display === 'block' ? close() : openDz(); e.preventDefault(); } else if (e.code === 'Escape' && root.style.display === 'block') close(); });
  addEventListener('keyup', e => held.delete(e.code)); addEventListener('blur', () => held.clear());
  return { open: openDz, close, markdown, items };
}
