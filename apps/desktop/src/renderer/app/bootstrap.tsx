import { createRoot } from 'react-dom/client';
import { bootstrapRenderer } from './renderer-bootstrap';
import '../shared/styles/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
void bootstrapRenderer(createRoot(root));
