
import express from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(), PORT=Number(process.env.PORT||3000), JWT_SECRET=process.env.JWT_SECRET;
if(!JWT_SECRET||JWT_SECRET.length<32){console.error('Configura JWT_SECRET con 32 caracteres o más en Render.');process.exit(1);}
app.disable('x-powered-by');app.use(express.json({limit:'2mb'}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');next();});
const dbPath=process.env.DB_PATH||path.join(__dirname,'nova.sqlite');
const db=new Database(dbPath);db.pragma('journal_mode=WAL');db.pragma('foreign_keys=ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',daily_limit INTEGER NOT NULL DEFAULT 30,used_today INTEGER NOT NULL DEFAULT 0,usage_date TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL DEFAULT 'Nuevo chat',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS chats_user_updated ON chats(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_chat_id ON messages(chat_id,id);
`);
const now=()=>new Date().toISOString(),today=()=>new Date().toISOString().slice(0,10);
const setting=(k,d='')=>db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value??d;
const setSetting=(k,v)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,String(v));
const publicUser=u=>({id:u.id,email:u.email,role:u.role});
function auth(req,res,next){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))throw 0;req.user=jwt.verify(h.slice(7),JWT_SECRET);next();}catch{return res.status(401).json({error:'Tu sesión terminó. Inicia sesión otra vez.'});}}
function admin(req,res,next){if(req.user?.role!=='admin')return res.status(403).json({error:'Acceso exclusivo del administrador.'});next();}
const ownedChat=(id,uid)=>db.prepare('SELECT * FROM chats WHERE id=? AND user_id=?').get(id,uid);
const titleFor=t=>{const s=String(t).replace(/\s+/g,' ').trim();return s.length>42?s.slice(0,39)+'…':s||'Nuevo chat';};
function ensureUser(req,res){const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);if(!u){res.status(401).json({error:'Cuenta no encontrada.'});return null;}if(u.usage_date!==today())db.prepare('UPDATE users SET used_today=0,usage_date=? WHERE id=?').run(today(),u.id);return db.prepare('SELECT * FROM users WHERE id=?').get(u.id);}
function checkUsage(u,res){if(u.role!=='admin'&&u.used_today>=u.daily_limit){res.status(429).json({error:'Llegaste al límite diario de mensajes.'});return false;}if(!process.env.OPENAI_API_KEY){res.status(503).json({error:'Falta configurar OPENAI_API_KEY en Render.'});return false;}return true;}
async function askAI(messages){
 const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',messages})});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||'El proveedor de IA no pudo responder. Revisa tu API key y cuota.');
 return d.choices?.[0]?.message?.content||'No llegó una respuesta.';
}
const systemPrompt='Eres NOVA AI, asistente útil y experta en programación, Unity, Roblox Studio, diseño web y creación de proyectos. Responde en español cuando el usuario escriba español. Entrega código completo y pasos concretos. No inventes IDs de Roblox, compilaciones, publicaciones ni archivos ya creados. Para Unity usa C# compatible con Unity y explica dónde colocar cada script. Para Roblox usa Luau para juegos propios, sin exploits ni trampas.';

const adminEmail=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase(),adminPassword=process.env.ADMIN_PASSWORD||'';
if(adminEmail&&adminPassword){
 const existing=db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail);
 if(!existing){const hash=bcrypt.hashSync(adminPassword,12);db.prepare("INSERT INTO users(email,password,role,daily_limit,usage_date) VALUES(?,?,'admin',999999,?)").run(adminEmail,hash,today());}
 else db.prepare("UPDATE users SET role='admin',daily_limit=999999 WHERE id=?").run(existing.id);
}
app.get('/api/health',(_q,s)=>s.json({ok:true,app:'NOVA AI'}));
app.post('/api/register',async(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||password.length<8||password.length>200)return res.status(400).json({error:'Usa un correo válido y una contraseña de 8 a 200 caracteres.'});
 try{const hash=await bcrypt.hash(password,12),info=db.prepare('INSERT INTO users(email,password,usage_date) VALUES(?,?,?)').run(email,hash,today());const user={id:Number(info.lastInsertRowid),email,role:'user'};res.status(201).json({token:jwt.sign(user,JWT_SECRET,{expiresIn:'7d'}),user});}catch{return res.status(409).json({error:'Ese correo ya está registrado.'});}
});
app.post('/api/login',async(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase(),row=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!row||!(await bcrypt.compare(String(req.body.password||''),row.password)))return res.status(401).json({error:'Correo o contraseña incorrectos.'});const user=publicUser(row);res.json({token:jwt.sign(user,JWT_SECRET,{expiresIn:'7d'}),user});});
app.get('/api/me',auth,(req,res)=>{const u=ensureUser(req,res);if(!u)return;res.json({id:u.id,email:u.email,role:u.role,daily_limit:u.daily_limit,used_today:u.used_today,announcement:setting('announcement'),version:setting('version','1.0')});});
app.get('/api/chats',auth,(req,res)=>res.json(db.prepare('SELECT id,title,created_at,updated_at FROM chats WHERE user_id=? ORDER BY updated_at DESC').all(req.user.id)));
app.post('/api/chats',auth,(req,res)=>{const id=crypto.randomUUID(),t=now();db.prepare("INSERT INTO chats(id,user_id,title,created_at,updated_at) VALUES(?,?,'Nuevo chat',?,?)").run(id,req.user.id,t,t);res.status(201).json({id,title:'Nuevo chat'});});
app.get('/api/chats/:id/messages',auth,(req,res)=>{if(!ownedChat(req.params.id,req.user.id))return res.status(404).json({error:'Chat no encontrado.'});res.json(db.prepare('SELECT id,role,content,created_at FROM messages WHERE chat_id=? ORDER BY id').all(req.params.id));});
app.delete('/api/chats/:id',auth,(req,res)=>{const x=db.prepare('DELETE FROM chats WHERE id=? AND user_id=?').run(req.params.id,req.user.id);if(!x.changes)return res.status(404).json({error:'Chat no encontrado.'});res.json({ok:true});});
app.post('/api/chat',auth,async(req,res)=>{
 const u=ensureUser(req,res);if(!u||!checkUsage(u,res))return;
 const chatId=String(req.body.chatId||''),message=String(req.body.message||'').trim();if(!chatId||!message||message.length>12000)return res.status(400).json({error:'Mensaje o conversación no válidos.'});
 const chat=ownedChat(chatId,u.id);if(!chat)return res.status(404).json({error:'Ese chat no existe en tu cuenta.'});
 const stamp=now(),first=!db.prepare('SELECT 1 FROM messages WHERE chat_id=? LIMIT 1').get(chatId);
 db.prepare("INSERT INTO messages(chat_id,user_id,role,content,created_at) VALUES(?,?,'user',?,?)").run(chatId,u.id,message,stamp);
 if(first)db.prepare('UPDATE chats SET title=?,updated_at=? WHERE id=?').run(titleFor(message),stamp,chatId);else db.prepare('UPDATE chats SET updated_at=? WHERE id=?').run(stamp,chatId);
 const previous=db.prepare('SELECT role,content FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT 16').all(chatId).reverse();
 try{const reply=await askAI([{role:'system',content:systemPrompt},...previous]);db.prepare("INSERT INTO messages(chat_id,user_id,role,content,created_at) VALUES(?,?,'assistant',?,?)").run(chatId,u.id,reply,now());db.prepare('UPDATE users SET used_today=used_today+1 WHERE id=?').run(u.id);res.json({reply,title:titleFor(message)});}
 catch(e){console.error(e);res.status(502).json({error:e.message||'No se pudo conectar con la IA.'});}
});
app.post('/api/generate',auth,async(req,res)=>{
 const u=ensureUser(req,res);if(!u||!checkUsage(u,res))return;
 const chatId=String(req.body.chatId||''),kind=String(req.body.kind||'file'),prompt=String(req.body.prompt||'').trim();
 if(!ownedChat(chatId,u.id))return res.status(404).json({error:'Conversación no encontrada.'});
 if(!prompt||prompt.length>10000)return res.status(400).json({error:'Describe lo que quieres crear (máximo 10.000 caracteres).'});
 const guide={file:'Genera el contenido completo de un único archivo útil. Devuelve SOLO el contenido del archivo, sin bloques Markdown ni explicaciones.',web:'Genera una página web completa en un único archivo HTML con CSS y JavaScript incluidos. Devuelve SOLO el código HTML.',game:'Genera un archivo de código inicial funcional y autocontenido para el motor o plataforma que indique el usuario. Si dice Unity, usa C#; si dice Roblox, usa Luau. Si no especifica, pregunta qué motor desea en lugar de inventarlo.'}[kind]||'Genera el archivo solicitado.';
 try{
  const content=await askAI([{role:'system',content:systemPrompt+' '+guide},{role:'user',content:prompt}]);
  const first=String(prompt).toLowerCase(),ext=kind==='web'?'html':(/roblox|luau/.test(first)?'lua':(/unity|c#/.test(first)?'cs':'txt'));
  const safe=first.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,28)||'nova-archivo';
  const filename=`${safe}.${ext}`;
  db.prepare("INSERT INTO messages(chat_id,user_id,role,content,created_at) VALUES(?,?,'user',?,?)").run(chatId,u.id,`[Generar ${kind}] ${prompt}`,now());
  db.prepare("INSERT INTO messages(chat_id,user_id,role,content,created_at) VALUES(?,?,'assistant',?,?)").run(chatId,u.id,`Archivo generado: ${filename}\n\n${content}`,now());
  db.prepare('UPDATE users SET used_today=used_today+1 WHERE id=?').run(u.id);
  res.json({filename,content});
 }catch(e){console.error(e);res.status(502).json({error:e.message||'No se pudo generar el archivo.'});}
});
app.get('/api/admin/users',auth,admin,(_q,s)=>s.json(db.prepare('SELECT id,email,role,daily_limit,used_today FROM users ORDER BY id DESC').all()));
app.patch('/api/admin/users/:id',auth,admin,(req,res)=>{
 const id=Number(req.params.id);
 if(req.body.daily_limit!==undefined){const n=Number(req.body.daily_limit);if(!Number.isInteger(n)||n<0||n>10000)return res.status(400).json({error:'Límite inválido.'});db.prepare("UPDATE users SET daily_limit=? WHERE id=? AND role='user'").run(n,id);}
 res.json({ok:true});
});
app.post('/api/admin/announcement',auth,admin,(req,res)=>{setSetting('announcement',String(req.body.text||'').slice(0,500));if(req.body.version)setSetting('version',String(req.body.version).slice(0,30));res.json({ok:true});});
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`NOVA AI escuchando en ${PORT}`));
