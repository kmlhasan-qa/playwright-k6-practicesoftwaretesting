import { randomUUID } from 'node:crypto';

/** Unique, self-identifying test data so runs never collide on the shared public demo. */
export function uniqueId(): string {
  return `${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
}

export interface NewCustomer {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  dob: string;
  phone: string;
  address: {
    street: string;
    house_number: string;
    city: string;
    state: string;
    country: string;
    postal_code: string;
  };
}

/** A valid registration payload (password satisfies upper/lower/number/symbol, adult DOB). */
export function newCustomer(overrides: Partial<NewCustomer> = {}): NewCustomer {
  const id = uniqueId();
  return {
    first_name: 'Qa',
    last_name: 'Automation',
    email: `qa.${id}@example.com`,
    password: `Qa!${id}Aa1`,
    dob: '1990-05-15',
    phone: '0612345678',
    address: {
      street: 'Oudegracht',
      house_number: '1',
      city: 'Utrecht',
      state: 'Utrecht',
      country: 'NL',
      postal_code: '3511AA',
    },
    ...overrides,
  };
}

/** MM/YYYY a number of months from today (negative = in the past). */
export function cardExpiry(monthsFromNow: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + monthsFromNow);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export const CREDIT_CARD = {
  valid: () => ({
    credit_card_number: '1111-1111-1111-1111',
    expiration_date: cardExpiry(24),
    cvv: '123',
    card_holder_name: 'Qa Automation',
  }),
  expired: () => ({
    credit_card_number: '1111-1111-1111-1111',
    expiration_date: cardExpiry(-1),
    cvv: '123',
    card_holder_name: 'Qa Automation',
  }),
};
