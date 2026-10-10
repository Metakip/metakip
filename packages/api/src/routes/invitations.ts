import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { resendManagedInvitation, revokeManagedInvitation } from '../utils/invitationAccess';
import { acceptInvitation, declineInvitation, getInvitationClaim } from '../utils/invitationClaims';
import { requireUuid } from '../utils/uuid';

const invitationsRoute = new Hono();

invitationsRoute.get('/claim/:token', async (c) => {
  return c.json(await getInvitationClaim(c.req.param('token')));
});

invitationsRoute.post('/claim/:token/decline', async (c) => {
  await declineInvitation(c.req.param('token'));
  return c.json({ ok: true });
});

invitationsRoute.post('/:invitationId/resend', requireAuth, async (c) => {
  const user = c.get('user');
  const invitationId = requireUuid(c.req.param('invitationId'), 'invitation ID');
  const invitation = await resendManagedInvitation(invitationId, user.id);
  return c.json({
    invitation,
    message: `Invitation queued for ${invitation.email}`,
  });
});

invitationsRoute.delete('/:invitationId', requireAuth, async (c) => {
  const user = c.get('user');
  const invitationId = requireUuid(c.req.param('invitationId'), 'invitation ID');
  const invitation = await revokeManagedInvitation(invitationId, user.id);
  return c.json({ ok: true, message: `Invitation to ${invitation.email} revoked` });
});

invitationsRoute.post('/claim/:token', requireAuth, async (c) => {
  const user = c.get('user');
  const destination = await acceptInvitation(c.req.param('token'), user.id);
  return c.json({ ok: true, destination });
});

export default invitationsRoute;
