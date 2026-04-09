'use strict';
/**
 * RestauManager V4 — Module Rentabilité Réelle
 * ─────────────────────────────────────────────
 * Calcule la rentabilité à partir des données RÉELLES :
 *   CA          → tables daily_revenue + sales
 *   Coût réel   → inventaires (stock_début + achats_factures − stock_fin)
 *   Coût théo   → ventes × recettes × prix mercuriale
 *   Charges     → table charges_fixes (nouveau, par mois/année)
 *
 * Ne modifie aucun autre module.
 */

window.Rentabilite = (() => {

  // ─── État interne ────────────────────────────────────────────
  const S = {
    annee: new Date().getFullYear(),
    mois: new Date().getMonth() + 1,   // 1–12
    chargesAnnee: new Date().getFullYear(),
    chargesMois: new Date().getMonth() + 1,

    // Données chargées
    charges: [],          // charges_fixes du mois courant
    revenueData: [],      // daily_revenue (tous)
    salesData: [],        // sales (tous)
    recipesData: [],      // recipes (tous)
    inventaires: [],      // inventaires validés
    lignesInv: {},        // { id: [lignes] }
    factureLignes: [],    // invoice_lines
    mercProduits: [],     // supplier_products

    // Résultats calculés
    calc: null,

    // Chart
    histoChart: null
  };

  // ─── Constantes catégories ────────────────────────────────────
  const CAT_LABELS = {
    loyer:       '🏠 Loyer',
    salaires:    '👥 Salaires',
    electricite: '⚡ Électricité',
    assurance:   '🛡️ Assurance',
    abonnement:  '📦 Abonnement',
    autre:       '📋 Autre'
  };
  const CAT_ORDER = ['loyer', 'salaires', 'electricite', 'assurance', 'abonnement', 'autre'];

  // ─── Helpers ────────────────────────────────────────────────
  const fmt2 = v => v == null || isNaN(v) || !isFinite(v)
    ? '—'
    : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v);

  const fmtPct = v => (typeof v === 'number' && isFinite(v))
    ? v.toFixed(1).replace('.', ',') + '\u00a0%'
    : '—';

  const fmtMonthLabel = (a, m) => {
    return new Date(a, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  };

  function el(id) { return document.getElementById(id); }

  function toast(msg, type = 'success') {
    if (window.toast) window.toast(msg, type);
  }

  // ─── API ─────────────────────────────────────────────────────
  // Helper : query string avec restaurant_id courant
  function rQS(base = 'limit=500') {
    const ctx = window.RestaurantCtx;
    if (!ctx || !ctx.currentId() || ctx.isGlobal()) return base;
    return `${base}&restaurant_id=${encodeURIComponent(ctx.currentId())}`;
  }

  async function apiGet(table, qs = 'limit=500') {
    try {
      const r = await fetch(`tables/${table}?${qs}`);
      if (!r.ok) return { data: [] };
      return r.json();
    } catch { return { data: [] }; }
  }

  async function apiPost(table, body) {
    const r = await fetch(`tables/${table}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.json();
  }

  async function apiPut(table, id, body) {
    const r = await fetch(`tables/${table}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.json();
  }

  async function apiDelete(table, id) {
    await fetch(`tables/${table}/${id}`, { method: 'DELETE' });
  }

  // ─── Sous-pages ──────────────────────────────────────────────
  function showMain() {
    el('rentaSubMain').style.display = '';
    el('rentaSubCharges').style.display = 'none';
  }

  function showCharges() {
    el('rentaSubMain').style.display = 'none';
    el('rentaSubCharges').style.display = '';
    S.chargesAnnee = S.annee;
    S.chargesMois = S.mois;
    updateChargesMonthLabel();
    loadChargesSubPage();
  }

  // ─── CHARGEMENT PRINCIPAL ─────────────────────────────────────
  async function load() {
    // Garde multi-restaurants
    if (window.RestaurantCtx && !window.RestaurantCtx.guardDisplay('Rentabilité')) return;
    showMain();
    showVerdictSkeleton(true);
    initMonthBar();
    await loadAllData();
    compute();
    render();
    bindMainEvents();
  }

  async function loadAllData() {
    const [chRes, revRes, saleRes, recRes, invRes, ligRes, factRes, mercRes] = await Promise.all([
      apiGet('charges_fixes',     rQS('limit=500')),
      apiGet('daily_revenue',     rQS('limit=1000')),
      apiGet('sales',             rQS('limit=2000')),
      apiGet('recipes',           'limit=500'),      // partagé entre restaurants
      apiGet('inventaires',       rQS('limit=200')),
      apiGet('lignes_inventaire', 'limit=2000'),
      apiGet('invoice_lines',     rQS('limit=2000')),
      apiGet('supplier_products', 'limit=500')       // partagé
    ]);

    S.charges      = chRes.data || [];
    S.revenueData  = revRes.data || [];
    S.salesData    = saleRes.data || [];
    S.recipesData  = recRes.data || [];
    S.inventaires  = (invRes.data || []).filter(i => i.statut === 'validé')
      .sort((a, b) => (a.date_inventaire || '').localeCompare(b.date_inventaire || ''));
    S.factureLignes = factRes.data || [];
    S.mercProduits  = mercRes.data || [];

    S.lignesInv = {};
    (ligRes.data || []).forEach(l => {
      if (!S.lignesInv[l.inventaire_id]) S.lignesInv[l.inventaire_id] = [];
      S.lignesInv[l.inventaire_id].push(l);
    });
  }

  // ─── MOTEUR DE CALCUL ─────────────────────────────────────────
  function compute() {
    const annee = S.annee;
    const mois  = S.mois;

    // Période : 1er du mois → dernier jour du mois
    const dateDebut = `${annee}-${String(mois).padStart(2,'0')}-01`;
    const dateFin   = lastDayOf(annee, mois);
    const isCurrentMonth = annee === new Date().getFullYear() && mois === (new Date().getMonth() + 1);

    // ── 1. CA du mois ──────────────────────────────────────────
    const caEntries = S.revenueData.filter(r => {
      const d = (r.date || '').split('T')[0];
      return d >= dateDebut && d <= dateFin;
    });
    const ca = caEntries.reduce((s, r) => s + (r.revenue || 0), 0);
    const caHasData = caEntries.length > 0;

    // CA depuis ventes si pas de daily_revenue
    const ventesperiode = S.salesData.filter(v => {
      const d = (v.sale_date || v.date || '').split('T')[0];
      return d >= dateDebut && d <= dateFin;
    });
    const caVentes = ventesperiode.reduce((s, v) => s + (v.total_amount || v.total_price || v.price || 0), 0);
    const caFinal = caHasData ? ca : caVentes;

    // ── 2. Charges fixes du mois (hors exceptionnelles) ────────
    const chargesMois = S.charges.filter(c => {
      const cA = c.annee != null ? parseInt(c.annee) : null;
      const cM = c.mois != null ? parseInt(c.mois) : null;
      return cA === annee && cM === mois;
    });
    const chargesFixesCourantes = chargesMois
      .filter(c => !c.est_exceptionnel)
      .reduce((s, c) => s + (c.montant || 0), 0);
    const chargesFixesTotales = chargesMois
      .reduce((s, c) => s + (c.montant || 0), 0);

    // ── 3. Coût matière réel (depuis inventaires) ──────────────
    const invResult = getCoutMatièreReel(dateDebut, dateFin);
    const { coutReel, hasInventaire, invStart, invEnd } = invResult;

    // ── 4. Coût matière théorique (recettes × ventes × prix) ───
    const coutTheorique = getCoutMatiereTheorique(ventesperiode);

    // ── 5. Calculs financiers ──────────────────────────────────
    const margeReelle  = caFinal - (hasInventaire ? coutReel : null);
    const margeTheo    = caFinal - coutTheorique;

    const margeReellePct  = caFinal > 0 && hasInventaire ? (margeReelle  / caFinal * 100) : null;
    const margeTheoPct    = caFinal > 0 && coutTheorique > 0 ? (margeTheo / caFinal * 100) : null;

    const ecartMatiere = hasInventaire && coutTheorique > 0 ? coutReel - coutTheorique : null;

    const resultatReel = hasInventaire
      ? margeReelle - chargesFixesCourantes
      : null;
    const resultatTheo = coutTheorique > 0
      ? margeTheo - chargesFixesCourantes
      : null;

    // Point mort : Charges / taux de marge réelle
    const tauxMarge = margeReellePct != null ? margeReellePct / 100 : (margeTheoPct ? margeTheoPct / 100 : 0);
    const pointMort = tauxMarge > 0 ? chargesFixesCourantes / tauxMarge : null;
    const progressPct = pointMort > 0 ? Math.min((caFinal / pointMort) * 100, 200) : 0;

    // Projection fin de mois (uniquement si mois en cours)
    let projection = null;
    if (isCurrentMonth && caFinal > 0) {
      const jourActuel = new Date().getDate();
      const nbJours    = daysInMonth(annee, mois);
      const caParJour  = caEntries.length > 0 ? caFinal / jourActuel : caFinal / jourActuel;
      const caProj     = caParJour * nbJours;
      const margeProj  = tauxMarge > 0 ? caProj * tauxMarge : caProj * (margeTheoPct ? margeTheoPct / 100 : 0.7);
      const resultatProj = margeProj - chargesFixesCourantes;
      projection = { caProj, resultatProj, jourActuel, nbJours, caParJour };
    }

    S.calc = {
      annee, mois, dateDebut, dateFin, isCurrentMonth,
      caFinal, caHasData,
      chargesFixesCourantes, chargesFixesTotales, chargesMois,
      coutReel, coutTheorique, hasInventaire, invStart, invEnd,
      margeReelle, margeTheo, margeReellePct, margeTheoPct,
      ecartMatiere,
      resultatReel, resultatTheo,
      pointMort, progressPct,
      projection,
      ventesperiode
    };
  }

  function getCoutMatièreReel(dateDebut, dateFin) {
    // Trouver 2 inventaires validés encadrant la période
    const valides = S.inventaires;
    if (valides.length < 2) return { coutReel: 0, hasInventaire: false };

    // Chercher l'inventaire le plus proche avant dateDebut (inclus)
    const candidatesStart = valides.filter(i => (i.date_inventaire || '').split('T')[0] <= dateDebut);
    const invStart = candidatesStart[candidatesStart.length - 1] || null;

    // Chercher l'inventaire le plus proche après dateFin (inclus)
    const candidatesEnd = valides.filter(i => (i.date_inventaire || '').split('T')[0] >= dateFin);
    const invEnd = candidatesEnd[0] || null;

    // Fallback : si pas exact, chercher les deux qui encadrent le mieux
    if (!invStart || !invEnd || invStart.id === invEnd.id) {
      // Prendre les deux derniers inventaires validés disponibles
      if (valides.length < 2) return { coutReel: 0, hasInventaire: false };
      const fallStart = valides[valides.length - 2];
      const fallEnd   = valides[valides.length - 1];
      return computeCoutReel(fallStart, fallEnd, dateDebut, dateFin);
    }

    return computeCoutReel(invStart, invEnd, dateDebut, dateFin);
  }

  function computeCoutReel(invStart, invEnd, dateDebut, dateFin) {
    const lignesS = S.lignesInv[invStart.id] || [];
    const lignesE = S.lignesInv[invEnd.id]   || [];

    // Stock début & fin par ingrédient (valorisé)
    const valorise = (lignes) =>
      lignes.reduce((s, l) => s + ((l.quantite || 0) * (l.prix_unitaire || 0)), 0);

    const stockDebut = valorise(lignesS);
    const stockFin   = valorise(lignesE);

    // Achats de la période (factures entre les deux inventaires)
    const d1 = (invStart.date_inventaire || '').split('T')[0];
    const d2 = (invEnd.date_inventaire   || '').split('T')[0];
    const achats = S.factureLignes
      .filter(l => {
        const d = (l.invoice_date || l.date || '').split('T')[0];
        return d > d1 && d <= d2;
      })
      .reduce((s, l) => {
        const prix = l.unit_price || l.prix_unitaire || 0;
        const qte  = l.quantity   || l.quantite      || 0;
        return s + prix * qte;
      }, 0);

    const coutReel = stockDebut + achats - stockFin;
    return {
      coutReel: Math.max(0, coutReel),
      hasInventaire: true,
      invStart,
      invEnd,
      stockDebut,
      stockFin,
      achats
    };
  }

  function getCoutMatiereTheorique(ventesperiode) {
    if (!ventesperiode.length || !S.recipesData.length) return 0;

    // Map recetteId → portions vendues
    const portions = {};
    ventesperiode.forEach(v => {
      const rId = v.recipe_id || v.product_id || '';
      if (rId) portions[rId] = (portions[rId] || 0) + (v.quantity || 1);
    });

    // Map mercuriale : id → prix unitaire
    const mercPrix = {};
    S.mercProduits.forEach(p => {
      mercPrix[p.id] = p.current_price || p.prix_unitaire || p.price_per_unit || 0;
    });

    let total = 0;
    S.recipesData.forEach(r => {
      const n = portions[r.id] || 0;
      if (n === 0) return;

      // Ingrédients depuis le champ JSON
      const ings = Array.isArray(r.ingredients) ? r.ingredients : [];
      if (ings.length > 0) {
        const coutPortion = ings.reduce((s, ing) => {
          const prix = mercPrix[ing.product_id || ing.ingredient_id || '']
            || ing.prix_unitaire || ing.price || 0;
          const qte = ing.quantite || ing.quantity || 0;
          return s + prix * qte;
        }, 0);
        total += coutPortion * n;
      } else if (r.cost > 0) {
        // Fallback : coût de la recette
        total += r.cost * n;
      }
    });

    return total;
  }

  // ─── RENDU PRINCIPAL ──────────────────────────────────────────
  function render() {
    showVerdictSkeleton(false);
    if (!S.calc) return;
    const c = S.calc;

    renderVerdict(c);
    renderPointMort(c);
    renderDecomposition(c);
    renderChargesBloc(c);
    renderHistoChart();
    renderDashCard();
  }

  // ── Bloc 1 : Verdict ─────────────────────────────────────────
  function renderVerdict(c) {
    const content = el('rentaVerdictContent');
    if (content) content.style.display = '';

    const isCurrentMonth = c.isCurrentMonth;
    const projPane = el('rentaVerdictProjection');

    if (isCurrentMonth && c.projection) {
      // Mois en cours → afficher résultat estimé fin de mois
      const proj = c.projection;
      const signe = proj.resultatProj >= 0 ? '+' : '';
      el('rentaVerdictAmount').textContent = signe + fmt2(proj.resultatProj);
      el('rentaVerdictAmount').className = 'renta-verdict-amount ' + (proj.resultatProj >= 0 ? 'positive' : 'negative');
      el('rentaVerdictLabel').textContent = 'Résultat estimé fin de mois';
      el('rentaVerdictIcon').textContent = proj.resultatProj >= 0 ? '📈' : '📉';
      if (projPane) {
        projPane.style.display = '';
        el('rentaProjFin').textContent = fmt2(proj.resultatProj);
        el('rentaProjFin').className = proj.resultatProj >= 0 ? 'renta-proj-value positive' : 'renta-proj-value negative';
      }
    } else if (c.resultatReel != null) {
      const signe = c.resultatReel >= 0 ? '+' : '';
      el('rentaVerdictAmount').textContent = signe + fmt2(c.resultatReel);
      el('rentaVerdictAmount').className = 'renta-verdict-amount ' + (c.resultatReel >= 0 ? 'positive' : 'negative');
      el('rentaVerdictLabel').textContent = 'Résultat réel après charges';
      el('rentaVerdictIcon').textContent  = c.resultatReel >= 0 ? '🟢' : '🔴';
      if (projPane) projPane.style.display = 'none';
    } else {
      // Pas d'inventaire → résultat théorique
      if (c.resultatTheo != null) {
        const signe = c.resultatTheo >= 0 ? '+' : '';
        el('rentaVerdictAmount').textContent = signe + fmt2(c.resultatTheo);
        el('rentaVerdictAmount').className = 'renta-verdict-amount ' + (c.resultatTheo >= 0 ? 'positive' : 'negative');
        el('rentaVerdictIcon').textContent  = '🟠';
        el('rentaVerdictLabel').textContent = 'Résultat théorique (pas d\'inventaire validé ce mois)';
      } else {
        el('rentaVerdictAmount').textContent = '—';
        el('rentaVerdictAmount').className = 'renta-verdict-amount';
        el('rentaVerdictIcon').textContent = '⚪';
        el('rentaVerdictLabel').textContent = 'Données insuffisantes pour ce mois';
      }
      if (projPane) projPane.style.display = 'none';
    }
  }

  // ── Bloc 2 : Point mort ──────────────────────────────────────
  function renderPointMort(c) {
    const target = el('rentaBreakevenTarget');
    const fill   = el('rentaProgressFill');
    const pctEl  = el('rentaProgressPct');
    const maxEl  = el('rentaProgressMax');
    const msgEl  = el('rentaBreakevenMsg');
    const goalLine = el('rentaGoalLine');

    if (target) target.textContent = c.pointMort ? `Seuil : ${fmt2(c.pointMort)}` : 'Seuil : non calculable';

    const pct = c.progressPct || 0;
    if (fill) {
      fill.style.width = Math.min(pct, 100) + '%';
      fill.className = 'renta-progress-fill' + (pct >= 100 ? ' renta-fill-green' : pct >= 70 ? ' renta-fill-orange' : ' renta-fill-red');
    }

    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    if (maxEl) maxEl.textContent = c.pointMort
      ? fmt2(Math.max(c.pointMort * 1.3, c.caFinal * 1.2))
      : '—';

    // Ligne cible à 77% de la barre si pas atteint (représente le point mort visuel)
    if (goalLine && c.pointMort && c.caFinal) {
      const maxVal = Math.max(c.pointMort * 1.3, c.caFinal * 1.2);
      const goalPct = Math.min((c.pointMort / maxVal) * 100, 95);
      goalLine.style.left = goalPct + '%';
      goalLine.style.display = pct < 100 ? '' : 'none';
    }

    if (msgEl) {
      if (!c.pointMort) {
        msgEl.innerHTML = '<span class="text-muted">Saisissez des charges fixes pour calculer le point mort</span>';
      } else if (c.caFinal >= c.pointMort) {
        msgEl.innerHTML = `<span class="renta-msg-green">✅ Seuil atteint — tout le CA supplémentaire contribue à votre bénéfice (<strong>${fmt2(c.caFinal - c.pointMort)}</strong> au-delà du point mort)</span>`;
      } else {
        const manque = c.pointMort - c.caFinal;
        msgEl.innerHTML = `<span class="renta-msg-orange">Il vous manque <strong>${fmt2(manque)}</strong> pour couvrir vos charges ce mois-ci</span>`;
      }
    }
  }

  // ── Bloc 3 : Décomposition ────────────────────────────────────
  function renderDecomposition(c) {
    const tbody  = el('rentaDecompBody');
    const banner = el('rentaEcartBanner');
    if (!tbody) return;

    const hasReal = c.hasInventaire;
    const na = (v, cls = '') => v != null
      ? `<span class="${cls}">${fmt2(v)}</span>`
      : `<span class="text-muted renta-na">—</span>`;

    const naInvLink = !hasReal
      ? `<span class="text-muted renta-na">Inventaire manquant <a href="#" onclick="navigateTo('inventaires');return false;" class="renta-link">→ Créer</a></span>`
      : null;

    const caRow = `
      <tr class="renta-row-ca">
        <td><strong>Chiffre d'affaires</strong></td>
        <td class="text-right">${fmt2(c.caFinal)}</td>
        <td class="text-right">${fmt2(c.caFinal)}</td>
        <td class="text-right"><span class="text-muted">—</span></td>
      </tr>`;

    const coutReelVal  = hasReal ? c.coutReel  : null;
    const ecartColor   = c.ecartMatiere != null ? (c.ecartMatiere > 0 ? 'renta-val-neg' : 'renta-val-pos') : '';
    const coutRow = `
      <tr class="renta-row-cout${c.ecartMatiere != null && c.ecartMatiere > 0 ? ' renta-row-alert' : ''}">
        <td>Coût matière</td>
        <td class="text-right">${na(c.coutTheorique > 0 ? c.coutTheorique : null)}</td>
        <td class="text-right">${naInvLink || na(coutReelVal, coutReelVal > (c.coutTheorique || 0) ? 'renta-val-neg' : '')}</td>
        <td class="text-right">${na(c.ecartMatiere, ecartColor)}</td>
      </tr>`;

    const margeReelleVal = hasReal ? c.margeReelle : null;
    const margeRow = `
      <tr class="renta-row-marge">
        <td><strong>Marge brute</strong></td>
        <td class="text-right"><strong>${na(c.margeTheo > 0 ? c.margeTheo : null)}</strong>
          ${c.margeTheoPct != null ? `<small class="text-muted"> (${fmtPct(c.margeTheoPct)})</small>` : ''}
        </td>
        <td class="text-right"><strong>${naInvLink || na(margeReelleVal)}</strong>
          ${c.margeReellePct != null ? `<small class="text-muted"> (${fmtPct(c.margeReellePct)})</small>` : ''}
        </td>
        <td class="text-right">${na(
          (margeReelleVal != null && c.margeTheo > 0) ? margeReelleVal - c.margeTheo : null,
          (margeReelleVal != null && c.margeTheo > 0 && margeReelleVal < c.margeTheo) ? 'renta-val-neg' : 'renta-val-pos'
        )}</td>
      </tr>`;

    const chargesRow = `
      <tr>
        <td>Charges fixes</td>
        <td class="text-right renta-val-neg">${fmt2(c.chargesFixesCourantes)}</td>
        <td class="text-right renta-val-neg">${fmt2(c.chargesFixesCourantes)}</td>
        <td class="text-right"><span class="text-muted">—</span></td>
      </tr>`;

    const resTheoVal = c.resultatTheo;
    const resReelVal = c.resultatReel;
    const resCls = v => v == null ? '' : v >= 0 ? 'renta-val-pos renta-bold' : 'renta-val-neg renta-bold';
    const resultRow = `
      <tr class="renta-row-result">
        <td><strong>Résultat net</strong></td>
        <td class="text-right"><strong class="${resCls(resTheoVal)}">${resTheoVal != null ? fmt2(resTheoVal) : '<span class="text-muted">—</span>'}</strong></td>
        <td class="text-right"><strong class="${resCls(resReelVal)}">${resReelVal != null ? fmt2(resReelVal) : (naInvLink || '<span class="text-muted">—</span>')}</strong></td>
        <td class="text-right">${na(
          resReelVal != null && resTheoVal != null ? resReelVal - resTheoVal : null,
          resReelVal != null && resTheoVal != null && resReelVal < resTheoVal ? 'renta-val-neg' : 'renta-val-pos'
        )}</td>
      </tr>`;

    tbody.innerHTML = caRow + coutRow + margeRow + chargesRow + resultRow;

    // Bannière écart matière
    if (banner) {
      if (c.ecartMatiere != null && c.ecartMatiere > 50) {
        el('rentaEcartBannerText').innerHTML =
          `⚠️ <strong>${fmt2(c.ecartMatiere)}</strong> de pertes terrain non expliquées par les recettes ce mois-ci`;
        banner.style.display = '';
      } else {
        banner.style.display = 'none';
      }
    }
  }

  // ── Bloc 4 : Charges du mois (vue lecture seule dans main) ────
  function renderChargesBloc(c) {
    const grouped = el('rentaChargesGrouped');
    const empty   = el('rentaChargesEmpty');
    const totalBadge = el('rentaChargesTotalBadge');

    if (!grouped) return;

    if (totalBadge) totalBadge.textContent = fmt2(c.chargesFixesCourantes);

    const charges = c.chargesMois;

    if (charges.length === 0) {
      grouped.style.display = 'none';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    grouped.style.display = '';

    // Regrouper par catégorie
    const groups = {};
    charges.forEach(ch => {
      const cat = ch.categorie || 'autre';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(ch);
    });

    grouped.innerHTML = CAT_ORDER
      .filter(cat => groups[cat])
      .map(cat => {
        const items = groups[cat];
        const total = items.reduce((s, i) => s + (i.montant || 0), 0);
        return `
          <div class="renta-charges-cat-group">
            <div class="renta-charges-cat-header">
              <span>${CAT_LABELS[cat] || cat}</span>
              <strong>${fmt2(total)}</strong>
            </div>
            ${items.map(ch => `
              <div class="renta-charge-item${ch.est_exceptionnel ? ' renta-charge-exceptional' : ''}">
                <span class="renta-charge-label">
                  ${escH(ch.libelle || '—')}
                  ${ch.est_exceptionnel ? '<span class="badge-exceptional">Exceptionnel</span>' : ''}
                </span>
                <span class="renta-charge-amount">${fmt2(ch.montant || 0)}</span>
              </div>`).join('')}
          </div>`;
      }).join('');
  }

  // ── Bloc 5 : Graphique historique ─────────────────────────────
  function renderHistoChart() {
    const ctx = el('rentaHistoChart');
    if (!ctx) return;
    if (S.histoChart) { S.histoChart.destroy(); S.histoChart = null; }

    // Construire 6 mois glissants
    const moisDatas = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(S.annee, S.mois - 1 - i, 1);
      const a = d.getFullYear();
      const m = d.getMonth() + 1;
      const label = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });

      const debut = `${a}-${String(m).padStart(2,'0')}-01`;
      const fin   = lastDayOf(a, m);

      // CA
      const ca = S.revenueData
        .filter(r => { const dd = (r.date||'').split('T')[0]; return dd>=debut && dd<=fin; })
        .reduce((s, r) => s + (r.revenue || 0), 0);

      // Charges
      const charges = S.charges
        .filter(c => parseInt(c.annee) === a && parseInt(c.mois) === m && !c.est_exceptionnel)
        .reduce((s, c) => s + (c.montant || 0), 0);

      // Coût théo (fallback si pas d'inventaire)
      const ventes = S.salesData.filter(v => { const dd=(v.sale_date||v.date||'').split('T')[0]; return dd>=debut && dd<=fin; });
      const coutTheo = getCoutMatiereTheorique(ventes);

      const resultat = ca > 0 ? ca - coutTheo - charges : null;

      moisDatas.push({ label, resultat });
    }

    const labels  = moisDatas.map(d => d.label);
    const values  = moisDatas.map(d => d.resultat);
    const colors  = values.map(v => v == null ? '#e2e8f0' : v >= 0 ? '#16a34a' : '#dc2626');
    const bgAlpha = values.map(v => v == null ? '#f1f5f9' : v >= 0 ? 'rgba(22,163,74,.15)' : 'rgba(220,38,38,.15)');

    // Point mort moyen
    const chargesTotales = S.charges
      .filter(c => parseInt(c.annee) === S.annee && parseInt(c.mois) === S.mois && !c.est_exceptionnel)
      .reduce((s, c) => s + (c.montant || 0), 0);

    S.histoChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Résultat net (€)',
          data: values.map(v => v ?? 0),
          backgroundColor: bgAlpha,
          borderColor: colors,
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
              label: ctx => {
                const v = ctx.parsed.y;
                return v === 0 ? ' Données insuffisantes' : ` ${v >= 0 ? '+' : ''}${new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(v)}`;
              }
            }
          },
          annotation: chargesTotales > 0 ? {
            annotations: {
              zeroLine: {
                type: 'line', yMin: 0, yMax: 0,
                borderColor: '#94a3b8', borderWidth: 1, borderDash: [4, 4]
              }
            }
          } : undefined
        },
        scales: {
          y: {
            grid: { color: '#f1f5f9' },
            ticks: { callback: v => new Intl.NumberFormat('fr-FR', { notation: 'compact', style: 'currency', currency: 'EUR' }).format(v) }
          }
        }
      }
    });
  }

  // ─── CARTE DASHBOARD ──────────────────────────────────────────
  function renderDashCard() {
    // ── Exposer S.calc pour le bloc Pilotage ──────────────────
    window._rentaCalc = S.calc;
    // Mettre à jour le bloc pilotage si disponible
    if (window.PilotageBloc && S.calc) {
      window.PilotageBloc.update(S.calc, S.recipesData || []);
    }
    // Mettre à jour les onglets dashboard (Ce mois-ci / Aujourd'hui)
    if (window.DashboardTabs && S.calc) {
      DashboardTabs.refresh();
    }

    const card   = el('dashRentaCard');
    if (!card || !S.calc) return;
    const c = S.calc;

    const res = c.resultatReel ?? c.resultatTheo;
    if (res == null && c.caFinal === 0) { card.style.display = 'none'; return; }
    card.style.display = '';

    const monthEl  = el('dashRentaMonth');
    const resultEl = el('dashRentaResult');
    const fillEl   = el('dashRentaProgressFill');
    const msgEl    = el('dashRentaMsg');

    if (monthEl)  monthEl.textContent  = fmtMonthLabel(c.annee, c.mois);
    if (resultEl) {
      const signe = res != null ? (res >= 0 ? '+' : '') : '';
      resultEl.textContent  = res != null ? signe + fmt2(res) : fmt2(c.caFinal) + ' CA';
      resultEl.className = 'renta-dash-result ' + (res == null ? '' : res >= 0 ? 'positive' : 'negative');
    }
    if (fillEl) {
      const pct = c.progressPct || 0;
      fillEl.style.width = Math.min(pct, 100) + '%';
      fillEl.className = 'renta-progress-fill' + (pct >= 100 ? ' renta-fill-green' : pct >= 70 ? ' renta-fill-orange' : ' renta-fill-red');
    }
    if (msgEl) {
      if (!c.pointMort) {
        msgEl.textContent = c.caFinal > 0 ? `CA : ${fmt2(c.caFinal)}` : 'Aucune donnée ce mois';
      } else if (c.caFinal >= c.pointMort) {
        msgEl.innerHTML = `<span style="color:var(--success)">✅ Point mort atteint</span>`;
      } else {
        msgEl.innerHTML = `Il manque <strong>${fmt2(c.pointMort - c.caFinal)}</strong>`;
      }
    }
  }

  // ─── SÉLECTEUR DE MOIS ────────────────────────────────────────
  function initMonthBar() {
    updateMonthLabel();
    el('rentaPrevMonth')?.addEventListener('click', () => changeMonth(-1));
    el('rentaNextMonth')?.addEventListener('click', () => changeMonth(+1));
  }

  function updateMonthLabel() {
    const lbl = el('rentaMonthLabel');
    const badge = el('rentaCurrentMonthBadge');
    const now = new Date();
    const isNow = S.annee === now.getFullYear() && S.mois === (now.getMonth() + 1);

    if (lbl) lbl.textContent = fmtMonthLabel(S.annee, S.mois);
    if (badge) badge.style.display = isNow ? '' : 'none';
  }

  async function changeMonth(delta) {
    let m = S.mois + delta;
    let a = S.annee;
    if (m < 1)  { m = 12; a--; }
    if (m > 12) { m = 1;  a++; }
    // Ne pas aller dans le futur
    const now = new Date();
    if (a > now.getFullYear() || (a === now.getFullYear() && m > now.getMonth() + 1)) return;
    S.annee = a;
    S.mois  = m;
    updateMonthLabel();
    showVerdictSkeleton(true);
    await loadAllData();
    compute();
    render();
  }

  // ─── EVENTS PRINCIPAUX ────────────────────────────────────────
  function bindMainEvents() {
    el('rentaGoChargesBtn')?.addEventListener('click', showCharges);
    el('rentaAddChargeBtn')?.addEventListener('click', () => openChargeModal());
  }

  function showVerdictSkeleton(show) {
    const sk = el('rentaVerdictSkeleton');
    const ct = el('rentaVerdictContent');
    if (sk) sk.style.display = show ? '' : 'none';
    if (ct) ct.style.display = show ? 'none' : '';
  }

  // ─── SOUS-PAGE CHARGES ────────────────────────────────────────
  async function loadChargesSubPage() {
    updateChargesMonthLabel();
    renderChargesSubPage();
    bindChargesEvents();
  }

  function updateChargesMonthLabel() {
    const lbl = el('chargesMonthLabel');
    if (lbl) lbl.textContent = fmtMonthLabel(S.chargesAnnee, S.chargesMois);
  }

  function renderChargesSubPage() {
    const grouped = el('chargesSubGrouped');
    const empty   = el('chargesSubEmpty');
    const total   = el('chargesSubTotal');
    if (!grouped) return;

    const charges = S.charges.filter(c =>
      parseInt(c.annee) === S.chargesAnnee && parseInt(c.mois) === S.chargesMois
    );

    const totalAmt = charges.filter(c => !c.est_exceptionnel).reduce((s, c) => s + (c.montant || 0), 0);
    if (total) total.textContent = fmt2(totalAmt);

    if (charges.length === 0) {
      grouped.style.display = 'none';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    grouped.style.display = '';

    const groups = {};
    charges.forEach(ch => {
      const cat = ch.categorie || 'autre';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(ch);
    });

    grouped.innerHTML = CAT_ORDER
      .filter(cat => groups[cat])
      .map(cat => {
        const items = groups[cat];
        return `
          <div class="renta-charges-cat-group">
            <div class="renta-charges-cat-header">
              <span>${CAT_LABELS[cat] || cat}</span>
            </div>
            ${items.map(ch => `
              <div class="renta-charge-item${ch.est_exceptionnel ? ' renta-charge-exceptional' : ''}">
                <span class="renta-charge-label">
                  ${escH(ch.libelle || '—')}
                  ${ch.est_exceptionnel ? '<span class="badge-exceptional">Exceptionnel — non inclus</span>' : ''}
                </span>
                <span class="renta-charge-actions">
                  <strong class="renta-charge-amount">${fmt2(ch.montant || 0)}</strong>
                  <button class="btn btn-ghost btn-sm" onclick="Rentabilite.editCharge('${ch.id}')"><i class="fas fa-edit"></i></button>
                  <button class="btn btn-ghost btn-sm" onclick="Rentabilite.deleteCharge('${ch.id}','${escH(ch.libelle||'')}')"><i class="fas fa-trash" style="color:var(--danger);"></i></button>
                </span>
              </div>`).join('')}
          </div>`;
      }).join('');
  }

  function bindChargesEvents() {
    el('rentaBackMainBtn')?.addEventListener('click', async () => {
      showMain();
      await loadAllData();
      compute();
      render();
    });
    el('chargesAddBtn')?.addEventListener('click', () => openChargeModal());
    el('chargesPrevMonth')?.addEventListener('click', () => changeChargesMonth(-1));
    el('chargesNextMonth')?.addEventListener('click', () => changeChargesMonth(+1));
    el('chargesCopyBtn')?.addEventListener('click',  copyFromPrevMonth);
  }

  async function changeChargesMonth(delta) {
    let m = S.chargesMois + delta;
    let a = S.chargesAnnee;
    if (m < 1)  { m = 12; a--; }
    if (m > 12) { m = 1;  a++; }
    const now = new Date();
    if (a > now.getFullYear() || (a === now.getFullYear() && m > now.getMonth() + 1)) return;
    S.chargesAnnee = a;
    S.chargesMois  = m;
    updateChargesMonthLabel();
    await loadAllData();
    renderChargesSubPage();
  }

  async function copyFromPrevMonth() {
    let prevM = S.chargesMois - 1;
    let prevA = S.chargesAnnee;
    if (prevM < 1) { prevM = 12; prevA--; }

    const prevCharges = S.charges.filter(c =>
      parseInt(c.annee) === prevA && parseInt(c.mois) === prevM
    );
    if (prevCharges.length === 0) {
      toast(`Aucune charge saisie en ${fmtMonthLabel(prevA, prevM)}`, 'warning');
      return;
    }

    const existing = S.charges.filter(c =>
      parseInt(c.annee) === S.chargesAnnee && parseInt(c.mois) === S.chargesMois
    );
    if (existing.length > 0) {
      if (!confirm(`Ce mois contient déjà ${existing.length} charge(s). Les charges du mois précédent seront ajoutées en plus. Continuer ?`)) return;
    } else {
      if (!confirm(`Copier les ${prevCharges.length} charge(s) de ${fmtMonthLabel(prevA, prevM)} vers ${fmtMonthLabel(S.chargesAnnee, S.chargesMois)} ?`)) return;
    }

    for (const c of prevCharges) {
      await apiPost('charges_fixes', {
        restaurant_id: c.restaurant_id || 'default',
        annee:    S.chargesAnnee,
        mois:     S.chargesMois,
        categorie: c.categorie,
        libelle:  c.libelle,
        montant:  c.montant,
        est_exceptionnel: c.est_exceptionnel || false
      });
    }

    toast(`${prevCharges.length} charge(s) copiée(s)`, 'success');
    await loadAllData();
    renderChargesSubPage();
  }

  // ─── MODAL CHARGE ─────────────────────────────────────────────
  function openChargeModal(id = null) {
    el('chargeModalId').value     = '';
    el('chargeModalAnnee').value  = S.chargesAnnee;
    el('chargeModalMois').value   = S.chargesMois;
    el('chargeLabel').value       = '';
    el('chargeCategory').value    = 'loyer';
    el('chargeAmount').value      = '';
    el('chargeExceptionnel').checked = false;
    el('chargeExceptionnelHint').style.display = 'none';
    el('chargeModalTitle').textContent = 'Nouvelle charge fixe';

    if (id) {
      const c = S.charges.find(x => x.id === id);
      if (c) {
        el('chargeModalId').value    = c.id;
        el('chargeModalAnnee').value = c.annee;
        el('chargeModalMois').value  = c.mois;
        el('chargeLabel').value      = c.libelle || '';
        el('chargeCategory').value   = c.categorie || 'loyer';
        el('chargeAmount').value     = c.montant || '';
        el('chargeExceptionnel').checked = !!c.est_exceptionnel;
        el('chargeExceptionnelHint').style.display = c.est_exceptionnel ? '' : 'none';
        el('chargeModalTitle').textContent = 'Modifier la charge';
      }
    }

    // Bind checkbox hint
    el('chargeExceptionnel').onchange = () => {
      el('chargeExceptionnelHint').style.display = el('chargeExceptionnel').checked ? '' : 'none';
    };

    // Bind save
    el('saveChargeBtn').onclick = saveCharge;

    if (window.openModal) openModal('chargeModal');
  }

  async function saveCharge() {
    const id       = el('chargeModalId').value;
    const libelle  = (el('chargeLabel').value || '').trim();
    const montant  = parseFloat(el('chargeAmount').value);
    const annee    = parseInt(el('chargeModalAnnee').value) || S.chargesAnnee;
    const mois     = parseInt(el('chargeModalMois').value)  || S.chargesMois;

    if (!libelle) { toast('Saisissez un libellé', 'warning'); return; }
    if (!montant || montant <= 0) { toast('Saisissez un montant valide', 'warning'); return; }

    const restoId = window.RestaurantCtx?.currentId() || 'default';
    const data = {
      restaurant_id: restoId,
      annee,
      mois,
      categorie: el('chargeCategory').value,
      libelle,
      montant,
      est_exceptionnel: el('chargeExceptionnel').checked
    };

    try {
      if (id) {
        await apiPut('charges_fixes', id, data);
        toast('Charge mise à jour', 'success');
      } else {
        await apiPost('charges_fixes', data);
        toast('Charge ajoutée', 'success');
      }
      if (window.closeModal) closeModal('chargeModal');
      await loadAllData();
      renderChargesSubPage();
    } catch { toast('Erreur lors de l\'enregistrement', 'error'); }
  }

  function editCharge(id) { openChargeModal(id); }

  async function deleteCharge(id, label) {
    if (!confirm(`Supprimer la charge "${label}" ?`)) return;
    await apiDelete('charges_fixes', id);
    toast('Charge supprimée', 'success');
    await loadAllData();
    renderChargesSubPage();
  }

  // ─── Dashboard update depuis app.js ───────────────────────────
  async function updateDashCard() {
    const card = el('dashRentaCard');
    if (!card) return;
    if (!S.calc) {
      // Chargement minimal
      await loadAllData();
      compute();
    }
    renderDashCard();
  }

  // ─── Utilitaires date ─────────────────────────────────────────
  function lastDayOf(annee, mois) {
    return new Date(annee, mois, 0).toISOString().split('T')[0];
  }

  function daysInMonth(annee, mois) {
    return new Date(annee, mois, 0).getDate();
  }

  function escH(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── API publique ─────────────────────────────────────────────
  return {
    load,
    editCharge,
    deleteCharge,
    updateDashCard
  };

})();
