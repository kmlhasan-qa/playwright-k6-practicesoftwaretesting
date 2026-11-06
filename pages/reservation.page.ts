import { expect, Locator, Page } from '@playwright/test';
import { BookingDates, BookingPayload } from '../helpers/data.factory';

/** /reservation/{roomId}?checkin=yyyy-MM-dd&checkout=yyyy-MM-dd */
export class ReservationPage {
  readonly reserveNow: Locator;
  readonly firstname: Locator;
  readonly lastname: Locator;
  readonly email: Locator;
  readonly phone: Locator;
  readonly errors: Locator;
  readonly confirmation: Locator;

  constructor(private readonly page: Page) {
    this.reserveNow = page.getByRole('button', { name: 'Reserve Now' });
    this.firstname = page.getByPlaceholder('Firstname');
    this.lastname = page.getByPlaceholder('Lastname');
    this.email = page.getByPlaceholder('Email');
    this.phone = page.getByPlaceholder('Phone');
    this.errors = page.locator('.alert-danger li, .alert-danger p');
    this.confirmation = page.getByText('Booking Confirmed');
  }

  /**
   * Deep-links to the reservation page with explicit dates. This is the same URL the
   * home page "Book now" button produces, and lets each run pick unique dates.
   */
  async open(roomId: number, dates: BookingDates): Promise<void> {
    await this.page.goto(`/reservation/${roomId}?checkin=${dates.checkin}&checkout=${dates.checkout}`);
  }

  /** The page fetches GET /api/room/{id} before rendering; wait for that and surface failures clearly. */
  async waitForRoomDetails(roomId: number): Promise<void> {
    const res = await this.page.waitForResponse((r) => r.url().endsWith(`/api/room/${roomId}`));
    expect(res.status(), `GET /api/room/${roomId} must succeed for the reservation page to render`).toBe(200);
    await expect(this.reserveNow.first()).toBeVisible();
  }

  async startReservation(): Promise<void> {
    await this.reserveNow.first().click();
    await expect(this.firstname).toBeVisible();
  }

  async fillGuest(guest: Pick<BookingPayload, 'firstname' | 'lastname' | 'email' | 'phone'>): Promise<void> {
    await this.firstname.fill(guest.firstname);
    await this.lastname.fill(guest.lastname);
    await this.email.fill(guest.email);
    await this.phone.fill(guest.phone);
  }

  async submit(): Promise<void> {
    await this.reserveNow.last().click();
  }
}
