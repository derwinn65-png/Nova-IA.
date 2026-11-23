const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOAD = path.join(DATA, "uploads");
const DB = path.join(DATA, "nova.json");

fs.mkdirSync(UPLOAD, { recursive: true });
app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "Public")));

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const id = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);

const defaultData = () => ({
  users: [],
  chats: [],
  files: [],
  settings: { announcement: "", version: "2.1.0" }
});

const read = () => {
  try {
    const d = JSON.parse(fs.readFileSync(DB, "utf8"));
    const base = defaultData();
    return {
      ...base,
      ...d,
      settings: { ...base.settings, ...(d.settings || {}) }
    };
  } catch {
    return defaultData();
  }
};

const write = (d) => {
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  fs.writeFileSync(DB, JSON.stringify(d, null, 2));
};

const safe = (u, d = read()) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  daily_limit: u.dailyLimit,
  used_today: u.usageDate === today() ? u.usedToday : 0,
  version: d.settings.version,
  announcement: d.settings.announcement
});

function auth(req, res, next) {
  try {
    if (!process.env.JWT_SECRET) throw new Error("Missing JWT_SECRET");
    const raw = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    req.user = jwt.verify(raw, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Inicia sesión para continuar." });
  }
}

function admin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Solo administrador." });
  }
  next();
}

function token(u) {
  return jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, {
    expiresIn: "30d"
  });
}

function bootstrap() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || "";
  if (!email || !pw) return;
  const d = read();
  let u = d.users.find((x) => x.email === email);
  if (!u) {
    d.users.push({
      id: id(),
      email,
      passwordHash: bcrypt.hashSync(pw, 12),
      role: "admin",
      dailyLimit: 10000,
      usedToday: 0,
      usageDate: today()
    });
  } else {
    u.role = "admin";
  }
  write(d);
}
bootstrap();

const storage = multer.diskStorage({
  destination: (_r, _f, cb) => cb(null, UPLOAD),
  filename: (_r, f, cb) => cb(null, id() + path.extname(f.originalname).slice(0, 10))
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 }
});

function saveFile(file, u, kind = "upload") {
  const f = {
    id: id(),
    ownerId: u.id,
    ownerEmail: u.email,
    originalName: path.basename(file.originalname).slice(0, 180),
    storedName: file.filename,
    mimeType: file.mimetype || "application/octet-stream",
    size: file.size,
    kind,
    createdAt: new Date().toISOString()
  };
  const d = read();
  d.files.push(f);
  write(d);
  return f;
}

function stripMarkdownFences(text) {
  return String(text || "")
    .trim()
    .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

app.get("/api/status", (_q, s) => s.json({ configured: !!ai, model: MODEL }));

app.post("/api/register", async (q, s) => {
  try {
    const email = String(q.body.email || "").trim().toLowerCase();
    const pw = String(q.body.password || "");
    if (!process.env.JWT_SECRET) return s.status(500).json({ error: "Falta JWT_SECRET." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return s.status(400).json({ error: "Correo no válido." });
    }
    if (pw.length < 8) return s.status(400).json({ error: "Usa al menos 8 caracteres." });
    const d = read();
    if (d.users.some((u) => u.email === email)) {
      return s.status(409).json({ error: "Ese correo ya tiene cuenta." });
    }
    const u = {
      id: id(),
      email,
      passwordHash: await bcrypt.hash(pw, 12),
      role: "user",
      dailyLimit: 30,
      usedToday: 0,
      usageDate: today()
    };
    d.users.push(u);
    write(d);
    s.json({ token: token(u), user: safe(u) });
  } catch (e) {
    console.error(e);
    s.status(500).json({ error: "No se pudo registrar." });
  }
});

app.post("/api/login", async (q, s) => {
  const d = read();
  const u = d.users.find(
    (x) => x.email === String(q.body.email || "").trim().toLowerCase()
  );
  if (!u || !(await bcrypt.compare(String(q.body.password || ""), u.passwordHash))) {
    return s.status(401).json({ error: "Correo o contraseña incorrectos." });
  }
  s.json({ token: token(u), user: safe(u) });
});

app.get("/api/me", auth, (q, s) => {
  const d = read();
  const u = d.users.find((x) => x.id === q.user.id);
  if (!u) return s.status(401).json({ error: "Cuenta no encontrada." });
  s.json(safe(u, d));
});

app.get("/api/chats", auth, (q, s) => {
  const chats = read()
    .chats.filter((c) => c.userId === q.user.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }));
  s.json(chats);
});

