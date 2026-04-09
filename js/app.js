/* ============================================================
   RESTAÜMANAGER — APPLICATION JAVASCRIPT
   Compatible Zelty : structure prête pour intégration API
   ============================================================ */

'use strict';

// ============================================================
// CONFIG & STATE
// ============================================================
const API_BASE = 'https://maria-manager.vercel.app/api/tables';

// ============================================================
// PROXY ZELTY — Route Next.js intégrée (aucune config requise)
// La route /api/zelty/proxy tourne côté serveur automatiquement.
// La clé API est lue depuis process.env.ZELTY_API_KEY (serveur).
// Pour configurer la clé : voir SETUP.md
// ============================================================
const ZELTY_PROXY_URL = 'https://maria-manager-v2.vercel.app/api/zelty/proxy';
const State = {
  currentPage: 'dashboard',
  recipes: [],
  sales: [],
  revenue: [],
  settings: {
    restaurantName: 'Mon Restaurant',
    address: '',
    currency: 'EUR',
    maxCovers: 50,
    syncFreq: 'manual',
    syncOnStart: false,
    syncNotif: true
  },
  zeltyConnected: false,
  charts: {},
  deleteCallback: null,
  recipeFilter: 'all',
  recipeSearch: ''
};

// ============================================================
// ZELTY API CLIENT
// Toutes les requêtes vers Zelty passent par /api/zelty/proxy.
// Le navigateur n'appelle JAMAIS api.zelty.fr directement.
// La clé API Zelty est lue depuis process.env.ZELTY_API_KEY (serveur).
// ============================================================
const ZeltyAPI = {

  // ── Appel générique vers la route proxy Next.js ───────────────
  // Le proxy reçoit { action, ...params } et contacte Zelty
  // côté serveur avec la clé stockée dans les variables d'env.
  async _callProxy(body, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(ZELTY_PROXY_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal
      });
      clearTimeout(timer);

      // Le proxy a répondu — même si Zelty a renvoyé une erreur
      const data = await res.json();
      return data;

    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        return { success: false, message: 'Le proxy ne répond pas (timeout). Vérifiez votre connexion.' };
      }
      return { success: false, message: `Erreur réseau vers le proxy : ${err.message}` };
    }
  },

  // ══════════════════════════════════════════════════════════════
  // 1. TEST CONNEXION
  //    Le proxy contacte GET /restaurants avec la clé côté serveur.
  //    options : { restaurant: "dax" | "mdm" } (optionnel)
  //    Retourne { success, restaurant: { id, name } } ou { success: false, error }
  // ══════════════════════════════════════════════════════════════
  async testConnection(_apiKey, _posId, _apiUrl, options = {}) {
    const body = { action: 'test' };
    if (options.restaurant_id) body.restaurant = options.restaurant_id;
    
    const result = await ZeltyAPI._callProxy(body);
    // Normaliser le champ message pour l'UI
    if (!result.success && result.error) result.message = result.error;
    return result;
  },

  // ══════════════════════════════════════════════════════════════
  // 2. RÉCUPÉRATION DES VENTES
  //    La route proxy :
  //      - appelle GET /orders avec pagination complète
  //      - filtre status=closed
  //      - convertit centimes→euros, TTC→HT, UTC→Paris
  //
  //    options : { date_start, date_end, restaurant }
  //      date_start / date_end : YYYY-MM-DD
  //      restaurant : "dax" | "mdm" (optionnel)
  // ══════════════════════════════════════════════════════════════
  async fetchSales(_apiKey, _posId, _apiUrl, options = {}) {
    // Période par défaut : hier → aujourd'hui
    const today     = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];

    const body = {
      action:     'sync',
      date_start: options.date_start || yesterday,
      date_end:   options.date_end   || today,
    };
    if (options.restaurant) body.restaurant = options.restaurant;

    const result = await ZeltyAPI._callProxy(body, 30000); // 30 s — pagination peut être longue
    if (!result.success && result.error) result.message = result.error;
    return result;
  },

  // ══════════════════════════════════════════════════════════════
  // 3. LISTE DES RESTAURANTS (multi-site)
  // ══════════════════════════════════════════════════════════════
  async fetchRestaurants() {
    const result = await ZeltyAPI._callProxy({ action: 'restaurants' });
    if (!result.success && result.error) result.message = result.error;
    return result;
  },

  // ══════════════════════════════════════════════════════════════
  // MODE DÉMO — utilisé UNIQUEMENT si proxy non configuré
  // Les prix sont déjà HT (prix des recettes), dates en Paris.
  // ══════════════════════════════════════════════════════════════
  _simulateSalesSync() {
    return new Promise((resolve) => {
      setTimeout(() => {
        const recipes = State.recipes.filter(r => r.is_active).slice(0, 6);
        const sales = recipes.map(r => {
          const priceHT = r.price || 0;
          const qty     = Math.floor(Math.random() * 5) + 1;
          // Date UTC simulée → heure Paris via Intl
          const utcDate = new Date(Date.now() - Math.random() * 3_600_000).toISOString();
          const dateParis = (() => {
            try {
              const parts = new Intl.DateTimeFormat('fr-FR', {
                timeZone: 'Europe/Paris',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
              }).formatToParts(new Date(utcDate));
              const p = {};
              parts.forEach(({ type, value }) => { p[type] = value; });
              return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
            } catch { return utcDate; }
          })();
          return {
            zelty_session_id: `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            recipe_id:    r.id,
            recipe_name:  r.name,
            quantity:     qty,
            unit_price:   priceHT,
            total_amount: +(priceHT * qty).toFixed(2),
            source:       'zelty',
            date:         Date.now(),
            date_paris:   dateParis,
            notes:        'Démo — clé ZELTY_API_KEY non encore configurée'
          };
        });
        resolve({
          success: true,
          sales,
          session_id: `demo_${Date.now()}`,
          total_revenue: +sales.reduce((s, x) => s + x.total_amount, 0).toFixed(2)
        });
      }, 1500);
    });
  }
};

// ============================================================
// API HELPERS
// ============================================================
async function apiGet(table, params = '') {
  const res = await fetch(`${API_BASE}/${table}?limit=500${params ? '&' + params : ''}`);
  if (!res.ok) throw new Error(`Erreur API: ${res.status}`);
  return res.json();
}

// apiGet avec filtre restaurant_id automatique
async function apiGetR(table, params = '') {
  const ctx = window.RestaurantCtx;
  const filtered = ctx ? ctx.filterQS(params) : params;
  return apiGet(table, filtered);
}

async function apiPost(table, data) {
  const res = await fetch(`${API_BASE}/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Erreur création: ${res.status}`);
  return res.json();
}

async function apiPut(table, id, data) {
  const res = await fetch(`${API_BASE}/${table}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Erreur mise à jour: ${res.status}`);
  return res.json();
}

async function apiDelete(table, id) {
  const res = await fetch(`${API_BASE}/${table}/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`Erreur suppression: ${res.status}`);
}

// ============================================================
// NAVIGATION
// ============================================================
function navigateTo(page) {
  State.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const titles = {
    dashboard: 'Tableau de bord',
    recipes: 'Recettes & Menu',
    sales: 'Ventes',
    revenue: "Chiffre d'affaires",
    mercuriale: 'Mercuriale — Prix fournisseurs',
    factures: 'Factures fournisseurs',
    pareto: 'Analyse achats — Pareto 80/20',
    rentabilite: 'Rentabilité',
    inventaires: 'Inventaires & Marges Réelles',
    restaurants: 'Mes restaurants',
    global: 'Vue globale — Tous les restaurants',
    // MariaManager
    settings: 'Paramètres'
  };

  // Titre avec nom restaurant pour pages filtrées
  const restoName = window.RestaurantCtx?.current()?.nom || '';
  const pagedWithResto = ['sales','revenue','inventaires','rentabilite','factures'];
  if (restoName && pagedWithResto.includes(page)) {
    document.getElementById('pageTitle').textContent = (titles[page] || page) + ' — ' + restoName;
  } else {
    document.getElementById('pageTitle').textContent = titles[page] || page;
  }
  // Refresh page data
  const loaders = {
    dashboard: loadDashboard,
    recipes: loadRecipes,
    sales: loadSales,
    revenue: loadRevenue,
    mercuriale: () => { if (window.Mercuriale) Mercuriale.load(); },
    factures: () => { if (window.Factures) Factures.load(); },
    pareto: () => { if (window.Pareto) Pareto.load(); },
    rentabilite: () => { if (window.Rentabilite) Rentabilite.load(); },
    inventaires: () => { if (window.Inventaire) Inventaire.load(); },
    restaurants: loadRestaurantsPage,
    global: loadGlobalView,
    settings: loadSettings
  };
  if (loaders[page]) loaders[page]();

  closeSidebar();
}

// Sidebar mobile
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('active');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
}

// ============================================================
// MODALS
// ============================================================
function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function toast(message, type = 'info', duration = 3500) {
  const icons = {
    success: 'fas fa-check-circle',
    error: 'fas fa-exclamation-circle',
    warning: 'fas fa-exclamation-triangle',
    info: 'fas fa-info-circle',
    zelty: 'fas fa-sync-alt'
  };

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="${icons[type] || icons.info}"></i><span>${message}</span>`;
  document.getElementById('toastContainer').appendChild(el);

  setTimeout(() => {
    el.style.animation = 'toastOut .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ============================================================
// FORMAT HELPERS
// ============================================================
function formatCurrency(amount) {
  if (isNaN(amount)) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  if (isNaN(d)) return ts;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return ts;
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard() {
  // Mettre à jour le nom du restaurant dans le dashboard
  const restoName = window.RestaurantCtx?.current()?.nom || '';
  const dnEl = document.getElementById('dashRestaurantName');
  if (dnEl) dnEl.textContent = restoName;
  const dnEl2 = document.getElementById('dashRestoName');
  if (dnEl2) dnEl2.textContent = restoName || '—';
  const badge = document.getElementById('dashRestoBadge');
  if (badge) badge.style.display = restoName ? '' : 'none';

  // Garde : bloquer si aucun restaurant sélectionné
  if (window.RestaurantCtx?.showWelcomeIfNeeded()) return;

  try {
    const [recipesData, revenueData, salesData] = await Promise.all([
      apiGet('recipes'),
      apiGetR('daily_revenue', 'sort=date'),
      apiGetR('sales')
    ]);

    State.recipes = recipesData.data || [];
    State.revenue = revenueData.data || [];
    State.sales = salesData.data || [];

    updateKPIs();
    renderRevenueChart();
    renderCategoryChart();
    // Afficher le skeleton du bloc titre intégré immédiatement
    if (window.PilotageBloc) {
      window.PilotageBloc.update(null, State.recipes);
    }
    // Rafraîchir les onglets Ce mois-ci / Aujourd'hui
    if (window.DashboardTabs) DashboardTabs.refresh();
    // Inject inventaire card if module ready
    setTimeout(() => { if (window.Inventaire)  Inventaire.updateDashCard();  }, 500);
    // Inject rentabilité card — déclenchera aussi PilotageBloc.update via renderDashCard
    setTimeout(() => { if (window.Rentabilite) Rentabilite.updateDashCard(); }, 700);
  } catch (e) {
    console.error('Dashboard load error:', e);
    toast('Erreur lors du chargement du tableau de bord', 'error');
  }
}

function updateKPIs() {
  const today = todayStr();
  const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

  const todayRevenue = State.revenue.find(r => r.date === today);
  setEl('kpiToday', todayRevenue ? formatCurrency(todayRevenue.revenue) : '—');
  setEl('kpiTodaySub', todayRevenue
    ? `${todayRevenue.covers || 0} couverts`
    : 'Aucun CA saisi aujourd\'hui');

  const weekTotal = State.revenue.reduce((sum, r) => sum + (r.revenue || 0), 0);
  setEl('kpiWeek', weekTotal > 0 ? formatCurrency(weekTotal) : '—');
  setEl('kpiWeekSub', `${State.revenue.length} jour(s) enregistrés`);

  const totalCovers = State.revenue.reduce((sum, r) => sum + (r.covers || 0), 0);
  const avgTicket = totalCovers > 0 ? weekTotal / totalCovers : 0;
  setEl('kpiCovers', totalCovers || '—');
  setEl('kpiCoversSub', avgTicket > 0
    ? `Ticket moyen : ${formatCurrency(avgTicket)}`
    : 'Ticket moyen : —');

  const activeRecipes = State.recipes.filter(r => r.is_active !== false).length;
  setEl('kpiRecipes', activeRecipes || '—');
  setEl('kpiRecipesSub', `${State.recipes.length} au total`);
}

function renderRevenueChart() {
  const ctx = document.getElementById('revenueChart');
  if (!ctx) return;
  if (State.charts.revenue) State.charts.revenue.destroy();

  const sorted = [...State.revenue].sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
  const labels = sorted.map(r => {
    const d = new Date(r.date);
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  });
  const data = sorted.map(r => r.revenue || 0);

  State.charts.revenue = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'CA (€)',
        data,
        backgroundColor: 'rgba(37,99,235,.15)',
        borderColor: 'rgba(37,99,235,1)',
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => formatCurrency(ctx.parsed.y)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: v => v.toLocaleString('fr-FR') + ' €',
            font: { size: 11 }
          },
          grid: { color: 'rgba(0,0,0,.04)' }
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

function renderCategoryChart() {
  const ctx = document.getElementById('categoryChart');
  if (!ctx) return;
  if (State.charts.category) State.charts.category.destroy();

  // Count recipes by category
  const cats = {};
  State.recipes.filter(r => r.is_active !== false).forEach(r => {
    const cat = r.category || 'autre';
    cats[cat] = (cats[cat] || 0) + 1;
  });

  if (Object.keys(cats).length === 0) {
    State.charts.category = null;
    return;
  }

  const colors = {
    'entrée': '#22c55e', 'plat': '#3b82f6', 'dessert': '#a855f7',
    'boisson': '#f97316', 'autre': '#94a3b8'
  };

  State.charts.category = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(cats).map(k => k.charAt(0).toUpperCase() + k.slice(1)),
      datasets: [{
        data: Object.values(cats),
        backgroundColor: Object.keys(cats).map(k => colors[k] || '#94a3b8'),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 12, font: { size: 12 }, usePointStyle: true }
        }
      },
      cutout: '65%'
    }
  });
}

// ============================================================
// RECIPES
// ============================================================
async function loadRecipes() {
  try {
    const data = await apiGet('recipes');
    State.recipes = data.data || [];
    renderRecipes();
  } catch (e) {
    toast('Erreur chargement des recettes', 'error');
  }
}

function renderRecipes() {
  const grid = document.getElementById('recipesGrid');
  const search = State.recipeSearch.toLowerCase();

  let filtered = State.recipes.filter(r => {
    const matchFilter = State.recipeFilter === 'all' || r.category === State.recipeFilter;
    const matchSearch = !search ||
      (r.name || '').toLowerCase().includes(search) ||
      (r.description || '').toLowerCase().includes(search);
    return matchFilter && matchSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <i class="fas fa-book-open"></i>
        <p>Aucune recette trouvée</p>
        <button class="btn btn-primary" onclick="document.getElementById('addRecipeBtn').click()">
          Ajouter une recette
        </button>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(recipe => recipeCardHTML(recipe)).join('');

  // Check Zelty mappings
  const unmapped = State.recipes.filter(r => r.is_active !== false && !r.zelty_product_id).length;
  const banner = document.getElementById('zeltyRecipeBanner');
  if (banner) {
    banner.style.display = unmapped > 0 ? 'flex' : 'none';
    if (unmapped > 0) {
      banner.querySelector('span').innerHTML =
        `<strong>${unmapped} recette(s)</strong> sans ID Zelty. Renseignez-les pour activer la synchronisation automatique.`;
    }
  }
}

function recipeCardHTML(r) {
  const price = r.price || 0;
  const cost = r.cost || 0;
  const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
  const marginColor = margin >= 60 ? '#16a34a' : margin >= 40 ? '#d97706' : '#dc2626';

  const zeltyLink = r.zelty_product_id
    ? `<div class="zelty-link linked">
        <i class="fas fa-link"></i>
        Zelty: ${r.zelty_product_id}
      </div>`
    : `<div class="zelty-link unlinked" onclick="openRecipeModal('${r.id}')" title="Ajouter l'ID Zelty">
        <i class="fas fa-plus"></i>
        Lier à Zelty
      </div>`;

  return `
    <div class="recipe-card ${r.is_active === false ? 'inactive' : ''}">
      <div class="recipe-card-header">
        <span class="recipe-badge ${r.category || 'autre'}">${r.category || 'autre'}</span>
        <div class="recipe-actions">
          <button class="icon-btn" onclick="openRecipeModal('${r.id}')" title="Modifier">
            <i class="fas fa-edit"></i>
          </button>
          <button class="icon-btn danger" onclick="confirmDelete('recipe','${r.id}','${(r.name||'').replace(/'/g,"\\'")}')">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
      <div class="recipe-card-body">
        <p class="recipe-name">${r.name || '—'}</p>
        ${r.description ? `<p class="recipe-desc">${r.description}</p>` : ''}
        <div class="recipe-prices">
          <div class="price-item">
            <span class="price-label">Vente</span>
            <span class="price-value">${formatCurrency(price)}</span>
          </div>
          ${cost > 0 ? `
          <div class="price-item">
            <span class="price-label">Revient</span>
            <span class="price-value cost">${formatCurrency(cost)}</span>
          </div>
          <div class="price-item">
            <span class="price-label">Marge</span>
            <span class="price-value" style="color:${marginColor}">${margin}%</span>
          </div>` : ''}
        </div>
        ${cost > 0 ? `
        <div class="margin-bar">
          <div class="margin-fill" style="width:${Math.min(margin,100)}%;background:${marginColor}"></div>
        </div>` : ''}
        ${zeltyLink}
      </div>
    </div>`;
}

function openRecipeModal(id = null) {
  document.getElementById('recipeModalId').value = '';
  document.getElementById('recipeName').value = '';
  document.getElementById('recipeCategory').value = 'plat';
  document.getElementById('recipePrice').value = '';
  document.getElementById('recipeCost').value = '';
  document.getElementById('recipeDescription').value = '';
  document.getElementById('recipeZeltyId').value = '';
  document.getElementById('recipeActive').checked = true;
  // Type de recette : produit_fini par défaut
  const typePF = document.getElementById('recipeTypePF');
  const typeSR = document.getElementById('recipeTypeSR');
  if (typePF) typePF.checked = true;
  if (typeSR) typeSR.checked = false;
  document.getElementById('recipeModalTitle').textContent = 'Nouvelle recette';

  // V3 : bouton ingrédients (visible seulement en édition)
  const shortcut = document.getElementById('recipeIngredientsShortcut');
  const newHint = document.getElementById('recipeIngredientsNew');
  const openBtn = document.getElementById('openIngredientsBtn');

  if (id) {
    const r = State.recipes.find(x => x.id === id);
    if (r) {
      document.getElementById('recipeModalId').value = r.id;
      document.getElementById('recipeName').value = r.name || '';
      document.getElementById('recipeCategory').value = r.category || 'plat';
      document.getElementById('recipePrice').value = r.price || '';
      document.getElementById('recipeCost').value = r.cost || '';
      document.getElementById('recipeDescription').value = r.description || '';
      document.getElementById('recipeZeltyId').value = r.zelty_product_id || '';
      document.getElementById('recipeActive').checked = r.is_active !== false;
      // Type recette
      const isSR = r.type === 'sous_recette';
      const typePF2 = document.getElementById('recipeTypePF');
      const typeSR2 = document.getElementById('recipeTypeSR');
      if (typePF2) typePF2.checked = !isSR;
      if (typeSR2) typeSR2.checked = isSR;
      document.getElementById('recipeModalTitle').textContent = 'Modifier la recette';

      // Afficher bouton ingrédients
      if (shortcut) shortcut.style.display = 'flex';
      if (newHint) newHint.style.display = 'none';
      if (openBtn) {
        openBtn.onclick = () => {
          closeModal('recipeModal');
          RecipeIngredientsManager.openForRecipe(r.id);
        };
      }

      // Charger le résumé ingrédients
      loadIngredientsSummary(r.id);
    }
  } else {
    if (shortcut) shortcut.style.display = 'none';
    if (newHint) newHint.style.display = 'block';
  }
  openModal('recipeModal');
}

async function loadIngredientsSummary(recipeId) {
  try {
    const res = await fetch('tables/recipe_ingredients?limit=500');
    const data = await res.json();
    const ings = (data.data || []).filter(i => i.recipe_id === recipeId);
    const summaryEl = document.getElementById('ingredientsSummaryText');
    if (summaryEl) {
      if (ings.length === 0) {
        summaryEl.textContent = 'Aucun ingrédient lié — Cliquez pour ajouter';
      } else {
        const totalCost = ings.reduce((s, i) => s + (i.cost || 0), 0);
        summaryEl.textContent = `${ings.length} ingrédient(s) — Coût : ${formatCurrency(totalCost)}`;
      }
    }
  } catch { /* silent */ }
}

async function saveRecipe() {
  const id = document.getElementById('recipeModalId').value;
  const name = document.getElementById('recipeName').value.trim();
  if (!name) { toast('Veuillez saisir un nom de recette', 'warning'); return; }
  const price = parseFloat(document.getElementById('recipePrice').value);
  if (!price || price <= 0) { toast('Veuillez saisir un prix valide', 'warning'); return; }

  // Type de recette
  const recipeType = document.querySelector('input[name="recipeType"]:checked')?.value || 'produit_fini';

  const data = {
    name,
    category: document.getElementById('recipeCategory').value,
    price,
    cost: parseFloat(document.getElementById('recipeCost').value) || 0,
    description: document.getElementById('recipeDescription').value.trim(),
    zelty_product_id: document.getElementById('recipeZeltyId').value.trim(),
    is_active: document.getElementById('recipeActive').checked,
    type: recipeType
  };

  try {
    if (id) {
      await apiPut('recipes', id, data);
      toast('Recette mise à jour avec succès', 'success');
    } else {
      await apiPost('recipes', data);
      toast('Recette créée avec succès', 'success');
    }
    closeModal('recipeModal');
    await loadRecipes();
  } catch (e) {
    toast('Erreur lors de l\'enregistrement', 'error');
  }
}

// ============================================================
// SALES
// ============================================================
async function loadSales() {
  if (!window.RestaurantCtx?.guardDisplay('Ventes')) return;
  try {
    const [salesData, recipesData] = await Promise.all([
      apiGetR('sales', 'sort=date'),
      apiGet('recipes')
    ]);
    State.sales = salesData.data || [];
    State.recipes = recipesData.data || [];
    populateRecipeSelect();
    renderSales();
    updateSalesSummary();
  } catch (e) {
    toast('Erreur chargement des ventes', 'error');
  }
}

function populateRecipeSelect() {
  const sel = document.getElementById('saleRecipe');
  if (!sel) return;
  const active = State.recipes.filter(r => r.is_active !== false);
  sel.innerHTML = '<option value="">-- Sélectionner --</option>' +
    active.map(r => `<option value="${r.id}" data-price="${r.price}">${r.name} — ${formatCurrency(r.price)}</option>`).join('');
}

function renderSales() {
  const tbody = document.getElementById('salesTableBody');
  const empty = document.getElementById('salesEmpty');
  const search = (document.getElementById('saleSearch')?.value || '').toLowerCase();
  const sourceFilter = document.getElementById('saleSourceFilter')?.value || 'all';

  let filtered = State.sales.filter(s => {
    const matchSource = sourceFilter === 'all' || s.source === sourceFilter;
    const matchSearch = !search ||
      (s.recipe_name || '').toLowerCase().includes(search) ||
      (s.notes || '').toLowerCase().includes(search);
    return matchSource && matchSearch;
  }).sort((a, b) => (b.date || 0) - (a.date || 0));

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = filtered.map(s => `
    <tr>
      <td>${formatDateTime(s.date)}</td>
      <td><strong>${s.recipe_name || '—'}</strong></td>
      <td>${s.quantity || 1}</td>
      <td>${formatCurrency(s.unit_price)}</td>
      <td><strong>${formatCurrency(s.total_amount)}</strong></td>
      <td>
        <span class="source-tag ${s.source || 'manual'}">
          ${s.source === 'zelty' ? '<i class="fas fa-sync-alt"></i> Zelty' : '<i class="fas fa-pencil-alt"></i> Manuel'}
        </span>
      </td>
      <td>
        <div class="actions-cell">
          <button class="icon-btn" onclick="openSaleModal('${s.id}')" title="Modifier">
            <i class="fas fa-edit"></i>
          </button>
          <button class="icon-btn danger" onclick="confirmDelete('sale','${s.id}','vente du ${formatDate(s.date)}')" title="Supprimer">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>`).join('');
}

function updateSalesSummary() {
  const total = State.sales.length;
  const revenue = State.sales.reduce((sum, s) => sum + (s.total_amount || 0), 0);
  const manual = State.sales.filter(s => s.source !== 'zelty').length;
  const zelty = State.sales.filter(s => s.source === 'zelty').length;

  document.getElementById('salesTotalCount').textContent = total;
  document.getElementById('salesTotalRevenue').textContent = formatCurrency(revenue);
  document.getElementById('salesManualCount').textContent = manual;
  document.getElementById('salesZeltyCount').textContent = zelty;
}

function openSaleModal(id = null) {
  document.getElementById('saleModalId').value = '';
  document.getElementById('saleDate').value = todayStr();
  document.getElementById('saleRecipe').value = '';
  document.getElementById('saleQty').value = 1;
  document.getElementById('saleUnitPrice').value = '';
  document.getElementById('saleNotes').value = '';
  document.getElementById('saleTotalDisplay').textContent = '0,00 €';
  document.getElementById('saleModalTitle').textContent = 'Nouvelle vente';

  if (id) {
    const s = State.sales.find(x => x.id === id);
    if (s) {
      document.getElementById('saleModalId').value = s.id;
      document.getElementById('saleDate').value = s.date ? new Date(s.date).toISOString().split('T')[0] : todayStr();
      document.getElementById('saleRecipe').value = s.recipe_id || '';
      document.getElementById('saleQty').value = s.quantity || 1;
      document.getElementById('saleUnitPrice').value = s.unit_price || '';
      document.getElementById('saleNotes').value = s.notes || '';
      updateSaleTotal();
      document.getElementById('saleModalTitle').textContent = 'Modifier la vente';
    }
  }
  openModal('saleModal');
}

function updateSaleTotal() {
  const qty = parseFloat(document.getElementById('saleQty')?.value) || 0;
  const price = parseFloat(document.getElementById('saleUnitPrice')?.value) || 0;
  const total = qty * price;
  document.getElementById('saleTotalDisplay').textContent = formatCurrency(total);
}

async function saveSale() {
  const id = document.getElementById('saleModalId').value;
  const recipeId = document.getElementById('saleRecipe').value;
  const qty = parseInt(document.getElementById('saleQty').value) || 1;
  const price = parseFloat(document.getElementById('saleUnitPrice').value);

  if (!recipeId) { toast('Sélectionnez un produit', 'warning'); return; }
  if (!price || price <= 0) { toast('Saisissez un prix valide', 'warning'); return; }

  const recipe = State.recipes.find(r => r.id === recipeId);
  const dateVal = document.getElementById('saleDate').value;

  const data = window.RestaurantCtx?.filterBody({
    date: dateVal ? new Date(dateVal).getTime() : Date.now(),
    recipe_id: recipeId,
    recipe_name: recipe ? recipe.name : 'Produit inconnu',
    quantity: qty,
    unit_price: price,
    total_amount: +(qty * price).toFixed(2),
    source: 'manual',
    notes: document.getElementById('saleNotes').value.trim(),
    zelty_session_id: ''
  }) || { date: Date.now(), source: 'manual' };

  try {
    if (id) {
      await apiPut('sales', id, data);
      toast('Vente mise à jour', 'success');
    } else {
      await apiPost('sales', data);
      toast('Vente enregistrée', 'success');
    }
    closeModal('saleModal');
    await loadSales();
  } catch (e) {
    toast('Erreur lors de l\'enregistrement', 'error');
  }
}

// ============================================================
// REVENUE (CA)
// ============================================================
async function loadRevenue() {
  if (!window.RestaurantCtx?.guardDisplay('Chiffre d\'affaires')) return;
  try {
    const data = await apiGetR('daily_revenue', 'sort=date');
    State.revenue = data.data || [];
    renderRevenueTable();
    renderRevenueDetailChart();
    updateRevenueKPIs();
  } catch (e) {
    toast('Erreur chargement du CA', 'error');
  }
}

function updateRevenueKPIs() {
  const now = new Date();
  const monthRevenues = State.revenue.filter(r => {
    const d = new Date(r.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const monthTotal = monthRevenues.reduce((sum, r) => sum + (r.revenue || 0), 0);
  const avg = monthRevenues.length > 0 ? monthTotal / monthRevenues.length : 0;
  const best = [...State.revenue].sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0];
  const totalCovers = State.revenue.reduce((sum, r) => sum + (r.covers || 0), 0);

  document.getElementById('kpiMonthRevenue').textContent = monthTotal > 0 ? formatCurrency(monthTotal) : '—';
  document.getElementById('kpiAvgRevenue').textContent = avg > 0 ? formatCurrency(avg) : '—';
  document.getElementById('kpiBestDay').textContent = best ? formatCurrency(best.revenue) : '—';
  document.getElementById('kpiTotalCovers').textContent = totalCovers || '—';
}

function renderRevenueTable() {
  const tbody = document.getElementById('revenueTableBody');
  const empty = document.getElementById('revenueEmpty');

  const sorted = [...State.revenue].sort((a, b) => b.date.localeCompare(a.date));

  if (sorted.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = sorted.map(r => {
    const avgTicket = (r.covers && r.covers > 0) ? r.revenue / r.covers : null;
    return `
      <tr>
        <td><strong>${formatDate(r.date)}</strong></td>
        <td><strong class="text-success">${formatCurrency(r.revenue)}</strong></td>
        <td>${r.covers || '—'}</td>
        <td>${avgTicket ? formatCurrency(avgTicket) : '—'}</td>
        <td>
          <span class="source-tag ${r.source || 'manual'}">
            ${r.source === 'zelty' ? '<i class="fas fa-sync-alt"></i> Zelty' : '<i class="fas fa-pencil-alt"></i> Manuel'}
          </span>
        </td>
        <td class="text-muted">${r.notes || '—'}</td>
        <td>
          <div class="actions-cell">
            <button class="icon-btn" onclick="openRevenueModal('${r.id}')" title="Modifier">
              <i class="fas fa-edit"></i>
            </button>
            <button class="icon-btn danger" onclick="confirmDelete('revenue','${r.id}','CA du ${formatDate(r.date)}')" title="Supprimer">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function renderRevenueDetailChart() {
  const ctx = document.getElementById('revenueDetailChart');
  if (!ctx) return;
  if (State.charts.revenueDetail) State.charts.revenueDetail.destroy();

  const sorted = [...State.revenue].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return;

  const labels = sorted.map(r => formatDate(r.date));
  const data = sorted.map(r => r.revenue || 0);

  State.charts.revenueDetail = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'CA (€)',
        data,
        fill: true,
        backgroundColor: 'rgba(37,99,235,.08)',
        borderColor: 'rgba(37,99,235,1)',
        borderWidth: 2.5,
        pointBackgroundColor: 'rgba(37,99,235,1)',
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => formatCurrency(ctx.parsed.y) }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            callback: v => v.toLocaleString('fr-FR') + ' €',
            font: { size: 11 }
          },
          grid: { color: 'rgba(0,0,0,.04)' }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, maxTicksLimit: 10 }
        }
      }
    }
  });
}

