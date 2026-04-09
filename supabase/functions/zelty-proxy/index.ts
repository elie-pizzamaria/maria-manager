/**
 * MariaManager — Zelty Proxy
 * Edge Function Supabase (Deno / TypeScript)
 * ══════════════════════════════════════════════════════════════
 *
 * Rôle : proxy serveur entre MariaManager et l'API Zelty.
 *   • Le navigateur n'appelle JAMAIS api.zelty.fr directement.
 *   • La clé API est lue depuis Supabase Vault (jamais exposée).
 *   • Pas de CORS côté Zelty : appel serveur → serveur.
 *
 * Base URL Zelty : https://api.zelty.fr/2.10
 *
 * Actions disponibles (body JSON) :
 *   { "action": "test" }
 *       → GET /restaurants — valide la clé API
 *
 *   { "action": "restaurants" }
 *       → GET /restaurants — retourne la liste des établissements
 *
 *   { "action": "sync", "date_start": "YYYY-MM-DD", "date_end": "YYYY-MM-DD",
 *     "restaurant_id": "..." (optionnel) }
 *       → GET /orders avec pagination complète
 *          Filtre status=closed, convertit centimes→euros, TTC→HT, UTC→Paris
 *
 * Variable d'environnement requise (Supabase Vault) :
 *   ZELTY_API_KEY  — votre clé API Zelty (Bearer token)
 *
 * ══════════════════════════════════════════════════════════════
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ──────────────────────────────────────────────────────────────
// CONSTANTES
// ──────────────────────────────────────────────────────────────

/** Base URL exacte de l'API Zelty v2.10 */
const ZELTY_BASE = "https://api.zelty.fr/2.10";

/** Nombre de commandes par page (max Zelty) */
const PAGE_SIZE = 100;

/** Seul statut accepté : commandes fermées et payées */
const VALID_STATUS = "closed";

// ──────────────────────────────────────────────────────────────
// CORS — le navigateur appelle notre proxy, pas Zelty
// ──────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // Restreindre à votre domaine en production
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

// ──────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────

/** Réponse JSON uniforme */
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

/**
 * Conversion centimes TTC → euros HT.
 *
 * Zelty renvoie TOUJOURS les montants en centimes.
 *   1100 centimes = 11,00 € TTC
 *
 * Si total_ht est présent dans la commande, on l'utilise directement.
 * Sinon on divise par le taux TVA dominant :
 *   10 %  (sur place, taux le plus courant en restauration)
 *   5,5 % (à emporter)
 *   20 %  (boissons alcoolisées, etc.)
 *
 * @param cents   montant en centimes (entier)
 * @param taxRate taux TVA en entier : 10 | 5 (5.5) | 20
 */
function centsToHt(cents: number, taxRate: number): number {
  const ttc = cents / 100;
  let divisor = 1.10; // 10 % par défaut
  if (taxRate === 5 || taxRate === 55 || taxRate === 550) divisor = 1.055;
  if (taxRate === 20 || taxRate === 200 || taxRate === 2000) divisor = 1.20;
  return Math.round((ttc / divisor) * 100) / 100; // arrondi au centime
}

/**
 * Conversion date UTC → chaîne YYYY-MM-DD HH:MM:SS en heure Paris.
 * Utilisé pour stocker la date en heure locale française.
 *
 * Exemple : "2025-03-15T23:30:00Z" → "2025-03-16 00:30:00"
 */
function utcToParis(isoString: string): string {
  try {
    const d = new Date(isoString);
    const parts = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const p: Record<string, string> = {};
    parts.forEach(({ type, value }) => { p[type] = value; });
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  } catch {
    return new Date(isoString).toISOString();
  }
}

/**
 * Extrait la date YYYY-MM-DD en heure Paris (pour regrouper par jour).
 * "2025-03-15T23:30:00Z" → "2025-03-16"
 */
function utcToParisDate(isoString: string): string {
  return utcToParis(isoString).slice(0, 10);
}

// ──────────────────────────────────────────────────────────────
// APPEL ZELTY PAGINÉ — cœur de la fonction sync
// ──────────────────────────────────────────────────────────────