app.post("/api/chats", auth, (q, s) => {
  const d = read();
  const c = {
    id: id(),
    userId: q.user.id,
    title: "Nueva conversación",
    messages: [],
    updatedAt: new Date().toISOString()
  };
  d.chats.push(c);
  write(d);
  s.json({ id: c.id });
});

app.get("/api/chats/:id/messages", auth, (q, s) => {
  const c = read().chats.find((c) => c.id === q.params.id && c.userId === q.user.id);
  if (!c) return s.status(404).json({ error: "Chat no encontrado." });
  s.json(c.messages);
});

app.delete("/api/chats/:id", auth, (q, s) => {
  const d = read();
  const idx = d.chats.findIndex((c) => c.id === q.params.id && c.userId === q.user.id);
  if (idx === -1) return s.status(404).json({ error: "Chat no encontrado." });
  d.chats.splice(idx, 1);
  write(d);
  s.json({ ok: true });
});

app.post("/api/upload", auth, upload.single("file"), (q, s) => {
  if (!q.file) return s.status(400).json({ error: "Selecciona un archivo." });
  const f = saveFile(q.file, q.user);
  s.json({
    file: { id: f.id, originalName: f.originalName, mimeType: f.mimeType, size: f.size }
  });
});

app.post("/api/chat", auth, async (q, s) => {
  try {
    if (!ai) return s.status(503).json({ error: "Configura GEMINI_API_KEY en Render." });
    const d = read();
    const u = d.users.find((x) => x.id === q.user.id);
    const c = d.chats.find((x) => x.id === q.body.chatId && x.userId === q.user.id);
    const msg = String(q.body.message || "").trim();
    if (!c) return s.status(404).json({ error: "Chat no encontrado." });
    if (u.usageDate !== today()) {
      u.usageDate = today();
      u.usedToday = 0;
    }
    if (u.usedToday >= u.dailyLimit) return s.status(429).json({ error: "Límite diario alcanzado." });

    const parts = [];
    if (msg) parts.push({ text: msg });

    for (const fid of (q.body.attachmentIds || []).slice(0, 8)) {
      const f = d.files.find((x) => x.id === fid && x.ownerId === q.user.id);
      const p = f && path.join(UPLOAD, f.storedName);
      if (!f || !fs.existsSync(p)) continue;
      if (f.mimeType.startsWith("image/") && fs.statSync(p).size < 10 * 1024 * 1024) {
        parts.push({
          inlineData: { mimeType: f.mimeType, data: fs.readFileSync(p).toString("base64") }
        });
      } else {
        parts.push({
          text: `Archivo adjunto almacenado: ${f.originalName} (${f.mimeType}).`
        });
      }
    }

    if (!parts.length) {
      return s.status(400).json({ error: "Escribe un mensaje o adjunta una imagen." });
    }

    const contents = c.messages.slice(-20).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
    contents.push({ role: "user", parts });

    const result = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction:
          "Eres Nova AI, un asistente experto y creativo. Responde en español si el usuario escribe en español. Ayuda con programación, páginas web, archivos y videojuegos 3D. No inventes archivos ni acciones que no hayas realizado."
      }
    });

    const reply = result.text || "No pude generar respuesta.";
    c.messages.push({ role: "user", content: msg || "Archivo adjunto" }, { role: "assistant", content: reply });
    if (c.title === "Nueva conversación" && msg) c.title = msg.slice(0, 45);
    c.updatedAt = new Date().toISOString();
    u.usedToday++;
    write(d);
    s.json({ reply });
  } catch (e) {
    console.error(e);
    s.status(500).json({ error: "Error al consultar Gemini. Comprueba API Key, modelo y cuota." });
  }
});

