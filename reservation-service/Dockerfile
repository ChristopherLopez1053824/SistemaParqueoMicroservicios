FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY certs ./certs

USER node

EXPOSE 3002

CMD ["node", "src/server.js"]
