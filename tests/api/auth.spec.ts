import { test, expect } from '../../fixtures';
import { DEMO_ACCOUNTS } from '../../helpers/config';
import { newCustomer, uniqueId } from '../../helpers/data.factory';

test.describe('Users & authentication @api', () => {
  test('TC-API-001 | Registered customer can log in and receives a bearer token', async ({ api }) => {
    const { email, password } = DEMO_ACCOUNTS.customer;
    const res = await api.login(email, password);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ token_type: 'bearer', access_token: expect.any(String), expires_in: expect.any(Number) });

    const me = await api.withToken(body.access_token).me();
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ email });
  });

  test('TC-API-002 | Wrong password is rejected with 401', async ({ api }) => {
    const res = await api.login(DEMO_ACCOUNTS.customer.email, 'wrong-password');
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  test('TC-API-003 | /users/me without a token is rejected with 401', async ({ api }) => {
    const res = await api.me();
    expect(res.status()).toBe(401);
  });

  test('TC-API-004 | New customer can register; same email again is rejected with 409', async ({ api }) => {
    const customer = newCustomer();
    const first = await api.register(customer);
    expect(first.status()).toBe(201);
    const created = await first.json();
    expect(created).toMatchObject({ email: customer.email, id: expect.any(String) });
    expect(created).not.toHaveProperty('password');

    const again = await api.register(customer);
    expect(again.status()).toBe(409);
    expect((await again.json()).email).toEqual(['A customer with this email address already exists.']);
  });

  const weakPasswords = [
    { password: 'Aa1!aaa', rule: 'min 8 characters (7 = min-1)', message: /at least 8 characters/ },
    { password: 'alllower1!', rule: 'upper + lower case', message: /uppercase and one lowercase/ },
    { password: 'NoSymbol123', rule: 'at least one symbol', message: /at least one symbol/ },
  ];
  for (const { password, rule, message } of weakPasswords) {
    test(`TC-API-005 | Password policy: ${rule} → 422`, async ({ api }) => {
      const res = await api.register(newCustomer({ password }));
      expect(res.status()).toBe(422);
      expect((await res.json()).password.join(' ')).toMatch(message);
    });
  }

  test('TC-API-006 | Boundary: password of exactly 8 characters meeting all rules is accepted', async ({ api }) => {
    // Random tail – a well-known 8-char string would be rejected by the breach check (TC-API-008).
    const password = `Qz7#${uniqueId().slice(-4)}`;
    expect(password).toHaveLength(8);
    const res = await api.register(newCustomer({ password }));
    expect(res.status(), await res.text()).toBe(201);
  });

  test('TC-API-008 | Password found in a public data breach is rejected even if it meets the rules', async ({ api }) => {
    const res = await api.register(newCustomer({ password: 'Aa1!aaaa' }));
    expect(res.status()).toBe(422);
    expect((await res.json()).password).toEqual([
      'The given password has appeared in a data leak. Please choose a different password.',
    ]);
  });

  test('TC-API-007 | Customer must be at least 18 years old', async ({ api }) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 17);
    const res = await api.register(newCustomer({ dob: d.toISOString().slice(0, 10) }));
    expect(res.status()).toBe(422);
    expect((await res.json()).dob).toEqual(['Customer must be 18 years old.']);
  });
});
