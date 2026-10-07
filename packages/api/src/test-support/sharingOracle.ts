export type OraclePermission = null | 'view' | 'commenter' | 'edit' | 'admin';
export type OraclePublicPermission = null | 'view' | 'edit';

export interface OracleNode {
  /** Account grant directly attached to this node. Index 0 is the target. */
  grant: OraclePermission;
  publicAccess: OraclePublicPermission;
  /** A boundary blocks workspace and sources on nodes above this one. */
  restricted: boolean;
}

export interface SharingOracleInput {
  workspace: OraclePermission;
  /** Target first, then ancestors from nearest to farthest. */
  nodes: readonly OracleNode[];
}

export interface OracleSource {
  kind: 'workspace' | 'grant' | 'public';
  nodeIndex: number | null;
  permission: Exclude<OraclePermission, null>;
}

export interface SharingOracleDecision {
  permission: OraclePermission;
  activeSources: OracleSource[];
  winningSources: OracleSource[];
}

const rank = (permission: OraclePermission): number => {
  switch (permission) {
    case 'admin':
      return 4;
    case 'edit':
      return 3;
    case 'commenter':
      return 2;
    case 'view':
      return 1;
    default:
      return 0;
  }
};

/**
 * Independent executable specification for sharing precedence and boundaries.
 * It intentionally imports no production permission helper or SQL-derived code.
 */
export function decideSharingPermission(input: SharingOracleInput): SharingOracleDecision {
  const activeSources: OracleSource[] = [];

  input.nodes.forEach((node, nodeIndex) => {
    // A boundary only blocks sources above it. A direct source on the boundary
    // itself starts a new inheritance chain and therefore remains active.
    const blocked = input.nodes.slice(0, nodeIndex).some((candidate) => candidate.restricted);
    if (!blocked && node.grant !== null) {
      activeSources.push({ kind: 'grant', nodeIndex, permission: node.grant });
    }
    if (!blocked && node.publicAccess !== null) {
      activeSources.push({ kind: 'public', nodeIndex, permission: node.publicAccess });
    }
  });

  if (input.workspace !== null && !input.nodes.some((node) => node.restricted)) {
    activeSources.push({ kind: 'workspace', nodeIndex: null, permission: input.workspace });
  }

  const winningRank = activeSources.reduce(
    (highest, source) => Math.max(highest, rank(source.permission)),
    0,
  );
  const winningSources = activeSources.filter((source) => rank(source.permission) === winningRank);

  return {
    permission: winningSources[0]?.permission ?? null,
    activeSources,
    winningSources,
  };
}
