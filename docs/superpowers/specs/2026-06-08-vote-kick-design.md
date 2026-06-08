# Vote Grille + Kick Inactif — Design Spec

**Date:** 2026-06-08
**Branche cible:** nouvelle branche depuis master

---

## Objectif

Deux nouvelles commandes chat pour améliorer la gestion des parties multijoueur :
1. `!grid N` pendant une partie déclenche un vote au lieu d'agir directement
2. `!kick <pseudo>` expulse immédiatement un joueur inactif depuis ≥10 min

---

## Scope

- Vote uniquement pour `!grid N` pendant une partie en cours (pas `!start`, pas en salle d'attente)
- Kick pendant une partie ET en salle d'attente
- Inactivité = aucun mot trouvé + aucun message chat depuis ≥10 min (depuis le `userIsReady`)
- Pas de vote pour le kick — direct si condition remplie

Hors scope : historique votes, niveaux de permissions, vote `!start`.

---

## 1. Vote `!grid N`

### Déclencheur

`!grid N` tapé pendant `gameState === ServerState.OnGame`.

En salle d'attente (`WaitingForPlayers`), `!grid N` continue de fonctionner comme avant (changement direct, pas de vote).

### Flow complet

```
Joueur A: !grid 2120
  → Serveur: crée PendingVote, vote A = oui automatiquement
  → Broadcast chat: "⚡ Vote lancé par A : grille #2120 — tapez !oui ou !non (30s)"
  → Timeout 30s démarré

Joueur B: !oui
  → Serveur: enregistre vote B = oui
  → Si majorité atteinte → résolution immédiate
  → Broadcast chat: "✅ Vote accepté (2/2) — changement de grille..."
  → !grid 2120 exécuté normalement

--- OU ---

Joueur B: !non
  → Serveur: enregistre vote B = non
  → Si majorité rejet → annulation immédiate
  → Broadcast chat: "❌ Vote refusé (1 non)"

--- OU ---

Timeout 30s:
  → Broadcast chat: "⏱ Vote expiré — grille inchangée"
  → _pendingVote = null
```

### Règles de majorité

- Majorité absolue = strictement plus de la moitié des joueurs de la salle
- Initiateur compte comme vote `oui` automatique
- Joueur qui rejoint pendant le vote ne compte pas (snapshot à la création du vote)
- Résolution dès que majorité atteinte (pas d'attente du timeout)

### Erreurs

| Condition | Message chat serveur |
|-----------|---------------------|
| Vote déjà actif | `"⚠ Un vote est déjà en cours"` |
| En salle d'attente | (change directement, pas de vote) |
| `!oui`/`!non` sans vote actif | Ignoré silencieusement |
| Joueur vote deux fois | Ignoré silencieusement |

### Implémentation

Nouvelle classe `PendingVote` dans `game_files/motsFleches.js` :

```javascript
function PendingVote(type, target, playerIds, onAccept, onReject, timeoutMs) {
  this.type      = type;       // 'grid'
  this.target    = target;     // numéro de grille
  this.votes     = {};         // { playerId: true/false }
  this.playerIds = playerIds;  // snapshot des joueurs au moment du vote
  this._timer    = setTimeout(onReject, timeoutMs);
  this._onAccept = onAccept;
  this._onReject = onReject;
}

PendingVote.prototype.vote = function(playerId, value) {
  if (this.votes[playerId] !== undefined) return; // déjà voté
  this.votes[playerId] = value;
};

PendingVote.prototype.resolve = function() {
  var total  = this.playerIds.length;
  var yes    = this.playerIds.filter(id => this.votes[id] === true).length;
  var no     = this.playerIds.filter(id => this.votes[id] === false).length;
  if (yes > total / 2)  { clearTimeout(this._timer); this._onAccept(yes, total); return 'accept'; }
  if (no  >= total / 2) { clearTimeout(this._timer); this._onReject();            return 'reject'; }
  return 'pending';
};
```

`GameRoom` gagne :
- `this._pendingVote = null` (initialisé dans le constructeur)
- Gestion de `!oui` / `!non` dans le handler `chat`
- `!grid N` pendant `OnGame` crée un `PendingVote` au lieu d'appeler `changeGrid()`

---

## 2. `!kick <pseudo>`

### Déclencheur

N'importe quel joueur connecté tape `!kick Alice` (pendant partie ou en attente).

### Flow complet

```
Joueur B: !kick Alice
  → Serveur vérifie Alice existe dans la salle
  → Vérifie Date.now() - alice.lastActivity >= 10 * 60 * 1000
  → Si ok : kick
      alice.socket.emit('kicked', { reason: 'inactivité' })
      alice.socket.disconnect()
      PlayersManager.removePlayer(alice)
      Broadcast chat: "🚪 Alice a été expulsée pour inactivité (10 min sans activité)"
  → Si pas assez inactif : message privé à B
      "⚠ Alice n'est pas inactive depuis suffisamment longtemps"
  → Si Alice n'existe pas :
      "⚠ Joueur introuvable : Alice"
  → Si B essaie de se kicker lui-même :
      "⚠ Vous ne pouvez pas vous expulser vous-même"
```

### Suivi d'inactivité

`Player` gagne propriété `lastActivity` (timestamp ms).

Mis à jour dans :
- `userIsReady` → `player.lastActivity = Date.now()`
- Réception `wordValidation` valide → `player.lastActivity = Date.now()`
- Réception message `chat` d'un joueur → `player.lastActivity = Date.now()`

### Événement client `kicked`

Nouveau événement Socket.IO serveur → client :

```javascript
socket.emit('kicked', { reason: 'inactivité' })
```

Client (`mflEngine.js`) : handler `socket.on('kicked', ...)` → affiche `showError("Vous avez été expulsé pour inactivité")` puis reset UI vers le panel login après 3 secondes.

### Edge case : partie avec un seul joueur restant

Si kick réduit le nombre de joueurs à 0 pendant `OnGame` :
- Appeler `resetPlayersForNewGame()` + `grid_reset` broadcast
- Retour à `WaitingForPlayers`

Si 1 joueur restant : partie continue normalement en solo.

### Implémentation

- `Player.prototype` : ajout `this.lastActivity = Date.now()` dans le constructeur
- `PlayersManager` : `kickPlayer(nick, reason)` — retire + déconnecte
- `motsFleches.js` handler `chat` : parser `!kick <pseudo>`, vérifications, appel `kickPlayer`
- `mflEngine.js` : `socket.on('kicked', handler)`

---

## Résumé des fichiers touchés

| Fichier | Changement |
|---------|-----------|
| `game_files/motsFleches.js` | Classe `PendingVote`, handler `!grid`/`!oui`/`!non`/`!kick` |
| `game_files/player.js` | Propriété `lastActivity` |
| `game_files/playersManager.js` | Méthode `kickPlayer(nick, reason)` |
| `public/javascripts/game/mflEngine.js` | Handler événement `kicked` |

---

## Critères de succès

- `!grid N` pendant partie → vote visible dans chat, résolution correcte (accept/refus/timeout)
- `!grid N` en salle d'attente → changement direct (pas de vote, comportement inchangé)
- `!kick Alice` → expulsion si inactive ≥10 min, messages d'erreur sinon
- Joueur kické → UI reset vers login avec message explicite
- Aucune régression sur `!start`, `!grid` en attente, rejoin, mots trouvés
