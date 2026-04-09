'use strict';
/**
 * RestauManager V5 — Module Multi-Restaurants
 * ─────────────────────────────────────────────
 * Gestionnaire central du contexte restaurant actif.
 * Ce module doit être chargé EN PREMIER (avant app.js).
 *
 * API publique exposée via window.RestaurantCtx :
 *   .currentId()        → id du restaurant actif (string|null)
 *   .current()          → objet restaurant actif
 *   .isGlobal()         → true si vue "tous les restaurants"
 *   .filterQS(base)     → ajoute &restaurant_id=xxx à une query string
 *   .filterBody(obj)    → ajoute restaurant_id dans un body POST/PUT
 *   .onSwitch(fn)       → s'abonner aux changements de restaurant
 *   .restaurants        → liste complète chargée
 */

window.RestaurantCtx = (() => {

  const STORAGE_KEY = 'rm_restaurant_id';
  const GLOBAL_ID   = '__global__';

  let _restaurants  = [];   // tous les restaurants actifs
  let _currentId    = null; // id sélectionné (null = pas encore choisi)
  let _callbacks    = [];   // listeners onSwitch

  // ─── Helpers API ─────────────────────────────────────────────
 async function apiFetch(path, opts = {}) {
    try {
      const base = window.API_BASE || 'https://maria-manager.vercel.app/api/tables';
      const url = path.startsWith('http') ? path : `${base}/${path.replace('tables/', '')}`;
      const r = await fetch(url, opts);
      if (!r.ok) return null;
      if (opts.method === 'DELETE') return true;
      return r.json();
    } catch { return null; }
  }

  // ─── Initialisation ──────────────────────────────────────────
  async function init() {
    await loadRestaurants();

    // Si aucun restaurant en base → créer les 2 par défaut
    if (_restaurants.length === 0) {
      await apiFetch('tables/restaurants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom: 'Restaurant A', adresse: '', actif: true })
      });
      await apiFetch('tables/restaurants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom: 'Restaurant B', adresse: '', actif: true })
      });
      await loadRestaurants();
    }

    // Restaurer le dernier choix depuis localStorage
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === GLOBAL_ID) {
      _currentId = GLOBAL_ID;
    } else if (saved && _restaurants.find(r => r.id === saved)) {
      _currentId = saved;
    } else if (_restaurants.length > 0) {
      // Premier lancement : forcer l'écran de choix (pas de présélection)
      _currentId = null;
    }

    renderSelector();
    updateSidebarLabel();
    return _currentId;
  }

  async function loadRestaurants() {
    const res = await apiFetch('tables/restaurants?limit=100');
    _restaurants = (res?.data || []).filter(r => r.actif !== false);
    _restaurants.sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
  }

  // ─── Sélecteur topbar ─────────────────────────────────────────
  function renderSelector() {
    const wrap = document.getElementById('restaurantSelectorWrap');
    if (!wrap) return;

    const current = _currentId === GLOBAL_ID
      ? { nom: '🌐 Vue globale', id: GLOBAL_ID }
      : _restaurants.find(r => r.id === _currentId);

    const label = current ? current.nom : 'Choisir un restaurant';

    wrap.innerHTML = `
      <div class="rs-selector" id="rsSelectorBtn" role="button" tabindex="0" aria-haspopup="true">
        <i class="fas fa-store rs-icon"></i>
        <span class="rs-label" id="rsCurrentLabel">${escH(label)}</span>
        <i class="fas fa-chevron-down rs-caret" id="rsCaret"></i>
      </div>
      <div class="rs-dropdown" id="rsDropdown" style="display:none;">
        ${_restaurants.map(r => `
          <div class="rs-item${r.id === _currentId ? ' rs-item-active' : ''}"
               onclick="RestaurantCtx.select('${r.id}')">
            <i class="fas fa-store"></i>
            <span>${escH(r.nom)}</span>
            ${r.id === _currentId ? '<i class="fas fa-check rs-check"></i>' : ''}
          </div>`).join('')}
        <div class="rs-item${_currentId === GLOBAL_ID ? ' rs-item-active' : ''}"
             onclick="RestaurantCtx.select('${GLOBAL_ID}')">
          <i class="fas fa-chart-line"></i>
          <span>Vue globale — Tous les restaurants</span>
          ${_currentId === GLOBAL_ID ? '<i class="fas fa-check rs-check"></i>' : ''}
        </div>
        <div class="rs-divider"></div>
        <div class="rs-item rs-item-manage" onclick="RestaurantCtx.goManage()">
          <i class="fas fa-cog"></i>
          <span>Gérer mes restaurants</span>
        </div>
      </div>`;

    const btn = document.getElementById('rsSelectorBtn');
    btn?.addEventListener('click', toggleDropdown);
    btn?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggleDropdown(); });

    // Fermer si clic ailleurs
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) closeDropdown();
    }, { capture: true });
  }

  function toggleDropdown() {
    const dd = document.getElementById('rsDropdown');
    const caret = document.getElementById('rsCaret');
    if (!dd) return;
    const open = dd.style.display !== 'none';
    dd.style.display = open ? 'none' : '';
    if (caret) caret.style.transform = open ? '' : 'rotate(180deg)';
  }

  function closeDropdown() {
    const dd = document.getElementById('rsDropdown');
    const caret = document.getElementById('rsCaret');
    if (dd) dd.style.display = 'none';
    if (caret) caret.style.transform = '';
  }

  function updateSidebarLabel() {
    const el = document.getElementById('sidebarRestaurantName');
    if (!el) return;
    const current = _currentId === GLOBAL_ID
      ? 'Vue globale'
      : (_restaurants.find(r => r.id === _currentId)?.nom || '—');
    el.textContent = current;
  }

  // ─── Sélection d'un restaurant ────────────────────────────────
  function select(id) {
    closeDropdown();

    if (id === GLOBAL_ID) {
      _currentId = GLOBAL_ID;
      localStorage.setItem(STORAGE_KEY, GLOBAL_ID);
      renderSelector();
      updateSidebarLabel();
      showGlobalView();
      return;
    }

    const resto = _restaurants.find(r => r.id === id);
    if (!resto) return;

    const changed = _currentId !== id;
    _currentId = id;
    localStorage.setItem(STORAGE_KEY, id);
    renderSelector();
    updateSidebarLabel();

    // Masquer l'écran de bienvenue si visible
    const welcome = document.getElementById('page-welcome');
    if (welcome) welcome.style.display = 'none';

    if (changed) {
      // Notifier tous les abonnés et recharger la page active
      _callbacks.forEach(fn => { try { fn(id, resto); } catch(e) {} });
      if (window.navigateTo) navigateTo(window.State?.currentPage || 'dashboard');
    }
  }

  function showGlobalView() {
    if (window.navigateTo) navigateTo('global');
  }

  function goManage() {
    closeDropdown();
    if (window.navigateTo) navigateTo('restaurants');
  }

  // ─── Page de bienvenue (premier lancement) ────────────────────
  function showWelcomeIfNeeded() {
    if (_currentId) return false;
    const welcome = document.getElementById('page-welcome');
    if (welcome) {
      // Cacher toutes les pages normales
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      // Injecter les boutons restaurants
      const btnsWrap = document.getElementById('welcomeRestoBtns');
      if (btnsWrap) {
        btnsWrap.innerHTML = _restaurants.map(r => `
          <button class="welcome-resto-btn" onclick="RestaurantCtx.select('${r.id}')">
            <i class="fas fa-store"></i>
            <span>${escH(r.nom)}</span>
          </button>`).join('');
      }
      welcome.style.display = '';
    }
    return true;
  }

  // ─── API de filtrage (utilisée par tous les modules) ──────────
  /**
   * filterQS('limit=100') → 'limit=100&restaurant_id=abc'
   * Si vue globale ou pas de restaurant, retourne la QS inchangée.
   */
  function filterQS(qs) {
    if (!_currentId || _currentId === GLOBAL_ID) return qs;
    const sep = qs ? '&' : '';
    return `${qs}${sep}restaurant_id=${encodeURIComponent(_currentId)}`;
  }

  /**
   * filterBody({ ... }) → { ..., restaurant_id: 'abc' }
   * N'ajoute rien si vue globale.
   */
  function filterBody(obj) {
    if (!_currentId || _currentId === GLOBAL_ID) return obj;
    return { ...obj, restaurant_id: _currentId };
  }

  /**
   * Valider que le restaurant_id est actif avant d'afficher.
   * Retourne true si on peut continuer, false si bloqué.
   */
  function guardDisplay(moduleName) {
    if (_currentId && _currentId !== GLOBAL_ID) return true;
    if (window.toast) toast(`Sélectionnez un restaurant pour accéder à ${moduleName}`, 'warning');
    return false;
  }

  // ─── CRUD restaurants ─────────────────────────────────────────
  async function saveRestaurant(data, id = null) {
    if (id) {
      return apiFetch(`tables/restaurants/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    }
    return apiFetch('tables/restaurants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }

  async function toggleActive(id, actif) {
    return apiFetch(`tables/restaurants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actif })
    });
  }

  async function reload() {
    await loadRestaurants();
    renderSelector();
    updateSidebarLabel();
  }

  // ─── Utilitaires ─────────────────────────────────────────────
  function escH(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── API publique ─────────────────────────────────────────────
  return {
    init,
    reload,
    select,
    goManage,
    showWelcomeIfNeeded,
    saveRestaurant,
    toggleActive,
    filterQS,
    filterBody,
    guardDisplay,
    onSwitch: (fn) => _callbacks.push(fn),
    currentId: () => _currentId,
    current: () => _currentId === GLOBAL_ID ? null : _restaurants.find(r => r.id === _currentId),
    isGlobal: () => _currentId === GLOBAL_ID,
    get restaurants() { return _restaurants; },
    GLOBAL_ID
  };

})();
