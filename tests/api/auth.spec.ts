import { test, expect } from '../../fixtures';
import { parseBody } from '../../helpers/api.client';
import { ADMIN } from '../../helpers/config';

test.describe('POST /api/auth/login @api', () => {
  test('TC-API-001 | Admin can log in and receives a token', async ({ api }) => {
    const res = await api.login(ADMIN.username, ADMIN.password);
    expect(res.status()).toBe(200);
    const token = await api.authenticate();
    expect(token).toBeTruthy();
  });

  test('TC-API-002 | Invalid credentials are rejected with 401', async ({ api }) => {
    const res = await api.login('not-a-user', 'wrong-password');
    expect(res.status()).toBe(401);
    expect(await parseBody(res)).toEqual({ error: 'Invalid credentials' });
  });

  test('TC-API-003 | Admin-only booking list requires authentication', async ({ api }) => {
    const res = await api.listBookingsUnauthenticated();
    expect(res.status()).toBe(401);
    expect(await parseBody(res)).toEqual({ error: 'Authentication required' });
  });
});
