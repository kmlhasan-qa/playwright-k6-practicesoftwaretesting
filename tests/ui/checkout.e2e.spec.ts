import { test, expect } from '../../fixtures';
import { BILLING } from '../../helpers/config';
import { CREDIT_CARD } from '../../helpers/data.factory';

/**
 * Checkout is the revenue-critical workflow of the Toolshop: browse → cart → sign in →
 * billing address → payment → order (invoice). Each test runs as a freshly registered
 * customer (see `customer` fixture) so order history is isolated and can be asserted.
 */
test.describe('Checkout @ui', () => {
  test('TC-UI-001 | Customer buys 2 units of a product and receives an invoice @e2e', async ({
    page,
    api,
    customer,
    homePage,
    productPage,
    checkoutPage,
  }) => {
    const product = await api.purchasableProduct();
    const quantity = 2;

    await test.step('Find the product via search and add 2 units to the cart', async () => {
      await homePage.goto();
      await homePage.search(product.name);
      await homePage.openProduct(product.id);
      await expect(productPage.name).toHaveText(product.name);
      expect(await productPage.price()).toBe(product.price);
      await productPage.addToCart(quantity);
    });

    const expectedTotal = Math.round(product.price * quantity * 100) / 100;

    await test.step('Cart shows the line and the correct total', async () => {
      await productPage.openCart();
      await expect(checkoutPage.productTitles).toHaveText([product.name]);
      await expect(checkoutPage.lineQuantities).toHaveValue(String(quantity));
      await expect(checkoutPage.cartTotal).toHaveText(`$${expectedTotal.toFixed(2)}`);
    });

    await test.step('Sign in as the new customer', async () => {
      await checkoutPage.proceedToSignIn();
      await checkoutPage.signIn(customer.email, customer.password);
    });

    await test.step('Billing address is completed through the postcode lookup', async () => {
      await checkoutPage.waitForSavedAddress(customer.address.street);
      await checkoutPage.enterAddressViaLookup(BILLING.country, BILLING.postalCode, BILLING.houseNumber);
      await checkoutPage.proceedToPayment();
    });

    let invoiceNumber = '';
    await test.step('Pay by credit card and confirm the order', async () => {
      await checkoutPage.fillCreditCard(CREDIT_CARD.valid());
      await checkoutPage.checkPayment();
      invoiceNumber = await checkoutPage.confirmOrder();
      await expect(page.getByTestId('cart-quantity')).toBeHidden();
    });

    await test.step('Order is persisted with the right lines and total (API)', async () => {
      const res = await customer.api.listInvoices();
      expect(res.status()).toBe(200);
      const { data } = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        invoice_number: invoiceNumber,
        total: expectedTotal,
        billing_country: BILLING.country,
        billing_postal_code: BILLING.postalCode,
        status: 'AWAITING_FULFILLMENT',
      });
      expect(data[0].invoicelines).toEqual([
        expect.objectContaining({ product_id: product.id, quantity, unit_price: product.price }),
      ]);
      expect(data[0].payment).toMatchObject({ payment_method: 'credit-card' });
    });
  });

  test('TC-UI-002 | Expired credit card is rejected and no order is created @negative', async ({
    page,
    api,
    customer,
    productPage,
    checkoutPage,
  }) => {
    const product = await api.purchasableProduct();

    // Record every payment/invoice request the browser sends during this test.
    const checkoutCalls: string[] = [];
    page.on('request', (r) => {
      if (/\/(payment\/check|invoices)$/.test(r.url()) && r.method() === 'POST') checkoutCalls.push(r.url());
    });

    await page.goto(`/product/${product.id}`);
    await productPage.addToCart(1);
    await productPage.openCart();
    await checkoutPage.proceedToSignIn();
    await checkoutPage.signIn(customer.email, customer.password);
    await checkoutPage.waitForSavedAddress(customer.address.street);
    await checkoutPage.enterAddressViaLookup(BILLING.country, BILLING.postalCode, BILLING.houseNumber);
    await checkoutPage.proceedToPayment();

    await test.step('Expiry date last month → field error and payment cannot be submitted', async () => {
      await checkoutPage.fillCreditCard(CREDIT_CARD.expired());
      await expect(checkoutPage.validationErrors).toHaveText(['Expiration date must be in the future.']);
      await expect(checkoutPage.finish).toBeDisabled();
      await expect(checkoutPage.paymentSuccess).toBeHidden();
    });

    await test.step('Nothing was sent to the payment or invoice endpoints and no order exists', async () => {
      expect(checkoutCalls).toEqual([]);
      const res = await customer.api.listInvoices();
      expect((await res.json()).data).toEqual([]);
      // The cart is kept so the customer can correct the card and retry.
      await expect(page.getByTestId('cart-quantity')).toHaveText('1');
    });
  });

  /**
   * Regression test for a known defect. It asserts the CORRECT behaviour, so it fails
   * today; test.fail() keeps CI green until the defect is fixed, then flips red to
   * prompt removing the annotation.
   */
  test('TC-UI-003 | DEF-001 Rejected order shows an error instead of failing silently @negative @defect', async ({
    page,
    api,
    customer,
    productPage,
    checkoutPage,
  }) => {
    test.fail(true, 'DEF-001: POST /invoices 422 is swallowed – UI still shows "Payment was successful"');
    const product = await api.purchasableProduct();

    await page.goto(`/product/${product.id}`);
    await productPage.addToCart(1);
    await productPage.openCart();
    await checkoutPage.proceedToSignIn();
    await checkoutPage.signIn(customer.email, customer.password);
    await checkoutPage.waitForSavedAddress(customer.address.street);
    await checkoutPage.enterAddressViaLookup(BILLING.country, BILLING.postalCode, BILLING.houseNumber);
    await checkoutPage.proceedToPayment();
    await checkoutPage.payCashOnDelivery();

    // In the field this happens when the customer's saved address (pre-filled, e.g. Utrecht)
    // wins the race against the postcode lookup – timing-dependent (see OBS-2). To make it
    // deterministic, the outgoing request is rewritten to carry the saved city; the REAL
    // server then answers with its REAL 422 and we observe how the UI handles it.
    await page.route('**/invoices', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = { ...route.request().postDataJSON(), billing_city: 'Utrecht', billing_state: 'Utrecht' };
      await route.continue({ postData: JSON.stringify(body) });
    });

    const invoice = page.waitForResponse((r) => r.url().endsWith('/invoices') && r.request().method() === 'POST');
    await checkoutPage.finish.click();
    const res = await invoice;
    expect(res.status(), `API rejects the address mismatch: ${res.request().postData()}`).toBe(422);

    // Expected: the customer is told the order failed and why; "payment successful" is withdrawn.
    await expect(page.getByText(/city does not belong|could not be placed|went wrong/i)).toBeVisible();
    await expect(checkoutPage.paymentSuccess).toBeHidden();
  });
});
