import { Locator, Page, expect } from '@playwright/test';

export interface CardDetails {
  credit_card_number: string;
  expiration_date: string;
  cvv: string;
  card_holder_name: string;
}

/**
 * The 4-step checkout wizard at /checkout:
 *   1. Cart  →  2. Sign in  →  3. Billing address  →  4. Payment
 */
export class CheckoutPage {
  // step 1 – cart
  readonly productTitles: Locator;
  readonly lineQuantities: Locator;
  readonly linePrices: Locator;
  readonly cartTotal: Locator;
  readonly proceedFromCart: Locator;
  // step 2 – sign in
  readonly email: Locator;
  readonly password: Locator;
  readonly loginSubmit: Locator;
  readonly proceedFromSignIn: Locator;
  // step 3 – billing address
  readonly country: Locator;
  readonly postalCode: Locator;
  readonly houseNumber: Locator;
  readonly street: Locator;
  readonly city: Locator;
  readonly state: Locator;
  readonly proceedFromAddress: Locator;
  // step 4 – payment
  readonly paymentMethod: Locator;
  readonly cardNumber: Locator;
  readonly expirationDate: Locator;
  readonly cvv: Locator;
  readonly cardHolder: Locator;
  readonly finish: Locator;
  readonly paymentSuccess: Locator;
  readonly orderConfirmation: Locator;

  constructor(private readonly page: Page) {
    this.productTitles = page.getByTestId('product-title');
    this.lineQuantities = page.getByTestId('product-quantity');
    this.linePrices = page.getByTestId('line-price');
    this.cartTotal = page.getByTestId('cart-total');
    this.proceedFromCart = page.getByTestId('proceed-1');

    this.email = page.getByTestId('email');
    this.password = page.getByTestId('password');
    this.loginSubmit = page.getByTestId('login-submit');
    this.proceedFromSignIn = page.getByTestId('proceed-2');

    this.country = page.getByTestId('country');
    this.postalCode = page.getByTestId('postal_code');
    this.houseNumber = page.getByTestId('house_number');
    this.street = page.getByTestId('street');
    this.city = page.getByTestId('city');
    this.state = page.getByTestId('state');
    this.proceedFromAddress = page.getByTestId('proceed-3');

    this.paymentMethod = page.getByTestId('payment-method');
    this.cardNumber = page.getByTestId('credit_card_number');
    this.expirationDate = page.getByTestId('expiration_date');
    this.cvv = page.getByTestId('cvv');
    this.cardHolder = page.getByTestId('card_holder_name');
    this.finish = page.getByTestId('finish');
    this.paymentSuccess = page.getByTestId('payment-success-message');
    this.orderConfirmation = page.getByText(/Thanks for your order! Your invoice number is/);
  }

  /** Field-level validation messages shown under payment inputs. */
  get validationErrors(): Locator {
    return this.page.locator('.alert-danger');
  }

  async proceedToSignIn(): Promise<void> {
    await this.proceedFromCart.click();
    await expect(this.loginSubmit).toBeVisible();
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.email.fill(email);
    await this.password.fill(password);
    const login = this.page.waitForResponse((r) => r.url().endsWith('/users/login'));
    await this.loginSubmit.click();
    expect((await login).status(), 'POST /users/login').toBe(200);
    await this.proceedFromSignIn.click();
    await expect(this.country).toBeVisible();
  }

  /**
   * Enters country + postcode + house number. The app then calls GET /postcode-lookup
   * and fills street, city and state, which the API later validates against.
   */
  /**
   * The signed-in customer's saved address is pre-filled asynchronously and can land
   * *after* a postcode lookup, silently overwriting it (observed race, see OBS-2).
   * Wait for the pre-fill to settle before touching the address.
   */
  async waitForSavedAddress(street: string): Promise<void> {
    await expect(this.street).toHaveValue(street);
  }

  async enterAddressViaLookup(country: string, postalCode: string, houseNumber: string): Promise<void> {
    // Retry until the form holds exactly what the lookup returned – that is what the API
    // validates billing city/state against.
    await expect(async () => {
      await this.country.selectOption(country);
      await this.postalCode.fill(postalCode);
      await this.houseNumber.clear();
      const lookup = this.page.waitForResponse((r) => r.url().includes('/postcode-lookup') && r.ok(), {
        timeout: 5_000,
      });
      await this.houseNumber.fill(houseNumber);
      await this.houseNumber.blur();
      const expected = await (await lookup).json();
      await expect(this.city).toHaveValue(expected.city, { timeout: 2_000 });
      await expect(this.state).toHaveValue(expected.state, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }

  async payCashOnDelivery(): Promise<void> {
    await this.paymentMethod.selectOption('cash-on-delivery');
    await this.checkPayment();
  }

  async proceedToPayment(): Promise<void> {
    await expect(this.proceedFromAddress).toBeEnabled();
    await this.proceedFromAddress.click();
    await expect(this.paymentMethod).toBeVisible();
  }

  async fillCreditCard(card: CardDetails): Promise<void> {
    await this.paymentMethod.selectOption('credit-card');
    await this.cardNumber.fill(card.credit_card_number);
    await this.expirationDate.fill(card.expiration_date);
    await this.cvv.fill(card.cvv);
    await this.cardHolder.fill(card.card_holder_name);
    await this.cardHolder.blur();
  }

  async checkPayment(): Promise<void> {
    const payment = this.page.waitForResponse((r) => r.url().endsWith('/payment/check'));
    await this.finish.click();
    expect((await payment).status(), 'POST /payment/check').toBe(200);
    await expect(this.paymentSuccess).toHaveText('Payment was successful');
  }

  /** Confirms the order; returns the invoice number shown to the customer. */
  async confirmOrder(): Promise<string> {
    const invoice = this.page.waitForResponse(
      (r) => r.url().endsWith('/invoices') && r.request().method() === 'POST',
    );
    await this.finish.click();
    const res = await invoice;
    expect(res.status(), `POST /invoices ${res.request().postData()} → ${await res.text()}`).toBe(201);
    await expect(this.orderConfirmation).toBeVisible();
    const text = await this.orderConfirmation.innerText();
    const match = text.match(/INV-\d+/);
    expect(match, `invoice number in "${text}"`).not.toBeNull();
    return match![0];
  }
}
