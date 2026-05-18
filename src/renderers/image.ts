import type { RenderSpec, Size } from '../canvas/types.ts';
import type { RenderResult } from './registry.ts';

const MAX_BYTES = 10 * 1024 * 1024;

export async function renderImage(
  spec: Extract<RenderSpec, { kind: 'image' }>
): Promise<RenderResult> {
  if (!/^https?:\/\//i.test(spec.url)) {
    return {
      ok: false,
      error: {
        kind: 'validation',
        renderer: 'image',
        messages: [{ text: 'url must be http:// or https://' }],
      },
    };
  }

  let res: Response;
  try {
    res = await fetch(spec.url);
  } catch (err) {
    return internalError(`fetch failed: ${(err as Error).message}`);
  }
  if (!res.ok) {
    return internalError(`fetch returned ${res.status} ${res.statusText}`);
  }

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (contentType && contentType !== spec.mime) {
    return {
      ok: false,
      error: {
        kind: 'validation',
        renderer: 'image',
        messages: [
          {
            text: `expected ${spec.mime} but server returned ${contentType}`,
          },
        ],
      },
    };
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    return internalError(
      `image is ${buffer.byteLength} bytes; limit is ${MAX_BYTES}`
    );
  }

  const bytes = new Uint8Array(buffer);
  const dims = (await detectRasterDimensions(bytes, spec.mime)) ?? { width: 640, height: 420 };
  return { ok: true, bytes, mime: spec.mime, size: dims };
}

/** Read PNG/JPEG headers to get intrinsic pixel dimensions. Avoids spinning
 *  up a full image-decode library; both formats expose dimensions in the
 *  first few hundred bytes. */
async function detectRasterDimensions(
  bytes: Uint8Array,
  mime: string
): Promise<Size | null> {
  if (mime === 'image/png') return parsePngDimensions(bytes);
  if (mime === 'image/jpeg') return parseJpegDimensions(bytes);
  return null;
}

function parsePngDimensions(bytes: Uint8Array): Size | null {
  if (bytes.length < 24) return null;
  // PNG: 8-byte sig, then IHDR chunk: length(4) + 'IHDR'(4) + width(4) + height(4).
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function parseJpegDimensions(bytes: Uint8Array): Size | null {
  // Walk JPEG markers looking for an SOFn frame, which carries height/width.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i < bytes.length - 8) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    i += 2;
    // SOF0..SOF15 minus SOFx reserved spots — height + width live here.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const height = view.getUint16(i + 3);
      const width = view.getUint16(i + 5);
      return { width, height };
    }
    // Segment length includes the 2 length bytes themselves.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const segLen = view.getUint16(i);
    i += segLen;
  }
  return null;
}

function internalError(text: string): RenderResult {
  return {
    ok: false,
    error: { kind: 'internal', renderer: 'image', messages: [{ text }] },
  };
}
