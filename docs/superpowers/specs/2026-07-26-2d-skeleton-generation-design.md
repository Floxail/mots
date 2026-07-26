# Génération de squelette 2D coordonnée — Design

Date : 2026-07-26
Branche : `feature/grid-generator` (suite du chantier générateur de grilles local)

## Contexte et objectif

`grid_generator/skeleton.js` construit actuellement le squelette (cases lettre/description) ligne
par ligne, indépendamment : chaque ligne est tuilée de gauche à droite (`Description, run de
lettres, Description, run...`) sans aucune coordination avec les autres lignes. Toute structure
verticale qui en résulte est une pure coïncidence de superposition entre lignes générées
séparément, pas un choix.

Ça a trois conséquences observées en usage réel :

1. **Résolvabilité limitée** : à partir de ~50 slots simultanés (grilles 13x15/15x15), le solveur
   (backtracking + MRV dynamique + cache, et même min-conflicts avec redémarrage) plafonne
   systématiquement, même avec un dictionnaire de 56k+ mots. Les croisements essentiellement
   aléatoires créent des CSP plus durs à satisfaire qu'un design intentionnel.
2. **Esthétique non fidèle à GSO** : chaque ligne démarre systématiquement par une case-description,
   créant un mur visible de définitions sur la colonne de gauche — confirmé sur une grille réelle
   generée, et confirmé qu'aucune grille GSO standard n'a ce motif.
3. **Pas de vrai "design" de grille** : aucune coordination 2D intentionnelle, contrairement à un
   vrai composeur de grille (humain ou logiciel professionnel).

**Objectif** : remplacer la génération ligne-par-ligne par un balayage 2D coordonné qui décide
case par case, en tenant compte simultanément de l'état de la ligne ET de la colonne, avec
GARANTIE PAR CONSTRUCTION (pas par chance) que toute case-lettre appartient à un run ≥2 dans au
moins un axe.

## Décision actée : pas de symétrie imposée

Hypothèse de départ (motifs symétriques façon mots-croisés américains) invalidée empiriquement :
vérification sur 5 grilles GSO réelles en cache (`cache/1292.mfj` à `1296.mfj`) montre ~30% de
cases ne correspondant pas sous rotation 180° — largement trop pour être une grille symétrique
avec exceptions mineures. GSO ne suit pas de contrainte de symétrie visuelle. La coordination 2D
vise donc la résolvabilité et la variété, pas un motif imposé.

## Algorithme

### Balayage case par case

Traitement en ordre ligne-major (ligne 0 colonne 0, colonne 1, ... puis ligne 1, ...).

**États maintenus pendant le balayage :**
- `columnObligation[nbLines]` : par colonne, soit `null` (libre) soit `{ remaining: N }` (encore
  N lignes à remplir en lettre pour terminer un mot vertical déjà engagé plus haut).
- `rowRemaining` : compteur local, réinitialisé à chaque nouvelle ligne — combien de cases
  restent à remplir en lettre pour terminer le mot horizontal en cours sur cette ligne.

**Règle de décision pour la case `(row, col)` :**

1. Si `columnObligation[col] !== null` OU `rowRemaining > 0` → la case est **forcée en lettre**.
   - Si `columnObligation[col]` actif : décrémenter `remaining` ; si `remaining` atteint 0, libérer
     la colonne (`columnObligation[col] = null`).
   - Si `rowRemaining > 0` : décrémenter.
   - Si les deux sont actifs simultanément (un mot horizontal en cours croise un mot vertical en
     cours) : la case sert de point de croisement naturel — cas normal et recherché, pas un cas
     spécial à gérer différemment.
