import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ImageCell } from '@/features/tables/components/cells/ImageCell';
import { VectorCell } from '@/features/tables/components/cells/VectorCell';
import { VerificationCell } from '@/features/tables/components/cells/VerificationCell';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { tablesApi } from '@/features/tables/api/tablesApi';

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
let generations = 0;
tablesApi.generateVectorCell = async () => ({ success: true, result: { text: `Generated ${++generations}`, text_length: 11, embedding_dimension: 0, generated_at: '2026-09-22' } });
const thumbnail = 'src/tests/cell-actions-fixture/thumbnail.svg';
function Fixture() {
  const [images, setImages] = useState(thumbnail);
  return <main className="p-4 text-[var(--text-primary)]">
    <h1>Cell actions</h1>
    <button type="button">Outside</button>
    <section aria-label="Images" className="my-4">
      <ImageCell value={images} onUpdate={setImages} config={{ file: { prefix: '/' } }} />
    </section>
    <section aria-label="Vector" className="my-4">
      <VectorCell value="" tableId={1} rowId={2} columnId="vector" />
    </section>
    <section aria-label="Verification" className="my-4">
      <VerificationCell value={{ verified: true, verified_by_user_id: 1, audit_log: [{ at: '2026-09-01', actor: 1, event: 'verified', reason: 'Checked' }] }} />
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture /></LanguageProvider>);
