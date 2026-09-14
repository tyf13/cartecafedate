import { currentSession, csrfOk, noStore } from "./_lib/auth.js";
import { kv, kvConfigured } from "./_lib/kv.js";
import { DEFAULT_MENU, validateMenu, MAX_PAYLOAD_BYTES } from "./_lib/menu.js";

const KEY = "cafedet:menu";

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "GET") return readMenu(req, res);
  if (req.method === "PUT") return writeMenu(req, res);

  res.setHeader("Allow", "GET, PUT");
  noStore(res);
  return res.status(405).json({ error: "Méthode non autorisée." });
}

/* ---------------- Lecture : publique ---------------- */
async function readMenu(req, res) {
  // Le CDN de Vercel sert la carte pendant 10 s, ce qui absorbe une
  // soirée entière de scans sans toucher au stockage.
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=10, stale-while-revalidate=60");

  // ?default=1 renvoie la carte d'origine sans rien modifier :
  // l'admin s'en sert pour proposer une remise à zéro.
  const query = req.query || {};
  if (query.default === "1") return res.status(200).json(DEFAULT_MENU);

  if (!kvConfigured()) return res.status(200).json(DEFAULT_MENU);

  try {
    const raw = await kv("GET", KEY);
    if (!raw) return res.status(200).json(DEFAULT_MENU);
    const parsed = JSON.parse(raw);
    const check = validateMenu(parsed);
    return res.status(200).json(check.ok ? check.value : DEFAULT_MENU);
  } catch {
    // Le service doit rester lisible même si le stockage tombe.
    return res.status(200).json(DEFAULT_MENU);
  }
}

/* ---------------- Écriture : réservée à l'admin ---------------- */
async function writeMenu(req, res) {
  noStore(res);

  if (!csrfOk(req)) {
    return res.status(403).json({ error: "Requête refusée : origine non reconnue." });
  }
  if (!kvConfigured()) {
    return res.status(503).json({ error: "Le serveur n'est pas configuré." });
  }

  let session;
  try {
    session = await currentSession(req);
  } catch {
    session = null;
  }
  if (!session) {
    return res.status(401).json({ error: "Session expirée. Reconnecte-toi." });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const serialized = JSON.stringify(body ?? null);
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ error: "Carte trop lourde. Allège le logo ou les descriptions." });
  }

  const check = validateMenu(body);
  if (!check.ok) return res.status(400).json({ error: check.error });

  await kv("SET", KEY, JSON.stringify(check.value));
  // On renvoie la version normalisée : le client affiche exactement
  // ce qui est enregistré, sans supposer que son état local est juste.
  return res.status(200).json(check.value);
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
