import { createRoot } from 'react-dom/client';
import '@fontsource-variable/space-grotesk';
import './app/globals.css';
import Home from './app/page';
createRoot(document.getElementById('root')!).render(<Home />);
