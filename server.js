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
app.use(express.static(__dirname + "/public"));

const fs = require("fs");

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const ADMIN_PIN = process.env.ADMIN_PIN;
const SECRET = process.env.SECRET;


// arriba
const sessions = new Map(); // token -> userId

let lastSent = 0;

// 2️⃣ 🔐 AUTH (AQUÍ ARRIBA)
function auth(req, res, next) {

  const header = req.headers.authorization;

  if (!header) return res.status(401).json({ error: "No token" });

  const token = header.split(" ")[1];

  // 🔥 ADMIN
  if (token.startsWith("admin-")) {
    req.isAdmin = true;
    req.userId = null;
    req.token = token;
    return next();
  }

  // 🔥 USUARIO NORMAL (tu lógica actual)
  req.isAdmin = false;
  req.userId = parseInt(token); // o como lo manejes

  next();
}

function track() {

  if (!player || typeof player.getCurrentTime !== "function") return;

  const state = player.getPlayerState();
  if (state !== YT.PlayerState.PLAYING) return;

  const current = player.getCurrentTime();

  if (!duration || duration === 0) {
    duration = player.getDuration();
    return;
  }

  // 🚫 NO ADELANTAR
  if (current > maxTime + 8) {
    player.seekTo(maxTime - 1);
  } else {
    maxTime = Math.max(maxTime, current);
  }

  const percentCurrentVideo = (maxTime / duration);
  const totalProgress =
    ((currentVideoIndex + percentCurrentVideo) / videos.length) * 100;

  // 🧠 UI
  document.getElementById("progress").innerText =
    "Progreso total: " + Math.floor(totalProgress) + "%";

  document.getElementById("progress-fill").style.width =
    totalProgress + "%";

  console.log("TRACK:", currentVideoIndex, maxTime, totalProgress);

  // 🔥 ENVÍO
  if (totalProgress - lastSent >= 3) {

    lastSent = totalProgress;

    fetch("/log-video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({
        progress: maxTime,
        videoIndex: currentVideoIndex
      })
    })
      .then(r => r.json())
      .then(data => console.log("RESPUESTA:", data))
      .catch(err => console.error("LOG VIDEO ERROR:", err));
  }
}

async function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");

  const expires = Date.now() + (1000 * 60 * 60);

  await db.query(
    "INSERT INTO sessions (token, userId, expires) VALUES (?, ?, ?)",
    [token, userId, expires]
  );

  return token;
}


app.get("/daily-code", auth, (req, res) => {
  const code = generatePassword();
  res.json({ code });
});


// PASSWORD DINÁMICA
function generatePassword() {

  const now = new Date();

  // 🇲🇽 Zona México (UTC-7 o UTC-6 dependiendo DST)
  const mexicoTime = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Mexico_City" })
  );

  const today = mexicoTime.toISOString().split("T")[0];

  const base = SECRET + today;

  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash << 5) - hash + base.charCodeAt(i);
    hash |= 0;
  }

  return "TIA#" + Math.abs(hash).toString(36).toUpperCase().slice(0, 6);
}



// ADMIN PASSWORD (PROTEGIDO)
app.post("/admin-login", async (req, res) => {

  const { pin } = req.body;

  try {

    const [rows] = await db.query(
      "SELECT * FROM admins WHERE pin = ? LIMIT 1",
      [pin]
    );

    if (rows.length === 0) {
      return res.status(401).json({ ok: false, msg: "PIN incorrecto" });
    }

    const admin = rows[0];

    // 🔥 generar token
    const token = "admin-" + admin.id + "-" + Date.now();

    res.json({
      ok: true,
      token,
      name: admin.name
    });

  } catch (err) {
    console.error("❌ ERROR admin-login:", err);
    res.status(500).json({ ok: false });
  }
});


