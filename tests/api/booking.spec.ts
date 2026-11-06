import { test, expect } from '../../fixtures';
import { errorMessages, parseBody } from '../../helpers/api.client';
import { buildBooking, futureStay } from '../../helpers/data.factory';

test.describe('POST /api/booking – happy path @api', () => {
  test('TC-API-020 | Guest creates a booking and admin can see it', async ({ api, cleanupBookings }) => {
    const payload = buildBooking({ roomid: 2, depositpaid: true });

    const res = await api.createBooking(payload);
    expect(res.status()).toBe(201);
    const body = await res.json();
    cleanupBookings.push(body.bookingid);

    expect(body).toEqual(
      expect.objectContaining({
        bookingid: expect.any(Number),
        roomid: payload.roomid,
        firstname: payload.firstname,
        lastname: payload.lastname,
        depositpaid: true,
        bookingdates: payload.bookingdates,
      }),
    );
    // PII such as email/phone should not be echoed back to an anonymous caller.
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('phone');

    const list = await api.listBookings(payload.roomid);
    expect(list.status()).toBe(200);
    const { bookings } = await list.json();
    expect(bookings.map((b: { bookingid: number }) => b.bookingid)).toContain(body.bookingid);
  });

  test('TC-API-021 | Same room, overlapping dates is rejected with 409 (no double booking)', async ({
    api,
    cleanupBookings,
  }) => {
    const first = buildBooking({ roomid: 3 });
    const res1 = await api.createBooking(first);
    expect(res1.status()).toBe(201);
    cleanupBookings.push((await res1.json()).bookingid);

    const res2 = await api.createBooking(buildBooking({ roomid: 3, bookingdates: first.bookingdates }));
    expect(res2.status()).toBe(409);
  });
});

test.describe('POST /api/booking – validation @api', () => {
  const cases: Array<{ id: string; name: string; override: Record<string, unknown>; errors: string[] }> = [
    { id: 'TC-API-030', name: 'blank firstname', override: { firstname: '' }, errors: ['Firstname should not be blank', 'size must be between 3 and 18'] },
    { id: 'TC-API-031', name: 'firstname 2 chars (min-1)', override: { firstname: 'Al' }, errors: ['size must be between 3 and 18'] },
    { id: 'TC-API-032', name: 'firstname 19 chars (max+1)', override: { firstname: 'A'.repeat(19) }, errors: ['size must be between 3 and 18'] },
    { id: 'TC-API-033', name: 'lastname 31 chars (max+1)', override: { lastname: 'B'.repeat(31) }, errors: ['size must be between 3 and 30'] },
    { id: 'TC-API-034', name: 'malformed email', override: { email: 'not-an-email' }, errors: ['must be a well-formed email address'] },
    { id: 'TC-API-035', name: 'phone 10 chars (min-1)', override: { phone: '0123456789' }, errors: ['size must be between 11 and 21'] },
    { id: 'TC-API-036', name: 'phone 22 chars (max+1)', override: { phone: '1'.repeat(22) }, errors: ['size must be between 11 and 21'] },
  ];

  for (const c of cases) {
    test(`${c.id} | Rejects ${c.name} with 400`, async ({ api }) => {
      const res = await api.createBooking(buildBooking(c.override));
      expect(res.status()).toBe(400);
      expect(errorMessages(await parseBody(res)).sort()).toEqual([...c.errors].sort());
    });
  }

  test('TC-API-037 | Boundary: firstname 18 / lastname 30 / phone 21 chars are accepted', async ({
    api,
    cleanupBookings,
  }) => {
    const res = await api.createBooking(
      buildBooking({ firstname: 'A'.repeat(18), lastname: 'B'.repeat(30), phone: '1'.repeat(21) }),
    );
    expect(res.status()).toBe(201);
    cleanupBookings.push((await res.json()).bookingid);
  });

  test('TC-API-038 | Checkout before checkin is rejected', async ({ api }) => {
    const res = await api.createBooking(
      buildBooking({ bookingdates: { checkin: '2031-06-12', checkout: '2031-06-10' } }),
    );
    // Observed: 409 "Failed to create booking". A 400 with a field message would be more accurate.
    expect([400, 409]).toContain(res.status());
  });
});

/**
 * Known defects – each test asserts the CORRECT behaviour, so it fails today and
 * turns green when fixed. Marked with test.fail() so CI stays green while the
 * defect is open, and flips red (unexpected pass) once it is fixed so the
 * annotation can be removed.
 */
test.describe('POST /api/booking – known defects @api @defect', () => {
  test('TC-API-040 | DEF-002 Booking dates in the past are rejected', async ({ api, cleanupBookings }) => {
    test.fail(true, 'DEF-002: API returns 201 for past dates');
    const res = await api.createBooking(buildBooking({ bookingdates: { checkin: '2020-01-10', checkout: '2020-01-12' } }));
    if (res.status() === 201) cleanupBookings.push((await res.json()).bookingid);
    expect(res.status()).toBe(400);
  });

  test('TC-API-041 | DEF-003 Booking a non-existent room is rejected', async ({ api, cleanupBookings }) => {
    test.fail(true, 'DEF-003: API returns 201 for roomid 99999');
    const res = await api.createBooking(buildBooking({ roomid: 99999 }));
    if (res.status() === 201) cleanupBookings.push((await res.json()).bookingid);
    expect([400, 404]).toContain(res.status());
  });

  test('TC-API-042 | DEF-004 Missing bookingdates returns a 400 validation error, not 500', async ({ api }) => {
    test.fail(true, 'DEF-004: API returns 500 when bookingdates is omitted');
    const { bookingdates: _omit, ...withoutDates } = buildBooking();
    const res = await api.createBooking(withoutDates);
    expect(res.status()).toBe(400);
  });
});

test('TC-API-039 | Same-day checkin/checkout (0 nights) is rejected @api', async ({ api }) => {
  const day = futureStay(0).checkin;
  const res = await api.createBooking(buildBooking({ bookingdates: { checkin: day, checkout: day } }));
  expect([400, 409]).toContain(res.status());
});
