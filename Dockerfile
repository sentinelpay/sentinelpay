FROM node:22

WORKDIR /app

# the manifest and the lockfile on their own layer, installed before the rest of
# the source is copied in.
#
# why it is worth the two extra lines: docker throws away every layer from the
# first one that changed onwards. with `COPY . .` first, editing one line of css
# invalidates the copy, which invalidates the install, and the build reinstalls
# every dependency to produce a byte-identical node_modules. almost everything we
# commit is a page, a stylesheet or a translation, so that was almost every
# build. this way the install layer is reused until the dependencies themselves
# actually change.
COPY api/package.json api/package-lock.json ./api/
RUN cd api && npm install --omit=dev

COPY . .

EXPOSE 8080

ENV PORT=8080

CMD ["sh", "-c", "cd api && node index.js"]
