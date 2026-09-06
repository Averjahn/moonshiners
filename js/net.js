// Тонкий клиент WS: только пересылка сообщений, никакой логики (она на сервере).
export function connect(name) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const handlers = {};
  const net = { ws, connected: false,
    on(type, fn) { handlers[type] = fn; },
    send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); } };
  ws.addEventListener('open', () => { net.connected = true; net.send({ t: 'hello', name }); });
  ws.addEventListener('close', () => { net.connected = false; });
  ws.addEventListener('message', e => { let msg; try { msg = JSON.parse(e.data); } catch { return; } handlers[msg.t]?.(msg); });
  return net;
}
