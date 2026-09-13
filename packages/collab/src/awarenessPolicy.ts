import type { Connection, Document } from '@hocuspocus/server';
import { getAnimalEmoji, getAnonymousName, getStableColor } from '@metakip/shared';
import { CollabProtocolDeniedError } from './collabErrors';
import { readVarUint } from './collaborationProtocol';
import { type CollabSession, getSessionUser, isAnonymousSession } from './collabSession';
import { type DeferredAwarenessContext, getConnectionLifecycle } from './connectionLifecycle';

const AWARENESS_RELAY_FINGERPRINT_LIMIT = 256;

export type AwarenessIdentityContext = CollabSession;

type ParsedAwarenessEntry = {
  clientId: number;
  clock: number;
  state: unknown;
};

function parseAwarenessEntries(update: Uint8Array): ParsedAwarenessEntry[] {
  const documentNameLength = readVarUint(update, 0);
  const messageType = readVarUint(update, documentNameLength.offset + documentNameLength.value);
  if (messageType.value !== 1) throw new Error('Not an awareness message');
  const payloadLength = readVarUint(update, messageType.offset);
  const payloadEnd = payloadLength.offset + payloadLength.value;
  if (payloadEnd !== update.length) throw new Error('Malformed awareness message');

  const entryCount = readVarUint(update, payloadLength.offset);
  const entries: ParsedAwarenessEntry[] = [];
  let offset = entryCount.offset;
  for (let index = 0; index < entryCount.value; index += 1) {
    const clientId = readVarUint(update, offset);
    const clock = readVarUint(update, clientId.offset);
    const stateLength = readVarUint(update, clock.offset);
    const stateEnd = stateLength.offset + stateLength.value;
    if (stateEnd > payloadEnd) throw new Error('Malformed awareness message');
    const stateText = new TextDecoder('utf-8', { fatal: true }).decode(
      update.slice(stateLength.offset, stateEnd),
    );
    entries.push({
      clientId: clientId.value,
      clock: clock.value,
      state: JSON.parse(stateText) as unknown,
    });
    offset = stateEnd;
  }
  if (offset !== payloadEnd) throw new Error('Malformed awareness message');
  return entries;
}

function getAwarenessEntryFingerprint(entry: ParsedAwarenessEntry): string {
  return JSON.stringify([entry.clientId, entry.clock, entry.state]);
}

export function rememberOutboundAwarenessEntries(
  context: DeferredAwarenessContext,
  message: unknown,
): void {
  if (!(message instanceof Uint8Array)) return;
  let entries: ParsedAwarenessEntry[];
  try {
    entries = parseAwarenessEntries(message);
  } catch {
    return;
  }
  const fingerprints = getConnectionLifecycle(context).awareness.sentRelayFingerprints;
  for (const entry of entries) {
    const fingerprint = getAwarenessEntryFingerprint(entry);
    if (fingerprints.has(fingerprint)) continue;
    while (fingerprints.size >= AWARENESS_RELAY_FINGERPRINT_LIMIT) {
      const oldest = fingerprints.values().next().value;
      if (oldest === undefined) break;
      fingerprints.delete(oldest);
    }
    fingerprints.add(fingerprint);
  }
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExactJsonValue(value: unknown, expected: unknown): boolean {
  if (value === expected) return true;
  if (Array.isArray(value) && Array.isArray(expected)) {
    return (
      value.length === expected.length &&
      value.every((entry, index) => isExactJsonValue(entry, expected[index]))
    );
  }
  if (!isUnknownRecord(value) || !isUnknownRecord(expected)) return false;
  const valueKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    valueKeys.length === expectedKeys.length &&
    valueKeys.every(
      (key, index) => expectedKeys[index] === key && isExactJsonValue(value[key], expected[key]),
    )
  );
}

function hasExactPrimitiveFields(
  value: unknown,
  expected: Record<string, string | boolean | null>,
): boolean {
  if (!isUnknownRecord(value)) return false;
  const expectedKeys = Object.keys(expected).sort();
  const valueKeys = Object.keys(value).sort();
  return (
    valueKeys.length === expectedKeys.length &&
    expectedKeys.every((key, index) => valueKeys[index] === key && value[key] === expected[key])
  );
}

