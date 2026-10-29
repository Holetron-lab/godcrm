import '../../styles/index.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FilePreviewModal } from '@/features/files/components/FilePreviewModal';

const markdown = '# Document\n\nSelected paragraph\n\n|' + ' Column |'.repeat(20) + '\n|' + ' --- |'.repeat(20) + '\n|' + ' Value |'.repeat(20) + '\n\n' + 'Document body\n\n'.repeat(80);

function Fixture() {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [content, setContent] = useState(markdown);
  useEffect(() => {
    const timer = setInterval(() => setTick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return <main>
    <h1>Document refresh fixture</h1>
    <button onClick={() => setOpen(true)}>Open document</button>
    <output aria-label="Background updates">{tick}</output>
    <FilePreviewModal isOpen={open} onClose={() => setOpen(false)} fileName="Document"
      fileType="markdown" inlineContent={content}
      extraHeaderActions={<button onClick={() => setContent('# Updated document')}>Update content</button>} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