/**
 * Récupère TOUTES les commandes Zelty sur une période donnée,
 * en gérant automatiquement la pagination par offsets de PAGE_SIZE.
 *
 * Paramètres Zelty utilisés :
 *   date_start, date_end, status=closed, limit=100, offset=N
 *   + restaurant_id si multi-site
 *
 * Continue tant que la page retournée contient PAGE_SIZE résultats.
 */
async function fetchAllOrders(
  apiKey: string,
  dateStart: string,
  dateEnd: string,
  restaurantId?: string,
): Promise<{ orders: Record<string, unknown>[]; pagesLoaded: number; error?: string }> {

  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  const allOrders: Record<string, unknown>[] = [];
  let offset = 0;
  let pagesLoaded = 0;
  const MAX_PAGES = 50; // sécurité anti-boucle infinie (= 5 000 commandes max)

  while (pagesLoaded < MAX_PAGES) {
    // Construction de l'URL avec les paramètres exacts documentés
    const params = new URLSearchParams({
      date_start: dateStart,
      date_end:   dateEnd,
      status:     VALID_STATUS,
      limit:      String(PAGE_SIZE),
      offset:     String(offset),
    });
    if (restaurantId) params.set("restaurant_id", restaurantId);

    const url = `${ZELTY_BASE}/orders?${params.toString()}`;

    let res: Response;
    try {
      res = await fetch(url, { method: "GET", headers });
    } catch (err) {
      return {
        orders: allOrders,
        pagesLoaded,
        error: `Erreur réseau page ${pagesLoaded + 1} : ${(err as Error).message}`,
      };
    }

    if (!res.ok) {
      return {
        orders: allOrders,
        pagesLoaded,
        error: `Zelty HTTP ${res.status} à l'offset ${offset}.`,
      };
    }

    // Zelty peut retourner un tableau directement, ou { orders: [...] }
    const raw = await res.json();
    const page: Record<string, unknown>[] = Array.isArray(raw)
      ? raw
      : (Array.isArray(raw.orders) ? raw.orders : Array.isArray(raw.data) ? raw.data : []);

    allOrders.push(...page);
    pagesLoaded++;

    // Dernière page : moins de PAGE_SIZE résultats
    if (page.length < PAGE_SIZE) break;

    offset += PAGE_SIZE;
  }

  return { orders: allOrders, pagesLoaded };
}

// ──────────────────────────────────────────────────────────────
// MAPPER une commande Zelty → objet sale MariaManager
// ──────────────────────────────────────────────────────────────

/**
 * Transforme une commande Zelty en ventes individuelles (une par article).
 *
 * Logique montants :
 *   1. Si la commande a total_ht → on l'utilise pour le CA HT global
 *   2. Sinon on calcule : total (centimes TTC) / 1.10
 *   3. Pour chaque article : price (centimes TTC) → HT via tax_rate
 */
