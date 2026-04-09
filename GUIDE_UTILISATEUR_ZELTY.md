# Guide utilisateur — Connexion Zelty

## 🎯 Résumé rapide

**Avant** : vous saisissiez votre clé API dans l'interface → **compliqué et non sécurisé**.  
**Maintenant** : la clé est stockée côté serveur → **simple et sécurisé**.

---

## ✅ Ce qui a changé

### Dans l'interface MariaManager

**Page Paramètres → Connexion API Zelty :**

| Avant | Après |
|-------|-------|
| 3 champs à remplir (clé API, ID point de vente, URL) | 0 champ — texte explicatif uniquement |
| Boutons "Tester" + "Enregistrer" | 1 seul bouton "Vérifier la connexion Zelty" |
| Mot de passe à afficher/masquer | Plus de champ de saisie |

**Nouveau message affiché :**
```
🔒 Clé API sécurisée côté serveur.
   Aucune configuration requise dans le navigateur.
```

---

## 🔧 Configuration (une seule fois)

### Étape 1 — Ajouter la clé côté serveur

**Sur Vercel** (ou votre hébergeur) :

1. Allez dans **Settings → Environment Variables**
2. Ajoutez **3 variables** :

| Variable | Valeur | Où la trouver ? |
|----------|--------|-----------------|
| `ZELTY_API_KEY` | Votre clé enseigne Zelty | Espace Zelty → Paramètres → API |
| `ZELTY_RESTAURANT_DAX` | ID Zelty de Dax | Commande `npm run find-ids` |
| `ZELTY_RESTAURANT_MDM` | ID Zelty de Mont-de-Marsan | Commande `npm run find-ids` |

3. Cliquez sur **Save** puis **Redeploy**

> 💡 **Aide pour trouver les IDs** : consultez [SETUP.md](./SETUP.md) section "Trouver vos IDs restaurants"

---

### Étape 2 — Vérifier la connexion

1. Ouvrez MariaManager (sur l'URL Vercel)
2. **Sélectionnez un restaurant** dans le menu déroulant (Dax ou MDM)
3. Allez dans **Paramètres → Connexion API Zelty**
4. Cliquez sur **"Vérifier la connexion Zelty"**

**Résultats possibles :**

| Message | Signification | Action |
|---------|---------------|--------|
| ✅ **"Connexion réussie"** | Tout fonctionne | Rien — vous pouvez synchroniser |
| ❌ **"Clé API Zelty non configurée"** | Variable manquante sur Vercel | Retourner à l'Étape 1 |
| ❌ **"Restaurant dax non configuré"** | ID manquant ou incorrect | Vérifier `ZELTY_RESTAURANT_DAX` |
| ❌ **"Clé API invalide"** | Mauvaise clé enseigne | Vérifier la valeur de `ZELTY_API_KEY` |

---

## 📊 Synchronisation des ventes

### Comment synchroniser

1. **Sélectionnez le restaurant** (Dax ou Mont-de-Marsan) dans le menu déroulant en haut
2. Allez dans **Paramètres → Intégration Zelty**
3. Cliquez sur **"Synchroniser maintenant"**

Ou utilisez le bouton rapide dans la barre du haut (icône ⟳).

### Ce qui est importé

- **Commandes** : uniquement statut `closed` (payées et fermées)
- **Montants** : convertis automatiquement TTC → HT (selon TVA 10 %/5,5 %/20 %)
- **Dates** : converties UTC → heure Paris
- **Filtrage** : seul le restaurant sélectionné est synchronisé

### Période synchronisée

- **Première fois** : les 30 derniers jours
- **Synchronisations suivantes** : depuis la dernière date connue → aujourd'hui

---

## 🔐 Sécurité

### Avant (ancien système)

❌ Clé API stockée dans le **navigateur** (localStorage)  
❌ Visible dans **DevTools** → Console → Application → Local Storage  
❌ Accessible via **extensions navigateur**  
❌ Copiable par **n'importe qui ayant accès à votre ordinateur**

### Maintenant (nouveau système)

✅ Clé API stockée **uniquement sur le serveur** (Vercel)  
✅ **Jamais transmise** au navigateur  
✅ **Impossible à voir** dans DevTools  
✅ **Protégée** par les secrets Vercel (chiffrés au repos)

---

## ❓ Questions fréquentes

### Où est passée la clé API que j'avais saisie avant ?

Elle est ignorée. Les anciennes clés stockées dans `localStorage` ne sont plus utilisées.  
Vous pouvez les supprimer manuellement (DevTools → Application → Local Storage → supprimer `zm_api_key`).

### Puis-je encore utiliser plusieurs établissements ?

**Oui**, c'est même mieux maintenant :
- **Une seule clé enseigne** pour tout
- Le système dispatch automatiquement vers Dax ou MDM selon le restaurant sélectionné

### Comment changer la clé API ?

1. Aller sur Vercel → Settings → Environment Variables
2. Modifier `ZELTY_API_KEY`
3. Cliquer sur **Save** puis **Redeploy**

### Ça fonctionne sur Genspark ?

**Non**. Genspark héberge uniquement des sites statiques.  
La route `/api/zelty/proxy` nécessite un serveur → migrez vers Vercel (gratuit).

📖 **Guide complet** : [DEPLOIEMENT_VERCEL.md](./DEPLOIEMENT_VERCEL.md)

### Je n'ai plus de champ pour tester ma clé, comment faire ?

Le bouton **"Vérifier la connexion Zelty"** remplace le test.  
Il appelle le serveur qui teste la clé stockée dans les variables d'environnement.

---

## 🚨 Dépannage

### "Proxy non configuré" ou erreur 404

→ Vous êtes probablement encore sur Genspark.  
→ Déployez sur Vercel : [DEPLOIEMENT_VERCEL.md](./DEPLOIEMENT_VERCEL.md)

### "Clé API Zelty non configurée"

→ La variable `ZELTY_API_KEY` n'est pas définie sur Vercel.  
→ Allez dans Settings → Environment Variables → ajoutez-la.

### "Restaurant dax non configuré"

→ La variable `ZELTY_RESTAURANT_DAX` est manquante ou vide.  
→ Lancez `npm run find-ids` pour récupérer l'ID → ajoutez-le sur Vercel.

### La synchronisation ne ramène rien

1. Vérifiez que le restaurant sélectionné est correct (Dax ou MDM)
2. Vérifiez la période : la première synchro couvre les 30 derniers jours
3. Vérifiez que Zelty a bien des commandes `closed` sur cette période

### Badge toujours "Non testée"

→ Vous n'avez pas encore cliqué sur "Vérifier la connexion Zelty".  
→ Le badge se met à jour après le test.

---

## 📞 Besoin d'aide ?

1. **Documentation technique** : [SETUP.md](./SETUP.md)
2. **Guide de déploiement** : [DEPLOIEMENT_VERCEL.md](./DEPLOIEMENT_VERCEL.md)
3. **Résumé multi-établissements** : [RESUME_ZELTY_MULTI_ETABLISSEMENTS.md](./RESUME_ZELTY_MULTI_ETABLISSEMENTS.md)
4. **Changelog** : [CHANGEMENTS_SIMPLIFICATION_UI.md](./CHANGEMENTS_SIMPLIFICATION_UI.md)

---

**Prêt à démarrer ?** 🚀  
→ Suivez l'**Étape 1** (Configuration serveur) puis testez avec l'**Étape 2** !
