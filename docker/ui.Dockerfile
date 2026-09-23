FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    API_URL=http://api:8000

WORKDIR /app

COPY --chown=node:node frontend/ /app/

USER node
EXPOSE 4173
CMD ["node", "server.js"]
