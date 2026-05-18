import type { RenderKind, RenderSpec, Size } from '../canvas/types.ts';
import { renderD2 } from './d2.ts';
import { renderImage } from './image.ts';
import { renderSvg } from './svg.ts';

export interface ValidationError {
  kind: 'validation' | 'render' | 'internal';
  renderer: RenderKind;
  messages: { line?: number; column?: number; text: string }[];
}

export type RenderResult =
  | {
      ok: true;
      bytes: Uint8Array;
      mime: string;
      size: Size;
    }
  | {
      ok: false;
      error: ValidationError;
    };

export interface Renderer {
  render(spec: RenderSpec): Promise<RenderResult>;
}

export async function render(spec: RenderSpec): Promise<RenderResult> {
  switch (spec.kind) {
    case 'd2':
      return renderD2(spec);
    case 'svg':
      return renderSvg(spec);
    case 'image':
      return renderImage(spec);
  }
}
