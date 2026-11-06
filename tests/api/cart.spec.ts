import { test, expect } from '../../fixtures';
import { RULES } from '../../helpers/config';

const { min, max } = RULES.cartQuantity;

test.describe('Cart @api', () => {
  test('TC-API-020 | Create a cart, add a product and read it back', async ({ api }) => {
    const product = await api.purchasableProduct();
    const cartId = await api.createCartOrFail();

    const add = await api.addToCart(cartId, product.id, 2);
    expect(add.status()).toBe(200);
    expect(await add.json()).toEqual({ result: 'item added or updated' });

    const cart = await (await api.getCart(cartId)).json();
    expect(cart.id).toBe(cartId);
    expect(cart.cart_items).toEqual([
      expect.objectContaining({ product_id: product.id, quantity: 2, product: expect.objectContaining({ price: product.price }) }),
    ]);
  });

  // Boundary value analysis on quantity: min-1, min, max, max+1 plus type checks.
  const cases: { quantity: unknown; status: number; label: string }[] = [
    { quantity: min - 1, status: 422, label: `${min - 1} (min-1)` },
    { quantity: -1, status: 422, label: 'negative' },
    { quantity: min, status: 200, label: `${min} (min)` },
    { quantity: max, status: 200, label: `${max} (max)` },
    { quantity: max + 1, status: 422, label: `${max + 1} (max+1)` },
    { quantity: 1.5, status: 422, label: 'decimal' },
    { quantity: 'abc', status: 422, label: 'non-numeric' },
  ];
  for (const { quantity, status, label } of cases) {
    test(`TC-API-021 | Add to cart with quantity ${label} → ${status}`, async ({ api }) => {
      const product = await api.purchasableProduct();
      const cartId = await api.createCartOrFail();
      const res = await api.addToCart(cartId, product.id, quantity);
      expect(res.status()).toBe(status);
      if (status === 422) expect((await res.json()).errors).toHaveProperty('quantity');
    });
  }

  test('TC-API-022 | Adding a non-existent product is rejected with 422', async ({ api }) => {
    const cartId = await api.createCartOrFail();
    const res = await api.addToCart(cartId, '01AAAAAAAAAAAAAAAAAAAAAAAA', 1);
    expect(res.status()).toBe(422);
    expect((await res.json()).errors.product_id).toEqual(['The selected product id is invalid.']);
  });

  test('TC-API-023 | Update quantity of a cart line; out-of-range update is rejected', async ({ api }) => {
    const product = await api.purchasableProduct();
    const cartId = await api.cartWith(product.id, 1);

    expect((await api.updateQuantity(cartId, product.id, 5)).status()).toBe(200);
    expect((await api.updateQuantity(cartId, product.id, max + 1)).status()).toBe(422);

    const cart = await (await api.getCart(cartId)).json();
    expect(cart.cart_items.map((i: { quantity: number }) => i.quantity)).toEqual([5]);
  });
});
