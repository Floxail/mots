# Spec — Générateur de grilles v2 : masque par hillclimber + fill contraint

Date : 2026-08-23
Statut : validé en discussion, en attente de revue du document
Remplace : l'ensemble de `grid_generator/` (skeleton/backtracking/slots/exporter/validate) et `scripts/generate-grid.js`

## 1. Contexte et objectif

Le générateur actuel produit un squelette par balayage aléatoire ligne-par-ligne puis
tente de le remplir par backtracking avec un budget énorme (300 s / 50 M backtracks par
tentative). Deux problèmes constatés en pratique :

- **Qualité du masque incontrôlée** : chaînes de cases définition (« ligne complète de
  défs sur un côté »), distribution des longueurs de mots subie (mots de 9+ lettres
  fréquents), aucune notion d'esthétique. ~88 % des squelettes sont rejetés avant
  résolution (edge-starts), le reste est lent à remplir.
- **Vitesse** : le remplissage échoue ou rame précisément parce que les masques
  imposent des croisements de mots longs, rares dans un dico de 56 k mots.

Référence principale : thèse TUM de Jakob Engel (2009), *Generating Swedish-style
Crossword Puzzle Masks using Evolutionary Algorithms* — exactement ce problème.
Conclusions reprises ici : le masque se génère par **optimisation d'une fonction de
pénalité** (validité + qualité unifiées) via un **hillclimber** ; un hillclimber seul bat
un algorithme génétique complet et atteint l'essentiel de la qualité du memetic ;
résultat jugé « presque aussi bon que fait main » par un éditeur professionnel.

Objectif : `generate(nbLines, nbColumns)` → grille jouable, dimensions libres
(13×13 minimum visé, 15×15 cible, rectangles quelconques), masque « organique et
organisé », génération en dizaines de secondes plutôt qu'en heures.

## 2. Non-objectifs

- Pas d'algorithme memetic (population + crossover) dans cette version — le hillclimber
  de ce spec en deviendrait l'étape de réparation si on l'ajoute plus tard.
- Pas de cases « cut-out » (images/vides) : la grille est un rectangle plein.
- Pas de changement client : le rendu des 4 types de flèches existe déjà
  (`public/javascripts/game/grid.js`, createDescriptionArrows).
- Pas de changement du format JSON de sortie ni de `!grid local`.
- `dictionary.js`, `lexiqueFrequency.js`, scrape et données (`dico.json`,
  `Lexique4.tsv`) inchangés. `gso-stats.json` n'est plus consommé par le générateur.

## 3. Modèle : cases, flèches, mots

Chaque case du masque est soit **Lettre**, soit **Définition**. Une case Définition
porte 1 ou 2 flèches ; chaque flèche définit exactement un mot :

| Flèche | Code export | Départ du mot | Sens |
|---|---|---|---|
| `R` (→) | 0 | (r, c+1) | horizontal |
| `RB` (→↓, coudée) | 1 | (r, c+1) | vertical |
| `B` (↓) | 2 | (r+1, c) | vertical |
| `BR` (↓→, coudée) | 3 | (r+1, c) | horizontal |

Les codes export sont ceux de l'enum local de `gridManager.js` (contrat client
existant — PAS `enums.ArrowDirections`).

Un mot part de sa case de départ et court dans son sens jusqu'à la première case
non-Lettre ou le bord. **Les mots sont définis par les flèches du génome**, pas par un
scan des runs : un run de lettres sans flèche qui le pointe = lettres non couvertes =
pénalité (c'est ainsi qu'Engel unifie validité et qualité).

Paires de flèches autorisées sur une même case (combinaisons observées dans les
grilles GSO réelles) : `R+B`, `RB+B`, `R+BR`, `B+BR`, `RB+BR`.

Contraintes de validité (pénalisées très fort, jamais réparées par du code spécial) :

1. chaque case Lettre appartient à ≥1 mot ;
2. chaque mot fait ≥2 lettres ;
3. deux mots de même axe ne se chevauchent pas ;
4. une flèche pointe vers une case Lettre existante (pas hors grille, pas vers une Déf).

Les flèches coudées rendent les bords naturels : une Déf en ligne 0 peut cluer un mot
horizontal de la ligne 1 (`BR`), une Déf en colonne 0 un mot vertical de la colonne 1
(`RB`) — comme les vraies grilles GSO. Le problème « edge-start » de l'ancien
générateur disparaît par construction.

## 4. Architecture

