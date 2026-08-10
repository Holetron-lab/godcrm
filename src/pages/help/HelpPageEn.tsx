/**
 * @legacy
 * @deprecated Will be replaced by the Documents module (ADR-117 Documents 2.0).
 * See ROADMAP-001 Phase 1.3 — split god components.
 * This file is a static help page; all content should migrate to CRM Documents.
 */
import { useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { 
  Book, Database, Table2, LayoutGrid, Calendar, GitBranch, 
  BarChart3, ListTodo, Plus, Filter, Search, 
  Eye, Columns, ArrowUpDown, ChevronRight,
  Layers, FolderKanban, FileSpreadsheet, Palette,
  Zap, Webhook, Upload, Download, Image, Code, Key, Server,
  Bot, Cpu, RefreshCw, MessageSquare
} from 'lucide-react';

interface HelpSection {
  id: string;
  title: string;
  icon: React.ReactNode;
}

const sections: HelpSection[] = [
  { id: 'intro', title: 'Introduction', icon: <Book className="w-5 h-5" /> },
  { id: 'spaces', title: 'Spaces', icon: <Layers className="w-5 h-5" /> },
  { id: 'tables', title: 'Tables', icon: <Database className="w-5 h-5" /> },
  { id: 'views', title: 'Views', icon: <Eye className="w-5 h-5" /> },
  { id: 'columns', title: 'Columns', icon: <Columns className="w-5 h-5" /> },
  { id: 'filters', title: 'Filters & Search', icon: <Filter className="w-5 h-5" /> },
  { id: 'widgets', title: 'Widgets', icon: <LayoutGrid className="w-5 h-5" /> },
  { id: 'automations', title: 'Automations', icon: <Zap className="w-5 h-5" /> },
  { id: 'api', title: 'API Reference', icon: <Code className="w-5 h-5" /> },
  { id: 'ai-api', title: 'AI Agents API', icon: <Bot className="w-5 h-5" /> },
];

export function HelpPageEn() {
  const [activeSection, setActiveSection] = useState('intro');

  const renderContent = () => {
    switch (activeSection) {
      case 'intro': return <IntroSection />;
      case 'spaces': return <SpacesSection />;
      case 'tables': return <TablesSection />;
      case 'views': return <ViewsSection />;
      case 'columns': return <ColumnsSection />;
      case 'filters': return <FiltersSection />;
      case 'widgets': return <WidgetsSection />;
      case 'automations': return <AutomationsSection />;
      case 'api': return <ApiSection />;
      case 'ai-api': return <AIAgentsApiSection />;
      default: return <IntroSection />;
    }
  };

  return (
    <div className="flex h-full bg-[var(--bg-primary)]">
      <nav className="w-64 flex-shrink-0 border-r border-[var(--border-primary)] overflow-y-auto">
        <div className="p-4">
          <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Book className="w-5 h-5 text-primary-500" />
            Help
          </h1>
          <ul className="space-y-1">
            {sections.map((section) => (
              <li key={section.id}>
                <button
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    activeSection === section.id
                      ? 'bg-primary-500/10 text-primary-500'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  {section.icon}
                  {section.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}

// === SECTIONS ===

function IntroSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          Welcome to GOD CRM
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          GOD CRM is a flexible data management system that lets you organize information 
          the way that works for you. Create tables, customize views, and automate routine tasks.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <FeatureCard icon={<Database className="w-6 h-6" />} title="Tables" description="Store any data in structured tables with custom fields" color="purple" />
        <FeatureCard icon={<Eye className="w-6 h-6" />} title="Views" description="See your data differently: table, kanban, calendar, gallery" color="cyan" />
        <FeatureCard icon={<LayoutGrid className="w-6 h-6" />} title="Widgets" description="Build dashboards with data visualization from multiple tables" color="emerald" />
        <FeatureCard icon={<Zap className="w-6 h-6" />} title="Automations" description="Automate actions when data changes" color="amber" />
      </div>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Quick Start</h2>
        <ol className="space-y-4">
          <QuickStartStep number={1} title="Create a Space" description="A space is a container for your projects and tables. For example: 'Work', 'Personal', 'Startup'." />
          <QuickStartStep number={2} title="Add a Table" description="A table stores your data. Each record is a row with a set of fields (columns)." />
          <QuickStartStep number={3} title="Configure a View" description="Choose how to display data: table for detailed view, kanban for tasks, calendar for events." />
          <QuickStartStep number={4} title="Add Widgets to Dashboard" description="Display key metrics and data on the space dashboard." />
        </ol>
      </section>
    </div>
  );
}

function SpacesSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Layers className="inline w-8 h-8 mr-2 text-primary-500" />
          Spaces
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Spaces are the top-level organization in GOD CRM. Use them to separate different 
          areas of work or life.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">What is a Space?</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <ul className="space-y-3">
            <li className="flex items-start gap-3">
              <FolderKanban className="w-5 h-5 text-primary-500 flex-shrink-0 mt-0.5" />
              <span className="text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">Projects</strong> — a space contains projects, 
                each with its own set of tables and settings
              </span>
            </li>
            <li className="flex items-start gap-3">
              <LayoutGrid className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
              <span className="text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">Dashboard</strong> — each space has a 
                dashboard with widgets for quick overview
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Palette className="w-5 h-5 text-pink-500 flex-shrink-0 mt-0.5" />
              <span className="text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">Customization</strong> — name, icon and color 
                for quick visual identification
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Usage Examples</h2>
        <div className="grid grid-cols-2 gap-4">
          <ExampleCard emoji="💼" title="Work" items={['Client CRM', 'Task tracker', 'Knowledge base']} />
          <ExampleCard emoji="🏠" title="Personal" items={['Finances', 'Habits', 'Yearly goals']} />
          <ExampleCard emoji="🚀" title="Startup" items={['Roadmap', 'Investors', 'Metrics']} />
          <ExampleCard emoji="📚" title="Learning" items={['Courses', 'Books', 'Notes']} />
        </div>
      </section>
    </div>
  );
}

function TablesSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Database className="inline w-8 h-8 mr-2 text-purple-500" />
          Tables
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Tables are the foundation of GOD CRM. Each record in a table is an object with 
          a set of properties that you define.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Creating a Table</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <ol className="space-y-4">
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500 text-white text-sm flex items-center justify-center">1</span>
              <span className="text-[var(--text-secondary)]">
                Go to the project and click <kbd className="px-2 py-0.5 bg-[var(--bg-tertiary)] rounded text-xs">+ Create Table</kbd>
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500 text-white text-sm flex items-center justify-center">2</span>
              <span className="text-[var(--text-secondary)]">Enter a name, icon, and description for the table</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500 text-white text-sm flex items-center justify-center">3</span>
              <span className="text-[var(--text-secondary)]">Add columns (fields) — they define the data structure</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500 text-white text-sm flex items-center justify-center">4</span>
              <span className="text-[var(--text-secondary)]">
                Start adding records via <kbd className="px-2 py-0.5 bg-[var(--bg-tertiary)] rounded text-xs">+ Add</kbd> button
              </span>
            </li>
          </ol>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Record Operations</h2>
        <div className="grid grid-cols-2 gap-4">
          <ActionCard icon={<Plus />} title="Add" description="Create a new record in the table" />
          <ActionCard icon={<FileSpreadsheet />} title="Edit" description="Double-click opens the record card" />
          <ActionCard icon={<Upload />} title="Import" description="Load data from a CSV file" />
          <ActionCard icon={<Download />} title="Export" description="Export data to CSV or Excel" />
        </div>
      </section>
    </div>
  );
}

function ViewsSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Eye className="inline w-8 h-8 mr-2 text-cyan-500" />
          Views
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          The same data can be displayed differently. Views let you choose the most 
          convenient format for the current task.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">View Types</h2>
        <div className="space-y-4">
          <ViewTypeCard icon={<Table2 className="w-6 h-6" />} title="Table" description="Classic table view with all columns. Ideal for detailed viewing and editing data." color="purple" useCases={['CRM with contacts', 'Inventory', 'Database']} />
          <ViewTypeCard icon={<LayoutGrid className="w-6 h-6" />} title="Kanban" description="Cards grouped by status columns. Drag cards between columns." color="cyan" useCases={['Task tracker', 'Sales pipeline', 'Hiring process']} />
          <ViewTypeCard icon={<Calendar className="w-6 h-6" />} title="Calendar" description="Records displayed on a calendar by dates. Supports multi-day events." color="emerald" useCases={['Meetings', 'Deadlines', 'Content plan']} />
          <ViewTypeCard icon={<GitBranch className="w-6 h-6" />} title="Timeline" description="Gantt chart with start and end dates. Shows duration and overlaps." color="amber" useCases={['Projects', 'Roadmap', 'Planning']} />
          <ViewTypeCard icon={<Image className="w-6 h-6" />} title="Gallery" description="Cards with image previews. Great for visual content." color="pink" useCases={['Portfolio', 'Product catalog', 'Moodboards']} />
          <ViewTypeCard icon={<ListTodo className="w-6 h-6" />} title="Checklist" description="Task list with checkboxes. Mark completed items, track progress." color="green" useCases={['To-do lists', 'Checklists', 'Habits']} />
          <ViewTypeCard icon={<BarChart3 className="w-6 h-6" />} title="Chart" description="Data visualization as charts: bar, line, pie." color="indigo" useCases={['Analytics', 'Reports', 'Metrics']} />
        </div>
      </section>
    </div>
  );
}

function ColumnsSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Columns className="inline w-8 h-8 mr-2 text-amber-500" />
          Column Types
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Columns define what data can be stored in a table. Choose the right type 
          for validation and convenient editing.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Available Types</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] divide-y divide-[var(--border-primary)]">
          <ColumnTypeRow type="text" name="Text" description="Any text, notes, descriptions" />
          <ColumnTypeRow type="number" name="Number" description="Numbers, amounts, quantities" />
          <ColumnTypeRow type="select" name="Select" description="Single value from a list of options with colors" />
          <ColumnTypeRow type="multiselect" name="Multi-select" description="Multiple values from a list (tags)" />
          <ColumnTypeRow type="date" name="Date" description="Date or date and time" />
          <ColumnTypeRow type="checkbox" name="Checkbox" description="Yes/No, enabled/disabled" />
          <ColumnTypeRow type="url" name="URL" description="Website links" />
          <ColumnTypeRow type="email" name="Email" description="Email addresses" />
          <ColumnTypeRow type="phone" name="Phone" description="Phone numbers" />
          <ColumnTypeRow type="file" name="File" description="File and image uploads" />
          <ColumnTypeRow type="user" name="User" description="Reference to a system user" />
          <ColumnTypeRow type="relation" name="Relation" description="Link to a record from another table" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Column Settings</h2>
        <div className="grid grid-cols-2 gap-4">
          <SettingCard title="Name" description="Displayed column name" />
          <SettingCard title="Type" description="Defines data format" />
          <SettingCard title="Required" description="Require value to be filled" />
          <SettingCard title="Default Value" description="Automatically populated" />
          <SettingCard title="Width" description="Column size in table" />
          <SettingCard title="Visibility" description="Hide/show column" />
        </div>
      </section>
    </div>
  );
}

function FiltersSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Filter className="inline w-8 h-8 mr-2 text-emerald-500" />
          Filters & Search
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Filters help find the right records in large datasets. Combine conditions 
          for precise results.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Search</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <div className="flex items-center gap-3 mb-4">
            <Search className="w-5 h-5 text-[var(--text-tertiary)]" />
            <span className="text-[var(--text-primary)]">Quick search across all text fields</span>
          </div>
          <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
            <li>• Type text in the search field — results update instantly</li>
            <li>• Search works on names and text columns</li>
            <li>• You can select specific columns for search</li>
          </ul>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Filter Types</h2>
        <div className="space-y-4">
          <FilterTypeCard title="Select Filter" description="Show records with specific values in Select/Multiselect columns" example="Status = 'In Progress' OR 'In Review'" />
          <FilterTypeCard title="Date Filter" description="Show records within a specific date range" example="Deadline: December 1 to December 31" />
          <FilterTypeCard title="Combined Filters" description="Multiple filters applied simultaneously (AND condition)" example="Status = 'In Progress' AND Assignee = 'John'" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Sorting</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <div className="flex items-center gap-3 mb-4">
            <ArrowUpDown className="w-5 h-5 text-[var(--text-tertiary)]" />
            <span className="text-[var(--text-primary)]">Record ordering</span>
          </div>
          <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
            <li>• Click column header — sort ascending</li>
            <li>• Click again — sort descending</li>
            <li>• Works for text, numbers, and dates</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function WidgetsSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <LayoutGrid className="inline w-8 h-8 mr-2 text-pink-500" />
          Widgets & Dashboards
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Widgets let you display table data on a dashboard in a convenient format. 
          Create overview panels for quick monitoring.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Creating a Widget</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <ol className="space-y-4">
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-pink-500 text-white text-sm flex items-center justify-center">1</span>
              <span className="text-[var(--text-secondary)]">
                Go to the space dashboard and click <kbd className="px-2 py-0.5 bg-[var(--bg-tertiary)] rounded text-xs">+ Add Widget</kbd>
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-pink-500 text-white text-sm flex items-center justify-center">2</span>
              <span className="text-[var(--text-secondary)]">Choose view type (kanban, calendar, chart, etc.)</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-pink-500 text-white text-sm flex items-center justify-center">3</span>
              <span className="text-[var(--text-secondary)]">Select the source table</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-pink-500 text-white text-sm flex items-center justify-center">4</span>
              <span className="text-[var(--text-secondary)]">Configure field mapping and filters in widget settings</span>
            </li>
          </ol>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Widget Types</h2>
        <div className="grid grid-cols-2 gap-4">
          <WidgetCard icon={<Table2 />} name="Table" color="purple" />
          <WidgetCard icon={<LayoutGrid />} name="Kanban" color="cyan" />
          <WidgetCard icon={<Calendar />} name="Calendar" color="emerald" />
          <WidgetCard icon={<GitBranch />} name="Timeline" color="amber" />
          <WidgetCard icon={<BarChart3 />} name="Chart" color="pink" />
          <WidgetCard icon={<ListTodo />} name="Checklist" color="green" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Dashboard Management</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <ul className="space-y-3 text-[var(--text-secondary)]">
            <li className="flex items-start gap-3">
              <span className="text-[var(--text-primary)]">📐</span>
              <span><strong className="text-[var(--text-primary)]">Resize</strong> — drag the widget corner</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-[var(--text-primary)]">↕️</span>
              <span><strong className="text-[var(--text-primary)]">Move</strong> — drag the widget by its header</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-[var(--text-primary)]">⚙️</span>
              <span><strong className="text-[var(--text-primary)]">Settings</strong> — click the gear icon in widget corner</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-[var(--text-primary)]">🗑️</span>
              <span><strong className="text-[var(--text-primary)]">Delete</strong> — via widget settings menu</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function AutomationsSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Zap className="inline w-8 h-8 mr-2 text-yellow-500" />
          Automations
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Automate routine actions. When a certain event occurs — the system 
          automatically performs specified actions.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Triggers (When to Run)</h2>
        <div className="space-y-3">
          <TriggerCard title="Record Created" description="When a new record is added to the table" />
          <TriggerCard title="Record Updated" description="When any field of a record changes" />
          <TriggerCard title="Field Changed" description="When a specific field changes (e.g., status)" />
          <TriggerCard title="Record Deleted" description="When a record is removed from the table" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Actions (What to Do)</h2>
        <div className="space-y-3">
          <ActionTypeCard title="Send Notification" description="Email or push notification to user" />
          <ActionTypeCard title="Update Record" description="Automatically change record fields" />
          <ActionTypeCard title="Create Record" description="Add new record to this or another table" />
          <ActionTypeCard title="Call Webhook" description="Send HTTP request to external service" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Automation Examples</h2>
        <div className="space-y-4">
          <AutomationExample trigger="Task status → 'Done'" action="Notify task author" />
          <AutomationExample trigger="New request created" action="Assign responsible manager" />
          <AutomationExample trigger="Deadline in 1 day" action="Remind the assignee" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Webhooks</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <div className="flex items-center gap-3 mb-4">
            <Webhook className="w-5 h-5 text-indigo-500" />
            <span className="text-[var(--text-primary)]">Integration with external services</span>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Webhooks allow sending data from CRM to external systems on certain events.
          </p>
          <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
            <li>• Integration with Telegram bots</li>
            <li>• Sync with external CRMs</li>
            <li>• Send data to analytics systems</li>
            <li>• Trigger workflows in n8n, Zapier, Make</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function ApiSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Code className="inline w-8 h-8 mr-2 text-indigo-500" />
          API Reference
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          GOD CRM provides a REST API for integration with external systems. 
          All endpoints require authentication.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Authentication</h2>
        <div className="space-y-4">
          <p className="text-[var(--text-secondary)]">
            The API supports two authentication methods: JWT tokens and API keys.
          </p>
          
          <div className="bg-primary-500/10 rounded-xl p-6 border border-primary-500/30">
            <div className="flex items-center gap-3 mb-4">
              <Key className="w-5 h-5 text-primary-500" />
              <span className="text-[var(--text-primary)] font-medium">🔑 API Keys (recommended for integrations)</span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Create an API key in Settings → API Keys. Keys start with <code className="bg-[var(--bg-secondary)] px-1 rounded">sk-</code>
            </p>
            <CodeBlock code={`X-API-Key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`} />
            <p className="text-sm text-[var(--text-secondary)] mt-3 mb-2">Or via Authorization header:</p>
            <CodeBlock code={`Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`} />
          </div>
          
          <div className="bg-emerald-500/10 rounded-xl p-6 border border-emerald-500/30">
            <div className="flex items-center gap-3 mb-4">
              <Key className="w-5 h-5 text-emerald-500" />
              <span className="text-[var(--text-primary)] font-medium">🎫 JWT Tokens (for web applications)</span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Get a token via <code className="bg-[var(--bg-secondary)] px-1 rounded">POST /api/v3/auth/login</code>
            </p>
            <CodeBlock code={`Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Base URL</h2>
        <CodeBlock code={`https://crm.hltrn.cc/api/v3`} />
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">API Keys Management</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/api-keys" description="List your API keys" />
          <ApiEndpoint method="POST" path="/api-keys" description="Create a new API key" body={`{
  "name": "n8n Integration",
  "scopes": ["*"],
  "expires_in_days": 90
}`} />
          <ApiEndpoint method="DELETE" path="/api-keys/:id" description="Revoke an API key" />
          
          <div className="bg-yellow-500/10 rounded-xl p-4 border border-yellow-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Available Scopes</h4>
            <div className="grid grid-cols-2 gap-2 text-sm text-[var(--text-secondary)]">
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">*</code> — full access</span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">tables:read</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">tables:write</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">rows:read</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">rows:write</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">widgets:read</code></span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">widgets:write</code></span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Tables API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/tables" description="List all tables" response={`{
  "success": true,
  "data": [
    { "id": 1, "name": "tasks", "displayName": "Tasks", ... }
  ]
}`} />
          <ApiEndpoint method="GET" path="/tables/:id" description="Get table details" response={`{
  "success": true,
  "data": { "id": 1, "name": "tasks", "columns": [...] }
}`} />
          <ApiEndpoint method="POST" path="/tables" description="Create a new table" body={`{
  "name": "contacts",
  "displayName": "Contacts",
  "projectId": 1,
  "columns": [
    { "name": "name", "type": "text" },
    { "name": "email", "type": "email" }
  ]
}`} />
          <ApiEndpoint method="PUT" path="/tables/:id" description="Update table settings" />
          <ApiEndpoint method="DELETE" path="/tables/:id" description="Delete a table" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Columns API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/tables/:tableId/columns" description="List table columns" />
          <ApiEndpoint method="POST" path="/tables/:tableId/columns" description="Add a column" body={`{
  "name": "status",
  "displayName": "Status",
  "type": "select",
  "config": {
    "options": [
      { "value": "new", "label": "New", "color": "#3b82f6" },
      { "value": "done", "label": "Done", "color": "#22c55e" }
    ]
  }
}`} />
          <ApiEndpoint method="PUT" path="/tables/:tableId/columns/:columnId" description="Update column" />
          <ApiEndpoint method="DELETE" path="/tables/:tableId/columns/:columnId" description="Delete column" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Rows API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/tables/:tableId/rows" description="List rows with pagination" response={`{
  "success": true,
  "data": {
    "rows": [
      { "id": 1, "data": { "name": "John", "email": "john@example.com" } }
    ],
    "pagination": { "page": 1, "limit": 50, "total": 100, "pages": 2 }
  }
}`} />
          <ApiEndpoint method="GET" path="/tables/:tableId/rows/:rowId" description="Get single row" />
          <ApiEndpoint method="POST" path="/tables/:tableId/rows" description="Create a row" body={`{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "status": "new"
}`} />
          <ApiEndpoint method="PUT" path="/tables/:tableId/rows/:rowId" description="Update a row" body={`{
  "status": "done"
}`} />
          <ApiEndpoint method="DELETE" path="/tables/:tableId/rows/:rowId" description="Delete a row" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Spaces & Projects API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/spaces" description="List all spaces" />
          <ApiEndpoint method="POST" path="/spaces" description="Create a space" body={`{
  "name": "My Workspace",
  "icon": "🚀",
  "type": "business"
}`} />
          <ApiEndpoint method="GET" path="/projects" description="List all projects" />
          <ApiEndpoint method="POST" path="/projects" description="Create a project" body={`{
  "name": "Sales CRM",
  "spaceId": 1,
  "icon": "💼"
}`} />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Widgets API</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/widgets" description="List widgets" />
          <ApiEndpoint method="GET" path="/widgets/:id" description="Get widget details" />
          <ApiEndpoint method="POST" path="/widgets" description="Create a widget" body={`{
  "dashboardId": 1,
  "presetName": "kanban_board",
  "title": "Tasks Board",
  "config": {
    "tableId": 5,
    "groupByColumn": "status"
  }
}`} />
          <ApiEndpoint method="PUT" path="/widgets/:id" description="Update widget" />
          <ApiEndpoint method="DELETE" path="/widgets/:id" description="Delete widget" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Error Responses</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            All errors follow a consistent format:
          </p>
          <CodeBlock code={`{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": { "field": "email", "issue": "Invalid email format" }
  }
}`} />
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs font-mono">400</span>
              <span className="text-[var(--text-secondary)]">Bad Request — invalid input</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs font-mono">401</span>
              <span className="text-[var(--text-secondary)]">Unauthorized — missing or invalid token</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded text-xs font-mono">403</span>
              <span className="text-[var(--text-secondary)]">Forbidden — insufficient permissions</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 bg-gray-500/20 text-gray-400 rounded text-xs font-mono">404</span>
              <span className="text-[var(--text-secondary)]">Not Found — resource doesn't exist</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs font-mono">500</span>
              <span className="text-[var(--text-secondary)]">Server Error — something went wrong</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// === HELPER COMPONENTS ===

function FeatureCard({ icon, title, description, color }: { icon: React.ReactNode; title: string; description: string; color: string }) {
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-500/10 text-purple-500',
    cyan: 'bg-cyan-500/10 text-cyan-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
    amber: 'bg-amber-500/10 text-amber-500',
  };
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className={`w-12 h-12 rounded-xl ${colorClasses[color]} flex items-center justify-center mb-3`}>{icon}</div>
      <h3 className="font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

function QuickStartStep({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary-500 text-white font-semibold flex items-center justify-center">{number}</span>
      <div>
        <h4 className="font-medium text-[var(--text-primary)]">{title}</h4>
        <p className="text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
    </li>
  );
}

function ExampleCard({ emoji, title, items }: { emoji: string; title: string; items: string[] }) {
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">{emoji}</span>
        <span className="font-medium text-[var(--text-primary)]">{title}</span>
      </div>
      <ul className="text-sm text-[var(--text-secondary)] space-y-1">
        {items.map((item, i) => <li key={i}>• {item}</li>)}
      </ul>
    </div>
  );
}

function ActionCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] flex items-start gap-3">
      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">{icon}</div>
      <div>
        <h4 className="font-medium text-[var(--text-primary)]">{title}</h4>
        <p className="text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
    </div>
  );
}

function ViewTypeCard({ icon, title, description, color, useCases }: { icon: React.ReactNode; title: string; description: string; color: string; useCases: string[] }) {
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-500/10 text-purple-500', cyan: 'bg-cyan-500/10 text-cyan-500',
    emerald: 'bg-emerald-500/10 text-emerald-500', amber: 'bg-amber-500/10 text-amber-500',
    pink: 'bg-pink-500/10 text-pink-500', green: 'bg-green-500/10 text-green-500',
    indigo: 'bg-indigo-500/10 text-indigo-500',
  };
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-xl ${colorClasses[color]} flex items-center justify-center flex-shrink-0`}>{icon}</div>
        <div className="flex-1">
          <h3 className="font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
          <p className="text-sm text-[var(--text-secondary)] mb-2">{description}</p>
          <div className="flex flex-wrap gap-2">
            {useCases.map((useCase, i) => (
              <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">{useCase}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ColumnTypeRow({ type, name, description }: { type: string; name: string; description: string }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <code className="px-2 py-1 text-xs bg-[var(--bg-tertiary)] rounded text-primary-400 w-24 text-center">{type}</code>
      <div className="flex-1">
        <span className="font-medium text-[var(--text-primary)]">{name}</span>
        <span className="text-[var(--text-tertiary)] mx-2">—</span>
        <span className="text-sm text-[var(--text-secondary)]">{description}</span>
      </div>
    </div>
  );
}

function SettingCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <h4 className="font-medium text-[var(--text-primary)] text-sm">{title}</h4>
      <p className="text-xs text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

function FilterTypeCard({ title, description, example }: { title: string; description: string; example: string }) {
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <h3 className="font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-secondary)] mb-2">{description}</p>
      <code className="block px-3 py-2 text-xs bg-[var(--bg-tertiary)] rounded-lg text-emerald-400">{example}</code>
    </div>
  );
}

