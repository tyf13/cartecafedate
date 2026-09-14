"use strict";
/* Aucun secret ici. L'authentification est entièrement côté serveur :
   ce fichier ne fait que demander, afficher et proposer des modifications
   que le serveur accepte ou refuse. */

const API_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "cafedet-admin", // exigé par le serveur : barrière CSRF
};

let menu = { logo: "", categories: [] };
let dirty = false;

/* ------------------------------------------------------------------
   Utilitaires
------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: API_HEADERS,
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* réponse sans corps */ }
  return { ok: res.ok, status: res.status, data };
}

/* ------------------------------------------------------------------
   Carte publique
------------------------------------------------------------------ */
async function loadMenu() {
  const { ok, data } = await api("/api/menu", { method: "GET" });
  if (ok && data && Array.isArray(data.categories)) menu = data;
  renderMenu();
}

function renderMenu() {
  const host = $("menu");
  const jump = $("jump");
  host.innerHTML = "";
  jump.innerHTML = "";
  host.setAttribute("aria-busy", "false");

  if (!menu.categories.length) {
    host.innerHTML = '<p class="loading">La carte est vide pour le moment.</p>';
  }

  for (const cat of menu.categories) {
    const anchor = `cat-${cat.id}`;

    const link = document.createElement("a");
    link.href = `#${anchor}`;
    link.textContent = cat.name;
    jump.appendChild(link);

    const sec = document.createElement("section");
    sec.className = "cat";
    sec.id = anchor;
    sec.innerHTML =
      `<h2><span>${esc(cat.name)}</span></h2><div class="rule"></div>` +
      cat.items.map((it) => {
        const price = it.price ? `${esc(it.price)}€` : "";
        if (!it.name) {
          return `<div class="item noname"><div class="row"><p class="desc">${esc(it.desc)}</p><span class="price">${price}</span></div></div>`;
        }
        return `<div class="item"><div class="row"><span class="name">${esc(it.name)}</span><span class="price">${price}</span></div>` +
          (it.desc ? `<p class="desc">${esc(it.desc)}</p>` : "") + "</div>";
      }).join("");
    host.appendChild(sec);
  }

  $("logoSlot").innerHTML = menu.logo
    ? `<img class="logo" src="${esc(menu.logo)}" alt="Logo FEDET">`
    : LOGO_SVG;

  markActive();
}

function markActive() {
  const links = Array.from(document.querySelectorAll("#jump a"));
  if (!links.length) return;
  const y = window.scrollY + 120;
  let current = links[0];
  document.querySelectorAll(".cat").forEach((sec) => {
    if (sec.offsetTop <= y) {
      const match = links.find((l) => l.getAttribute("href") === `#${sec.id}`);
      if (match) current = match;
    }
  });
  links.forEach((l) => l.classList.toggle("on", l === current));
}

window.addEventListener("scroll", () => {
  if (!$("view-menu").classList.contains("hidden")) markActive();
}, { passive: true });

const LOGO_SVG = `<svg class="logo" viewBox="0 0 240 150" role="img" aria-label="Logo FEDET">
  <circle cx="120" cy="58" r="44" fill="none" stroke="#1B3B6F" stroke-width="5"/>
  <path d="M78 74 C96 40 128 22 166 20 C150 36 146 46 144 58 C158 50 172 44 186 44 C168 58 150 78 132 92 C120 101 104 100 96 92 Z" fill="#2B5FA8"/>
  <path d="M96 92 C104 82 118 72 134 66 C124 82 112 92 100 96 Z" fill="#1B3B6F"/>
  <text x="120" y="130" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="700" font-size="30" letter-spacing="3" fill="#1B3B6F">FEDET</text>
  <text x="120" y="144" text-anchor="middle" font-family="Poppins, sans-serif" font-size="8.5" letter-spacing=".6" fill="#1B3B6F">Fédération Des Étudiants Toulonnais</text>
</svg>`;

/* ------------------------------------------------------------------
   Enregistrement
------------------------------------------------------------------ */
let saveTimer = null;

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  flash("Enregistrement…", "wait");
  saveTimer = setTimeout(saveNow, 600);
}

