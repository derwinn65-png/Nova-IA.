import express from "express";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const db = new Database("nova.sqlite");
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (!JWT_SECRET) console.warn("Configura JWT_SECRET en .env antes de publicar.");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT UNIQUE NOT NULL,
 password TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user',
 daily_limit INTEGER NOT NULL DEFAULT 20,
 used_today INTEGER NOT NULL DEFAULT 0,
 usage_date TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
const getSetting = (k, d) => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value ?? d;
const setSetting = (k,v) => db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k,String(v));

function auth(req,res,next) {
  try {
    const token=(req.headers.authorization||"").replace(/^Bearer /,"");
    req.user=jwt.verify(token,JWT_SECRET);
    next();
  } catch { res.status(401).json({error:"Inicia sesión para continuar."}); }
}
function admin(req,res,next) {
  if(req.user?.role!=="admin") return res.status(403).json({error:"Acceso exclusivo del propietario."});
  next();
}
function today(){ return new Date().toISOString().slice(0,10); }

const adminEmail=process.env.ADMIN_EMAIL;
const adminPassword=process.env.ADMIN_PASSWORD;
if(adminEmail && adminPassword && !db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail.toLowerCase())){
  const hash=bcrypt.hashSync(adminPassword,12);
  db.prepare("INSERT INTO users(email,password,role,daily_limit,usage_date) VALUES(?,?, 'admin', 999999, ?)").run(adminEmail.toLowerCase(),hash,today());
}

app.post("/api/register", async (req,res)=>{
  const email=String(req.body.email||"").trim().toLowerCase();
  const password=String(req.body.password||"");
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length<8)
    return res.status(400).json({error:"Usa un correo válido y una contraseña de al menos 8 caracteres."});
  try {
    const hash=await bcrypt.hash(password,12);
    const info=db.prepare("INSERT INTO users(email,password,usage_date) VALUES(?,?,?)").run(email,hash,today());
    const user={id:info.lastInsertRowid,email,role:"user"};
    res.json({token:jwt.sign(user,JWT_SECRET,{expiresIn:"7d"}),user});
  } catch { res.status(409).json({error:"Ese correo ya está registrado."}); }
});
app.post("/api/login", async (req,res)=>{
  const email=String(req.body.email||"").trim().toLowerCase();
  const row=db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if(!row || !(await bcrypt.compare(String(req.body.password||""),row.password)))
    return res.status(401).json({error:"Correo o contraseña incorrectos."});
  const user={id:row.id,email:row.email,role:row.role};
  res.json({token:jwt.sign(user,JWT_SECRET,{expiresIn:"7d"}),user});
});
app.get("/api/me",auth,(req,res)=>{
  const u=db.prepare("SELECT id,email,role,daily_limit,used_today,usage_date FROM users WHERE id=?").get(req.user.id);
  if(!u) return res.status(404).json({error:"Cuenta no encontrada."});
  if(u.usage_date!==today()){db.prepare("UPDATE users SET used_today=0,usage_date=? WHERE id=?").run(today(),u.id);u.used_today=0;}
  res.json({...u,announcement:getSetting("announcement",""),version:getSetting("version","1.0.0")});
});
app.post("/api/chat",auth,async(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if(!u) return res.status(401).json({error:"Cuenta no encontrada."});
  if(u.usage_date!==today()) db.prepare("UPDATE users SET used_today=0,usage_date=? WHERE id=?").run(today(),u.id);
  const fresh=db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
  if(fresh.role!=="admin" && fresh.used_today>=fresh.daily_limit) return res.status(429).json({error:"Llegaste al límite diario de mensajes."});
  if(!process.env.OPENAI_API_KEY) return res.status(503).json({error:"Falta configurar OPENAI_API_KEY en el servidor."});
  const messages=Array.isArray(req.body.messages)?req.body.messages.slice(-16):[];
  const safe=messages.filter(m=>["user","assistant"].includes(m.role) && typeof m.content==="string").map(m=>({role:m.role,content:m.content.slice(0,12000)}));
  if(!safe.length || safe[safe.length-1].role!=="user") return res.status(400).json({error:"Envía un mensaje para comenzar."});
  try {
    const response=await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4.1-mini",messages:[{role:"system",content:"Eres NOVA AI, una asistente útil, honesta y experta en programación y creación de proyectos. No afirmes haber creado o compilado archivos si no lo hiciste."},...safe]})
    });
    const data=await response.json();
    if(!response.ok) return res.status(502).json({error:data.error?.message||"El proveedor de IA no pudo responder."});
    db.prepare("UPDATE users SET used_today=used_today+1 WHERE id=?").run(u.id);
    res.json({reply:data.choices?.[0]?.message?.content||"No llegó una respuesta.",usage:data.usage});
  } catch { res.status(502).json({error:"No se pudo conectar con el servicio de IA."}); }
});
app.get("/api/admin/users",auth,admin,(req,res)=>{
  res.json(db.prepare("SELECT id,email,role,daily_limit,used_today FROM users ORDER BY id DESC").all());
});
app.patch("/api/admin/users/:id",auth,admin,(req,res)=>{
  const id=Number(req.params.id), limit=Math.max(0,Math.min(10000,Number(req.body.daily_limit)));
  if(!Number.isInteger(id)||!Number.isFinite(limit)) return res.status(400).json({error:"Datos inválidos."});
  db.prepare("UPDATE users SET daily_limit=? WHERE id=? AND role='user'").run(limit,id);
  res.json({ok:true});
});
app.post("/api/admin/announcement",auth,admin,(req,res)=>{
  setSetting("announcement",String(req.body.text||"").slice(0,500));
  if(req.body.version) setSetting("version",String(req.body.version).slice(0,30));
  res.json({ok:true});
});
app.listen(PORT,()=>console.log(`NOVA AI disponible en http://localhost:${PORT}`));
