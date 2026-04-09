# Changements — Simplification UI Zelty

## Résumé

Suppression complète de la saisie manuelle de la clé API Zelty dans l'interface.  
La clé enseigne est désormais **uniquement** gérée via les variables d'environnement serveur (`ZELTY_API_KEY`).

---

## Fichiers modifiés

### 1. `index.html`

**Avant** — Formulaire complet avec 3 champs + 2 boutons :
```html
<input type="password" id="zeltyApiKey" />
<input type="text" id="zeltyPosId" />
<input type="text" id="zeltyApiUrl" />
<button id="testConnectionBtn">Tester</button>
<button id="saveApiSettingsBtn">Enregistrer</button>
```

**Après** — Bloc simplifié avec message explicatif + 1 bouton :
```html
<div class="info-box">
  <p>Clé API sécurisée côté serveur. Aucune configuration requise.</p>
</div>
<button id="verifyZeltyConnectionBtn">Vérifier la connexion Zelty</button>
<div id="connectionResult"></div>
```

**Badge de statut** :
- Avant : `"Non configurée"` | `"Configurée"`
- Après : `"Non testée"` | `"Connectée ✅"`

---

### 2. `js/app.js`

#### Suppressions

**Code supprimé** (70 lignes) :
- Bloc `ZeltySecurity` complet (encode/decode/save/load/clear)
- Champs `State.settings.zeltyApiKey`, `zeltyPosId`, `zeltyApiUrl`
- Fonction `testZeltyConnection()` (ancienne version avec champs manuels)
- Fonction `saveApiSettings()` (ancienne version avec sauvegarde localStorage)
- Event listener `toggleApiKey` (afficher/masquer mot de passe)
- Références `ZeltySecurity.load()`, `ZeltySecurity.save()`, `ZeltySecurity.clear()`

#### Ajouts/Modifications

**Nouvelle fonction** : `verifyZeltyConnection()`
```javascript
async function verifyZeltyConnection() {
  // Récupère le restaurant courant (dax/mdm)
  const restaurant = ctx?.currentId === 'dax' ? 'dax' : 'mdm';
  
  // Appel au proxy avec le restaurant
  const result = await ZeltyAPI.testConnection(null, null, null, { restaurant });
  
  // Affichage du résultat
  if (result.success) {
    updateApiStatusBadge(true);
    resultEl.innerHTML = 'Connexion réussie ✅';
  } else {
    updateApiStatusBadge(false);
    resultEl.innerHTML = result.message;
  }
}
```

**Modifications ZeltyAPI** :
```javascript
// testConnection() accepte maintenant options.restaurant
async testConnection(_apiKey, _posId, _apiUrl, options = {}) {
  const body = { action: 'test' };
  if (options.restaurant) body.restaurant = options.restaurant;
  return await this._callProxy(body);
}

// fetchSales() utilise options.restaurant au lieu de restaurant_id
async fetchSales(_apiKey, _posId, _apiUrl, options = {}) {
  const body = {
    action: 'sync',
    date_start: options.date_start || yesterday,
    date_end: options.date_end || today,
  };
  if (options.restaurant) body.restaurant = options.restaurant;
  // ...
}
```

