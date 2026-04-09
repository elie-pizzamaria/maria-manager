# 🎯 Résumé — Intégration Zelty multi-établissements

## Ce qui a été fait

### ✅ Backend — Route proxy Next.js

**Fichier créé** : `api/zelty/proxy.js`

Rôle : proxy serveur qui appelle l'API Zelty côté serveur pour éviter CORS et protéger la clé API.

**Architecture :**
```
Browser → POST /api/zelty/proxy { restaurant: "dax" }
           ↓
        Route Next.js lit process.env.ZELTY_RESTAURANT_DAX → "12345"
           ↓
        GET https://api.zelty.fr/2.10/orders?restaurant_id=12345&status=closed
           ↓
        Retourne { sales: [...], ca_ht: 1234.56, ... }
```

**Actions disponibles :**
| Action | Paramètres | Description |
|--------|------------|-------------|
| `test` | `restaurant: "dax" \| "mdm"` | Valide la clé enseigne + vérifie l'ID restaurant |
| `restaurants` | aucun | Liste tous les établissements Zelty |
| `sync` | `restaurant: "dax" \| "mdm"`, `date_start`, `date_end` | Récupère les commandes (pagination auto, 100/page max 5000) |

**Gestion multi-établissements :**
- Une seule clé enseigne (`ZELTY_API_KEY`)
- Mapping codes → IDs Zelty via `process.env` :
  - `"dax"` → `ZELTY_RESTAURANT_DAX` → ex: `"12345"`
  - `"mdm"` → `ZELTY_RESTAURANT_MDM` → ex: `"67890"`
- Le proxy traduit automatiquement le code en ID Zelty dans les requêtes

---

### ✅ Frontend — Client ZeltyAPI simplifié

**Fichier modifié** : `js/app.js`

Changements :
- Suppression de toutes les références Supabase
- Client simplifié qui appelle `/api/zelty/proxy` (route locale)
- Plus de vérification `_proxyReady()` — le proxy est toujours disponible
- Le sélecteur de restaurant transmet automatiquement `restaurant: "dax" | "mdm"`

**Exemples d'appels :**
```javascript
// Test connexion Dax
await ZeltyAPI.testConnection(null, null, null, { restaurant: 'dax' });

// Sync commandes Mont-de-Marsan (mars 2025)
await ZeltyAPI.fetchSales(null, null, null, {
  restaurant: 'mdm',
  date_start: '2025-03-01',
  date_end:   '2025-03-31'
});
```

---

### ✅ Configuration — Variables d'environnement

**Fichiers créés :**
- `.env.local` — template avec 3 variables
- `.env.example` — version vide à copier
- `.gitignore` — empêche de commiter `.env.local`

**3 variables requises :**
```env
ZELTY_API_KEY=votre_cle_enseigne_zelty
ZELTY_RESTAURANT_DAX=12345
ZELTY_RESTAURANT_MDM=67890
```

**Où les renseigner ?**
- **Local** : fichier `.env.local` à la racine
- **Vercel** : Settings → Environment Variables

---

### ✅ Scripts utilitaires

**Fichier créé** : `scripts/find-restaurant-ids.js`

Usage :
```bash
npm install
npm run find-ids
```

Affiche :
```
✅ 2 restaurant(s) trouvé(s) :

1. Restaurant Dax
   ID Zelty : 12345

2. Restaurant Mont-de-Marsan
   ID Zelty : 67890
```

---

### ✅ Documentation

**Fichiers mis à jour/créés :**

