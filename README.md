# MariaManager v3.0 — Pilotage de Rentabilité Restaurant

> Application web SPA mobile-first, identité visuelle **Pizza Maria** (rose bubble-gum · rouge tomate · blanc pur).  
> Architecture multi-restaurants, 11 modules, 100% fonctionnelle sans API externe.

---

## 🎨 Identité visuelle

| Élément | Valeur |
|---------|--------|
| Rouge principal (brand) | `#C0392B` |
| Rouge survol | `#A93226` |
| Rose pâle (bg accent) | `#FDF0EF` |
| Rose moyen (bordures) | `#F5C6C2` |
| Fond général | `#FAFAFA` |
| Fond cartes | `#FFFFFF` |
| Texte principal | `#1A1A1A` |
| Succès | `#16A34A` |
| Logo | `img/logo.png` (Pizza Maria) |

---

## ✅ Modules livrés — Version 3.0 + Intégration Zelty

| Module | Statut | Filtré par restaurant | Nouveautés v3 |
|--------|--------|-----------------------|---------------|
| **Dashboard** | ✅ v3 | ✅ | Onglets Ce mois-ci / Aujourd'hui |
| **Recettes** | ✅ | Partagé | Type produit_fini / sous_recette |
| **Ingrédients recettes** | ✅ | Partagé | Sous-recettes, coût récursif, anti-boucle |
| **Ventes** | ✅ | ✅ `restaurant_id` | — |
| **Chiffre d'affaires** | ✅ | ✅ | — |
| **Inventaires** | ✅ v4 | ✅ | — |
| **Mercuriale** | ✅ v3 | Partagé | `prix_total_ht`, `poids`, prix_unitaire calculé |
| **Factures** | ✅ v3 | ✅ | Autocomplétion produit, Total HT/Qté → prix unitaire |
| **Analyse Achats (Pareto)** | ✅ | ✅ | — |
| **Rentabilité** | ✅ v4 | ✅ | — |
| **Restaurants** | ✅ v5 | Admin | — |
| **Paramètres** | ✅ | Global | — |
| **Intégration Zelty** | ✅ v2.10 | ✅ Multi-établissements | Clé enseigne, dispatch auto Dax/MDM |

---

## 🆕 Nouveautés Version 3.0

### 1. Mercuriale — Prix total HT + Poids
- Deux nouveaux champs dans le formulaire produit : **Prix total HT** et **Poids/Quantité livrée**
- **Prix unitaire calculé automatiquement** = `prix_total_ht / poids` (affiché en lecture seule)
- Le prix unitaire saisi manuellement reste disponible si les deux champs ne sont pas renseignés
- Champs : `prix_total_ht` (number), `poids` (number) dans `supplier_products`

### 2. Factures — Saisie améliorée
- **Autocomplétion produit** : datalist sur le champ nom, préremplit le fournisseur et l'unité
- **Colonne Prix total HT** : saisie du montant total de la ligne (ex. : montant facture)
- **Prix unitaire calculé** = `total_price / quantity` (lecture seule, en temps réel)
- **Validation → Mercuriale** : met à jour `prix_total_ht`, `poids` et `current_price` dans `supplier_products`

### 3. Recettes — Sous-recettes & Coût récursif
- **Champ `type`** sur la table `recipes` : `'produit_fini'` ou `'sous_recette'`
- **Champ `type_ingredient`** sur `recipe_ingredients` : `'produit'` ou `'sous_recette'`
- **Champ `sous_recette_id`** sur `recipe_ingredients` : référence `recipes.id`
- **Bouton "+ Ajouter une sous-recette"** dans le modal ingrédients
- **Calcul coût récursif** : utilise le coût précalculé de la sous-recette × quantité
- **Détection de boucles** : Set de visites + exception levée si cycle détecté (`computeSubRecipeCost`)
- **`refreshAllRecipeCosts()`** : recalcule automatiquement toutes les recettes après import facture

