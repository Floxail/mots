# Fiabilité du remplissage (fill) de grille à densité réelle — Design

Date : 2026-07-28
Branche : `feature/grid-generator`
Suite de : `docs/superpowers/specs/2026-07-26-skeleton-density-calibration-design.md` (implémenté, commit `e39d953`) et du fix d'orphelines (`grid_generator/skeleton.js::repairOrphanDescriptions`, non documenté séparément, commit `cddfcc9`)

## Contexte et objectif

Depuis la calibration de densité (spec du 2026-07-26) et le repair des cases Description orphelines, les squelettes générés correspondent enfin à la vraie densité GSO (~19%) et sont structurellement valides (`validateGrid` passe). Mais le **remplissage** (assignation des mots aux slots) échoue quasi systématiquement à 13x15/15x15 réel : mesuré à 0/40 tentatives sur plusieurs runs consécutifs, chaque tentative épuisant son budget de 20s.

Diagnostic (voir conversation du 2026-07-28) :
- Le nombre de slots réel à cette densité est bien plus élevé qu'avant (55-75 sur 15x15, contre ~20-30 avant la calibration de densité).
- Ce n'est **pas** une pénurie de mots courts (177 mots de longueur 2, 787 de longueur 3 dans `data/dico.json` — largement suffisant face à 9-17 slots de longueur 2 typiquement demandés).
- Les deux solveurs déjà présents dans le code (`grid_generator/backtracking.js`, backtracking chronologique avec MRV + cache de domaine ; `grid_generator/minConflicts.js`, recherche locale avec redémarrage anti-stagnation) échouent tous les deux, même avec un budget généreux de 45s par tentative, testé en direct sur de vrais squelettes.
- La vraie difficulté est combinatoire : satisfaire 55-75 contraintes de croisement simultanées est un CSP dense, et aucun des deux algorithmes ne fait de propagation de contraintes proactive (ils découvrent une impasse seulement quand un slot atteint 0 candidat, après coup).

