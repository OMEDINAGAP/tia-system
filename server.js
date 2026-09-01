const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const path = require("path");
const nodemailer = require("nodemailer");


const db = mysql.createPool({
  host: process.env.MYSQLHOST || "127.0.0.1",
  user: process.env.MYSQLUSER || "root",
  password: process.env.MYSQLPASSWORD || "",
  database: process.env.MYSQLDATABASE || "CURSOS",
  port: Number(process.env.MYSQLPORT) || 3306,
});

const app = express();
app.set("trust proxy", 1);

const publicOrigin = (() => {
  try { return new URL(process.env.PUBLIC_URL || "http://localhost:3000").origin; }
  catch { return "http://localhost:3000"; }
})();
const allowedOrigins = new Set([
  publicOrigin,
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origen no permitido"));
  },
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.removeHeader("X-Powered-By");
  next();
});
app.use(express.json({ limit: "100kb" }));
app.use(express.static(__dirname + "/public"));

function createRateLimiter({ windowMs, max, message }) {
  const attempts = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip}:${req.path}`;
    const current = attempts.get(key);
    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) {
      res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000));
      return res.status(429).json({ ok: false, message, msg: message });
    }
    next();
  };
}

const adminLoginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Demasiados intentos. Espera 15 minutos e intenta nuevamente."
});
const accessLoginLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: "Demasiados intentos. Espera unos minutos e intenta nuevamente."
});

app.all(["/validate-new", "/validate-id", "/log-login", "/validate", "/validate-cert"], (req, res) => {
  return res.status(410).json({ ok: false, error: "Ruta retirada" });
});

app.get("/health",async(req,res)=>{
  try{await db.query("SELECT 1");return res.json({ok:true,service:"tia-system"})}
  catch(err){return res.status(503).json({ok:false,service:"tia-system",database:"unavailable"})}
});

const fs = require("fs");

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const ADMIN_PIN = process.env.ADMIN_PIN;
const SECRET = process.env.SECRET;

function createMailTransport(){
  if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS)return null;
  return nodemailer.createTransport({
    host:process.env.SMTP_HOST,
    port:Number(process.env.SMTP_PORT)||465,
    secure:String(process.env.SMTP_SECURE??"true").toLowerCase()!=="false",
    auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}
  });
}


// arriba
const sessions = new Map(); // token -> userId

let lastSent = 0;
const videoProgressRate = new Map();

// 2️⃣ 🔐 AUTH (AQUÍ ARRIBA)
/* function auth(req, res, next) {

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
 */


// 🔐 AUTH
async function auth(req, res, next) {

  try {

    const header = req.headers.authorization;

    if (!header) {

      return res.status(401).json({
        error: "No token"
      });

    }

    const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) return res.status(401).json({ error: "Token invalido" });

    // 🔥 ADMIN
    if (token.startsWith("admin-")) {
      const [adminRows] = await db.query(
        `SELECT a.id,a.name,a.usuario,a.rol FROM admin_sessions s JOIN admins a ON a.id=s.admin_id
         WHERE s.token=? AND s.expires_at>NOW() AND a.activo=1 LIMIT 1`,
        [token]
      );
      if (!adminRows.length) return res.status(401).json({ error: "Sesion administrativa invalida" });
      req.isAdmin = true;
      req.admin = adminRows[0];
      req.userId = null;
      req.token = token;
      return next();
    }

    // 🔥 USER NORMAL
    req.isAdmin = false;

    // 🔍 BUSCAR SESIÓN
    const [rows] = await db.query(
      `SELECT * FROM sessions
       WHERE token=? AND expires>?
       LIMIT 1`,
      [token, Date.now()]
    );

    if (!rows.length) {

      return res.status(401).json({
        error: "Sesión inválida"
      });

    }

    const session = rows[0];

    console.log("AUTH SESSION:", session);

    // ✅ USER REAL
    req.userId = Number(session.userId);

    console.log("AUTH USER:", req.userId);

    if (!req.userId || isNaN(req.userId)) {

      return res.status(401).json({
        error: "User inválido"
      });

    }

    req.token = token;

    next();

  } catch (err) {

    console.error("AUTH ERROR:", err);

    res.status(500).json({
      error: "Auth error"
    });

  }
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

/* async function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");

  const expires = Date.now() + (1000 * 60 * 60);

  await db.query(
    "INSERT INTO sessions (token, userId, expires) VALUES (?, ?, ?)",
    [token, userId, expires]
  );

  return token;
}
 */

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
app.post("/admin-login", adminLoginLimiter, async (req, res) => {

  const usuario = String(req.body.usuario || "").trim();
  const password = String(req.body.password || req.body.pin || "");

  try {

    const [rows] = usuario
      ? await db.query("SELECT * FROM admins WHERE usuario=? AND activo=1 LIMIT 1", [usuario])
      : await db.query("SELECT * FROM admins WHERE pin=? AND activo=1 LIMIT 1", [password]);

    if (rows.length === 0) {
      return res.status(401).json({ ok: false, msg: "Credenciales incorrectas" });
    }

    const admin = rows[0];
    const validPassword = admin.password_hash && admin.password_salt
      ? crypto.timingSafeEqual(
          Buffer.from(admin.password_hash, "hex"),
          crypto.scryptSync(password, admin.password_salt, 64)
        )
      : password === admin.pin;
    if (!validPassword) return res.status(401).json({ ok: false, msg: "Credenciales incorrectas" });

    // 🔥 generar token
    const token = "admin-" + crypto.randomBytes(29).toString("hex");
    await db.query(
      `INSERT INTO admin_sessions(token,admin_id,expires_at)
       VALUES(?,?,DATE_ADD(NOW(),INTERVAL 8 HOUR))`,
      [token,admin.id]
    );

    res.json({
      ok: true,
      token,
      name: admin.name,
      role: admin.rol
    });

  } catch (err) {
    console.error("❌ ERROR admin-login:", err);
    res.status(500).json({ ok: false });
  }
});

app.get("/admin-overview",auth,async(req,res)=>{
  try {
    if(!req.isAdmin) return res.status(403).json({error:"No autorizado"});
    const [companies]=await db.query(`
      SELECT fa.id,e.id AS empresa_id,fa.folio,fa.fecha_emision,fa.empresa AS empresa_autorizada,
             fa.estatus,fa.caducidad,e.nombre,e.razon_social,e.representante_legal,
             e.telefono_1,e.telefono_2,e.correo_1,e.correo_2,e.direccion,e.descripcion,
             e.creado_en,ce.usuario,COUNT(DISTINCT pc.id) AS colaboradores,
             SUM(CASE WHEN u.aprobado=1 THEN 1 ELSE 0 END) AS aprobados,
             ROUND(AVG(COALESCE(pg.progreso,0)),1) AS progreso_promedio
      FROM folios_acceso fa LEFT JOIN empresas e ON e.folio_acceso_id=fa.id
      LEFT JOIN cuentas_empresa ce ON ce.empresa_id=e.id
      LEFT JOIN personas_curso pc ON pc.empresa_id=e.id LEFT JOIN users u ON u.id=pc.user_id
      LEFT JOIN (SELECT userId,LEAST(100,SUM(progress)/2) AS progreso FROM video_progress GROUP BY userId) pg ON pg.userId=u.id
      GROUP BY fa.id,e.id,ce.id ORDER BY fa.creado_en DESC`);
    const [people]=await db.query(`
      SELECT pc.id,pc.empresa_id,pc.folio,pc.nombres,pc.apellido_paterno,pc.apellido_materno,
             pc.puesto,pc.telefono,pc.correo,pc.estatus,e.nombre AS empresa,
             COALESCE(u.exam,0) AS calificacion,COALESCE(u.intentos,0) AS intentos,
             COALESCE(u.aprobado,0) AS aprobado,u.photo,u.foto_registrada_en,u.foto_estatus,u.foto_motivo_rechazo,u.fecha AS fecha_aprobacion,
             ROUND(COALESCE(pg.progreso,0),1) AS progreso,pc.creado_en
      FROM personas_curso pc JOIN empresas e ON e.id=pc.empresa_id
      LEFT JOIN users u ON u.id=pc.user_id
      LEFT JOIN (SELECT userId,LEAST(100,SUM(progress)/2) AS progreso FROM video_progress GROUP BY userId) pg ON pg.userId=u.id
      ORDER BY pc.creado_en DESC`);
    const stats={
      empresas:companies.length,
      empresasActivas:companies.filter(c=>c.estatus==="USADO").length,
      colaboradores:people.length,
      aprobados:people.filter(p=>p.aprobado).length,
      reprobados:people.filter(p=>!p.aprobado&&Number(p.intentos)>0).length,
      progresoPromedio:people.length?Math.round(people.reduce((s,p)=>s+Number(p.progreso||0),0)/people.length):0
    };
    return res.json({ok:true,admin:req.admin,stats,companies,people});
  }catch(err){console.error("ADMIN OVERVIEW ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible cargar la administracion"});}
});

app.post("/admin-tokens",auth,async(req,res)=>{
  let connection;
  try{
    if(!req.isAdmin||req.admin.rol!=="SUPERADMIN") return res.status(403).json({ok:false,error:"Solo el administrador principal puede generar tokens"});
    const caducidad=String(req.body.caducidad||"").trim();
    const cantidad=Math.min(50,Math.max(1,Number(req.body.cantidad)||1));
    const expiry=new Date(caducidad);
    if(!caducidad||Number.isNaN(expiry.getTime())||expiry.getTime()<=Date.now()) {
      return res.status(400).json({ok:false,error:"Selecciona una fecha de caducidad futura"});
    }
    connection=await db.getConnection();
    await connection.beginTransaction();
    const tokens=[];
    for(let i=0;i<cantidad;i++){
      const folio="TIA-E-"+crypto.randomBytes(6).toString("hex").toUpperCase();
      const [result]=await connection.query(
        `INSERT INTO folios_acceso(folio,fecha_emision,empresa,estatus,caducidad)
         VALUES(?,NOW(),'','ACTIVO',?)`,[folio,expiry]
      );
      tokens.push({id:result.insertId,token:folio,caducidad:expiry});
    }
    await connection.commit();
    return res.status(201).json({ok:true,tokens});
  }catch(err){
    if(connection)await connection.rollback();
    console.error("ADMIN TOKEN ERROR:",err);
    return res.status(500).json({ok:false,error:"No fue posible generar los tokens"});
  }finally{if(connection)connection.release()}
});

app.patch("/admin-tokens/:id/status",auth,async(req,res)=>{
  try{
    if(!req.isAdmin||req.admin.rol!=="SUPERADMIN")return res.status(403).json({ok:false,error:"Solo el administrador principal puede modificar tokens"});
    const status=String(req.body.estatus||"").toUpperCase();
    if(!["ACTIVO","SUSPENDIDO"].includes(status))return res.status(400).json({ok:false,error:"Estado invalido"});
    const [result]=await db.query(
      `UPDATE folios_acceso SET estatus=?
       WHERE id=? AND estatus IN ('ACTIVO','SUSPENDIDO')`,[status,Number(req.params.id)]
    );
    if(!result.affectedRows)return res.status(409).json({ok:false,error:"Solo pueden modificarse tokens pendientes o suspendidos"});
    return res.json({ok:true});
  }catch(err){console.error("ADMIN TOKEN STATUS ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible actualizar el token"})}
});

app.get("/admin-users",auth,async(req,res)=>{
  try{
    if(!req.isAdmin||req.admin.rol!=="SUPERADMIN")return res.status(403).json({ok:false,error:"No autorizado"});
    const [users]=await db.query("SELECT id,name,usuario,rol,activo,creado_en FROM admins ORDER BY creado_en DESC");
    return res.json({ok:true,users});
  }catch(err){console.error("ADMIN USERS ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible cargar los usuarios"})}
});

app.post("/admin-users",auth,async(req,res)=>{
  try{
    if(!req.isAdmin||req.admin.rol!=="SUPERADMIN")return res.status(403).json({ok:false,error:"No autorizado"});
    const name=String(req.body.name||"").trim();
    const usuario=String(req.body.usuario||"").trim().toLowerCase();
    const password=String(req.body.password||"");
    if(name.length<3||!/^[-_.a-z0-9]{4,40}$/.test(usuario)||password.length<8){
      return res.status(400).json({ok:false,error:"Captura nombre, usuario de 4 caracteres y contraseña de al menos 8 caracteres"});
    }
    const salt=crypto.randomBytes(16).toString("hex");
    const passwordHash=crypto.scryptSync(password,salt,64).toString("hex");
    const [result]=await db.query(
      `INSERT INTO admins(name,usuario,pin,password_hash,password_salt,rol,activo)
       VALUES(?,?,NULL,?,?,'GESTOR',1)`,[name,usuario,passwordHash,salt]
    );
    return res.status(201).json({ok:true,id:result.insertId});
  }catch(err){
    if(err.code==="ER_DUP_ENTRY")return res.status(409).json({ok:false,error:"Ese nombre de usuario ya existe"});
    console.error("ADMIN USER CREATE ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible crear el usuario"});
  }
});

app.patch("/admin-users/:id/status",auth,async(req,res)=>{
  try{
    if(!req.isAdmin||req.admin.rol!=="SUPERADMIN")return res.status(403).json({ok:false,error:"No autorizado"});
    const activo=req.body.activo?1:0,id=Number(req.params.id);
    if(id===Number(req.admin.id))return res.status(409).json({ok:false,error:"No puedes desactivar tu propia cuenta"});
    const [result]=await db.query("UPDATE admins SET activo=? WHERE id=? AND rol='GESTOR'",[activo,id]);
    if(!result.affectedRows)return res.status(404).json({ok:false,error:"Usuario de gestión no encontrado"});
    if(!activo)await db.query("DELETE FROM admin_sessions WHERE admin_id=?",[id]);
    return res.json({ok:true});
  }catch(err){console.error("ADMIN USER STATUS ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible actualizar el usuario"})}
});

app.get("/admin-personas/:id/constancia",auth,async(req,res)=>{
  try{
    if(!req.isAdmin) return res.status(403).json({error:"No autorizado"});
    const [rows]=await db.query(`SELECT pc.folio,pc.nombres,pc.apellido_paterno,pc.apellido_materno,e.nombre AS empresa,u.exam,u.fecha,u.aprobado,u.photo,u.foto_estatus FROM personas_curso pc JOIN empresas e ON e.id=pc.empresa_id JOIN users u ON u.id=pc.user_id WHERE pc.id=? LIMIT 1`,[Number(req.params.id)]);
    const person=rows[0];
    if(!person) return res.status(404).json({error:"Persona no encontrada"});
    if(!person.aprobado||!person.photo||person.foto_estatus!=="APROBADA") return res.status(403).json({error:"Constancia pendiente de aprobación de fotografía"});
    await generateCertificatePdf(req,res,person,"attachment");
  }catch(err){console.error("ADMIN CERT ERROR:",err);if(!res.headersSent)return res.status(500).json({error:"No fue posible generar la constancia"});res.end();}
});

app.get("/admin-personas/:id/fotografia",auth,async(req,res)=>{
  try{
    if(!req.isAdmin)return res.status(403).json({error:"No autorizado"});
    const [rows]=await db.query(
      `SELECT pc.folio,u.photo,u.photo_data,u.photo_mime,u.aprobado,u.foto_estatus
       FROM personas_curso pc JOIN users u ON u.id=pc.user_id
       WHERE pc.id=? LIMIT 1`,[Number(req.params.id)]
    );
    const person=rows[0];
    if(!person||!person.aprobado||!person.photo||!['PENDIENTE','APROBADA'].includes(person.foto_estatus))return res.status(404).json({error:"Fotografía no disponible"});
    const filename=`fotografia-${String(person.folio).replace(/[^a-z0-9_-]/gi,"_")}.jpg`;
    if(person.photo_data){
      res.setHeader("Content-Type",person.photo_mime||"image/jpeg");
      res.setHeader("Content-Disposition",`${req.query.preview==="1"?"inline":"attachment"}; filename="${filename}"`);
      return res.send(person.photo_data);
    }
    const uploadsRoot=path.resolve(__dirname,"uploads"),photoPath=path.resolve(__dirname,person.photo);
    if(!photoPath.startsWith(uploadsRoot+path.sep)||!fs.existsSync(photoPath))return res.status(404).json({error:"Archivo de fotografía no encontrado"});
    if(req.query.preview==="1")return res.sendFile(photoPath,{headers:{"Content-Type":"image/jpeg","Content-Disposition":`inline; filename="${filename}"`}});
    return res.download(photoPath,filename);
  }catch(err){console.error("ADMIN PHOTO ERROR:",err);if(!res.headersSent)return res.status(500).json({error:"No fue posible descargar la fotografía"})}
});

app.patch("/admin-personas/:id/fotografia",auth,async(req,res)=>{
  let connection;
  try{
    if(!req.isAdmin)return res.status(403).json({ok:false,error:"No autorizado"});
    const decision=String(req.body.decision||"").toUpperCase();
    const motivo=String(req.body.motivo||"").trim();
    if(!["ACEPTAR","RECHAZAR"].includes(decision))return res.status(400).json({ok:false,error:"Decisión inválida"});
    if(decision==="RECHAZAR"&&motivo.length<5)return res.status(400).json({ok:false,error:"Indica el motivo del rechazo"});
    connection=await db.getConnection();await connection.beginTransaction();
    const [rows]=await connection.query(
      `SELECT pc.id,pc.folio,pc.nombres,pc.apellido_paterno,pc.apellido_materno,
              u.id AS user_id,u.photo,u.photo_data,u.foto_estatus,e.nombre AS empresa,e.correo_1
       FROM personas_curso pc JOIN users u ON u.id=pc.user_id JOIN empresas e ON e.id=pc.empresa_id
       WHERE pc.id=? FOR UPDATE`,[Number(req.params.id)]
    );
    const person=rows[0];
    if(!person||!person.photo||person.foto_estatus!=="PENDIENTE"){
      await connection.rollback();return res.status(409).json({ok:false,error:"La fotografía ya no está pendiente de revisión"});
    }
    if(decision==="ACEPTAR"){
      await connection.query(
        "UPDATE users SET foto_estatus='APROBADA',foto_revisada_en=NOW(),foto_revisada_por=?,foto_motivo_rechazo=NULL WHERE id=?",
        [req.admin.id,person.user_id]
      );
      await connection.commit();
      return res.json({ok:true,decision:"APROBADA"});
    }
    await connection.query(
      "UPDATE users SET photo=NULL,photo_data=NULL,photo_mime=NULL,foto_estatus='RECHAZADA',foto_revisada_en=NOW(),foto_revisada_por=?,foto_motivo_rechazo=? WHERE id=?",
      [req.admin.id,motivo,person.user_id]
    );
    await connection.commit();
    if(person.photo&&person.photo!=="DB"){
      const oldPhoto=path.resolve(__dirname,person.photo),uploadsRoot=path.resolve(__dirname,"uploads");
      if(oldPhoto.startsWith(uploadsRoot+path.sep))fs.unlink(oldPhoto,()=>{});
    }
    const nombre=[person.nombres,person.apellido_paterno,person.apellido_materno].filter(Boolean).join(" ");
    const subject=`Fotografía rechazada - ${nombre}`;
    let emailSent=false,emailError="";
    try{
      const transporter=createMailTransport();
      if(!transporter)throw new Error("SMTP no configurado");
      await transporter.sendMail({
        from:process.env.MAIL_FROM||process.env.SMTP_USER,
        to:person.correo_1,
        subject,
        text:`La fotografía de ${nombre}, folio ${person.folio}, fue rechazada. Motivo: ${motivo}. El colaborador debe ingresar nuevamente al módulo TIA y tomarse una nueva fotografía.`,
        html:`<p>La fotografía del colaborador <strong>${nombre}</strong>, folio <strong>${person.folio}</strong>, fue rechazada.</p><p><strong>Motivo:</strong> ${motivo.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}</p><p>El colaborador debe ingresar nuevamente al módulo TIA con su folio y tomarse una nueva fotografía.</p>`
      });
      emailSent=true;
    }catch(mailErr){emailError=mailErr.message;console.error("PHOTO REJECTION EMAIL ERROR:",mailErr.message)}
    await db.query(
      `INSERT INTO notificaciones_correo(tipo,destinatario,asunto,persona_id,estatus,detalle)
       VALUES('FOTO_RECHAZADA',?,?,?,?,?)`,
      [person.correo_1,subject,person.id,emailSent?"ENVIADO":"ERROR",emailSent?"Notificación enviada":emailError]
    );
    return res.json({ok:true,decision:"RECHAZADA",emailSent,email:person.correo_1,warning:emailSent?null:"La fotografía fue rechazada, pero el correo no pudo enviarse: "+emailError});
  }catch(err){if(connection)await connection.rollback();console.error("PHOTO REVIEW ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible revisar la fotografía"})}
  finally{if(connection)connection.release()}
});


// ACCESO DE USUARIO MEDIANTE FOLIO PREVIAMENTE REGISTRADO
app.post("/folio-login", accessLoginLimiter, async (req, res) => {
  try {
    const folio = String(req.body.folio || "").trim().toUpperCase();
    if (!folio) return res.status(400).json({ ok: false, message: "El folio es requerido" });

    // El folio estable de la persona vive en personas_curso y nunca cambia.
    const [registeredPeople] = await db.query(
      `SELECT u.id,u.name,pc.folio,u.aprobado,u.photo,u.foto_registrada_en,u.foto_estatus
       FROM personas_curso pc JOIN users u ON u.id=pc.user_id
       WHERE UPPER(pc.folio)=? LIMIT 1`,
      [folio]
    );
    if (registeredPeople.length && registeredPeople[0].aprobado && registeredPeople[0].photo && registeredPeople[0].foto_estatus==="APROBADA") {
      return res.status(403).json({
        ok: false,
        completed: true,
        message: "Este colaborador ya concluyó el curso y registró su fotografía. Su constancia está disponible con la empresa."
      });
    }

    // Los folios personales activos entran directamente al curso.
    const [people] = await db.query(
      `SELECT u.id,u.name,pc.folio,u.aprobado,u.photo,u.foto_estatus
       FROM personas_curso pc JOIN users u ON u.id=pc.user_id
       WHERE UPPER(pc.folio)=? LIMIT 1`,
      [folio]
    );
    if (people.length) {
      const user = people[0];
      const token = crypto.randomBytes(32).toString("hex");
      await db.query(
        "INSERT INTO sessions (token, userId, expires) VALUES (?, ?, ?)",
        [token, user.id, Date.now() + 86400000]
      );
      return res.json({ ok: true, persona: true, pendingPhoto:!!user.aprobado&&user.foto_estatus!=="APROBADA", token, userId: user.id, folio: user.folio });
    }

    const [rows] = await db.query(
      `SELECT fa.id, fa.folio, fa.empresa, fa.estatus, fa.caducidad,
              e.id AS empresa_id, ce.id AS cuenta_id
       FROM folios_acceso fa
       LEFT JOIN empresas e ON e.folio_acceso_id=fa.id
       LEFT JOIN cuentas_empresa ce ON ce.empresa_id=e.id
       WHERE UPPER(fa.folio) = ?
       LIMIT 1`,
      [folio]
    );
    if (!rows.length) return res.status(401).json({ ok: false, message: "Folio no encontrado" });

    const acceso = rows[0];
    if (acceso.estatus === "USADO" && acceso.cuenta_id) {
      return res.json({ ok: true, requiereCredenciales: true, folio: acceso.folio });
    }
    if (acceso.estatus === "CONFIGURANDO" && acceso.empresa_id && !acceso.cuenta_id) {
      const token = crypto.randomBytes(32).toString("hex");
      await db.query(
        `INSERT INTO sesiones_empresa (token, empresa_id, proposito, expira_en)
         VALUES (?, ?, 'CONFIGURAR_CUENTA', DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
        [token, acceso.empresa_id]
      );
      return res.json({ ok: true, configurarCuenta: true, token, folio: acceso.folio });
    }
    if (acceso.estatus !== "ACTIVO") {
      return res.status(403).json({ ok: false, message: "Este folio no se encuentra activo" });
    }
    if (new Date(acceso.caducidad).getTime() < Date.now()) {
      await db.query("UPDATE folios_acceso SET estatus='VENCIDO' WHERE id=?", [acceso.id]);
      return res.status(403).json({ ok: false, message: "Este folio ha caducado" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    await db.query(
      `INSERT INTO sesiones_registro_empresa (token, folio_acceso_id, expira_en)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      [token, acceso.id]
    );

    return res.json({
      ok: true,
      token,
      folio: acceso.folio,
      empresa: acceso.empresa
    });
  } catch (err) {
    console.error("ERROR folio-login:", err);
    return res.status(500).json({ ok: false, message: "No fue posible iniciar sesion" });
  }
});

app.post("/registro-empresa", async (req, res) => {
  let connection;

  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return res.status(401).json({ ok: false, message: "Sesion de registro requerida" });

    const fields = [
      "nombre", "razonSocial", "representanteLegal", "telefono1", "telefono2",
      "correo1", "correo2", "direccion", "descripcion"
    ];
    const values = Object.fromEntries(
      fields.map(field => [field, String(req.body[field] || "").trim()])
    );
    if (fields.some(field => !values[field])) {
      return res.status(400).json({ ok: false, message: "Todos los campos son obligatorios" });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(values.correo1) || !emailPattern.test(values.correo2)) {
      return res.status(400).json({ ok: false, message: "Revisa los correos electronicos" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [sessions] = await connection.query(
      `SELECT folio_acceso_id
       FROM sesiones_registro_empresa
       WHERE token=? AND usado_en IS NULL AND expira_en > NOW()
       FOR UPDATE`,
      [token]
    );
    if (!sessions.length) {
      await connection.rollback();
      return res.status(401).json({ ok: false, message: "La sesion expiro; valida nuevamente tu folio" });
    }

    const folioId = sessions[0].folio_acceso_id;
    const [empresaResult] = await connection.query(
      `INSERT INTO empresas
       (folio_acceso_id, nombre, razon_social, representante_legal, telefono_1,
        telefono_2, correo_1, correo_2, direccion, descripcion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [folioId, values.nombre, values.razonSocial, values.representanteLegal,
        values.telefono1, values.telefono2, values.correo1, values.correo2,
        values.direccion, values.descripcion]
    );
    const setupToken = crypto.randomBytes(32).toString("hex");
    await connection.query(
      `INSERT INTO sesiones_empresa (token, empresa_id, proposito, expira_en)
       VALUES (?, ?, 'CONFIGURAR_CUENTA', DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      [setupToken, empresaResult.insertId]
    );
    await connection.query(
      "UPDATE folios_acceso SET empresa=?, estatus='CONFIGURANDO' WHERE id=?",
      [values.nombre, folioId]
    );
    await connection.query("UPDATE sesiones_registro_empresa SET usado_en=NOW() WHERE token=?", [token]);
    await connection.commit();

    return res.json({ ok: true, setupToken });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("ERROR registro-empresa:", err);
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ ok: false, message: "Este folio ya registro una empresa" });
    }
    return res.status(500).json({ ok: false, message: "No fue posible guardar la empresa" });
  } finally {
    if (connection) connection.release();
  }
});

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

app.post("/configurar-cuenta", async (req, res) => {
  let connection;
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const usuario = String(req.body.usuario || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!token) return res.status(401).json({ ok: false, message: "Sesion requerida" });
    if (!/^[a-z0-9._-]{4,80}$/.test(usuario)) {
      return res.status(400).json({ ok: false, message: "El usuario debe tener al menos 4 caracteres y usar letras, numeros, punto, guion o guion bajo" });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, message: "La contrasena debe tener al menos 8 caracteres" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [sessions] = await connection.query(
      `SELECT empresa_id FROM sesiones_empresa
       WHERE token=? AND proposito='CONFIGURAR_CUENTA' AND usado_en IS NULL AND expira_en>NOW()
       FOR UPDATE`, [token]
    );
    if (!sessions.length) {
      await connection.rollback();
      return res.status(401).json({ ok: false, message: "La sesion expiro; ingresa nuevamente el folio" });
    }

    const empresaId = sessions[0].empresa_id;
    const salt = crypto.randomBytes(16).toString("hex");
    await connection.query(
      `INSERT INTO cuentas_empresa (empresa_id, usuario, password_hash, password_salt)
       VALUES (?, ?, ?, ?)`,
      [empresaId, usuario, hashPassword(password, salt), salt]
    );
    await connection.query("UPDATE sesiones_empresa SET usado_en=NOW() WHERE token=?", [token]);
    await connection.query(
      `UPDATE folios_acceso fa JOIN empresas e ON e.folio_acceso_id=fa.id
       SET fa.estatus='USADO' WHERE e.id=?`, [empresaId]
    );
    const personaToken = crypto.randomBytes(32).toString("hex");
    await connection.query(
      `INSERT INTO sesiones_empresa (token, empresa_id, proposito, expira_en)
       VALUES (?, ?, 'GESTIONAR_PERSONAS', DATE_ADD(NOW(), INTERVAL 8 HOUR))`,
      [personaToken, empresaId]
    );
    await connection.commit();
    return res.json({ ok: true, gestionToken: personaToken });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("ERROR configurar-cuenta:", err);
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ ok: false, message: "El nombre de usuario ya existe" });
    return res.status(500).json({ ok: false, message: "No fue posible crear la cuenta" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/login-empresa", accessLoginLimiter, async (req, res) => {
  try {
    const folio = String(req.body.folio || "").trim().toUpperCase();
    const usuario = String(req.body.usuario || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const [rows] = await db.query(
      `SELECT e.id AS empresa_id, ce.password_hash, ce.password_salt, ce.activo
       FROM folios_acceso fa JOIN empresas e ON e.folio_acceso_id=fa.id
       JOIN cuentas_empresa ce ON ce.empresa_id=e.id
       WHERE UPPER(fa.folio)=? AND ce.usuario=? AND fa.estatus='USADO' LIMIT 1`,
      [folio, usuario]
    );
    const account = rows[0];
    if (!account || !account.activo) return res.status(401).json({ ok: false, message: "Credenciales incorrectas" });
    const actual = Buffer.from(hashPassword(password, account.password_salt), "hex");
    const expected = Buffer.from(account.password_hash, "hex");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      return res.status(401).json({ ok: false, message: "Credenciales incorrectas" });
    }
    const token = crypto.randomBytes(32).toString("hex");
    await db.query(
      `INSERT INTO sesiones_empresa (token, empresa_id, proposito, expira_en)
       VALUES (?, ?, 'GESTIONAR_PERSONAS', DATE_ADD(NOW(), INTERVAL 8 HOUR))`,
      [token, account.empresa_id]
    );
    return res.json({ ok: true, token });
  } catch (err) {
    console.error("ERROR login-empresa:", err);
    return res.status(500).json({ ok: false, message: "No fue posible iniciar sesion" });
  }
});

app.post("/registro-persona", async (req, res) => {
  let connection;
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const fields = ["nombres", "apellidoPaterno", "puesto", "telefono", "correo"];
    const data = Object.fromEntries(fields.map(f => [f, String(req.body[f] || "").trim()]));
    data.apellidoMaterno = String(req.body.apellidoMaterno || "").trim();
    if (!token) return res.status(401).json({ ok: false, message: "Sesion requerida" });
    if (fields.some(f => !data[f])) return res.status(400).json({ ok: false, message: "Completa todos los campos obligatorios" });

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [sessions] = await connection.query(
      `SELECT se.empresa_id, e.nombre AS empresa
       FROM sesiones_empresa se JOIN empresas e ON e.id=se.empresa_id
       WHERE se.token=? AND se.proposito='GESTIONAR_PERSONAS' AND se.usado_en IS NULL AND se.expira_en>NOW()
       FOR UPDATE`, [token]
    );
    if (!sessions.length) {
      await connection.rollback();
      return res.status(401).json({ ok: false, message: "La sesion expiro" });
    }
    const personFolio = "TIA-P-" + crypto.randomBytes(5).toString("hex").toUpperCase();
    const fullName = [data.nombres, data.apellidoPaterno, data.apellidoMaterno].filter(Boolean).join(" ");
    const [userResult] = await connection.query(
      `INSERT INTO users (name, company, puesto, telefono, correo, folio, loginTime)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [fullName, sessions[0].empresa, data.puesto, data.telefono, data.correo, personFolio]
    );
    const [result] = await connection.query(
      `INSERT INTO personas_curso
       (empresa_id,folio,user_id,nombres,apellido_paterno,apellido_materno,puesto,telefono,correo)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [sessions[0].empresa_id, personFolio, userResult.insertId, data.nombres,
        data.apellidoPaterno, data.apellidoMaterno || null, data.puesto, data.telefono, data.correo]
    );
    await connection.commit();
    return res.json({ ok: true, personaId: result.insertId, folio: personFolio });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("ERROR registro-persona:", err);
    return res.status(500).json({ ok: false, message: "No fue posible guardar a la persona" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/empresa-personas", async (req, res) => {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const [sessions] = await db.query(
      `SELECT se.empresa_id, e.nombre AS empresa
       FROM sesiones_empresa se JOIN empresas e ON e.id=se.empresa_id
       WHERE se.token=? AND se.proposito='GESTIONAR_PERSONAS'
         AND se.usado_en IS NULL AND se.expira_en>NOW() LIMIT 1`,
      [token]
    );
    if (!sessions.length) return res.status(401).json({ ok: false, message: "Sesion expirada" });
    const [people] = await db.query(
      `SELECT pc.id, pc.folio, pc.nombres, pc.apellido_paterno, pc.apellido_materno,
              pc.puesto, pc.telefono, pc.correo, pc.estatus, pc.creado_en,
              COALESCE(u.aprobado,0) AS aprobado, u.photo, u.foto_registrada_en,u.foto_estatus,u.foto_motivo_rechazo, COALESCE(u.exam,0) AS calificacion,
              u.fecha AS fecha_aprobacion,
              LEAST(100,COALESCE(SUM(vp.progress),0)/2) AS progreso
       FROM personas_curso pc
       LEFT JOIN users u ON u.id=pc.user_id
       LEFT JOIN video_progress vp ON vp.userId=u.id
       WHERE pc.empresa_id=?
       GROUP BY pc.id,u.id ORDER BY pc.creado_en DESC`,
      [sessions[0].empresa_id]
    );
    return res.json({ ok: true, empresa: sessions[0].empresa, personas: people });
  } catch (err) {
    console.error("ERROR empresa-personas:", err);
    return res.status(500).json({ ok: false, message: "No fue posible consultar las personas" });
  }
});

async function generateCertificatePdf(req,res,person,disposition="attachment") {
  const name=[person.nombres,person.apellido_paterno,person.apellido_materno].filter(Boolean).join(" ");
  const filename=String(person.folio).replace(/[^a-z0-9_-]/gi,"_");
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",`${disposition}; filename="constancia-${filename}.pdf"`);
  const doc=new PDFDocument({size:[900,600],margin:0});
  doc.pipe(res);
  const background=__dirname+"/public/assets/fondo-certificado.png";
  const logo=__dirname+"/public/assets/logo-gap.png";
  if(fs.existsSync(background)) doc.image(background,0,0,{width:900,height:600});
  if(fs.existsSync(logo)) doc.image(logo,62,42,{fit:[76,62],align:"center",valign:"center"});
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#a87524").text("SISTEMA DE CAPACITACION AEROPORTUARIA",150,50,{width:500,align:"center",characterSpacing:1.4});
  doc.fontSize(27).fillColor("#082f49").text("CONSTANCIA DE ACREDITACION",120,86,{width:560,align:"center"});
  doc.moveTo(210,123).lineTo(590,123).lineWidth(1.5).stroke("#c6923b");
  doc.font("Helvetica").fontSize(12).fillColor("#475569").text("Se hace constar que",120,148,{width:560,align:"center"});
  doc.font("Helvetica-Bold").fontSize(name.length>38?20:24).fillColor("#0f3d5e").text(name.toUpperCase(),95,178,{width:610,align:"center"});
  doc.font("Helvetica").fontSize(12).fillColor("#475569").text(`Colaborador(a) de ${person.empresa}`,120,218,{width:560,align:"center"});
  doc.font("Helvetica").fontSize(14).fillColor("#1e293b").text("acredito satisfactoriamente el",120,258,{width:560,align:"center"});
  doc.font("Helvetica-Bold").fontSize(22).fillColor("#8a5b13").text("CURSO DE SEGURIDAD AEROPORTUARIA",95,286,{width:610,align:"center"});
  doc.font("Helvetica").fontSize(11).fillColor("#475569").text("Formacion orientada a la cultura de seguridad, control de accesos, prevencion de riesgos y cumplimiento de los procedimientos operativos aplicables en instalaciones aeroportuarias.",125,330,{width:550,align:"center",lineGap:3});
  doc.roundedRect(145,405,500,55,6).fillAndStroke("#f8fafc","#d4a64f");
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f3d5e").text(`FOLIO  ${person.folio}`,160,420,{width:155,align:"center"}).text(`RESULTADO  ${Number(person.exam).toFixed(0)}%`,320,420,{width:145,align:"center"}).text(`FECHA  ${person.fecha?new Date(person.fecha).toLocaleDateString("es-MX"):"--"}`,470,420,{width:160,align:"center"});
  doc.moveTo(245,510).lineTo(545,510).lineWidth(1).stroke("#64748b");
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#334155").text("COORDINACION DE SEGURIDAD AEROPORTUARIA",195,518,{width:400,align:"center"});
  doc.font("Helvetica").fontSize(8).fillColor("#64748b").text("Documento emitido electronicamente por el Sistema TIA",195,535,{width:400,align:"center"});
  const verifyUrl=`${req.protocol}://${req.get("host")}/validar.html?folio=${encodeURIComponent(person.folio)}`;
  const qrData=await QRCode.toDataURL(verifyUrl,{margin:1,width:280,color:{dark:"#082f49",light:"#ffffff"}});
  doc.image(Buffer.from(qrData.split(",")[1],"base64"),752,235,{width:108,height:108});
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#d6aa55").text(person.folio,744,354,{width:125,align:"center"});
  doc.end();
}

app.get("/empresa-personas/:id/constancia", async (req, res) => {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const [rows] = await db.query(
      `SELECT pc.folio,pc.nombres,pc.apellido_paterno,pc.apellido_materno,
              e.nombre AS empresa,u.exam,u.fecha,u.aprobado,u.photo,u.foto_estatus
       FROM sesiones_empresa se JOIN empresas e ON e.id=se.empresa_id
       JOIN personas_curso pc ON pc.empresa_id=e.id JOIN users u ON u.id=pc.user_id
       WHERE se.token=? AND se.proposito='GESTIONAR_PERSONAS'
         AND se.usado_en IS NULL AND se.expira_en>NOW() AND pc.id=? LIMIT 1`,
      [token, Number(req.params.id)]
    );
    const person = rows[0];
    if (!person) return res.status(404).json({ ok:false, message:"Persona no encontrada" });
    if (!person.aprobado || !person.photo || person.foto_estatus!=="APROBADA") return res.status(403).json({ ok:false, message:"La constancia estará disponible después de aprobar la fotografía" });
    await generateCertificatePdf(req,res,person,"attachment");
  } catch(err) {
    console.error("ERROR descargar-constancia:",err);
    if(!res.headersSent) return res.status(500).json({ok:false,message:"No fue posible generar la constancia"});
    res.end();
  }
});

app.get("/mi-constancia",auth,async(req,res)=>{
  try {
    const [rows]=await db.query(
      `SELECT pc.folio,pc.nombres,pc.apellido_paterno,pc.apellido_materno,
              e.nombre AS empresa,u.exam,u.fecha,u.aprobado,u.photo,u.foto_estatus
       FROM personas_curso pc JOIN empresas e ON e.id=pc.empresa_id
       JOIN users u ON u.id=pc.user_id WHERE u.id=? LIMIT 1`,[req.userId]
    );
    const person=rows[0];
    if(!person) return res.status(404).json({ok:false,message:"Persona no encontrada"});
    if(!person.aprobado) return res.status(403).json({ok:false,message:"Aún no has aprobado el curso"});
    if(!person.photo||person.foto_estatus!=="APROBADA") return res.status(403).json({ok:false,message:"Tu fotografía debe ser aprobada antes de consultar la constancia"});
    await generateCertificatePdf(req,res,person,"inline");
  } catch(err) {
    console.error("ERROR mi-constancia:",err);
    if(!res.headersSent) return res.status(500).json({ok:false,message:"No fue posible generar la constancia"});
    res.end();
  }
});

app.get("/verificar-constancia", async (req,res) => {
  try {
    const folio = String(req.query.folio || "").trim().toUpperCase();
    const [rows] = await db.query(
      `SELECT pc.folio,pc.nombres,pc.apellido_paterno,pc.apellido_materno,
              e.nombre AS empresa,u.exam,u.fecha,u.aprobado,u.photo,u.foto_estatus
       FROM personas_curso pc JOIN empresas e ON e.id=pc.empresa_id
       JOIN users u ON u.id=pc.user_id WHERE UPPER(pc.folio)=? LIMIT 1`,[folio]
    );
    const p=rows[0];
    if(!p || !p.aprobado || !p.photo || p.foto_estatus!=="APROBADA") return res.status(404).json({ok:false,message:"Constancia no encontrada"});
    return res.json({ok:true,constancia:{folio:p.folio,nombre:[p.nombres,p.apellido_paterno,p.apellido_materno].filter(Boolean).join(" "),empresa:p.empresa,calificacion:Number(p.exam),fecha:p.fecha}});
  } catch(err) {
    console.error("ERROR verificar-constancia:",err);
    return res.status(500).json({ok:false,message:"No fue posible verificar la constancia"});
  }
});


app.post("/log-login", async (req, res) => {

  try {

    const { name, company } = req.body;

    // 🔍 BUSCAR USUARIO
    const [rows] = await db.query(
      `SELECT * FROM users
       WHERE name=? AND company=?
       ORDER BY id DESC
       LIMIT 1`,
      [name, company]
    );

    let user;

    if (rows.length === 0) {

      // 🔥 CREAR USUARIO
      const [result] = await db.query(
        `INSERT INTO users
        (name, company)
        VALUES (?, ?)`,
        [name, company]
      );

      user = {
        id: result.insertId,
        folio: "SIN-FOLIO"
      };

    } else {

      user = rows[0];

    }

    // ✅ FORZAR NÚMERO
    const userId = Number(user.id);

    console.log("LOGIN USER:", userId);

    // 🚨 VALIDAR
    if (!userId || isNaN(userId)) {

      return res.status(500).json({
        error: "UserId inválido"
      });

    }

    // 🔥 TOKEN
    const token = crypto
      .randomBytes(32)
      .toString("hex");

    // 🔥 EXPIRACIÓN
    const expires = Date.now() + 86400000;

    // 💾 SESIÓN
    await db.query(
      `INSERT INTO sessions
      (token, userId, expires)
      VALUES (?, ?, ?)`,
      [token, userId, expires]
    );

    // ✅ RESPUESTA
    res.json({
      ok: true,
      token,
      folio: user.folio || ("TIA-" + userId)
    });

  } catch (err) {

    console.error("❌ ERROR log-login:", err);

    res.status(500).json({
      error: "Error login"
    });

  }

});


app.get("/video-progress", auth, async (req, res) => {

  console.log("📥 GET USER:", req.userId);

  const [rows] = await db.query(
    "SELECT videoIndex, progress, completed FROM video_progress WHERE userId=?",
    [req.userId]
  );

  /* console.log("📊 RESULTADOS BD:", rows); */

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

    if (![0, 1].includes(videoIndex)) {
      return res.status(400).json({ ok: false, error: "Video invalido" });
    }

    progress = Math.max(0, Math.min(progress, 100));
    const [savedRows] = await db.query(
      "SELECT progress FROM video_progress WHERE userId=? AND videoIndex=? LIMIT 1",
      [userId, videoIndex]
    );
    const savedProgress = Number(savedRows[0]?.progress || 0);
    const rateKey = `${userId}:${videoIndex}`;
    const now = Date.now();
    const lastUpdate = videoProgressRate.get(rateKey) || 0;

    const legitimateCompletion = progress === 100 && savedProgress > 95;
    if (!legitimateCompletion && now - lastUpdate < 3000 && progress > savedProgress) {
      return res.json({ ok: true, progress: savedProgress, limited: true });
    }

    progress = Math.min(progress, savedProgress + 5);
    const completed = progress > 95;
    if (progress > savedProgress) videoProgressRate.set(rateKey, now);

    console.log("💾 SAVE USER:", userId);

    await db.query(`
      INSERT INTO video_progress (userId, videoIndex, progress, completed)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        progress = GREATEST(progress, VALUES(progress)),
        completed = GREATEST(completed, VALUES(completed))
    `, [userId, videoIndex, progress, completed]);

    console.log("GUARDANDO PARA USER:", req.userId);

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ ERROR log-video:", err);
    res.status(500).json({ ok: false });
  }
});

// LOG EXAM SEGURO
// LOG EXAM SEGURO
app.post("/log-exam", auth, async (req, res) => {

  try {

    const QRCode = require("qrcode");

    const userId = req.userId;
    const examToken = String(req.body.examToken || "");
    const [examRows] = await db.query(
      `SELECT score,logged_at FROM exam_sessions
       WHERE token=? AND user_id=? AND submitted_at IS NOT NULL LIMIT 1`,
      [examToken,userId]
    );
    if(!examRows.length || examRows[0].logged_at) {
      return res.status(400).json({ok:false,error:"Resultado de examen invalido o ya registrado"});
    }
    const score = Number(examRows[0].score);
    await db.query("UPDATE exam_sessions SET logged_at=NOW() WHERE token=?",[examToken]);

    console.log("USER:", userId);
    console.log("SCORE:", score);

    const [rows] = await db.query(
      "SELECT * FROM users WHERE id=?",
      [userId]
    );

    const user = rows[0];

    if (!user) {

      return res.json({
        ok: false,
        error: "Usuario no encontrado"
      });

    }

    // 🔥 NUEVO INTENTO
    const intentoActual = (user.intentos || 0) + 1;

    // ✅ APROBADO
    if (score >= 80) {

      const folio = user.folio;

      const fecha = new Date();

      // ✅ URL VALIDACIÓN
      const publicBase=String(process.env.PUBLIC_URL||`${req.protocol}://${req.get("host")}`).replace(/\/$/,"");
      const urlValidacion=`${publicBase}/validar.html?folio=${encodeURIComponent(folio)}`;

      // ✅ QR
      const qr =
        await QRCode.toDataURL(urlValidacion);

      // ✅ GUARDAR
      await db.query(`
        UPDATE users
        SET
          exam=?,
          intentos=?,
          aprobado=1,
          folio=?,
          fecha=?,
          qr=?
        WHERE id=?
      `, [
        score,
        intentoActual,
        folio,
        fecha,
        qr,
        userId
      ]);
      await db.query("UPDATE personas_curso SET estatus='APROBADO' WHERE user_id=?", [userId]);

      console.log("APROBADO OK");

      return res.json({
        ok: true,
        aprobado: true,
        score,
        folio,
        qr
      });

    }

    // ❌ REPROBADO

    // 🔥 SI YA AGOTÓ LOS 3
    if (intentoActual >= 3) {

      console.log("REINICIANDO CURSO");

      // 🔥 RESET USER
      await db.query(`
        UPDATE users
        SET
          exam=0,
          intentos=0,
          aprobado=0,
          fecha=NULL,
          qr=NULL,
          video=0
        WHERE id=?
      `, [userId]);

      // 🔥 BORRAR VIDEOS
      await db.query(
        "DELETE FROM video_progress WHERE userId=?",
        [userId]
      );
      await db.query("UPDATE personas_curso SET estatus='REGISTRADO' WHERE user_id=?", [userId]);

      return res.json({
        ok: true,
        aprobado: false,
        blocked: true,
        score
      });

    }

    // 🔥 SOLO GUARDAR INTENTO
    await db.query(`
      UPDATE users
      SET
        exam=?,
        intentos=?,
        aprobado=0
      WHERE id=?
    `, [
      score,
      intentoActual,
      userId
    ]);
    await db.query("UPDATE personas_curso SET estatus='REPROBADO' WHERE user_id=?", [userId]);

    console.log("REPROBADO");

    return res.json({
      ok: true,
      aprobado: false,
      blocked: false,
      score,
      left: 3 - intentoActual
    });

  } catch (err) {

    console.error("ERROR REAL:", err);

    res.status(500).json({
      ok: false,
      error: err.message
    });

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

  try {

    if (!req.isAdmin) {

      return res.status(403).json({
        error: "No autorizado"
      });

    }

    const [users] = await db.query(`

      SELECT 
        u.id,
        u.name,
        u.folio,

        MAX(CASE WHEN vp.videoIndex = 0 
          THEN vp.progress ELSE 0 END) as video1,

        MAX(CASE WHEN vp.videoIndex = 1 
          THEN vp.progress ELSE 0 END) as video2

      FROM users u

      LEFT JOIN video_progress vp
      ON u.id = vp.userId

      GROUP BY u.id

    `);

    const formatted = users.map(u => {

      const v1 = Number(u.video1 || 0);
      const v2 = Number(u.video2 || 0);

      const total = (v1 + v2) / 2;

      return {

        ...u,

        video1: v1,
        video2: v2,
        progress: total

      };

    });

    // ✅ SOLO UNA RESPUESTA
    return res.json({

      users: formatted,

      activity: [
        "Usuario inició sesión",
        "Progreso guardado"
      ]

    });

  } catch (err) {

    console.error(
      "❌ ERROR admin-data:",
      err
    );

    return res.status(500).json({
      error: "Error servidor"
    });

  }

});


app.get("/me", auth, async (req, res) => {
  if (req.isAdmin) return res.status(403).json({ error: "Acceso no disponible" });
  const [rows] = await db.query(
    `SELECT id,name,company,puesto,telefono,correo,folio,exam,intentos,aprobado,fecha,
            video,foto_registrada_en,foto_estatus,foto_motivo_rechazo
     FROM users WHERE id=? LIMIT 1`,
    [req.userId]
  );
  if (!rows.length) return res.status(404).json({ error: "Colaborador no encontrado" });
  res.json(rows[0]);
});




const PORT = process.env.PORT || 3000;
async function prepareProductionAdmin(){
  if(process.env.NODE_ENV!=="production")return;
  const password=String(process.env.ADMIN_PASSWORD||"");
  if(password.length<12)throw new Error("ADMIN_PASSWORD debe tener al menos 12 caracteres en producción");
  const usuario=String(process.env.ADMIN_USER||"admin").trim().toLowerCase();
  const name=String(process.env.ADMIN_NAME||"Administrador TIA").trim();
  const salt=crypto.randomBytes(16).toString("hex");
  await db.query(
    `UPDATE admins SET name=?,usuario=?,pin=NULL,password_hash=?,password_salt=?,rol='SUPERADMIN',activo=1
     WHERE id=(SELECT id FROM (SELECT MIN(id) id FROM admins) base)`,
    [name,usuario,hashPassword(password,salt),salt]
  );
}
prepareProductionAdmin()
  .then(()=>app.listen(PORT,()=>console.log(`TIA running on port ${PORT}`)))
  .catch(err=>{console.error("STARTUP ERROR:",err.message);process.exit(1)});

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

const upload = multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:5*1024*1024,files:1},
  fileFilter:(req,file,cb)=>{
    if(["image/jpeg","image/png","image/webp"].includes(file.mimetype))return cb(null,true);
    cb(new Error("La fotografía debe ser JPG, PNG o WebP"));
  }
});

