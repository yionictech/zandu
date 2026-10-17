#!/usr/bin/env bash
# Essai complet de la recette sur un poste ou en CI, sans nom de domaine : adresses
# *.zandu.localhost, certificats de l'autorité interne de Caddy, secrets tirés au hasard.
#
# Prérequis : Docker (avec Compose), Node 22, openssl, et dans /etc/hosts :
#   127.0.0.1 zandu.localhost api.zandu.localhost bo.zandu.localhost media.zandu.localhost
#
#   ./deploy/recette/essai-local.sh            construit, démarre, charge la démo, vérifie
#   ./deploy/recette/essai-local.sh journaux   journaux des services
#   ./deploy/recette/essai-local.sh arreter    arrête et efface tout (base, photos)
set -euo pipefail
cd "$(dirname "$0")"
DIR=.essai-local
compose() { docker compose --env-file "$DIR/env" -p zandu-essai "$@"; }

case "${1:-demarrer}" in
  journaux) compose logs --tail=200; exit 0 ;;
  arreter) compose down -v; rm -rf "$DIR"; exit 0 ;;
  demarrer) ;;
  *) echo "Usage : $0 [demarrer|journaux|arreter]" >&2; exit 2 ;;
esac

for host in zandu.localhost api.zandu.localhost bo.zandu.localhost media.zandu.localhost; do
  getent hosts "$host" >/dev/null || {
    echo "Ajoutez à /etc/hosts : 127.0.0.1 zandu.localhost api.zandu.localhost bo.zandu.localhost media.zandu.localhost" >&2
    exit 1
  }
done

mkdir -p "$DIR"
if [ ! -f "$DIR/env" ]; then
  cat > "$DIR/env" <<EOF
SITE_HOST=zandu.localhost
API_HOST=api.zandu.localhost
BACKOFFICE_HOST=bo.zandu.localhost
MEDIA_HOST=media.zandu.localhost
ACME_EMAIL=essai@example.com
POSTGRES_PASSWORD=$(openssl rand -hex 16)
APP_SECRET=$(openssl rand -hex 32)
SIMULATOR_WEBHOOK_SECRET=$(openssl rand -hex 24)
RECETTE_KEY=$(openssl rand -hex 16)
S3_ACCESS_KEY_ID=$(openssl rand -hex 10)
S3_SECRET_ACCESS_KEY=$(openssl rand -hex 24)
ZANDU_VERSION=essai
EOF
fi

compose up -d --build
echo "Attente de l'API derrière Caddy…"
for _ in $(seq 1 90); do
  curl -sfk -o /dev/null https://api.zandu.localhost/health && break
  sleep 2
done
compose run --rm --no-deps migrate node dist/db/seed-demo.js
compose cp caddy:/data/caddy/pki/authorities/local/root.crt "$DIR/caddy-racine.crt"
NODE_EXTRA_CA_CERTS="$DIR/caddy-racine.crt" node verifier.mjs "$DIR/env"
echo
echo "Site        https://zandu.localhost      (certificat local : accepter l'avertissement)"
echo "Back-office https://bo.zandu.localhost"
echo "SMS de test https://zandu.localhost/recette/sms — mot de passe : RECETTE_KEY de $PWD/$DIR/env"
