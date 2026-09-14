import { createRoot } from 'react-dom/client';
import { App } from './app/App';
// Paper Atelier em módulos; a ordem abaixo é a cascata (mobile por último).
import './app/styles/base.css';
import './app/styles/library.css';
import './app/styles/reader.css';
import './app/styles/webtoon.css';
import './app/styles/modals.css';
import './app/styles/mobile.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Tactile Reader root element was not found.');
}

createRoot(root).render(<App />);
