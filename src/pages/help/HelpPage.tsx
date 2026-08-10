/**
 * @legacy
 * @deprecated Will be replaced by the Documents module (ADR-117 Documents 2.0).
 * See ROADMAP-001 Phase 1.3 — split god components.
 * This file is a static help page; all content should migrate to CRM Documents.
 */
import { useState, useEffect } from 'react';
import {
  Book, Database, Eye, Columns, Filter, LayoutGrid,
  Zap, Code2, Bot, Cpu, Layers,
} from 'lucide-react';
import { setPageTitle } from '@/shared/utils/pageTitle';
import type { HelpSection } from './types';
import { IntroSection } from './IntroSection';
import { SpacesSection } from './SpacesSection';
import { TablesSection } from './TablesSection';
import { ViewsSection } from './ViewsSection';
import { ColumnsSection } from './ColumnsSection';
import { FiltersSection } from './FiltersSection';
import { WidgetsSection } from './WidgetsSection';
import { AutomationsSection } from './AutomationsSection';
import { ApiSection } from './ApiSection';
import { AIAgentsSection } from './AIAgentsSection';
import { AIAgentsApiSection } from './AIAgentsApiSection';

const sections: HelpSection[] = [
  { id: 'intro', title: 'Введение', icon: <Book className="w-5 h-5" /> },
  { id: 'spaces', title: 'Пространства', icon: <Layers className="w-5 h-5" /> },
  { id: 'tables', title: 'Таблицы', icon: <Database className="w-5 h-5" /> },
  { id: 'views', title: 'Представления', icon: <Eye className="w-5 h-5" /> },
  { id: 'columns', title: 'Колонки', icon: <Columns className="w-5 h-5" /> },
  { id: 'filters', title: 'Фильтры и поиск', icon: <Filter className="w-5 h-5" /> },
  { id: 'widgets', title: 'Виджеты', icon: <LayoutGrid className="w-5 h-5" /> },
  { id: 'automations', title: 'Автоматизации', icon: <Zap className="w-5 h-5" /> },
  { id: 'api', title: 'REST API', icon: <Code2 className="w-5 h-5" /> },
  { id: 'ai-agents', title: 'AI Агенты', icon: <Bot className="w-5 h-5" /> },
  { id: 'ai-api', title: 'AI Agents API', icon: <Cpu className="w-5 h-5" /> },
];

export function HelpPage() {
  const [activeSection, setActiveSection] = useState('intro');

  useEffect(() => {
    setPageTitle('Help');
  }, []);

  const renderContent = () => {
    switch (activeSection) {
      case 'intro':
        return <IntroSection />;
      case 'spaces':
        return <SpacesSection />;
      case 'tables':
        return <TablesSection />;
      case 'views':
        return <ViewsSection />;
      case 'columns':
        return <ColumnsSection />;
      case 'filters':
        return <FiltersSection />;
      case 'widgets':
        return <WidgetsSection />;
      case 'automations':
        return <AutomationsSection />;
      case 'api':
        return <ApiSection />;
      case 'ai-agents':
        return <AIAgentsSection />;
      case 'ai-api':
        return <AIAgentsApiSection />;
      default:
        return <IntroSection />;
    }
  };

  return (
    <div className="flex h-full bg-[var(--bg-primary)]">
      {/* Sidebar */}
      <nav className="w-64 flex-shrink-0 border-r border-[var(--border-primary)] overflow-y-auto">
        <div className="p-4">
          <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Book className="w-5 h-5 text-primary-500" />
            Справка
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

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}

export default HelpPage;
