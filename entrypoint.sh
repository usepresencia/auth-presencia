#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
    echo "DATABASE_URL não definida."
    exit 1
fi

echo "Aplicando migrations pendentes..."
npx --no-install prisma migrate deploy

exec "$@"
