# Welcome to GOD CRM

GOD CRM is a flexible data management system that lets you organize information the way that works for you. Create tables, customize views, and automate routine tasks.

### Key Features

- **Tables** -- Store any data in structured tables with custom fields
- **Views** -- See your data differently: table, kanban, calendar, gallery
- **Widgets** -- Build dashboards with data visualization from multiple tables
- **Automations** -- Automate actions when data changes

## Quick Start

1. **Create a Space** -- A space is a container for your projects and tables. For example: 'Work', 'Personal', 'Startup'.
2. **Add a Table** -- A table stores your data. Each record is a row with a set of fields (columns).
3. **Configure a View** -- Choose how to display data: table for detailed view, kanban for tasks, calendar for events.
4. **Add Widgets to Dashboard** -- Display key metrics and data on the space dashboard.

---

# Spaces

Spaces are the top-level organization in GOD CRM. Use them to separate different areas of work or life.

## What is a Space?

- **Projects** -- a space contains projects, each with its own set of tables and settings
- **Dashboard** -- each space has a dashboard with widgets for quick overview
- **Customization** -- name, icon and color for quick visual identification

## Usage Examples

### Work
- Client CRM
- Task tracker
- Knowledge base

### Personal
- Finances
- Habits
- Yearly goals

### Startup
- Roadmap
- Investors
- Metrics

### Learning
- Courses
- Books
- Notes

---

# Tables

Tables are the foundation of GOD CRM. Each record in a table is an object with a set of properties that you define.

## Creating a Table

1. Go to the project and click `+ Create Table`
2. Enter a name, icon, and description for the table
3. Add columns (fields) -- they define the data structure
4. Start adding records via `+ Add` button

## Record Operations

- **Add** -- Create a new record in the table
- **Edit** -- Double-click opens the record card
- **Import** -- Load data from a CSV file
- **Export** -- Export data to CSV or Excel

## Row Selection and Bulk Operations

### Row Selection

- Checkbox on the left side of each row for selection
- Checkbox in the header -- select/deselect all visible rows
- Selected rows are highlighted with color
- Keyboard shortcuts: Shift+Click for range, Ctrl+A for all

### Selection Container

A badge to the right of the "Filters" button shows the number of selected rows. Clicking opens a menu with actions:

- Default -- no sorting
- Selected on top -- show selected rows first
- Selected at bottom -- show selected rows last
- Deselect all -- clear selection
- Select all filtered -- select results of current filters

### Bulk Replace (Find & Replace)

The "Replace" button to the right of the container opens a modal for bulk data changes.

**Apply to:**
- Selected rows -- only those checked with checkboxes
- Filtered rows -- results of current filters
- All rows -- the entire table without restrictions

**Operation types:**
- `Replace value` -- Draft -> Active
- `Add (prefix/suffix)` -- Hello -> Hello World
- `Clear value` -- Text -> (empty)
- `Apply formula` -- {name} - {code}

**Additional:**
- Regular expression (regex) support
- Case sensitive matching
- Preview changes before applying
- Display of affected row count

Example: find "Draft" and replace with "Active" in the Status column for 5 selected rows.

---

# Views

The same data can be displayed differently. Views let you choose the most convenient format for the current task.

## View Types

### Table
Classic table view with all columns. Ideal for detailed viewing and editing data.
Use cases: CRM with contacts, Inventory, Database

### Kanban
Cards grouped by status columns. Drag cards between columns.
Use cases: Task tracker, Sales pipeline, Hiring process

### Calendar
Records displayed on a calendar by dates. Supports multi-day events.
Use cases: Meetings, Deadlines, Content plan

### Timeline
Gantt chart with start and end dates. Shows duration and overlaps.
Use cases: Projects, Roadmap, Planning

### Gallery
Cards with image previews. Great for visual content.
Use cases: Portfolio, Product catalog, Moodboards

### Checklist
Task list with checkboxes. Mark completed items, track progress.
Use cases: To-do lists, Checklists, Habits

### Chart
Data visualization as charts: bar, line, pie.
Use cases: Analytics, Reports, Metrics

---

# Column Types

Columns define what data can be stored in a table. Choose the right type for validation and convenient editing.

## Available Types

### `text` -- Text
Any text, notes, descriptions.

**Capabilities:**
- Display template with variables: {{name}} ({{code}})
- Prefix and suffix for formatting
- Formula support in default value
- Text wrapping: single line, auto-wrap, limited

**Settings:**
- `formula` -- Template with variables from other columns
- `prefix` -- Text before the value
- `suffix` -- Text after the value
- `defaultValue` -- Default value for new rows

Example: Template: {{first_name}} {{last_name}} -> John Smith

### `number` -- Number
Numbers, amounts, quantities.

