/**
 * MariaManager — Route API Next.js
 * POST /api/zelty/proxy
 * ══════════════════════════════════════════════════════════════
 *
 * Rôle : proxy serveur entre MariaManager et l'API Zelty.
 *   • Le navigateur n'appelle JAMAIS api.zelty.fr directement.
 *   • La clé API enseigne est lue depuis process.env.ZELTY_API_KEY (serveur).
 *   • Multi-établissements : dispatch via restaurant_id Zelty.
 *   • Pas de CORS côté Zelty : appel serveur → serveur.
 *
 * Base URL Zelty : https://api.zelty.fr/2.10
 *
 * Actions disponibles (body JSON) :
 *   { "action": "test", "restaurant": "dax" | "mdm" }
 *       → GET /restaurants — valide la clé API
 *
 *   { "action": "restaurants" }
 *       → GET /restaurants — retourne la liste des établissements
 *
 *   { "action": "sync", "restaurant": "dax" | "mdm",
 *     "date_start": "YYYY-MM-DD", "date_end": "YYYY-MM-DD" }
 *       → GET /orders?restaurant_id=[ID_ZELTY]
 *          Filtre status=closed, convertit centimes→euros, TTC→HT, UTC→Paris
 *
 * Variables d'environnement requises :
 *   ZELTY_API_KEY        — clé API enseigne (Bearer token)
 *   ZELTY_RESTAURANT_DAX — ID Zelty du restaurant de Dax
 *   ZELTY_RESTAURANT_MDM — ID Zelty du restaurant de Mont-de-Marsan
 *   Fichier .env.local (dev) ou secrets Vercel (prod)
 *
 * ══════════════════════════════════════════════════════════════
 */

// ──────────────────────────────────────────────────────────────
// CONSTANTES
// ──────────────────────────────────────────────────────────────

const ZELTY_BASE  = 'https://api.zelty.fr/2.10';
const PAGE_SIZE   = 100;
const MAX_PAGES   = 50; // sécurité anti-boucle infinie (= 5 000 commandes max)

// ──────────────────────────────────────────────────────────────
// MAPPING code restaurant → ID Zelty (lu depuis env)
// ──────────────────────────────────────────────────────────────
const RESTAURANT_MAP = {
  dax: process.env.ZELTY_RESTAURANT_DAX || '',
  mdm: process.env.ZELTY_RESTAURANT_MDM || '',
};

/**
 * Résout le code restaurant (dax/mdm) en ID Zelty.
 * @param {string} code  "dax" ou "mdm"
 * @returns {string}     ID Zelty ou chaîne vide
 */
function getRestaurantId(code) {
  if (!code) return '';
  const normalized = String(code).toLowerCase();
  return RESTAURANT_MAP[normalized] || '';
}

// ──────────────────────────────────────────────────────────────
// HELPERS — conversions montants et dates
// ──────────────────────────────────────────────────────────────

/**
 * Conversion centimes TTC → euros HT.
 * Zelty renvoie TOUJOURS les montants en centimes.
 *   1100 centimes = 11,00 € TTC
 *
 * @param {number} cents    montant en centimes (entier)
 * @param {number} taxRate  taux TVA (10, 5, 55, 550, 20, 200, 2000)
 * @returns {number} montant HT en euros, arrondi au centime
 */
function centsToHt(cents, taxRate) {
  const ttc = cents / 100;
  let divisor = 1.10; // 10 % par défaut (sur place)
  if (taxRate === 5 || taxRate === 55 || taxRate === 550)   divisor = 1.055; // 5,5 % (à emporter)
  if (taxRate === 20 || taxRate === 200 || taxRate === 2000) divisor = 1.20;  // 20 % (alcool…)
  return Math.round((ttc / divisor) * 100) / 100;
}

/**
 * Conversion date UTC → chaîne "YYYY-MM-DD HH:MM:SS" en heure Paris.
 * Exemple : "2025-03-15T23:30:00Z" → "2025-03-16 00:30:00"
 *
 * @param {string} isoString date ISO UTC
 * @returns {string}
 */
function utcToParis(isoString) {
  try {
    const d = new Date(isoString);
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const p = {};
    parts.forEach(({ type, value }) => { p[type] = value; });
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  } catch {
    return new Date(isoString).toISOString();
  }
}

