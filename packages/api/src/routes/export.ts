import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { exportAllPages } from '../utils/workspaceExport';

const exportRoute = new Hono();

exportRoute.use('*', requireAuth);

exportRoute.get('/export', async (c) => {
  const user = c.get('user') as { id: string };
  const buffer = await exportAllPages(user.id);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  c.header('Content-Type', 'application/zip');
  c.header('Content-Disposition', 'attachment; filename="metakip-export.zip"');
  return c.newResponse(arrayBuffer, 200);
});

export { exportAllPages } from '../utils/workspaceExport';
export default exportRoute;
