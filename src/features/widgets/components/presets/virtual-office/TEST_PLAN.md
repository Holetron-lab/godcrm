# Virtual Office Widget - QA Test Plan

**ADR Reference:** ADR-063: WorkAdventure Virtual Office Integration  
**Component:** VirtualOfficeWidget  
**QA Agent:** @frontend-qa  
**Created:** 2026-01-28  
**Status:** PREPARED (awaiting component implementation)

---

## 1. Overview

This test plan covers comprehensive QA testing for the Virtual Office Widget, which displays WorkAdventure virtual office status in the GOD CRM dashboard.

### Widget Features
- Online users count display
- Active rooms list with user counts
- "Join Office" button (opens WorkAdventure in new tab)
- Real-time updates via polling/WebSocket
- Loading, error, and empty states
- Optional iframe mini-view

### Test Categories
1. Visual Testing
2. Accessibility Testing
3. Performance Testing
4. Responsive/Layout Testing
5. Component Unit Testing
6. E2E Integration Testing

---

## 2. Visual Testing

### 2.1 Screenshot Baselines

| State | Viewport | File |
|-------|----------|------|
| Default (5 users) | Desktop 1280x720 | `virtual-office-default.png` |
| Empty (0 users) | Desktop 1280x720 | `virtual-office-empty.png` |
| Loading | Desktop 1280x720 | `virtual-office-loading.png` |
| Error | Desktop 1280x720 | `virtual-office-error.png` |
| Many users (25+) | Desktop 1280x720 | `virtual-office-many-users.png` |
| Mobile | 375x667 | `virtual-office-mobile.png` |
| Tablet | 768x1024 | `virtual-office-tablet.png` |
| Dark theme | Desktop 1280x720 | `virtual-office-dark.png` |

### 2.2 Visual Checklist

- [ ] Widget title and icon display correctly
- [ ] Online count badge is visible and styled
- [ ] User avatars display in a stack (max 5 visible)
- [ ] "+N more" indicator shows for excess users
- [ ] Room list items have consistent styling
- [ ] "Join Office" button matches design system
- [ ] Loading skeleton matches widget dimensions
- [ ] Error state has appropriate styling (red/warning)
- [ ] Empty state illustration is centered
- [ ] Hover states work on interactive elements
- [ ] Focus states are visible
- [ ] Status indicators (online/away/busy) are distinguishable

### 2.3 Dynamic Content Masking

Elements to mask in visual tests (dynamic content):
- `.timestamp` - Last updated time
- `[data-testid="last-updated"]` - Update timestamp
- `[data-testid="user-avatar"]` - User avatars (may vary)
- `.live-counter` - Real-time counters

---

## 3. Accessibility Testing

### 3.1 WCAG 2.1 AA Compliance

| Criterion | Requirement | Test Method |
|-----------|-------------|-------------|
| 1.1.1 Non-text Content | All images have alt text | axe-core |
| 1.3.1 Info and Relationships | Proper heading hierarchy | Manual |
| 1.4.3 Contrast (Minimum) | 4.5:1 for text | axe-core |
| 1.4.11 Non-text Contrast | 3:1 for UI components | Manual |
| 2.1.1 Keyboard | All functions keyboard accessible | Manual |
| 2.1.2 No Keyboard Trap | No focus traps | Manual |
| 2.4.3 Focus Order | Logical focus order | Manual |
| 2.4.7 Focus Visible | Visible focus indicators | Manual |
| 4.1.2 Name, Role, Value | Proper ARIA attributes | axe-core |

### 3.2 Keyboard Navigation

| Key | Expected Action |
|-----|-----------------|
| Tab | Move to next interactive element |
| Shift+Tab | Move to previous interactive element |
| Enter | Activate button/link |
| Space | Activate button |
| Escape | Close expanded panels |
| Arrow Up/Down | Navigate user/room list |

### 3.3 Screen Reader Testing

