// ЭКОНОМИКА Moonshiners — чистые функции, без сервера и сети. Их же гоняет симуляция
// test/economy.test.mjs, поэтому баланс проверяется месяцами игры за секунды.
//
// Почему деньги не «печатаются» с ростом игроков:
//  1. КРАНЫ (деньги приходят извне: хозяин спикизи скупает самогон, зарплаты, премии закону,
//     туристы берут машины в прокат, дилер выкупает машины) растут медленнее числа игроков:
//     общие дневные пулы спроса масштабируются как √N, а не N. Кубов на карте всего 23.
//  2. СТОКИ (деньги уходят из мира: товары лавок, новые машины, бензин, ремонт, налог на машины,
//     проценты банка, услуги, «шерифу за тишину», комиссия проката) растут вместе с активностью
//     и богатством — налог на машину считается от её стоимости.
//  3. ИНДЕКС ЦЕН раз в игровой день смотрит на МЕДИАНУ денег у игроков в сети: стоки дорожают
//     в полную силу индекса, краны — только на его корень. Лишние деньги сами себя съедают,
//     а медиана не даёт двум богачам поднять цены всем остальным.
//  4. Между игроками деньги только переходят (прокат, перепродажа), город берёт комиссию — сток.
//  5. Налоги и кредиты начисляются только за время в игре: неделя вне сети не разоряет.

export const ECON = {
  TARGET_CASH: 400,          // целевая медиана наличных у игрока в сети
  INDEX_MIN: .75, INDEX_MAX: 2.2, INDEX_STEP: .02,   // индекс двигается не больше чем на 2% в день
  START_CASH: 150,
  CAR_TAX: .003,             // налог на машину за игровой день — доля её оценочной стоимости
  RESALE: .6,                // дилер выкупает за 60% новой цены × состояние
  REPAIR_K: .45,             // полный ремонт убитой машины — 45% её цены
  WEAR_PER_M: .000004,       // износ: 0,4% состояния на километр
  FUEL_PRICE: .22,           // $ за галлон бензина (в 1929-м около 21 цента)
  RENT_RATE: .05,            // справедливая аренда в сутки — 5% цены машины
  RENT_COMMISSION: .12,      // контора проката берёт 12% с каждой аренды
  RENT_MIN: .5, RENT_MAX: 2, // цену аренды владелец ставит в пределах половины — двух справедливых
  LISTING_DAYS: 30,          // объявление живёт 30 игровых дней — ферма простаивающих машин не вечна
  NPC_RENT_BASE: 3, NPC_RENT_PER_SQRT: 2, RENT_STREET_PASS: 1.5,   // туристы: машино-дней в сутки
  WAGE: 3.5, WORK_CAP_H: 6,  // честная работа: $ в час и не больше 6 часов в игровой день (кран на игрока, с числом игроков не растёт)
  SPEAK_PRICE: 5.5, SPEAK_FLOOR: .4, SPEAK_DAY_K: .82,     // галлон у хозяина: ночью полная цена, днём 82%
  SPEAK_CAP_BASE: 0, SPEAK_CAP_PER_SQRT: 17,              // сколько галлонов в день берут по хорошей цене: в пустом городе мало, растёт с √игроков
  PROTECTION: .12,           // доля выручки спикизи уходит «шерифу за тишину»
  EVIDENCE_PAY: 1, RAID_BOUNTY: 55,                         // премии закону (кран) — множитель к базовым
  LOAN_RATE: .015, LOAN_LTV: .5, LOAN_DAYS: 12, LOAN_MISS_LIMIT: 3, LOAN_PENALTY: .05,
  RACKET_FREE: 1.2, RACKET_RATE: .035,  // рэкет: 1,2% в сутки с наличных сверх 2,5 целевых медиан — сток только для богатых
};

export const round2 = v => Math.round(v * 100) / 100;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sinkPrice = (base, I) => round2(base * I);            // стоки дорожают вместе с индексом
export const faucetPrice = (base, I) => round2(base * Math.sqrt(I)); // краны — только на корень

