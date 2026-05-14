import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './error-boundary';
import '../shared/styles/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
createRoot(root).render(<ErrorBoundary><App /></ErrorBoundary>);