2. Sinon (case libre, ni ligne ni colonne n'imposent rien) → décision fraîche :
   - Avec probabilité ≈ `stats.descriptionDensity` (densité réelle GSO) : placer une case-description.
   - Sinon, 50/50 entre :
     - **Démarrer un mot horizontal** : tirer une longueur via `pickSegmentLength` (distribution
       réelle, ≥2 uniquement — réutilise l'exclusion longueur-1 déjà en place), bornée par la place
       restante sur la ligne (`nbLines - col`). Si la longueur bornée tombe sous 2 (pas assez de
       place), essayer l'autre direction à la place.
     - **Démarrer un mot vertical** : idem, borné par la place restante en dessous
       (`nbColumns - row`), engage `columnObligation[col]` pour les lignes suivantes.
   - Si ni l'une ni l'autre direction n'a assez de place (rare, coin bas-droit de la grille) :
     case-description par défaut.

### Garantie par construction

Toute case-lettre placée est soit :
- **Case de départ** d'un run (horizontal ou vertical) de longueur tirée ≥2 → jamais orpheline,
  puisqu'elle a au moins un voisin de même run garanti par construction (pas besoin d'attendre le
  reste du balayage).
- **Case forcée** (continuation d'un run déjà engagé) → par définition appartient à un run ≥2.

Aucune case-lettre ne peut donc se retrouver orpheline dans les deux axes. C'est un vrai
changement par rapport à l'existant, où l'orphelinage n'était détecté qu'après coup par
`validate.js` puis corrigé par nouvelle tentative de squelette.

**Bornage automatique correct** : un mot vertical démarré en ligne `R` avec longueur bornée par
`nbColumns - R` ne peut jamais dépasser la dernière ligne (`nbColumns - 1`) — le calcul de
bornage garantit `R + (longueur - 1) ≤ nbColumns - 1` par construction.

### Ce qui reste géré par le filet de sécurité existant

Une case-description peut toujours se retrouver sans AUCUNE case-lettre adjacente (ni à droite,
ni en dessous) si les deux décisions libres voisines tombent sur "description" — cas résiduel,
plus rare qu'avant grâce à la coordination 2D mais pas éliminé par construction. Reste détecté
par `validate.js` (case sans définition) et corrigé par la boucle de réessai existante dans
`scripts/generate-grid.js` — aucun changement nécessaire à ce filet de sécurité.

## Interface externe : inchangée

`generateSkeleton(nbLines, nbColumns, stats, rng)` garde exactement la même signature et la même
forme de sortie (`{ nbLines, nbColumns, types }`). Aucun changement requis dans `slots.js`,
`backtracking.js`, `minConflicts.js`, `exporter.js`, `validate.js`, ou `scripts/generate-grid.js`
— seul l'algorithme interne de `generateSkeleton` change. C'est un remplacement direct.

## Densité

Pas de calibration exacte de la densité cible (`stats.descriptionDensity`) — la probabilité par
case-libre donne un résultat statistiquement proche de la cible, pas une correspondance exacte.
Cohérent avec l'approche actuelle (déjà approximative), pas une régression.

## Tests / validation

- Tests unitaires sur `generateSkeleton` : vérifier qu'aucun run (H ou V) n'est jamais < 2,
  vérifier qu'aucun mot vertical ne déborde de la grille, vérifier le comportement de croisement
  (case forcée simultanément par ligne et colonne).
- Test de non-régression : le taux de réussite du solveur à 13x15 (avec le dico réel actuel)
  devrait être égal ou meilleur qu'avant ce changement — à valider manuellement en conditions
  réelles après implémentation, pas un test automatisé (dépend du dico local, pas committé).
- Vérification visuelle manuelle : générer une grille réelle et confirmer que la colonne de
  gauche n'est plus systématiquement des cases-description.

## Hors scope (cette itération)

- Symétrie visuelle (invalidée empiriquement, voir plus haut).
- Calibration exacte de la densité par case.
- Placement "intelligent" des cases-description pour garantir 100% qu'elles ont toujours ≥1
  attache (le filet de sécurité existant suffit).
- Optimisation de la vitesse du solveur lui-même (déjà traité dans les itérations précédentes :
  MRV dynamique, cache de domaines, min-conflicts).
