#!/bin/bash

# .env dosyasını yükle
if [ -f .env ]; then
  echo "📄 .env dosyası yükleniyor..."
  export $(cat .env | grep -v '^#' | xargs)
fi

# Gerekli environment değişkenlerini kontrol et
echo "Environment değişkenleri kontrol ediliyor..."

REQUIRED_VARS=(
  "NODE_ENV"
  "DATABASE_URL"
  "JWT_SECRET"
  "JWT_REFRESH_SECRET"
)

MISSING=0

for VAR in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!VAR}" ]; then
    echo "❌ Eksik: $VAR"
    MISSING=1
  else
    echo "✅ $VAR = ${!VAR:0:10}..."
  fi
done

if [ $MISSING -eq 1 ]; then
  echo "❌ Gerekli environment değişkenleri eksik"
  echo "💡 .env dosyasını kontrol et veya export et: export \$(cat .env | xargs)"
  exit 1
fi

echo "✅ Tüm gerekli environment değişkenleri ayarlandı"
