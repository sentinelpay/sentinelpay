# slim, not the full image.
#
# the full node:22 is a complete debian userland with a compiler toolchain, and
# it is about four hundred megabytes of the four hundred and ten the finished
# image weighed. that is what the deploy was stalling on: the build itself
# finished in seconds and then sat there pushing the base image to the registry.
# slim is the same debian and the same glibc with the build tools and the
# extras stripped out, and it takes the push down by roughly a factor of five.
#
# it is safe here because nothing we install needs to be compiled: all nine
# runtime dependencies are pure javascript, the only package in the lockfile
# with an install script is fsevents, which is macos-only and a dependency of
# nodemon that --omit=dev leaves out anyway. if a dependency that needs
# node-gyp is ever added, this line is where it will show up, and the answer
# then is to build on the full image and copy node_modules into a slim one
# rather than to go back to shipping a compiler.
FROM node:22-slim

# chromium, for the usage report as a pdf.
#
# the one binary the app drives: api/pdf.js starts it to print the report the
# dashboard shows, so the pdf comes out the same whoever downloads it. debian's
# own package rather than the copy puppeteer downloads, because that download
# runs as an install script and fetches whatever build it was pinned to from
# google's servers at build time; this one comes from the same signed archive
# as the rest of the image and is patched with it. it adds about three hundred
# megabytes to the image and nothing to memory until somebody asks for a pdf.
# the fonts the report is set in travel inside the page, so no font packages.
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium \
    && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium

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
# ci, not install.
#
# `npm install` is allowed to resolve something other than what the lockfile
# says and to rewrite the lockfile while it does it, which means the image can
# end up with a dependency tree nobody reviewed. `npm ci` installs exactly the
# tree in the lockfile or fails, so what runs in production is what was audited
# in the pull request. Without lifecycle scripts: nothing the app runs on needs
# one, and a dependency that started running code at install would not get to.
RUN cd api && npm ci --omit=dev --ignore-scripts

COPY . .

# not root.
#
# node:22-slim runs as root unless told otherwise, so until now a hole in any
# dependency was a hole with root in the container. the node user ships with the
# image; the app only ever reads its own files and writes to the temp directory,
# so it needs nothing that root was providing.
USER node

EXPOSE 8080

ENV PORT=8080

CMD ["sh", "-c", "cd api && node index.js"]
