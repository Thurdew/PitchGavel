# PitchGavel

Açık arttırmalı kadro kurma & maç simülasyonu oyunu — iki (ya da daha fazla, 2-8 kişi) oyuncu canlı bir açık arttırmayla kendi 11 kişilik futbol kadrolarını kurar, sonra kadrolar birbirine karşı simüle edilmiş maçlarda (ev sahibi + deplasman) karşılaşır.

Tasarım kararları, oynanış kuralları ve tüm geliştirme geçmişi için bkz. [`claude.md`](./claude.md) (proje spesifikasyonu/karar günlüğü) ve [`design.md`](./design.md) (arayüz tasarım dili).

## Mimari

- **Backend:** Node.js + Express + Socket.io (`server/`) — draft, açık arttırma, dizilim ve maç simülasyonu mantığının tamamı burada, istemci sadece arayüz.
- **Frontend:** Build aracı olmadan doğrudan sunulan vanilla JS/CSS (`client/public/`).
- **Veri:** Oyuncu veri seti (`server/data/processed/players.json`) [`dcaribou/transfermarkt-datasets`](https://github.com/dcaribou/transfermarkt-datasets) + Wikidata'dan tek seferlik bir ETL ile üretilir (bkz. aşağıda "Veri / ETL").

## Kurulum ve Çalıştırma

```bash
cd server
npm install
npm start
```

Sunucu `http://localhost:3000` adresinde ayağa kalkar; istemci de aynı adresten servis edilir (ayrı bir build adımı yok).

Geliştirme sırasında dosya değişikliklerini otomatik yansıtmak için:

```bash
npm run dev
```

## Testler

```bash
cd server
npm test
```

Her faz için ayrı bir uçtan uca test scripti var (`server/test/phase*.test.js`) — oda kurma, canlı/kör draft, tek lig modu, dizilim, maç simülasyonu ve çok oyunculu (N≤8) akışların tamamını gerçek bir Socket.io sunucusu üzerinden doğrular.

## Veri / ETL

`server/data/processed/players.json` repoya dahil edilmiştir — oyunu çalıştırmak için ETL'i yeniden koşmanıza gerek yok. Veri setini kendiniz yeniden üretmek isterseniz:

1. Ham CSV'leri indirin ve `server/data/raw/` altına koyun (bu klasör `.gitignore`'da — repoya dahil değil, tek dosyası ~150MB):
   - `dcaribou/transfermarkt-datasets` deposunun public R2 aynasından: `https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/{players,clubs,player_valuations,competitions,games,appearances}.csv.gz` (hesap/API anahtarı gerekmez).
2. `npm run etl` çalıştırın (`server/src/etl/run.js`) — `players.json`'ı yeniden üretir.

Icon (efsane) oyuncu listesi ayrıca Wikidata SPARQL uç noktasından çekilir (`server/src/etl/fetchIconsWikidata.js`).

## Lisans

Bu proje kişisel/hobi amaçlı geliştirilmiştir, `UNLICENSED` olarak işaretlidir (bkz. `server/package.json`).
