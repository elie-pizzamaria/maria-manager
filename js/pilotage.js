'use strict';
/**
 * MariaManager — Bloc Titre Intégré (Dashboard)
 * ──────────────────────────────────────────────
 * Remplace l'ancien "Bloc Pilotage" par un titre compact 2 lignes + 4 KPI.
 *
 * Structure HTML cible :
 *   #dash-title-block
 *     .dtb-row1  → app-name | subtitle  ||  #dtbResultAmount
 *     .dtb-row2  → #dtbStatusBadge       ||  #dtbShortMsg
 *     .dtb-separator
 *     .dtb-kpi-row → #dtbKpiCA | #dtbKpiCout | #dtbKpiMarge | #dtbKpiPM
 *
 * Lit UNIQUEMENT :
 *   - window._rentaCalc  (exposé par rentabilite.js après chaque render)
 *   - localStorage 'rm_inv_dash' (cache inventaire)
 * Aucun calcul modifié, aucune requête API.
 */

window.PilotageBloc = (() => {

  // ─── Helpers ────────────────────────────────────────────────────────────
  const fmt = v => {
    if (v == null || isNaN(v) || !isFinite(v)) return '—';
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency', currency: 'EUR', maximumFractionDigits: 0
    }).format(v);
  };

  const fmtPct = v =>
    (typeof v === 'number' && isFinite(v))
      ? v.toFixed(1).replace('.', ',') + '\u00a0%'
      : '—';

  const el = id => document.getElementById(id);

  // ─── Accès données ──────────────────────────────────────────────────────
  function getRentaCalc() {
    try { return window._rentaCalc || null; } catch { return null; }
  }

  function getInvDash() {
    try { return JSON.parse(localStorage.getItem('rm_inv_dash') || 'null'); } catch { return null; }
  }

  // ─── Détection du message court prioritaire ─────────────────────────────
  function detectShortMsg(calc, jourDuMois) {
    if (!calc || calc.caFinal === 0) {
      return { type: 'collecting', msg: 'Données en cours de collecte' };
    }

    // Règle 1 — Écart inventaire > 10 %
    if (calc.hasInventaire && calc.ecartMatiere != null && calc.coutTheorique > 0) {
      const ecartPct = (calc.ecartMatiere / calc.coutTheorique) * 100;
      if (ecartPct > 10) {
        return { type: 'warning', msg: 'Attention\u00a0— pertes terrain détectées ce mois-ci' };
      }
    }

    // Règle 2 — Food cost > 32 %
    const fc = calc.hasInventaire
      ? (calc.coutReel > 0 && calc.caFinal > 0 ? (calc.coutReel / calc.caFinal) * 100 : null)
      : (calc.coutTheorique > 0 && calc.caFinal > 0 ? (calc.coutTheorique / calc.caFinal) * 100 : null);
    if (fc != null && fc > 32) {
      return { type: 'warning', msg: 'Attention\u00a0— marge faible, food cost trop élevé' };
    }

    // Règle 3 — Charges > 40 % du CA
    if (calc.caFinal > 0 && calc.chargesFixesCourantes > 0) {
      const chargesPct = (calc.chargesFixesCourantes / calc.caFinal) * 100;
      if (chargesPct > 40) {
        return { type: 'warning', msg: 'Attention\u00a0— charges trop lourdes ce mois-ci' };
      }
    }

    // Règle 4 — Point mort non atteint après le 20
    if (calc.pointMort > 0 && calc.caFinal < calc.pointMort && jourDuMois > 20) {
      return { type: 'danger', msg: 'Attention\u00a0— seuil de rentabilité non atteint' };
    }

    // Règle 5 — Tout va bien
    if ((calc.resultatReel ?? calc.resultatTheo ?? -1) >= 0) {
      return { type: 'ok', msg: 'Bonne dynamique ce mois-ci' };
    }

    return { type: 'neutral', msg: '' };
  }

  // ─── Rendu principal ────────────────────────────────────────────────────
  function render(calc) {
    const bloc = el('dash-title-block');
    if (!bloc) return;

    const now = new Date();
    const jourDuMois = now.getDate();

    // ── Cas : données insuffisantes (< 3 jours et pas de données) ──
    if (!calc || (calc.caFinal === 0 && jourDuMois <= 3)) {
      setResult('—', 'neutral');
      setStatus('neutral', '📊 En cours de collecte');
      setShortMsg('Les données du mois sont en cours de collecte');
      setKPIs(null);
      return;
    }

    // ── Résultat net ──
    const res = calc.resultatReel ?? calc.resultatTheo;
    const isCurrentMonth = calc.isCurrentMonth;
    const proj = calc.projection;
    const valeurAffichee = (isCurrentMonth && proj) ? proj.resultatProj : res;
    const positif = valeurAffichee != null ? valeurAffichee >= 0 : null;

    // Montant principal
    if (valeurAffichee != null) {
      const signe = valeurAffichee >= 0 ? '+' : '';
      setResult(signe + fmt(valeurAffichee), positif ? 'positive' : 'negative');
    } else if (calc.caFinal > 0) {
      setResult('CA\u00a0: ' + fmt(calc.caFinal), 'neutral');
    } else {
      setResult('—', 'neutral');
    }

    // Badge statut
    if (positif === true) {
      setStatus('positive', 'Rentable ✅');
    } else if (positif === false) {
      setStatus('negative', 'En perte ⚠');
    } else {
      setStatus('neutral', '📊 Analyse en cours');
    }

    // Message court
    const { msg } = detectShortMsg(calc, jourDuMois);
    let shortMsg = msg;
    if (isCurrentMonth && proj && !shortMsg) {
      shortMsg = 'Estimation basée sur votre rythme actuel';
    } else if (isCurrentMonth && proj && shortMsg && positif === true) {
      shortMsg = 'Estimation basée sur votre rythme actuel';
    }
    setShortMsg(shortMsg);

    // KPIs
    setKPIs(calc);
  }

  // ─── Mutateurs DOM ──────────────────────────────────────────────────────
  function setResult(text, cls) {
    const e = el('dtbResultAmount');
    if (!e) return;
    e.textContent = text;
    e.className = 'dtb-result-amount ' + (cls || 'neutral');
  }

  function setStatus(cls, text) {
    const badge = el('dtbStatusBadge');
    const textEl = el('dtbStatusText');
    if (!badge || !textEl) return;
    badge.className = 'dtb-status-badge dtb-status-' + (cls || 'neutral');
    textEl.textContent = text || '';
  }

  function setShortMsg(text) {
    const e = el('dtbShortMsg');
    if (!e) return;
    e.textContent = text || '';
    e.style.display = text ? '' : 'none';
  }

  function setKPIs(calc) {
    // CA du mois
    const caEl = el('dtbKpiCA');
    if (caEl) {
      if (calc && calc.caFinal > 0) {
        caEl.textContent = fmt(calc.caFinal);
        caEl.className = 'dtb-kpi-value neutral';
      } else {
        caEl.textContent = '—';
        caEl.className = 'dtb-kpi-value neutral';
      }
    }

    // Coût matière réel
    const coutEl = el('dtbKpiCout');
    if (coutEl) {
      const cout = calc?.hasInventaire ? calc?.coutReel : calc?.coutTheorique;
      if (cout > 0) {
        coutEl.textContent = fmt(cout);
        // Colorier selon food cost
        const fc = calc.caFinal > 0 ? (cout / calc.caFinal) * 100 : 0;
        coutEl.className = 'dtb-kpi-value ' + (fc > 32 ? 'negative' : fc > 0 ? 'positive' : 'neutral');
      } else {
        coutEl.textContent = '—';
        coutEl.className = 'dtb-kpi-value neutral';
      }
    }

    // Marge brute %
    const margeEl = el('dtbKpiMarge');
    if (margeEl) {
      const cout = calc?.hasInventaire ? calc?.coutReel : calc?.coutTheorique;
      if (calc && calc.caFinal > 0 && cout > 0) {
        const marge = ((calc.caFinal - cout) / calc.caFinal) * 100;
        margeEl.textContent = fmtPct(marge);
        margeEl.className = 'dtb-kpi-value ' + (marge >= 68 ? 'positive' : marge >= 55 ? 'neutral' : 'negative');
      } else {
        margeEl.textContent = '—';
        margeEl.className = 'dtb-kpi-value neutral';
      }
    }

    // Point mort — % atteint
    const pmEl = el('dtbKpiPM');
    if (pmEl) {
      if (calc && calc.pointMort > 0 && calc.caFinal > 0) {
        const pct = Math.min((calc.caFinal / calc.pointMort) * 100, 999);
        pmEl.textContent = fmtPct(pct);
        pmEl.className = 'dtb-kpi-value ' + (pct >= 100 ? 'positive' : pct >= 80 ? 'neutral' : 'negative');
      } else {
        pmEl.textContent = '—';
        pmEl.className = 'dtb-kpi-value neutral';
      }
    }
  }

  // ─── Squelette (état initial) ────────────────────────────────────────────
  function showSkeleton() {
    setResult('—', 'neutral');
    setStatus('neutral', '⏳ Chargement…');
    setShortMsg('');
    setKPIs(null);
  }

  // ─── API publique ────────────────────────────────────────────────────────
  /**
   * update(calc, recipes)
   * @param {object|null} calc    — résultat de Rentabilite.compute() (S.calc)
   * @param {Array}       recipes — liste recettes (conservé pour compatibilité)
   */
  function update(calc, recipes) {
    window._pilotageRecipes = recipes || [];
    if (!calc) {
      showSkeleton();
      return;
    }
    render(calc);
  }

  // Conservé pour ne pas casser les éventuels appels existants dans app.js
  function handleActionClick() {}

  return { update, handleActionClick, showSkeleton };

})();
