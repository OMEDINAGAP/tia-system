const express = require("express");
const cors = require("cors");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));


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
  const today = new Date().toISOString().split("T")[0];
  const base = SECRET + today;

  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash << 5) - hash + base.charCodeAt(i);
    hash |= 0;
  }

  return "TIA#" + Math.abs(hash).toString(36).toUpperCase().slice(0,6);
}

// LOGIN
app.get("/validate", (req, res) => {
  const pass = req.query.pass;
  res.json({ ok: pass === generatePassword() });
});

// ADMIN PASSWORD (PROTEGIDO)
app.get("/admin-password", (req, res) => {
  if (req.query.pin !== ADMIN_PIN) return res.status(403).send("No autorizado");
  res.send(generatePassword());
});

// LOG LOGIN
app.post("/log-login", async (req, res) => {
  const user = {
    id: Date.now(),
    name: req.body.name,
    loginTime: new Date(),
    video: 0,
    exam: null
  };

  db.data.users.push(user);
  await db.write();

  res.json(user);
});

// LOG VIDEO
app.post("/log-video", async (req, res) => {
  const user = db.data.users.find(u => u.id == req.body.userId);
  if (user) {
    user.video = req.body.progress;
    await db.write();
  }
  res.json({ ok: true });
});

// LOG EXAM
app.post("/log-exam", async (req, res) => {
  const user = db.data.users.find(u => u.id == req.body.userId);
  if (user) {
    user.exam = req.body.score;
    await db.write();
  }
  res.json({ ok: true });
});

// ADMIN DATA
app.get("/admin-data", (req, res) => {
  if (req.query.pin !== ADMIN_PIN) return res.status(403).send("No autorizado");
  res.json(db.data.users);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running"));