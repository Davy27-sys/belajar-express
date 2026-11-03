const Database = require("better-sqlite3");

const db = new Database("soal.db");

// Aktifkan Foreign Key
db.pragma("foreign_keys = ON");

// Buat tabel opsi jawaban
db.exec(`
  CREATE TABLE IF NOT EXISTS opsi_jawaban (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    soal_id INTEGER NOT NULL,
    teks_opsi TEXT NOT NULL,
    benar INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (soal_id)
      REFERENCES soal(id)
      ON DELETE CASCADE
  );
`);

console.log("Tabel opsi_jawaban berhasil dibuat!");

db.close();