**Capabilities:**
- Formats: plain number, currency, percent (%)
- Minimum and maximum value
- Step for +/- buttons in cell
- Decimal places count

**Settings:**
- `format` -- number | currency | percent
- `min / max` -- Value constraints
- `step` -- Change step (default 1)
- `decimals` -- Decimal places (0-10)

Example: Format: currency, decimals: 2 -> $1,234.50

### `select` -- Select
Single value from a list of options with colors.

**Capabilities:**
- Option list with color coding
- Import options from CSV or another table
- Automatic option collection from existing data
- Relation support for loading from a linked table

**Settings:**
- `options` -- Array { id, label, color }
- `relation.tableId` -- Source table for options
- `relation.valueColumn` -- Column with values
- `relation.labelColumn` -- Column with labels

Example: Status: New | In Progress | Done

### `multi-select` -- Multi-Select
Multiple values from a list (tags, categories).

**Capabilities:**
- Selection of multiple values from a list
- Relation mode -- loading options from a linked table
- 4 display formats: badges, list, count, first
- 4 storage formats: json, comma, semicolon, newline

**Settings:**
- `relation.tableId` -- Table with options
- `relation.valueColumn` -- Column with values (id)
- `relation.labelColumn` -- Column with labels
- `relation.colorColumn` -- Column with colors (optional)
- `relation.displayMode` -- badges | list | count | first
- `relation.storageFormat` -- json | comma | semicolon | newline

Example: Tags: [React] [TypeScript] [Node.js] or "3 tags"

### `datetime` -- Date and Time
Specific date and time.

**Capabilities:**
- 3 storage formats: ISO 8601, Unix (sec), Unix (ms)
- Timezone selection: UTC or browser
- 11 display formats
- NOW() support for current date

**Settings:**
- `storageFormat` -- ISO8601 | unix | unix_ms
- `timezone` -- UTC | browser
- `displayFormat` -- 12/25/2024 10:30, December 25, 2024, etc.

Example: Storage: 2024-12-25T10:30:00Z -> Display: December 25, 2024, 1:30 PM

### `time` -- Time (Cron)
Schedule for cron tasks (HH:MM, day of month).

**Capabilities:**
- Time input in HH:MM format
- Day of month selection for periodic tasks
- Integration with automations
- Visual schedule editor

**Settings:**
- `format` -- HH:MM | cron expression
- `dayOfMonth` -- Day of month (1-31)
- `repeatType` -- daily | weekly | monthly

Example: 09:00 every day or 15:30 every 1st of the month

### `checkbox` -- Checkbox
Yes/No, enabled/disabled.

**Capabilities:**
- Customizable values for Yes/No
- 3 styles: checkmark, toggle, yes/no
- Default value

**Settings:**
- `trueValue` -- Value for "Yes" (1, true, yes...)
- `falseValue` -- Value for "No" (0, false, no...)
- `style` -- checkbox | toggle | yesno

Example: Toggle style: ON / OFF

### `url` -- URL (Link)
Links to websites and resources.

**Capabilities:**
- URL template with variables from other columns
- Customizable link text
- Open in new tab
- Link preview

**Settings:**
- `template` -- Template: https://site.com/{{id}}
- `linkText` -- Text instead of URL

Example: Template: https://shop.com/products/{{slug}} -> Open product

### `email` -- Email
Email addresses.

**Capabilities:**
- 4 display formats
- "Send email" button
- Copy on click
- Masking for privacy

**Settings:**
- `displayFormat` -- full | link | masked | domain

Example: Masked: u***@e***.com, Domain: @example.com

### `phone` -- Phone
Phone numbers.

**Capabilities:**
- 4 display formats
- Auto-formatting by country
- Buttons: call, WhatsApp, Telegram
- Masking for privacy

**Settings:**
- `format` -- full | national | international | masked
- `country` -- ru | us | uk | de

Example: +19001234567 -> (900) 123-4567 (US) or +1 *** ***-**67

### `file` -- File
File uploads.

**Capabilities:**
- Single or multiple file upload
- Formula for computed path
- Prefix (domain) and suffix (parameters)
- Formats: full URL, filename, path

**Settings:**
- `formula` -- Template: {{folder}}/{{filename}}
- `prefix` -- e.g.: https://cdn.site.com/
- `suffix` -- e.g.: ?v=2

Example: prefix + formula -> https://cdn.site.com/docs/report.pdf

### `image` -- Image
Upload and display images.

**Capabilities:**
- 4 gallery modes: stack, carousel, grid, single
- Customizable height (32-200px)
- Shape: square, rounded, circle
- Lightbox on click

**Settings:**
- `galleryMode` -- stack | carousel | grid | single
- `height` -- Height in pixels (32-200)
- `shape` -- square | rounded | circle
- `fit` -- cover | contain | fill

Example: Stack mode: [photo][photo][photo] +3 photos

