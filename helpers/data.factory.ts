import { randomInt, randomUUID } from 'node:crypto';

export interface BookingDates {
  checkin: string; // yyyy-MM-dd
  checkout: string; // yyyy-MM-dd
}

export interface BookingPayload {
  roomid: number;
  firstname: string;
  lastname: string;
  depositpaid: boolean;
  email: string;
  phone: string;
  bookingdates: BookingDates;
}

export interface MessagePayload {
  name: string;
  email: string;
  phone: string;
  subject: string;
  description: string;
}

const FIRST_NAMES = ['Amelia', 'Oliver', 'Charlotte', 'Jack', 'Isla', 'Noah', 'Sienna', 'Lucas'];
const LAST_NAMES = ['Taylor', 'Nguyen', 'Wilson', 'Hasan', 'Smith', 'Brown', 'Kelly', 'Martin'];

const pick = <T>(list: readonly T[]): T => list[randomInt(list.length)];

/** Short unique tag so data created by a run can be recognised and cleaned up. */
export const uniqueTag = (): string => randomUUID().replace(/-/g, '').slice(0, 6);

export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** dd/MM/yyyy – the format used by the home page date pickers. */
export const toUiDate = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/**
 * The demo is shared by everyone, and a room can only be booked once per night.
 * Pick a random window 3–10 years ahead so parallel workers and other users
 * practically never collide (a collision returns 409).
 */
export function futureStay(nights = 2, minYearsAhead = 3, maxYearsAhead = 10): BookingDates {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + randomInt(365 * minYearsAhead, 365 * maxYearsAhead));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + nights);
  return { checkin: toIsoDate(start), checkout: toIsoDate(end) };
}

export function buildBooking(overrides: Partial<BookingPayload> = {}): BookingPayload {
  return {
    roomid: 1,
    firstname: pick(FIRST_NAMES),
    lastname: `${pick(LAST_NAMES)}${uniqueTag().slice(0, 3)}`,
    depositpaid: false,
    email: `qa.${uniqueTag()}@example.com`,
    phone: `0${randomInt(1_000_000_000, 9_999_999_999)}`, // 11 digits
    bookingdates: futureStay(),
    ...overrides,
  };
}

export function buildMessage(overrides: Partial<MessagePayload> = {}): MessagePayload {
  const tag = uniqueTag();
  return {
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    email: `qa.${tag}@example.com`,
    phone: `0${randomInt(1_000_000_000, 9_999_999_999)}`,
    subject: `Automation enquiry ${tag}`,
    description: `Automated test message ${tag}. Please ignore – created by the Playwright suite.`,
    ...overrides,
  };
}