/** Extrait la date YYYY-MM-DD en heure Paris pour regrouper par jour. */
function utcToParisDate(isoString) {
  return utcToParis(isoString).slice(0, 10);
}

// ──────────────────────────────────────────────────────────────
// RÉCUPÉRATION PAGINÉE DES COMMANDES ZELTY
// ──────────────────────────────────────────────────────────────

/**
 * Récupère TOUTES les commandes Zelty sur une période donnée,
 * en gérant automatiquement la pagination (offsets de PAGE_SIZE).
 *
 * @param {string} apiKey
 * @param {string} dateStart  YYYY-MM-DD
 * @param {string} dateEnd    YYYY-MM-DD
 * @param {string} [restaurantId]
 * @returns {{ orders: object[], pagesLoaded: number, error?: string }}
 */
async function fetchAllOrders(apiKey, dateStart, dateEnd, restaurantId) {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };

  const allOrders = [];
  let offset      = 0;
  let pagesLoaded = 0;

 while (pagesLoaded < MAX_PAGES) {
    const params = new URLSearchParams({
      date_start: dateStart,
      date_end:   dateEnd,
      limit:      String(PAGE_SIZE),
      offset:     String(offset),
    });
    if (restaurantId) params.set('restaurant_id', restaurantId);

    const url = `${ZELTY_BASE}/orders?${params.toString()}`;
    console.log('Zelty URL:', url);

    let res;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch (err) {
      return {
        orders: allOrders,
        pagesLoaded,
        error: `Erreur réseau page ${pagesLoaded + 1} : ${err.message}`,
      };
    }

    if (!res.ok) {
      return {
        orders: allOrders,
        pagesLoaded,
        const errorText = await res.text();
console.log('Zelty error response:', errorText);
error: `Zelty HTTP ${res.status} à l'offset ${offset}: ${errorText}`,
      };
    }

    const raw  = await res.json();
    const page = Array.isArray(raw)
      ? raw
      : (Array.isArray(raw.orders) ? raw.orders
        : Array.isArray(raw.data)   ? raw.data
        : []);

    allOrders.push(...page);
    pagesLoaded++;

    // Dernière page : moins de PAGE_SIZE résultats → on s'arrête
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { orders: allOrders, pagesLoaded };
}

// ──────────────────────────────────────────────────────────────
// MAPPING commande Zelty → objet vente MariaManager
// ──────────────────────────────────────────────────────────────

/**
 * Transforme une commande Zelty en ventes individuelles (une par article).
 *
 * Logique montants :
 *   1. Si la commande a total_ht (centimes) → on l'utilise pour le CA HT global.
 *   2. Sinon : total (centimes TTC) / 1.10 (taux dominant sur place).
 *   3. Pour chaque article : price (centimes TTC) → HT via tax_rate.
 *
 * @param {object} order  commande brute Zelty
 * @returns {{ sales: object[], ca_ht: number, ca_ttc: number }}
 */
