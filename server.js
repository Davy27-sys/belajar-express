const express = require("express");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;

app.use(express.json());

const fileDB = path.join(__dirname, "soal.db");
const fileSoal = path.join(__dirname, "soal.json");

const db = new Database(fileDB);

// Membuat tabel jika belum ada
db.exec(`
  CREATE TABLE IF NOT EXISTS soal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pertanyaan TEXT NOT NULL,
    jawaban TEXT NOT NULL,
    jawabanBenar TEXT NOT NULL
  )
`);

// Migrasi data dari soal.json jika tabel masih kosong
const jumlahSoal = db.prepare("SELECT COUNT(*) AS total FROM soal").get();

if (jumlahSoal.total === 0) {
  if (fs.existsSync(fileSoal)) {
    const dataLama = JSON.parse(fs.readFileSync(fileSoal, "utf8"));

    const insertSoal = db.prepare(`
      INSERT INTO soal (id, pertanyaan, jawaban, jawabanBenar)
      VALUES (?, ?, ?, ?)
    `);

    const migrasi = db.transaction((data) => {
      for (const item of data) {
        insertSoal.run(
          item.id,
          item.pertanyaan,
          JSON.stringify(item.jawaban),
          item.jawabanBenar,
        );
      }
    });

    migrasi(dataLama);
    console.log(`Migrasi berhasil: ${dataLama.length} soal dipindahkan.`);
  } else {
    console.log("File soal.json tidak ditemukan.");
  }
} else {
  console.log(`Migrasi dilewati: tabel sudah berisi ${jumlahSoal.total} soal.`);
}

// Verifikasi isi database
const dataSQLite = db.prepare("SELECT * FROM soal ORDER BY id").all();

console.log("Isi tabel soal di SQLite:");
console.table(dataSQLite);
console.log("Total soal di SQLite:", dataSQLite.length);

// Endpoint QUERY untuk pencarian soal
app.use((req, res, next) => {
  if (req.method !== "QUERY" || req.path !== "/soal") {
    return next();
  }

  const { cari } = req.body || {};

  if (typeof cari !== "string" || !cari.trim()) {
    return res.status(400).json({
      pesan: "Kata kunci 'cari' wajib diisi",
    });
  }

  const hasil = db
    .prepare(
      `
      SELECT * FROM soal
      WHERE LOWER(pertanyaan) LIKE ?
      ORDER BY id
    `,
    )
    .all(`%${cari.trim().toLowerCase()}%`)
    .map((item) => ({
      ...item,
      jawaban: JSON.parse(item.jawaban),
    }));

  return res.status(200).json({
    total: hasil.length,
    data: hasil,
  });
});

// GET semua soal
app.get("/soal", (req, res) => {
  const daftarSoal = db.prepare("SELECT * FROM soal ORDER BY id").all();

  const hasil = daftarSoal.map((item) => ({
    ...item,
    jawaban: JSON.parse(item.jawaban),
  }));

  res.status(200).json(hasil);
});

// GET soal berdasarkan ID — menggunakan parameterized query
app.get("/soal/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      pesan: "ID soal tidak valid",
    });
  }

  const data = db.prepare("SELECT * FROM soal WHERE id = ?").get(id);

  if (!data) {
    return res.status(404).json({
      pesan: "Soal tidak ditemukan",
    });
  }

  data.jawaban = JSON.parse(data.jawaban);

  res.status(200).json(data);
});

// POST tambah soal
app.post("/soal", (req, res) => {
  const { pertanyaan, jawaban, jawabanBenar } = req.body;

  if (
    typeof pertanyaan !== "string" ||
    !pertanyaan.trim() ||
    !Array.isArray(jawaban) ||
    jawaban.length === 0 ||
    !jawaban.every((item) => typeof item === "string") ||
    typeof jawabanBenar !== "string" ||
    !jawabanBenar.trim()
  ) {
    return res.status(400).json({
      pesan: "Pertanyaan, jawaban (array teks), dan jawabanBenar wajib diisi",
    });
  }

  if (!jawaban.includes(jawabanBenar.trim())) {
    return res.status(400).json({
      pesan: "jawabanBenar harus ada di dalam pilihan jawaban",
    });
  }

  const hasil = db
    .prepare(
      `
      INSERT INTO soal (pertanyaan, jawaban, jawabanBenar)
      VALUES (?, ?, ?)
    `,
    )
    .run(pertanyaan.trim(), JSON.stringify(jawaban), jawabanBenar.trim());

  const soalBaru = db
    .prepare("SELECT * FROM soal WHERE id = ?")
    .get(hasil.lastInsertRowid);

  soalBaru.jawaban = JSON.parse(soalBaru.jawaban);

  res.status(201).json(soalBaru);
});

// PUT ubah soal berdasarkan ID
app.put("/soal/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      pesan: "ID soal tidak valid",
    });
  }

  const dataLama = db.prepare("SELECT * FROM soal WHERE id = ?").get(id);

  if (!dataLama) {
    return res.status(404).json({
      pesan: "Soal tidak ditemukan",
    });
  }

  const { pertanyaan, jawaban, jawabanBenar } = req.body;

  if (
    (pertanyaan !== undefined &&
      (typeof pertanyaan !== "string" || !pertanyaan.trim())) ||
    (jawaban !== undefined &&
      (!Array.isArray(jawaban) ||
        jawaban.length === 0 ||
        !jawaban.every((item) => typeof item === "string"))) ||
    (jawabanBenar !== undefined &&
      (typeof jawabanBenar !== "string" || !jawabanBenar.trim()))
  ) {
    return res.status(400).json({
      pesan: "Data pertanyaan, jawaban, atau jawabanBenar tidak valid",
    });
  }

  const pertanyaanBaru =
    pertanyaan !== undefined ? pertanyaan.trim() : dataLama.pertanyaan;

  const jawabanBaru =
    jawaban !== undefined ? jawaban : JSON.parse(dataLama.jawaban);

  const jawabanBenarBaru =
    jawabanBenar !== undefined ? jawabanBenar.trim() : dataLama.jawabanBenar;

  if (!jawabanBaru.includes(jawabanBenarBaru)) {
    return res.status(400).json({
      pesan: "jawabanBenar harus ada di dalam pilihan jawaban",
    });
  }

  db.prepare(
    `
    UPDATE soal
    SET pertanyaan = ?, jawaban = ?, jawabanBenar = ?
    WHERE id = ?
  `,
  ).run(pertanyaanBaru, JSON.stringify(jawabanBaru), jawabanBenarBaru, id);

  const dataBaru = db.prepare("SELECT * FROM soal WHERE id = ?").get(id);
  dataBaru.jawaban = JSON.parse(dataBaru.jawaban);

  res.status(200).json({
    pesan: "Soal berhasil diubah",
    data: dataBaru,
  });
});

// DELETE hapus soal berdasarkan ID
app.delete("/soal/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      pesan: "ID soal tidak valid",
    });
  }

  const data = db.prepare("SELECT * FROM soal WHERE id = ?").get(id);

  if (!data) {
    return res.status(404).json({
      pesan: "Soal tidak ditemukan",
    });
  }

  db.prepare("DELETE FROM soal WHERE id = ?").run(id);
  data.jawaban = JSON.parse(data.jawaban);

  res.status(200).json({
    pesan: "Soal berhasil dihapus",
    data,
  });
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