function mapOrderToSales(order: Record<string, unknown>): {
  sales: unknown[];
  ca_ht: number;
  ca_ttc: number;
} {
  const createdAt  = (order.created_at ?? order.date ?? new Date().toISOString()) as string;
  const dateMs     = new Date(createdAt).getTime();
  const dateParis  = utcToParis(createdAt);
  const dateParisD = utcToParisDate(createdAt); // YYYY-MM-DD Paris

  // ── Montant global de la commande ──────────────────────────
  const totalCentsTTC = (order.total ?? 0) as number;
  const totalCentsHT  = (order.total_ht ?? 0) as number;

  const ca_ttc = Math.round(totalCentsTTC) / 100;

  // Si Zelty fournit total_ht, on l'utilise directement
  let ca_ht: number;
  if (totalCentsHT > 0) {
    ca_ht = Math.round(totalCentsHT) / 100;
  } else {
    // Fallback : TTC / 1.10 (taux dominant restauration sur place)
    ca_ht = Math.round((totalCentsTTC / 1.10) * 100) / 100;
  }

  // ── Articles de la commande ────────────────────────────────
  const rawItems: unknown[] = Array.isArray(order.items)
    ? order.items
    : Array.isArray(order.products)
      ? order.products
      : Array.isArray(order.lines)
        ? order.lines
        : [];

  const sales: unknown[] = [];

  for (const rawItem of rawItems) {
    const item     = rawItem as Record<string, unknown>;
    const taxRate  = (item.tax_rate ?? 10) as number; // 10 par défaut (sur place)
    const priceTTC = (item.price ?? item.unit_price ?? 0) as number; // centimes
    const priceHT  = centsToHt(priceTTC, taxRate);
    const qty      = (item.quantity ?? 1) as number;
    const totalHT  = Math.round(priceHT * qty * 100) / 100;
    const itemName = (item.name ?? item.product_name ?? "Produit Zelty") as string;
    const itemId   = (item.id ?? item.product_id ?? "") as string;

    sales.push({
      // Identifiant unique = id_commande_id_article (évite les doublons)
      zelty_order_id:   String(order.id ?? order.ref ?? ""),
      zelty_session_id: `${order.id ?? order.ref}_${itemId || Math.random().toString(36).slice(2, 8)}`,
      recipe_id:        String(item.product_id ?? item.recipe_id ?? ""),
      recipe_name:      itemName,
      quantity:         qty,
      unit_price:       priceHT,    // HT en euros
      total_amount:     totalHT,    // HT en euros
      source:           "zelty",
      date:             dateMs,
      date_paris:       dateParis,  // "2025-03-16 00:30:00"
      date_day:         dateParisD, // "2025-03-16" — pour regrouper par jour
      notes:            `Zelty #${order.id ?? order.ref}`,
    });
  }

  // Cas : commande sans items → on crée quand même une ligne CA
  if (sales.length === 0 && ca_ht > 0) {
    sales.push({
      zelty_order_id:   String(order.id ?? order.ref ?? ""),
      zelty_session_id: String(order.id ?? order.ref ?? `zelty_${Date.now()}`),
      recipe_id:        "",
      recipe_name:      "Commande Zelty (sans détail articles)",
      quantity:         1,
      unit_price:       ca_ht,
      total_amount:     ca_ht,
      source:           "zelty",
      date:             dateMs,
      date_paris:       dateParis,
      date_day:         dateParisD,
      notes:            `Zelty #${order.id ?? order.ref}`,
    });
  }

  return { sales, ca_ht, ca_ttc };
}

