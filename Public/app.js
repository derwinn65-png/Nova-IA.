const $ = (id) => document.getElementById(id);

let token = localStorage.getItem("nova_token") || null;
let user = null;
let currentChatId = null;
let history = [];
let registering = false;

const api = async (url, options = {}) => {
  const r = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(options.headers || {})
    }
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Error de conexión");
  return d;
};

function bubble(role, text) {
  const el = document.createElement("div");
  el.className = "bubble " + role;
  el.textContent = text;
  $("chat").append(el);
  $("chat").scrollTop = $("chat").scrollHeight;
  return el;
}

function appendDownloadBubble(filename, downloadUrl, kind = "file") {
  const el = document.createElement("div");
  el.className = "bubble assistant download-bubble";

  const label = document.createElement("div");
  label.textContent =
    kind === "game"
      ? `Juego 3D listo: ${filename}`
      : `Archivo listo: ${filename}`;

  const link = document.createElement("a");
  const sep = downloadUrl.includes("?") ? "&" : "?";
  link.href = `${downloadUrl}${sep}token=${encodeURIComponent(token || "")}`;
  link.download = filename;
  link.className = "download-btn";
  link.textContent = `⬇ Descargar ${filename}`;

  el.append(label, link);
  $("chat").append(el);
  $("chat").scrollTop = $("chat").scrollHeight;
  return el;
}

function welcome() {
  $("chat").innerHTML = `
    <div class="welcome">
      <div class="hero-logo">✦</div>
      <h1>Hola, soy NOVA.</h1>
      <p>¿Qué vamos a crear hoy?</p>
      <div class="suggestions">
        <button type="button">Créame una página web moderna</button>
        <button type="button">Crea un juego 3D de esquivar obstáculos</button>
        <button type="button">Crea un archivo HTML con una calculadora</button>
        <button type="button">Corrige este código</button>
      </div>
    </div>`;
  document.querySelectorAll(".suggestions button").forEach((b) => {
    b.onclick = () => {
      $("message").value = b.textContent;
      $("message").focus();
    };
  });
}

async function ensureChat() {
  if (currentChatId) return currentChatId;
  const chats = await api("/api/chats");
  if (chats.length > 0) {
    currentChatId = chats[0].id;
    return currentChatId;
  }
  const created = await api("/api/chats", { method: "POST", body: JSON.stringify({}) });
  currentChatId = created.id;
  return currentChatId;
}

async function renderChatsList() {
  const list = $("chatsList");
  if (!list || !token) return;
  const chats = await api("/api/chats");
  list.innerHTML = "";
  chats.forEach((c) => {
    const row = document.createElement("div");
    row.className = "chat-item" + (c.id === currentChatId ? " active" : "");

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "chat-select";
    openBtn.textContent = c.title || "Nueva conversación";
    openBtn.onclick = async () => {
      currentChatId = c.id;
      const msgs = await api(`/api/chats/${c.id}/messages`);
      history = msgs;
      $("chat").innerHTML = "";
      if (!msgs.length) welcome();
      else msgs.forEach((m) => bubble(m.role, m.content));
      showChat();
      await renderChatsList();
    };

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "chat-delete";
    delBtn.textContent = "Borrar";
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      await api(`/api/chats/${c.id}`, { method: "DELETE" });
      if (currentChatId === c.id) {
        currentChatId = null;
        history = [];
        welcome();
      }
      await renderChatsList();
    };

    row.append(openBtn, delBtn);
    list.append(row);
  });
}

async function refresh() {
  if (!token) {
    $("account").textContent = "No has iniciado sesión";
    $("authOpen").hidden = false;
    $("logout").hidden = true;
    $("adminNav").hidden = true;
    welcome();
    return;
  }
  try {
    const d = await api("/api/me");
    user = d;
    $("account").textContent =
      d.email +
      " · " +
      (d.role === "admin" ? "Propietario" : `${d.used_today}/${d.daily_limit} mensajes hoy`);
    $("authOpen").hidden = true;
    $("logout").hidden = false;
    $("adminNav").hidden = d.role !== "admin";
    if ($("version")) $("version").textContent = "v" + d.version;
    if ($("announcement")) {
      $("announcement").hidden = !d.announcement;
      $("announcement").textContent = d.announcement;
    }
    await ensureChat();
    await renderChatsList();
    if (!history.length && !$("chat").children.length) welcome();
  } catch {
    logout();
  }
}

function logout() {
  token = null;
  user = null;
  currentChatId = null;
  history = [];
  localStorage.removeItem("nova_token");
  refresh();
}

function detectGenerationKind(text) {
  const t = text.toLowerCase();
  const wantsFile =
    t.includes("archivo") ||
    t.includes("descarg") ||
    t.includes("juego") ||
    t.includes("3d") ||
    t.includes("página web") ||
    t.includes("pagina web") ||
    t.includes("html");
  if (!wantsFile) return null;
  if (t.includes("juego") || t.includes("3d")) return "game";
  if (t.includes("página web") || t.includes("pagina web") || t.includes("html")) return "web";
  return "file";
}

