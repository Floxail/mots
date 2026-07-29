# Remplissage constructif mot-par-mot (word-first) — Design

Date : 2026-07-29
Branche : `feature/grid-generator`
Suite de : `docs/superpowers/specs/2026-07-28-fill-reliability-design.md` (implémenté, commits `acd2dec`..`ac71b48` — AC-3 statique + tri par fréquence, mesuré inefficace, voir Contexte)

## Contexte et objectif

Le pipeline actuel (`grid_generator/skeleton.js` génère un squelette noir/blanc à partir des seules statistiques GSO, `grid_generator/slots.js` en dérive les slots, `grid_generator/backtracking.js` tente de résoudre l'ensemble comme un unique CSP simultané) échoue de façon quasi systématique à 13x15/15x15 en densité réelle (~19% de descriptions).

Deux tentatives de renforcement du solveur ont été mesurées empiriquement et rejetées :
- **AC-3 statique** (spec du 2026-07-28) : élague à peine 6% du volume de domaines sur un dico de 56k mots (quasi tout est déjà arc-cohérent sans aucune valeur assignée), coûte ~412ms/tentative, et mesuré **pire** que sans (9x9 : 11/20 → 7/20 succès).
- **MAC** (propagation incrémentale pendant la recherche, prototype jetable) : 0/10 à 15x15 (identique au backtracking simple), ~2.5x plus lent par tentative.

Diagnostic commun aux deux échecs : le squelette est généré **en aveugle**, sans aucune connaissance de la disponibilité réelle des mots, avant qu'aucune tentative de remplissage ne commence. Si la configuration combinatoire qui en résulte est insatisfiable pour le dictionnaire réel, aucune sophistication de résolution a posteriori ne peut compenser — on ne fait que découvrir l'échec plus ou moins vite.

## Décision actée : construire le squelette ET les mots simultanément

Au lieu de "squelette complet → puis résoudre", on construit case par case (même balayage 2D ligne par ligne que l'existant) et on **assigne un vrai mot au moment même où un mot commence**, en vérifiant sa disponibilité réelle (via `dictionary.candidatesFor`, contraintes de croisement comprises) avant de s'engager. Un échec local (aucun mot ne convient) se rattrape immédiatement sur place (essayer une autre longueur, ou basculer en case Description) — jamais découvert seulement après coup sur l'ensemble de la grille.

### Preuve de concept (prototype jetable, mesuré avant ce design)

Sur 50 grilles réelles par taille (`data/dico.json`, `data/gso-stats.json`, `data/Lexique4.tsv`) :

| Taille | Temps/grille | Densité lettres (cible ~81%) | Mots distincts/slots | Croisements vérifiés corrects | Orphelines lettre |
|---|---|---|---|---|---|
| 15x15 | 3ms | 78.3% | 56.1/56.6 (99%) | 50/50 | 0 |
| 13x15 | 2ms | 77.6% | 50.1/50.4 | 50/50 | 0 |
| 9x9 | 1ms | 75.1% | 23.8/23.9 | 50/50 | 0 |

À comparer à l'existant : 0/25 réussi à 15x15 même avec 45s/tentative. La construction ne peut jamais "échouer" au sens où elle produit toujours une grille complète (la case Description reste un filet de sécurité systématiquement disponible) — la vraie question est la qualité du résultat (densité, variété), mesurée ci-dessus comme bonne.

## Architecture

### `grid_generator/constructiveFill.js` (nouveau)

**`generate(nbLines, nbColumns, stats, dictionary, rng)`** → `{ nbLines, nbColumns, types, values }`

Même structure de balayage que `skeleton.js::sweepSkeleton` (obligations colonne/ligne, réutilise `computeDecisionDescriptionProbability` déjà exporté), avec deux différences :
- `columnObligation[col]` et l'équivalent ligne portent désormais le **mot réel** choisi (`{ word, consumed }`), pas seulement une longueur restante — les cases forcées consomment `word[consumed]` au lieu d'un type abstrait.
- Démarrer un run (H ou V) essaie les longueurs disponibles (mélangées aléatoirement) et, pour chacune, interroge `dictionary.candidatesFor(length, constraints, usedWords)` — `constraints` dérivées des obligations colonne déjà en cours qui traversent les cases visées par ce run. Le premier candidat disponible (dictionnaire trié par fréquence, cf. spec du 2026-07-28) est assigné immédiatement et ajouté à `usedWords`. Aucune longueur ne donne de candidat → repli sur Description, comme aujourd'hui.

Une obligation verticale démarrée maintenant n'a jamais de contrainte de croisement réelle à sa création (aucune ligne future n'a encore décidé son propre run horizontal) — c'est un choix libre parmi les mots inutilisés de la longueur choisie. La contrainte se vérifie plus tard, quand le balayage atteint effectivement cette ligne et tente d'y démarrer un mot horizontal qui croise cette colonne : à ce moment la lettre est déjà connue et vérifiée avant tout engagement.

**`repairOrphanDescriptions(built, dictionary, usedWords)`** — mute `built.types`/`built.values` en place.

Même détection qu'aujourd'hui (`grid_generator/skeleton.js::repairOrphanDescriptions`, logique dupliquée ici volontairement — cf. Hors scope) : une case Description est orpheline si ni le mot horizontal démarrant à droite ni le mot vertical démarrant en dessous n'existe. Mesuré empiriquement sur le pattern word-first : ~34% des cases Description sont orphelines (même ordre de grandeur qu'avant), la réparation reste donc nécessaire.

