ARG PHP_BASE=php84

FROM composer:2@sha256:919efe8e62179c71dfd31fad035fd671fe7454211c6b2aa30a10af0ab4acedba AS composer-runtime

FROM php:8.4-cli-trixie@sha256:1afd622efcdd7623feca3562344097fb60c8078926e9961679f0c54657fac603 AS php84
RUN apt-get update \
    && apt-get install -y --no-install-recommends git libicu-dev libonig-dev libsqlite3-dev libxml2-dev libzip-dev unzip \
    && missing="$(php -r 'foreach (["dom", "intl", "mbstring", "pdo_sqlite", "simplexml", "xml", "xmlwriter", "zip"] as $ext) if (!extension_loaded($ext)) echo $ext, " ";')" \
    && if [ -n "$missing" ]; then set -- $missing; docker-php-ext-install -j "$(nproc)" "$@"; fi \
    && rm -rf /var/lib/apt/lists/*

FROM dunglas/frankenphp:1-php8.5@sha256:667c5fffd348d9c3c260803d75956f1d9aace7e4b7331d8893de6f101d7e0e57 AS php85
RUN apt-get update \
    && apt-get install -y --no-install-recommends git unzip \
    && install-php-extensions dom intl mbstring pdo_sqlite simplexml xml xmlwriter zip \
    && rm -rf /var/lib/apt/lists/*

FROM ${PHP_BASE}
COPY --from=composer-runtime /usr/bin/composer /usr/local/bin/composer
ENV COMPOSER_ALLOW_SUPERUSER=1
WORKDIR /workspace
