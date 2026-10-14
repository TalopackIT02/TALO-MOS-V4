import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import { LoginPage } from './pages/auth/LoginPage';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <LoginPage />
  </StrictMode>,
);
