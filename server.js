const express = require("express");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;

app.use(express.json());

const fileDB = path.join(__dirname, "soal.db");
const fileSoal = path.join(__dirname, "soal.json");
console.log("Database yang digunakan:", fileDB);;

const db = new Database(fileDB);

db.pragma("foreign_keys = ON");

// ======================================
// MIGRASI DATABASE
// ======================================

db.exec(`
  CREATE TABLE IF NOT EXISTS kategori (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL UNIQUE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS soal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pertanyaan TEXT NOT NULL,
    jawaban TEXT NOT NULL,
    jawabanBenar TEXT NOT NULL
  )
`);

const columns = db.pragma("table_info(soal)");
const hasKategoriId = columns.some((column) => column.name === "kategori_id");

if (!hasKategoriId) {
  db.exec(`
    ALTER TABLE soal
    ADD COLUMN kategori_id INTEGER REFERENCES kategori(id)
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS opsi_jawaban (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    soal_id INTEGER NOT NULL,
    teks_opsi TEXT NOT NULL,
    benar INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (soal_id)
      REFERENCES soal(id)
      ON DELETE CASCADE
  )
`);

const insertKategori = db.prepare(`
  INSERT OR IGNORE INTO kategori (nama) VALUES (?)
`);

insertKategori.run("Umum");
insertKategori.run("Komputer");
insertKategori.run("Matematika");

const kategoriUmum = db
  .prepare("SELECT id FROM kategori WHERE nama = ?")
  .get("Umum").id;

const kategoriMatematika = db
  .prepare("SELECT id FROM kategori WHERE nama = ?")
  .get("Matematika").id;

db.prepare(
  `
  UPDATE soal SET kategori_id = ?
  WHERE kategori_id IS NULL
`,
).run(kategoriUmum);

db.prepare(
  `
  UPDATE soal SET kategori_id = ?
  WHERE pertanyaan LIKE '%2 + 2%'
`,
).run(kategoriMatematika);

// Migrasi dari soal.json jika tabel soal kosong
const jumlahSoal = db.prepare("SELECT COUNT(*) AS total FROM soal").get();

if (jumlahSoal.total === 0 && fs.existsSync(fileSoal)) {
  const dataLama = JSON.parse(fs.readFileSync(fileSoal, "utf8"));

  const migrasiJSON = db.transaction(() => {
    for (const item of dataLama) {
      const pilihan = item.jawaban;

      const hasil = db
        .prepare(
          `
        INSERT INTO soal
        (id, pertanyaan, jawaban, jawabanBenar, kategori_id)
        VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(
          item.id,
          item.pertanyaan,
          JSON.stringify(pilihan),
          item.jawabanBenar,
          kategoriUmum,
        );

      const insertOpsi = db.prepare(`
        INSERT INTO opsi_jawaban
        (soal_id, teks_opsi, benar)
        VALUES (?, ?, ?)
      `);

      for (const opsi of pilihan) {
        insertOpsi.run(
          hasil.lastInsertRowid,
          opsi,
          opsi === item.jawabanBenar ? 1 : 0,
        );
      }
    }
  });

  migrasiJSON();
}

// ======================================
// HELPER
// ======================================

const querySoal = `
  SELECT
    soal.*,
    kategori.nama AS kategori
  FROM soal
  JOIN kategori ON soal.kategori_id = kategori.id
`;

function formatSoal(item) {
  if (!item) return null;

  const opsi = db
    .prepare(
      `
    SELECT id, teks_opsi, benar
    FROM opsi_jawaban
    WHERE soal_id = ?
    ORDER BY id
  `,
    )
    .all(item.id);

  return {
    ...item,
    jawaban: opsi.map((o) => o.teks_opsi),
    jawabanBenar: opsi.find((o) => o.benar === 1)?.teks_opsi ?? null,
    opsi_jawaban: opsi,
  };
}

function validasiPilihan(jawaban, jawabanBenar) {
  return (
    Array.isArray(jawaban) &&
    jawaban.length >= 2 &&
    jawaban.every((item) => typeof item === "string" && item.trim()) &&
    new Set(jawaban.map((item) => item.trim())).size === jawaban.length &&
    typeof jawabanBenar === "string" &&
    jawabanBenar.trim() &&
    jawaban.map((item) => item.trim()).includes(jawabanBenar.trim())
  );
}

function kategoriAda(id) {
  return (
    Number.isInteger(id) &&
    id > 0 &&
    !!db.prepare("SELECT id FROM kategori WHERE id = ?").get(id)
  );
}

// ======================================
// QUERY SOAL
// ======================================

app.use((req, res, next) => {
  if (req.method !== "QUERY" || req.path !== "/soal") {
    return next();
  }

  const { cari } = req.body || {};

  if (typeof cari !== "string" || !cari.trim()) {
    return res.status(400).json({
      pesan: "Kata kunci cari wajib diisi",
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

  res.status(200).json({
    total: data.length,
    data,
  });
});

// ======================================
// GET SEMUA SOAL
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

  if (
    typeof pertanyaan !== "string" ||
    !pertanyaan.trim() ||
    !validasiPilihan(jawaban, jawabanBenar)
  ) {
    return res.status(400).json({
      pesan: "Pertanyaan dan pilihan jawaban tidak valid",
    });
  }

  if (!kategoriAda(kategori_id)) {
    return res.status(400).json({
      pesan: "Kategori tidak ditemukan atau tidak valid",
    });
  }

  const pilihan = jawaban.map((item) => item.trim());
  const benar = jawabanBenar.trim();

  try {
    const tambahSoal = db.transaction(() => {
      const hasil = db
        .prepare(
          `
        INSERT INTO soal
        (pertanyaan, jawaban, jawabanBenar, kategori_id)
        VALUES (?, ?, ?, ?)
      `,
        )
        .run(pertanyaan.trim(), JSON.stringify(pilihan), benar, kategori_id);

      const soalId = Number(hasil.lastInsertRowid);

      const insertOpsi = db.prepare(`
        INSERT INTO opsi_jawaban
        (soal_id, teks_opsi, benar)
        VALUES (?, ?, ?)
      `);

      for (const opsi of pilihan) {
        insertOpsi.run(soalId, opsi, opsi === benar ? 1 : 0);
      }

      return soalId;
    });

    const idBaru = tambahSoal();

    const data = db
      .prepare(
        `
      ${querySoal}
      WHERE soal.id = ?
    `,
      )
      .get(idBaru);

    res.status(201).json(formatSoal(data));
  } catch (error) {
    res.status(500).json({
      pesan: "Gagal menambahkan soal",
      error: error.message,
    });
  }
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

  const dataLama = db.prepare("SELECT * FROM soal WHERE id = ?").get(id);

  if (!dataLama) {
    return res.status(404).json({
      pesan: "Soal tidak ditemukan",
    });
  }

  const { pertanyaan, jawaban, jawabanBenar, kategori_id } = req.body;

  const opsiLama = db
    .prepare(
      `
    SELECT teks_opsi, benar
    FROM opsi_jawaban
    WHERE soal_id = ?
    ORDER BY id
  `,
    )
    .all(id);

  const pilihanLama = opsiLama.map((o) => o.teks_opsi);
  const benarLama = opsiLama.find((o) => o.benar === 1)?.teks_opsi;

  const pertanyaanBaru =
    pertanyaan !== undefined ? pertanyaan : dataLama.pertanyaan;

  const jawabanBaru = jawaban !== undefined ? jawaban : pilihanLama;

  const jawabanBenarBaru =
    jawabanBenar !== undefined ? jawabanBenar : benarLama;

  const kategoriBaru =
    kategori_id !== undefined ? kategori_id : dataLama.kategori_id;

  if (
    typeof pertanyaanBaru !== "string" ||
    !pertanyaanBaru.trim() ||
    !validasiPilihan(jawabanBaru, jawabanBenarBaru)
  ) {
    return res.status(400).json({
      pesan: "Data soal atau pilihan jawaban tidak valid",
    });
  }

  if (!kategoriAda(kategoriBaru)) {
    return res.status(400).json({
      pesan: "Kategori tidak ditemukan",
    });
  }

  const pilihan = jawabanBaru.map((item) => item.trim());
  const benar = jawabanBenarBaru.trim();

  try {
    const ubahSoal = db.transaction(() => {
      db.prepare(
        `
        UPDATE soal
        SET pertanyaan = ?,
            jawaban = ?,
            jawabanBenar = ?,
            kategori_id = ?
        WHERE id = ?
      `,
      ).run(
        pertanyaanBaru.trim(),
        JSON.stringify(pilihan),
        benar,
        kategoriBaru,
        id,
      );

      db.prepare(
        `
        DELETE FROM opsi_jawaban WHERE soal_id = ?
      `,
      ).run(id);

      const insertOpsi = db.prepare(`
        INSERT INTO opsi_jawaban
        (soal_id, teks_opsi, benar)
        VALUES (?, ?, ?)
      `);

      for (const opsi of pilihan) {
        insertOpsi.run(id, opsi, opsi === benar ? 1 : 0);
      }
    });

    ubahSoal();

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
  } catch (error) {
    res.status(500).json({
      pesan: "Gagal mengubah soal",
      error: error.message,
    });
  }
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

  db.prepare("DELETE FROM soal WHERE id = ?").run(id);

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