```
grid_generator/
├── dictionary.js        (conservé tel quel)
├── lexiqueFrequency.js  (conservé tel quel)
├── extractWords.js      (conservé tel quel — scrape)
├── mask.js              NOUVEAU : génome, pénalités, hillclimber, dérivation des slots
│                        (la dérivation mots/slots partage la marche des flèches avec le
│                        scoring — un seul module, l'ancien slots.js est supprimé)
├── fill.js              NOUVEAU : backtracking MRV + forward checking (remplace backtracking.js)
├── export.js            RÉÉCRIT : masque + assignation → JSON grille, flèches coudées incluses
└── validate.js          RÉÉCRIT : filet de sécurité final adapté au nouveau modèle
scripts/
└── generate-grid.js     RÉÉCRIT : orchestrateur + CLI (même interface qu'aujourd'hui)
```

Supprimés : `grid_generator/skeleton.js`, `grid_generator/backtracking.js`,
`grid_generator/exporter.js`, `grid_generator/slots.js` et leurs tests. `scripts/benchmark-fill.js` supprimé ou
adapté à `fill.js`.

## 5. mask.js — génome, pénalités, hillclimber

### Génome

Tableau plat `cells[]` de taille nbLines × nbColumns. Chaque entrée : `{ kind: 'L' }`
ou `{ kind: 'D', arrows: [a] | [a, b] }` avec les combinaisons de la section 3.

### Fonction de pénalité

Somme de pénalités, barème Engel par défaut, tout exposé dans un objet `weights`
paramétrable (les valeurs exactes se règlent à l'usage, pas dans ce spec) :

**Couverture** (par case Lettre) :
- croisée H et V : 0
- couverte 1 fois, voisins perpendiculaires tous deux non-Lettre : 75
- couverte 1 fois sinon : 200
- couverte 2 fois même axe (chevauchement, invalide) : 600
- non couverte (invalide) : 1500

**Longueur de mot** (par mot) :
`[0:1800, 1:1500, 2:650, 3:100, 4:10, 5:0, 6:0, 7:30, 8:50, 9:150, 10:250, 11:400,
12:550, 13:750, 14:1000, 15:1300]` — au-delà : +300 par lettre supplémentaire.

**Croisement de mots longs** : deux mots de longueur >6 qui se croisent :
`+ lenA × lenB` (protège la faisabilité du remplissage).

**Clusters de cases Définition** (composantes 8-connexes) : pénalité croissante en
(taille, étendue max horizontale ou verticale), table Engel jusqu'à 7, extrapolation
+400/case au-delà. Cases Déf en ligne 0 ou colonne 0 comptées ½ (les bords en ont
forcément). C'est la pénalité qui tue les « lignes complètes de défs ».

**Dead ends** : case Lettre entourée de 3 voisins non-Lettre (hors bords haut/gauche) :
400.

**Flèche invalide** (pointe hors grille ou vers une Déf) : 2000.

### Hillclimber

```
mask = init aléatoire (ratio Déf ~20 %, flèches aléatoires valides)
penalty = score(mask)
répéter :
  muter 1 case au hasard : L→D (flèches aléatoires), D→L, ou re-tirage des flèches d'une D
  si score(mask') < penalty : garder
  sinon : annuler
arrêt : N mutations infructueuses consécutives (défaut 5 000, paramétrable)
```

Le score se recalcule **en entier à chaque mutation** dans un premier temps : sur
15×15 (225 cases, ~45 mots) un recalcul complet est de l'ordre de la dizaine de
microsecondes, soit quelques secondes pour un hillclimb entier — un benchmark dans les
tests le vérifie. Si le benchmark montre que c'est trop lent, on passe au recalcul
incrémental (mots et clusters touchant la case mutée), avec le recalcul complet comme
vérité terrain de test.

Sortie : `{ cells, nbLines, nbColumns, penalty }`. Déterministe à seed fixée
(mulberry32 conservé).

## 6. Dérivation des slots (dans mask.js)

`deriveSlots(mask)` parcourt les cases Déf ; chaque flèche produit un slot :
`{ axis: 'H'|'V', cells: [indices], length, crossings: [{slotIndex, ownPos,
otherPos}], defCell: index, arrowIndex: 0|1 }`. Les croisements se calculent comme
aujourd'hui. Un chevauchement de mots de même axe (génome invalide) fait retourner
`null` — l'orchestrateur jette le masque (ne doit pas arriver après hillclimb, filet
de sécurité).

## 7. fill.js — remplissage

Backtracking gardé comme classe d'algorithme (seule approche ayant jamais rempli un
15×15 ici), réécrit proprement :

- **MRV** : à chaque étape, choisir le slot non assigné au plus petit nombre de
  candidats (recalculé via `dictionary.candidatesFor` sur les contraintes courantes).
- **Forward checking** : après chaque pose, vérifier que chaque slot croisé non
  assigné garde ≥1 candidat ; sinon backtrack immédiat (fail fast, cf. « betterfill »
  de GNOME Crosswords).
