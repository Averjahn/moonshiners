// ГОЛОС РЯДОМ. WebRTC напрямую между браузерами игроков, сигналинг — через наш WebSocket (t:'rtc').
// Соединяемся только с теми, кто близко и тоже включил голос (до 8 ближайших в радиусе слышимости).
// Звук объёмный: громкость падает с расстоянием, лево-право — по положению на экране.
// Режимы: выкл → только слушаю → говорю по V → открытый микрофон.
// Микрофон браузер даёт только на HTTPS (или localhost) — на http слушать можно, говорить нельзя.
const HEAR_R = 45, DROP_R = 60, MAX_PEERS = 8, CONNECT_TIMEOUT = 10000, RETRY_AFTER = 15000;
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const FWD = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };   // «вперёд» слушателя — вглубь экрана, как смотрит изометрическая камера
const ORDER = ['off', 'listen', 'ptt', 'open'];
const LABEL = { off: 'Голос: выкл', listen: 'Голос: слушаю', ptt: 'Голос: говорить — V', open: 'Голос: микрофон открыт' };

export function createVoice({ net, myId, me, peers, onLevel, onMyLevel, onStatus }) {
  let mode = 'off', pttDown = false, stream = null, ctx = null, myAnalyser = null, lastTick = 0;
  const conns = new Map(), retryAt = new Map(), buf = new Uint8Array(512);
  const say = t => onStatus && onStatus(t);
  const track = () => (stream ? stream.getAudioTracks()[0] : null);
  function audioCtx() { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  function applyMic() { const t = track(); if (t) t.enabled = mode === 'open' || (mode === 'ptt' && pttDown); }
  const level = an => { an.getByteTimeDomainData(buf); let s = 0; for (let q = 0; q < buf.length; q++) { const v = (buf[q] - 128) / 128; s += v * v; } return Math.sqrt(s / buf.length); };

  async function ensureMic() {
    if (stream) return true;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say('Голос: говорить можно только по HTTPS'); return false; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { say('Голос: нет доступа к микрофону'); return false; }
    const c = audioCtx(); myAnalyser = c.createAnalyser(); myAnalyser.fftSize = 512; c.createMediaStreamSource(stream).connect(myAnalyser);
    for (const cn of conns.values()) if (cn.sender) cn.sender.replaceTrack(track());
    return true;
  }
  function releaseMic() {
    for (const cn of conns.values()) if (cn.sender) cn.sender.replaceTrack(null);
    if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; myAnalyser = null;
  }

  function makeConn(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE }), cn = { pc, sender: null, pending: [], remoteSet: false, born: performance.now() };
    pc.onicecandidate = e => { if (e.candidate) net.send({ t: 'rtc', to: id, kind: 'ice', cand: e.candidate }); };
    pc.ontrack = e => attachRemote(cn, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { drop(id); retryAt.set(id, performance.now() + RETRY_AFTER); } };
    conns.set(id, cn); return cn;
  }
  function attachRemote(cn, ms) {
    if (cn.audio) return; const c = audioCtx();
    cn.audio = new Audio(); cn.audio.srcObject = ms; cn.audio.muted = true; cn.audio.play().catch(() => {});   // без привязки к <audio> Chrome не отдаёт звук WebRTC в Web Audio
    const src = c.createMediaStreamSource(ms);
    cn.analyser = c.createAnalyser(); cn.analyser.fftSize = 512;
    cn.panner = c.createPanner(); Object.assign(cn.panner, { panningModel: 'HRTF', distanceModel: 'linear', refDistance: 3, maxDistance: HEAR_R, rolloffFactor: 1 });
    cn.gain = c.createGain();
    src.connect(cn.analyser); src.connect(cn.panner); cn.panner.connect(cn.gain); cn.gain.connect(c.destination);
  }
  // звонит тот, у кого id меньше, — двое не звонят друг другу одновременно
  async function call(id) {
    const cn = makeConn(id), tr = cn.pc.addTransceiver('audio', { direction: 'sendrecv' }); cn.sender = tr.sender;
    if (track()) await cn.sender.replaceTrack(track());
    await cn.pc.setLocalDescription(await cn.pc.createOffer());
    net.send({ t: 'rtc', to: id, kind: 'offer', sdp: cn.pc.localDescription });
  }
  function drop(id, tell = true) {
    const cn = conns.get(id); if (!cn) return; conns.delete(id);
    try { cn.pc.close(); } catch {}
    if (cn.audio) cn.audio.srcObject = null; if (cn.gain) cn.gain.disconnect();
    if (tell) net.send({ t: 'rtc', to: id, kind: 'bye' }); onLevel && onLevel(id, 0);
  }
  async function flushIce(cn) { for (const c of cn.pending) await cn.pc.addIceCandidate(c); cn.pending = []; }

  net.on('rtc', async msg => {
    if (mode === 'off') { if (msg.kind === 'offer') net.send({ t: 'rtc', to: msg.from, kind: 'bye' }); return; }
    const id = msg.from;
    try {
      if (msg.kind === 'offer') {
        if (conns.has(id)) drop(id, false);
        const cn = makeConn(id); await cn.pc.setRemoteDescription(msg.sdp); cn.remoteSet = true;
        const tr = cn.pc.getTransceivers()[0]; if (tr) { tr.direction = 'sendrecv'; cn.sender = tr.sender; if (track()) await cn.sender.replaceTrack(track()); }
        await cn.pc.setLocalDescription(await cn.pc.createAnswer());
        net.send({ t: 'rtc', to: id, kind: 'answer', sdp: cn.pc.localDescription }); await flushIce(cn);
      } else if (msg.kind === 'answer') { const cn = conns.get(id); if (!cn) return; await cn.pc.setRemoteDescription(msg.sdp); cn.remoteSet = true; await flushIce(cn); }
      else if (msg.kind === 'ice') { const cn = conns.get(id); if (!cn) return; if (cn.remoteSet) await cn.pc.addIceCandidate(msg.cand); else cn.pending.push(msg.cand); }
      else if (msg.kind === 'bye') drop(id, false);
    } catch (e) { console.warn('voice:', e && e.message); }
  });

  function update() {
    if (mode === 'off') return;
    const id0 = myId(); if (id0 == null) return;
    const pos = me(), list = peers(), now = performance.now();
    if (now - lastTick > 500) { lastTick = now;
      const near = list.map(q => ({ ...q, d: Math.hypot(q.x - pos.x, q.z - pos.z) })).sort((a, b) => a.d - b.d);
      const want = new Set(near.filter(q => q.d < HEAR_R).slice(0, MAX_PEERS).map(q => q.id));
      for (const q of near) if (want.has(q.id) && !conns.has(q.id) && id0 < q.id && !(retryAt.get(q.id) > now)) call(q.id).catch(() => drop(q.id, false));
      const dist = new Map(near.map(q => [q.id, q.d]));
      for (const [id, cn] of [...conns]) { const d = dist.get(id);
        if (d == null || d > DROP_R) drop(id);
        else if (cn.pc.connectionState !== 'connected' && now - cn.born > CONNECT_TIMEOUT) { drop(id); retryAt.set(id, now + RETRY_AFTER); } } }
    if (!ctx) return;
    const L = ctx.listener;
    if (L.positionX) { L.positionX.value = pos.x; L.positionY.value = 1.6; L.positionZ.value = pos.z; L.forwardX.value = FWD.x; L.forwardY.value = 0; L.forwardZ.value = FWD.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(pos.x, 1.6, pos.z); L.setOrientation(FWD.x, 0, FWD.z, 0, 1, 0); }
    const at = new Map(list.map(q => [q.id, q]));
    for (const [id, cn] of conns) { const q = at.get(id); if (!q || !cn.panner) continue;
      if (cn.panner.positionX) { cn.panner.positionX.value = q.x; cn.panner.positionY.value = 1.6; cn.panner.positionZ.value = q.z; } else cn.panner.setPosition(q.x, 1.6, q.z);
      onLevel && onLevel(id, level(cn.analyser)); }
    if (onMyLevel) onMyLevel(myAnalyser && track() && track().enabled ? level(myAnalyser) : 0);
  }

  async function setMode(m) {
    mode = m;
    if (m === 'off') { for (const id of [...conns.keys()]) drop(id); releaseMic(); net.send({ t: 'voice', on: false }); say(LABEL.off); return; }
    audioCtx(); net.send({ t: 'voice', on: true });
    if (m === 'ptt' || m === 'open') { if (!await ensureMic()) { mode = 'listen'; applyMic(); return; } }
    else releaseMic();
    applyMic(); say(LABEL[mode]);
  }
  return {
    update, setMode,
    cycle: () => setMode(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]),
    ptt(down) { if (pttDown === down) return; pttDown = down; if (down && (mode === 'off' || mode === 'listen')) setMode('ptt'); else applyMic(); },
    get mode() { return mode; }, get peers() { return [...conns.keys()]; },
  };
}
