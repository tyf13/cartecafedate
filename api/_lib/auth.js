import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHmac,
  createHash,
} from "node:crypto";
import { kv } from "./kv.js";

export const SESSION_TTL = 60 * 60 * 2; // 2 heures
const COOKIE = "cafedet_sid";

/* ------------------------------------------------------------------
   Secrets — uniquement via variables d'environnement.
   Rien de sensible n'est jamais écrit dans le dépôt.
------------------------------------------------------------------ */
function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET manquant ou trop court");
  return s;
}

export function secretsConfigured() {
  const s = process.env.SESSION_SECRET;
  const h = process.env.ADMIN_PASSWORD_HASH;
  return Boolean(s && s.length >= 32 && h && h.startsWith("scrypt$"));
}

/* ------------------------------------------------------------------
   Mot de passe : vérification scrypt à comparaison en temps constant.
   Format stocké : scrypt$N$r$p$sel_b64$empreinte_b64
------------------------------------------------------------------ */
export function verifyPassword(password) {
  const stored = process.env.ADMIN_PASSWORD_HASH || "";
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, N, r, p, saltB64, hashB64] = parts;
  let salt, expected, actual;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
    actual = scryptSync(Buffer.from(String(password), "utf8"), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/* ------------------------------------------------------------------
   Jeton de session : identifiant aléatoire signé en HMAC-SHA256.
   L'identifiant est aussi stocké dans Redis, ce qui rend la
   déconnexion réellement effective (révocation côté serveur).
------------------------------------------------------------------ */
function sign(body) {
  return createHmac("sha256", sessionSecret()).update(body).digest("base64url");
}

export function createToken() {
  const jti = randomBytes(24).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const body = Buffer.from(JSON.stringify({ jti, exp }), "utf8").toString("base64url");
  return { token: `${body}.${sign(body)}`, jti, exp };
}

export function readToken(token) {
  if (typeof token !== "string" || token.length < 8 || token.length > 512) return null;
  const i = token.lastIndexOf(".");
  if (i < 1) return null;

  const body = token.slice(0, i);
  const given = Buffer.from(token.slice(i + 1), "utf8");
  const expected = Buffer.from(sign(body), "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.jti !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp * 1000 <= Date.now()) return null;
  return payload;
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export async function currentSession(req) {
  const payload = readToken(readCookie(req, COOKIE));
  if (!payload) return null;
  // Le jeton est valide cryptographiquement, mais a-t-il été révoqué ?
  const alive = await kv("EXISTS", `sess:${payload.jti}`);
  return alive === 1 ? payload : null;
}

export async function openSession(res) {
  const { token, jti, exp } = createToken();
  await kv("SET", `sess:${jti}`, "1", "EX", String(SESSION_TTL));
  setCookie(res, token, SESSION_TTL);
  return exp;
}

export async function closeSession(req, res) {
  const payload = readToken(readCookie(req, COOKIE));
  if (payload) await kv("DEL", `sess:${payload.jti}`);
  setCookie(res, "", 0);
}

function setCookie(res, value, maxAge) {
  res.setHeader("Set-Cookie", [
    `${COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly", // inaccessible au JavaScript : un XSS ne peut pas voler la session
    "Secure", // jamais transmis en clair
    "SameSite=Strict", // le cookie ne part pas sur une requête venue d'un autre site (anti-CSRF)
    `Max-Age=${maxAge}`,
  ].join("; "));
}

/* ------------------------------------------------------------------
   Contrôle d'origine + en-tête personnalisé : deuxième barrière CSRF,
   au cas où SameSite serait contourné par un navigateur ancien.
------------------------------------------------------------------ */
export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const expected = [req.headers["x-forwarded-host"], req.headers.host].filter(Boolean);
  return expected.includes(host);
}

export function csrfOk(req) {
  return originAllowed(req) && req.headers["x-requested-with"] === "cafedet-admin";
}

/* ------------------------------------------------------------------
   Limitation de débit. L'IP n'est jamais stockée en clair : on
   n'enregistre qu'une empreinte tronquée, salée avec le secret.
------------------------------------------------------------------ */
export function clientFingerprint(req) {
  const fwd = req.headers["x-forwarded-for"] || "";
  const ip = String(fwd).split(",")[0].trim() || "inconnue";
  return createHash("sha256")
    .update(`${sessionSecret()}:${ip}`)
    .digest("base64url")
    .slice(0, 22);
}

export async function rateLimit(key, limit, windowSec) {
  const n = Number(await kv("INCR", key));
  if (n === 1) await kv("EXPIRE", key, String(windowSec));
  if (n > limit) {
    const ttl = Number(await kv("TTL", key));
    return { allowed: false, retryAfter: ttl > 0 ? ttl : windowSec };
  }
  return { allowed: true, retryAfter: 0 };
}

/* ------------------------------------------------------------------
   En-têtes communs aux réponses d'API.
------------------------------------------------------------------ */
export function noStore(res) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Content-Type-Options", "nosniff");
}
