// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] Resend'in REST API'sine Node'un
// built-in `fetch`'iyle POST — yeni bir SDK/npm paketi YOK. `RESEND_API_KEY` ayarlanmadıysa
// (kullanıcı henüz Resend hesabı açmadıysa/key'i server/.env'e koymadıysa) gerçek gönderim
// YAPILMAZ, link sunucu konsoluna yazdırılır — kayıt akışı hiçbir zaman bu yüzden engellenmez
// (draft'ın asla tıkanmaması felsefesiyle aynı, bkz. claude.md).
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'PitchGavel <onboarding@resend.dev>';
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

async function sendVerificationEmail(toEmail, token) {
  const verifyUrl = `${APP_BASE_URL}/api/auth/verify?token=${token}`;

  if (!RESEND_API_KEY) {
    console.log(`[email] (DEV — RESEND_API_KEY yok, gerçek gönderim YAPILMADI) Doğrulama linki (${toEmail}): ${verifyUrl}`);
    return { ok: true, mode: 'dev', verifyUrl };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [toEmail],
        subject: 'PitchGavel — E-postanı doğrula',
        html: `<p>PitchGavel hesabını doğrulamak için aşağıdaki linke tıkla:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.</p>`,
      }),
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

module.exports = { sendVerificationEmail };
