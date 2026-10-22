const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;

// Middleware untuk membaca body JSON
app.use(express.json());

// Lokasi file penyimpanan soal
const fileSoal = path.join(__dirname, "soal.json");

// Baca data soal dari file saat server mulai
let soal = JSON.parse(fs.readFileSync(fileSoal, "utf8"));

// Fungsi menyimpan data soal ke file
function simpanSoal() {
  fs.writeFileSync(fileSoal, JSON.stringify(soal, null, 2), "utf8");
}

// GET semua soal
app.get("/soal", (req, res) => {
  res.json(soal);
});

// GET soal berdasarkan ID
app.get("/soal/", (req, res) => {
  const id = Number(req.params.id);
  const data = soal.find((item) => item.id === id);

  if (!data) {
    return res.status(404).json({
      pesan: "Soal tidak ditemukan",
    });
  }

  res.json(data);
});

// QUERY mencari soal berdasarkan kata kunci dari body JSON
app.query("/soal", (req, res) => {
  const { cari } = req.body;

  if (typeof cari !== "string" || !cari.trim()) {
    return res.status(400).json({
      pesan: "Kata kunci 'cari' wajib diisi",
    });
  }

  const kataKunci = cari.trim().toLowerCase();

  const hasil = soal.filter((item) =>
    item.pertanyaan.toLowerCase().includes(kataKunci),
  );

  res.json({
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
    !jawaban.length ||
    typeof jawabanBenar !== "string" ||
    !jawabanBenar.trim()
  ) {
    return res.status(400).json({
      pesan: "Pertanyaan, jawaban (array), dan jawabanBenar wajib diisi",
    });
  }

  const idBaru =
    soal.length > 0 ? Math.max(...soal.map((item) => item.id)) + 1 : 1;

  const soalBaru = {
    id: idBaru,
    pertanyaan: pertanyaan.trim(),
    jawaban,
    jawabanBenar: jawabanBenar.trim(),
  };

  soal.push(soalBaru);
  simpanSoal();

  res.status(201).json(soalBaru);
});

// PUT ubah soal berdasarkan ID
app.put("/soal/", (req, res) => {
  const id = Number(req.params.id);
  const index = soal.findIndex((item) => item.id === id);

  if (index === -1) {
    return res.status(404).json({
      pesan: "Soal tidak ditemukan",
    });
  }

  const { pertanyaan, jawaban, jawabanBenar } = req.body;

  soal[index] = {
    ...soal[index],
    ...(pertanyaan !== undefined && { pertanyaan }),
    ...(jawaban !== undefined && { jawaban }),
    ...(jawabanBenar !== undefined && { jawabanBenar }),
    id,
  };

  simpanSoal();

  res.json(soal[index]);
});

// DELETE hapus soal berdasarkan ID
app.delete("/soal/", (req, res) => {
  const id = Number(req.params.id);
  const index = soal.findIndex((item) => item.id === id);

  if (index === -1) {
    return res.status(404).json({
      pesan: "Soal tidak ditemukan",
    });
  }

  const soalDihapus = soal.splice(index, 1)[0];

  simpanSoal();

  res.json({
    pesan: "Soal berhasil dihapus",
    data: soalDihapus,
  });
});

// Jalankan server setelah semua route didaftarkan
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