function getCanonicalAwarenessUser(
  context: AwarenessIdentityContext,
): Record<string, string | boolean | null> {
  const user = getSessionUser(context);
  if (isAnonymousSession(context)) {
    return {
      name: user.name || getAnonymousName(user.id),
      color: getStableColor(user.id),
      avatar: null,
      emoji: getAnimalEmoji(user.id),
      isAnonymous: true,
    };
  }
  return {
    name: user.name || 'Anonymous',
    color: getStableColor(user.id),
    avatar: context.principal.kind === 'account' ? context.principal.user.avatarUrl : null,
  };
}

export function validateAwarenessIdentity(
  update: Uint8Array,
  document: Document,
  connection: Connection,
  context: AwarenessIdentityContext,
): 'apply' | 'ignore' {
  const entries = parseAwarenessEntries(update);
  if (entries.length === 0) throw new CollabProtocolDeniedError('One awareness identity required');
  const ownedClientIds = document.getClients(connection);
  const awareness = context.lifecycle.awareness;
  const isCanonicalRelay = entries.every((entry) => {
    const ownsClientId =
      awareness.clientId === entry.clientId || ownedClientIds.has(entry.clientId);
    if (ownsClientId) return false;
    const canonicalClock = document.awareness.meta.get(entry.clientId)?.clock;
    const canonicalState = document.awareness.getStates().get(entry.clientId);
    return (
      canonicalClock === entry.clock &&
      (entry.state === null
        ? canonicalState === undefined
        : canonicalState !== undefined && isExactJsonValue(entry.state, canonicalState))
    );
  });
  const isKnownServerRelay = entries.every((entry) => {
    const ownsClientId =
      awareness.clientId === entry.clientId || ownedClientIds.has(entry.clientId);
    return (
      !ownsClientId && awareness.sentRelayFingerprints.has(getAwarenessEntryFingerprint(entry))
    );
  });

  if (isCanonicalRelay || isKnownServerRelay) {
    return 'ignore';
  }
  if (entries.length !== 1) throw new CollabProtocolDeniedError('One awareness identity required');
  const entry = entries[0];
  if (!entry) throw new CollabProtocolDeniedError('One awareness identity required');
  const directlyOwnsClientId =
    awareness.clientId === entry.clientId || ownedClientIds.has(entry.clientId);
  const otherOwners = document.getConnections().filter((otherConnection) => {
    if (otherConnection === connection) return false;
    const otherContext = otherConnection.context as AwarenessIdentityContext | undefined;
    return (
      otherContext?.lifecycle.awareness.clientId === entry.clientId ||
      document.getClients(otherConnection).has(entry.clientId)
    );
  });
  const isSamePrincipal = (otherConnection: Connection): boolean => {
    const otherContext = otherConnection.context as AwarenessIdentityContext | undefined;
    return (
      otherContext !== undefined &&
      otherContext.principal.kind === context.principal.kind &&
      getSessionUser(otherContext).id === getSessionUser(context).id
    );
  };
  const compatibleOwner = otherOwners.some(isSamePrincipal);
  const foreignOwner = otherOwners.some((otherConnection) => !isSamePrincipal(otherConnection));
  const ownsClientId = directlyOwnsClientId || compatibleOwner;

  if (entry.state === null) {
    if (!directlyOwnsClientId || foreignOwner) {
      throw new CollabProtocolDeniedError('Foreign awareness identity is not allowed');
    }
    return 'apply';
  }
  if (
    foreignOwner ||
    (awareness.clientId !== undefined && awareness.clientId !== entry.clientId) ||
    (ownedClientIds.size > 0 && !ownedClientIds.has(entry.clientId)) ||
    (!ownsClientId && document.awareness.getStates().has(entry.clientId))
  ) {
    throw new CollabProtocolDeniedError('Foreign awareness identity is not allowed');
  }
  if (isUnknownRecord(entry.state) && entry.state.user != null) {
    if (!hasExactPrimitiveFields(entry.state.user, getCanonicalAwarenessUser(context))) {
      throw new CollabProtocolDeniedError('Forged awareness user is not allowed');
    }
  }
  awareness.clientId = entry.clientId;
  return 'apply';
}
