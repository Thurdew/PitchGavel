// Tek seferlik ETL adımı: Wikidata'dan icon oyuncuların Q-id'lerini bulur ve
// P54 (member of sports team) özelliğiyle kulüp/milli takım kariyer geçmişini çeker.
// Sonuç server/data/raw/icons_wikidata.json içine yazılır; runtime'da tekrar
// çağrılmaz (bkz. AUCTION-GAME-CLAUDE.md "Mimari": "runtime'da canlı API çağrısı yapılmaz").
//
// Not: reyting HESABI bu dosyadaki veriyi kullanmaz — reyting server/src/etl/icons.js
// içindeki elle küratörlü başarı tablosundan (Ballon d'Or, şampiyonluklar, milli takım
// gol/maç sayısı) türetilir (bkz. AUCTION-GAME-CLAUDE.md "Reyting Sistemi"). Bu script
// sadece oyuncu profilinde gösterilecek kulüp kariyeri geçmişini (gerçek, doğrulanabilir
// Wikidata verisi) sağlar.

const fs = require('fs');
const path = require('path');
const ICONS = require('./iconNames');

const UA = 'PitchGavelETL/1.0 (educational hobby project; contact: semihturkoglu903@gmail.com)';
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'raw', 'icons_wikidata.json');

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function searchQid(searchTerm) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(searchTerm)}&language=en&format=json&limit=8&type=item`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const json = await res.json();
  const candidates = json.search || [];
  // "footballer" / "association football" geçen ilk sonucu tercih et.
  const best = candidates.find((c) => /footballer|association football/i.test(c.description || ''))
    || candidates[0];
  return best ? best.id : null;
}

async function fetchClubHistory(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ');
  const query = `
    SELECT ?person ?personLabel ?team ?teamLabel ?start ?end WHERE {
      VALUES ?person { ${values} } .
      ?person p:P54 ?stmt .
      ?stmt ps:P54 ?team .
      OPTIONAL { ?stmt pq:P580 ?start }
      OPTIONAL { ?stmt pq:P582 ?end }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } ORDER BY ?personLabel ?start
  `;
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
  const json = await res.json();
  return json.results.bindings;
}

async function main() {
  console.log(`[icons] ${ICONS.length} icon için Wikidata Q-id aranıyor...`);
  const resolved = [];
  for (const icon of ICONS) {
    let qid = null;
    try {
      qid = await searchQid(icon.searchTerm);
    } catch (e) {
      console.warn(`[icons] arama hatası (${icon.displayName}):`, e.message);
    }
    resolved.push({ ...icon, qid });
    console.log(`  ${icon.displayName} -> ${qid || 'BULUNAMADI'}`);
    await sleep(150); // API'ye nazik davran
  }

  const missing = resolved.filter((r) => !r.qid);
  if (missing.length) {
    console.warn('[icons] Q-id bulunamayan oyuncular:', missing.map((m) => m.displayName).join(', '));
  }

  const qids = resolved.filter((r) => r.qid).map((r) => r.qid);
  console.log(`[icons] ${qids.length} Q-id için kulüp geçmişi (P54) sorgulanıyor...`);

  // SPARQL sorgusunu 15'li gruplar halinde çalıştır (uzun VALUES listesi zaman aşımına sebep olabiliyor).
  const chunks = [];
  for (let i = 0; i < qids.length; i += 15) chunks.push(qids.slice(i, i + 15));

  let allBindings = [];
  for (const chunk of chunks) {
    try {
      const bindings = await fetchClubHistory(chunk);
      allBindings = allBindings.concat(bindings);
    } catch (e) {
      console.warn('[icons] SPARQL sorgu hatası:', e.message);
    }
    await sleep(300);
  }

  // Q-id -> career[] eşle
  const careerByQid = {};
  for (const b of allBindings) {
    const qid = b.person.value.split('/').pop();
    if (!careerByQid[qid]) careerByQid[qid] = [];
    careerByQid[qid].push({
      team: b.teamLabel ? b.teamLabel.value : null,
      start: b.start ? b.start.value.slice(0, 10) : null,
      end: b.end ? b.end.value.slice(0, 10) : null,
    });
  }

  const output = resolved.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    nation: r.nation,
    qid: r.qid,
    career: r.qid ? (careerByQid[r.qid] || []) : [],
  }));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[icons] yazıldı -> ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
