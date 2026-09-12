import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/app/App';
import { AppErrorBoundary } from '@/components/state/AppErrorBoundary';
import '@/styles/index.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('В index.html нет узла #root');
}

createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
