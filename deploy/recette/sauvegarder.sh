#!/usr/bin/env bash
# Sauvegarde de la base de la recette, à lancer chaque nuit par cron sur le serveur :
#   30 2 * * * /opt/zandu/deploy/recette/sauvegarder.sh >> /var/log/zandu-sauvegarde.log 2>&1
# Garde 14 jours. Copier aussi le dossier sauvegardes/ hors du serveur (voir le guide).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p sauvegardes
fichier="sauvegardes/zandu-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T postgres pg_dump -U zandu -d zandu --no-owner --clean --if-exists \
  | gzip > "$fichier.partiel"
mv "$fichier.partiel" "$fichier"
find sauvegardes -name 'zandu-*.sql.gz' -mtime +14 -delete
echo "$(date -Iseconds) sauvegarde $fichier ($(du -h "$fichier" | cut -f1))"