/* app.post("/log-login", async (req, res) => {
  try {

    const { name, company } = req.body;

    if (!name || !company) {
      return res.status(400).json({ ok: false, error: "Datos requeridos" });
    }

    const [rows] = await db.query(
      "SELECT * FROM users WHERE name=? AND company=?",
      [name.trim(), company.trim()]
    );

    let userId;
    let folio;

    if (rows.length > 0) {

      userId = rows[0].id;
      folio = rows[0].folio;

      console.log("👤 Usuario existente:", userId);

    } else {

      userId = Date.now();
      folio = "TIA-" + Math.floor(100000 + Math.random() * 900000);

      await db.query(
        `INSERT INTO users (id, name, company, folio, loginTime) 
         VALUES (?, ?, ?, ?, NOW())`,
        [userId, name.trim(), company.trim(), folio]
      );

      console.log("🆕 Usuario nuevo:", userId);
    }

    // 🔥 limpiar sesiones viejas
    await db.query("DELETE FROM sessions WHERE userId=?", [userId]);

    const token = await createSession(userId);

    res.json({
      ok: true,
      token,
      userId,
      folio   // 🔥 IMPORTANTE
    });

  } catch (err) {
    console.error("❌ ERROR log-login:", err);
    res.status(500).json({ ok: false });
  }
}); */

app.post("/log-login", async (req, res) => {

  const { name, company } = req.body;

  // 🔍 BUSCAR USUARIO
  const [rows] = await db.query(
    "SELECT * FROM users WHERE name=? AND company=?",
    [name, company]
  );

  let user;

  if (rows.length === 0) {
    // 🔥 CREAR USUARIO
    const [result] = await db.query(
      "INSERT INTO users (name, company) VALUES (?, ?)",
      [name, company]
    );

    user = { id: result.insertId };

  } else {
    user = rows[0];
  }

  // 🔥 ESTE ES EL BUENO
  const userId = user.id;

  // 🔥 TOKEN
  const token = crypto.randomBytes(32).toString("hex");

  await db.query(
    "INSERT INTO sessions (token, userId, expires) VALUES (?, ?, ?)",
    [token, userId, Date.now() + 86400000]
  );

  res.json({
    ok: true,
    token,
    folio: "TIA-" + userId
  });

});

app.get("/video-progress", auth, async (req, res) => {

  console.log("📥 GET USER:", req.userId);

  const [rows] = await db.query(
    "SELECT videoIndex, progress, completed FROM video_progress WHERE userId=?",
    [req.userId]
  );

  console.log("📊 RESULTADOS BD:", rows);

  res.json(rows);
});


app.post("/log-video", auth, async (req, res) => {
  try {
    const userId = req.userId;
    let { progress, videoIndex } = req.body;

    progress = parseFloat(progress);
    videoIndex = parseInt(videoIndex);

    if (isNaN(progress) || isNaN(videoIndex)) {
      return res.status(400).json({ ok: false });
    }

    progress = Math.max(0, Math.min(progress, 100));
    const completed = progress >= 90;

    console.log("💾 SAVE USER:", userId);

    await db.query(`
      INSERT INTO video_progress (userId, videoIndex, progress, completed)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        progress = GREATEST(progress, VALUES(progress)),
        completed = VALUES(completed)
    `, [userId, videoIndex, progress, completed]);

    console.log("GUARDANDO PARA USER:", req.userId);

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ ERROR log-video:", err);
    res.status(500).json({ ok: false });
  }
});

// LOG EXAM SEGURO
app.post("/log-exam", auth, async (req, res) => {

  try {

    const userId = req.userId; // 🔐 viene del token
    const score = req.body.score;

    // VALIDACIÓN BÁSICA
    if (score === undefined) {
      return res.json({ ok: false, error: "Score requerido" });
    }

    const [rows] = await db.query(
      "SELECT * FROM users WHERE id=?",
      [userId]
    );

    const user = rows[0];

    if (!user) return res.json({ ok: false });

    // 🔒 BLOQUEO POR INTENTOS
    if (user.intentos >= 3) {
      return res.json({ ok: false, error: "Intentos agotados" });
    }

    // 🔒 BLOQUEO: no permitir examen si no terminó video
    if (user.video < 90) {
      return res.json({ ok: false, error: "Curso no completado" });
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
      ok: true,
      folio,
      qr
    });

  } catch (err) {
    console.error("LOG-EXAM ERROR:", err);
    res.status(500).json({ ok: false });
  }

});

