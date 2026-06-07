# UI/UX Refonte Ciblée — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter la liste des mots trouvés par joueur, des badges flèches lisibles sur les cases définitions, et une navigation par onglets sur mobile (≤ 768px).

**Architecture:** Tout client-side. `score.js` trackera les mots via événements socket existants. `grid.js` injectera un badge Unicode dans les cases description. `mflEngine.js` + `mfl.css` + `mfl.pug` géreront les onglets mobiles.

**Tech Stack:** Vanilla JS (AMD/RequireJS), CSS3, Pug (templates serveur)

---

## File Map

| Fichier | Rôle dans ce plan |
|---|---|
| `public/javascripts/game/score.js` | Tracker `_playerWords` + affichage liste mots |
| `public/javascripts/game/mflEngine.js` | Appel `trackWord` + tab bar init + badge chat |
| `public/javascripts/game/grid.js` | Badge flèche dans `insertDescription` |
| `public/stylesheets/mfl.css` | Styles badge + responsive tab bar |
| `views/mfl.pug` | Injection HTML du `.tab-bar` |

---

## Contexte code important

**`score.js`** — AMD module. `UpdatePlayerList(playerList)` reçoit `[{id, nick, monster:{color,path}, score, nbWords}]`. `RefreshScore(scoreObj)` reçoit `{playerID, score, words, progress, bonus:[]}`. `resetScores()` remet les barres à 0.

**`mflEngine.js`** — `_wordFoundedHandler` dans `onStartGame` appelle `_gridManager.RevealWord(wordObj)` où `wordObj = {word, axis, start, color}`. `setupGameListeners` enregistre `_socket.on('found_words', ...)` qui rejoue les mots au rejoin.

**`grid.js`** — `insertDescription(line, col, size, info)` : `info.nbDesc` spans, chacun avec `info.desc[i]` (texte) et `info.arrow[i]` (int ou null). Arrow values : `0=→  1=→↓  2=↓  3=↓→`. Actuellement ajoute classe `arrow0`/`arrow1`/`arrow2`/`arrow3` sur le span → déclenche `::after` CSS positionné hors case.

**`mfl.css`** — Breakpoint `@media screen and (max-width: 768px)` existe déjà (ligne 987). IDs réels : `#gs-chat`, `#gs-grid-container`, `#gs-scores`, `#game-panel`.

**Pas de test runner.** Les étapes "Vérifier" décrivent la vérification manuelle dans le navigateur avec `npm start`.

---

## Task 1 — Score : tracker des mots trouvés

**Files:**
- Modify: `public/javascripts/game/score.js`

### Contexte

`score_update` n'inclut pas la liste des mots — uniquement le count (`words`). On trackera les mots côté client via l'événement `word_founded` `{word, color}`. Les couleurs des joueurs seront extraites lors de `UpdatePlayerList`.

- [ ] **Step 1 — Ajouter les variables module + méthode `trackWord`**

Remplacer le début de `score.js` (après `define(function () {`) :

```javascript
define(function () {

  var SCORE_BAR_PERCENT_WIDTH   = 21;
  var DELAY_BETWEEN_BONUSES     = 200;

  // playerID -> hex color string (populated by UpdatePlayerList)
  var _playerColors = {};
  // playerID -> array of word strings (populated by trackWord)
  var _playerWords  = {};
```

- [ ] **Step 2 — Modifier `UpdatePlayerList` pour peupler `_playerColors`**

Remplacer `Score.prototype.UpdatePlayerList` en entier :

```javascript
Score.prototype.UpdatePlayerList = function(playerList) {
  var i,
      nbPlayers = playerList.length,
      scoreNode = document.getElementById('gs-scores');

  scoreNode.innerHTML = '';

  for (i = 0; i < nbPlayers; i++) {
    if (playerList[i].monster) {
      _playerColors[playerList[i].id] = playerList[i].monster.color;
      if (!_playerWords[playerList[i].id]) _playerWords[playerList[i].id] = [];
      scoreNode.innerHTML += '<article id="player' + playerList[i].id + '" class="playerScore bloc' + nbPlayers + '">' +
        '<div class="score-bar" style="background-color: ' + playerList[i].monster.color + '">' +
        '<img src="' + playerList[i].monster.path + '"></div>' +
        '<footer>' +
        '<h3>' + playerList[i].nick + '</h3>' +
        '<strong>' + playerList[i].score + ' points</strong>' +
        '<span>' + playerList[i].nbWords + ' mots</span>' +
        '<div class="player-word-list" id="words-' + playerList[i].id + '"></div>' +
        '</footer></article>';
    }
  }

  // Re-render word lists for players we already have data for
  for (i = 0; i < nbPlayers; i++) {
    _renderWordList(playerList[i].id, playerList[i].monster ? playerList[i].monster.color : '#fff');
  }
};
```

