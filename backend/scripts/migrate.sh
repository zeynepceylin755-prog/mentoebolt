#!/bin/bash

echo "📦 Veritabanı migration'ları çalıştırılıyor..."

# Prisma migration'larını çalıştır
npx prisma migrate deploy

if [ $? -eq 0 ]; then
  echo "✅ Migration başarılı"
else
  echo "❌ Migration başarısız"
  exit 1
fi
