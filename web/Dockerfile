FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV AIE_DOCKER_BUILD=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S aie && adduser -S aie -G aie
COPY --from=builder /app/public ./public
COPY --from=builder --chown=aie:aie /app/.next/standalone ./
COPY --from=builder --chown=aie:aie /app/.next/static ./.next/static
USER aie
EXPOSE 3000
CMD ["node", "server.js"]
