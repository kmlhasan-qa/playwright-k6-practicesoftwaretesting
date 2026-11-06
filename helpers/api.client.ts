import { APIRequestContext, APIResponse } from '@playwright/test';
import { ADMIN } from './config';
import { BookingPayload, MessagePayload } from './data.factory';

/** Parse JSON, falling back to raw text for non-JSON bodies (e.g. "Internal Server Error"). */
export async function parseBody(response: APIResponse): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Normalise the two error shapes the API returns: `{ errors: [...] }` and a bare `[...]`. */
export function errorMessages(body: unknown): string[] {
  if (Array.isArray(body)) return body.map(String);
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.errors)) return b.errors.map(String);
    if (typeof b.error === 'string') return [b.error];
  }
  return [];
}

/**
 * Thin, typed wrapper around the Restful Booker Platform REST API.
 * Specs talk to this class instead of hard-coding URLs and headers.
 */
export class BookerApi {
  private token?: string;

  constructor(private readonly request: APIRequestContext) {}

  // ── Auth ────────────────────────────────────────────────────────────────
  login(username = ADMIN.username, password = ADMIN.password): Promise<APIResponse> {
    return this.request.post('/api/auth/login', { data: { username, password } });
  }

  /** Logs in as admin once and caches the token for authenticated calls. */
  async authenticate(): Promise<string> {
    if (this.token) return this.token;
    const res = await this.login();
    if (res.status() !== 200) throw new Error(`Admin login failed: ${res.status()} ${await res.text()}`);
    const body = await parseBody(res);
    const cookieToken = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => /token=([^;]+)/.exec(h.value)?.[1])
      .find(Boolean);
    this.token = (body && body.token) || cookieToken;
    if (!this.token) throw new Error('Admin login returned no token');
    return this.token;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Cookie: `token=${await this.authenticate()}` };
  }

  // ── Rooms ───────────────────────────────────────────────────────────────
  listRooms(): Promise<APIResponse> {
    return this.request.get('/api/room');
  }

  getRoom(roomId: number | string): Promise<APIResponse> {
    return this.request.get(`/api/room/${roomId}`);
  }

  // ── Bookings ────────────────────────────────────────────────────────────
  createBooking(payload: Partial<BookingPayload> | Record<string, unknown>): Promise<APIResponse> {
    return this.request.post('/api/booking', { data: payload });
  }

  /** Admin only. */
  async listBookings(roomId?: number): Promise<APIResponse> {
    return this.request.get('/api/booking', {
      headers: await this.authHeaders(),
      params: roomId ? { roomid: roomId } : undefined,
    });
  }

  listBookingsUnauthenticated(): Promise<APIResponse> {
    return this.request.get('/api/booking');
  }

  /** Admin only. */
  async deleteBooking(bookingId: number): Promise<APIResponse> {
    return this.request.delete(`/api/booking/${bookingId}`, { headers: await this.authHeaders() });
  }

  // ── Messages ────────────────────────────────────────────────────────────
  sendMessage(payload: Partial<MessagePayload>): Promise<APIResponse> {
    return this.request.post('/api/message', { data: payload });
  }

  // ── Branding ────────────────────────────────────────────────────────────
  getBranding(): Promise<APIResponse> {
    return this.request.get('/api/branding');
  }
}
