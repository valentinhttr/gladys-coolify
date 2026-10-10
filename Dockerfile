FROM node:24-alpine
RUN apk add --no-cache dumb-init
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY index.js gladys-assistant-integration.json ./
COPY src ./src
ENV NODE_ENV=production
USER node
VOLUME ["/data"]
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
