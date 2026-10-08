# Fly.io uchun bitta monorepo image: api (web) + bot + worker shu obrazdan
# fly.toml'dagi [processes] orqali alohida jarayon bo'lib chiqadi.
# (Alohida docker-compose deploy uchun apps/*/Dockerfile'lar ham mavjud.)
FROM node:22-bookworm-slim AS build
WORKDIR /repo
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/worker/package.json apps/worker/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx prisma generate --schema packages/db/prisma/schema.prisma \
  && npm run typecheck -w @app/shared -w @app/db -w @app/api -w @app/bot -w @app/worker

FROM node:22-bookworm-slim
WORKDIR /repo
ENV NODE_ENV=production
# tsx build bosqichidagi to'liq node_modules bilan ishlaydi (prod start = tsx).
COPY --from=build /repo ./
RUN mkdir -p /data/uploads
ENV MEDIA_DIR=/data/uploads
EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@app/api"]
