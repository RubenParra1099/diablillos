// Imitación mínima de pg.Pool sobre PGlite (Postgres real en WASM), solo para pruebas
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const run = async (text, params) => {
  if (!params || !params.length) {
    if (text.split(';').filter(x => x.trim()).length > 1) { await db.exec(text); return { rows: [], rowCount: 0 }; }
  }
  const r = await db.query(text, params || []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
class Pool { query(t, p) { return run(t, p); } async connect() { return { query: run, release() {} }; } }
export default { Pool };