app.post("/api/generate", auth, async (q, s) => {
  try {
    if (!ai) return s.status(503).json({ error: "Falta GEMINI_API_KEY." });
    const d = read();
    const u = d.users.find((x) => x.id === q.user.id);
    const c = d.chats.find((x) => x.id === q.body.chatId && x.userId === q.user.id);
    if (!c) return s.status(404).json({ error: "Chat no encontrado." });
    if (u.usageDate !== today()) {
      u.usageDate = today();
      u.usedToday = 0;
    }
    if (u.usedToday >= u.dailyLimit) return s.status(429).json({ error: "Límite diario alcanzado." });

    const kind = String(q.body.kind || "file");
    const prompt = String(q.body.prompt || "").trim();
    if (!prompt) return s.status(400).json({ error: "Describe qué archivo o juego quieres crear." });

    const instruction =
      kind === "game"
        ? "Crea un videojuego 3D completo, colorido y jugable en un solo archivo HTML usando Three.js desde CDN, con controles (teclado y/o táctiles), cámara/iluminación, puntuación o colisiones y bucle de animación."
        : kind === "web"
        ? "Crea una página web completa en un solo archivo HTML, con CSS y JavaScript incluidos."
        : "Crea el contenido completo del archivo solicitado.";

    const r = await ai.models.generateContent({
      model: MODEL,
      contents: `${instruction} Devuelve únicamente el código o contenido final, sin bloques Markdown (\`\`\`) ni explicaciones externas. Solicitud: ${prompt}`
    });

    const content = stripMarkdownFences(r.text || "");
    const ext = kind === "web" || kind === "game" ? "html" : "txt";
    const name = `nova-${kind}-${Date.now()}.${ext}`;
    const stored = `${id()}.${ext}`;

    fs.writeFileSync(path.join(UPLOAD, stored), content, "utf8");

    const f = {
      id: id(),
      ownerId: q.user.id,
      ownerEmail: q.user.email,
      originalName: name,
      storedName: stored,
      mimeType: ext === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
      size: Buffer.byteLength(content, "utf8"),
      kind: "generated",
      createdAt: new Date().toISOString()
    };

    d.files.push(f);
    c.messages.push(
      { role: "user", content: prompt },
      { role: "assistant", content: `Archivo creado: ${name}` }
    );
    if (c.title === "Nueva conversación") c.title = prompt.slice(0, 45);
    c.updatedAt = new Date().toISOString();
    u.usedToday++;
    write(d);

    s.json({
      content,
      filename: name,
      downloadUrl: `/api/files/${f.id}/download`
    });
  } catch (e) {
    console.error(e);
    s.status(500).json({ error: "No se pudo crear el archivo." });
  }
});

app.get(
  "/api/files/:id/download",
  (q, s, next) => {
    if (q.headers.authorization) return auth(q, s, next);
    try {
      q.user = jwt.verify(String(q.query.token || ""), process.env.JWT_SECRET);
      next();
    } catch {
      return s.status(401).json({ error: "Inicia sesión para descargar." });
    }
  },
  (q, s) => {
    const f = read().files.find((x) => x.id === q.params.id);
    if (!f || (q.user.role !== "admin" && f.ownerId !== q.user.id)) {
      return s.status(404).json({ error: "Archivo no encontrado." });
    }
    s.download(path.join(UPLOAD, f.storedName), f.originalName);
  }
);

app.get("/api/admin/users", auth, admin, (_q, s) => {
  const d = read();
  s.json(d.users.map((u) => safe(u, d)));
});

app.post("/api/admin/announcement", auth, admin, (q, s) => {
  const d = read();
  d.settings.announcement = String(q.body.text || "").slice(0, 500);
  d.settings.version = String(q.body.version || d.settings.version).slice(0, 40);
  write(d);
  s.json({ ok: true, settings: d.settings });
});

app.patch("/api/admin/users/:id", auth, admin, (q, s) => {
  const d = read();
  const u = d.users.find((x) => x.id === q.params.id);
  const n = Number(q.body.daily_limit);
  if (!u) return s.status(404).json({ error: "Usuario no encontrado." });
  if (!Number.isInteger(n) || n < 0 || n > 10000) {
    return s.status(400).json({ error: "Límite inválido." });
  }
  u.dailyLimit = n;
  write(d);
  s.json(safe(u));
});

app.get("/api/admin/files", auth, admin, (_q, s) => {
  const list = read()
    .files.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((f) => ({
      id: f.id,
      originalName: f.originalName,
      ownerEmail: f.ownerEmail,
      mimeType: f.mimeType,
      size: f.size,
      kind: f.kind,
      createdAt: f.createdAt
    }));
  s.json(list);
});

app.get("/api/admin/files/:id/download", auth, admin, (q, s) => {
  const f = read().files.find((x) => x.id === q.params.id);
  if (!f) return s.status(404).json({ error: "No existe." });
  s.download(path.join(UPLOAD, f.storedName), f.originalName);
});

app.get(/.*/, (_q, s) => {
  s.sendFile(path.join(__dirname, "Public", "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "El archivo supera el máximo de 15 MB."
          : "No se pudo subir el archivo."
    });
  }
  res.status(500).json({ error: "Error interno del servidor." });
});

app.listen(PORT, () => console.log("Nova AI en puerto " + PORT));

