# Déploiement mots.floxail.fr — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Déployer Mots.js sur `https://mots.floxail.fr` depuis un PC Ubuntu via nginx reverse proxy + Let's Encrypt SSL + PM2, jeu multijoueur fonctionnel.

**Architecture:** nginx termine SSL port 443 et proxie tout le trafic (HTTP + WebSocket) vers `localhost:2121` — Express et Socket.IO partagent le même port. `server.js` route `/conf.json` retourne dynamiquement l'adresse production via headers HTTP forwarded. PM2 maintient Node.js en vie après reboot. Pas de changement de logique jeu.

**Tech Stack:** Node.js 20 (NodeSource apt), nginx, certbot + python3-certbot-nginx, PM2 5.x, UFW, Ubuntu 22.04/24.04, Git.

---

## Fichiers touchés

| Fichier | Action | Raison |
|---------|--------|--------|
| `server.js` | Modifier lignes 74-83 | Guard `process.stdin.isTTY` — PM2 n'a pas de TTY, `prompts` bloquerait sinon |
| `/etc/nginx/sites-available/mots.floxail.fr` | Créer (sur serveur) | Config nginx reverse proxy |
| `/etc/nginx/sites-enabled/mots.floxail.fr` | Symlink (sur serveur) | Activer le site |

---

## Task 1: Fix PM2 compatibility — `server.js` non-TTY guard

**Contexte :** `server.js` utilise `prompts` (sélection interactive) si plusieurs interfaces réseau détectées. PM2 lance Node.js sans TTY → `prompts` bloque indéfiniment. Fix : vérifier `process.stdin.isTTY` avant d'invoquer le prompt.

**Fichiers :**
- Modifier : `server.js` lignes 74-83

- [ ] **Step 1: Remplacer le bloc `else if (addresses.length > 1)`**

Remplacer :
```javascript
  else if (addresses.length > 1) {
    var response = await prompts({
      type: 'select',
      name: 'value',
      message: 'Choose the IP address to use',
      choices: addresses,
    });

    console.log(`\n\n\tWaiting for players at http://${addresses[response.value]}:${_port}\n\n`);
  }
```

Par :
```javascript
  else if (addresses.length > 1) {
    if (process.stdin.isTTY) {
      var response = await prompts({
        type: 'select',
        name: 'value',
        message: 'Choose the IP address to use',
        choices: addresses,
      });
      console.log(`\n\n\tWaiting for players at http://${addresses[response.value]}:${_port}\n\n`);
    } else {
      console.log(`\n\n\tWaiting for players at http://${addresses[0]}:${_port}\n\n`);
    }
  }
```

- [ ] **Step 2: Vérifier que le démarrage local fonctionne toujours**

```bash
npm start default
```

Attendu : démarrage normal, pas de régression, affiche l'URL dans le terminal. Arrêter avec `Ctrl+C`.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "fix(server): skip interactive IP prompt when stdin is not a TTY (PM2 compat)"
```

---

## Task 2: DNS — OVH A record

**Contexte :** Configurer `mots.floxail.fr` → IP publique statique du serveur Ubuntu. DNS prend 1-24h à se propager — faire en premier pour que la propagation se fasse pendant les étapes suivantes.

**Fichiers :** aucun (interface web OVH Manager)

- [ ] **Step 1: Trouver l'IP publique du serveur Ubuntu**

Depuis le serveur Ubuntu (via SSH) :
```bash
curl -s ifconfig.me
```

Attendu : une IP v4 publique, ex. `82.64.x.x`. Noter cette valeur.

- [ ] **Step 2: Ajouter l'enregistrement A dans OVH Manager**

1. Aller sur `https://www.ovh.com/manager/` → Domaines → `floxail.fr` → Zone DNS
2. Cliquer "Ajouter une entrée" → Type `A`
3. Remplir :
   - Sous-domaine : `mots`
   - Cible : `<IP publique du step 1>`
   - TTL : `3600` (ou valeur par défaut OVH)
4. Confirmer

