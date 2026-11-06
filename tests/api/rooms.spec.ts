import { test, expect } from '../../fixtures';
import { parseBody } from '../../helpers/api.client';
import { SEEDED_ROOM_IDS } from '../../helpers/config';

test.describe('Rooms @api', () => {
  test('TC-API-010 | GET /api/room lists rooms with the expected contract', async ({ api }) => {
    const res = await api.listRooms();
    expect(res.status()).toBe(200);

    const { rooms } = await res.json();
    expect(Array.isArray(rooms)).toBe(true);
    expect(rooms.length).toBeGreaterThan(0);
    for (const room of rooms) {
      expect(room).toEqual(
        expect.objectContaining({
          roomid: expect.any(Number),
          roomName: expect.any(String),
          type: expect.any(String),
          accessible: expect.any(Boolean),
          roomPrice: expect.any(Number),
          features: expect.any(Array),
        }),
      );
      expect(room.roomPrice).toBeGreaterThan(0);
    }
  });

  for (const roomId of SEEDED_ROOM_IDS) {
    // DEF-001: currently returns 500 "Internal Server Error" (see booking.spec.ts for the test.fail() convention).
    test(`TC-API-011 | DEF-001 GET /api/room/${roomId} returns the room details @defect`, async ({ api }) => {
      test.fail(true, 'DEF-001: GET /api/room/{id} returns 500 for every room');
      const res = await api.getRoom(roomId);
      expect(res.status(), `body: ${await res.text()}`).toBe(200);
      expect(await parseBody(res)).toEqual(expect.objectContaining({ roomid: roomId }));
    });
  }
});
