FROM node:26-alpine AS source
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .

FROM source AS api
RUN npm run build --workspace=@lthai/api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4000
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]

FROM source AS web
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
RUN npm run build --workspace=@lthai/web
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "/app/node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