### `person` -- User
Reference to a system user.

**Capabilities:**
- 3 sources: system users, from table, manual input
- 5 display formats
- Avatar and name

**Settings:**
- `source` -- system | table | manual
- `displayFormat` -- name | avatar | avatar_name | email | card

Example: John Smith or john@company.com

### `relation` -- Relation
Link to a record from another table.

**Capabilities:**
- Select linked table
- Customizable display column
- Navigate to linked record on click
- Multiple relations (many-to-many)

**Settings:**
- `linkedTableId` -- ID of the linked table
- `displayColumn` -- Column to display

Example: Client: -> John Smith (click opens the card)

### `table` -- Embedded Table
Displays records from another table, filtered by the current row.

**Capabilities:**
- Shows related records directly in the cell
- Filtering by current row key
- Column selection for display
- Pagination for large datasets

**Settings:**
- `sourceTableId` -- Source table
- `filterColumn` -- Column for filtering
- `displayColumns` -- Columns to display

Example: Product -> [Sub-items: Size S | Size M | Size L]

### `rollup` -- Rollup
Data aggregation from a linked table.

**Capabilities:**
- 10 aggregation functions
- 4 output formats: number, currency, percent, compact
- Automatic recalculation on data changes

**Settings:**
- `function` -- sum | count | avg | min | max | percent | range | countAll | countValues | countUnique
- `format` -- number | currency | percent | compact

Example: Order total: $125,400 or Count: 47 items

### `vector` -- Vector (AI Search)
Vector embeddings for semantic search.

**Capabilities:**
- AI embeddings for meaning-based search
- Formula for text composition
- Integration with OpenAI text-embedding-ada-002
- Storage in PostgreSQL + pgvector

**Settings:**
- `formula` -- Template: {{title}} {{description}}
- `prefix` -- Context before text
- `suffix` -- Context after text

Example: Query: "blue jeans" -> Found: "Denim pants navy" (95%)

### `button` -- Button
Button for actions.

**Capabilities:**
- 3 action types: open URL, webhook, automation
- Variable support in URL
- 3 styles: primary, secondary, danger

**Settings:**
- `action` -- url | webhook | automation
- `url` -- URL with variables: /edit/{{id}}
- `style` -- primary | secondary | danger

Example: [Edit] -> /admin/edit/{{id}}

### `audio` -- Audio
Audio player for sound playback.

**Capabilities:**
- Built-in audio player in cell
- URL support for audio files
- Formula for path computation
- Prefix (CDN domain)

**Settings:**
- `formula` -- Template: audio/{{filename}}.mp3
- `prefix` -- CDN URL: https://cdn.site.com/

Example: [0:00 / 3:45] -> playback from CDN

### `password` -- Password
Encrypted text.

**Capabilities:**
- Hidden display: --------
- Secure storage
- Show/hide button
- Copy to clipboard

**Settings:**
- `showButton` -- Show "eye" button

Example: Input field: [--------]

### `formula` -- Formula
Computed field.

**Capabilities:**
- JavaScript expressions
- Access to data from other columns
- Auto-recalculation on changes
- Result formatting

**Settings:**
- `expression` -- JS expression: price * qty
- `format` -- number | currency | percent

Example: Total: price * qty * (1 - discount/100) -> $8,500

### `dialog` -- AI Dialog
AI dialog / conversation.

**Capabilities:**
- Conversation history with AI
- Context from current row
- Integration with AI agents
- Dialog saved in the row

**Settings:**
- `agentId` -- AI agent ID for dialog
- `contextColumns` -- Columns for context

Example: AI dialog about a client card

### `chat` -- AI Chat
AI chat conversation.

**Capabilities:**
- Full-featured chat with AI
- Message history
- Response streaming
- Support for different models

**Settings:**
- `model` -- Model: gpt-4, claude-3, etc.
- `systemPrompt` -- System prompt

Example: Chat with an AI assistant in a cell

## Vector Column (AI Search)

### What is a Vector Column?

A vector column automatically creates AI embeddings (vector representations) from text data, allowing you to search records by meaning rather than exact word matches.

**Use cases:**
- Finding similar products
- Semantic document search
- Content recommendations
- Record deduplication

**Technology:**
- OpenAI text-embedding-ada-002
- Storage in PostgreSQL + pgvector
- Cosine similarity for search
- Automatic vectorization

### Vector Column Settings

**`formula`** (optional) -- Formula for creating the text that will be vectorized. Supports variables from other columns.

```
{{title}} {{articul}}
{{description}}
Category: {{category_id}}
Brand: {{brand_id}}
```

**`prefix`** (optional) -- Text added before the formula. Used for context. For example: "Product: "

**`suffix`** (optional) -- Text added after the formula. For example: " (in stock)"

### Example: Product Search

