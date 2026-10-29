import "../../styles/index.css";
import { createRoot } from 'react-dom/client';
import { Switch } from '../../shared/components/ui/Switch';

const root = document.getElementById('root');
if (!root) throw new Error('Browser fixture root is missing');

createRoot(root).render(
  <main className="mx-auto max-w-xl p-4">
    <Switch label="Fixture switch" />
  </main>
);
