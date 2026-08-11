import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Tactile Reader root element was not found.');
}

createRoot(root).render(<App />);
