import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const USER_ONE = "11111111-1111-4111-8111-111111111111";
const USER_TWO = "22222222-2222-4222-8222-222222222222";

function userId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function firstRoomHole(): { x: number; y: number } {
  const topic = "game:street-vn-1";
  let seed = 7;
  for (const character of topic) {
    seed = ((seed << 5) - seed + character.charCodeAt(0)) | 0;
  }
  seed >>>= 0;
  const random = (index: number) => {
    const value = Math.sin(seed + index * 999) * 43758.5453;
    return value - Math.floor(value);
  };
  return { x: 260 + random(0) * 2080, y: 220 + random(1) * 1360 };
}

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

async function closeSockets(sockets: WebSocket[]): Promise<void> {
  for (const socket of sockets) socket.close(1000, "done");
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: { type: string; payload: Record<string, unknown> }) => boolean,
): Promise<{ type: string; payload: Record<string, unknown> }> {
  return new Promise((resolve) => {
    socket.addEventListener("message", function onMessage(event: MessageEvent) {
      const message = JSON.parse(String(event.data)) as { type: string; payload: Record<string, unknown> };
      if (!predicate(message)) return;
      socket.removeEventListener("message", onMessage);
      resolve(message);
    });
  });
}

describe("GameRoom", () => {
  it("ships the server-score client without broadcasting a client-owned score", async () => {
    const response = await env.ASSETS.fetch(new Request("https://example.com/"));
    const html = await response.text();
    expect(html).toContain("event.type==='score-update'");
    expect(html).toContain("function receiveRoomScores");
    expect(html).not.toContain("score:state.score");
  });

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
    await expect(received).resolves.toMatchObject({ id: USER_ONE, name: "Mèo Một", x: 100, y: 200, score: 0 });
    await closeSockets([firstSocket!, secondSocket!]);
  });

  it("rejects missing server identity", async () => {
    const room = env.GAME_ROOM.getByName("VN-2-test");
    const response = await room.fetch(new Request("https://example.com/api/room", {
      headers: { Upgrade: "websocket" },
    }));
    expect(response.status).toBe(401);
  });

  it("accepts 20 distinct players and rejects player 21", async () => {
    const room = env.GAME_ROOM.getByName("VN-capacity-test");
    const sockets: WebSocket[] = [];

    for (let index = 1; index <= 20; index += 1) {
      const response = await room.fetch(upgradeRequest(userId(index), `Mèo ${index}`));
      expect(response.status).toBe(101);
      expect(response.webSocket).not.toBeNull();
      response.webSocket!.accept();
      sockets.push(response.webSocket!);
    }

    const overflow = await room.fetch(upgradeRequest(userId(21), "Mèo 21"));
    expect(overflow.status).toBe(409);
    await expect(overflow.json()).resolves.toEqual({ error: "room_full" });

    const nextRoom = env.GAME_ROOM.getByName("VN-capacity-test-room-2");
    const rollover = await nextRoom.fetch(upgradeRequest(userId(21), "Mèo 21"));
    expect(rollover.status).toBe(101);
    rollover.webSocket!.accept();

    await closeSockets([...sockets, rollover.webSocket!]);
  });

  it("replaces a duplicate account without consuming another room slot", async () => {
    const room = env.GAME_ROOM.getByName("VN-duplicate-test");
    const first = await room.fetch(upgradeRequest(USER_ONE, "Mèo Cũ"));
    expect(first.status).toBe(101);
    first.webSocket!.accept();

    const replaced = new Promise<{ code: number; reason: string }>((resolve) => {
      first.webSocket!.addEventListener("close", (event: CloseEvent) => {
        resolve({ code: event.code, reason: event.reason });
      });
    });

    const second = await room.fetch(upgradeRequest(USER_ONE, "Mèo Mới"));
    expect(second.status).toBe(101);
    second.webSocket!.accept();
    await expect(replaced).resolves.toEqual({ code: 4001, reason: "newer_connection" });

    await closeSockets([second.webSocket!]);
  });

  it("owns room scores and ignores a forged client score", async () => {
    const room = env.GAME_ROOM.getByName("VN-authoritative-score-test");
    const killerResponse = await room.fetch(upgradeRequest(USER_ONE, "Mèo Ghi Điểm"));
    const victimResponse = await room.fetch(upgradeRequest(USER_TWO, "Mèo Bị Đẩy"));
    expect(killerResponse.status).toBe(101);
    expect(victimResponse.status).toBe(101);
    const killer = killerResponse.webSocket!;
    const victim = victimResponse.webSocket!;
    killer.accept();
    victim.accept();

    const hole = firstRoomHole();
    killer.send(JSON.stringify({
      type: "player-state",
      payload: { seq: 1, x: hole.x + 45, y: hole.y, vx: 100, vy: 0, dead: false, score: 999_999 },
    }));
    victim.send(JSON.stringify({
      type: "player-state",
      payload: { seq: 1, x: hole.x, y: hole.y, vx: 0, vy: 0, dead: false, score: 999_999 },
    }));
    await new Promise((resolve) => setTimeout(resolve, 150));

    killer.send(JSON.stringify({
      type: "player-hit",
      payload: { targetId: USER_TWO, impulseX: 200, impulseY: 0 },
    }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    victim.send(JSON.stringify({
      type: "player-state",
      payload: { seq: 2, x: hole.x, y: hole.y, vx: 0, vy: 0, dead: true, score: 999_999 },
    }));

    const authoritativeScore = waitForMessage(killer, (message) =>
      message.type === "score-update" &&
      Array.isArray(message.payload.players) &&
      message.payload.players.some((entry) =>
        (entry as { id?: string; score?: number }).id === USER_ONE &&
        (entry as { id?: string; score?: number }).score === 15
      )
    );
    victim.send(JSON.stringify({
      type: "player-eliminated",
      payload: {
        eventId: "33333333-3333-4333-8333-333333333333",
        killerId: USER_ONE,
      },
    }));
    await expect(authoritativeScore).resolves.toMatchObject({ type: "score-update" });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const relayedState = waitForMessage(victim, (message) =>
      message.type === "player-state" &&
      (message.payload as { id?: string }).id === USER_ONE
    );
    killer.send(JSON.stringify({
      type: "player-state",
      payload: { seq: 2, x: hole.x + 45, y: hole.y, vx: 0, vy: 0, dead: false, score: 999_999 },
    }));
    await expect(relayedState).resolves.toMatchObject({
      type: "player-state",
      payload: { id: USER_ONE, score: 15 },
    });

    await closeSockets([killer, victim]);

    const reconnectResponse = await room.fetch(upgradeRequest(USER_ONE, "Mèo Ghi Điểm"));
    expect(reconnectResponse.status).toBe(101);
    const reconnect = reconnectResponse.webSocket!;
    const restored = waitForMessage(reconnect, (message) => message.type === "welcome");
    reconnect.accept();
    await expect(restored).resolves.toMatchObject({
      type: "welcome",
      payload: { id: USER_ONE, score: 15 },
    });
    await closeSockets([reconnect]);
  });
});
