# E2E Testing Guide - Business CRM

## 📋 Overview

A complete suite of E2E tests for verifying frontend functionality in conjunction with the backend.

**The tests cover:**
- ✅ Tables CRUD (creating, editing, deleting tables, columns, rows)
- ✅ Widgets & Dashboards (HTML widgets with project variables, drag-and-drop)
- ✅ Spaces & Projects (spaces, navigation, aggregation)
- ✅ Full Integration (complete user journey from registration to widgets)

---

## 🚀 Quick Start

### 1. Prerequisites

```bash
# Install Playwright (if not already installed)
npm install -D @playwright/test
npx playwright install
```

### 2. Start Servers

**Terminal 1 - Backend:**
```bash
cd /root/business-crm
node backend/server.js
```

**Terminal 2 - Frontend:**
```bash
cd /root/business-crm
npm run dev
```

### 3. Run Tests

**All tests:**
```bash
npm run test:e2e
```

**Specific test suite:**
```bash
# Tables only
npx playwright test tables.spec.ts

# Widgets only
npx playwright test widgets.spec.ts

# Spaces only
npx playwright test spaces.spec.ts

# Integration only
npx playwright test integration.spec.ts
```

**Headed mode (with UI):**
```bash
npx playwright test --headed
```

**Debug mode:**
```bash
npx playwright test --debug
```

**Specific browser:**
```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

---

## 📂 Test Structure

```
src/tests/e2e/
├── helpers.ts           # Helper functions (login, API calls)
├── tables.spec.ts       # 10 tests for Tables CRUD
├── widgets.spec.ts      # 12 tests for Widgets & Dashboards
├── spaces.spec.ts       # 10 tests for Spaces & Projects
└── integration.spec.ts  # 5 comprehensive integration tests
```

---

## 🧪 Test Cases

### Tables Tests (10 tests)

| ID | Test Case | Description |
|----|-----------|-------------|
| TC-01 | Create new table | Creating a table through the UI |
| TC-02 | Open existing table | Opening a table from the list |
| TC-03 | Add column to table | Adding a column |
| TC-04 | Add multiple columns | Adding columns of various types (email, phone, select, checkbox) |
| TC-05 | Add row to table | Adding a row with data |
| TC-06 | Edit cell value | Editing a cell value |
| TC-07 | Delete row | Deleting a row |
| TC-08 | Delete column | Deleting a column |
| TC-09 | Rename table | Renaming a table |
| TC-10 | Delete table | Deleting a table |

### Widgets Tests (12 tests)

| ID | Test Case | Description |
|----|-----------|-------------|
| WD-01 | Create HTML widget | Widget with project variables ({{project.name}}) |
| WD-02 | Edit widget config | Editing widget settings |
| WD-03 | Widget with CSS | Widget with custom styles |
| WD-04 | Widget with JS | Interactive widget (buttons, counter) |
| WD-05 | Table visualization | Widget displaying a table |
| WD-06 | Move widget | Moving a widget via drag-and-drop |
| WD-07 | Resize widget | Resizing a widget |
| WD-08 | Delete widget | Deleting a widget |
| WD-09 | Create dashboard | Creating a new dashboard |
| WD-10 | Switch dashboards | Switching between dashboards |
| WD-11 | Variable interpolation | Verifying interpolation of {{user.name}}, {{project.*}} |
| WD-12 | Chart widget | Chart/diagram (if implemented) |

### Spaces Tests (10 tests)

| ID | Test Case | Description |
|----|-----------|-------------|
| SP-01 | View spaces list | Viewing the list of spaces |
| SP-02 | Create new space | Creating a space (Business/Personal/Admin) |
| SP-03 | Switch spaces | Switching between spaces |
| SP-04 | Create project in space | Creating a project within a space |
| SP-05 | Theme customization | Configuring theme colors (primary/secondary/tertiary) |
| SP-06 | Space dashboard | Viewing the space dashboard |
| SP-07 | Navigate to project | Navigating to a project from a space |
| SP-08 | Owner space visibility | Admin Owner's Space visible only to the owner |
| SP-09 | Space aggregation | Aggregating data from multiple projects |
| SP-10 | Delete space | Deleting a space |

### Integration Tests (5 tests)

| ID | Test Case | Description |
|----|-----------|-------------|
| INT-01 | Complete user journey | Registration → Space → Project → Table → Data → Widget |
| INT-02 | Backend-Frontend sync | Verifying API responses, data persistence |
| INT-03 | Multi-user collab | Collaborative work (skipped for now) |
| INT-04 | Performance - 100 rows | Creating and rendering 100 rows |
| INT-05 | Error handling | Form validation, error handling |

---

## 🎯 Test Data Isolation

Each test creates a unique user:
```typescript
const TEST_USER = {
  email: `test-${Date.now()}@test.com`, // Unique
  password: 'Test123!@#',
  name: 'Test User'
};
```

This guarantees isolation and prevents conflicts between tests.

---

## 📊 Expected Results

### Success Criteria

- **All tests GREEN:** 37+ tests passing
- **Coverage:** All major user flows covered
- **Performance:** Tests complete in < 5 minutes
- **No flaky tests:** 100% stability

### Test Execution Time

- **Tables:** ~2 minutes (10 tests)
- **Widgets:** ~3 minutes (12 tests)
- **Spaces:** ~2 minutes (10 tests)
- **Integration:** ~3 minutes (5 tests)

**Total:** ~10 minutes for all tests

---

## 🐛 Troubleshooting

### Tests fail with "Cannot find element"

**Cause:** Frontend components do not have `data-testid` attributes.

**Solution:** Add `data-testid` to the components:
```tsx
<button data-testid="create-table-btn">Create Table</button>
<div data-testid="table-item">{table.name}</div>
```

### Tests timeout

**Cause:** Backend/Frontend are not running or respond slowly.

**Solution:**
```bash
# Check that the servers are running
lsof -i :5000  # Backend
lsof -i :5173  # Frontend

