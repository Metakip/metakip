export function requestLogPath(path: string): string {
  if (path.startsWith('/api/invitations/claim/')) {
    return /^\/api\/invitations\/claim\/[^/]+\/decline\/?$/.test(path)
      ? '/api/invitations/claim/:token/decline'
      : '/api/invitations/claim/:token';
  }
  if (path.startsWith('/invite/')) return '/invite/:token';
  return path;
}