app.get("/estado-finalizacion",auth,async(req,res)=>{
  try{
    if(req.isAdmin)return res.status(403).json({ok:false,error:"Acceso no disponible"});
    const [rows]=await db.query("SELECT name,folio,aprobado,photo,foto_registrada_en,foto_estatus,foto_motivo_rechazo FROM users WHERE id=? LIMIT 1",[req.userId]);
    if(!rows.length)return res.status(404).json({ok:false,error:"Colaborador no encontrado"});
    return res.json({ok:true,nombre:rows[0].name,folio:rows[0].folio,aprobado:!!rows[0].aprobado,fotoRegistrada:!!rows[0].photo,fotoEstatus:rows[0].foto_estatus,motivoRechazo:rows[0].foto_motivo_rechazo,fechaFoto:rows[0].foto_registrada_en});
  }catch(err){console.error("FINALIZACION STATUS ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible consultar el estado"})}
});

// 📸 GUARDAR FOTO
app.post("/upload-photo", auth, upload.single("photo"), async (req, res) => {
  try {

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No se recibió la fotografía" });
    }

    if(req.isAdmin)return res.status(403).json({ok:false,error:"Acceso no disponible"});
    if(String(req.body.confirmacion)!=="true"){
      return res.status(400).json({ok:false,error:"Debes confirmar que la fotografía cumple los requisitos"});
    }
    if(String(req.body.origen)!=="CAMARA"){
      return res.status(400).json({ok:false,error:"La fotografía debe capturarse directamente desde la cámara"});
    }

    const userId = req.userId;

    const [result]=await db.query(
      "UPDATE users SET photo='DB',photo_data=?,photo_mime=?,foto_registrada_en=NOW(),foto_estatus='PENDIENTE',foto_revisada_en=NULL,foto_revisada_por=NULL,foto_motivo_rechazo=NULL WHERE id=? AND aprobado=1",
      [req.file.buffer,req.file.mimetype,userId]
    );
    if(!result.affectedRows)return res.status(403).json({ok:false,error:"Primero debes aprobar el examen"});

    res.json({ ok: true, certificado:"/certificado.html" });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ ok: false, error:err.message||"No fue posible guardar la fotografía" });
  }
});