**Simplification `loadSettings()`** :
- Suppression du chargement des champs Zelty (n'existent plus)
- Suppression de `ZeltySecurity.load()`
- Conservation uniquement du chargement des paramètres restaurant et sync

**Simplification `updateApiStatusBadge()`** :
```javascript
// Avant : vérifiait saved.hasKey && !!saved.posId
// Après : reçoit directement isConnected (booléen)
function updateApiStatusBadge(isConnected) {
  badge.innerHTML = isConnected 
    ? '<i class="fas fa-check-circle"></i> Connectée ✅'
    : 'Non testée';
}
```

**Simplification `updateZeltyStatusBar()`** :
```javascript
// Avant : 3 états (connecté / configuré / manuel)
// Après : 2 états (connecté / manuel)
function updateZeltyStatusBar() {
  if (State.zeltyConnected) {
    text.textContent = 'Zelty connectée';
  } else {
    text.textContent = 'Mode manuel';
  }
}
```

**Modification `runZeltySync()`** :
```javascript
// Ajout de la résolution du restaurant courant
const ctx = window.RestaurantCtx;
const restaurant = ctx?.currentId === 'dax' ? 'dax' : 'mdm';

// Passage du paramètre restaurant au lieu de restaurant_id
await ZeltyAPI.testConnection(null, null, null, { restaurant });
await ZeltyAPI.fetchSales(null, null, null, { 
  date_start, 
  date_end, 
  restaurant 
});
```

**Nettoyage `clearDataBtn`** :
```javascript
// Supprimé : ZeltySecurity.clear()
// Conservation : reset localStorage restaurant/sync + State.zeltyConnected
```

**Event listeners** :
```javascript
// Supprimé :
- testConnectionBtn → testZeltyConnection
- saveApiSettingsBtn → saveApiSettings
- toggleApiKey → (show/hide password)

// Ajouté :
+ verifyZeltyConnectionBtn → verifyZeltyConnection
```

---

## Comportement utilisateur

### Avant (complexe)
1. Utilisateur va dans Paramètres
2. Saisit manuellement `zeltyApiKey`, `zeltyPosId`, `zeltyApiUrl`
3. Clique sur "Tester la connexion" → test en direct
4. Clique sur "Enregistrer" → sauvegarde dans `localStorage` (chiffré)
5. La clé reste dans le navigateur

### Après (simplifié)
1. Utilisateur va dans Paramètres
2. Lit le message : "Clé API sécurisée côté serveur"
3. Clique sur "Vérifier la connexion Zelty"
4. Le proxy appelle `/api/zelty/proxy` avec `{ action: "test", restaurant: "dax" }`
5. Affiche "Connectée ✅" ou message d'erreur
6. Aucune donnée stockée côté client

---

## Avantages

### Sécurité ✅
- **Clé jamais exposée** au navigateur
- **Aucun stockage localStorage** de secrets
- **Aucun risque de fuite** via DevTools ou extensions

### Simplicité ✅
- **0 champ à renseigner** côté utilisateur
- **1 seul bouton** : "Vérifier la connexion"
- **Configuration unique** côté serveur (Vercel)

### Maintenance ✅
- **Moins de code frontend** (−70 lignes)
- **Pas de gestion localStorage** pour les secrets
- **Un seul point de configuration** (variables d'env)

---

## Migration utilisateur

### Anciens utilisateurs (déjà configurés)
Les clés stockées dans `localStorage` (`zm_api_key`, `zm_pos_id`, `zm_api_url`) ne sont **plus utilisées**.  
Elles peuvent être supprimées manuellement via DevTools ou rester (ignorées).

### Nouveaux utilisateurs
Configuration directe dans Vercel → Settings → Environment Variables :
```
ZELTY_API_KEY=zlt_abc123...
ZELTY_RESTAURANT_DAX=12345
ZELTY_RESTAURANT_MDM=67890
```

---

## Tests de validation

### ✅ Test 1 — Vérification connexion
1. Aller dans Paramètres
2. Cliquer sur "Vérifier la connexion Zelty"
3. **Résultat attendu** : "Connexion réussie ✅ — Restaurant : Dax"

### ✅ Test 2 — Badge de statut
1. Après vérification réussie
2. **Résultat attendu** : Badge affiche "Connectée ✅"
3. Naviguer vers une autre page puis revenir
4. **Résultat attendu** : Badge reste "Connectée ✅" (persistance `State.zeltyConnected`)

### ✅ Test 3 — Synchronisation
1. Sélectionner "Dax" dans le menu déroulant
2. Cliquer sur "Synchroniser maintenant"
3. **Résultat attendu** : Commandes de Dax importées uniquement

### ✅ Test 4 — Erreur clé invalide
1. Retirer `ZELTY_API_KEY` de Vercel
2. Redéployer
3. Cliquer sur "Vérifier la connexion"
4. **Résultat attendu** : "Clé API Zelty non configurée"

---

## Compatibilité

| Navigateur | État |
|------------|------|
| Chrome/Edge | ✅ Testé OK |
| Firefox | ✅ Compatible |
| Safari | ✅ Compatible |
| Mobile | ✅ Responsive conservé |

---

## Rollback (si nécessaire)

Si besoin de revenir à l'ancienne version :
1. Restaurer `index.html` (formulaire complet)
2. Restaurer `js/app.js` (bloc `ZeltySecurity`, anciennes fonctions)
3. Garder quand même `/api/zelty/proxy` (fonctionnel en parallèle)

Fichiers de sauvegarde disponibles dans le Git history :
- Commit avant modification : `[hash_commit]`
- Branche de sauvegarde : `backup-zelty-form` (si créée)