Contrairement à la version existante (deux stratégies : auto-conversion si voisine d'une Letter, sinon creuser), celle-ci **creuse toujours** un mini-mot de 2 cases neuf (jamais de conversion d'une case existante) et lui assigne un **vrai mot** de longueur 2 immédiatement (`dictionary.candidatesFor(2, constraintsSiCroisementExistant, usedWords)`), ajouté à `usedWords`. Pas de risque d'érosion de mot déjà posé (aucune valeur existante n'est jamais touchée), et le mot est vérifié disponible au moment même de la réparation — pas de risque de casser la solvabilité globale comme la stratégie "creuser" seule l'avait fait dans l'ancien pipeline CSP (où creuser ajoutait une contrainte que le solveur global devait ensuite satisfaire ; ici on la satisfait sur-le-champ).

Cas limite : aucune place pour creuser dans un sens ou l'autre (coin de grille) — laissé orphelin, `validateGrid` (existant, inchangé) le détectera et déclenchera un nouveau tirage complet, opération quasi gratuite (~3ms) contrairement à l'ancien pipeline.

### `scripts/generate-grid.js` — `generate()` : intérieur remplacé, signature inchangée

```
pour chaque tentative (jusqu'à maxSkeletonAttempts) :
  built = constructiveFill.generate(nbLines, nbColumns, stats, dictionary, rng)
  constructiveFill.repairOrphanDescriptions(built, dictionary, usedWords)
  slots = slotsLib.deriveSlots(built)                      // inchangé
  si slots.length hors [minSlots, maxSlots] → tentative suivante
  assignment = slots.map(slot => slot.cells.map(c => built.values[c]).join(''))
  grid = exporterLib.exportGrid(built, slots, assignment, dictionary)  // inchangé
  si validateLib.validateGrid(grid).valid → return grid                // inchangé
retourne null
```

`slots.js`, `exporter.js`, `validate.js` sont réutilisés **sans aucune modification** — le nouveau code ne fait que produire une grille déjà remplie que ce pipeline existant sait déjà exporter/valider.

Options désormais sans effet et abandonnées : `maxBacktracks`, `timeoutMs`, `allowedWords` (plus de phase de résolution CSP séparée à budgéter). `test/generate.test.js` mis à jour en conséquence (voir Tests).

`grid_generator/skeleton.js`, `backtracking.js`, `constraintPropagation.js`, `minConflicts.js` restent **intacts, non modifiés** — ils deviennent du code mort du point de vue de l'application (plus jamais appelés par `generate-grid.js`) mais leurs tests et leur fonctionnement restent valides, au cas où une réutilisation future s'avère pertinente (ex. si le dictionnaire grossissait au point où la propagation redevient utile). Décision actée avec l'utilisateur : pas de suppression dans ce plan.