A user searches for "blue mens jeans". The system will find products with similar meaning, even if the words differ: "Navy denim pants for men".

Query: `blue mens jeans` -> Result: `Navy denim pants (95% similarity)`

## Column Actions

### Creating a Column

1. Click the `+ Add Column` button in the table header
2. Select the column type from the list (text, number, select, etc.)
3. Enter a name and system name (auto-generated from the name)
4. Configure parameters depending on the type
5. Click `Save`

### Editing
Click the gear icon in the column header or right-click -> Settings

### Deleting
Column settings -> "Delete Column" button at the bottom. Data will be lost!

### Moving
Drag the column header left/right to change the display order

### Hiding/Showing
Right-click on the header -> Hide column. Restore via the "Hidden Columns" menu

### Duplicating
Column settings -> Duplicate. Creates a copy with all settings

### Resizing
Drag the border between column headers or specify an exact value in pixels

## Display Settings

### Column Width
Size in pixels (80-800px). Values: Auto, 150px (default), 200px, 300px...

### Text Alignment
Horizontal content alignment: Left, Center, Right

### Text Wrapping
Behavior when cell overflows:
- **nowrap** -- Single line with truncation ...
- **wrap** -- Auto wrap, height adjusts to content
- **ellipsis** -- Limited wrap (2-3 lines) + ...

### Typography
Font size (10-24px), **bold**, *italic*, `monospace`

### Colors
Text color and cell background color

## Formulas and Variables

### What are Formulas?

Formulas allow you to automatically compute values based on other columns. Use variables in curly braces `{{column_name}}` to substitute values.

Example:
```
{{first_name}} {{last_name}} ({{email}})
```
Result: John Smith (john@example.com)

### Variable Syntax

**`{{column_name}}`** -- Basic value substitution from a column
```
{{title}} - {{price}} USD
```

**`{{value}}`** -- Current cell value (for file, vector type formulas)
```
Prefix: https://cdn.example.com/
Formula: {{folder}}/{{value}}
Result: https://cdn.example.com/images/photo.jpg
```

**`NOW()`** -- Special function for current date and time
```
Default value: NOW()
Result: 2025-12-13T23:45:00
```

### Where Formulas Can Be Used

- **Text columns** -- Display template, prefix, suffix
- **Files and images** -- Path formula, URL prefix
- **URL columns** -- Link template, link text
- **Vector columns** -- Text vectorization formula
- **Buttons** -- URL for navigation, webhook endpoint
- **Default values** -- For any column type

### Practical Formula Examples

- **Full name:** `{{first_name}} {{middle_name}} {{last_name}}`
- **Product URL:** `https://shop.com/products/{{id}}/{{slug}}`
- **File path:** `{{year}}/{{month}}/{{category}}/{{filename}}`
- **Search description:** `{{brand}} {{model}} {{color}} {{size}}`

### Important Notes

- If a column doesn't exist, `{{unknown}}` will be highlighted in red
- Existing columns are highlighted `{{name}}` in green
- Formulas are recalculated automatically when source data changes
- Formulas are case-sensitive: `{{Name}}` != `{{name}}`

## Column Settings

- **Name** -- Displayed column name
- **Type** -- Defines data format
- **Required** -- Require value to be filled
- **Default Value** -- Automatically populated
- **Width** -- Column size in table
- **Visibility** -- Hide/show column

---

# Filters & Search

Filters help find the right records in large datasets. Combine conditions for precise results.

## Search

Quick search across all text fields:

- Type text in the search field -- results update instantly
- Search works on names and text columns
- You can select specific columns for search

## Filter Types

### Select Filter
Show records with specific values in Select/Multiselect columns.
Example: `Status = 'In Progress' OR 'In Review'`

### Date Filter
Show records within a specific date range.
Example: `Deadline: December 1 to December 31`

### Combined Filters
Multiple filters applied simultaneously (AND condition).
Example: `Status = 'In Progress' AND Assignee = 'John'`

## Sorting

Record ordering:

- Click column header -- sort ascending
- Click again -- sort descending
- Works for text, numbers, and dates

---

# Widgets & Dashboards

Widgets let you display table data on a dashboard in a convenient format. Create overview panels for quick monitoring.

## Creating a Widget

1. Go to the space dashboard and click `+ Add Widget`
2. Choose view type (kanban, calendar, chart, etc.)
3. Select the source table
4. Configure field mapping and filters in widget settings

## Widget Types

- Table
- Kanban
- Calendar
- Timeline
- Chart
- Checklist

## Dashboard Management

- **Resize** -- drag the widget corner
- **Move** -- drag the widget by its header
- **Settings** -- click the gear icon in widget corner
- **Delete** -- via widget settings menu

---

# Automations

Automate routine actions. When a certain event occurs -- the system automatically performs specified actions.

## Triggers (When to Run)

