# Guide de déploiement — Vercel

## 🎯 Pourquoi Vercel ?

- ✅ **Gratuit** pour les projets personnels/petites équipes
- ✅ **Next.js natif** → la route `/api/zelty/proxy` fonctionne automatiquement
- ✅ **Variables d'environnement sécurisées** → les secrets ne sont jamais exposés
- ✅ **Déploiement en 5 minutes** sans configuration complexe

---

## Étape 1 — Créer un compte Vercel

1. Allez sur [vercel.com](https://vercel.com)
2. Cliquez sur **"Sign Up"**
3. Connectez-vous avec GitHub, GitLab ou email

---

## Étape 2 — Importer le projet

### Option A — Depuis GitHub (recommandé)

1. Poussez votre code sur GitHub (créez un repo privé si nécessaire)
2. Dans Vercel → **"Add New Project"** → **"Import Git Repository"**
3. Sélectionnez votre repo MariaManager
4. Cliquez sur **"Import"**

### Option B — Upload direct (si pas de Git)

1. Dans Vercel → **"Add New Project"** → **"Deploy from a template"** → **"Browse all templates"**
2. Téléchargez le CLI Vercel : `npm install -g vercel`
3. Dans le dossier MariaManager : `vercel`
4. Suivez les instructions (choisir "N" pour les frameworks détectés, puis confirmer)

---

## Étape 3 — Configurer les variables d'environnement (IMPORTANT)

Une fois le projet importé dans Vercel :

1. Allez dans **Settings → Environment Variables**
2. Ajoutez **3 variables** :

| Name | Value | Exemple |
|------|-------|---------|
| `ZELTY_API_KEY` | Votre clé enseigne Zelty | `zlt_abc123...` |
| `ZELTY_RESTAURANT_DAX` | ID Zelty du restaurant de Dax | `12345` |
| `ZELTY_RESTAURANT_MDM` | ID Zelty du restaurant de Mont-de-Marsan | `67890` |

> **Comment trouver les IDs restaurant ?**
>
> 1. Allez dans MariaManager → Paramètres → Intégration Zelty
> 2. Cliquez sur **"Lister les restaurants"** (une fois `ZELTY_API_KEY` renseignée)
> 3. Notez les `id` de chaque établissement
>
> Ou utilisez cette requête directe (avec votre clé) :
> ```bash
> curl -H "Authorization: Bearer VOTRE_CLE" https://api.zelty.fr/2.10/restaurants
> ```

3. Sélectionnez **Production**, **Preview** et **Development** (les 3 environnements)
4. Cliquez sur **"Save"**

---

## Étape 4 — Redéployer avec les secrets

Les variables d'environnement ne sont appliquées qu'au prochain déploiement.

**Option 1 — Depuis Vercel (rapide)** :
1. Allez dans **Deployments**
2. Cliquez sur les `...` à droite du dernier déploiement
3. Cliquez sur **"Redeploy"**

**Option 2 — Depuis Git (si vous avez connecté GitHub)** :
1. Faites un commit bidon : `git commit --allow-empty -m "Trigger redeploy"`
2. Poussez : `git push`
3. Vercel redéploie automatiquement

---

## Étape 5 — Tester la connexion

1. Ouvrez l'URL de production Vercel (ex : `https://maria-manager.vercel.app`)
2. Allez dans **Paramètres → Intégration Zelty**
3. Cliquez sur **"Vérifier la connexion"**

Résultats attendus :
- ✅ **"Clé API valide ✅ — connexion réussie (Dax)"** → tout fonctionne
- ❌ **"Restaurant dax non configuré"** → vérifiez `ZELTY_RESTAURANT_DAX` dans Vercel
- ❌ **"Clé API invalide ❌"** → vérifiez `ZELTY_API_KEY` dans Vercel

---

## Synchronisation multi-établissements

Le sélecteur de restaurant dans MariaManager envoie automatiquement le bon code (`dax` ou `mdm`) au proxy, qui le traduit en ID Zelty.

### Comment ça marche ?

```javascript
// Frontend envoie
fetch('/api/zelty/proxy', {
  body: JSON.stringify({
    action: 'sync',
    restaurant: 'dax',  // ← code lisible
    date_start: '2025-03-01',
    date_end: '2025-03-31'
  })
});

// Proxy traduit
const restaurant_id = getRestaurantId('dax');
// → lit process.env.ZELTY_RESTAURANT_DAX → "12345"

// Appel Zelty filtré
GET https://api.zelty.fr/2.10/orders?restaurant_id=12345&...
```

Aucune manipulation manuelle — tout est automatique.

---

## URLs importantes

Une fois déployé sur Vercel :

| Service | URL |
|---------|-----|
| **Application** | `https://votre-projet.vercel.app` |
| **Proxy API** | `https://votre-projet.vercel.app/api/zelty/proxy` |
| **Dashboard Vercel** | [vercel.com/dashboard](https://vercel.com/dashboard) |

---

## Dépannage

### "Clé API Zelty non configurée"
→ Les variables d'env ne sont pas définies. Retournez dans Vercel → Settings → Environment Variables.

### "Restaurant dax non configuré"
→ `ZELTY_RESTAURANT_DAX` est manquant ou vide. Ajoutez-le dans Vercel, puis redéployez.

### "Erreur 500 Internal Server Error"
→ Regardez les logs Vercel : Deployments → cliquez sur le dernier → onglet "Functions" → cherchez `/api/zelty/proxy`.

### Mon site Genspark affiche "404" quand j'appelle `/api/zelty/proxy`
→ C'est normal. Genspark héberge uniquement les fichiers statiques (HTML/CSS/JS).
   La route API ne fonctionne QUE sur Vercel. Il faut migrer le projet entier sur Vercel.

---

## Migrer de Genspark vers Vercel

1. **Export depuis Genspark** :
   - Téléchargez tous les fichiers du projet
   - Ou clonez le repo Git si vous en avez un

2. **Import dans Vercel** (voir Étape 2 ci-dessus)

3. **Copiez l'URL Vercel dans vos favoris** :
   - L'ancienne URL Genspark ne fonctionnera plus (pas de backend)
   - Utilisez désormais `https://votre-projet.vercel.app`

4. **(Optionnel) Redirection** :
   - Si vous avez un nom de domaine personnalisé sur Genspark, pointez-le vers Vercel
   - Vercel → Settings → Domains → ajoutez votre domaine

---

## Alternative — Cloudflare Workers

Si vous ne voulez pas migrer de Genspark, vous pouvez créer un proxy Cloudflare Workers séparé.

**Avantages** :
- Frontend reste sur Genspark (aucun changement)
- Proxy tourne sur Cloudflare (gratuit jusqu'à 100k req/jour)

**Inconvénient** :
- Configuration supplémentaire (2 services au lieu d'un)

→ Demandez si vous préférez cette option, je génère le code complet.
