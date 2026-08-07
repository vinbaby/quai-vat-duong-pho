import { DurableObject } from "cloudflare:workers";

const ROOM_CAPACITY = 20;
const RELEASE_VERSION = "1.3.0-beta.1";
const MAX_MESSAGE_BYTES = 2048;
const SCORE_RETENTION_MS = 120_000;
const EVENT_RETENTION_MS = 10 * 60_000;
const HIT_CREDIT_MS = 10_000;
const HOLE_ROTATION_MS = 90_000;
const HOLE_WARNING_MS = 8_000;
const HOLE_GRACE_MS = 5_000;
const BOT_ID = "00000000-0000-4000-8000-000000000001";
const BOT_NAME = "KAI BOT";
const BOT_RADIUS = 22;
const BOT_TICK_MS = 120;
const BOT_RESPAWN_MS = 2_200;
const BOT_HIT_COOLDOWN_MS = 420;
const WORLD_WIDTH = 2_600;
const WORLD_HEIGHT = 1_800;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRUSTED_PORTAL_HOSTS = new Set(["uploads.ungrounded.net"]);
const TRUSTED_PORTAL_HOST_SUFFIXES = [
  ".itch.io",
  ".itch.zone",
  ".hwcdn.net",
  ".gamejolt.com",
  ".gamejolt.net",
  ".gjcdn.net",
];

type RoomHole = { x: number; y: number; r: number };

type HoleState = {
  roomTopic: string;
  version: number;
  holes: RoomHole[];
  previousVersion: number | null;
  previousHoles: RoomHole[];
  rotatedAt: number;
  nextHoleAt: number;
  warningSent: boolean;
};

type SocketAttachment = {
  userId: string;
  name: string;
  lastStateAt: number;
  messageWindowAt: number;
  messageCount: number;
  score: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dead: boolean;
  lastHitFrom: string;
  lastHitAt: number;
  lastPersistAt: number;
  roomTopic: string;
};

type RoomItem = {
  id: string;
  x: number;
  y: number;
  type: "push" | "speed";
  expiresAt: number;
};

type ServerBot = {
  id: typeof BOT_ID;
  name: typeof BOT_NAME;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pushX: number;
  pushY: number;
  dir: number;
  score: number;
  dead: boolean;
  respawnAt: number;
  lastTickAt: number;
  lastBroadcastAt: number;
  nextDecisionAt: number;
  targetId: string;
  wanderAngle: number;
  lastHitFrom: string;
  lastHitAt: number;
  lastCollisionAt: number;
  pushBoostUntil: number;
  speedBoostUntil: number;
  sequence: number;
};

type AuthUser = {
  id: string;
  user_metadata?: { display_name?: unknown };
};

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function boundedText(value: unknown, max: number, fallback = ""): string {
  const text = String(value ?? fallback).trim().replace(/\s+/g, " ");
  return text.slice(0, max) || fallback;
}

function boundedNumber(value: unknown, min: number, max: number, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function decodedHeader(value: string | null): string {
  try {
    return decodeURIComponent(value ?? "");
  } catch {
    return "";
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function roomHash(text: string): number {
  let value = 7;
  for (const character of text) {
    value = ((value << 5) - value + character.charCodeAt(0)) | 0;
  }
  return value >>> 0;
}

function roomHoles(topic: string, version: number, attempt = 0): RoomHole[] {
  const seed = roomHash(`${topic}:${version}:${attempt}`);
  const random = (index: number) => {
    const value = Math.sin(seed + index * 999) * 43758.5453;
    return value - Math.floor(value);
  };
  return Array.from({ length: 5 }, (_, index) => ({
    x: 260 + random(index * 2) * 2080,
    y: 220 + random(index * 2 + 1) * 1360,
    r: 58 + random(index + 30) * 15,
  }));
}

function isInsideRoomHole(holes: RoomHole[], x: number, y: number): boolean {
  return holes.some((hole) => Math.hypot(x - hole.x, y - hole.y) <= hole.r + 40);
}

function parseRoomHoles(value: string): RoomHole[] {
  try {
    const holes = JSON.parse(value) as Array<Partial<RoomHole>>;
    if (!Array.isArray(holes) || holes.length !== 5) return [];
    return holes.map((hole) => ({
      x: boundedNumber(hole.x, 100, 2500, 1300),
      y: boundedNumber(hole.y, 100, 1700, 900),
      r: boundedNumber(hole.r, 50, 90, 64),
    }));
  } catch {
    return [];
  }
}

function readProtocols(request: Request): { token: string } | null {
  const protocols = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!protocols.includes("qv-game-v1")) return null;
  const authProtocol = protocols.find((value) => value.startsWith("qv-auth."));
  const token = authProtocol?.slice("qv-auth.".length) ?? "";
  return token.length >= 32 && token.length <= 4096 ? { token } : null;
}

function isAllowedGameOrigin(origin: string | null, requestUrl: URL): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.origin === requestUrl.origin) return true;
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    return TRUSTED_PORTAL_HOSTS.has(hostname) || TRUSTED_PORTAL_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
    );
  } catch {
    return false;
  }
}

