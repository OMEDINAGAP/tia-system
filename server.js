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
app.use((err, req, res, next) => {
  if (err?.message === "Origen no permitido") {
    return res.status(403).json({ ok:false,error:"Origen no permitido" });
  }
  return next(err);
});
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://www.youtube.com",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com https://www.youtube.com https://*.youtube.com https://*.googlevideo.com",
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
    "worker-src 'self' blob:",
    "media-src 'self' blob: https:"
  ].join("; "));
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
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

function repairMojibake(value){
  if(typeof value!=="string")return value;
  let repaired=value.replace(/├/g,"Ã").replace(/┬/g,"Â").replace(/┼/g,"Å");
  for(let attempt=0;attempt<2&&/[ÃÂâ]/.test(repaired);attempt++){
    const candidate=Buffer.from(repaired,"latin1").toString("utf8");
    if(candidate.includes("�"))break;
    repaired=candidate;
  }
  return repaired;
}

/* Auditoria: solo almacena referencias y cambios operativos; nunca secretos, contraseñas ni archivos. */
function auditActor(req, fallback={}) {
  if (req?.isAdmin && req.admin) return { tipo:"ADMIN", id:req.admin.id, nombre:req.admin.usuario || req.admin.name };
  return { tipo:fallback.tipo || "SISTEMA", id:fallback.id || null, nombre:fallback.nombre || "Sistema TIA" };
}
function auditSafe(value) {
  if (!value || typeof value !== "object") return value ?? null;
  const result={};
  for (const [key,item] of Object.entries(value)) {
    if (/pass|password|salt|hash|firma|photo|imagen|token/i.test(key)) continue;
    result[key]=item;
  }
  return result;
}
async function auditEvent(executor, req, event, details={}) {
  try {
    const actor=auditActor(req, details.actor);
    await executor.query(`INSERT INTO auditoria_eventos
      (actor_tipo,actor_id,actor_nombre,empresa_id,persona_id,folio,entidad,entidad_id,evento,antes_json,despues_json,detalle,ip,user_agent)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      actor.tipo,actor.id,actor.nombre,details.empresaId || null,details.personaId || null,details.folio || null,
      details.entidad || null,details.entidadId || null,event,
      JSON.stringify(auditSafe(details.antes)),JSON.stringify(auditSafe(details.despues)),details.detalle || null,
      String(req?.ip || "").slice(0,64),String(req?.get?.("user-agent") || "").slice(0,500)
    ]);
  } catch (error) { console.error("AUDIT EVENT ERROR:",error.message); }
}
async function auditPersonContext(executor,userId) {
  const [rows]=await executor.query(`SELECT pc.id AS persona_id,pc.empresa_id,pc.folio,u.name
    FROM personas_curso pc JOIN users u ON u.id=pc.user_id WHERE u.id=? LIMIT 1`,[userId]);
  return rows[0] || {};
}


// arriba
const sessions = new Map(); // token -> userId
const COLLABORATOR_SESSION_EXPIRES = 253402300799000; // 31-12-9999; la sesión personal no vence por tiempo.

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
      `SELECT s.*, sc.persona_id AS suspendida
       FROM sessions s
       LEFT JOIN personas_curso pc ON pc.user_id=s.userId
       LEFT JOIN suspensiones_colaborador sc ON sc.persona_id=pc.id
       WHERE s.token=? LIMIT 1`,
      [token]
    );

    if (!rows.length) {

      return res.status(401).json({
        error: "Sesión inválida"
      });

    }

    const session = rows[0];

    if (session.suspendida) {
      await db.query("DELETE FROM sessions WHERE userId=?", [session.userId]);
      return res.status(403).json({ error: "El acceso de este colaborador se encuentra suspendido. La baja formal debe concluirse en el módulo TIA." });
    }

    // ✅ USER REAL
    req.userId = Number(session.userId);

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

/* Roles internos. La autorización se valida siempre en el servidor; ocultar
   una opción en la interfaz no concede ni revoca permisos por sí mismo. */
const INTERNAL_ROLES = Object.freeze(["SUPERADMIN","ADMINISTRADOR","AUDITOR","VISOR"]);
function adminHasPermission(req, permission){
  if(!req?.isAdmin || !req.admin)return false;
  const role=req.admin.rol;
  if(role==="SUPERADMIN" || role==="ADMINISTRADOR")return true;
  if(role==="AUDITOR")return ["OVERVIEW","AUDIT_VIEW","DOCUMENT_READ"].includes(permission);
  if(role==="VISOR")return ["OVERVIEW","DOCUMENT_READ"].includes(permission);
  return false;
}
function requireAdminPermission(req,res,permission,message="No tienes permisos para realizar esta acción"){
  if(adminHasPermission(req,permission))return true;
  res.status(403).json({ok:false,error:message});
  return false;
}
function canManageInternalRole(actorRole,targetRole){
  if(actorRole==="SUPERADMIN")return targetRole!=="SUPERADMIN";
  return actorRole==="ADMINISTRADOR" && ["AUDITOR","VISOR"].includes(targetRole);
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
    await auditEvent(db,req,"INICIO_SESION_ADMINISTRATIVO",{actor:{tipo:"ADMIN",id:admin.id,nombre:admin.usuario||admin.name},entidad:"ADMIN",entidadId:admin.id});

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
             e.creado_en,GROUP_CONCAT(DISTINCT ce.usuario ORDER BY ce.usuario SEPARATOR ', ') AS usuario,
             COUNT(DISTINCT pc.id) AS colaboradores,
             COUNT(DISTINCT CASE WHEN u.aprobado=1 THEN pc.id END) AS aprobados,
             ROUND(AVG(COALESCE(pg.progreso,0)),1) AS progreso_promedio
      FROM folios_acceso fa LEFT JOIN empresas e ON e.folio_acceso_id=fa.id
      LEFT JOIN cuentas_empresa ce ON ce.empresa_id=e.id
      LEFT JOIN personas_curso pc ON pc.empresa_id=e.id LEFT JOIN users u ON u.id=pc.user_id
      LEFT JOIN (SELECT userId,LEAST(100,SUM(progress)/2) AS progreso FROM video_progress GROUP BY userId) pg ON pg.userId=u.id
      GROUP BY fa.id,e.id ORDER BY fa.creado_en DESC`);
    const [people]=await db.query(`
      SELECT pc.id,pc.empresa_id,pc.folio,pc.nombres,pc.apellido_paterno,pc.apellido_materno,
             pc.puesto,pc.telefono,pc.correo,pc.estatus,e.nombre AS empresa,
             COALESCE(u.exam,0) AS calificacion,COALESCE(u.intentos,0) AS intentos,
             COALESCE(u.aprobado,0) AS aprobado,u.photo,u.foto_registrada_en,u.foto_estatus,u.foto_motivo_rechazo,u.fecha AS fecha_aprobacion,cc.aceptado_en AS carta_aceptada_en,ea.id AS examen_auditado_id,sc.suspendido_en,
             ROUND(COALESCE(pg.progreso,0),1) AS progreso,pc.creado_en
      FROM personas_curso pc JOIN empresas e ON e.id=pc.empresa_id
      LEFT JOIN users u ON u.id=pc.user_id
      LEFT JOIN cartas_compromiso cc ON cc.user_id=u.id
      LEFT JOIN examenes_aprobados ea ON ea.user_id=u.id
      LEFT JOIN suspensiones_colaborador sc ON sc.persona_id=pc.id
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

app.get("/admin-auditoria",auth,async(req,res)=>{
  try {
    if(!requireAdminPermission(req,res,"AUDIT_VIEW","Solo administradores y auditores pueden consultar la auditoría")) return;
    const search=String(req.query.q||"").trim();
    const event=String(req.query.evento||"").trim();
    const from=String(req.query.desde||"").slice(0,10);
    const to=String(req.query.hasta||"").slice(0,10);
    const empresaId=Number(req.query.empresaId)||0;
    const exportAll=String(req.query.export||"")==="1", pageSize=exportAll?10000:20;
    const eventPage=Math.max(1,Number(req.query.eventPage||req.query.page)||1);
    const processPage=Math.max(1,Number(req.query.processPage||req.query.page)||1);
    const companyPage=Math.max(1,Number(req.query.companyPage||1));
    const responsibilityPage=Math.max(1,Number(req.query.responsibilityPage||1));
    const eventOffset=(eventPage-1)*pageSize,processOffset=(processPage-1)*pageSize,companyOffset=(companyPage-1)*pageSize,responsibilityOffset=(responsibilityPage-1)*pageSize;
    const where=[],params=[];
    if(search){ where.push("(ae.folio LIKE ? OR ae.actor_nombre LIKE ? OR e.nombre LIKE ? OR CONCAT_WS(' ',pc.nombres,pc.apellido_paterno,pc.apellido_materno) LIKE ? OR ae.detalle LIKE ?)"); for(let i=0;i<5;i++)params.push(`%${search}%`); }
    if(event){where.push("ae.evento=?");params.push(event);}
    if(empresaId){where.push("ae.empresa_id=?");params.push(empresaId);}
    if(from){where.push("ae.creado_en>=?");params.push(`${from} 00:00:00`);}
    if(to){where.push("ae.creado_en<?");params.push(`${to} 23:59:59`);}
    const filter=where.length?`WHERE ${where.join(" AND ")}`:"";
    const [countRows]=await db.query(`SELECT COUNT(*) total FROM auditoria_eventos ae LEFT JOIN empresas e ON e.id=ae.empresa_id LEFT JOIN personas_curso pc ON pc.id=ae.persona_id ${filter}`,params);
    const [events]=await db.query(`SELECT ae.*,e.nombre AS empresa,CONCAT_WS(' ',pc.nombres,pc.apellido_paterno,pc.apellido_materno) AS colaborador
      FROM auditoria_eventos ae LEFT JOIN empresas e ON e.id=ae.empresa_id LEFT JOIN personas_curso pc ON pc.id=ae.persona_id
      ${filter} ORDER BY ae.creado_en DESC,ae.id DESC LIMIT ? OFFSET ?`,[...params,pageSize,eventOffset]);
    events.forEach(item=>{
      item.actor_nombre=repairMojibake(item.actor_nombre);
      item.empresa=repairMojibake(item.empresa);
      item.colaborador=repairMojibake(item.colaborador);
      item.detalle=repairMojibake(item.detalle);
    });
    const [eventTypes]=await db.query("SELECT evento,COUNT(*) total FROM auditoria_eventos GROUP BY evento ORDER BY evento");
    const kpiClauses=[],kpiParams=[];
    if(empresaId){kpiClauses.push("pc.empresa_id=?");kpiParams.push(empresaId);}
    if(search){kpiClauses.push("(pc.folio LIKE ? OR e.nombre LIKE ? OR CONCAT_WS(' ',pc.nombres,pc.apellido_paterno,pc.apellido_materno) LIKE ?)");kpiParams.push(`%${search}%`,`%${search}%`,`%${search}%`);}
    if(from){kpiClauses.push("pc.creado_en>=?");kpiParams.push(`${from} 00:00:00`);}
    if(to){kpiClauses.push("pc.creado_en<?");kpiParams.push(`${to} 23:59:59`);}
    const kpiWhere=kpiClauses.length?`WHERE ${kpiClauses.join(" AND ")}`:"";
    const [kpiCountRows]=await db.query(`SELECT COUNT(*) total FROM personas_curso pc JOIN empresas e ON e.id=pc.empresa_id ${kpiWhere}`,kpiParams);
    const [kpis]=await db.query(`SELECT pc.id,pc.folio,e.nombre AS empresa,CONCAT_WS(' ',pc.nombres,pc.apellido_paterno,pc.apellido_materno) AS colaborador,
      MIN(CASE WHEN ae.evento='COLABORADOR_REGISTRADO' THEN ae.creado_en END) AS alta_en,
      MIN(CASE WHEN ae.evento='INICIO_SESION_COLABORADOR' THEN ae.creado_en END) AS sesion_en,
      MIN(CASE WHEN ae.evento='CARTA_ACEPTADA' THEN ae.creado_en END) AS carta_en,
      MIN(CASE WHEN ae.evento='CURSO_INICIADO' THEN ae.creado_en END) AS curso_inicio_en,
      MIN(CASE WHEN ae.evento='VIDEO_COMPLETADO' THEN ae.creado_en END) AS video_en,
      MAX(CASE WHEN ae.evento='EXAMEN_INICIADO' THEN ae.creado_en END) AS examen_inicio_en,
      MIN(CASE WHEN ae.evento='EXAMEN_APROBADO' THEN ae.creado_en END) AS examen_en,
      MIN(CASE WHEN ae.evento='FOTOGRAFIA_APROBADA' THEN ae.creado_en END) AS constancia_lista_en,
      MIN(CASE WHEN ae.evento='CONSTANCIA_DESCARGADA' THEN ae.creado_en END) AS constancia_descargada_en
      FROM personas_curso pc JOIN empresas e ON e.id=pc.empresa_id LEFT JOIN auditoria_eventos ae ON ae.persona_id=pc.id
      ${kpiWhere} GROUP BY pc.id,e.nombre ORDER BY pc.creado_en DESC LIMIT ? OFFSET ?`,[...kpiParams,pageSize,processOffset]);
    const [summaryRows]=await db.query(`SELECT COUNT(CASE WHEN u.aprobado=1 AND u.foto_estatus='APROBADA' THEN 1 END) AS concluidos,
      AVG(CASE WHEN u.aprobado=1 AND u.foto_estatus='APROBADA' THEN TIMESTAMPDIFF(SECOND,pc.creado_en,u.foto_revisada_en)/3600 END) AS promedio_horas
      FROM personas_curso pc JOIN empresas e ON e.id=pc.empresa_id LEFT JOIN users u ON u.id=pc.user_id ${kpiWhere}`,kpiParams);
    const completed=Number(summaryRows[0]?.concluidos||0);
    const averageHours=summaryRows[0]?.promedio_horas==null?null:Math.round(Number(summaryRows[0].promedio_horas)*10)/10;
    const companyClauses=[],companyParams=[];
    if(empresaId){companyClauses.push("e.id=?");companyParams.push(empresaId);}
    if(search){companyClauses.push("e.nombre LIKE ?");companyParams.push(`%${search}%`);}
    if(from){companyClauses.push("e.creado_en>=?");companyParams.push(`${from} 00:00:00`);}
    if(to){companyClauses.push("e.creado_en<?");companyParams.push(`${to} 23:59:59`);}
    const companyWhere=companyClauses.length?`WHERE ${companyClauses.join(" AND ")}`:"";
    const [companyCountRows]=await db.query(`SELECT COUNT(*) total FROM empresas e ${companyWhere}`,companyParams);
    const [companyKpis]=await db.query(`SELECT e.id,e.nombre,fa.folio,fa.fecha_emision AS token_emitido_en,e.creado_en AS empresa_registrada_en,
      MIN(pc.creado_en) AS primer_colaborador_en,COUNT(pc.id) AS colaboradores,
      SUM(CASE WHEN u.aprobado=1 AND u.foto_estatus='APROBADA' THEN 1 ELSE 0 END) AS concluidos,
      AVG(CASE WHEN u.aprobado=1 AND u.foto_estatus='APROBADA' THEN TIMESTAMPDIFF(SECOND,pc.creado_en,u.foto_revisada_en)/3600 END) AS promedio_constancia_horas
      FROM empresas e JOIN folios_acceso fa ON fa.id=e.folio_acceso_id LEFT JOIN personas_curso pc ON pc.empresa_id=e.id LEFT JOIN users u ON u.id=pc.user_id
      ${companyWhere} GROUP BY e.id,fa.id ORDER BY promedio_constancia_horas DESC LIMIT ? OFFSET ?`,[...companyParams,pageSize,companyOffset]);
    /* Indicadores de responsabilidad: separan el tiempo en espera de la empresa/
       colaborador del tiempo en revisión del módulo TIA. */
    const [photoSlaRows]=await db.query(`SELECT
      COUNT(CASE WHEN u.foto_registrada_en IS NOT NULL AND u.foto_revisada_en IS NOT NULL THEN 1 END) AS revisadas,
      SUM(CASE WHEN u.foto_registrada_en IS NOT NULL AND u.foto_revisada_en IS NOT NULL AND TIMESTAMPDIFF(SECOND,u.foto_registrada_en,u.foto_revisada_en)<=86400 THEN 1 ELSE 0 END) AS dentro_sla,
      AVG(CASE WHEN u.foto_registrada_en IS NOT NULL AND u.foto_revisada_en IS NOT NULL THEN TIMESTAMPDIFF(SECOND,u.foto_registrada_en,u.foto_revisada_en)/3600 END) AS promedio_revision_horas,
      SUM(CASE WHEN u.foto_estatus='PENDIENTE' THEN 1 ELSE 0 END) AS pendientes
      FROM personas_curso pc JOIN users u ON u.id=pc.user_id ${kpiWhere}`,kpiParams);
    const [physicalTimeRows]=await db.query(`SELECT
      COUNT(CASE WHEN tf.atendido_en IS NOT NULL THEN 1 END) AS atendidas,
      AVG(CASE WHEN tf.llegada_en IS NOT NULL AND tf.atencion_iniciada_en IS NOT NULL THEN TIMESTAMPDIFF(SECOND,tf.llegada_en,tf.atencion_iniciada_en)/60 END) AS espera_minutos,
      AVG(CASE WHEN tf.atencion_iniciada_en IS NOT NULL AND tf.atendido_en IS NOT NULL THEN TIMESTAMPDIFF(SECOND,tf.atencion_iniciada_en,tf.atendido_en)/60 END) AS atencion_minutos,
      AVG(CASE WHEN tf.llegada_en IS NOT NULL AND tf.atendido_en IS NOT NULL THEN TIMESTAMPDIFF(SECOND,tf.llegada_en,tf.atendido_en)/60 END) AS total_minutos
      FROM personas_curso pc JOIN users u ON u.id=pc.user_id LEFT JOIN fotografias_toma_fisica tf ON tf.user_id=u.id ${kpiWhere}`,kpiParams);
    const [processRows]=await db.query(`SELECT pc.id,pc.folio,pc.creado_en AS alta_en,e.nombre AS empresa,
      CONCAT_WS(' ',pc.nombres,pc.apellido_paterno,pc.apellido_materno) AS colaborador,
      u.aprobado,u.photo,u.foto_estatus,u.foto_registrada_en,u.foto_revisada_en,tf.solicitado_en AS toma_fisica_en,tf.llegada_en,tf.atencion_iniciada_en,tf.atendido_en,
      MIN(CASE WHEN ae.evento='INICIO_SESION_COLABORADOR' THEN ae.creado_en END) AS sesion_en,
      MIN(CASE WHEN ae.evento='CARTA_ACEPTADA' THEN ae.creado_en END) AS carta_en,
      MIN(CASE WHEN ae.evento='CURSO_INICIADO' THEN ae.creado_en END) AS curso_inicio_en,
      MIN(CASE WHEN ae.evento='VIDEO_COMPLETADO' THEN ae.creado_en END) AS video_en,
      MIN(CASE WHEN ae.evento='EXAMEN_APROBADO' THEN ae.creado_en END) AS examen_en,
      MIN(CASE WHEN ae.evento='FOTOGRAFIA_ENVIADA' THEN ae.creado_en END) AS foto_en
      FROM personas_curso pc JOIN empresas e ON e.id=pc.empresa_id LEFT JOIN users u ON u.id=pc.user_id
      LEFT JOIN fotografias_toma_fisica tf ON tf.user_id=u.id LEFT JOIN auditoria_eventos ae ON ae.persona_id=pc.id
      ${kpiWhere} GROUP BY pc.id,e.nombre,u.id,tf.user_id ORDER BY pc.creado_en DESC`,kpiParams);
    const asDate=value=>value?new Date(value):null;
    const hoursBetween=(start,end)=>{const a=asDate(start),b=asDate(end);return a&&b?Math.max(0,(b-a)/3600000):null};
    const stalledCases=processRows.map(row=>{
      let etapa,esperando,responsable,inicio;
      if(row.foto_estatus==='APROBADA'){etapa='CONCLUIDO';esperando='Proceso finalizado';responsable='SISTEMA';inicio=row.foto_revisada_en;}
      else if(row.toma_fisica_en){etapa='TOMA_FISICA';esperando='Toma física en módulo TIA';responsable='MODULO_TIA';inicio=row.toma_fisica_en;}
      else if(row.foto_estatus==='PENDIENTE'&&row.photo){etapa='REVISION_FOTOGRAFIA';esperando='Revisión de fotografía';responsable='MODULO_TIA';inicio=row.foto_en||row.foto_registrada_en;}
      else if(row.examen_en){etapa='FOTOGRAFIA';esperando='Carga de fotografía';responsable='COLABORADOR';inicio=row.examen_en;}
      else if(row.video_en){etapa='EXAMEN';esperando='Presentación de examen';responsable='COLABORADOR';inicio=row.video_en;}
      else if(row.carta_en){etapa='CURSO';esperando='Finalizar videos del curso';responsable='COLABORADOR';inicio=row.curso_inicio_en||row.carta_en;}
      else if(row.sesion_en){etapa='CARTA';esperando='Aceptar y firmar carta compromiso';responsable='COLABORADOR';inicio=row.sesion_en;}
      else {etapa='INICIO_SESION';esperando='Primer inicio de sesión';responsable='EMPRESA_COLABORADOR';inicio=row.alta_en;}
      return {...row,etapa,esperando,responsable,inicio_espera:inicio,horas_espera:hoursBetween(inicio,new Date())};
    });
    const openCases=stalledCases.filter(item=>item.etapa!=='CONCLUIDO');
    const responsibility={
      esperandoEmpresaColaborador:openCases.filter(item=>item.responsable==='EMPRESA_COLABORADOR'||item.responsable==='COLABORADOR').length,
      esperandoModulo:openCases.filter(item=>item.responsable==='MODULO_TIA').length,
      promedioModuloRevisionHoras:photoSlaRows[0]?.promedio_revision_horas==null?null:Math.round(Number(photoSlaRows[0].promedio_revision_horas)*10)/10,
      slaFotoHoras:24,
      fotosRevisadas:Number(photoSlaRows[0]?.revisadas||0),
      fotosDentroSla:Number(photoSlaRows[0]?.dentro_sla||0),
      fotosPendientes:Number(photoSlaRows[0]?.pendientes||0),
      tomasFisicasAtendidas:Number(physicalTimeRows[0]?.atendidas||0),
      esperaFisicaMinutos:physicalTimeRows[0]?.espera_minutos==null?null:Math.round(Number(physicalTimeRows[0].espera_minutos)),
      atencionFisicaMinutos:physicalTimeRows[0]?.atencion_minutos==null?null:Math.round(Number(physicalTimeRows[0].atencion_minutos)),
      totalFisicaMinutos:physicalTimeRows[0]?.total_minutos==null?null:Math.round(Number(physicalTimeRows[0].total_minutos))
    };
    const paginatedStalledCases=openCases.slice(responsibilityOffset,responsibilityOffset+pageSize);
    return res.json({ok:true,events,eventTypes,kpis,companyKpis,stalledCases:paginatedStalledCases,responsibility,pagination:{pageSize,eventPage,processPage,companyPage,responsibilityPage,totalEvents:Number(countRows[0].total),totalKpis:Number(kpiCountRows[0].total),totalCompanies:Number(companyCountRows[0].total),totalResponsibility:openCases.length},summary:{eventos:Number(countRows[0].total),procesosConcluidos:completed,tiempoPromedioHoras:averageHours}});
  } catch(err) { console.error("ADMIN AUDIT ERROR:",err); return res.status(500).json({ok:false,error:"No fue posible cargar la auditoria"}); }
});

/* Reporte ejecutivo para reuniones: concentra avance, responsables y cuellos de botella
   usando los mismos filtros de la pantalla de Auditoría. */
app.get("/admin-auditoria/reporte.pdf",auth,async(req,res)=>{
  try{
    if(!requireAdminPermission(req,res,"AUDIT_VIEW","Solo administradores y auditores pueden generar el reporte"))return;
    const search=String(req.query.q||"").trim(),from=String(req.query.desde||"").slice(0,10),to=String(req.query.hasta||"").slice(0,10),empresaId=Number(req.query.empresaId)||0;
    const clauses=[],params=[];
    if(empresaId){clauses.push("pc.empresa_id=?");params.push(empresaId);}
    if(search){clauses.push("(pc.folio LIKE ? OR e.nombre LIKE ? OR CONCAT_WS(' ',pc.nombres,pc.apellido_paterno,pc.apellido_materno) LIKE ?)");params.push(`%${search}%`,`%${search}%`,`%${search}%`);}
    if(from){clauses.push("pc.creado_en>=?");params.push(`${from} 00:00:00`);}
    if(to){clauses.push("pc.creado_en<?");params.push(`${to} 23:59:59`);}
    const where=clauses.length?`WHERE ${clauses.join(" AND ")}`:"";
    const [rows]=await db.query(`SELECT pc.folio,pc.creado_en AS alta_en,e.nombre AS empresa,CONCAT_WS(' ',pc.nombres,pc.apellido_paterno,pc.apellido_materno) AS colaborador,
      u.aprobado,u.photo,u.foto_estatus,u.foto_registrada_en,u.foto_revisada_en,tf.solicitado_en AS toma_fisica_en,
      MIN(CASE WHEN ae.evento='INICIO_SESION_COLABORADOR' THEN ae.creado_en END) AS sesion_en,
      MIN(CASE WHEN ae.evento='CARTA_ACEPTADA' THEN ae.creado_en END) AS carta_en,
      MIN(CASE WHEN ae.evento='CURSO_INICIADO' THEN ae.creado_en END) AS curso_inicio_en,
      MIN(CASE WHEN ae.evento='VIDEO_COMPLETADO' THEN ae.creado_en END) AS video_en,
      MIN(CASE WHEN ae.evento='EXAMEN_APROBADO' THEN ae.creado_en END) AS examen_en,
      MIN(CASE WHEN ae.evento='FOTOGRAFIA_ENVIADA' THEN ae.creado_en END) AS foto_en
      FROM personas_curso pc JOIN empresas e ON e.id=pc.empresa_id LEFT JOIN users u ON u.id=pc.user_id
      LEFT JOIN fotografias_toma_fisica tf ON tf.user_id=u.id LEFT JOIN auditoria_eventos ae ON ae.persona_id=pc.id
      ${where} GROUP BY pc.id,e.nombre,u.id,tf.user_id ORDER BY pc.creado_en ASC`,params);
    const now=new Date();
    const hours=(start,end=now)=>{const a=start?new Date(start):null,b=end?new Date(end):null;return a&&b?Math.max(0,(b-a)/3600000):null};
    const stage=row=>{
      if(row.foto_estatus==='APROBADA')return {stage:'Concluido',owner:'Sistema',since:row.foto_revisada_en};
      if(row.toma_fisica_en)return {stage:'Toma física TIA',owner:'Módulo TIA',since:row.toma_fisica_en};
      if(row.foto_estatus==='PENDIENTE'&&row.photo)return {stage:'Revisión de fotografía',owner:'Módulo TIA',since:row.foto_en||row.foto_registrada_en};
      if(row.examen_en)return {stage:'Carga de fotografía',owner:'Colaborador',since:row.examen_en};
      if(row.video_en)return {stage:'Presentación de examen',owner:'Colaborador',since:row.video_en};
      if(row.carta_en)return {stage:'Finalizar curso',owner:'Colaborador',since:row.curso_inicio_en||row.carta_en};
      if(row.sesion_en)return {stage:'Carta compromiso',owner:'Colaborador',since:row.sesion_en};
      return {stage:'Primer inicio de sesión',owner:'Empresa / colaborador',since:row.alta_en};
    };
    const records=rows.map(row=>({...row,empresa:repairMojibake(row.empresa),colaborador:repairMojibake(row.colaborador),...stage(row)}));
    const completed=records.filter(row=>row.stage==='Concluido'),open=records.filter(row=>row.stage!=='Concluido').sort((a,b)=>(hours(b.since)||0)-(hours(a.since)||0));
    const avg=completed.length?completed.reduce((sum,row)=>sum+(hours(row.alta_en,row.foto_revisada_en)||0),0)/completed.length:null;
    const owners={"Módulo TIA":0,"Colaborador":0,"Empresa / colaborador":0};open.forEach(row=>{owners[row.owner]=(owners[row.owner]||0)+1});
    const companyMap=new Map();
    records.forEach(row=>{const item=companyMap.get(row.empresa)||{empresa:row.empresa,total:0,concluidos:0,hours:[]};item.total++;if(row.stage==='Concluido'){item.concluidos++;const value=hours(row.alta_en,row.foto_revisada_en);if(value!=null)item.hours.push(value)}companyMap.set(row.empresa,item)});
    const companies=[...companyMap.values()].map(item=>({...item,promedio:item.hours.length?item.hours.reduce((a,b)=>a+b,0)/item.hours.length:null})).sort((a,b)=>(b.promedio??-1)-(a.promedio??-1));
    res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`attachment; filename="reporte-ejecutivo-TIA-${new Date().toISOString().slice(0,10)}.pdf"`);
    const doc=new PDFDocument({size:"LETTER",margin:38});doc.pipe(res);
    const navy="#08111f",green="#16a34a",gold="#d6a94f",muted="#52657b",line="#cbd5e1";
    const dateText=value=>value?new Date(value).toLocaleString("es-MX",{dateStyle:"short",timeStyle:"short"}):"--";
    const duration=value=>value==null?"--":value<24?`${value.toFixed(1)} h`:`${(value/24).toFixed(1)} días`;
    let pageNumber=1;
    const header=()=>{doc.rect(0,0,612,84).fill(navy);doc.rect(0,80,612,4).fill(gold);doc.fillColor(gold).fontSize(21).font("Helvetica-Bold").text("TIA",38,23);doc.fillColor("#ffffff").fontSize(15).text("REPORTE EJECUTIVO",92,25);doc.fontSize(9).fillColor("#b8c7d9").text("Trazabilidad, tiempos y responsables del proceso",92,45);doc.fontSize(8).text(`Corte: ${dateText(new Date())}`,38,62);doc.text(`Alcance: ${empresaId?`empresa ${empresaId}`:"todas las empresas"}${from?` | desde ${from}`:""}${to?` | hasta ${to}`:""}${search?` | ${search}`:""}`,245,62,{width:329,align:"right"});doc.y=105};
    const footer=()=>{doc.strokeColor(line).lineWidth(.5).moveTo(38,744).lineTo(574,744).stroke();doc.fillColor(muted).font("Helvetica").fontSize(7.5).text(`Sistema TIA | Reporte auditable | Página ${pageNumber}`,38,752,{width:536,align:"center"})};
    const page=()=>{footer();doc.addPage();pageNumber++;header()};
    const title=value=>{if(doc.y>680)page();const y=doc.y;doc.fillColor(navy).font("Helvetica-Bold").fontSize(14).text(value,38,y,{width:536});doc.strokeColor(gold).lineWidth(1.5).moveTo(38,doc.y+4).lineTo(98,doc.y+4).stroke();doc.x=38;doc.moveDown(.55)};
    const note=value=>{const y=doc.y;doc.fillColor(muted).font("Helvetica").fontSize(8.8).text(value,38,y,{width:536,lineGap:2});doc.x=38;doc.moveDown(.7)};
    const metricCards=items=>{const width=105,height=56,gap=3;if(doc.y+height>720)page();const y=doc.y;items.forEach((item,index)=>{const x=38+index*(width+gap);doc.roundedRect(x,y,width,height,5).fillAndStroke("#f1f5f9",line);doc.fillColor(muted).font("Helvetica-Bold").fontSize(7).text(item.label,x+8,y+10,{width:width-16});doc.fillColor(item.color||navy).font("Helvetica-Bold").fontSize(16).text(String(item.value),x+8,y+27,{width:width-16});});doc.y=y+height+14};
    const table=(headers,data,widths)=>{const rowHeight=26,total=widths.reduce((sum,value)=>sum+value,0);const drawHeader=()=>{if(doc.y>700)page();const y=doc.y;let x=38;doc.rect(x,y,total,20).fill(navy);doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.2);headers.forEach((head,i)=>{doc.text(head,x+5,y+6,{width:widths[i]-10,height:10,ellipsis:true});x+=widths[i]});doc.y=y+20};drawHeader();data.forEach((row,index)=>{if(doc.y+rowHeight>734){page();drawHeader()}const y=doc.y;let x=38;doc.rect(x,y,total,rowHeight).fill(index%2?"#f8fafc":"#ffffff");doc.strokeColor("#e2e8f0").lineWidth(.35).moveTo(x,y+rowHeight).lineTo(x+total,y+rowHeight).stroke();doc.fillColor(navy).font("Helvetica").fontSize(7.6);row.forEach((cell,i)=>{doc.text(String(cell??"--").replace(/\s*\n\s*/g," · "),x+5,y+8,{width:widths[i]-10,height:10,ellipsis:true});x+=widths[i]});doc.y=y+rowHeight});doc.moveDown(.9)};
    header();
    title("Resumen para toma de decisiones");
    const total=records.length,completion=total?Math.round(completed.length/total*100):0;
    metricCards([{label:"COLABORADORES",value:total},{label:"CONCLUIDOS",value:completed.length,color:green},{label:"PENDIENTES",value:open.length,color:"#b45309"},{label:"AVANCE",value:`${completion}%`,color:green},{label:"PROMEDIO",value:duration(avg)}]);
    title("Responsabilidad de procesos pendientes");note("Estos indicadores señalan quién tiene la siguiente acción. Permiten diferenciar una espera atribuible al módulo TIA de una espera de empresa o colaborador.");
    table(["Responsable", "Casos abiertos", "Lectura para junta"],[["Módulo TIA",owners["Módulo TIA"]||0,"Revisión de fotografía o toma física"],["Empresa / colaborador",owners["Empresa / colaborador"]||0,"Aún no inicia el curso"],["Colaborador",owners.Colaborador||0,"Carta, curso, examen o fotografía pendientes"]],[150,110,276]);
    title("Empresas con mayor tiempo de procedimiento");note("El promedio se calcula únicamente sobre colaboradores con constancia habilitada. Las empresas sin procesos concluidos aparecen sin promedio.");
    table(["Empresa", "Colaboradores", "Concluidos", "Promedio a constancia"],companies.map(item=>[item.empresa,item.total,item.concluidos,duration(item.promedio)]),[255,90,90,101]);
    title("Casos abiertos y siguiente responsable");note("Ordenados por mayor tiempo detenido. Incluye quién no ha cumplido, desde cuándo y la siguiente acción requerida.");
    table(["Folio", "Colaborador", "Empresa", "Etapa", "Responsable", "Desde", "Detenido"],open.slice(0,200).map(row=>[row.folio,row.colaborador,row.empresa,row.stage,row.owner,dateText(row.since),duration(hours(row.since))]),[65,100,100,82,78,67,44]);
    if(open.length>200)note(`Se muestran los primeros 200 de ${open.length} casos abiertos, ordenados por mayor antigüedad.`);
    footer();doc.end();
  }catch(err){console.error("AUDIT PDF ERROR:",err);if(!res.headersSent)res.status(500).json({ok:false,error:"No fue posible generar el reporte PDF"});}
});

app.post("/admin-tokens",auth,async(req,res)=>{
  let connection;
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede generar tokens")) return;
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
    for(const created of tokens) await auditEvent(connection,req,"TOKEN_EMPRESARIAL_CREADO",{folio:created.token,entidad:"TOKEN",entidadId:created.id,despues:{caducidad:created.caducidad}});
    await connection.commit();
    return res.status(201).json({ok:true,tokens});
  }catch(err){
    if(connection)await connection.rollback();
    console.error("ADMIN TOKEN ERROR:",err);
    return res.status(500).json({ok:false,error:"No fue posible generar los tokens"});
  }finally{if(connection)connection.release()}
});

app.get("/admin-tokens/:id/detalle",auth,async(req,res)=>{
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede consultar cuentas empresariales"))return;
    const tokenId=Number(req.params.id);
    if(!Number.isInteger(tokenId)||tokenId<1)return res.status(400).json({ok:false,error:"Token invalido"});
    const [tokens]=await db.query(
      `SELECT fa.id,fa.folio,fa.fecha_emision,fa.caducidad,fa.estatus,fa.empresa,
              e.id AS empresa_id,e.nombre,e.razon_social,e.representante_legal,e.correo_1,e.telefono_1
       FROM folios_acceso fa LEFT JOIN empresas e ON e.folio_acceso_id=fa.id
       WHERE fa.id=? LIMIT 1`,[tokenId]
    );
    const detail=tokens[0];
    if(!detail)return res.status(404).json({ok:false,error:"Token no encontrado"});
    const [accounts]=detail.empresa_id?await db.query(
      `SELECT id,nombre,usuario,activo,creado_en,actualizado_en
       FROM cuentas_empresa WHERE empresa_id=? ORDER BY activo DESC,creado_en ASC`,[detail.empresa_id]
    ):[[]];
    return res.json({ok:true,token:detail,cuentas:accounts});
  }catch(err){console.error("ADMIN TOKEN DETAIL ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible consultar el token"});}
});

app.post("/admin-tokens/:tokenId/cuentas/:accountId/restablecer-password",auth,async(req,res)=>{
  let connection;
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede restablecer contraseñas"))return;
    const tokenId=Number(req.params.tokenId),accountId=Number(req.params.accountId),password=String(req.body.password||"");
    if(!Number.isInteger(tokenId)||!Number.isInteger(accountId)||tokenId<1||accountId<1)return res.status(400).json({ok:false,error:"Solicitud invalida"});
    if(password.length<8)return res.status(400).json({ok:false,error:"La contrasena debe tener al menos 8 caracteres"});
    connection=await db.getConnection();
    await connection.beginTransaction();
    const [accounts]=await connection.query(
      `SELECT ce.id,ce.usuario FROM folios_acceso fa
       JOIN empresas e ON e.folio_acceso_id=fa.id
       JOIN cuentas_empresa ce ON ce.empresa_id=e.id
       WHERE fa.id=? AND ce.id=? FOR UPDATE`,[tokenId,accountId]
    );
    const account=accounts[0];
    if(!account){await connection.rollback();return res.status(404).json({ok:false,error:"La cuenta no pertenece a este token empresarial"});}
    const salt=crypto.randomBytes(16).toString("hex");
    await connection.query("UPDATE cuentas_empresa SET password_hash=?,password_salt=? WHERE id=?",[hashPassword(password,salt),salt,account.id]);
    await connection.query("DELETE FROM sesiones_empresa WHERE cuenta_empresa_id=?",[account.id]);
    await auditEvent(connection,req,"CUENTA_EMPRESA_CONTRASENA_RESTABLECIDA",{entidad:"CUENTA_EMPRESA",entidadId:account.id,folio:String(tokenId),despues:{usuario:account.usuario},detalle:"Las sesiones empresariales fueron cerradas"});
    await connection.commit();
    return res.json({ok:true,usuario:account.usuario});
  }catch(err){if(connection)await connection.rollback();console.error("ADMIN TOKEN PASSWORD RESET ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible restablecer la contrasena"});}
  finally{if(connection)connection.release();}
});

app.post("/admin-tokens/:tokenId/cuentas",auth,async(req,res)=>{
  let connection;
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede administrar cuentas empresariales"))return;
    const tokenId=Number(req.params.tokenId),nombre=String(req.body.nombre||"").trim(),usuario=String(req.body.usuario||"").trim().toLowerCase(),password=String(req.body.password||"");
    if(!Number.isInteger(tokenId)||tokenId<1)return res.status(400).json({ok:false,error:"Token inválido"});
    if(!nombre||nombre.length>120)return res.status(400).json({ok:false,error:"Indica el nombre del administrador"});
    if(!/^[a-z0-9._-]{4,80}$/.test(usuario))return res.status(400).json({ok:false,error:"El usuario debe tener al menos 4 caracteres y usar letras, números, punto, guion o guion bajo"});
    if(password.length<8)return res.status(400).json({ok:false,error:"La contraseña debe tener al menos 8 caracteres"});
    connection=await db.getConnection();await connection.beginTransaction();
    const [companies]=await connection.query(`SELECT e.id FROM folios_acceso fa JOIN empresas e ON e.folio_acceso_id=fa.id WHERE fa.id=? FOR UPDATE`,[tokenId]);
    const company=companies[0];
    if(!company){await connection.rollback();return res.status(404).json({ok:false,error:"Primero debe estar activado el perfil de la empresa"});}
    const salt=crypto.randomBytes(16).toString("hex");
    const [result]=await connection.query(`INSERT INTO cuentas_empresa (empresa_id,nombre,usuario,password_hash,password_salt) VALUES (?,?,?,?,?)`,[company.id,nombre,usuario,hashPassword(password,salt),salt]);
    await auditEvent(connection,req,"CUENTA_EMPRESA_AUTORIZADA",{empresaId:company.id,entidad:"CUENTA_EMPRESA",entidadId:result.insertId,folio:String(tokenId),despues:{nombre,usuario,activo:true}});
    await connection.commit();
    return res.status(201).json({ok:true,cuenta:{id:result.insertId,nombre,usuario,activo:1}});
  }catch(err){if(connection)await connection.rollback();if(err.code==="ER_DUP_ENTRY")return res.status(409).json({ok:false,error:"El nombre de usuario ya existe"});console.error("ADMIN CREATE COMPANY ACCOUNT ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible crear la cuenta"});}
  finally{if(connection)connection.release();}
});

app.patch("/admin-tokens/:tokenId/cuentas/:accountId/estado",auth,async(req,res)=>{
  let connection;
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede administrar cuentas empresariales"))return;
    const tokenId=Number(req.params.tokenId),accountId=Number(req.params.accountId),activo=req.body.activo===true||req.body.activo===1||req.body.activo==="1";
    if(!Number.isInteger(tokenId)||!Number.isInteger(accountId)||tokenId<1||accountId<1)return res.status(400).json({ok:false,error:"Solicitud inválida"});
    connection=await db.getConnection();await connection.beginTransaction();
    const [accounts]=await connection.query(`SELECT ce.id,ce.nombre,ce.usuario,ce.activo FROM folios_acceso fa JOIN empresas e ON e.folio_acceso_id=fa.id JOIN cuentas_empresa ce ON ce.empresa_id=e.id WHERE fa.id=? AND ce.id=? FOR UPDATE`,[tokenId,accountId]);
    const account=accounts[0];
    if(!account){await connection.rollback();return res.status(404).json({ok:false,error:"La cuenta no pertenece a este token empresarial"});}
    await connection.query("UPDATE cuentas_empresa SET activo=? WHERE id=?",[activo?1:0,account.id]);
    if(!activo)await connection.query("DELETE FROM sesiones_empresa WHERE cuenta_empresa_id=?",[account.id]);
    await auditEvent(connection,req,activo?"CUENTA_EMPRESA_REACTIVADA":"CUENTA_EMPRESA_SUSPENDIDA",{entidad:"CUENTA_EMPRESA",entidadId:account.id,folio:String(tokenId),antes:{activo:account.activo},despues:{activo},detalle:account.usuario});
    await connection.commit();
    return res.json({ok:true,cuenta:{...account,activo:activo?1:0}});
  }catch(err){if(connection)await connection.rollback();console.error("ADMIN COMPANY ACCOUNT STATUS ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible actualizar la cuenta"});}
  finally{if(connection)connection.release();}
});

app.patch("/admin-tokens/:id/status",auth,async(req,res)=>{
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede modificar tokens"))return;
    const status=String(req.body.estatus||"").toUpperCase();
    if(!["ACTIVO","SUSPENDIDO"].includes(status))return res.status(400).json({ok:false,error:"Estado invalido"});
    const [result]=await db.query(
      `UPDATE folios_acceso SET estatus=?
       WHERE id=? AND estatus IN ('ACTIVO','SUSPENDIDO')`,[status,Number(req.params.id)]
    );
    if(!result.affectedRows)return res.status(409).json({ok:false,error:"Solo pueden modificarse tokens pendientes o suspendidos"});
    await auditEvent(db,req,status==="SUSPENDIDO"?"TOKEN_SUSPENDIDO":"TOKEN_REACTIVADO",{entidad:"TOKEN",entidadId:Number(req.params.id),despues:{estatus:status}});
    return res.json({ok:true});
  }catch(err){console.error("ADMIN TOKEN STATUS ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible actualizar el token"})}
});

app.patch("/admin-empresas/:id/suspender",auth,async(req,res)=>{
  let connection;
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede suspender folios empresariales"))return;
    const folioId=Number(req.params.id);
    if(!Number.isInteger(folioId)||folioId<1)return res.status(400).json({ok:false,error:"Empresa inválida"});
    connection=await db.getConnection();
    await connection.beginTransaction();
    const [companies]=await connection.query(
      `SELECT fa.id,fa.estatus,e.id AS empresa_id,e.nombre
       FROM folios_acceso fa LEFT JOIN empresas e ON e.folio_acceso_id=fa.id
       WHERE fa.id=? FOR UPDATE`,[folioId]
    );
    const company=companies[0];
    if(!company){await connection.rollback();return res.status(404).json({ok:false,error:"Empresa no encontrada"});}
    if(company.estatus==="SUSPENDIDO"){await connection.rollback();return res.status(409).json({ok:false,error:"El folio de esta empresa ya está suspendido"});}
    if(!["ACTIVO","CONFIGURANDO","USADO"].includes(company.estatus)){
      await connection.rollback();
      return res.status(409).json({ok:false,error:"Este folio no puede suspenderse en su estado actual"});
    }
    await connection.query("UPDATE folios_acceso SET estatus='SUSPENDIDO' WHERE id=?",[folioId]);
    if(company.empresa_id){
      await connection.query("UPDATE cuentas_empresa SET activo=0 WHERE empresa_id=?",[company.empresa_id]);
      await connection.query(
        `INSERT INTO suspensiones_colaborador(persona_id,empresa_id)
         SELECT id,empresa_id FROM personas_curso WHERE empresa_id=?
         ON DUPLICATE KEY UPDATE empresa_id=VALUES(empresa_id)`,[company.empresa_id]
      );
      await connection.query(
        "DELETE s FROM sessions s JOIN personas_curso pc ON pc.user_id=s.userId WHERE pc.empresa_id=?",[company.empresa_id]
      );
      await connection.query("DELETE FROM sesiones_empresa WHERE empresa_id=?",[company.empresa_id]);
      await connection.query("DELETE FROM sesiones_registro_empresa WHERE folio_acceso_id=?",[folioId]);
    }
    await auditEvent(connection,req,"EMPRESA_Y_ACCESOS_SUSPENDIDOS",{empresaId:company.empresa_id,entidad:"EMPRESA",entidadId:company.empresa_id,folio:String(folioId),antes:{estatus:company.estatus},despues:{estatus:"SUSPENDIDO"},detalle:"Se suspendieron cuentas y colaboradores vinculados"});
    await connection.commit();
    return res.json({ok:true,empresa:company.nombre||null});
  }catch(err){
    if(connection)await connection.rollback();
    console.error("ADMIN COMPANY SUSPEND ERROR:",err);
    return res.status(500).json({ok:false,error:"No fue posible suspender el folio empresarial"});
  }finally{if(connection)connection.release()}
});

app.patch("/admin-empresas/:id/reactivar",auth,async(req,res)=>{
  let connection;
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede reactivar folios empresariales"))return;
    const folioId=Number(req.params.id);
    if(!Number.isInteger(folioId)||folioId<1)return res.status(400).json({ok:false,error:"Empresa invalida"});
    connection=await db.getConnection();
    await connection.beginTransaction();
    const [companies]=await connection.query(`SELECT fa.id,fa.estatus,fa.caducidad,e.id AS empresa_id FROM folios_acceso fa LEFT JOIN empresas e ON e.folio_acceso_id=fa.id WHERE fa.id=? FOR UPDATE`,[folioId]);
    const company=companies[0];
    if(!company){await connection.rollback();return res.status(404).json({ok:false,error:"Empresa no encontrada"});}
    if(company.estatus!=="SUSPENDIDO"){await connection.rollback();return res.status(409).json({ok:false,error:"El folio no esta suspendido"});}
    if(new Date(company.caducidad).getTime()<Date.now()){await connection.rollback();return res.status(409).json({ok:false,error:"No es posible reactivar un folio vencido"});}
    let status="ACTIVO";
    if(company.empresa_id){
      const [accounts]=await connection.query("SELECT id FROM cuentas_empresa WHERE empresa_id=? LIMIT 1",[company.empresa_id]);
      status=accounts.length?"USADO":"CONFIGURANDO";
      await connection.query("UPDATE cuentas_empresa SET activo=1 WHERE empresa_id=?",[company.empresa_id]);
      await connection.query("DELETE FROM suspensiones_colaborador WHERE empresa_id=?",[company.empresa_id]);
    }
    await connection.query("UPDATE folios_acceso SET estatus=? WHERE id=?",[status,folioId]);
    await auditEvent(connection,req,"EMPRESA_Y_ACCESOS_REACTIVADOS",{empresaId:company.empresa_id,entidad:"EMPRESA",entidadId:company.empresa_id,folio:String(folioId),antes:{estatus:"SUSPENDIDO"},despues:{estatus:status},detalle:"Se reactivaron cuentas y colaboradores vinculados"});
    await connection.commit();
    return res.json({ok:true,estatus:status});
  }catch(err){if(connection)await connection.rollback();console.error("ADMIN COMPANY REACTIVATE ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible reactivar los accesos"});}
  finally{if(connection)connection.release();}
});

app.get("/admin-users",auth,async(req,res)=>{
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede gestionar usuarios internos"))return;
    const isSuper=req.admin.rol==="SUPERADMIN";
    const [users]=await db.query(`SELECT id,name,usuario,rol,activo,creado_en FROM admins ${isSuper?"":"WHERE rol<>'SUPERADMIN'"} ORDER BY creado_en DESC`);
    return res.json({ok:true,users});
  }catch(err){console.error("ADMIN USERS ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible cargar los usuarios"})}
});

app.post("/admin-users",auth,async(req,res)=>{
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede crear usuarios internos"))return;
    const name=String(req.body.name||"").trim();
    const usuario=String(req.body.usuario||"").trim().toLowerCase();
    const password=String(req.body.password||"");
    const rol=String(req.body.rol||"VISOR").trim().toUpperCase();
    if(name.length<3||!/^[-_.a-z0-9]{4,40}$/.test(usuario)||password.length<8){
      return res.status(400).json({ok:false,error:"Captura nombre, usuario de 4 caracteres y contraseña de al menos 8 caracteres"});
    }
    if(!["ADMINISTRADOR","AUDITOR","VISOR"].includes(rol)||!canManageInternalRole(req.admin.rol,rol)){
      return res.status(403).json({ok:false,error:"No tienes permiso para crear ese perfil"});
    }
    const salt=crypto.randomBytes(16).toString("hex");
    const passwordHash=crypto.scryptSync(password,salt,64).toString("hex");
    const [result]=await db.query(
      `INSERT INTO admins(name,usuario,pin,password_hash,password_salt,rol,activo)
       VALUES(?,?,NULL,?,?,?,1)`,[name,usuario,passwordHash,salt,rol]
    );
    await auditEvent(db,req,"USUARIO_INTERNO_CREADO",{entidad:"ADMIN",entidadId:result.insertId,despues:{nombre:name,usuario,rol,activo:true}});
    return res.status(201).json({ok:true,id:result.insertId});
  }catch(err){
    if(err.code==="ER_DUP_ENTRY")return res.status(409).json({ok:false,error:"Ese nombre de usuario ya existe"});
    console.error("ADMIN USER CREATE ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible crear el usuario"});
  }
});

app.patch("/admin-users/:id/status",auth,async(req,res)=>{
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede modificar usuarios internos"))return;
    const activo=req.body.activo?1:0,id=Number(req.params.id);
    if(id===Number(req.admin.id))return res.status(409).json({ok:false,error:"No puedes desactivar tu propia cuenta"});
    const [[target]]=await db.query("SELECT id,rol FROM admins WHERE id=? LIMIT 1",[id]);
    if(!target||!canManageInternalRole(req.admin.rol,target.rol))return res.status(403).json({ok:false,error:"No tienes permiso para modificar este usuario"});
    const [result]=await db.query("UPDATE admins SET activo=? WHERE id=?",[activo,id]);
    if(!result.affectedRows)return res.status(404).json({ok:false,error:"Usuario de gestión no encontrado"});
    if(!activo)await db.query("DELETE FROM admin_sessions WHERE admin_id=?",[id]);
    await auditEvent(db,req,activo?"USUARIO_INTERNO_REACTIVADO":"USUARIO_INTERNO_SUSPENDIDO",{entidad:"ADMIN",entidadId:id,despues:{activo:Boolean(activo)}});
    return res.json({ok:true});
  }catch(err){console.error("ADMIN USER STATUS ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible actualizar el usuario"})}
});

/* Banco de preguntas. Los exámenes aprobados conservan su propia copia de
   preguntas y respuestas, por lo que editar este catálogo no altera auditorías
   ni constancias ya emitidas. */
function normalizeExamQuestion(input={}){
  const question=String(input.question||"").trim();
  const options={
    A:String(input.option_a||input.options?.A||"").trim(),
    B:String(input.option_b||input.options?.B||"").trim(),
    C:String(input.option_c||input.options?.C||"").trim(),
    D:String(input.option_d||input.options?.D||"").trim()
  };
  const correct=String(input.correct||input.respuesta_correcta||"").trim().toUpperCase();
  if(question.length<8||question.length>4000)throw new Error("La pregunta debe tener entre 8 y 4,000 caracteres");
  if(!options.A||!options.B||!options.C)throw new Error("Las opciones A, B y C son obligatorias");
  if(Object.values(options).some(value=>value.length>4000))throw new Error("Cada opción puede tener hasta 4,000 caracteres");
  if(!["A","B","C","D"].includes(correct)||!options[correct])throw new Error("Selecciona una respuesta correcta que tenga contenido");
  return {question,options,correct};
}
function requireQuestionAdmin(req,res){
  return requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede gestionar el banco de preguntas");
}

app.get("/admin-questions",auth,async(req,res)=>{
  try{
    if(!requireQuestionAdmin(req,res))return;
    const q=String(req.query.q||"").trim();
    const estado=String(req.query.estado||"").toLowerCase();
    const filters=[],values=[];
    if(q){filters.push("(question LIKE ? OR option_a LIKE ? OR option_b LIKE ? OR option_c LIKE ? OR option_d LIKE ?)");const term=`%${q}%`;values.push(term,term,term,term,term)}
    if(estado==="active"){filters.push("active=1")}else if(estado==="inactive"){filters.push("active=0")}
    const where=filters.length?`WHERE ${filters.join(" AND ")}`:"";
    const [statsRows]=await db.query("SELECT COUNT(*) total,SUM(active=1) active,SUM(active=0) inactive FROM questions");
    const stats={total:Number(statsRows[0].total||0),active:Number(statsRows[0].active||0),inactive:Number(statsRows[0].inactive||0),minimo:15};
    if(String(req.query.export||"")==="1"){
      const [questions]=await db.query(`SELECT id,question,option_a,option_b,option_c,option_d,correct,active,source_document,creado_en FROM questions ${where} ORDER BY id DESC LIMIT 10000`,values);
      return res.json({ok:true,questions,stats});
    }
    const page=Math.max(1,Number(req.query.page)||1),pageSize=20,offset=(page-1)*pageSize;
    const [[count]]=await db.query(`SELECT COUNT(*) total FROM questions ${where}`,values);
    const [questions]=await db.query(`SELECT id,question,option_a,option_b,option_c,option_d,correct,active,source_document,creado_en FROM questions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,[...values,pageSize,offset]);
    return res.json({ok:true,questions,stats,pagination:{page,pageSize,total:Number(count.total||0)}});
  }catch(err){console.error("ADMIN QUESTIONS LIST ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible consultar el banco de preguntas"})}
});

