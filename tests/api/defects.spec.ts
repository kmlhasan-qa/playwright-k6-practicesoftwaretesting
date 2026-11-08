import { test, expect } from '../../fixtures';
import { RULES } from '../../helpers/config';
import type { Product } from '../../helpers/api.client';
import { CREDIT_CARD, cardExpiry, newCustomer, uniqueId } from '../../helpers/data.factory';

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

/**
 * Defects first found by exploratory API testing on 7 Nov 2026 (DEF-004…006, OBS-6…10),
 * made executable on 8 Nov 2026. Same convention: assert the correct behaviour, test.fail().
 */
test.describe('Known defects – exploratory findings @api @defect', () => {
  /** YYYY-MM-DD for today minus a number of years (local date, as a customer would type it). */
  const yearsAgo = (years: number): string => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  test('TC-API-046 | DEF-004 An order cannot be placed with an expired credit card', async ({ api, customer }) => {
    test.fail(true, 'DEF-004: POST /invoices accepts a card that /payment/check rejects as expired (201)');
    const product = await api.purchasableProduct();
    const cartId = await api.cartWith(product.id);
    const payment = { payment_method: 'credit-card', payment_details: CREDIT_CARD.expired() };
    expect((await api.checkPayment(payment)).status(), 'payment check rejects the card').toBe(422);

    const res = await customer.api.createInvoice({ ...(await api.validBillingAddress()), ...payment, cart_id: cartId });
    expect(res.status(), 'order with the same expired card').toBe(422);
  });

  test('TC-API-047 | DEF-005 Card number is masked and CVV is not returned on the invoice', async ({ api, customer }) => {
    test.fail(true, 'DEF-005: GET /invoices/{id} returns the full card number and the CVV');
    const product = await api.purchasableProduct();
    const cartId = await api.cartWith(product.id);
    const card = CREDIT_CARD.valid();
    const created = await customer.api.createInvoice({
      ...(await api.validBillingAddress()),
      payment_method: 'credit-card',
      payment_details: card,
      cart_id: cartId,
    });
    expect(created.status()).toBe(201);

    const invoice = await (await customer.api.getInvoice((await created.json()).id)).json();
    const stored = JSON.stringify(invoice);
    expect(stored, 'CVV must never be stored or returned').not.toContain(`"cvv":"${card.cvv}"`);
    expect(stored, 'full card number must not be returned').not.toContain(card.credit_card_number);
  });

  test('TC-API-048 | DEF-006 An out-of-stock product cannot be added to the cart', async ({ api }) => {
    const res = await api.listProducts({ page: 1 });
    const { data } = (await res.json()) as { data: Product[] };
    const outOfStock = data.find((p) => !p.in_stock && !p.is_rental && !p.is_location_offer);
    test.skip(!outOfStock, 'no out-of-stock product on page 1 today');
    test.fail(true, 'DEF-006: adding an out-of-stock product returns 200');

    const cartId = await api.createCartOrFail();
    const add = await api.addToCart(cartId, outOfStock!.id, 1);
    expect(add.status(), `add out-of-stock "${outOfStock!.name}"`).toBeGreaterThanOrEqual(400);
  });

  test('TC-API-049 | OBS-6 A card that expires this month is accepted', async ({ api }) => {
    test.fail(true, 'OBS-6: /payment/check rejects the current month ("must be a date after today")');
    const res = await api.checkPayment({
      payment_method: 'credit-card',
      payment_details: { ...CREDIT_CARD.valid(), expiration_date: cardExpiry(0) },
    });
    expect(res.status(), await res.text()).toBe(200);
  });

  test('TC-API-050 | OBS-7 Registration rejects an email address without @', async ({ api }) => {
    test.fail(true, 'OBS-7: an email without @ is accepted with 201');
    const res = await api.register(newCustomer({ email: `qa.${uniqueId()}.example.com` }));
    expect(res.status()).toBe(422);
  });

  test('TC-API-051 | OBS-8 A customer older than 75 is rejected, as the error message states', async ({ api }) => {
    test.fail(true, 'OBS-8: a 77-year-old customer is accepted (201)');
    const res = await api.register(newCustomer({ dob: yearsAgo(77) }));
    expect(res.status()).toBe(422);
  });

  test('TC-API-052 | OBS-9 A customer who turns 18 today can register', async ({ api }) => {
    test.fail(true, 'OBS-9: rejected with "Customer must be 18 years old." on the 18th birthday');
    const res = await api.register(newCustomer({ dob: yearsAgo(18) }));
    expect(res.status(), await res.text()).toBe(201);
  });

  test('TC-API-053 | OBS-10 Updating the quantity of a product that is not in the cart is rejected', async ({ api }) => {
    test.fail(true, 'OBS-10: returns 200 "item added or updated" and changes nothing');
    const product = await api.purchasableProduct();
    const cartId = await api.createCartOrFail();
    const res = await api.updateQuantity(cartId, product.id, 2);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });


  test('TC-API-054 | OBS-11 Registration validates the phone number like the profile update does', async ({ api }) => {
    test.fail(true, 'OBS-11: registration stores "call me maybe" as the phone; PUT /users/{id} rejects the same value');
    const res = await api.register(newCustomer({ phone: 'call me maybe' }));
    expect(res.status()).toBe(422);
  });
});