Test with:
- [ ] NVDA (Windows)
- [ ] VoiceOver (macOS)
- [ ] ChromeVox (Chrome extension)

Verify announcements for:
- [ ] Widget title and purpose
- [ ] Online user count
- [ ] Room names and user counts
- [ ] Status changes (live region)
- [ ] Error messages
- [ ] Loading state

### 3.4 ARIA Requirements

```html
<!-- Widget container -->
<section aria-labelledby="virtual-office-title" role="region">
  <h2 id="virtual-office-title">Virtual Office</h2>
  
  <!-- Online count with live region -->
  <div role="status" aria-live="polite" aria-label="5 users online">
    5 online
  </div>
  
  <!-- User list -->
  <ul role="list" aria-label="Online users">
    <li role="listitem">John Doe - Main Hall</li>
  </ul>
  
  <!-- Room list -->
  <ul role="list" aria-label="Active rooms">
    <li role="listitem">Main Hall (5 users)</li>
  </ul>
  
  <!-- Join button -->
  <button aria-label="Join Virtual Office in new tab">
    Join Office
  </button>
  
  <!-- Error state -->
  <div role="alert" aria-live="assertive">
    Failed to connect to WorkAdventure
  </div>
</section>
```

---

## 4. Performance Testing

### 4.1 Load Time Targets

| Metric | Target | Maximum |
|--------|--------|---------|
| Widget render | < 100ms | 200ms |
| Initial data load | < 300ms | 500ms |
| Total time to interactive | < 500ms | 1000ms |

### 4.2 Bundle Size Budget

| Asset | Budget | Warning |
|-------|--------|---------|
| Widget JS | < 15KB | 20KB |
| Widget CSS | < 5KB | 8KB |
| Total chunk | < 25KB | 35KB |

### 4.3 Memory Usage

| Scenario | Max Memory |
|----------|------------|
| Initial load | < 5MB |
| After 10 updates | < 8MB |
| After 1 hour | < 15MB |

### 4.4 Performance Checklist

- [ ] No memory leaks during real-time updates
- [ ] Efficient re-renders (React.memo where appropriate)
- [ ] Debounced/throttled updates
- [ ] Cleanup on unmount (subscriptions, timers)
- [ ] Lazy loading for user avatars
- [ ] Virtualized list for many users (25+)

---

## 5. Responsive/Layout Testing

### 5.1 Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Mobile S | 320px | Single column, stacked |
| Mobile M | 375px | Single column, stacked |
| Mobile L | 425px | Single column, stacked |
| Tablet | 768px | Two columns possible |
| Laptop | 1024px | Full layout |
| Desktop | 1280px | Full layout |
| Wide | 1920px | Full layout |

### 5.2 Layout Checklist

- [ ] No horizontal scroll on any viewport
- [ ] Text readable without zoom
- [ ] Touch targets >= 44x44px on mobile
- [ ] Proper spacing at all breakpoints
- [ ] Images scale correctly
- [ ] Button text doesn't wrap awkwardly
- [ ] Room list scrollable if too long
- [ ] User avatars stack properly

### 5.3 Grid Integration

Widget position constraints:
- Minimum width: 3 grid units
- Minimum height: 4 grid units
- Maximum width: 12 grid units
- Maximum height: 12 grid units

---

## 6. Component Testing

### 6.1 Test Coverage Targets

| Type | Target | Minimum |
|------|--------|---------|
| Line coverage | 80% | 60% |
| Branch coverage | 75% | 50% |
| Function coverage | 80% | 60% |

### 6.2 Test Cases

#### Rendering Tests
- [ ] Renders with default props
- [ ] Renders online count correctly
- [ ] Renders room list
- [ ] Renders user avatars
- [ ] Renders Join Office button

#### State Tests
- [ ] Shows loading state
- [ ] Shows error state
- [ ] Shows empty state
- [ ] Updates on data change

