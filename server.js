
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

const JWT_SECRET = process.env.JWT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

if (!JWT_SECRET) {
  console.error("Falta configurar JWT_SECRET en Render.");
  process.exit(1);
}

app.use(express.json({ limit: "1mb" }));

// ARCHIVOS DE NOVA
const publicDir = path.join(__dirname, "Public");
const indexFile = path.join(publicDir, "index.html");

console.log("Carpeta Public:", fs.existsSync(publicDir));
console.log("index.html encontrado:", fs.existsSync(indexFile));

app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(indexFile, (error) => {
    if (error) {
      console.error("No se pudo cargar index.html:", error);
      if (!res.headersSent) {
        res.status(500).send("No se encontró Public/index.html");
      }
    }
  });
});

// BASE DE DATOS
const db = new Database(
  process.env.DB_PATH || path.join(__dirname, "nova.db")
);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// CREAR ADMINISTRADOR INICIAL
async function createAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log("ADMIN_EMAIL o ADMIN_PASSWORD no configurados.");
    return;
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email);

  if (!existing) {
    const hash = await bcrypt.hash(password, 12);

    db.prepare(`
      INSERT INTO users (email, password_hash, role)
      VALUES (?, ?, 'admin')
    `).run(email, hash);

    console.log("Administrador inicial creado.");
  } else {
    db.prepare("UPDATE users SET role = 'admin' WHERE email = ?")
      .run(email);

    console.log("Administrador existente reconocido.");
  }
}

// AUTENTICACIÓN
function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      error: "Inicia sesión para continuar."
    });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: "Sesión inválida o expirada."
    });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      error: "Acceso exclusivo para administradores."
    });
  }

  next();
}

// REGISTRO
app.post("/api/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Correo inválido." });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "La contraseña debe tener al menos 6 caracteres."
      });
    }

    const existing = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email);

    if (existing) {
      return res.status(409).json({
        error: "Ese correo ya está registrado."
      });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = db.prepare(`
      INSERT INTO users (email, password_hash, role)
      VALUES (?, ?, 'user')
    `).run(email, hash);

    const user = {
      id: Number(result.lastInsertRowid),
      email,
      role: "user"
    };

    res.status(201).json({
      message: "Cuenta creada correctamente.",
      token: createToken(user),
      user
    });
  } catch (error) {
    console.error("Error en registro:", error);
    res.status(500).json({ error: "No se pudo crear la cuenta." });
  }
});

// INICIO DE SESIÓN
app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        error: "Correo o contraseña incorrectos."
      });
    }

    const safeUser = {
      id: user.id,
      email: user.email,
      role: user.role
    };

    res.json({
      message: "Sesión iniciada.",
      token: createToken(safeUser),
      user: safeUser
    });
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({ error: "Error al iniciar sesión." });
  }
});

// USUARIO ACTUAL
app.get("/api/me", authenticate, (req, res) => {
  const user = db.prepare(`
    SELECT id, email, role, created_at
    FROM users
    WHERE id = ?
  `).get(req.user.id);

  if (!user) {
    return res.status(404).json({ error: "Usuario no encontrado." });
  }

  res.json({ user });
});

// CHAT CON NOVA
app.post("/api/chat", authenticate, async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();

    if (!message) {
      return res.status(400).json({
        error: "Escribe un mensaje."
      });
    }

    if (!OPENAI_API_KEY) {
      return res.status(503).json({
        error: "Falta configurar OPENAI_API_KEY en Render."
      });
    }

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            {
              role: "system",
              content:
                "Eres Nova, una inteligencia artificial útil, creativa y experta en programación, videojuegos, HTML y tecnología. Responde en el idioma del usuario."
            },
            {
              role: "user",
              content: message
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Error de OpenAI:", data);
      return res.status(response.status).json({
        error: data.error?.message || "Error al comunicarse con la IA."
      });
    }

    res.json({
      reply: data.choices?.[0]?.message?.content || "No recibí una respuesta."
    });
  } catch (error) {
    console.error("Error en chat:", error);
    res.status(500).json({ error: "Error interno del chat." });
  }
});

// LISTA DE USUARIOS PARA ADMIN
app.get("/api/admin/users", authenticate, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, email, role, created_at
    FROM users
    ORDER BY id DESC
  `).all();

  res.json({ users });
});

// MODIFICAR USUARIO
app.patch("/api/admin/users/:id", authenticate, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { role } = req.body;

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "ID inválido." });
  }

  if (!["user", "admin"].includes(role)) {
    return res.status(400).json({ error: "Rol inválido." });
  }

  const result = db.prepare(`
    UPDATE users SET role = ? WHERE id = ?
  `).run(role, id);

  if (!result.changes) {
    return res.status(404).json({ error: "Usuario no encontrado." });
  }

  res.json({ message: "Usuario actualizado." });
});

// PUBLICAR ANUNCIO
app.post("/api/admin/announcement", authenticate, requireAdmin, (req, res) => {
  const message = String(req.body.message || "").trim();

  if (!message) {
    return res.status(400).json({ error: "El anuncio está vacío." });
  }

  db.prepare(`
    INSERT INTO announcements (message)
    VALUES (?)
  `).run(message);

  res.json({ message: "Anuncio publicado." });
});

// CONSULTAR ANUNCIOS
app.get("/api/announcements", (req, res) => {
  const announcements = db.prepare(`
    SELECT id, message, created_at
    FROM announcements
    ORDER BY id DESC
    LIMIT 20
  `).all();

  res.json({ announcements });
});

// COMPROBAR SERVIDOR
app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    name: "Nova AI"
  });
});

// INICIAR SERVIDOR
createAdmin()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Nova AI funcionando en el puerto ${PORT}`);
      console.log(`Página principal: ${indexFile}`);
    });
  })
  .catch((error) => {
    console.error("No se pudo iniciar Nova:", error);
    process.exit(1);
  });