app.post("/admin-questions",auth,async(req,res)=>{
  try{
    if(!requireQuestionAdmin(req,res))return;
    const item=normalizeExamQuestion(req.body),active=req.body.active===false||req.body.active===0||req.body.active==="0"?0:1;
    const sourceDocument=Number(req.body.source_document)||null;
    const [result]=await db.query("INSERT INTO questions(question,option_a,option_b,option_c,option_d,correct,active,source_document) VALUES(?,?,?,?,?,?,?,?)",[item.question,item.options.A,item.options.B,item.options.C,item.options.D||null,item.correct,active,sourceDocument]);
    await auditEvent(db,req,"PREGUNTA_EXAMEN_CREADA",{entidad:"PREGUNTA",entidadId:result.insertId,despues:{id:result.insertId,pregunta:item.question,respuestaCorrecta:item.correct,activa:Boolean(active)}});
    return res.status(201).json({ok:true,id:result.insertId});
  }catch(err){if(err.code==="ER_DUP_ENTRY")return res.status(409).json({ok:false,error:"Ya existe una pregunta con ese texto"});if(err.message)return res.status(400).json({ok:false,error:err.message});console.error("ADMIN QUESTION CREATE ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible crear la pregunta"})}
});

app.patch("/admin-questions/:id",auth,async(req,res)=>{
  let connection;
  try{
    if(!requireQuestionAdmin(req,res))return;
    const id=Number(req.params.id),item=normalizeExamQuestion(req.body),active=req.body.active===false||req.body.active===0||req.body.active==="0"?0:1,sourceDocument=Number(req.body.source_document)||null;
    if(!Number.isInteger(id)||id<1)return res.status(400).json({ok:false,error:"Pregunta no válida"});
    connection=await db.getConnection();await connection.beginTransaction();
    const [[before]]=await connection.query("SELECT id,question,option_a,option_b,option_c,option_d,correct,active,source_document FROM questions WHERE id=? FOR UPDATE",[id]);
    if(!before){await connection.rollback();return res.status(404).json({ok:false,error:"Pregunta no encontrada"})}
    if(before.active&&!active){const [[count]]=await connection.query("SELECT COUNT(*) total FROM questions WHERE active=1");if(Number(count.total)<=15){await connection.rollback();return res.status(409).json({ok:false,error:"Debe conservarse un mínimo de 15 preguntas activas"})}}
    await connection.query("UPDATE questions SET question=?,option_a=?,option_b=?,option_c=?,option_d=?,correct=?,active=?,source_document=? WHERE id=?",[item.question,item.options.A,item.options.B,item.options.C,item.options.D||null,item.correct,active,sourceDocument,id]);
    await auditEvent(connection,req,"PREGUNTA_EXAMEN_ACTUALIZADA",{entidad:"PREGUNTA",entidadId:id,antes:{pregunta:before.question,respuestaCorrecta:before.correct,activa:Boolean(before.active)},despues:{pregunta:item.question,respuestaCorrecta:item.correct,activa:Boolean(active)}});
    await connection.commit();return res.json({ok:true});
  }catch(err){if(connection)await connection.rollback();if(err.code==="ER_DUP_ENTRY")return res.status(409).json({ok:false,error:"Ya existe una pregunta con ese texto"});if(err.message)return res.status(400).json({ok:false,error:err.message});console.error("ADMIN QUESTION UPDATE ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible actualizar la pregunta"})}
  finally{if(connection)connection.release();}
});

