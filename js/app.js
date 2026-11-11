/* Zeitschiene: Steuerung der Oberfläche */
'use strict';
const App = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => n.toLocaleString('de-CH');
  const pl = (n, a, b) => `${fmt(n)} ${n === 1 ? a : b}`;
  const dur = s => s == null ? '' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  const DAY = 86400e3;
  const S = {
    files: [], events: [], set: { gapH: 8, minSize: 12, awayKm: 40, hideShots: true }, titles: {},
    dir: null, handles: new Map(), raw: new Map(), readable: false, regT: [], regD: [], cur: [], li: 0, first: true, curEvent: null
  };
  const supported = 'showDirectoryPicker' in window;

  /* ---------- Dateizugriff ---------- */
  async function getFile(path) {
    if (S.raw.has(path)) return S.raw.get(path);
    if (!S.readable || !S.dir) return null;
    try {
      let h = S.handles.get(path);
      if (!h) { // vor dem ersten Einlesen: Pfad Schritt für Schritt auflösen
        const parts = path.split('/'); let d = S.dir;
        for (let i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i]);
        h = await d.getFileHandle(parts[parts.length - 1]); S.handles.set(path, h);
      }
      return await h.getFile();
    } catch (e) { return null; }
  }
  const canRead = () => S.readable || S.raw.size > 0;

  async function pool(arr, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: n }, async () => { while (i < arr.length) { const k = i++; await fn(arr[k], k); } }));
  }

  /* ---------- Fortschritt ---------- */
  function progress(title, done, total, text) {
    $('progress').hidden = false; $('pTitle').textContent = title;
    $('pBar').style.width = total ? (done / total * 100).toFixed(1) + '%' : '0';
    $('pText').textContent = text || (total ? `${fmt(done)} von ${fmt(total)}` : '');
  }
  const progressEnd = () => { $('progress').hidden = true; };

  /* ---------- Einlesen ---------- */
  async function walk(dir, prefix, out) {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.') || name.startsWith('$') || name === 'System Volume Information') continue;
      if (h.kind === 'directory') await walk(h, prefix + name + '/', out);
      else if (Meta.kindOf(name)) { out.push([prefix + name, h]); if (out.length % 250 === 0) progress('Ordner wird durchsucht', 0, 0, `${fmt(out.length)} Fotos und Videos gefunden`); }
    }
  }
  async function scan() {
    let entries = [];
    try {
      if (S.raw.size) entries = [...S.raw].map(([p, f]) => [p, f]);
      else { progress('Ordner wird durchsucht', 0, 0, 'Einen Moment …'); S.handles = new Map(); await walk(S.dir, '', entries); entries.forEach(([p, h]) => S.handles.set(p, h)); }
    } catch (e) { progressEnd(); return lostAccess(); }
    const known = new Map(S.files.map(f => [f.path, f])), next = [], changed = [];
    let done = 0;
    await pool(entries, 16, async ([path, src]) => {
      try {
        const file = src instanceof File ? src : await src.getFile();
        const old = known.get(path);
        if (old && old.size === file.size && old.mtime === file.lastModified) next.push(old);
        else { const r = await Meta.analyze(path, file); next.push(r); changed.push(r); }
      } catch (e) { /* Datei nicht lesbar: überspringen */ }
      if (++done % 100 === 0 || done === entries.length) progress('Aufnahmedaten werden gelesen', done, entries.length);
    });
    const present = new Set(next.map(f => f.path));
    const removed = [...known.keys()].filter(p => !present.has(p));
    await DB.putMany('files', changed); await DB.delMany('files', removed);
    const stale = removed.concat(changed.map(c => c.path)); await DB.delMany('thumbs', stale); Thumbs.forget(stale);
    S.files = next; progressEnd(); showApp();
    if (S.first || changed.length || removed.length) rebuild();
    startThumbs();
  }
  function startThumbs() { Thumbs.background(S.files.filter(f => !(S.set.hideShots && f.shot)), showThumbProg); }
  function showThumbProg(bg) { $('thumbProg').textContent = bg.on ? `Vorschaubilder ${fmt(bg.done)} / ${fmt(bg.total)}` : ''; $('sThumbs').textContent = bg.on ? 'Vorbereiten anhalten' : 'Vorschaubilder vorbereiten'; }
  function lostAccess() { S.readable = false; $('banner').hidden = false; }

  async function pick() {
    let d;
    try { d = await window.showDirectoryPicker({ id: 'zeitschiene', mode: 'read', startIn: 'pictures' }); }
    catch (e) { return; }
    if (S.dir && !(await S.dir.isSameEntry(d))) { S.files = []; await DB.clear('files'); await Thumbs.clearAll(); S.first = true; }
    S.dir = d; S.readable = true; S.raw = new Map();
    await DB.put('meta', d, 'dir');
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    $('banner').hidden = true; scan();
  }
  async function reconnect() {
    if (!supported) return $('fallback').click();
    if (!S.dir) return pick();
    try { if (await S.dir.requestPermission({ mode: 'read' }) === 'granted') { S.readable = true; $('banner').hidden = true; $('start').hidden = true; return scan(); } } catch (e) { /* weiter */ }
    pick();
  }
  function fromInput(list) {
    S.raw = new Map();
    for (const f of list) { const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name; if (Meta.kindOf(f.name)) S.raw.set(rel, f); }
    $('banner').hidden = true; scan();
  }

  /* ---------- Zeitschiene ---------- */
  const STEP = 132, YGAP = 110, AX = 280;
  let pos = [], yPos = {}, io = null, ioD = null, y0 = 0, nM = 0;
  const monthIdx = t => { const d = new Date(t); return (d.getUTCFullYear() - y0) * 12 + d.getUTCMonth() + (d.getUTCDate() - 1) / 31; };

  function covers(e) {
    const src = e.nImg >= 3 ? e.items.filter(i => i.kind === 'img') : e.items, n = src.length;
    return n <= 3 ? src : [src[0], src[n >> 1], src[n - 1]];
  }
  function tileHTML(rec, reg, extra) {
    const k = reg.push(rec) - 1;
    return `<div class="tile" data-r="${k}" ${extra || ''}>${rec.kind === 'vid' ? `<span class="vbadge">${dur(rec.dur)}</span>` : ''}</div>`;
  }
  function loadTile(t, reg) {
    const rec = reg[+t.dataset.r]; if (!rec) return;
    Thumbs.url(rec).then(u => { if (u) t.style.backgroundImage = `url("${u}")`; else if (Thumbs.has(rec.path)) t.classList.add('fail'); });
  }

  function rebuild() {
    const track = $('track'), center = S.first ? null : timeAtCenter();
    S.events = Group.build(S.files, S.set, S.titles);
    renderTimeline();
    if (center == null) scrollToIdx(pos.length - 1, 'end');
    else { let i = S.events.findIndex(e => e.start >= center); scrollToIdx(i < 0 ? pos.length - 1 : i, 'center'); }
    S.first = false; updWin();
    const n = S.events.reduce((a, e) => a + e.items.length, 0);
    $('totals').textContent = S.events.length ? `${fmt(n)} Dateien · ${new Date(S.events[0].start).getUTCFullYear()} bis ${new Date(S.events[S.events.length - 1].end).getUTCFullYear()} · ${fmt(S.events.filter(e => !e.alltag).length)} Erlebnisse` : '';
    void track;
  }
  function renderTimeline() {
    const stage = $('stage'); S.regT = []; pos = []; yPos = {};
    if (io) io.disconnect();
    io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); loadTile(e.target, S.regT); } }), { root: $('track'), rootMargin: '0px 900px' });
    if (!S.events.length) { stage.style.width = '100%'; stage.innerHTML = '<p class="empty">Keine Fotos oder Videos gefunden.</p>'; $('yearChips').innerHTML = ''; $('histo').querySelectorAll('i').forEach(i => i.remove()); return; }
    let x = 90, lastY = null, html = '<div class="axis"></div>';
    S.events.forEach((e, i) => {
      const y = new Date(e.start).getUTCFullYear();
      if (y !== lastY) { if (lastY !== null) x += YGAP - STEP / 2; yPos[y] = x; html += `<button class="ymark" type="button" data-y="${y}" style="left:${x}px">${y}</button>`; x += YGAP; lastY = y; }
      const up = i % 2 === 0, cv = covers(e), rest = e.items.length - cv.length;
      const tiles = cv.map((r, k) => tileHTML(r, S.regT).replace(/<\/div>$/, k === cv.length - 1 && rest > 0 ? `<span class="more">+${fmt(rest)}</span></div>` : '</div>')).join('');
      const cnt = [e.nImg ? pl(e.nImg, 'Foto', 'Fotos') : '', e.nVid ? pl(e.nVid, 'Video', 'Videos') : ''].filter(Boolean).join(' · ');
      const sub = Group.range(e) + (e.place && e.title !== e.place ? ' · ' + e.place : '');
      html += `<div class="stem" style="left:${x - 1}px;top:${up ? AX - 34 : AX}px"></div><span class="dot${e.alltag ? ' alltag' : ''}" style="left:${x}px"></span>
        <div class="card${e.alltag ? ' alltag' : ''}" role="button" tabindex="0" data-i="${i}" style="left:${x - 118}px;top:${up ? AX - 34 - 206 : AX + 34}px" aria-label="${esc(e.title)} öffnen">
          <div class="cov n${cv.length}">${tiles}</div><div class="txt"><b title="${esc(e.title)}">${esc(e.title)}</b><span class="d">${esc(sub)}</span><span class="c">${cnt}</span></div></div>`;
      pos.push(x); x += STEP;
    });
    stage.style.width = (x + 120) + 'px'; stage.innerHTML = html;
    stage.querySelectorAll('.tile').forEach(t => io.observe(t));
    // Jahr-Knöpfe
    const years = Object.keys(yPos);
    $('yearChips').innerHTML = years.map(y => `<button type="button" data-y="${y}">${y}</button>`).join('');
    // Übersicht: Dateien pro Monat
    y0 = +years[0]; const y1 = +years[years.length - 1]; nM = (y1 - y0 + 1) * 12;
    const bins = new Array(nM).fill(0);
    S.events.forEach(e => e.items.forEach(it => { const k = Math.floor(monthIdx(it.t)); if (k >= 0 && k < nM) bins[k]++; }));
    const mx = Math.max(1, ...bins), histo = $('histo');
    histo.querySelectorAll('i').forEach(i => i.remove());
    histo.insertAdjacentHTML('afterbegin', bins.map((v, k) => `<i style="height:${v ? Math.max(4, v / mx * 100) : 0}%" title="${Group.MS[k % 12]} ${y0 + Math.floor(k / 12)}: ${fmt(v)} Dateien"></i>`).join(''));
    const stepY = Math.max(1, Math.ceil((y1 - y0 + 1) / 14));
    $('hyears').innerHTML = years.filter(y => (y - y0) % stepY === 0).map(y => `<span style="left:${((y - y0) * 12 + 6) / nM * 100}%">${y}</span>`).join('');
  }
  function xToMonth(px) {
    if (!pos.length) return 0;
    if (px <= pos[0]) return monthIdx(S.events[0].start);
    for (let i = 1; i < pos.length; i++) if (px <= pos[i]) { const f = (px - pos[i - 1]) / (pos[i] - pos[i - 1]); return monthIdx(S.events[i - 1].start) + f * (monthIdx(S.events[i].start) - monthIdx(S.events[i - 1].start)); }
    return monthIdx(S.events[S.events.length - 1].end) + 0.5;
  }
  function timeAtCenter() {
    const t = $('track'), c = t.scrollLeft + t.clientWidth / 2;
    for (let i = 0; i < pos.length; i++) if (pos[i] >= c) return S.events[i] ? S.events[i].start : null;
    return null;
  }
  function scrollToIdx(i, where) {
    const t = $('track'); if (i < 0 || !pos.length) return;
    t.scrollLeft = where === 'end' ? t.scrollWidth : pos[i] - t.clientWidth / 2;
  }
  function updWin() {
    const t = $('track'), win = $('win'); if (!nM || !pos.length) return;
    const a = xToMonth(t.scrollLeft), b = xToMonth(t.scrollLeft + t.clientWidth);
    win.style.left = (Math.max(0, a) / nM * 100) + '%'; win.style.width = Math.max(1.2, (b - a) / nM * 100) + '%';
    const c = timeAtCenter(), yc = c ? new Date(c).getUTCFullYear() : null;
    $('yearChips').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.y === yc));
  }

  /* ---------- Detailansicht ---------- */
  function openLayer() {
    $('layer').hidden = false; $('lbody').scrollTop = 0; $('back').focus();
    if (ioD) ioD.disconnect();
    ioD = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { ioD.unobserve(e.target); loadTile(e.target, S.regD); } }), { root: $('lbody'), rootMargin: '600px 0px' });
    $('lbody').querySelectorAll('.tile').forEach(t => ioD.observe(t));
  }
  function openEvent(i) {
    const e = S.events[i]; S.curEvent = e; S.regD = []; S.cur = [];
    $('lTitle').textContent = e.title; $('rename').hidden = false;
    $('lSub').textContent = [Group.range(e), e.place ? e.place + (e.cc && e.cc !== 'CH' ? ', ' + Geo.country(e.cc) : '') : '', e.nImg ? pl(e.nImg, 'Foto', 'Fotos') : '', e.nVid ? pl(e.nVid, 'Video', 'Videos') : ''].filter(Boolean).join(' · ');
    const days = new Map();
    e.items.forEach(it => { const k = Math.floor(it.t / DAY); if (!days.has(k)) days.set(k, []); days.get(k).push(it); });
    let bar = '', body = '';
    for (const [k, list] of days) {
      const d = new Date(k * DAY), lab = `${Group.WD[d.getUTCDay()].slice(0, 2)} ${d.getUTCDate()}. ${Group.MS[d.getUTCMonth()]}`;
      bar += `<button type="button" data-d="${k}">${lab} · ${fmt(list.length)}</button>`;
      body += `<div class="dgroup" id="day${k}"><h3>${Group.WD[d.getUTCDay()]}, ${d.getUTCDate()}. ${Group.MON[d.getUTCMonth()]} ${d.getUTCFullYear()}<span>${pl(list.length, 'Datei', 'Dateien')}</span></h3><div class="grid">${list.map(r => { const c = S.cur.push(r) - 1; return tileHTML(r, S.regD, `data-c="${c}" tabindex="0" role="button" aria-label="${r.kind === 'vid' ? 'Video' : 'Foto'} öffnen"`); }).join('')}</div></div>`;
    }
    $('daybar').innerHTML = bar; $('daybar').hidden = days.size < 2; $('lbody').innerHTML = body;
    openLayer();
  }
  function openYear(y) {
    S.curEvent = null; S.regD = []; S.cur = [];
    const list = S.events.map((e, i) => [e, i]).filter(([e]) => new Date(e.start).getUTCFullYear() === +y);
    const n = list.reduce((a, [e]) => a + e.items.length, 0);
    $('lTitle').textContent = `Jahr ${y}`; $('rename').hidden = true;
    $('lSub').textContent = `${list.filter(([e]) => !e.alltag).length} Erlebnisse · ${fmt(n)} Dateien`;
    $('daybar').innerHTML = list.map(([e, i]) => `<button type="button" data-ev="${i}">${Group.MS[new Date(e.start).getUTCMonth()]} · ${esc(e.title)}</button>`).join(''); $('daybar').hidden = false;
    $('lbody').innerHTML = list.map(([e, i]) => {
      const its = e.items.length <= 12 ? e.items : Array.from({ length: 12 }, (_, k) => e.items[Math.floor(k * e.items.length / 12)]);
      return `<div class="dgroup" id="ev${i}"><div class="hd"><h3>${esc(e.title)}<span>${esc(Group.range(e))}${e.place ? ' · ' + esc(e.place) : ''}</span></h3><button class="btn" type="button" data-open="${i}">Alle ${fmt(e.items.length)} ansehen →</button></div><div class="row12">${its.map(r => { const c = S.cur.push(r) - 1; return tileHTML(r, S.regD, `data-c="${c}" tabindex="0" role="button"`); }).join('')}</div></div>`;
    }).join('');
    openLayer();
  }
  const closeLayer = () => { $('layer').hidden = true; endRename(false); };
  function startRename() {
    const inp = $('lEdit'); inp.value = S.curEvent.title; inp.hidden = false; $('lTitle').hidden = true; inp.focus(); inp.select();
  }
  async function endRename(save) {
    const inp = $('lEdit'); if (inp.hidden) return;
    inp.hidden = true; $('lTitle').hidden = false;
    const e = S.curEvent; if (!save || !e) return;
    const v = inp.value.trim();
    if (!v || v === e.auto) delete S.titles[e.id]; else S.titles[e.id] = v;
    e.title = S.titles[e.id] || e.auto; $('lTitle').textContent = e.title;
    await DB.put('meta', S.titles, 'titles');
    const t = $('track').scrollLeft; renderTimeline(); $('track').scrollLeft = t;
  }

  /* ---------- Grossansicht ---------- */
  let lbUrl = null;
  async function showLB() {
    const r = S.cur[S.li], m = $('lbMedia');
    if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
    m.innerHTML = '';
    const d = new Date(r.t), pl = r.lat != null ? Geo.place(r.lat, r.lon) : null;
    $('lbInfo').textContent = `${S.li + 1} von ${fmt(S.cur.length)} · ${Group.WD[d.getUTCDay()].slice(0, 2)}, ${d.getUTCDate()}. ${Group.MON[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}${r.tSrc === 'datei' ? ' (Datum der Datei, keine Aufnahmezeit)' : ''}${pl ? ' · ' + pl.name : ''}`;
    $('lbPath').textContent = r.path;
    const want = S.li, file = await getFile(r.path);
    if (want !== S.li) return;
    if (!file) {
      const u = await Thumbs.url(r);
      m.innerHTML = u ? `<img alt="">` : '<p class="err">Kein Zugriff auf den Ordner. Oben auf „Ordner freigeben“ klicken.</p>';
      if (u) m.firstChild.src = u; return;
    }
    lbUrl = URL.createObjectURL(file);
    if (r.kind === 'vid') {
      const v = document.createElement('video'); v.controls = true; v.autoplay = true; v.playsInline = true; v.src = lbUrl;
      v.onerror = () => { m.innerHTML = '<p class="err">Chrome kann dieses Videoformat nicht abspielen. Häufige Ursachen: H.265/HEVC ohne passende Windows-Erweiterung, AVI oder ältere Formate. Der Pfad unten lässt sich kopieren, um die Datei im Explorer zu öffnen.</p>'; };
      m.appendChild(v);
    } else {
      const img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.src = lbUrl; m.appendChild(img);
    }
  }
  function openLB(c) { S.li = c; $('lb').hidden = false; showLB(); $('lbClose').focus(); }
  function closeLB() { $('lb').hidden = true; $('lbMedia').innerHTML = ''; if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; } }
  const stepLB = d => { S.li = (S.li + d + S.cur.length) % S.cur.length; showLB(); };

  /* ---------- Einstellungen ---------- */
  async function openSettings() {
    $('sGap').value = S.set.gapH; $('sMin').value = S.set.minSize; $('sAway').value = S.set.awayKm; $('sShots').checked = S.set.hideShots;
    $('sClearConfirm').hidden = true; $('sPick').hidden = !supported;
    let info = `${fmt(S.files.length)} Dateien im Verzeichnis` + (S.dir ? ` · Ordner „${S.dir.name}“` : '');
    try { const est = await navigator.storage.estimate(); const per = navigator.storage.persisted ? await navigator.storage.persisted() : false; info += ` · Zwischenspeicher ${fmt(Math.round(est.usage / 1048576))} MB` + (per ? ' (dauerhaft)' : ' (der Browser darf ihn bei Platzmangel leeren)'); } catch (e) { /* ohne Angabe */ }
    $('sInfo').textContent = info;
    $('settings').showModal();
  }
  async function saveSettings() {
    const n = (id, min, max, def) => { const v = Math.round(+$(id).value); return v >= min && v <= max ? v : def; };
    S.set = { gapH: n('sGap', 1, 72, 8), minSize: n('sMin', 1, 100, 12), awayKm: n('sAway', 5, 1000, 40), hideShots: $('sShots').checked };
    await DB.put('meta', S.set, 'settings'); rebuild();
  }

  /* ---------- Ereignisse verdrahten ---------- */
  function wire() {
    $('pick').onclick = pick; $('reopen').onclick = reconnect; $('reconnect').onclick = reconnect;
    $('fallback').onchange = e => { if (e.target.files.length) fromInput(e.target.files); };
    const track = $('track');
    track.addEventListener('scroll', updWin, { passive: true }); window.addEventListener('resize', updWin);
    track.addEventListener('wheel', ev => {
      if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return;
      ev.preventDefault(); track.scrollLeft += ev.deltaY * (ev.deltaMode === 1 ? 40 : 1);
    }, { passive: false });
    $('stage').addEventListener('click', ev => {
      const c = ev.target.closest('.card'); if (c) return openEvent(+c.dataset.i);
      const y = ev.target.closest('.ymark'); if (y) openYear(y.dataset.y);
    });
    $('yearChips').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) { track.scrollLeft = yPos[b.dataset.y] - 40; } });
    $('histo').addEventListener('click', ev => {
      const r = $('histo').getBoundingClientRect(), m = (ev.clientX - r.left) / r.width * nM;
      let i = S.events.findIndex(e => monthIdx(e.end) >= m); if (i < 0) i = S.events.length - 1; scrollToIdx(i, 'center');
    });
    $('back').onclick = closeLayer; $('rename').onclick = startRename;
    $('lEdit').addEventListener('keydown', e => { if (e.key === 'Enter') endRename(true); if (e.key === 'Escape') { e.stopPropagation(); endRename(false); } });
    $('lEdit').addEventListener('blur', () => endRename(true));
    $('daybar').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; const t = $(b.dataset.d !== undefined ? 'day' + b.dataset.d : 'ev' + b.dataset.ev); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('lbody').addEventListener('click', ev => { const o = ev.target.closest('[data-open]'); if (o) return openEvent(+o.dataset.open); const t = ev.target.closest('[data-c]'); if (t) openLB(+t.dataset.c); });
    $('lbClose').onclick = closeLB; $('lbPrev').onclick = () => stepLB(-1); $('lbNext').onclick = () => stepLB(1);
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('.card,[data-c]')) { ev.target.click(); return; }
      if (!$('lb').hidden) { if (ev.key === 'Escape') closeLB(); else if (ev.key === 'ArrowRight') stepLB(1); else if (ev.key === 'ArrowLeft') stepLB(-1); return; }
      if (!$('layer').hidden) { if (ev.key === 'Escape') closeLayer(); return; }
      if (!$('app').hidden && $('settings').open === false) { if (ev.key === 'ArrowRight') track.scrollLeft += 400; if (ev.key === 'ArrowLeft') track.scrollLeft -= 400; }
    });
    $('openSettings').onclick = openSettings;
    $('settings').addEventListener('close', () => { if ($('settings').returnValue === 'save') saveSettings(); });
    $('sRescan').onclick = () => { $('settings').close(); if (canRead()) scan(); else reconnect(); };
    $('sThumbs').onclick = () => { if (Thumbs.state().on) Thumbs.stop(); else startThumbs(); };
    $('sPick').onclick = () => { $('settings').close(); pick(); };
    $('sClear').onclick = () => { $('sClearConfirm').hidden = false; };
    $('sClearYes').onclick = async () => { Thumbs.stop(); await Promise.all(['files', 'thumbs', 'meta'].map(s => DB.clear(s))); location.reload(); };
  }
  function showApp() { $('start').hidden = true; $('app').hidden = false; }

  /* ---------- Start ---------- */
  async function init() {
    wire();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (!supported) {
      $('pick').hidden = true; $('fallbackWrap').hidden = false;
      $('startNote').textContent = 'Dieser Browser kann sich den Ordner nicht merken (z. B. Firefox). Du kannst ihn trotzdem laden, musst ihn aber bei jedem Start neu wählen. Für die volle Funktion: Chrome oder Edge.';
    }
    await Promise.all([Geo.load(), Thumbs.init()]);
    const set = await DB.get('meta', 'settings'); if (set) Object.assign(S.set, set);
    S.titles = (await DB.get('meta', 'titles')) || {};
    S.files = await DB.getAll('files');
    const dir = supported ? await DB.get('meta', 'dir') : null;
    if (S.files.length) { showApp(); rebuild(); }
    if (dir) {
      S.dir = dir;
      let p = 'prompt'; try { p = await dir.queryPermission({ mode: 'read' }); } catch (e) { /* weiter */ }
      if (p === 'granted') { S.readable = true; return scan(); }
      if (S.files.length) { $('banner').hidden = false; return; }
      $('start').hidden = false; $('pick').hidden = true; $('reopen').hidden = false; $('reopen').textContent = `Ordner „${dir.name}“ wieder öffnen`;
      $('startNote').textContent = 'Chrome fragt aus Sicherheitsgründen nach, bevor die App den Ordner wieder lesen darf.';
      return;
    }
    if (S.files.length) { $('banner').hidden = false; return; }
    $('start').hidden = false;
  }
  return { init, getFile, canRead };
})();
App.init();