function openRevenueModal(id = null) {
  document.getElementById('revenueModalId').value = '';
  document.getElementById('revenueDate').value = todayStr();
  document.getElementById('revenueAmount').value = '';
  document.getElementById('revenueCovers').value = '';
  document.getElementById('revenueSource').value = 'manual';
  document.getElementById('revenueNotes').value = '';
  document.getElementById('revenueModalTitle').textContent = 'Saisir le CA du jour';

  if (id) {
    const r = State.revenue.find(x => x.id === id);
    if (r) {
      document.getElementById('revenueModalId').value = r.id;
      document.getElementById('revenueDate').value = r.date || todayStr();
      document.getElementById('revenueAmount').value = r.revenue || '';
      document.getElementById('revenueCovers').value = r.covers || '';
      document.getElementById('revenueSource').value = r.source || 'manual';
      document.getElementById('revenueNotes').value = r.notes || '';
      document.getElementById('revenueModalTitle').textContent = 'Modifier le CA';
    }
  }
  openModal('revenueModal');
}

async function saveRevenue() {
  const id = document.getElementById('revenueModalId').value;
  const date = document.getElementById('revenueDate').value;
  const amount = parseFloat(document.getElementById('revenueAmount').value);

  if (!date) { toast('Sélectionnez une date', 'warning'); return; }
  if (!amount || amount < 0) { toast('Saisissez un CA valide', 'warning'); return; }

  const data = window.RestaurantCtx?.filterBody({
    date,
    revenue: amount,
    covers: parseInt(document.getElementById('revenueCovers').value) || 0,
    source: document.getElementById('revenueSource').value,
    notes: document.getElementById('revenueNotes').value.trim()
  }) || { date, revenue: amount };

  try {
    if (id) {
      await apiPut('daily_revenue', id, data);
      toast('CA mis à jour', 'success');
    } else {
      // Check for duplicate date
      const existing = State.revenue.find(r => r.date === date);
      if (existing) {
        toast('Un CA existe déjà pour cette date. Modifiez l\'existant.', 'warning');
        return;
      }
      await apiPost('daily_revenue', data);
      toast('CA enregistré pour le ' + formatDate(date), 'success');
    }
    closeModal('revenueModal');
    await loadRevenue();
  } catch (e) {
    toast('Erreur lors de l\'enregistrement', 'error');
  }
}