app.patch("/admin-questions/:id/status",auth,async(req,res)=>{
  let connection;
  try{
    if(!requireQuestionAdmin(req,res))return;
    const id=Number(req.params.id),active=req.body.active?1:0;
    connection=await db.getConnection();await connection.beginTransaction();
    const [[question]]=await connection.query("SELECT id,question,active FROM questions WHERE id=? FOR UPDATE",[id]);
    if(!question){await connection.rollback();return res.status(404).json({ok:false,error:"Pregunta no encontrada"})}
    if(!active&&question.active){const [[count]]=await connection.query("SELECT COUNT(*) total FROM questions WHERE active=1");if(Number(count.total)<=15){await connection.rollback();return res.status(409).json({ok:false,error:"Debe conservarse un mínimo de 15 preguntas activas"})}}
    await connection.query("UPDATE questions SET active=? WHERE id=?",[active,id]);
    await auditEvent(connection,req,active?"PREGUNTA_EXAMEN_ACTIVADA":"PREGUNTA_EXAMEN_DESACTIVADA",{entidad:"PREGUNTA",entidadId:id,antes:{activa:Boolean(question.active)},despues:{activa:Boolean(active)},detalle:question.question});
    await connection.commit();return res.json({ok:true});
  }catch(err){if(connection)await connection.rollback();console.error("ADMIN QUESTION STATUS ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible actualizar el estado"})}
  finally{if(connection)connection.release();}
});

