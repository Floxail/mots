# Générateur de grilles "Mots Fléchés" maison — Design

Date : 2026-07-20
Branche : `feature/grid-generator` (isolée de `master` — merge seulement après tests validés)

## Contexte et objectif

Le jeu récupère aujourd'hui ses grilles depuis GSO (rcijeux.fr, format `.mfj`, voir `game_files/gridManager.js`).
Objectif : s'affranchir de cette dépendance en générant des grilles localement, avec un dictionnaire
mots+définitions constitué en scrapant les grilles GSO existantes (source ponctuelle, pas de dépendance
à l'exécution).

Le générateur doit produire une sortie strictement compatible avec la structure serveur actuelle
(`game_files/case.js`, `game_files/enums.js`) afin que `motsFleches.js` et tout le front restent inchangés —
seul `GridManager` change de source (réseau GSO → génération locale).

## Décisions actées (issues de la clarification)

| Point | Décision |
|---|---|
| Dictionnaire | Scraper toutes les grilles GSO disponibles (~1292–2117, ~2401–2600, cf. `scan-grids.js`) via `gridManager.js` réutilisé, extraire paires mot+définition(s), dédupliquer → `dico.json` local. Une wordlist publique pourra être ajoutée plus tard (définitions à fournir manuellement) — hors scope de cette première version. |
| Format export | 100% compatible avec `Case.LetterCase` / `Case.DescriptionCase` / `Case.EmptyCase` et `enums.CaseType` / arrows actuels. |
| Style de grille | "Mots fléchés" dense façon GSO (pas de mots crossés isolés par cases noires) : cases-description contiennent 1 ou 2 définitions + flèche(s), les lettres s'entrecroisent sans séparateur. |
| Densité cases-description | Dérivée empiriquement des grilles GSO scrapées (pas de ratio arbitraire fixe). |
| Taille par défaut | 15×15, budget génération < 5s. Paramétrable en CLI. |
| Contrainte lettres | Uniquement `A`-`Z` non accentué (contrainte héritée de `getCaseType` dans `gridManager.js` — un caractère hors `A`-`Z` serait interprété comme case-description). Les mots/définitions scrapés sont normalisés (accents retirés, majuscules) pour le remplissage de grille ; les définitions elles-mêmes gardent leurs accents (texte affiché, pas contrainte de parsing). |

## Pipeline

```
1. scripts/scrape-dico.js   → télécharge les grilles GSO connues, extrait mot+définition(s) par case-description, dédupe → data/dico.json
2. scripts/analyze-gso.js   → sur les mêmes grilles, calcule stats réelles : ratio cases-description/total,
                               distribution des longueurs de segments, ratio cases à 1 vs 2 définitions → data/gso-stats.json
3. scripts/generate-grid.js → génère une grille NxM à partir de dico.json + gso-stats.json, exporte JSON
                               compatible case.js/enums.js
```

Les scripts 1 et 2 sont des utilitaires à lancer ponctuellement (pas au runtime du jeu). Le script 3 est le
générateur utilisable en CLI ou importable comme module (futur remplacement de `GridManager.retreiveAndParseGrid`).

## Structures de données

### Dictionnaire indexé

- `dico.json` : `[{ word: "ABEILLE", definitions: ["Butine les fleurs"] }, ...]`
- Chargé en mémoire sous forme :
  - `Map<longueur, string[]>` — liste des mots par longueur
  - `Map<longueur, Map<position, Map<lettre, Set<mot>>>>` — index croisé permettant de répondre
    rapidement "quels mots de longueur L ont la lettre X en position P ?", utilisé pour le
    forward-checking pendant le backtracking (technique standard de résolution de mots croisés).
  - `Map<mot, string[]>` — accès direct aux définitions d'un mot pour l'export final.

### Skeleton (squelette de grille)

Tableau plat `nbLines * nbColumns`, chaque case taggée `Letter | Description | Empty` avant tout
remplissage de lettres. Généré à partir de `gso-stats.json` :

- Segments de cases-lettres consécutifs (horizontaux et verticaux) tirés selon la distribution réelle
  de longueurs observée sur GSO (pas uniforme).
- Chaque case-description démarre un ou deux segments (horizontal et/ou vertical), selon le ratio
  1-def/2-def observé.
- Contrainte de validité : toute case-lettre doit appartenir à au moins un slot (segment) horizontal
  ou vertical exploitable — pas de case orpheline.

### Slots

Dérivés du skeleton après sa génération : chaque segment de cases-lettres consécutives (borné par
description/empty/bord de grille) devient un slot avec :
- longueur fixe
- position de départ + direction (horizontal/vertical)
- liste des croisements avec d'autres slots (index de case partagée)

## Algorithme de remplissage (backtracking)

1. **Ordonnancement MRV** : les slots sont triés par contrainte décroissante — longueur rare dans le
   dico d'abord, puis nombre de croisements élevé d'abord (Most Constrained Variable en premier).
2. **Génération de candidats** : pour un slot donné, requête l'index dico par longueur + lettres déjà
   fixées par les croisements déjà résolus (forward-checking, pas de génère-puis-filtre).
3. **Propagation** : poser un mot dans un slot met à jour immédiatement les cases partagées ; si un
   slot croisé se retrouve sans candidat possible, backtrack immédiat (pas d'exploration inutile).
4. **Unicité** : un mot déjà utilisé dans la grille est exclu des candidats des autres slots.
5. **Budget** : timeout de 5s ou N backtracks max (paramétrable) par tentative de skeleton. Si épuisé
   sans solution, le skeleton est regénéré (nouvelle tentative, jusqu'à M tentatives globales) plutôt
   que de prolonger un backtracking sur un squelette potentiellement infaisable.

## Assignation des définitions et flèches

Réutilise l'algorithme exact de `gridManager.js::insertDescription` / `getNextCase` (scan en ordre de
lecture "InARow", remplit `desc[0]` puis `desc[1]` de chaque case-description dans l'ordre) — garantit
un rendu identique au front actuel, aucune adaptation de `motsFleches.js` ou du client requise.

Les flèches ne sont pas déduites d'un caractère `a`-`w` comme dans le format GSO : la géométrie réelle
des slots rattachés à chaque case-description est connue directement (on sait si elle démarre un slot
horizontal, vertical, ou les deux), donc l'attribution des `enumArrow` est directe et sans ambiguïté.

## Export

Même forme que `GridManager.prototype.getFullGrid()` : `{ nbLines, nbColumns, nbWords, cases: [...], infos }`,
directement substituable à la sortie actuelle de `gridManager.js`.

## Gestion des erreurs / cas limites

- Skeleton jugé infaisable après budget de backtracking épuisé → regénération (budget global de tentatives,
  échec propre avec message clair si toutes échouent — pas de boucle infinie).
- Dictionnaire trop petit pour une longueur de slot donnée → cette longueur de segment est évitée dès
  la génération du skeleton (contrainte connue à l'avance via les tailles disponibles dans l'index).
- Mots avec caractères hors `A`-`Z` après normalisation (rare, ex. mots composés avec espace/tiret) →
  exclus du dico de remplissage à l'ingestion (scrape-dico.js filtre).

## Tests / validation

- Script de validation post-génération : vérifie qu'aucune case-lettre n'est orpheline, que chaque
  case-description a au moins une définition assignée, que tous les mots posés existent bien dans le
  dico, pas de doublon de mot dans la grille.
- Test de compatibilité : charger une grille générée dans le pipeline `motsFleches.js` existant (mode
  solo) et vérifier que le jeu se déroule normalement (mots validables, bonus, game over).
- Avant merge sur `master` : test manuel en conditions réelles sur la branche `feature/grid-generator`
  (le jeu actuel via GSO reste intouché tant que ce n'est pas mergé).

## Hors scope (v1)

- Wordlist publique complémentaire avec définitions manuelles (mentionnée par l'utilisateur comme
  suite possible).
- Persistance / base de données du dico (fichier JSON suffit pour l'instant).
- Thèmes de grille, niveaux de difficulté ajustables.
