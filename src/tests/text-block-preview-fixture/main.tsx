import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TextBlockPreview } from '@/features/tables/components/FormBuilder/TextBlockComponents';
import type { FormTextBlock } from '@/features/tables/types/form-config.types';

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
const block: FormTextBlock = { id: 'text-1', type: 'text', order: 1, contentType: 'html',
  content: '<p>Инструкция к заявке: заполните обязательные поля.</p><a href="#help">Справка</a>' };
function Fixture() {
  const [events, setEvents] = useState<string[]>([]);
  const record = (event: string) => setEvents(previous => [...previous, event]);
  return <main className="p-4 max-w-2xl mx-auto">
    <h1>Выбор текстового блока</h1>
    <form onSubmit={event => { event.preventDefault(); record('submit'); }}>
      <TextBlockPreview block={block} isSelected={events.length > 0} onClick={() => record('select')} />
    </form>
    <section aria-label="Предпросмотр">
      <TextBlockPreview block={{ ...block, content: 'Текст для просмотра' }} isSelected={false} isPreviewMode onClick={() => record('preview')} />
    </section>
    <p id="help">Справка по заполнению</p>
    <output aria-label="События">{events.join(',')}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
