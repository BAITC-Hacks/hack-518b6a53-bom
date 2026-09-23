FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    API_URL=http://api:8000

WORKDIR /app

COPY --chown=node:node package.json server.js index.html styles.css app.js api.js model.js /app/
COPY --chown=node:node i18n.js locales.js map-geometry.js map-objects.js map-object-art.js /app/
COPY --chown=node:node svg /app/svg

USER node
EXPOSE 4173
CMD ["node", "server.js"]
