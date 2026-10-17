#!/bin/sh
# Stockage objet de la recette (SeaweedFS, compatible S3) : les identités sont écrites à partir
# des variables d'environnement, jamais versionnées.
#   - zandu : la clé de l'API (lecture, écriture) ;
#   - anonyme : lecture seule du compartiment public (photos des produits). Le compartiment
#     privé (pièces d'identité, preuves de litige) ne se lit qu'avec une URL signée.
set -eu
case "${S3_ACCESS_KEY_ID:-}${S3_SECRET_ACCESS_KEY:-}" in
  *[!A-Za-z0-9]* | '') echo "S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY : lettres et chiffres uniquement" >&2; exit 1 ;;
esac
umask 077
cat > /tmp/s3.json <<JSON
{
  "identities": [
    { "name": "anonymous", "actions": ["Read:${S3_PUBLIC_BUCKET:-zandu-public}"] },
    {
      "name": "zandu",
      "credentials": [{ "accessKey": "${S3_ACCESS_KEY_ID}", "secretKey": "${S3_SECRET_ACCESS_KEY}" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
JSON
chown seaweed:seaweed /tmp/s3.json
exec /entrypoint.sh server -s3 -s3.port=8333 -s3.config=/tmp/s3.json