// ============================================================
// SETTINGS
// ============================================================
function loadSettings() {
  // Restaurant info
  const rsettings = JSON.parse(localStorage.getItem('zm_restaurant') || '{}');
  document.getElementById('settingRestaurantName').value = rsettings.name || '';
  document.getElementById('settingAddress').value = rsettings.address || '';
  document.getElementById('settingCurrency').value = rsettings.currency || 'EUR';
  document.getElementById('settingMaxCovers').value = rsettings.maxCovers || '';

  // Sync settings
  const sync = JSON.parse(localStorage.getItem('zm_sync') || '{}');
  document.getElementById('settingSyncFreq').value = sync.freq || 'manual';
  document.getElementById('settingSyncOnStart').checked = sync.onStart || false;
  document.getElementById('settingSyncNotif').checked = sync.notif !== false;

  // API status badge (initial)
  updateApiStatusBadge(State.zeltyConnected);

  // Data info
  updateDataInfo();
}

function updateApiStatusBadge(isConnected) {
  const badge = document.getElementById('apiStatusBadge');
  if (!badge) return;

  if (isConnected) {
    badge.className = 'badge badge-connected';
    badge.innerHTML = '<i class="fas fa-check-circle"></i> Connectée ✅';
  } else {
    badge.className = 'badge badge-manual';
    badge.innerHTML = 'Non testée';
  }
}

