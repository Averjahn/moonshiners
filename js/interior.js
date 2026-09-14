// Интерьеры заведений: одна комната, которая пересобирается под нужное место.
// Камера изометрическая и смотрит с +X/+Z, поэтому стены ставим только по дальним
// сторонам (-X и -Z) — иначе они закроют собой прилавок.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const ROOM = { w: 15, d: 11.5, wall: 3.4 };   // внутренние габариты

// Палитра и начинка каждого заведения. clerk — имя и реплика продавца.
export const PLACES = {
  'HARDWARE':    { title: 'Скобяная лавка', floor: '#8d7250', wall: '#c7b394', shelf: '#6f573c', clerk: 'Приказчик', greet: 'Медь листами, гвозди, инструмент. Что берём?', goods: 'copper' },
  'GROCERY':     { title: 'Бакалея',        floor: '#9a8258', wall: '#d8c8a4', shelf: '#7a6242', clerk: 'Бакалейщик', greet: 'Сахар мешками? Записываю в книгу, как положено…', goods: 'sacks' },
  'FEED & SEED': { title: 'Корма и семена', floor: '#8a7a52', wall: '#c9bb92', shelf: '#6b5b3a', clerk: 'Хозяин склада', greet: 'Кукуруза, бочки. Бери сколько увезёшь.', goods: 'barrels' },
  'Ферма':        { title: 'Амбар фермы',   floor: '#8a7350', wall: '#cbb384', shelf: '#6a5433', clerk: 'Фермер', greet: 'Кукуруза, сено, яйца. Мешками дешевле, чем в лавке.', goods: 'crates' },
  'Мельница':    { title: 'Мельница',       floor: '#93805c', wall: '#cdbd97', shelf: '#75603f', clerk: 'Мельник', greet: 'Смелю зерно, пока жернов крутится.', goods: 'sacks' },
  'GARAGE':      { title: 'Гараж',          floor: '#6f6a63', wall: '#9a958c', shelf: '#4f4a44', clerk: 'Механик', greet: 'Котёл из меди? Сделаем, только тихо.', goods: 'tools' },
  'BANK':          { title: 'Банк округа Франклин', floor: '#8a7a68', wall: '#d8d0c0', shelf: '#5a4a3a', clerk: 'Кассир', greet: 'Кредит под залог машины, погашение — каждый день. Подпишите здесь.', goods: 'tools' },
  'FILLING STATION': { title: 'Бензоколонка', floor: '#7a746a', wall: '#c9c1ae', shelf: '#5a5048', clerk: 'Заправщик', greet: 'Бензин по центу-другому за галлон. Долить до полного?', goods: 'barrels' },
  'FORD DEALER':   { title: 'Автосалон Ford', floor: '#9a8a70', wall: '#e2d8c2', shelf: '#4a3a2a', clerk: 'Продавец автомобилей', greet: 'Семейный Model A или быстрый V8? Старую машину возьмём в зачёт.', goods: 'none', showroom: true },
  'AUTO EMPORIUM': { title: 'Автомобильный салон «Эмпориум»', floor: '#8a7a62', wall: '#d6cab0', shelf: '#4a3a2a', clerk: 'Управляющий салоном', greet: 'Chevrolet, Dodge, Hudson и даже Cadillac — выбирайте.', goods: 'none', showroom: true },
  'CAR RENTAL':    { title: 'Прокат автомобилей', floor: '#8f8068', wall: '#d9ccae', shelf: '#5a4a38', clerk: 'Конторщик проката', greet: 'Взять машину на сутки или сдать свою — туристов в сезон хватает.', goods: 'tools', showroom: true },
  'HOTEL':         { title: 'Гостиница «Рокет»', floor: '#7a5a48', wall: '#c9b39a', shelf: '#5a3f2e', clerk: 'Портье', greet: 'Номер до утра: чистая постель, сейф для вещей, никаких вопросов.', goods: 'sacks' },
  'CAFE':          { title: 'Кафе на Main Street', floor: '#9a7a58', wall: '#e6d6b8', shelf: '#6a4a32', clerk: 'Официантка', greet: 'Обед или кофе? Кофе крепкий — побежите, как на автомобиле.', goods: 'bottles' },
  'DRUG STORE':    { title: 'Аптека', floor: '#8a8a7a', wall: '#e2e2d4', shelf: '#5a5a48', clerk: 'Аптекарь', greet: 'От ожогов — мазь и бинты. Спирт только по рецепту, сэр.', goods: 'bottles' },
  'COFFEE HOUSE':  { title: 'Кофейня', floor: '#6a5442', wall: '#e0cdb0', shelf: '#4a3a2c', clerk: 'Хозяин кофейни', greet: 'Кофе свежий, булки с утра. Садись к окну, посиди.', goods: 'bottles' },
  'BUTCHER':       { title: 'Мясная лавка', floor: '#9a9a90', wall: '#e8e4d8', shelf: '#6a4a3a', clerk: 'Мясник', greet: 'Свежая свинина, рёбра, окорок. Лёд привозят по утрам.', goods: 'crates' },
  'BARBER':        { title: 'Цирюльня', floor: '#8a6a5a', wall: '#e0d0c0', shelf: '#4a3a32', clerk: 'Цирюльник', greet: 'Побреем, пострижём — родная мать не узнает, не то что шериф.', goods: 'tools' },
  'TAILOR':        { title: 'Портной', floor: '#7a6a5a', wall: '#d8c8b0', shelf: '#4a3a2a', clerk: 'Портной', greet: 'Приличный костюм — лучшее алиби.', goods: 'sacks' },
  'POST OFFICE':   { title: 'Почта', floor: '#8a7a62', wall: '#d8ccb0', shelf: '#5a4a38', clerk: 'Почтмейстер', greet: 'Нужны руки разбирать почту — плачу почасово, честные деньги.', goods: 'sacks' },
  'Депо':          { title: 'Депо', floor: '#6f6a63', wall: '#9a8a7a', shelf: '#4f4a44', clerk: 'Бригадир', greet: 'Вагоны сами себя не разгрузят. Смена — три часа.', goods: 'barrels' },
  'BILLIARDS':   { title: 'Бильярдная (спикизи)', floor: '#5d4630', wall: '#7a5c3e', shelf: '#4a3722', clerk: 'Хозяин', greet: 'Товар вниз по лестнице. И не через парадную дверь.', goods: 'bottles', dim: true },
};

