'use strict';
/**
 * MariaManager — Analyse OCR Factures PDF
 * ════════════════════════════════════════════════════════════════════
 * Flux complet (100% client-side, aucun backend requis) :
 *
 *   Phase 1 — Import PDF + fournisseur + date
 *   Phase 2 — Rendu PDF → images via PDF.js + envoi à Google Cloud Vision
 *   Phase 3 — Tableau éditable des lignes parsées + matching mercuriale
 *   Phase 4 — Succès après validation
 *
 * API utilisée :
 *   POST https://vision.googleapis.com/v1/images:annotate
 *   Feature : DOCUMENT_TEXT_DETECTION
 *   Payload : { image: { content: <base64 PNG> }, features: [...] }
 *
 *   Le PDF est d'abord rendu page par page en canvas PNG via PDF.js (CDN).
 *   Chaque page est envoyée séparément à GCV puis les textes sont concaténés.
 *
 * Configuration :
 *   Paramètres → "Analyse OCR — Factures PDF" → champ "Clé API Google Cloud Vision"
 *   Variable localStorage : mm_gcv_api_key
 *
 * Sans clé : mode démo avec données simulées.
 */

window.FacturesOCR = (() => {

  /* ── Constantes ─────────────────────────────────────────────────────── */
  const GCV_KEY_LS    = 'mm_gcv_api_key';
  const GCV_ENDPOINT  = 'https://vision.googleapis.com/v1/images:annotate';
  const PDFJS_CDN     = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER  = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const MAX_PAGES     = 6;   // Nb max de pages analysées (évite timeout)
  const SCALE         = 2.0; // Résolution de rendu (2× = bonne qualité OCR)

  /* ── État ───────────────────────────────────────────────────────────── */
  let _file          = null;
  let _supplierId    = '';
  let _supplierName  = '';
  let _date          = '';
  let _lines         = [];
  let _pdfTotal      = null;
  let _lastInvoiceId = null;
  let _aborted       = false;
  let _pdfjsLoaded   = false;

  /* ── Helpers ────────────────────────────────────────────────────────── */
  const el    = id => document.getElementById(id);
  const today = ()  => new Date().toISOString().split('T')[0];
  const toast = (m,t) => window.toast?.(m, t);
  const escH  = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                                   .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmt   = v => {
    if (v == null || isNaN(v) || !isFinite(v)) return '—';
    return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(v);
  };
  const norm  = s =>
    (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
           .toLowerCase().trim().replace(/\s+/g,' ');
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const getKey = () => (localStorage.getItem(GCV_KEY_LS)||'').trim();

  /* ══════════════════════════════════════════════════════════════════════
     CHARGEMENT DYNAMIQUE DE PDF.JS
  ══════════════════════════════════════════════════════════════════════ */
  function loadPdfJs() {
    if (_pdfjsLoaded && window.pdfjsLib) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (window.pdfjsLib) { _pdfjsLoaded = true; resolve(); return; }
      const s = document.createElement('script');
      s.src = PDFJS_CDN;
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        _pdfjsLoaded = true;
        resolve();
      };
      s.onerror = () => reject(new Error('Impossible de charger PDF.js'));
      document.head.appendChild(s);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     OUVERTURE / FERMETURE DU PANNEAU
  ══════════════════════════════════════════════════════════════════════ */
  async function open() {
    const panel = el('ocr-panel');
    if (!panel) return;

    if (window.Mercuriale) {
      try { await window.Mercuriale.load(); } catch(_) {}
    }

    _file = null; _supplierId = ''; _supplierName = '';
    _date = today(); _lines = []; _pdfTotal = null;
    _lastInvoiceId = null; _aborted = false;

    showPhase(1);
    el('ocrInvoiceDate').value = _date;
    resetDrop();
    populateSupplierSelect();
    checkApiKeyWarning();
    refreshAnalyzeBtn();

    panel.style.display = '';
    panel.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function close() {
    const p = el('ocr-panel');
    if (p) p.style.display = 'none';
    _aborted = true;
  }

  /* ── Phases ─────────────────────────────────────────────────────────── */
  function showPhase(n) {
    [1,2,3,4].forEach(i => {
      const p = el('ocrPhase'+i);
      if (p) p.style.display = (i===n) ? '' : 'none';
    });
    [['ocrStep1Ind',1],['ocrStep2Ind',2],['ocrStep3Ind',3]].forEach(([id,i]) => {
      const e = el(id); if (!e) return;
      e.classList.toggle('active', i===n);
      e.classList.toggle('done',   i<n);
    });
  }

  /* ── Drop zone ──────────────────────────────────────────────────────── */
  function resetDrop() {
    const z = el('ocrDropZone');
    if (z) z.className = 'ocr-drop-zone';
    const dc = el('ocrDropContent');
    if (dc) dc.innerHTML = `
      <i class="fas fa-file-pdf ocr-drop-icon"></i>
      <p class="ocr-drop-title">Déposez votre facture PDF ici</p>
      <p class="ocr-drop-sub">ou cliquez pour choisir un fichier</p>
      <p class="ocr-drop-hint">PDF uniquement · 10 Mo max</p>
      <button type="button" class="btn btn-secondary"
        onclick="document.getElementById('ocrFileInput').click()">
        <i class="fas fa-folder-open"></i> Parcourir
      </button>`;
    const inp = el('ocrFileInput');
    if (inp) inp.value = '';
    _file = null;
  }

  function handleFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      toast('Seuls les fichiers PDF sont acceptés.','warning'); return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('Fichier trop lourd (max 10 Mo). Compressez le PDF et réessayez.','error'); return;
    }
    _file = file;
    const z = el('ocrDropZone');
    if (z) z.className = 'ocr-drop-zone has-file';
    const dc = el('ocrDropContent');
    if (dc) dc.innerHTML = `
      <i class="fas fa-check-circle ocr-drop-icon" style="color:var(--success)"></i>
      <p class="ocr-drop-title" style="color:var(--success)">${escH(file.name)}</p>
      <p class="ocr-drop-sub">${(file.size/1024).toFixed(0)} Ko · PDF prêt pour analyse</p>
      <button type="button" class="btn btn-outline"
        onclick="document.getElementById('ocrFileInput').click()">
        <i class="fas fa-redo"></i> Changer de fichier
      </button>`;
    refreshAnalyzeBtn();
  }

  /* ── Select fournisseurs ─────────────────────────────────────────────── */
  function populateSupplierSelect() {
    const sel = el('ocrSupplierId');
    if (!sel) return;
    const sups = window.Mercuriale?.getSuppliers?.() || [];
    sel.innerHTML = '<option value="">-- Sélectionner un fournisseur --</option>' +
      sups.map(s =>
        `<option value="${s.id}" data-name="${escH(s.name)}">${escH(s.name)}${s.category ? ' ('+s.category+')' : ''}</option>`
      ).join('');
    if (_supplierId) sel.value = _supplierId;
  }

  /* ── Avertissement clé manquante ────────────────────────────────────── */
  function checkApiKeyWarning() {
    const w = el('ocrApiWarning');
    if (w) w.style.display = getKey() ? 'none' : 'flex';
  }

  function refreshAnalyzeBtn() {
    const btn = el('ocrAnalyzeBtn');
    if (!btn) return;
    btn.disabled = !(_file && el('ocrSupplierId')?.value && el('ocrInvoiceDate')?.value);
  }

  /* ══════════════════════════════════════════════════════════════════════
     ANALYSE — CŒUR DU FLUX
     1. Chargement PDF.js si nécessaire
     2. Rendu de chaque page en canvas PNG (côté client)
     3. Envoi de chaque page à Google Cloud Vision images:annotate
     4. Concaténation du texte + parsing
  ══════════════════════════════════════════════════════════════════════ */
  async function analyze() {
    _supplierId   = el('ocrSupplierId').value;
    _supplierName = el('ocrSupplierId').selectedOptions[0]?.dataset?.name || '';
    _date         = el('ocrInvoiceDate').value;
    _aborted      = false;

    if (!_supplierId) { toast('Sélectionnez un fournisseur','warning'); return; }
    if (!_date)       { toast('Saisissez la date de facture','warning'); return; }
    if (!_file)       { toast('Importez d\'abord un fichier PDF','warning'); return; }

    const apiKey = getKey();
    showPhase(2);

    try {
      let rawText = '';

      if (apiKey) {
        /* ── Flux réel : PDF.js → images → GCV ────────────────────── */
        setLoadingMsg('Chargement de PDF.js…', 10);

        await loadPdfJs();
        if (_aborted) return;

        setLoadingMsg('Lecture du PDF…', 20);
        const pdfData = await readFileAsArrayBuffer(_file);
        const pdf     = await window.pdfjsLib.getDocument({ data: pdfData }).promise;
        if (_aborted) return;

        const totalPages = Math.min(pdf.numPages, MAX_PAGES);
        const pageTexts  = [];

        for (let p = 1; p <= totalPages; p++) {
          if (_aborted) return;
          const pct = 20 + Math.round((p / totalPages) * 55);
          setLoadingMsg(`Rendu page ${p}/${totalPages}…`, pct);

          const page    = await pdf.getPage(p);
          const b64png  = await renderPageToBase64(page);
          if (_aborted) return;

          setLoadingMsg(`Analyse page ${p}/${totalPages} via Google Vision…`, pct + 5);
          const text = await callGcvVision(apiKey, b64png);
          pageTexts.push(text);
        }

        rawText = pageTexts.join('\n');

        if (!rawText || rawText.trim().length < 20) {
          // PDF scanné ou texte non détecté
          const w = el('ocrScanWarning');
          if (w) w.style.display = '';
        }

      } else {
        /* ── Mode démo sans clé ─────────────────────────────────────── */
        setLoadingMsg('Mode démo — simulation…', 40);
        await delay(1200);
        rawText = buildDemoText(_supplierId);
        toast('Mode démo — configurez une clé Google Cloud Vision dans Paramètres.','info');
      }

      if (_aborted) return;

      setLoadingMsg('Extraction des lignes produits…', 90);
      await delay(150);

      const parsed = parseInvoiceText(rawText);
      _lines       = parsed.lines.map(l => matchMercuriale(l));
      _pdfTotal    = parsed.total;

      showPhase(3);
      renderBanner();
      renderTable();
      updateTotals();
      refreshValidateBtn();

      const wNoLines = el('ocrNoLinesWarning');
      if (wNoLines) wNoLines.style.display = _lines.length === 0 ? '' : 'none';

    } catch(e) {
      if (_aborted) return;
      console.error('[FacturesOCR] Erreur analyse:', e);
      _lines = []; _pdfTotal = null;
      showPhase(3);
      const wNoLines = el('ocrNoLinesWarning');
      if (wNoLines) wNoLines.style.display = '';
      const wScan = el('ocrScanWarning');
      if (wScan) wScan.style.display = 'none';
      renderBanner(); renderTable(); updateTotals(); refreshValidateBtn();
      toast(`Erreur : ${e.message}. Saisissez les lignes manuellement.`, 'error');
    }
  }

  /* ── Progression ─────────────────────────────────────────────────────── */
  function setLoadingMsg(txt, pct) {
    const t = el('ocrLoadingTitle');
    if (t) t.textContent = txt;
    const bar = el('ocrProgressBar');
    if (bar) bar.style.width = (pct||0) + '%';
  }

  /* ── Lecture fichier → ArrayBuffer ─────────────────────────────────── */
  function readFileAsArrayBuffer(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = () => res(r.result);
      r.onerror = rej;
      r.readAsArrayBuffer(file);
    });
  }

  /* ── Rendu d'une page PDF en base64 PNG ─────────────────────────────── */
  async function renderPageToBase64(page) {
    const viewport = page.getViewport({ scale: SCALE });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    // Retourner le base64 sans le préfixe "data:image/png;base64,"
    return canvas.toDataURL('image/png').split(',')[1];
  }

  /* ── Appel Google Cloud Vision ──────────────────────────────────────── */
  async function callGcvVision(apiKey, base64Image) {
    const body = {
      requests: [{
        image:        { content: base64Image },
        features:     [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['fr','en'] }
      }]
    };

    const resp = await fetch(`${GCV_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `Google Vision API — erreur HTTP ${resp.status}`);
    }

    const data = await resp.json();
    return data.responses?.[0]?.fullTextAnnotation?.text
        || data.responses?.[0]?.textAnnotations?.[0]?.description
        || '';
  }

  /* ══════════════════════════════════════════════════════════════════════
     PARSING DU TEXTE BRUT
     Recherche des lignes de type :
       "Entrecôte  3.5  kg  28.50  99.75"
       "Tomates rondes  10  kg  1.20"
  ══════════════════════════════════════════════════════════════════════ */
  function parseInvoiceText(text) {
    const lines = [];
    let   total = null;

    if (!text || text.trim().length < 5) return { lines, total };

    // Normaliser décimales (virgule → point)
    const cleanText = text.replace(/(\d),(\d)/g, '$1.$2');
    const rows = cleanText.split('\n').map(l => l.trim()).filter(Boolean);

    const NUM    = /\d+(?:\.\d+)?/g;
    const UNITS  = ['kg','g','l','litre','litres','cl','ml','pièce','piece',
                    'pcs','boite','boîte','lot','carton','bouteille','bt',
                    'barquette','portion','u','unité','unite'];
    const UNIT_RE = new RegExp(`\\b(${UNITS.join('|')})s?\\b`, 'i');

    const IGNORE = /^(total|tva|ttc|ht|sous.total|remise|avoir|facture|date|adresse|siret|numéro|n°|fax|tel|www|http|email|page|ref|référence|designation|produit|qté|quantite|unitaire|montant|merci|cordialement|règlement|paiement|échéance|conditions|livraison|bon\s*de)/i;

    // Détecter le total global
    for (const row of rows) {
      if (/\b(total\s*(ttc|ht|général|facture|à\s*payer)?)\s*:?\s*(\d[\d\s,.]*)/i.test(row)) {
        const m = row.match(/(\d[\d\s,.]*)\s*€?$/);
        if (m) {
          const v = parseFloat(m[1].replace(/\s/g,'').replace(',','.'));
          if (!isNaN(v) && v > 0) total = v;
        }
      }
    }

    // Extraction des lignes produits
    for (const row of rows) {
      if (IGNORE.test(row)) continue;
      if (row.length < 5) continue;

      const nums = (row.match(NUM) || []).map(Number).filter(n => n > 0 && n < 100000);
      if (nums.length < 2) continue;

      const unitMatch = row.match(UNIT_RE);
      const rawUnit   = unitMatch ? unitMatch[1].toLowerCase() : 'kg';
      const unit      = normaliseUnit(rawUnit);

      let qty = 0, unitPrice = 0, lineTotal = 0;

      if (nums.length >= 3) {
        qty       = nums[0];
        unitPrice = nums[nums.length - 2];
        lineTotal = nums[nums.length - 1];
        const calc = qty * unitPrice;
        if (Math.abs(calc - lineTotal) / (lineTotal||1) > 0.25) {
          outer: for (let i = 0; i < nums.length-1; i++) {
            for (let j = i+1; j < nums.length; j++) {
              const t = nums.find((n,k) => k!==i && k!==j);
              if (t && Math.abs(nums[i]*nums[j] - t)/(t||1) < 0.1) {
                qty=nums[i]; unitPrice=nums[j]; lineTotal=t; break outer;
              }
            }
          }
        }
      } else {
        qty       = nums[0];
        unitPrice = nums[1];
        lineTotal = +(qty * unitPrice).toFixed(2);
      }

      if (unitPrice <= 0 || qty <= 0) continue;
      if (qty === 1 && unitPrice > 500) continue;

      let name = row
        .replace(UNIT_RE, '')
        .replace(NUM, ' ')
        .replace(/[€%]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (name.length < 2 || IGNORE.test(name)) continue;

      // Confidence heuristique : si qty*unitPrice ≈ lineTotal → haute confiance
      const coherence = lineTotal > 0
        ? Math.abs(qty * unitPrice - lineTotal) / lineTotal
        : 1;
      const confidence = coherence < 0.05 ? 1
                       : coherence < 0.25 ? 0.7
                       : 0.4;

      lines.push({
        product_name: capitalise(name),
        quantity:     +qty.toFixed(3),
        unit,
        unit_price:   +unitPrice.toFixed(2),
        total_price:  +lineTotal.toFixed(2),
        confidence,
        _incertain:   confidence < 0.7
      });
    }

    // Dédoublonner
    const deduped = [];
    for (const l of lines) {
      const last = deduped[deduped.length-1];
      if (last && norm(last.product_name) === norm(l.product_name) &&
          last.unit_price === l.unit_price) continue;
      deduped.push(l);
    }

    return { lines: deduped, total };
  }

  function capitalise(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function normaliseUnit(u) {
    const map = {
      g:'g', kg:'kg', l:'litre', litre:'litre', litres:'litre',
      cl:'litre', ml:'ml', 'pièce':'pièce', piece:'pièce',
      pcs:'pièce', boite:'boîte', 'boîte':'boîte',
      bouteille:'bouteille', bt:'bouteille',
      lot:'lot', carton:'carton', barquette:'barquette',
      portion:'portion', u:'pièce', 'unité':'pièce', unite:'pièce'
    };
    return map[(u||'').toLowerCase().trim()] || 'kg';
  }

  /* ── Démo sans clé ───────────────────────────────────────────────────── */
  function buildDemoText(supplierId) {
    const sups   = window.Mercuriale?.getSuppliers?.() || [];
    const sup    = sups.find(s => s.id === supplierId);
    const cat    = sup?.category || 'autres';
    const cats   = {
      viande:   [['Entrecôte de boeuf','3','kg','28.50'],['Poulet fermier','8','kg','6.80'],['Lardons fumés','2','kg','8.20']],
      BOF:      [['Beurre doux','4','kg','8.20'],['Crème fraîche 35%','6','litre','4.90'],['Oeufs frais x12','10','pièce','3.80']],
      épicerie: [['Farine T45','10','kg','0.90'],['Huile olive vierge','3','litre','8.50'],['Sel fin','5','kg','1.20']],
      légumes:  [['Tomates rondes','8','kg','2.90'],['Oignons','10','kg','1.40'],['Pommes de terre','15','kg','1.20']],
      boisson:  [['Vin rouge maison','12','bouteille','7.50'],['Eau minérale 1L','4','carton','8.50']],
      poisson:  [['Saumon frais filet','3','kg','18.50'],['Cabillaud filet','2','kg','16.00']],
      autres:   [['Produit A','4','pièce','5.00'],['Produit B','2','kg','8.00']]
    };
    const items = cats[cat] || cats.autres;
    let text = `FACTURE FOURNISSEUR\nDate : ${today()}\n\nDESIGNATION   QTE   UNITE   PRIX HT   MONTANT\n`;
    let sum = 0;
    items.forEach(([nom,qty,unit,prix]) => {
      const t = (parseFloat(qty)*parseFloat(prix)).toFixed(2);
      sum += parseFloat(t);
      text += `${nom}   ${qty}   ${unit}   ${prix}   ${t}\n`;
    });
    text += `\nTOTAL HT : ${sum.toFixed(2)} €\n`;
    return text;
  }

  /* ══════════════════════════════════════════════════════════════════════
     MATCHING MERCURIALE
  ══════════════════════════════════════════════════════════════════════ */
  function matchMercuriale(line) {
    const allP = window.Mercuriale?.getProducts?.() || [];
    const n    = norm(line.product_name);

    const exact = allP.find(p => norm(p.name) === n);
    if (exact) {
      return { ...line, matchType:'exact', supplier_product_id:exact.id,
               _matched_name:exact.name, _candidates:[] };
    }

    const partials = allP.filter(p => {
      const pn = norm(p.name);
      return pn.split(' ').filter(w=>w.length>=3).some(w=>n.includes(w)) ||
             n.split(' ').filter(w=>w.length>=3).some(w=>pn.includes(w));
    });
    if (partials.length) {
      return { ...line, matchType:'partial', supplier_product_id:partials[0].id,
               _matched_name:partials[0].name, _candidates:partials.slice(0,5) };
    }

    return { ...line, matchType:'none', supplier_product_id:'', _matched_name:'', _candidates:[] };
  }

  /* ══════════════════════════════════════════════════════════════════════
     RENDU PHASE 3 — TABLEAU
  ══════════════════════════════════════════════════════════════════════ */
  function renderBanner() {
    const b = el('ocrResultBanner'); if (!b) return;
    const total   = _lines.length;
    const exact   = _lines.filter(l => l.matchType==='exact').length;
    const partial = _lines.filter(l => l.matchType==='partial').length;
    const none    = _lines.filter(l => l.matchType==='none').length;
    b.innerHTML = `
      <div class="ocr-banner-item"><i class="fas fa-list"></i> <strong>${total}</strong> ligne${total>1?'s':''} détectée${total>1?'s':''}</div>
      ${exact   ? `<div class="ocr-banner-item ok"><i class="fas fa-link"></i> <strong>${exact}</strong> lié${exact>1?'s':''} mercuriale</div>` : ''}
      ${partial ? `<div class="ocr-banner-item warn"><i class="fas fa-question-circle"></i> <strong>${partial}</strong> à confirmer</div>` : ''}
      ${none    ? `<div class="ocr-banner-item new"><i class="fas fa-plus-circle"></i> <strong>${none}</strong> nouveau${none>1?'x':''}</div>` : ''}`;
  }

  function rowBg(ln) {
    if (ln.confidence >= 0.8) return '';
    if (ln.confidence >= 0.5) return 'background:#FFFBEB;';
    return 'background:#FEF2F2;border-left:3px solid #C0392B;';
  }
  function rowIcon(ln) {
    if (ln.confidence >= 0.8) return '<span title="Confiance élevée">✅</span>';
    if (ln.confidence >= 0.5) return `<span title="Confiance moyenne — vérifiez les valeurs" style="cursor:help">⚠️</span>`;
    return `<span title="Confiance faible — ligne à corriger manuellement" style="cursor:help">❌</span>`;
  }

  function renderTable() {
    const tbody = el('ocrLinesBody'); if (!tbody) return;
    const allP  = window.Mercuriale?.getProducts?.() || [];
    const UNITS = ['kg','g','litre','ml','cl','pièce','boîte','lot','barquette','carton','bouteille','portion','autre'];

    if (!_lines.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">
        Aucune ligne détectée — ajoutez-en manuellement ci-dessous.</td></tr>`;
      return;
    }

    tbody.innerHTML = _lines.map((ln, i) => {
      /* Badge produit lié */
      let badge = '';
      if (ln.matchType === 'exact') {
        badge = `<span class="ocr-match-badge ocr-match-exact" title="${escH(ln._matched_name)}">
                   <i class="fas fa-check-circle"></i> ${escH(ln._matched_name)}
                 </span>`;
      } else if (ln.matchType === 'partial') {
        badge = `<select class="inline-select ocr-match-select"
                   onchange="FacturesOCR.setMatch(${i},this.value)">
                   ${ln._candidates.map(c =>
                     `<option value="${c.id}" ${c.id===ln.supplier_product_id?'selected':''}>${escH(c.name)} ?</option>`
                   ).join('')}
                   <option value="">➕ Nouveau produit</option>
                 </select>`;
      } else {
        badge = `<span class="ocr-match-badge ocr-match-new">
                   <i class="fas fa-plus-circle"></i> Nouveau
                 </span>`;
      }

      const unitOpts = UNITS.map(u => `<option ${u===ln.unit?'selected':''}>${u}</option>`).join('');
      const bg = rowBg(ln);

      return `<tr class="ocr-line-row" style="${bg}">
        <td style="text-align:center">${rowIcon(ln)}</td>
        <td><input class="inline-input" type="text" value="${escH(ln.product_name)}"
              oninput="FacturesOCR.edit(${i},'product_name',this.value)" /></td>
        <td><input class="inline-input inline-qty" type="number" value="${ln.quantity}" min="0" step="0.001"
              oninput="FacturesOCR.edit(${i},'quantity',parseFloat(this.value)||0)" /></td>
        <td><select class="inline-select" onchange="FacturesOCR.edit(${i},'unit',this.value)">${unitOpts}</select></td>
        <td><input class="inline-input inline-price" type="number" value="${ln.unit_price}" min="0" step="0.01"
              oninput="FacturesOCR.edit(${i},'unit_price',parseFloat(this.value)||0)" /></td>
        <td style="text-align:right;font-weight:600">${fmt(ln.total_price)}</td>
        <td>${badge}</td>
        <td><button class="icon-btn danger" onclick="FacturesOCR.removeLine(${i})" title="Supprimer ligne">
              <i class="fas fa-times"></i></button></td>
      </tr>`;
    }).join('');
  }

  /* ── Édition inline ─────────────────────────────────────────────────── */
  function edit(i, field, value) {
    if (!_lines[i]) return;
    _lines[i][field] = value;
    if (field === 'quantity' || field === 'unit_price') {
      _lines[i].total_price = +(_lines[i].quantity * _lines[i].unit_price).toFixed(2);
      renderTable();
    }
    updateTotals();
    refreshValidateBtn();
  }

  function setMatch(i, productId) {
    if (!_lines[i]) return;
    const allP = window.Mercuriale?.getProducts?.() || [];
    const prod = allP.find(p => p.id === productId);
    _lines[i].supplier_product_id = productId;
    _lines[i]._matched_name = prod?.name || '';
    _lines[i].matchType = productId ? 'exact' : 'none';
    refreshValidateBtn();
  }

  function removeLine(i) {
    _lines.splice(i, 1);
    renderBanner(); renderTable(); updateTotals(); refreshValidateBtn();
  }

  function addLine() {
    _lines.push({
      product_name:'', quantity:1, unit:'kg', unit_price:0, total_price:0,
      confidence:1, _incertain:false,
      matchType:'none', supplier_product_id:'', _matched_name:'', _candidates:[]
    });
    renderTable(); updateTotals(); refreshValidateBtn();
    setTimeout(() => {
      const rows = el('ocrLinesBody')?.querySelectorAll('tr.ocr-line-row');
      rows?.[rows.length-1]?.querySelector('input')?.focus();
    }, 50);
  }

  /* ── Totaux ──────────────────────────────────────────────────────────── */
  function updateTotals() {
    const calc   = _lines.reduce((s,l) => s+(l.total_price||0), 0);
    const calcEl = el('ocrTotalCalc');
    if (calcEl) calcEl.textContent = fmt(calc);

    const pdfWrap = el('ocrTotalPdfWrap');
    const gapWrap = el('ocrTotalGapWrap');
    if (_pdfTotal != null) {
      if (pdfWrap) { pdfWrap.style.display=''; el('ocrTotalPdf').textContent = fmt(_pdfTotal); }
      const gap = Math.abs(calc - _pdfTotal);
      if (gapWrap) {
        gapWrap.style.display = gap > 0.05 ? '' : 'none';
        const ge = el('ocrTotalGap'); if (ge) ge.textContent = fmt(gap);
      }
    } else {
      if (pdfWrap) pdfWrap.style.display = 'none';
      if (gapWrap) gapWrap.style.display = 'none';
    }
  }

  /* ── Bouton Valider ─────────────────────────────────────────────────── */
  function refreshValidateBtn() {
    const btn  = el('ocrValidateBtn');
    const info = el('ocrValidateInfo');
    if (!btn) return;

    const incomplete = _lines.filter(l => !l.product_name?.trim() || l.unit_price <= 0);
    if (_lines.length === 0) {
      btn.disabled = true;
      if (info) info.innerHTML = '<span style="color:var(--text-muted)">Ajoutez au moins une ligne</span>';
    } else if (incomplete.length) {
      btn.disabled = true;
      if (info) info.innerHTML = `<span style="color:var(--warning)"><i class="fas fa-exclamation-triangle"></i> ${incomplete.length} ligne(s) incomplète(s) — vérifiez nom et prix</span>`;
    } else {
      btn.disabled = false;
      if (info) info.innerHTML = '';
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     VALIDATION ET ENREGISTREMENT
     1. Créer facture dans `invoices`
     2. Pour chaque ligne : créer/MAJ supplier_products + price_history
     3. Créer chaque ligne dans `invoice_lines`
     4. Succès → phase 4
  ══════════════════════════════════════════════════════════════════════ */
  async function validate() {
    const btn = el('ocrValidateBtn');
    if (btn) { btn.disabled=true; btn.innerHTML='<i class="fas fa-circle-notch fa-spin"></i> Enregistrement…'; }

    try {
      const restoId     = window.RestaurantCtx?.currentId?.() || 'default';
      const totalAmount = +_lines.reduce((s,l) => s+(l.total_price||0), 0).toFixed(2);
      const invNumber   = `OCR-${_date.replace(/-/g,'')}-${Math.floor(Math.random()*9000)+1000}`;

      /* 1. Créer la facture */
      const invResp = await fetch('tables/invoices', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          supplier_id:    _supplierId,
          supplier_name:  _supplierName,
          invoice_number: invNumber,
          invoice_date:   _date,
          total_amount:   totalAmount,
          lines_count:    _lines.length,
          status:         'imported',
          filename:       _file?.name || 'facture.pdf',
          notes:          'Importée via Google Cloud Vision OCR (PDF.js + images:annotate)',
          restaurant_id:  restoId
        })
      });
      if (!invResp.ok) throw new Error(`Erreur création facture : HTTP ${invResp.status}`);
      const invoice = await invResp.json();
      _lastInvoiceId = invoice.id;

      let added = 0, updated = 0;
      const allP        = window.Mercuriale?.getProducts?.() || [];
      const supplierCat = (window.Mercuriale?.getSuppliers?.() || []).find(s=>s.id===_supplierId)?.category || 'autres';

      /* 2. Lignes + mercuriale */
      for (const ln of _lines) {
        if (!ln.product_name.trim()) continue;

        let productId = ln.supplier_product_id || '';

        if (productId) {
          const existing = allP.find(p => p.id === productId);
          if (existing) {
            await fetch(`tables/supplier_products/${productId}`, {
              method:'PUT', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({
                ...existing,
                current_price: ln.unit_price,
                unit:          ln.unit,
                last_updated:  _date,
                supplier_id:   _supplierId,
                supplier_name: _supplierName
              })
            });
            await fetch('tables/price_history', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({
                product_id:    productId,
                product_name:  existing.name,
                supplier_id:   _supplierId,
                supplier_name: _supplierName,
                price:         ln.unit_price,
                unit:          ln.unit,
                date:          _date,
                notes:         `Import OCR — ${invNumber}`
              })
            });
            updated++;
          }
        } else {
          const nr = await fetch('tables/supplier_products', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              supplier_id:       _supplierId,
              supplier_name:     _supplierName,
              name:              ln.product_name,
              category:          supplierCat,
              unit:              ln.unit,
              current_price:     ln.unit_price,
              last_updated:      _date,
              recipe_ingredient: '',
              notes:             `Créé via OCR — ${invNumber}`
            })
          });
          if (!nr.ok) throw new Error(`Erreur création produit : HTTP ${nr.status}`);
          const created = await nr.json();
          productId = created.id;

          await fetch('tables/price_history', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              product_id:    productId,
              product_name:  ln.product_name,
              supplier_id:   _supplierId,
              supplier_name: _supplierName,
              price:         ln.unit_price,
              unit:          ln.unit,
              date:          _date,
              notes:         `Premier prix OCR — ${invNumber}`
            })
          });
          added++;
        }

        /* 3. Ligne de facture */
        await fetch('tables/invoice_lines', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            invoice_id:          invoice.id,
            supplier_id:         _supplierId,
            supplier_name:       _supplierName,
            invoice_date:        _date,
            product_name:        ln.product_name,
            quantity:            ln.quantity,
            unit:                ln.unit,
            unit_price:          ln.unit_price,
            total_price:         ln.total_price,
            supplier_product_id: productId,
            matched:             !!productId,
            restaurant_id:       restoId
          })
        });
      }

      /* 4. Succès */
      showPhase(4);
      const stitle = el('ocrSuccessTitle');
      const ssub   = el('ocrSuccessSub');
      if (stitle) stitle.textContent = 'Facture enregistrée ✅';
      if (ssub)   ssub.textContent   =
        `${_lines.length} ligne(s) importée(s) · ${added} produit(s) créé(s) · ${updated} prix mis à jour`;

      setTimeout(() => window.Factures?.load?.(), 300);
      setTimeout(() => window.Mercuriale?.load?.(), 400);
      setTimeout(() => window.RecipeIngredientsManager?.refreshAllRecipeCosts?.(), 700);

      toast(`✅ Facture OCR enregistrée — ${added} ajouté(s), ${updated} mis à jour`, 'success');

    } catch(e) {
      console.error('[FacturesOCR] validate error:', e);
      toast('Erreur lors de l\'enregistrement : ' + e.message, 'error');
      if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-check"></i> Valider la facture'; }
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     PARAMÈTRES — Gestion clé Google Cloud Vision
  ══════════════════════════════════════════════════════════════════════ */
  function initSettings() {
    const ki = el('gcvApiKey');
    if (ki) ki.value = getKey();
    updateGcvBadge();

    el('toggleGcvKey')?.addEventListener('click', () => {
      const inp = el('gcvApiKey'); if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      const ic = el('toggleGcvKey')?.querySelector('i');
      if (ic) ic.className = inp.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
    });

    el('saveGcvKeyBtn')?.addEventListener('click', () => {
      const k = (el('gcvApiKey')?.value||'').trim();
      if (k) { localStorage.setItem(GCV_KEY_LS, k); toast('Clé Google Vision enregistrée ✅','success'); }
      else   { localStorage.removeItem(GCV_KEY_LS);  toast('Clé supprimée','info'); }
      updateGcvBadge();
      checkApiKeyWarning();
    });

    el('testGcvKeyBtn')?.addEventListener('click', testGcvConnection);
  }

  function updateGcvBadge() {
    const b = el('gcvStatusBadge'); if (!b) return;
    const has = !!getKey();
    b.textContent = has ? 'Configurée ✅' : 'Non configurée';
    b.className   = has ? 'badge badge-connected' : 'badge badge-manual';
  }

  async function testGcvConnection() {
    const btn = el('testGcvKeyBtn');
    const res = el('gcvTestResult');
    const key = (el('gcvApiKey')?.value||'').trim() || getKey();
    if (!key) {
      if (res) { res.style.display=''; res.className='connection-result error';
                 res.innerHTML='<i class="fas fa-times-circle"></i> Aucune clé saisie.'; }
      return;
    }
    if (btn) { btn.disabled=true; btn.innerHTML='<i class="fas fa-circle-notch fa-spin"></i> Test…'; }
    try {
      // Test avec une image 1×1 PNG transparente
      const testPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const body = { requests:[{ image:{ content: testPng }, features:[{ type:'LABEL_DETECTION', maxResults:1 }] }] };
      const r = await fetch(`${GCV_ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
      });
      if (r.ok) {
        if (res) { res.style.display=''; res.className='connection-result success';
                   res.innerHTML='<i class="fas fa-check-circle"></i> Connexion Google Cloud Vision réussie — clé valide ✅'; }
      } else {
        const err = await r.json().catch(()=>({}));
        if (res) { res.style.display=''; res.className='connection-result error';
                   res.innerHTML=`<i class="fas fa-times-circle"></i> Erreur ${r.status} : ${escH(err?.error?.message||'Clé invalide')}`; }
      }
    } catch(e) {
      if (res) { res.style.display=''; res.className='connection-result error';
                 res.innerHTML='<i class="fas fa-times-circle"></i> Impossible de contacter Google Cloud Vision.'; }
    } finally {
      if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-wifi"></i> Tester la connexion'; }
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     INIT — Attacher tous les événements
  ══════════════════════════════════════════════════════════════════════ */
  function init() {
    el('ocrInvoiceBtn')?.addEventListener('click', open);
    el('ocrCloseBtn')?.addEventListener('click', close);
    el('ocrCancelBtn')?.addEventListener('click', close);

    el('ocrAbortBtn')?.addEventListener('click', () => { _aborted = true; showPhase(1); resetDrop(); });

    el('ocrFileInput')?.addEventListener('change', e => handleFile(e.target.files[0]));

    const dz = el('ocrDropZone');
    if (dz) {
      dz.addEventListener('click',     () => el('ocrFileInput')?.click());
      dz.addEventListener('dragover',  e  => { e.preventDefault(); dz.classList.add('drag-over'); });
      dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
      dz.addEventListener('drop',      e  => { e.preventDefault(); dz.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });
    }

    el('ocrSupplierId')?.addEventListener('change', () => {
      _supplierId = el('ocrSupplierId').value;
      refreshAnalyzeBtn();
    });
    el('ocrInvoiceDate')?.addEventListener('change', refreshAnalyzeBtn);

    el('ocrAddSupplierLink')?.addEventListener('click', e => {
      e.preventDefault();
      if (typeof openModal === 'function') openModal('supplierModal');
    });

    el('ocrAnalyzeBtn')?.addEventListener('click', analyze);

    el('ocrAddLineBtn')?.addEventListener('click', addLine);
    el('ocrValidateBtn')?.addEventListener('click', validate);
    el('ocrBackBtn')?.addEventListener('click', () => {
      _lines = []; _aborted = false;
      showPhase(1); resetDrop(); populateSupplierSelect();
    });

    el('ocrNewBtn')?.addEventListener('click', () => {
      _lines = []; _aborted = false;
      showPhase(1); resetDrop(); populateSupplierSelect();
    });
    el('ocrViewInvoiceBtn')?.addEventListener('click', () => {
      close();
      if (_lastInvoiceId) setTimeout(() => window.Factures?.showInvoiceDetail?.(_lastInvoiceId), 200);
    });

    initSettings();
  }

  return { init, open, close, edit, setMatch, removeLine, addLine };

})();