### 4. Dashboard — Onglets Ce mois-ci / Aujourd'hui
#### Onglet "Ce mois-ci"
- **CA du mois** (couleur verte si > 0)
- **Coût matière** (réel si inventaires disponibles, théorique sinon) + food cost %
- **Charges fixes** du mois en cours
- **Résultat net** = CA − Coût matière − Charges fixes
- **Projection fin de mois** (linéaire) si mois en cours
- **Barre de progression vers le point mort** avec couleur (vert/orange/rouge)

#### Onglet "Aujourd'hui"
- **CA du jour** + nb couverts + ticket moyen
- **Coût matière du jour** (proportionnel au CA du jour / ratio mensuel)
- **Charges du jour** = charges fixes mensuelles ÷ jours ouvrés (lun–sam)
- **Résultat du jour** = CA − coût mat. − charges du jour

---

## 🏗️ Architecture des fichiers

```
index.html                 — SPA principale (11 pages)
css/style.css              — Styles complets MariaManager v3
img/logo.png               — Logo Pizza Maria
api/
  zelty/
    proxy.js               — 🆕 Route Next.js — Proxy Zelty multi-établissements
js/
  app.js                   — Bootstrap, navigation, multi-restaurants, ZeltyAPI client
  mercuriale.js            — Module mercuriale (prix_total_ht, poids, calcUnitPrice)
  pareto.js                — Analyse achats Pareto
  rentabilite.js           — Calcul rentabilité v4 (expose window._rentaCalc)
  factures.js              — Gestion factures v3 (autocomplétion, total HT)
  factures-ocr.js          — OCR PDF via Vision API ou PDF.js
  inventaire.js            — Inventaires & marges réelles v4
  restaurants.js           — Gestion restaurants v5
  pilotage.js              — Bloc titre intégré (dash-title-block, PilotageBloc)
  dashboard-tabs.js        — 🆕 Onglets Ce mois-ci / Aujourd'hui (DashboardTabs)
scripts/
  find-restaurant-ids.js   — 🆕 Script pour récupérer les IDs Zelty de Dax/MDM
.env.local                 — 🆕 Variables d'env (clé enseigne + IDs restaurants)
```

---

## 🗄️ Schémas de tables

| Table | Champs clés |
|-------|-------------|
| `recipes` | id, name, category, price, cost, type (**produit_fini**\|**sous_recette**) |
| `recipe_ingredients` | id, recipe_id, product_id, quantity, unit, unit_price, cost, **type_ingredient**, **sous_recette_id** |
| `supplier_products` | id, supplier_id, name, unit, current_price, **prix_total_ht**, **poids**, last_updated |
| `invoices` | id, supplier_id, invoice_number, invoice_date, total_amount, status, restaurant_id |
| `invoice_lines` | id, invoice_id, product_name, quantity, unit, unit_price, total_price, supplier_product_id |
| `charges_fixes` | id, restaurant_id, annee, mois, categorie, libelle, montant, est_exceptionnel |
| `daily_revenue` | id, restaurant_id, date, revenue, covers, source |
| `price_history` | id, product_id, product_name, supplier_id, price, unit, date |

---

## 🌐 URIs fonctionnels

| URL | Description |
|-----|-------------|
| `index.html` | Dashboard principal — onglets Ce mois-ci / Aujourd'hui |
| `#recipes` | Recettes (produit_fini ou sous_recette) |
| `#sales` | Ventes |
| `#revenue` | Chiffre d'affaires quotidien |
| `#inventaires` | Inventaires & marges réelles |
| `#mercuriale` | Mercuriale fournisseurs |
| `#factures` | Factures fournisseurs (import + saisie manuelle) |
| `#pareto` | Analyse achats Pareto 80/20 |
| `#rentabilite` | Rentabilité mensuelle |
| `#restaurants` | Gestion restaurants |
| `#settings` | Paramètres |

**API Tables** (RESTful interne) :
- `tables/restaurants`
- `tables/sales` — filtré `restaurant_id`
- `tables/daily_revenue` — filtré `restaurant_id`
- `tables/charges_fixes` — filtré `restaurant_id`
- `tables/invoices` / `tables/invoice_lines` — filtré `restaurant_id`
- `tables/inventaires` / `tables/lignes_inventaire`
- `tables/recipes` — partagé
- `tables/recipe_ingredients` — partagé
- `tables/supplier_products` / `tables/suppliers` — partagé
- `tables/price_history`

