# 🧪 MASTER TEST SUMMARY REPORT v2.0

## Run Information
- **Run ID:** `1767887478485-rgyyts`
- **Start Time:** 2026-01-08T15:51:18.485Z
- **End Time:** 2026-01-08T15:51:23.361Z
- **Environment:** https://devcrm.hltrn.cc/api/v3

---

## 📊 Coverage Summary

| Metric | Value |
|--------|-------|
| **Total Endpoints** | 124 |
| **Tested** | 70 (56%) |
| **Passed** | 225 |
| **Failed** | 2 |

### Coverage by Category

| Category | Total | Tested | Coverage |
|----------|-------|--------|----------|
| auth | 19 | 4 | 21% |
| spaces | 8 | 7 | 88% |
| projects | 4 | 4 | 100% |
| tables | 15 | 9 | 60% |
| widgets | 11 | 11 | 100% |
| documents | 12 | 5 | 42% |
| folders | 5 | 5 | 100% |
| files | 8 | 0 | 0% |
| api-keys | 5 | 5 | 100% |
| webhooks | 6 | 5 | 83% |
| user-settings | 4 | 3 | 75% |
| ai-agents | 13 | 7 | 54% |
| data-sources | 9 | 1 | 11% |
| schema | 4 | 3 | 75% |
| batch | 1 | 1 | 100% |

---

## 👤 Test Owner
| Field | Value |
|-------|-------|
| Email | `testowner@hltrn.cc` |
| User ID | `428` |

---

## 👥 Created Users (4)

| Email | Name | Role | Space Role | Password |
|-------|------|------|------------|----------|
| `admin-1767887478965-b0mje9@test.godcrm.local` | Admin 1767887478965-b0mje9 | admin | admin | `TestPass123!` |
| `manager-1767887479165-pcfge6@test.godcrm.local` | Manager 1767887479165-pcfge6 | user | editor | `TestPass123!` |
| `employee-1767887479360-h2hiij@test.godcrm.local` | Employee 1767887479360-h2hiij | user | editor | `TestPass123!` |
| `viewer-1767887479604-mfzjit@test.godcrm.local` | Viewer 1767887479604-mfzjit | viewer | viewer | `TestPass123!` |

---

## 📈 Created Entities

| Entity | Count |
|--------|-------|
| Spaces | 5 |
| Projects | 3 |
| Tables | 4 |
| Rows | 48 |
| Widgets | 15 |
| Dashboards | 4 |
| Documents | 1 |
| Folders | 1 |
| API Keys | 0 |
| Webhooks | 0 |

---

## ❌ Errors (0)

✅ No errors!

---

## 🔍 Endpoint Results

### ✅ Passed Endpoints (225)

| Method | Path | Status | Duration |
|--------|------|--------|----------|
| POST | `/auth/login` | 200 | 176ms |
| GET | `/auth/me` | 200 | 19ms |
| GET | `/auth/profile` | 200 | 3ms |
| PATCH | `/auth/profile` | 200 | 11ms |
| GET | `/spaces` | 200 | 15ms |
| POST | `/spaces` | 201 | 205ms |
| GET | `/spaces/:id` | 200 | 4ms |
| PUT | `/spaces/:id` | 200 | 10ms |
| GET | `/spaces/:spaceId/schema` | 200 | 10ms |
| POST | `/spaces/:id/data-sources-project` | 200 | 4ms |
| POST | `/spaces/:id/users-table` | 200 | 4ms |
| POST | `/spaces/:id/roles-table` | 200 | 4ms |
| GET | `/projects` | 200 | 5ms |
| POST | `/projects` | 201 | 11ms |
| PUT | `/projects/:id` | 200 | 13ms |
| GET | `/projects/:projectId/tables` | 200 | 5ms |
| GET | `/projects/:projectId/dashboard` | 200 | 11ms |
| GET | `/projects/:projectId/widgets` | 200 | 5ms |
| POST | `/projects/:projectId/documents/init` | 201 | 132ms |
| GET | `/projects/:projectId/documents` | 200 | 9ms |
| GET | `/projects/:projectId/folders` | 200 | 7ms |
| POST | `/projects/:projectId/folders` | 201 | 16ms |
| GET | `/projects/:projectId/webhooks` | 200 | 9ms |
| POST | `/projects` | 201 | 13ms |
| PUT | `/projects/:id` | 200 | 10ms |
| GET | `/projects/:projectId/tables` | 200 | 4ms |
| GET | `/projects/:projectId/dashboard` | 200 | 13ms |
| GET | `/projects/:projectId/widgets` | 200 | 5ms |
| POST | `/projects/:projectId/documents/init` | 201 | 172ms |
| GET | `/projects/:projectId/documents` | 200 | 13ms |
| GET | `/projects/:projectId/folders` | 200 | 9ms |
| POST | `/projects/:projectId/folders` | 201 | 15ms |
| GET | `/projects/:projectId/webhooks` | 200 | 8ms |
| POST | `/projects` | 201 | 10ms |
| PUT | `/projects/:id` | 200 | 11ms |
| GET | `/projects/:projectId/tables` | 200 | 4ms |
| GET | `/projects/:projectId/dashboard` | 200 | 11ms |
| GET | `/projects/:projectId/widgets` | 200 | 5ms |
| POST | `/projects/:projectId/documents/init` | 201 | 131ms |
| GET | `/projects/:projectId/documents` | 200 | 9ms |
| GET | `/projects/:projectId/folders` | 200 | 7ms |
| POST | `/projects/:projectId/folders` | 201 | 14ms |
| GET | `/projects/:projectId/webhooks` | 200 | 9ms |
| POST | `/projects` | 201 | 13ms |
| PUT | `/projects/:id` | 200 | 11ms |
| GET | `/projects/:projectId/tables` | 200 | 5ms |
| GET | `/projects/:projectId/dashboard` | 200 | 11ms |
| GET | `/projects/:projectId/widgets` | 200 | 4ms |
| POST | `/projects/:projectId/documents/init` | 201 | 124ms |
| GET | `/projects/:projectId/documents` | 200 | 9ms |

