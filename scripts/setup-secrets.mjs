#!/usr/bin/env node
/**
 * Génère les deux secrets à déposer dans Vercel.
 * À exécuter en local : node scripts/setup-secrets.mjs
 *
 * Le mot de passe en clair n'est jamais écrit sur le disque ni transmis.
 * Seule son empreinte scrypt sort d'ici.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

const N = 16384; // coût mémoire/CPU : ~16 Mo, ~100 ms par tentative
const R = 8;
const P = 1;
const KEYLEN = 32;

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const onData = (char) => {
      if (["\n", "\r", "\u0004"].includes(String(char))) {
        stdin.removeListener("data", onData);
      } else {
        stdout.clearLine(0);
        stdout.cursorTo(0);
        stdout.write(`${question}${"*".repeat(rl.line.length)}`);
      }
    };
    stdin.on("data", onData);
    rl.question(question, (answer) => {
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
  });
}

const password = await askHidden("Mot de passe admin : ");
const confirm = await askHidden("Confirme le mot de passe : ");

if (password !== confirm) {
  console.error("\nLes deux saisies ne correspondent pas. Rien n'a été généré.");
  process.exit(1);
}
if (password.length < 12) {
  console.error("\n12 caractères minimum. Rien n'a été généré.");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(Buffer.from(password, "utf8"), salt, KEYLEN, {
  N, r: R, p: P, maxmem: 128 * 1024 * 1024,
});

const adminHash = ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
const sessionSecret = randomBytes(48).toString("base64url");

console.log(`
Ajoute ces deux variables dans Vercel
(Project → Settings → Environment Variables, pour Production et Preview) :

ADMIN_PASSWORD_HASH
${adminHash}

SESSION_SECRET
${sessionSecret}

Ne les commit jamais. Pour changer de mot de passe : relance ce script,
remplace ADMIN_PASSWORD_HASH, puis redéploie.
`);
