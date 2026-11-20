# syntax=docker/dockerfile:1.7
ARG RUST_IMAGE=rust:1.100.0-bookworm@sha256:ade39a710ef85f3506cffcfec3e8a24ba090badef1dff2fb798f71d878833fea
ARG PHP_IMAGE=php:8.4.28-cli-trixie@sha256:1afd622efcdd7623feca3562344097fb60c8078926e9961679f0c54657fac603
ARG PYTHON_IMAGE=python:3.12.16-slim-trixie@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.13.9@sha256:d3b601f0c7b118bc1753febf7c41cc80981df678445e0254284eecf84db79a7d
ARG COMPOSER_IMAGE=composer:2.11.2@sha256:919efe8e62179c71dfd31fad035fd671fe7454211c6b2aa30a10af0ab4acedba

FROM ${RUST_IMAGE} AS poc-source
WORKDIR /poc
RUN --mount=type=secret,id=proxy_ca <<'SH'
set -eu
revision=4e811e48ee9c934791695ebfc9622daa251534b4
if [ -s /run/secrets/proxy_ca ]; then export GIT_SSL_CAINFO=/run/secrets/proxy_ca; fi
git init -q .
git remote add origin https://github.com/xormania/mago-serena_v2-poc.git
git fetch --no-tags --depth=1 origin "$revision"
git checkout --detach FETCH_HEAD
test "$(git rev-parse HEAD)" = "$revision"
printf '%s\n' "$revision" > /poc-source.sha
SH

FROM ${RUST_IMAGE} AS mago

ARG MAGO_BUILD_JOBS=4
WORKDIR /src
COPY --from=poc-source /poc/patches/mago-language-server-cargo.patch /poc/patches/mago-lsp-extensions.patch /patches/

# Apply the experimental server to the exact stable release. The Cargo patch
# reconciles their dependency metadata while keeping the release's versions.
RUN --mount=type=secret,id=proxy_ca <<'SH'
set -eu
mago=3de548f9607a8d8d071f6e0deb2a0023107b8848
lsp=53f32a871e5c226af855dc5579a48dba6bb13cbb
base=40f23211f1dd5714b6cd878b9752903f7cfd154d
if [ -s /run/secrets/proxy_ca ]; then export GIT_SSL_CAINFO=/run/secrets/proxy_ca; fi
git init -q .
git remote add origin https://github.com/carthage-software/mago.git
git fetch --no-tags --depth=1 origin "$mago" "$lsp" "$base"
git checkout --detach "$mago"
git diff --binary "$base" "$lsp" -- . ':!Cargo.toml' ':!Cargo.lock' > /patches/mago-language-server.patch
git apply /patches/mago-language-server.patch
git apply --unidiff-zero /patches/mago-language-server-cargo.patch
git apply /patches/mago-lsp-extensions.patch
printf '%s  %s\n' 576b972b9641d825ea1eaed473b9f7071c289b1bd86f76d1040836f082456a20 Cargo.lock | sha256sum -c -
mkdir /output
printf '%s\n' "$mago" > /output/mago-source.sha
printf '%s\n' "$lsp" > /output/mago-lsp-source.sha
printf '%s\n' "$base" > /output/mago-lsp-base.sha
SH

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    --mount=type=secret,id=proxy_ca <<'SH'
set -eu
if [ -s /run/secrets/proxy_ca ]; then export CARGO_HTTP_CAINFO=/run/secrets/proxy_ca; fi
cargo build --locked --release -p mago --bin mago -j "$MAGO_BUILD_JOBS"
install -m755 target/release/mago /output/mago
test "$(/output/mago --version)" = 'mago 1.60.2'
rustc --version > /output/rust-version.txt
mkdir -p /licenses/mago /licenses/cargo
cp LICENSE-APACHE LICENSE-MIT crates/prelude/assets/extensions/rdkafka.NOTICE Cargo.lock /licenses/mago/
find /usr/local/cargo/registry/src -type f \( -iname 'LICENSE*' -o -iname 'NOTICE*' -o -iname 'COPYING*' \) \
    -exec cp --parents '{}' /licenses/cargo/ \;
