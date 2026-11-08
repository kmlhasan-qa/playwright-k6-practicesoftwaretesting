import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import { API_URL, BILLING } from './config';
import type { NewCustomer } from './data.factory';

export interface Product {
  id: string;
  name: string;
  price: number;
  in_stock: boolean;
  is_rental: boolean;
  is_location_offer: boolean;
}

export interface BillingAddress {
  billing_street: string;
  billing_city: string;
  billing_state: string;
  billing_country: string;
  billing_postal_code: string;
}

export type PaymentMethod = 'bank-transfer' | 'cash-on-delivery' | 'credit-card' | 'buy-now-pay-later' | 'gift-card';

/**
 * Thin, typed wrapper over the Toolshop REST API.
 *
 * Low-level methods return the raw APIResponse so tests can assert on status codes
 * (including negative cases). `…OrFail` helpers assert success and return the payload –
 * use them for arrange steps.
 */
export class ToolshopApi {
  private token?: string;

  constructor(private readonly request: APIRequestContext) {}

  private url(path: string): string {
    return `${API_URL}${path}`;
  }

  private headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  /** Returns a copy of this client that sends the given bearer token. */
  withToken(token: string): ToolshopApi {
    const c = new ToolshopApi(this.request);
    c.token = token;
    return c;
  }

  // ---------- users ----------
  register(customer: NewCustomer): Promise<APIResponse> {
    return this.request.post(this.url('/users/register'), { data: customer });
  }

  login(email: string, password: string): Promise<APIResponse> {
    return this.request.post(this.url('/users/login'), { data: { email, password } });
  }

  async loginOrFail(email: string, password: string): Promise<string> {
    const res = await this.login(email, password);
    expect(res.status(), `login as ${email}`).toBe(200);
    return (await res.json()).access_token;
  }

  me(): Promise<APIResponse> {
    return this.request.get(this.url('/users/me'), { headers: this.headers() });
  }

  // ---------- products ----------
  listProducts(params: Record<string, string | number> = {}): Promise<APIResponse> {
    return this.request.get(this.url('/products'), { params });
  }

  getProduct(id: string): Promise<APIResponse> {
    return this.request.get(this.url(`/products/${id}`));
  }

  searchProducts(q: string): Promise<APIResponse> {
    return this.request.get(this.url('/products/search'), { params: { q } });
  }

  /** First product that can be bought in a normal checkout (in stock, not a rental). */
  async purchasableProduct(): Promise<Product> {
    const res = await this.listProducts({ page: 1 });
    expect(res.status()).toBe(200);
    const { data } = (await res.json()) as { data: Product[] };
    const product = data.find((p) => p.in_stock && !p.is_rental && !p.is_location_offer);
    expect(product, 'a purchasable product exists on page 1').toBeTruthy();
    return product!;
  }

  // ---------- cart ----------
  createCart(): Promise<APIResponse> {
    return this.request.post(this.url('/carts'));
  }

  async createCartOrFail(): Promise<string> {
    const res = await this.createCart();
    expect(res.status()).toBe(201);
    return (await res.json()).id;
  }

  addToCart(cartId: string, productId: string, quantity: unknown): Promise<APIResponse> {
    return this.request.post(this.url(`/carts/${cartId}`), { data: { product_id: productId, quantity } });
  }

  /** Sends an arbitrary add-to-cart body (e.g. extra fields a tampering client might send). */
  addToCartRaw(cartId: string, body: Record<string, unknown>): Promise<APIResponse> {
    return this.request.post(this.url(`/carts/${cartId}`), { data: body });
  }

  updateQuantity(cartId: string, productId: string, quantity: unknown): Promise<APIResponse> {
    return this.request.put(this.url(`/carts/${cartId}/product/quantity`), {
      data: { product_id: productId, quantity },
    });
  }

  getCart(cartId: string): Promise<APIResponse> {
    return this.request.get(this.url(`/carts/${cartId}`));
  }

  /** Creates a cart containing `quantity` of the product; returns the cart id. */
  async cartWith(productId: string, quantity = 1): Promise<string> {
    const cartId = await this.createCartOrFail();
    const res = await this.addToCart(cartId, productId, quantity);
    expect(res.status(), 'add item to cart').toBe(200);
    return cartId;
  }

  // ---------- checkout ----------
  postcodeLookup(country: string, postcode: string, houseNumber?: string): Promise<APIResponse> {
    return this.request.get(this.url('/postcode-lookup'), {
      params: { country, postcode, ...(houseNumber ? { house_number: houseNumber } : {}) },
    });
  }

  /** A billing address the API accepts (city/state resolved through the postcode lookup). */
  async validBillingAddress(): Promise<BillingAddress> {
    const res = await this.postcodeLookup(BILLING.country, BILLING.postalCode, BILLING.houseNumber);
    expect(res.status()).toBe(200);
    const a = await res.json();
    return {
      billing_street: `${a.street} ${a.house_number}`,
      billing_city: a.city,
      billing_state: a.state,
      billing_country: BILLING.country,
      billing_postal_code: BILLING.postalCode,
    };
  }

  checkPayment(body: unknown): Promise<APIResponse> {
    return this.request.post(this.url('/payment/check'), { data: body });
  }

  createInvoice(body: Record<string, unknown>): Promise<APIResponse> {
    return this.request.post(this.url('/invoices'), { data: body, headers: this.headers() });
  }

  listInvoices(): Promise<APIResponse> {
    return this.request.get(this.url('/invoices'), { headers: this.headers() });
  }

  getInvoice(id: string): Promise<APIResponse> {
    return this.request.get(this.url(`/invoices/${id}`), { headers: this.headers() });
  }
}
