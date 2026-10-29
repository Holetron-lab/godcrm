import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { EditableMarkdownPreview } from '../../features/widgets/components/presets/documents/content/EditableMarkdownPreview';

function Fixture() {
  const [content, setContent] = useState('| Работа | Результат | Метрика |\n| --- | --- | --- |\n| Починить процессы и передать управляющему: управляющий ведёт бизнес внутри GOD CRM и становится самостоятельным. | Версия с правильным статусбаром; еженедельный отчёт и демонстрация новых возможностей. | Сколько недель подряд управляющий закрыл без тебя. |');
  return <main className="mx-auto max-w-3xl p-4">
    <EditableMarkdownPreview content={content} onContentChange={async value => { setContent(value); }} />
    <button type="button">Вне таблицы</button>
    <pre data-testid="saved" className="whitespace-pre-wrap break-all">{content}</pre>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
