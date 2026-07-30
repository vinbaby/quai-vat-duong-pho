import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const USER_ONE = "11111111-1111-4111-8111-111111111111";
const USER_TWO = "22222222-2222-4222-8222-222222222222";

function upgradeRequest(userId: string, name: string): Request {
  return new Request("https://example.com/api/room?country=VN&room=1", {
    headers: {
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": "qv-game-v1",
      "X-QV-User-Id": userId,
      "X-QV-Player-Name": encodeURIComponent(name),
    },
  });
}

describe("GameRoom", () => {
  it("accepts two authenticated internal identities and broadcasts server-owned IDs", async () => {
    const room = env.GAME_ROOM.getByName("VN-1-test");
    const first = await room.fetch(upgradeRequest(USER_ONE, "Mèo Một"));
    const second = await room.fetch(upgradeRequest(USER_TWO, "Mèo Hai"));
    expect(first.status).toBe(101);
    expect(second.status).toBe(101);

    const firstSocket = first.webSocket;
    const secondSocket = second.webSocket;
    expect(firstSocket).not.toBeNull();
    expect(secondSocket).not.toBeNull();
    firstSocket!.accept();
    secondSocket!.accept();

    const received = new Promise<Record<string, unknown>>((resolve) => {
      secondSocket!.addEventListener("message", (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as { type: string; payload: Record<string, unknown> };
        if (message.type === "player-state") resolve(message.payload);
      });
    });
    firstSocket!.send(JSON.stringify({
      type: "player-state",
      payload: {
        id: USER_TWO,
        name: "Giả mạo",
        seq: 1,
        x: 100,
        y: 200,
        vx: 10,
        vy: 20,
        score: 5,
      },
    }));
    await expect(received).resolves.toMatchObject({ id: USER_ONE, name: "Mèo Một", x: 100, y: 200 });
    firstSocket!.close(1000, "done");
    secondSocket!.close(1000, "done");
  });

  it("rejects missing server identity", async () => {
    const room = env.GAME_ROOM.getByName("VN-2-test");
    const response = await room.fetch(new Request("https://example.com/api/room", {
      headers: { Upgrade: "websocket" },
    }));
    expect(response.status).toBe(401);
  });
});
