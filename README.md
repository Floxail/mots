Mots.js
====

Un jeu de mots fléchés multijoueur basé sur Node.js !
Les grilles sont récupérées chez GSO (rcijeux.fr). Vous pouvez choisir de lancer la grille du jour ou jouer sur la grille de votre choix.

![](./illustrations/mots-details1.png)

Finit les parties à 4 autour d'un bureau à dicter vos mots à votre collègue. Vous trouvez tout les mots ? Vous êtes le meilleur ? Prouvez le !

![](./illustrations/mots-details2.png)

## Comment jouer ?

```
$ npm install
$ npm start
```

ℹ️ Si plusieurs addresses IP sont détectées sur votre PC, un prompt vous demandera de choisir laquelle utiliser pour le jeu.

Le jeu est ensuite accessible pour tout le monde à l'adresse indiquée dans la console.

Quand vous êtes prêt, écrivez `!start` dans le chat, puis amusez vous ! :smile:

#### Options

Par défaut, le jeu tente de charger la grille GSO du jour en estimant son numéro à partir de la date actuelle.

Vous pouvez spécifier une grille au lancement :

```
$ npm start <numéro>      # Charge la grille numérotée
$ npm start default       # Charge la grille par défaut (debug)
```

Pendant une partie, vous pouvez changer de grille via le chat avec la commande `!grid <numéro>`.

#### Commandes chat

| Commande | Description |
|---|---|
| `!start` | Lance la partie (en salle d'attente uniquement) |
| `!grid <numéro>` | Charge une nouvelle grille et relance la partie |

#### Système de bonus

Des points bonus sont attribués en plus des lettres trouvées :

| Bonus | Points | Condition |
|---|---|---|
| Preum's ! | +4 | Premier mot trouvé de la partie |
| Finish him ! | +4 | Dernier mot trouvé (grille complétée) |
| Débloqueur | +5 | Premier mot après 2 minutes d'inactivité |
| Gros mot ! | +3 | Mot de 6 lettres ou plus |


## Crédits

Les images des "petits monstres" utilisées dans le projet ont été réalisées par le talentuex [Buatoom](https://dribbble.com/buatoom)


## Notes

Toute contribution au projet est la bienvenue !
N'hésitez pas à remonter tout bug ou suggestions via Github
