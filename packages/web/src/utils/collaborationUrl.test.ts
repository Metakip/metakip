import { describe, expect, it } from 'vitest';
import { getCollaborationUrl } from './collaborationUrl';

describe('getCollaborationUrl', () => {
  it('uses the current HTTP origin instead of a build-machine localhost address', () => {
    expect(getCollaborationUrl({ protocol: 'http:', host: '168.144.31.161:5173' })).toBe(
      'ws://168.144.31.161:5173/collab',
    );
  });

  it('uses secure WebSockets on an HTTPS origin', () => {
    expect(getCollaborationUrl({ protocol: 'https:', host: 'metakip.com' })).toBe(
      'wss://metakip.com/collab',
    );
  });
});
