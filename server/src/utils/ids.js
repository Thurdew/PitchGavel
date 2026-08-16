const crypto = require('crypto');

// Kullanıcıya okunması/söylemesi kolay bir oda kodu üretir (5 karakter, karışabilecek
// karakterler -0/O, 1/I/L- havuzdan çıkarıldı).
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateRoomCode(length = 5) {
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

function generateClientId() {
  return crypto.randomUUID();
}

module.exports = { generateRoomCode, generateClientId };