#### Interaction Tests
- [ ] Join button opens new tab
- [ ] Retry button triggers refresh
- [ ] User list expands/collapses
- [ ] Room filter works

#### Edge Cases
- [ ] Handles null/undefined data
- [ ] Handles very long user names
- [ ] Handles many users (100+)
- [ ] Handles rapid updates

---

## 7. E2E Testing

### 7.1 Test Scenarios

| Scenario | Priority | Status |
|----------|----------|--------|
| Display online count | High | Prepared |
| Join Office opens new tab | High | Prepared |
| Empty state display | Medium | Prepared |
| Error state and retry | Medium | Prepared |
| Real-time updates | Medium | Prepared |
| Responsive layout | Medium | Prepared |
| Keyboard navigation | Medium | Prepared |
| Cross-browser | Low | Prepared |

### 7.2 Test Data

Mock API responses prepared in:
- `__fixtures__/mockData.ts`

### 7.3 Test Commands

```bash
# Run all E2E tests
npm run test:e2e

# Run Virtual Office widget tests only
npx playwright test virtual-office-widget.spec.ts

# Run with UI
npx playwright test virtual-office-widget.spec.ts --ui

# Update screenshots
npx playwright test virtual-office-widget.spec.ts --update-snapshots
```

---

## 8. Test Files Structure

```
src/features/widgets/components/presets/virtual-office/
├── __tests__/
│   ├── VirtualOfficeWidget.test.tsx      # Component unit tests
│   ├── VirtualOfficeWidget.a11y.test.tsx # Accessibility tests
│   └── VirtualOfficeWidget.visual.test.tsx # Visual regression tests
├── __fixtures__/
│   └── mockData.ts                        # Mock data for all tests
├── VirtualOfficeWidget.tsx                # Component (to be created)
├── VirtualOfficeWidget.stories.tsx        # Storybook stories (to be created)
└── TEST_PLAN.md                           # This document

src/tests/e2e/
└── virtual-office-widget.spec.ts          # Playwright E2E tests
```

---

## 9. Storybook Stories (To Be Created)

```typescript
// VirtualOfficeWidget.stories.tsx
export default {
  title: 'Widgets/VirtualOfficeWidget',
  component: VirtualOfficeWidget,
  parameters: {
    docs: {
      description: {
        component: 'Displays WorkAdventure virtual office status',
      },
    },
  },
};

// Stories to create:
export const Default = {};
export const Loading = {};
export const Empty = {};
export const Error = {};
export const ManyUsers = {};
export const WithIframe = {};
export const Mobile = {};
export const Dark = {};
```

---

## 10. Definition of Done

### PASS Criteria
- [ ] All visual tests match baseline (or approved changes)
- [ ] axe-core accessibility score >= 90
- [ ] No critical/serious accessibility violations
- [ ] Lighthouse performance score >= 80
- [ ] Widget loads within 500ms
- [ ] Layout works on all breakpoints (320px - 1920px)
- [ ] Component test coverage >= 80%
- [ ] All E2E tests pass
- [ ] No console errors in any state

### FAIL Criteria
- Visual regression detected (unapproved)
- Critical accessibility violation
- Performance below threshold
- Layout broken on any breakpoint
- Component tests failing
- E2E tests failing
- Console errors present

---

## 11. QA Workflow

1. **Component Created** - @frontend notifies @frontend-qa
2. **Run Tests** - Execute all test suites
3. **Report Findings** - Document issues in CRM task
4. **Fix Issues** - @frontend addresses findings
5. **Re-test** - Verify fixes
6. **Approve** - Mark QA complete

---

## 12. Notes

- Widget component does not exist yet (TASK-003 pending)
- All test infrastructure is prepared and ready
- Tests use `.todo()` markers for unimplemented tests
- Mock data covers all expected states
- E2E tests include API mocking

---

**Prepared by:** @frontend-qa  
**Ready for:** Component implementation by @frontend
