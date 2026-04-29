const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const QRCode = require("qrcode");


const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));



const ADMIN_PIN = process.env.ADMIN_PIN;
const SECRET = process.env.SECRET;


// arriba
const sessions = new Map(); // token -> userId

// 👇 AQUÍ VA EL MIDDLEWARE
async function auth(req, res, next){
  try {
    const header = req.headers.authorization;

    if(!header){
      return res.status(401).json({ ok:false });
    }

    const token = header.startsWith("Bearer ")
      ? header.split(" ")[1]
      : header;

    const [rows] = await db.query(
      "SELECT * FROM sessions WHERE token=?",
      [token]
    );

    const session = rows[0];

    if(!session){
      return res.status(401).json({ ok:false });
    }

    if(session.expires < Date.now()){
      return res.status(401).json({ ok:false });
    }

    // 🔥 IMPORTANTE
    req.userId = session.userId;

    // 🔥 AQUÍ ESTÁ LA CLAVE
    req.isAdmin = String(session.userId).startsWith("admin-");

    next();

  } catch(err){
    console.error(err);
    res.status(500).json({ ok:false });
  }
}

async function createSession(userId){
  const token = crypto.randomBytes(24).toString("hex");

  const expires = Date.now() + (1000 * 60 * 60);

  await db.query(
    "INSERT INTO sessions (token, userId, expires) VALUES (?, ?, ?)",
    [token, userId, expires]
  );

  return token;
}





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
app.post("/admin-login", async (req, res) => {
  try {
    const { pin } = req.body;

    const [rows] = await db.query(
      "SELECT * FROM admins WHERE pin=?",
      [pin]
    );

    const admin = rows[0];

    if(!admin){
      return res.status(401).json({ ok:false });
    }

    // 🔥 crear sesión como usuario
    const token = await createSession("admin-" + admin.id);

    res.json({
      ok:true,
      token,
      name: admin.name
    });

  } catch(err){
    console.error(err);
    res.status(500).json({ ok:false });
  }
});

// LOG LOGIN
app.post("/log-login", async (req, res) => {
  try {
    const id = Date.now();

    await db.query(
      "INSERT INTO users (id, name, loginTime) VALUES (?, ?, NOW())",
      [id, req.body.name]
    );

    const token = createSession(id);

    res.json({ id, token });

  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ ok:false, error:"DB error" });
  }
});
// LOG VIDEO
app.post("/log-video", auth, async (req, res) => {
  try {
    const userId = req.userId; // 🔐 del token

    await db.query(
      "UPDATE users SET video=? WHERE id=?",
      [req.body.progress, userId]
    );

    res.json({ ok: true });

  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ ok:false, error:"DB error" });
  }
});

// LOG EXAM SEGURO
app.post("/log-exam", auth, async (req, res) => {

  try {

    const userId = req.userId; // 🔐 viene del token
    const score = req.body.score;

    // VALIDACIÓN BÁSICA
    if(score === undefined){
      return res.json({ ok:false, error:"Score requerido" });
    }

    const [rows] = await db.query(
      "SELECT * FROM users WHERE id=?",
      [userId]
    );

    const user = rows[0];

    if (!user) return res.json({ ok:false });

    // 🔒 BLOQUEO POR INTENTOS
    if(user.intentos >= 3){
      return res.json({ ok:false, error:"Intentos agotados" });
    }

    // 🔒 BLOQUEO: no permitir examen si no terminó video
    if(user.video < 90){
      return res.json({ ok:false, error:"Curso no completado" });
    }

    const folio = generarFolio();
    const fecha = new Date();

    // 🔐 FIRMA (como ya lo haces)
    const base = `${folio}|${user.name}|${fecha.toISOString()}`;
    const firma = generarFirma(base);

    const payload = encodeURIComponent(JSON.stringify({
      folio,
      nombre: user.name,
      fecha,
      firma
    }));

    const urlValidacion = `${process.env.BASE_URL}/validar.html?data=${payload}`;

    const QRCode = require("qrcode");
    const qr = await QRCode.toDataURL(urlValidacion);

    // 💾 GUARDAR TODO
    await db.query(`
      UPDATE users 
      SET exam=?, 
          intentos=intentos+1, 
          aprobado=?, 
          folio=?, 
          fecha=?, 
          qr=? 
      WHERE id=?`,
      [score, score >= 80, folio, fecha, qr, userId]
    );

    res.json({
      ok:true,
      folio,
      qr
    });

  } catch(err){
    console.error("LOG-EXAM ERROR:", err);
    res.status(500).json({ ok:false });
  }

});

// ADMIN DATA
app.get("/admin-data", auth, async (req, res) => {
  try {

    // 🔐 SOLO ADMIN
    if(!req.isAdmin){
      return res.status(403).json({ ok:false, error:"Acceso denegado" });
    }

    const [rows] = await db.query(
      "SELECT * FROM users ORDER BY id DESC"
    );

    res.json(rows);

  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ ok:false, error:"DB error" });
  }
});


app.get("/me", auth, async (req, res) => {
  const [rows] = await db.query("SELECT * FROM users WHERE id=?", [req.userId]);
  res.json(rows[0]);
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

app.post("/validate-cert", auth, async (req, res) => {
  try {
    const { folio, nombre, fecha, firma } = req.body;

    // 🔐 1. Validar firma
    const base = `${folio}|${nombre}|${fecha}`;
    const expected = crypto
      .createHmac("sha256", process.env.QR_SECRET || "TIA_SECRET")
      .update(base)
      .digest("hex");

    if(expected !== firma){
      return res.json({ ok:false, reason:"Firma inválida" });
    }

    // 🗄 2. Validar existencia en BD
    const [rows] = await db.query(
      "SELECT * FROM users WHERE folio=?",
      [folio]
    );

    const user = rows[0];

    if(!user){
      return res.json({ ok:false, reason:"No existe en BD" });
    }

    // 🔍 3. Validar consistencia
    if(user.name !== nombre){
      return res.json({ ok:false, reason:"Nombre no coincide" });
    }

    res.json({
      ok:true,
      user: {
        nombre: user.name,
        folio: user.folio,
        fecha: user.fecha,
        aprobado: user.aprobado,
        score: user.exam
      }
    });

  } catch(err){
    console.error(err);
    res.status(500).json({ ok:false });
  }
});