async function getExamEligibility(userId) {
  const [rows] = await db.query(
    `SELECT u.aprobado,COUNT(vp.videoIndex) AS videos,
            COALESCE(AVG(vp.progress),0) AS progress
     FROM users u
     LEFT JOIN video_progress vp ON vp.userId=u.id AND vp.videoIndex IN (0,1)
     WHERE u.id=?
     GROUP BY u.id`,
    [userId]
  );
  if (!rows.length) return { eligible:false,progress:0,reason:"Colaborador no encontrado" };
  const user = rows[0];
  const progress = Number(user.progress || 0);
  if (user.aprobado) return { eligible:false,progress,reason:"El curso ya fue aprobado" };
  if (Number(user.videos) < 2 || progress <= 95) {
    return { eligible:false,progress,reason:"Debes completar más del 95% del curso" };
  }
  return { eligible:true,progress };
}

app.get("/questions", auth, async (req, res) => {
  try {
    if (req.isAdmin) return res.status(403).json({ok:false,error:"Acceso no disponible"});
    const eligibility = await getExamEligibility(req.userId);
    if (!eligibility.eligible) {
      return res.status(403).json({ok:false,error:eligibility.reason,progress:eligibility.progress});
    }
    const [rows] = await db.query(`
      SELECT id,question,option_a,option_b,option_c,option_d
      FROM questions WHERE active=1 ORDER BY RAND() LIMIT 15
    `);
    if(rows.length<15) return res.status(503).json({ok:false,error:"Banco de preguntas insuficiente"});
    const examToken=crypto.randomBytes(32).toString("hex");
    await db.query(
      `INSERT INTO exam_sessions(token,user_id,question_ids,expires_at)
       VALUES(?,?,?,DATE_ADD(NOW(),INTERVAL 60 MINUTE))`,
      [examToken,req.userId,JSON.stringify(rows.map(q=>q.id))]
    );
    return res.json({ok:true,examToken,questions:rows});
  } catch(err) {
    console.error("QUESTIONS ERROR:",err);
    return res.status(500).json({ok:false,error:"No fue posible cargar el examen"});
  }
});

