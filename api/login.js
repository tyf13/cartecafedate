import {
  verifyPassword,
  openSession,
  currentSession,
  rateLimit,
  clientFingerprint,
  csrfOk,
  noStore,
  secretsConfigured,
} from "./_lib/auth.js";
import { kvConfigured } from "./_lib/kv.js";

export default async function handler(req, res) {
  noStore(res);

  if (!kvConfigured() || !secretsConfigured()) {
    return res.status(503).json({
      error: "Le serveur n'est pas configuré. Vérifie les variables d'environnement sur Vercel.",
    });
  }

  // État de la session en cours — sert uniquement à afficher le bon écran.
  if (req.method === "GET") {
    try {
      const session = await currentSession(req);
      return res.status(200).json({ authenticated: Boolean(session) });
    } catch {
      return res.status(200).json({ authenticated: false });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  if (!csrfOk(req)) {
    return res.status(403).json({ error: "Requête refusée : origine non reconnue." });
  }

  let fingerprint;
  try {
    fingerprint = clientFingerprint(req);
  } catch {
    return res.status(503).json({ error: "Le serveur n'est pas configuré." });
  }

  // Deux barrières : par appareil, puis globale sur le compte.
  // La seconde protège même si l'attaquant fait tourner ses adresses IP.
  const perClient = await rateLimit(`rl:login:${fingerprint}`, 5, 900);
  if (!perClient.allowed) {
    res.setHeader("Retry-After", String(perClient.retryAfter));
    return res.status(429).json({
      error: "Trop de tentatives. Réessaie dans quelques minutes.",
      retryAfter: perClient.retryAfter,
    });
  }
  const global = await rateLimit("rl:login:global", 40, 900);
  if (!global.allowed) {
    res.setHeader("Retry-After", String(global.retryAfter));
    return res.status(429).json({
      error: "Connexion temporairement verrouillée. Réessaie plus tard.",
      retryAfter: global.retryAfter,
    });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const password = body && typeof body.password === "string" ? body.password : "";
  if (password.length > 200) {
    return res.status(400).json({ error: "Mot de passe invalide." });
  }

  // verifyPassword compare en temps constant et échoue proprement
  // si le hash n'est pas exploitable.
  if (!verifyPassword(password)) {
    return res.status(401).json({ error: "Mot de passe incorrect." });
  }

  const exp = await openSession(res);
  return res.status(200).json({ authenticated: true, expiresAt: exp });
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
