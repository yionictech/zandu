# syntax=docker/dockerfile:1.7
#
# Images de Zandu (ADR-0013). Une seule recette de construction, une cible par service ; la
# même image sert la recette et la production (la configuration arrive par l'environnement).
#
#   docker build --target api        -t zandu-api .         API, worker, migrations, outils
#   docker build --target web        -t zandu-web .         site web acheteurs
#   docker build --target backoffice -t zandu-backoffice .  back-office du support
#
# L'application mobile ne passe pas par ici (EAS Build, voir docs/exploitation).

ARG NODE_IMAGE=node:22-bookworm-slim
# Image de construction : la même par défaut (un poste derrière un proxy peut en fournir une
# qui fait confiance à son certificat, sans modifier ce fichier).
ARG BUILD_IMAGE=${NODE_IMAGE}

# ---------------------------------------------------------------------------------------------
FROM ${BUILD_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@10.28.0 && npm cache clean --force
WORKDIR /repo

# Dépendances d'abord : cette couche reste en cache tant que les manifestes ne changent pas.
# Le manifeste mobile est copié pour que le lockfile corresponde à l'espace de travail, mais
# ses dépendances (React Native, Expo) ne sont pas installées.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/backoffice/package.json apps/backoffice/
COPY apps/mobile/package.json apps/mobile/
COPY packages/domain/package.json packages/domain/
COPY packages/api-client/package.json packages/api-client/
COPY packages/design/package.json packages/design/
RUN --mount=type=cache,id=zandu-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter "@zandu/api..." --filter "@zandu/web..." --filter "@zandu/backoffice..."

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/web apps/web
COPY apps/backoffice apps/backoffice
RUN NEXT_OUTPUT=standalone pnpm \
      --filter "@zandu/api..." --filter "@zandu/web..." --filter "@zandu/backoffice..." build
# API : ses seules dépendances de production, paquets de l'espace de travail compris.
RUN --mount=type=cache,id=zandu-pnpm,target=/pnpm/store \
    pnpm --filter @zandu/api deploy --prod --legacy /out/api

# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production PORT=3000
# Même arborescence que le dépôt : dist/db/migrate.js trouve ../../../../db/migrations.
WORKDIR /srv/apps/api
COPY --from=build /out/api ./
COPY db/migrations /srv/db/migrations
COPY db/seeds /srv/db/seeds
USER node
EXPOSE 3000
# La même image sert aussi le worker (node dist/worker.js) et les migrations.
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /srv
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS backoffice
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /srv
COPY --from=build /repo/apps/backoffice/.next/standalone ./
COPY --from=build /repo/apps/backoffice/.next/static ./apps/backoffice/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/backoffice/server.js"]
