import { expect, Locator, Page } from '@playwright/test';
import { MessagePayload } from '../helpers/data.factory';

/** Landing page: hero, availability search, room cards and the contact form. */
export class HomePage {
  readonly roomsHeading: Locator;
  readonly roomCards: Locator;

  // Contact form (the app exposes stable data-testid hooks here)
  readonly contactName: Locator;
  readonly contactEmail: Locator;
  readonly contactPhone: Locator;
  readonly contactSubject: Locator;
  readonly contactDescription: Locator;
  readonly contactSubmit: Locator;
  readonly contactErrors: Locator;

  constructor(private readonly page: Page) {
    this.roomsHeading = page.getByRole('heading', { name: 'Our Rooms' });
    this.roomCards = page.locator('.room-card');

    this.contactName = page.getByTestId('ContactName');
    this.contactEmail = page.getByTestId('ContactEmail');
    this.contactPhone = page.getByTestId('ContactPhone');
    this.contactSubject = page.getByTestId('ContactSubject');
    this.contactDescription = page.getByTestId('ContactDescription');
    this.contactSubmit = page.locator('#contact').getByRole('button', { name: 'Submit' });
    this.contactErrors = page.locator('.alert-danger p');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.roomsHeading).toBeVisible();
  }

  /** Room card for a given room type (Single / Double / Suite). */
  roomCard(type: string): Locator {
    return this.roomCards.filter({ has: this.page.getByRole('heading', { name: type, exact: true }) }).first();
  }

  bookNowLink(type: string): Locator {
    return this.roomCard(type).getByRole('link', { name: /book now/i });
  }

  async fillContactForm(msg: Partial<MessagePayload>): Promise<void> {
    if (msg.name !== undefined) await this.contactName.fill(msg.name);
    if (msg.email !== undefined) await this.contactEmail.fill(msg.email);
    if (msg.phone !== undefined) await this.contactPhone.fill(msg.phone);
    if (msg.subject !== undefined) await this.contactSubject.fill(msg.subject);
    if (msg.description !== undefined) await this.contactDescription.fill(msg.description);
  }

  async submitContactForm(): Promise<void> {
    await this.contactSubmit.click();
  }

  contactSuccess(name: string): Locator {
    return this.page.getByRole('heading', { name: `Thanks for getting in touch ${name}!` });
  }
}