app.get("/admin-password", auth, (req, res) => {

  if (!req.isAdmin) {
    return res.status(403).send("No autorizado");
  }

  res.send(generatePassword());
});

// ADMIN DATA
app.get("/admin-data", auth, async (req, res) => {

  if (!req.isAdmin) {
    return res.status(403).json({ error: "No autorizado" });
  }

  try {

    const [users] = await db.query(`
      SELECT 
        u.id, 
        u.name, 
        u.folio,
        IFNULL(MAX(v.progress),0) as progress
      FROM users u
      LEFT JOIN video_progress v ON u.id = v.userId
      GROUP BY u.id
    `);

    const formatted = users.map(u => ({
      id: u.id,
      name: u.name,
      folio: u.folio,
      progress: Number(u.progress),
      video: "Video 1",
      minute: Math.round((u.progress / 100) * 60),
      status: u.progress >= 100 ? "completado" : "en progreso"
    }));


    console.log("USERS:", users);

    res.json({
      users: formatted,
      activity: [
        "Usuario inició sesión",
        "Progreso guardado"
      ]
    });

  } catch (err) {
    console.error("❌ ERROR admin-data:", err);
    res.status(500).json({ error: "Error servidor" });
  }

});


app.get("/me", auth, async (req, res) => {
  const [rows] = await db.query("SELECT * FROM users WHERE id=?", [req.userId]);
  res.json(rows[0]);
});




const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running"));

app.post("/validate", (req, res) => {
  const { pass, company } = req.body;

  const current = generatePassword();


  // Validación básica
  if (!company) {
    return res.json({ ok: false, error: "Empresa requerida" });
  }

  res.json({ ok: pass === current });
});




function generarFolio() {
  return "TIA-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generarFirma(data) {
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

    if (expected !== firma) {
      return res.json({ ok: false, reason: "Firma inválida" });
    }

    // 🗄 2. Validar existencia en BD
    const [rows] = await db.query(
      "SELECT * FROM users WHERE folio=?",
      [folio]
    );

    const user = rows[0];

    if (!user) {
      return res.json({ ok: false, reason: "No existe en BD" });
    }

    // 🔍 3. Validar consistencia
    if (user.name !== nombre) {
      return res.json({ ok: false, reason: "Nombre no coincide" });
    }

    res.json({
      ok: true,
      user: {
        nombre: user.name,
        folio: user.folio,
        fecha: user.fecha,
        aprobado: user.aprobado,
        score: user.exam
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});


const multer = require("multer");

// 🔧 asegurar carpeta
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const upload = multer({ dest: "uploads/" });

// 📸 GUARDAR FOTO
app.post("/upload-photo", auth, upload.single("photo"), async (req, res) => {
  try {

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file recibido" });
    }

    const userId = req.userId;

    const filePath = req.file.path;

    console.log("Archivo guardado:", filePath);

    await db.query(
      "UPDATE users SET photo=? WHERE id=?",
      [filePath, userId]
    );

    res.json({ ok: true });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ ok: false });
  }
});


app.get("/questions", async (req, res) => {

  const group = Math.floor(Math.random() * 3) + 1;

  const [rows] = await db.query(
    "SELECT id, question, option_a, option_b, option_c, option_d FROM questions WHERE exam_group=? ORDER BY RAND() LIMIT 15",
    [group]
  );

  res.json(rows);
});

