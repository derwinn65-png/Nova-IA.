const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "Public")));

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

app.get("/api/status", (_req, res) => {
  res.json({ configured: Boolean(ai) });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!ai) return res.status(503).json({ error: "Gemini no está configurado en Render." });
    const { message, history = [] } = req.body || {};
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Escribe un mensaje." });
    }
    const safeHistory = Array.isArray(history) ? history.slice(-20) : [];
    const contents = safeHistory
      .filter(x => x && typeof x.text === "string")
      .map(x => ({
        role: x.role === "model" ? "model" : "user",
        parts: [{ text: x.text.slice(0, 12000) }]
      }));
    contents.push({ role: "user", parts: [{ text: message.trim().slice(0, 12000) }] });

    const result = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: "Eres Nova AI, un asistente inteligente, creativo y útil. Responde en español cuando el usuario escriba en español."
      }
    });
    res.json({ reply: result.text || "No pude generar una respuesta." });
  } catch (err) {
    console.error("Gemini request failed:", err);
    res.status(500).json({ error: "Error al consultar Gemini. Revisa la configuración y los registros de Render." });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "Public", "index.html"));
});

app.listen(PORT, () => console.log(`Nova AI web server listening on ${PORT}`));
