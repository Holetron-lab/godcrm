# 🚀 Quick Start Guide - Business CRM

## 📋 Credentials

**Admin user:**
```
Email: gera69lvl@gmail.com
Password: admin123
Role: admin
```

**Existing businesses:**
- SIXTYNINE (ID: 1)
- HOLETRON (ID: 2)

---

## 🏃 Quick start

### 1. Start the server
```bash
cd /root/business-crm
node backend/server.js
```

### 2. Open in browser
```
http://localhost:5000
```

### 3. Log in
- Email: `gera69lvl@gmail.com`
- Password: `admin123`

---

## 🔧 Useful commands

### Server
```bash
# Start
cd /root/business-crm && node backend/server.js

# In the background
cd /root/business-crm && node backend/server.js &

# Stop
pkill -f "node server.js"

# Check status
curl http://localhost:5000/api/health
```

### Database
```bash
# Location
/var/lib/business-crm-data/crm.db

# View
sqlite3 /var/lib/business-crm-data/crm.db

# Backup
cp /var/lib/business-crm-data/crm.db \
   /var/lib/business-crm-data/crm.db.backup-$(date +%Y%m%d)
```

### Password reset
```bash
cd /root/business-crm/backend
node reset-password.js <email> <new-password>

# Example
node reset-password.js gera69lvl@gmail.com newpass123
```

---

## 📡 API Endpoints

### Authentication
```bash
# Login
POST /api/auth/login
Body: {"email": "...", "password": "..."}

# Get current user
GET /api/auth/me
Header: Authorization: Bearer <token>
```

### Businesses
```bash
# List businesses
GET /api/businesses
Header: Authorization: Bearer <token>

# Create business
POST /api/businesses
Body: {"name": "...", "description": "..."}

# Update business
PUT /api/businesses/:id

# Delete business
DELETE /api/businesses/:id
```

### Database Integrations (NEW!)
```bash
# Detect database type
POST /api/integrations/detect-database-type
Body: {"path": "localhost:3306"}

# Test connection
POST /api/integrations/test-direct-connection
Body: {
  "type": "mysql2",
  "host": "localhost",
  "port": 3306,
  "database": "neometal",
  "user": "root",
  "password": ""
}

# Discover schema
POST /api/integrations/discover-schema-direct
Body: {...same as test-connection...}

# List all integrations
GET /api/integrations/list
Header: Authorization: Bearer <token>
```

---

## 🗂️ Project structure

```
/root/business-crm/
├── backend/
│   ├── server.js                    # Entry point
│   ├── database/
│   │   └── init.js                  # DB initialization
│   ├── routes/
│   │   ├── auth.js
│   │   ├── business.js
│   │   ├── integrations.js          # NEW!
│   │   └── ...
│   ├── services/
│   │   ├── DatabaseTypeDetector.js  # NEW!
│   │   └── DirectDatabaseConnector.js # NEW!
│   └── middleware/
│       └── auth.js
├── src/                             # Frontend
│   ├── components/
│   │   ├── Integrations/            # NEW!
│   │   │   ├── DirectConnectionForm.jsx
│   │   │   └── DirectConnectionForm.css
│   │   └── ...
│   └── ...
├── .env                             # Environment config
├── package.json
└── docs/
    ├── IMPLEMENTATION-COMPLETE.md
    ├── DATABASE-MIGRATION.md
    └── BUGFIX-REACT-ERRORS.md
```

---

## 📊 Database

**Location:** `/var/lib/business-crm-data/crm.db`

**Tables:**
- `users` - Users
- `businesses` - Businesses
- `employees` - Employees
- `employee_businesses` - Employee-to-business relationships
- `services` - Services/passwords
- `modules` - CRM modules
- `module_permissions` - Access permissions
- `audit_log` - Action audit
- `employee_invitations` - Employee invitations

---

## 🔍 Debugging

### Server logs
```bash
# Run with logs
cd /root/business-crm && node backend/server.js

# Logs to a file
cd /root/business-crm && node backend/server.js > server.log 2>&1 &
tail -f server.log
```

### Port checks
```bash
# Which process is using port 5000
lsof -i:5000

# Kill the process on port 5000
lsof -ti:5000 | xargs kill -9
```

### Database check
```bash
sqlite3 /var/lib/business-crm-data/crm.db "
  SELECT 'Users:' as info, COUNT(*) as count FROM users
  UNION ALL
  SELECT 'Businesses:', COUNT(*) FROM businesses
  UNION ALL
  SELECT 'Employees:', COUNT(*) FROM employees
  UNION ALL
  SELECT 'Services:', COUNT(*) FROM services;
"
```

---

## 🎯 What works

✅ JWT authentication  
✅ Business management  
✅ Employee management  
✅ Password Manager (with encryption)  
✅ Modules and access permissions  
✅ **NEW:** Direct Database Connection (MySQL/PostgreSQL/SQLite)  
✅ **NEW:** Schema Discovery  
✅ **NEW:** Database Type Auto-detection  

---

## 📚 Documentation

- [IMPLEMENTATION-COMPLETE.md](./docs/IMPLEMENTATION-COMPLETE.md) - Full Direct Connection implementation
- [DATABASE-MIGRATION.md](./docs/DATABASE-MIGRATION.md) - DB migration to /var/lib
- [BUGFIX-REACT-ERRORS.md](./docs/BUGFIX-REACT-ERRORS.md) - React error fixes
- [PROMPT-DIRECT-CONNECTION.md](./docs/PROMPT-DIRECT-CONNECTION.md) - Direct Connection architecture
- [PROMPT-DEVELOPER.md](./docs/PROMPT-DEVELOPER.md) - Developer guide

---

## 🚀 Done!

The system is fully configured and ready to use!

**Next steps:**
1. Log in to the system
2. Check the businesses
3. Add an integration with an external DB (via /integrations)
4. Set up data synchronization

**Good luck! 🎉**