SH

FROM ${PYTHON_IMAGE} AS python
FROM ${UV_IMAGE} AS uv
FROM ${COMPOSER_IMAGE} AS composer
FROM ${PHP_IMAGE}

ARG PHP_IMAGE
ARG PYTHON_IMAGE
ARG UV_IMAGE
ARG COMPOSER_IMAGE
ARG RUST_IMAGE

# Install the PHP 8.4 extensions and Python/Composer runtime libraries from
# the signed Trixie package snapshot, with PHP modules built from PHP's source.
RUN <<'SH'
set -eu
snapshot=20261119T000000Z
sed -i \
    -e "s|^URIs: http://deb.debian.org/|URIs: https://snapshot.debian.org/archive/|" \
    -e "/^URIs:/s|$|/$snapshot/|" \
    -e '/^Suites:/i Check-Valid-Until: no' \
    /etc/apt/sources.list.d/debian.sources
apt-get update
apt-get install -y --no-install-recommends \
    git unzip libexpat1 libgdbm6t64 libicu76 libzip5 libicu-dev libzip-dev
docker-php-ext-install -j4 intl zip
apt-get purge -y --auto-remove libicu-dev libzip-dev
rm -rf /var/lib/apt/lists/*
printf '%s\n' "$snapshot" > /opt/debian-snapshot.txt
SH
COPY --from=python /usr/local/ /usr/local/
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
COPY --from=mago /output/mago /usr/local/bin/mago
COPY --from=mago /output/*.sha /output/rust-version.txt /opt/mago-serena-provider/
COPY --from=mago /licenses/ /opt/mago-serena-provider/licenses/
COPY --from=mago /patches/ /opt/mago-serena-provider/patches/
COPY --from=poc-source /poc-source.sha /opt/mago-serena-provider/
COPY --from=poc-source /poc/LICENSE /opt/mago-serena-provider/licenses/poc/LICENSE
COPY --from=poc-source /poc/patches/apply_serena.py /poc/patches/serena-symbol-references.patch /opt/mago-serena-provider/patches/
RUN install -d -m0755 /opt/mago-serena-provider/licenses/composer
ADD --checksum=sha256:7855ac293067aebe7e51afdd23b9dea54b8be24187dbecc9b9142581c37f596c --chmod=0644 https://raw.githubusercontent.com/composer/composer/12c820dbc3f030954b1d09f5884fcf1e9d29d6cb/LICENSE /opt/mago-serena-provider/licenses/composer/LICENSE

ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never
COPY --from=poc-source /poc/adapter /opt/adapter
WORKDIR /opt/provider
COPY pyproject.toml uv.lock identity.py ./
RUN --mount=type=bind,from=uv,source=/uv,target=/usr/local/bin/uv \
    --mount=type=secret,id=proxy_ca \
    --mount=type=cache,target=/root/.cache/uv <<'SH'
set -eu
if [ -s /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca GIT_SSL_CAINFO=/run/secrets/proxy_ca; fi
ldconfig
uv sync --locked --no-dev --no-editable --python /usr/local/bin/python3
/opt/venv/bin/python identity.py "$PHP_IMAGE" "$PYTHON_IMAGE" "$UV_IMAGE" "$COMPOSER_IMAGE" "$RUST_IMAGE" "$(uv --version)"
ln -s mago /usr/local/bin/mago-native
# Use the PoC adapter's manifest path so its pre-launch binary check stays active.
ln -s /opt/mago-serena-provider/identity.json /opt/toolchain-runtime.json
install -d -m1777 /state
SH

ENV PATH=/opt/venv/bin:$PATH HOME=/state SERENA_HOME=/state/serena \
    MAGO_EXPERIMENTAL_SERVER=1 PYTHONUNBUFFERED=1
WORKDIR /workspace
USER 1000:1000
CMD ["mago", "--version"]
