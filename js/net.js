// Тонкий клиент WS: только пересылка сообщений, никакой логики (она на сервере).
export function connect(name, role) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const handlers = {};
  const net = { ws, connected: false,
    // на один тип может быть несколько подписчиков — иначе вторая подписка молча затирает первую
    on(type, fn) { (handlers[type] || (handlers[type] = [])).push(fn); },
    send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); } };
  ws.addEventListener('open', () => { net.connected = true; net.send({ t: 'hello', name, role }); });
  ws.addEventListener('close', () => { net.connected = false; });
  ws.addEventListener('message', e => { let msg; try { msg = JSON.parse(e.data); } catch { return; } for (const fn of handlers[msg.t] || []) fn(msg); });
  return net;
}