- [ ] **Step 3: Vérifier la propagation DNS (depuis n'importe quelle machine)**

```bash
nslookup mots.floxail.fr
```

Attendu quand propagé :
```
Name:   mots.floxail.fr
Address: 82.64.x.x    ← même IP qu'à l'étape 1
```

Si pas encore propagé, attendre et retester. Continuer les tasks suivantes en parallèle — le DNS n'est requis qu'au Task 6 (certbot).

---

## Task 3: Pousser le code et cloner sur le serveur

**Contexte :** Code est sur la branche `MAJ-2026` (Windows dev machine). Le serveur Ubuntu a besoin du code à jour, y compris le fix PM2 du Task 1.

- [ ] **Step 1: Merger MAJ-2026 dans master et pousser (depuis Windows)**

```bash
git checkout master
git merge MAJ-2026
git push origin master
```

Attendu :
```
Branch 'master' set up to track remote branch 'master' from 'origin'.
```

- [ ] **Step 2: SSH vers le serveur Ubuntu**

```bash
ssh <user>@<IP-serveur>
```

Remplacer `<user>` par ton nom d'utilisateur Ubuntu (ex. `floxa`) et `<IP-serveur>` par l'IP LAN ou publique du serveur.

- [ ] **Step 3: Installer Node.js 20 via NodeSource**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
```

Attendu :
```
v20.x.x
10.x.x
```

- [ ] **Step 4: Cloner le repo**

Si repo public :
```bash
cd ~
git clone https://github.com/<user>/<repo>.git mots-1.0
```

Si repo privé (HTTPS + Personal Access Token GitHub) :
```bash
git clone https://<TOKEN>@github.com/<user>/<repo>.git mots-1.0
```

Remplacer `<TOKEN>` par un PAT GitHub avec scope `repo` (générer dans GitHub → Settings → Developer settings → Personal access tokens).

- [ ] **Step 5: Installer les dépendances npm**

```bash
cd ~/mots-1.0
npm install
```

Attendu : dossier `node_modules/` créé, pas d'erreur.

- [ ] **Step 6: Vérifier que le serveur démarre**

```bash
node server.js default &
sleep 3
curl -s http://localhost:2121 | grep -i "mots\|game\|pug\|html" | head -5
kill %1
```

Attendu : fragment HTML retourné (page du jeu). Pas d'erreur `Cannot find module`.

---

## Task 4: Installer nginx + UFW + config HTTP initiale

**Contexte :** nginx proxie vers Node.js port 2121. Configuration HTTP d'abord (sans SSL) — certbot l'upgrade en HTTPS ensuite. UFW doit autoriser 80 avant certbot (validation HTTP-01).

**Fichiers (sur serveur Ubuntu) :**
- Créer : `/etc/nginx/sites-available/mots.floxail.fr`
- Créer symlink : `/etc/nginx/sites-enabled/mots.floxail.fr`

- [ ] **Step 1: Installer nginx**

```bash
sudo apt-get update
sudo apt-get install -y nginx
sudo systemctl status nginx
```

Attendu : `active (running)`.

- [ ] **Step 2: Configurer UFW**

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Attendu :
```
Status: active
To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

- [ ] **Step 3: Créer la config nginx initiale (HTTP uniquement)**

```bash
sudo nano /etc/nginx/sites-available/mots.floxail.fr
```

Contenu exact à coller :
```nginx
server {
    listen 80;
    server_name mots.floxail.fr;

    location / {
        proxy_pass         http://localhost:2121;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }
}
```

Sauvegarder : `Ctrl+O` `Enter` `Ctrl+X`.

- [ ] **Step 4: Activer le site et recharger nginx**

```bash
sudo ln -s /etc/nginx/sites-available/mots.floxail.fr /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Attendu pour `nginx -t` :
```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

- [ ] **Step 5: Démarrer le serveur Node.js temporairement pour tester**

```bash
cd ~/mots-1.0
node server.js default &
sleep 2
curl -s http://localhost:2121 | grep -c "html\|game\|mots"
```

Attendu : nombre > 0 (HTML retourné).

- [ ] **Step 6: Tester le proxy nginx**

(Uniquement si DNS déjà propagé — sinon tester avec IP directe après les étapes suivantes.)

```bash
curl -I http://mots.floxail.fr
```

Attendu :
```
HTTP/1.1 200 OK
```

- [ ] **Step 7: Arrêter Node.js temporaire**

```bash
kill %1
```

---

## Task 5: Certbot — Certificat Let's Encrypt

**Contexte :** DNS doit être propagé avant cette étape (certbot valide le domaine via HTTP). nginx doit être actif sur le port 80.

- [ ] **Step 1: Vérifier que le DNS est propagé**

```bash
nslookup mots.floxail.fr
```

Attendu : retourne l'IP publique du serveur. **Ne pas continuer si le DNS n'est pas résolu.**

- [ ] **Step 2: Installer certbot**

```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

- [ ] **Step 3: Obtenir le certificat**

```bash
sudo certbot --nginx -d mots.floxail.fr
```

Certbot demande :
1. Email (pour notifications d'expiration) → entrer ton email
2. Accepter les CGU → `A`
3. Partager l'email avec EFF → `N` (optionnel)

Attendu en fin :
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/mots.floxail.fr/fullchain.pem
...
Deploying certificate to VirtualHost /etc/nginx/sites-enabled/mots.floxail.fr
```

Certbot modifie automatiquement la config nginx pour ajouter SSL + redirect 301.

- [ ] **Step 4: Vérifier HTTPS**

```bash
curl -I https://mots.floxail.fr
```

Attendu :
```
HTTP/2 200
```

---

## Task 6: Compléter la config nginx — WebSocket headers

**Contexte :** Certbot a modifié la config nginx. Vérifier que les headers WebSocket (`Upgrade`, `Connection`, `X-Forwarded-Proto`) et `proxy_read_timeout 86400s` sont bien présents. Certbot préserve le bloc `location /` existant donc ils devraient y être — vérifier et corriger si absent.

**Fichiers (sur serveur Ubuntu) :**
- Modifier : `/etc/nginx/sites-available/mots.floxail.fr`

- [ ] **Step 1: Afficher la config post-certbot**

```bash
cat /etc/nginx/sites-available/mots.floxail.fr
```

Le bloc `server { listen 443 ssl; ... }` doit contenir dans `location /` :
```nginx
proxy_http_version 1.1;
proxy_set_header   Upgrade           $http_upgrade;
proxy_set_header   Connection        "upgrade";
proxy_set_header   X-Forwarded-Proto $scheme;
proxy_read_timeout 86400s;
```

- [ ] **Step 2: Si manquants, éditer**

```bash
sudo nano /etc/nginx/sites-available/mots.floxail.fr
```

S'assurer que le bloc `location /` du server 443 contient exactement :
```nginx
    location / {
        proxy_pass         http://localhost:2121;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
    }
```

- [ ] **Step 3: Valider et recharger nginx**

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Attendu :
```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

---

## Task 7: PM2 — Démarrage automatique

**Contexte :** PM2 maintient Node.js en vie (crash recovery) et le relance au reboot via un service systemd.

- [ ] **Step 1: Installer PM2 globalement**

```bash
sudo npm install -g pm2
pm2 --version
```

Attendu : version `5.x.x`.

- [ ] **Step 2: Démarrer le serveur avec PM2**

```bash
cd ~/mots-1.0
pm2 start server.js --name mots
```

Attendu :
```
┌────┬────────────────────┬──────────┬──────┬───────────┬──────────┬──────────┐
│ id │ name               │ mode     │ pid  │ status    │ cpu      │ memory   │
├────┼────────────────────┼──────────┼──────┼───────────┼──────────┼──────────┤
│ 0  │ mots               │ fork     │ XXXX │ online    │ 0%       │ XX.Xmb   │
└────┴────────────────────┴──────────┴──────┴───────────┴──────────┴──────────┘
```

- [ ] **Step 3: Vérifier les logs**

```bash
pm2 logs mots --lines 20
```

Attendu : pas d'erreur, ligne `Express server listening on port 2121`.

- [ ] **Step 4: Sauvegarder la liste des processus PM2**

```bash
pm2 save
```

Attendu :
```
[PM2] Saving current process list...
[PM2] Successfully saved in /home/<user>/.pm2/dump.pm2
```

- [ ] **Step 5: Configurer le démarrage automatique au boot**

```bash
pm2 startup
```

PM2 affiche une commande à exécuter en root, ex. :
```
[PM2] To setup the Startup Script, copy/paste the following command:
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u floxa --hp /home/floxa
```

**Copier-coller et exécuter cette commande exacte** (elle est différente selon l'user/path) :
```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u <user> --hp /home/<user>
```

Attendu :
```
[PM2] PM2 Successfully daemonized
[PM2] Writing init systems with path /etc/systemd/system/pm2-<user>.service
```

- [ ] **Step 6: Tester le reboot**

```bash
sudo reboot
```

Reconnecter en SSH après ~30 secondes, puis vérifier :
```bash
pm2 status
```

Attendu : `mots` en status `online`.

---

## Task 8: Vérification complète

**Contexte :** Validation end-to-end du déploiement. À faire depuis le serveur Ubuntu (via SSH) ET depuis un navigateur.

- [ ] **Step 1: Vérifier conf.json dynamique**

```bash
curl -s https://mots.floxail.fr/conf.json
```

Attendu exact :
```json
{"SOCKET_ADDR":"https://mots.floxail.fr","SOCKET_PORT":443}
```

Si `SOCKET_ADDR` contient une IP locale ou `http://`, l'header `X-Forwarded-Proto` n'est pas transmis par nginx → revérifier la config nginx (Task 6 Step 2).

- [ ] **Step 2: Vérifier l'endpoint Socket.IO**

```bash
curl -s "https://mots.floxail.fr/socket.io/?EIO=4&transport=polling" | head -c 100
```

Attendu : réponse JSON Socket.IO (commence par un chiffre suivi de JSON) :
```
0{"sid":"...","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000}
```

Si erreur 502 : Node.js pas démarré → `pm2 status` et `pm2 logs mots`.

- [ ] **Step 3: Vérifier le redirect HTTP → HTTPS**

```bash
curl -I http://mots.floxail.fr
```

Attendu :
```
HTTP/1.1 301 Moved Permanently
Location: https://mots.floxail.fr/
```

- [ ] **Step 4: Vérifier la page de jeu**

Dans un navigateur : `https://mots.floxail.fr`

Attendu : page du jeu Mots.js chargée, certificat valide (cadenas vert), formulaire de connexion visible.

- [ ] **Step 5: Test multijoueur**

1. Ouvrir deux onglets sur `https://mots.floxail.fr`
2. Onglet 1 : entrer pseudo "Player1", choisir un monstre → rejoindre
3. Onglet 2 : entrer pseudo "Player2", choisir un monstre → rejoindre
4. Onglet 1 : taper `!start` dans le chat
5. Vérifier : grille affichée dans les deux onglets simultanément
6. Trouver un mot → vérifier que le mot apparaît en couleur sur les **deux** onglets en temps réel

Si les mots ne se synchronisent pas : Socket.IO WebSocket ne traverse pas nginx → revérifier headers `Upgrade`/`Connection` dans nginx (Task 6).

- [ ] **Step 6: Vérifier le renouvellement automatique du certificat**

```bash
sudo certbot renew --dry-run
```

Attendu :
```
Congratulations, all simulated renewals succeeded:
  /etc/letsencrypt/live/mots.floxail.fr/fullchain.pem (success)
```

---

## Flow de mise à jour du code (post-déploiement)

Pour déployer une mise à jour après ce déploiement initial :

**Depuis Windows (dev machine) :**
```bash
git checkout master
git merge <branche-feature>
git push origin master
```

**Depuis SSH sur Ubuntu :**
```bash
cd ~/mots-1.0
git pull origin master
npm install
pm2 restart mots
pm2 logs mots --lines 10
```
