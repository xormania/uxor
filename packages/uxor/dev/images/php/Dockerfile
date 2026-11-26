FROM composer:2.11.2@sha256:919efe8e62179c71dfd31fad035fd671fe7454211c6b2aa30a10af0ab4acedba AS composer
FROM dunglas/frankenphp:1.13.6-php8.5.13-trixie@sha256:16459935c294791b28d6895cc4b155b99c0bdbb61c7cacc63ac96785db12ca57
COPY --from=composer /usr/bin/composer /usr/local/bin/composer

RUN apt-get update \
    && apt-get install -y --no-install-recommends git unzip \
    && install-php-extensions intl zip \
    && rm -rf /var/lib/apt/lists/*

# Docker copies these directories into new per-worktree cache volumes on first use.
ARG UXOR_DEV_UID=1000
ARG UXOR_DEV_GID=1000
RUN install -d -o "$UXOR_DEV_UID" -g "$UXOR_DEV_GID" /home/dev /data /data/caddy /config /config/caddy
