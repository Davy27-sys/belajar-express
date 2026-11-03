const Database = require("better-sqlite3");

const db = new Database("soal.db");

// Melihat struktur tabel soal
console.log("Struktur tabel soal:");
console.log(db.prepare("PRAGMA table_info(soal)").all());

// Melihat struktur tabel kategori
console.log("\nStruktur tabel kategori:");
console.log(db.prepare("PRAGMA table_info(kategori)").all());

db.close();