const lamb = c => new THREE.MeshLambertMaterial({ color: c });

export function clerkFigure(dim) {
  const g = new THREE.Group(), shirt = dim ? '#3d4a5a' : '#e8e2d2';
  const mesh = (geo, c, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, lamb(c)); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const limb = (x, y, r, len, c) => { const pivot = new THREE.Group(); pivot.position.set(x, y, 0); g.add(pivot); mesh(new THREE.CapsuleGeometry(r, len, 4, 10), c, 0, -(len / 2 + r), 0, pivot); return pivot; };
  limb(-.12, .5, .09, .3, '#4a4438'); limb(.12, .5, .09, .3, '#4a4438');
  mesh(new RoundedBoxGeometry(.5, .56, .3, 3, .12), shirt, 0, .8, 0);           // рубаха
  mesh(new RoundedBoxGeometry(.52, .34, .32, 3, .08), '#b9a480', 0, .66, 0);    // фартук
  limb(-.33, 1.04, .07, .34, shirt); limb(.33, 1.04, .07, .34, shirt);
  mesh(new THREE.SphereGeometry(.17, 18, 14), '#e8c39e', 0, 1.3, 0);            // голова
  mesh(new THREE.SphereGeometry(.172, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), '#4a3a2a', 0, 1.33, 0);   // волосы
  return g;
}

// Товар на полках — разный для каждого заведения, чтобы лавки не были одинаковыми.
function goodsOn(g, kind, x0, y, z) {
  const put = (geo, c, x, yy, zz, rot) => { const m = new THREE.Mesh(geo, lamb(c)); m.position.set(x, yy, zz); if (rot) m.rotation.y = rot; m.castShadow = true; g.add(m); return m; };
  for (let k = 0; k < 6; k++) {
    const x = x0 + k * 1.1;
    if (kind === 'copper') put(new THREE.BoxGeometry(.8, .05, .5), '#c8873f', x, y + .03, z, k * .3);
    else if (kind === 'sacks') { put(new THREE.CylinderGeometry(.22, .3, .55, 7), '#d9cba4', x, y + .28, z); if (k % 2) put(new THREE.CylinderGeometry(.2, .28, .5, 7), '#c9b98e', x + .3, y + .25, z - .35); }
    else if (kind === 'barrels') put(new THREE.CylinderGeometry(.3, .3, .7, 10), '#7a5a3a', x, y + .35, z);
    else if (kind === 'tools') { put(new THREE.BoxGeometry(.12, .5, .12), '#5a5550', x, y + .25, z); put(new THREE.BoxGeometry(.35, .1, .12), '#3f3a35', x, y + .5, z); }
    else if (kind === 'none') break;   // шоурум: вместо полок в зале стоят машины
    else if (kind === 'bottles') { put(new THREE.CylinderGeometry(.09, .11, .42, 7), '#8fae94', x, y + .21, z); put(new THREE.CylinderGeometry(.05, .05, .12, 6), '#6f8a74', x, y + .48, z); }
  }
}

