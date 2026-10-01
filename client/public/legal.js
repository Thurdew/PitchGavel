// [YASAL — KVKK / ÇEREZ ONAYI] Gizlilik & çerez politikası sayfası, çerez onay şeridi ve
// "sayfa bulunamadı" görünümü.
//
// Çerez onayı Google Consent Mode v2 ile çalışır: index.html GTM'den ÖNCE varsayılanı
// "reddedildi" olarak ayarlar; kullanıcı "Kabul et" derse burada `consent update` gönderilir ve
// GTM içindeki GA4 etiketi analitik çerezlerini o andan itibaren yazmaya başlar. Seçim
// localStorage'da (pg_consent) saklanır ve index.html sayfa açılışında onu uygular.
import { el } from './helpers.js';

// !!! YAYINDAN ÖNCE DOLDUR: KVKK başvuruları için gerçek bir iletişim adresi (ör. destek@pitchgavel.com).
export const CONTACT_EMAIL = 'noreply@pitchgavel.com';
export const DATA_CONTROLLER = 'PitchGavel';
const POLICY_DATE = '1 Ekim 2026';

const CONSENT_KEY = 'pg_consent';

function readConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
}

function writeConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch (e) { /* gizli sekme vb. — oturumluk kalır */ }
}

function applyConsent(granted) {
  const v = granted ? 'granted' : 'denied';
  window.dataLayer = window.dataLayer || [];
  // gtag() ile aynı biçim — Consent Mode `arguments` nesnesi bekler.
  (function gtag() { window.dataLayer.push(arguments); })('consent', 'update', {
    analytics_storage: v,
    ad_storage: v,
    ad_user_data: v,
    ad_personalization: v,
  });
}

// Kullanıcı henüz seçim yapmadıysa alt şeridi gösterir. `onOpenPolicy` politikayı açar.
export function mountConsentBanner(onOpenPolicy) {
  if (readConsent()) return;
  if (document.getElementById('consentBanner')) return;
  const banner = el('div', { id: 'consentBanner', class: 'consent-banner', role: 'dialog', 'aria-live': 'polite', 'aria-label': 'Çerez tercihi' });
  const close = () => banner.remove();
  banner.appendChild(el('p', { class: 'consent-text' }, [
    'Siteyi geliştirmek için Google Analytics çerezlerini kullanmak istiyoruz. Oyunun çalışması için gereken oturum çerezi her zaman kullanılır. Ayrıntılar: ',
    el('a', { href: '/gizlilik', onclick: (e) => { e.preventDefault(); onOpenPolicy(); } }, 'Gizlilik ve Çerez Politikası'),
    '.',
  ]));
  banner.appendChild(el('div', { class: 'consent-actions' }, [
    el('button', { class: 'btn small secondary', type: 'button', onclick: () => { writeConsent('denied'); applyConsent(false); close(); } }, 'Reddet'),
    el('button', { class: 'btn small', type: 'button', onclick: () => { writeConsent('granted'); applyConsent(true); close(); } }, 'Kabul et'),
  ]));
  document.body.appendChild(banner);
}

// Politikadaki "tercihini değiştir" bağlantısı için.
export function resetConsent(onOpenPolicy) {
  try { localStorage.removeItem(CONSENT_KEY); } catch (e) { /* yok say */ }
  applyConsent(false);
  mountConsentBanner(onOpenPolicy);
}

function section(title, paragraphs) {
  return el('div', { class: 'panel legal-section' }, [
    el('h3', {}, title),
    ...paragraphs.map((p) => (typeof p === 'string' ? el('p', {}, p) : p)),
  ]);
}

function list(items) {
  return el('ul', { class: 'legal-list' }, items.map((i) => el('li', {}, i)));
}

