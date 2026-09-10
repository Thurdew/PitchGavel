// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "FC26 2026-2027 reytingleri" dosyalarını (kullanıcı ekledi,
// server/data/processed/*_2026_2027_fc26_reytingleri.md — önce Süper Lig, sonra diğer büyük 5
// Avrupa ligi) ayrıştırıp kendi oyuncu havuzumuzdaki (players.json) isimlerle eşleştirir. NOT: EA
// FC/FIFA reytinglerinin KULLANILMAMASI daha önce bilinçli bir karardı (bkz. claude.md "EA FC/FIFA
// reytingleri KULLANILMAYACAK ve KOPYALANMAYACAK") — kullanıcı bu turda AÇIKÇA bu kararı geri alıp
// EA FC26 reytinglerinin doğrudan kopyalanmasını istedi (bkz. claude.md "FC26 Reyting Override'ı"
// notu). Bu dosya SADECE ayrıştırma — gerçek eşleştirme/uygulama fc26RatingOverrides.js'te,
// etl/run.js bunu her ligin dosyası için çağırır.
//
// [GENELLEŞTİRME] İki farklı tablo formatı var: Süper Lig dosyası 5 kolonlu (Oyuncu | Reyting |
// Mevki | Durum | Not), diğer 5 büyük Avrupa ligi dosyası 3 kolonlu (Oyuncu | Reyting | Mevki) —
// parser her iki satırı da (esnek pipe-sayısıyla) tanıyor. "## Özet ..." başlığı (Süper Lig'de
// "Özet", diğerlerinde "Özet (takıma göre)") her iki biçimde de bir takım sanılmasın diye atlanır.
const fs = require('fs');

function parseMarkdown(mdPath) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const lines = text.split('\n');
  const teams = []; // { team, players: [{ name, rating, position, durum?, not? }] }
  let current = null;
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2 && !/^Özet\b/.test(h2[1].trim())) {
      current = { team: h2[1].trim(), players: [] };
      teams.push(current);
      continue;
    }
    if (!current) continue;
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const [name, ratingRaw, position, durum, not_] = cells;
    if (name === 'Oyuncu' || /^-+$/.test(name)) continue; // başlık/ayraç satırı
    const rating = Number(ratingRaw);
    if (!Number.isFinite(rating)) continue; // "Veri yok" gibi satırlar atlanır
    current.players.push({ name, rating, position: position || '', durum: durum || '', not: not_ || '' });
  }
  return teams;
}

module.exports = { parseMarkdown };

if (require.main === module) {
  const path = require('path');
  const target = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'processed', 'super_lig_2026_2027_fc26_reytingleri.md');
  const teams = parseMarkdown(target);
  let total = 0;
  for (const t of teams) { total += t.players.length; console.log(`${t.team}: ${t.players.length} oyuncu`); }
  console.log('TOPLAM (reytingi olan):', total);
}
