// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TURSO] Render'ın ücretsiz planında disk her deploy'da
// sıfırlandığı için hesaplar kalıcı bir uzak veritabanına (Turso, libSQL) taşındı. Servisler
// (AuthService, RewardsService) iki arka ucu da AYNI asenkron arayüzle görür:
//   get(sql, ...args) → satır | undefined
//   all(sql, ...args) → satır[]
//   run(sql, ...args) → { lastInsertRowid, changes }
//   exec(sql)         → çok ifadeli DDL
// Yerelde/testlerde node:sqlite (senkron) aynen kullanılıyor, sadece Promise'e sarılıyor.

function wrapSqlite(sqlite) {
  return {
    kind: 'sqlite',
    async get(sql, ...args) { return sqlite.prepare(sql).get(...args); },
    async all(sql, ...args) { return sqlite.prepare(sql).all(...args); },
    async run(sql, ...args) {
      const info = sqlite.prepare(sql).run(...args);
      return { lastInsertRowid: Number(info.lastInsertRowid), changes: Number(info.changes) };
    },
    async exec(sql) { sqlite.exec(sql); },
  };
}

// libSQL satırları dizi-benzeri nesneler — servislerin `{ ...row }` gibi kullanımı güvenli olsun
// diye düz nesneye çevriliyor.
function toPlain(columns, row) {
  const out = {};
  columns.forEach((c, i) => { out[c] = row[i]; });
  return out;
}

function wrapLibsql(client) {
  return {
    kind: 'libsql',
    async get(sql, ...args) {
      const r = await client.execute({ sql, args });
      return r.rows[0] ? toPlain(r.columns, r.rows[0]) : undefined;
    },
    async all(sql, ...args) {
      const r = await client.execute({ sql, args });
      return r.rows.map((row) => toPlain(r.columns, row));
    },
    async run(sql, ...args) {
      const r = await client.execute({ sql, args });
      return { lastInsertRowid: r.lastInsertRowid == null ? undefined : Number(r.lastInsertRowid), changes: r.rowsAffected };
    },
    async exec(sql) { await client.executeMultiple(sql); },
  };
}

module.exports = { wrapSqlite, wrapLibsql };