| Fichier | Contenu |
|---------|---------|
| `SETUP.md` | Guide de configuration (3 étapes : clé enseigne → IDs → variables d'env) |
| `DEPLOIEMENT_VERCEL.md` | Guide complet de déploiement sur Vercel (gratuit) |
| `README.md` | Ajout section Intégration Zelty multi-établissements |
| `package.json` | Script `npm run find-ids` |

---

## Comment utiliser

### 1️⃣ Trouver vos IDs restaurants

**Option A** — Script automatique (recommandé) :
```bash
# 1. Renseigner ZELTY_API_KEY dans .env.local
echo "ZELTY_API_KEY=votre_cle_enseigne" > .env.local

# 2. Lancer le script
npm install
npm run find-ids
```

**Option B** — Manuellement (curl) :
```bash
curl -H "Authorization: Bearer VOTRE_CLE_ENSEIGNE" \
     https://api.zelty.fr/2.10/restaurants
```

---

### 2️⃣ Configurer les variables d'environnement

**Développement local** :
```bash
# Copier le template
cp .env.example .env.local

# Éditer .env.local
ZELTY_API_KEY=zlt_abc123...
ZELTY_RESTAURANT_DAX=12345
ZELTY_RESTAURANT_MDM=67890
```

**Production Vercel** :
1. Aller sur [vercel.com](https://vercel.com)
2. Importer le projet
3. Settings → Environment Variables → ajouter les 3 variables
4. Redéployer

---

### 3️⃣ Tester la connexion

1. Ouvrir MariaManager
2. **Sélectionner "Dax"** dans le menu déroulant en haut
3. Aller dans **Paramètres → Intégration Zelty**
4. Cliquer sur **"Vérifier la connexion"**

Résultats attendus :
- ✅ **"Clé API valide ✅ — connexion réussie (Dax)"** → tout fonctionne
- ❌ **"Restaurant dax non configuré"** → vérifier `ZELTY_RESTAURANT_DAX`
- ❌ **"Clé API invalide ❌"** → vérifier `ZELTY_API_KEY`

---

### 4️⃣ Synchroniser les ventes

1. **Sélectionner le restaurant** (Dax ou Mont-de-Marsan)
2. Cliquer sur **"Synchroniser maintenant"**
3. Les commandes sont importées :
   - Uniquement `status=closed`
   - Montants convertis TTC → HT (selon TVA)
   - Dates UTC → Paris
   - Pagination automatique (100 commandes/page)

---

## Architecture finale

```
┌──────────────────────────────────────────────┐
│  FRONTEND (MariaManager)                     │
│  ┌────────────────────┐                      │
│  │ Sélecteur          │                      │
│  │ [ Dax ▼ ]          │                      │
│  └────────────────────┘                      │
│                                               │
│  js/app.js                                   │
│  ZeltyAPI.fetchSales(null, null, null, {     │
│    restaurant: 'dax',                        │
│    date_start: '2025-03-01',                 │
│    date_end:   '2025-03-31'                  │
│  })                                          │
└──────────────┬───────────────────────────────┘
               │ POST /api/zelty/proxy
               │ { restaurant: "dax", ... }
               ▼
┌──────────────────────────────────────────────┐
│  BACKEND (Next.js — Vercel)                  │
│                                               │
│  api/zelty/proxy.js                          │
│  ┌────────────────────────────────────────┐  │
│  │ 1. Lit process.env.ZELTY_API_KEY      │  │
│  │ 2. Résout "dax" → ZELTY_RESTAURANT_DAX│  │
│  │    → "12345"                           │  │
│  │ 3. Appelle Zelty avec clé enseigne    │  │
│  │    GET /orders?restaurant_id=12345     │  │
│  │ 4. Filtre closed, convertit TTC→HT     │  │
│  │ 5. Retourne JSON nettoyé               │  │
│  └────────────────────────────────────────┘  │
└──────────────┬───────────────────────────────┘
               │ Authorization: Bearer [clé]
               │ GET /orders?restaurant_id=12345
               ▼
┌──────────────────────────────────────────────┐
│  API ZELTY v2.10                             │
│  https://api.zelty.fr/2.10                   │
│                                               │
│  Retourne commandes du restaurant 12345      │
└──────────────────────────────────────────────┘
```

---

## Points clés

### ✅ Avantages

1. **Une seule clé enseigne** — pas besoin de clé par restaurant
2. **Dispatch automatique** — le code `dax`/`mdm` est traduit en ID Zelty côté serveur
3. **Zéro configuration frontend** — tout est côté serveur
4. **Sécurité** — la clé n'est jamais exposée au navigateur
5. **Aucun CORS** — appel serveur → serveur

### ⚠️ Contraintes

1. **Nécessite un backend** — ne fonctionne pas sur Genspark (statique uniquement)
2. **Déploiement Vercel recommandé** — gratuit et natif Next.js
3. **3 variables d'env obligatoires** — clé enseigne + 2 IDs restaurants

---

## Dépannage rapide

| Erreur | Cause | Solution |
|--------|-------|----------|
| **"Clé API Zelty non configurée"** | `ZELTY_API_KEY` manquant | Ajouter dans `.env.local` ou Vercel |
| **"Restaurant dax non configuré"** | `ZELTY_RESTAURANT_DAX` vide | Lancer `npm run find-ids` → copier l'ID |
| **"Restaurant ID 12345 introuvable"** | ID invalide dans Zelty | Vérifier avec `npm run find-ids` |
| **"Clé API invalide ❌"** | Clé rejetée par Zelty (401/403) | Vérifier la valeur de `ZELTY_API_KEY` |
| **404 sur /api/zelty/proxy** | Site hébergé sur Genspark | Migrer vers Vercel (voir `DEPLOIEMENT_VERCEL.md`) |

---

## Prochaine étape recommandée

🚀 **Déployer sur Vercel** pour tester en production :

1. Créer un compte sur [vercel.com](https://vercel.com)
2. Importer le repo GitHub
3. Ajouter les 3 variables d'env
4. Cliquer sur "Deploy"
5. Tester `/api/zelty/proxy` depuis l'URL Vercel

📖 **Guide complet** : [DEPLOIEMENT_VERCEL.md](./DEPLOIEMENT_VERCEL.md)
