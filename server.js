const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const QRCode = require("qrcode");

console.log("DB_HOST:", process.env.DB_HOST);

const db = mysql.createPool({
  host: process.env.DB_HOST || "mysql.hostinger.com",
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));



const ADMIN_PIN = process.env.ADMIN_PIN;
const SECRET = process.env.SECRET;



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
  try {
    const id = Date.now();

    await db.query(
      "INSERT INTO users (id, name, loginTime) VALUES (?, ?, NOW())",
      [id, req.body.name]
    );

    res.json({ id, name: req.body.name });

  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ ok:false, error:"DB error" });
  }
});

// LOG VIDEO
app.post("/log-video", async (req, res) => {
try {
  await db.query(
    "UPDATE users SET video=? WHERE id=?",
    [req.body.progress, req.body.userId]
  );

  res.json({ ok: true });
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ ok:false, error:"DB error" });
  }
  

});

// LOG EXAM
app.post("/log-exam", async (req, res) => {
try {
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
 } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ ok:false, error:"DB error" });
  }
  
  

});

// ADMIN DATA
app.get("/admin-data", async (req, res) => {
try {
  if (req.query.pin !== process.env.ADMIN_PIN)
    return res.status(403).send("No autorizado");

  const [rows] = await db.query("SELECT * FROM users ORDER BY loginTime DESC");

  res.json(rows);
} catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ ok:false, error:"DB error" });
  }
  

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




function generarFolio(){
  return "TIA-" + Math.random().toString(36).substring(2,8).toUpperCase();
}

function generarFirma(data){
  return crypto
    .createHmac("sha256", process.env.QR_SECRET || "TIA_SECRET")
    .update(data)
    .digest("hex");
}

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED PROMISE:", err);
});