app.post("/submit-exam", auth, async (req, res) => {

  const userId = req.userId;
  const answers = req.body.answers;

  let correct = 0;

  for (let a of answers) {
    const [q] = await db.query(
      "SELECT correct FROM questions WHERE id=?",
      [a.id]
    );

    if (q.length && q[0].correct === a.answer) {
      correct++;
    }
  }

  const score = Math.round((correct / answers.length) * 100);

  // 🔥 obtener usuario
  const [rows] = await db.query(
    "SELECT intentos FROM users WHERE id=?",
    [userId]
  );

  if (!rows.length) {
    console.log("❌ Usuario no encontrado:", userId);
    return res.status(401).json({ error: "Usuario no válido" });
  }

  const user = rows[0];

  const intento = (user.intentos || 0) + 1;

  const aprobado = score >= 80;
  const resetVideo = intento >= 3 && !aprobado;

  // 🔥 guardar
  await db.query(
    "UPDATE users SET exam=?, intentos=?, aprobado=? WHERE id=?",
    [score, intento, aprobado, userId]
  );

  res.json({
    score,
    aprobado,
    intentos: intento,
    resetVideo
  });

});

app.get("/can-take-exam", auth, async (req, res) => {
  try {

    const isTest = req.headers["x-test-mode"] === "true";

    // 🔥 MODO PRUEBA (BYPASS TOTAL)
    if (isTest) {
      return res.json({
        ok: true,
        test: true
      });
    }

    // 🔒 VALIDACIÓN NORMAL
    const [rows] = await db.query(
      "SELECT video FROM users WHERE id=?",
      [req.userId]
    );

    const progress = rows[0]?.video || 0;

    if (progress >= 90) {
      return res.json({ ok: true, progress });
    }

    res.json({ ok: false, progress });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

/* app.post("/validate-new", async (req, res) => {

  const { name, company, pass } = req.body;
  const current = generatePassword();

  if (pass !== current) {
    return res.json({ ok: false, msg: "Contraseña incorrecta" });
  }

  if (!name || !company) {
    return res.json({ ok: false, msg: "Datos incompletos" });
  }

  // 🔥 crear usuario
  const id = Date.now(); // simple, luego puedes mejorar
  // 🔥 GENERAR FOLIO (AQUÍ VA)
  const folio = "TIA-" + Math.floor(100000 + Math.random() * 900000);

  await db.query(
    `INSERT INTO users (id, name, company, folio, loginTime) 
     VALUES (?, ?, ?, ?, NOW())`,
    [id, name.trim(), company.trim(), folio]
  );

  res.json({ ok: true, id, folio });
}); */

app.post("/validate-new", async (req, res) => {

  const { name, company, pass } = req.body;

  const current = generatePassword();

  if (pass !== current) {
    return res.json({
      ok: false,
      msg: "Contraseña incorrecta"
    });
  }

  if (!name || !company) {
    return res.json({
      ok: false,
      msg: "Datos incompletos"
    });
  }

  // 🔥 FOLIO
  const folio = "TIA-" + Math.floor(
    100000 + Math.random() * 900000
  );

  // ✅ INSERT SIN ID
  const [result] = await db.query(
    `INSERT INTO users 
    (name, company, folio, loginTime)
    VALUES (?, ?, ?, NOW())`,
    [
      name.trim(),
      company.trim(),
      folio
    ]
  );

  // ✅ ID REAL MYSQL
  const userId = result.insertId;

  res.json({
    ok: true,
    id: userId,
    folio
  });
});

app.post("/validate-id", async (req, res) => {

  const { id, pass } = req.body;
  const current = generatePassword();

  if (pass !== current) {
    return res.json({ ok: false });
  }

  // 🔥 BUSCAR POR ID O FOLIO
  const [rows] = await db.query(
    "SELECT * FROM users WHERE id=? OR folio=?",
    [id, id]
  );

  if (!rows.length) {
    return res.json({ ok: false });
  }

  const user = rows[0];

  res.json({
    ok: true,
    user
  });
});
