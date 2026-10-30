#!/usr/bin/env bash
# Préparation du serveur de recette, lancée par GitHub Actions avant chaque déploiement
# (docs/exploitation/deploiement-automatique.md). Sans effet si tout est déjà en place :
#   - Docker installé, pare-feu limité à SSH, HTTP et HTTPS ;
#   - fichier .env créé une seule fois (adresses tirées du domaine, secrets tirés au hasard) ;
#   - sauvegarde de la base chaque nuit.
# Variables : DOMAINE (ex. zandu.com), EMAIL (avis des certificats HTTPS), RECETTE_KEY (facultatif).
set -euo pipefail
cd "$(dirname "$0")"
: "${DOMAINE:?DOMAINE manquant}" "${EMAIL:?EMAIL manquant}"
[ "$(id -u)" = 0 ] || { echo "✘ À lancer en administrateur (root)"; exit 1; }
if [ -n "${RECETTE_KEY:-}" ] && [ "${#RECETTE_KEY}" -lt 24 ]; then
  echo "✘ RECETTE_KEY (mot de passe des testeurs) : 24 caractères au moins"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installation de Docker…"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true

if command -v ufw >/dev/null 2>&1 && ! ufw status | grep -q 'Status: active'; then
  ufw allow OpenSSH >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null && ufw --force enable >/dev/null
  echo "✔ Pare-feu : SSH, HTTP et HTTPS seulement"
fi

secret() { openssl rand -hex "${1:-32}"; }
if [ ! -f .env ]; then
  cat > .env <<ENV
# Recette de Zandu, créé par preparer-serveur.sh le $(date -I). Ne quitte jamais le serveur.
SITE_HOST=recette.$DOMAINE
API_HOST=api.recette.$DOMAINE
BACKOFFICE_HOST=bo.recette.$DOMAINE
MEDIA_HOST=media.recette.$DOMAINE
ACME_EMAIL=$EMAIL
POSTGRES_PASSWORD=$(secret)
APP_SECRET=$(secret)
SIMULATOR_WEBHOOK_SECRET=$(secret)
RECETTE_KEY=${RECETTE_KEY:-$(secret 16)}
S3_ACCESS_KEY_ID=$(secret 10)
S3_SECRET_ACCESS_KEY=$(secret)
SUPPORT_ALERT_PHONE=
BACKOFFICE_ALLOWED_IPS=
PUSH_PROVIDER=none
EXPO_ACCESS_TOKEN=
ENV
  chmod 600 .env
  echo "✔ .env créé pour recette.$DOMAINE (secrets tirés au hasard)"
elif [ -n "${RECETTE_KEY:-}" ] && ! grep -q "^RECETTE_KEY=$RECETTE_KEY$" .env; then
  sed -i "s/^RECETTE_KEY=.*/RECETTE_KEY=$RECETTE_KEY/" .env
  echo "✔ Mot de passe des testeurs (RECETTE_KEY) mis à jour"
fi

chmod +x sauvegarder.sh deployer.sh
ligne="30 2 * * * $PWD/sauvegarder.sh >> /var/log/zandu-sauvegarde.log 2>&1"
if ! crontab -l 2>/dev/null | grep -qF "$PWD/sauvegarder.sh"; then
  (crontab -l 2>/dev/null; echo "$ligne") | crontab -
  echo "✔ Sauvegarde de la base chaque nuit à 2 h 30 (14 jours gardés)"
fi
