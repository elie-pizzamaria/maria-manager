/* ============================================================
   RESTAÜMANAGER V3 — MODULE PARETO (ANALYSE ACHATS)
   Loi 80/20 — Données réelles depuis factures + ventes + recettes
   Filtres : période + fournisseur
   ============================================================ */

'use strict';

const Pareto = (() => {

  let paretoData = [];
  let chartInstance = null;
  let allInvoiceLines = [];
  let allSuppliers = [];
  let activeFilterPeriod = 'all';
  let activeFilterSupplier = 'all';

  // ============================================================
  // LOAD & COMPUTE
  // ============================================================
  async function load() {
    try {
      const [salesRes, recipesRes, prodRes, invLinesRes, supRes] = await Promise.all([
        fetch('tables/sales?limit=500').then(r => r.json()),
        fetch('tables/recipes?limit=500').then(r => r.json()),
        fetch('tables/supplier_products?limit=500').then(r => r.json()),
        fetch('tables/invoice_lines?limit=1000').then(r => r.json()),
        fetch('tables/suppliers?limit=500').then(r => r.json())
      ]);

      const sales = salesRes.data || [];
      const recipes = recipesRes.data || [];
      const supplierProducts = prodRes.data || [];
      allInvoiceLines = invLinesRes.data || [];
      allSuppliers = supRes.data || [];

      renderFilters();
      computeAndRender(sales, recipes, supplierProducts);
    } catch (e) {
      console.error('Pareto load error:', e);
      showToast('Erreur chargement analyse achats', 'error');
    }
  }

  function renderFilters() {
    // Inject filter bar into pareto page if not yet done
    let filterBar = document.getElementById('paretoFilterBar');
    if (!filterBar) {
      filterBar = document.createElement('div');
      filterBar.id = 'paretoFilterBar';
      filterBar.className = 'filters-bar';
      filterBar.innerHTML = `
        <select class="select-filter" id="paretoPeriodFilter">
          <option value="all">Toute la période</option>
          <option value="month">Ce mois</option>
          <option value="quarter">Ce trimestre</option>
          <option value="last30">30 derniers jours</option>
        </select>
        <select class="select-filter" id="paretoSupplierFilter">
          <option value="all">Tous fournisseurs</option>
          ${allSuppliers.map(s => `<option value="${s.name}">${s.name}</option>`).join('')}
        </select>
        <span class="text-muted text-sm" id="paretoDataSource"></span>`;

      const pageEl = document.getElementById('page-pareto');
      const insight = document.getElementById('paretoInsight');
      if (pageEl && insight) pageEl.insertBefore(filterBar, insight);

      document.getElementById('paretoPeriodFilter')?.addEventListener('change', e => {
        activeFilterPeriod = e.target.value;
        recomputeWithFilters();
      });
      document.getElementById('paretoSupplierFilter')?.addEventListener('change', e => {
        activeFilterSupplier = e.target.value;
        recomputeWithFilters();
      });
    }
  }

  async function recomputeWithFilters() {
    const [salesRes, recipesRes, prodRes] = await Promise.all([
      fetch('tables/sales?limit=500').then(r => r.json()),
      fetch('tables/recipes?limit=500').then(r => r.json()),
      fetch('tables/supplier_products?limit=500').then(r => r.json())
    ]);
    computeAndRender(salesRes.data || [], recipesRes.data || [], prodRes.data || []);
  }

  function getFilteredInvoiceLines() {
    const now = new Date();
    return allInvoiceLines.filter(l => {
      // Filtre période
      if (activeFilterPeriod !== 'all' && l.invoice_date) {
        const d = new Date(l.invoice_date);
        if (activeFilterPeriod === 'month') {
          if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
        } else if (activeFilterPeriod === 'quarter') {
          const quarter = Math.floor(now.getMonth() / 3);
          const dQuarter = Math.floor(d.getMonth() / 3);
          if (dQuarter !== quarter || d.getFullYear() !== now.getFullYear()) return false;
        } else if (activeFilterPeriod === 'last30') {
          if ((now - d) / (1000 * 60 * 60 * 24) > 30) return false;
        }
      }
      // Filtre fournisseur
      if (activeFilterSupplier !== 'all' && l.supplier_name !== activeFilterSupplier) return false;
      return true;
    });
  }

  function computeAndRender(sales, recipes, supplierProducts) {
    const filteredLines = getFilteredInvoiceLines();
    const hasRealData = filteredLines.length > 0;

    // Source info
    const sourceEl = document.getElementById('paretoDataSource');
    if (sourceEl) {
      sourceEl.innerHTML = hasRealData
        ? `<i class="fas fa-file-invoice" style="color:var(--success)"></i> <strong>${filteredLines.length}</strong> lignes factures réelles`
        : `<i class="fas fa-calculator" style="color:var(--warning)"></i> Estimation (pas encore de factures)`;
    }

    paretoData = hasRealData
      ? computeFromInvoices(filteredLines)
      : compute(sales, recipes, supplierProducts);

    renderKPIs();
    renderChart();
    renderTable();
    renderInsight();
  }

  // ============================================================
  // CALCUL DEPUIS FACTURES RÉELLES (prioritaire)
  // ============================================================
  function computeFromInvoices(lines) {
    const productMap = {};

    lines.forEach(l => {
      const key = (l.product_name || '').toLowerCase().trim();
      if (!productMap[key]) {
        productMap[key] = {
          name: l.product_name,
          supplier: l.supplier_name || '—',
          totalCost: 0,
          totalQty: 0,
          unit: l.unit || '—',
          source: 'factures'
        };
      }
      productMap[key].totalCost += l.total_price || 0;
      productMap[key].totalQty += l.quantity || 0;
    });

    const sorted = Object.values(productMap)
      .filter(p => p.totalCost > 0)
      .sort((a, b) => b.totalCost - a.totalCost);

    const grandTotal = sorted.reduce((s, p) => s + p.totalCost, 0);
    let cumul = 0;

    return sorted.map((p, i) => {
      cumul += p.totalCost;
      const pct = grandTotal > 0 ? (p.totalCost / grandTotal * 100) : 0;
      const cumulPct = grandTotal > 0 ? (cumul / grandTotal * 100) : 0;
      return { ...p, rank: i + 1, pct: pct.toFixed(1), cumulPct: parseFloat(cumulPct.toFixed(1)), isTop: cumulPct <= 80 || i === 0, grandTotal };
    });
  }

  // ============================================================
  // CALCUL PARETO
  // Logique : pour chaque recette vendue, on calcule le coût matière
  // basé sur le prix d'achat fournisseur ou le coût saisi sur la recette.
  // On regroupe ensuite par "produit/ingrédient" et on trie.
  // ============================================================
  function compute(sales, recipes, supplierProducts) {
    // Map recettes par id
    const recipeMap = {};
    recipes.forEach(r => { recipeMap[r.id] = r; });

    // Map prix fournisseur par nom d'ingrédient (normalize)
    const supplierPriceMap = {};
    supplierProducts.forEach(p => {
      const key = (p.recipe_ingredient || p.name || '').toLowerCase().trim();
      if (key && (!supplierPriceMap[key] || p.current_price < supplierPriceMap[key].price)) {
        supplierPriceMap[key] = {
          price: p.current_price,
          unit: p.unit,
          supplier: p.supplier_name,
          product: p.name
        };
      }
    });

    // Agréger les coûts par produit/recette à partir des ventes
    const productCosts = {};

    sales.forEach(sale => {
      const recipe = recipeMap[sale.recipe_id];
      const qty = sale.quantity || 1;

      if (!recipe) {
        // Vente sans recette : utiliser le montant brut comme proxy
        const key = (sale.recipe_name || 'Inconnu').toLowerCase().trim();
        if (!productCosts[key]) {
          productCosts[key] = {
            name: sale.recipe_name || 'Inconnu',
            supplier: '—',
            totalCost: 0,
            totalQty: 0,
            unit: 'pièce',
            source: 'vente'
          };
        }
        // Estimer 30% food cost par défaut
        productCosts[key].totalCost += (sale.total_amount || 0) * 0.30;
        productCosts[key].totalQty += qty;
        return;
      }

      const costPerUnit = recipe.cost || 0;
      const recipeName = (recipe.name || '').toLowerCase().trim();

      // Chercher si un prix fournisseur correspond
      let finalCost = costPerUnit;
      let supplierName = '—';
      let unit = 'pièce';

      // Chercher par nom de recette ou ingrédient lié
      const spMatch = supplierPriceMap[recipeName];
      if (spMatch) {
        finalCost = spMatch.price;
        supplierName = spMatch.supplier;
        unit = spMatch.unit;
      }

      const key = recipe.id;
      if (!productCosts[key]) {
        productCosts[key] = {
          name: recipe.name || 'Inconnu',
          supplier: supplierName,
          totalCost: 0,
          totalQty: 0,
          unit,
          costPerUnit: finalCost,
          source: 'recette'
        };
      }
      productCosts[key].totalCost += finalCost * qty;
      productCosts[key].totalQty += qty;
      if (supplierName !== '—') productCosts[key].supplier = supplierName;
    });

    // Si pas de ventes : utiliser les recettes directement avec coût estimé
    if (sales.length === 0) {
      recipes.filter(r => r.is_active !== false && r.cost > 0).forEach(r => {
        productCosts[r.id] = {
          name: r.name,
          supplier: '—',
          totalCost: r.cost * 10, // 10 unités estimées
          totalQty: 10,
          costPerUnit: r.cost,
          unit: 'pièce',
          source: 'estimation'
        };
      });
    }

    // Ajouter les produits mercuriale sans ventes correspondantes
    const usedKeys = new Set(Object.values(productCosts).map(p => p.name.toLowerCase().trim()));
    supplierProducts.forEach(sp => {
      const key = (sp.name || '').toLowerCase().trim();
      if (!usedKeys.has(key) && sp.current_price > 0) {
        productCosts[`sp_${sp.id}`] = {
          name: sp.name,
          supplier: sp.supplier_name || '—',
          totalCost: sp.current_price * 5, // 5 unités estimées
          totalQty: 5,
          costPerUnit: sp.current_price,
          unit: sp.unit || '—',
          source: 'mercuriale'
        };
      }
    });

    // Trier du plus coûteux au moins coûteux
    const sorted = Object.values(productCosts)
      .filter(p => p.totalCost > 0)
      .sort((a, b) => b.totalCost - a.totalCost);

    // Calculer le total et les %
    const grandTotal = sorted.reduce((sum, p) => sum + p.totalCost, 0);
    let cumul = 0;

    return sorted.map((p, i) => {
      cumul += p.totalCost;
      const pct = grandTotal > 0 ? (p.totalCost / grandTotal * 100) : 0;
      const cumulPct = grandTotal > 0 ? (cumul / grandTotal * 100) : 0;
      return {
        ...p,
        rank: i + 1,
        pct: pct.toFixed(1),
        cumulPct: parseFloat(cumulPct.toFixed(1)),
        isTop: cumulPct <= 80 || (i === 0),
        grandTotal
      };
    });
  }

  // ============================================================
  // KPIs
  // ============================================================
  function renderKPIs() {
    const top20 = paretoData.filter(p => p.isTop).length;
    const grandTotal = paretoData[0]?.grandTotal || 0;
    const foodCostPct = computeFoodCostPct();
    const top20Cost = paretoData.filter(p => p.isTop).reduce((s, p) => s + p.totalCost, 0);
    const savings = top20Cost * 0.05; // Potentiel 5% d'économie sur le top 20%

    document.getElementById('kpiPareto20').textContent = top20 || '—';
    document.getElementById('kpiTotalPurchase').textContent = grandTotal > 0 ? formatCurrency(grandTotal) : '—';
    document.getElementById('kpiFoodCost').textContent = foodCostPct > 0 ? foodCostPct + '%' : '—';
    document.getElementById('kpiSavingsPotential').textContent = savings > 0 ? formatCurrency(savings) : '—';
  }

  function computeFoodCostPct() {
    // Food cost = (coût matière / CA) × 100
    // On utilise les recettes : moyenne pondérée (cost/price)
    // Données exposées par State global si disponibles
    if (window.State?.recipes) {
      const active = window.State.recipes.filter(r => r.is_active !== false && r.price > 0 && r.cost > 0);
      if (active.length === 0) return 0;
      const total = active.reduce((s, r) => s + (r.cost / r.price), 0);
      return Math.round((total / active.length) * 100);
    }
    return 0;
  }

  // ============================================================
  // CHART PARETO
  // ============================================================
  function renderChart() {
    const ctx = document.getElementById('paretoChart');
    if (!ctx) return;
    if (chartInstance) chartInstance.destroy();

    const top10 = paretoData.slice(0, 10);
    if (top10.length === 0) return;

    const labels = top10.map(p => truncate(p.name, 18));
    const costs = top10.map(p => p.totalCost);
    const cumuls = top10.map(p => p.cumulPct);
    const colors = top10.map(p => p.isTop ? 'rgba(220,38,38,0.75)' : 'rgba(100,116,139,0.5)');

    chartInstance = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Coût total (€)',
            data: costs,
            backgroundColor: colors,
            borderColor: colors.map(c => c.replace('0.75', '1').replace('0.5', '0.8')),
            borderWidth: 1,
            borderRadius: 6,
            yAxisID: 'y'
          },
          {
            type: 'line',
            label: '% cumulé',
            data: cumuls,
            borderColor: 'rgba(37,99,235,1)',
            backgroundColor: 'rgba(37,99,235,0.05)',
            borderWidth: 2.5,
            pointBackgroundColor: 'rgba(37,99,235,1)',
            pointRadius: 4,
            tension: 0.3,
            fill: false,
            yAxisID: 'y2'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { size: 12 }, usePointStyle: true }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (ctx.dataset.type === 'bar') return ` ${formatCurrency(ctx.parsed.y)}`;
                return ` ${ctx.parsed.y}% cumulé`;
              }
            }
          },
          annotation: {
            annotations: {
              line80: {
                type: 'line',
                yScaleID: 'y2',
                yMin: 80, yMax: 80,
                borderColor: 'rgba(239,68,68,0.6)',
                borderWidth: 2,
                borderDash: [6, 4],
                label: { content: '80%', enabled: true, position: 'start', font: { size: 11 } }
              }
            }
          }
        },
        scales: {
          y: {
            position: 'left',
            beginAtZero: true,
            ticks: {
              callback: v => v.toLocaleString('fr-FR') + ' €',
              font: { size: 11 }
            },
            grid: { color: 'rgba(0,0,0,.04)' }
          },
          y2: {
            position: 'right',
            beginAtZero: true,
            max: 100,
            ticks: {
              callback: v => v + '%',
              font: { size: 11 }
            },
            grid: { display: false }
          },
          x: {
            ticks: { font: { size: 11 } },
            grid: { display: false }
          }
        }
      }
    });
  }

  // ============================================================
  // TABLE
  // ============================================================
  function renderTable() {
    const tbody = document.getElementById('paretoTableBody');
    const empty = document.getElementById('paretoEmpty');

    if (paretoData.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    tbody.innerHTML = paretoData.map(p => {
      const barColor = p.cumulPct <= 50 ? 'danger' : p.cumulPct <= 80 ? 'warning' : '';

      return `
        <tr style="${p.isTop ? 'background:rgba(254,242,242,.4);' : ''}">
          <td><strong style="color:var(--text-muted);">#${p.rank}</strong></td>
          <td>
            <strong>${p.name}</strong>
            ${p.source === 'estimation' ? '<span style="font-size:10px;color:var(--text-light);"> (estimé)</span>' : ''}
            ${p.source === 'mercuriale' ? '<span style="font-size:10px;color:var(--zelty);"> (mercuriale)</span>' : ''}
          </td>
          <td>${p.supplier}</td>
          <td>${p.totalQty.toLocaleString('fr-FR')} ${p.unit}</td>
          <td><strong>${formatCurrency(p.totalCost)}</strong></td>
          <td>
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="cumul-bar-container"><div class="cumul-bar-fill ${barColor}" style="width:${Math.min(p.pct,100)}%"></div></div>
              <span style="font-weight:600;">${p.pct}%</span>
            </div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="cumul-bar-container"><div class="cumul-bar-fill ${barColor}" style="width:${Math.min(p.cumulPct,100)}%"></div></div>
              <span style="font-weight:600;${p.isTop ? 'color:var(--danger)' : ''}">${p.cumulPct}%</span>
            </div>
          </td>
          <td>
            ${p.isTop
              ? `<span class="pareto-priority-top"><i class="fas fa-fire"></i> Prioritaire</span>`
              : `<span class="pareto-priority-normal">Secondaire</span>`
            }
          </td>
        </tr>`;
    }).join('');
  }

  // ============================================================
  // INSIGHT BANNER
  // ============================================================
  function renderInsight() {
    const el = document.getElementById('paretoInsight');
    if (!el || paretoData.length === 0) return;

    const top = paretoData.filter(p => p.isTop);
    const grandTotal = paretoData[0]?.grandTotal || 0;
    const topCost = top.reduce((s, p) => s + p.totalCost, 0);
    const topPct = grandTotal > 0 ? Math.round(topCost / grandTotal * 100) : 0;

    el.className = 'pareto-insight loaded';
    el.innerHTML = `
      <i class="fas fa-lightbulb" style="font-size:20px;margin-right:8px;"></i>
      <strong>${top.length} produit(s)</strong> sur ${paretoData.length} représentent
      <strong style="color:var(--danger);">${topPct}% de vos achats</strong>
      (${formatCurrency(topCost)} sur ${formatCurrency(grandTotal)} total).
      <br>
      <span style="font-size:13px;font-weight:500;margin-top:4px;display:block;">
        👉 Concentrez vos négociations sur ces produits : <strong>${top.slice(0,3).map(p => p.name).join(', ')}${top.length > 3 ? '...' : ''}</strong>
      </span>`;
  }

  // ============================================================
  // HELPERS
  // ============================================================
  function formatCurrency(v) {
    if (v == null || isNaN(v)) return '—';
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v);
  }

  function truncate(str, max) {
    return str?.length > max ? str.slice(0, max) + '…' : str;
  }

  function showToast(msg, type) {
    if (window.toast) window.toast(msg, type);
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    document.getElementById('paretoRefreshBtn')?.addEventListener('click', load);
  }

  return { load, init };

})();

window.Pareto = Pareto;