function updateZeltyStatusBar() {
  const badge = document.getElementById('zeltyStatusBadge');
  const text = document.getElementById('zeltyStatusText');
  if (!badge || !text) return;

  if (State.zeltyConnected) {
    badge.className = 'zelty-status connected';
    text.textContent = 'Zelty connectée';
  } else {
    badge.className = 'zelty-status';
    text.textContent = 'Mode manuel';
  }
}

async function verifyZeltyConnection() {
  const resultEl = document.getElementById('connectionResult');
  const btn = document.getElementById('verifyZeltyConnectionBtn');

  if (!resultEl || !btn) return;

  // Récupérer le restaurant sélectionné
  const ctx = window.RestaurantCtx;
  const restaurant = restoId === '8714' ? 'dax' : restoId === '7426' ? 'mdm' : null;

  resultEl.style.display = 'flex';
  resultEl.className = 'connection-result testing';
  resultEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Vérification en cours…';
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Vérification en cours…';

  try {
    const result = await ZeltyAPI.testConnection(null, null, null, { restaurant });

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-wifi"></i> Vérifier la connexion Zelty';

    if (result.success) {
      State.zeltyConnected = true;
      updateApiStatusBadge(true);
      updateZeltyStatusBar();
      resultEl.className = 'connection-result success';
      resultEl.innerHTML = `<i class="fas fa-check-circle"></i> Connexion réussie ✅<br><small>Restaurant : ${result.restaurant?.name || 'Zelty'}</small>`;
      toast('Connexion Zelty vérifiée avec succès', 'success');
    } else {
      State.zeltyConnected = false;
      updateApiStatusBadge(false);
      updateZeltyStatusBar();
      resultEl.className = 'connection-result error';
      const errMsg = result.message || result.error || 'Erreur inconnue';
      resultEl.innerHTML = `<i class="fas fa-times-circle"></i> ${errMsg}`;
      toast(errMsg, 'error');
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-wifi"></i> Vérifier la connexion Zelty';
    State.zeltyConnected = false;
    updateApiStatusBadge(false);
    updateZeltyStatusBar();
    resultEl.className = 'connection-result error';
    resultEl.innerHTML = `<i class="fas fa-times-circle"></i> Erreur : ${err.message}`;
    toast('Erreur lors de la vérification', 'error');
  }
}

function saveRestaurantSettings() {
  const data = {
    name: document.getElementById('settingRestaurantName').value.trim(),
    address: document.getElementById('settingAddress').value.trim(),
    currency: document.getElementById('settingCurrency').value,
    maxCovers: parseInt(document.getElementById('settingMaxCovers').value) || 50
  };
  localStorage.setItem('zm_restaurant', JSON.stringify(data));
  toast('Informations restaurant enregistrées', 'success');
}

function saveSyncSettings() {
  const data = {
    freq: document.getElementById('settingSyncFreq').value,
    onStart: document.getElementById('settingSyncOnStart').checked,
    notif: document.getElementById('settingSyncNotif').checked
  };
  localStorage.setItem('zm_sync', JSON.stringify(data));
  toast('Préférences de synchronisation enregistrées', 'success');
}

function updateDataInfo() {
  const el = document.getElementById('dataInfo');
  if (!el) return;
  el.innerHTML = `
    <p><i class="fas fa-utensils" style="color:var(--primary)"></i> Recettes : <strong>${State.recipes.length}</strong></p>
    <p><i class="fas fa-receipt" style="color:var(--success)"></i> Ventes : <strong>${State.sales.length}</strong></p>
    <p><i class="fas fa-chart-line" style="color:var(--zelty)"></i> Jours CA : <strong>${State.revenue.length}</strong></p>
    <p><i class="fas fa-shield-alt" style="color:#9333ea"></i> Proxy Zelty : <strong>${State.zeltyConnected ? 'Connecté ✅' : 'Non testé (cliquez "Vérifier la connexion")'}</strong></p>
  `;
}

function exportData() {
  const data = {
    exportDate: new Date().toISOString(),
    recipes: State.recipes,
    sales: State.sales,
    revenue: State.revenue
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `restaümanager_export_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Données exportées', 'success');
}

// ============================================================
// ZELTY SYNC — via proxy /api/zelty/proxy
// ============================================================
async function runZeltySync() {
  openModal('syncModal');

  const icon = document.getElementById('syncIcon');
  icon.className = 'fas fa-sync-alt fa-spin';
  document.getElementById('syncResult').style.display = 'none';
  document.getElementById('syncModalFooter').style.display = 'none';
  document.getElementById('syncModalClose').style.display = 'none';

  // ── Helpers UI ──────────────────────────────────────────────
  const setStep = (id, state) => {
    // state : 'spin' | 'done' | 'error' | 'pending'
    const el = document.getElementById(id);
    if (!el) return;
    const icons = {
      spin:    'fas fa-circle-notch fa-spin',
      done:    'fas fa-check-circle',
      error:   'fas fa-times-circle',
      pending: 'fas fa-circle'
    };
    el.className = `sync-step ${state === 'spin' ? '' : state}`;
    el.querySelector('i').className = icons[state] || icons.pending;
  };

  const failSync = (message) => {
    icon.className = 'fas fa-times-circle';
    const r = document.getElementById('syncResult');
    r.style.display = 'block';
    r.className = 'sync-result error';
    r.innerHTML = `<i class="fas fa-times-circle"></i> ${message}`;
    document.getElementById('syncModalFooter').style.display = 'flex';
    document.getElementById('syncModalClose').style.display = 'block';
  };

  // Reset toutes les étapes
  ['syncStep1','syncStep2','syncStep3','syncStep4','syncStep5']
    .forEach(id => setStep(id, 'pending'));

  // ══════════════════════════════════════════════════════════
  // Étape 0 — Récupérer le restaurant courant
  // ══════════════════════════════════════════════════════════
  const ctx = window.RestaurantCtx;
  const restoId = ctx?.currentId() || null;
  const restaurant = restoId ? (restoId === 'dax' ? 'dax' : 'mdm') : null;

  // ══════════════════════════════════════════════════════════
  // Étape 1 — Test de connexion via /api/zelty/proxy
  // ══════════════════════════════════════════════════════════
  setStep('syncStep1', 'spin');
  const connResult = await ZeltyAPI.testConnection(null, null, null, { restaurant });
  if (!connResult.success) {
    setStep('syncStep1', 'error');
    failSync(`Connexion Zelty échouée : ${connResult.message || connResult.error}`);
    return;
  }
  setStep('syncStep1', 'done');

  // ══════════════════════════════════════════════════════════
  // Étape 2 — Récupération commandes (pagination automatique)
  // Période : depuis le dernier CA Zelty enregistré ou -30 jours
  // ══════════════════════════════════════════════════════════
  setStep('syncStep2', 'spin');

  // Calculer la période : dernier CA zelty connu → aujourd'hui
  const today = todayStr();
  const zeltyRevenues = State.revenue.filter(r => r.source === 'zelty').sort((a,b) => b.date.localeCompare(a.date));
  const lastSyncDate  = zeltyRevenues[0]?.date;
  // Resynchroniser depuis la dernière date connue (incluse) ou 30 jours en arrière
  const dateStart = lastSyncDate || (() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  })();
  const dateEnd = today;

  const syncResult = await ZeltyAPI.fetchSales(null, null, null, { 
    date_start: dateStart, 
    date_end: dateEnd, 
    restaurant 
  });

  if (!syncResult.success) {
    setStep('syncStep2', 'error');
    failSync(`Récupération des commandes échouée : ${syncResult.message || syncResult.error}`);
    return;
  }
  setStep('syncStep2', 'done');

  const sales        = syncResult.sales        || [];
  const caHt         = syncResult.ca_ht        || 0;   // CA HT total — champ principal
  const nbOrders     = syncResult.nb_orders    || 0;
  const nbPages      = syncResult.nb_pages     || 1;
  const sessionId    = syncResult.session_id   || `zelty_${Date.now()}`;

  // ══════════════════════════════════════════════════════════
  // Étape 3 — Dédoublonnage et regroupement CA par jour Paris
  // ══════════════════════════════════════════════════════════
  setStep('syncStep3', 'spin');

  // Récupérer les zelty_order_id déjà en base pour éviter les doublons
  let existingOrderIds = new Set();
  try {
    const existing = await fetch('tables/sales?limit=5000&source=zelty').then(r => r.json());
    (existing.data || []).forEach(s => {
      if (s.zelty_order_id) existingOrderIds.add(s.zelty_order_id);
    });
  } catch { /* non bloquant */ }

  // Filtrer les ventes déjà importées
  const newSales = sales.filter(s => !existingOrderIds.has(s.zelty_order_id));

  // Regrouper le CA HT par jour (date_day = YYYY-MM-DD en heure Paris)
  const caByDay = {};
  const coversByDay = {};
  for (const s of newSales) {
    const day = s.date_day || s.date_paris?.slice(0,10) || today;
    caByDay[day]    = +(( caByDay[day]     || 0) + (s.total_amount || 0)).toFixed(2);
    coversByDay[day] = (coversByDay[day] || 0) + 1; // 1 article = 1 commande estimée
  }
  // Recompter les couverts en nb de commandes uniques par jour
  const ordersByDay = {};
  for (const s of newSales) {
    const day = s.date_day || today;
    if (!ordersByDay[day]) ordersByDay[day] = new Set();
    ordersByDay[day].add(s.zelty_order_id || s.zelty_session_id);
  }

  await new Promise(r => setTimeout(r, 300));
  setStep('syncStep3', 'done');

  // ══════════════════════════════════════════════════════════
  // Étape 4 — Insertion des ventes en base (sans doublons)
  // ══════════════════════════════════════════════════════════
  setStep('syncStep4', 'spin');

  let savedCount = 0;
  const restoBody = window.RestaurantCtx?.filterBody({}) || {};

  for (const sale of newSales) {
    try {
      await apiPost('sales', { ...sale, ...restoBody });
      savedCount++;
    } catch { /* on continue même si une insertion échoue */ }
  }
  setStep('syncStep4', 'done');

  // ══════════════════════════════════════════════════════════
  // Étape 5 — Mise à jour du CA quotidien (daily_revenue)
  //           Un enregistrement par jour, CA en HT
  //           Couverts = nb commandes uniques Zelty ce jour
  // ══════════════════════════════════════════════════════════
  setStep('syncStep5', 'spin');

  // Recharger les revenues existants pour savoir lesquels mettre à jour
  let currentRevenues = State.revenue;
  try {
    const rev = await fetch(`tables/daily_revenue?limit=500${restoId ? '&restaurant_id=' + restoId : ''}`).then(r => r.json());
    currentRevenues = rev.data || State.revenue;
  } catch { /* utiliser State.revenue en fallback */ }

  let caUpdatedDays = 0;
  for (const [day, dayCaHt] of Object.entries(caByDay)) {
    if (dayCaHt <= 0) continue;
    const nbCouverts = ordersByDay[day]?.size || 0;
    const existing   = currentRevenues.find(r => r.date === day && r.source === 'zelty');
    try {
      if (existing) {
        // Remplacer (pas additionner) : la synchro Zelty est la source de vérité
        await apiPut('daily_revenue', existing.id, {
          ...existing,
          revenue: dayCaHt,      // CA HT Zelty pour ce jour
          covers:  nbCouverts,
          source:  'zelty',
          notes:   `Sync Zelty — ${nbOrders} cmd — session ${sessionId}`
        });
      } else {
        await apiPost('daily_revenue', {
          ...restoBody,
          date:    day,
          revenue: dayCaHt,      // CA HT Zelty
          covers:  nbCouverts,
          source:  'zelty',
          notes:   `Sync Zelty — ${nbOrders} cmd — session ${sessionId}`
        });
      }
      caUpdatedDays++;
    } catch { /* non bloquant */ }
  }

  setStep('syncStep5', 'done');

  // ══════════════════════════════════════════════════════════
  // Résultat final
  // ══════════════════════════════════════════════════════════
  icon.className = 'fas fa-check-circle';
  const resultEl = document.getElementById('syncResult');
  resultEl.style.display = 'block';
  resultEl.className = 'sync-result success';
  resultEl.innerHTML = `
    <p><strong><i class="fas fa-check-circle"></i> Synchronisation réussie !</strong></p>
    <p style="margin-top:10px;font-size:13px;line-height:1.8;">
      📦 <strong>${nbOrders}</strong> commande(s) Zelty récupérée(s)
        sur <strong>${nbPages}</strong> page(s)<br>
      🧾 <strong>${savedCount}</strong> nouvelle(s) vente(s) enregistrée(s)<br>
      📅 <strong>${caUpdatedDays}</strong> jour(s) de CA mis à jour<br>
      💶 CA HT importé : <strong>${formatCurrency(caHt)}</strong>
         <span style="font-size:11px;color:#6B7280;">(hors taxes, commandes closed uniquement)</span>
    </p>
    <p style="margin-top:6px;font-size:11px;color:#6B7280;">
      Période : ${dateStart} → ${dateEnd} · Session : ${sessionId}
    </p>`;

  document.getElementById('syncModalFooter').style.display = 'flex';
  document.getElementById('syncModalClose').style.display = 'block';

  toast(`Zelty ✅ — ${nbOrders} cmd · ${formatCurrency(caHt)} HT · ${caUpdatedDays} jour(s) mis à jour`, 'zelty');

  // Rafraîchir la page courante
  if (State.currentPage === 'sales')     loadSales();
  if (State.currentPage === 'revenue')   loadRevenue();
  if (State.currentPage === 'dashboard') loadDashboard();
}

// ============================================================
// DELETE CONFIRMATION
// ============================================================
function confirmDelete(type, id, label) {
  document.getElementById('deleteModalText').textContent = `Supprimer "${label}" ?`;
  State.deleteCallback = async () => {
    try {
      const tableMap = { recipe: 'recipes', sale: 'sales', revenue: 'daily_revenue' };
      await apiDelete(tableMap[type], id);
      toast('Supprimé avec succès', 'success');
      closeModal('deleteModal');
      const loaders = { recipe: loadRecipes, sale: loadSales, revenue: loadRevenue };
      if (loaders[type]) await loaders[type]();
    } catch (e) {
      toast('Erreur lors de la suppression', 'error');
    }
  };
  openModal('deleteModal');
}

// ============================================================
// INIT
// ============================================================
async function initApp() {
  // Date display
  const now = new Date();
  document.getElementById('dateDisplay').textContent = now.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Sidebar toggle mobile
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.id = 'sidebarOverlay';
  overlay.onclick = closeSidebar;
  document.body.appendChild(overlay);

  document.getElementById('mobileMenuBtn').addEventListener('click', openSidebar);
  document.getElementById('sidebarToggle').addEventListener('click', closeSidebar);

  // Navigation
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(el.dataset.page);
    });
  });

  // Recipe events
  document.getElementById('addRecipeBtn').addEventListener('click', () => openRecipeModal());
  document.getElementById('saveRecipeBtn').addEventListener('click', saveRecipe);

  document.getElementById('recipeSearch').addEventListener('input', (e) => {
    State.recipeSearch = e.target.value;
    renderRecipes();
  });

  document.querySelectorAll('#recipeFilterTabs .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#recipeFilterTabs .filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.recipeFilter = btn.dataset.filter;
      renderRecipes();
    });
  });

  // Sale events
  document.getElementById('addSaleBtn').addEventListener('click', () => {
    populateRecipeSelect();
    openSaleModal();
  });
  document.getElementById('saveSaleBtn').addEventListener('click', saveSale);
  document.getElementById('syncSalesBtn').addEventListener('click', runZeltySync);
  document.getElementById('saleSearch').addEventListener('input', renderSales);
  document.getElementById('saleSourceFilter').addEventListener('change', renderSales);

  // Sale total auto-calculate
  document.getElementById('saleQty').addEventListener('input', updateSaleTotal);
  document.getElementById('saleUnitPrice').addEventListener('input', updateSaleTotal);

  // Auto-fill price from recipe
  document.getElementById('saleRecipe').addEventListener('change', (e) => {
    const opt = e.target.options[e.target.selectedIndex];
    const price = opt.dataset.price;
    if (price) {
      document.getElementById('saleUnitPrice').value = price;
      updateSaleTotal();
    }
  });

  // Revenue events
  document.getElementById('addRevenueBtn').addEventListener('click', () => openRevenueModal());
  document.getElementById('saveRevenueBtn').addEventListener('click', saveRevenue);

  // Settings events
  document.getElementById('verifyZeltyConnectionBtn').addEventListener('click', verifyZeltyConnection);
  document.getElementById('saveRestaurantBtn').addEventListener('click', saveRestaurantSettings);
  document.getElementById('saveSyncSettingsBtn').addEventListener('click', saveSyncSettings);
  document.getElementById('exportDataBtn').addEventListener('click', exportData);
  document.getElementById('clearDataBtn').addEventListener('click', () => {
    if (confirm('Réinitialiser les paramètres locaux ? (Les données API ne seront pas supprimées)')) {
      localStorage.removeItem('zm_restaurant');
      localStorage.removeItem('zm_sync');
      State.zeltyConnected = false;
      loadSettings();
      updateZeltyStatusBar();
      toast('Paramètres locaux réinitialisés', 'warning');
    }
  });

  // Sync buttons (topbar)
  document.getElementById('syncBtn').addEventListener('click', runZeltySync);

  // Delete confirm
  document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
    if (State.deleteCallback) State.deleteCallback();
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m.id));
    }
  });

  // Update Zelty status bar
  updateZeltyStatusBar();

  // Init V2/V3 modules
  if (window.Mercuriale) Mercuriale.init();
  if (window.Pareto) Pareto.init();
  // Rentabilite.init() supprimé en V4 — le module s'initialise via load()
  if (window.Factures) Factures.init();
  if (window.FacturesOCR) FacturesOCR.init();
  RecipeIngredientsManager.init();
  // Init onglets dashboard (Ce mois-ci / Aujourd'hui)
  if (window.DashboardTabs) DashboardTabs.init();

  // Expose toast globally for sub-modules
  window.toast = toast;

  // Init multi-restaurants V5
  if (window.RestaurantCtx) {
    await RestaurantCtx.init();
    // Recharger quand on change de restaurant
    RestaurantCtx.onSwitch(() => {
      const page = State.currentPage;
      if (page === 'dashboard') loadDashboard();
    });
  }

  // Load initial page
  loadDashboard();

  console.log('%c🍽️ MariaManager v1.0 — Pilotage de rentabilité', 'color:#C9A84C;font-size:16px;font-weight:bold;');
  console.log('%c✅ Multi-Restaurants · Flux automatisé · Zelty Ready', 'color:#1C2B2B;font-size:12px;');
}

// Expose openModal/closeModal globally for sub-modules
window.openModal = openModal;
window.closeModal = closeModal;

// ============================================================
// GESTION DES RESTAURANTS (page /restaurants)
// ============================================================
async function loadRestaurantsPage() {
  const skeleton = document.getElementById('restoSkeleton');
  const list     = document.getElementById('restoList');
  if (!skeleton || !list) return;

  skeleton.style.display = '';
  list.style.display = 'none';

  const res = await fetch('tables/restaurants?limit=100');
  if (!res.ok) { skeleton.style.display = 'none'; return; }
  const data = await res.json();
  const restos = data.data || [];

  skeleton.style.display = 'none';
  list.style.display = '';

  if (restos.length === 0) {
    list.innerHTML = '<div class="empty-state"><i class="fas fa-store"></i><p>Aucun restaurant</p></div>';
  } else {
    list.innerHTML = restos.map(r => `
      <div class="resto-card${!r.actif ? ' resto-card-inactive' : ''}">
        <div class="resto-card-left">
          <div class="resto-card-icon"><i class="fas fa-store"></i></div>
          <div>
            <div class="resto-card-name">${escHtml(r.nom)}</div>
            ${r.adresse ? `<div class="resto-card-addr">${escHtml(r.adresse)}</div>` : ''}
            <span class="badge badge-${r.actif !== false ? 'success' : 'warning'}">${r.actif !== false ? 'Actif' : 'Désactivé'}</span>
            ${window.RestaurantCtx?.currentId() === r.id ? '<span class="badge" style="background:var(--primary-light);color:var(--primary-dark); margin-left:4px;">Sélectionné</span>' : ''}
          </div>
        </div>
        <div class="resto-card-actions">
          <button class="btn btn-sm btn-primary" onclick="RestaurantCtx.select('${r.id}'); navigateTo('dashboard')">
            <i class="fas fa-arrow-right"></i> Sélectionner
          </button>
          <button class="btn btn-sm btn-secondary" onclick="openRestoModal('${r.id}','${escHtml(r.nom).replace(/'/g,"\\'")}','${escHtml(r.adresse||'')}')">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-ghost" onclick="toggleRestoActive('${r.id}',${!r.actif})" title="${r.actif !== false ? 'Désactiver' : 'Réactiver'}">
            <i class="fas fa-${r.actif !== false ? 'eye-slash' : 'eye'}"></i>
          </button>
        </div>
      </div>`).join('');
  }

  // Bouton ajouter
  document.getElementById('addRestoBtn').onclick = () => openRestoModal();
}

function openRestoModal(id = null, nom = '', adresse = '') {
  // Créer le modal dynamiquement s'il n'existe pas
  let modal = document.getElementById('restoModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'restoModal';
    modal.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h3 id="restoModalTitle">Nouveau restaurant</h3>
          <button class="modal-close" onclick="closeModal('restoModal')"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="restoModalId" />
          <div class="form-group">
            <label class="form-label">Nom du restaurant *</label>
            <input type="text" id="restoModalNom" class="form-control" placeholder="Ex: La Bella Italia — Lyon" />
          </div>
          <div class="form-group">
            <label class="form-label">Adresse</label>
            <input type="text" id="restoModalAdresse" class="form-control" placeholder="Optionnel..." />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('restoModal')">Annuler</button>
          <button class="btn btn-primary" id="saveRestoBtn"><i class="fas fa-save"></i> Enregistrer</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('restoModalId').value   = id || '';
  document.getElementById('restoModalNom').value  = nom;
  document.getElementById('restoModalAdresse').value = adresse;
  document.getElementById('restoModalTitle').textContent = id ? 'Modifier le restaurant' : 'Nouveau restaurant';
  document.getElementById('saveRestoBtn').onclick = saveResto;
  openModal('restoModal');
}

async function saveResto() {
  const id      = document.getElementById('restoModalId').value;
  const nom     = document.getElementById('restoModalNom').value.trim();
  const adresse = document.getElementById('restoModalAdresse').value.trim();
  if (!nom) { toast('Saisissez un nom', 'warning'); return; }

  const body = JSON.stringify({ nom, adresse, actif: true });
  const url  = id ? `tables/restaurants/${id}` : 'tables/restaurants';
  const method = id ? 'PUT' : 'POST';
  await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body });
  toast(id ? 'Restaurant mis à jour' : 'Restaurant créé', 'success');
  closeModal('restoModal');
  await RestaurantCtx.reload();
  await loadRestaurantsPage();
}

async function toggleRestoActive(id, actif) {
  await fetch(`tables/restaurants/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actif })
  });
  toast(actif ? 'Restaurant réactivé' : 'Restaurant désactivé', 'success');
  await RestaurantCtx.reload();
  await loadRestaurantsPage();
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// VUE GLOBALE (comparaison multi-restaurants)
// ============================================================
let _globalAnnee = new Date().getFullYear();
let _globalMois  = new Date().getMonth() + 1;

