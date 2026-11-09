const express = require("express");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;

app.use(express.json());

const fileDB = path.join(__dirname, "soal.db");
const fileSoal = path.join(__dirname, "soal.json");

console.log("Database yang digunakan:", fileDB);

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
    kategori_id INTEGER REFERENCES kategori(id)
  )
`);

// Tambahkan kategori_id jika database lama belum memilikinya
const kolomSoal = db.pragma("table_info(soal)");
const punyaKategoriId = kolomSoal.some((kolom) => kolom.name === "kategori_id");

if (!punyaKategoriId) {
  db.exec(`
    ALTER TABLE soal
    ADD COLUMN kategori_id INTEGER REFERENCES kategori(id)
  `);
}

// Buat tabel opsi
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

// ======================================
// MIGRASI RIWAYAT KUIS
// ======================================

db.exec(`
  CREATE TABLE IF NOT EXISTS riwayat_kuis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama_pemain TEXT NOT NULL,
    tanggal TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    kategori_id INTEGER NOT NULL,
    nilai INTEGER NOT NULL,
    jumlah_soal INTEGER NOT NULL,

    FOREIGN KEY (kategori_id)
      REFERENCES kategori(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS detail_riwayat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    riwayat_id INTEGER NOT NULL,
    soal_id INTEGER NOT NULL,
    opsi_id INTEGER NOT NULL,
    benar INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (riwayat_id)
      REFERENCES riwayat_kuis(id)
      ON DELETE CASCADE,

    FOREIGN KEY (soal_id)
      REFERENCES soal(id),

    FOREIGN KEY (opsi_id)
      REFERENCES opsi_jawaban(id)
  )
`);

console.log("Migrasi tabel riwayat berhasil.");

// Buat kategori awal
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

// ======================================
// MIGRASI JAWABAN DATABASE LAMA
// ======================================

const kolomLama = db.pragma("table_info(soal)");

const punyaJawabanLama = kolomLama.some((kolom) => kolom.name === "jawaban");

const punyaJawabanBenarLama = kolomLama.some(
  (kolom) => kolom.name === "jawabanBenar",
);

if (punyaJawabanLama !== punyaJawabanBenarLama) {
  throw new Error(
    "Struktur database lama tidak lengkap: kolom jawaban harus tersedia berpasangan.",
  );
}

if (punyaJawabanLama && punyaJawabanBenarLama) {
  const migrasiJawaban = db.transaction(() => {
    const soalLama = db
      .prepare(
        `
      SELECT id, jawaban, jawabanBenar
      FROM soal
      ORDER BY id
    `,
      )
      .all();

    const cekOpsi = db.prepare(`
      SELECT COUNT(*) AS total
      FROM opsi_jawaban
      WHERE soal_id = ?
    `);

    const insertOpsi = db.prepare(`
      INSERT INTO opsi_jawaban
      (soal_id, teks_opsi, benar)
      VALUES (?, ?, ?)
    `);

    for (const item of soalLama) {
      // Lewati soal yang opsinya sudah pernah dimigrasikan
      if (cekOpsi.get(item.id).total > 0) {
        continue;
      }

      let pilihan;

      try {
        pilihan = JSON.parse(item.jawaban);
      } catch {
        throw new Error(`JSON jawaban soal ID ${item.id} tidak valid.`);
      }

      if (
        !Array.isArray(pilihan) ||
        pilihan.length === 0 ||
        !pilihan.every((opsi) => typeof opsi === "string" && opsi.trim()) ||
        !pilihan.includes(item.jawabanBenar)
      ) {
        throw new Error(`Data jawaban soal ID ${item.id} tidak valid.`);
      }

      for (const opsi of pilihan) {
        insertOpsi.run(
          item.id,
          opsi.trim(),
          opsi === item.jawabanBenar ? 1 : 0,
        );
      }
    }

    // Hapus sumber jawaban lama setelah migrasi berhasil
    db.exec(`
      ALTER TABLE soal DROP COLUMN jawaban;
      ALTER TABLE soal DROP COLUMN jawabanBenar;
    `);
  });

  migrasiJawaban();
  console.log("Migrasi jawaban lama berhasil.");
} else {
  console.log("Kolom jawaban lama tidak ditemukan. Migrasi dilewati.");
}

// Isi kategori untuk soal lama yang belum memiliki kategori

// Prioritaskan soal matematika yang kategorinya masih kosong
db.prepare(
  `
  UPDATE soal
  SET kategori_id = ?
  WHERE kategori_id IS NULL
  AND pertanyaan LIKE '%2 + 2%'
`,
).run(kategoriMatematika);

// Soal lainnya yang kategorinya masih kosong diberi kategori Umum
db.prepare(
  `
  UPDATE soal
  SET kategori_id = ?
  WHERE kategori_id IS NULL
