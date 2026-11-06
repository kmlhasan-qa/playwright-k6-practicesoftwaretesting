import { test, expect } from '../../fixtures';
import { RULES } from '../../helpers/config';

/**
 * Known defects – each test asserts the CORRECT behaviour, so it fails today and turns
 * green when fixed. Marked with test.fail() so CI stays green while the defect is open;
 * once fixed, Playwright reports "expected to fail but passed" and the annotation is removed.
 *
 * DEF-001 (UI swallows rejected orders) is covered by TC-UI-003.
 */
test.describe('Known defects @api @defect', () => {
  const cod = { payment_method: 'cash-on-delivery', payment_details: {} };

  test('TC-API-040 | DEF-002 A cart can only be checked out once (no duplicate orders)', async ({ api, customer }) => {
    test.fail(true, 'DEF-002: the same cart_id produces a new invoice on every POST /invoices');
    const product = await api.purchasableProduct();
    const cartId = await api.cartWith(product.id, 1);
    const body = { ...(await api.validBillingAddress()), ...cod, cart_id: cartId };

    const first = await customer.api.createInvoice(body);
    expect(first.status()).toBe(201);

    const second = await customer.api.createInvoice(body); // e.g. double-click, retry, 2nd tab
    expect(second.status(), 'second checkout of the same cart must be rejected').toBeGreaterThanOrEqual(400);
    const { data } = await (await customer.api.listInvoices()).json();
    expect(data).toHaveLength(1);
  });

  test('TC-API-041 | DEF-003 An order cannot be placed for an empty cart', async ({ api, customer }) => {
    test.fail(true, 'DEF-003: POST /invoices with an empty cart returns 201 and a 0.00 invoice');
    const cartId = await api.createCartOrFail();
    const res = await customer.api.createInvoice({ ...(await api.validBillingAddress()), ...cod, cart_id: cartId });
    expect(res.status()).toBe(422);
  });

  test('TC-API-042 | OBS-1 Cart quantity cap (99) also applies when the same product is added repeatedly', async ({ api }) => {
    test.fail(true, 'OBS-1: two adds of 60 give a cart line of 120 although max per add/update is 99');
    const product = await api.purchasableProduct();
    const cartId = await api.cartWith(product.id, 60);
    const res = await api.addToCart(cartId, product.id, 60);
    const cart = await (await api.getCart(cartId)).json();
    const qty = cart.cart_items[0].quantity;
    expect(res.status() === 422 || qty <= RULES.cartQuantity.max, `status ${res.status()}, line qty ${qty}`).toBe(true);
  });

  test('TC-API-043 | OBS-3 Payment check rejects an unknown payment method and an empty body', async ({ api }) => {
    test.fail(true, 'OBS-3: POST /payment/check returns 200 "Payment was successful" for both');
    expect((await api.checkPayment({ payment_method: 'bitcoin', payment_details: {} })).status()).toBe(422);
    expect((await api.checkPayment({})).status()).toBe(422);
  });

  test('TC-API-044 | OBS-4 Malformed credit card on POST /invoices returns 422, not 500', async ({ api, customer }) => {
    test.fail(true, 'OBS-4: API returns 500 "Something went wrong"');
    const product = await api.purchasableProduct();
    const cartId = await api.cartWith(product.id);
    const res = await customer.api.createInvoice({
      ...(await api.validBillingAddress()),
      payment_method: 'credit-card',
      payment_details: { credit_card_number: 'x' },
      cart_id: cartId,
    });
    expect(res.status()).toBe(422);
  });

  test('TC-API-045 | OBS-5 billing_postal_code is required (per API spec)', async ({ api, customer }) => {
    test.fail(true, 'OBS-5: omitting billing_postal_code returns 201 and skips the address check');
    const product = await api.purchasableProduct();
    const cartId = await api.cartWith(product.id);
    const { billing_postal_code: _omit, ...address } = await api.validBillingAddress();
    const res = await customer.api.createInvoice({ ...address, billing_city: 'Utrecht', ...cod, cart_id: cartId });
    expect(res.status()).toBe(422);
  });
});
