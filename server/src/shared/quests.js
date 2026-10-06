// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — GÖREVLER] "Küçük büyük görevler, karşılığında coin —
// mesela 5 maç kazanınca 200 coin." Katalog ve rakamlar için tek yer burası.
//
// scope: 'daily' (her gün UTC 00:00'da sıfırlanır — coin günlük tavanıyla aynı gün tanımı),
//        'weekly' (pazartesi UTC 00:00), 'once' (tek seferlik "büyük" görev).
// stat:  maç olayından ne sayılır (bkz. QuestService.statsOf):
//        play = oynanan maç, win = galibiyet, goals = atılan gol, cleanSheet = gol yenmeyen maç,
//        bigWin = 3+ farkla galibiyet.
// "Maç" = coin sistemindeki gibi her ayak (ev / deplasman) ayrı sayılır, ve SADECE coin
// kurallarına göre geçerli maçlar sayılır (bkz. CoinService.awardRoomResult `events`).
// Görev coin'i maç tavanına (COIN_REWARDS.dailyCap) SAYILMAZ — görevlerin kendi sınırı var.
const QUESTS = [
  { id: 'd_play2', scope: 'daily', stat: 'play', target: 2, reward: 40, title: '2 maç oyna' },
  { id: 'd_win1', scope: 'daily', stat: 'win', target: 1, reward: 60, title: '1 maç kazan' },
  { id: 'd_goals5', scope: 'daily', stat: 'goals', target: 5, reward: 50, title: '5 gol at' },

  { id: 'w_win5', scope: 'weekly', stat: 'win', target: 5, reward: 200, title: '5 maç kazan' },
  { id: 'w_play10', scope: 'weekly', stat: 'play', target: 10, reward: 150, title: '10 maç oyna' },
  { id: 'w_clean3', scope: 'weekly', stat: 'cleanSheet', target: 3, reward: 150, title: '3 maçta gol yeme' },
  { id: 'w_bigwin2', scope: 'weekly', stat: 'bigWin', target: 2, reward: 150, title: '2 maçı 3+ farkla kazan' },

  { id: 'o_win25', scope: 'once', stat: 'win', target: 25, reward: 500, title: '25 maç kazan' },
  { id: 'o_play50', scope: 'once', stat: 'play', target: 50, reward: 400, title: '50 maç oyna' },
  { id: 'o_goals100', scope: 'once', stat: 'goals', target: 100, reward: 600, title: '100 gol at' },
  { id: 'o_win100', scope: 'once', stat: 'win', target: 100, reward: 2000, title: '100 maç kazan' },
];
const QUEST_BY_ID = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

module.exports = { QUESTS, QUEST_BY_ID };
