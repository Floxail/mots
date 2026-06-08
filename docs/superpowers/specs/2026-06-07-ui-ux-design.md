# UI/UX Refonte Ciblée — Design Spec

**Date:** 2026-06-07  
**Branche cible:** MAJ-2026  

---

## Objectif

Améliorer la lisibilité du jeu et la visibilité des contributions de chaque joueur, avec un minimum de support responsive (tablette + mobile clavier physique). Zéro changement backend.

---

## Scope

Trois axes :
1. **Contributions joueur** — voir quels mots chaque joueur a trouvés
2. **Cases définitions** — flèches et texte plus lisibles
3. **Responsive** — onglets sur petit écran (≤ 768px)

Hors scope : redesign visuel global, animations, sons, persistance scores, support clavier tactile mobile.

---

## 1. Contributions joueur — liste des mots dans le score panel

### Problème
`score_update` envoie `{playerID, score, words (count), progress, bonus}` — pas la liste des mots. Le panneau score affiche seulement le total de points.

### Solution : tracker client-side dans `score.js`

- Maintenir `_playerWords = {}` — objet keyed by `playerID`, valeur = array de strings
- Maintenir `_playerColors = {}` — keyed by `playerID`, valeur = couleur hex
- Populer `_playerColors` à chaque `score_update` via `playerID` + couleur reçue dans `chat` player list
- À chaque événement `word_founded` : `{word, color}` → matcher couleur → trouver playerID → `_playerWords[playerID].push(word)`
- Au rejoin : `found_words` replay → même logique, reconstruire `_playerWords`
- `RefreshScore(data)` : afficher sous le score les mots sous forme de tags colorés (même couleur que le joueur)

### Rendu attendu (score panel)

```
● Player1  12 pts  ████████░░
  CHAT · ARBRE · SOL

● Player2  6 pts   ████░░░░░░
  FILM · ROSE
```

### Fichiers modifiés
- `public/javascripts/game/score.js`

---

## 2. Cases définitions — badge flèche + texte agrandi

### Problème
Flèches positionnées en `::after` CSS parfois hors des cases. Texte définition 7-8px illisible sur les grandes grilles.

### Solution : badge inline + typographie

- Dans `grid.js` → `DisplayGrid()`, pour chaque `DescriptionCase` :
  - Injecter un `<span class="arrow-badge">` contenant le symbole Unicode de direction (`→`, `↓`, `→↓`, `↓→`)
  - Positionner en `position: absolute; bottom: 2px; right: 2px`
- Supprimer les règles CSS `::after` existantes pour les flèches des DescriptionCase
- Augmenter `font-size` du texte définition dans les cases noires : `7px` → `10px`
- `.arrow-badge` : `background: #e8c840; color: #111; border-radius: 3px; padding: 1px 4px; font-size: 10px; font-weight: bold; line-height: 1`

### Fichiers modifiés
- `public/javascripts/game/grid.js`
- `public/stylesheets/mfl.css`

---

## 3. Responsive — onglets mobile (≤ 768px)

### Problème
Layout desktop (flex row : chat | grille | scores) s'écrase sur tablette/mobile. Grille déborde, chat inaccessible.

### Solution : tab bar CSS + JS minimal

**Structure DOM existante** (inchangée) :
- `#gs-chat` — panneau chat gauche
- `#gs-grid-container` — grille centre  
- `#gs-scores` — scores droite
- `#game-panel` — conteneur principal flex

**Ajouts CSS** (`@media (max-width: 768px)`) :
- `#game-panel` passe en `flex-direction: column`
- `#gs-chat`, `#gs-grid-container`, `#gs-scores` : `display: none` par défaut sauf celui avec classe `.tab-active`
- `.tab-bar` fixe en bas, 3 boutons : **Grille** / **Scores** / **Chat**
- Touch targets min 44px hauteur
- Onglet actif par défaut : Grille

**JS dans `mflEngine.js`** :
```javascript
function switchTab(name) {
  var panels = { grid: 'gs-grid-container', score: 'gs-scores', chat: 'gs-chat' };
  Object.keys(panels).forEach(function(t) {
    document.getElementById(panels[t]).classList.toggle('tab-active', t === name);
  });
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  if (name === 'chat') clearChatBadge();
}
```

**Notification chat** :
- À chaque événement `chat` reçu : si onglet actif ≠ Chat, afficher badge rouge sur bouton Chat
- `clearChatBadge()` appelé au switch vers Chat

**Fichiers modifiés** :
- `public/stylesheets/mfl.css` (media queries + tab bar styles)
- `views/mfl.pug` (injection `.tab-bar` dans `#game-panel`)
- `public/javascripts/game/mflEngine.js` (`switchTab`, badge notif)

---

## Résumé des fichiers touchés

| Fichier | Changement |
|---|---|
| `public/javascripts/game/score.js` | `_playerWords` tracker + affichage liste mots |
| `public/javascripts/game/grid.js` | badge flèche dans `DisplayGrid()` |
| `public/javascripts/game/mflEngine.js` | `switchTab()` + badge notif chat |
| `public/stylesheets/mfl.css` | badge styles + responsive tab bar |
| `views/mfl.pug` | injection `.tab-bar` HTML |

Backend inchangé.

---

## Critères de succès

- Panneau score affiche la liste des mots trouvés par chaque joueur
- Cases définitions : flèche lisible en badge jaune, texte ≥ 10px
- Sur écran ≤ 768px : onglets fonctionnels, pas de débordement horizontal
- Aucune régression sur desktop (layout identique au-dessus de 768px)
- Rejoin/refresh : liste des mots reconstruite correctement via `found_words`
