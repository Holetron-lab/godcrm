#!/bin/bash
# Deploy script for Business CRM production

set -e

echo "🚀 Starting Business CRM deployment..."

# Build frontend
echo "📦 Building frontend..."
cd /root/prod/business-crm
npm run build

# Copy files to web directory
echo "📁 Copying files to /var/www/business-crm/dist/..."
mkdir -p /var/www/business-crm/dist
rm -rf /var/www/business-crm/dist/*
cp -r /root/prod/business-crm/dist/* /var/www/business-crm/dist/
chown -R www-data:www-data /var/www/business-crm/

# Reload nginx
echo "🔄 Reloading nginx..."
systemctl reload nginx

# Restart backend (in case of code changes)
echo "🔄 Restarting backend..."
systemctl restart business-crm-backend

# Wait for backend to start
sleep 3

# Check backend status
echo "✅ Checking backend status..."
systemctl status business-crm-backend --no-pager | head -5

echo ""
echo "✅ Deployment complete!"
echo "🌐 Site: https://crm.hltrn.cc"
echo "📊 Backend logs: journalctl -u business-crm-backend -f"