async function saveNow() {
  const { ok, status, data } = await api("/api/menu", {
    method: "PUT",
    body: JSON.stringify(menu),
  });

  if (ok && data) {
    menu = data; // version normalisée par le serveur
    dirty = false;
    flash("Enregistré");
    renderMenu();
    $("json").value = JSON.stringify(menu, null, 2);
    return;
  }
  if (status === 401) {
    flash("Session expirée. Reconnecte-toi.", "bad");
    route();
    return;
  }
  flash((data && data.error) || "Échec de l'enregistrement.", "bad");
}

window.addEventListener("beforeunload", (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});

function flash(message, kind) {
  const el = $("status");
  el.textContent = message;
  el.style.color = kind === "bad" ? "var(--danger)" : kind === "wait" ? "var(--muted)" : "var(--ok)";
}

/* ------------------------------------------------------------------
   Éditeur
------------------------------------------------------------------ */
function renderAdmin() {
  const host = $("cats");
  host.innerHTML = "";

  menu.categories.forEach((cat, ci) => {
    const box = document.createElement("div");
    box.className = "catbox";
    box.innerHTML = `
      <div class="head">
        <input type="text" value="${esc(cat.name)}" data-act="catname" aria-label="Nom de la catégorie">
        <button class="ghost mini" data-act="up" type="button" ${ci === 0 ? "disabled" : ""} aria-label="Monter la catégorie">▲</button>
        <button class="ghost mini" data-act="down" type="button" ${ci === menu.categories.length - 1 ? "disabled" : ""} aria-label="Descendre la catégorie">▼</button>
        <button class="danger mini" data-act="delcat" type="button">Supprimer</button>
      </div>
      <div class="items"></div>
      <div class="btns"><button class="ghost mini" data-act="additem" type="button">Ajouter un article</button></div>`;

    const items = box.querySelector(".items");
    cat.items.forEach((it, ii) => {
      const row = document.createElement("div");
      row.className = "itembox";
      row.innerHTML = `
        <input type="text" value="${esc(it.name)}" placeholder="Nom de l'article" data-f="name" aria-label="Nom de l'article">
        <input type="text" value="${esc(it.price)}" placeholder="Prix" data-f="price" inputmode="decimal" aria-label="Prix en euros">
        <button class="danger mini" data-act="delitem" type="button" aria-label="Supprimer l'article">✕</button>
        <input class="full" type="text" value="${esc(it.desc)}" placeholder="Description (facultatif)" data-f="desc" aria-label="Description">`;

      row.querySelectorAll("input").forEach((input) => {
        input.addEventListener("input", () => {
          it[input.dataset.f] = input.value;
          scheduleSave();
        });
      });
      row.querySelector('[data-act="delitem"]').addEventListener("click", () => {
        cat.items.splice(ii, 1);
        renderAdmin();
        scheduleSave();
      });
      items.appendChild(row);
    });

    box.querySelector('[data-act="catname"]').addEventListener("input", (e) => {
      cat.name = e.target.value;
      scheduleSave();
    });
    box.querySelector('[data-act="additem"]').addEventListener("click", () => {
      cat.items.push({ name: "", price: "", desc: "" });
      renderAdmin();
      scheduleSave();
    });
    box.querySelector('[data-act="delcat"]').addEventListener("click", () => {
      if (!confirm(`Supprimer la catégorie « ${cat.name} » et ses articles ?`)) return;
      menu.categories.splice(ci, 1);
      renderAdmin();
      scheduleSave();
    });
    box.querySelector('[data-act="up"]').addEventListener("click", () => {
      [menu.categories[ci - 1], menu.categories[ci]] = [menu.categories[ci], menu.categories[ci - 1]];
      renderAdmin();
      scheduleSave();
    });
    box.querySelector('[data-act="down"]').addEventListener("click", () => {
      [menu.categories[ci + 1], menu.categories[ci]] = [menu.categories[ci], menu.categories[ci + 1]];
      renderAdmin();
      scheduleSave();
    });

    host.appendChild(box);
  });

  $("json").value = JSON.stringify(menu, null, 2);
  $("logoUrl").value = menu.logo && menu.logo.startsWith("data:") ? "" : (menu.logo || "");
}

