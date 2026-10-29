import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TextBlockSettingsPanel } from '@/features/tables/components/FormBuilder/TextBlockComponents';
import type { FormTextBlock } from '@/features/tables/types/form-config.types';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
function Fixture() {
  const [block, setBlock] = useState<FormTextBlock>({ id: 'text-1', type: 'text', content: 'Инструкция к заявке', order: 1 });
  const [events, setEvents] = useState<string[]>([]);
  const record = (event: string) => setEvents(previous => [...previous, event]);
  return <main className="p-4 max-w-2xl mx-auto">
    <h1 className="mb-4">Настройки текстового блока</h1>
    <form onSubmit={event => { event.preventDefault(); record('submit'); }}>
      <TextBlockSettingsPanel block={block} canMoveUp={false} canMoveDown
        onUpdate={update => { setBlock(previous => ({ ...previous, ...update })); record(Object.keys(update).join(',')); }}
        onMoveUp={() => record('up')} onMoveDown={() => record('down')}
        onDelete={() => record('delete')} onClose={() => record('close')} />
    </form>
    <output className="block break-all mt-4" aria-label="События">{events.join(',')}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