- **Record Created** -- When a new record is added to the table
- **Record Updated** -- When any field of a record changes
- **Field Changed** -- When a specific field changes (e.g., status)
- **Record Deleted** -- When a record is removed from the table

## Actions (What to Do)

- **Send Notification** -- Email or push notification to user
- **Update Record** -- Automatically change record fields
- **Create Record** -- Add new record to this or another table
- **Call Webhook** -- Send HTTP request to external service

## Automation Examples

- **WHEN** Task status -> 'Done' **THEN** Notify task author
- **WHEN** New request created **THEN** Assign responsible manager
- **WHEN** Deadline in 1 day **THEN** Remind the assignee

## Webhooks

Integration with external services.

Webhooks allow sending data from CRM to external systems on certain events.

- Integration with Telegram bots
- Sync with external CRMs
- Send data to analytics systems
- Trigger workflows in n8n, Zapier, Make

---

# REST API

GOD CRM provides a full-featured REST API for integration with external systems. All endpoints return JSON and require authentication.

## Authentication

The API supports two authentication methods: JWT tokens and API keys.

### API Keys (recommended for integrations)

Create an API key in Settings -> API Keys. Keys start with `sk-`

Using the X-API-Key header:
```
X-API-Key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Or via Authorization:
```
Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### JWT Tokens (for web applications)

Get a token via `POST /api/v3/auth/login`

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Base URL

```
https://crm.hltrn.cc/api/v3
```

## API Key Management

**GET** `/api-keys` -- List your API keys

**POST** `/api-keys` -- Create a new API key

Request Body:
```json
{
  "name": "string",
  "scopes": ["*"],
  "expires_in_days": "number"
}
```

**DELETE** `/api-keys/:id` -- Revoke an API key

### Available Scopes

- `*` -- full access
- `tables:read`
- `tables:write`
- `rows:read`
- `rows:write`
- `widgets:read`
- `widgets:write`

## Tables API

**GET** `/tables` -- List all tables

**POST** `/tables` -- Create a new table

Request Body:
```json
{
  "name": "string",
  "space_id": "number",
  "emoji": "string"
}
```

**GET** `/tables/:id` -- Get table details

**PATCH** `/tables/:id` -- Update table

Request Body:
```json
{
  "name": "string",
  "emoji": "string"
}
```

**DELETE** `/tables/:id` -- Delete a table

## Columns API

**GET** `/tables/:tableId/columns` -- List table columns

**POST** `/tables/:tableId/columns` -- Add a column

Request Body:
```json
{
  "name": "string",
  "type": "text|number|select|datetime|...",
  "options": "object"
}
```

**PATCH** `/columns/:id` -- Update column

**DELETE** `/columns/:id` -- Delete column

### Column Types

text, number, select, multi_select, datetime, time, checkbox, url, email, phone, rating, file, image, relation, lookup, formula, rollup, json, vector

## Rows API

**GET** `/tables/:tableId/rows` -- List rows with pagination
Query: `?limit=50&offset=0&sort=column_id&order=asc`

**POST** `/tables/:tableId/rows` -- Create a row

Request Body:
```json
{
  "values": {
    "column_id": "value"
  }
}
```

**GET** `/rows/:id` -- Get a single row

**PATCH** `/rows/:id` -- Update a row

Request Body:
```json
{
  "values": {
    "column_id": "new_value"
  }
}
```

**DELETE** `/rows/:id` -- Delete a row

**POST** `/tables/:tableId/rows/batch` -- Batch create rows

Request Body:
```json
{
  "rows": [
    { "values": {} },
    { "values": {} }
  ]
}
```

## Spaces & Projects API

**GET** `/spaces` -- List all spaces

**POST** `/spaces` -- Create a space

Request Body:
```json
{
  "name": "My Workspace",
  "icon": "rocket",
  "type": "business"
}
```

**GET** `/projects` -- List all projects

**POST** `/projects` -- Create a project

Request Body:
```json
{
  "name": "Sales CRM",
  "spaceId": 1,
  "icon": "briefcase"
}
```

## Views API

**GET** `/tables/:tableId/views` -- List table views

**POST** `/tables/:tableId/views` -- Create a view

Request Body:
```json
{
  "name": "string",
  "type": "table|kanban|calendar|gallery",
  "config": "object"
}
```

**PATCH** `/views/:id` -- Update view

**DELETE** `/views/:id` -- Delete view

## Widgets API

**GET** `/dashboards/:dashboardId/widgets` -- List dashboard widgets

**POST** `/dashboards/:dashboardId/widgets` -- Create a widget

Request Body:
```json
{
  "type": "chart|stat|kanban|calendar|...",
  "config": "object",
  "position": { "x": 0, "y": 0, "w": 2, "h": 2 }
}
```

**PATCH** `/widgets/:id` -- Update widget

