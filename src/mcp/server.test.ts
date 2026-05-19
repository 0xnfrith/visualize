import { describe, expect, it } from 'bun:test';
import { resolveHosts } from './server.ts';

const env = (
  bind?: string,
  advertised?: string
): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = {};
  if (bind !== undefined) e.VISUALIZE_BIND_HOST = bind;
  if (advertised !== undefined) e.VISUALIZE_ADVERTISED_HOST = advertised;
  return e;
};

describe('resolveHosts', () => {
  it('defaults both to 127.0.0.1 when env is empty', () => {
    expect(resolveHosts(env())).toEqual({
      bindHost: '127.0.0.1',
      advertisedHost: '127.0.0.1',
    });
  });

  it('remaps advertised to 127.0.0.1 when bind is 0.0.0.0 and advertised is unset', () => {
    expect(resolveHosts(env('0.0.0.0'))).toEqual({
      bindHost: '0.0.0.0',
      advertisedHost: '127.0.0.1',
    });
  });

  it('honors both when explicitly set', () => {
    expect(resolveHosts(env('0.0.0.0', 'visualize.orb.local'))).toEqual({
      bindHost: '0.0.0.0',
      advertisedHost: 'visualize.orb.local',
    });
  });

  it('mirrors bind into advertised for non-0.0.0.0 binds', () => {
    expect(resolveHosts(env('192.168.1.5'))).toEqual({
      bindHost: '192.168.1.5',
      advertisedHost: '192.168.1.5',
    });
  });

  it('remaps an explicit advertised=0.0.0.0 to 127.0.0.1 instead of handing back an undialable URL', () => {
    expect(resolveHosts(env('127.0.0.1', '0.0.0.0'))).toEqual({
      bindHost: '127.0.0.1',
      advertisedHost: '127.0.0.1',
    });
  });

  it('treats empty-string env vars as unset', () => {
    expect(resolveHosts(env('', ''))).toEqual({
      bindHost: '127.0.0.1',
      advertisedHost: '127.0.0.1',
    });
  });

  it('treats whitespace-only env vars as unset', () => {
    expect(resolveHosts(env('   ', '\t'))).toEqual({
      bindHost: '127.0.0.1',
      advertisedHost: '127.0.0.1',
    });
  });

  it('lets advertised override even when bind is unset', () => {
    expect(resolveHosts(env(undefined, 'visualize.orb.local'))).toEqual({
      bindHost: '127.0.0.1',
      advertisedHost: 'visualize.orb.local',
    });
  });
});
