/* Kleine Hülle um IndexedDB. Alles bleibt im Browser dieses PCs. */
'use strict';
const DB = (() => {
  let dbp = null;
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('zeitschiene', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('files', { keyPath: 'path' });   // Verzeichnis: Datum, Ort, Grösse
        d.createObjectStore('thumbs', { keyPath: 'path' });  // Vorschaubilder als JPEG
        d.createObjectStore('meta');                         // Ordnerzugriff, Einstellungen, Titel
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function store(name, mode) { return (await open()).transaction(name, mode).objectStore(name); }
  function done(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }
  return {
    async get(name, key) { return req((await store(name, 'readonly')).get(key)); },
    async put(name, val, key) { return req((await store(name, 'readwrite')).put(val, key)); },
    async del(name, key) { return req((await store(name, 'readwrite')).delete(key)); },
    async getAll(name) { return req((await store(name, 'readonly')).getAll()); },
    async getAllKeys(name) { return req((await store(name, 'readonly')).getAllKeys()); },
    async clear(name) { return req((await store(name, 'readwrite')).clear()); },
    async putMany(name, vals) {
      for (let i = 0; i < vals.length; i += 1000) {
        const t = (await open()).transaction(name, 'readwrite'); const s = t.objectStore(name);
        vals.slice(i, i + 1000).forEach(v => s.put(v)); await done(t);
      }
    },
    async delMany(name, keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const t = (await open()).transaction(name, 'readwrite'); const s = t.objectStore(name);
        keys.slice(i, i + 1000).forEach(k => s.delete(k)); await done(t);
      }
    }
  };
})();