async function loadGlobalView() {
  updateGlobalMonthLabel();
  document.getElementById('globalPrevMonth').onclick = () => changeGlobalMonth(-1);
  document.getElementById('globalNextMonth').onclick = () => changeGlobalMonth(+1);
  await renderGlobalCompare();
}

function updateGlobalMonthLabel() {
  const lbl = document.getElementById('globalMonthLabel');
  if (lbl) lbl.textContent = new Date(_globalAnnee, _globalMois - 1, 1)
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

async function changeGlobalMonth(delta) {
  _globalMois += delta;
  if (_globalMois < 1)  { _globalMois = 12; _globalAnnee--; }
  if (_globalMois > 12) { _globalMois = 1;  _globalAnnee++; }
  updateGlobalMonthLabel();
  await renderGlobalCompare();
}

async function renderGlobalCompare() {
  const skeleton = document.getElementById('globalSkeleton');
  const table    = document.getElementById('globalCompareTable');
  if (!skeleton || !table) return;

  skeleton.style.display = '';
  table.style.display = 'none';

  const ctx = window.RestaurantCtx;
  const restos = ctx ? [...ctx.restaurants] : [];
  if (restos.length === 0) {
    skeleton.style.display = 'none';
    table.innerHTML = '<div class="empty-state"><i class="fas fa-store"></i><p>Aucun restaurant actif</p></div>';
    table.style.display = '';
    return;
  }

  const fmt2 = v => v == null ? '—' : new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(v);
  const fmtPct = v => v == null ? '—' : v.toFixed(1) + '\u00a0%';

  const dateDebut = `${_globalAnnee}-${String(_globalMois).padStart(2,'0')}-01`;
  const dateFin   = new Date(_globalAnnee, _globalMois, 0).toISOString().split('T')[0];

  // Charger données pour chaque restaurant en parallèle
  const datasets = await Promise.all(restos.map(async r => {
    const [rev, sales, charges] = await Promise.all([
      fetch(`tables/daily_revenue?limit=500&restaurant_id=${r.id}`).then(x=>x.ok?x.json():{data:[]}),
      fetch(`tables/sales?limit=1000&restaurant_id=${r.id}`).then(x=>x.ok?x.json():{data:[]}),
      fetch(`tables/charges_fixes?limit=200&restaurant_id=${r.id}`).then(x=>x.ok?x.json():{data:[]})
    ]);

    const ca = (rev.data||[]).filter(x=>{const d=(x.date||'').split('T')[0];return d>=dateDebut&&d<=dateFin;})
      .reduce((s,x)=>s+(x.revenue||0),0);
    const chargesMois = (charges.data||[]).filter(c=>parseInt(c.annee)===_globalAnnee&&parseInt(c.mois)===_globalMois&&!c.est_exceptionnel)
      .reduce((s,c)=>s+(c.montant||0),0);

    // Coût matière théo simplifié (ventes × recettes — sans prix mercuriale)
    const ventes = (sales.data||[]).filter(v=>{const d=(v.sale_date||v.date||'').split('T')[0];return d>=dateDebut&&d<=dateFin;});
    const caVentes = ventes.reduce((s,v)=>s+(v.total_amount||0),0);
    const caFinal = ca > 0 ? ca : caVentes;

    // Food cost théo depuis les recettes (30% par défaut si pas de données)
    const foodCostRatio = 0.30;
    const coutMatiere = caFinal * foodCostRatio;
    const margeBrute  = caFinal - coutMatiere;
    const resultat    = margeBrute - chargesMois;

    return { r, caFinal, coutMatiere, margeBrute, chargesMois, resultat };
  }));

  // Construire le tableau comparatif
  const rows = [
    { label: 'Chiffre d\'affaires', key: 'caFinal',      fmt: fmt2,   bold: false, highlight: false },
    { label: 'Coût matière*',       key: 'coutMatiere',  fmt: fmt2,   bold: false, highlight: false },
    { label: 'Marge brute',         key: 'margeBrute',   fmt: fmt2,   bold: false, highlight: true  },
    { label: 'Charges fixes',       key: 'chargesMois',  fmt: fmt2,   bold: false, highlight: false },
    { label: 'Résultat net',        key: 'resultat',     fmt: fmt2,   bold: true,  highlight: true  }
  ];

  const colHeaders = restos.map(r => `<th>${escHtml(r.nom)}</th>`).join('');
  const bodyRows = rows.map(row => {
    const cells = datasets.map(d => {
      const v = d[row.key];
      const colored = row.key === 'resultat' ? (v >= 0 ? 'renta-val-pos' : 'renta-val-neg') : '';
      const bold = row.bold ? 'renta-bold' : '';
      return `<td class="text-right ${colored} ${bold}">${row.fmt(v)}</td>`;
    }).join('');
    return `<tr class="${row.highlight ? 'renta-row-marge' : ''}"><td><strong>${row.label}</strong></td>${cells}</tr>`;
  }).join('');

  table.innerHTML = `
    <div class="global-note info-banner" style="margin-bottom:16px;">
      <i class="fas fa-info-circle"></i>
      <span>* Coût matière estimé à 30% du CA (théorique). Pour le coût réel, utilisez les inventaires par restaurant.</span>
    </div>
    <div class="table-wrapper">
      <table class="data-table renta-decomp-table">
        <thead><tr><th>Indicateur</th>${colHeaders}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;

  skeleton.style.display = 'none';
  table.style.display = '';
}

// Expose State globally for cross-module access
window.State = State;

/* ============================================================
   RECIPE INGREDIENTS MANAGER (V3)
   Liaison mercuriale → recettes : source unique de vérité prix
   ============================================================ */
const RecipeIngredientsManager = (() => {

  let currentRecipeId = null;
  let currentRecipeName = null;
  let currentRecipePrice = 0;
  let ingredients = [];      // ingrédients de la recette courante
  let allProducts = [];      // tous les produits mercuriale
  let allRecipes = [];       // toutes les recettes (pour sous-recettes)

  // ============================================================
  // OUVRIR LE MODAL INGRÉDIENTS
  // ============================================================
  async function openForRecipe(recipeId) {
    const recipe = State.recipes.find(r => r.id === recipeId);
    if (!recipe) return;

    currentRecipeId = recipeId;
    currentRecipeName = recipe.name;
    currentRecipePrice = recipe.price || 0;

    // Charger produits mercuriale + toutes recettes
    try {
      const [prodRes, ingRes, recRes] = await Promise.all([
        fetch('tables/supplier_products?limit=500').then(r => r.json()),
        fetch(`tables/recipe_ingredients?limit=1000`).then(r => r.json()),
        fetch('tables/recipes?limit=500').then(r => r.json())
      ]);
      allProducts = prodRes.data || [];
      allRecipes  = recRes.data  || [];
      const allIngredients = ingRes.data || [];
      ingredients = allIngredients.filter(i => i.recipe_id === recipeId);
    } catch (e) {
      allProducts = [];
      allRecipes  = [];
      ingredients = [];
    }

    document.getElementById('ingredientsRecipeName').textContent =
      `Recette : ${recipe.name} · Prix vente : ${formatCurrency(recipe.price)}`;
    document.getElementById('icsSellingPrice').textContent = formatCurrency(recipe.price);

    // Populate product select + sous-recettes
    populateProductSelect();
    populateSubRecipeSelect();
    renderIngredients();
    updateCostSummary();

    openModal('ingredientsModal');
  }

  function populateProductSelect() {
    const sel = document.getElementById('ingredientProductSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Choisir un produit --</option>' +
      allProducts.map(p =>
        `<option value="${p.id}" data-price="${p.current_price}" data-unit="${p.unit}">
          ${p.name} — ${formatCurrency(p.current_price)}/${p.unit}
        </option>`
      ).join('');
  }

  // Remplir le select sous-recettes (type=sous_recette, pas la recette elle-même)
  function populateSubRecipeSelect() {
    const sel = document.getElementById('subRecipeSelect');
    if (!sel) return;
    const subRecipes = allRecipes.filter(r =>
      r.type === 'sous_recette' && r.id !== currentRecipeId
    );
    sel.innerHTML = '<option value="">-- Sélectionner une sous-recette --</option>' +
      subRecipes.map(r => {
        const cost = r.cost || 0;
        return `<option value="${r.id}" data-cost="${cost}">${r.name} — coût : ${formatCurrency(cost)}/portion</option>`;
      }).join('');
    // Afficher/masquer la section selon disponibilité
    const form = document.getElementById('addSubRecipeForm');
    if (form) form.style.display = subRecipes.length ? '' : 'none';
  }

  function renderIngredients() {
    const container = document.getElementById('ingredientsList');
    if (!container) return;

    if (ingredients.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:20px;color:var(--text-muted);">
          <i class="fas fa-carrot" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px;"></i>
          <p>Aucun ingrédient lié. Ajoutez des produits ou sous-recettes ci-dessous.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <table class="data-table" style="margin-bottom:16px;">
        <thead><tr>
          <th>Ingrédient / Sous-recette</th><th>Qté</th><th>Unité</th><th>Prix unit.</th><th>Coût</th><th></th>
        </tr></thead>
        <tbody>
          ${ingredients.map(ing => {
            const isSR = ing.type_ingredient === 'sous_recette';
            return `
            <tr style="${isSR ? 'background:#FDF8FF;' : ''}">
              <td>
                ${isSR
                  ? `<span style="color:#7C3AED;"><i class="fas fa-layer-group"></i></span> <strong>${ing.product_name}</strong>
                     <br><span class="text-muted text-sm" style="font-size:10px;">Sous-recette — coût récursif</span>`
                  : `<strong>${ing.product_name}</strong>
                     <br><span class="text-muted text-sm" style="font-size:10px;"><i class="fas fa-link"></i> Mercuriale</span>`
                }
              </td>
              <td>${ing.quantity}</td>
              <td>${ing.unit || 'portion'}</td>
              <td>${formatCurrency(ing.unit_price)}</td>
              <td><strong style="color:var(--danger);">${formatCurrency(ing.cost)}</strong></td>
              <td>
                <button class="icon-btn danger" onclick="RecipeIngredientsManager.removeIngredient('${ing.id}')" title="Retirer">
                  <i class="fas fa-times"></i>
                </button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  function updateCostSummary() {
    const totalCost = ingredients.reduce((s, i) => s + (i.cost || 0), 0);
    const price = currentRecipePrice;
    const margin = price > 0 ? ((price - totalCost) / price * 100) : 0;
    const foodCost = price > 0 ? (totalCost / price * 100) : 0;

    document.getElementById('icsTotalCost').textContent = formatCurrency(totalCost);
    const marginEl = document.getElementById('icsMargin');
    marginEl.textContent = price > 0 ? Math.round(margin) + '%' : '—';
    marginEl.style.color = margin >= 60 ? 'var(--success)' : margin >= 40 ? 'var(--warning)' : 'var(--danger)';
    const fcEl = document.getElementById('icsFoodCost');
    fcEl.textContent = price > 0 ? Math.round(foodCost) + '%' : '—';
    fcEl.style.color = foodCost <= 30 ? 'var(--success)' : foodCost <= 35 ? 'var(--warning)' : 'var(--danger)';
  }

  // ============================================================
  // CALCUL COÛT INGRÉDIENT (conversion d'unités)
  // ============================================================
  function computeIngredientCost(productPrice, productUnit, qty, recipeUnit) {
    // Facteurs de conversion vers l'unité de base du fournisseur
    const toBase = { g: 0.001, kg: 1, ml: 0.001, cl: 0.01, l: 1, litre: 1, pièce: 1, portion: 1 };
    const fromBase = { kg: 1, litre: 1, pièce: 1 };

    const recipeUnitBase = toBase[recipeUnit] || 1;
    const productUnitBase = fromBase[productUnit] || 1;

    // Quantité en unité fournisseur
    const qtyInProductUnit = (qty * recipeUnitBase) / productUnitBase;
    return +(productPrice * qtyInProductUnit).toFixed(4);
  }

  // ============================================================
  // CALCUL COÛT RÉCURSIF (sous-recette)
  // Protéger contre les boucles avec un Set de visites
  // ============================================================
  function computeSubRecipeCost(subRecipeId, visited = new Set()) {
    if (visited.has(subRecipeId)) {
      throw new Error(`Boucle détectée dans les sous-recettes (id: ${subRecipeId})`);
    }
    visited.add(subRecipeId);
    // Chercher le coût précalculé dans allRecipes
    const sr = allRecipes.find(r => r.id === subRecipeId);
    return sr?.cost || 0;
  }

  // ============================================================
  // AJOUT INGRÉDIENT (produit mercuriale)
  // ============================================================
  async function addIngredient() {
    const productId = document.getElementById('ingredientProductSelect').value;
    const qty = parseFloat(document.getElementById('ingredientQty').value);
    const unit = document.getElementById('ingredientUnit').value;

    if (!productId) { toast('Sélectionnez un produit mercuriale', 'warning'); return; }
    if (!qty || qty <= 0) { toast('Saisissez une quantité valide', 'warning'); return; }

    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const cost = computeIngredientCost(product.current_price, product.unit, qty, unit);

    const data = {
      recipe_id:       currentRecipeId,
      recipe_name:     currentRecipeName,
      product_id:      productId,
      product_name:    product.name,
      quantity:        qty,
      unit,
      unit_price:      product.current_price,
      cost,
      type_ingredient: 'produit',
      sous_recette_id: ''
    };

    try {
      const res = await fetch('tables/recipe_ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const created = await res.json();
      ingredients.push(created);
      renderIngredients();
      updateCostSummary();

      // Reset form
      document.getElementById('ingredientProductSelect').value = '';
      document.getElementById('ingredientQty').value = '';
      document.getElementById('ingredientCostCalc').textContent = '—';
      document.getElementById('ingredientPricePreview').textContent = '—';

      toast(`Ingrédient ajouté : ${product.name}`, 'success');
    } catch { toast('Erreur ajout ingrédient', 'error'); }
  }

  // ============================================================
  // AJOUT SOUS-RECETTE
  // ============================================================
  async function addSubRecipe() {
    const subId = document.getElementById('subRecipeSelect').value;
    const qty   = parseFloat(document.getElementById('subRecipeQty').value) || 1;

    if (!subId) { toast('Sélectionnez une sous-recette', 'warning'); return; }

    // Vérification anti-boucle : la sous-recette ne doit pas déjà référencer la recette courante
    try {
      const subCost = computeSubRecipeCost(subId, new Set([currentRecipeId]));
      const lineCost = +(subCost * qty).toFixed(4);
      const subRecipe = allRecipes.find(r => r.id === subId);

      const data = {
        recipe_id:       currentRecipeId,
        recipe_name:     currentRecipeName,
        product_id:      '',
        product_name:    subRecipe?.name || 'Sous-recette',
        quantity:        qty,
        unit:            'portion',
        unit_price:      subRecipe?.cost || 0,
        cost:            lineCost,
        type_ingredient: 'sous_recette',
        sous_recette_id: subId
      };

      const res = await fetch('tables/recipe_ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const created = await res.json();
      ingredients.push(created);
      renderIngredients();
      updateCostSummary();

      document.getElementById('subRecipeSelect').value = '';
      document.getElementById('subRecipeQty').value = '1';

      toast(`Sous-recette ajoutée : ${subRecipe?.name}`, 'success');
    } catch (e) {
      toast(`⚠️ ${e.message}`, 'error');
    }
  }

  async function removeIngredient(id) {
    try {
      await fetch(`tables/recipe_ingredients/${id}`, { method: 'DELETE' });
      ingredients = ingredients.filter(i => i.id !== id);
      renderIngredients();
      updateCostSummary();
      toast('Ingrédient retiré', 'success');
    } catch { toast('Erreur suppression', 'error'); }
  }

  // ============================================================
  // SAUVEGARDER → mettre à jour le coût de la recette
  // ============================================================
  async function saveAndUpdateRecipeCost() {
    const totalCost = ingredients.reduce((s, i) => s + (i.cost || 0), 0);
    if (!currentRecipeId) return;

    try {
      const recipe = State.recipes.find(r => r.id === currentRecipeId);
      if (recipe) {
        await apiPut('recipes', currentRecipeId, { ...recipe, cost: +totalCost.toFixed(2) });
        // Update local state
        const idx = State.recipes.findIndex(r => r.id === currentRecipeId);
        if (idx !== -1) State.recipes[idx].cost = +totalCost.toFixed(2);
        toast(`Food cost mis à jour : ${formatCurrency(totalCost)}`, 'success');
        closeModal('ingredientsModal');
        if (State.currentPage === 'recipes') renderRecipes();
      }
    } catch { toast('Erreur mise à jour recette', 'error'); }
  }

  // ============================================================
  // MISE À JOUR AUTOMATIQUE DE TOUTES LES RECETTES
  // (appelé après import facture si prix change)
  // ============================================================
  async function refreshAllRecipeCosts() {
    try {
      const [prodRes, ingRes, recipesRes] = await Promise.all([
        fetch('tables/supplier_products?limit=500').then(r => r.json()),
        fetch('tables/recipe_ingredients?limit=1000').then(r => r.json()),
        fetch('tables/recipes?limit=500').then(r => r.json())
      ]);

      const products = prodRes.data || [];
      const allIngredients = ingRes.data || [];
      const recipes = recipesRes.data || [];

      // Map prix par product_id
      const priceMap = {};
      products.forEach(p => { priceMap[p.id] = p.current_price; });

      // Pour chaque recette, recalculer le coût depuis les ingrédients
      let updatedCount = 0;
      for (const recipe of recipes) {
        const recipeIngredients = allIngredients.filter(i => i.recipe_id === recipe.id);
        if (recipeIngredients.length === 0) continue;

        let newCost = 0;
        for (const ing of recipeIngredients) {
          if (ing.type_ingredient === 'sous_recette' && ing.sous_recette_id) {
            // Coût d'une sous-recette : cost de la sous-recette * quantity
            const subR = recipes.find(r => r.id === ing.sous_recette_id);
            const subCost = subR?.cost || 0;
            const lineCost = +(subCost * ing.quantity).toFixed(4);
            newCost += lineCost;
            if (Math.abs(lineCost - (ing.cost || 0)) > 0.001) {
              await fetch(`tables/recipe_ingredients/${ing.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...ing, unit_price: subCost, cost: lineCost })
              });
            }
          } else {
            const currentPrice = priceMap[ing.product_id] || ing.unit_price;
            const newIngCost = computeIngredientCost(currentPrice, products.find(p => p.id === ing.product_id)?.unit || ing.unit, ing.quantity, ing.unit);
            newCost += newIngCost;
            if (currentPrice !== ing.unit_price) {
              await fetch(`tables/recipe_ingredients/${ing.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...ing, unit_price: currentPrice, cost: +newIngCost.toFixed(4) })
              });
            }
          }
        }

        // Update recette
        if (Math.abs(newCost - (recipe.cost || 0)) > 0.01) {
          await apiPut('recipes', recipe.id, { ...recipe, cost: +newCost.toFixed(2) });
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        toast(`🔄 ${updatedCount} recette(s) mise(s) à jour automatiquement`, 'zelty');
        if (State.currentPage === 'recipes') await loadRecipes();
      }
    } catch (e) {
      console.error('refreshAllRecipeCosts error:', e);
    }
  }

  function computeIngredientCost(productPrice, productUnit, qty, recipeUnit) {
    const toBase = { g: 0.001, kg: 1, ml: 0.001, cl: 0.01, l: 1, litre: 1, pièce: 1, portion: 1 };
    const fromBase = { kg: 1, litre: 1, pièce: 1 };
    const recipeUnitBase = toBase[recipeUnit] || 1;
    const productUnitBase = fromBase[productUnit] || 1;
    const qtyInProductUnit = (qty * recipeUnitBase) / productUnitBase;
    return +(productPrice * qtyInProductUnit).toFixed(4);
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    document.getElementById('addIngredientConfirmBtn')?.addEventListener('click', addIngredient);
    document.getElementById('saveIngredientsBtn')?.addEventListener('click', saveAndUpdateRecipeCost);

    // Bouton sous-recette
    document.getElementById('addSubRecipeBtn')?.addEventListener('click', addSubRecipe);

    // Preview coût sous-recette à la sélection
    document.getElementById('subRecipeSelect')?.addEventListener('change', e => {
      const opt = e.target.options[e.target.selectedIndex];
      const cost = parseFloat(opt.dataset.cost) || 0;
      const qty  = parseFloat(document.getElementById('subRecipeQty')?.value) || 1;
      const preview = document.getElementById('subRecipeCostPreview');
      const calcEl  = document.getElementById('subRecipeCostCalc');
      if (preview && calcEl && opt.value) {
        calcEl.textContent = formatCurrency(cost * qty);
        preview.style.display = '';
      } else if (preview) {
        preview.style.display = 'none';
      }
    });
    document.getElementById('subRecipeQty')?.addEventListener('input', () => {
      const sel  = document.getElementById('subRecipeSelect');
      const opt  = sel?.options[sel.selectedIndex];
      const cost = parseFloat(opt?.dataset?.cost) || 0;
      const qty  = parseFloat(document.getElementById('subRecipeQty').value) || 1;
      const calcEl = document.getElementById('subRecipeCostCalc');
      if (calcEl && opt?.value) calcEl.textContent = formatCurrency(cost * qty);
    });

    // Preview prix + coût à la sélection produit
    document.getElementById('ingredientProductSelect')?.addEventListener('change', e => {
      const opt = e.target.options[e.target.selectedIndex];
      const price = parseFloat(opt.dataset.price);
      const unit = opt.dataset.unit;
      const preview = document.getElementById('ingredientPricePreview');
      if (preview && price) {
        preview.innerHTML = `<span style="font-size:16px;font-weight:700;color:var(--primary);">${formatCurrency(price)}</span><span style="color:var(--text-muted);"> / ${unit}</span>`;
      }
      updateCostPreview();
    });

    document.getElementById('ingredientQty')?.addEventListener('input', updateCostPreview);
    document.getElementById('ingredientUnit')?.addEventListener('change', updateCostPreview);
  }

  function updateCostPreview() {
    const sel = document.getElementById('ingredientProductSelect');
    const opt = sel?.options[sel?.selectedIndex];
    const price = parseFloat(opt?.dataset?.price);
    const productUnit = opt?.dataset?.unit;
    const qty = parseFloat(document.getElementById('ingredientQty')?.value);
    const unit = document.getElementById('ingredientUnit')?.value;
    const calc = document.getElementById('ingredientCostCalc');

    if (price && qty && unit && calc) {
      const cost = computeIngredientCost(price, productUnit, qty, unit);
      calc.textContent = formatCurrency(cost);
      calc.style.color = 'var(--danger)';
    }
  }

  return { openForRecipe, removeIngredient, saveAndUpdateRecipeCost, refreshAllRecipeCosts, init };

})();

// Expose globally
window.RecipeIngredientsManager = RecipeIngredientsManager;

// Start app
document.addEventListener('DOMContentLoaded', initApp);
