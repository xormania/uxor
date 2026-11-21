FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS javascript
WORKDIR /opt/javascript
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM ghcr.io/astral-sh/uv:0.13.9@sha256:d3b601f0c7b118bc1753febf7c41cc80981df678445e0254284eecf84db79a7d AS uv
FROM dunglas/frankenphp:1.13.6-php8.5.13-trixie@sha256:17ff6554ba6de527d17aa5ec37e2a3bc3b182d7dbea9362f9a02eb5b4a1c4b95
RUN apt-get update && apt-get install -y --no-install-recommends git python3 \
    && install-php-extensions intl zip && rm -rf /var/lib/apt/lists/*
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /opt/serena
ADD --checksum=sha256:72726504c3761e7aabc0a3016f44ab7aa48efe0129a2c50241d5b211196d529b https://codeload.github.com/oraios/serena/tar.gz/7f7d6245bf96b60fdf4e752a779917372fd1ee6e /tmp/serena.tar.gz
RUN tar -xzf /tmp/serena.tar.gz --strip-components=1 && rm /tmp/serena.tar.gz \
    && uv sync --frozen --no-dev --no-editable --no-cache --python /usr/bin/python3 \
    && .venv/bin/serena --version
ADD --checksum=sha256:b28bf6166e016d539fc2f2aec18ef918b12590e436a6f1ccbdf30b5bbdbdb16b --chmod=0555 https://github.com/phpactor/phpactor/releases/download/2026.10.07.0/phpactor.phar /opt/phpactor.phar
# Node runs only the optional JavaScript language server inside the editor.
COPY --from=javascript /usr/local/bin/node /usr/local/bin/node
COPY --from=javascript /opt/javascript /opt/javascript
RUN install -d -m 1777 /cache
COPY start.py /opt/start.py
ENV HOME=/tmp/home SERENA_HOME=/tmp/home/serena XDG_CACHE_HOME=/cache PYTHONDONTWRITEBYTECODE=1 SERENA_USAGE_REPORTING=false
WORKDIR /workspace
ENTRYPOINT ["/opt/serena/.venv/bin/python", "/opt/start.py"]
