# Core subgraph image for Cloud Run.
#
# Codegen runs here rather than at boot. The `production` script runs it before
# the server starts, which would repeat that work on every cold start and - worse -
# make the container's first request wait on a step that could fail after the
# service reports healthy.

FROM node:24-slim

WORKDIR /src

# Swatch re-encodes Gemini's films, which come out about three times too large.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Yarn 4 comes from the `packageManager` field rather than a bundled release.
RUN corepack enable

# Manifests first, so a dependency install is only redone when they change.
COPY package.json yarn.lock .yarnrc.yml ./
# `.yarn/` is not copied here: `.gitignore` keeps everything in it out of the
# repository, so the directory is absent from a clean checkout and the COPY
# fails. It exists locally - install state and an empty patches folder - which
# is why a deploy from local sources built and the first build from git did
# not. Should patches ever be committed, `COPY . .` below picks them up.
COPY Server/package.json ./Server/
COPY Codegen/package.json ./Codegen/

# Dev dependencies are needed at runtime: the server is run through `tsx`, which
# is a devDependency, and there is no compile step.
RUN yarn install --immutable

COPY . .

# `Server/Types/graphql.ts` is generated, not committed, so the server cannot
# start without this having run.
RUN yarn codegen

ENV NODE_ENV=production

# Cloud Run supplies PORT and ignores EXPOSE; this documents the default the
# server falls back to when PORT is absent.
EXPOSE 8080

CMD ["yarn", "tsx", "Server/index.ts"]
