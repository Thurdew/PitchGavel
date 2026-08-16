// Çok ünlü/yıldız oyuncular için elle tamamlanmış gerçek çoklu-pozisyon verisi.
// (bkz. AUCTION-GAME-CLAUDE.md "Çoklu pozisyon verisi": "Bazı oyuncularda bu veri eksik/
// tutarsız olabilir ... eksik kalan ünlü oyuncular için elle bir tamamlama tablosu
// tutulmalı".) 3000+ oyuncunun tamamını taramak yerine, gerçekten tanınan/yıldız
// oyuncular için bilinen ikincil pozisyonları burada elle giriyoruz; geri kalanı
// server/src/shared/football.js içindeki heuristik uygunluk matrisine bırakılır.
//
// Anahtar: Transfermarkt player_code (players.csv'deki `player_code` alanı, URL slug'ı).
// Değer: birincil sub_position DIŞINDA, gerçekten oynayabildiği ek slot kodları
// (server/src/shared/football.js SLOTS listesine göre).

module.exports = {
  'cristiano-ronaldo': ['LW', 'RW'],
  'lionel-messi': ['ST', 'AM', 'CM'],
  'kylian-mbappe': ['LW', 'RW'],
  'erling-haaland': ['AM'],
  'vinicius-junior': ['ST', 'RW'],
  'rodrygo': ['ST', 'RW', 'AM'],
  'jude-bellingham': ['CM', 'ST'],
  'kevin-de-bruyne': ['CM', 'RM', 'RW'],
  'achraf-hakimi': ['RM', 'RW'],
  'trent-alexander-arnold': ['CM', 'RM'],
  'alphonso-davies': ['LM', 'LW'],
  'joshua-kimmich': ['RB', 'CM', 'CB'],
  'harry-kane': ['AM', 'LW'],
  'bukayo-saka': ['RM', 'RB'],
  'phil-foden': ['AM', 'LW', 'CM'],
  'jamal-musiala': ['CM', 'LW', 'ST'],
  'florian-wirtz': ['CM', 'LW', 'RW'],
  'pedri': ['CM', 'DM'],
  'gavi': ['CM', 'DM'],
  'lamine-yamal': ['LW', 'ST'],
  'ousmane-dembele': ['LW', 'ST'],
  'mohamed-salah': ['ST', 'AM'],
  'sadio-mane': ['LW', 'ST'],
  'robert-lewandowski': ['AM'],
  'karim-benzema': ['AM', 'LW'],
  'toni-kroos': ['DM', 'CM'],
  'luka-modric': ['DM', 'CM'],
  'casemiro': ['CB', 'CM'],
  'declan-rice': ['CM', 'CB'],
  'martin-odegaard': ['CM', 'RW'],
  'bruno-fernandes': ['CM', 'RW'],
  'marcus-rashford': ['ST', 'RW'],
  'antoine-griezmann': ['ST', 'CM'],
  'kingsley-coman': ['RW', 'ST'],
  'leroy-sane': ['LW', 'ST'],
  'serge-gnabry': ['LW', 'ST'],
  'federico-valverde': ['RB', 'RM', 'DM'],
  'ilkay-guendogan': ['DM', 'AM'],
  'thomas-mueller': ['ST', 'CM'],
  'neymar': ['LW', 'ST', 'CM'],
  'raphinha': ['RW', 'LW', 'ST'],
  'nicolas-jackson': ['LW', 'RW'],
  'cole-palmer': ['AM', 'RW', 'CM'],
  'julian-alvarez': ['ST', 'AM'],
  'lautaro-martinez': ['ST', 'AM'],
  'victor-osimhen': ['AM'],
  'khvicha-kvaratskhelia': ['RW', 'ST'],
  'rafael-leao': ['ST', 'AM'],
  'nico-williams': ['RW', 'ST'],
  'arda-guler': ['AM', 'RW', 'CM'],
  'hakan-calhanoglu': ['CM', 'AM', 'LW'],
  'kenan-yildiz': ['LW', 'AM', 'ST'],
  'zeki-celik': ['RM'],
  'james-rodriguez': ['CM', 'RW'],
  'jack-grealish': ['LM', 'AM'],
  'raheem-sterling': ['RW', 'ST'],
};
