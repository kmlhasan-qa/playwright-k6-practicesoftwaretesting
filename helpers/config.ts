import 'dotenv/config';

/**
 * Single source of truth for environment configuration.
 * Every value can be overridden via an environment variable or a local .env file.
 */
const env = process.env;

export const BASE_URL = env.BASE_URL ?? 'https://practicesoftwaretesting.com';
export const API_URL = env.API_URL ?? 'https://api.practicesoftwaretesting.com';
export const HEADLESS = (env.HEADLESS ?? 'true').toLowerCase() !== 'false';

/** Seeded demo accounts published in the application documentation. */
export const DEMO_ACCOUNTS = {
  customer: {
    email: env.CUSTOMER_EMAIL ?? 'customer@practicesoftwaretesting.com',
    password: env.CUSTOMER_PASSWORD ?? 'welcome01',
  },
} as const;

/**
 * Billing address used for checkout.
 *
 * The API validates that billing city/state match what GET /postcode-lookup returns
 * for the given country + postal code (the lookup is the "source of truth", backed by
 * a deterministic faker driver on the demo). Tests therefore resolve city/state through
 * the lookup instead of hard-coding them.
 */
export const BILLING = {
  country: 'NL',
  postalCode: '3511AA',
  houseNumber: '1',
} as const;

/** Business rules observed on the API (see docs/ and the README). */
export const RULES = {
  cartQuantity: { min: 1, max: 99 },
  password: { minLength: 8 },
} as const;
