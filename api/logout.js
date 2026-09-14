import { closeSession, csrfOk, noStore } from "./_lib/auth.js";
import { kvConfigured } from "./_lib/kv.js";

export default async function handler(req, res) {
  noStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }
  if (!csrfOk(req)) {
    return res.status(403).json({ error: "Requête refusée : origine non reconnue." });
  }
  if (!kvConfigured()) {
    return res.status(503).json({ error: "Le serveur n'est pas configuré." });
  }

  // La session est supprimée côté serveur : le jeton devient inutilisable,
  // même si quelqu'un en avait gardé une copie.
  await closeSession(req, res);
  return res.status(200).json({ authenticated: false });
}