- [ ] **Step 3 — Ajouter `trackWord` et `_renderWordList`**

Insérer avant `Score.prototype.RefreshScore` :

```javascript
Score.prototype.trackWord = function(wordObj) {
  // Find playerID by matching color
  var pid = null;
  for (var id in _playerColors) {
    if (_playerColors[id] === wordObj.color) { pid = id; break; }
  }
  if (pid === null) return;
  if (!_playerWords[pid]) _playerWords[pid] = [];
  _playerWords[pid].push(wordObj.word);
  _renderWordList(pid, wordObj.color);
};

function _renderWordList(playerID, color) {
  var el = document.getElementById('words-' + playerID);
  if (!el) return;
  var words = _playerWords[playerID] || [];
  el.innerHTML = words.map(function(w) {
    return '<span class="word-tag" style="background:' + color + '">' + w + '</span>';
  }).join('');
}
```

- [ ] **Step 4 — Modifier `resetScores` pour vider les listes**

Remplacer `Score.prototype.resetScores` en entier :

```javascript
Score.prototype.resetScores = function() {
  var scoreNodes = document.querySelectorAll('.playerScore'),
      size, i;

  _playerWords = {};

  for (i = 0, size = scoreNodes.length; i < size; i++) {
    scoreNodes[i].querySelector('div').style.height = '0%';
    scoreNodes[i].querySelector('footer > strong').innerHTML = '0 points';
    scoreNodes[i].querySelector('footer > span').innerHTML = '0 mots';
    var wl = scoreNodes[i].querySelector('.player-word-list');
    if (wl) wl.innerHTML = '';
  }
};
```

- [ ] **Step 5 — Ajouter le CSS des word-tags dans `mfl.css`**

Ajouter à la fin de la section "Score part" (après la règle `#gs-scores`, avant le commentaire `/* Responsive grid */`) :

```css
/* Word tags in score panel */
.player-word-list {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 4px;
}
.word-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: bold;
  color: #111;
  font-family: 'abeezeeregular', sans-serif;
}
```

- [ ] **Step 6 — Vérifier visuellement**

```
npm start
```

Ouvre `http://localhost:2121`. Rejoins une salle, joue. Quand un mot est trouvé, vérifie que le tag coloré apparaît sous le nom du joueur dans le panneau score.

- [ ] **Step 7 — Commit**

```bash
git add public/javascripts/game/score.js public/stylesheets/mfl.css
git commit -m "feat(score): afficher liste des mots trouvés par joueur"
```

---

## Task 2 — Câbler trackWord dans mflEngine.js

**Files:**
- Modify: `public/javascripts/game/mflEngine.js`

### Contexte

`_wordFoundedHandler` est défini dans `onStartGame`. Il appelle `_gridManager.RevealWord(wordObj)`. On y ajoute `_scoreManager.trackWord(wordObj)`.

Le handler `found_words` (rejoin) appelle `_gridManager.RevealWord(words[i])` dans un `setTimeout`. On y ajoute aussi `_scoreManager.trackWord(words[i])`.

- [ ] **Step 1 — Modifier `_wordFoundedHandler` dans `onStartGame`**

Dans `onStartGame`, remplacer :

```javascript
_wordFoundedHandler = function (wordObj) { _gridManager.RevealWord(wordObj); };
```

par :

```javascript
_wordFoundedHandler = function (wordObj) {
  _gridManager.RevealWord(wordObj);
  _scoreManager.trackWord(wordObj);
};
```

- [ ] **Step 2 — Modifier le handler `found_words` pour le rejoin**

Dans `setupGameListeners`, remplacer la fonction `replay` :

```javascript
_socket.on('found_words', function (words) {
  function replay() {
    if (!_gridManager) return;
    for (var i = 0; i < words.length; i++) {
      _gridManager.RevealWord(words[i]);
      _scoreManager.trackWord(words[i]);
    }
  }
  setTimeout(replay, 300);
});
```

- [ ] **Step 3 — Vérifier le rejoin**

```
npm start
```

1. Ouvre deux onglets, rejoins la même salle.
2. Trouve quelques mots dans l'onglet 1.
3. Rafraîchis l'onglet 1 (F5).
4. Vérifie que la liste des mots est reconstruite après reconnexion automatique.

- [ ] **Step 4 — Commit**

```bash
git add public/javascripts/game/mflEngine.js
git commit -m "feat(engine): câbler trackWord sur word_founded et found_words"
```

---

## Task 3 — Badges flèches sur cases description

**Files:**
- Modify: `public/javascripts/game/grid.js`
- Modify: `public/stylesheets/mfl.css`