app.post("/submit-exam", auth, async (req, res) => {

  try {

    const userId = req.userId;
    if (req.isAdmin) return res.status(403).json({ok:false,error:"Acceso no disponible"});
    const eligibility = await getExamEligibility(userId);
    if (!eligibility.eligible) {
      return res.status(403).json({ok:false,error:eligibility.reason,progress:eligibility.progress});
    }
    const examToken=String(req.body.examToken||"");
    const answers=Array.isArray(req.body.answers)?req.body.answers:[];
    const [sessions]=await db.query(
      `SELECT question_ids FROM exam_sessions
       WHERE token=? AND user_id=? AND submitted_at IS NULL AND expires_at>NOW() LIMIT 1`,
      [examToken,userId]
    );
    if(!sessions.length) return res.status(400).json({ok:false,error:"Examen invalido o vencido"});
    const ids=typeof sessions[0].question_ids==="string"?JSON.parse(sessions[0].question_ids):sessions[0].question_ids;
    const [correctRows]=await db.query("SELECT id,correct FROM questions WHERE id IN (?)",[ids]);
    const answerMap=new Map(answers.map(a=>[Number(a.id),String(a.answer||"").toUpperCase()]));
    const correct=correctRows.reduce((sum,q)=>sum+(answerMap.get(Number(q.id))===q.correct?1:0),0);
    const score=Math.round((correct/ids.length)*100);

    console.log("SCORE:", score);

    const aprobado =
      score >= 80;

    await db.query("UPDATE exam_sessions SET score=?,submitted_at=NOW() WHERE token=?",[score,examToken]);

    res.json({
      ok: true,
      aprobado,
      score
    });

  } catch (err) {

    console.error("SUBMIT ERROR:", err);

    res.status(500).json({
      ok: false,
      error: err.message
    });

  }

});

