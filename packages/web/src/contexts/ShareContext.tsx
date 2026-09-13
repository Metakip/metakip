import {
  type CapabilitySet,
  deriveCapabilities,
  type FolderDetailPayload,
  getAnonymousName,
  type PublicPermission,
} from '@metakip/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from '../hooks/useAuth';
import { getAnonymousId } from '../utils/anonymous-cookie';

export type AccessPermission = PublicPermission | null;

interface ShareContextType {
  isAnonymous: boolean;
  anonymousId: string | null;
  anonymousName: string | null;
  accessPermission: AccessPermission;
  capabilities: CapabilitySet;
  publicEntity: FolderDetailPayload | null;
  /** @deprecated Use capabilities.canEdit instead */
  canEdit: boolean;
}

const ShareContext = createContext<ShareContextType | undefined>(undefined);
const SetAccessPermissionContext = createContext<
  React.Dispatch<React.SetStateAction<AccessPermission>>
>(() => {});
const SetCapabilitiesContext = createContext<React.Dispatch<React.SetStateAction<CapabilitySet>>>(
  () => {},
);

const DEFAULT_CAPABILITIES: CapabilitySet = {
  canEdit: false,
  canDelete: false,
  canCopy: false,
};

function capabilitiesEqual(left: CapabilitySet, right: CapabilitySet): boolean {
  return (
    left.canEdit === right.canEdit &&
    left.canDelete === right.canDelete &&
    left.canCopy === right.canCopy
  );
}

interface ShareProviderProps {
  children: ReactNode;
  publicPermission?: AccessPermission;
  capabilities?: CapabilitySet;
  publicEntity?: FolderDetailPayload | null;
  accessPending?: boolean;
}

export function ShareProvider({
  children,
  publicPermission: initial = null,
  capabilities: initialCapabilities,
  publicEntity = null,
  accessPending = false,
}: ShareProviderProps) {
  const { data: session } = useAuth();
  const isAnonymous = !session?.user;
  const capabilitySnapshot = initialCapabilities ?? DEFAULT_CAPABILITIES;
  const accessRevisionRef = useRef({ snapshot: initial, revision: 0 });
  if (accessRevisionRef.current.snapshot !== initial) {
    accessRevisionRef.current = {
      snapshot: initial,
      revision: accessRevisionRef.current.revision + 1,
    };
  }
  const capabilityRevisionRef = useRef({ snapshot: capabilitySnapshot, revision: 0 });
  if (!capabilitiesEqual(capabilityRevisionRef.current.snapshot, capabilitySnapshot)) {
    capabilityRevisionRef.current = {
      snapshot: capabilitySnapshot,
      revision: capabilityRevisionRef.current.revision + 1,
    };
  }
  const accessRevision = accessRevisionRef.current.revision;
  const capabilityRevision = capabilityRevisionRef.current.revision;
  const [accessState, setAccessState] = useState({ revision: accessRevision, value: initial });
  const [capabilityState, setCapabilityState] = useState({
    revision: capabilityRevision,
    value: capabilitySnapshot,
  });
  const accessSnapshotRef = useRef({ revision: accessRevision, value: initial });
  accessSnapshotRef.current = { revision: accessRevision, value: initial };
  const capabilityValueRef = useRef({ revision: capabilityRevision, value: capabilitySnapshot });
  capabilityValueRef.current = { revision: capabilityRevision, value: capabilitySnapshot };
  const accessPermission = accessState.revision === accessRevision ? accessState.value : initial;
  const capabilities =
    capabilityState.revision === capabilityRevision ? capabilityState.value : capabilitySnapshot;

  const setAccessPermission = useCallback<React.Dispatch<React.SetStateAction<AccessPermission>>>(
    (update) => {
      setAccessState((current) => {
        const snapshot = accessSnapshotRef.current;
        const currentValue =
          current.revision === snapshot.revision ? current.value : snapshot.value;
        const value = typeof update === 'function' ? update(currentValue) : update;
        return { revision: snapshot.revision, value };
      });
    },
    [],
  );
  const setCapabilities = useCallback<React.Dispatch<React.SetStateAction<CapabilitySet>>>(
    (update) => {
      setCapabilityState((current) => {
        const snapshot = capabilityValueRef.current;
        const currentValue =
          current.revision === snapshot.revision ? current.value : snapshot.value;
        const value = typeof update === 'function' ? update(currentValue) : update;
        return { revision: snapshot.revision, value };
      });
    },
    [],
  );

  const effectiveAccessPermission = accessPending ? null : accessPermission;
  const effectiveCapabilities = accessPending ? DEFAULT_CAPABILITIES : capabilities;

  const value = useMemo(() => {
    if (!isAnonymous) {
      return {
        isAnonymous: false,
        anonymousId: null,
        anonymousName: null,
        accessPermission: effectiveAccessPermission,
        capabilities: effectiveCapabilities,
        publicEntity: accessPending ? null : publicEntity,
        canEdit: effectiveCapabilities.canEdit,
      };
    }

    const anonymousId = getAnonymousId();
    const anonymousName = getAnonymousName(anonymousId);
    const anonymousCapabilities = deriveCapabilities(effectiveAccessPermission);

    return {
      isAnonymous: true,
      anonymousId,
      anonymousName,
      accessPermission: effectiveAccessPermission,
      capabilities: anonymousCapabilities,
      publicEntity: accessPending ? null : publicEntity,
      canEdit: anonymousCapabilities.canEdit,
    };
  }, [accessPending, effectiveAccessPermission, effectiveCapabilities, isAnonymous, publicEntity]);

  return (
    <SetCapabilitiesContext.Provider value={setCapabilities}>
      <SetAccessPermissionContext.Provider value={setAccessPermission}>
        <ShareContext.Provider value={value}>{children}</ShareContext.Provider>
      </SetAccessPermissionContext.Provider>
    </SetCapabilitiesContext.Provider>
  );
}

const DEFAULT_SHARE_CONTEXT: ShareContextType = {
  isAnonymous: false,
  anonymousId: null,
  anonymousName: null,
  accessPermission: null,
  capabilities: DEFAULT_CAPABILITIES,
  publicEntity: null,
  canEdit: false,
};

export function useShareContext(): ShareContextType {
  const context = useContext(ShareContext);
  return context ?? DEFAULT_SHARE_CONTEXT;
}

export function useSetAccessPermission(): React.Dispatch<React.SetStateAction<AccessPermission>> {
  return useContext(SetAccessPermissionContext);
}

export function useSetCapabilities(): React.Dispatch<React.SetStateAction<CapabilitySet>> {
  return useContext(SetCapabilitiesContext);
}
