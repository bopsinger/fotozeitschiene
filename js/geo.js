/* Ortsnamen aus Koordinaten, komplett offline mit eingebauter Liste (GeoNames). */
'use strict';
const Geo = (() => {
  let ready = null, names, cc, lat, lon, grid;
  const cache = new Map();
  let regions = null;
  try { regions = new Intl.DisplayNames(['de'], { type: 'region' }); } catch (e) { /* ohne Ländernamen */ }

  function load() {
    if (ready) return ready;
    ready = new Promise(res => {
      const s = document.createElement('script');
      s.src = 'js/cities.js';
      s.onload = () => {
        const lines = (window.CITIES || '').split('\n'); window.CITIES = null;
        const n = lines.length; names = new Array(n); cc = new Array(n); lat = new Float32Array(n); lon = new Float32Array(n); grid = new Map();
        for (let i = 0; i < n; i++) {
          const p = lines[i].split('|'); names[i] = p[0]; cc[i] = p[1]; lat[i] = +p[2]; lon[i] = +p[3];
          const k = Math.floor(lat[i]) * 1000 + Math.floor(lon[i]);
          let b = grid.get(k); if (!b) grid.set(k, b = []); b.push(i);
        }
        res(true);
      };
      s.onerror = () => res(false);
      document.head.appendChild(s);
    });
    return ready;
  }
  function km(a, b, c, d) {
    const r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r;
    return Math.sqrt(x * x + y * y) * 6371;
  }
  /* nächster Ort im Umkreis von 30 km, sonst null */
  function place(la, lo) {
    if (!names || la == null) return null;
    const key = la.toFixed(2) + ',' + lo.toFixed(2);
    if (cache.has(key)) return cache.get(key);
    let best = -1, bd = 30;
    const fy = Math.floor(la), fx = Math.floor(lo);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const b = grid.get((fy + dy) * 1000 + fx + dx); if (!b) continue;
      for (const i of b) { const d = km(la, lo, lat[i], lon[i]); if (d < bd) { bd = d; best = i; } }
    }
    const out = best < 0 ? null : { name: names[best], cc: cc[best] };
    cache.set(key, out);
    return out;
  }
  const country = code => { try { return regions ? regions.of(code) : code; } catch (e) { return code; } };
  return { load, place, km, country };
})();
