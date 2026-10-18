# Node 22, the line the main app runs on; 18 has had no security fixes since
# April 2025. Nothing to install: the server is Node's own http.
FROM node:22-alpine
WORKDIR /app
COPY --chown=root:root server.js index.html package.json ./
USER node
CMD ["node", "server.js"]
