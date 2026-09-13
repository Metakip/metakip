import type { CapabilitySet } from '@metakip/shared';
import { act, render } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ data: { user: { id: 'user-1' } } }),
}));

import {
  type AccessPermission,
  ShareProvider,
  useSetAccessPermission,
  useSetCapabilities,
  useShareContext,
} from './ShareContext';

const VIEW_CAPABILITIES: CapabilitySet = {
  canEdit: false,
  canDelete: false,
  canCopy: true,
};

const EDIT_CAPABILITIES: CapabilitySet = {
  canEdit: true,
  canDelete: false,
  canCopy: true,
};

function ContextProbe({
  observe,
}: {
  observe: (snapshot: {
    accessPermission: AccessPermission;
    capabilities: CapabilitySet;
    setAccessPermission: Dispatch<SetStateAction<AccessPermission>>;
    setCapabilities: Dispatch<SetStateAction<CapabilitySet>>;
  }) => void;
}) {
  const context = useShareContext();
  observe({
    accessPermission: context.accessPermission,
    capabilities: context.capabilities,
    setAccessPermission: useSetAccessPermission(),
    setCapabilities: useSetCapabilities(),
  });
  return null;
}

describe('ShareProvider setters', () => {
  it('keeps setter identities stable while applying updates to the latest snapshots', () => {
    let latest:
      | {
          accessPermission: AccessPermission;
          capabilities: CapabilitySet;
          setAccessPermission: Dispatch<SetStateAction<AccessPermission>>;
          setCapabilities: Dispatch<SetStateAction<CapabilitySet>>;
        }
      | undefined;
    const observe = (snapshot: NonNullable<typeof latest>) => {
      latest = snapshot;
    };
    const { rerender } = render(
      <ShareProvider publicPermission="view" capabilities={VIEW_CAPABILITIES}>
        <ContextProbe observe={observe} />
      </ShareProvider>,
    );

    const initialSetAccessPermission = latest?.setAccessPermission;
    const initialSetCapabilities = latest?.setCapabilities;
    expect(initialSetAccessPermission).toBeDefined();
    expect(initialSetCapabilities).toBeDefined();

    rerender(
      <ShareProvider publicPermission="edit" capabilities={{ ...EDIT_CAPABILITIES }}>
        <ContextProbe observe={observe} />
      </ShareProvider>,
    );

    expect(latest?.setAccessPermission).toBe(initialSetAccessPermission);
    expect(latest?.setCapabilities).toBe(initialSetCapabilities);
    expect(latest?.accessPermission).toBe('edit');
    expect(latest?.capabilities).toEqual(EDIT_CAPABILITIES);

    act(() => {
      initialSetAccessPermission?.('view');
      initialSetCapabilities?.(VIEW_CAPABILITIES);
    });

    expect(latest?.accessPermission).toBe('view');
    expect(latest?.capabilities).toEqual(VIEW_CAPABILITIES);
  });

  it('does not revise capabilities for an equivalent object from a query refresh', () => {
    const setters: Dispatch<SetStateAction<CapabilitySet>>[] = [];
    const observe = ({
      setCapabilities,
    }: {
      accessPermission: AccessPermission;
      capabilities: CapabilitySet;
      setAccessPermission: Dispatch<SetStateAction<AccessPermission>>;
      setCapabilities: Dispatch<SetStateAction<CapabilitySet>>;
    }) => {
      setters.push(setCapabilities);
    };
    const { rerender } = render(
      <ShareProvider capabilities={EDIT_CAPABILITIES}>
        <ContextProbe observe={observe} />
      </ShareProvider>,
    );

    rerender(
      <ShareProvider capabilities={{ ...EDIT_CAPABILITIES }}>
        <ContextProbe observe={observe} />
      </ShareProvider>,
    );

    expect(new Set(setters).size).toBe(1);
  });
});