// Возвращает готовую комнату и её «физику»: прямоугольники, сквозь которые нельзя пройти.
export function buildInterior(name) {
  const p = PLACES[name] || PLACES['GROCERY'];
  const g = new THREE.Group();
  const col = [];                                    // коллайдеры в локальных координатах
  const box = (w, h, d, x, y, z, c, solid = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lamb(c)); m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true; g.add(m);
    if (solid) col.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
    return m;
  };
  const { w, d, wall } = ROOM;
  // пол и половицы
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, .2, d), lamb(p.floor)); floor.position.y = -.1; floor.receiveShadow = true; g.add(floor);
  for (let x = -w / 2 + .6; x < w / 2; x += 1.2) { const s = new THREE.Mesh(new THREE.BoxGeometry(.05, .02, d), lamb('#00000022')); s.position.set(x, .011, 0); g.add(s); }
  // дальние стены (их и видит камера), ближние — низкий бортик, чтобы не загораживать
  box(w, wall, .35, 0, 0, -d / 2, p.wall); box(.35, wall, d, -w / 2, 0, 0, p.wall);
  box(w, .5, .3, 0, 0, d / 2, p.wall); box(.3, .5, d, w / 2, 0, 0, p.wall);
  // прилавок и продавец за ним
  box(8.4, 1.05, 1.1, -1.6, 0, -1.6, p.shelf);
  const clerk = clerkFigure(p.dim); clerk.position.set(-1.6, 0, -3.1); clerk.rotation.y = Math.PI; g.add(clerk);
  col.push({ x0: -2.4, x1: -.8, z0: -3.7, z1: -2.5 });
  // полки вдоль дальней стены с товаром
  for (const z of [-4.9]) { const sh = box(w - 1.6, .25, .9, 0, 1.1, z, p.shelf); goodsOn(g, p.goods, -5.6, 1.35, z); }
  box(3.2, 2.2, .8, 5.2, 0, -4.6, p.shelf); goodsOn(g, p.goods, 4.1, 2.2, -4.6);
  // особые приметы места
  if (name === 'GARAGE') { box(1.4, .9, 1.4, 5.4, 0, 1.6, '#4a4038'); const anvil = new THREE.Mesh(new THREE.BoxGeometry(1, .35, .5), lamb('#3a3632')); anvil.position.set(5.4, 1.1, 1.6); g.add(anvil); }
  if (name === 'Мельница') { const st = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, .5, 16), lamb('#8d8880')); st.position.set(5, .25, 2.2); st.castShadow = true; g.add(st); col.push({ x0: 3.5, x1: 6.5, z0: .7, z1: 3.7 }); }
  if (name === 'BILLIARDS') { const t = new THREE.Mesh(new THREE.BoxGeometry(4.4, .75, 2.4), lamb('#2f6a4a')); t.position.set(4, .75, 2.4); t.castShadow = true; g.add(t); col.push({ x0: 1.8, x1: 6.2, z0: 1.2, z1: 3.6 }); }
  // стойка со стульями у прилавка
  for (let k = 0; k < 3; k++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(.28, .28, .55, 8), lamb(p.shelf)); s.position.set(-4.6 + k * 1.6, .27, .3); s.castShadow = true; g.add(s); }
  // дверь: коврик у ближнего края, через него выходим
  const mat = new THREE.Mesh(new THREE.BoxGeometry(2.2, .04, 1.2), lamb('#8a6a48')); mat.position.set(w / 2 - 2.6, .02, d / 2 - 1.1); g.add(mat);
  // лампа под потолком
  const lamp = new THREE.PointLight(p.dim ? '#ffb066' : '#ffe6b8', p.dim ? 12 : 16, 26, 1.6);
  lamp.position.set(0, 3.1, 0); g.add(lamp);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff1c8' })); bulb.position.set(0, 3.1, 0); g.add(bulb);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .6, 4), lamb('#3a3128')); cord.position.set(0, 3.5, 0); g.add(cord);

  return { group: g, colliders: col, title: p.title, clerkName: p.clerk, greet: p.greet,
    clerkAt: { x: -1.6, z: -3.1 }, doorAt: { x: w / 2 - 2.6, z: d / 2 - 1.1 },
    bounds: { x: w / 2 - .6, z: d / 2 - .6 } };
}
