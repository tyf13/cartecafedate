# Carte des boissons — CAFEDET

Page publique scannable par QR-Code + espace de gestion authentifié côté serveur.
Hébergement Vercel, stockage Redis, aucune dépendance npm en production.

```
public/        carte publique et interface admin (aucun secret)
  vendor/      bibliothèque QR servie depuis le site, pas depuis un CDN
api/           fonctions serverless : login, logout, menu
  _lib/        auth (scrypt, sessions, limitation de débit), validation, accès Redis
scripts/       génération des secrets, à exécuter en local
vercel.json    en-têtes de sécurité et CSP
```

---

## Déploiement

### 1. Brancher un Redis

Sur Vercel : **Storage → Create Database → Upstash for Redis**, puis relie-le au projet.
Vercel injecte automatiquement `KV_REST_API_URL` et `KV_REST_API_TOKEN`.

> Vérifie que les deux variables apparaissent dans Settings → Environment Variables avant de continuer.

### 2. Générer les secrets

En local, à la racine du dépôt :

```bash
npm run secrets
```

Le script demande un mot de passe (12 caractères minimum, jamais écrit sur le disque)
et affiche deux valeurs à copier.

### 3. Déposer les secrets sur Vercel

**Settings → Environment Variables**, pour *Production* et *Preview* :

| Variable | Valeur |
|---|---|
| `ADMIN_PASSWORD_HASH` | l'empreinte `scrypt$...` affichée par le script |
| `SESSION_SECRET` | la chaîne aléatoire affichée par le script |

> Ne les mets jamais dans le dépôt. `.env` est déjà ignoré par git.

### 4. Déployer

Framework Preset **Other**, pas de build command, output directory vide.
Push sur `main` → déploiement automatique.

### 5. Vérifier

- `https://ton-projet.vercel.app` → la carte s'affiche
- `https://ton-projet.vercel.app/#admin` → écran de connexion
- Connecte-toi, colle l'URL publique dans le champ QR, régénère, imprime

---

## Ce qui protège quoi

| Mesure | Menace couverte |
|---|---|
| Mot de passe en empreinte scrypt dans une variable d'environnement | lecture du dépôt, historique git, inspecteur du navigateur |
| Comparaison en temps constant (`timingSafeEqual`) | attaque temporelle sur la vérification |
| Session = identifiant aléatoire signé HMAC-SHA256, stocké en Redis | jeton forgé, jeton rejoué après déconnexion |
| Cookie `HttpOnly` `Secure` `SameSite=Strict` | vol de session par XSS, envoi en clair, CSRF |
| Contrôle de l'en-tête `Origin` + en-tête `X-Requested-With` | CSRF si `SameSite` est contourné |
| 5 tentatives / 15 min par appareil, 40 / 15 min au global | attaque par force brute, rotation d'adresses IP |
| Revalidation serveur de toute la carte, champs reconstruits un par un | injection de contenu, champs parasites, charge utile surdimensionnée |
| Logo limité à PNG/JPEG/WebP, SVG refusé en image embarquée | script transporté dans un SVG |
| CSP `default-src 'none'`, aucun script ni style en ligne | XSS |
| HSTS, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer` | rétrogradation HTTP, confusion de type MIME, clickjacking, fuite d'URL |
| Bibliothèque QR vendorisée | compromission d'un CDN tiers |

### Limites assumées

- **Un seul compte, un seul mot de passe.** Pas de comptes nommés, donc pas de
  traçabilité de qui a modifié quoi. Suffisant pour une petite équipe de bureau,
  insuffisant si un jour vous êtes dix à avoir l'accès.
- **Pas de journal d'audit.** On sait ce qu'est la carte, pas qui l'a changée ni quand.
- **Pas de second facteur.** L'ajout serait le prochain palier si le besoin monte.
- **La carte publique est en cache CDN 10 secondes.** Une modification met jusqu'à
  10 secondes à apparaître pour les scans. C'est un compromis volontaire pour tenir
  la charge d'une soirée sans solliciter Redis à chaque scan.

### Changer de mot de passe

Relance `npm run secrets`, remplace `ADMIN_PASSWORD_HASH`, redéploie.
Pour invalider immédiatement toutes les sessions ouvertes, change aussi `SESSION_SECRET`.

### Développement local

```bash
cp .env.example .env    # colle-y tes valeurs
npx vercel dev
```

En local le cookie porte l'attribut `Secure` : utilise l'URL `https` fournie par
`vercel dev`, ou teste directement sur un déploiement Preview.

---

Bibliothèque QR : [node-qrcode](https://github.com/soldair/node-qrcode), licence MIT
(voir `public/vendor/qrcode.LICENSE.txt`).
