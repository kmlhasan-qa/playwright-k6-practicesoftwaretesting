import { test, expect } from '../../fixtures';

test.describe('Products @api', () => {
  test('TC-API-010 | GET /products returns a paginated list with the expected contract', async ({ api }) => {
    const res = await api.listProducts({ page: 1 });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ current_page: 1, per_page: expect.any(Number), total: expect.any(Number) });
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.length).toBeLessThanOrEqual(body.per_page);
    for (const p of body.data) {
      expect(p).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        price: expect.any(Number),
        in_stock: expect.any(Boolean),
      });
      expect(p.price).toBeGreaterThan(0);
    }
  });

  test('TC-API-011 | GET /products/{id} returns the same product as the list', async ({ api }) => {
    const product = await api.purchasableProduct();
    const res = await api.getProduct(product.id);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ id: product.id, name: product.name, price: product.price });
  });

  test('TC-API-012 | GET /products/{id} for an unknown id returns 404', async ({ api }) => {
    const res = await api.getProduct('01AAAAAAAAAAAAAAAAAAAAAAAA');
    expect(res.status()).toBe(404);
  });

  test('TC-API-013 | Search returns only matching products', async ({ api }) => {
    const res = await api.searchProducts('pliers');
    expect(res.status()).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBeGreaterThan(0);
    for (const p of data) expect(p.name.toLowerCase()).toContain('pliers');
  });
});
