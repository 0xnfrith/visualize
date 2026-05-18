import { StrictMode, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { connectSocket } from './sync.ts';
import { attachOperatorListeners } from './operator.ts';
import { DiagramShapeUtil } from './diagram-shape.tsx';

const SHAPE_UTILS = [DiagramShapeUtil];

function App() {
  const onMount = useCallback((editor: Editor) => {
    // Default new visitors to dark mode; respect any prior toggle that
    // tldraw has persisted to localStorage. Tldraw is canonical for theme
    // from here on — toggling Preferences -> Color scheme repaints every
    // inlined diagram via the `.tl-theme__dark` ancestor class.
    if (editor.user.getUserPreferences().colorScheme == null) {
      editor.user.updateUserPreferences({ colorScheme: 'dark' });
    }
    const socket = connectSocket(editor);
    const detach = attachOperatorListeners(editor, socket);
    // Tldraw doesn't unmount during a session, but if it ever does we'd
    // want to clean up — keep the references for hot-reload safety.
    return () => {
      detach();
      socket.close();
    };
  }, []);

  return <Tldraw onMount={onMount} shapeUtils={SHAPE_UTILS} />;
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
