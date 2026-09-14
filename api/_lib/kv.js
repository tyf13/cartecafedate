// Accès Redis via l'API REST Upstash (fournie par Vercel KV et par
// l'intégration Upstash du marketplace Vercel). Aucune dépendance npm :
// moins de surface d'attaque, rien à auditer en plus.

const BASE = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

export function kvConfigured() {
  return Boolean(BASE && TOKEN);
}

export async function kv(...command) {
  if (!kvConfigured()) throw new Error("KV non configuré");
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    // Un appel KV qui traîne ne doit pas bloquer la fonction.
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`KV ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`KV: ${data.error}`);
  return data.result;
}