`,
).run(kategoriUmum);

// ======================================
// MIGRASI DARI SOAL.JSON
// ======================================

const jumlahSoal = db.prepare("SELECT COUNT(*) AS total FROM soal").get().total;

if (jumlahSoal === 0 && fs.existsSync(fileSoal)) {
  const dataLama = JSON.parse(fs.readFileSync(fileSoal, "utf8"));

  if (!Array.isArray(dataLama)) {
    throw new Error("Format soal.json tidak valid.");
  }

  const migrasiJSON = db.transaction(() => {
    for (const item of dataLama) {
      if (
        !Array.isArray(item.jawaban) ||
        !item.jawaban.includes(item.jawabanBenar)
      ) {
        throw new Error(
          `Pilihan jawaban soal "${item.pertanyaan}" tidak valid.`,
        );
      }

      const hasil = db
        .prepare(
          `
        INSERT INTO soal (id, pertanyaan, kategori_id)
        VALUES (?, ?, ?)
      `,
        )
        .run(item.id, item.pertanyaan, kategoriUmum);

      const insertOpsi = db.prepare(`
        INSERT INTO opsi_jawaban
        (soal_id, teks_opsi, benar)
        VALUES (?, ?, ?)
      `);

      for (const opsi of item.jawaban) {
        insertOpsi.run(
          hasil.lastInsertRowid,
          opsi,
          opsi === item.jawabanBenar ? 1 : 0,
        );
      }
    }
  });

  migrasiJSON();
  console.log("Migrasi dari soal.json berhasil.");
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
    SELECT teks_opsi, benar
    FROM opsi_jawaban
    WHERE soal_id = ?
    ORDER BY id
  `,
    )
    .all(item.id);

  return {
    id: item.id,
    pertanyaan: item.pertanyaan,
    kategori_id: item.kategori_id,
    kategori: item.kategori,
    jawaban: opsi.map((o) => o.teks_opsi),
    jawabanBenar: opsi.find((o) => o.benar === 1)?.teks_opsi ?? null,
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
        INSERT INTO soal (pertanyaan, kategori_id)
        VALUES (?, ?)
      `,
        )
        .run(pertanyaan.trim(), kategori_id);

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
            kategori_id = ?
        WHERE id = ?
      `,
      ).run(pertanyaanBaru.trim(), kategoriBaru, id);

      db.prepare(
        `
        DELETE FROM opsi_jawaban
        WHERE soal_id = ?
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

  // Format data sebelum dihapus agar opsi tidak hilang
  const dataTerhapus = formatSoal(data);

  db.prepare("DELETE FROM soal WHERE id = ?").run(id);

  res.status(200).json({
    pesan: "Soal berhasil dihapus",
    data: dataTerhapus,
  });
});

// ======================================
// POST RIWAYAT KUIS
// ======================================

app.post("/riwayat", (req, res) => {
  const { nama_pemain, kategori_id, jawaban } = req.body;

  // Validasi nama pemain
  if (typeof nama_pemain !== "string" || !nama_pemain.trim()) {
    return res.status(400).json({
      pesan: "Nama pemain tidak boleh kosong",
    });
  }

  // Validasi kategori
  if (!kategoriAda(kategori_id)) {
    return res.status(400).json({
      pesan: "Kategori tidak ditemukan atau tidak valid",
    });
  }

  // Validasi daftar jawaban
  if (!Array.isArray(jawaban) || jawaban.length === 0) {
    return res.status(400).json({
      pesan: "Daftar jawaban tidak boleh kosong",
    });
  }

  // Validasi setiap soal dan opsi yang dipilih
  const dataJawaban = [];

  for (const item of jawaban) {
    if (
      !item ||
      !Number.isInteger(item.soal_id) ||
      item.soal_id <= 0 ||
      !Number.isInteger(item.opsi_id) ||
      item.opsi_id <= 0
    ) {
      return res.status(400).json({
        pesan: "Data soal atau opsi tidak valid",
      });
    }

    const soal = db
      .prepare("SELECT id FROM soal WHERE id = ?")
      .get(item.soal_id);

    if (!soal) {
      return res.status(400).json({
        pesan: `Soal ID ${item.soal_id} tidak ditemukan`,
      });
    }

    const opsi = db
      .prepare(
        `
        SELECT id, benar
        FROM opsi_jawaban
        WHERE id = ? AND soal_id = ?
      `,
      )
      .get(item.opsi_id, item.soal_id);

    if (!opsi) {
      return res.status(400).json({
        pesan: `Opsi tidak valid untuk soal ID ${item.soal_id}`,
      });
    }

    dataJawaban.push({
      soal_id: item.soal_id,
      opsi_id: item.opsi_id,
      benar: opsi.benar === 1 ? 1 : 0,
    });
  }

  // Cegah soal yang sama dijawab lebih dari satu kali
  const daftarSoal = dataJawaban.map((item) => item.soal_id);

  if (new Set(daftarSoal).size !== daftarSoal.length) {
    return res.status(400).json({
      pesan: "Soal tidak boleh dijawab lebih dari satu kali",
    });
  }

  // Hitung nilai berdasarkan jawaban yang benar
  const jumlahSoal = dataJawaban.length;
  const jumlahBenar = dataJawaban.filter((item) => item.benar === 1).length;

  const nilai = Math.round((jumlahBenar / jumlahSoal) * 100);

  try {
    // Simpan riwayat dan detail secara atomik
    const simpanRiwayat = db.transaction(() => {
      const hasil = db
        .prepare(
          `
          INSERT INTO riwayat_kuis
          (nama_pemain, kategori_id, nilai, jumlah_soal)
          VALUES (?, ?, ?, ?)
        `,
        )
        .run(nama_pemain.trim(), kategori_id, nilai, jumlahSoal);

      const riwayatId = Number(hasil.lastInsertRowid);

      const insertDetail = db.prepare(`
        INSERT INTO detail_riwayat
        (riwayat_id, soal_id, opsi_id, benar)
        VALUES (?, ?, ?, ?)
      `);

      for (const item of dataJawaban) {
        insertDetail.run(riwayatId, item.soal_id, item.opsi_id, item.benar);
      }

      return riwayatId;
    });

    const riwayatId = simpanRiwayat();

    // Ambil kembali data yang sudah disimpan
    const data = db
      .prepare(
        `
        SELECT
          r.id,
          r.nama_pemain,
          r.tanggal,
          r.kategori_id,
          k.nama AS kategori,
          r.nilai,
          r.jumlah_soal
        FROM riwayat_kuis r
        JOIN kategori k ON r.kategori_id = k.id
        WHERE r.id = ?
      `,
      )
      .get(riwayatId);

    res.status(201).json({
      pesan: "Riwayat kuis berhasil disimpan",
      data: {
        ...data,
        jumlah_benar: jumlahBenar,
        jumlah_salah: jumlahSoal - jumlahBenar,
      },
    });
  } catch (error) {
    res.status(500).json({
      pesan: "Gagal menyimpan riwayat kuis",
      error: error.message,
    });
  }
});

// ======================================
// GET DETAIL RIWAYAT KUIS
// ======================================

app.get("/riwayat/:id", (req, res) => {
  const id = Number(req.params.id);

  // Validasi ID
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({
      pesan: "ID riwayat tidak valid",
    });
  }

  // Ambil data utama riwayat
  const riwayat = db
    .prepare(
      `
      SELECT
        r.id,
        r.nama_pemain,
        r.tanggal,
        r.kategori_id,
        k.nama AS kategori,
        r.nilai,
        r.jumlah_soal
      FROM riwayat_kuis r
      JOIN kategori k ON r.kategori_id = k.id
      WHERE r.id = ?
    `,
    )
    .get(id);

  if (!riwayat) {
    return res.status(404).json({
      pesan: "Riwayat kuis tidak ditemukan",
    });
  }

  // Ambil detail jawaban
  const detail = db
    .prepare(
      `
      SELECT
        d.soal_id,
        s.pertanyaan,
        d.opsi_id,
        o.teks_opsi AS jawaban_dipilih,
        d.benar,
        CASE
          WHEN d.benar = 1 THEN 'Benar'
          ELSE 'Salah'
        END AS status
      FROM detail_riwayat d
      JOIN soal s ON d.soal_id = s.id
      JOIN opsi_jawaban o ON d.opsi_id = o.id
      WHERE d.riwayat_id = ?
      ORDER BY d.id
    `,
    )
    .all(id);

  res.status(200).json({
    data: {
      ...riwayat,
      detail,
    },
  });
});

// ======================================
// GET SEMUA RIWAYAT KUIS
// ======================================

app.get("/riwayat", (req, res) => {
  const pemain = req.query.pemain;

  // Jika filter pemain digunakan
  if (pemain !== undefined) {
    if (typeof pemain !== "string" || !pemain.trim()) {
      return res.status(400).json({
        pesan: "Filter nama pemain tidak valid",
      });
    }

    const data = db
      .prepare(
        `
        SELECT
          r.id,
          r.nama_pemain,
          r.tanggal,
          k.nama AS kategori,
          r.nilai,
          r.jumlah_soal
        FROM riwayat_kuis r
        JOIN kategori k ON r.kategori_id = k.id
        WHERE LOWER(r.nama_pemain) LIKE LOWER(?)
        ORDER BY r.id DESC
      `,
      )
      .all(`%${pemain.trim()}%`);

    return res.status(200).json({
      jumlah: data.length,
      data,
    });
  }

  // Jika tidak menggunakan filter
  const data = db
    .prepare(
      `
      SELECT
        r.id,
        r.nama_pemain,
        r.tanggal,
        k.nama AS kategori,
        r.nilai,
        r.jumlah_soal
      FROM riwayat_kuis r
      JOIN kategori k ON r.kategori_id = k.id
      ORDER BY r.id DESC
    `,
    )
    .all();

  res.status(200).json({
    jumlah: data.length,
    data,
  });
});

// ======================================
// MENJALANKAN SERVER
// ======================================

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