function mapOrderToSales(order) {
  const createdAt  = order.created_at ?? order.date ?? new Date().toISOString();
  const dateMs     = new Date(createdAt).getTime();
  const dateParis  = utcToParis(createdAt);
  const dateParisD = utcToParisDate(createdAt);

  // ── Montant global de la commande ──────────────────────────
  const totalCentsTTC = order.total    ?? 0;
  const totalCentsHT  = order.total_ht ?? 0;
  const ca_ttc        = Math.round(totalCentsTTC) / 100;
  const ca_ht         = totalCentsHT > 0
    ? Math.round(totalCentsHT) / 100
    : Math.round((totalCentsTTC / 1.10) * 100) / 100;

  // ── Articles de la commande ────────────────────────────────
  const rawItems = Array.isArray(order.items)    ? order.items
    : Array.isArray(order.products) ? order.products
    : Array.isArray(order.lines)    ? order.lines
    : [];

  const sales = [];

  for (const item of rawItems) {
    const taxRate  = item.tax_rate ?? 10;
    const priceTTC = item.price ?? item.unit_price ?? 0; // centimes
    const priceHT  = centsToHt(priceTTC, taxRate);
    const qty      = item.quantity ?? 1;
    const totalHT  = Math.round(priceHT * qty * 100) / 100;
    const itemName = item.name ?? item.product_name ?? 'Produit Zelty';
    const itemId   = item.id   ?? item.product_id   ?? '';

    sales.push({
      zelty_order_id:   String(order.id ?? order.ref ?? ''),
      zelty_session_id: `${order.id ?? order.ref}_${itemId || Math.random().toString(36).slice(2, 8)}`,
      recipe_id:        String(item.product_id ?? item.recipe_id ?? ''),
      recipe_name:      itemName,
      quantity:         qty,
      unit_price:       priceHT,    // HT en euros
      total_amount:     totalHT,    // HT en euros
      source:           'zelty',
      date:             dateMs,
      date_paris:       dateParis,  // "2025-03-16 00:30:00"
      date_day:         dateParisD, // "2025-03-16"
      notes:            `Zelty #${order.id ?? order.ref}`,
    });
  }

  // Cas : commande sans items → on crée une ligne CA globale de fallback
  if (sales.length === 0 && ca_ht > 0) {
    sales.push({
      zelty_order_id:   String(order.id ?? order.ref ?? ''),
      zelty_session_id: String(order.id ?? order.ref ?? `zelty_${Date.now()}`),
      recipe_id:        '',
      recipe_name:      'Commande Zelty (sans détail articles)',
      quantity:         1,
      unit_price:       ca_ht,
      total_amount:     ca_ht,
      source:           'zelty',
      date:             dateMs,
      date_paris:       dateParis,
      date_day:         dateParisD,
      notes:            `Zelty #${order.id ?? order.ref}`,
    });
  }

  return { sales, ca_ht, ca_ttc };
}

// ══════════════════════════════════════════════════════════════
// HANDLER NEXT.JS
// ══════════════════════════════════════════════════════════════

/**
 * Route API Next.js — POST /api/zelty/proxy
 *
 * Body JSON attendu :
 *   { action: "test" | "restaurants" | "sync",
 *     date_start?: "YYYY-MM-DD",   (sync uniquement)
 *     date_end?:   "YYYY-MM-DD",   (sync uniquement)
 *     restaurant_id?: string       (sync optionnel)
 *   }
 */