### Contexte

`insertDescription` ajoute actuellement `arrow0`/`arrow1`/`arrow2`/`arrow3` sur les spans → déclenche des `::after` CSS positionnés hors de la case (bug connu). On remplace par un badge `<span class="arrow-badge">` injecté directement dans le `.frame`.

Mapping arrow int → symbole Unicode :
- `0` → `→`
- `1` → `→↓`
- `2` → `↓`
- `3` → `↓→`

- [ ] **Step 1 — Modifier `insertDescription` dans `grid.js`**

Remplacer la fonction `insertDescription` en entier :

```javascript
function insertDescription(line, column, size, info) {
  var frame = document.createElement('div'),
      lineHeight,
      fontSize,
      descNode,
      i;

  frame.className = 'frame description frame' + info.pos;
  frame.style.width = size + 'px';
  frame.style.height = size + 'px';
  frame.style.top = (line * size) + 'px';
  frame.style.left = (column * size) + 'px';
  frame.setAttribute('data-line', line);
  frame.setAttribute('data-col', column);
  frame.setAttribute('data-pos', info.pos);

  if (info.nbLines === 1) {
    lineHeight = size;
    fontSize = Math.max(10, Math.floor(size / 5.4));
  } else {
    lineHeight = Math.floor(size / info.nbLines);
    fontSize = Math.max(10, Math.floor(size / 5.5));
  }

  frame.style.lineHeight = lineHeight + 'px';
  frame.style.fontSize = fontSize + 'px';

  var arrowSymbols = ['→', '→↓', '↓', '↓→'];
  var badgeText = '';

  for (i = 0; i < info.nbDesc; i++) {
    descNode = document.createElement('span');
    descNode.innerHTML = info.desc[i];
    // No arrowN class — badge replaces the ::after arrows
    frame.appendChild(descNode);

    if (info.arrow[i] !== null && arrowSymbols[info.arrow[i]]) {
      badgeText += arrowSymbols[info.arrow[i]];
    }
  }

  if (badgeText) {
    var badge = document.createElement('span');
    badge.className = 'arrow-badge';
    badge.textContent = badgeText;
    frame.appendChild(badge);
  }

  return frame;
}
```

- [ ] **Step 2 — Ajouter le CSS `.arrow-badge` dans `mfl.css`**

Ajouter juste après la règle `.description {` (après la ligne `background: url('../images/grey.png');`) :

```css
/* Arrow direction badge — replaces ::after arrows */
.arrow-badge {
  position: absolute;
  bottom: 2px;
  right: 2px;
  background: #e8c840;
  color: #111;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 10px;
  font-weight: bold;
  line-height: 1;
  pointer-events: none;
}
```

- [ ] **Step 3 — Vérifier visuellement**

```
npm start
```

Charge une grille. Vérifie que :
- Les cases noires affichent un badge jaune en bas à droite avec `→`, `↓`, `→↓` ou `↓→`
- Le texte de définition est lisible (min 10px)
- Aucune flèche ne déborde hors de la case

- [ ] **Step 4 — Commit**

```bash
git add public/javascripts/game/grid.js public/stylesheets/mfl.css
git commit -m "feat(grid): badge flèche coloré sur cases définitions, font min 10px"
```

---

## Task 4 — Responsive : onglets mobiles

**Files:**
- Modify: `views/mfl.pug`
- Modify: `public/stylesheets/mfl.css`
- Modify: `public/javascripts/game/mflEngine.js`

### Contexte

Un `#tab-bar` est injecté dans `#game-panel`. Sur desktop (`> 768px`), `display: none`. Sur mobile, les panneaux `#gs-chat`, `#gs-grid-container`, `#gs-scores` sont masqués par défaut — seul celui avec `.tab-active` est visible. `switchTab(name)` dans `mflEngine.js` gère la bascule. Un badge rouge s'affiche sur l'onglet Chat à chaque nouveau message si l'onglet n'est pas actif.

- [ ] **Step 1 — Injecter le tab bar dans `mfl.pug`**

