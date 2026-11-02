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

// Mengaktifkan foreign key
db.pragma("foreign_keys = ON");

// ======================================
// MIGRASI DATABASE
// ======================================

// Membuat tabel soal jika belum ada
db.exec(`
  CREATE TABLE IF NOT EXISTS soal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pertanyaan TEXT NOT NULL,
    jawaban TEXT NOT NULL,
    jawabanBenar TEXT NOT NULL
  )
`);

// Migrasi data dari soal.json jika tabel kosong
const jumlahSoal = db.prepare("SELECT COUNT(*) AS total FROM soal").get();

if (jumlahSoal.total === 0 && fs.existsSync(fileSoal)) {
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
}

// Membuat tabel kategori
db.exec(`
  CREATE TABLE IF NOT EXISTS kategori (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL UNIQUE
  )
`);

// Menambahkan kategori awal
const insertKategori = db.prepare(`
  INSERT OR IGNORE INTO kategori (nama)
  VALUES (?)
`);

insertKategori.run("Umum");
insertKategori.run("Komputer");
insertKategori.run("Matematika");

// Mengambil ID kategori
const kategoriUmum = db
  .prepare(
    `
  SELECT id FROM kategori WHERE nama = ?
`,
  )
  .get("Umum").id;

const kategoriKomputer = db
  .prepare(
    `
  SELECT id FROM kategori WHERE nama = ?
`,
  )
  .get("Komputer").id;

const kategoriMatematika = db
  .prepare(
    `
  SELECT id FROM kategori WHERE nama = ?
`,
  )
  .get("Matematika").id;

// Mengecek apakah kategori_id sudah ada
const columns = db.pragma("table_info(soal)");

const hasKategoriId = columns.some((column) => column.name === "kategori_id");

// Menambahkan kolom kategori_id jika belum ada
if (!hasKategoriId) {
  db.exec(`
    ALTER TABLE soal
    ADD COLUMN kategori_id INTEGER
    REFERENCES kategori(id)
  `);

  console.log("Kolom kategori_id berhasil ditambahkan.");
}

// Mengisi kategori soal lama yang masih NULL
const updateKategori = db.prepare(`
  UPDATE soal
  SET kategori_id = ?
  WHERE kategori_id IS NULL
`);

updateKategori.run(kategoriUmum);

// Memindahkan soal matematika lama ke kategori Matematika
db.prepare(
  `
  UPDATE soal
  SET kategori_id = ?
  WHERE pertanyaan LIKE '%2 + 2%'
`,
).run(kategoriMatematika);

// ======================================
// HELPER
// ======================================

// Mengambil soal beserta nama kategorinya
const querySoal = `
  SELECT
    soal.*,
    kategori.nama AS kategori
  FROM soal
  JOIN kategori
    ON soal.kategori_id = kategori.id
`;

// Mengubah jawaban dari JSON string menjadi array
function formatSoal(item) {
  if (!item) return null;

  return {
    ...item,
    jawaban: JSON.parse(item.jawaban),
  };
}

