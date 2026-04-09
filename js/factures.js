/* ============================================================
   RESTAÜMANAGER V3 — MODULE FACTURES
   Import PDF simulé → mercuriale → recettes → rentabilité
   ============================================================ */

'use strict';

const Factures = (() => {

  let invoices = [];
  let invoiceLines = [];
  let suppliers = [];
  let supplierProducts = [];
  let pendingLines = []; // lignes en cours d'analyse (avant validation)
  let currentInvoiceStep = 1;
  let currentFile = null;

  // ============================================================
  // SIMULATEUR D'ANALYSE PDF
  // Génère des lignes réalistes depuis le nom du fournisseur
  // ============================================================
  const InvoiceSimulator = {

    // Catalogue produits par catégorie fournisseur
    catalog: {
      viande: [
        { name: 'Entrecôte de bœuf', unit: 'kg', basePrice: 28.5, qtyRange: [2, 15] },
        { name: 'Poulet fermier', unit: 'kg', basePrice: 6.8, qtyRange: [5, 20] },
        { name: 'Côte de porc', unit: 'kg', basePrice: 9.5, qtyRange: [3, 12] },
        { name: 'Escalope de veau', unit: 'kg', basePrice: 22.0, qtyRange: [2, 8] },
        { name: 'Lardons fumés', unit: 'kg', basePrice: 8.2, qtyRange: [1, 5] },
        { name: 'Filet de bœuf', unit: 'kg', basePrice: 45.0, qtyRange: [1, 5] },
      ],
      BOF: [
        { name: 'Beurre doux', unit: 'kg', basePrice: 8.2, qtyRange: [2, 10] },
        { name: 'Crème fraîche 35%', unit: 'litre', basePrice: 4.9, qtyRange: [3, 15] },
        { name: 'Œufs frais (boîte 12)', unit: 'pièce', basePrice: 3.8, qtyRange: [5, 20] },
        { name: 'Parmesan râpé', unit: 'kg', basePrice: 18.5, qtyRange: [1, 4] },
        { name: 'Gruyère AOP', unit: 'kg', basePrice: 14.2, qtyRange: [1, 5] },
      ],
      épicerie: [
        { name: 'Pâtes fraîches', unit: 'kg', basePrice: 4.2, qtyRange: [3, 15] },
        { name: 'Farine T45', unit: 'kg', basePrice: 0.9, qtyRange: [5, 25] },
        { name: 'Sucre fin', unit: 'kg', basePrice: 1.1, qtyRange: [3, 10] },
        { name: 'Sel fin', unit: 'kg', basePrice: 1.2, qtyRange: [2, 8] },
        { name: 'Huile d\'olive vierge', unit: 'litre', basePrice: 8.5, qtyRange: [2, 8] },
        { name: 'Vinaigre de vin', unit: 'litre', basePrice: 3.2, qtyRange: [1, 5] },
      ],
      légumes: [
        { name: 'Oignons', unit: 'kg', basePrice: 1.4, qtyRange: [5, 20] },
        { name: 'Salade romaine', unit: 'pièce', basePrice: 1.8, qtyRange: [10, 40] },
        { name: 'Tomates rondes', unit: 'kg', basePrice: 2.9, qtyRange: [5, 20] },
        { name: 'Champignons de Paris', unit: 'kg', basePrice: 4.5, qtyRange: [2, 10] },
        { name: 'Pommes de terre', unit: 'kg', basePrice: 1.2, qtyRange: [10, 30] },
        { name: 'Carottes', unit: 'kg', basePrice: 0.9, qtyRange: [3, 12] },
      ],
      boisson: [
        { name: 'Vin rouge maison', unit: 'bouteille', basePrice: 7.5, qtyRange: [6, 24] },
        { name: 'Vin blanc sec', unit: 'bouteille', basePrice: 6.8, qtyRange: [6, 18] },
        { name: 'Eau minérale plate 1L', unit: 'carton', basePrice: 8.5, qtyRange: [3, 10] },
        { name: 'Café expresso grain', unit: 'kg', basePrice: 22.0, qtyRange: [1, 5] },
      ],
      poisson: [
        { name: 'Saumon frais', unit: 'kg', basePrice: 18.5, qtyRange: [2, 8] },
        { name: 'Cabillaud filet', unit: 'kg', basePrice: 16.0, qtyRange: [2, 6] },
        { name: 'Crevettes décortiquées', unit: 'kg', basePrice: 24.0, qtyRange: [1, 4] },
      ],
      autres: [
        { name: 'Produit A', unit: 'pièce', basePrice: 5.0, qtyRange: [2, 10] },
        { name: 'Produit B', unit: 'kg', basePrice: 8.0, qtyRange: [1, 5] },
      ]
    },

    analyze(supplier, filename) {
      const category = supplier?.category || 'autres';
      const products = this.catalog[category] || this.catalog.autres;

      // Sélectionner 3 à 7 produits aléatoirement
      const count = Math.floor(Math.random() * 4) + 3;
      const shuffled = [...products].sort(() => Math.random() - 0.5).slice(0, count);

      return shuffled.map(p => {
        const qty = +(Math.random() * (p.qtyRange[1] - p.qtyRange[0]) + p.qtyRange[0]).toFixed(1);
        // Variation réaliste du prix (±8%)
        const priceVariation = 1 + (Math.random() * 0.16 - 0.08);
        const unitPrice = +(p.basePrice * priceVariation).toFixed(2);
        const total = +(qty * unitPrice).toFixed(2);

        // Chercher si ce produit existe dans la mercuriale
        const matched = supplierProducts.find(sp =>
          sp.name.toLowerCase().includes(p.name.toLowerCase().split(' ')[0]) ||
          p.name.toLowerCase().includes(sp.name.toLowerCase().split(' ')[0])
        );

        return {
          product_name: p.name,
          quantity: qty,
          unit: p.unit,
          unit_price: unitPrice,
          total_price: total,
          supplier_product_id: matched?.id || '',
          matched: !!matched,
          _matched_name: matched?.name || '',
          _edited: false
        };
      });
    }
  };

  // ============================================================
  // LOAD
  // ============================================================
  // Helper : query string avec restaurant_id courant
  function rQS(base = 'limit=500') {
    const ctx = window.RestaurantCtx;
    if (!ctx || !ctx.currentId() || ctx.isGlobal()) return base;
    return `${base}&restaurant_id=${encodeURIComponent(ctx.currentId())}`;
  }

  async function load() {
    // Garde multi-restaurants
    if (window.RestaurantCtx && !window.RestaurantCtx.guardDisplay('Factures')) return;
    try {
      const [invRes, linesRes, supRes, prodRes] = await Promise.all([
        fetch(`tables/invoices?${rQS('limit=500')}`).then(r => r.json()),
        fetch(`tables/invoice_lines?${rQS('limit=1000')}`).then(r => r.json()),
        fetch('tables/suppliers?limit=500').then(r => r.json()),
        fetch('tables/supplier_products?limit=500').then(r => r.json())
      ]);

      invoices = invRes.data || [];
      invoiceLines = linesRes.data || [];
      suppliers = supRes.data || [];
      supplierProducts = prodRes.data || [];

      updateKPIs();
      renderInvoices();
      populateFilters();
      updateNavBadge();
    } catch (e) {
      console.error('Factures load error:', e);
      showToast('Erreur chargement factures', 'error');
    }
  }

  function updateKPIs() {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const pending = invoices.filter(i => i.status === 'pending').length;
    const monthInvoices = invoices.filter(i => i.invoice_date?.startsWith(thisMonth));
    const monthTotal = monthInvoices.reduce((s, i) => s + (i.total_amount || 0), 0);

    // Produits mis à jour depuis les factures (lignes importées ce mois)
    const updatedProducts = new Set(
      invoiceLines
        .filter(l => l.invoice_date?.startsWith(thisMonth) && l.supplier_product_id)
        .map(l => l.supplier_product_id)
    ).size;

    document.getElementById('kpiInvoicesTotal').textContent = invoices.length;
    document.getElementById('kpiInvoicesPending').textContent = pending;
    document.getElementById('kpiInvoicesMonth').textContent = formatCurrency(monthTotal);
    document.getElementById('kpiProductsUpdated').textContent = updatedProducts;

    // Alert pending
    const alert = document.getElementById('pendingInvoicesAlert');
    if (alert) {
      if (pending > 0) {
        alert.style.display = 'flex';
        document.getElementById('pendingInvoicesText').textContent =
          `${pending} facture(s) en attente de validation — Validez pour mettre à jour la mercuriale.`;
      } else {
        alert.style.display = 'none';
      }
    }
  }

  function updateNavBadge() {
    const pending = invoices.filter(i => i.status === 'pending').length;
    const badge = document.getElementById('invoicesBadge');
    if (!badge) return;
    if (pending > 0) {
      badge.style.display = 'flex';
      badge.textContent = pending;
    } else {
      badge.style.display = 'none';
    }
  }

  function populateFilters() {
    // Supplier filter
    const sel = document.getElementById('invoiceSupplierFilter');
    if (!sel) return;
    const used = [...new Set(invoices.map(i => i.supplier_name).filter(Boolean))];
    sel.innerHTML = '<option value="all">Tous fournisseurs</option>' +
      used.map(s => `<option value="${s}">${s}</option>`).join('');

    // Supplier select in modal
    const modalSel = document.getElementById('invoiceSupplierSelect');
    if (modalSel) {
      modalSel.innerHTML = '<option value="">-- Sélectionner --</option>' +
        suppliers.map(s => `<option value="${s.id}" data-category="${s.category}">${s.name} (${s.category})</option>`).join('');
    }
  }

  // ============================================================
  // RENDER INVOICES LIST
  // ============================================================
  function renderInvoices(filterStatus = 'all', filterSupplier = 'all', search = '') {
    const container = document.getElementById('invoicesList');
    const empty = document.getElementById('invoicesEmpty');

    let filtered = invoices.filter(i => {
      const matchStatus = filterStatus === 'all' || i.status === filterStatus;
      const matchSupplier = filterSupplier === 'all' || i.supplier_name === filterSupplier;
      const matchSearch = !search ||
        (i.supplier_name || '').toLowerCase().includes(search.toLowerCase()) ||
        (i.invoice_number || '').toLowerCase().includes(search.toLowerCase());
      return matchStatus && matchSupplier && matchSearch;
    }).sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || ''));

    if (filtered.length === 0) {
      container.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    container.innerHTML = filtered.map(inv => {
      const lines = invoiceLines.filter(l => l.invoice_id === inv.id);
      const statusInfo = {
        pending: { label: '⏳ En attente', cls: 'badge-warning' },
        validated: { label: '✅ Validée', cls: 'badge-connected' },
        imported: { label: '🔄 Importée', cls: 'badge-zelty' }
      };
      const st = statusInfo[inv.status] || statusInfo.pending;

      return `
        <div class="invoice-card ${inv.status}">
          <div class="invoice-card-header">
            <div class="invoice-meta">
              <span class="invoice-supplier"><i class="fas fa-truck"></i> ${inv.supplier_name || '—'}</span>
              <span class="invoice-number">${inv.invoice_number || 'Sans numéro'}</span>
            </div>
            <div class="invoice-right">
              <span class="badge ${st.cls}">${st.label}</span>
              <span class="invoice-total">${formatCurrency(inv.total_amount)}</span>
            </div>
          </div>
          <div class="invoice-card-body">
            <div class="invoice-lines-preview">
              ${lines.slice(0, 3).map(l => `
                <span class="invoice-line-chip ${l.matched ? 'matched' : 'unmatched'}">
                  <i class="fas fa-${l.matched ? 'link' : 'unlink'}"></i>
                  ${l.product_name} — ${formatCurrency(l.unit_price)}/${l.unit}
                </span>`).join('')}
              ${lines.length > 3 ? `<span class="invoice-line-chip">+${lines.length - 3} autres</span>` : ''}
            </div>
            <div class="invoice-card-footer">
              <span class="text-muted text-sm"><i class="fas fa-calendar"></i> ${formatDate(inv.invoice_date)} · ${inv.lines_count || lines.length} ligne(s)</span>
              <div class="btn-group">
                ${inv.status === 'pending' ? `
                  <button class="btn btn-primary btn-sm" onclick="Factures.validateInvoice('${inv.id}')">
                    <i class="fas fa-check"></i> Valider & importer
                  </button>` : ''}
                <button class="btn btn-secondary btn-sm" onclick="Factures.showInvoiceDetail('${inv.id}')">
                  <i class="fas fa-eye"></i> Détail
                </button>
                <button class="btn btn-secondary btn-sm" onclick="Factures.deleteInvoice('${inv.id}')">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // ============================================================
  // IMPORT WORKFLOW
  // ============================================================
  function openImportModal() {
    currentInvoiceStep = 1;
    currentFile = null;
    pendingLines = [];
    document.getElementById('invoiceStep1').style.display = 'block';
    document.getElementById('invoiceStep2').style.display = 'none';
    document.getElementById('invoiceAnalyzeBtn').style.display = 'inline-flex';
    document.getElementById('invoiceDateInput').value = todayStr();
    document.getElementById('invoiceNumberInput').value = '';
    resetDropZone();

    // Populate supplier select
    const sel = document.getElementById('invoiceSupplierSelect');
    if (sel) {
      sel.innerHTML = '<option value="">-- Sélectionner --</option>' +
        suppliers.map(s => `<option value="${s.id}" data-category="${s.category}">${s.name}</option>`).join('');
    }
    openModal('invoiceImportModal');
  }

  function resetDropZone() {
    const zone = document.getElementById('pdfDropZone');
    if (zone) zone.classList.remove('has-file');
    document.getElementById('dropContent').innerHTML = `
      <i class="fas fa-file-pdf"></i>
      <p class="drop-title">Glissez votre facture ici</p>
      <p class="drop-sub">PDF, image ou CSV acceptés</p>
      <button type="button" class="btn btn-outline" onclick="document.getElementById('pdfFileInput').click()">
        <i class="fas fa-folder-open"></i> Parcourir
      </button>`;
    document.getElementById('pdfFileInput').value = '';
  }

  function handleFileSelect(file) {
    if (!file) return;
    currentFile = file;
    const zone = document.getElementById('pdfDropZone');
    zone.classList.add('has-file');
    document.getElementById('dropContent').innerHTML = `
      <i class="fas fa-file-check" style="color:var(--success);"></i>
      <p class="drop-title" style="color:var(--success);">${file.name}</p>
      <p class="drop-sub">${(file.size / 1024).toFixed(0)} Ko — Prêt pour analyse</p>
      <button type="button" class="btn btn-outline" onclick="document.getElementById('pdfFileInput').click()">
        <i class="fas fa-redo"></i> Changer
      </button>`;
  }

  async function analyzeInvoice() {
    const supplierId = document.getElementById('invoiceSupplierSelect').value;
    const date = document.getElementById('invoiceDateInput').value;

    if (!supplierId) { showToast('Sélectionnez un fournisseur', 'warning'); return; }
    if (!date) { showToast('Saisissez la date de facture', 'warning'); return; }
    if (!currentFile) { showToast('Importez d\'abord un fichier', 'warning'); return; }

    const supplier = suppliers.find(s => s.id === supplierId);

    // Animation d'analyse
    const btn = document.getElementById('invoiceAnalyzeBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Analyse en cours...';

    await new Promise(r => setTimeout(r, 1800)); // Simulation traitement

    // Générer les lignes simulées
    pendingLines = InvoiceSimulator.analyze(supplier, currentFile?.name);

    // Passer à l'étape 2
    document.getElementById('invoiceStep1').style.display = 'none';
    document.getElementById('invoiceStep2').style.display = 'block';
    btn.innerHTML = '<i class="fas fa-check"></i> Valider & importer dans la mercuriale';
    btn.disabled = false;
    btn.onclick = () => importInvoice(supplierId, supplier?.name, date);

    // Info
    const matchedCount = pendingLines.filter(l => l.matched).length;
    document.getElementById('analysisInfo').innerHTML = `
      <div class="analysis-badge">
        <i class="fas fa-magic" style="color:var(--primary)"></i>
        <strong>${pendingLines.length} lignes détectées</strong>
        &nbsp;·&nbsp;
        <span style="color:var(--success);"><i class="fas fa-link"></i> ${matchedCount} liées à la mercuriale</span>
        &nbsp;·&nbsp;
        <span style="color:var(--warning);"><i class="fas fa-unlink"></i> ${pendingLines.length - matchedCount} nouvelles</span>
      </div>`;

    renderPendingLines();
  }

  function renderPendingLines() {
    const tbody = document.getElementById('invoiceLinesBody');
    let total = 0;

    tbody.innerHTML = pendingLines.map((line, idx) => {
      total += line.total_price || 0;
      // Construire la liste datalist pour l'auto-complétion
      const dlId = `dl-prod-${idx}`;
      const dlHTML = `<datalist id="${dlId}">${supplierProducts.map(sp =>
        `<option value="${sp.name}" data-id="${sp.id}" data-price="${sp.current_price}" data-unit="${sp.unit}"></option>`
      ).join('')}</datalist>`;

      // Calcul prix unitaire depuis total / quantité
      const calcUnit = (line.total_price > 0 && line.quantity > 0)
        ? formatCurrency(line.total_price / line.quantity)
        : '—';

      return `
        ${dlHTML}
        <tr class="${line.matched ? 'row-matched' : 'row-new'}">
          <td>
            <input type="text" class="inline-input" value="${line.product_name}"
              list="${dlId}"
              oninput="Factures.updateLine(${idx},'product_name',this.value)"
              onchange="Factures.applyAutoComplete(${idx},this)" />
            ${line.matched
              ? `<span style="font-size:10px;color:var(--success);"><i class="fas fa-link"></i> ${line._matched_name}</span>`
              : `<span style="font-size:10px;color:var(--warning);"><i class="fas fa-plus"></i> Nouveau</span>`}
          </td>
          <td>
            <input type="number" class="inline-input inline-qty" value="${line.quantity}"
              onchange="Factures.updateLine(${idx},'quantity',parseFloat(this.value))" step="0.001" min="0" />
          </td>
          <td>
            <select class="inline-select" onchange="Factures.updateLine(${idx},'unit',this.value)">
              ${['kg','pièce','litre','boîte','lot','barquette','carton','bouteille','g','ml'].map(u =>
                `<option ${u === line.unit ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </td>
          <td>
            <!-- Prix total HT de cette ligne -->
            <input type="number" class="inline-input inline-price" value="${line.total_price || ''}"
              placeholder="Total HT"
              onchange="Factures.updateLine(${idx},'total_price',parseFloat(this.value)||0)" step="0.01" min="0" />
          </td>
          <td>
            <!-- Prix unitaire : calculé = total / qte, lecture seule -->
            <span style="font-weight:600;color:var(--primary);font-size:13px;">${calcUnit}</span>
          </td>
          <td>
            <select class="inline-select" onchange="Factures.updateLine(${idx},'supplier_product_id',this.value)">
              <option value="">Nouveau</option>
              ${supplierProducts.map(sp => `<option value="${sp.id}" ${sp.id === line.supplier_product_id ? 'selected' : ''}>${sp.name}</option>`).join('')}
            </select>
          </td>
          <td>
            <button class="icon-btn danger" onclick="Factures.removeLine(${idx})" title="Supprimer">
              <i class="fas fa-times"></i>
            </button>
          </td>
        </tr>`;
    }).join('');

    document.getElementById('invoiceGrandTotal').textContent = formatCurrency(total);
  }

  // Auto-complétion : lorsqu'un nom de produit existant est choisi dans le datalist
  function applyAutoComplete(idx, inputEl) {
    const val = inputEl.value;
    const sp  = supplierProducts.find(p => p.name === val);
    if (sp && pendingLines[idx]) {
      pendingLines[idx].supplier_product_id = sp.id;
      pendingLines[idx]._matched_name       = sp.name;
      pendingLines[idx].matched             = true;
      pendingLines[idx].unit                = sp.unit || pendingLines[idx].unit;
      renderPendingLines();
    }
  }

  // Édition inline des lignes
  function updateLine(idx, field, value) {
    if (pendingLines[idx]) {
      pendingLines[idx][field] = value;
      // Recalcul prix unitaire à partir de total_price / quantity
      const ln = pendingLines[idx];
      if (field === 'total_price' || field === 'quantity') {
        if (ln.quantity > 0 && ln.total_price > 0) {
          ln.unit_price = +(ln.total_price / ln.quantity).toFixed(4);
        }
      }
      renderPendingLines();
    }
  }

  function removeLine(idx) {
    pendingLines.splice(idx, 1);
    renderPendingLines();
  }

  function addManualLine() {
    pendingLines.push({
      product_name: 'Nouveau produit', quantity: 1, unit: 'kg',
      unit_price: 0, total_price: 0, supplier_product_id: '', matched: false, _matched_name: ''
    });
    renderPendingLines();
  }

  // ============================================================
  // IMPORT DANS LA MERCURIALE
  // ============================================================
  async function importInvoice(supplierId, supplierName, date) {
    const btn = document.getElementById('invoiceAnalyzeBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Import en cours...';

    try {
      const totalAmount = pendingLines.reduce((s, l) => s + (l.total_price || 0), 0);
      const invoiceNumber = document.getElementById('invoiceNumberInput').value.trim() ||
        `FA-${date.replace(/-/g, '')}-${Math.floor(Math.random() * 999) + 1}`;

      // 1. Créer la facture (avec restaurant_id)
      const restoId = window.RestaurantCtx?.currentId() || 'default';
      const invRes = await fetch('tables/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: supplierId,
          supplier_name: supplierName,
          invoice_number: invoiceNumber,
          invoice_date: date,
          total_amount: totalAmount,
          lines_count: pendingLines.length,
          status: 'pending',
          filename: currentFile?.name || 'facture.pdf',
          notes: '',
          restaurant_id: restoId
        })
      });
      const invoice = await invRes.json();

      // 2. Enregistrer les lignes + mise à jour mercuriale
      let updatedCount = 0;
      for (const line of pendingLines) {
        // Créer la ligne de facture
        await fetch('tables/invoice_lines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoice_id: invoice.id,
            supplier_id: supplierId,
            supplier_name: supplierName,
            invoice_date: date,
            product_name: line.product_name,
            quantity: line.quantity,
            unit: line.unit,
            unit_price: line.unit_price,
            total_price: line.total_price,
            supplier_product_id: line.supplier_product_id,
            matched: line.matched || !!line.supplier_product_id,
            restaurant_id: restoId
          })
        });

        // Mettre à jour ou créer dans la mercuriale
        // Prix unitaire = total_price / quantity si disponible
        const computedUnitPrice = (line.quantity > 0 && line.total_price > 0)
          ? +(line.total_price / line.quantity).toFixed(4)
          : (line.unit_price || 0);

        if (line.supplier_product_id) {
          // Update prix existant + prix_total_ht + poids
          const existing = supplierProducts.find(p => p.id === line.supplier_product_id);
          if (existing) {
            await fetch(`tables/supplier_products/${line.supplier_product_id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...existing,
                current_price:  computedUnitPrice,
                prix_total_ht:  line.total_price || null,
                poids:          line.quantity    || null,
                unit:           line.unit,
                last_updated:   date
              })
            });
            // Archiver dans l'historique
            await fetch('tables/price_history', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                product_id:    line.supplier_product_id,
                product_name:  line.product_name,
                supplier_id:   supplierId,
                supplier_name: supplierName,
                price:         computedUnitPrice,
                unit:          line.unit,
                date,
                notes: `Import facture ${invoiceNumber}`
              })
            });
            updatedCount++;
          }
        } else {
          // Créer nouveau produit mercuriale avec prix_total_ht et poids
          const newProd = await fetch('tables/supplier_products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              supplier_id:       supplierId,
              supplier_name:     supplierName,
              name:              line.product_name,
              category:          suppliers.find(s => s.id === supplierId)?.category || 'autres',
              unit:              line.unit,
              current_price:     computedUnitPrice,
              prix_total_ht:     line.total_price || null,
              poids:             line.quantity    || null,
              last_updated:      date,
              recipe_ingredient: '',
              notes:             `Créé depuis facture ${invoiceNumber}`
            })
          });
          const created = await newProd.json();
          await fetch('tables/price_history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              product_id:    created.id,
              product_name:  line.product_name,
              supplier_id:   supplierId,
              supplier_name: supplierName,
              price:         computedUnitPrice,
              unit:          line.unit,
              date,
              notes: `Import facture ${invoiceNumber}`
            })
          });
          updatedCount++;
        }
      }

      // 3. Valider la facture
      await fetch(`tables/invoices/${invoice.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: supplierId, supplier_name: supplierName,
          invoice_number: invoiceNumber, invoice_date: date,
          total_amount: totalAmount, lines_count: pendingLines.length,
          status: 'imported', filename: currentFile?.name || 'facture.pdf', notes: ''
        })
      });

      closeModal('invoiceImportModal');
      showToast(`✅ Facture importée — ${updatedCount} produit(s) mis à jour dans la mercuriale`, 'success');

      // Refresh
      await load();

      // Déclencher la mise à jour des recettes liées
      if (window.RecipeIngredientsManager) {
        await RecipeIngredientsManager.refreshAllRecipeCosts();
      }

    } catch (e) {
      console.error('Import error:', e);
      showToast('Erreur lors de l\'import', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check"></i> Valider & importer dans la mercuriale';
    }
  }

  // ============================================================
  // VALIDATE (depuis la liste)
  // ============================================================
  async function validateInvoice(invoiceId) {
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) return;

    try {
      await fetch(`tables/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...inv, status: 'validated' })
      });
      showToast('Facture validée', 'success');
      await load();
    } catch { showToast('Erreur validation', 'error'); }
  }

  // ============================================================
  // DETAIL (affichage inline)
  // ============================================================
  function showInvoiceDetail(invoiceId) {
    const inv = invoices.find(i => i.id === invoiceId);
    const lines = invoiceLines.filter(l => l.invoice_id === invoiceId);
    if (!inv) return;

    const content = `
      <div style="margin-bottom:12px;">
        <strong>${inv.supplier_name}</strong> — ${inv.invoice_number} — ${formatDate(inv.invoice_date)}
      </div>
      <table class="data-table" style="font-size:13px;">
        <thead><tr><th>Produit</th><th>Qté</th><th>Unité</th><th>Prix HT</th><th>Total</th><th>Mercuriale</th></tr></thead>
        <tbody>
          ${lines.map(l => `
            <tr>
              <td>${l.product_name}</td>
              <td>${l.quantity}</td>
              <td>${l.unit}</td>
              <td>${formatCurrency(l.unit_price)}</td>
              <td><strong>${formatCurrency(l.total_price)}</strong></td>
              <td>${l.matched ? '<span style="color:var(--success);"><i class="fas fa-check-circle"></i> Lié</span>' : '<span style="color:var(--text-muted);">—</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div style="text-align:right;margin-top:12px;font-size:16px;font-weight:700;">
        Total : ${formatCurrency(inv.total_amount)}
      </div>`;

    // Injecter dans un mini modal ou alerte
    const existing = document.getElementById('invoiceDetailInline');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'invoiceDetailInline';
    el.className = 'invoice-detail-panel';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h4 style="font-weight:700;"><i class="fas fa-file-invoice"></i> Détail facture</h4>
        <button onclick="document.getElementById('invoiceDetailInline').remove()" class="icon-btn">
          <i class="fas fa-times"></i>
        </button>
      </div>
      ${content}`;
    document.getElementById('invoicesList').prepend(el);
    el.scrollIntoView({ behavior: 'smooth' });
  }

  async function deleteInvoice(id) {
    if (!confirm('Supprimer cette facture et ses lignes ?')) return;
    await fetch(`tables/invoices/${id}`, { method: 'DELETE' });
    showToast('Facture supprimée', 'success');
    await load();
  }

  function showPending() {
    const statusFilter = document.getElementById('invoiceStatusFilter');
    if (statusFilter) {
      statusFilter.value = 'pending';
      applyFilters();
    }
  }

  function applyFilters() {
    const search = document.getElementById('invoiceSearch')?.value || '';
    const status = document.getElementById('invoiceStatusFilter')?.value || 'all';
    const supplier = document.getElementById('invoiceSupplierFilter')?.value || 'all';
    renderInvoices(status, supplier, search);
  }

  // ============================================================
  // EXPOSE DONNÉES POUR PARETO
  // ============================================================
  function getInvoiceLines() { return invoiceLines; }
  function getInvoices() { return invoices; }

  // ============================================================
  // HELPERS
  // ============================================================
  function formatCurrency(v) {
    if (v == null || isNaN(v)) return '—';
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v);
  }

  function formatDate(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }

  function todayStr() { return new Date().toISOString().split('T')[0]; }

  function showToast(msg, type) { if (window.toast) window.toast(msg, type); }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    document.getElementById('importInvoiceBtn')?.addEventListener('click', openImportModal);
    document.getElementById('invoiceAnalyzeBtn')?.addEventListener('click', analyzeInvoice);
    document.getElementById('addInvoiceLineBtn')?.addEventListener('click', addManualLine);

    // File input
    const fileInput = document.getElementById('pdfFileInput');
    fileInput?.addEventListener('change', e => handleFileSelect(e.target.files[0]));

    // Drag & drop
    const dropZone = document.getElementById('pdfDropZone');
    if (dropZone) {
      dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
      dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFileSelect(e.dataTransfer.files[0]);
      });
    }

    // Filters
    document.getElementById('invoiceSearch')?.addEventListener('input', applyFilters);
    document.getElementById('invoiceStatusFilter')?.addEventListener('change', applyFilters);
    document.getElementById('invoiceSupplierFilter')?.addEventListener('change', applyFilters);
  }

  return { load, init, validateInvoice, deleteInvoice, showInvoiceDetail, showPending, updateLine, removeLine, applyAutoComplete, getInvoiceLines, getInvoices };

})();

window.Factures = Factures;
