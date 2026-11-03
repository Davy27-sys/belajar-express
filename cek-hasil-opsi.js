const Database = require("better-sqlite3");

const db = new Database("soal.db");

const hasil = db
  .prepare(
    `
  SELECT
    s.id,
    s.pertanyaan,
    COUNT(o.id) AS jumlah_opsi,
    SUM(o.benar) AS jumlah_jawaban_benar
  FROM soal s
  LEFT JOIN opsi_jawaban o ON s.id = o.soal_id
  GROUP BY s.id, s.pertanyaan
`,
  )
  .all();

console.log("Hasil pengecekan relasi:");
console.table(hasil);

db.close();
