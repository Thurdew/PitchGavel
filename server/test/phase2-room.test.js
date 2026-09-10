// Faz 2 doğrulama scripti: sunucuyu başlatır, iki socket.io-client ile oda
// oluşturma/katılma/reconnect akışını uçtan uca test eder. Bir test framework'ü
// (jest/mocha) kurmadan hızlı bir sağlık kontrolü olarak kullanılır.
const { server, io, roomManager } = require('../src/index');
const { io: ioClient } = require('socket.io-client');

const PORT = 3999;

function connect() {
  return ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] });
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test] sunucu ayakta, port', PORT);

  const hostId = 'client-host-1';
  const guestId = 'client-guest-1';

  const hostSocket = connect();
  await once(hostSocket, 'connect');

  const created = await new Promise((resolve) => {
    hostSocket.emit('room:create', { clientId: hostId, name: 'Semih' }, resolve);
  });
  console.assert(created.room && created.room.code, 'oda kodu oluşmalı');
  console.assert(created.room.hostClientId === hostId, 'odayı kuran kişi hostClientId olarak işaretlenmeli: ' + created.room.hostClientId);
  const code = created.room.code;
  console.log('[test] oda oluşturuldu:', code, created.room);

  const guestSocket = connect();
  await once(guestSocket, 'connect');

  const readyPromise = once(hostSocket, 'room:ready');

  const joined = await new Promise((resolve) => {
    guestSocket.emit('room:join', { clientId: guestId, name: 'Rakip', code }, resolve);
  });
  console.assert(joined.room && joined.room.players.length === 2, 'iki oyuncu da odada olmalı');
  console.log('[test] katılım sonrası oda:', joined.room);

  await readyPromise;
  console.log('[test] room:ready sinyali alındı (iki taraf da bağlı)');

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kaç kullanıcı oynayacağını lobide sorma, kaç kişi
  // gelirse gelsin" — artık sabit bir hedef (2) yok, oda MAX_ROOM_PLAYERS'a (8) kadar açık.
  // Bu yüzden 3. kişi de rahatça katılabilmeli (host henüz draftı başlatmadı).
  const thirdSocket = connect();
  await once(thirdSocket, 'connect');
  const thirdJoin = await new Promise((resolve) => {
    thirdSocket.emit('room:join', { clientId: 'client-third-1', name: 'Üçüncü', code }, resolve);
  });
  console.assert(!thirdJoin.error && thirdJoin.room.players.length === 3, '3. kişi de rahatça katılabilmeli: ' + JSON.stringify(thirdJoin));
  console.log('[test] 3. kişi başarıyla katıldı, oda artık', thirdJoin.room.players.length, 'kişilik');

  // Guest bağlantısını kesip yeniden bağlansın (reconnect akışı)
  guestSocket.disconnect();
  await new Promise((r) => setTimeout(r, 200));
  const room = roomManager.getRoom(code);
  console.assert(room.players.find((p) => p.clientId === guestId).connected === false, 'guest disconnected olmalı');
  console.log('[test] disconnect sonrası guest.connected =', room.players.find((p) => p.clientId === guestId).connected);

  const guestSocket2 = connect();
  await once(guestSocket2, 'connect');
  const reconnected = await new Promise((resolve) => {
    guestSocket2.emit('room:reconnect', { clientId: guestId, code }, resolve);
  });
  console.assert(reconnected.room.players.length === 3, 'reconnect sonrası hâlâ 3 oyuncu olmalı (host+guest+üçüncü)');
  console.log('[test] reconnect başarılı:', reconnected.room);

  // [BUG DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Oyun ortasında yabancı biri odaya katılabiliyor"
  // — room.status LOBBY dışına çıktıktan sonra TAMAMEN YENİ bir clientId artık katılamamalı, ama
  // var olan bir oyuncunun geri dönmesi (reconnect ile aynı yol) hâlâ çalışmalı.
  room.status = 'draft'; // gerçek bir draft kurmadan durum geçişini simüle ediyoruz
  const strangerSocket = connect();
  await once(strangerSocket, 'connect');
  const strangerJoin = await new Promise((resolve) => {
    strangerSocket.emit('room:join', { clientId: 'client-stranger-1', name: 'Yabancı', code }, resolve);
  });
  console.assert(strangerJoin.error === 'ROOM_IN_PROGRESS', 'oyun başladıktan sonra YENİ biri katılamamalı: ' + JSON.stringify(strangerJoin));
  console.log('[test] oyun içindeyken yeni katılım engellendi:', strangerJoin.error);
  const existingRejoin = await new Promise((resolve) => {
    guestSocket2.emit('room:join', { clientId: guestId, name: 'Rakip', code }, resolve);
  });
  console.assert(!existingRejoin.error, 'var olan bir oyuncu draft sırasında da room:join ile geri dönebilmeli: ' + JSON.stringify(existingRejoin));
  console.log('[test] var olan oyuncunun draft sırasında geri katılması hâlâ çalışıyor');
  room.status = 'lobby'; // testin geri kalanını etkilememesi için eski haline döndür
  strangerSocket.close();

  // [BUG DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Host bağlantısını kaybedip hiç geri gelmezse
  // oda sonsuza kadar kilitli kalıyor" — host disconnect olunca, odada hâlâ bağlı biri varsa
  // host rolü ona devredilmeli.
  hostSocket.disconnect();
  await new Promise((r) => setTimeout(r, 200));
  const roomAfterHostDrop = roomManager.getRoom(code);
  console.assert(roomAfterHostDrop.hostClientId !== hostId, 'host bağlantısını kaybedince host rolü devretmeli: ' + roomAfterHostDrop.hostClientId);
  console.assert(roomAfterHostDrop.players.find((p) => p.clientId === roomAfterHostDrop.hostClientId)?.connected,
    'yeni host BAĞLI bir oyuncu olmalı: ' + JSON.stringify(roomAfterHostDrop.players));
  console.log('[test] host devri sonrası yeni host:', roomAfterHostDrop.hostClientId);

  console.log('[test] TÜM TESTLER GEÇTİ ✅');
  guestSocket.close();
  thirdSocket.close();
  guestSocket2.close();
  io.close();
  server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('[test] HATA:', e);
  process.exit(1);
});
