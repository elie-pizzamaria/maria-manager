# MariaManager — Guide de configuration Zelty

## Architecture multi-établissements

```
Navigateur (MariaManager)
        │
        │  POST /api/zelty/proxy
        │  { action: "sync", restaurant: "dax", ... }
        ▼
Route Next.js  api/zelty/proxy.js
        │
        │  Lit process.env.ZELTY_API_KEY (clé enseigne)
        │  Résout "dax" → process.env.ZELTY_RESTAURANT_DAX → "12345"
        │  Authorization: Bearer [clé enseigne]
        │  GET https://api.zelty.fr/2.10/orders?restaurant_id=12345
        ▼
API Zelty v2.10
```

**Avantages :**
- ✅ **Une seule clé enseigne** pour tous les établissements
- ✅ **Dispatch automatique** via codes restaurant (dax/mdm)
- ✅ La clé n'est jamais transmise au navigateur
- ✅ Pas de problème CORS (appel serveur → serveur)

---

## Étape 1 — Obtenir votre clé enseigne Zelty

1. Connectez-vous à votre espace Zelty
2. Allez dans **Paramètres → API** (ou contactez le support Zelty)
3. Copiez votre **Bearer token enseigne** (commence souvent par `zlt_...`)

> 💡 **Clé enseigne vs clé restaurant** :
> - Clé enseigne = accès à tous les établissements (Dax + Mont-de-Marsan)
> - Le filtrage se fait via `restaurant_id` dans les requêtes

---

## Étape 2 — Trouver les IDs de vos restaurants

Vous avez deux méthodes :

### Méthode A — Script automatique (recommandé)

1. Installez les dépendances : `npm install`
2. Ajoutez votre clé dans `.env.local` :
   ```env
   ZELTY_API_KEY=votre_cle_enseigne_ici
   ```
3. Lancez le script : `npm run find-ids`

Le script affiche :
```
✅ 2 restaurant(s) trouvé(s) :

1. Restaurant Dax
   ID Zelty : 12345

2. Restaurant Mont-de-Marsan
   ID Zelty : 67890
```

### Méthode B — Manuellement (avec curl)

```bash
curl -H "Authorization: Bearer VOTRE_CLE_ENSEIGNE" \
     https://api.zelty.fr/2.10/restaurants
```

Notez les `id` de chaque établissement.

---

## Étape 3 — Configurer les variables d'environnement

### En développement local

Créez (ou modifiez) le fichier **`.env.local`** à la racine du projet :

```env
# Clé enseigne (commune)
ZELTY_API_KEY=votre_cle_enseigne_ici

# ID Zelty de Dax (trouvé à l'étape 2)
ZELTY_RESTAURANT_DAX=12345

# ID Zelty de Mont-de-Marsan (trouvé à l'étape 2)
ZELTY_RESTAURANT_MDM=67890
```

> ⚠️ **Ne commitez jamais `.env.local` dans Git.**
> Le fichier `.gitignore` doit contenir `.env.local`.

### Sur Vercel (production)

> ⚠️ **Important** : Genspark n'héberge que des sites statiques. Pour que `/api/zelty/proxy` fonctionne, vous **devez déployer sur Vercel** (ou un équivalent Next.js).