app.post("/admin-questions/import",auth,async(req,res)=>{
  let connection;
  try{
    if(!requireQuestionAdmin(req,res))return;
    const rows=Array.isArray(req.body.rows)?req.body.rows:[];
    if(!rows.length)return res.status(400).json({ok:false,error:"El archivo no contiene preguntas"});
    if(rows.length>200)return res.status(400).json({ok:false,error:"Puedes importar hasta 200 preguntas por archivo"});
    connection=await db.getConnection();await connection.beginTransaction();
    let creadas=0,ignoradas=0;const errores=[];
    for(let index=0;index<rows.length;index++){
      try{
        const item=normalizeExamQuestion(rows[index]);
        const active=["0","false","no","inactivo","inactive"].includes(String(rows[index].activo??rows[index].active??"1").trim().toLowerCase())?0:1;
        const sourceDocument=Number(rows[index].source_document)||null;
        await connection.query("INSERT INTO questions(question,option_a,option_b,option_c,option_d,correct,active,source_document) VALUES(?,?,?,?,?,?,?,?)",[item.question,item.options.A,item.options.B,item.options.C,item.options.D||null,item.correct,active,sourceDocument]);
        creadas++;
      }catch(error){if(error.code==="ER_DUP_ENTRY")ignoradas++;else errores.push({fila:index+2,error:error.message||"Formato inválido"})}
    }
    if(!creadas&&errores.length){await connection.rollback();return res.status(400).json({ok:false,error:"No se pudo importar ninguna pregunta",creadas,ignoradas,errores})}
    await auditEvent(connection,req,"BANCO_PREGUNTAS_IMPORTADO",{entidad:"PREGUNTAS",despues:{creadas,ignoradas,errores:errores.length},detalle:`Importación de ${creadas} pregunta(s)`});
    await connection.commit();return res.json({ok:true,creadas,ignoradas,errores});
  }catch(err){if(connection)await connection.rollback();console.error("ADMIN QUESTIONS IMPORT ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible importar el banco de preguntas"})}
  finally{if(connection)connection.release();}
});

app.get("/admin-personas/:id/constancia",auth,async(req,res)=>{
  try{
    if(!req.isAdmin) return res.status(403).json({error:"No autorizado"});
    const [rows]=await db.query(`SELECT pc.folio,pc.nombres,pc.apellido_paterno,pc.apellido_materno,e.nombre AS empresa,u.exam,u.fecha,u.aprobado,u.photo,u.foto_estatus FROM personas_curso pc JOIN empresas e ON e.id=pc.empresa_id JOIN users u ON u.id=pc.user_id WHERE pc.id=? LIMIT 1`,[Number(req.params.id)]);
    const person=rows[0];
    if(!person) return res.status(404).json({error:"Persona no encontrada"});
    if(!person.aprobado||!person.photo||person.foto_estatus!=="APROBADA") return res.status(403).json({error:"Constancia pendiente de aprobación de fotografía"});
    await auditEvent(db,req,"CONSTANCIA_DESCARGADA",{personaId:Number(req.params.id),folio:person.folio,entidad:"CONSTANCIA",entidadId:Number(req.params.id),detalle:"Descarga desde administracion"});
    await generateCertificatePdf(req,res,person,"attachment");
  }catch(err){console.error("ADMIN CERT ERROR:",err);if(!res.headersSent)return res.status(500).json({error:"No fue posible generar la constancia"});res.end();}
});

