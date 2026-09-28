// cookie-parser bağımlılığı eklemeden manuel cookie okuma/yazma (bkz. claude.md hesap sistemi
// notu — yeni npm bağımlılığı yok kararı).

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function serializeCookie(name, value, { httpOnly, sameSite, secure, path: p, maxAgeMs } = {}) {
  let str = `${name}=${encodeURIComponent(value)}`;
  if (p) str += `; Path=${p}`;
  if (maxAgeMs != null) str += `; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
  if (sameSite) str += `; SameSite=${sameSite}`;
  if (httpOnly) str += '; HttpOnly';
  if (secure) str += '; Secure';
  return str;
}

module.exports = { parseCookies, serializeCookie };