module.exports = async function handler(req, res) {

  // ── Méthodes autorisées ────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  // ── Clé API depuis les variables d'environnement ──────────
  // La clé n'est JAMAIS exposée côté client.
  const ZELTY_API_KEY = process.env.ZELTY_API_KEY ?? '';
  if (!ZELTY_API_KEY) {
    return res.status(500).json({
      success: false,
      error:   'Clé API Zelty non configurée. Ajoutez ZELTY_API_KEY dans .env.local (dev) ou les secrets Genspark (prod).',
    });
  }

  // ── Body ────────────────────────────────────────────────────
  const { action, date_start, date_end, restaurant } = req.body ?? {};
  if (!action) {
    return res.status(400).json({
      error: "Paramètre 'action' manquant. Valeurs acceptées : test | restaurants | sync.",
    });
  }

  // ── Résolution du restaurant_id Zelty ──────────────────────
  // Le frontend envoie "dax" ou "mdm", on le traduit en ID Zelty
  const restaurant_id = getRestaurantId(restaurant);

  const zeltyHeaders = {
    'Authorization': `Bearer ${ZELTY_API_KEY}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };

  // ════════════════════════════════════════════════════════════
  // ACTION : test / restaurants
  // GET /restaurants → valide la clé API et retourne les sites
  // ════════════════════════════════════════════════════════════
  if (action === 'test' || action === 'restaurants') {
    try {
      const zeltyRes = await fetch(`${ZELTY_BASE}/restaurants`, {
        method:  'GET',
        headers: zeltyHeaders,
      });

      if (zeltyRes.ok) {
        const data = await zeltyRes.json();
        const list = Array.isArray(data)
          ? data
          : (data.restaurants ?? data.data ?? (data.id ? [data] : []));

        if (action === 'restaurants') {
          return res.status(200).json({
            success:     true,
            restaurants: list.map(r => ({ id: r.id, name: r.name ?? r.nom ?? `Restaurant ${r.id}` })),
          });
        }

        // action === "test" : confirmer la clé + retourner l'établissement demandé
        if (restaurant_id) {
          const found = list.find(r => String(r.id) === String(restaurant_id));
          if (found) {
            return res.status(200).json({
              success:    true,
              restaurant: {
                id:   found.id,
                name: found.name ?? found.nom ?? `Restaurant ${found.id}`,
              },
            });
          }
          return res.status(200).json({
            success: false,
            error:   `Restaurant ID ${restaurant_id} introuvable dans Zelty. Vérifiez ZELTY_RESTAURANT_DAX/MDM.`,
          });
        }

        // Pas de restaurant spécifié → retourner le premier
        const first = list[0] ?? {};
        return res.status(200).json({
          success:    true,
          restaurant: {
            id:   first.id   ?? null,
            name: first.name ?? first.nom ?? 'Zelty',
          },
        });
      }

      if (zeltyRes.status === 401 || zeltyRes.status === 403) {
        return res.status(200).json({
          success: false,
          error:   'Clé API invalide ❌ — vérifiez votre clé dans les secrets du serveur.',
        });
      }

      return res.status(200).json({
        success: false,
        error:   `Erreur Zelty HTTP ${zeltyRes.status}.`,
      });

    } catch (err) {
      return res.status(502).json({
        success: false,
        error:   `Impossible de contacter Zelty : ${err.message}`,
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // ACTION : sync
  // Récupère toutes les commandes sur une période avec pagination.
  // ════════════════════════════════════════════════════════════
  if (action === 'sync') {

    // ── Vérifier que le restaurant est configuré ─────────────
    if (!restaurant) {
      return res.status(400).json({
        error: 'Paramètre "restaurant" requis. Valeurs : "dax" ou "mdm".',
      });
    }
    if (!restaurant_id) {
      return res.status(500).json({
        success: false,
        error:   `Restaurant "${restaurant}" non configuré. Ajoutez ZELTY_RESTAURANT_${restaurant.toUpperCase()} dans les secrets.`,
      });
    }

    // ── Valider les dates ─────────────────────────────────────
    if (!date_start || !date_end) {
      return res.status(400).json({
        error: 'Paramètres date_start et date_end requis (format YYYY-MM-DD).',
      });
    }
    const reDate = /^\d{4}-\d{2}-\d{2}$/;
    if (!reDate.test(date_start) || !reDate.test(date_end)) {
      return res.status(400).json({ error: 'Format de date invalide. Utilisez YYYY-MM-DD.' });
    }
    if (date_start > date_end) {
      return res.status(400).json({ error: 'date_start doit être antérieure ou égale à date_end.' });
    }

    // ── Récupérer toutes les pages ───────────────────────────
    const { orders, pagesLoaded, error: fetchError } = await fetchAllOrders(
      ZELTY_API_KEY,
      date_start,
      date_end,
      restaurant_id,
    );

    if (fetchError && orders.length === 0) {
      return res.status(502).json({ success: false, error: fetchError, sales: [], ca_ht: 0, ca_ttc: 0 });
    }

    // ── Filtre défensif status=closed ────────────────────────
    const closedOrders = orders.filter(
      o => (o.status ?? '').toLowerCase() === VALID_STATUS,
    );
    const nbIgnored = orders.length - closedOrders.length;

    // ── Mapper les commandes en ventes ───────────────────────
    const allSales = [];
    let totalCaHt  = 0;
    let totalCaTtc = 0;

    for (const order of closedOrders) {
      const { sales, ca_ht, ca_ttc } = mapOrderToSales(order);
      allSales.push(...sales);
      totalCaHt  += ca_ht;
      totalCaTtc += ca_ttc;
    }

    totalCaHt  = Math.round(totalCaHt  * 100) / 100;
    totalCaTtc = Math.round(totalCaTtc * 100) / 100;

    return res.status(200).json({
      success:       true,
      sales:         allSales,
      ca_ht:         totalCaHt,         // CA HT en euros — valeur à stocker
      ca_ttc:        totalCaTtc,        // CA TTC en euros — pour info
      nb_orders:     closedOrders.length,
      nb_pages:      pagesLoaded,
      nb_ignored:    nbIgnored,
      partial:       !!fetchError,
      partial_error: fetchError ?? null,
      session_id:    `zelty_${Date.now()}`,
    });
  }

  // Action inconnue
  return res.status(400).json({
    error: `Action inconnue : "${action}". Valeurs : test | restaurants | sync.`,
  });
}
