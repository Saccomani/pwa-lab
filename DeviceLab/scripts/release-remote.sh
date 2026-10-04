#!/usr/bin/env bash
set -euo pipefail

STAGE="${1:?Diretório temporário da publicação ausente}"
WEBROOT="/var/www/sacomani.com.br/pwa"

if [[ "$EUID" -ne 0 ]]; then
    echo "A cópia para $WEBROOT precisa de root ou sudo." >&2
    exit 1
fi
if [[ "$STAGE" != /tmp/devicelab-release-* || ! -s "$STAGE/index.html" ]]; then
    echo "A pasta temporária da publicação é inválida." >&2
    exit 1
fi
for required_file in service-worker.js service-worker-assets.js manifest.webmanifest; do
    if [[ ! -s "$STAGE/$required_file" ]]; then
        printf 'Artefato remoto ausente ou vazio: %s\n' "$required_file" >&2
        exit 1
    fi
done
if ! compgen -G "$STAGE/_framework/blazor.webassembly.*.js" >/dev/null || ! compgen -G "$STAGE/_framework/dotnet.native.*.wasm" >/dev/null; then
    echo "Arquivos de inicialização WebAssembly do SDK 10 ausentes no estágio." >&2
    exit 1
fi

# Copy the new assets first and index.html last so a running site keeps using
# its previous entry point until the complete optimized publish is in place.
# Existing files are preserved; this intentionally does not use rsync --delete.
if [[ -e "$WEBROOT/index.html" ]]; then
    if ! grep -Fq '<title>DeviceLab' "$WEBROOT/index.html"; then
        echo "Já existe um site diferente em $WEBROOT; cópia recusada para preservar esse conteúdo." >&2
        exit 1
    fi
elif [[ -d "$WEBROOT" ]] && find "$WEBROOT" -mindepth 1 \
    ! -path "$WEBROOT/.well-known" ! -path "$WEBROOT/.well-known/*" \
    -print -quit | grep -q .; then
    echo "A pasta $WEBROOT já contém conteúdo sem um index DeviceLab reconhecível; cópia recusada." >&2
    exit 1
fi

install -d -m 0755 "$WEBROOT"
if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude='/.well-known/' --exclude='/index.html' "$STAGE/" "$WEBROOT/"
else
    while IFS= read -r -d '' source_file; do
        relative_path="${source_file#"$STAGE"/}"
        [[ "$relative_path" == "index.html" || "$relative_path" == .well-known/* ]] && continue
        install -D -m 0644 "$source_file" "$WEBROOT/$relative_path"
    done < <(find "$STAGE" -type f -print0)
fi
install -m 0644 "$STAGE/index.html" "$WEBROOT/index.html"

# dotnet publish can leave _framework mode 0700 on macOS. rsync -a preserves
# that mode, which prevents Nginx's www-data user from traversing the files.
# Normalize only paths included in this release; leave .well-known untouched.
while IFS= read -r -d '' source_directory; do
    relative_path="${source_directory#"$STAGE"/}"
    [[ "$relative_path" == .well-known || "$relative_path" == .well-known/* ]] && continue
    chmod 0755 "$WEBROOT/$relative_path"
done < <(find "$STAGE" -mindepth 1 -type d -print0)
while IFS= read -r -d '' source_file; do
    relative_path="${source_file#"$STAGE"/}"
    [[ "$relative_path" == .well-known || "$relative_path" == .well-known/* ]] && continue
    chmod 0644 "$WEBROOT/$relative_path"
done < <(find "$STAGE" -type f -print0)
chmod 0755 "$WEBROOT"

for required_file in index.html service-worker.js service-worker-assets.js manifest.webmanifest; do
    if [[ ! -s "$WEBROOT/$required_file" ]]; then
        printf 'Arquivo não encontrado após a cópia: %s\n' "$WEBROOT/$required_file" >&2
        exit 1
    fi
done
if ! compgen -G "$WEBROOT/_framework/blazor.webassembly.*.js" >/dev/null || ! compgen -G "$WEBROOT/_framework/dotnet.native.*.wasm" >/dev/null; then
    echo "Arquivos de inicialização WebAssembly do SDK 10 ausentes após a cópia." >&2
    exit 1
fi
if ! grep -Fq '<title>DeviceLab' "$WEBROOT/index.html"; then
    echo "O index copiado não corresponde ao DeviceLab." >&2
    exit 1
fi

echo "Arquivos estáticos instalados em $WEBROOT. Nginx, Certbot e DNS não foram alterados."