... and 175 more

### ❌ Failed Endpoints (2)

| Method | Path | Status | Duration |
|--------|------|--------|----------|
| POST | `/relations` | 500 | 9ms |
| DELETE | `/documents/:documentId` | 400 | 9ms |

### ⏳ Not Tested Endpoints

- `POST /auth/register` (auth)
- `POST /auth/logout` (auth)
- `POST /auth/refresh` (auth)
- `PATCH /auth/password` (auth)
- `PATCH /auth/email` (auth)
- `POST /auth/2fa/setup` (auth)
- `POST /auth/2fa/verify` (auth)
- `DELETE /auth/2fa` (auth)
- `POST /auth/forgot-password` (auth)
- `GET /auth/verify-reset-token/:token` (auth)
- `POST /auth/reset-password` (auth)
- `GET /auth/google/config` (auth)
- `GET /auth/google/auth-url` (auth)
- `POST /auth/google/callback` (auth)
- `POST /auth/google/config` (auth)
- `DELETE /spaces/:id` (spaces)
- `POST /tables/create-calendar` (tables)
- `PUT /tables/:tableId/rows/:rowId` (tables)
- `DELETE /tables/:tableId/rows/:rowId` (tables)
- `POST /tables/:tableId/connect` (tables)
- `POST /tables/:tableId/rows/batch-update` (tables)
- `POST /tables/:tableId/rows/batch-delete` (tables)
- `POST /documents/:documentId/import-v4` (documents)
- `POST /projects/:projectId/documents/add-language` (documents)
- `POST /documents/import` (documents)
- `GET /documents/:documentId/export` (documents)
- `PUT /documents/:documentId/structure` (documents)
- `POST /documents/:documentId/rebuild-structure` (documents)
- `POST /documents/setup-columns` (documents)
- `POST /files/upload` (files)
- `GET /files` (files)
- `GET /files/:fileId` (files)
- `DELETE /files/:fileId` (files)
- `GET /storage-providers` (files)
- `POST /storage-providers` (files)
- `PUT /storage-providers/:providerId` (files)
- `DELETE /storage-providers/:providerId` (files)
- `POST /incoming/:token` (webhooks)
- `DELETE /user-settings/spaces-order` (user-settings)
- `POST /ai/run` (ai-agents)
- `POST /ai/chat` (ai-agents)
- `POST /ai/process-prompt` (ai-agents)
- `POST /ai/providers/:providerId/refresh-models` (ai-agents)
- `PUT /ai/providers/:providerId` (ai-agents)
- `GET /ai/providers/:providerId/models` (ai-agents)
- `GET /data-sources/:id` (data-sources)
- `POST /data-sources` (data-sources)
- `PUT /data-sources/:id` (data-sources)
- `DELETE /data-sources/:id` (data-sources)
- `POST /data-sources/:id/test` (data-sources)
- `GET /data-sources/:id/tables` (data-sources)
- `GET /data-sources/:id/tables/:tableName/columns` (data-sources)
- `POST /data-sources/:id/import` (data-sources)
- `POST /spaces/:spaceId/schema/tables` (schema)

---

## 🧹 Cleanup Command

```bash
./tests/scripts/run-scenarios.sh cleanup dev --email testowner@hltrn.cc --password testpass123!
```

---

*Generated by Master Test Scenario v2.0*

---

## 🐛 Known Backend Issues

### 1. POST `/relations` - 500 Internal Server Error
**Cause:** The code uses `name` instead of `column_name` in the SQL query
```sql
SELECT * FROM table_columns WHERE table_id = ? AND name = ?
```
**Fix:** Replace `name` with `column_name` in `backend/routes/v3/schema.js`

### 2. Document v3/v4 API Incompatibility
**Problem:** `GET /documents/:documentId/export` and `PUT /documents/:documentId/structure` 
require `documents_table_id` and `sections_table_id`, but `POST /documents/init` v4 
returns `registry_table_id` and `atoms_table_id`.

**Solution:** Update the export/structure endpoints to support the v4 format, or create separate v4 endpoints.

---

## 📝 Untested Categories

### Files (0% - 8 endpoints)
Requires implementing file upload in the test (multipart/form-data)

### Auth (21% - 15 untested)
Most endpoints require special setup:
- 2FA (setup, verify, disable)
- Google OAuth (config, callback)
- Password reset (forgot, verify-token, reset)
- Register (conflicts with cleanup)
- Logout, Refresh

### Data Sources (11% - 8 untested)
Requires an external MySQL database for full testing