**DELETE** `/widgets/:id` -- Delete widget

### Widget Types

- chart -- charts
- stat -- statistics
- kanban -- kanban board
- calendar -- calendar
- task_list -- task list
- table -- mini-table

## Webhooks API

**GET** `/tables/:tableId/webhooks` -- List table webhooks

**POST** `/tables/:tableId/webhooks` -- Create a webhook

Request Body:
```json
{
  "url": "string",
  "events": ["row.created", "row.updated", "row.deleted"],
  "secret": "string"
}
```

**DELETE** `/webhooks/:id` -- Delete webhook

### Webhook Events

- `row.created` -- record created
- `row.updated` -- record updated
- `row.deleted` -- record deleted

## External Sources API

**GET** `/data-sources` -- List data sources

**POST** `/data-sources` -- Create an external source

Request Body:
```json
{
  "name": "string",
  "type": "postgres|mysql|api",
  "connection": "object"
}
```

**POST** `/data-sources/:id/sync` -- Synchronize data

**DELETE** `/data-sources/:id` -- Delete source

## Vector API (Semantic Search)

### What is it?

Vector API allows you to create vector embeddings of text and search for similar records by meaning rather than exact word matches. Uses OpenAI embeddings and PostgreSQL with pgvector extension.

| Parameter | Value |
|-----------|-------|
| Model | text-embedding-ada-002 |
| Dimensions | 1536 dimensions |
| Similarity | Cosine similarity |

**POST** `/api/v3/ai/vector/embed` -- Create and store an embedding for text

Request Body:
```json
{
  "workspaceId": "number",
  "tableId": "number",
  "rowId": "number",
  "text": "string",
  "metadata": "object"
}
```

Example /embed request:
```json
{
  "workspaceId": 1,
  "tableId": 5,
  "rowId": 123,
  "text": "Smartphone Apple iPhone 15 Pro 256GB Blue Titanium",
  "metadata": {
    "category": "electronics",
    "price": 99999
  }
}
```

**POST** `/api/v3/ai/vector/search` -- Search for similar records by query text

Request Body:
```json
{
  "workspaceId": "number",
  "queryText": "string",
  "tableId": "number",
  "limit": "number (default: 10)",
  "metadataFilters": "object"
}
```

Example /search request:
```json
{
  "workspaceId": 1,
  "queryText": "blue iphone phone",
  "tableId": 5,
  "limit": 5,
  "metadataFilters": {
    "category": "electronics"
  }
}
```

Example response:
```json
{
  "success": true,
  "results": [
    {
      "rowId": 123,
      "similarity": 0.94,
      "metadata": {
        "category": "electronics",
        "text_content": "Smartphone Apple iPhone 15 Pro 256GB Blue Titanium"
      }
    },
    {
      "rowId": 124,
      "similarity": 0.89,
      "metadata": {
        "text_content": "iPhone 15 Blue 128GB"
      }
    }
  ],
  "count": 2
}
```

**POST** `/api/v3/ai/vector/batch` -- Batch create embeddings

Request Body:
```json
{
  "workspaceId": "number",
  "items": [
    { "tableId": "number", "rowId": "number", "text": "string", "metadata": "object" }
  ]
}
```

**POST** `/api/v3/ai/vector/generate-cell` -- Create embedding for a vector column using its formula

Request Body:
```json
{
  "tableId": "number",
  "rowId": "number",
  "columnId": "number"
}
```

### How /generate-cell works

This endpoint reads the vector column settings (formula, prefix, suffix), substitutes values from other columns of the row, forms the final text, and creates the embedding.

1. Column formula: Prefix: "Product: " + Formula: {{title}} {{category}} + Suffix: " in stock"
2. Row data: title: "iPhone 15", category: "Smartphones"
3. Final text: "Product: iPhone 15 Smartphones in stock"
4. Embedding creation via OpenAI API

**GET** `/api/v3/ai/vector/stats/:workspaceId` -- Get embedding statistics

### Requirements

- **OPENAI_API_KEY** -- OpenAI API key in environment variables
- **PostgreSQL + pgvector** -- database with vector extension
- **business_crm_vectors database** -- separate database for embedding storage

## Usage Examples

### Creating a record (cURL)

```bash
curl -X POST https://crm.hltrn.cc/api/tables/1/rows \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "values": {
      "name": "New client",
      "email": "client@example.com",
      "status": "new"
    }
  }'
```

### JavaScript/Fetch

```javascript
const response = await fetch('/api/tables/1/rows', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    values: {
      name: 'New client',
      email: 'client@example.com',
    }
  })
});

const newRow = await response.json();
console.log('Created row:', newRow.id);
```

## Error Handling

The API returns standard HTTP codes and JSON with error descriptions:

| Code | Description |
|------|-------------|
| `200` | OK -- success |
| `201` | Created -- created |
| `400` | Bad Request -- invalid request |
| `401` | Unauthorized -- not authenticated |
| `404` | Not Found -- not found |
| `500` | Server Error -- server error |

Error format:
```json
{
  "error": true,
  "message": "Table not found",
  "code": "TABLE_NOT_FOUND"
}
```

---

# AI Agents

Intelligent assistants that understand your data and help you work with it. Agents can answer questions, analyze data, and perform tasks.

## What are AI Agents?

AI Agents are customizable AI assistants based on GPT-4, Claude, or other models. Each agent has its own role, knowledge, and tools.

- **Personalization** -- Configure system prompt, model, and tools for your tasks
- **Data Context** -- The agent understands your table structure and can work with data
- **Multiple Providers** -- OpenAI, Anthropic, Google, Ollama -- choose the right model
- **Monitoring** -- Track token usage, costs, and response quality

## Quick Start

1. **Create an "AI Agents" space** -- Or use an existing one. The space should have tables: Agents, Models, Providers, API Keys.
2. **Add a provider API key** -- In the API Keys table, add a key from OpenAI, Anthropic, or another provider.
3. **Create an agent** -- In the Agents table, create a record with name, description, system prompt, and model selection.
4. **Start a dialog** -- Click the chat icon in the bottom right corner and select an agent.

## Agent Configuration

- `name` -- Agent name for display in the list
- `description` -- Brief description of the agent's purpose
- `system_prompt` -- System prompt defining the agent's behavior and role
- `model` -- Link to Models table -- AI model selection
- `provider_id` -- Link to Providers table -- API provider selection
- `api_key_id` -- Link to API Keys table -- authorization key
- `tools` -- JSON array of available agent tools
- `is_active` -- Checkbox -- whether the agent is active for use

## AI Agents and Vector Search

### Semantic Data Search

AI agents can use vector search for intelligent data analysis. Instead of exact word matching, the agent understands the meaning of a query and finds relevant records.

### Example 1: Finding Similar Products

**Question:** "Find products similar to iPhone 15"

**Agent:** Uses Vector API to search products with similar characteristics: premium smartphones, large screen, good camera -> finds Samsung S24 Ultra, Google Pixel 8 Pro

### Example 2: Document Search by Meaning

**Question:** "Where is the information about working with clients?"

**Agent:** Searches for documents semantically related to CRM, customer service, sales -> finds "CRM Guide", "Request Processing", "Sales Scripts"

### Example 3: Recommendations

**Question:** "What else might a client who bought a design laptop like?"

**Agent:** Analyzes the purchase via vector search -> recommends a graphics tablet, external 4K monitor, designer mouse, Adobe Creative Cloud subscription

### How to Enable Vector Search for an Agent

1. Create a vector column in the needed table
2. Configure the vectorization formula (which fields to include)
3. Add the `vector_search` tool to the agent
4. In the system prompt, specify when to use vector search

## Supported Providers

- **OpenAI** -- GPT-4, GPT-4 Turbo, GPT-3.5
- **Anthropic** -- Claude 3.5, Claude 3 Opus
- **Google** -- Gemini 1.5 Pro, Gemini Flash
- **Ollama** -- Llama 3.2, Mistral, CodeLlama

## Message Logs

All agent interactions are automatically logged to the "Message Logs" table:

- agent_name
- user_id
- model
- message
- response
- tokens_in/out
- status
- timestamp

## Tips

- **System prompt** -- Clearly define the agent's role. For example: "You are a sales analyst. Answer briefly and to the point."
- **Model selection** -- GPT-4 Turbo for complex tasks, GPT-3.5 for simple ones -- save tokens wisely.
- **Variables in prompts** -- Use templates like {{table.column}} for dynamic data substitution from tables.

---

# AI Agents API

API for working with AI agents, providers, and models. Manage artificial intelligence in your workspace.

## Overview

- **AI Agents** -- Create and manage intelligent assistants
- **Chat with Agents** -- Send messages and receive AI responses
- **Providers** -- OpenAI, Anthropic, Google, Ollama
- **Models** -- GPT-4, Claude, Gemini and more

## Base URL

```
https://crm.hltrn.cc/api/v3/ai
```

## Agents

**GET** `/ai/agents` -- Get list of all agents

**GET** `/ai/agents/:spaceId` -- Get agents for a specific space

**POST** `/ai/agents` -- Create a new agent

Request Body:
```json
{
  "name": "string",
  "description": "string",
  "model": "gpt-4-turbo",
  "provider": "openai",
  "system_prompt": "string",
  "tools": ["string"]
}
```

**PATCH** `/ai/agents/:id` -- Update an agent

Request Body:
```json
{
  "name": "string",
  "model": "string",
  "system_prompt": "string"
}
```

**DELETE** `/ai/agents/:id` -- Delete an agent