## Cas limites

- Slot dont la longueur n'a aucun mot disponible dans le dico → `candidatesFor` renvoie `[]`, cette longueur est simplement écartée au profit d'une autre ou de Description — jamais de crash.
- Épuisement du dictionnaire pour une longueur donnée en cours de grille (mots déjà tous utilisés ailleurs) → même repli, `candidatesFor` exclut déjà `usedWords`.
- Réparation sans mot de longueur 2 disponible (scénario dictionnaire appauvri) → détecté par `validateGrid`, retry complet.

## Qualité du résultat (pas des bugs, des réglages à valider empiriquement pendant l'implémentation)

- Densité lettres mesurée ~3-6 points sous la cible (75-78% vs ~81%) — si jugé significatif après implémentation réelle (avec réparation incluse, non mesurée dans le prototype), ajuster légèrement `decisionDescriptionProbability` ou élargir la tentative de longueurs avant repli.
- Toujours piocher `candidates[0]` (mot le plus fréquent compatible) donne une bonne variété **dans** une grille (99% mesuré) mais pourrait répéter les mêmes mots courants **entre** grilles différentes — pas mesuré, à surveiller ; piocher aléatoirement parmi les meilleurs candidats plutôt que toujours le premier est une amélioration possible si observé comme un problème réel.

## Tests / validation

- Unitaires `constructiveFill.test.js` :
  - `generate` produit une grille où toute case Letter a une valeur, respecte les contraintes de croisement (mot H et V d'accord sur la lettre partagée — cas construit à la main avec un dico minimal), ne réutilise jamais un mot (`usedWords`).
  - `repairOrphanDescriptions` corrige une case orpheline construite à la main en lui assignant un vrai mot de longueur 2, sans toucher aux cases déjà valides ; cas limite (pas de place dans un sens) laisse la case orpheline sans crasher.
- `test/generate.test.js` mis à jour : retirer les assertions sur `maxBacktracks`/`timeoutMs`/`allowedWords` (obsolètes), garder `maxSkeletonAttempts`/`maxSlots`/`minSlots`/`seed` avec des scénarios adaptés au nouveau pipeline.
- Vérification manuelle en conditions réelles : `node scripts/generate-grid.js 15 15` et `13 15` plusieurs fois, confirmer succès quasi systématique dès la première tentative (à comparer à l'échec quasi systématique actuel).
- Test statistique de densité (même esprit que `docs/superpowers/specs/2026-07-26-skeleton-density-calibration-design.md`) : générer ~200 grilles réelles 15x15 (`data/gso-stats.json`), mesurer la densité de cellules Description résultante après réparation, tolérance ±5 points de pourcentage autour de `stats.descriptionDensity` (0.19). Le prototype seul (sans réparation) mesurait 75-78% de densité lettres soit ~22-25% de descriptions, déjà dans cette tolérance élargie par rapport à la cible ~19% ; la réparation ajoute des mots donc devrait resserrer encore l'écart. Si la mesure réelle post-réparation dépasse ±5 points, ajuster `decisionDescriptionProbability` avant de considérer la tâche terminée.

## Hors scope (cette itération)

- Suppression de `skeleton.js`, `backtracking.js`, `constraintPropagation.js`, `minConflicts.js` — décision actée de les garder intacts, non utilisés par l'application.
- Partage de la logique de détection d'orpheline (`isWordStart`/`isOrphan`) entre `skeleton.js` et `constructiveFill.js` via un module commun — petite duplication (~15 lignes) acceptée pour ne pas toucher à `skeleton.js`, qui reste figé.
- Sélection aléatoire parmi les meilleurs candidats (au lieu de toujours `candidates[0]`) — amélioration possible si la répétition inter-grilles s'avère un problème réel observé, pas une hypothèse à corriger préventivement.
- Calibration fine de `decisionDescriptionProbability` pour combler l'écart de densité mesuré (3-6 points) — à ajuster seulement si la mesure post-réparation confirme un écart significatif.
