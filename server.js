
const express = require("express");
const Database = require("better-sqlite3");

const app = express();
const PORT = 3001;

// Middleware untuk membaca body JSON
app.use(express.json());

// Koneksi ke database SQLite
const db = new Database("soal.db");

// Membuat tabel soal jika belum ada
db.exec(`
  CREATE TABLE IF NOT EXISTS soal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pertanyaan TEXT NOT NULL,
    jawaban TEXT NOT NULL,
    jawabanBenar TEXT NOT NULL
  )
`);

// GET semua soal
app.get("/soal", (req, res) => {
  const soal = db.prepare("SELECT * FROM soal").all();

  // Ubah jawaban dari teks JSON menjadi array
  const hasil = soal.map((item) => ({
    ...item,
    jawaban: JSON.parse(item.jawaban),
  }));

  res.status(200).json(hasil);
});

// GET soal berdasarkan ID
app.get("/soal/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      pesan: "ID soal tidak valid",
    });
  }

  const data = db
    .prepare("SELECT * FROM soal WHERE id = ?")
    .get(id);

  if (!data) {
    return res.status(404).json({
      pesan: "Soal tidak ditemukan",
    });
  }

  data.jawaban = JSON.parse(data.jawaban);

  res.status(200).json(data);
});

// QUERY mencari soal berdasarkan kata kunci
app.query("/soal", (req, res) => {
  const { cari } = req.body;

  if (typeof cari !== "string" || !cari.trim()) {
    return res.status(400).json({
      pesan: "Kata kunci 'cari' wajib diisi",
    });
  }

  const hasil = db
    .prepare(`
      SELECT * FROM soal
      WHERE LOWER(pertanyaan) LIKE ?
    `)
    .all(`%${cari.trim().toLowerCase()}%`)
    .map((item) => ({
      ...item,
      jawaban: JSON.parse(item.jawaban),
    }));

  res.status(200).json({
    total: hasil.length,
    data: hasil,
  });
});

// POST tambah soal baru
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
    .prepare(`
      INSERT INTO soal (pertanyaan, jawaban, jawabanBenar)
      VALUES (?, ?, ?)
    `)
    .run(
      pertanyaan.trim(),
      JSON.stringify(jawaban),
      jawabanBenar.trim()
    );

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

  const dataLama = db
    .prepare("SELECT * FROM soal WHERE id = ?")
    .get(id);

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
    pertanyaan !== undefined
      ? pertanyaan.trim()
      : dataLama.pertanyaan;

  const jawabanBaru =
    jawaban !== undefined
      ? jawaban
      : JSON.parse(dataLama.jawaban);

  const jawabanBenarBaru =
    jawabanBenar !== undefined
      ? jawabanBenar.trim()
      : dataLama.jawabanBenar;

  if (!jawabanBaru.includes(jawabanBenarBaru)) {
    return res.status(400).json({
      pesan: "jawabanBenar harus ada di dalam pilihan jawaban",
    });
  }

  db.prepare(`
    UPDATE soal
    SET pertanyaan = ?, jawaban = ?, jawabanBenar = ?
    WHERE id = ?
  `).run(
    pertanyaanBaru,
    JSON.stringify(jawabanBaru),
    jawabanBenarBaru,
    id
  );

  const dataBaru = db
    .prepare("SELECT * FROM soal WHERE id = ?")
    .get(id);

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

  const data = db
    .prepare("SELECT * FROM soal WHERE id = ?")
    .get(id);

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

// Jalankan server
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
