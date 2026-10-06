// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — GÖREVLER] "Küçük büyük görevler, karşılığında coin —
// mesela 5 maç kazanınca 200 coin." + "Sadece maç kazan/gol at değil, niş görevler de — mesela
// kör draftta düşük teklifle kazanma." Katalog ve rakamlar için tek yer burası.
//
// scope: 'daily' (her gün UTC 00:00'da sıfırlanır — coin günlük tavanıyla aynı gün tanımı),
//        'weekly' (pazartesi UTC 00:00), 'once' (tek seferlik "büyük" görev).
// group: panelde hangi başlık altında (daily / weekly / niche / once). Niş görevler haftalık sıfırlanır.
// stat:  ne sayılır. Maç istatistikleri (QuestService.statsOf; her ayak ayrı maç, sadece coin
//        kurallarına göre geçerli maçlar): play, win, goals, cleanSheet, bigWin (3+ fark),
//        oneNil (1-0 galibiyet), goalRain (bir maçta 5+ gol), superLigWin, blindWin, wheelWin.
//        Draft/takas istatistikleri (quests/questLog.js; oda içinde sayılır, maç sonunda o oyuncunun
//        en az bir geçerli maçı varsa yazılır): blindMin, blindNarrow, liveSnipe, wheelSteal,
//        trade, icons2, saver.
// Görev coin'i maç tavanına (COIN_REWARDS.dailyCap) SAYILMAZ — görevlerin kendi sınırı var.
const QUESTS = [
  { id: 'd_play2', scope: 'daily', group: 'daily', stat: 'play', target: 2, reward: 40, title: '2 maç oyna' },
  { id: 'd_win1', scope: 'daily', group: 'daily', stat: 'win', target: 1, reward: 60, title: '1 maç kazan' },
  { id: 'd_goals5', scope: 'daily', group: 'daily', stat: 'goals', target: 5, reward: 50, title: '5 gol at' },

  { id: 'w_win5', scope: 'weekly', group: 'weekly', stat: 'win', target: 5, reward: 200, title: '5 maç kazan' },
  { id: 'w_play10', scope: 'weekly', group: 'weekly', stat: 'play', target: 10, reward: 150, title: '10 maç oyna' },
  { id: 'w_clean3', scope: 'weekly', group: 'weekly', stat: 'cleanSheet', target: 3, reward: 150, title: '3 maçta gol yeme' },
  { id: 'w_bigwin2', scope: 'weekly', group: 'weekly', stat: 'bigWin', target: 2, reward: 150, title: '2 maçı 3+ farkla kazan' },

  // Niş görevler (haftalık).
  { id: 'n_blind_min', scope: 'weekly', group: 'niche', stat: 'blindMin', target: 1, reward: 150, title: 'Kelepir', desc: 'Kör draftta rakipli bir turu en düşük teklifle (10₺) kazan' },
  { id: 'n_blind_narrow', scope: 'weekly', group: 'niche', stat: 'blindNarrow', target: 5, reward: 200, title: 'Kıl payı', desc: 'Kör draftta 5 oyuncuyu rakibinden 10₺\'den az farkla kap (ör. 140\'a karşı 145)' },
  { id: 'n_live_snipe', scope: 'weekly', group: 'niche', stat: 'liveSnipe', target: 3, reward: 150, title: 'Son saniye golcüsü', desc: 'Canlı açık arttırmada son 5 saniyede verdiğin teklifle oyuncu kap' },
  { id: 'n_wheel_steal', scope: 'weekly', group: 'niche', stat: 'wheelSteal', target: 1, reward: 100, title: 'Kapkaç', desc: 'Çark modunda rakibinden oyuncu çal' },
  { id: 'n_icons2', scope: 'weekly', group: 'niche', stat: 'icons2', target: 1, reward: 150, title: 'Efsaneler kulübü', desc: 'Bir draftı en az 2 efsane (icon) oyuncuyla bitir' },
  { id: 'n_saver', scope: 'weekly', group: 'niche', stat: 'saver', target: 1, reward: 120, title: 'Kumbaracı', desc: 'Canlı ya da kör draftı kasada 300₺+ ile bitir' },
  { id: 'n_trade', scope: 'weekly', group: 'niche', stat: 'trade', target: 2, reward: 100, title: 'Pazarlıkçı', desc: 'Takas turunda 2 takas tamamla' },
  { id: 'n_one_nil', scope: 'weekly', group: 'niche', stat: 'oneNil', target: 2, reward: 120, title: 'Tek gol yeter', desc: '2 maçı 1-0 kazan' },
  { id: 'n_goal_rain', scope: 'weekly', group: 'niche', stat: 'goalRain', target: 1, reward: 150, title: 'Gol yağmuru', desc: 'Bir maçta 5 ya da daha fazla gol at' },
  { id: 'n_superlig', scope: 'weekly', group: 'niche', stat: 'superLigWin', target: 3, reward: 150, title: 'Yerli malı', desc: 'Süper Lig havuzunda 3 maç kazan' },

  { id: 'o_win25', scope: 'once', group: 'once', stat: 'win', target: 25, reward: 500, title: '25 maç kazan' },
  { id: 'o_play50', scope: 'once', group: 'once', stat: 'play', target: 50, reward: 400, title: '50 maç oyna' },
  { id: 'o_goals100', scope: 'once', group: 'once', stat: 'goals', target: 100, reward: 600, title: '100 gol at' },
  { id: 'o_blind10', scope: 'once', group: 'once', stat: 'blindWin', target: 10, reward: 400, title: 'Kör draftta 10 maç kazan' },
  { id: 'o_wheel10', scope: 'once', group: 'once', stat: 'wheelWin', target: 10, reward: 400, title: 'Çark modunda 10 maç kazan' },
  { id: 'o_win100', scope: 'once', group: 'once', stat: 'win', target: 100, reward: 2000, title: '100 maç kazan' },
];
const QUEST_BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q]));
// Draft/takas olaylarından gelen istatistikler — QuestService bunları sadece bu listeden kabul eder.
const DRAFT_QUEST_STATS = ['blindMin', 'blindNarrow', 'liveSnipe', 'wheelSteal', 'trade', 'icons2', 'saver'];

module.exports = { QUESTS, QUEST_BY_ID, DRAFT_QUEST_STATS };