Dans `views/mfl.pug`, repérer la ligne `section#gs-scores` (~ligne 80). Ajouter le bloc `div#tab-bar` juste APRÈS (même niveau d'indentation que les `section`) :

```pug
      section#gs-scores

      div#tab-bar
        button.tab-btn(data-tab='grid') Grille
        button.tab-btn(data-tab='score') Scores
        button.tab-btn(data-tab='chat')
          | Chat 
          span#chat-badge(class='chat-badge')
```

Ne pas modifier les `section` existantes — ajouter uniquement le `div#tab-bar`.

- [ ] **Step 2 — CSS desktop : cacher le tab bar**

Ajouter juste avant le bloc `@media screen and (max-width: 1599px)` dans `mfl.css` :

```css
/* Tab bar — hidden on desktop, shown via mobile media query */
#tab-bar { display: none; }
```

- [ ] **Step 3 — CSS mobile : tab bar + panneaux à onglets**

Dans `mfl.css`, à l'intérieur du bloc `@media screen and (max-width: 768px)` existant (avant la `}` fermante finale à la ligne 1042), ajouter :

```css
  /* Tab bar */
  #tab-bar {
    display: flex;
    flex-shrink: 0;
    height: 50px;
    background: #1a1a2e;
    border-top: 1px solid rgba(127,140,141,0.3);
    order: 10;
  }
  .tab-btn {
    flex: 1;
    height: 100%;
    background: none;
    border: none;
    border-top: 3px solid transparent;
    color: #aaa;
    font-family: 'abeezeeregular', sans-serif;
    font-size: 13px;
    cursor: pointer;
    position: relative;
  }
  .tab-btn.active {
    color: #7ec87e;
    border-top-color: #7ec87e;
  }
  .chat-badge {
    display: none;
    position: absolute;
    top: 8px;
    right: calc(50% - 18px);
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #e74c3c;
  }
  .chat-badge.visible { display: block; }

  /* Hide all panels by default — tab-active shows the right one */
  #gs-chat, #gs-grid-container, #gs-scores {
    display: none !important;
    float: none !important;
    width: 100% !important;
  }
  #gs-chat.tab-active,
  #gs-grid-container.tab-active,
  #gs-scores.tab-active {
    display: flex !important;
    flex-direction: column;
    flex: 1 1 auto;
    overflow: auto;
  }
  #gs-chat.tab-active {
    display: block !important;
    height: calc(100% - 50px) !important;
  }
```

- [ ] **Step 4 — Ajouter `switchTab` et `initTabBar` dans `mflEngine.js`**

Ajouter ces deux fonctions avant `function showError(msg)` :

```javascript
function initTabBar() {
  var bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchTab(btn.getAttribute('data-tab'));
    });
  });
  switchTab('grid');
}

function switchTab(name) {
  var panels = { grid: 'gs-grid-container', score: 'gs-scores', chat: 'gs-chat' };
  Object.keys(panels).forEach(function(t) {
    var el = document.getElementById(panels[t]);
    if (el) el.classList.toggle('tab-active', t === name);
  });
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === name);
  });
  if (name === 'chat') {
    var badge = document.getElementById('chat-badge');
    if (badge) badge.classList.remove('visible');
  }
}
```

- [ ] **Step 5 — Appeler `initTabBar()` au démarrage**

Dans `mflEngine.js`, au niveau du bootstrap (juste après `startLobby();`), ajouter :

```javascript
initTabBar();
```

- [ ] **Step 6 — Badge chat sur nouveaux messages**

Dans `setupGameListeners()`, ajouter après la ligne `_socket.on('game_over', ...)` :

```javascript
_socket.on('chat', function() {
  var chatPanel = document.getElementById('gs-chat');
  if (chatPanel && !chatPanel.classList.contains('tab-active')) {
    var badge = document.getElementById('chat-badge');
    if (badge) badge.classList.add('visible');
  }
});
```

- [ ] **Step 7 — Vérifier sur mobile**

```
npm start
```

1. Ouvre `http://<IP>:2121` sur un téléphone ou redimensionne le navigateur à < 768px.
2. Vérifie que trois onglets s'affichent en bas : **Grille**, **Scores**, **Chat**.
3. Clique chaque onglet — vérifie que le panneau correspondant s'affiche seul.
4. Envoie un message chat depuis un autre joueur — vérifie le badge rouge sur l'onglet Chat.
5. Clique Chat — vérifie que le badge disparaît.
6. Sur desktop (> 768px) : vérifie que le tab bar est invisible et le layout normal.

- [ ] **Step 8 — Commit**

```bash
git add views/mfl.pug public/stylesheets/mfl.css public/javascripts/game/mflEngine.js
git commit -m "feat(responsive): onglets Grille/Scores/Chat sur mobile ≤768px"
```

---

## Vérification finale

- [ ] Lancer `npm start`, jouer une partie complète à 2 joueurs
- [ ] Panneau score : liste des mots sous chaque joueur, couleur correcte
- [ ] Rejoin (F5 pendant la partie) : liste des mots reconstruite
- [ ] Cases description : badge jaune `→`/`↓`/`→↓`/`↓→` en bas-droite, texte ≥ 10px
- [ ] Mobile ≤ 768px : onglets fonctionnels, aucun débordement
- [ ] Desktop > 768px : layout identique à avant (tab bar invisible)
