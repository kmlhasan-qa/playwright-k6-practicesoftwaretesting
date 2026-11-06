import { Locator, Page, expect } from '@playwright/test';

/** Product detail page: /product/{id}. */
export class ProductPage {
  readonly name: Locator;
  readonly unitPrice: Locator;
  readonly quantity: Locator;
  readonly addToCartButton: Locator;
  readonly cartBadge: Locator;
  readonly navCart: Locator;

  constructor(private readonly page: Page) {
    this.name = page.getByTestId('product-name');
    this.unitPrice = page.getByTestId('unit-price');
    this.quantity = page.getByTestId('quantity');
    this.addToCartButton = page.getByTestId('add-to-cart');
    this.cartBadge = page.getByTestId('cart-quantity');
    this.navCart = page.getByTestId('nav-cart');
  }

  async price(): Promise<number> {
    return Number(await this.unitPrice.innerText());
  }

  /** Sets the quantity and adds to cart; waits for the API to confirm the cart update. */
  async addToCart(quantity = 1): Promise<void> {
    await this.quantity.fill(String(quantity));
    const added = this.page.waitForResponse(
      (r) => /\/carts\/[^/]+$/.test(r.url()) && r.request().method() === 'POST',
    );
    await this.addToCartButton.click();
    expect((await added).status(), 'POST /carts/{id}').toBe(200);
    await expect(this.cartBadge).toHaveText(String(quantity));
  }

  async openCart(): Promise<void> {
    await this.navCart.click();
    await expect(this.page).toHaveURL(/\/checkout$/);
  }
}
