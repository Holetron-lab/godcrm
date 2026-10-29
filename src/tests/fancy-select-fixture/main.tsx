import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FancySelect } from '@/features/tables/components/UniversalTable/column-settings/DefaultValueInput';

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
function Fixture() {
  const [value, setValue] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [submits, setSubmits] = useState(0);
  return <main className="p-4 max-w-md text-[var(--text-primary)]">
    <h1>Default value selection</h1>
    <form onSubmit={event => { event.preventDefault(); setSubmits(count => count + 1); }}>
      <FancySelect label="Default status" value={value} onChange={setValue} disabled={disabled}
        options={[{ value: 'open', label: 'Open', color: '#777777' }, { value: 'done', label: 'Done', color: '#777777' }]} />
      <button type="button">After select</button>
    </form>
    <label><input type="checkbox" checked={disabled} onChange={event => setDisabled(event.target.checked)} />Use formula</label>
    <output aria-label="Selected value">{value === null ? 'null' : value}</output>
    <output aria-label="Submissions">{submits}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
