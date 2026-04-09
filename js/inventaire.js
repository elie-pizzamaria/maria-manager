'use strict';
/**
 * RestauManager V5 — Module Inventaire & Marges Réelles
 * Connexions : Mercuriale (prix) · Recettes (ingrédients) · Ventes (portions vendues) · Factures (achats)
 * Tables API : inventaires · lignes_inventaire
 * Filtrage par restaurant_id via RestaurantCtx.
 * Aucune modification des modules existants.
 */

window.Inventaire = (() => {

  // ─── État interne ─────────────────────────────────────────────
  const S = {
    inventaires: [],       // tous les inventaires validés/brouillons
    lignes: {},            // { inventaire_id: [...lignes] }
    mercurialeProduits: [],
    recettes: [],
    ventes: [],
    factureLignes: [],     // lignes de factures pour les achats
    analyseData: [],       // résultats de l'analyse courante
    analyseSort: { col: 'perte_euro', asc: false },
    analyseFilter: 'all',
    formLignes: [],        // lignes en cours de saisie (formulaire)
    editId: null,          // id de l'inventaire en édition (null = nouveau)
    loaded: false
  };

  // ─── Helpers ──────────────────────────────────────────────────
  const fmt2 = v => typeof v === 'number' ? v.toFixed(2).replace('.', ',') + ' €' : '—';
  const fmt3 = (v, u) => typeof v === 'number' ? v.toFixed(3).replace('.', ',') + (u ? ' ' + u : '') : '—';
  const fmtPct = v => typeof v === 'number' ? v.toFixed(1).replace('.', ',') + ' %' : '—';
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('fr-FR') : '—';
  const todayIso = () => new Date().toISOString().split('T')[0];

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

  function toast(msg, type = 'success') {
    if (window.toast) window.toast(msg, type);
    else console.log(`[TOAST ${type}] ${msg}`);
  }

  function showSub(which) {
    ['invSubListe', 'invSubForm', 'invSubAnalyse'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === which ? '' : 'none';
    });
    // Boutons topbar
    const btnNew = document.getElementById('invNewBtn');
    const btnAna = document.getElementById('invAnalyseBtn');
    if (btnNew) btnNew.style.display = which === 'invSubListe' ? '' : 'none';
    if (btnAna) btnAna.style.display = which === 'invSubListe' ? '' : 'none';
  }

  // ─── CHARGEMENT DES DONNÉES ───────────────────────────────────
  // Helper : retourne query string filtrée par restaurant courant
  function rQS(base = 'limit=500') {
    const ctx = window.RestaurantCtx;
    if (!ctx || !ctx.currentId() || ctx.isGlobal()) return base;
    return `${base}&restaurant_id=${encodeURIComponent(ctx.currentId())}`;
  }

  async function loadAll() {
    const [invRes, lignesRes, mercRes, recRes, ventesRes, factRes] = await Promise.all([
      apiGet('inventaires', rQS('limit=200&sort=date_inventaire')),
      apiGet('lignes_inventaire', 'limit=2000'),
      apiGet('supplier_products', 'limit=500'),
      apiGet('recipes', 'limit=500'),
      apiGet('sales', rQS('limit=2000')),
      apiGet('invoice_lines', rQS('limit=2000'))
    ]);

    S.inventaires = (invRes.data || []).sort((a, b) =>
      (a.date_inventaire || '').localeCompare(b.date_inventaire || ''));
    
    // Indexer les lignes par inventaire_id
    S.lignes = {};
    (lignesRes.data || []).forEach(l => {
      if (!S.lignes[l.inventaire_id]) S.lignes[l.inventaire_id] = [];
      S.lignes[l.inventaire_id].push(l);
    });

    S.mercurialeProduits = mercRes.data || [];
    S.recettes = recRes.data || [];
    S.ventes = ventesRes.data || [];
    S.factureLignes = factRes.data || [];
    S.loaded = true;
  }

  // ─── PAGE PRINCIPALE : load() ────────────────────────────────
  async function load() {
    // Garde multi-restaurants
    if (window.RestaurantCtx && !window.RestaurantCtx.guardDisplay('Inventaires')) return;
    showSub('invSubListe');
    renderSkeletonListe(true);
    await loadAll();
    renderSkeletonListe(false);
    renderListe();
  }

  // ─── LISTE DES INVENTAIRES ────────────────────────────────────
  function renderSkeletonListe(show) {
    const sk = document.getElementById('invSkeletonListe');
    const ct = document.getElementById('invListeContainer');
    const em = document.getElementById('invEmptyState');
    if (sk) sk.style.display = show ? '' : 'none';
    if (ct) ct.style.display = show ? 'none' : '';
    if (em) em.style.display = 'none';
  }

  function renderListe() {
    const container = document.getElementById('invListeContainer');
    const items = document.getElementById('invListeItems');
    const empty = document.getElementById('invEmptyState');
    const banner = document.getElementById('invInfoBanner');
    if (!items) return;

    const valides = S.inventaires.filter(i => i.statut === 'validé');
    if (banner) banner.style.display = valides.length < 2 ? '' : 'none';

    if (S.inventaires.length === 0) {
      if (container) container.style.display = 'none';
      if (empty) empty.style.display = '';
      return;
    }

    if (container) container.style.display = '';
    if (empty) empty.style.display = 'none';

    // Trier par date décroissante pour l'affichage
    const sorted = [...S.inventaires].reverse();
    items.innerHTML = sorted.map(inv => {
      const lignes = S.lignes[inv.id] || [];
      const valeur = lignes.reduce((s, l) => s + (l.valeur_stock || 0), 0);
      const isValide = inv.statut === 'validé';
      const canAnalyse = isValide && valides.length >= 2;
      return `
        <div class="inv-card" data-id="${inv.id}">
          <div class="inv-card-left">
            <div class="inv-card-date">${fmtDate(inv.date_inventaire)}</div>
            <div class="inv-card-label">${esc(inv.label || '—')}</div>
            <div class="inv-card-meta">
              <span>${lignes.length} ingrédient${lignes.length > 1 ? 's' : ''}</span>
              <span>·</span>
              <span>${fmt2(valeur)} de stock</span>
            </div>
          </div>
          <div class="inv-card-right">
            <span class="badge badge-${isValide ? 'success' : 'warning'}">${isValide ? '✅ Validé' : '📝 Brouillon'}</span>
            <div class="inv-card-actions">
              ${canAnalyse ? `<button class="btn btn-sm btn-primary" onclick="Inventaire.showAnalyseWith('${inv.id}')"><i class="fas fa-chart-bar"></i> Analyser</button>` : ''}
              ${!isValide ? `<button class="btn btn-sm btn-secondary" onclick="Inventaire.editInv('${inv.id}')"><i class="fas fa-edit"></i></button>` : ''}
              ${!isValide ? `<button class="btn btn-sm btn-danger" onclick="Inventaire.deleteInv('${inv.id}')"><i class="fas fa-trash"></i></button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── SUPPRESSION BROUILLON ────────────────────────────────────
  async function deleteInv(id) {
    if (!confirm('Supprimer cet inventaire brouillon ?')) return;
    // Supprimer les lignes
    const lignes = S.lignes[id] || [];
    for (const l of lignes) await apiDelete('lignes_inventaire', l.id);
    await apiDelete('inventaires', id);
    toast('Inventaire supprimé');
    await loadAll();
    renderListe();
  }

  // ─── FORMULAIRE NOUVEL / MODIFIER ─────────────────────────────
  function showNouvel() {
    S.editId = null;
    S.formLignes = [];
    document.getElementById('invFormId').value = '';
    document.getElementById('invFormDate').value = todayIso();
    document.getElementById('invFormLabel').value = '';
    document.getElementById('invFormTitle').textContent = 'Nouvel inventaire';
    renderFormLignes();
    showSub('invSubForm');
    bindFormEvents();
  }

  async function editInv(id) {
    if (!S.loaded) await loadAll();
    const inv = S.inventaires.find(i => i.id === id);
    if (!inv) { toast('Inventaire introuvable', 'error'); return; }
    S.editId = id;
    S.formLignes = (S.lignes[id] || []).map(l => ({ ...l }));
    document.getElementById('invFormId').value = id;
    document.getElementById('invFormDate').value = inv.date_inventaire ? inv.date_inventaire.split('T')[0] : todayIso();
    document.getElementById('invFormLabel').value = inv.label || '';
    document.getElementById('invFormTitle').textContent = 'Modifier l\'inventaire';
    renderFormLignes();
    showSub('invSubForm');
    bindFormEvents();
  }

  function bindFormEvents() {
    // Recherche ingrédient
    const inp = document.getElementById('invIngSearch');
    const res = document.getElementById('invSearchResults');
    if (inp) {
      inp.oninput = () => {
        const q = inp.value.trim().toLowerCase();
        if (q.length < 2) { res.style.display = 'none'; return; }
        const matches = S.mercurialeProduits.filter(p =>
          (p.nom || p.name || '').toLowerCase().includes(q)
        ).slice(0, 10);
        if (matches.length === 0 && q.length > 0) {
          res.innerHTML = `<div class="inv-search-item inv-search-manual" onclick="Inventaire.addManualIng('${esc(inp.value.trim())}')">
            <i class="fas fa-plus"></i> Ajouter manuellement "<strong>${esc(inp.value.trim())}</strong>"
          </div>`;
          res.style.display = '';
          return;
        }
        res.innerHTML = matches.map(p => {
          const nom = p.nom || p.name || '?';
          const prix = p.prix_unitaire || p.price_per_unit || 0;
          const unite = p.unite || p.unit || 'kg';
          return `<div class="inv-search-item" onclick="Inventaire.addMercurialeIng('${p.id}','${esc(nom)}','${unite}',${prix})">
            <span class="inv-search-nom">${esc(nom)}</span>
            <span class="inv-search-prix">${prix.toFixed(2)} €/${unite}</span>
          </div>`;
        }).join('');
        res.style.display = '';
      };
    }

    // Bouton ajouter (manuel si rien sélectionné)
    const btnAdd = document.getElementById('invAddIngBtn');
    if (btnAdd) {
      btnAdd.onclick = () => {
        const q = (document.getElementById('invIngSearch')?.value || '').trim();
        if (q) addManualIng(q);
      };
    }

    // CSV import
    const csvInput = document.getElementById('invCsvInput');
    if (csvInput) {
      csvInput.onchange = e => importCsv(e.target.files[0]);
    }

    // Save draft
    const btnDraft = document.getElementById('invSaveDraftBtn');
    if (btnDraft) btnDraft.onclick = () => saveInv('brouillon');

    // Validate
    const btnVal = document.getElementById('invValidateBtn');
    if (btnVal) btnVal.onclick = () => saveInv('validé');
  }

  function addMercurialeIng(prodId, nom, unite, prix) {
    // Éviter les doublons
    if (S.formLignes.some(l => l.ingredient_id === prodId)) {
      toast(`"${nom}" est déjà dans l'inventaire`, 'warning');
      closeSearchResults();
      return;
    }
    S.formLignes.push({
      _tmp: true,
      ingredient_id: prodId,
      ingredient_nom: nom,
      quantite: 0,
      unite: unite,
      prix_unitaire: prix,
      valeur_stock: 0,
      source_prix: 'mercuriale'
    });
    renderFormLignes();
    closeSearchResults();
  }

  function addManualIng(nom) {
    S.formLignes.push({
      _tmp: true,
      ingredient_id: '',
      ingredient_nom: nom,
      quantite: 0,
      unite: 'kg',
      prix_unitaire: 0,
      valeur_stock: 0,
      source_prix: 'manuel'
    });
    renderFormLignes();
    closeSearchResults();
  }

  function closeSearchResults() {
    const res = document.getElementById('invSearchResults');
    const inp = document.getElementById('invIngSearch');
    if (res) res.style.display = 'none';
    if (inp) inp.value = '';
  }

  function removeLigne(idx) {
    S.formLignes.splice(idx, 1);
    renderFormLignes();
  }

  function updateLigne(idx, field, value) {
    S.formLignes[idx][field] = parseFloat(value) || 0;
    S.formLignes[idx].valeur_stock =
      (S.formLignes[idx].quantite || 0) * (S.formLignes[idx].prix_unitaire || 0);
    // Mettre à jour total
    updateTotalValeur();
  }

  function updateTotalValeur() {
    const total = S.formLignes.reduce((s, l) => s + (l.valeur_stock || 0), 0);
    const el = document.getElementById('invTotalValeur');
    if (el) el.textContent = fmt2(total);
  }

  function renderFormLignes() {
    const tbody = document.getElementById('invLignesTbody');
    const emptyRow = document.getElementById('invLignesEmpty');
    if (!tbody) return;

    if (S.formLignes.length === 0) {
      tbody.innerHTML = `<tr id="invLignesEmpty"><td colspan="6" class="text-center text-muted" style="padding:2rem;">Ajoutez des ingrédients pour commencer l'inventaire</td></tr>`;
      updateTotalValeur();
      return;
    }

    tbody.innerHTML = S.formLignes.map((l, idx) => `
      <tr class="inv-ligne-row" data-idx="${idx}">
        <td>
          <span class="inv-ing-nom">${esc(l.ingredient_nom)}</span>
          ${l.source_prix === 'mercuriale' ? '<span class="badge-merc">Mercuriale</span>' : ''}
        </td>
        <td>
          <input type="number" class="form-control form-control-sm inv-qty-input"
            value="${l.quantite || 0}" min="0" step="0.001"
            onchange="Inventaire.updateLigne(${idx},'quantite',this.value); Inventaire.updateValeur(${idx}, this)"
            placeholder="0.000" />
        </td>
        <td>
          <input type="text" class="form-control form-control-sm" style="width:70px;"
            value="${esc(l.unite || 'kg')}"
            onchange="Inventaire.updateLigneText(${idx},'unite',this.value)" />
        </td>
        <td>
          <input type="number" class="form-control form-control-sm"
            value="${l.prix_unitaire || 0}" min="0" step="0.01"
            ${l.source_prix === 'mercuriale' ? '' : ''}
            onchange="Inventaire.updateLigne(${idx},'prix_unitaire',this.value); Inventaire.updateValeur(${idx}, null)"
            placeholder="0.00" />
        </td>
        <td class="inv-valeur-cell" id="invValCell_${idx}">
          ${fmt2(l.valeur_stock || 0)}
        </td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="Inventaire.removeLigne(${idx})" title="Supprimer">
            <i class="fas fa-trash" style="color:#ef4444;"></i>
          </button>
        </td>
      </tr>`).join('');

    updateTotalValeur();
  }

  function updateValeur(idx, qtyEl) {
    const l = S.formLignes[idx];
    if (!l) return;
    l.valeur_stock = (l.quantite || 0) * (l.prix_unitaire || 0);
    const cell = document.getElementById(`invValCell_${idx}`);
    if (cell) cell.textContent = fmt2(l.valeur_stock);
    updateTotalValeur();
  }

  function updateLigneText(idx, field, value) {
    if (S.formLignes[idx]) S.formLignes[idx][field] = value;
  }

  // ─── SAUVEGARDE ───────────────────────────────────────────────
  async function saveInv(statut) {
    const date = document.getElementById('invFormDate')?.value;
    const label = document.getElementById('invFormLabel')?.value?.trim();
    if (!date) { toast('Veuillez saisir une date', 'error'); return; }
    if (!label) { toast('Veuillez saisir un libellé', 'error'); return; }

    const valeurTotale = S.formLignes.reduce((s, l) => s + (l.valeur_stock || 0), 0);

    try {
      let invId = S.editId;

      if (invId) {
        // Mise à jour de l'inventaire existant
        await apiPut('inventaires', invId, {
          date_inventaire: date,
          label,
          statut,
          valeur_totale: valeurTotale,
          nb_lignes: S.formLignes.length
        });
        // Supprimer anciennes lignes
        const old = S.lignes[invId] || [];
        for (const l of old) await apiDelete('lignes_inventaire', l.id);
      } else {
        // Création
        // Injecter restaurant_id courant
        const restoId = window.RestaurantCtx?.currentId() || 'default';
        const created = await apiPost('inventaires', {
          date_inventaire: date,
          label,
          statut,
          valeur_totale: valeurTotale,
          nb_lignes: S.formLignes.length,
          restaurant_id: restoId
        });
        invId = created.id;
      }

      // Créer les nouvelles lignes
      for (let i = 0; i < S.formLignes.length; i++) {
        const l = S.formLignes[i];
        await apiPost('lignes_inventaire', {
          inventaire_id: invId,
          ingredient_nom: l.ingredient_nom || '',
          ingredient_id: l.ingredient_id || '',
          quantite: l.quantite || 0,
          unite: l.unite || 'kg',
          prix_unitaire: l.prix_unitaire || 0,
          valeur_stock: l.valeur_stock || 0,
          source_prix: l.source_prix || 'manuel',
          ordre: i
        });
      }

      toast(`Inventaire ${statut === 'validé' ? 'validé ✅' : 'enregistré en brouillon'}`, 'success');
      await loadAll();
      showListe();
    } catch (e) {
      console.error(e);
      toast('Erreur lors de la sauvegarde', 'error');
    }
  }

  // ─── CSV IMPORT ───────────────────────────────────────────────
  function importCsv(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const lines = e.target.result.split('\n').filter(l => l.trim());
      let added = 0;
      lines.forEach(line => {
        const parts = line.split(';');
        if (parts.length < 2) return;
        const nom = parts[0].trim();
        const qte = parseFloat(parts[1].replace(',', '.')) || 0;
        const unite = parts[2] ? parts[2].trim() : 'kg';
        if (!nom) return;
        // Chercher dans mercuriale
        const merc = S.mercurialeProduits.find(p =>
          (p.nom || p.name || '').toLowerCase() === nom.toLowerCase()
        );
        if (S.formLignes.some(l => l.ingredient_nom.toLowerCase() === nom.toLowerCase())) return;
        S.formLignes.push({
          _tmp: true,
          ingredient_id: merc ? merc.id : '',
          ingredient_nom: nom,
          quantite: qte,
          unite,
          prix_unitaire: merc ? (merc.prix_unitaire || merc.price_per_unit || 0) : 0,
          valeur_stock: qte * (merc ? (merc.prix_unitaire || merc.price_per_unit || 0) : 0),
          source_prix: merc ? 'mercuriale' : 'manuel'
        });
        added++;
      });
      renderFormLignes();
      toast(`${added} ligne(s) importée(s) depuis le CSV`);
    };
    reader.readAsText(file);
  }

  // ─── ANALYSE DES ÉCARTS ───────────────────────────────────────
  function showListe() { showSub('invSubListe'); renderListe(); }

  async function showAnalyse() {
    if (!S.loaded) { await loadAll(); }
    const valides = S.inventaires.filter(i => i.statut === 'validé');
    if (valides.length < 2) {
      toast('Il faut au moins 2 inventaires validés pour analyser les écarts', 'warning');
      return;
    }
    showSub('invSubAnalyse');
    populateAnalyseSelectors(valides);
    document.getElementById('invAnalyseResults').style.display = 'none';
    bindAnalyseEvents();
  }

  async function showAnalyseWith(idFin) {
    if (!S.loaded) await loadAll();
    await showAnalyse();
    const valides = S.inventaires.filter(i => i.statut === 'validé');
    const endSel = document.getElementById('invAnalyseEnd');
    if (endSel) endSel.value = idFin;
    // Sélectionner le précédent comme début
    const idx = valides.findIndex(i => i.id === idFin);
    if (idx > 0) {
      const startSel = document.getElementById('invAnalyseStart');
      if (startSel) startSel.value = valides[idx - 1].id;
    }
  }

  function populateAnalyseSelectors(valides) {
    const startSel = document.getElementById('invAnalyseStart');
    const endSel = document.getElementById('invAnalyseEnd');
    if (!startSel || !endSel) return;
    const options = valides.map(i =>
      `<option value="${i.id}">${fmtDate(i.date_inventaire)} — ${esc(i.label || '')}</option>`
    ).join('');
    startSel.innerHTML = options;
    endSel.innerHTML = options;
    if (valides.length >= 2) {
      startSel.value = valides[valides.length - 2].id;
      endSel.value = valides[valides.length - 1].id;
    }
  }

  function bindAnalyseEvents() {
    const btn = document.getElementById('invLancerAnalyseBtn');
    if (btn) btn.onclick = lancerAnalyse;

    const filterTabs = document.getElementById('invAnalyseFilter');
    if (filterTabs) {
      filterTabs.querySelectorAll('.filter-tab').forEach(t => {
        t.onclick = () => {
          filterTabs.querySelectorAll('.filter-tab').forEach(x => x.classList.remove('active'));
          t.classList.add('active');
          S.analyseFilter = t.dataset.filter;
          renderAnalyseTable();
        };
      });
    }

    const exportBtn = document.getElementById('invExportCsvBtn');
    if (exportBtn) exportBtn.onclick = exportCsv;
  }

  async function lancerAnalyse() {
    const startId = document.getElementById('invAnalyseStart')?.value;
    const endId = document.getElementById('invAnalyseEnd')?.value;
    if (!startId || !endId || startId === endId) {
      toast('Sélectionnez deux inventaires différents', 'error');
      return;
    }

    const invStart = S.inventaires.find(i => i.id === startId);
    const invEnd = S.inventaires.find(i => i.id === endId);
    if (!invStart || !invEnd) return;

    // S'assurer que le start est chronologiquement avant end
    const dateStart = invStart.date_inventaire || '';
    const dateEnd = invEnd.date_inventaire || '';

    const lignesStart = S.lignes[startId] || [];
    const lignesEnd = S.lignes[endId] || [];

    // Construire le map des ingrédients
    const ingMap = {};
    const addIng = (l, role) => {
      const key = l.ingredient_id || l.ingredient_nom?.toLowerCase();
      if (!ingMap[key]) ingMap[key] = {
        nom: l.ingredient_nom,
        ingredient_id: l.ingredient_id,
        unite: l.unite || 'kg',
        prix_unitaire: l.prix_unitaire || 0,
        stock_debut: 0,
        stock_fin: 0,
        achats: 0,
        conso_theorique: 0
      };
      if (role === 'start') {
        ingMap[key].stock_debut = l.quantite || 0;
        if (l.prix_unitaire) ingMap[key].prix_unitaire = l.prix_unitaire;
      } else {
        ingMap[key].stock_fin = l.quantite || 0;
        if (l.prix_unitaire) ingMap[key].prix_unitaire = l.prix_unitaire;
      }
    };

    lignesStart.forEach(l => addIng(l, 'start'));
    lignesEnd.forEach(l => addIng(l, 'end'));

    // ── Achats de la période depuis factures ──────────────────
    const achatsMap = computeAchats(dateStart, dateEnd);
    Object.entries(achatsMap).forEach(([nom, qte]) => {
      const key = Object.keys(ingMap).find(k =>
        ingMap[k].nom?.toLowerCase() === nom.toLowerCase()
      );
      if (key) ingMap[key].achats += qte;
    });

    // ── Consommation théorique depuis ventes × recettes ───────
    const consoTheoMap = computeConsoTheorique(dateStart, dateEnd);
    Object.entries(consoTheoMap).forEach(([ingId, data]) => {
      const key = Object.keys(ingMap).find(k =>
        k === ingId || ingMap[k].nom?.toLowerCase() === data.nom?.toLowerCase()
      );
      if (key) ingMap[key].conso_theorique += data.qte;
    });

    // ── Calcul des écarts ─────────────────────────────────────
    S.analyseData = Object.values(ingMap).map(ing => {
      const conso_reelle = ing.stock_debut + ing.achats - ing.stock_fin;
      const ecart_qte = conso_reelle - ing.conso_theorique;
      const ecart_pct = ing.conso_theorique > 0
        ? (ecart_qte / ing.conso_theorique) * 100 : 0;
      const perte_euro = ecart_qte * ing.prix_unitaire;

      let statut = 'normal';
      const absPct = Math.abs(ecart_pct);
      if (absPct > 15) statut = 'alerte';
      else if (absPct > 5) statut = 'attention';

      return {
        nom: ing.nom,
        unite: ing.unite,
        prix_unitaire: ing.prix_unitaire,
        stock_debut: ing.stock_debut,
        achats: ing.achats,
        stock_fin: ing.stock_fin,
        conso_reelle,
        conso_theorique: ing.conso_theorique,
        ecart_qte,
        ecart_pct,
        perte_euro,
        statut,
        recipes_usage: ing.recipes_usage || []
      };
    }).filter(d => d.conso_reelle !== 0 || d.conso_theorique !== 0);

    // ── Affichage KPIs ────────────────────────────────────────
    const totalReelle = S.analyseData.reduce((s, d) => s + d.conso_reelle * d.prix_unitaire, 0);
    const totalTheo = S.analyseData.reduce((s, d) => s + d.conso_theorique * d.prix_unitaire, 0);
    const totalPerte = S.analyseData.reduce((s, d) => s + Math.max(0, d.perte_euro), 0);
    const ecartGlobal = totalTheo > 0 ? ((totalReelle - totalTheo) / totalTheo) * 100 : 0;

    document.getElementById('invKpiReelle').textContent = fmt2(totalReelle);
    document.getElementById('invKpiTheorique').textContent = fmt2(totalTheo);
    document.getElementById('invKpiPerte').textContent = fmt2(totalPerte);
    document.getElementById('invKpiEcartPct').textContent = fmtPct(ecartGlobal);

    // Coloriser l'écart
    const kpiPct = document.getElementById('invKpiEcartPct');
    if (kpiPct) {
      kpiPct.style.color = Math.abs(ecartGlobal) > 15 ? '#ef4444'
        : Math.abs(ecartGlobal) > 5 ? '#f97316' : '#22c55e';
    }

    document.getElementById('invAnalyseResults').style.display = '';
    renderAnalyseTable();

    // Mémoriser pour le dashboard
    saveDashboardState(invStart, invEnd, totalPerte, ecartGlobal);
  }

  function computeAchats(dateStart, dateEnd) {
    const map = {};
    S.factureLignes.forEach(l => {
      const d = l.invoice_date || l.date || '';
      if (d < dateStart || d > dateEnd) return;
      const nom = (l.product_name || l.nom || '').toLowerCase();
      const qte = l.quantity || 0;
      if (!nom) return;
      map[nom] = (map[nom] || 0) + qte;
    });
    return map;
  }

  function computeConsoTheorique(dateStart, dateEnd) {
    // Filtrer les ventes de la période
    const ventesperiode = S.ventes.filter(v => {
      const d = (v.sale_date || v.date || '').split('T')[0];
      return d >= dateStart && d <= dateEnd;
    });

    // Construire un map recetteId → portions vendues
    const recettePortions = {};
    ventesperiode.forEach(v => {
      const rId = v.recipe_id || v.product_id || '';
      if (rId) recettePortions[rId] = (recettePortions[rId] || 0) + (v.quantity || 1);
    });

    // Pour chaque recette, multiplier les ingrédients par les portions
    const consoMap = {};
    S.recettes.forEach(r => {
      const portions = recettePortions[r.id] || 0;
      if (portions === 0) return;
      const ingredients = r.ingredients || [];
      (Array.isArray(ingredients) ? ingredients : []).forEach(ing => {
        const key = ing.product_id || ing.ingredient_id || ing.nom?.toLowerCase() || '';
        if (!key) return;
        const qteParPortion = ing.quantite || ing.quantity || 0;
        if (!consoMap[key]) consoMap[key] = { nom: ing.nom || ing.ingredient_nom || key, qte: 0 };
        consoMap[key].qte += qteParPortion * portions;
      });
    });

    return consoMap;
  }

  function renderAnalyseTable() {
    const tbody = document.getElementById('invAnalyseTbody');
    if (!tbody) return;

    let data = [...S.analyseData];

    // Filtre
    if (S.analyseFilter !== 'all') {
      data = data.filter(d => d.statut === S.analyseFilter);
    }

    // Tri
    data.sort((a, b) => {
      const va = a[S.analyseSort.col] ?? 0;
      const vb = b[S.analyseSort.col] ?? 0;
      if (typeof va === 'string') return S.analyseSort.asc ? va.localeCompare(vb) : vb.localeCompare(va);
      return S.analyseSort.asc ? va - vb : vb - va;
    });

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding:2rem;">
        Aucun ingrédient pour ce filtre ou aucune donnée disponible.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(d => {
      const statutBadge = d.statut === 'alerte'
        ? '<span class="badge badge-danger">🔴 Alerte</span>'
        : d.statut === 'attention'
        ? '<span class="badge badge-warning">🟠 Attention</span>'
        : '<span class="badge badge-success">🟢 Normal</span>';

      const ecartQteCls = d.ecart_qte > 0 ? 'inv-loss' : d.ecart_qte < 0 ? 'inv-under' : '';
      const ecartPctCls = d.ecart_pct > 0 ? 'inv-loss' : d.ecart_pct < 0 ? 'inv-under' : '';
      const perteCls = d.perte_euro > 0 ? 'inv-loss' : d.perte_euro < 0 ? 'inv-under' : '';

      const consoKey = JSON.stringify({ n: d.nom, sd: d.stock_debut, a: d.achats, sf: d.stock_fin, cr: d.conso_reelle, ct: d.conso_theorique });
      const consoKeyEsc = esc(consoKey).replace(/'/g, '&apos;');

      return `<tr>
        <td><strong>${esc(d.nom)}</strong></td>
        <td>${fmt3(d.conso_reelle, d.unite)}</td>
        <td>${d.conso_theorique > 0 ? fmt3(d.conso_theorique, d.unite) : '<span class="text-muted">—</span>'}</td>
        <td class="${ecartQteCls}">${d.ecart_qte > 0 ? '+' : ''}${fmt3(d.ecart_qte, d.unite)}</td>
        <td class="${ecartPctCls}">${d.ecart_pct > 0 ? '+' : ''}${fmtPct(d.ecart_pct)}</td>
        <td class="${perteCls} inv-bold">${fmt2(d.perte_euro)}</td>
        <td>${statutBadge}</td>
        <td>
          <button class="btn btn-ghost btn-sm" title="Détail"
            onclick='Inventaire.showDetail(${JSON.stringify(d)})'>
            <i class="fas fa-chevron-right"></i>
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  function sortAnalyse(col) {
    if (S.analyseSort.col === col) S.analyseSort.asc = !S.analyseSort.asc;
    else { S.analyseSort.col = col; S.analyseSort.asc = false; }
    renderAnalyseTable();
  }

  function showDetail(d) {
    document.getElementById('invDetailTitle').textContent = `Détail — ${d.nom}`;
    document.getElementById('invDetStockDeb').textContent = fmt3(d.stock_debut, d.unite);
    document.getElementById('invDetAchats').textContent = fmt3(d.achats, d.unite);
    document.getElementById('invDetStockFin').textContent = fmt3(d.stock_fin, d.unite);
    document.getElementById('invDetConsoReelle').textContent = fmt3(d.conso_reelle, d.unite);
    document.getElementById('invDetConsoTheo').textContent = d.conso_theorique > 0 ? fmt3(d.conso_theorique, d.unite) : '— (pas de ventes liées)';
    document.getElementById('invDetRecipes').textContent = d.recipes_usage?.length > 0
      ? d.recipes_usage.join(', ') : '— (non utilisé dans les recettes)';
    document.getElementById('invDetailPane').style.display = '';
    document.getElementById('invDetailPane').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ─── EXPORT CSV ───────────────────────────────────────────────
  function exportCsv() {
    if (!S.analyseData.length) { toast('Aucune donnée à exporter', 'error'); return; }
    const header = 'Ingrédient;Unité;Conso réelle;Conso théorique;Écart quantité;Écart %;Perte €;Statut\n';
    const rows = S.analyseData.map(d =>
      `"${d.nom}";"${d.unite}";${d.conso_reelle.toFixed(3)};${d.conso_theorique.toFixed(3)};${d.ecart_qte.toFixed(3)};${d.ecart_pct.toFixed(1)};${d.perte_euro.toFixed(2)};${d.statut}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventaire-analyse-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Export CSV téléchargé');
  }

  // ─── DASHBOARD CARD ───────────────────────────────────────────
  function saveDashboardState(invStart, invEnd, totalPerte, ecartGlobal) {
    const state = {
      periode: `${fmtDate(invStart.date_inventaire)} → ${fmtDate(invEnd.date_inventaire)}`,
      perte: totalPerte,
      ecartPct: ecartGlobal,
      top3: [...S.analyseData]
        .filter(d => d.perte_euro > 0)
        .sort((a, b) => b.perte_euro - a.perte_euro)
        .slice(0, 3)
        .map(d => ({ nom: d.nom, perte: d.perte_euro, statut: d.statut }))
    };
    try { localStorage.setItem('rm_inv_dash', JSON.stringify(state)); } catch (e) {}
    renderDashCard(state);
  }

  async function updateDashCard() {
    const card = document.getElementById('dashInventaireCard');
    if (!card) return;
    // Charger les inventaires si pas encore fait (avec filtre restaurant)
    if (!S.loaded) {
      const invRes = await apiGet('inventaires', rQS('limit=200&sort=date_inventaire'));
      S.inventaires = (invRes.data || []).sort((a, b) =>
        (a.date_inventaire || '').localeCompare(b.date_inventaire || ''));
    }
    const valides = S.inventaires.filter(i => i.statut === 'validé');
    if (valides.length < 2) { card.style.display = 'none'; return; }

    // Essayer de lire le cache
    try {
      const cached = JSON.parse(localStorage.getItem('rm_inv_dash') || 'null');
      if (cached) { renderDashCard(cached); card.style.display = ''; return; }
    } catch (e) {}

    card.style.display = 'none';
  }

  function renderDashCard(state) {
    const card = document.getElementById('dashInventaireCard');
    if (!card) return;
    card.style.display = '';

    const periodeEl = document.getElementById('dashInvPeriod');
    const lossEl = document.getElementById('dashInvLoss');
    const gapEl = document.getElementById('dashInvGap');
    const top3El = document.getElementById('dashInvTop3');

    if (periodeEl) periodeEl.textContent = state.periode || '—';
    if (lossEl) lossEl.textContent = fmt2(state.perte || 0);
    if (gapEl) {
      gapEl.textContent = fmtPct(state.ecartPct || 0);
      gapEl.style.color = Math.abs(state.ecartPct || 0) > 15 ? '#ef4444'
        : Math.abs(state.ecartPct || 0) > 5 ? '#f97316' : '#22c55e';
    }
    if (top3El && state.top3) {
      top3El.innerHTML = state.top3.length === 0
        ? '<p class="text-muted" style="margin:0;">Aucune perte détectée 🎉</p>'
        : state.top3.map(t => `
          <div class="inv-top3-item">
            <span class="inv-top3-nom">${esc(t.nom)}</span>
            <span class="inv-top3-val inv-loss">${fmt2(t.perte)}</span>
            <span class="badge badge-${t.statut === 'alerte' ? 'danger' : t.statut === 'attention' ? 'warning' : 'success'}">
              ${t.statut === 'alerte' ? '🔴' : t.statut === 'attention' ? '🟠' : '🟢'}
            </span>
          </div>`).join('');
    }
  }

  // ─── API PUBLIQUE ─────────────────────────────────────────────
  return {
    load,
    showListe,
    showNouvel,
    showAnalyse,
    showAnalyseWith,
    editInv,
    deleteInv,
    renderFormLignes,
    addMercurialeIng,
    addManualIng,
    removeLigne,
    updateLigne,
    updateLigneText,
    updateValeur,
    sortAnalyse,
    showDetail,
    updateDashCard
  };

})();
