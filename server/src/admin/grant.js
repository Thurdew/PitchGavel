// [KULLANICI İSTEĞİ — YÖNETİCİ ARACI] Bir hesaba coin ve/veya mağaza ürünü verir, ya da hesabın
// durumunu gösterir. BİLEREK bir HTTP uç noktası DEĞİL, sadece komut satırı: sunucuya erişimi
// olmayan kimse çalıştıramaz (web'de "kendine coin ver" düğmesi yanlış yapılandırılırsa herkes
// kendine coin verebilirdi).
//
// Hangi veritabanına yazar: sunucuyla AYNI kural (db.js) — TURSO_DATABASE_URL tanımlıysa canlı
// Turso, değilse yerel server/data/pitchgavel.sqlite. Başlarken hangisi olduğunu yazar.
//
// Kullanım (server/ klasöründe):
//   node src/admin/grant.js <e-posta>                         → durumu göster
//   node src/admin/grant.js <e-posta> --coins 5000            → coin ekle (eksi değer düşer)
//   node src/admin/grant.js <e-posta> --all                   → mağazadaki TÜM ürünleri ver
//   node src/admin/grant.js <e-posta> --item frame:gold --item kit:retro
//   node src/admin/grant.js --items                           → ürün kimliklerini listele
// Canlı sunucuda (Oracle VM) ortam değişkenleri /etc/pitchgavel.env'de:
//   cd /opt/pitchgavel/server && sudo bash -c 'set -a; . /etc/pitchgavel.env; node src/admin/grant.js <e-posta> --all'
require('../loadEnv').loadEnvFile();
const { db, ready, usingTurso, DB_PATH } = require('../db/db');
const { STORE_ITEMS, STORE_ITEM_BY_ID } = require('../shared/economy');

function parseArgs(argv) {
  const out = { email: null, coins: 0, all: false, items: [], listItems: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--coins') out.coins = Number(argv[++i]);
    else if (a === '--all') out.all = true;
    else if (a === '--item') out.items.push(argv[++i]);
    else if (a === '--items') out.listItems = true;
    else if (!a.startsWith('--') && !out.email) out.email = a.trim().toLowerCase();
    else throw new Error(`Bilinmeyen argüman: ${a}`);
  }
  if (!Number.isInteger(out.coins)) throw new Error('--coins bir tam sayı olmalı');
  return out;
}

async function show(user) {
  const u = await db.get('SELECT coins, cosmetics FROM users WHERE id = ?', user.id);
  const items = (await db.all('SELECT item_id FROM user_items WHERE user_id = ? ORDER BY item_id', user.id)).map((r) => r.item_id);
  console.log(`\n${user.email} (id ${user.id}, ${user.display_name})`);
  console.log(`  coin      : ${Number(u.coins || 0).toLocaleString('tr-TR')}`);
  console.log(`  ürünler   : ${items.length}/${STORE_ITEMS.length}${items.length ? ` — ${items.join(', ')}` : ''}`);
  console.log(`  takılı    : ${u.cosmetics || '{}'}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.listItems) {
    for (const i of STORE_ITEMS) console.log(`${i.id.padEnd(22)} ${String(i.price).padStart(5)} coin`);
    return;
  }
  if (!args.email) {
    console.log('Kullanım: node src/admin/grant.js <e-posta> [--coins N] [--all] [--item <id> ...]   |   --items');
    process.exitCode = 1;
    return;
  }
  await ready;
  console.log(`Veritabanı: ${usingTurso ? 'Turso (CANLI)' : `yerel dosya (${DB_PATH})`}`);

  const user = await db.get('SELECT id, email, display_name FROM users WHERE email = ?', args.email);
  if (!user) throw new Error(`Bu e-postayla hesap yok: ${args.email}`);

  const wanted = args.all ? STORE_ITEMS.map((i) => i.id) : args.items;
  for (const id of wanted) if (!STORE_ITEM_BY_ID.has(id)) throw new Error(`Bilinmeyen ürün: ${id} (liste için --items)`);

  const now = Date.now();
  let added = 0;
  for (const id of wanted) {
    const r = await db.run('INSERT OR IGNORE INTO user_items (user_id, item_id, acquired_at) VALUES (?, ?, ?)', user.id, id, now);
    added += r.changes;
  }
  if (args.coins) {
    // Bakiye eksiye düşmesin.
    await db.run('UPDATE users SET coins = MAX(0, coins + ?) WHERE id = ?', args.coins, user.id);
  }
  // Maç ödülleri/satın almalarla karışmasın diye ayrı bir sebeple deftere yazılır.
  if (args.coins || added) {
    await db.run(
      'INSERT INTO coin_ledger (user_id, amount, reason, meta, created_at) VALUES (?, ?, ?, ?, ?)',
      user.id, args.coins || 0, 'admin_grant', JSON.stringify({ items: wanted }), now
    );
  }
  if (args.coins || wanted.length) console.log(`Verildi: ${args.coins ? `${args.coins} coin` : ''}${args.coins && wanted.length ? ', ' : ''}${wanted.length ? `${added} yeni ürün (${wanted.length - added} zaten vardı)` : ''}`);
  await show(user);
  console.log('\nNot: Açık bir odadaysan değişiklik odaya yeniden bağlandığında görünür; sayfayı yenilemek yeterli.');
}

main().then(() => process.exit()).catch((e) => { console.error('HATA:', e.message); process.exit(1); });