// ══════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ══════════════════════════════════════════════════════════════
serve(async (req: Request) => {

  // Pré-flight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Méthode non autorisée. Utilisez POST." }, 405);
  }

  // ── Body ────────────────────────────────────────────────────
  let body: {
    action?: string;
    date_start?: string;
    date_end?: string;
    restaurant_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body JSON invalide." }, 400);
  }

  const { action, date_start, date_end, restaurant_id } = body;
  if (!action) {
    return json({ error: "Paramètre 'action' manquant. Valeurs : test | restaurants | sync." }, 400);
  }

  // ── Clé API depuis Supabase Vault ──────────────────────────
  const ZELTY_API_KEY = Deno.env.get("ZELTY_API_KEY") ?? "";
  if (!ZELTY_API_KEY) {
    return json({
      success: false,
      error: "Clé API Zelty non configurée. Ajoutez ZELTY_API_KEY dans Supabase Vault (voir SETUP.md).",
    }, 500);
  }

  const zeltyHeaders = {
    "Authorization": `Bearer ${ZELTY_API_KEY}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  // ════════════════════════════════════════════════════════════
  // ACTION : test
  // GET /restaurants → valide la clé API
  // Retourne : { success, restaurant: { id, name } }
  // ════════════════════════════════════════════════════════════
  if (action === "test" || action === "restaurants") {
    try {
      const res = await fetch(`${ZELTY_BASE}/restaurants`, {
        method: "GET",
        headers: zeltyHeaders,
      });

      if (res.ok) {
        const data = await res.json();
        // Zelty retourne soit un tableau, soit un objet unique
        const list: Record<string, unknown>[] = Array.isArray(data)
          ? data
          : (data.restaurants ?? data.data ?? (data.id ? [data] : []));

        if (action === "restaurants") {
          // Retourner la liste complète pour le sélecteur multi-site
          return json({
            success: true,
            restaurants: list.map((r) => ({ id: r.id, name: r.name ?? r.nom ?? `Restaurant ${r.id}` })),
          });
        }

        // action === "test" : juste confirmer que la clé est valide
        const first = list[0] ?? {};
        return json({
          success: true,
          restaurant: {
            id:   first.id   ?? null,
            name: first.name ?? first.nom ?? "Zelty",
          },
        });
      }

      if (res.status === 401 || res.status === 403) {
        return json({ success: false, error: "Clé API invalide ❌ — vérifiez votre clé dans Supabase Vault." });
      }

      return json({ success: false, error: `Erreur Zelty HTTP ${res.status}.` });

    } catch (err) {
      return json({ success: false, error: `Impossible de contacter Zelty : ${(err as Error).message}` }, 502);
    }
  }

  // ════════════════════════════════════════════════════════════
  // ACTION : sync
  // Récupère toutes les commandes sur une période avec pagination.
  //
  // Body attendu :
  //   date_start      YYYY-MM-DD  (obligatoire)
  //   date_end        YYYY-MM-DD  (obligatoire)
  //   restaurant_id   string      (optionnel — multi-site)
  //
  // Retourne :
  //   { success, sales[], ca_ht, ca_ttc, nb_orders, nb_pages,
  //     nb_ignored, session_id }
  // ════════════════════════════════════════════════════════════
  if (action === "sync") {

    // ── Valider les dates ─────────────────────────────────────
    if (!date_start || !date_end) {
      return json({ error: "Paramètres date_start et date_end requis (format YYYY-MM-DD)." }, 400);
    }
    const reDate = /^\d{4}-\d{2}-\d{2}$/;
    if (!reDate.test(date_start) || !reDate.test(date_end)) {
      return json({ error: "Format de date invalide. Utilisez YYYY-MM-DD." }, 400);
    }
    if (date_start > date_end) {
      return json({ error: "date_start doit être antérieure ou égale à date_end." }, 400);
    }

    // ── Récupérer toutes les pages ───────────────────────────
    const { orders, pagesLoaded, error: fetchError } = await fetchAllOrders(
      ZELTY_API_KEY,
      date_start,
      date_end,
      restaurant_id,
    );

    // Une erreur en cours de pagination n'est pas fatale
    // si on a déjà récupéré des données.
    if (fetchError && orders.length === 0) {
      return json({ success: false, error: fetchError, sales: [], ca_ht: 0, ca_ttc: 0 }, 502);
    }

    // ── Note : le filtre status=closed est déjà dans la requête
    // On le filtre aussi côté code pour être sûr (défense en profondeur).
    const closedOrders = orders.filter(
      (o) => (o.status as string ?? "").toLowerCase() === VALID_STATUS,
    );
    const nbIgnored = orders.length - closedOrders.length;

    // ── Mapper les commandes en ventes ───────────────────────
    const allSales: unknown[] = [];
    let totalCaHt  = 0;
    let totalCaTtc = 0;

    for (const order of closedOrders) {
      const { sales, ca_ht, ca_ttc } = mapOrderToSales(order);
      allSales.push(...sales);
      totalCaHt  += ca_ht;
      totalCaTtc += ca_ttc;
    }

    // Arrondir les totaux au centime
    totalCaHt  = Math.round(totalCaHt  * 100) / 100;
    totalCaTtc = Math.round(totalCaTtc * 100) / 100;

    return json({
      success:     true,
      sales:       allSales,
      ca_ht:       totalCaHt,         // CA HT en euros — valeur à stocker
      ca_ttc:      totalCaTtc,        // CA TTC en euros — pour info
      nb_orders:   closedOrders.length,
      nb_pages:    pagesLoaded,
      nb_ignored:  nbIgnored,
      partial:     !!fetchError,      // true si pagination interrompue
      partial_error: fetchError ?? null,
      session_id:  `zelty_${Date.now()}`,
    });
  }

  // Action inconnue
  return json({
    error: `Action inconnue : "${action}". Valeurs : test | restaurants | sync.`,
  }, 400);
});
