# Calibration de la densité de description dans le squelette 2D — Design

Date : 2026-07-26
Branche : `feature/grid-generator`
Suite de : `docs/superpowers/specs/2026-07-26-2d-skeleton-generation-design.md` (implémenté, commit `d8e305a`)

## Contexte et objectif

Après implémentation du balayage 2D coordonné (`grid_generator/skeleton.js`), un test en conditions réelles a révélé une régression de résolvabilité : une grille 10x10, auparavant fiable à 100% avec l'ancien algorithme, échoue maintenant 0/40 tentatives. Une 13x15 sans filtre échoue aussi 0/40.

## Root cause (investigation empirique)

Comparaison directe des deux algorithmes sur les mêmes stats réelles (`data/gso-stats.json`, `descriptionDensity: 0.18988`) et les mêmes graines :

| | 10x10 slots | 13x15 slots | % cases description |
|---|---|---|---|
| Ancien algorithme (ligne-par-ligne) | 34.2 | 63.2 | 16.4% |
| Nouveau algorithme (2D, actuel) | 24.5-25.6 | 38.7-40.9 | ~4.6-6.6% |

L'ancien algorithme ne consultait JAMAIS `stats.descriptionDensity` comme probabilité — il plaçait une case-description de façon déterministe à chaque cycle (`Description, run, Description, run...`), donnant mécaniquement une densité de cellules-description ≈ `1/(1+longueurMoyenneRun)` ≈ 1/(1+4.82) ≈ 17.2% (proche du 16.4% mesuré).

Le nouveau algorithme (design du 2026-07-26) applique `stats.descriptionDensity` (0.19) comme **probabilité de décision** (à chaque case libre : 19% de chances de choisir description, 81% de démarrer un run). Mais un run consomme en moyenne ~4.82 cellules par décision contre 1 seule pour une description — la densité de CELLULES qui en résulte est donc bien plus basse que la probabilité de DÉCISION utilisée :

```
densité_cellules = p / (p + (1-p) × L)
```

Avec p=0.19 et L=4.82 : densité_cellules ≈ 0.19/(0.19+0.81×4.82) ≈ 4.6% — confirmé empiriquement (4.6-6.6% mesuré, l'écart vient du bruit d'échantillonnage et de l'arrondi de `pickSegmentLength`).

C'est une erreur de modèle dans le design du 2026-07-26, pas un bug d'implémentation — le code fait exactement ce que le design demandait, mais le design confondait densité-de-décision et densité-de-cellule.

## Constat additionnel : parité totale avec l'ancien algorithme n'est pas atteignable (ni souhaitable)

Une partie du volume de slots élevé de l'ancien algorithme provenait de runs verticaux incidents de longueur non bornée par la vraie distribution GSO (jusqu'à quasi toute la hauteur de la grille, 13-15 lettres, alors que la distribution réelle plafonne à 10). Le nouveau algorithme borne CORRECTEMENT toute run (H ou V) à la vraie distribution — c'était un objectif explicite du design précédent, pas un défaut.

Balayage empirique de la probabilité de décision (à structure 2D inchangée) : le nombre de slots plafonne vers p≈0.5-0.55, à environ 80-83% du total de l'ancien algorithme (51.5/63.2 en 13x15, 28.5/34.2 en 10x10) — pas une parité totale, mais une amélioration très significative par rapport à l'état actuel (39.7→51.5, soit +30%).

## Décision actée : probabilité de décision auto-calibrée depuis les stats

Plutôt qu'une constante magique fixée empiriquement (fragile si `stats.descriptionDensity` ou la distribution de longueurs changent avec un dico différent), calculer la probabilité de décision directement à partir des stats déjà disponibles :

```
L = moyenne pondérée de usableLengthCounts (segmentLengthCounts filtré >=2)
p_decision = (d × L) / (d × L + (1 - d))   où d = stats.descriptionDensity
```

Cette formule est l'inverse exact de la relation empirique ci-dessus — elle garantit que la densité de cellules-description RÉSULTANTE converge vers `d` (la vraie densité mesurée sur GSO), peu importe la distribution de longueurs utilisée. Auto-calibrant : si le dico/les stats changent, la formule s'ajuste automatiquement sans retouche manuelle.

Avec les stats actuelles (d=0.19, L≈4.82), ça donne p_decision ≈ 0.53 — cohérent avec le pic empirique observé (0.5-0.55).

## Interface externe : inchangée

`generateSkeleton(nbLines, nbColumns, stats, rng)` garde exactement la même signature et forme de sortie. Le changement est interne : le calcul de la probabilité utilisée pour le tirage `rng() < ???` à la ligne de décision "case libre", qui passe de `stats.descriptionDensity` brut à `p_decision` calculé via la formule ci-dessus. Aucun autre fichier de la pipeline n'est concerné.

## Cas limite : L=0 ou usableLengthCounts vide

Si `usableLengthCounts` est vide (aucune longueur ≥2 dans les stats, cas dégénéré déjà géré ailleurs dans le pipeline via retry), la formule diviserait par un moyenne indéfinie. Fallback : si `usableLengthCounts` est vide, garder `p_decision = stats.descriptionDensity` (comportement actuel, cas déjà couvert par le filet de sécurité `validate.js` + retry-loop).

## Tests / validation

- Test unitaire : avec des stats synthétiques simples (ex. `segmentLengthCounts: {3: 1}` → L=3, `descriptionDensity: 0.25`), vérifier que la probabilité calculée correspond à la formule (`0.25×3/(0.25×3+0.75) = 0.5`), en instrumentant le rng pour compter les appels ou en vérifiant la densité résultante sur un grand échantillon.
- Test de non-régression : générer un grand nombre de squelettes (ex. 200) avec les stats réelles et vérifier que la densité de cellules-description résultante est proche de `stats.descriptionDensity` (tolérance ±3 points de pourcentage) — preuve que la formule calibre correctement, peu importe les valeurs exactes de L et d.
- Vérification manuelle en conditions réelles : relancer `scripts/generate-grid.js 10` et `scripts/generate-grid.js 13 15` avec le dico réel et confirmer une amélioration mesurable du taux de réussite par rapport à l'état actuel (0/40) — pas un test automatisé, dépend du dico local.

## Hors scope (cette itération)

- Rapprocher davantage le nombre de slots de l'ancien algorithme (nécessiterait de dévier de la vraie distribution de longueurs GSO, contraire à l'objectif du design précédent).
- Rendre `verticalStartProbability` (le 50/50 horizontal/vertical) configurable — testé empiriquement (0.1 à 0.5), n'a aucun effet mesurable sur le nombre total de slots, donc pas de valeur à changer ce paramètre pour ce problème.
- Optimisation du solveur (déjà traité dans les itérations précédentes).