// ======================================
// ENDPOINT QUERY
// ======================================

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
    ${querySoal}
    WHERE LOWER(soal.pertanyaan) LIKE ?
    ORDER BY soal.id
  `,
    )
    .all(`%${cari.trim().toLowerCase()}%`);

  const data = hasil.map(formatSoal);

  return res.status(200).json({
    total: data.length,
    data,
  });
});

// ======================================
// GET SEMUA SOAL + FILTER KATEGORI
// ======================================

app.get("/soal", (req, res) => {
  const { kategori } = req.query;

  let hasil;

  if (kategori) {
    hasil = db
      .prepare(
        `
      ${querySoal}
      WHERE LOWER(kategori.nama) = LOWER(?)
      ORDER BY soal.id
    `,
      )
      .all(kategori);
  } else {
    hasil = db
      .prepare(
        `
      ${querySoal}
      ORDER BY soal.id
    `,
      )
      .all();
  }

  res.status(200).json(hasil.map(formatSoal));
});

// ======================================
// GET SOAL BERDASARKAN ID
// ======================================

app.get("/soal/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      pesan: "ID soal tidak valid",
    });
  }

  const data = db
    .prepare(
      `
    ${querySoal}
    WHERE soal.id = ?
  `,
    )
    .get(id);

  if (!data) {
    return res.status(404).json({
      pesan: "Soal tidak ditemukan",
    });
  }

  res.status(200).json(formatSoal(data));
});

// ======================================
// POST TAMBAH SOAL
// ======================================

app.post("/soal", (req, res) => {
  const { pertanyaan, jawaban, jawabanBenar, kategori_id } = req.body;

  // Validasi data soal
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

  // Validasi jawaban benar
  if (!jawaban.includes(jawabanBenar.trim())) {
    return res.status(400).json({
      pesan: "jawabanBenar harus ada di dalam pilihan jawaban",
    });
  }

  // Validasi kategori_id
  if (!Number.isInteger(kategori_id) || kategori_id <= 0) {
    return res.status(400).json({
      pesan: "kategori_id wajib berupa angka yang valid",
    });
  }

  const kategori = db
    .prepare(
      `
    SELECT id FROM kategori WHERE id = ?
  `,
    )
    .get(kategori_id);

  if (!kategori) {
    return res.status(400).json({
      pesan: "Kategori tidak ditemukan",
    });
  }

  // Menyimpan soal
  const hasil = db
    .prepare(
      `
    INSERT INTO soal (
      pertanyaan,
      jawaban,
      jawabanBenar,
      kategori_id
    )
    VALUES (?, ?, ?, ?)
  `,
    )
    .run(
      pertanyaan.trim(),
      JSON.stringify(jawaban),
      jawabanBenar.trim(),
      kategori_id,
    );

  const soalBaru = db
    .prepare(
      `
    ${querySoal}
    WHERE soal.id = ?
  `,
    )
    .get(hasil.lastInsertRowid);

  res.status(201).json(formatSoal(soalBaru));
});

// ======================================
// PUT UBAH SOAL
// ======================================

app.put("/soal/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      pesan: "ID soal tidak valid",
    });
  }

  const dataLama = db
    .prepare(
      `
    SELECT * FROM soal WHERE id = ?
  `,
    )
    .get(id);

  if (!dataLama) {
    return res.status(404).json({
      pesan: "Soal tidak ditemukan",
    });
  }

  const { pertanyaan, jawaban, jawabanBenar, kategori_id } = req.body;

  // Validasi input
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

  const kategoriBaru =
    kategori_id !== undefined ? kategori_id : dataLama.kategori_id;

  if (!jawabanBaru.includes(jawabanBenarBaru)) {
    return res.status(400).json({
      pesan: "jawabanBenar harus ada di dalam pilihan jawaban",
    });
  }

  // Validasi kategori jika diubah
  if (!Number.isInteger(kategoriBaru) || kategoriBaru <= 0) {
    return res.status(400).json({
      pesan: "kategori_id tidak valid",
    });
  }

  const kategori = db
    .prepare(
      `
    SELECT id FROM kategori WHERE id = ?
  `,
    )
    .get(kategoriBaru);

  if (!kategori) {
    return res.status(400).json({
      pesan: "Kategori tidak ditemukan",
    });
  }

  db.prepare(
    `
    UPDATE soal
    SET
      pertanyaan = ?,
      jawaban = ?,
      jawabanBenar = ?,
      kategori_id = ?
    WHERE id = ?
  `,
  ).run(
    pertanyaanBaru,
    JSON.stringify(jawabanBaru),
    jawabanBenarBaru,
    kategoriBaru,
    id,
  );

  const dataBaru = db
    .prepare(
      `
    ${querySoal}
    WHERE soal.id = ?
  `,
    )
    .get(id);

  res.status(200).json({
    pesan: "Soal berhasil diubah",
    data: formatSoal(dataBaru),
  });
});

// ======================================
// DELETE SOAL
// ======================================

app.delete("/soal/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      pesan: "ID soal tidak valid",
    });
  }

  const data = db
    .prepare(
      `
    ${querySoal}
    WHERE soal.id = ?
  `,
    )
    .get(id);

  if (!data) {
    return res.status(404).json({
      pesan: "Soal tidak ditemukan",
    });
  }

  db.prepare(
    `
    DELETE FROM soal WHERE id = ?
  `,
  ).run(id);

  res.status(200).json({
    pesan: "Soal berhasil dihapus",
    data: formatSoal(data),
  });
});

// ======================================
// MENJALANKAN SERVER
// ======================================

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
