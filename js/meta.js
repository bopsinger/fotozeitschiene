/* Aufnahmedaten lesen: EXIF aus JPEG, Erstellzeit aus MP4/MOV, Datum aus Dateinamen.
   Zeiten werden als "Ortszeit in ms" gespeichert (Date.UTC der angezeigten Uhrzeit)
   und immer mit getUTC* ausgegeben, damit nichts durch Zeitzonen verrutscht. */
'use strict';
const Meta = (() => {
  const IMG = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'];
  const VID = ['mp4', 'm4v', 'mov', 'webm', 'mkv', '3gp', 'avi'];
  const ext = n => { const i = n.lastIndexOf('.'); return i < 0 ? '' : n.slice(i + 1).toLowerCase(); };
  const kindOf = n => { const e = ext(n); return IMG.includes(e) ? 'img' : VID.includes(e) ? 'vid' : null; };
  const wall = (y, mo, d, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s);
  const wallFromEpoch = ms => { const d = new Date(ms); return wall(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()); };
  const plausible = (y, mo, d) => y >= 1980 && y <= new Date().getFullYear() + 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;

  function parseJpeg(buf) {
    const v = new DataView(buf), out = {};
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return out;
    let off = 2;
    while (off + 4 <= v.byteLength) {
      if (v.getUint8(off) !== 0xFF) break;
      const m = v.getUint8(off + 1), len = v.getUint16(off + 2);
      if (m === 0xE1 && off + 10 < v.byteLength && v.getUint32(off + 4) === 0x45786966) {
        try { Object.assign(out, parseTiff(v, off + 10)); } catch (e) { /* defekte EXIF-Daten ignorieren */ }
      } else if (m >= 0xC0 && m <= 0xC3 && off + 9 <= v.byteLength) {
        out.h = v.getUint16(off + 5); out.w = v.getUint16(off + 7);
      }
      if (m === 0xDA) break;
      off += 2 + len;
    }
    return out;
  }
  function parseTiff(v, t) {
    const le = v.getUint16(t) === 0x4949;
    const u16 = o => v.getUint16(o, le), u32 = o => v.getUint32(o, le);
    function ifd(o) {
      const tags = {}, n = u16(t + o);
      for (let i = 0; i < n; i++) {
        const e = t + o + 2 + i * 12; if (e + 12 > v.byteLength) break;
        tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 };
      }
      return tags;
    }
    function val(tag) {
      if (!tag) return null;
      const { type, count, at } = tag;
      if (type === 2) { const p = count <= 4 ? at : t + u32(at); let s = ''; for (let i = 0; i < count - 1 && p + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(p + i)); return s; }
      if (type === 3) return u16(at);
      if (type === 4) return u32(at);
      if (type === 5) { const p = t + u32(at), a = []; for (let i = 0; i < count; i++) { const d = u32(p + i * 8 + 4); a.push(d ? u32(p + i * 8) / d : 0); } return a; }
      return null;
    }
    const out = {}, i0 = ifd(u32(t + 4));
    out.orient = val(i0[0x0112]) || 1;
    let dt = val(i0[0x0132]);
    if (i0[0x8769]) { const ex = ifd(val(i0[0x8769])); dt = val(ex[0x9003]) || val(ex[0x9004]) || dt; }
    if (dt) {
      const m = dt.match(/(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      if (m && plausible(+m[1], +m[2], +m[3])) out.t = wall(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
    }
    if (i0[0x8825]) {
      const g = ifd(val(i0[0x8825]));
      const la = val(g[2]), lo = val(g[4]);
      if (la && lo && la.length === 3 && lo.length === 3) {
        let lat = la[0] + la[1] / 60 + la[2] / 3600, lon = lo[0] + lo[1] / 60 + lo[2] / 3600;
        if (val(g[1]) === 'S') lat = -lat; if (val(g[3]) === 'W') lon = -lon;
        if ((lat || lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { out.lat = +lat.toFixed(5); out.lon = +lon.toFixed(5); }
      }
    }
    return out;
  }

  /* MP4/MOV: moov > mvhd enthält Erstellzeit (UTC, Sekunden seit 1904) und Dauer */
  async function parseMp4(file) {
    const out = {}; let pos = 0, guard = 0;
    try {
      while (pos + 8 <= file.size && guard++ < 64) {
        const h = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
        let size = h.getUint32(0), hdr = 8; const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
        if (size === 1) { size = Number(h.getBigUint64(8)); hdr = 16; } else if (size === 0) size = file.size - pos;
        if (size < 8) break;
        if (type === 'moov') {
          const b = new DataView(await file.slice(pos + hdr, pos + Math.min(size, 8 * 1024 * 1024)).arrayBuffer());
          let p = 0;
          while (p + 8 <= b.byteLength) {
            const s = b.getUint32(p), ty = String.fromCharCode(b.getUint8(p + 4), b.getUint8(p + 5), b.getUint8(p + 6), b.getUint8(p + 7));
            if (ty === 'mvhd') {
              const ver = b.getUint8(p + 8); let c, scale, dur;
              if (ver === 1) { c = Number(b.getBigUint64(p + 12)); scale = b.getUint32(p + 28); dur = Number(b.getBigUint64(p + 32)); }
              else { c = b.getUint32(p + 12); scale = b.getUint32(p + 20); dur = b.getUint32(p + 24); }
              const ms = (c - 2082844800) * 1000;
              if (c > 0 && new Date(ms).getUTCFullYear() >= 1995) out.utc = ms;
              if (scale) out.dur = dur / scale;
              break;
            }
            if (s < 8) break; p += s;
          }
          break;
        }
        pos += size;
      }
    } catch (e) { /* unlesbar: dann Datum aus Name oder Datei */ }
    return out;
  }

  /* Datum im Dateinamen, z. B. IMG_20230815_143012.jpg, PXL_20230815_..., IMG-20230815-WA0001.jpg */
  function dateFromName(name) {
    const m = name.match(/(?:^|[^0-9])((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[-_ T.]?([01]\d|2[0-3])[-_.:]?([0-5]\d)[-_.:]?([0-5]\d))?(?![0-9]{3})/);
    if (!m || !plausible(+m[1], +m[2], +m[3])) return null;
    return m[4] ? wall(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]) : wall(+m[1], +m[2], +m[3], 12);
  }

  async function analyze(path, file) {
    const name = path.slice(path.lastIndexOf('/') + 1), folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const e = ext(name), rec = { path, name, folder, size: file.size, mtime: file.lastModified, kind: kindOf(name) };
    let info = {};
    if (e === 'jpg' || e === 'jpeg') info = parseJpeg(await file.slice(0, 196608).arrayBuffer());
    else if (['mp4', 'm4v', 'mov', '3gp'].includes(e)) { info = await parseMp4(file); if (info.utc) info.t = wallFromEpoch(info.utc); }
    if (info.t) rec.tSrc = 'aufnahme';
    else { const n = dateFromName(name); if (n) { info.t = n; rec.tSrc = 'name'; } else { info.t = wallFromEpoch(file.lastModified); rec.tSrc = 'datei'; } }
    rec.t = info.t;
    if (info.lat != null) { rec.lat = info.lat; rec.lon = info.lon; }
    if (info.dur) rec.dur = Math.round(info.dur);
    if (info.w) { rec.w = info.w; rec.h = info.h; }
    if (info.orient && info.orient !== 1) rec.orient = info.orient;
    rec.shot = /screenshot|screen_shot|bildschirmfoto|bildschirmaufnahme|screen ?recording/i.test(path);
    return rec;
  }

  return { kindOf, analyze, parseJpeg, parseMp4, dateFromName, wallFromEpoch };
})();
