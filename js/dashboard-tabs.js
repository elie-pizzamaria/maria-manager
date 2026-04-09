'use strict';
/**
 * MariaManager — Dashboard Tabs
 * ══════════════════════════════════════════════════════════════
 * Gère les deux onglets du tableau de bord :
 *   ① "Ce mois-ci"  : CA / Coût matière / Charges / Résultat net
 *                     + barre de progression point mort
 *                     + projection linéaire fin de mois
 *   ② "Aujourd'hui" : CA du jour / Coût matière du jour
 *                     + Charges du jour (fixes ÷ jours ouvrés)
 *                     + Résultat du jour
 *
 * Source de données (priorité décroissante) :
 *   1. window._rentaCalc  exposé par rentabilite.js
 *   2. Appels API directs pour CA et charges du restaurant courant
 *
 * Ce module ne modifie aucun autre module existant.
 * ══════════════════════════════════════════════════════════════
 */

window.DashboardTabs = (() => {

  // ──────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────
  const fmt = v => {
    if (v == null || isNaN(v) || !isFinite(v)) return '—';
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency', currency: 'EUR', maximumFractionDigits: 0
    }).format(v);
  };

  const el = id => document.getElementById(id);
  const set = (id, val) => { const e = el(id); if (e) e.textContent = val; };
  const setClass = (id, cls) => { const e = el(id); if (e) e.className = cls; };

  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  /** Nombre de jours ouvrés dans un mois (lun–sam, sans dimanche) */
  function workDaysInMonth(year, month) {
    const days = new Date(year, month, 0).getDate();
    let count = 0;
    for (let d = 1; d <= days; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow !== 0) count++; // exclure dimanche
    }
    return count;
  }

  /** Jours ouvrés ÉCOULÉS dans le mois courant (jusqu'à aujourd'hui inclus) */
  function workDaysElapsed(year, month) {
    const today = new Date();
    const lastDay = (today.getFullYear() === year && today.getMonth() + 1 === month)
      ? today.getDate()
      : new Date(year, month, 0).getDate();
    let count = 0;
    for (let d = 1; d <= lastDay; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow !== 0) count++;
    }
    return count;
  }

  // ──────────────────────────────────────────────────────────────
  // Gestion des onglets
  // ──────────────────────────────────────────────────────────────
  let activeTab = 'month';

  function initTabs() {
    const bar = el('dashTabsBar');
    if (!bar) return;

    bar.querySelectorAll('.dash-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.dashtab;
        switchTab(tab);
      });
    });
  }

  function switchTab(tab) {
    activeTab = tab;

    // Activation visuelle des boutons
    const bar = el('dashTabsBar');
    if (bar) {
      bar.querySelectorAll('.dash-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.dashtab === tab);
      });
    }

    // Affichage des panneaux
    const monthPanel = el('dashPanelMonth');
    const todayPanel = el('dashPanelToday');
    if (monthPanel) monthPanel.style.display = tab === 'month' ? '' : 'none';
    if (todayPanel) todayPanel.style.display = tab === 'today' ? '' : 'none';

    // Rafraîchir les données de l'onglet actif
    if (tab === 'month') renderMonth();
    else renderToday();
  }

  // ──────────────────────────────────────────────────────────────
  // ONGLET CE MOIS-CI
  // ──────────────────────────────────────────────────────────────
  async function renderMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // 1. Essayer d'utiliser window._rentaCalc (données déjà calculées)
    const calc = window._rentaCalc;

    if (calc && calc.annee === year && calc.mois === month) {
      _renderMonthFromCalc(calc);
      return;
    }

    // 2. Sinon : charger depuis l'API
    try {
      const [revenueRes, chargesRes] = await Promise.all([
        _fetchRevenueMonth(year, month),
        _fetchChargesMonth(year, month)
      ]);

      const caFinal = revenueRes.reduce((s, r) => s + (r.revenue || 0), 0);
      const chargesFixesCourantes = chargesRes
        .filter(c => !c.est_exceptionnel)
        .reduce((s, c) => s + (c.montant || 0), 0);

      // Coût matière théorique estimé (30% si pas de données précises)
      const coutTheorique = caFinal * 0.3;
      const resultatTheo = caFinal - coutTheorique - chargesFixesCourantes;
      const pointMort = chargesFixesCourantes > 0
        ? chargesFixesCourantes / 0.7  // marge brute cible 70%
        : 0;

      // Projection linéaire
      const daysInMonth = new Date(year, month, 0).getDate();
      const daysElapsed = now.getDate();
      const projection = (daysElapsed > 0 && daysElapsed < daysInMonth && caFinal > 0)
        ? { resultatProj: (resultatTheo / daysElapsed) * daysInMonth }
        : null;

      const fakeCalc = {
        annee: year, mois: month,
        caFinal, caHasData: caFinal > 0,
        chargesFixesCourantes, chargesFixesTotales: chargesFixesCourantes,
        coutTheorique, hasInventaire: false, coutReel: 0,
        resultatTheo, resultatReel: null,
        pointMort, progressPct: pointMort > 0 ? (caFinal / pointMort * 100) : 0,
        projection, isCurrentMonth: true
      };
      _renderMonthFromCalc(fakeCalc);
    } catch (e) {
      console.error('DashboardTabs.renderMonth error:', e);
    }
  }

  function _renderMonthFromCalc(c) {
    // ── CA du mois ──
    const caEl = el('dpMonthCA');
    if (caEl) {
      caEl.textContent = fmt(c.caFinal);
      caEl.className = 'dash-period-value' + (c.caFinal > 0 ? ' positive' : '');
    }
    // Nombre de jours
    if (window.State?.revenue) {
      const now = new Date();
      const prefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      const daysCount = (window.State.revenue || []).filter(r => (r.date||'').startsWith(prefix)).length;
      set('dpMonthCADays', `${daysCount} jour(s) enregistré(s)`);
    }

    // ── Coût matière ──
    const cout = c.hasInventaire ? c.coutReel : c.coutTheorique;
    const coutEl = el('dpMonthCost');
    if (coutEl) {
      coutEl.textContent = cout > 0 ? fmt(cout) : '—';
      if (c.caFinal > 0 && cout > 0) {
        const fc = (cout / c.caFinal) * 100;
        coutEl.className = 'dash-period-value' + (fc > 35 ? ' negative' : ' positive');
        set('dpMonthFoodCost', `Food cost : ${fc.toFixed(1)}%${c.hasInventaire ? ' (réel)' : ' (théo.)'}`);
      } else {
        coutEl.className = 'dash-period-value';
        set('dpMonthFoodCost', 'Food cost : —');
      }
    }

    // ── Charges fixes ──
    const chargesEl = el('dpMonthCharges');
    if (chargesEl) {
      chargesEl.textContent = fmt(c.chargesFixesCourantes || 0);
      chargesEl.className = 'dash-period-value' + (c.chargesFixesCourantes > 0 ? ' negative' : '');
    }

    // ── Résultat net ──
    const res = c.resultatReel ?? c.resultatTheo;
    const displayRes = (c.isCurrentMonth && c.projection) ? c.projection.resultatProj : res;
    const resultEl = el('dpMonthResult');
    if (resultEl) {
      if (displayRes != null) {
        const signe = displayRes >= 0 ? '+' : '';
        resultEl.textContent = signe + fmt(displayRes);
        resultEl.className = 'dash-period-value ' + (displayRes >= 0 ? 'positive' : 'negative');
      } else if (c.caFinal > 0) {
        resultEl.textContent = fmt(c.caFinal) + ' CA';
        resultEl.className = 'dash-period-value';
      } else {
        resultEl.textContent = '—';
        resultEl.className = 'dash-period-value';
      }
    }

    // Sous-titre résultat
    const resSub = el('dpMonthResultSub');
    if (resSub) {
      if (c.isCurrentMonth && c.projection) {
        resSub.textContent = 'Projection fin de mois (linéaire)';
        resSub.style.color = '#7C3AED';
      } else {
        resSub.textContent = 'CA − Coût matière − Charges fixes';
        resSub.style.color = '';
      }
    }

    // ── Barre de progression point mort ──
    _renderProgressBar(c);
  }

  function _renderProgressBar(c) {
    const pct = c.progressPct || (c.pointMort > 0 ? (c.caFinal / c.pointMort * 100) : 0);
    const capped = Math.min(pct, 100);

    // % affiché
    const pctEl = el('dpMonthPMPct');
    if (pctEl) {
      pctEl.textContent = pct > 0 ? pct.toFixed(1) + '\u00a0%' : '—';
      pctEl.style.color = pct >= 100 ? '#16A34A' : pct >= 70 ? '#D97706' : '#C0392B';
    }

    // Barre
    const fill = el('dpMonthPMFill');
    if (fill) {
      fill.style.width = capped + '%';
      fill.className = 'dash-pm-fill' +
        (pct >= 100 ? '' : pct >= 70 ? ' warning' : ' danger');
    }

    // Message gauche
    if (c.pointMort > 0) {
      if (c.caFinal >= c.pointMort) {
        set('dpMonthPMLeft', '✅ Point mort atteint — ' + fmt(c.caFinal - c.pointMort) + ' de bénéfice supplémentaire');
      } else {
        const remaining = c.pointMort - c.caFinal;
        set('dpMonthPMLeft', `Il manque ${fmt(remaining)} pour atteindre le point mort (${fmt(c.pointMort)})`);
      }
    } else {
      set('dpMonthPMLeft', 'Renseignez vos charges fixes pour calculer le point mort');
    }

    // Projection fin de mois
    const projEl = el('dpMonthPMProjection');
    if (projEl) {
      if (c.isCurrentMonth && c.projection && c.caFinal > 0) {
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysElapsed = now.getDate();
        const projCA = daysElapsed > 0 ? (c.caFinal / daysElapsed) * daysInMonth : 0;
        if (projCA > 0) {
          projEl.textContent = `↗ Projection CA fin de mois : ${fmt(projCA)}`;
        } else {
          projEl.textContent = '';
        }
      } else {
        projEl.textContent = '';
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // ONGLET AUJOURD'HUI
  // ──────────────────────────────────────────────────────────────
  async function renderToday() {
    const today = todayStr();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    try {
      // Charger CA du mois pour proportionner le coût matière
      const revenueRes = await _fetchRevenueMonth(year, month);
      const chargesRes = await _fetchChargesMonth(year, month);

      const caMonth   = revenueRes.reduce((s, r) => s + (r.revenue || 0), 0);
      const todayData = revenueRes.find(r => (r.date || '').split('T')[0] === today);
      const caToday   = todayData?.revenue || 0;

      // Charges fixes du mois
      const chargesMois = chargesRes
        .filter(c => !c.est_exceptionnel)
        .reduce((s, c) => s + (c.montant || 0), 0);

      // Jours ouvrés
      const workTotal   = workDaysInMonth(year, month);
      const chargesDay  = workTotal > 0 ? chargesMois / workTotal : 0;
      set('dpWorkDays', workTotal);

      // Coût matière du jour : proportionnel au CA (même ratio food cost que le mois)
      let coutDayRaw = 0;
      const calc = window._rentaCalc;
      if (calc && calc.annee === year && calc.mois === month && calc.caFinal > 0) {
        const cout = calc.hasInventaire ? calc.coutReel : calc.coutTheorique;
        const ratio = cout / calc.caFinal;
        coutDayRaw = caToday * ratio;
      } else if (caMonth > 0 && caToday > 0) {
        coutDayRaw = caToday * 0.3; // 30% par défaut
      }

      // Résultat du jour
      const resultDay = caToday - coutDayRaw - chargesDay;

      // ── Affichage ──
      // CA du jour
      const caEl = el('dpTodayCA');
      if (caEl) {
        caEl.textContent = caToday > 0 ? fmt(caToday) : '—';
        caEl.className = 'dash-period-value' + (caToday > 0 ? ' positive' : '');
      }
      if (caToday > 0) {
        set('dpTodayCASub', todayData?.covers
          ? `${todayData.covers} couvert(s) — ticket moy. ${fmt(caToday / todayData.covers)}`
          : 'CA enregistré');
      } else {
        set('dpTodayCASub', 'Pas de CA saisi aujourd\'hui');
      }

      // Coût matière du jour
      const coutEl = el('dpTodayCost');
      if (coutEl) {
        coutEl.textContent = coutDayRaw > 0 ? fmt(coutDayRaw) : '—';
        coutEl.className = 'dash-period-value';
      }
      if (caToday > 0 && coutDayRaw > 0) {
        const fc = (coutDayRaw / caToday * 100);
        set('dpTodayCostSub', `Food cost jour : ${fc.toFixed(1)}%`);
      } else {
        set('dpTodayCostSub', 'Food cost jour : —');
      }

      // Charges du jour
      const chargesEl = el('dpTodayCharges');
      if (chargesEl) {
        chargesEl.textContent = chargesDay > 0 ? fmt(chargesDay) : '—';
        chargesEl.className = 'dash-period-value' + (chargesDay > 0 ? ' negative' : '');
      }

      // Résultat du jour
      const resultEl = el('dpTodayResult');
      if (resultEl) {
        if (caToday > 0) {
          const signe = resultDay >= 0 ? '+' : '';
          resultEl.textContent = signe + fmt(resultDay);
          resultEl.className = 'dash-period-value ' + (resultDay >= 0 ? 'positive' : 'negative');
        } else {
          resultEl.textContent = '—';
          resultEl.className = 'dash-period-value';
        }
      }

    } catch (e) {
      console.error('DashboardTabs.renderToday error:', e);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Fetchers API (avec filtre restaurant si disponible)
  // ──────────────────────────────────────────────────────────────
  async function _fetchRevenueMonth(year, month) {
    try {
      const prefix = `${year}-${String(month).padStart(2, '0')}`;
      const restoId = window.RestaurantCtx?.currentId();
      let url = `tables/daily_revenue?limit=500`;
      if (restoId) url += `&restaurant_id=${encodeURIComponent(restoId)}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).filter(r => (r.date || '').startsWith(prefix));
    } catch { return []; }
  }

  async function _fetchChargesMonth(year, month) {
    try {
      const restoId = window.RestaurantCtx?.currentId();
      let url = `tables/charges_fixes?limit=200`;
      if (restoId) url += `&restaurant_id=${encodeURIComponent(restoId)}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).filter(c =>
        parseInt(c.annee) === year && parseInt(c.mois) === month
      );
    } catch { return []; }
  }

  // ──────────────────────────────────────────────────────────────
  // API publique
  // ──────────────────────────────────────────────────────────────

  /**
   * refresh() — Appelé par loadDashboard() et par rentabilite.js
   * après renderDashCard(). Met à jour l'onglet actif.
   */
  function refresh() {
    if (activeTab === 'month') renderMonth();
    else renderToday();
  }

  /**
   * init() — À appeler une seule fois dans initApp()
   */
  function init() {
    initTabs();
    // Onglet par défaut : "Ce mois-ci"
    switchTab('month');
  }

  return { init, refresh, switchTab };

})();
