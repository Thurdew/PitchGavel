// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKIM TEMASI] client/public/teams.js ile AYNI id listesi.
// Sadece doğrulama için — renk/desen bilgisi istemcide.
const TEAM_IDS = ["besiktas","galatasaray","fenerbahce","trabzonspor","basaksehir","kasimpasa","eyupspor","goztepe","samsunspor","rizespor","konyaspor","kocaelispor","genclerbirligi","gaziantep","alanyaspor","erzurumspor","corum"];
const TEAM_ID_SET = new Set(TEAM_IDS);
function isValidTeamId(id) { return typeof id === 'string' && TEAM_ID_SET.has(id); }
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — FORMA ÇEŞİTLERİ] client/public/teams.js KIT_VARIANTS ile AYNI.
// Premium olanlar ileride ücretli olacak — sahiplik kontrolü o zaman burada eklenecek.
const KIT_IDS = ['home', 'away', 'plain', 'retro', 'sash', 'night'];
const PREMIUM_KIT_IDS = ['plain', 'retro', 'sash', 'night'];
const KIT_ID_SET = new Set(KIT_IDS);
function isValidKitId(id) { return typeof id === 'string' && KIT_ID_SET.has(id); }
module.exports = { TEAM_IDS, isValidTeamId, KIT_IDS, PREMIUM_KIT_IDS, isValidKitId };
