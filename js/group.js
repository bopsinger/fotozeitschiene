/* Fotos zu Erlebnissen zusammenfassen.
   1. Nach Zeit sortieren, bei einer Pause > X Stunden neue Gruppe.
   2. "Zuhause" = häufigster Ort. Aufeinanderfolgende Gruppen weit weg davon = eine Reise.
   3. Gruppen im gleichen, sinnvoll benannten Ordner werden zusammengelegt.
   4. Kleine Gruppen zuhause landen gesammelt in "Alltag im <Monat>". */
'use strict';
const Group = (() => {
  const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const MS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const H = 3600e3;
  const GENERIC = /^(dcim|camera|kamera|pictures|bilder|photos?|fotos?|images?|eigene aufnahmen|eigene bilder|camera roll|kamera-?rolle|screenshots?|bildschirmfotos|whatsapp( images| video| bilder)?|sent|private|telegram( images| video)?|signal|instagram|facebook|messenger|download(s)?|desktop|onedrive|saved pictures|gespeicherte bilder|neuer ordner|new folder|misc|diverses|div|sonstiges|handy|mobile|backup|export|import|\d+andro|\d+[a-z]{4,5}|100media|100msdcf|\d+_?pana|.*\bunsorted\b.*|unsortiert)$/i;

  function folderTitle(folder) {
    if (!folder) return null; // Wurzel des gewählten Ordners
    let leaf = folder.slice(folder.lastIndexOf('/') + 1).trim();
    leaf = leaf.replace(/^[\s._-]*((19|20)\d{2})([\s._-]*\d{1,2}){0,2}[\s._-]*/, '').replace(/[_]+/g, ' ').trim();
    if (!leaf || leaf.length < 3 || GENERIC.test(leaf) || /^\d+$/.test(leaf) || MON.some(m => m.toLowerCase() === leaf.toLowerCase())) return null;
    return leaf;
  }
  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const mode = a => { const m = new Map(); let best = null, bc = 0; for (const x of a) { if (x == null) continue; const c = (m.get(x) || 0) + 1; m.set(x, c); if (c > bc) { bc = c; best = x; } } return [best, bc]; };

  function props(g, home, set) {
    g.start = g.items[0].t; g.end = g.items[g.items.length - 1].t;
    const [f, fc] = mode(g.items.map(i => folderTitle(i.folder)));
    g.folderTitle = f && fc >= g.items.length * 0.6 ? f : null;
    const d = home ? g.items.filter(i => i.lat != null).map(i => Geo.km(home[0], home[1], i.lat, i.lon)) : [];
    g.away = d.length ? median(d) > set.awayKm : false;
  }

  function build(files, set, titles) {
    const items = files.filter(f => !(set.hideShots && f.shot)).sort((a, b) => a.t - b.t || (a.path < b.path ? -1 : 1));
    if (!items.length) return [];
    // Zuhause bestimmen
    // Zuhause = Gegend (ca. 20 km Raster) mit den meisten verschiedenen Tagen, nicht mit den meisten Fotos
    const cellOf = i => Math.round(i.lat * 5) + ',' + Math.round(i.lon * 5);
    const days = new Map();
    items.forEach(i => { if (i.lat == null) return; const c = cellOf(i); if (!days.has(c)) days.set(c, new Set()); days.get(c).add(Math.floor(i.t / 864e5)); });
    let cells = null, best = 0;
    days.forEach((s, c) => { if (s.size > best) { best = s.size; cells = c; } });
    let home = null;
    if (cells) { const pts = items.filter(i => i.lat != null && cellOf(i) === cells); home = [median(pts.map(p => p.lat)), median(pts.map(p => p.lon))]; }
    // 1. nach Pausen trennen
    let groups = [], cur = null;
    for (const it of items) {
      if (!cur || it.t - cur.items[cur.items.length - 1].t > set.gapH * H) groups.push(cur = { items: [] });
      cur.items.push(it);
    }
    groups.forEach(g => props(g, home, set));
    // 2.+3. zusammenlegen
    const merged = [];
    for (const g of groups) {
      const p = merged[merged.length - 1];
      if (p && ((p.away && g.away && g.start - p.end < 36 * H) || (p.folderTitle && p.folderTitle === g.folderTitle && g.start - p.end < 10 * 24 * H))) {
        p.items.push(...g.items); props(p, home, set); p.away = p.away || g.away;
      } else merged.push(g);
    }
    // 4. kleine Gruppen in Monats-Alltag
    const out = [], daily = new Map();
    for (const g of merged) {
      if (g.items.length < set.minSize && !g.away && !g.folderTitle) {
        const d = new Date(g.start), k = d.getUTCFullYear() * 12 + d.getUTCMonth();
        let a = daily.get(k); if (!a) daily.set(k, a = { items: [], alltag: true }); a.items.push(...g.items);
      } else out.push(g);
    }
    for (const a of daily.values()) { a.start = a.items[0].t; a.end = a.items[a.items.length - 1].t; out.push(a); }
    out.sort((a, b) => a.start - b.start);
    // Titel und Ort
    for (const e of out) {
      e.id = e.items[0].path + (e.alltag ? '#alltag' : '');
      const [pl] = mode(e.items.filter(i => i.lat != null).map(i => { const p = Geo.place(i.lat, i.lon); return p ? p.name + '|' + p.cc : null; }));
      if (pl) { const [n, c] = pl.split('|'); e.place = n; e.cc = c; }
      const d = new Date(e.start);
      e.auto = e.alltag ? `Alltag im ${MON[d.getUTCMonth()]}` : e.folderTitle || (e.away && e.place) || (e.place && e.end - e.start > 20 * H ? e.place : null) || `${WD[d.getUTCDay()]}, ${d.getUTCDate()}. ${MON[d.getUTCMonth()]}`;
      e.title = titles[e.id] || e.auto;
      e.nImg = e.items.filter(i => i.kind === 'img').length; e.nVid = e.items.length - e.nImg;
    }
    return out;
  }

  function range(e) {
    const a = new Date(e.start), b = new Date(e.end);
    const same = (x, y) => x.getUTCFullYear() === y.getUTCFullYear() && x.getUTCMonth() === y.getUTCMonth() && x.getUTCDate() === y.getUTCDate();
    if (e.alltag) return `${MON[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
    if (same(a, b)) return `${WD[a.getUTCDay()].slice(0, 2)}, ${a.getUTCDate()}. ${MON[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
    if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${a.getUTCDate()}. ${MS[a.getUTCMonth()]} ${a.getUTCFullYear()} bis ${b.getUTCDate()}. ${MS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
    if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}. bis ${b.getUTCDate()}. ${MON[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
    return `${a.getUTCDate()}. ${MS[a.getUTCMonth()]} bis ${b.getUTCDate()}. ${MS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  }
  return { build, range, MON, MS, WD };
})();