export function renderPrivacy({ actions }) {
  const root = el('div', { class: 'view legal-view' });
  root.appendChild(el('button', {
    class: 'btn small secondary', style: 'align-self:flex-start',
    onclick: () => actions.navigateToPage(null),
  }, '← Geri dön'));

  root.appendChild(el('div', { class: 'lobby-hero', style: 'margin-top:0' }, [
    el('h1', { class: 'lobby-title compact' }, 'Gizlilik ve Çerez Politikası'),
    el('p', { class: 'lobby-sub', style: 'margin-top:10px' },
      `6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında aydınlatma metni. Son güncelleme: ${POLICY_DATE}.`),
  ]));

  const contact = CONTACT_EMAIL
    ? ['Başvurularını ', el('a', { href: `mailto:${CONTACT_EMAIL}` }, CONTACT_EMAIL), ' adresine e-postayla iletebilirsin.']
    : ['Başvurularını sitedeki iletişim adresine iletebilirsin.'];

  root.appendChild(section('1. Veri sorumlusu', [
    `Bu sitedeki kişisel verilerin veri sorumlusu ${DATA_CONTROLLER}'dir.`,
    el('p', {}, contact),
  ]));

  root.appendChild(section('2. Hangi verileri işliyoruz?', [
    'Hesap açmadan da oynayabilirsin. Bu durumda yalnızca oyunun çalışması için gereken geçici oyun verileri işlenir.',
    list([
      'Hesap bilgileri (hesap açarsan): e-posta adresi, görünen ad, tuttuğun takım ve seçtiğin forma/kozmetikler. Parolan geri çevrilemez şekilde (scrypt ile) özetlenerek saklanır; düz hâli hiçbir yerde tutulmaz.',
      'Oyun verileri: oda kodu, oyuncu adın, draft/maç hamlelerin, coin bakiyen, mağaza alımların ve günlük ödül geçmişin.',
      'Teknik veriler: IP adresi (kötüye kullanımı ve sahte hesapla coin kasmayı önlemek için, sadece sunucu belleğinde kısa süreli), oturum çerezi.',
      'Analitik veriler (sadece onay verirsen): Google Analytics üzerinden sayfa görüntüleme, cihaz/tarayıcı türü, yaklaşık konum ve oyun içi olaylar (oda kurma, eşleşme vb.).',
    ]),
  ]));

  root.appendChild(section('3. Hangi amaçlarla ve hangi hukuki sebeple?', [
    list([
      'Hesabını oluşturmak, giriş yapmanı sağlamak ve oyunu sunmak — sözleşmenin kurulması ve ifası (KVKK m.5/2-c).',
      'E-posta doğrulama ve parola sıfırlama e-postaları göndermek — sözleşmenin ifası (m.5/2-c).',
      'Güvenliği sağlamak, kötüye kullanımı ve hileyi önlemek — meşru menfaat (m.5/2-f).',
      'Siteyi nasıl kullandığını ölçüp geliştirmek (analitik çerezler) — açık rıza (m.5/1). Rızanı istediğin an geri alabilirsin.',
    ]),
  ]));

  root.appendChild(section('4. Verileri kimlerle paylaşıyoruz? (Yurt dışına aktarım)', [
    'Verilerin satılmaz. Hizmeti sunmak için aşağıdaki altyapı sağlayıcılarını kullanıyoruz; bu sağlayıcıların sunucuları yurt dışında olabilir:',
    list([
      'Oracle Cloud (Almanya) — sunucu barındırma.',
      'Turso — hesap veritabanı barındırma.',
      'Resend — doğrulama ve parola sıfırlama e-postalarının gönderimi.',
      'Google (Google Tag Manager, Google Analytics) — sadece analitik çerezlere onay verirsen.',
    ]),
    'Yurt dışına aktarım, KVKK m.9 kapsamındaki şartlara uygun olarak gerçekleştirilir.',
  ]));

  root.appendChild(section('5. Çerezler', [
    list([
      'Zorunlu — kk_session: Giriş yaptığında oturumunu açık tutar (30 gün). Onay gerektirmez; olmadan giriş yapılamaz.',
      'Zorunlu — tarayıcı oturum depolaması (sessionStorage): Odaya yeniden bağlanabilmen için sekmene özel oyun kimliği. Sekmeyi kapatınca silinir.',
      'Tercih — pg_consent (localStorage): Çerez tercihini hatırlar.',
      'Analitik — _ga, _ga_*: Google Analytics. Sadece "Kabul et" dersen yazılır, 2 yıla kadar saklanır.',
    ]),
    el('p', {}, [
      'Tercihini istediğin zaman değiştirebilirsin: ',
      el('button', { class: 'btn small secondary', type: 'button', onclick: () => actions.resetConsent() }, 'Çerez tercihimi değiştir'),
    ]),
  ]));

  root.appendChild(section('6. Saklama süreleri', [
    list([
      'Hesap verileri: hesabın açık olduğu sürece. Hesabının silinmesini istersen veriler silinir ya da anonim hâle getirilir.',
      'Oturumlar: en fazla 30 gün; doğrulama bağlantıları 24 saat, parola sıfırlama bağlantıları 1 saat.',
      'Oda ve maç verileri: sunucu belleğinde, oyun bittikten kısa süre sonra silinir.',
    ]),
  ]));

  root.appendChild(section('7. Hakların (KVKK m.11)', [
    'Kişisel verilerinin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme, amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı üçüncü kişileri bilme, eksik ya da yanlışsa düzeltilmesini, silinmesini veya yok edilmesini isteme, otomatik sistemlerle analiz edilmesi sonucu aleyhine bir sonuca itiraz etme ve kanuna aykırı işlenmesi nedeniyle zarara uğradıysan zararın giderilmesini talep etme hakların var.',
    el('p', {}, contact),
  ]));

  return root;
}

export function renderNotFound({ actions }) {
  const root = el('div', { class: 'view' });
  root.appendChild(el('div', { class: 'lobby-hero', style: 'margin-top:0' }, [
    el('h1', { class: 'lobby-title compact' }, 'Sayfa bulunamadı'),
    el('p', { class: 'lobby-sub', style: 'margin-top:10px' }, 'Aradığın sayfa taşınmış ya da hiç var olmamış olabilir.'),
  ]));
  root.appendChild(el('button', {
    class: 'btn', style: 'align-self:flex-start',
    onclick: () => actions.navigateToPage(null),
  }, 'Ana sayfaya dön'));
  return root;
}
