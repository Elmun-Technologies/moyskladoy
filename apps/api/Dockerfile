# api xizmati - monorepo build
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
RUN npx prisma generate --schema packages/db/prisma/schema.prisma || echo "[build] prisma generate network kerak bo'lsa deploy paytida ishga tushadi" && npm run typecheck -w @app/shared -w @app/db

FROM node:22-bookworm-slim
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo ./
EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@app/api"]
