ARG MAGO_RELEASE=ghcr.io/carthage-software/mago:1.60.2@sha256:e1a629ea46be10ad5b873512ec4475f1f806ae2b688406d160a8c54145ef6265
FROM ${MAGO_RELEASE} AS release

# Provide the PHP runtime and extensions used by project-configured analyzer workers.
FROM php:8.4.28-cli-trixie@sha256:1afd622efcdd7623feca3562344097fb60c8078926e9961679f0c54657fac603
RUN apt-get update \
    && apt-get install -y --no-install-recommends libicu-dev libzip-dev \
    && docker-php-ext-install -j4 intl zip \
    && apt-get purge -y libicu-dev libzip-dev \
    && rm -rf /var/lib/apt/lists/*
ARG MAGO_RELEASE
COPY --from=release /usr/local/bin/mago /usr/local/bin/mago
ADD --chmod=0644 --checksum=sha256:0562f9f7aa4ee4f7d5e35460d447bd8c4594b7d73c535bffb3ab88c027af771d https://raw.githubusercontent.com/carthage-software/mago/3de548f9607a8d8d071f6e0deb2a0023107b8848/LICENSE-MIT /usr/share/licenses/mago/LICENSE-MIT
ADD --chmod=0644 --checksum=sha256:62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a https://raw.githubusercontent.com/carthage-software/mago/3de548f9607a8d8d071f6e0deb2a0023107b8848/LICENSE-APACHE /usr/share/licenses/mago/LICENSE-APACHE
LABEL io.uxor.mago.release-image="${MAGO_RELEASE}"
RUN chmod 755 /usr/share/licenses /usr/share/licenses/mago && test "$(mago --version)" = "mago 1.60.2"
ENTRYPOINT []
