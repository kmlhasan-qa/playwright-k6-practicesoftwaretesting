import { Locator, Page, expect } from '@playwright/test';

/** Product overview (home page): search, filters and product cards. */
export class HomePage {
  readonly searchInput: Locator;
  readonly searchSubmit: Locator;
  readonly productNames: Locator;
  readonly cartBadge: Locator;

  constructor(private readonly page: Page) {
    this.searchInput = page.getByTestId('search-query');
    this.searchSubmit = page.getByTestId('search-submit');
    this.productNames = page.getByTestId('product-name');
    this.cartBadge = page.getByTestId('cart-quantity');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.productNames.first()).toBeVisible();
  }

  async search(term: string): Promise<void> {
    const results = this.page.waitForResponse((r) => r.url().includes('/products/search') && r.ok());
    await this.searchInput.fill(term);
    await this.searchSubmit.click();
    await results;
    await expect(this.productNames.filter({ hasText: term }).first()).toBeVisible();
  }

  /** Product cards carry `data-test="product-<id>"`. */
  productCard(productId: string): Locator {
    return this.page.getByTestId(`product-${productId}`);
  }

  async openProduct(productId: string): Promise<void> {
    await this.productCard(productId).click();
    await expect(this.page).toHaveURL(new RegExp(`/product/${productId}$`));
  }
}
