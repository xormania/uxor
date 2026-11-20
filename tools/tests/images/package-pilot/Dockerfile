FROM scratch AS tailwind-amd64
ADD --checksum=sha256:dc61b3ac6b8c9ca874c0cc4c57b2409791a64c5540404ca5f5367360babc313a https://github.com/tailwindlabs/tailwindcss/releases/download/v4.3.3/tailwindcss-linux-x64 /tailwindcss

FROM scratch AS tailwind-arm64
ADD --checksum=sha256:55fd0b241214eff3de1e8ee4f22796662f2d2e7a49bcfca7477cfd0bac398195 https://github.com/tailwindlabs/tailwindcss/releases/download/v4.3.3/tailwindcss-linux-arm64 /tailwindcss

FROM tailwind-${TARGETARCH} AS tailwind
FROM composer:2.11.2@sha256:919efe8e62179c71dfd31fad035fd671fe7454211c6b2aa30a10af0ab4acedba AS composer
FROM node:22.23.5-trixie-slim@sha256:68c76cfad89921b927eae28ba21407475e29d0ce450afcdbe70c1532db042b64 AS node

FROM php:8.5.13-cli-trixie@sha256:f324fcb4dc009ac0470a7d614cd122499dcee3ca47a9bab620fc14c0eb759ba2 AS php
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl git openssl python3 unzip \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
COPY --from=tailwind --chmod=0755 /tailwindcss /usr/local/bin/tailwindcss
COPY --chmod=0755 entrypoint.sh /usr/local/bin/pilot-entrypoint
ENV HOME=/tmp
ENTRYPOINT ["pilot-entrypoint"]
CMD ["php", "-a"]

# Browser contracts and the optional in-container release builder use Node.
FROM php AS tools
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
