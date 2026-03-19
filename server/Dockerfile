FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
COPY server/package.json ./server/package.json
COPY shared/package.json ./shared/package.json
RUN npm install

FROM deps AS build
COPY server ./server
COPY shared ./shared
RUN npm run build --workspace @faceless/shared && npm run build --workspace @faceless/server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY server/package.json ./server/package.json
COPY shared/package.json ./shared/package.json
RUN npm install --omit=dev --workspace @faceless/server --workspace @faceless/shared
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/src/db/migrations ./server/dist/db/migrations
COPY --from=build /app/shared/dist ./shared/dist
VOLUME ["/app/data"]
WORKDIR /app/server
EXPOSE 3001
CMD ["node", "dist/server.js"]
