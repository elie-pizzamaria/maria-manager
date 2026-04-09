/* ============================================================
   RESTAÜMANAGER V2 — MODULE MERCURIALE
   Fournisseurs + Prix produits + Historique + Meilleurs prix
   ============================================================ */

'use strict';

const Mercuriale = (() => {

  // State local
  let suppliers = [];
  let products = [];
  let history = [];
  let activeTab = 'by-supplier';

  // Icônes catégories
  const catIcons = {
    viande: 'fa-drumstick-bite', BOF: 'fa-egg', épicerie: 'fa-jar',
    légumes: 'fa-carrot', boisson: 'fa-wine-bottle',
    poisson: 'fa-fish', autres: 'fa-box-open'
  };

  // ============================================================
  // LOAD
  // ============================================================
  async function load() {
    try {
      const [supRes, prodRes, histRes] = await Promise.all([
        fetch(`tables/suppliers?limit=500`).then(r => r.json()),
        fetch(`tables/supplier_products?limit=500`).then(r => r.json()),
        fetch(`tables/price_history?limit=500`).then(r => r.json())
      ]);

      suppliers = supRes.data || [];
      products = prodRes.data || [];
      history = histRes.data || [];

      updateKPIs();
      renderActiveTab();
      populateSupplierSelects();
      populateHistoryFilter();
    } catch (e) {
      console.error('Mercuriale load error:', e);
      showToast('Erreur chargement mercuriale', 'error');
    }
  }

  function updateKPIs() {
    const activeSuppliers = suppliers.filter(s => s.is_active !== false).length;
    document.getElementById('kpiSuppliers').textContent = activeSuppliers;
    document.getElementById('kpiProducts').textContent = products.length;

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const updatedThisMonth = products.filter(p =>
      p.last_updated && p.last_updated.startsWith(thisMonth)
    ).length;
    document.getElementById('kpiPricesUpdated').textContent = updatedThisMonth;

    // Produits présents chez plusieurs fournisseurs (par nom)
    const nameCounts = {};
    products.forEach(p => {
      const key = (p.name || '').toLowerCase().trim();
      nameCounts[key] = (nameCounts[key] || 0) + 1;
    });
    const multi = Object.values(nameCounts).filter(c => c > 1).length;
    document.getElementById('kpiMultiSupplier').textContent = multi;
  }

  // ============================================================
  // TAB MANAGEMENT
  // ============================================================
  function renderActiveTab() {
    switch (activeTab) {
      case 'by-supplier': renderBySupplier(); break;
      case 'by-product': renderByProduct(); break;
      case 'best-price': renderBestPrice(); break;
      case 'history': renderHistory(); break;
    }
  }

  // ============================================================
  // TAB 1 : PAR FOURNISSEUR
  // ============================================================
  function renderBySupplier() {
    const container = document.getElementById('suppliersList');
    const search = (document.getElementById('supplierSearch')?.value || '').toLowerCase();
    const catFilter = document.getElementById('supplierCatFilter')?.value || 'all';

    let filtered = suppliers.filter(s => {
      const matchCat = catFilter === 'all' || s.category === catFilter;
      const matchSearch = !search ||
        (s.name || '').toLowerCase().includes(search) ||
        (s.category || '').toLowerCase().includes(search);
      return matchCat && matchSearch;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-truck"></i>
          <p>Aucun fournisseur trouvé</p>
          <button class="btn btn-primary" onclick="document.getElementById('addSupplierBtn').click()">Ajouter un fournisseur</button>
        </div>`;
      return;
    }

    container.innerHTML = `<div class="suppliers-grid">${filtered.map(s => supplierCardHTML(s)).join('')}</div>`;
  }

  function supplierCardHTML(s) {
    const supProducts = products.filter(p => p.supplier_id === s.id);
    const icon = catIcons[s.category] || 'fa-box-open';
    const catClass = `cat-${s.category || 'autres'}`;

    const productsHTML = supProducts.length > 0
      ? supProducts.map(p => `
        <div class="supplier-product-row">
          <div>
            <span class="sp-name">${p.name || '—'}</span>
            <span class="sp-date">&nbsp;·&nbsp;${p.last_updated ? formatShortDate(p.last_updated) : '—'}</span>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <span class="sp-price">${formatCurrency(p.current_price)}</span>
            <span class="sp-unit"> / ${p.unit || '—'}</span>
            <button class="icon-btn" onclick="Mercuriale.editProduct('${p.id}')" title="Modifier" style="margin-left:4px;"><i class="fas fa-edit"></i></button>
          </div>
        </div>`).join('')
      : `<p style="padding:12px 0;color:var(--text-muted);font-size:13px;text-align:center;">Aucun produit renseigné</p>`;

    return `
      <div class="supplier-card">
        <div class="supplier-card-header">
          <div class="supplier-avatar ${catClass}"><i class="fas ${icon}"></i></div>
          <div>
            <p class="supplier-name">${s.name || '—'}</p>
            <p class="supplier-cat"><i class="fas fa-tag"></i> ${s.category || '—'}${s.contact ? ' · ' + s.contact : ''}</p>
          </div>
          <div class="supplier-actions">
            <button class="icon-btn" onclick="Mercuriale.editSupplier('${s.id}')" title="Modifier"><i class="fas fa-edit"></i></button>
            <button class="icon-btn danger" onclick="Mercuriale.deleteSupplier('${s.id}','${(s.name||'').replace(/'/g,"\\'")}')"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="supplier-products-list">${productsHTML}</div>
        <div class="supplier-add-product">
          <button onclick="Mercuriale.addProductForSupplier('${s.id}')">
            <i class="fas fa-plus-circle"></i> Ajouter un prix produit
          </button>
        </div>
      </div>`;
  }

  // ============================================================
  // TAB 2 : PAR PRODUIT
  // ============================================================
  function renderByProduct() {
    const tbody = document.getElementById('productsTableBody');
    const empty = document.getElementById('productsEmpty');
    const search = (document.getElementById('productSearch')?.value || '').toLowerCase();

    let filtered = products.filter(p =>
      !search || (p.name || '').toLowerCase().includes(search) ||
      (p.supplier_name || '').toLowerCase().includes(search)
    ).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    tbody.innerHTML = filtered.map(p => {
      const isOld = p.last_updated && isOlderThan30Days(p.last_updated);
      return `
        <tr>
          <td><strong>${p.name || '—'}</strong>${isOld ? ' <span style="color:var(--warning);font-size:11px;" title="Prix non mis à jour depuis plus de 30 jours"><i class="fas fa-clock"></i></span>' : ''}</td>
          <td>${p.supplier_name || '—'}</td>
          <td><span class="charge-cat ${p.category || 'autres'}">${p.category || '—'}</span></td>
          <td><strong style="color:var(--primary);font-size:16px;">${formatCurrency(p.current_price)}</strong></td>
          <td>${p.unit || '—'}</td>
          <td>${p.last_updated ? formatShortDate(p.last_updated) : '—'}</td>
          <td>
            <div class="actions-cell">
              <button class="icon-btn" onclick="Mercuriale.editProduct('${p.id}')" title="Modifier"><i class="fas fa-edit"></i></button>
              <button class="icon-btn danger" onclick="Mercuriale.deleteProduct('${p.id}','${(p.name||'').replace(/'/g,"\\'")}')"><i class="fas fa-trash"></i></button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // ============================================================
  // TAB 3 : MEILLEURS PRIX (comparaison inter-fournisseurs)
  // ============================================================
  function renderBestPrice() {
    const container = document.getElementById('bestPriceGrid');

    // Grouper par nom de produit (normalize)
    const grouped = {};
    products.forEach(p => {
      const key = (p.name || '').toLowerCase().trim();
      if (!grouped[key]) grouped[key] = { name: p.name, items: [] };
      grouped[key].items.push(p);
    });

    const groups = Object.values(grouped).filter(g => g.items.length >= 1);
    groups.sort((a, b) => a.name.localeCompare(b.name));

    if (groups.length === 0) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-trophy"></i><p>Aucun produit à comparer</p><p class="text-muted text-sm">Ajoutez des produits fournisseurs pour voir les comparaisons</p></div>`;
      return;
    }

    container.innerHTML = `<div class="best-price-grid">` +
      groups.map(g => {
        const sorted = [...g.items].sort((a, b) => (a.current_price || 0) - (b.current_price || 0));
        const best = sorted[0];
        const others = sorted.slice(1);
        const hasComp = others.length > 0;
        const maxPrice = sorted[sorted.length - 1]?.current_price || 0;
        const savings = hasComp ? ((maxPrice - best.current_price) / maxPrice * 100).toFixed(0) : 0;

        return `
          <div class="best-price-card ${hasComp ? 'has-competition' : ''}">
            <p class="bp-product"><i class="fas fa-tag"></i> ${g.name}</p>
            <div class="bp-winner">
              <div>
                <p class="bp-price">${formatCurrency(best.current_price)}<span class="bp-unit"> / ${best.unit || '—'}</span></p>
                <p class="bp-supplier"><i class="fas fa-truck"></i> ${best.supplier_name || '—'}</p>
              </div>
              ${hasComp ? `<span style="margin-left:auto;background:#dcfce7;color:#15803d;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;">🏆 Best</span>` : ''}
            </div>
            ${hasComp ? `
              <div class="bp-others">
                ${others.map(o => `
                  <div class="bp-other-row">
                    <span>${o.supplier_name || '—'}</span>
                    <span style="font-weight:600;">${formatCurrency(o.current_price)} / ${o.unit || '—'}</span>
                  </div>`).join('')}
                <p class="bp-savings">💰 Économie : ${savings}% vs prix le plus élevé</p>
              </div>` : `<p class="bp-others" style="color:var(--text-light);font-style:italic;">Un seul fournisseur — Ajoutez-en un autre pour comparer</p>`}
          </div>`;
      }).join('') + `</div>`;
  }

  // ============================================================
  // TAB 4 : HISTORIQUE
  // ============================================================
  function renderHistory() {
    const tbody = document.getElementById('priceHistoryBody');
    const empty = document.getElementById('historyEmpty');
    const filterVal = document.getElementById('historyProductFilter')?.value || 'all';

    let filtered = [...history].filter(h =>
      filterVal === 'all' || h.product_id === filterVal
    ).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    tbody.innerHTML = filtered.map(h => `
      <tr>
        <td>${h.date ? formatShortDate(h.date) : '—'}</td>
        <td><strong>${h.product_name || '—'}</strong></td>
        <td>${h.supplier_name || '—'}</td>
        <td><strong style="color:var(--primary);">${formatCurrency(h.price)}</strong></td>
        <td>${h.unit || '—'}</td>
        <td class="text-muted">${h.notes || '—'}</td>
      </tr>`).join('');
  }

  function populateHistoryFilter() {
    const sel = document.getElementById('historyProductFilter');
    if (!sel) return;
    const unique = {};
    products.forEach(p => { unique[p.id] = p.name; });
    sel.innerHTML = '<option value="all">Tous les produits</option>' +
      Object.entries(unique).map(([id, name]) =>
        `<option value="${id}">${name}</option>`).join('');
  }

  // ============================================================
  // SUPPLIER CRUD
  // ============================================================
  function openSupplierModal(id = null) {
    document.getElementById('supplierModalId').value = '';
    document.getElementById('supplierName').value = '';
    document.getElementById('supplierCategory').value = 'viande';
    document.getElementById('supplierContact').value = '';
    document.getElementById('supplierEmail').value = '';
    document.getElementById('supplierNotes').value = '';
    document.getElementById('supplierModalTitle').textContent = 'Nouveau fournisseur';

    if (id) {
      const s = suppliers.find(x => x.id === id);
      if (s) {
        document.getElementById('supplierModalId').value = s.id;
        document.getElementById('supplierName').value = s.name || '';
        document.getElementById('supplierCategory').value = s.category || 'viande';
        document.getElementById('supplierContact').value = s.contact || '';
        document.getElementById('supplierEmail').value = s.email || '';
        document.getElementById('supplierNotes').value = s.notes || '';
        document.getElementById('supplierModalTitle').textContent = 'Modifier le fournisseur';
      }
    }
    openModal('supplierModal');
  }

  async function saveSupplier() {
    const id = document.getElementById('supplierModalId').value;
    const name = document.getElementById('supplierName').value.trim();
    if (!name) { showToast('Saisissez un nom de fournisseur', 'warning'); return; }

    const data = {
      name,
      category: document.getElementById('supplierCategory').value,
      contact: document.getElementById('supplierContact').value.trim(),
      email: document.getElementById('supplierEmail').value.trim(),
      notes: document.getElementById('supplierNotes').value.trim(),
      is_active: true
    };

    try {
      if (id) {
        await fetch(`tables/suppliers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        showToast('Fournisseur mis à jour', 'success');
      } else {
        await fetch('tables/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        showToast('Fournisseur ajouté', 'success');
      }
      closeModal('supplierModal');
      await load();
    } catch { showToast('Erreur lors de l\'enregistrement', 'error'); }
  }

  function editSupplier(id) { openSupplierModal(id); }

  function deleteSupplier(id, name) {
    if (confirm(`Supprimer le fournisseur "${name}" et tous ses produits ?`)) {
      fetch(`tables/suppliers/${id}`, { method: 'DELETE' })
        .then(() => { showToast('Fournisseur supprimé', 'success'); load(); });
    }
  }

  // ============================================================
  // PRODUCT CRUD
  // ============================================================
  function populateSupplierSelects() {
    const sel = document.getElementById('spSupplierId');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Sélectionner --</option>' +
      suppliers.map(s => `<option value="${s.id}">${s.name} (${s.category})</option>`).join('');
  }

  function openProductModal(id = null, presetSupplierId = null) {
    document.getElementById('spModalId').value = '';
    document.getElementById('spSupplierId').value = presetSupplierId || '';
    document.getElementById('spName').value = '';
    document.getElementById('spCategory').value = 'épicerie';
    document.getElementById('spPrice').value = '';
    document.getElementById('spUnit').value = 'kg';
    document.getElementById('spDate').value = todayStr();
    document.getElementById('spRecipeIngredient').value = '';
    document.getElementById('spNotes').value = '';
    // Nouveaux champs
    document.getElementById('spPrixTotalHT').value = '';
    document.getElementById('spPoids').value = '';
    document.getElementById('spCalcPriceWrap').style.display = 'none';
    document.getElementById('supplierProductModalTitle').textContent = 'Ajouter un prix produit';

    if (id) {
      const p = products.find(x => x.id === id);
      if (p) {
        document.getElementById('spModalId').value = p.id;
        document.getElementById('spSupplierId').value = p.supplier_id || '';
        document.getElementById('spName').value = p.name || '';
        document.getElementById('spCategory').value = p.category || 'épicerie';
        document.getElementById('spPrice').value = p.current_price || '';
        document.getElementById('spUnit').value = p.unit || 'kg';
        document.getElementById('spDate').value = p.last_updated || todayStr();
        document.getElementById('spRecipeIngredient').value = p.recipe_ingredient || '';
        document.getElementById('spNotes').value = p.notes || '';
        // Nouveaux champs
        const pth = p.prix_total_ht || '';
        const pw  = p.poids || '';
        document.getElementById('spPrixTotalHT').value = pth;
        document.getElementById('spPoids').value = pw;
        if (pth && pw) {
          document.getElementById('spCalcPriceWrap').style.display = '';
          document.getElementById('spCalcPrice').value =
            formatCurrency(parseFloat(pth) / parseFloat(pw));
        }
        document.getElementById('supplierProductModalTitle').textContent = 'Modifier le prix produit';
      }
    }
    openModal('supplierProductModal');
  }

  // Calcul auto prix unitaire depuis prix_total_ht / poids
  function calcUnitPrice() {
    const total = parseFloat(document.getElementById('spPrixTotalHT')?.value) || 0;
    const poids = parseFloat(document.getElementById('spPoids')?.value) || 0;
    const wrap  = document.getElementById('spCalcPriceWrap');
    const calc  = document.getElementById('spCalcPrice');
    const priceInput = document.getElementById('spPrice');
    if (total > 0 && poids > 0) {
      const unitPrice = total / poids;
      if (calc)  calc.value = formatCurrency(unitPrice);
      if (wrap)  wrap.style.display = '';
      // Remplir le prix unitaire automatiquement
      if (priceInput) priceInput.value = unitPrice.toFixed(4);
    } else {
      if (wrap) wrap.style.display = 'none';
    }
  }

  async function saveProduct() {
    const id = document.getElementById('spModalId').value;
    const supplierId = document.getElementById('spSupplierId').value;
    const name = document.getElementById('spName').value.trim();
    const date = document.getElementById('spDate').value || todayStr();

    // Récupérer prix_total_ht et poids pour calcul auto
    const prixTotalHT = parseFloat(document.getElementById('spPrixTotalHT')?.value) || null;
    const poids       = parseFloat(document.getElementById('spPoids')?.value) || null;
    // Prix unitaire : calculé si possible, sinon saisi manuellement
    let price = parseFloat(document.getElementById('spPrice').value);
    if (prixTotalHT > 0 && poids > 0) {
      price = +(prixTotalHT / poids).toFixed(4);
    }

    if (!supplierId) { showToast('Sélectionnez un fournisseur', 'warning'); return; }
    if (!name) { showToast('Saisissez le nom du produit', 'warning'); return; }
    if (!price || price <= 0) { showToast('Saisissez un prix valide (ou renseignez Prix total HT + Poids)', 'warning'); return; }

    const supplier = suppliers.find(s => s.id === supplierId);

    const data = {
      supplier_id: supplierId,
      supplier_name: supplier?.name || '',
      name,
      category: document.getElementById('spCategory').value,
      unit: document.getElementById('spUnit').value,
      current_price: price,
      prix_total_ht: prixTotalHT,
      poids: poids,
      last_updated: date,
      recipe_ingredient: document.getElementById('spRecipeIngredient').value.trim(),
      notes: document.getElementById('spNotes').value.trim()
    };

    try {
      let productId = id;

      if (id) {
        // Si le prix a changé → sauvegarder dans historique
        const existing = products.find(p => p.id === id);
        if (existing && existing.current_price !== price) {
          await saveToHistory(existing, date);
        }
        await fetch(`tables/supplier_products/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        showToast('Prix mis à jour', 'success');
      } else {
        const res = await fetch('tables/supplier_products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const created = await res.json();
        productId = created.id;
        showToast('Produit ajouté à la mercuriale', 'success');
      }

      // Toujours enregistrer dans l'historique à la création/modification
      await saveToHistory({ ...data, id: productId, product_id: productId, product_name: name }, date);

      closeModal('supplierProductModal');
      await load();
    } catch (e) {
      console.error(e);
      showToast('Erreur lors de l\'enregistrement', 'error');
    }
  }

  async function saveToHistory(product, date) {
    await fetch('tables/price_history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: product.id || product.product_id || '',
        product_name: product.name || product.product_name || '',
        supplier_id: product.supplier_id || '',
        supplier_name: product.supplier_name || '',
        price: product.current_price,
        unit: product.unit || '',
        date: date || todayStr(),
        notes: product.notes || ''
      })
    });
  }

  function editProduct(id) { openProductModal(id); }

  function addProductForSupplier(supplierId) {
    populateSupplierSelects();
    openProductModal(null, supplierId);
  }

  async function deleteProduct(id, name) {
    if (confirm(`Supprimer le produit "${name}" ?`)) {
      await fetch(`tables/supplier_products/${id}`, { method: 'DELETE' });
      showToast('Produit supprimé', 'success');
      await load();
    }
  }

  // ============================================================
  // EXPOSE GETTERS (used by pareto + rentabilite)
  // ============================================================
  function getProducts() { return products; }
  function getSuppliers() { return suppliers; }

  // ============================================================
  // HELPERS
  // ============================================================
  function formatCurrency(v) {
    if (v == null || isNaN(v)) return '—';
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v);
  }

  function formatShortDate(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }

  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  function isOlderThan30Days(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const diff = (new Date() - d) / (1000 * 60 * 60 * 24);
    return diff > 30;
  }

  function showToast(msg, type) {
    if (window.toast) window.toast(msg, type);
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    // Tabs
    document.querySelectorAll('.merc-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.merc-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.merc-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        activeTab = btn.dataset.tab;
        document.getElementById(`tab-${activeTab}`)?.classList.add('active');
        renderActiveTab();
      });
    });

    // Supplier actions
    document.getElementById('addSupplierBtn')?.addEventListener('click', () => openSupplierModal());
    document.getElementById('saveSupplierBtn')?.addEventListener('click', saveSupplier);

    // Product actions
    document.getElementById('addSupplierProductBtn')?.addEventListener('click', () => {
      populateSupplierSelects();
      openProductModal();
    });
    document.getElementById('saveSupplierProductBtn')?.addEventListener('click', saveProduct);

    // Search/filter events
    document.getElementById('supplierSearch')?.addEventListener('input', renderBySupplier);
    document.getElementById('supplierCatFilter')?.addEventListener('change', renderBySupplier);
    document.getElementById('productSearch')?.addEventListener('input', renderByProduct);
    document.getElementById('historyProductFilter')?.addEventListener('change', renderHistory);
  }

  // Public API
  return { load, init, getProducts, getSuppliers, editSupplier, deleteSupplier, editProduct, deleteProduct, addProductForSupplier, calcUnitPrice };

})();

// Expose globally so app.js and other modules can reach it via window.Mercuriale
window.Mercuriale = Mercuriale;
