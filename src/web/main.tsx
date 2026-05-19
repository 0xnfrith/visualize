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
    // First-visit default: force dark mode. This overrides the OS
    // `prefers-color-scheme` for new visitors, who may prefer light. They
    // can switch via Preferences -> Color scheme, which tldraw persists to
    // localStorage; on subsequent visits the persisted value (`'light'`,
    // `'dark'`, or `'system'`) is respected. tldraw is canonical for theme;
    // `operator.ts` reports it back to the server so the agent can pick
    // contrasting diagram colors at draw time.
    if (editor.user.getUserPreferences().colorScheme == null) {
      editor.user.updateUserPreferences({ colorScheme: 'dark' });
    }
    const socketHandle = connectSocket(editor);
    const detach = attachOperatorListeners(editor, socketHandle);
    // Tldraw doesn't unmount during a session, but if it ever does we'd
    // want to clean up — keep the references for hot-reload safety.
    // `socketHandle.close()` stops the auto-reconnect chain in sync.ts.
    return () => {
      detach();
      socketHandle.close();
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
