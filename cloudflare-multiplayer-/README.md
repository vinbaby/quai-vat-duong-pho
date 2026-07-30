# Quái Vật Đường Phố — Cloudflare multiplayer

Worker này phục vụ bản game một-file và chuyển luồng multiplayer thời gian thực sang một Durable Object SQLite cho mỗi phòng. Supabase tiếp tục giữ Auth, hồ sơ, tiền, skin, matchmaking, vật phẩm và xác minh hạ gục.

## Kiểm tra

```bash
npm install
npm test
npm run check
```

## Chạy thử cục bộ

```bash
npm run dev
```

## Triển khai Worker thử nghiệm

```bash
npx wrangler login
npm run deploy
```

Không dùng Direct Upload của bản `index.html` cũ cho dự án này vì Worker cần binding `GAME_ROOM` và migration Durable Object `v1`.
