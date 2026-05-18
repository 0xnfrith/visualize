import { describe, expect, it } from 'bun:test';
import type { PublicPayload } from '../mcp/protocol.ts';
import { payloadToContent } from './payload-utils.ts';

const identity = (s: string) => s;

describe('payloadToContent', () => {
  it('handles a valid svg payload and runs it through the sanitizer', () => {
    const out = payloadToContent({ kind: 'svg', svgText: '<svg/>' }, 'd2-001', s =>
      s.toUpperCase()
    );
    expect(out).toEqual({ kind: 'svg', text: '<SVG/>' });
  });

  it('handles a valid image payload', () => {
    const out = payloadToContent(
      { kind: 'image', assetUrl: '/diagrams/abc' },
      'img-001',
      identity
    );
    expect(out).toEqual({ kind: 'image', url: '/diagrams/abc' });
  });

  it("throws when kind='image' but assetUrl is empty", () => {
    expect(() =>
      payloadToContent(
        { kind: 'image', assetUrl: '' } as PublicPayload,
        'img-002',
        identity
      )
    ).toThrow(/img-002/);
  });

  it("throws when kind='image' but assetUrl is the wrong type", () => {
    expect(() =>
      payloadToContent(
        { kind: 'image', assetUrl: undefined } as unknown as PublicPayload,
        'img-003',
        identity
      )
    ).toThrow(/img-003/);
  });

  it("throws when kind='svg' but svgText is the wrong type", () => {
    expect(() =>
      payloadToContent(
        { kind: 'svg', svgText: undefined } as unknown as PublicPayload,
        'd2-002',
        identity
      )
    ).toThrow(/d2-002/);
  });

  it('preserves empty SVG text (the loading sentinel)', () => {
    const out = payloadToContent(
      { kind: 'svg', svgText: '' },
      'd2-003',
      identity
    );
    expect(out).toEqual({ kind: 'svg', text: '' });
  });
});
