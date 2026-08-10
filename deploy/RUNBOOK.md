# GOD CRM — Deployment Runbook

> ADR-064 Phase 3, Task 13 | Last updated: 2026-01-31

---

## 1. Pre-Deploy Checklist

- [ ] All tests pass: `npm test -- --run`
- [ ] Build succeeds: `npm run build`
- [ ] TypeScript checks: `npx tsc --noEmit`
- [ ] Environment variables set (see `backend/.env.example`)
- [ ] Database backup taken: `pg_dump godcrm_prod > /root/backups/godcrm-$(date +%Y%m%d-%H%M).sql`
- [ ] No secrets in codebase: `grep -r "sk-proj\|GOCSPX" backend/` returns 0

---

## 2. Environments

| Env | URL | Branch | Port | DB | Directory |
|-----|-----|--------|------|----|-----------|
| PROD | https://crm.hltrn.cc | `main` | 5000 | `godcrm_prod` | `/root/prod/business-crm` |
| DEV | https://devcrm.hltrn.cc | `develop` | 5001 | `godcrm` | `/root/workspace/business-crm` |

---

## 3. Deploy to DEV

```bash
cd /root/workspace/business-crm
git pull origin develop
npm ci
npm run build

# Copy frontend
rm -rf /var/www/business-crm-dev/dist/*
cp -r dist/* /var/www/business-crm-dev/dist/
chown -R www-data:www-data /var/www/business-crm-dev/dist/

# Restart backend
systemctl restart business-crm-dev
systemctl status business-crm-dev

# Verify
curl -s https://devcrm.hltrn.cc/api/health | jq .
```

---

## 4. Deploy to PROD

```bash
# 1. Backup database FIRST
pg_dump godcrm_prod > /root/backups/godcrm-$(date +%Y%m%d-%H%M).sql

# 2. Pull and build
cd /root/prod/business-crm
git pull origin main
npm ci --production
npm run build

# 3. Copy frontend
rm -rf /var/www/business-crm/dist/*
cp -r dist/* /var/www/business-crm/dist/
chown -R www-data:www-data /var/www/business-crm/dist/

# 4. Restart backend
systemctl restart business-crm
systemctl status business-crm

# 5. Verify
curl -s https://crm.hltrn.cc/api/health | jq .
```

---

## 5. Rollback Procedure

### Backend Rollback
```bash
cd /root/prod/business-crm
git log --oneline -5           # Find last good commit
git checkout <commit-hash>     # Revert to good commit
npm ci --production
systemctl restart business-crm
```

### Database Rollback
```bash
# Stop backend first
systemctl stop business-crm

# Restore from backup
psql -U godcrm -d godcrm_prod < /root/backups/godcrm-YYYYMMDD-HHMM.sql

# Restart
systemctl start business-crm
```

### Frontend-Only Rollback
```bash
# If only frontend broke, restore from previous build
cd /root/prod/business-crm
git checkout HEAD~1 -- dist/
cp -r dist/* /var/www/business-crm/dist/
chown -R www-data:www-data /var/www/business-crm/dist/
```

---

## 6. Monitoring Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/health` | None | Basic health (status, version, uptime, DB) |
| `GET /api/health/deep` | Admin | Full system status (DB pool, memory, disk) |

### Health Check Commands
```bash
# Basic health
curl -s https://crm.hltrn.cc/api/health | jq .

# Deep health (requires admin token)
curl -s -H "Authorization: Bearer $TOKEN" https://crm.hltrn.cc/api/health/deep | jq .
```

---

## 7. Log Locations

| Service | Log Path | Rotation |
|---------|----------|----------|
| Backend (Pino) | `journalctl -u business-crm` | systemd journal |
| Nginx access | `/var/log/nginx/crm.hltrn.cc.access.log` | logrotate daily |
| Nginx error | `/var/log/nginx/crm.hltrn.cc.error.log` | logrotate daily |
| PostgreSQL | `/var/log/postgresql/postgresql-16-main.log` | logrotate weekly |

### Useful Log Commands
```bash
# Live backend logs
journalctl -u business-crm -f

# Last 100 errors
journalctl -u business-crm --since "1 hour ago" -p err

# Nginx errors
tail -f /var/log/nginx/crm.hltrn.cc.error.log
```

---

## 8. Database Backup Schedule

| Type | Frequency | Retention | Script |
|------|-----------|-----------|--------|
| Daily | 02:00 MSK | 7 days | cron: `pg_dump godcrm_prod > /root/backups/daily/` |
| Manual | On demand | 30 days | `POST /api/v3/system/backups/create` (admin) |

### Cron Entry
```cron
0 2 * * * pg_dump -U godcrm godcrm_prod --compress=6 -f /root/backups/daily/godcrm_$(date +\%Y\%m\%d).sql && find /root/backups/daily/ -name "*.sql" -mtime +7 -delete
```

---

## 9. Emergency Contacts

| Role | Contact |
|------|---------|
| System Admin | Check server via SSH |
| Database | PostgreSQL on localhost:5432 |

### Emergency Commands
```bash
# Check if backend is running
systemctl status business-crm

# Check if nginx is running
systemctl status nginx

# Check PostgreSQL
pg_isready -U godcrm

# Check disk space
df -h /

# Check memory
free -m

# Kill runaway process
systemctl restart business-crm
```

---

## 10. Required Environment Variables

See `backend/.env.example` for full list. Critical ones:

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | `production` or `development` |
| `JWT_SECRET` | Yes | Min 64 chars, random |
| `MASTER_ENCRYPTION_KEY` | Yes | 64 hex chars for AES-256 |
| `POSTGRES_PASSWORD` | Yes | DB password |
| `CORS_ORIGINS` | Prod only | Comma-separated allowed origins |
| `OPENAI_API_KEY` | Optional | For AI features |
| `SMTP_*` | Optional | For email features |