async function verifySupabaseUser(
  request: Request,
  env: Env,
  country: string,
  room: number,
): Promise<{ userId: string; name: string } | null> {
  const auth = readProtocols(request);
  if (!auth) return null;
  const headers = {
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${auth.token}`,
    Accept: "application/json",
  };
  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers });
  if (!userResponse.ok) return null;
  const user = await userResponse.json<AuthUser>();
  if (!isUuid(user.id)) return null;

  const matchUrl = new URL("/rest/v1/public_matchmaking", env.SUPABASE_URL);
  matchUrl.searchParams.set("select", "country_code,room_number,last_seen");
  matchUrl.searchParams.set("user_id", `eq.${user.id}`);
  matchUrl.searchParams.set("limit", "1");
  const profileUrl = new URL("/rest/v1/player_profiles", env.SUPABASE_URL);
  profileUrl.searchParams.set("select", "display_name");
  profileUrl.searchParams.set("id", `eq.${user.id}`);
  profileUrl.searchParams.set("limit", "1");

  const [matchResponse, profileResponse] = await Promise.all([
    fetch(matchUrl, { headers }),
    fetch(profileUrl, { headers }),
  ]);
  if (!matchResponse.ok) return null;
  const matches = await matchResponse.json<Array<{ country_code: string; room_number: number; last_seen: string }>>();
  const match = matches[0];
  const lastSeen = Date.parse(match?.last_seen ?? "");
  if (
    !match ||
    match.country_code !== country ||
    Number(match.room_number) !== room ||
    !Number.isFinite(lastSeen) ||
    lastSeen < Date.now() - 60_000
  ) {
    return null;
  }

  let name = boundedText(user.user_metadata?.display_name, 16, "Người chơi");
  if (profileResponse.ok) {
    const profiles = await profileResponse.json<Array<{ display_name: string }>>();
    name = boundedText(profiles[0]?.display_name, 16, name);
  }
  return { userId: user.id, name };
}

function withSecurityHeaders(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  headers.set("X-QV-Version", RELEASE_VERSION);
  if ((headers.get("Content-Type") ?? "").toLowerCase().includes("text/html")) {
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  }
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' ${env.SUPABASE_URL} wss://${new URL(env.SUPABASE_URL).host}; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://telegram.org https://*.telegram.org`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export class GameRoom extends DurableObject<Env> {
  private nextHoleClockCheckAt = 0;
  private bot: ServerBot | null = null;
  private roomItems = new Map<string, RoomItem>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_scores (
          user_id TEXT PRIMARY KEY,
          score INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS elimination_events (
          event_id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS room_hole_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          room_topic TEXT NOT NULL,
          version INTEGER NOT NULL,
          holes_json TEXT NOT NULL,
          previous_version INTEGER,
          previous_holes_json TEXT NOT NULL DEFAULT '[]',
          rotated_at INTEGER NOT NULL,
          next_hole_at INTEGER NOT NULL,
          warning_sent INTEGER NOT NULL DEFAULT 0
        );
      `);
    });
  }

  private attachment(ws: WebSocket): SocketAttachment | null {
    try {
      const value = ws.deserializeAttachment() as Partial<SocketAttachment> | null;
      if (!value || !isUuid(value.userId)) return null;
      return {
        userId: value.userId,
        name: boundedText(value.name, 16, "Người chơi"),
        lastStateAt: boundedNumber(value.lastStateAt, 0, Number.MAX_SAFE_INTEGER),
        messageWindowAt: boundedNumber(value.messageWindowAt, 0, Number.MAX_SAFE_INTEGER),
        messageCount: boundedNumber(value.messageCount, 0, 1_000),
        score: Math.floor(boundedNumber(value.score, 0, 1_000_000)),
        x: boundedNumber(value.x, 25, 2575, 1300),
        y: boundedNumber(value.y, 25, 1775, 900),
        vx: boundedNumber(value.vx, -500, 500),
        vy: boundedNumber(value.vy, -500, 500),
        dead: Boolean(value.dead),
        lastHitFrom: isUuid(value.lastHitFrom) ? value.lastHitFrom : "",
        lastHitAt: boundedNumber(value.lastHitAt, 0, Number.MAX_SAFE_INTEGER),
        lastPersistAt: boundedNumber(value.lastPersistAt, 0, Number.MAX_SAFE_INTEGER),
        roomTopic: boundedText(value.roomTopic, 80, "game:street-gl-1"),
      };
    } catch {
      return null;
    }
  }

  private humanAttachments(): SocketAttachment[] {
    return this.ctx.getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN)
      .map((ws) => this.attachment(ws))
      .filter((attachment): attachment is SocketAttachment => Boolean(attachment));
  }

  private players(): Array<{ id: string; name: string; score: number; isBot: boolean }> {
    const players = new Map<string, { name: string; score: number; isBot: boolean }>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const attachment = this.attachment(ws);
      if (attachment) players.set(attachment.userId, { name: attachment.name, score: attachment.score, isBot: false });
    }
    if (this.bot && players.size > 0) {
      players.set(this.bot.id, { name: this.bot.name, score: this.bot.score, isBot: true });
    }
    return [...players].map(([id, player]) => ({ id, ...player }));
  }

  private socketForUser(userId: string): WebSocket | null {
    return this.ctx.getWebSockets(`user:${userId}`).find((ws) => ws.readyState === WebSocket.OPEN) ?? null;
  }

  private persistScore(attachment: SocketAttachment, now = Date.now()): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO room_scores (user_id, score, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`,
      attachment.userId,
      attachment.score,
      now,
    );
    attachment.lastPersistAt = now;
  }

  private pruneExpiredRoomData(now = Date.now()): void {
    this.ctx.storage.sql.exec(
      "DELETE FROM elimination_events WHERE created_at < ?",
      now - EVENT_RETENTION_MS,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM room_scores WHERE updated_at < ?",
      now - SCORE_RETENTION_MS,
    );
  }

  private broadcastScores(): void {
    this.broadcast("score-update", { players: this.players().map(({ id, score }) => ({ id, score })) });
  }

  private botStatePayload(bot: ServerBot): Record<string, unknown> {
    return {
      id: bot.id,
      name: bot.name,
      seq: bot.sequence,
      x: Math.round(bot.x * 10) / 10,
      y: Math.round(bot.y * 10) / 10,
      vx: Math.round((bot.vx + bot.pushX) * 10) / 10,
      vy: Math.round((bot.vy + bot.pushY) * 10) / 10,
      dir: Math.round(bot.dir * 100) / 100,
      score: bot.score,
      dead: bot.dead,
      icon: "🤖",
      color: "#ff9f43",
      trail: "stars",
      isBot: true,
    };
  }

  private safeBotSpawn(holes: RoomHole[], now: number): { x: number; y: number } {
    const players = this.humanAttachments().filter((player) => !player.dead);
    const seed = roomHash(`${players[0]?.roomTopic ?? "room"}:bot:${Math.floor(now / 1_000)}`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const angleSeed = Math.sin(seed + attempt * 997) * 43_758.5453;
      const distanceSeed = Math.sin(seed + attempt * 613 + 17) * 43_758.5453;
      const x = 120 + (angleSeed - Math.floor(angleSeed)) * (WORLD_WIDTH - 240);
      const y = 120 + (distanceSeed - Math.floor(distanceSeed)) * (WORLD_HEIGHT - 240);
      const awayFromHoles = holes.every((hole) => Math.hypot(x - hole.x, y - hole.y) > hole.r + 210);
      const awayFromPlayers = players.every((player) => Math.hypot(x - player.x, y - player.y) > 180);
      if (awayFromHoles && awayFromPlayers) return { x, y };
    }
    return { x: 1_300, y: 900 };
  }

  private ensureBot(roomTopic: string, holes: RoomHole[], now: number): ServerBot | null {
    if (this.humanAttachments().length === 0) {
      this.bot = null;
      return null;
    }
    if (this.bot) return this.bot;
    const spawn = this.safeBotSpawn(holes, now);
    const stored = this.ctx.storage.sql
      .exec<{ score: number; updated_at: number }>(
        "SELECT score, updated_at FROM room_scores WHERE user_id = ?",
        BOT_ID,
      )
      .toArray()[0];
    this.bot = {
      id: BOT_ID,
      name: BOT_NAME,
      ...spawn,
      vx: 0,
      vy: 0,
      pushX: 0,
      pushY: 0,
      dir: 0,
      score: stored && stored.updated_at >= now - SCORE_RETENTION_MS ? stored.score : 0,
      dead: false,
      respawnAt: 0,
      lastTickAt: now,
      lastBroadcastAt: 0,
      nextDecisionAt: now,
      targetId: "",
      wanderAngle: roomHash(roomTopic) % 628 / 100,
      lastHitFrom: "",
      lastHitAt: 0,
      lastCollisionAt: 0,
      pushBoostUntil: 0,
      speedBoostUntil: 0,
      sequence: 0,
    };
    return this.bot;
  }

  private persistBotScore(bot: ServerBot, now: number): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO room_scores (user_id, score, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`,
      bot.id,
      bot.score,
      now,
    );
  }

  private collectBotItem(bot: ServerBot, now: number): void {
    for (const [id, item] of this.roomItems) {
      if (item.expiresAt <= now) {
        this.roomItems.delete(id);
        continue;
      }
      if (Math.hypot(bot.x - item.x, bot.y - item.y) > BOT_RADIUS + 15) continue;
      this.roomItems.delete(id);
      if (item.type === "push") bot.pushBoostUntil = now + 60_000;
      else bot.speedBoostUntil = now + 60_000;
      this.broadcast("item-collected", { ...item, itemId: item.id, collectorId: bot.id });
      break;
    }
  }

  private chooseBotTarget(bot: ServerBot, humans: SocketAttachment[], now: number): void {
    if (now < bot.nextDecisionAt) return;
    bot.nextDecisionAt = now + 520 + roomHash(`${now}:${bot.sequence}`) % 480;
    const item = [...this.roomItems.values()]
      .filter((candidate) => candidate.expiresAt > now)
      .sort((a, b) => Math.hypot(bot.x - a.x, bot.y - a.y) - Math.hypot(bot.x - b.x, bot.y - b.y))[0];
    if (item && Math.hypot(bot.x - item.x, bot.y - item.y) < 620) {
      bot.targetId = `item:${item.id}`;
      return;
    }
    const live = humans
      .filter((player) => !player.dead && now - player.lastStateAt < 3_000)
      .sort((a, b) => Math.hypot(bot.x - a.x, bot.y - a.y) - Math.hypot(bot.x - b.x, bot.y - b.y));
    const makesMistake = roomHash(`${now}:mistake:${bot.sequence}`) % 7 === 0;
    bot.targetId = makesMistake ? "" : (live[0]?.userId ?? "");
    if (!bot.targetId) bot.wanderAngle += (roomHash(`${now}:wander`) % 160 - 80) / 100;
  }

  private eliminateBot(bot: ServerBot, holes: RoomHole[], now: number): void {
    if (bot.dead || !isInsideRoomHole(holes, bot.x, bot.y)) return;
    bot.dead = true;
    bot.respawnAt = now + BOT_RESPAWN_MS;
    bot.vx = 0;
    bot.vy = 0;
    bot.pushX = 0;
    bot.pushY = 0;
    const killerSocket = now - bot.lastHitAt <= HIT_CREDIT_MS ? this.socketForUser(bot.lastHitFrom) : null;
    const killer = killerSocket ? this.attachment(killerSocket) : null;
    if (killerSocket && killer) {
      killer.score = Math.min(1_000_000, killer.score + 15);
      this.persistScore(killer, now);
      killerSocket.serializeAttachment(killer);
      this.broadcast("bot-eliminated", {
        botId: bot.id,
        botName: bot.name,
        killerId: killer.userId,
        killerScore: killer.score,
      });
      this.broadcastScores();
    }
    bot.lastHitFrom = "";
    bot.lastHitAt = 0;
  }

  private tickBot(roomTopic: string, now = Date.now(), force = false): void {
    if (!force && this.bot && now - this.bot.lastBroadcastAt < BOT_TICK_MS) return;
    const holeState = this.ensureHoleState(roomTopic, now);
    const bot = this.ensureBot(roomTopic, holeState.holes, now);
    if (!bot) return;
    const humans = this.humanAttachments();
    if (bot.dead) {
      if (now < bot.respawnAt) {
        if (force || now - bot.lastBroadcastAt >= BOT_TICK_MS) {
          bot.lastBroadcastAt = now;
          bot.sequence += 1;
          this.broadcast("player-state", this.botStatePayload(bot));
        }
        return;
      }
      Object.assign(bot, this.safeBotSpawn(holeState.holes, now));
      bot.dead = false;
      bot.lastTickAt = now;
      this.broadcast("bot-respawned", { botId: bot.id, x: bot.x, y: bot.y });
    }

    const dt = Math.max(0.016, Math.min(0.3, (now - bot.lastTickAt) / 1_000));
    bot.lastTickAt = now;
    this.chooseBotTarget(bot, humans, now);
    let targetX = bot.x + Math.cos(bot.wanderAngle) * 180;
    let targetY = bot.y + Math.sin(bot.wanderAngle) * 180;
    if (bot.targetId.startsWith("item:")) {
      const item = this.roomItems.get(bot.targetId.slice(5));
      if (item) ({ x: targetX, y: targetY } = item);
      else bot.targetId = "";
    } else if (bot.targetId) {
      const target = humans.find((player) => player.userId === bot.targetId && !player.dead);
      if (target) ({ x: targetX, y: targetY } = target);
      else bot.targetId = "";
    }

    let desiredX = targetX - bot.x;
    let desiredY = targetY - bot.y;
    const targetDistance = Math.hypot(desiredX, desiredY) || 1;
    desiredX /= targetDistance;
    desiredY /= targetDistance;
    for (const hole of holeState.holes) {
      const dx = bot.x - hole.x;
      const dy = bot.y - hole.y;
      const distance = Math.hypot(dx, dy) || 1;
      const danger = hole.r + 250;
      if (distance < danger) {
        const strength = Math.pow(1 - distance / danger, 2) * 3.1;
        desiredX += dx / distance * strength;
        desiredY += dy / distance * strength;
      }
      const gravityReach = hole.r * 3;
      if (distance < gravityReach) {
        const pull = Math.pow(1 - distance / gravityReach, 2) * 1_050;
        bot.pushX -= dx / distance * pull * dt;
        bot.pushY -= dy / distance * pull * dt;
      }
    }
    if (bot.x < 150) desiredX += 1.5;
    if (bot.x > WORLD_WIDTH - 150) desiredX -= 1.5;
    if (bot.y < 150) desiredY += 1.5;
    if (bot.y > WORLD_HEIGHT - 150) desiredY -= 1.5;
    const desiredLength = Math.hypot(desiredX, desiredY) || 1;
    desiredX /= desiredLength;
    desiredY /= desiredLength;
    const chasing = Boolean(bot.targetId);
    const speedBoost = bot.speedBoostUntil > now ? 1.05 : 1;
    const speed = (chasing ? 154 : 92) * speedBoost;
    const reaction = Math.min(1, dt * 4.2);
    bot.vx += (desiredX * speed - bot.vx) * reaction;
    bot.vy += (desiredY * speed - bot.vy) * reaction;
    bot.dir = Math.atan2(bot.vy + bot.pushY, bot.vx + bot.pushX);
    bot.x = Math.max(BOT_RADIUS, Math.min(WORLD_WIDTH - BOT_RADIUS, bot.x + (bot.vx + bot.pushX) * dt));
    bot.y = Math.max(BOT_RADIUS, Math.min(WORLD_HEIGHT - BOT_RADIUS, bot.y + (bot.vy + bot.pushY) * dt));
    bot.pushX *= Math.pow(0.002, dt);
    bot.pushY *= Math.pow(0.002, dt);

    for (const human of humans) {
      if (human.dead || now - human.lastStateAt > 2_000) continue;
      const dx = human.x - bot.x;
      const dy = human.y - bot.y;
      const distance = Math.hypot(dx, dy) || 0.01;
      if (distance > BOT_RADIUS + 25 || now - bot.lastCollisionAt < BOT_HIT_COOLDOWN_MS) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      const botSpeed = Math.hypot(bot.vx + bot.pushX, bot.vy + bot.pushY);
      const humanSpeed = Math.hypot(human.vx, human.vy);
      const force = (112 + Math.abs(botSpeed - humanSpeed) * 0.28) * (bot.pushBoostUntil > now ? 1.05 : 1);
      if (botSpeed >= humanSpeed * 0.82) {
        human.lastHitFrom = bot.id;
        human.lastHitAt = now;
        const targetSocket = this.socketForUser(human.userId);
        if (targetSocket) targetSocket.serializeAttachment(human);
        this.broadcast("player-hit", {
          targetId: human.userId,
          fromId: bot.id,
          fromName: bot.name,
          impulseX: nx * force * 0.75,
          impulseY: ny * force * 0.75,
        });
      } else {
        bot.pushX -= nx * force * 0.65;
        bot.pushY -= ny * force * 0.65;
        bot.lastHitFrom = human.userId;
        bot.lastHitAt = now;
      }
      bot.lastCollisionAt = now;
    }

    this.collectBotItem(bot, now);
    this.eliminateBot(bot, holeState.holes, now);
    bot.lastBroadcastAt = now;
    bot.sequence += 1;
    this.broadcast("player-state", this.botStatePayload(bot));
  }

  private broadcast(type: string, payload: unknown, except?: WebSocket): void {
    const message = JSON.stringify({ type, payload });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(message);
      } catch {
        // The close/error callback removes dead sockets from the next Presence snapshot.
      }
    }
  }

  private broadcastPresence(): void {
    this.broadcast("presence", { players: this.players() });
  }

  private readHoleState(): HoleState | null {
    const row = this.ctx.storage.sql
      .exec<{
        room_topic: string;
        version: number;
        holes_json: string;
        previous_version: number | null;
        previous_holes_json: string;
        rotated_at: number;
        next_hole_at: number;
        warning_sent: number;
      }>("SELECT * FROM room_hole_state WHERE singleton = 1")
      .toArray()[0];
    if (!row) return null;
    const holes = parseRoomHoles(row.holes_json);
    if (holes.length !== 5) return null;
    return {
      roomTopic: row.room_topic,
      version: row.version,
      holes,
      previousVersion: row.previous_version,
      previousHoles: parseRoomHoles(row.previous_holes_json),
      rotatedAt: row.rotated_at,
      nextHoleAt: row.next_hole_at,
      warningSent: Boolean(row.warning_sent),
    };
  }

  private persistHoleState(state: HoleState): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO room_hole_state (
        singleton, room_topic, version, holes_json, previous_version,
        previous_holes_json, rotated_at, next_hole_at, warning_sent
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (singleton) DO UPDATE SET
        room_topic = excluded.room_topic,
        version = excluded.version,
        holes_json = excluded.holes_json,
        previous_version = excluded.previous_version,
        previous_holes_json = excluded.previous_holes_json,
        rotated_at = excluded.rotated_at,
        next_hole_at = excluded.next_hole_at,
        warning_sent = excluded.warning_sent`,
      state.roomTopic,
      state.version,
      JSON.stringify(state.holes),
      state.previousVersion,
      JSON.stringify(state.previousHoles),
      state.rotatedAt,
      state.nextHoleAt,
      state.warningSent ? 1 : 0,
    );
  }

  private safeRoomHoles(topic: string, version: number): RoomHole[] {
    const players = this.ctx.getWebSockets()
      .map((ws) => this.attachment(ws))
      .filter((attachment): attachment is SocketAttachment => Boolean(attachment && !attachment.dead));
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const holes = roomHoles(topic, version, attempt);
      const safe = holes.every((hole) =>
        players.every((player) => Math.hypot(player.x - hole.x, player.y - hole.y) > hole.r + 180)
      );
      if (safe) return holes;
    }
    return roomHoles(topic, version, 24);
  }

  private ensureHoleState(topic: string, now = Date.now()): HoleState {
    const existing = this.readHoleState();
    if (existing && existing.roomTopic === topic) return existing;
    const version = 1;
    const state: HoleState = {
      roomTopic: topic,
      version,
      holes: this.safeRoomHoles(topic, version),
      previousVersion: null,
      previousHoles: [],
      rotatedAt: now,
      nextHoleAt: now + HOLE_ROTATION_MS,
      warningSent: false,
    };
    this.persistHoleState(state);
    return state;
  }

  private rotateHoles(state: HoleState, now = Date.now()): HoleState {
    const next: HoleState = {
      roomTopic: state.roomTopic,
      version: state.version + 1,
      holes: this.safeRoomHoles(state.roomTopic, state.version + 1),
      previousVersion: state.version,
      previousHoles: state.holes,
      rotatedAt: now,
      nextHoleAt: now + HOLE_ROTATION_MS,
      warningSent: false,
    };
    this.persistHoleState(next);
    return next;
  }

  private holePayload(state: HoleState): Record<string, unknown> {
    return {
      version: state.version,
      holes: state.holes,
      nextHoleAt: state.nextHoleAt,
      rotationMs: HOLE_ROTATION_MS,
      warningMs: HOLE_WARNING_MS,
    };
  }

  private async scheduleHoleAlarm(state: HoleState): Promise<void> {
    if (this.ctx.getWebSockets().every((ws) => ws.readyState !== WebSocket.OPEN)) return;
    const target = state.warningSent ? state.nextHoleAt : state.nextHoleAt - HOLE_WARNING_MS;
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, target));
  }

  private async advanceHoleClock(
    now = Date.now(),
    roomTopic?: string,
    force = false,
  ): Promise<void> {
    if (!force && now < this.nextHoleClockCheckAt) return;
    this.nextHoleClockCheckAt = now + 1_000;
    let state = roomTopic ? this.ensureHoleState(roomTopic, now) : this.readHoleState();
    if (!state || this.ctx.getWebSockets().every((ws) => ws.readyState !== WebSocket.OPEN)) return;
    if (now >= state.nextHoleAt) {
      state = this.rotateHoles(state, now);
      this.broadcast("hole-layout", this.holePayload(state));
    } else if (!state.warningSent && now >= state.nextHoleAt - HOLE_WARNING_MS) {
      state.warningSent = true;
      this.persistHoleState(state);
      this.broadcast("hole-warning", {
        version: state.version + 1,
        nextHoleAt: state.nextHoleAt,
        warningMs: HOLE_WARNING_MS,
      });
    }
    await this.scheduleHoleAlarm(state);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonError(426, "websocket_required");
    }
    const userId = request.headers.get("X-QV-User-Id") ?? "";
    const name = boundedText(decodedHeader(request.headers.get("X-QV-Player-Name")), 16, "Người chơi");
    if (!isUuid(userId)) return jsonError(401, "invalid_identity");

    const sockets = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
    const duplicate = sockets.filter((ws) => this.attachment(ws)?.userId === userId);
    if (sockets.length - duplicate.length >= ROOM_CAPACITY) {
      return jsonError(409, "room_full");
    }
    for (const ws of duplicate) {
      try {
        ws.close(4001, "newer_connection");
      } catch {
        // Already closed.
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const now = Date.now();
    this.pruneExpiredRoomData(now);
    const url = new URL(request.url);
    const country = (url.searchParams.get("country") ?? "GL").toLowerCase();
    const room = Math.max(1, Number(url.searchParams.get("room")) || 1);
    const roomTopic = `game:street-${country}-${room}`;
    let holeState = this.ensureHoleState(roomTopic, now);
    const holesRotated = holeState.nextHoleAt <= now;
    if (holesRotated) holeState = this.rotateHoles(holeState, now);
    const carriedScore = duplicate.reduce(
      (score, ws) => Math.max(score, this.attachment(ws)?.score ?? 0),
      0,
    );
    const stored = this.ctx.storage.sql
      .exec<{ score: number; updated_at: number }>(
        "SELECT score, updated_at FROM room_scores WHERE user_id = ?",
        userId,
      )
      .toArray()[0];
    const score = carriedScore || (
      stored && stored.updated_at >= now - SCORE_RETENTION_MS
        ? Math.floor(boundedNumber(stored.score, 0, 1_000_000))
        : 0
    );
    server.serializeAttachment({
      userId,
      name,
      lastStateAt: 0,
      messageWindowAt: now,
      messageCount: 0,
      score,
      x: 1300,
      y: 900,
      vx: 0,
      vy: 0,
      dead: false,
      lastHitFrom: "",
      lastHitAt: 0,
      lastPersistAt: now,
      roomTopic,
    } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server, [`user:${userId}`]);
    const bot = this.ensureBot(roomTopic, holeState.holes, now);
    this.persistScore(this.attachment(server)!, now);
    server.send(JSON.stringify({
      type: "welcome",
      payload: { id: userId, capacity: ROOM_CAPACITY, score, ...this.holePayload(holeState) },
    }));
    this.broadcastPresence();
    if (bot) {
      server.send(JSON.stringify({ type: "player-state", payload: this.botStatePayload(bot) }));
    }
    this.broadcastScores();
    if (holesRotated) this.broadcast("hole-layout", this.holePayload(holeState), server);
    await this.scheduleHoleAlarm(holeState);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": "qv-game-v1" },
    });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message !== "string" || new TextEncoder().encode(message).byteLength > MAX_MESSAGE_BYTES) {
      ws.close(4009, "message_too_large");
      return;
    }
    const attachment = this.attachment(ws);
    if (!attachment) {
      ws.close(4003, "missing_identity");
      return;
    }
    const now = Date.now();
    if (now - attachment.messageWindowAt >= 1000) {
      attachment.messageWindowAt = now;
      attachment.messageCount = 0;
    }
    attachment.messageCount += 1;
    if (attachment.messageCount > 40) {
      ws.close(4008, "rate_limited");
      return;
    }
    ws.serializeAttachment(attachment);

    let event: { type?: unknown; payload?: unknown };
    try {
      event = JSON.parse(message) as { type?: unknown; payload?: unknown };
    } catch {
      return;
    }
    const type = String(event.type ?? "");
    const raw = event.payload;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const payload = raw as Record<string, unknown>;
    let clean: Record<string, unknown> | null = null;

    // Player traffic is a backup clock for room hazards. Cloudflare Alarm is
    // still primary, but an active room now self-heals if an alarm is delayed.
    await this.advanceHoleClock(now, attachment.roomTopic);

    if (type === "player-state") {
      const nextDead = Boolean(payload.dead);
      const scoreChanged = nextDead && !attachment.dead;
      // A death transition is authoritative gameplay state. Never drop it just
      // because it follows a movement packet inside the normal throttle window.
      if (now - attachment.lastStateAt < 125 && !scoreChanged) return;
      attachment.lastStateAt = now;
      attachment.x = boundedNumber(payload.x, 25, 2575, 1300);
      attachment.y = boundedNumber(payload.y, 25, 1775, 900);
      attachment.vx = boundedNumber(payload.vx, -500, 500);
      attachment.vy = boundedNumber(payload.vy, -500, 500);
      attachment.dead = nextDead;
      if (scoreChanged) attachment.score = Math.max(0, attachment.score - 8);
      if (
        scoreChanged &&
        this.bot &&
        attachment.lastHitFrom === this.bot.id &&
        now - attachment.lastHitAt <= HIT_CREDIT_MS
      ) {
        const holeState = this.ensureHoleState(attachment.roomTopic, now);
        if (isInsideRoomHole(holeState.holes, attachment.x, attachment.y)) {
          this.bot.score = Math.min(1_000_000, this.bot.score + 15);
          this.persistBotScore(this.bot, now);
          attachment.lastHitFrom = "";
          attachment.lastHitAt = 0;
        }
      }
      if (scoreChanged || now - attachment.lastPersistAt >= 15_000) {
        this.persistScore(attachment, now);
      }
      ws.serializeAttachment(attachment);
      clean = {
        id: attachment.userId,
        name: attachment.name,
        seq: Math.floor(boundedNumber(payload.seq, 0, 2_147_483_647)),
        x: attachment.x,
        y: attachment.y,
        vx: boundedNumber(payload.vx, -500, 500),
        vy: boundedNumber(payload.vy, -500, 500),
        dir: boundedNumber(payload.dir, -Math.PI * 2, Math.PI * 2),
        score: attachment.score,
        dead: attachment.dead,
        icon: boundedText(payload.icon, 4, "🐱"),
        color: /^#[0-9a-f]{6}$/i.test(String(payload.color ?? "")) ? String(payload.color) : "#a78bfa",
        trail: boundedText(payload.trail, 16, "none"),
      };
      if (scoreChanged) this.broadcastScores();
    } else if (type === "player-hit" && payload.targetId === BOT_ID && this.bot && !this.bot.dead) {
      const closeEnough = now - attachment.lastStateAt <= 2_000 &&
        Math.hypot(attachment.x - this.bot.x, attachment.y - this.bot.y) <= 140;
      if (!closeEnough) return;
      this.bot.pushX += boundedNumber(payload.impulseX, -420, 420);
      this.bot.pushY += boundedNumber(payload.impulseY, -420, 420);
      this.bot.lastHitFrom = attachment.userId;
      this.bot.lastHitAt = now;
      clean = {
        targetId: this.bot.id,
        fromId: attachment.userId,
        fromName: attachment.name,
        impulseX: boundedNumber(payload.impulseX, -420, 420),
        impulseY: boundedNumber(payload.impulseY, -420, 420),
      };
    } else if (type === "player-hit" && isUuid(payload.targetId)) {
      const targetSocket = this.socketForUser(payload.targetId);
      const target = targetSocket ? this.attachment(targetSocket) : null;
      const closeEnough = target &&
        now - attachment.lastStateAt <= 2_000 &&
        now - target.lastStateAt <= 2_000 &&
        Math.hypot(attachment.x - target.x, attachment.y - target.y) <= 140;
      if (!targetSocket || !target || !closeEnough || target.dead) return;
      target.lastHitFrom = attachment.userId;
      target.lastHitAt = now;
      targetSocket.serializeAttachment(target);
      clean = {
        targetId: payload.targetId,
        fromId: attachment.userId,
        fromName: attachment.name,
        impulseX: boundedNumber(payload.impulseX, -420, 420),
        impulseY: boundedNumber(payload.impulseY, -420, 420),
      };
    } else if (
      type === "player-eliminated" &&
      isUuid(payload.eventId) &&
      isUuid(payload.killerId)
    ) {
      const killerSocket = this.socketForUser(payload.killerId);
      const killer = killerSocket ? this.attachment(killerSocket) : null;
      const holeState = this.ensureHoleState(attachment.roomTopic, now);
      const reportedHoleVersion = Number(payload.holeVersion);
      const validationHoles = reportedHoleVersion === holeState.version
        ? holeState.holes
        : reportedHoleVersion === holeState.previousVersion && now - holeState.rotatedAt <= HOLE_GRACE_MS
          ? holeState.previousHoles
          : [];
      const seen = this.ctx.storage.sql
        .exec<{ event_id: string }>(
          "SELECT event_id FROM elimination_events WHERE event_id = ?",
          payload.eventId,
        )
        .toArray().length > 0;
      const valid = killerSocket &&
        killer &&
        payload.killerId !== attachment.userId &&
        attachment.dead &&
        attachment.lastHitFrom === payload.killerId &&
        now - attachment.lastHitAt <= HIT_CREDIT_MS &&
        isInsideRoomHole(validationHoles, attachment.x, attachment.y) &&
        !seen;
      if (!valid || !killerSocket || !killer) return;
      this.ctx.storage.sql.exec(
        "INSERT INTO elimination_events (event_id, created_at) VALUES (?, ?)",
        payload.eventId,
        now,
      );
      killer.score = Math.min(1_000_000, killer.score + 15);
      attachment.lastHitFrom = "";
      attachment.lastHitAt = 0;
      this.persistScore(killer, now);
      killerSocket.serializeAttachment(killer);
      ws.serializeAttachment(attachment);
      clean = {
        eventId: payload.eventId,
        victimId: attachment.userId,
        victimName: attachment.name,
        killerId: payload.killerId,
        victimScore: attachment.score,
        killerScore: killer.score,
      };
      this.broadcastScores();
    } else if (
      (type === "item-spawned" || type === "item-removed" || type === "item-collected") &&
      isUuid(payload.itemId)
    ) {
      clean = {
        itemId: payload.itemId,
        x: boundedNumber(payload.x, 0, 2600),
        y: boundedNumber(payload.y, 0, 1800),
        type: payload.type === "push" ? "push" : "speed",
        expiresAt: Math.floor(boundedNumber(payload.expiresAt, 0, Date.now() + 120_000)),
        ...(type === "item-collected" ? { collectorId: attachment.userId } : {}),
      };
      const itemId = String(payload.itemId);
      if (type === "item-spawned") {
        this.roomItems.set(itemId, {
          id: itemId,
          x: Number(clean.x),
          y: Number(clean.y),
          type: clean.type === "push" ? "push" : "speed",
          expiresAt: Number(clean.expiresAt),
        });
      } else {
        this.roomItems.delete(itemId);
      }
    }

    if (clean) this.broadcast(type, clean, ws);
    this.tickBot(attachment.roomTopic, now);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = this.attachment(ws);
    if (attachment) this.persistScore(attachment);
    this.broadcastPresence();
    if (this.humanAttachments().length === 0) {
      this.bot = null;
      this.roomItems.clear();
      await this.ctx.storage.deleteAlarm();
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const attachment = this.attachment(ws);
    if (attachment) this.persistScore(attachment);
    this.broadcastPresence();
    if (this.humanAttachments().length === 0) {
      this.bot = null;
      this.roomItems.clear();
      await this.ctx.storage.deleteAlarm();
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.pruneExpiredRoomData(now);
    await this.advanceHoleClock(now, undefined, true);
    const holeState = this.readHoleState();
    if (holeState) this.tickBot(holeState.roomTopic, now, true);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") {
        return Response.json(
          {
            ok: true,
            service: "quai-vat-multiplayer",
            version: RELEASE_VERSION,
            capacity: ROOM_CAPACITY,
          },
          {
            headers: {
              "Cache-Control": "no-store",
              "X-QV-Version": RELEASE_VERSION,
            },
          },
        );
      }
      if (url.pathname === "/api/room") {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
          return jsonError(426, "websocket_required");
        }
        if (!isAllowedGameOrigin(request.headers.get("Origin"), url)) {
          return jsonError(403, "origin_not_allowed");
        }
        const country = (url.searchParams.get("country") ?? "").toUpperCase();
        const room = Number(url.searchParams.get("room"));
        if (!/^[A-Z]{2}$/.test(country) || !Number.isInteger(room) || room < 1 || room > 1_000_000) {
          return jsonError(400, "invalid_room");
        }
        const user = await verifySupabaseUser(request, env, country, room);
        if (!user) return jsonError(401, "invalid_or_expired_session");
        const headers = new Headers(request.headers);
        headers.set("X-QV-User-Id", user.userId);
        headers.set("X-QV-Player-Name", encodeURIComponent(user.name));
        const stub = env.GAME_ROOM.getByName(`${country}-${room}`);
        return await stub.fetch(new Request(request, { headers }));
      }
      return withSecurityHeaders(await env.ASSETS.fetch(request), env);
    } catch (error) {
      console.error(JSON.stringify({
        message: "worker_request_failed",
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return jsonError(500, "internal_error");
    }
  },
} satisfies ExportedHandler<Env>;