- Candidats ordonnés par fréquence Lexique (déjà fait par `dictionary.js`).
- Pas de mot en double dans la grille.
- Budget : `maxBacktracks` (défaut 500 000) et `timeoutMs` (défaut 30 000) — petits,
  car les masques optimisés (mots de 4-6 lettres majoritaires) doivent se remplir
  vite ; c'est l'orchestrateur qui multiplie les tentatives.

API : `solve(slots, dictionary, options)` → `assignment[]` (mot par slot) ou `null`.

## 8. export.js

`exportGrid(mask, slots, assignment, dictionary)` → `{ nbLines, nbColumns, nbWords,
cases }` avec les classes `Case` existantes. Pour chaque case Déf : `nbDesc`,
`desc[]` (définition la plus courte du dico pour le mot, comportement conservé),
`arrow[]` (codes 0/1/2/3 de la section 3). Plus aucune recherche « quel slot commence
à côté » : chaque flèche du génome connaît son slot (`defCell`/`arrowIndex`).

## 9. validate.js

Filet de sécurité final sur la grille exportée, adapté au nouveau modèle :

- chaque case Lettre couverte par ≥1 mot ;
- chaque mot clué par exactement une flèche ; chaque flèche pointe un mot réel ;
- mots ≥2 lettres, tous présents dans le dico, pas de doublon ;
- chaque case Déf a autant de `desc` non vides que de flèches ;
- dimensions cohérentes.

Retour `{ valid, errors[] }` comme aujourd'hui.

## 10. generate-grid.js — orchestrateur + CLI

```
generate(nbLines, nbColumns, dictionary, options) :
  pour attempt = 1 .. maxMaskAttempts (défaut 30) :
    mask = hillclimb(seed dérivée)          # ~secondes
    slots = deriveSlots(mask) ; si null → continue
    assignment = fill(slots, ...)            # budget court
    si null → continue
    grid = export(...) ; si validate(grid).valid → retour grid
  retour null
```

CLI conservée : `node scripts/generate-grid.js <largeur> [hauteur]`, sortie
`data/generated-grid.json`, consommée par `!grid local`. Les options de filtrage par
nombre de slots (maxSlots/minSlots) disparaissent — le masque est désormais contrôlé à
la source par les pénalités.

En cas d'échec de fill répété, chaque nouvelle tentative repart d'un hillclimb à seed
différente (masques indépendants). Pas de couplage fill→pénalités dans cette version.

## 11. Tests

`node:test` + seeds fixées (mulberry32), comme l'existant :

- **mask.js** : score complet vs score incrémental identiques sur mutations aléatoires
  (propriété, plusieurs seeds) ; chaque pénalité vérifiée sur un petit masque
  construit à la main ; hillclimber : la pénalité ne remonte jamais, masque final
  sans violation de validité sur plusieurs seeds en 13×13/15×15 ; déterminisme à seed
  fixe.
- **slots.js** : flèches → slots corrects (droites, coudées, doubles), croisements,
  `null` sur chevauchement.
- **fill.js** : cas trivial 1 slot ; cas insatisfiable → null ; MRV/forward checking
  vérifiés sur un cas construit où le backtracking naïf explose et le forward
  checking coupe court ; budget respecté.
- **export.js** : codes flèches 0/1/2/3 conformes au contrat client ; définitions
  attachées ; cas coudé en bord haut/gauche.
- **validate.js** : chaque règle a son cas rouge et son cas vert.
- **Intégration** : `generate(9, 9)` sur le **vrai** `data/dico.json` (un dico
  synthétique ne peut pas remplir une grille organique), seed trouvée
  empiriquement puis figée → grille valide.

Vérification manuelle finale : génération 15×15 réelle, chargement `!grid local`,
contrôle visuel (bords remplis, flèches coudées rendues, pas de chaîne de défs).

## 12. Risques et parades

- **Barème de pénalités mal réglé pour notre dico français** : tout le barème est un
  objet `weights` injectable ; les tests structurels ne dépendent pas des valeurs
  exactes. Réglage empirique après premier run réel.
- **Hillclimber coincé dans un minimum local médiocre** : l'orchestrateur relance à
  seed différente ; si la qualité stagne vraiment, l'upgrade memetic (Engel ch. 4)
  se construit par-dessus sans rien jeter.
- **Fill trop lent malgré les bons masques** : budget court + multiplication des
  masques ; le couple (pénalité croisements longs, table de longueurs) se durcit via
  `weights` pour produire des masques encore plus faciles.
- **Score incrémental faux** : test de propriété complet-vs-incrémental à chaque CI.