// ---- товары и услуги города (базовые цены при индексе 1)
export const GOODS = { copper: 6, kerosene: 3, sugar: 2, yeast: 1, corn: 1.5, barrel: 4, planks: 2 };
export const SERVICES = {
  meal:     { place: 'CAFE', name: 'Обед', price: 1.2, hp: 100, fed: 55 },
  coffee:   { place: 'COFFEE HOUSE', name: 'Чашка кофе', price: .6, buffH: 2, fed: 4 },
  bread:    { place: 'COFFEE HOUSE', name: 'Булка с маслом', price: .5, fed: 25 },
  drink:    { place: 'BILLIARDS', name: 'Стопка у стойки', price: 1.1, fed: 8, cheerH: 3, wanted: -6 },
  room:     { place: 'HOTEL', name: 'Номер до утра (здоровье и тайник на ночь)', price: 6, hp: 100 },
  medicine: { place: 'DRUG STORE', name: 'Лекарство от ожогов', price: 4, hp: 100 },
  bandage:  { place: 'DRUG STORE', name: 'Бинт', price: 1.5, hp: 40 },
  haircut:  { place: 'BARBER', name: 'Стрижка и бритьё (−25 к розыску)', price: 3, wanted: -25 },
  suit:     { place: 'TAILOR', name: 'Новый костюм (−40 к розыску)', price: 18, wanted: -40 },
  telegram: { place: 'POST OFFICE', name: 'Телеграмма', price: .5 },
  steak:    { place: 'BUTCHER', name: 'Окорок с собой', price: 2.8, hp: 70, fed: 45 },
};
export const JOBS = {
  'POST OFFICE': { name: 'Разбирать почту', hours: 2 },
  'Депо': { name: 'Грузить вагоны', hours: 3 },
};

// ---- АВТОМОБИЛИ 1924–1932. cap — галлонов груза, speed — макс. скорость в игре, accel/grip —
// разгон и руль, stealth — насколько груз незаметен при досмотре, tank — бак (галлонов),
// burn — галлонов бензина на метр пути, appeal — насколько машину хотят туристы в прокате.
export const CARS = {
  model_t:     { name: 'Ford Model T', year: 1924, dealer: 'FORD DEALER', price: 260, cap: 30, speed: 14, accel: 9, grip: 2.2, stealth: .15, tank: 10, burn: .004, body: 'sedan', color: '#2b2b2b', appeal: 1 },
  model_a:     { name: 'Ford Model A', year: 1928, dealer: 'FORD DEALER', price: 450, cap: 40, speed: 17, accel: 11, grip: 2.4, stealth: .2, tank: 11, burn: .0042, body: 'sedan', color: '#3a4a3a', appeal: 1.15 },
  model_aa:    { name: 'Ford Model AA, грузовик', year: 1929, dealer: 'FORD DEALER', price: 760, cap: 180, speed: 10, accel: 6, grip: 1.7, stealth: .05, tank: 15, burn: .007, body: 'truck', color: '#4a3a2a', appeal: .8 },
  v8:          { name: 'Ford V8 Model 18', year: 1932, dealer: 'FORD DEALER', price: 980, cap: 45, speed: 23, accel: 15, grip: 2.8, stealth: .3, tank: 14, burn: .006, body: 'coupe', color: '#1a1a24', appeal: 1.4 },
  chevy_ab:    { name: 'Chevrolet National AB', year: 1928, dealer: 'AUTO EMPORIUM', price: 520, cap: 42, speed: 16, accel: 10, grip: 2.5, stealth: .25, tank: 11, burn: .0043, body: 'sedan', color: '#2a3a5a', appeal: 1.2 },
  dodge_panel: { name: 'Dodge Brothers, фургон', year: 1927, dealer: 'AUTO EMPORIUM', price: 690, cap: 110, speed: 12, accel: 7, grip: 1.9, stealth: .45, tank: 14, burn: .0065, body: 'panel', color: '#5a4a2a', appeal: .9 },
  hudson:      { name: 'Hudson Super Six', year: 1929, dealer: 'AUTO EMPORIUM', price: 1150, cap: 38, speed: 20, accel: 13, grip: 2.7, stealth: .4, tank: 15, burn: .0055, body: 'long', color: '#5a2a2a', appeal: 1.5 },
  cadillac:    { name: 'Cadillac V-16', year: 1930, dealer: 'AUTO EMPORIUM', price: 2800, cap: 32, speed: 22, accel: 14, grip: 2.9, stealth: .7, tank: 20, burn: .009, body: 'limo', color: '#101014', appeal: 2.2 },
  police_a:    { name: 'Ford Model A, полиция', year: 1928, dealer: null, price: 450, cap: 20, speed: 18, accel: 12, grip: 2.6, stealth: 0, tank: 12, burn: .0042, body: 'sedan', color: '#141c2b', appeal: 0, issued: 'law' },
};
export const DEALERS = { 'FORD DEALER': 'Автосалон Ford', 'AUTO EMPORIUM': 'Автомобильный салон «Эмпориум»' };
export const dealerModels = dealer => Object.entries(CARS).filter(([, m]) => m.dealer === dealer).map(([id]) => id);