app.get("/can-take-exam", auth, async (req, res) => {

  try {

    // 🔥 OBTENER TODOS LOS VIDEOS
    const [rows] = await db.query(

      `SELECT progress
       FROM video_progress
       WHERE userId=? AND videoIndex IN (0, 1)`,

      [req.userId]

    );

    // 🚫 SIN VIDEOS
    if (rows.length < 2) {

      return res.json({
        ok: false,
        progress: 0
      });

    }

    // 🔥 PROMEDIO REAL
    const total =
      rows.reduce(
        (acc, r) => acc + Number(r.progress || 0),
        0
      ) / rows.length;

    console.log(
      "TOTAL EXAM:",
      total
    );

    // ✅ VALIDAR
    if (total > 95) {

      return res.json({
        ok: true,
        progress: total
      });

    }

    res.json({
      ok: false,
      progress: total
    });

  } catch (err) {

    console.error(
      "❌ ERROR can-take-exam:",
      err
    );

    res.status(500).json({
      ok: false
    });

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

  const {
    name,
    company,
    puesto,
    telefono,
    correo,
    pass
  } = req.body;

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
    (name, company, puesto, telefono, correo, folio, loginTime)
    VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [
      name.trim(),
      company.trim(),
      puesto.trim(),
      telefono.trim(),
      correo.trim(),
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
