#!/bin/bash

# Health check script'i
HOST=${1:-localhost}
PORT=${2:-3000}

# Health endpoint'ini kontrol et
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://$HOST:$PORT/health)

if [ "$RESPONSE" -eq 200 ]; then
  echo "✅ Health check başarılı"
  exit 0
else
  echo "❌ Health check başarısız (HTTP $RESPONSE)"
  exit 1
fi
