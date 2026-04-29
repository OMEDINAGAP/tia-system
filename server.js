const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
});

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const userId = Number(req.body.userId);
    const dir = `uploads/${userId}`;

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });
const ADMIN_PIN = process.env.ADMIN_PIN;
const SECRET = process.env.SECRET;

const adapter = new JSONFile("db.json");
const db = new Low(adapter, { users: [] });

async function init() {
  await db.read();
  db.data ||= { users: [] };
  await db.write();
}
init();

// PASSWORD DINÁMICA
function generatePassword() {
  const now = new Date();

  // FORZAR ZONA MÉXICO (UTC-7)
  const offset = -7;
  const local = new Date(now.getTime() + (offset * 60 * 60 * 1000));

  const today = local.toISOString().split("T")[0];

  const base = SECRET + today;

  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash << 5) - hash + base.charCodeAt(i);
    hash |= 0;
  }

  return "TIA#" + Math.abs(hash).toString(36).toUpperCase().slice(0,6);
}



// ADMIN PASSWORD (PROTEGIDO)
app.get("/admin-password", (req, res) => {
  if (req.query.pin !== ADMIN_PIN) return res.status(403).send("No autorizado");
  res.send(generatePassword());
});

// LOG LOGIN
app.post("/log-login", async (req, res) => {

  const id = Date.now();

  await db.query(
    "INSERT INTO users (id, name, loginTime) VALUES (?, ?, NOW())",
    [id, req.body.name]
  );

  res.json({ id, name: req.body.name });

});

// LOG VIDEO
app.post("/log-video", async (req, res) => {

  await db.query(
    "UPDATE users SET video=? WHERE id=?",
    [req.body.progress, req.body.userId]
  );

  res.json({ ok: true });

});

// LOG EXAM
app.post("/log-exam", async (req, res) => {

  const userId = req.body.userId;
  const score = req.body.score;

  const [rows] = await db.query("SELECT * FROM users WHERE id=?", [userId]);
  const user = rows[0];

  if (!user) return res.json({ ok:false });

  const folio = generarFolio();
  const fecha = new Date();

  const base = `${folio}|${user.name}|${fecha.toISOString()}`;
  const firma = generarFirma(base);

  const payload = encodeURIComponent(JSON.stringify({
    folio,
    nombre: user.name,
    fecha,
    firma
  }));

  const urlValidacion = `${process.env.BASE_URL}/validar.html?data=${payload}`;
  const qr = await QRCode.toDataURL(urlValidacion);

  await db.query(`
    UPDATE users 
    SET exam=?, folio=?, fecha=?, qr=?, intentos=intentos+1, aprobado=? 
    WHERE id=?`,
    [score, folio, fecha, qr, score>=80, userId]
  );

  res.json({ ok:true, folio, qr });

});

// ADMIN DATA
app.get("/admin-data", async (req, res) => {

  if (req.query.pin !== process.env.ADMIN_PIN)
    return res.status(403).send("No autorizado");

  const [rows] = await db.query("SELECT * FROM users ORDER BY loginTime DESC");

  res.json(rows);

});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running"));

app.get("/validate", (req, res) => {
  const pass = req.query.pass;
  const current = generatePassword();

  console.log("PASS USER:", pass);
  console.log("PASS SERVER:", current);

  res.json({ ok: pass === current });
});

app.post("/upload-docs", upload.array("docs"), async (req, res) => {

  console.log("FILES:", req.files);
  console.log("BODY:", req.body);

  const userId = Number(req.body.userId);

  if (!userId) {
    return res.json({ ok:false, error:"userId inválido" });
  }

  const user = db.data.users.find(u => u.id === userId);

  if (!user) {
    return res.json({ ok:false, error:"Usuario no encontrado" });
  }

  if (!req.files || req.files.length === 0) {
    return res.json({ ok:false, error:"No se recibieron archivos" });
  }

  user.docs = req.files.map(f => f.path);

  await db.write();

  res.json({ ok: true });
});

app.use("/uploads", express.static("uploads"));
