/* Vorschaubilder: werden einmal erzeugt und in IndexedDB abgelegt.
   Sichtbare Kacheln haben Vorrang, im Hintergrund wird der Rest vorbereitet. */
'use strict';
const Thumbs = (() => {
  const W = 360, mem = new Map(), pending = new Map(), hi = [], lo = [];
  let runImg = 0, runVid = 0, have = new Set(), bg = { on: false, done: 0, total: 0 }, onProgress = () => {};
  const sig = r => r.size + '-' + r.mtime;

  async function init() { have = new Set(await DB.getAllKeys('thumbs')); }
  function forget(paths) { paths.forEach(p => { have.delete(p); const u = mem.get(p); if (u) URL.revokeObjectURL(u); mem.delete(p); }); }
  const has = p => have.has(p);

  function url(rec, low) {
    if (mem.has(rec.path)) return Promise.resolve(mem.get(rec.path));
    if (pending.has(rec.path)) return pending.get(rec.path).p;
    let resolve; const p = new Promise(r => resolve = r);
    pending.set(rec.path, { p, resolve, rec });
    (async () => {
      let row = null; try { row = have.has(rec.path) ? await DB.get('thumbs', rec.path) : null; } catch (e) { /* weiter */ }
      if (row && row.sig === sig(rec)) return finish(rec.path, row.fail ? null : URL.createObjectURL(row.blob), true);
      (low ? lo : hi).push(rec); pump();
    })();
    return p;
  }
  function finish(path, u, keep) {
    if (keep) mem.set(path, u);
    const e = pending.get(path); pending.delete(path); if (e) e.resolve(u);
  }
  function pump() {
    for (const q of [hi, lo]) {
      for (let i = 0; i < q.length;) {
        const r = q[i];
        if (r.kind === 'vid' ? runVid >= 1 : runImg >= 3) { i++; continue; }
        q.splice(i, 1);
        if (r.kind === 'vid') runVid++; else runImg++;
        make(r).then(res => { if (res === undefined) return finish(r.path, null, false); finish(r.path, res.blob ? URL.createObjectURL(res.blob) : null, true); })
          .finally(() => { if (r.kind === 'vid') runVid--; else runImg--; pump(); });
      }
    }
  }
  /* liefert {blob} oder {fail}; undefined wenn die Datei gerade nicht lesbar ist (kein Zugriff) */
  async function make(rec) {
    const file = await App.getFile(rec.path);
    if (!file) return undefined;
    let res;
    try { res = rec.kind === 'vid' ? await videoThumb(file) : await imageThumb(file); }
    catch (e) { res = { fail: true }; }
    try { await DB.put('thumbs', { path: rec.path, sig: sig(rec), blob: res.blob || null, fail: !!res.fail }); have.add(rec.path); } catch (e) { /* Speicher voll: nur im Speicher halten */ }
    return res;
  }
  async function imageThumb(file) {
    const bmp = await createImageBitmap(file, { resizeWidth: W, resizeQuality: 'medium', imageOrientation: 'from-image' });
    const c = new OffscreenCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
    return { blob: await c.convertToBlob({ type: 'image/jpeg', quality: 0.78 }) };
  }
  function videoThumb(file) {
    return new Promise(res => {
      const v = document.createElement('video'), u = URL.createObjectURL(file);
      let t = setTimeout(() => end({ fail: true }), 15000);
      function end(r) { clearTimeout(t); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(u); res(r); }
      v.muted = true; v.preload = 'auto'; v.playsInline = true;
      v.onerror = () => end({ fail: true });
      v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); };
      v.onseeked = () => {
        if (!v.videoWidth) return end({ fail: true });
        const s = W / v.videoWidth, c = document.createElement('canvas');
        c.width = W; c.height = Math.round(v.videoHeight * s);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(b => end(b ? { blob: b } : { fail: true }), 'image/jpeg', 0.78);
      };
      v.src = u;
    });
  }
  /* Hintergrund: alle fehlenden Vorschaubilder vorbereiten */
  async function background(files, cb) {
    if (bg.on) return; onProgress = cb || onProgress;
    const todo = files.filter(f => !have.has(f.path));
    bg = { on: true, done: 0, total: todo.length, stop: false };
    onProgress(bg);
    for (let i = 0; i < todo.length; i += 6) {
      if (bg.stop) break;
      await Promise.all(todo.slice(i, i + 6).map(r => url(r, true)));
      bg.done = Math.min(todo.length, i + 6); onProgress(bg);
      if (!App.canRead()) break;
    }
    bg.on = false; onProgress(bg);
  }
  const stop = () => { bg.stop = true; };
  const state = () => bg;
  async function clearAll() { mem.forEach(u => u && URL.revokeObjectURL(u)); mem.clear(); have.clear(); await DB.clear('thumbs'); }
  return { init, url, has, forget, background, stop, state, clearAll };
})();
