const ZELTY_BASE   = 'https://api.zelty.fr/2.10';
const PAGE_SIZE    = 100;
const MAX_PAGES    = 50;
const VALID_STATUS = 'closed';

const RESTAURANT_MAP = {
  dax: process.env.ZELTY_RESTAURANT_DAX || '',
  mdm: process.env.ZELTY_RESTAURANT_MDM || '',
};

function getRestaurantId(code) {
  if (!code) return '';
  return RESTAURANT_MAP[String(code).toLowerCase()] || '';
}

function centsToHt(cents, taxRate) {
  var ttc = cents / 100;
  var divisor = 1.10;
  if (taxRate === 5 || taxRate === 55 || taxRate === 550)    divisor = 1.055;
  if (taxRate === 20 || taxRate === 200 || taxRate === 2000) divisor = 1.20;
  return Math.round((ttc / divisor) * 100) / 100;
}

function utcToParis(isoString) {
  try {
    var d = new Date(isoString);
    var parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    var p = {};
    parts.forEach(function(item) { p[item.type] = item.value; });
    return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second;
  } catch(e) {
    return new Date(isoString).toISOString();
  }
}

function utcToParisDate(isoString) {
  return utcToParis(isoString).slice(0, 10);
}

async function fetchAllOrders(apiKey, dateStart, dateEnd, restaurantId) {
  var headers = {
    'Authorization': 'Bearer ' + apiKey,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };

  var allOrders = [];
  var offset = 0;
  var pagesLoaded = 0;

  while (pagesLoaded < MAX_PAGES) {
    var params = new URLSearchParams({
      from:   dateStart + 'T00:00:00',
      to:     dateEnd + 'T23:59:59',
      limit:  String(PAGE_SIZE),
      offset: String(offset),
    });
    if (restaurantId) params.set('restaurant_id', restaurantId);

    var url = ZELTY_BASE + '/orders?' + params.toString();
    console.log('Zelty URL:', url);

    var res;
    try {
      res = await fetch(url, { method: 'GET', headers: headers });
    } catch (err) {
      return { orders: allOrders, pagesLoaded: pagesLoaded, error: 'Erreur réseau: ' + err.message };
    }

    if (!res.ok) {
      var errorText = await res.text();
      console.log('Zelty error:', errorText);
      return { orders: allOrders, pagesLoaded: pagesLoaded, error: 'Zelty HTTP ' + res.status + ': ' + errorText };
    }

    var raw = await res.json();
    var page = Array.isArray(raw) ? raw
      : Array.isArray(raw.orders) ? raw.orders
      : Array.isArray(raw.data)   ? raw.data
      : [];

    allOrders = allOrders.concat(page);
    pagesLoaded++;

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { orders: allOrders, pagesLoaded: pagesLoaded };
}

function mapOrderToSales(order) {
  var createdAt  = order.created_at || order.date || new Date().toISOString();
  var dateMs     = new Date(createdAt).getTime();
  var dateParis  = utcToParis(createdAt);
  var dateParisD = utcToParisDate(createdAt);

  var totalCentsTTC = order.total    || 0;
  var totalCentsHT  = order.total_ht || 0;
  var ca_ttc = Math.round(totalCentsTTC) / 100;
  var ca_ht  = totalCentsHT > 0
    ? Math.round(totalCentsHT) / 100
    : Math.round((totalCentsTTC / 1.10) * 100) / 100;

  var rawItems = Array.isArray(order.items)    ? order.items
    : Array.isArray(order.products) ? order.products
    : Array.isArray(order.lines)    ? order.lines
    : [];

  var sales = [];

  for (var i = 0; i < rawItems.length; i++) {
    var item = rawItems[i];
    var taxRate  = item.tax_rate || 10;
    var priceTTC = item.price || item.unit_price || 0;
    var priceHT  = centsToHt(priceTTC, taxRate);
    var qty      = item.quantity || 1;
    var totalHT  = Math.round(priceHT * qty * 100) / 100;

    sales.push({
      zelty_order_id:   String(order.id || order.ref || ''),
      zelty_session_id: String(order.id || order.ref || '') + '_' + (item.id || Math.random().toString(36).slice(2, 8)),
      recipe_id:        String(item.product_id || item.recipe_id || ''),
      recipe_name:      item.name || item.product_name || 'Produit Zelty',
      quantity:         qty,
      unit_price:       priceHT,
      total_amount:     totalHT,
      source:           'zelty',
      date:             dateMs,
      date_paris:       dateParis,
      date_day:         dateParisD,
      notes:            'Zelty #' + (order.id || order.ref),
    });
  }

  if (sales.length === 0 && ca_ht > 0) {
    sales.push({
      zelty_order_id:   String(order.id || order.ref || ''),
      zelty_session_id: String(order.id || order.ref || ('zelty_' + Date.now())),
      recipe_id:        '',
      recipe_name:      'Commande Zelty (sans détail articles)',
      quantity:         1,
      unit_price:       ca_ht,
      total_amount:     ca_ht,
      source:           'zelty',
      date:             dateMs,
      date_paris:       dateParis,
      date_day:         dateParisD,
      notes:            'Zelty #' + (order.id || order.ref),
    });
  }

  return { sales: sales, ca_ht: ca_ht, ca_ttc: ca_ttc };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode non autorisee. Utilisez POST.' });
  }

  var ZELTY_API_KEY = process.env.ZELTY_API_KEY || '';
  if (!ZELTY_API_KEY) {
    return res.status(500).json({ success: false, error: 'Cle API Zelty non configuree.' });
  }

  var body = req.body || {};
  var action = body.action;
  var date_start = body.date_start;
  var date_end = body.date_end;
  var restaurant = body.restaurant;

  if (!action) {
    return res.status(400).json({ error: "Parametre 'action' manquant." });
  }

  var restaurant_id = getRestaurantId(restaurant);

  var zeltyHeaders = {
    'Authorization': 'Bearer ' + ZELTY_API_KEY,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };

  if (action === 'test' || action === 'restaurants') {
    try {
      var zeltyRes = await fetch(ZELTY_BASE + '/restaurants', { method: 'GET', headers: zeltyHeaders });

      if (zeltyRes.ok) {
        var data = await zeltyRes.json();
        var list = Array.isArray(data) ? data : (data.restaurants || data.data || []);

        if (action === 'restaurants') {
          return res.status(200).json({
            success: true,
            restaurants: list.map(function(r) { return { id: r.id, name: r.name || ('Restaurant ' + r.id) }; }),
          });
        }

        if (restaurant_id) {
          var found = list.find(function(r) { return String(r.id) === String(restaurant_id); });
          return res.status(200).json({
            success: !!found,
            restaurant: found ? { id: found.id, name: found.name || ('Restaurant ' + found.id) } : null,
            error: found ? null : 'Restaurant ID ' + restaurant_id + ' introuvable.',
          });
        }

        var first = list[0] || {};
        return res.status(200).json({ success: true, restaurant: { id: first.id, name: first.name || 'Zelty' } });
      }

      if (zeltyRes.status === 401 || zeltyRes.status === 403) {
        return res.status(200).json({ success: false, error: 'Cle API invalide' });
      }

      return res.status(200).json({ success: false, error: 'Erreur Zelty HTTP ' + zeltyRes.status });

    } catch (err) {
      return res.status(502).json({ success: false, error: 'Impossible de contacter Zelty : ' + err.message });
    }
  }

  if (action === 'sync') {
    if (!restaurant) return res.status(400).json({ error: 'Parametre "restaurant" requis : "dax" ou "mdm".' });
    if (!restaurant_id) return res.status(500).json({ success: false, error: 'Restaurant "' + restaurant + '" non configure.' });
    if (!date_start || !date_end) return res.status(400).json({ error: 'date_start et date_end requis (YYYY-MM-DD).' });

    var result = await fetchAllOrders(ZELTY_API_KEY, date_start, date_end, restaurant_id);
    var orders = result.orders;
    var pagesLoaded = result.pagesLoaded;
    var fetchError = result.error;

    if (fetchError && orders.length === 0) {
      return res.status(502).json({ success: false, error: fetchError, sales: [], ca_ht: 0, ca_ttc: 0 });
    }

var closedOrders = orders;
console.log('First order raw:', JSON.stringify(orders[0]));

    var allSales = [];
    var totalCaHt = 0;
    var totalCaTtc = 0;

    for (var i = 0; i < closedOrders.length; i++) {
      var mapped = mapOrderToSales(closedOrders[i]);
      allSales = allSales.concat(mapped.sales);
      totalCaHt  += mapped.ca_ht;
      totalCaTtc += mapped.ca_ttc;
    }

    return res.status(200).json({
      success:    true,
      sales:      allSales,
      ca_ht:      Math.round(totalCaHt  * 100) / 100,
      ca_ttc:     Math.round(totalCaTtc * 100) / 100,
      nb_orders:  closedOrders.length,
      nb_pages:   pagesLoaded,
      session_id: 'zelty_' + Date.now(),
    });
  }

  return res.status(400).json({ error: 'Action inconnue : "' + action + '".' });
};
