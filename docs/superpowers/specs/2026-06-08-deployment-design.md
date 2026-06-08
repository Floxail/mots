# Déploiement Mots.js — Design Spec

**Date:** 2026-06-08
**Branche cible:** MAJ-2026 → master (merge avant déploiement)
**Domaine cible:** `mots.floxail.fr`

---

## Objectif

Rendre Mots.js accessible publiquement sur `https://mots.floxail.fr` depuis un PC Ubuntu servant de serveur, via un nom de domaine OVH. Jeu multijoueur fonctionnel : Socket.IO WebSocket doit traverser le proxy nginx intact.

---

## Architecture cible

```
Internet
    │
    ▼ HTTPS :443
nginx (Ubuntu PC)
    │  TLS terminé ici
    │  X-Forwarded-Proto: https
    │  Host: mots.floxail.fr
    ▼
Node.js (Express + Socket.IO)
    localhost:2121
    (single port — même httpServer)
```

**Propriété clé :** `server.js` route `/conf.json` retourne dynamiquement `SOCKET_ADDR` et `SOCKET_PORT` en lisant les headers HTTP forwards. Si nginx passe `X-Forwarded-Proto: https` et `Host: mots.floxail.fr`, le client reçoit automatiquement `{SOCKET_ADDR: "https://mots.floxail.fr", SOCKET_PORT: 443}`. **Aucun changement de code requis.**

---

## Hors scope

- HTTPS côté Socket.IO séparé (même port que HTTP maintenant)
- Monitoring avancé / logs centralisés
- CI/CD automatique
- Certificat payant / wildcard

---

## 1. DNS — OVH

### Configuration

Dans l'interface OVH (Manager → Zone DNS du domaine `floxail.fr`) :

| Type | Sous-domaine | Cible | TTL |
|------|-------------|-------|-----|
| A | `mots` | `<IP publique statique>` | 3600 |

Pas de CNAME, pas de DynDNS — IP fixe.

**Propagation** : 1h–24h selon les résolveurs. Vérifier avec :
```bash
nslookup mots.floxail.fr
```

---

## 2. Nginx — Reverse proxy + WebSocket

### Comportement attendu

- Port 80 → redirect 301 vers HTTPS
- Port 443 → proxy vers `localhost:2121`
- Headers WebSocket (`Upgrade`, `Connection`) transmis pour Socket.IO
- `X-Forwarded-Proto: https` pour que la route `/conf.json` retourne le bon protocole

### Config nginx

**Ordre bootstrap** : nginx ne peut pas démarrer avec des chemins de certificat inexistants. Séquence obligatoire :
1. Créer config HTTP-only (port 80 uniquement)
2. Lancer `certbot --nginx` — obtient le cert et modifie la config automatiquement
3. Éditer la config résultante pour ajouter les headers WebSocket + `proxy_read_timeout`

**Config initiale** (avant certbot) — fichier `/etc/nginx/sites-available/mots.floxail.fr` :

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

**Config finale** (après certbot, qui ajoute automatiquement le bloc SSL et le redirect 301) :

```nginx
server {
    listen 80;
    server_name mots.floxail.fr;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name mots.floxail.fr;

    ssl_certificate     /etc/letsencrypt/live/mots.floxail.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mots.floxail.fr/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

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

**`proxy_read_timeout 86400s`** : évite que nginx coupe les connexions WebSocket longue durée (défaut 60s).

Le bloc `location /` unique suffit car Express et Socket.IO partagent le même port 2121 — pas besoin de `location /socket.io/` séparé.

---

## 3. SSL — Let's Encrypt via Certbot

Certbot installe le certificat et modifie automatiquement le fichier nginx :

```bash
sudo certbot --nginx -d mots.floxail.fr
```

Renouvellement automatique via le timer systemd certbot (installé par défaut avec certbot). Vérifier :
```bash
sudo systemctl status certbot.timer
```

---

## 4. PM2 — Gestion du processus Node.js

PM2 gère le redémarrage automatique de Node.js (crash, reboot serveur).

```bash
cd ~/mots-1.0
pm2 start server.js --name mots
pm2 save
pm2 startup   # génère la commande systemd à exécuter en root
```

Commandes utiles :
- `pm2 logs mots` — logs temps réel
- `pm2 restart mots` — redémarrer après mise à jour
- `pm2 status` — état du processus

**Argument grille :** pour lancer avec la grille du jour, pas d'argument. Pour grille spécifique : `pm2 start server.js --name mots -- 2120`.

---

## 5. UFW — Pare-feu

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Port 2121 : **non exposé**. Accessible localhost uniquement (nginx sert de seul point d'entrée). Idem pour tout port interne Socket.IO (maintenant identique à 2121).

Vérifier :
```bash
sudo ufw status
```

---

## 6. Déploiement depuis Windows via SSH

Connexion SSH depuis le PC Windows vers l'Ubuntu server :
```bash
ssh user@<IP-server-LAN>   # ex: ssh floxa@192.168.1.x
```

Ou via IP publique si accès externe :
```bash
ssh user@<IP-publique>
```

**Flow de mise à jour du code :**

Depuis Windows (repo git local) :
```bash
git checkout master
git merge MAJ-2026
git push origin master
```

Depuis le terminal SSH sur Ubuntu :
```bash
cd ~/mots-1.0
git pull origin master
npm install
pm2 restart mots
```

**Premier déploiement :**
```bash
# Sur Ubuntu (via SSH)
cd ~
git clone <url-repo> mots-1.0    # HTTPS avec token si repo privé, ou SSH key
cd mots-1.0
npm install
```

**Note repo privé :** si le repo GitHub est privé, soit configurer une clé SSH sur le serveur Ubuntu (`ssh-keygen` + ajouter la clé publique dans GitHub Settings → SSH Keys), soit utiliser HTTPS avec un token d'accès personnel (PAT) : `git clone https://<token>@github.com/user/repo.git`.

---

## 7. Vérification post-déploiement

```bash
# DNS résolu correctement
nslookup mots.floxail.fr

# Cert valide, nginx répond
curl -I https://mots.floxail.fr

# Game page accessible
curl -s https://mots.floxail.fr | grep -i "mots"

# Socket.IO endpoint répond
curl -s "https://mots.floxail.fr/socket.io/?EIO=4&transport=polling"

# conf.json route retourne les bonnes valeurs
curl -s https://mots.floxail.fr/conf.json
# Attendu: {"SOCKET_ADDR":"https://mots.floxail.fr","SOCKET_PORT":443}
```

**Test multijoueur :** ouvrir deux onglets sur `https://mots.floxail.fr`, créer une salle, rejoindre avec les deux clients, lancer une partie — vérifier que les mots trouvés s'affichent en temps réel sur les deux clients.

---

## Résumé des étapes

| # | Étape | Où |
|---|-------|----|
| 1 | Ajouter A record `mots` → IP dans OVH | Navigateur (Manager OVH) |
| 2 | Installer nginx + certbot sur Ubuntu | SSH Ubuntu |
| 3 | Créer config nginx + activer le site | SSH Ubuntu |
| 4 | Obtenir certificat Let's Encrypt | SSH Ubuntu |
| 5 | Configurer UFW | SSH Ubuntu |
| 6 | Cloner le repo + `npm install` | SSH Ubuntu |
| 7 | Démarrer avec PM2 + configurer startup | SSH Ubuntu |
| 8 | Vérifier avec `curl` + test navigateur | Local |

**Aucun changement de code** requis — l'architecture actuelle (single-port, `/conf.json` dynamique) est déjà compatible production.
