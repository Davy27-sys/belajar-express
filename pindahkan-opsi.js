const Database = require("better-sqlite3");

const db = new Database("soal.db");

db.pragma("foreign_keys = ON");

const soal = db
  .prepare(
    `
  SELECT id, jawaban, jawabanBenar
  FROM soal
`,
  )
  .all();

const insertOpsi = db.prepare(`
  INSERT INTO opsi_jawaban
  (soal_id, teks_opsi, benar)
  VALUES (?, ?, ?)
`);

const hapusOpsi = db.prepare(`
  DELETE FROM opsi_jawaban
  WHERE soal_id = ?
`);

const migrasi = db.transaction(() => {
  for (const item of soal) {
    const pilihan = JSON.parse(item.jawaban);

    if (!Array.isArray(pilihan)) {
      throw new Error(`Pilihan soal ID ${item.id} bukan array`);
    }

    // Hapus opsi lama jika script dijalankan ulang
    hapusOpsi.run(item.id);

    for (const opsi of pilihan) {
      const benar =
        String(opsi).trim() === String(item.jawabanBenar).trim() ? 1 : 0;

      insertOpsi.run(item.id, opsi, benar);
    }

    console.log(`Soal ID ${item.id} berhasil dipindahkan!`);
  }
});

try {
  migrasi();
  console.log("\nMigrasi semua opsi berhasil!");
} catch (error) {
  console.error("Migrasi gagal:", error.message);
}

db.close();