## Chat with Agent

**POST** `/ai/chat` -- Send a message to agent and receive response

Request Body:
```json
{
  "agentId": "number",
  "message": "string",
  "conversationId": "string",
  "context": "object"
}
```

Response Example:
```json
{
  "success": true,
  "response": "Here are your sales stats for this month...",
  "conversationId": "conv_abc123",
  "model": "gpt-4-turbo",
  "usage": {
    "promptTokens": 150,
    "completionTokens": 85,
    "totalTokens": 235
  }
}
```

**GET** `/ai/conversations/:conversationId` -- Get conversation history

**DELETE** `/ai/conversations/:conversationId` -- Delete a conversation

## AI Providers

**GET** `/ai/providers` -- Get list of AI providers

Supported Providers:

- `openai` -- OpenAI (GPT-4, GPT-3.5)
- `anthropic` -- Anthropic (Claude)
- `google` -- Google (Gemini)
- `ollama` -- Ollama (local models)

**POST** `/ai/providers` -- Add a provider

Request Body:
```json
{
  "name": "string",
  "provider_key": "openai|anthropic|google|ollama",
  "base_url": "string",
  "is_active": true
}
```

**PATCH** `/ai/providers/:id` -- Update a provider

**DELETE** `/ai/providers/:id` -- Delete a provider

## Models

**GET** `/ai/models` -- Get list of all models

**GET** `/ai/models?providerId=:id` -- Get models for a specific provider

Popular Models:

- **OpenAI:** gpt-4-turbo, gpt-4o, gpt-3.5-turbo
- **Anthropic:** claude-3-5-sonnet-20241022, claude-3-opus
- **Google:** gemini-1.5-pro, gemini-1.5-flash
- **Ollama:** llama3.2, mistral, codellama

**POST** `/ai/models` -- Add a model

Request Body:
```json
{
  "provider_id": "number",
  "model_id": "gpt-4-turbo",
  "display_name": "GPT-4 Turbo",
  "context_window": 128000,
  "is_active": true
}
```

**PATCH** `/ai/models/:id` -- Update a model

**DELETE** `/ai/models/:id` -- Delete a model

## Refresh Models

**POST** `/ai/providers/:providerId/refresh-models` -- Refresh model list from provider API

Response Example:
```json
{
  "success": true,
  "message": "Updated models: 17",
  "added": 12,
  "updated": 5,
  "models": [
    { "model_id": "gpt-4-turbo", "display_name": "GPT-4 Turbo" },
    { "model_id": "gpt-4o", "display_name": "GPT-4o" }
  ]
}
```

**Important:** Refreshing models requires a configured API key for the provider in the API Keys table. Automatic refresh is supported for OpenAI and Anthropic.

## AI API Keys

Provider API keys are stored in the "API Keys" table of the "AI Agents" space.

API Key record structure:
```json
{
  "provider": "openai",
  "key_name": "OpenAI API",
  "api_key": "sk-...",
  "is_active": true,
  "last_used": "2024-01-15"
}
```

## Agent Tools

Agents can use tools to interact with the CRM.

| Tool | Description |
|------|-------------|
| `get_workspace_info` | Get information about spaces, projects, and tables |
| `query_table_data` | Query data from a table |
| `create_table` | Create a new table |
| `create_row` | Add a record to a table |
| `update_row` | Update a record in a table |
| `create_dashboard` | Create a dashboard |
| `create_widget` | Add a widget to dashboard |
| `search_records` | Search records by criteria |

## Usage Examples

### Send message to agent (cURL)

```bash
curl -X POST https://crm.hltrn.cc/api/v3/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "agentId": 1,
    "message": "Show sales statistics for this month",
    "context": {
      "spaceId": 5,
      "tableId": 12
    }
  }'
```

### JavaScript / Fetch

```javascript
const response = await fetch('/api/v3/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentId: 1,
    message: 'Create a report on tasks',
    conversationId: 'conv_existing_id' // optional
  })
});

const { response: aiResponse, usage } = await response.json();
console.log('AI responded:', aiResponse);
console.log('Tokens used:', usage.totalTokens);
```

### Refresh provider models

```javascript
// Get a fresh model list from OpenAI
const result = await fetch('/api/v3/ai/providers/1/refresh-models', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
});

const { added, updated, models } = await result.json();
console.log(`Added: ${added}, updated: ${updated}`);
```

## Error Handling

| Code | Description |
|------|-------------|
| `400` | Bad Request |
| `401` | Unauthorized |
| `404` | Agent Not Found |
| `500` | AI Provider Error |

AI error format:
```json
{
  "success": false,
  "error": "AI_PROVIDER_ERROR",
  "message": "OpenAI API rate limit exceeded",
  "details": {
    "provider": "openai",
    "model": "gpt-4-turbo"
  }
}
```