app.get("/admin-personas/:id/fotografia",auth,async(req,res)=>{
  try{
    if(!req.isAdmin)return res.status(403).json({error:"No autorizado"});
    const [rows]=await db.query(
      `SELECT pc.id,pc.empresa_id,pc.folio,u.photo,u.photo_data,u.photo_mime,u.aprobado,u.foto_estatus
       FROM personas_curso pc JOIN users u ON u.id=pc.user_id
       WHERE pc.id=? LIMIT 1`,[Number(req.params.id)]
    );
    const person=rows[0];
    if(!person||!person.aprobado||!person.photo||!['PENDIENTE','APROBADA'].includes(person.foto_estatus))return res.status(404).json({error:"Fotografía no disponible"});
    await auditEvent(db,req,req.query.preview==="1"?"FOTOGRAFIA_CONSULTADA":"FOTOGRAFIA_DESCARGADA",{empresaId:person.empresa_id,personaId:person.id,folio:person.folio,entidad:"FOTOGRAFIA",entidadId:person.id});
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
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede validar fotografías"))return;
    const decision=String(req.body.decision||"").toUpperCase();
    const motivo=String(req.body.motivo||"").trim();
    if(!["ACEPTAR","RECHAZAR"].includes(decision))return res.status(400).json({ok:false,error:"Decisión inválida"});
    if(decision==="RECHAZAR"&&motivo.length<5)return res.status(400).json({ok:false,error:"Indica el motivo del rechazo"});
    connection=await db.getConnection();await connection.beginTransaction();
    const [rows]=await connection.query(
      `SELECT pc.id,pc.empresa_id,pc.folio,pc.nombres,pc.apellido_paterno,pc.apellido_materno,
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
      await auditEvent(connection,req,"FOTOGRAFIA_APROBADA",{empresaId:person.empresa_id,personaId:person.id,folio:person.folio,entidad:"FOTOGRAFIA",entidadId:person.user_id,despues:{estatus:"APROBADA"}});
      await connection.commit();
      const nombre=[person.nombres,person.apellido_paterno,person.apellido_materno].filter(Boolean).join(" ");
      const subject=`Fotografía aceptada - ${nombre}`;
      let emailSent=false,emailError="";
      try{
        const transporter=createMailTransport();
        if(!transporter)throw new Error("SMTP no configurado");
        await transporter.sendMail({
          from:process.env.MAIL_FROM||process.env.SMTP_USER,
          to:person.correo_1,
          subject,
          text:`La fotografía de ${nombre}, folio ${person.folio}, fue aceptada. El curso ha quedado concluido y la constancia ya está disponible en el portal de la empresa.`
        });
        emailSent=true;
      }catch(mailErr){emailError=mailErr.message;console.error("PHOTO ACCEPTANCE EMAIL ERROR:",mailErr.message)}
      await db.query(
        `INSERT INTO notificaciones_correo(tipo,destinatario,asunto,persona_id,estatus,detalle)
         VALUES('FOTO_ACEPTADA',?,?,?,?,?)`,
        [person.correo_1,subject,person.id,emailSent?"ENVIADO":"ERROR",emailSent?"Notificación enviada":emailError]
      );
      return res.json({
        ok:true,
        decision:"APROBADA",
        emailSent,
        email:person.correo_1,
        warning:emailSent?null:"La fotografía fue aceptada, pero el correo no pudo enviarse: "+emailError
      });
    }
    const [rejectionCountRows]=await connection.query(
      "SELECT COUNT(*) AS total FROM notificaciones_correo WHERE persona_id=? AND tipo='FOTO_RECHAZADA'",
      [person.id]
    );
    const requiereTomaFisica=Number(rejectionCountRows[0]?.total||0)>=2;
    await connection.query(
      "UPDATE users SET photo=NULL,photo_data=NULL,photo_mime=NULL,foto_estatus='RECHAZADA',foto_revisada_en=NOW(),foto_revisada_por=?,foto_motivo_rechazo=? WHERE id=?",
      [req.admin.id,motivo,person.user_id]
    );
    if(requiereTomaFisica){
      await connection.query(
        "INSERT INTO fotografias_toma_fisica(user_id) VALUES(?) ON DUPLICATE KEY UPDATE solicitado_en=solicitado_en",
        [person.user_id]
      );
    }
    await auditEvent(connection,req,"FOTOGRAFIA_RECHAZADA",{empresaId:person.empresa_id,personaId:person.id,folio:person.folio,entidad:"FOTOGRAFIA",entidadId:person.user_id,despues:{estatus:"RECHAZADA",tomaFisica:requiereTomaFisica},detalle:motivo});
    await connection.commit();
    if(person.photo&&person.photo!=="DB"){
      const oldPhoto=path.resolve(__dirname,person.photo),uploadsRoot=path.resolve(__dirname,"uploads");
      if(oldPhoto.startsWith(uploadsRoot+path.sep))fs.unlink(oldPhoto,()=>{});
    }
    const nombre=[person.nombres,person.apellido_paterno,person.apellido_materno].filter(Boolean).join(" ");
    const subject=requiereTomaFisica?`Toma física de fotografía requerida - ${nombre}`:`Fotografía rechazada - ${nombre}`;
    let emailSent=false,emailError="";
    try{
      const transporter=createMailTransport();
      if(!transporter)throw new Error("SMTP no configurado");
      await transporter.sendMail({
        from:process.env.MAIL_FROM||process.env.SMTP_USER,
        to:person.correo_1,
        subject,
        text:requiereTomaFisica?`La fotografía de ${nombre}, folio ${person.folio}, fue rechazada por tercera ocasión. El colaborador debe presentarse al módulo TIA para la toma física de la fotografía. Motivo del último rechazo: ${motivo}.`:`La fotografía de ${nombre}, folio ${person.folio}, fue rechazada. Motivo: ${motivo}. El colaborador debe ingresar nuevamente al módulo TIA y tomarse una nueva fotografía.`,
        html:requiereTomaFisica?`<p>La fotografía del colaborador <strong>${nombre}</strong>, folio <strong>${person.folio}</strong>, fue rechazada por tercera ocasión.</p><p><strong>El colaborador debe presentarse al módulo TIA para la toma física de la fotografía.</strong></p><p><strong>Motivo del último rechazo:</strong> ${motivo.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}</p>`:`<p>La fotografía del colaborador <strong>${nombre}</strong>, folio <strong>${person.folio}</strong>, fue rechazada.</p><p><strong>Motivo:</strong> ${motivo.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}</p><p>El colaborador debe ingresar nuevamente al módulo TIA con su folio y tomarse una nueva fotografía.</p>`
      });
      emailSent=true;
    }catch(mailErr){emailError=mailErr.message;console.error("PHOTO REJECTION EMAIL ERROR:",mailErr.message)}
    await db.query(
      `INSERT INTO notificaciones_correo(tipo,destinatario,asunto,persona_id,estatus,detalle)
       VALUES(?,?,?,?,?,?)`,
      [requiereTomaFisica?"FOTO_TOMA_FISICA":"FOTO_RECHAZADA",person.correo_1,subject,person.id,emailSent?"ENVIADO":"ERROR",emailSent?"Notificación enviada":emailError]
    );
    return res.json({ok:true,decision:"RECHAZADA",requiereTomaFisica,emailSent,email:person.correo_1,warning:emailSent?null:"La fotografía fue rechazada, pero el correo no pudo enviarse: "+emailError});
  }catch(err){if(connection)await connection.rollback();console.error("PHOTO REVIEW ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible revisar la fotografía"})}
  finally{if(connection)connection.release()}
});

/* Kiosco de llegada: el folio sólo puede registrarse cuando ya fue enviado a toma física. */
app.post("/toma-fisica/llegada",accessLoginLimiter,async(req,res)=>{
  try{
    const folio=String(req.body.folio||"").trim().toUpperCase();
    if(!folio)return res.status(400).json({ok:false,error:"Captura tu folio personal"});
    const [rows]=await db.query(`SELECT u.id AS user_id,u.name,u.folio,pc.id AS persona_id,pc.empresa_id,tf.llegada_en,tf.atendido_en
      FROM users u JOIN personas_curso pc ON pc.user_id=u.id JOIN fotografias_toma_fisica tf ON tf.user_id=u.id
      WHERE u.folio=? LIMIT 1`,[folio]);
    const person=rows[0];
    if(!person)return res.status(404).json({ok:false,error:"Este folio no tiene una toma física pendiente"});
    if(person.atendido_en)return res.json({ok:true,completed:true,message:"La toma física de este folio ya fue concluida."});
    const already=Boolean(person.llegada_en);
    if(!already){
      await db.query("UPDATE fotografias_toma_fisica SET llegada_en=NOW() WHERE user_id=? AND llegada_en IS NULL",[person.user_id]);
      await auditEvent(db,req,"TOMA_FISICA_LLEGADA_REGISTRADA",{actor:{tipo:"COLABORADOR",id:person.user_id,nombre:person.name},empresaId:person.empresa_id,personaId:person.persona_id,folio:person.folio,entidad:"TOMA_FISICA",entidadId:person.user_id,detalle:"Llegada registrada desde kiosco"});
    }
    return res.json({ok:true,already,nombre:String(person.name||"").split(" ")[0]||"Colaborador"});
  }catch(err){console.error("PHYSICAL CHECKIN ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible registrar la llegada"});}
});


// ACCESO DE USUARIO MEDIANTE FOLIO PREVIAMENTE REGISTRADO
app.post("/folio-login", accessLoginLimiter, async (req, res) => {
  try {
    const folio = String(req.body.folio || "").trim().toUpperCase();
    if (!folio) return res.status(400).json({ ok: false, message: "El folio es requerido" });

    // El folio estable de la persona vive en personas_curso y nunca cambia.
    const [registeredPeople] = await db.query(
      `SELECT u.id,u.name,pc.folio,u.aprobado,u.photo,u.foto_registrada_en,u.foto_estatus,sc.persona_id AS suspendida
       FROM personas_curso pc JOIN users u ON u.id=pc.user_id
       LEFT JOIN suspensiones_colaborador sc ON sc.persona_id=pc.id
       WHERE UPPER(pc.folio)=? LIMIT 1`,
      [folio]
    );
    if (registeredPeople.length && registeredPeople[0].suspendida) {
      return res.status(403).json({ ok:false, suspended:true, message:"El acceso de este colaborador está suspendido. Esta acción no constituye una baja formal; la empresa debe concluirla en el módulo TIA." });
    }
    if (registeredPeople.length && registeredPeople[0].aprobado && registeredPeople[0].photo && registeredPeople[0].foto_estatus==="APROBADA") {
      return res.status(403).json({
        ok: false,
        completed: true,
        message: "Este colaborador ya concluyó el curso y registró su fotografía. Su constancia está disponible con la empresa."
      });
    }

    // Los folios personales activos entran directamente al curso.
    const [people] = await db.query(
      `SELECT u.id,u.name,pc.id AS persona_id,pc.empresa_id,pc.folio,u.aprobado,u.photo,u.foto_estatus
       FROM personas_curso pc JOIN users u ON u.id=pc.user_id
       LEFT JOIN suspensiones_colaborador sc ON sc.persona_id=pc.id
       WHERE UPPER(pc.folio)=? AND sc.persona_id IS NULL LIMIT 1`,
      [folio]
    );
    if (people.length) {
      const user = people[0];
      const token = crypto.randomBytes(32).toString("hex");
      await db.query(
        "INSERT INTO sessions (token, userId, expires) VALUES (?, ?, ?)",
        [token, user.id, COLLABORATOR_SESSION_EXPIRES]
      );
      await auditEvent(db,req,"INICIO_SESION_COLABORADOR",{actor:{tipo:"COLABORADOR",id:user.id,nombre:user.name},empresaId:user.empresa_id,personaId:user.persona_id,folio:user.folio,entidad:"COLABORADOR",entidadId:user.persona_id});
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
    await auditEvent(connection,req,"EMPRESA_REGISTRADA",{empresaId:empresaResult.insertId,entidad:"EMPRESA",entidadId:empresaResult.insertId,folio:String(folioId),despues:{nombre:values.nombre,razonSocial:values.razonSocial,representanteLegal:values.representanteLegal}});
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

async function getEmpresaManagementSession(connection, token, forUpdate = false) {
  const [sessions] = await connection.query(
    `SELECT se.empresa_id, se.cuenta_empresa_id, e.nombre AS empresa, e.correo_1,
            ce.nombre AS administrador, ce.usuario
     FROM sesiones_empresa se
     JOIN empresas e ON e.id=se.empresa_id
     JOIN cuentas_empresa ce ON ce.id=se.cuenta_empresa_id AND ce.empresa_id=se.empresa_id
     WHERE se.token=? AND se.proposito='GESTIONAR_PERSONAS'
       AND se.usado_en IS NULL AND se.expira_en>NOW() AND ce.activo=1
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [token]
  );
  return sessions[0] || null;
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
    const [accountResult] = await connection.query(
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
      `INSERT INTO sesiones_empresa (token, empresa_id, cuenta_empresa_id, proposito, expira_en)
       VALUES (?, ?, ?, 'GESTIONAR_PERSONAS', DATE_ADD(NOW(), INTERVAL 8 HOUR))`,
      [personaToken, empresaId, accountResult.insertId]
    );
    await auditEvent(connection,req,"CUENTA_EMPRESA_CONFIGURADA",{actor:{tipo:"EMPRESA",id:accountResult.insertId,nombre:usuario},empresaId,entidad:"CUENTA_EMPRESA",entidadId:accountResult.insertId,despues:{usuario,activo:true}});
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
      `SELECT e.id AS empresa_id, ce.id AS cuenta_empresa_id, ce.password_hash, ce.password_salt, ce.activo
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
      `INSERT INTO sesiones_empresa (token, empresa_id, cuenta_empresa_id, proposito, expira_en)
       VALUES (?, ?, ?, 'GESTIONAR_PERSONAS', DATE_ADD(NOW(), INTERVAL 8 HOUR))`,
      [token, account.empresa_id, account.cuenta_empresa_id]
    );
    await auditEvent(db,req,"INICIO_SESION_EMPRESA",{actor:{tipo:"EMPRESA",id:account.cuenta_empresa_id,nombre:usuario},empresaId:account.empresa_id,entidad:"CUENTA_EMPRESA",entidadId:account.cuenta_empresa_id});
    return res.json({ ok: true, token });
  } catch (err) {
    console.error("ERROR login-empresa:", err);
    return res.status(500).json({ ok: false, message: "No fue posible iniciar sesion" });
  }
});

app.get("/empresa-cuentas", async (req, res) => {
  return res.status(403).json({ ok:false, message:"La gestión de cuentas está disponible únicamente para el administrador del sistema" });
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const session = await getEmpresaManagementSession(db, token);
    if (!session) return res.status(401).json({ ok:false, message:"Sesion expirada" });
    const [accounts] = await db.query(
      `SELECT id,nombre,usuario,activo,creado_en,actualizado_en
       FROM cuentas_empresa WHERE empresa_id=? ORDER BY activo DESC, creado_en ASC`,
      [session.empresa_id]
    );
    return res.json({ ok:true, cuentas:accounts, cuentaActualId:session.cuenta_empresa_id });
  } catch (err) {
    console.error("ERROR empresa-cuentas:", err);
    return res.status(500).json({ ok:false, message:"No fue posible consultar las cuentas" });
  }
});

app.post("/empresa-cuentas", async (req, res) => {
  return res.status(403).json({ ok:false, message:"La gestión de cuentas está disponible únicamente para el administrador del sistema" });
  let connection;
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const nombre = String(req.body.nombre || "").trim();
    const usuario = String(req.body.usuario || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!nombre || nombre.length > 120) return res.status(400).json({ ok:false, message:"Indica el nombre del administrador" });
    if (!/^[a-z0-9._-]{4,80}$/.test(usuario)) return res.status(400).json({ ok:false, message:"El usuario debe tener al menos 4 caracteres y usar letras, numeros, punto, guion o guion bajo" });
    if (password.length < 8) return res.status(400).json({ ok:false, message:"La contrasena debe tener al menos 8 caracteres" });

    connection = await db.getConnection();
    await connection.beginTransaction();
    const session = await getEmpresaManagementSession(connection, token, true);
    if (!session) {
      await connection.rollback();
      return res.status(401).json({ ok:false, message:"Sesion expirada" });
    }
    const salt = crypto.randomBytes(16).toString("hex");
    const [result] = await connection.query(
      `INSERT INTO cuentas_empresa (empresa_id,nombre,usuario,password_hash,password_salt)
       VALUES (?,?,?,?,?)`,
      [session.empresa_id, nombre, usuario, hashPassword(password, salt), salt]
    );
    await connection.commit();
    return res.status(201).json({ ok:true, cuenta:{ id:result.insertId, nombre, usuario, activo:1 } });
  } catch (err) {
    if (connection) await connection.rollback();
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ ok:false, message:"El nombre de usuario ya existe" });
    console.error("ERROR crear-cuenta-empresa:", err);
    return res.status(500).json({ ok:false, message:"No fue posible crear la cuenta" });
  } finally {
    if (connection) connection.release();
  }
});

app.patch("/empresa-cuentas/:id/estado", async (req, res) => {
  return res.status(403).json({ ok:false, message:"La gestión de cuentas está disponible únicamente para el administrador del sistema" });
  let connection;
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const accountId = Number(req.params.id);
    const activo = req.body.activo === true || req.body.activo === 1 || req.body.activo === "1";
    if (!Number.isInteger(accountId) || accountId < 1) return res.status(400).json({ ok:false, message:"Cuenta invalida" });

    connection = await db.getConnection();
    await connection.beginTransaction();
    const session = await getEmpresaManagementSession(connection, token, true);
    if (!session) {
      await connection.rollback();
      return res.status(401).json({ ok:false, message:"Sesion expirada" });
    }
    if (!activo && accountId === Number(session.cuenta_empresa_id)) {
      await connection.rollback();
      return res.status(409).json({ ok:false, message:"No puedes suspender tu propia cuenta" });
    }
    const [accounts] = await connection.query(
      "SELECT id,nombre,usuario,activo FROM cuentas_empresa WHERE id=? AND empresa_id=? FOR UPDATE",
      [accountId, session.empresa_id]
    );
    const account = accounts[0];
    if (!account) {
      await connection.rollback();
      return res.status(404).json({ ok:false, message:"Cuenta no encontrada" });
    }
    if (Number(account.activo) === Number(activo)) {
      await connection.rollback();
      return res.json({ ok:true, cuenta:account, unchanged:true });
    }
    await connection.query("UPDATE cuentas_empresa SET activo=? WHERE id=?", [activo ? 1 : 0, accountId]);
    if (!activo) await connection.query("DELETE FROM sesiones_empresa WHERE cuenta_empresa_id=?", [accountId]);
    await connection.commit();
    return res.json({ ok:true, cuenta:{ ...account, activo:activo ? 1 : 0 } });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("ERROR estado-cuenta-empresa:", err);
    return res.status(500).json({ ok:false, message:"No fue posible actualizar la cuenta" });
  } finally {
    if (connection) connection.release();
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
    const session = await getEmpresaManagementSession(connection, token, true);
    if (!session) {
      await connection.rollback();
      return res.status(401).json({ ok: false, message: "La sesion expiro" });
    }
    const personFolio = "TIA-P-" + crypto.randomBytes(5).toString("hex").toUpperCase();
    const fullName = [data.nombres, data.apellidoPaterno, data.apellidoMaterno].filter(Boolean).join(" ");
    const [userResult] = await connection.query(
      `INSERT INTO users (name, company, puesto, telefono, correo, folio, loginTime)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [fullName, session.empresa, data.puesto, data.telefono, data.correo, personFolio]
    );
    const [result] = await connection.query(
      `INSERT INTO personas_curso
       (empresa_id,folio,user_id,nombres,apellido_paterno,apellido_materno,puesto,telefono,correo)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [session.empresa_id, personFolio, userResult.insertId, data.nombres,
        data.apellidoPaterno, data.apellidoMaterno || null, data.puesto, data.telefono, data.correo]
    );
    await auditEvent(connection,req,"COLABORADOR_REGISTRADO",{actor:{tipo:"EMPRESA",id:session.cuenta_empresa_id,nombre:session.usuario},empresaId:session.empresa_id,personaId:result.insertId,folio:personFolio,entidad:"COLABORADOR",entidadId:result.insertId,despues:{nombre:fullName,puesto:data.puesto,correo:data.correo}});
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
    const session = await getEmpresaManagementSession(db, token);
    if (!session) return res.status(401).json({ ok: false, message: "Sesion expirada" });
    const [people] = await db.query(
      `SELECT pc.id, pc.folio, pc.nombres, pc.apellido_paterno, pc.apellido_materno,
              pc.puesto, pc.telefono, pc.correo, pc.estatus, pc.creado_en,
              COALESCE(u.aprobado,0) AS aprobado, u.photo, u.foto_registrada_en,u.foto_estatus,u.foto_motivo_rechazo, COALESCE(u.exam,0) AS calificacion,
              u.fecha AS fecha_aprobacion, sc.suspendido_en,
              LEAST(100,COALESCE(SUM(vp.progress),0)/2) AS progreso
       FROM personas_curso pc
       LEFT JOIN users u ON u.id=pc.user_id
       LEFT JOIN suspensiones_colaborador sc ON sc.persona_id=pc.id
       LEFT JOIN video_progress vp ON vp.userId=u.id
       WHERE pc.empresa_id=?
       GROUP BY pc.id,u.id ORDER BY pc.creado_en DESC`,
      [session.empresa_id]
    );
    return res.json({ ok: true, empresa: session.empresa, personas: people });
  } catch (err) {
    console.error("ERROR empresa-personas:", err);
    return res.status(500).json({ ok: false, message: "No fue posible consultar las personas" });
  }
});

app.post("/empresa-personas/:id/suspender", async (req, res) => {
  let connection;
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const personId = Number(req.params.id);
    if (!token || !Number.isInteger(personId) || personId < 1) {
      return res.status(400).json({ ok:false, message:"Solicitud inválida" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    const session = await getEmpresaManagementSession(connection, token, true);
    if (!session) {
      await connection.rollback();
      return res.status(401).json({ ok:false, message:"Sesión expirada" });
    }
    const empresa = session;
    const [people] = await connection.query(
      `SELECT pc.id,pc.folio,pc.nombres,pc.apellido_paterno,pc.apellido_materno,u.id AS user_id
       FROM personas_curso pc JOIN users u ON u.id=pc.user_id
       WHERE pc.id=? AND pc.empresa_id=? FOR UPDATE`, [personId, empresa.empresa_id]
    );
    const person = people[0];
    if (!person) {
      await connection.rollback();
      return res.status(404).json({ ok:false, message:"Colaborador no encontrado" });
    }
    const [existing] = await connection.query(
      "SELECT persona_id FROM suspensiones_colaborador WHERE persona_id=? FOR UPDATE", [person.id]
    );
    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({ ok:false, message:"El acceso de este colaborador ya está suspendido" });
    }
    await connection.query(
      "INSERT INTO suspensiones_colaborador(persona_id,empresa_id) VALUES(?,?)", [person.id, empresa.empresa_id]
    );
    await connection.query("DELETE FROM sessions WHERE userId=?", [person.user_id]);
    await auditEvent(connection,req,"COLABORADOR_SUSPENDIDO",{actor:{tipo:"EMPRESA",id:empresa.cuenta_empresa_id,nombre:empresa.usuario},empresaId:empresa.empresa_id,personaId:person.id,folio:person.folio,entidad:"COLABORADOR",entidadId:person.id,detalle:"Inhabilitacion solicitada por empresa; requiere baja formal en modulo TIA"});
    await connection.commit();

    const nombre = [person.nombres, person.apellido_paterno, person.apellido_materno].filter(Boolean).join(" ");
    const subject = `Suspensión de acceso TIA - ${nombre}`;
    let emailSent = false, emailError = null;
    try {
      const transporter = createMailTransport();
      if (!transporter) throw new Error("SMTP no configurado");
      await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: empresa.correo_1,
        subject,
        html: `<p>Se suspendió el acceso al sistema TIA del colaborador <strong>${nombre}</strong> (folio <strong>${person.folio}</strong>).</p><p><strong>Esta suspensión únicamente inhabilita el perfil en el sistema y no constituye la baja formal del colaborador.</strong></p><p>Para continuar con la baja, deberán acudir al módulo TIA en sitio y entregar el documento de baja junto con la TIA correspondiente. La baja se considera concluida únicamente cuando el módulo TIA confirme el trámite.</p>`
      });
      emailSent = true;
    } catch (mailErr) {
      emailError = mailErr.message;
      console.error("COLLABORATOR SUSPENSION EMAIL ERROR:", emailError);
    }
    await db.query(
      `INSERT INTO notificaciones_correo(tipo,destinatario,asunto,persona_id,estatus,detalle)
       VALUES('SUSPENSION_COLABORADOR',?,?,?,?,?)`,
      [empresa.correo_1, subject, person.id, emailSent ? "ENVIADO" : "ERROR", emailSent ? "Notificación enviada" : emailError]
    );
    return res.json({ ok:true, emailSent, warning:emailSent ? null : "El acceso fue suspendido, pero no se pudo enviar el correo: " + emailError });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("COLLABORATOR SUSPENSION ERROR:", err);
    return res.status(500).json({ ok:false, message:"No fue posible suspender el acceso" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/empresa-personas/:id/reactivar", async (req, res) => {
  let connection;
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const personId = Number(req.params.id);
    if (!token || !Number.isInteger(personId) || personId < 1) {
      return res.status(400).json({ ok:false, message:"Solicitud inválida" });
    }
    connection = await db.getConnection();
    await connection.beginTransaction();
    const session = await getEmpresaManagementSession(connection, token, true);
    if (!session) {
      await connection.rollback();
      return res.status(401).json({ ok:false, message:"Sesión expirada" });
    }
    const [people] = await connection.query(
      "SELECT id,folio FROM personas_curso WHERE id=? AND empresa_id=? FOR UPDATE", [personId, session.empresa_id]
    );
    if (!people.length) {
      await connection.rollback();
      return res.status(404).json({ ok:false, message:"Colaborador no encontrado" });
    }
    const [result] = await connection.query(
      "DELETE FROM suspensiones_colaborador WHERE persona_id=? AND empresa_id=?", [personId, session.empresa_id]
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(409).json({ ok:false, message:"El acceso de este colaborador no está suspendido" });
    }
    await auditEvent(connection,req,"COLABORADOR_REACTIVADO",{actor:{tipo:"EMPRESA",id:session.cuenta_empresa_id,nombre:session.usuario},empresaId:session.empresa_id,personaId:personId,folio:people[0].folio,entidad:"COLABORADOR",entidadId:personId,detalle:"Se conservaron avance y documentos"});
    await connection.commit();
    return res.json({ ok:true, message:"El acceso fue reactivado. El avance y los documentos del colaborador se conservaron." });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("COLLABORATOR REACTIVATION ERROR:", err);
    return res.status(500).json({ ok:false, message:"No fue posible reactivar el acceso" });
  } finally {
    if (connection) connection.release();
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
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f3d5e").text(`FOLIO  ${person.folio}`,160,420,{width:210,align:"center"}).text(`FECHA  ${person.fecha?new Date(person.fecha).toLocaleDateString("es-MX"):"--"}`,415,420,{width:210,align:"center"});
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
       JOIN cuentas_empresa ce ON ce.id=se.cuenta_empresa_id AND ce.empresa_id=se.empresa_id AND ce.activo=1
       JOIN personas_curso pc ON pc.empresa_id=e.id JOIN users u ON u.id=pc.user_id
       WHERE se.token=? AND se.proposito='GESTIONAR_PERSONAS'
         AND se.usado_en IS NULL AND se.expira_en>NOW() AND pc.id=? LIMIT 1`,
      [token, Number(req.params.id)]
    );
    const person = rows[0];
    if (!person) return res.status(404).json({ ok:false, message:"Persona no encontrada" });
    if (!person.aprobado || !person.photo || person.foto_estatus!=="APROBADA") return res.status(403).json({ ok:false, message:"La constancia estará disponible después de aprobar la fotografía" });
    const session=await getEmpresaManagementSession(db,token);
    await auditEvent(db,req,"CONSTANCIA_DESCARGADA",{actor:{tipo:"EMPRESA",id:session?.cuenta_empresa_id,nombre:session?.usuario||"Empresa"},personaId:Number(req.params.id),folio:person.folio,entidad:"CONSTANCIA",entidadId:Number(req.params.id),detalle:"Descarga desde panel empresarial"});
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
    const context=await auditPersonContext(db,req.userId);
    await auditEvent(db,req,"CONSTANCIA_DESCARGADA",{actor:{tipo:"COLABORADOR",id:req.userId,nombre:context.name||"Colaborador"},empresaId:context.empresa_id,personaId:context.persona_id,folio:context.folio,entidad:"CONSTANCIA",entidadId:req.userId,detalle:"Consulta del colaborador"});
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


const COURSE_INTERACTIONS = {
  "0-28": { videoIndex:0, question:"Al detectar una situación que puede afectar la seguridad aeroportuaria, ¿cuál es la acción adecuada?", options:["Reportarla por los canales establecidos y seguir las indicaciones", "Ignorarla si no afecta directamente mi área", "Publicarla en redes sociales"], correct:0 },
  "0-72": { videoIndex:0, question:"¿Por qué es importante cumplir los controles de acceso en zonas restringidas?", options:["Para proteger las operaciones y prevenir accesos no autorizados", "Solo para evitar retrasos administrativos", "Únicamente cuando hay supervisión"], correct:0 },
  "1-28": { videoIndex:1, question:"Ante una credencial o identificación que parece irregular, ¿qué debes hacer?", options:["Informar de inmediato al personal o canal autorizado", "Permitir el acceso para evitar conflictos", "Prestarle mi identificación"], correct:0 },
  "1-72": { videoIndex:1, question:"La seguridad aeroportuaria es responsabilidad de:", options:["Todas las personas que participan en la operación", "Solo el área de seguridad", "Únicamente los supervisores"], correct:0 }
};

app.get("/curso-interacciones", auth, async (req,res) => {
  try {
    if (req.isAdmin) return res.status(403).json({ok:false,error:"Acceso no disponible"});
    const [rows] = await db.query("SELECT checkpoint FROM interacciones_curso WHERE user_id=?",[req.userId]);
    return res.json({ok:true,completed:rows.map(row=>row.checkpoint)});
  } catch(err) { console.error("COURSE INTERACTIONS GET ERROR:",err); return res.status(500).json({ok:false,error:"No fue posible cargar las interacciones"}); }
});

app.post("/curso-interacciones", auth, async (req,res) => {
  try {
    if (req.isAdmin) return res.status(403).json({ok:false,error:"Acceso no disponible"});
    const checkpoint=String(req.body.checkpoint||"");
    const answer=Number(req.body.answer);
    const interaction=COURSE_INTERACTIONS[checkpoint];
    if(!interaction||!Number.isInteger(answer))return res.status(400).json({ok:false,error:"Interacción inválida"});
    if(answer!==interaction.correct)return res.status(422).json({ok:false,correct:false,error:"Respuesta incorrecta. Revisa el contenido y vuelve a intentarlo."});
    await db.query(`INSERT INTO interacciones_curso(user_id,video_index,checkpoint,respuesta,completado_en)
                    VALUES(?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE respuesta=VALUES(respuesta),completado_en=NOW()`,[req.userId,interaction.videoIndex,checkpoint,answer]);
    return res.json({ok:true,correct:true});
  } catch(err) { console.error("COURSE INTERACTIONS POST ERROR:",err); return res.status(500).json({ok:false,error:"No fue posible guardar la interacción"}); }
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
    if(savedProgress===0 && progress>0){
      const context=await auditPersonContext(db,userId);
      const [alreadyStarted]=await db.query("SELECT id FROM auditoria_eventos WHERE persona_id=? AND evento='CURSO_INICIADO' LIMIT 1",[context.persona_id||0]);
      if(!alreadyStarted.length)await auditEvent(db,req,"CURSO_INICIADO",{actor:{tipo:"COLABORADOR",id:userId,nombre:context.name||"Colaborador"},empresaId:context.empresa_id,personaId:context.persona_id,folio:context.folio,entidad:"CURSO",entidadId:userId});
    }
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

    if (completed && savedProgress <= 95) {
      const [finished]=await db.query("SELECT COUNT(*) total FROM video_progress WHERE userId=? AND completed=1",[userId]);
      if(Number(finished[0]?.total||0)>=2){
        const context=await auditPersonContext(db,userId);
        const [already]=await db.query("SELECT id FROM auditoria_eventos WHERE persona_id=? AND evento='VIDEO_COMPLETADO' LIMIT 1",[context.persona_id||0]);
        if(!already.length)await auditEvent(db,req,"VIDEO_COMPLETADO",{actor:{tipo:"COLABORADOR",id:userId,nombre:context.name||"Colaborador"},empresaId:context.empresa_id,personaId:context.persona_id,folio:context.folio,entidad:"CURSO",entidadId:userId,despues:{videosCompletos:2}});
      }
    }


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


app.get("/carta-compromiso", auth, async (req, res) => {
  try {
    if (req.isAdmin) return res.status(403).json({ ok:false, error:"No autorizado" });
    const [rows] = await db.query(
      `SELECT c.aceptado_en,u.name,u.company,u.folio
       FROM users u LEFT JOIN cartas_compromiso c ON c.user_id=u.id
       WHERE u.id=? LIMIT 1`, [req.userId]
    );
    const record=rows[0];
    if (!record) return res.status(404).json({ ok:false, error:"Colaborador no encontrado" });
    return res.json({ ok:true, aceptada:!!record.aceptado_en, aceptadoEn:record.aceptado_en||null, usuario:record });
  } catch (err) { console.error("COMMITMENT STATUS ERROR:",err); return res.status(500).json({ok:false,error:"No fue posible consultar la carta"}); }
});

app.post("/carta-compromiso", auth, async (req, res) => {
  try {
    if (req.isAdmin) return res.status(403).json({ ok:false, error:"No autorizado" });
    const accepted=req.body.acepta===true;
    const signature=String(req.body.firma || "");
    const match=signature.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!accepted) return res.status(400).json({ok:false,error:"Debes aceptar la carta compromiso"});
    if (!match || match[1].length<300 || match[1].length>800000) return res.status(400).json({ok:false,error:"Captura una firma digital valida"});
    const [existing]=await db.query("SELECT user_id FROM cartas_compromiso WHERE user_id=? LIMIT 1",[req.userId]);
    if (existing.length) return res.json({ok:true,existente:true});
    await db.query(
      `INSERT INTO cartas_compromiso(user_id,firma_data,firma_mime,aceptado_en,version_documento)
       VALUES(?,?, 'image/png', NOW(), 'SAN_JOSE_DEL_CABO_2026_01')`,
      [req.userId,Buffer.from(match[1],"base64")]
    );
    const context=await auditPersonContext(db,req.userId);
    await auditEvent(db,req,"CARTA_ACEPTADA",{actor:{tipo:"COLABORADOR",id:req.userId,nombre:context.name||"Colaborador"},empresaId:context.empresa_id,personaId:context.persona_id,folio:context.folio,entidad:"CARTA_COMPROMISO",entidadId:req.userId,despues:{version:"SAN_JOSE_DEL_CABO_2026_01"}});
    return res.status(201).json({ok:true});
  } catch (err) { console.error("COMMITMENT SAVE ERROR:",err); return res.status(500).json({ok:false,error:"No fue posible guardar la carta compromiso"}); }
});

async function generateCommitmentPdf(res, record) {
  const filename=`carta-compromiso-${String(record.folio).replace(/[^a-z0-9_-]/gi,"_")}.pdf`;
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",`attachment; filename="${filename}"`);
  const doc=new PDFDocument({size:"LETTER",margin:42});
  doc.pipe(res);
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a").text("CARTA COMPROMISO DE CONFIDENCIALIDAD",{align:"center"});
  doc.moveDown(.6).font("Helvetica-Bold").fontSize(11).text("ADVERTENCIA");
  doc.font("Helvetica").fontSize(10.3).text("La información contenida en el curso de Seguridad de la Aviación Civil y en el Programa Local de Seguridad Aeroportuaria es propiedad de San Jose del Cabo S.A. de C.V.",{lineGap:3});
  doc.moveDown(.5).text("La información proporcionada en este curso es únicamente para fines de capacitación y no modifica ni sustituye las políticas, criterios y/o restricciones contenidos en el PLSA del aeropuerto, autorizado por la Autoridad Aeroportuaria.",{lineGap:3});
  doc.moveDown(.7).font("Helvetica-Bold").text("EL COMPROMISO QUE CADA ALUMNO ACEPTA Y ASUME DE MANERA IMPLÍCITA E IRREVOCABLE ES:");
  doc.font("Helvetica").text("1. No difundir de ninguna manera, ya sea oral, escrita o por cualquier medio electrónico, directo o indirectamente, el contenido total o parcial de este curso a cualquier persona, dependencia o empresa que no tenga necesidad directa y autorizada por escrito de la Jefatura de Seguridad del Aeropuerto de San Jose del Cabo S.A. de C.V.",{lineGap:3});
  doc.moveDown(.35).text("2. No prestar, facilitar ni de ningún modo, directo o indirecto o por medio de terceros, fotocopiar, digitalizar, copiar, leer, difundir y/o obtener información de este curso para cualquier uso que no sea autorizado por la Jefatura de Seguridad del Aeropuerto de San Jose del Cabo S.A. de C.V.",{lineGap:3});
  doc.moveDown(.5).text("Asimismo, estoy enterado de que el curso de seguridad de la aviación civil del Aeropuerto de San Jose del Cabo S.A. de C.V. contiene información restringida cuyo mal uso o inadecuada e ilegal difusión pudiera poner en peligro la seguridad de las operaciones del aeropuerto, con las consecuencias legales que esto constituye.",{lineGap:3});
  doc.moveDown(.4).text("Es propiedad material e intelectual del Aeropuerto de San Jose del Cabo S.A. de C.V., motivo por el cual se reserva todos los derechos de autor; cualquier violación a estos derechos será sancionada conforme a las leyes correspondientes.",{lineGap:3});
  doc.moveDown(.8).font("Helvetica-Bold").text(`Nombre: ${record.name}`); doc.font("Helvetica").text(`Folio: ${record.folio}    Fecha: ${new Date(record.aceptado_en).toLocaleDateString("es-MX")}`);
  doc.moveDown(.45).font("Helvetica-Bold").text("Firma digital de aceptación:");
  if (record.firma_data) doc.image(record.firma_data,{fit:[230,85],align:"left"});
  doc.end();
}

async function generateProfessionalCommitmentPdf(res, record) {
  const filename=`carta-compromiso-${String(record.folio).replace(/[^a-z0-9_-]/gi,"_")}.pdf`;
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",`attachment; filename="${filename}"`);
  const doc=new PDFDocument({size:"LETTER",margin:0});
  doc.pipe(res);
  const width=612, height=792, left=52, contentWidth=508;
  const navy="#082f49", ink="#24364a", gold="#c6923b", pale="#edf3f8";
  doc.rect(0,0,width,height).fill("#f8fafc");
  doc.rect(18,18,width-36,height-36).lineWidth(1).stroke("#cbd5e1");
  doc.rect(18,18,width-36,82).fill(navy);
  const logo=path.join(__dirname,"public","assets","logo-gap.png");
  if(fs.existsSync(logo)) doc.image(logo,42,34,{fit:[54,45]});
  doc.font("Helvetica-Bold").fillColor("#ffffff").fontSize(8).text("SISTEMA TIA  |  SEGURIDAD AEROPORTUARIA",116,37,{characterSpacing:1.1});
  doc.font("Helvetica-Bold").fontSize(17).text("CARTA COMPROMISO",116,51);
  doc.font("Helvetica").fontSize(10).text("DE CONFIDENCIALIDAD",116,71,{characterSpacing:1.6});
  doc.rect(18,100,width-36,4).fill(gold);
  let y=121;
  const section=(title)=>{doc.roundedRect(left,y,contentWidth,20,3).fill(pale);doc.rect(left,y,4,20).fill(gold);doc.font("Helvetica-Bold").fontSize(8.5).fillColor(navy).text(title,left+12,y+6,{characterSpacing:.35});y+=29;};
  const paragraph=(text,size=8.45,gap=5)=>{doc.font("Helvetica").fontSize(size).fillColor(ink).text(text,left,y,{width:contentWidth,lineGap:2.2,align:"justify"});y=doc.y+gap;};
  section("ADVERTENCIA");
  paragraph("La información contenida en el curso de Seguridad de la Aviación Civil y en el Programa Local de Seguridad Aeroportuaria es propiedad de San Jose del Cabo S.A. de C.V.");
  paragraph("La información proporcionada en este curso es únicamente para fines de capacitación y no modifica ni sustituye las políticas, criterios y/o restricciones contenidos en el PLSA del aeropuerto, autorizado por la Autoridad Aeroportuaria.",8.45,9);
  section("COMPROMISOS DE CONFIDENCIALIDAD");
  paragraph("1. No difundir de ninguna manera, ya sea oral, escrita o por cualquier medio electrónico, directo o indirectamente, el contenido total o parcial de este curso a cualquier persona, dependencia o empresa que no tenga necesidad directa y autorizada por escrito de la Jefatura de Seguridad del Aeropuerto de San Jose del Cabo S.A. de C.V.",8.15,5);
  paragraph("2. No prestar, facilitar ni de ningún modo, directo o indirecto o por medio de terceros, fotocopiar, digitalizar, copiar, leer, difundir y/o obtener información de este curso para cualquier uso que no sea autorizado por la Jefatura de Seguridad del Aeropuerto de San Jose del Cabo S.A. de C.V.",8.15,8);
  paragraph("Asimismo, estoy enterado de que el curso de seguridad de la aviación civil del Aeropuerto de San Jose del Cabo S.A. de C.V. contiene información restringida cuyo mal uso o inadecuada e ilegal difusión pudiera poner en peligro la seguridad de las operaciones del aeropuerto, con las consecuencias legales que esto constituye.",8.15,5);
  paragraph("Es propiedad material e intelectual del Aeropuerto de San Jose del Cabo S.A. de C.V., motivo por el cual se reserva todos los derechos de autor; cualquier violación a estos derechos será sancionada conforme a las leyes correspondientes.",8.15,10);
  doc.roundedRect(left,y,contentWidth,48,4).fillAndStroke("#eef4f8","#cbd5e1");
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text("COLABORADOR",left+12,y+9);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(navy).text(record.name,left+12,y+21,{width:250});
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text("FOLIO / FECHA DE ACEPTACIÓN",left+285,y+9);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(navy).text(`${record.folio}  ·  ${new Date(record.aceptado_en).toLocaleDateString("es-MX")}`,left+285,y+22,{width:208});
  y+=62;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(navy).text("FIRMA DIGITAL DE ACEPTACIÓN",left,y);
  doc.roundedRect(left,y+13,235,66,4).lineWidth(1).stroke("#94a3b8");
  if(record.firma_data) doc.image(record.firma_data,left+12,y+18,{fit:[210,53],align:"left",valign:"center"});
  doc.moveTo(left,y+82).lineTo(left+235,y+82).lineWidth(.8).stroke("#64748b");
  doc.font("Helvetica").fontSize(7.5).fillColor("#64748b").text("Firma del colaborador",left,y+86,{width:235,align:"center"});
  doc.font("Helvetica").fontSize(7.2).fillColor("#64748b").text(`Control documental: ${record.folio}`,left+280,y+36,{width:220,align:"right"});
  doc.end();
}

async function generateApprovedExamPdf(res, exam, answers) {
  const filename=`examen-${String(exam.folio).replace(/[^a-z0-9_-]/gi,"_")}.pdf`;
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",`attachment; filename="${filename}"`);
  const doc=new PDFDocument({size:"LETTER",margin:0});
  doc.pipe(res);
  const width=612,height=792,left=48,bodyWidth=516,navy="#082f49",gold="#c6923b",ink="#24364a",pale="#edf3f8";
  let page=1;
  const header=()=>{
    doc.rect(0,0,width,height).fill("#f8fafc");doc.rect(18,18,width-36,height-36).lineWidth(1).stroke("#cbd5e1");doc.rect(18,18,width-36,82).fill(navy);
    const logo=path.join(__dirname,"public","assets","logo-gap.png");if(fs.existsSync(logo))doc.image(logo,42,34,{fit:[54,45]});
    doc.font("Helvetica-Bold").fillColor("#fff").fontSize(8).text("SISTEMA TIA  |  SEGURIDAD AEROPORTUARIA",116,37,{characterSpacing:1.1});doc.font("Helvetica-Bold").fontSize(17).text("EVALUACIÓN DE SEGURIDAD",116,51);doc.font("Helvetica").fontSize(9).text("EXPEDIENTE AUDITABLE",116,72,{characterSpacing:1.3});doc.rect(18,100,width-36,4).fill(gold);
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(`Página ${page}`,left,766,{width:bodyWidth,align:"right"});
  };
  header();
  let y=121;
  doc.roundedRect(left,y,bodyWidth,58,4).fillAndStroke(pale,"#cbd5e1");
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text("COLABORADOR",left+12,y+10);doc.font("Helvetica-Bold").fontSize(10).fillColor(navy).text(exam.name,left+12,y+23,{width:240});
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text("EMPRESA",left+275,y+10);doc.font("Helvetica-Bold").fontSize(9).fillColor(navy).text(exam.company,left+275,y+23,{width:225});
  doc.font("Helvetica").fontSize(8).fillColor("#475569").text(`Folio: ${exam.folio}    Fecha: ${new Date(exam.aprobado_en).toLocaleDateString("es-MX")}    Resultado: ${Number(exam.calificacion).toFixed(0)}%`,left+12,y+43);
  y+=74;
  doc.roundedRect(left,y,bodyWidth,21,3).fill(pale);doc.rect(left,y,4,21).fill(gold);doc.font("Helvetica-Bold").fontSize(8.5).fillColor(navy).text("RESPUESTAS REGISTRADAS DEL EXAMEN APROBADO",left+12,y+7,{characterSpacing:.3});y+=33;
  const newPage=()=>{doc.addPage();page++;header();y=121;};
  for(const answer of answers){
    const questionText=`${answer.orden}. ${answer.pregunta}`;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(navy);
    const questionHeight=doc.heightOfString(questionText,{width:bodyWidth,lineGap:2});
    const options=["A","B","C","D"].filter(letter=>answer[`opcion_${letter.toLowerCase()}`]).map(letter=>`${letter}) ${answer[`opcion_${letter.toLowerCase()}`]}`);
    doc.font("Helvetica").fontSize(8.1);const optionsHeight=options.reduce((sum,text)=>sum+doc.heightOfString(text,{width:bodyWidth-24,lineGap:1.5})+5,0);
    const total=questionHeight+optionsHeight+40;if(y+total>730)newPage();
    doc.roundedRect(left,y,bodyWidth,total,4).fillAndStroke("#ffffff","#d6dee8");
    doc.font("Helvetica-Bold").fontSize(9).fillColor(navy).text(questionText,left+12,y+11,{width:bodyWidth-24,lineGap:2});
    let optionY=doc.y+7;
    for(const text of options){const letter=text[0],selected=letter===answer.respuesta_colaborador,correct=letter===answer.respuesta_correcta;const color=selected?(correct?"#e8f7ed":"#fdecec"):"#f8fafc";const border=selected?(correct?"#22c55e":"#ef4444"):"#e2e8f0";doc.roundedRect(left+12,optionY,bodyWidth-24,doc.heightOfString(text,{width:bodyWidth-48,lineGap:1.5})+8,3).fillAndStroke(color,border);doc.font(selected?"Helvetica-Bold":"Helvetica").fontSize(8.1).fillColor(ink).text(text,left+24,optionY+4,{width:bodyWidth-48,lineGap:1.5});optionY=doc.y+5;}
    doc.font("Helvetica-Bold").fontSize(7.6).fillColor(answer.es_correcta?"#15803d":"#b91c1c").text(answer.es_correcta?"RESPUESTA CORRECTA":"RESPUESTA INCORRECTA",left+12,optionY+2);y+=total+10;
  }
  doc.end();
}

app.get("/admin-personas/:id/carta-compromiso", auth, async (req,res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({error:"No autorizado"});
    const [rows]=await db.query(`SELECT u.name,u.folio,c.firma_data,c.aceptado_en FROM users u JOIN cartas_compromiso c ON c.user_id=u.id WHERE u.id=(SELECT user_id FROM personas_curso WHERE id=? LIMIT 1) LIMIT 1`,[Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({error:"Carta de aceptación no disponible"});
    await auditEvent(db,req,"CARTA_COMPROMISO_DESCARGADA",{personaId:Number(req.params.id),folio:rows[0].folio,entidad:"CARTA_COMPROMISO",entidadId:Number(req.params.id)});
    await generateProfessionalCommitmentPdf(res,rows[0]);
  } catch(err) { console.error("ADMIN COMMITMENT PDF ERROR:",err); if(!res.headersSent)return res.status(500).json({error:"No fue posible generar la carta"}); res.end(); }
});

app.get("/admin-personas/:id/examen", auth, async (req,res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({error:"No autorizado"});
    const personId=Number(req.params.id);
    const [exams]=await db.query(`SELECT ea.id,ea.calificacion,ea.aprobado_en,u.name,u.company,u.folio,e.nombre AS empresa FROM personas_curso pc JOIN users u ON u.id=pc.user_id JOIN empresas e ON e.id=pc.empresa_id JOIN examenes_aprobados ea ON ea.user_id=u.id WHERE pc.id=? LIMIT 1`,[personId]);
    const exam=exams[0];
    if(!exam)return res.status(404).json({error:"Examen aprobado no disponible"});
    exam.company=exam.empresa||exam.company;
    const [answers]=await db.query("SELECT orden,pregunta,opcion_a,opcion_b,opcion_c,opcion_d,respuesta_colaborador,respuesta_correcta,es_correcta FROM respuestas_examen_aprobado WHERE examen_id=? ORDER BY orden",[exam.id]);
    if(!answers.length)return res.status(404).json({error:"Respuestas del examen no disponibles"});
    await auditEvent(db,req,"EXAMEN_AUDITABLE_DESCARGADO",{personaId:personId,folio:exam.folio,entidad:"EXAMEN",entidadId:exam.id});
    await generateApprovedExamPdf(res,exam,answers);
  } catch(err) { console.error("ADMIN EXAM PDF ERROR:",err);if(!res.headersSent)return res.status(500).json({error:"No fue posible generar el examen"});res.end(); }
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
async function ensureOperationalTables(){
  /* Compatibilidad con respaldos anteriores que solo tenían SUPERADMIN/GESTOR. */
  await db.query("ALTER TABLE admins MODIFY rol ENUM('SUPERADMIN','ADMINISTRADOR','AUDITOR','VISOR','GESTOR') NOT NULL DEFAULT 'VISOR'");
  await db.query("UPDATE admins SET rol='ADMINISTRADOR' WHERE rol='GESTOR'");
  await db.query(`CREATE TABLE IF NOT EXISTS auditoria_eventos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_tipo ENUM('ADMIN','EMPRESA','COLABORADOR','SISTEMA') NOT NULL,
    actor_id BIGINT UNSIGNED NULL,
    actor_nombre VARCHAR(180) NOT NULL,
    empresa_id BIGINT UNSIGNED NULL,
    persona_id BIGINT UNSIGNED NULL,
    folio VARCHAR(60) NULL,
    entidad VARCHAR(60) NULL,
    entidad_id BIGINT UNSIGNED NULL,
    evento VARCHAR(80) NOT NULL,
    antes_json JSON NULL,
    despues_json JSON NULL,
    detalle VARCHAR(1000) NULL,
    ip VARCHAR(64) NULL,
    user_agent VARCHAR(500) NULL,
    PRIMARY KEY (id),
    KEY idx_auditoria_fecha (creado_en),
    KEY idx_auditoria_evento (evento),
    KEY idx_auditoria_empresa (empresa_id,creado_en),
    KEY idx_auditoria_persona (persona_id,creado_en),
    KEY idx_auditoria_actor (actor_tipo,actor_id,creado_en),
    KEY idx_auditoria_folio (folio)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS suspensiones_colaborador (
    persona_id BIGINT UNSIGNED NOT NULL,
    empresa_id BIGINT UNSIGNED NOT NULL,
    suspendido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (persona_id),
    KEY idx_suspensiones_empresa (empresa_id),
    CONSTRAINT fk_suspensiones_persona FOREIGN KEY (persona_id) REFERENCES personas_curso(id) ON DELETE CASCADE,
    CONSTRAINT fk_suspensiones_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS fotografias_toma_fisica (
    user_id BIGINT UNSIGNED NOT NULL,
    solicitado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_fotografias_toma_fisica_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  for(const definition of [
    "ADD COLUMN llegada_en DATETIME NULL AFTER solicitado_en",
    "ADD COLUMN atencion_iniciada_en DATETIME NULL AFTER llegada_en",
    "ADD COLUMN atendido_en DATETIME NULL AFTER atencion_iniciada_en",
    "ADD COLUMN atendido_por BIGINT UNSIGNED NULL AFTER atendido_en"
  ]){
    try{await db.query(`ALTER TABLE fotografias_toma_fisica ${definition}`)}catch(err){if(err.code!=="ER_DUP_FIELDNAME")throw err;}
  }
  await db.query(`CREATE TABLE IF NOT EXISTS cartas_compromiso (
    user_id BIGINT UNSIGNED NOT NULL,
    firma_data LONGBLOB NOT NULL,
    firma_mime VARCHAR(50) NOT NULL DEFAULT 'image/png',
    aceptado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version_documento VARCHAR(80) NOT NULL,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_cartas_compromiso_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS interacciones_curso (
    user_id BIGINT UNSIGNED NOT NULL,
    video_index TINYINT UNSIGNED NOT NULL,
    checkpoint VARCHAR(20) NOT NULL,
    respuesta TINYINT UNSIGNED NOT NULL,
    completado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id,checkpoint),
    KEY idx_interacciones_video (user_id,video_index),
    CONSTRAINT fk_interacciones_curso_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS examenes_aprobados (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    exam_token CHAR(64) NOT NULL,
    calificacion DECIMAL(5,2) NOT NULL,
    aprobado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_examenes_aprobados_user (user_id),
    UNIQUE KEY uq_examenes_aprobados_token (exam_token),
    CONSTRAINT fk_examenes_aprobados_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS respuestas_examen_aprobado (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    examen_id BIGINT UNSIGNED NOT NULL,
    orden TINYINT UNSIGNED NOT NULL,
    pregunta TEXT NOT NULL,
    opcion_a TEXT NOT NULL,
    opcion_b TEXT NOT NULL,
    opcion_c TEXT NOT NULL,
    opcion_d TEXT NULL,
    respuesta_colaborador ENUM('A','B','C','D') NOT NULL,
    respuesta_correcta ENUM('A','B','C','D') NOT NULL,
    es_correcta TINYINT(1) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_respuestas_examen_orden (examen_id,orden),
    CONSTRAINT fk_respuestas_examen_aprobado FOREIGN KEY (examen_id) REFERENCES examenes_aprobados(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  /* Recupera hitos existentes como registros heredados; no inventa actor ni tiempos de video no disponibles. */
  await db.query(`INSERT INTO auditoria_eventos(actor_tipo,actor_nombre,empresa_id,persona_id,folio,entidad,entidad_id,evento,detalle,creado_en)
    SELECT 'SISTEMA','Registro histórico',pc.empresa_id,pc.id,pc.folio,'COLABORADOR',pc.id,'COLABORADOR_REGISTRADO','Evento recuperado de registro previo',pc.creado_en
    FROM personas_curso pc WHERE NOT EXISTS (SELECT 1 FROM auditoria_eventos ae WHERE ae.persona_id=pc.id AND ae.evento='COLABORADOR_REGISTRADO')`);
  await db.query(`INSERT INTO auditoria_eventos(actor_tipo,actor_nombre,empresa_id,persona_id,folio,entidad,entidad_id,evento,detalle,creado_en)
    SELECT 'SISTEMA','Registro histórico',pc.empresa_id,pc.id,pc.folio,'CARTA_COMPROMISO',u.id,'CARTA_ACEPTADA','Evento recuperado de registro previo',cc.aceptado_en
    FROM cartas_compromiso cc JOIN users u ON u.id=cc.user_id JOIN personas_curso pc ON pc.user_id=u.id
    WHERE NOT EXISTS (SELECT 1 FROM auditoria_eventos ae WHERE ae.persona_id=pc.id AND ae.evento='CARTA_ACEPTADA')`);
  await db.query(`INSERT INTO auditoria_eventos(actor_tipo,actor_nombre,empresa_id,persona_id,folio,entidad,entidad_id,evento,detalle,creado_en)
    SELECT 'SISTEMA','Registro histórico',pc.empresa_id,pc.id,pc.folio,'EXAMEN',u.id,'EXAMEN_APROBADO','Evento recuperado de examen aprobado previo',ea.aprobado_en
    FROM examenes_aprobados ea JOIN users u ON u.id=ea.user_id JOIN personas_curso pc ON pc.user_id=u.id
    WHERE NOT EXISTS (SELECT 1 FROM auditoria_eventos ae WHERE ae.persona_id=pc.id AND ae.evento='EXAMEN_APROBADO')`);
  await db.query(`INSERT INTO auditoria_eventos(actor_tipo,actor_nombre,empresa_id,persona_id,folio,entidad,entidad_id,evento,detalle,creado_en)
    SELECT 'SISTEMA','Registro histórico',pc.empresa_id,pc.id,pc.folio,'FOTOGRAFIA',u.id,'FOTOGRAFIA_APROBADA','Evento recuperado de fotografía aprobada previa',u.foto_revisada_en
    FROM users u JOIN personas_curso pc ON pc.user_id=u.id WHERE u.foto_estatus='APROBADA'
    AND NOT EXISTS (SELECT 1 FROM auditoria_eventos ae WHERE ae.persona_id=pc.id AND ae.evento='FOTOGRAFIA_APROBADA')`);
  await db.query(`INSERT INTO auditoria_eventos(actor_tipo,actor_nombre,empresa_id,persona_id,folio,entidad,entidad_id,evento,detalle,creado_en)
    SELECT 'SISTEMA','Registro histórico',pc.empresa_id,pc.id,pc.folio,'FOTOGRAFIA',u.id,'FOTOGRAFIA_RECHAZADA',COALESCE(u.foto_motivo_rechazo,'Evento recuperado de fotografía rechazada previa'),COALESCE(u.foto_revisada_en,NOW())
    FROM users u JOIN personas_curso pc ON pc.user_id=u.id WHERE u.foto_estatus='RECHAZADA'
    AND NOT EXISTS (SELECT 1 FROM auditoria_eventos ae WHERE ae.persona_id=pc.id AND ae.evento='FOTOGRAFIA_RECHAZADA')`);
}
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
ensureOperationalTables()
  .then(prepareProductionAdmin)
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

function detectedImageMime(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<12)return null;
  if(buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff)return "image/jpeg";
  if(buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return "image/png";
  if(buffer.subarray(0,4).toString("ascii")==="RIFF"&&buffer.subarray(8,12).toString("ascii")==="WEBP")return "image/webp";
  return null;
}
function hasValidImageContent(file){
  const detected=detectedImageMime(file?.buffer);
  return Boolean(detected&&detected===file?.mimetype);
}

app.get("/admin-toma-fisica",auth,async(req,res)=>{
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede consultar la toma física"))return;
    const [queue]=await db.query(`SELECT u.id AS user_id,u.folio,u.name,e.nombre AS empresa,pc.id AS persona_id,tf.solicitado_en,tf.llegada_en,tf.atencion_iniciada_en,tf.atendido_en,
      CASE WHEN tf.atendido_en IS NOT NULL THEN 'CONCLUIDO' WHEN tf.atencion_iniciada_en IS NOT NULL THEN 'EN_ATENCION' WHEN tf.llegada_en IS NOT NULL THEN 'EN_SITIO' ELSE 'PENDIENTE_LLEGADA' END AS estado
      FROM fotografias_toma_fisica tf JOIN users u ON u.id=tf.user_id JOIN personas_curso pc ON pc.user_id=u.id JOIN empresas e ON e.id=pc.empresa_id
      ORDER BY CASE WHEN tf.llegada_en IS NULL THEN 1 ELSE 0 END,tf.llegada_en ASC,tf.solicitado_en ASC LIMIT 200`);
    const open=queue.filter(item=>!item.atendido_en),summary={pendientesLlegada:open.filter(item=>!item.llegada_en).length,enSitio:open.filter(item=>item.llegada_en&&!item.atencion_iniciada_en).length,enAtencion:open.filter(item=>item.atencion_iniciada_en).length};
    return res.json({ok:true,queue,summary});
  }catch(err){console.error("PHYSICAL QUEUE ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible consultar la cola de toma física"});}
});

app.post("/admin-toma-fisica/:userId/llegada",auth,async(req,res)=>{
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede operar la toma física"))return;
    const userId=Number(req.params.userId),[rows]=await db.query(`SELECT tf.user_id,tf.llegada_en,pc.id persona_id,pc.empresa_id,pc.folio
      FROM fotografias_toma_fisica tf JOIN personas_curso pc ON pc.user_id=tf.user_id WHERE tf.user_id=? LIMIT 1`,[userId]),item=rows[0];
    if(!item)return res.status(404).json({ok:false,error:"Caso de toma física no encontrado"});
    if(!item.llegada_en){await db.query("UPDATE fotografias_toma_fisica SET llegada_en=NOW() WHERE user_id=?",[userId]);await auditEvent(db,req,"TOMA_FISICA_LLEGADA_REGISTRADA",{empresaId:item.empresa_id,personaId:item.persona_id,folio:item.folio,entidad:"TOMA_FISICA",entidadId:userId,detalle:"Llegada registrada por personal TIA"});}
    return res.json({ok:true,already:Boolean(item.llegada_en)});
  }catch(err){console.error("PHYSICAL ARRIVAL ADMIN ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible registrar la llegada"});}
});

app.post("/admin-toma-fisica/:userId/iniciar",auth,async(req,res)=>{
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede operar la toma física"))return;
    const userId=Number(req.params.userId),[rows]=await db.query(`SELECT tf.user_id,tf.llegada_en,tf.atendido_en,pc.id persona_id,pc.empresa_id,pc.folio
      FROM fotografias_toma_fisica tf JOIN personas_curso pc ON pc.user_id=tf.user_id WHERE tf.user_id=? LIMIT 1`,[userId]),item=rows[0];
    if(!item)return res.status(404).json({ok:false,error:"Caso de toma física no encontrado"});
    if(!item.llegada_en)return res.status(409).json({ok:false,error:"Primero registra la llegada del colaborador"});
    if(item.atendido_en)return res.status(409).json({ok:false,error:"La toma física ya fue concluida"});
    await db.query("UPDATE fotografias_toma_fisica SET atencion_iniciada_en=COALESCE(atencion_iniciada_en,NOW()) WHERE user_id=?",[userId]);
    await auditEvent(db,req,"TOMA_FISICA_ATENCION_INICIADA",{empresaId:item.empresa_id,personaId:item.persona_id,folio:item.folio,entidad:"TOMA_FISICA",entidadId:userId});
    return res.json({ok:true});
  }catch(err){console.error("PHYSICAL START ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible iniciar la atención"});}
});

app.post("/admin-toma-fisica/:userId/fotografia",auth,upload.single("photo"),async(req,res)=>{
  let connection;
  try{
    if(!requireAdminPermission(req,res,"SYSTEM_CONFIG","Solo un administrador puede operar la toma física"))return;
    if(!req.file)return res.status(400).json({ok:false,error:"Captura una fotografía antes de concluir"});
    if(!hasValidImageContent(req.file))return res.status(400).json({ok:false,error:"El archivo no contiene una imagen válida"});
    const userId=Number(req.params.userId);connection=await db.getConnection();await connection.beginTransaction();
    const [rows]=await connection.query(`SELECT tf.user_id,tf.llegada_en,tf.atendido_en,pc.id persona_id,pc.empresa_id,pc.folio
      FROM fotografias_toma_fisica tf JOIN personas_curso pc ON pc.user_id=tf.user_id WHERE tf.user_id=? FOR UPDATE`,[userId]),item=rows[0];
    if(!item){await connection.rollback();return res.status(404).json({ok:false,error:"Caso de toma física no encontrado"});}
    if(!item.llegada_en){await connection.rollback();return res.status(409).json({ok:false,error:"Primero registra la llegada del colaborador"});}
    if(item.atendido_en){await connection.rollback();return res.status(409).json({ok:false,error:"La toma física ya fue concluida"});}
    await connection.query("UPDATE users SET photo='DB',photo_data=?,photo_mime=?,foto_registrada_en=NOW(),foto_estatus='APROBADA',foto_revisada_en=NOW(),foto_revisada_por=?,foto_motivo_rechazo=NULL WHERE id=?",[req.file.buffer,req.file.mimetype,req.admin.id,userId]);
    await connection.query("UPDATE fotografias_toma_fisica SET atencion_iniciada_en=COALESCE(atencion_iniciada_en,NOW()),atendido_en=NOW(),atendido_por=? WHERE user_id=?",[req.admin.id,userId]);
    await auditEvent(connection,req,"FOTOGRAFIA_TOMA_FISICA_APROBADA",{empresaId:item.empresa_id,personaId:item.persona_id,folio:item.folio,entidad:"TOMA_FISICA",entidadId:userId,despues:{estatus:"APROBADA",origen:"MODULO_TIA"},detalle:"Fotografía capturada y aceptada en módulo TIA"});
    await connection.commit();return res.json({ok:true});
  }catch(err){if(connection)await connection.rollback();console.error("PHYSICAL PHOTO ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible concluir la toma física"});}
  finally{if(connection)connection.release();}
});

app.get("/estado-finalizacion",auth,async(req,res)=>{
  try{
    if(req.isAdmin)return res.status(403).json({ok:false,error:"Acceso no disponible"});
    const [rows]=await db.query(
      `SELECT u.name,u.folio,u.aprobado,u.photo,u.foto_registrada_en,u.foto_estatus,u.foto_motivo_rechazo,
              tf.user_id AS toma_fisica
       FROM users u LEFT JOIN fotografias_toma_fisica tf ON tf.user_id=u.id
       WHERE u.id=? LIMIT 1`,[req.userId]
    );
    if(!rows.length)return res.status(404).json({ok:false,error:"Colaborador no encontrado"});
    return res.json({ok:true,nombre:rows[0].name,folio:rows[0].folio,aprobado:!!rows[0].aprobado,fotoRegistrada:!!rows[0].photo,fotoEstatus:rows[0].toma_fisica?"TOMA_FISICA":rows[0].foto_estatus,motivoRechazo:rows[0].foto_motivo_rechazo,fechaFoto:rows[0].foto_registrada_en,tomaFisica:!!rows[0].toma_fisica});
  }catch(err){console.error("FINALIZACION STATUS ERROR:",err);return res.status(500).json({ok:false,error:"No fue posible consultar el estado"})}
});

// 📸 GUARDAR FOTO
app.post("/upload-photo", auth, upload.single("photo"), async (req, res) => {
  try {

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No se recibió la fotografía" });
    }

    if(!hasValidImageContent(req.file)){
      return res.status(400).json({ok:false,error:"El archivo no contiene una imagen válida"});
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
      `UPDATE users SET photo='DB',photo_data=?,photo_mime=?,foto_registrada_en=NOW(),foto_estatus='PENDIENTE',foto_revisada_en=NULL,foto_revisada_por=NULL,foto_motivo_rechazo=NULL
       WHERE id=? AND aprobado=1 AND NOT EXISTS (SELECT 1 FROM fotografias_toma_fisica WHERE user_id=users.id)`,
      [req.file.buffer,req.file.mimetype,userId]
    );
    if(!result.affectedRows)return res.status(403).json({ok:false,error:"Debes presentarte al módulo TIA para la toma física de la fotografía"});

    const context=await auditPersonContext(db,userId);
    await auditEvent(db,req,"FOTOGRAFIA_ENVIADA",{actor:{tipo:"COLABORADOR",id:userId,nombre:context.name||"Colaborador"},empresaId:context.empresa_id,personaId:context.persona_id,folio:context.folio,entidad:"FOTOGRAFIA",entidadId:userId,despues:{estatus:"PENDIENTE"}});

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
    const [previousSessions] = await db.query(
      `SELECT question_ids FROM exam_sessions
       WHERE user_id=? AND submitted_at IS NOT NULL
       ORDER BY submitted_at DESC`, [req.userId]
    );
    const previouslyUsed = new Set();
    previousSessions.forEach(session => {
      const ids = typeof session.question_ids === "string" ? JSON.parse(session.question_ids) : session.question_ids;
      (Array.isArray(ids) ? ids : []).forEach(id => previouslyUsed.add(Number(id)));
    });
    const [allQuestions] = await db.query(`
      SELECT id,question,option_a,option_b,option_c,option_d
      FROM questions WHERE active=1 ORDER BY RAND()
    `);
    const unused = allQuestions.filter(question => !previouslyUsed.has(Number(question.id)));
    const rows = [...unused, ...allQuestions.filter(question => previouslyUsed.has(Number(question.id)))].slice(0,15);
    if(rows.length<15) return res.status(503).json({ok:false,error:"Banco de preguntas insuficiente"});
    const examToken=crypto.randomBytes(32).toString("hex");
    await db.query(
      `INSERT INTO exam_sessions(token,user_id,question_ids,expires_at)
       VALUES(?,?,?,DATE_ADD(NOW(),INTERVAL 60 MINUTE))`,
      [examToken,req.userId,JSON.stringify(rows.map(q=>q.id))]
    );
    const auditContext=await auditPersonContext(db,req.userId);
    await auditEvent(db,req,"EXAMEN_INICIADO",{actor:{tipo:"COLABORADOR",id:req.userId,nombre:auditContext.name||"Colaborador"},empresaId:auditContext.empresa_id,personaId:auditContext.persona_id,folio:auditContext.folio,entidad:"EXAMEN",entidadId:req.userId,detalle:"Se generó un intento de examen"});
    const shuffle = items => {
      const result = [...items];
      for (let index=result.length-1; index>0; index--) {
        const other=crypto.randomInt(index+1);
        [result[index],result[other]]=[result[other],result[index]];
      }
      return result;
    };
    const questions=rows.map(question=>({
      id:question.id,
      question:repairMojibake(question.question),
      options:shuffle([
        ["A",question.option_a], ["B",question.option_b], ["C",question.option_c], ["D",question.option_d]
      ].filter(([,text])=>text)).map(([key,text],index)=>({key,label:String.fromCharCode(65+index),text:repairMojibake(text)}))
    }));
    return res.json({ok:true,examToken,questions});
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
    const auditContext=await auditPersonContext(db,userId);
    await auditEvent(db,req,aprobado?"EXAMEN_APROBADO":"EXAMEN_REPROBADO",{actor:{tipo:"COLABORADOR",id:userId,nombre:auditContext.name||"Colaborador"},empresaId:auditContext.empresa_id,personaId:auditContext.persona_id,folio:auditContext.folio,entidad:"EXAMEN",entidadId:userId,despues:{calificacion:score,aprobado},detalle:`Intento de examen registrado`});

    if (aprobado) {
      const [existingAudit] = await db.query("SELECT id FROM examenes_aprobados WHERE user_id=? LIMIT 1", [userId]);
      if (!existingAudit.length) {
        const [questionRows] = await db.query(
          "SELECT id,question,option_a,option_b,option_c,option_d,correct FROM questions WHERE id IN (?)", [ids]
        );
        const questionsById = new Map(questionRows.map(question => [Number(question.id), question]));
        const [auditResult] = await db.query(
          "INSERT INTO examenes_aprobados(user_id,exam_token,calificacion,aprobado_en) VALUES(?,?,?,NOW())",
          [userId, examToken, score]
        );
        const auditRows = ids.map((id, index) => {
          const question = questionsById.get(Number(id));
          const selected = answerMap.get(Number(id));
          return [auditResult.insertId, index + 1, repairMojibake(question.question), repairMojibake(question.option_a), repairMojibake(question.option_b), repairMojibake(question.option_c), repairMojibake(question.option_d), selected, question.correct, selected === question.correct ? 1 : 0];
        });
        await db.query(
          `INSERT INTO respuestas_examen_aprobado
           (examen_id,orden,pregunta,opcion_a,opcion_b,opcion_c,opcion_d,respuesta_colaborador,respuesta_correcta,es_correcta)
           VALUES ?`, [auditRows]
        );
      }
    }

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
