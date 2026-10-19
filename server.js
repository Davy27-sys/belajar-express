const express = require("express");

const app = express();
const PORT = 3001;

const soal = [
  {
    id: 1,
    pertanyaan: "Apa kepanjangan CPU?",
    jawaban: ["Central Processing Unit", "Computer Personal Unit"],
    jawabanBenar: "Central Processing Unit",
  },
  {
    id: 2,
    pertanyaan: "Apa fungsi RAM?",
    jawaban: ["Menyimpan data sementara", "Mencetak dokumen"],
    jawabanBenar: "Menyimpan data sementara",
  },
];

app.get("/", (req, res) => {
  res.send("Server Express berhasil berjalan!");
});

app.get("/tentang", (req, res) => {
  res.json({
    nama: "Belajar Express",
    status: "Aktif",
  });
});

app.get("/soal", (req, res) => {
  res.json(soal);
});

app.get("/soal/:id", (req, res) => {
  const id = Number(req.params.id);
  const dataSoal = soal.find((item) => item.id === id);

  if (!dataSoal) {
    return res.status(404).json({
      pesan: "Soal tidak ditemukan",
    });
  }

  res.json(dataSoal);
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
