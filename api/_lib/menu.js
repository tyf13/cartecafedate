// Source de vérité de la carte + validation du contenu.
// Tout ce qui arrive du navigateur est reconstruit champ par champ :
// aucune propriété inconnue n'est enregistrée.

export const DEFAULT_MENU = {
  logo: "",
  categories: [
    {
      id: "softs",
      name: "Softs",
      items: [
        { id: "softs-1", name: "Soda 33cl", price: "2", desc: "Coca, zéro, cherry, ice tea, oasis pomme cassis framboise, tropical, orangina, sprite, schweppes" },
        { id: "softs-2", name: "Red Bull", price: "2,5", desc: "" },
        { id: "softs-3", name: "Sirop", price: "1", desc: "Grenadine, pêche, menthe, cerise, orgeat, fraise, citron, rose, vanille, noisette" },
      ],
    },
    {
      id: "bieres-et-vins",
      name: "Bières et vins",
      items: [
        { id: "bieres-1", name: "Bud", price: "2,5", desc: "" },
        { id: "bieres-2", name: "Leffe - Leffe Ruby", price: "3", desc: "" },
        { id: "bieres-3", name: "Desperados", price: "3,5", desc: "" },
        { id: "bieres-4", name: "La Bête", price: "4,5", desc: "" },
        { id: "bieres-5", name: "Verre de vin 12cl", price: "2,5", desc: "Blanc, rosé, rouge" },
        { id: "bieres-6", name: "Prosecco 12cl", price: "4", desc: "" },
      ],
    },
    {
      id: "bonbons",
      name: "Bonbons",
      items: [
        { id: "bonbons-1", name: "", price: "0,50", desc: "Sucette cœur, sucette piquante, boules magiques" },
      ],
    },
    {
      id: "cocktails",
      name: "Cocktails",
      items: [
        { id: "cocktails-1", name: "Athéna", price: "6", desc: "Berry Mojito, limonade, sirop de vanille" },
        { id: "cocktails-2", name: "Dionysos", price: "6", desc: "Vin blanc, crème de cassis, sirop de pêche" },
        { id: "cocktails-3", name: "Perséphone", price: "6", desc: "Soho, manzana, limonade, sirop de cerise" },
        { id: "cocktails-4", name: "Hadès", price: "6", desc: "Jet 27, vodka black, limonade" },
        { id: "cocktails-5", name: "BBQ Chicken", price: "6", desc: "Malibu, multifruit, sirop de fruit rouge" },
        { id: "cocktails-6", name: "Fedet", price: "6", desc: "Manzana, pulco, limonade, curaçao" },
      ],
    },
    {
      id: "sans-alcool",
      name: "Sans alcool",
      items: [
        { id: "sans-alcool-1", name: "PF", price: "4", desc: "Multifruit, limonade, grenadine, sirop de citron" },
      ],
    },
    {
      id: "shooters",
      name: "Shooters",
      items: [
        { id: "shooters-1", name: "Fedet'Shoot", price: "2", desc: "Shooter au choix" },
      ],
    },
  ],
};

export const MAX_PAYLOAD_BYTES = 400_000;

const LIMITS = {
  categories: 40,
  itemsPerCategory: 80,
  categoryName: 60,
  itemName: 80,
  desc: 400,
  price: 12,
  logoUrl: 400,
  logoData: 300_000,
};

const PRICE_RE = /^(\d{1,4}([.,]\d{1,2})?)?$/;
const CONTROL_RE = /[\u0000-\u001F\u007F]/g;

function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_RE, "").trim().slice(0, max);
}

function slug(text, fallback) {
  const s = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return s || fallback;
}

function cleanLogo(value) {
  if (typeof value !== "string" || !value) return "";
  const v = value.trim();

  // Image embarquée : uniquement des formats matriciels, jamais de SVG
  // (un SVG peut porter du script, même si <img> le neutralise en principe).
  if (v.startsWith("data:")) {
    const ok = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
    return ok && v.length <= LIMITS.logoData ? v : "";
  }
  if (v.length > LIMITS.logoUrl) return "";
  // Adresse absolue en HTTPS, ou chemin relatif du site.
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v;
  if (/^\/?[\w.\-/]+\.(png|jpe?g|webp|svg)$/i.test(v)) return v;
  return "";
}

export function validateMenu(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Format attendu : un objet avec une liste « categories »." };
  }
  if (!Array.isArray(input.categories)) {
    return { ok: false, error: "La propriété « categories » doit être une liste." };
  }
  if (input.categories.length > LIMITS.categories) {
    return { ok: false, error: `Maximum ${LIMITS.categories} catégories.` };
  }

  const categories = [];
  const usedIds = new Set();

  for (const [ci, rawCat] of input.categories.entries()) {
    if (!rawCat || typeof rawCat !== "object") {
      return { ok: false, error: `Catégorie ${ci + 1} : format invalide.` };
    }
    const name = clean(rawCat.name, LIMITS.categoryName);
    if (!name) return { ok: false, error: `Catégorie ${ci + 1} : le nom est obligatoire.` };
    if (!Array.isArray(rawCat.items)) {
      return { ok: false, error: `Catégorie « ${name} » : « items » doit être une liste.` };
    }
    if (rawCat.items.length > LIMITS.itemsPerCategory) {
      return { ok: false, error: `Catégorie « ${name} » : maximum ${LIMITS.itemsPerCategory} articles.` };
    }

    // Les identifiants sont régénérés côté serveur : le client ne
    // choisit pas ses clés.
    let base = slug(name, `categorie-${ci + 1}`);
    let id = base;
    let n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);

    const items = [];
    for (const [ii, rawItem] of rawCat.items.entries()) {
      if (!rawItem || typeof rawItem !== "object") {
        return { ok: false, error: `Catégorie « ${name} », article ${ii + 1} : format invalide.` };
      }
      const price = clean(rawItem.price, LIMITS.price).replace(/€/g, "").trim();
      if (!PRICE_RE.test(price)) {
        return {
          ok: false,
          error: `Catégorie « ${name} », article ${ii + 1} : prix « ${price} » invalide (ex. 2 ou 2,50).`,
        };
      }
      items.push({
        id: `${id}-${ii + 1}`,
        name: clean(rawItem.name, LIMITS.itemName),
        price,
        desc: clean(rawItem.desc, LIMITS.desc),
      });
    }

    categories.push({ id, name, items });
  }

  return { ok: true, value: { logo: cleanLogo(input.logo), categories } };
}
