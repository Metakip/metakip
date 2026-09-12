import * as Y from 'yjs';

export function readVarUint(
  input: Uint8Array,
  initialOffset: number,
): { value: number; offset: number } {
  let value = 0;
  let multiplier = 1;
  let offset = initialOffset;
  while (offset < input.length) {
    const byte = input[offset];
    if (byte === undefined) break;
    value += (byte & 0x7f) * multiplier;
    offset += 1;
    if (byte < 0x80) return { value, offset };
    multiplier *= 128;
    if (!Number.isSafeInteger(value) || multiplier > Number.MAX_SAFE_INTEGER) break;
  }
  throw new Error('Malformed collaboration message');
}

/** Extract the Yjs update from messages that can mutate the server document. */
export function getYjsWriteUpdate(update: Uint8Array): Uint8Array | null {
  try {
    const documentNameLength = readVarUint(update, 0);
    const messageType = readVarUint(update, documentNameLength.offset + documentNameLength.value);
    if (messageType.value !== 0 && messageType.value !== 4) return null;
    const syncType = readVarUint(update, messageType.offset);
    if (syncType.value !== 1 && syncType.value !== 2) return null;
    const payloadLength = readVarUint(update, syncType.offset);
    const payloadEnd = payloadLength.offset + payloadLength.value;
    if (payloadEnd > update.length) throw new Error('Malformed collaboration message');
    const payload = update.slice(payloadLength.offset, payloadEnd);
    try {
      const decoded = Y.decodeUpdate(payload);
      if (decoded.structs.length === 0 && decoded.ds.clients.size === 0) return null;
    } catch {
      // A malformed payload is still a potential write. The protocol decoder
      // performs the final rejection after permission admission.
    }
    return payload;
  } catch {
    return null;
  }
}

type DecodedYjsUpdate = ReturnType<typeof Y.decodeUpdate>;

function findStructContainingClock(
  structs: readonly Y.AbstractStruct[] | undefined,
  clock: number,
): Y.AbstractStruct | undefined {
  return structs?.find(
    (struct) => clock >= struct.id.clock && clock < struct.id.clock + struct.length,
  );
}

export function yjsUpdateTouchesTitle(document: Y.Doc, update: Uint8Array): boolean {
  let decoded: DecodedYjsUpdate;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return true;
  }

  const title = document.getText('title');
  const decodedByClient = new Map<number, Y.AbstractStruct[]>();
  for (const struct of decoded.structs) {
    const clientStructs = decodedByClient.get(struct.id.client) ?? [];
    clientStructs.push(struct);
    decodedByClient.set(struct.id.client, clientStructs);
  }

  const resolveStruct = (id: Y.ID): Y.AbstractStruct | undefined =>
    findStructContainingClock(decodedByClient.get(id.client), id.clock) ??
    findStructContainingClock(document.store.clients.get(id.client), id.clock);
  const visited = new Set<Y.AbstractStruct>();
  const targetsTitle = (struct: Y.AbstractStruct | undefined): boolean => {
    if (!struct || !(struct instanceof Y.Item) || visited.has(struct)) return false;
    visited.add(struct);
    const parent = struct.parent as unknown;
    if (parent === 'title' || parent === title) return true;
    if (typeof parent === 'string') return false;
    if (parent instanceof Y.ID) {
      const parentStruct = resolveStruct(parent);
      return parentStruct ? targetsTitle(parentStruct) : true;
    }
    if (parent instanceof Y.AbstractType) return parent === title;
    if (struct.origin) {
      const origin = resolveStruct(struct.origin);
      if (!origin || targetsTitle(origin)) return true;
    }
    if (struct.rightOrigin) {
      const rightOrigin = resolveStruct(struct.rightOrigin);
      if (!rightOrigin || targetsTitle(rightOrigin)) return true;
    }
    return false;
  };

  if (decoded.structs.some((struct) => targetsTitle(struct))) return true;
  for (const [clientId, deletions] of decoded.ds.clients) {
    const candidateStructs = [
      ...(document.store.clients.get(clientId) ?? []),
      ...(decodedByClient.get(clientId) ?? []),
    ];
    for (const deletion of deletions) {
      const deletionEnd = deletion.clock + deletion.len;
      let resolvedDeletion = false;
      for (const struct of candidateStructs) {
        const structEnd = struct.id.clock + struct.length;
        if (struct.id.clock >= deletionEnd || structEnd <= deletion.clock) continue;
        resolvedDeletion = true;
        if (targetsTitle(struct)) return true;
      }
      if (!resolvedDeletion) return true;
    }
  }
  return false;
}

/** Reject updates that introduce data under a retired top-level Yjs type. */
export function yjsUpdateTouchesRootType(
  document: Y.Doc,
  update: Uint8Array,
  rootType: string,
): boolean {
  let decoded: DecodedYjsUpdate;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    // Let the protocol decoder reject malformed updates through its normal
    // admission/finalization path.
    return false;
  }

  const decodedByClient = new Map<number, Y.AbstractStruct[]>();
  for (const struct of decoded.structs) {
    const clientStructs = decodedByClient.get(struct.id.client) ?? [];
    clientStructs.push(struct);
    decodedByClient.set(struct.id.client, clientStructs);
  }
  const existingRoot = document.share.get(rootType);
  const resolveStruct = (id: Y.ID): Y.AbstractStruct | undefined =>
    findStructContainingClock(decodedByClient.get(id.client), id.clock) ??
    findStructContainingClock(document.store.clients.get(id.client), id.clock);
  const visited = new Set<Y.AbstractStruct>();
  const targetsRoot = (struct: Y.AbstractStruct | undefined): boolean => {
    if (!struct || !(struct instanceof Y.Item) || visited.has(struct)) return false;
    visited.add(struct);
    const parent = struct.parent as unknown;
    if (parent === rootType) return true;
    if (typeof parent === 'string') return false;
    if (parent instanceof Y.ID) {
      const parentStruct = resolveStruct(parent);
      return parentStruct ? targetsRoot(parentStruct) : true;
    }
    if (parent instanceof Y.AbstractType)
      return existingRoot !== undefined && parent === existingRoot;
    if (struct.origin) {
      const origin = resolveStruct(struct.origin);
      if (!origin || targetsRoot(origin)) return true;
    }
    if (struct.rightOrigin) {
      const rightOrigin = resolveStruct(struct.rightOrigin);
      if (!rightOrigin || targetsRoot(rightOrigin)) return true;
    }
    return false;
  };

  return decoded.structs.some((struct) => targetsRoot(struct));
}

export function sanitizeCanonicalYjsUpdate(update: Uint8Array): Uint8Array {
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, update);
    if (candidate.store.pendingStructs !== null || candidate.store.pendingDs !== null) {
      throw new Error('Canonical Yjs state contains unresolved updates');
    }
    return Y.encodeStateAsUpdate(candidate);
  } finally {
    candidate.destroy();
  }
}

export function getProtocolMessageType(update: Uint8Array): number | null {
  try {
    const documentNameLength = readVarUint(update, 0);
    const messageType = readVarUint(update, documentNameLength.offset + documentNameLength.value);
    return messageType.value;
  } catch {
    return null;
  }
}
