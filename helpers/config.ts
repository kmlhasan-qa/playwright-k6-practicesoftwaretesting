import 'dotenv/config';

/**
 * Single source of truth for environment configuration.
 * Every value can be overridden via an environment variable or a local .env file.
 */
const env = process.env;

export const BASE_URL = env.BASE_URL ?? 'https://automationintesting.online';
export const HEADLESS = (env.HEADLESS ?? 'true').toLowerCase() !== 'false';

/** Public demo admin account published by the Restful Booker Platform. */
export const ADMIN = {
  username: env.ADMIN_USERNAME ?? 'admin',
  password: env.ADMIN_PASSWORD ?? 'password',
};

/** Rooms seeded by the demo (reset periodically by the platform). */
export const SEEDED_ROOM_IDS = [1, 2, 3] as const;

/** Field rules observed on POST /api/booking and POST /api/message. */
export const RULES = {
  booking: {
    firstname: { min: 3, max: 18 },
    lastname: { min: 3, max: 30 },
    phone: { min: 11, max: 21 },
  },
  message: {
    phone: { min: 11, max: 21 },
    subject: { min: 5, max: 100 },
    description: { min: 20, max: 2000 },
  },
} as const;
