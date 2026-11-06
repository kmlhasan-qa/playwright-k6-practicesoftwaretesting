import { test as base, expect } from '@playwright/test';
import { ToolshopApi } from '../helpers/api.client';
import { newCustomer, NewCustomer } from '../helpers/data.factory';
import { HomePage } from '../pages/home.page';
import { ProductPage } from '../pages/product.page';
import { CheckoutPage } from '../pages/checkout.page';

export interface Customer extends NewCustomer {
  token: string;
  /** API client authenticated as this customer. */
  api: ToolshopApi;
}

type Fixtures = {
  /** Unauthenticated API client. */
  api: ToolshopApi;
  /**
   * A brand-new registered customer for this test only. Isolates order history
   * from other runs and from people using the shared public demo.
   */
  customer: Customer;
  homePage: HomePage;
  productPage: ProductPage;
  checkoutPage: CheckoutPage;
};

export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => {
    await use(new ToolshopApi(request));
  },
  customer: async ({ api }, use) => {
    const data = newCustomer();
    const res = await api.register(data);
    expect(res.status(), `register ${data.email}`).toBe(201);
    const token = await api.loginOrFail(data.email, data.password);
    await use({ ...data, token, api: api.withToken(token) });
  },
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  productPage: async ({ page }, use) => {
    await use(new ProductPage(page));
  },
  checkoutPage: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },
});

export { expect };
