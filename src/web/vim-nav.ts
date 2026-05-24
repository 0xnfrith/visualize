import type { Editor } from 'tldraw';

// Vim-style keyboard navigation. `space` enters nav mode, after which
// hjkl pan / i,o zoom / 0 reset / gg fit / zz fit-selection / Esc exits.
// While in nav mode the listener fully owns input — every recognised key
// is preventDefault'd so tldraw's own shortcuts don't fire. Unrecognised
// keys (except the chord prefixes g and z) drop nav mode vim-style.

const PAN_STEP_PX = 150;
const PAN_BIG_PX = 500;
const CHORD_WINDOW_MS = 800;

type Chord = 'g' | 'z' | null;

export function attachVimNav(editor: Editor): () => void {
  // Badge. Hidden until nav mode is entered. Hardcoded dark styling —
  // the canvas defaults to dark and theme-aware styling is out of scope
  // for this iteration.
  const badge = document.createElement('div');
  badge.textContent = 'NAV';
  badge.setAttribute('data-vim-nav-badge', '');
  Object.assign(badge.style, {
    position: 'fixed',
    bottom: '12px',
    right: '12px',
    padding: '4px 10px',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.08em',
    color: 'rgba(255, 255, 255, 0.85)',
    background: 'rgba(20, 20, 24, 0.75)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '999px',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: '2147483600',
    display: 'none',
  } as CSSStyleDeclaration);
  document.body.appendChild(badge);

  let navMode = false;
  let pendingChord: Chord = null;
  let chordExpiresAt = 0;

  const setNavMode = (on: boolean) => {
    navMode = on;
    badge.style.display = on ? 'block' : 'none';
    if (!on) {
      pendingChord = null;
      chordExpiresAt = 0;
    }
  };

  const isEditableElement = (el: Element | null): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    return false;
  };

  // Editable check consults both the event target AND document.activeElement.
  // At window-capture, e.target can be the tldraw container while the actual
  // focus (and the contenteditable that should receive the key) is a child.
  const isEditableContext = (target: EventTarget | null): boolean => {
    if (target instanceof Element && isEditableElement(target)) return true;
    if (isEditableElement(document.activeElement)) return true;
    return false;
  };

  const panBy = (dxScreen: number, dyScreen: number) => {
    const cam = editor.getCamera();
    const z = editor.getZoomLevel() || 1;
    // setCamera({x: -px, y: -py}) centers the viewport on page point
    // (px, py) — see Editor.centerOnPoint. So to pan the view right by
    // `dxScreen` px (content shifts left visually), decrease camera.x by
    // `dxScreen / z` page units.
    editor.setCamera({
      x: cam.x - dxScreen / z,
      y: cam.y - dyScreen / z,
      z: cam.z,
    });
  };

  const handlePanKey = (key: string, big: boolean): boolean => {
    const step = big ? PAN_BIG_PX : PAN_STEP_PX;
    switch (key) {
      case 'h':
        panBy(-step, 0);
        return true;
      case 'j':
        panBy(0, step);
        return true;
      case 'k':
        panBy(0, -step);
        return true;
      case 'l':
        panBy(step, 0);
        return true;
      default:
        return false;
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Don't interfere with text editing — applies even inside nav mode so
    // clicking into a diagram label and typing still works. Two signals:
    // (a) tldraw's own "I'm editing a shape's text" flag, which is the
    // most accurate, and (b) DOM-level focus on input/textarea/contentEditable.
    if (editor.getEditingShapeId()) return;
    if (isEditableContext(e.target)) return;

    // Meta/Ctrl/Alt always pass through so OS / browser / tldraw shortcuts
    // keep working. Shift is allowed — it's meaningful for H/J/K/L big-pan
    // and ignored on other bindings.
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key;
    const lower = key.toLowerCase();

    if (!navMode) {
      // Enter nav mode on a bare space tap. preventDefault so tldraw's
      // hold-space-to-pan never sees it. The !e.repeat guard means a held
      // space only enters once (no flicker).
      if (key === ' ' && !e.shiftKey && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        setNavMode(true);
        return;
      }
      return;
    }

    // --- In nav mode from here on ---

    // Re-pressed or auto-repeating space: consume it (no-op). Without this,
    // OS auto-repeat lands here, no binding matches, the catch-all exits
    // nav mode WITHOUT preventDefault, and tldraw's hold-space-to-pan
    // engages. So holding space slightly too long would otherwise drop
    // the operator out of nav mode and start a tldraw pan gesture.
    if (key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setNavMode(false);
      return;
    }

    // Bare Shift keydown (no other key) — no-op, stay in nav mode. Without
    // this, pressing Shift fires its own keydown with key === 'Shift', and
    // it would fall through to the catch-all and exit nav mode. This means
    // any Shift+letter combo (e.g. Shift+I attempting capital "I") would
    // exit nav mode on the leading Shift before the letter ever arrived.
    // (Ctrl/Alt/Meta are filtered earlier via the modifier-key early-out.)
    if (key === 'Shift') return;

    // Chord resolution. If a chord is pending and still in window, try to
    // complete it; otherwise drop it and fall through to normal handling.
    if (pendingChord && Date.now() <= chordExpiresAt) {
      if (pendingChord === 'g' && key === 'g') {
        e.preventDefault();
        e.stopPropagation();
        pendingChord = null;
        editor.zoomToFit();
        return;
      }
      if (pendingChord === 'z' && key === 'z') {
        e.preventDefault();
        e.stopPropagation();
        pendingChord = null;
        // zoomToSelection is a no-op when the selection is empty —
        // matches the spec.
        if (editor.getSelectedShapeIds().length > 0) {
          editor.zoomToSelection();
        }
        return;
      }
      // Pending chord didn't resolve — clear it and let this key be
      // interpreted as a fresh keystroke below.
      pendingChord = null;
    }

    // Pan keys. Lowercase = small, shift+letter = big. Match on `lower`
    // so H/J/K/L (caps) also work.
    if (lower === 'h' || lower === 'j' || lower === 'k' || lower === 'l') {
      e.preventDefault();
      e.stopPropagation();
      handlePanKey(lower, e.shiftKey);
      return;
    }

    // Shift + anything other than HJKL — swallow as a no-op. Stay in nav
    // mode. Accidentally hitting Shift+I (etc.) shouldn't zoom AND shouldn't
    // drop nav mode; the operator explicitly wants shift+non-HJKL ignored.
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (key === 'i') {
      e.preventDefault();
      e.stopPropagation();
      editor.zoomIn();
      return;
    }
    if (key === 'o') {
      e.preventDefault();
      e.stopPropagation();
      editor.zoomOut();
      return;
    }
    if (key === '0') {
      e.preventDefault();
      e.stopPropagation();
      editor.resetZoom();
      return;
    }

    // Chord prefixes — arm and stay in nav mode.
    if (key === 'g' || key === 'z') {
      e.preventDefault();
      e.stopPropagation();
      pendingChord = key;
      chordExpiresAt = Date.now() + CHORD_WINDOW_MS;
      return;
    }

    // Any other key while in nav mode: vim-style abort. We do NOT
    // preventDefault — the operator's intent was to start using tldraw
    // again (e.g. `r` for the rectangle tool), so let the key through.
    setNavMode(false);
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });

  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    badge.remove();
  };
}
