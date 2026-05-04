FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

FROM deps AS build
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