function WidgetCard({ icon, name, color }: { icon: React.ReactNode; name: string; color: string }) {
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-500', cyan: 'bg-cyan-500', emerald: 'bg-emerald-500',
    amber: 'bg-amber-500', pink: 'bg-pink-500', green: 'bg-green-500',
  };
  return (
    <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg ${colorClasses[color]} flex items-center justify-center text-white`}>{icon}</div>
      <span className="font-medium text-[var(--text-primary)]">{name}</span>
    </div>
  );
}

function TriggerCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <Zap className="w-5 h-5 text-yellow-500 flex-shrink-0" />
      <div>
        <h4 className="font-medium text-[var(--text-primary)]">{title}</h4>
        <p className="text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
    </div>
  );
}

function ActionTypeCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <ChevronRight className="w-5 h-5 text-primary-500 flex-shrink-0" />
      <div>
        <h4 className="font-medium text-[var(--text-primary)]">{title}</h4>
        <p className="text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
    </div>
  );
}

function AutomationExample({ trigger, action }: { trigger: string; action: string }) {
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-center gap-2 text-sm">
        <span className="px-2 py-1 rounded bg-yellow-500/10 text-yellow-500">WHEN</span>
        <span className="text-[var(--text-primary)]">{trigger}</span>
      </div>
      <div className="flex items-center gap-2 text-sm mt-2">
        <span className="px-2 py-1 rounded bg-primary-500/10 text-primary-500">THEN</span>
        <span className="text-[var(--text-primary)]">{action}</span>
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="px-4 py-3 bg-[var(--bg-tertiary)] rounded-lg overflow-x-auto">
      <code className="text-sm text-emerald-400 whitespace-pre">{code}</code>
    </pre>
  );
}

function ApiEndpoint({ method, path, description, body, response }: { method: string; path: string; description: string; body?: string; response?: string }) {
  const methodColors: Record<string, string> = {
    GET: 'bg-emerald-500/20 text-emerald-400',
    POST: 'bg-primary-500/20 text-primary-400',
    PUT: 'bg-amber-500/20 text-amber-400',
    PATCH: 'bg-amber-500/20 text-amber-400',
    DELETE: 'bg-red-500/20 text-red-400',
  };
  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-center gap-3 mb-2">
        <span className={`px-2 py-1 rounded text-xs font-mono font-semibold ${methodColors[method]}`}>{method}</span>
        <code className="text-sm text-[var(--text-primary)]">{path}</code>
      </div>
      <p className="text-sm text-[var(--text-secondary)] mb-3">{description}</p>
      {body && (
        <div className="mb-3">
          <p className="text-xs text-[var(--text-tertiary)] mb-1">Request Body:</p>
          <CodeBlock code={body} />
        </div>
      )}
      {response && (
        <div>
          <p className="text-xs text-[var(--text-tertiary)] mb-1">Response:</p>
          <CodeBlock code={response} />
        </div>
      )}
    </div>
  );
}

// === AI AGENTS API SECTION ===

function AIAgentsApiSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Bot className="inline w-8 h-8 mr-2 text-violet-500" />
          AI Agents API
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          API for working with AI agents, providers, and models. Manage artificial 
          intelligence in your workspace.
        </p>
      </header>

      {/* Overview */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🎯 Overview</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/30">
            <Bot className="w-6 h-6 text-violet-500 mb-2" />
            <h4 className="font-medium text-[var(--text-primary)]">AI Agents</h4>
            <p className="text-sm text-[var(--text-secondary)]">Create and manage intelligent assistants</p>
          </div>
          <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30">
            <MessageSquare className="w-6 h-6 text-primary-500 mb-2" />
            <h4 className="font-medium text-[var(--text-primary)]">Chat with Agents</h4>
            <p className="text-sm text-[var(--text-secondary)]">Send messages and receive AI responses</p>
          </div>
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <Cpu className="w-6 h-6 text-emerald-500 mb-2" />
            <h4 className="font-medium text-[var(--text-primary)]">Providers</h4>
            <p className="text-sm text-[var(--text-secondary)]">OpenAI, Anthropic, Google, Ollama</p>
          </div>
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <RefreshCw className="w-6 h-6 text-amber-500 mb-2" />
            <h4 className="font-medium text-[var(--text-primary)]">Models</h4>
            <p className="text-sm text-[var(--text-secondary)]">GPT-4, Claude, Gemini and more</p>
          </div>
        </div>
      </section>

      {/* Base URL */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🌐 Base URL</h2>
        <CodeBlock code="https://crm.hltrn.cc/api/v3/ai" />
      </section>

      {/* Agents API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🤖 Agents</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/ai/agents" description="Get list of all agents" />
          <ApiEndpoint method="GET" path="/ai/agents/:spaceId" description="Get agents for a specific space" />
          <ApiEndpoint method="POST" path="/ai/agents" description="Create a new agent" body={`{
  "name": "Sales Assistant",
  "description": "Helps with sales data",
  "model": "gpt-4-turbo",
  "provider": "openai",
  "system_prompt": "You are a helpful sales assistant...",
  "tools": ["query_table_data", "create_row"]
}`} />
          <ApiEndpoint method="PATCH" path="/ai/agents/:id" description="Update an agent" />
          <ApiEndpoint method="DELETE" path="/ai/agents/:id" description="Delete an agent" />
        </div>
      </section>

      {/* Chat API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">💬 Chat with Agent</h2>
        <div className="space-y-4">
          <ApiEndpoint method="POST" path="/ai/chat" description="Send a message to agent and receive response" body={`{
  "agentId": 1,
  "message": "Show me sales statistics for this month",
  "conversationId": "conv_abc123",
  "context": { "spaceId": 5, "tableId": 12 }
}`} />
          
          <div className="p-4 rounded-xl bg-primary-500/10 border border-primary-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Response Example</h4>
            <CodeBlock code={`{
  "success": true,
  "response": "Here's the sales data for this month...",
  "conversationId": "conv_abc123",
  "model": "gpt-4-turbo",
  "usage": {
    "promptTokens": 150,
    "completionTokens": 85,
    "totalTokens": 235
  }
}`} />
          </div>
          
          <ApiEndpoint method="GET" path="/ai/conversations/:conversationId" description="Get conversation history" />
          <ApiEndpoint method="DELETE" path="/ai/conversations/:conversationId" description="Delete a conversation" />
        </div>
      </section>

      {/* Providers API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🔌 AI Providers</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/ai/providers" description="Get list of AI providers" />
          
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Supported Providers</h4>
            <div className="grid grid-cols-2 gap-2 text-sm text-[var(--text-secondary)]">
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">openai</code> — OpenAI (GPT-4, GPT-3.5)</span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">anthropic</code> — Anthropic (Claude)</span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">google</code> — Google (Gemini)</span>
              <span>• <code className="bg-[var(--bg-secondary)] px-1 rounded">ollama</code> — Ollama (local models)</span>
            </div>
          </div>

          <ApiEndpoint method="POST" path="/ai/providers" description="Add a provider" body={`{
  "name": "OpenAI",
  "provider_key": "openai",
  "base_url": "https://api.openai.com/v1",
  "is_active": true
}`} />
          <ApiEndpoint method="PATCH" path="/ai/providers/:id" description="Update a provider" />
          <ApiEndpoint method="DELETE" path="/ai/providers/:id" description="Delete a provider" />
        </div>
      </section>

      {/* Models API */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🧠 Models</h2>
        <div className="space-y-4">
          <ApiEndpoint method="GET" path="/ai/models" description="Get list of all models" />
          <ApiEndpoint method="GET" path="/ai/models?providerId=:id" description="Get models for a specific provider" />
          
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Popular Models</h4>
            <div className="space-y-2 text-sm text-[var(--text-secondary)]">
              <p><strong>OpenAI:</strong> gpt-4-turbo, gpt-4o, gpt-3.5-turbo</p>
              <p><strong>Anthropic:</strong> claude-3-5-sonnet-20241022, claude-3-opus</p>
              <p><strong>Google:</strong> gemini-1.5-pro, gemini-1.5-flash</p>
              <p><strong>Ollama:</strong> llama3.2, mistral, codellama</p>
            </div>
          </div>

          <ApiEndpoint method="POST" path="/ai/models" description="Add a model" body={`{
  "provider_id": 1,
  "model_id": "gpt-4-turbo",
  "display_name": "GPT-4 Turbo",
  "context_window": 128000,
  "is_active": true
}`} />
          <ApiEndpoint method="PATCH" path="/ai/models/:id" description="Update a model" />
          <ApiEndpoint method="DELETE" path="/ai/models/:id" description="Delete a model" />
        </div>
      </section>

      {/* Refresh Models */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🔄 Refresh Models</h2>
        <div className="space-y-4">
          <ApiEndpoint method="POST" path="/ai/providers/:providerId/refresh-models" description="Refresh model list from provider API" />
          
          <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Response Example</h4>
            <CodeBlock code={`{
  "success": true,
  "message": "Updated models: 17",
  "added": 12,
  "updated": 5,
  "models": [
    { "model_id": "gpt-4-turbo", "display_name": "GPT-4 Turbo" },
    { "model_id": "gpt-4o", "display_name": "GPT-4o" }
  ]
}`} />
          </div>

          <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">⚠️ Important</h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Refreshing models requires a configured API key for the provider in the API Keys table.
              Automatic refresh is supported for OpenAI and Anthropic.
            </p>
          </div>
        </div>
      </section>

      {/* Agent Tools */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">🛠️ Agent Tools</h2>
        <div className="space-y-4">
          <p className="text-[var(--text-secondary)]">
            Agents can use tools to interact with the CRM.
          </p>
          
          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] divide-y divide-[var(--border-primary)]">
            <ToolRow name="get_workspace_info" description="Get information about spaces, projects, and tables" />
            <ToolRow name="query_table_data" description="Query data from a table" />
            <ToolRow name="create_table" description="Create a new table" />
            <ToolRow name="create_row" description="Add a record to a table" />
            <ToolRow name="update_row" description="Update a record in a table" />
            <ToolRow name="create_dashboard" description="Create a dashboard" />
            <ToolRow name="create_widget" description="Add a widget to dashboard" />
            <ToolRow name="search_records" description="Search records by criteria" />
          </div>
        </div>
      </section>

      {/* Examples */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">💡 Usage Examples</h2>
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border-primary)] overflow-hidden">
            <div className="px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
              <span className="text-sm font-medium text-[var(--text-primary)]">Send message to agent (cURL)</span>
            </div>
            <CodeBlock code={`curl -X POST https://crm.hltrn.cc/api/v3/ai/chat \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -d '{
    "agentId": 1,
    "message": "Show sales statistics for this month",
    "context": { "spaceId": 5, "tableId": 12 }
  }'`} />
          </div>
          
          <div className="rounded-xl border border-[var(--border-primary)] overflow-hidden">
            <div className="px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
              <span className="text-sm font-medium text-[var(--text-primary)]">JavaScript / Fetch</span>
            </div>
            <CodeBlock code={`const response = await fetch('/api/v3/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agentId: 1,
    message: 'Create a report on tasks',
    conversationId: 'conv_existing_id'
  })
});

const { response: aiResponse, usage } = await response.json();
logger.debug('AI responded:', aiResponse);
logger.debug('Tokens used:', usage.totalTokens);`} />
          </div>
        </div>
      </section>

      {/* Error Handling */}
      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">⚠️ Error Handling</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-red-500">400</span>
              <span className="text-[var(--text-secondary)] ml-2">Bad Request</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-yellow-500">401</span>
              <span className="text-[var(--text-secondary)] ml-2">Unauthorized</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-orange-500">404</span>
              <span className="text-[var(--text-secondary)] ml-2">Agent Not Found</span>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
              <span className="font-mono text-red-500">500</span>
              <span className="text-[var(--text-secondary)] ml-2">AI Provider Error</span>
            </div>
          </div>
          <CodeBlock code={`{
  "success": false,
  "error": "AI_PROVIDER_ERROR",
  "message": "OpenAI API rate limit exceeded",
  "details": {
    "provider": "openai",
    "model": "gpt-4-turbo"
  }
}`} />
        </div>
      </section>
    </div>
  );
}

function ToolRow({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <code className="px-2 py-1 text-xs bg-violet-500/20 rounded text-violet-400 font-mono">
        {name}
      </code>
      <span className="text-sm text-[var(--text-secondary)]">{description}</span>
    </div>
  );
}

export default HelpPageEn;
