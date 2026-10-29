import { createRoot } from 'react-dom/client';
import '@/styles/index.css';
import { Neo16ModuleWidget } from '../../town/TownWidget';
import type { Widget } from '@/features/widgets/types/widget.types';

const response = await fetch('/fixture/widget');
const widget: Widget = await response.json();
createRoot(document.getElementById('root')!).render(
  <div className="h-screen w-full"><Neo16ModuleWidget widget={widget} data={[]} /></div>,
);
