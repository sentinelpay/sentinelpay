# slim, not the full image.
#
# the full node:22 is a complete debian userland with a compiler toolchain, and
# it is about four hundred megabytes of the four hundred and ten the finished
# image weighed. that is what the deploy was stalling on: the build itself
# finished in seconds and then sat there pushing the base image to the registry.
# slim is the same debian and the same glibc with the build tools and the
# extras stripped out, and it takes the push down by roughly a factor of five.
#
# it is safe here because nothing we install needs to be compiled: all eight
# runtime dependencies are pure javascript, the only package in the lockfile
# with an install script is fsevents, which is macos-only and a dependency of
# nodemon that --omit=dev leaves out anyway, and the app never shells out to a
# binary. if a dependency that needs node-gyp is ever added, this line is where
# it will show up, and the answer then is to build on the full image and copy
# node_modules into a slim one rather than to go back to shipping a compiler.
FROM node:22-slim

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
