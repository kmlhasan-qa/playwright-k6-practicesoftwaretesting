import { test, expect } from '../../fixtures';
import { CREDIT_CARD, newCustomer } from '../../helpers/data.factory';

test.describe('Checkout: payment & invoice @api', () => {
  test('TC-API-030 | Customer places an order; invoice total and lines match the cart', async ({ api, customer }) => {
    const product = await api.purchasableProduct();
    const cartId = await api.cartWith(product.id, 3);
    const address = await api.validBillingAddress();
    const payment = { payment_method: 'credit-card', payment_details: CREDIT_CARD.valid() };

    const check = await api.checkPayment(payment);
    expect(check.status()).toBe(200);
    expect(await check.json()).toEqual({ message: 'Payment was successful' });

    const res = await customer.api.createInvoice({ ...address, ...payment, cart_id: cartId });
    expect(res.status()).toBe(201);
    const invoice = await res.json();
    const expectedTotal = Math.round(product.price * 3 * 100) / 100;
    expect(invoice).toMatchObject({ invoice_number: expect.stringMatching(/^INV-\d+$/), total: expectedTotal, ...address });

    const detail = await (await customer.api.getInvoice(invoice.id)).json();
    expect(detail.status).toBe('AWAITING_FULFILLMENT');
    expect(detail.invoicelines).toEqual([
      expect.objectContaining({ product_id: product.id, quantity: 3, unit_price: product.price }),
    ]);
  });

  test('TC-API-031 | Placing an order without a token is rejected with 401', async ({ api }) => {
    const product = await api.purchasableProduct();
    const cartId = await api.cartWith(product.id);
    const res = await api.createInvoice({
      ...(await api.validBillingAddress()),
      payment_method: 'cash-on-delivery',
      payment_details: {},
      cart_id: cartId,
    });
    expect(res.status()).toBe(401);
  });

  test('TC-API-032 | Billing city that does not match the postcode is rejected with 422', async ({ api, customer }) => {
    const product = await api.purchasableProduct();
    const cartId = await api.cartWith(product.id);
    const res = await customer.api.createInvoice({
      ...(await api.validBillingAddress()),
      billing_city: 'Utrecht',
      billing_state: 'Utrecht',
      payment_method: 'cash-on-delivery',
      payment_details: {},
      cart_id: cartId,
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).billing_country[0]).toContain('The city does not belong to the selected country');
  });

  test('TC-API-033 | Order for an unknown cart returns 404', async ({ api, customer }) => {
    const res = await customer.api.createInvoice({
      ...(await api.validBillingAddress()),
      payment_method: 'cash-on-delivery',
      payment_details: {},
      cart_id: 'does-not-exist',
    });
    expect(res.status()).toBe(404);
  });

  test('TC-API-034 | Payment check rejects an expired credit card (boundary: last month)', async ({ api }) => {
    const res = await api.checkPayment({ payment_method: 'credit-card', payment_details: CREDIT_CARD.expired() });
    expect(res.status()).toBe(422);
    expect(Object.keys((await res.json()).errors)).toEqual(['payment_details.expiration_date']);
  });

  test('TC-API-035 | Payment check reports every invalid credit-card field', async ({ api }) => {
    const res = await api.checkPayment({
      payment_method: 'credit-card',
      payment_details: { credit_card_number: 'abc', expiration_date: '12/2099', cvv: '1', card_holder_name: '' },
    });
    expect(res.status()).toBe(422);
    expect(Object.keys((await res.json()).errors).sort()).toEqual(
      ['payment_details.card_holder_name', 'payment_details.credit_card_number', 'payment_details.cvv'].sort(),
    );
  });

  test('TC-API-036 | Gift card payment requires number and validation code', async ({ api }) => {
    const res = await api.checkPayment({ payment_method: 'gift-card', payment_details: { gift_card_number: '', validation_code: '' } });
    expect(res.status()).toBe(422);
    expect(Object.keys((await res.json()).errors).sort()).toEqual([
      'payment_details.gift_card_number',
      'payment_details.validation_code',
    ]);
  });

  // Other payment methods share the order path with credit card / COD (PAY-09, PAY-10, PAY-12).
  const otherMethods = [
    { method: 'gift-card', details: { gift_card_number: '1234567890123456', validation_code: '1234' }, id: 'PAY-09' },
    { method: 'bank-transfer', details: { bank_name: 'Qa Bank', account_name: 'Qa Automation', account_number: '123456789' }, id: 'PAY-10' },
    { method: 'buy-now-pay-later', details: { monthly_installments: '3' }, id: 'PAY-12' },
  ];
  for (const { method, details, id } of otherMethods) {
    test(`TC-API-037 | ${id} Order paid by ${method} is accepted and stored with that method`, async ({ api, customer }) => {
      const product = await api.purchasableProduct();
      const cartId = await api.cartWith(product.id);
      const payment = { payment_method: method, payment_details: details };

      const check = await api.checkPayment(payment);
      expect(check.status(), await check.text()).toBe(200);

      const res = await customer.api.createInvoice({ ...(await api.validBillingAddress()), ...payment, cart_id: cartId });
      expect(res.status(), await res.text()).toBe(201);
      const detail = await (await customer.api.getInvoice((await res.json()).id)).json();
      expect(detail.payment).toMatchObject({ payment_method: method });
      expect(detail.total).toBe(product.price);
    });
  }

  test('TC-API-038 | ORD-09 A customer cannot read another customer\'s invoice', async ({ api, customer }) => {
    const product = await api.purchasableProduct();
    const cartId = await api.cartWith(product.id);
    const res = await customer.api.createInvoice({
      ...(await api.validBillingAddress()),
      payment_method: 'cash-on-delivery',
      payment_details: {},
      cart_id: cartId,
    });
    expect(res.status()).toBe(201);
    const invoiceId = (await res.json()).id;

    const other = newCustomer();
    expect((await api.register(other)).status()).toBe(201);
    const otherApi = api.withToken(await api.loginOrFail(other.email, other.password));

    const peek = await otherApi.getInvoice(invoiceId);
    expect([403, 404], `customer B reading A's invoice → ${peek.status()}`).toContain(peek.status());
    expect(await peek.text()).not.toContain(customer.email);
    expect((await (await otherApi.listInvoices()).json()).data).toEqual([]);
  });

  test('TC-API-039 | Total, subtotal and status sent by the client are ignored when placing an order', async ({ api, customer }) => {
    const product = await api.purchasableProduct();
    const cartId = await api.cartWith(product.id);
    const res = await customer.api.createInvoice({
      ...(await api.validBillingAddress()),
      payment_method: 'cash-on-delivery',
      payment_details: {},
      cart_id: cartId,
      total: 0.01,
      subtotal: 0.01,
      status: 'COMPLETED',
    });
    expect(res.status()).toBe(201);
    const detail = await (await customer.api.getInvoice((await res.json()).id)).json();
    expect(detail).toMatchObject({ total: product.price, status: 'AWAITING_FULFILLMENT' });
    expect(detail.invoicelines).toEqual([expect.objectContaining({ quantity: 1, unit_price: product.price })]);
  });
});