Objectif : rendre le remplissage fiable en pratique à 13x15/15x15 réel. Le temps de génération par grille reste variable (accepté explicitement par l'utilisateur — priorité fiabilité, pas vitesse garantie), c'est un processus offline (cron quotidien), pas sur le chemin d'un joueur.

## Décision actée : propagation de contraintes (AC-3) + tri par fréquence

Deux changements complémentaires, dans cet ordre de mise en œuvre :

### 1. Propagation de contraintes (nouveau module `grid_generator/constraintPropagation.js`)

`pruneDomains(slots, dictionary)` implémente un AC-3 simplifié sur les slots (variables) et leurs mots candidats (domaines) :

- Domaine initial de chaque slot = tous les mots de sa longueur (`dictionary.byLength.get(slot.length)`), sans contrainte.
- Pour chaque arc dirigé `(A → B)` où A et B se croisent à `(posA, posB)` : réviser le domaine de A en ne gardant que les mots dont la lettre en `posA` apparaît dans l'ensemble des lettres présentes en `posB` sur le domaine courant de B. Coût de la révision : `O(|domaine(A)| + |domaine(B)|)` via un `Set` de lettres autorisées (pas de produit cartésien).
- File d'attente classique AC-3 : si le domaine de A rétrécit, ré-enfiler tous les arcs `(X → A)` pour tout X croisant A (hors l'arc qui vient d'être traité).
- Si un domaine devient vide à un moment quelconque → le squelette est **prouvé insolvable**, retour `null` immédiat. C'est le gain principal : évite de gaspiller 20s de backtracking sur une grille morte d'avance.
- Retour (cas non-vide) : `Map<slotIndex, Set<string>>` des mots survivants par slot.

### 2. Tri des pools de mots par fréquence réelle

`dictionary.buildDictionary(entries, freqMap)` accepte un second paramètre optionnel : une `Map<word, frequency>`. Si fourni, chaque bucket `byLength` est trié par fréquence décroissante (mots inconnus de la map → fréquence 0, en fin de liste) une seule fois à la construction.

`freqMap` est construit en parsant `data/Lexique4.tsv` (déjà présent sur disque, déjà utilisé pour la curation initiale de `data/dico.json` dans `scripts/scrape-fsolver.js::buildCandidateListFromLexique`, colonne 10 / index 9 = `10_FreqMot`). On réutilise cette logique de parsing (extraite dans une petite fonction dédiée, pas dupliquée), mais cette fois pour construire une map complète mot→fréquence chargée au runtime de génération, pas pour filtrer quels mots entrent dans le dico.

Effet : les mots courants sont essayés en premier par le backtracking (ordre de `candidatesFor`, qui filtre `byLength` en préservant l'ordre) et par min-conflicts (`pickRandom`/meilleur score sur `pool`, qui parcourt `byLength` dans l'ordre) — accélère la convergence sans changer leur logique interne.

## Intégration dans le pipeline

`grid_generator/backtracking.js` : changement minimal. `domainFor(i)` intersecte le résultat de `candidatesFor(...)` avec un `allowedWords[i]` optionnel (un `Set`, passé via `options.allowedWords`) si fourni. Le reste (MRV, cache d'invalidation) est inchangé.

`scripts/generate-grid.js::generate()` : après `deriveSlots`, nouvel appel `pruneDomains(slots, dictionary)` :
- `null` → rejet immédiat de la tentative (comme le filtre `maxSlots`/`minSlots` existant), sans jamais appeler `backtracking.solve`.
- Sinon → passé à `backtracking.solve(slots, dictionary, { ...options, allowedWords: pruned })`.

`minConflicts.js` n'est **pas** modifié dans cette itération (voir Hors scope) — le portfolio (option C évoquée en discussion) n'est pas retenu pour l'instant, on mesure d'abord l'effet de A+B seul.

## Cas limites

- Slot dont la longueur n'a aucun mot dans le dico (`byLength.get(length)` vide) → domaine initial vide → détecté dès la première révision, `null` immédiat (même garde déjà présente dans `minConflicts.js`, reproduite ici).
- Slot sans aucun croisement (mot isolé sur un seul axe) → aucun arc à réviser, domaine = pool complet inchangé, comportement correct par construction (rien à propager).
- Parsing de fréquence : ligne malformée ou colonne manquante → fréquence 0 (même filet de sécurité que `buildCandidateListFromLexique` existant, `parseFloat(...) || 0`).
- `freqMap` non fourni à `buildDictionary` → comportement actuel inchangé (ordre d'insertion de `dico.json`), rétrocompatible.

## Tests / validation

- Unitaires `constraintPropagation.test.js` : petit cas construit à la main (3-4 slots croisés) vérifiant qu'un mot incompatible est bien éliminé du domaine du voisin, et qu'une contrainte manifestement insatisfiable (deux slots courts ne partageant aucune lettre compatible) produit `null`.
- Unitaire `dictionary.test.js` : `buildDictionary(entries, freqMap)` trie bien `byLength` par fréquence décroissante ; sans `freqMap`, ordre inchangé (non-régression).
- Unitaire `backtracking.test.js` : `solve(..., { allowedWords })` ne retourne jamais un mot hors de `allowedWords[i]` quand fourni ; sans l'option, comportement actuel inchangé.
- **Script de benchmark** (pas un test unitaire, dépend du dico local) : `scripts/benchmark-fill.js` ou équivalent, génère N=20-30 squelettes réels 15x15 (`data/gso-stats.json`), mesure taux de succès et temps avant/après. Sert à rapporter des chiffres concrets à l'utilisateur, pas à faire échouer une CI.
- Vérification manuelle : relancer `scripts/generate-grid.js 15 15` et `scripts/generate-grid.js 13 15` en conditions réelles, confirmer une amélioration mesurable par rapport à l'état actuel (0/40, 0/8 à 45s/tentative avec les deux solveurs).

## Hors scope (cette itération)

- Maintaining Arc Consistency incrémental pendant la recherche (MAC) — AC-3 statique en pré-traitement est le changement le plus rentable pour l'effort ; MAC serait une itération de suivi si AC-3 seul ne suffit pas.
- Portfolio backtracking + minConflicts en parallèle (option C de la discussion) — pas retenu pour l'instant, à reconsidérer seulement si A+B ne suffit pas empiriquement.
- Régénération de `data/dico.json` pour y stocker la fréquence directement (au lieu de charger `Lexique4.tsv` séparément à chaque run) — optimisation possible plus tard si le chargement du TSV s'avère trop lent, pas un problème mesuré à ce stade.
- Garantie de temps de génération fixe ("quelques secondes") — objectif explicitement écarté par l'utilisateur au profit de la fiabilité.
