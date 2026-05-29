import { StrictMode, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { connectSocket } from './sync.ts';
import { attachOperatorListeners } from './operator.ts';
import { attachVimNav } from './vim-nav.ts';
import { DiagramShapeUtil } from './diagram-shape.tsx';
import { WfNodeShapeUtil } from './workflow/wf-node-shape.tsx';
import { WfConnectionBindingUtil, WfConnectionShapeUtil } from './workflow/connection.tsx';
import { WF_TOOLS } from './workflow/tools.ts';
import { WfToolbar, wfUiOverrides } from './workflow/ui.tsx';
import { attachWorkflowSerializer } from './workflow/operator-workflow.ts';

const SHAPE_UTILS = [DiagramShapeUtil, WfNodeShapeUtil, WfConnectionShapeUtil];
const BINDING_UTILS = [WfConnectionBindingUtil];
const COMPONENTS = { Toolbar: WfToolbar };

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
    const detachVimNav = attachVimNav(editor);
    const detachWf = attachWorkflowSerializer(editor, socketHandle);
    // Tldraw doesn't unmount during a session, but if it ever does we'd
    // want to clean up — keep the references for hot-reload safety.
    // `socketHandle.close()` stops the auto-reconnect chain in sync.ts.
    return () => {
      detach();
      detachVimNav();
      detachWf();
      socketHandle.close();
    };
  }, []);

  return (
    <Tldraw
      onMount={onMount}
      shapeUtils={SHAPE_UTILS}
      bindingUtils={BINDING_UTILS}
      tools={WF_TOOLS}
      overrides={wfUiOverrides}
      components={COMPONENTS}
    />
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
