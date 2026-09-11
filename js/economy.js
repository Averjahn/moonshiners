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
  meal:     { place: 'CAFE', name: 'Обед', price: 1.2, hp: 100 },
  coffee:   { place: 'CAFE', name: 'Кофе', price: .3, buffH: 2 },
  room:     { place: 'HOTEL', name: 'Номер до утра (здоровье и тайник на ночь)', price: 6, hp: 100 },
  medicine: { place: 'DRUG STORE', name: 'Лекарство от ожогов', price: 4, hp: 100 },
  bandage:  { place: 'DRUG STORE', name: 'Бинт', price: 1.5, hp: 40 },
  haircut:  { place: 'BARBER', name: 'Стрижка и бритьё (−25 к розыску)', price: 3, wanted: -25 },
  suit:     { place: 'TAILOR', name: 'Новый костюм (−40 к розыску)', price: 18, wanted: -40 },
  telegram: { place: 'POST OFFICE', name: 'Телеграмма', price: .5 },
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
