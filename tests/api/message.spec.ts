import { test, expect } from '../../fixtures';
import { errorMessages, parseBody } from '../../helpers/api.client';
import { buildMessage } from '../../helpers/data.factory';

test.describe('POST /api/message @api', () => {
  test('TC-API-050 | Valid enquiry is accepted', async ({ api }) => {
    const res = await api.sendMessage(buildMessage());
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  test('TC-API-051 | Invalid enquiry returns every field error', async ({ api }) => {
    const res = await api.sendMessage({ name: '', email: 'bad', phone: '1', subject: 'a', description: 'short' });
    expect(res.status()).toBe(400);
    expect(errorMessages(await parseBody(res))).toEqual(
      expect.arrayContaining([
        'Name may not be blank',
        'must be a well-formed email address',
        'Subject must be between 5 and 100 characters.',
        'Phone must be between 11 and 21 characters.',
        'Message must be between 20 and 2000 characters.',
      ]),
    );
  });
});
