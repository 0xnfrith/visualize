export type RenderKind = 'd2' | 'svg' | 'image';
export type D2Layout = 'dagre' | 'elk' | 'tala';

export type RenderSpec =
  | { kind: 'd2'; source: string; layout?: D2Layout }
  | { kind: 'svg'; source: string }
  | { kind: 'image'; url: string; mime: 'image/png' | 'image/jpeg' };

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Entry {
  id: string;
  title: string;
  spec: RenderSpec;
  bytes: Uint8Array;
  mime: string;
  size: Size;
  position: Point;
  page: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertInput {
  id?: string;
  title?: string;
  spec: RenderSpec;
  page?: string;
  position?: Point;
  size?: Size;
}

export type OperatorEvent =
  | { type: 'moved'; id: string; from: Point; to: Point }
  | { type: 'removed'; id: string; title: string }
  | { type: 'selected'; ids: string[] };