1. Créez un projet sur [vercel.com](https://vercel.com) (gratuit)
2. Importez votre repo MariaManager
3. Allez dans **Settings → Environment Variables**
4. Ajoutez **3 variables** :
   - `ZELTY_API_KEY` → votre clé enseigne
   - `ZELTY_RESTAURANT_DAX` → ID Zelty de Dax (ex: `12345`)
   - `ZELTY_RESTAURANT_MDM` → ID Zelty de Mont-de-Marsan (ex: `67890`)
5. Sélectionnez **Production + Preview + Development**
6. Cliquez sur **"Save"** puis **"Redeploy"**

📖 **Guide complet** : consultez [DEPLOIEMENT_VERCEL.md](./DEPLOIEMENT_VERCEL.md)

---

## Étape 4 — Vérifier la connexion

1. Ouvrez MariaManager dans votre navigateur (Vercel ou localhost)
2. **Sélectionnez un restaurant** dans le menu déroulant en haut (Dax ou MDM)
3. Allez dans **Paramètres → Intégration Zelty**
4. Cliquez sur **"Vérifier la connexion"**

Résultats attendus :
- ✅ **"Clé API valide ✅ — connexion réussie (Dax)"** → tout fonctionne
- ❌ **"Restaurant dax non configuré"** → vérifiez `ZELTY_RESTAURANT_DAX`
- ❌ **"Clé API invalide ❌"** → vérifiez `ZELTY_API_KEY`
- ⚠️ **"Clé API Zelty non configurée"** → la variable d'env n'est pas définie

---

## Synchronisation des ventes (multi-établissements)

1. **Sélectionnez le restaurant** dans le menu déroulant (Dax ou Mont-de-Marsan)
2. Allez dans **Paramètres → Intégration Zelty**
3. Cliquez sur **"Synchroniser maintenant"**
4. La synchronisation récupère les commandes **de l'établissement sélectionné uniquement** :
   - Statut `closed` uniquement
   - Montants convertis TTC → HT (TVA 10 % par défaut, 5,5 % ou 20 % selon `tax_rate`)
   - Dates converties UTC → heure Paris
   - Pagination automatique (100 commandes / page, max 5 000)
   - Filtre `restaurant_id` appliqué automatiquement

---

## Structure des fichiers

```
api/
  zelty/
    proxy.js        ← Route Next.js POST /api/zelty/proxy
.env.local          ← Variables d'environnement (non commité)
.env.example        ← Modèle à copier
js/
  app.js            ← Frontend — appelle /api/zelty/proxy
```

---

## Actions disponibles (API interne)

| Action | Description | Paramètres |
|--------|-------------|------------|
| `test` | Vérifie la clé + établissement | `restaurant: "dax" \| "mdm"` |
| `restaurants` | Liste tous les établissements | aucun |
| `sync` | Récupère les commandes | `restaurant: "dax" \| "mdm"`, `date_start`, `date_end` |

### Exemple d'appel depuis le navigateur

```javascript
// Test de connexion pour Dax
const res = await fetch('/api/zelty/proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'test',
    restaurant: 'dax'  // ← dispatch automatique vers ZELTY_RESTAURANT_DAX
  })
});
const data = await res.json();
// { success: true, restaurant: { id: "12345", name: "Restaurant Dax" } }

// Synchronisation des ventes de Mont-de-Marsan
const res2 = await fetch('/api/zelty/proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'sync',
    restaurant: 'mdm',  // ← dispatch vers ZELTY_RESTAURANT_MDM
    date_start: '2025-03-01',
    date_end:   '2025-03-31'
  })
});
const data2 = await res2.json();
// { success: true, sales: [...], ca_ht: 1234.56, nb_orders: 42, ... }
```

---

## Codes d'erreur

| Code HTTP | Signification |
|-----------|---------------|
| 200 | Succès (vérifiez `success: true/false` dans le body) |
| 400 | Paramètres manquants ou invalides |
| 401/403 | Clé API invalide (retournée via Zelty) |
| 500 | Variable `ZELTY_API_KEY` non configurée |
| 502 | Impossible de contacter l'API Zelty |

---

## Dépannage

### "Clé API Zelty non configurée"
→ Vérifiez que `ZELTY_API_KEY` est bien définie dans `.env.local` (dev) ou les secrets Vercel (prod).

### "Restaurant dax non configuré"
→ `ZELTY_RESTAURANT_DAX` est manquant ou vide. Relancez `npm run find-ids`, puis ajoutez-le dans `.env.local` ou Vercel.

### "Restaurant ID 12345 introuvable dans Zelty"
→ L'ID configuré n'existe pas dans votre compte Zelty. Vérifiez avec `npm run find-ids` ou `GET /restaurants`.

### "Clé API invalide ❌"
→ La clé enseigne a été transmise à Zelty mais elle est rejetée (401/403). Vérifiez sa valeur.

### "Impossible de contacter Zelty"
→ Problème réseau entre le serveur et `api.zelty.fr`. Vérifiez votre connexion ou contactez Zelty.

### Route `/api/zelty/proxy` retourne 404
→ Vous êtes sur Genspark (hébergeur statique). Migrez vers Vercel (voir [DEPLOIEMENT_VERCEL.md](./DEPLOIEMENT_VERCEL.md)).
