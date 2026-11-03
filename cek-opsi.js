const Database = require("better-sqlite3");

const db = new Database("soal.db");

console.log(db.prepare("PRAGMA table_info(opsi_jawaban)").all());

db.close();
