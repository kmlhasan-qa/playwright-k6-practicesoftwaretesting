import { test, expect } from '../../fixtures';
import { buildBooking, futureStay } from '../../helpers/data.factory';

/**
 * High-value scenario #1 – happy path.
 * A guest picks a room on the home page, opens the reservation page, enters
 * their details and receives a booking confirmation. The booking is then
 * verified through the admin API and cleaned up.
 *
 * NOTE: at the time of writing GET /api/room/{id} returns 500 on the public demo
 * (see DEF-001 in the README), so this test fails at `waitForRoomDetails` with a
 * clear message. That is intended: it is the regression signal for the defect.
 */
test.describe('Room booking – end to end @e2e', () => {
  test('TC-UI-001 | Guest books a Single room and sees a confirmation', async ({
    page,
    homePage,
    reservationPage,
    api,
    cleanupBookings,
  }) => {
    const roomId = 1;
    const guest = buildBooking({ roomid: roomId, bookingdates: futureStay(2) });

    await test.step('Home page lists the Single room with a Book now link', async () => {
      await homePage.goto();
      await expect(homePage.roomCard('Single')).toBeVisible();
      await expect(homePage.bookNowLink('Single')).toHaveAttribute('href', new RegExp(`/reservation/${roomId}`));
    });

    await test.step('Open the reservation page for unique future dates', async () => {
      const roomDetails = reservationPage.waitForRoomDetails(roomId);
      await reservationPage.open(roomId, guest.bookingdates);
      await roomDetails;
    });

    await test.step('Enter guest details and reserve', async () => {
      await reservationPage.startReservation();
      await reservationPage.fillGuest(guest);
      const created = page.waitForResponse((r) => r.url().endsWith('/api/booking') && r.request().method() === 'POST');
      await reservationPage.submit();
      const res = await created;
      expect(res.status()).toBe(201);
      cleanupBookings.push((await res.json()).bookingid);
    });

    await test.step('Confirmation shows the booked dates', async () => {
      await expect(reservationPage.confirmation).toBeVisible();
      await expect(page.getByText(guest.bookingdates.checkin)).toBeVisible();
      await expect(page.getByText(guest.bookingdates.checkout)).toBeVisible();
    });

    await test.step('Booking is persisted (admin API)', async () => {
      const res = await api.listBookings(roomId);
      expect(res.status()).toBe(200);
      const { bookings } = await res.json();
      expect(bookings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ firstname: guest.firstname, lastname: guest.lastname, bookingdates: guest.bookingdates }),
        ]),
      );
    });
  });

  test('TC-UI-002 | Reservation form blocks submission when guest details are empty', async ({
    page,
    reservationPage,
  }) => {
    const roomId = 2;
    const dates = futureStay(1);
    let bookingCreated = false;
    page.on('response', (r) => {
      if (r.url().endsWith('/api/booking') && r.request().method() === 'POST' && r.status() === 201) bookingCreated = true;
    });

    const roomDetails = reservationPage.waitForRoomDetails(roomId);
    await reservationPage.open(roomId, dates);
    await roomDetails;
    await reservationPage.startReservation();
    await reservationPage.submit();

    await expect(reservationPage.errors.first()).toBeVisible();
    await expect(page.getByText('Firstname should not be blank')).toBeVisible();
    await expect(page.getByText('Lastname should not be blank')).toBeVisible();
    await expect(reservationPage.confirmation).toHaveCount(0);
    expect(bookingCreated, 'no booking should be created').toBe(false);
  });
});
