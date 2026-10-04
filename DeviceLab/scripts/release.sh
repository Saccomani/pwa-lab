#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

# Builds the optimized Blazor PWA and uploads its static files. This script
# does not configure Nginx, Certbot, DNS, or any external service.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PROJECT_FILE="$PROJECT_DIR/DeviceLab.csproj"
REMOTE_SCRIPT="$SCRIPT_DIR/release-remote.sh"
REMOTE_DIR="/var/www/sacomani.com.br/pwa"

: "${SSH_HOST:?Defina SSH_HOST no ambiente}"
: "${SSH_USER:?Defina SSH_USER no ambiente}"
: "${SSH_PASS:?Defina SSH_PASS no ambiente}"

for command_name in dotnet ssh sshpass scp tar; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        printf 'Comando necessário não encontrado: %s\n' "$command_name" >&2
        exit 1
    fi
done

if [[ "$SSH_HOST" == -* || ! "$SSH_HOST" =~ ^[A-Za-z0-9._:-]+$ ]]; then
    echo "SSH_HOST deve ser um hostname ou endereço IP simples." >&2
    exit 1
fi
if [[ ! "$SSH_USER" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "SSH_USER deve conter apenas letras, números, ponto, hífen ou sublinhado." >&2
    exit 1
fi
if [[ "$SSH_PASS" == *$'\n'* || "$SSH_PASS" == *$'\r'* ]]; then
    echo "SSH_PASS não pode conter quebras de linha." >&2
    exit 1
fi
if [[ ! -f "$PROJECT_FILE" || ! -f "$REMOTE_SCRIPT" ]]; then
    echo "Projeto ou script remoto não encontrado; execute este arquivo dentro do projeto DeviceLab." >&2
    exit 1
fi

SSH_TARGET="$SSH_USER@$SSH_HOST"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
REMOTE_STAGE="/tmp/devicelab-release-$RELEASE_ID"
REMOTE_SCRIPT_PATH="/tmp/devicelab-release-remote-$RELEASE_ID.sh"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/devicelab-release.XXXXXX")"
PUBLISH_DIR="$TEMP_DIR/publish"
PUBLISH_WEBROOT="$PUBLISH_DIR/wwwroot"
REMOTE_STAGE_CREATED=0

ssh_command() {
    SSHPASS="$SSH_PASS" sshpass -e ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=yes "$@"
}

cleanup() {
    local status=$?
    if [[ "$REMOTE_STAGE_CREATED" == 1 ]]; then
        ssh_command -T "$SSH_TARGET" "rm -rf -- '$REMOTE_STAGE' '$REMOTE_SCRIPT_PATH'" >/dev/null 2>&1 || true
    fi
    rm -rf -- "$TEMP_DIR"
    exit "$status"
}
trap cleanup EXIT

echo "Gerando a publicação Release do Blazor WebAssembly…"
dotnet publish "$PROJECT_FILE" -c Release -o "$PUBLISH_DIR"
for required_file in index.html service-worker.js service-worker-assets.js manifest.webmanifest; do
    if [[ ! -s "$PUBLISH_WEBROOT/$required_file" ]]; then
        printf 'Artefato de publicação ausente ou vazio: %s\n' "$required_file" >&2
        exit 1
    fi
done
if ! compgen -G "$PUBLISH_WEBROOT/_framework/blazor.webassembly.*.js" >/dev/null || ! compgen -G "$PUBLISH_WEBROOT/_framework/dotnet.native.*.wasm" >/dev/null; then
    echo "Arquivos de inicialização WebAssembly do SDK 10 ausentes na publicação." >&2
    exit 1
fi
if ! grep -Fq '<base href="/"' "$PUBLISH_WEBROOT/index.html" || ! grep -Fq '<title>DeviceLab' "$PUBLISH_WEBROOT/index.html"; then
    echo "O index publicado não parece ser o DeviceLab na raiz do domínio." >&2
    exit 1
fi

echo "Enviando arquivos para ${REMOTE_DIR}…"
ssh_command -T "$SSH_TARGET" "mkdir -m 700 -- '$REMOTE_STAGE'"
REMOTE_STAGE_CREATED=1
COPYFILE_DISABLE=1 tar -C "$PUBLISH_WEBROOT" -czf - . | ssh_command -T "$SSH_TARGET" "tar -xzf - -C '$REMOTE_STAGE'"
SSHPASS="$SSH_PASS" sshpass -e scp -q -o ConnectTimeout=15 -o StrictHostKeyChecking=yes "$REMOTE_SCRIPT" "$SSH_TARGET:$REMOTE_SCRIPT_PATH"

REMOTE_UID="$(ssh_command -T "$SSH_TARGET" "id -u" | tr -d '\r\n')"
if [[ "$REMOTE_UID" == 0 ]]; then
    ssh_command -T "$SSH_TARGET" "/bin/bash '$REMOTE_SCRIPT_PATH' '$REMOTE_STAGE'"
else
    printf '%s\n' "$SSH_PASS" | ssh_command -T "$SSH_TARGET" \
        "sudo -S -p '' /bin/bash '$REMOTE_SCRIPT_PATH' '$REMOTE_STAGE'"
fi

echo "Arquivos Release copiados e verificados em ${REMOTE_DIR}."
echo "Este script não configura nem verifica Nginx, Certbot, DNS ou HTTPS."