$("authOpen").onclick = () => {
  $("authDialog").showModal();
};

$("toggleAuth").onclick = () => {
  registering = !registering;
  $("authTitle").textContent = registering ? "Crear cuenta" : "Iniciar sesión";
  $("authSubmit").textContent = registering ? "Registrarme" : "Entrar";
  $("toggleAuth").textContent = registering ? "Ya tengo una cuenta" : "Crear una cuenta";
  $("authError").textContent = "";
};

$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const d = await api(registering ? "/api/register" : "/api/login", {
      method: "POST",
      body: JSON.stringify({ email: $("email").value, password: $("password").value })
    });
    token = d.token;
    localStorage.setItem("nova_token", token);
    $("authDialog").close();
    currentChatId = null;
    history = [];
    await refresh();
  } catch (err) {
    $("authError").textContent = err.message;
  }
};

$("composer").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("message").value.trim();
  if (!text) return;
  if (!token) {
    $("authDialog").showModal();
    $("authError").textContent = "Inicia sesión para hablar con NOVA.";
    return;
  }

  $("message").value = "";
  document.querySelector(".welcome")?.remove();
  history.push({ role: "user", content: text });
  bubble("user", text);

  const genKind = detectGenerationKind(text);
  const loading = bubble(
    "assistant",
    genKind ? "NOVA está creando tu archivo y enlace de descarga…" : "NOVA está pensando…"
  );
  $("send").disabled = true;

  try {
    const chatId = await ensureChat();
    if (genKind) {
      const gen = await api("/api/generate", {
        method: "POST",
        body: JSON.stringify({ chatId, kind: genKind, prompt: text })
      });
      loading.textContent = `Listo, creé "${gen.filename}". Toca el botón de abajo para descargarlo:`;
      history.push({ role: "assistant", content: `Archivo creado: ${gen.filename}` });
      appendDownloadBubble(gen.filename, gen.downloadUrl, genKind);
    } else {
      const d = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ chatId, message: text, attachmentIds: [] })
      });
      loading.textContent = d.reply;
      history.push({ role: "assistant", content: d.reply });
    }
    await renderChatsList();
    await refresh();
  } catch (err) {
    loading.textContent = "⚠ " + err.message;
    history.pop();
  } finally {
    $("send").disabled = false;
  }
};

function showChat() {
  $("adminPanel").hidden = true;
  $("chat").hidden = false;
  $("composer").hidden = false;
  document.querySelectorAll(".nav").forEach((n) => n.classList.remove("active"));
  $("chatNav").classList.add("active");
}

$("newChat").onclick = async () => {
  if (!token) {
    history = [];
    welcome();
    showChat();
    return;
  }
  const created = await api("/api/chats", { method: "POST", body: JSON.stringify({}) });
  currentChatId = created.id;
  history = [];
  welcome();
  showChat();
  await renderChatsList();
};

$("chatNav").onclick = showChat;
$("backToChat").onclick = showChat;

$("logout").onclick = () => {
  logout();
  history = [];
  welcome();
  showChat();
};

document.addEventListener("click", (e) => {
  const b = e.target.closest(".suggestions button");
  if (b) {
    $("message").value = b.textContent;
    $("message").focus();
  }
});

$("adminNav").onclick = async () => {
  document.querySelectorAll(".nav").forEach((n) => n.classList.remove("active"));
  $("adminNav").classList.add("active");
  $("chat").hidden = true;
  $("composer").hidden = true;
  $("adminPanel").hidden = false;
  try {
    const users = await api("/api/admin/users");
    $("users").innerHTML = "";
    users.forEach((u) => {
      const row = document.createElement("div");
      row.className = "user-row";
      row.textContent = `${u.email} · ${u.role} · ${u.used_today}/${u.daily_limit} `;
      if (u.role === "user") {
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.max = "10000";
        input.value = u.daily_limit;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Guardar límite";
        btn.onclick = async () => {
          await api(`/api/admin/users/${u.id}`, {
            method: "PATCH",
            body: JSON.stringify({ daily_limit: Number(input.value) })
          });
          btn.textContent = "Guardado";
        };
        row.append(input, btn);
      }
      $("users").append(row);
    });
  } catch (e) {
    $("users").textContent = e.message;
  }
};

$("saveAnnouncement").onclick = async () => {
  try {
    await api("/api/admin/announcement", {
      method: "POST",
      body: JSON.stringify({
        text: $("announcementInput").value,
        version: $("versionInput").value
      })
    });
    alert("Actualización publicada");
    await refresh();
  } catch (e) {
    alert(e.message);
  }
};

$("mobileMenu").onclick = () =>
  $("mobileMenu").parentElement.previousElementSibling.classList.toggle("open");

$("message").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

refresh();
