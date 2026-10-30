#!/usr/bin/env bash
# Mise à jour de la recette par GitHub Actions (docs/exploitation/deploiement-automatique.md).
# Lancé sur le serveur, dans /opt/zandu/recette, avec :
#   ZANDU_IMAGES   ex. ghcr.io/yionictech/zandu
#   ZANDU_VERSION  identifiant du commit déployé
#   GHCR_USER      compte GitHub ; le jeton d'accès aux images arrive sur l'entrée standard
# Les images sont tirées, jamais construites ici : un petit serveur suffit.
set -euo pipefail
cd "$(dirname "$0")"
: "${ZANDU_IMAGES:?}" "${ZANDU_VERSION:?}" "${GHCR_USER:?}"
GHCR_TOKEN=$(cat)
test -f .env || { echo "✘ .env absent : lancer d'abord preparer-serveur.sh"; exit 1; }

# La version déployée est retenue : `docker compose` sans variable relance la même.
grep -v '^ZANDU_IMAGES=\|^ZANDU_VERSION=' .env > .env.nouveau || true
printf 'ZANDU_IMAGES=%s\nZANDU_VERSION=%s\n' "$ZANDU_IMAGES" "$ZANDU_VERSION" >> .env.nouveau
mv .env.nouveau .env
chmod 600 .env

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
docker compose pull --quiet migrate api worker web backoffice
docker compose pull --quiet --ignore-pull-failures postgres stockage caddy
# migrate s'exécute avant l'API : schéma à jour avant le nouveau code.
docker compose up -d --no-build --remove-orphans

echo "Attente de l'API…"
for _ in $(seq 1 60); do
  if [ "$(docker compose ps api --format '{{.Health}}')" = healthy ]; then
    echo "✔ Recette à jour : $ZANDU_VERSION"
    docker image prune -af --filter "until=168h" >/dev/null || true
    exit 0
  fi
  sleep 5
done
echo "✘ L'API ne répond pas après 5 minutes"
docker compose ps
docker compose logs --tail=80 migrate api
exit 1
