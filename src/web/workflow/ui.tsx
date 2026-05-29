import {
  DefaultToolbar,
  DefaultToolbarContent,
  TldrawUiMenuItem,
  useIsToolSelected,
  useTools,
  type Editor,
  type TLUiOverrides,
  type TLUiToolItem,
} from 'tldraw';
import { WF_TOOL_DEFS, type WfToolDef } from './tools.ts';

function iconFor(def: WfToolDef): string {
  if (def.group === 'connection') return 'tool-arrow';
  return 'geo-rectangle';
}

/** Register the workflow tools so they get labels, keyboard shortcuts, and
 *  toolbar entries. */
export const wfUiOverrides: TLUiOverrides = {
  tools(editor: Editor, tools) {
    for (const def of WF_TOOL_DEFS) {
      tools[def.id] = {
        id: def.id,
        label: def.label,
        icon: iconFor(def),
        kbd: def.kbd,
        onSelect: () => editor.setCurrentTool(def.id),
      };
    }
    return tools;
  },
};

function WfToolbarItem({ item }: { item: TLUiToolItem }) {
  const isSelected = useIsToolSelected(item);
  return <TldrawUiMenuItem {...item} isSelected={isSelected} />;
}

/** Toolbar = the default tools plus the workflow primitive + connection tools. */
export function WfToolbar() {
  const tools = useTools();
  return (
    <DefaultToolbar>
      <DefaultToolbarContent />
      {WF_TOOL_DEFS.map(def => {
        const item = tools[def.id];
        return item ? <WfToolbarItem key={def.id} item={item} /> : null;
      })}
    </DefaultToolbar>
  );
}