function wireAdmin() {
  $("addCat").addEventListener("click", () => {
    menu.categories.push({ name: "Nouvelle catégorie", items: [] });
    renderAdmin();
    scheduleSave();
  });

  $("exportBtn").addEventListener("click", async () => {
    const field = $("json");
    field.value = JSON.stringify(menu, null, 2);
    try {
      await navigator.clipboard.writeText(field.value);
      flash("JSON copié");
    } catch {
      field.select();
      flash("Sélectionné : copie avec Ctrl+C");
    }
  });

  $("importBtn").addEventListener("click", () => {
    let parsed;
    try {
      parsed = JSON.parse($("json").value);
    } catch {
      flash("JSON invalide : vérifie les virgules et les accolades.", "bad");
      return;
    }
    if (!parsed || !Array.isArray(parsed.categories)) {
      flash("JSON invalide : il manque la liste « categories ».", "bad");
      return;
    }
    menu = parsed;
    renderAdmin();
    scheduleSave();
  });

  $("resetBtn").addEventListener("click", async () => {
    if (!confirm("Revenir à la carte d'origine ? Les modifications seront perdues.")) return;
    const { ok, data } = await api("/api/menu?default=1", { method: "GET" });
    if (!ok) { flash("Impossible de charger la carte d'origine.", "bad"); return; }
    menu = data;
    renderAdmin();
    scheduleSave();
  });

  $("logoUrl").addEventListener("input", (e) => {
    menu.logo = e.target.value.trim();
    scheduleSave();
  });
  $("logoFileBtn").addEventListener("click", () => $("logoFile").click());
  $("logoFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 280_000) {
      flash("Image trop lourde : 280 Ko maximum.", "bad");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      menu.logo = String(reader.result);
      scheduleSave();
    };
    reader.readAsDataURL(file);
  });
  $("logoReset").addEventListener("click", () => {
    menu.logo = "";
    $("logoUrl").value = "";
    scheduleSave();
  });

  $("qrGen").addEventListener("click", makeQR);
  $("qrPrint").addEventListener("click", printQR);

  $("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    location.hash = "";
    route();
  });
}

/* ------------------------------------------------------------------
   QR-Code (bibliothèque servie depuis le site, pas depuis un CDN)
------------------------------------------------------------------ */
function publicUrl() {
  return location.href.split("#")[0];
}

function makeQR() {
  const url = $("qrUrl").value.trim() || publicUrl();
  if (!window.QRCode) return;
  window.QRCode.toCanvas($("qr"), url, {
    width: 200,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0A0A0A", light: "#FFFFFF" },
  }, (err) => {
    if (err) flash("QR-Code impossible à générer pour cette adresse.", "bad");
  });
}

function printQR() {
  try {
    $("printQr").src = $("qr").toDataURL("image/png");
  } catch {
    flash("Génère d'abord le QR-Code.", "bad");
    return;
  }
  document.body.classList.add("print-qr");
  window.print();
}

window.addEventListener("afterprint", () => document.body.classList.remove("print-qr"));

/* ------------------------------------------------------------------
   Connexion
------------------------------------------------------------------ */
function wireGate() {
  const submit = async () => {
    const button = $("loginBtn");
    const field = $("pw");
    button.disabled = true;
    $("pwErr").textContent = "";

    const { ok, status, data } = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: field.value }),
    });
    field.value = "";
    button.disabled = false;

    if (ok && data && data.authenticated) { route(); return; }
    if (status === 429) {
      $("pwErr").textContent = (data && data.error) || "Trop de tentatives.";
      return;
    }
    $("pwErr").textContent = (data && data.error) || "Connexion impossible.";
  };

  $("loginBtn").addEventListener("click", submit);
  $("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

/* ------------------------------------------------------------------
   Routage
------------------------------------------------------------------ */
async function route() {
  const isAdmin = location.hash === "#admin";
  $("view-menu").classList.toggle("hidden", isAdmin);
  $("view-admin").classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;

  const { data } = await api("/api/login", { method: "GET" });
  const authed = Boolean(data && data.authenticated);

  $("gate").classList.toggle("hidden", authed);
  $("editor").classList.toggle("hidden", !authed);

  if (authed) {
    renderAdmin();
    if (!$("qrUrl").value) $("qrUrl").value = publicUrl();
    makeQR();
  } else {
    $("pw").focus();
  }
}

window.addEventListener("hashchange", route);

/* ------------------------------------------------------------------
   Démarrage
------------------------------------------------------------------ */
(async function init() {
  wireGate();
  wireAdmin();
  await loadMenu();
  await route();
})();
