#!/bin/bash

# Backup script'i
BACKUP_DIR=${BACKUP_DIR:-./backups}
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME=${DB_NAME:-mentora}

# Backup dizinini oluştur
mkdir -p $BACKUP_DIR

echo "📦 Veritabanı backup alınıyor..."

# SQLite için
if [ -f "dev.db" ]; then
  cp dev.db $BACKUP_DIR/db_$DATE.db
  echo "✅ Backup alındı: $BACKUP_DIR/db_$DATE.db"
else
  echo "❌ Veritabanı dosyası bulunamadı"
  exit 1
fi

# Eski backup'ları temizle (30 günden eski)
find $BACKUP_DIR -name "db_*.db" -mtime +30 -delete

echo "✅ Backup tamamlandı!"