# Increase the timeout in playwright.config.ts
use: {
  timeout: 30000 // 30 seconds
}
```

### API returns 401 Unauthorized

**Cause:** Auth token is not set or has expired.

**Solution:** Check the `login()` function in `helpers.ts` and make sure the token is saved to localStorage.

### Widget variables not interpolated

**Cause:** The backend does not implement interpolation of `{{project.name}}` variables.

**Solution:** Implement middleware to replace the variables:
```javascript
function interpolateVariables(html, context) {
  return html.replace(/\{\{(.+?)\}\}/g, (match, key) => {
    return context[key] || match;
  });
}
```

---

## 📝 Adding New Tests

### 1. Create test file

```bash
touch src/tests/e2e/my-feature.spec.ts
```

### 2. Template

```typescript
import { test, expect } from '@playwright/test';
import { login, createTestUser } from './helpers';

const TEST_USER = {
  email: `my-test-${Date.now()}@test.com`,
  password: 'Test123!',
  name: 'Test User'
};

test.describe('My Feature Tests', () => {
  test.beforeEach(async ({ page }) => {
    await createTestUser(TEST_USER.email, TEST_USER.password, TEST_USER.name);
    await login(page, TEST_USER.email, TEST_USER.password);
  });

  test('MF-01: Should do something', async ({ page }) => {
    await page.click('[data-testid="my-button"]');
    await expect(page.locator('text=Success')).toBeVisible();
  });
});
```

### 3. Run

```bash
npx playwright test my-feature.spec.ts
```

---

## 🎬 CI/CD Integration

### GitHub Actions

```yaml
name: E2E Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npx playwright install --with-deps
      - run: npm run build
      - run: node backend/server.js &
      - run: npm run dev &
      - run: npm run test:e2e
```

---

## 📚 Resources

- [Playwright Documentation](https://playwright.dev)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Tests](https://playwright.dev/docs/debug)

---

## ✅ Checklist Before Running Tests

- [ ] Backend server running (port 5000)
- [ ] Frontend dev server running (port 5173)
- [ ] Database is clean or a test database
- [ ] Playwright installed (`npx playwright install`)
- [ ] No other tests that could create conflicts
- [ ] `.env` file configured correctly

---

## 🎯 Next Steps

1. **Start the backend and frontend**
2. **Run the tests:** `npm run test:e2e`
3. **Check the results:** `npx playwright show-report`
4. **Fix failing tests** (add data-testid, implement functionality)
5. **Add missing tests** as new features are implemented

**Good luck with testing! 🚀**
