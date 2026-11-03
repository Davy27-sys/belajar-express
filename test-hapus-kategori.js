const db = require("better-sqlite3")("soal.db");

// Aktifkan foreign key untuk koneksi pengujian
db.pragma("foreign_keys = ON");

// Cari kategori yang masih dipakai soal
const kategori = db
  .prepare(
    `
  SELECT k.id, k.nama, COUNT(s.id) AS jumlah_soal
  FROM kategori k
  JOIN soal s ON s.kategori_id = k.id
  GROUP BY k.id, k.nama
  LIMIT 1
`,
  )
  .get();

if (!kategori) {
  console.log("Tidak ada kategori yang sedang dipakai soal.");
  process.exit();
}

console.log("Kategori yang diuji:", kategori);

// Coba hapus, tetapi selalu rollback agar data tetap aman
try {
  db.transaction(() => {
    db.prepare("DELETE FROM kategori WHERE id = ?").run(kategori.id);

    throw new Error("ROLLBACK_TEST");
  })();
} catch (err) {
  if (err.message === "ROLLBACK_TEST") {
    console.log("Penghapusan berhasil, tetapi dibatalkan (rollback).");
  } else {
    console.log("Penghapusan ditolak:", err.message);
  }
}

db.close();