// ---- индекс цен: раз в игровой день по медиане наличных у игроков в сети.
// Смотрим на ТИПИЧНОГО игрока (медиана), а не на поток денег: пока игроки копят, краны законно больше стоков,
// и индекс по потокам уходил в потолок — машины дорожали, новички не могли купить первую.
// Богатый хвост держит рэкет, а не индекс.
export function stepIndex(I, medianCash) {
  const move = clamp(Math.log(Math.max(.05, medianCash / ECON.TARGET_CASH)) * .05, -ECON.INDEX_STEP, ECON.INDEX_STEP);
  return Math.round(clamp(I * Math.exp(move), ECON.INDEX_MIN, ECON.INDEX_MAX) * 1e5) / 1e5;
}
export function median(xs) { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export function gini(xs) { const s = xs.filter(v => v >= 0).sort((a, b) => a - b), n = s.length, sum = s.reduce((a, b) => a + b, 0); if (!n || !sum) return 0;
  let acc = 0; s.forEach((v, q) => { acc += (2 * (q + 1) - n - 1) * v; }); return acc / (n * sum); }

// ---- машины
export const carPrice = (model, I) => Math.round(CARS[model].price * I);
export const carValue = (car, I) => carPrice(car.model, I) * (.35 + .65 * car.cond);          // оценка для налога и залога
export const resale = (car, I) => (CARS[car.model].issued ? 0 : Math.round(carPrice(car.model, I) * ECON.RESALE * car.cond));
export const carTax = (car, I) => (CARS[car.model].issued ? 0 : round2(carValue(car, I) * ECON.CAR_TAX));
export const fuelCost = (gallons, I) => round2(gallons * sinkPrice(ECON.FUEL_PRICE, I));
export const repairCost = (car, I) => round2(carPrice(car.model, I) * ECON.REPAIR_K * (1 - car.cond));
export function newCar(model, id) { return { id, model, cond: 1, fuel: CARS[model].tank, odo: 0, listing: null, rentedTo: null, rentUntil: 0 }; }
// проехали dist метров: расход бензина и износ; без бензина машина не едет дальше
export function drive(car, dist) {
  const m = CARS[car.model], can = m.burn > 0 ? car.fuel / m.burn : dist, d = Math.min(dist, can);
  car.fuel = Math.max(0, Math.round((car.fuel - d * m.burn) * 1000) / 1000);
  car.cond = Math.max(.2, Math.round((car.cond - d * ECON.WEAR_PER_M) * 10000) / 10000);
  car.odo = Math.round((car.odo || 0) + d);
  return d;
}

// ---- прокат
export const fairRent = (model, I) => round2(carPrice(model, I) * ECON.RENT_RATE);
export const rentBounds = (model, I) => [round2(fairRent(model, I) * ECON.RENT_MIN), round2(fairRent(model, I) * ECON.RENT_MAX)];
export const npcRentPool = online => ECON.NPC_RENT_BASE + ECON.NPC_RENT_PER_SQRT * Math.sqrt(Math.max(0, online));
// доли туристов между объявлениями: дешевле справедливой цены, свежее и престижнее — больше спрос.
// «проход мимо» не даёт одинокому объявлению забрать весь пул (методика business-sim, конкуренция за поток)
export function rentShares(listings, I) {
  const pw = listings.map(l => Math.pow(Math.pow(fairRent(l.model, I) / Math.max(.01, l.price), 2) * (.4 + .6 * l.cond) * (CARS[l.model].appeal || .01), 1.2));
  const total = pw.reduce((a, b) => a + b, 0) + ECON.RENT_STREET_PASS;
  return pw.map(p => p / total);
}
// машино-дни туристов за сутки на каждое объявление (не больше суток на машину)
export function allocateNpcRent(listings, online, I) { const pool = npcRentPool(online), sh = rentShares(listings, I); return listings.map((_, q) => Math.min(1, pool * sh[q])); }
export function rentPayout(price, days) { const gross = round2(price * days), fee = round2(gross * ECON.RENT_COMMISSION); return { gross, fee, net: round2(gross - fee) }; }

// ---- спикизи: цена падает, когда хозяин за день уже набрал товара
export const speakCapacity = online => ECON.SPEAK_CAP_BASE + ECON.SPEAK_CAP_PER_SQRT * Math.sqrt(Math.max(0, online));
export function speakPrice(soldToday, online, I, night) {
  const k = Math.max(ECON.SPEAK_FLOOR, 1 - .6 * soldToday / speakCapacity(online));
  return round2(faucetPrice(ECON.SPEAK_PRICE, I) * k * (night ? 1 : ECON.SPEAK_DAY_K));
}
// продаём партию: каждый галлон сдвигает цену; «шерифу за тишину» уходит доля
export function sellBatch(n, soldToday, online, I, night) {
  let gross = 0; for (let q = 0; q < n; q++) gross += speakPrice(soldToday + q, online, I, night);
  gross = round2(gross); const protection = round2(gross * ECON.PROTECTION);
  return { gross, protection, net: round2(gross - protection) };
}

// ---- рэкет: единственный сток, который растёт с богатством, а не с активностью. Без него у тех, кто
// уже купил всё желаемое, наличные копятся бесконечно и тянут индекс цен для всех остальных.
export const racketFree = I => ECON.RACKET_FREE * ECON.TARGET_CASH * I;
export const racket = (cash, I) => round2(Math.max(0, cash - racketFree(I)) * ECON.RACKET_RATE);

// ---- честная работа (кран, ограничен часами в день)
export const wage = I => faucetPrice(ECON.WAGE, I);
export const workHours = (want, doneToday) => Math.max(0, Math.min(want, ECON.WORK_CAP_H - doneToday));

// ---- банк: дифференцированный кредит, лимит от ЧИСТОГО капитала (без спирали «заём → больше лимит»)
export function netWorth(acc, I) { return round2(acc.cash + (acc.cars || []).reduce((s, c) => s + (CARS[c.model].issued ? 0 : carValue(c, I)), 0) - (acc.loan ? acc.loan.left : 0)); }
export function loanLimit(acc, I) { const debt = acc.loan ? acc.loan.left : 0; return Math.max(0, Math.floor(netWorth(acc, I) * ECON.LOAN_LTV - debt)); }
export function loanSchedule(P, rate = ECON.LOAN_RATE, n = ECON.LOAN_DAYS) {
  const out = []; let left = P;
  for (let d = 1; d <= n; d++) { const body = round2(d === n ? left : P / n), interest = round2(left * rate); left = round2(left - body); out.push({ day: d, body, interest, total: round2(body + interest), left }); }
  return out;
}
export function newLoan(P, day) { return { principal: P, left: P, nextDay: day + 1, paidDays: 0, missed: 0, rate: ECON.LOAN_RATE, days: ECON.LOAN_DAYS }; }
// платёж за день: тело равными долями + процент на остаток; пропуск — пеня и счётчик
export function loanDue(loan) { const body = round2(Math.min(loan.left, loan.principal / loan.days)); return { body, interest: round2(loan.left * loan.rate), total: round2(body + loan.left * loan.rate) }; }

// ================= ЗАВЕДЕНИЯ ИГРОКОВ =================
// Игрок может владеть заведением: ставит цену, закупает товар оптом, нанимает помощника,
// вкладывается в вид витрины. Деньги при этом НЕ печатаются:
//  · неигровые покупатели (горожане) — кран, их поток растёт как √N, а не как N;
//  · закупка у оптовика, содержание, зарплата помощника и торговый сбор — стоки;
//  · покупка живым игроком — просто перевод денег владельцу минус тот же сбор.
// Пустой прилавок, задранная цена и нехватка рук режут продажи по-разному — владелец
// видит три отдельные причины потерь, а не одну «мало выручки».
export const BIZ = {
  GROCERY:          { name: 'Бакалея',          role: 'Бакалейщик',        unit: 'товар',   ref: 2.2, base: 9.6, sells: ['sugar', 'yeast'] },
  BUTCHER:          { name: 'Мясная лавка',     role: 'Мясник',            unit: 'отруб',   ref: 2.8, base: 7.8, sells: ['steak'] },
  'FEED & SEED':    { name: 'Корма и семена',   role: 'Торговец кормами',  unit: 'мешок',   ref: 4,   base: 4.8, sells: ['corn', 'barrel'] },
  HARDWARE:         { name: 'Скобяная лавка',   role: 'Скобянщик',         unit: 'товар',   ref: 6,   base: 4.2, sells: ['copper', 'kerosene'] },
  CAFE:             { name: 'Кафе',             role: 'Хозяин кафе',       unit: 'порция',  ref: 1.2, base: 15,   sells: ['meal', 'coffee'] },
  HOTEL:            { name: 'Гостиница',        role: 'Хозяин гостиницы',  unit: 'номер',   ref: 6,   base: 3.6, sells: ['room'] },
  'DRUG STORE':     { name: 'Аптека',           role: 'Аптекарь',          unit: 'склянка', ref: 4,   base: 3.3, sells: ['medicine', 'bandage'] },
  BARBER:           { name: 'Цирюльня',         role: 'Цирюльник',         unit: 'клиент',  ref: 3,   base: 4.8, sells: ['haircut'] },
  TAILOR:           { name: 'Ателье',           role: 'Портной',           unit: 'костюм',  ref: 18,  base: 2.2, sells: ['suit'] },
  'POST OFFICE':    { name: 'Почта',            role: 'Почтмейстер',       unit: 'отправление', ref: .9, base: 12,   sells: ['telegram'] },
  GARAGE:           { name: 'Гараж',            role: 'Механик',           unit: 'наряд',   ref: 12,  base: 3.6, sells: ['repair'] },
  'FILLING STATION':{ name: 'Заправка',         role: 'Заправщик',         unit: 'заправка',ref: 2.4, base: 12,  sells: ['fuel'] },
  'Мельница':       { name: 'Мельница',         role: 'Мельник',           unit: 'доска',   ref: 2,   base: 9,   sells: ['planks'] },
  Ферма:            { name: 'Ферма',            role: 'Фермер',            unit: 'мешок',   ref: 1.5, base: 18,   sells: ['corn'], farm: true },
  'COFFEE HOUSE':   { name: 'Кофейня',          role: 'Хозяин кофейни',    unit: 'чашка',   ref: .6,  base: 22,   sells: ['coffee', 'bread'] },
  BILLIARDS:        { name: 'Подпольный бар',   role: 'Хозяин бара',       unit: 'стопка',  ref: 1.1, base: 26,   sells: ['drink'], bar: true },
};
Object.assign(ECON, {
  BIZ_WHOLESALE: .55,     // оптовая цена единицы — доля ориентира розницы (сток: товар приходит извне округа)
  BIZ_TAX: .08,           // торговый сбор города с каждой продажи — сток и с неигровых, и с игроков
  BIZ_SWEET: .95, BIZ_CAP: 2.1,   // берут не глядя до .95 ориентира, выше 2.1 — не берут вовсе
  BIZ_STREET_PASS: 1.2,   // часть горожан просто проходит мимо: одинокая лавка не забирает весь поток
  BIZ_DECOR_STEP: 24, BIZ_DECOR_MAX: 4,   // вложение в витрину: дороже с каждым уровнем, потолок 4
  BIZ_OWNER_CAP: 18, BIZ_STAFF_CAP: 14, BIZ_STAFF_WAGE: 3.5, BIZ_STAFF_MAX: 3,   // руки: сам хозяин и помощники
  BIZ_EQUIP_CAP: 16, BIZ_EQUIP_MAX: 3, BIZ_EQUIP_K: .45,   // оборудование: второй прилавок, ледник, колонка — узкое место не только в людях
  BIZ_UPKEEP: .008,       // содержание в сутки — доля цены лицензии; около 18% дневной маржи
  BIZ_LICENSE: 22.5, BIZ_LICENSE_CAP: 150,   // лицензия ≈ 27 дней чистой прибыли; потолок — для самых людных мест
  BIZ_DEBT_DAYS: 3,       // три дня без денег на содержание — заведение уходит городу
});

export const bizRef = (type, I) => sinkPrice(BIZ[type].ref, I);                         // ориентир розничной цены
export const bizCost = (type, I) => sinkPrice(BIZ[type].ref * ECON.BIZ_WHOLESALE, I);   // оптовая закупка единицы
export const bizPriceBounds = (type, I) => [round2(bizRef(type, I) * .5), round2(bizRef(type, I) * ECON.BIZ_CAP)];
export const bizLicense = (type, I) => Math.round(Math.min(BIZ[type].base * ECON.BIZ_LICENSE, ECON.BIZ_LICENSE_CAP) * bizRef(type, I) / 10) * 10;
export const bizUpkeep = (type, I) => round2(bizLicense(type, I) * ECON.BIZ_UPKEEP);
export const bizDecorPrice = (type, level, I) => Math.round(sinkPrice(ECON.BIZ_DECOR_STEP, I) * (level + 1));
// сколько горожан в день заходит за таким товаром во все заведения этого типа разом
export const bizPool = (type, online) => round2(BIZ[type].base * Math.sqrt(Math.max(1, online)));
// Пропускная способность — минимум из двух узких мест методики: люди и оборудование.
// Без оборудования лишние руки упираются в один прилавок, без людей не помогает и лучший прилавок.
export const bizCapacity = shop => ECON.BIZ_OWNER_CAP + ECON.BIZ_STAFF_CAP * (shop.staff || 0) + ECON.BIZ_EQUIP_CAP * (shop.equip || 0);
export const bizEquipPrice = (type, level, I) => Math.round(bizLicense(type, I) * ECON.BIZ_EQUIP_K * (level + 1) / 5) * 5;
export const bizEquipName = type => ({ CAFE: 'вторая стойка и плита', 'Ферма': 'сеялка и телега', 'FILLING STATION': 'вторая колонка',
  'POST OFFICE': 'второе окно', GROCERY: 'второй прилавок', BUTCHER: 'ледник и колода', 'Мельница': 'второй постав',
  GARAGE: 'подъёмник и станок', HOTEL: 'ещё номера', 'DRUG STORE': 'аптечный стол', BARBER: 'второе кресло',
  TAILOR: 'швейная машина', HARDWARE: 'склад при лавке', 'FEED & SEED': 'зерновой бункер' }[type] || 'оборудование');
// интерес к цене: до «сладкой» берут не думая, выше потолка — ноль, между ними гладко
export function bizPriceFit(type, price, I) {
  const ref = bizRef(type, I), sweet = ref * ECON.BIZ_SWEET, cap = ref * ECON.BIZ_CAP;
  if (price > cap) return 0;
  if (price <= sweet) return 1;
  return (cap - price) / (cap - sweet);
}
// привлекательность: цена, витрина и наличие товара на прилавке
// Пустой прилавок отпугивает, но НЕ вычёркивает лавку из потока — иначе владелец не увидит,
// скольких покупателей потерял, пока стоял без товара.
export function bizAttract(shop, I) {
  if (!shop.open) return 0;
  return bizPriceFit(shop.type, shop.price, I) * (.6 + .4 * ((shop.decor || 0) / ECON.BIZ_DECOR_MAX)) * ((shop.stock || 0) > 0 ? 1 : .35);
}
// доли потока между заведениями одного типа; сумма всегда меньше единицы — часть горожан проходит мимо
export function bizShares(shops, I) {
  const pw = shops.map(s => Math.pow(bizAttract(s, I), 1.25));
  const total = pw.reduce((a, b) => a + b, 0) + ECON.BIZ_STREET_PASS;
  return pw.map(p => p / total);
}
// Торговый день одного заведения. Три причины потерь считаем НЕЗАВИСИМО друг от друга, иначе
// подсказка врёт: пока товара меньше, чем рук, владелец никогда не увидит «не хватило рук»
// и не поймёт, что пора нанимать людей.
export function bizDay(shop, share, pool, I) {
  const want = Math.floor(pool * share), capacity = bizCapacity(shop), stock = shop.stock || 0;
  const sold = Math.max(0, Math.min(want, stock, capacity));
  const revenue = round2(sold * shop.price), tax = round2(revenue * ECON.BIZ_TAX);
  const wage = round2(ECON.BIZ_STAFF_WAGE * (shop.staff || 0) * Math.sqrt(I));
  const upkeep = bizUpkeep(shop.type, I);
  return { sold, want, revenue, tax, wage, upkeep, net: round2(revenue - tax - wage - upkeep),
    lostPrice: round2(Math.max(0, pool * (1 - share) - pool * ECON.BIZ_STREET_PASS / (ECON.BIZ_STREET_PASS + 1))),
    lostStock: Math.max(0, Math.min(want, capacity) - stock),   // пришли, а товара нет
    lostQueue: Math.max(0, want - capacity) };                  // пришли, а обслужить некому
}
// продажа живому игроку: деньги переходят владельцу, городу остаётся сбор
export function bizSale(price, I) { const tax = round2(price * ECON.BIZ_TAX); return { price: round2(price), tax, toOwner: round2(price - tax) }; }

// ================= БИРЖА: ДОЛИ В ДЕЛЕ =================
// У каждого заведения 100 долей. Кто занял дело — держит все. Долю можно продать любому игроку:
// продавец получает деньги сразу, покупатель — право на часть ежедневной прибыли.
// Управление идёт за большинством: собрал больше половины — заведение твоё (недружественный выкуп возможен,
// и это честно: продавая больше 49 долей, хозяин рискует делом, о чём его предупреждают).
// Город берёт биржевой сбор с каждой сделки и с каждой выплаты — это сток, а не перевод.
Object.assign(ECON, {
  SHARES: 100,              // долей в каждом деле
  SHARE_YIELD_DAYS: 20,     // ориентир цены доли: двадцать дней её прибыли
  SHARE_FEE: .05,           // биржевой сбор с сделки и с дивидендов
  SHARE_MIN_PRICE: .1,
  SHARE_ASSET_K: .5,        // пол цены доли — половина лицензии на 100 долей: свежее дело не отдать за гроши
  SHARE_PRICE_MIN_K: .3, SHARE_PRICE_MAX_K: 3,   // цену объявления держим в разумных пределах от ориентира
});
// Ориентир цены доли: либо двадцать дней её прибыли, либо доля имущества дела — что больше.
// Без имущественного пола контрольный пакет в только что купленном заведении уходил бы за гроши.
export const shareFair = (netPerDay, I = 1, license = 0) => round2(Math.max(
  ECON.SHARE_MIN_PRICE,
  license * ECON.SHARE_ASSET_K / ECON.SHARES,
  netPerDay * ECON.SHARE_YIELD_DAYS / ECON.SHARES * Math.sqrt(I)));
export const sharePriceBounds = (netPerDay, I = 1, license = 0) => {
  const f = shareFair(netPerDay, I, license);
  return [round2(Math.max(ECON.SHARE_MIN_PRICE, f * ECON.SHARE_PRICE_MIN_K)), round2(f * ECON.SHARE_PRICE_MAX_K)];
};
export const sharesOf = (shares, name) => (shares && shares[name]) || 0;
export const freeShares = (shares, name, listed = 0) => Math.max(0, sharesOf(shares, name) - listed);
// кто держит больше половины — тот и хозяин; при равенстве дело остаётся за нынешним
export function majorityOwner(shares, current) {
  let best = current, bestN = sharesOf(shares, current);
  for (const [name, n] of Object.entries(shares || {})) if (n > bestN) { best = name; bestN = n; }
  return bestN * 2 > ECON.SHARES ? best : current;
}
// сделка на бирже: продавец получает цену за вычетом сбора, сбор уходит городу
export function shareTrade(price, n) {
  const gross = round2(price * n), fee = round2(gross * ECON.SHARE_FEE);
  return { gross, fee, toSeller: round2(gross - fee) };
}
// дележ дневной прибыли: каждому по долям за вычетом сбора; хозяину — остаток.
// Убыток не делят: расходы заведения уже оплачены из кармана хозяина.
export function dividends(net, shares, owner) {
  if (!(net > 0)) return { total: 0, fee: 0, toOwner: round2(Math.min(0, net)), pay: {} };
  const pay = {}; let handed = 0, fee = 0;
  for (const [name, n] of Object.entries(shares || {})) {
    if (name === owner || !n) continue;
    const part = round2(net * n / ECON.SHARES), cut = round2(part * ECON.SHARE_FEE);
    if (part <= 0) continue;
    pay[name] = round2(part - cut); handed = round2(handed + part); fee = round2(fee + cut);
  }
  return { total: round2(handed - fee), fee, toOwner: round2(net - handed), pay };
}

// ================= ГОЛОД, КОФЕ И ПОДПОЛЬНЫЙ БАР =================
// Сытость — то, ради чего игрок вообще заходит в кафе, к мяснику и в бар. Она убывает сама,
// и голодный хуже работает: сначала медленнее ходит, потом теряет здоровье. Кофе греет ненадолго,
// но не кормит. Бар — единственное место, где самогонщик сбывает товар живому хозяину, а не городу.
Object.assign(ECON, {
  FED_MAX: 100, FED_PER_H: 4.2,        // за сутки съедается чуть больше сотни: есть надо примерно раз в игровой день
  FED_SLOW: 30, FED_HURT: 10,          // ниже 30 — вялый шаг, ниже 10 — здоровье уходит
  FED_SLOW_K: .72, FED_HURT_HP: 2.5,   // насколько медленнее и сколько здоровья теряет в игровой час
  DRINK_FED: 8, DRINK_CHEER_H: 3,      // выпивка почти не кормит, зато даёт «кураж» на три часа
  CHEER_WANTED: -6,                    // за стойкой с людьми розыск утихает: свой парень, не чужак
  BAR_BUY_K: .62,                      // почём бар берёт галлон у самогонщика — доля розничной цены стопки × порций
  BAR_POURS: 8,                        // сколько стопок выходит из галлона
  BAR_RAID_K: .012,                     // шанс облавы на бар за игровой день на каждый галлон в запасе
});
// Еда: сколько сытости даёт и где продаётся. Голод — общий стимул для кафе, мясника и фермы.
export const FOOD = {
  meal:    { fed: 55 }, steak: { fed: 45 }, coffee: { fed: 4 },
  bread:   { fed: 25 }, drink: { fed: ECON.DRINK_FED },
};
export const fedAfter = (fed, hours) => clamp(fed - ECON.FED_PER_H * hours, 0, ECON.FED_MAX);
export const fedEat = (fed, key) => clamp(fed + ((FOOD[key] || {}).fed || 0), 0, ECON.FED_MAX);
// множитель скорости от сытости: сытый идёт как обычно, голодный — вяло
export const fedSpeed = fed => (fed >= ECON.FED_SLOW ? 1 : ECON.FED_SLOW_K + (1 - ECON.FED_SLOW_K) * (fed / ECON.FED_SLOW));
export const fedHurt = (fed, hours) => (fed <= ECON.FED_HURT ? round2(ECON.FED_HURT_HP * hours) : 0);
export const fedState = fed => fed >= 60 ? 'сыт' : fed >= ECON.FED_SLOW ? 'проголодался' : fed >= ECON.FED_HURT ? 'голоден' : 'падает с ног';

// Бар: берёт самогон у игроков галлонами и разливает стопками. Цена закупки привязана к тому,
// почём он наливает: хозяин не может брать дороже, чем сам выручит, иначе разорится.
export const barPourPrice = (type, I) => bizRef(type, I);
export const barBuyPrice = (type, I, markup = 1) => round2(barPourPrice(type, I) * markup * ECON.BAR_POURS * ECON.BAR_BUY_K);
export const barRaidChance = gallons => clamp(gallons * ECON.BAR_RAID_K, 0, .6);
