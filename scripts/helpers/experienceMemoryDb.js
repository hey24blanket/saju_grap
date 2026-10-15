// Deterministic adapter for API boundary tests, including transaction ordering.
// This is not a replacement for the deployed Firestore smoke test.
export class MemoryDB {
  rows = new Map(); chain = Promise.resolve();
  collection(path) { return this.query(path); }
  query(path, filters = [], maximum = Infinity) {
    return { path, id: path.split('/').at(-1),
      doc: id => this.ref(`${path}/${id}`),
      where: (field, op, value) => this.query(path, [...filters, [field, op, value]], maximum),
      limit: n => this.query(path, filters, n),
      get: async () => ({ docs: [...this.rows.keys()].filter(key => key.startsWith(path + '/') && key.slice(path.length + 1).split('/').length === 1).filter(key => filters.every(([field, op, val]) => op === '==' ? this.rows.get(key)[field] === val : this.rows.get(key)[field] <= val)).slice(0, maximum).map(key => this.snap(key)) })
    };
  }
  ref(path) {
    return { path, id: path.split('/').at(-1), firestore: this,
      collection: name => this.query(`${path}/${name}`),
      listCollections: async () => [...new Set([...this.rows.keys()].filter(k => k.startsWith(path + '/') && k.slice(path.length + 1).includes('/')).map(k => k.slice(path.length + 1).split('/')[0]))].map(name => this.query(`${path}/${name}`)),
      get: async () => this.snap(path), set: async value => { this.rows.set(path, structuredClone(value)); }
    };
  }
  snap(path) { const v = this.rows.get(path); return { exists: Boolean(v), ref: this.ref(path), id: path.split('/').at(-1), data: () => v ? structuredClone(v) : undefined }; }
  runTransaction(fn) {
    const result = this.chain.then(async () => {
      const writes = []; const tx = {
        get: async ref => { if (writes.length) throw new Error('Firestore requires reads before writes'); return this.snap(ref.path); },
        set: (ref, value) => writes.push(() => this.rows.set(ref.path, structuredClone(value))),
        update: (ref, value) => writes.push(() => { if (!this.rows.has(ref.path)) throw new Error('not found'); this.rows.set(ref.path, { ...this.rows.get(ref.path), ...structuredClone(value) }); }),
        delete: ref => writes.push(() => this.rows.delete(ref.path))
      };
      const r = await fn(tx); writes.forEach(write => write()); return r;
    }); this.chain = result.catch(() => {}); return result;
  }
  batch() { const refs = []; return { delete: ref => refs.push(ref), commit: async () => refs.forEach(ref => this.rows.delete(ref.path)) }; }
  async recursiveDelete(ref) { for (const key of this.rows.keys()) if (key === ref.path || key.startsWith(`${ref.path}/`)) this.rows.delete(key); }
}
export function response() { return { headers: {}, code: 0, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } }; }
export function request(body, cookie = '', token = '') { return { method: 'POST', headers: { 'content-type': 'application/json', host: 'example.test', origin: 'https://example.test', cookie, ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-vercel-forwarded-for': '192.0.2.1' }, body }; }
