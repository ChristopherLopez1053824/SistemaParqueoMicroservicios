FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY certs ./certs
COPY sql ./sql

USER node

EXPOSE 3003

CMD ["node", "src/server.js"]
