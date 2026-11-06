import { test, expect } from '../../fixtures';
import { buildMessage } from '../../helpers/data.factory';

/**
 * Contact form – the guest's other entry point into the B&B.
 * TC-UI-003 is a green end-to-end path that does not depend on the room
 * endpoints, and TC-UI-004/005 cover client/server validation.
 */
test.describe('Contact form @e2e', () => {
  test.beforeEach(async ({ homePage }) => {
    await homePage.goto();
  });

  test('TC-UI-003 | Guest sends a valid enquiry and gets a thank-you message', async ({ page, homePage }) => {
    const msg = buildMessage();

    await homePage.fillContactForm(msg);
    const sent = page.waitForResponse((r) => r.url().endsWith('/api/message') && r.request().method() === 'POST');
    await homePage.submitContactForm();

    expect((await sent).status()).toBe(200);
    await expect(homePage.contactSuccess(msg.name)).toBeVisible();
    await expect(page.getByText(msg.subject)).toBeVisible();
  });

  test('TC-UI-004 | Submitting an empty form lists every required-field error', async ({ homePage }) => {
    await homePage.submitContactForm();

    // The API returns errors in a non-deterministic order, so compare as a set.
    await expect(homePage.contactErrors.first()).toBeVisible();
    const errors = await homePage.contactErrors.allTextContents();
    expect(errors).toEqual(
      expect.arrayContaining([
        'Name may not be blank',
        'Email may not be blank',
        'Phone may not be blank',
        'Subject may not be blank',
        'Message may not be blank',
      ]),
    );
  });

  test('TC-UI-005 | Boundary: phone of 10 digits and message of 19 chars are rejected', async ({ homePage }) => {
    await homePage.fillContactForm(
      buildMessage({ phone: '0123456789', description: 'x'.repeat(19) }),
    );
    await homePage.submitContactForm();

    await expect(homePage.contactErrors.first()).toBeVisible();
    const errors = await homePage.contactErrors.allTextContents();
    expect(errors).toEqual(
      expect.arrayContaining([
        'Phone must be between 11 and 21 characters.',
        'Message must be between 20 and 2000 characters.',
      ]),
    );
    expect(errors).toHaveLength(2);
  });
});