**API Zelty** (proxy serveur) :
- `POST /api/zelty/proxy` — actions : `test`, `restaurants`, `sync`
- Dispatch automatique Dax/MDM via clé enseigne
- Authentification : `process.env.ZELTY_API_KEY` (serveur uniquement)
- Base URL : `https://api.zelty.fr/2.10`

---

## 🔄 Multi-restaurants + Intégration Zelty

### Gestion des établissements
- **Sélecteur** : Dropdown dans la topbar, persisté en `localStorage`
- **Écran d'accueil** : S'affiche si aucun restaurant n'est sélectionné
- **Filtrage automatique** : Ventes, Factures, Inventaires, Rentabilité, Dashboard tabs

### Synchronisation Zelty multi-établissements
- **Une clé enseigne** commune (pas de clé par restaurant)
- **Dispatch automatique** : `restaurant: "dax"` → `ZELTY_RESTAURANT_DAX` → `restaurant_id=12345`
- **API v2.10** : `GET /orders?restaurant_id=[ID_ZELTY]&status=closed`
- **Conversions** : centimes→euros, TTC→HT (TVA 10%/5.5%/20%), UTC→Paris
- **Pagination** : 100 commandes/page, max 5 000 (protection anti-boucle infinie)

---

## ⚠️ Signaux à surveiller (risques de régression)

| Point | Risque | Mitigation |
|-------|--------|------------|
| `refreshAllRecipeCosts()` | Charge beaucoup de données (1000 ingrédients, 500 recettes) | Limiteur `?limit=500/1000` déjà en place |
| Coût récursif des sous-recettes | Dépend du champ `cost` précalculé de la sous-recette | Toujours appeler `saveAndUpdateRecipeCost()` après modification |
| `window._rentaCalc` | Peut être `null` si la page rentabilité n'a pas été chargée | Dashboard tabs fallback sur appels API directs |
| `prix_total_ht / poids` | Division par zéro si poids = 0 | Guard `poids > 0` dans `calcUnitPrice()` et `saveProduct()` |

---

## 📱 Responsive

- **Desktop** : Sidebar 240px fixe, contenu décalé
- **Tablet** : Sidebar slide-over avec overlay
- **Mobile** : Topbar 56px, hamburger sidebar ; grille KPI 2 colonnes

---

## 🚀 Prochaines étapes recommandées

1. ~~Connecter l'API Zelty en production~~ ✅ **FAIT** (v2.10, multi-établissements)
2. Ajouter un vrai OCR PDF via service tiers (ex. Google Document AI avec backend)
3. Export PDF des rapports de rentabilité mensuelle
4. Notifications push pour alertes point mort
5. Historique des coûts de sous-recettes (traçabilité)
6. Graphique d'évolution food cost dans le dashboard

---

## 📦 Déploiement

### Développement local
```bash
# 1. Installer les dépendances
npm install

# 2. Configurer les variables d'env
cp .env.example .env.local
# Renseigner ZELTY_API_KEY, ZELTY_RESTAURANT_DAX, ZELTY_RESTAURANT_MDM

# 3. Trouver les IDs restaurants (optionnel si inconnus)
npm run find-ids

# 4. Lancer le serveur de dev (Next.js ou équivalent)
npm run dev
```

### Production (Vercel)
Consultez **[DEPLOIEMENT_VERCEL.md](./DEPLOIEMENT_VERCEL.md)** pour le guide complet.

**TL;DR** :
1. Créer un compte sur [vercel.com](https://vercel.com)
2. Importer le repo GitHub
3. Ajouter 3 variables d'env : `ZELTY_API_KEY`, `ZELTY_RESTAURANT_DAX`, `ZELTY_RESTAURANT_MDM`
4. Déployer → URL automatique

⚠️ **Genspark ne supporte pas `/api/zelty/proxy`** (site statique uniquement). Utilisez Vercel ou Cloudflare Workers.
