const Database = require("better-sqlite3");

const db = new Database("soal.db");

const data = db
  .prepare(
    `
  SELECT * FROM soal
`,
  )
  .all();

console.log("Data soal saat ini:");
console.log(data);

db.close();
