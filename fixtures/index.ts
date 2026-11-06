import { test as base, expect } from '@playwright/test';
import { BookerApi } from '../helpers/api.client';
import { HomePage } from '../pages/home.page';
import { ReservationPage } from '../pages/reservation.page';

type Fixtures = {
  api: BookerApi;
  homePage: HomePage;
  reservationPage: ReservationPage;
  /** Register booking ids created during a test; they are deleted (best effort) afterwards. */
  cleanupBookings: number[];
};

export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => {
    await use(new BookerApi(request));
  },
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  reservationPage: async ({ page }, use) => {
    await use(new ReservationPage(page));
  },
  cleanupBookings: async ({ api }, use) => {
    const ids: number[] = [];
    await use(ids);
    for (const id of ids) {
      await api.deleteBooking(id).catch(() => undefined);
    }
  },
});

export { expect };
