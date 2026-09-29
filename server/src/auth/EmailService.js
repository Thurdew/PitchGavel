// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] Resend'in REST API'sine Node'un
// built-in `fetch`'iyle POST — yeni bir SDK/npm paketi YOK. `RESEND_API_KEY` ayarlanmadıysa
// (kullanıcı henüz Resend hesabı açmadıysa/key'i server/.env'e koymadıysa) gerçek gönderim
// YAPILMAZ, link sunucu konsoluna yazdırılır — kayıt akışı hiçbir zaman bu yüzden engellenmez
// (draft'ın asla tıkanmaması felsefesiyle aynı, bkz. claude.md).
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'PitchGavel <onboarding@resend.dev>';
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

// Ortak gönderim — doğrulama ve parola sıfırlama e-postaları aynı yolu kullanıyor.
async function sendEmail(toEmail, subject, html, link, kind) {
  if (!RESEND_API_KEY) {
    console.log(`[email] (DEV — RESEND_API_KEY yok, gerçek gönderim YAPILMADI) ${kind} linki (${toEmail}): ${link}`);
    return { ok: true, mode: 'dev', link };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [toEmail], subject, html }),
    });
    if (!res.ok) {
      console.error('[email] Resend hatası:', res.status, await res.text());
      return { ok: false };
    }
    return { ok: true, mode: 'sent' };
  } catch (e) {
    // E-posta gönderilemese de KAYIT başarısız SAYILMAZ — kullanıcı "tekrar gönder" ile
    // sonra deneyebilir (bkz. index.js POST /api/auth/resendVerification).
    console.error('[email] gönderim başarısız:', e.message);
    return { ok: false };
  }
}

async function sendVerificationEmail(toEmail, token) {
  const verifyUrl = `${APP_BASE_URL}/api/auth/verify?token=${token}`;
  const result = await sendEmail(
    toEmail,
    'PitchGavel — E-postanı doğrula',
    `<p>PitchGavel hesabını doğrulamak için aşağıdaki linke tıkla:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.</p>`,
    verifyUrl,
    'Doğrulama'
  );
  return result.mode === 'dev' ? { ok: true, mode: 'dev', verifyUrl } : result;
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — PAROLA SIFIRLAMA] Link bir API ucuna değil doğrudan
// istemcideki giriş sayfasına gidiyor — yeni parola orada bir formla girilir (bkz. client
// app.js `?reset=` kontrolü, views.js renderLogin 'reset' modu).
async function sendPasswordResetEmail(toEmail, token) {
  const resetUrl = `${APP_BASE_URL}/giris?reset=${token}`;
  return sendEmail(
    toEmail,
    'PitchGavel — Parolanı sıfırla',
    `<p>PitchGavel hesabın için bir parola sıfırlama isteği aldık. Yeni parolanı belirlemek için aşağıdaki linke tıkla (1 saat geçerli, tek kullanımlık):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin — parolan değişmez.</p>`,
    resetUrl,
    'Parola sıfırlama'
  );
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
