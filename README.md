# Quái Vật Đường Phố

Game web multiplayer liên tục, ghép phòng công khai theo quốc gia. Mỗi phòng
tối đa 20 người; khi phòng đầy, Supabase tự cấp phòng tiếp theo.

## Bản v1 có gì

- Đăng ký, đăng nhập và hồ sơ người chơi bằng Supabase Auth.
- Ghép phòng công khai bằng Supabase Postgres RPC.
- Đồng bộ trận đấu bằng Cloudflare Worker, Durable Objects và WebSocket.
- Điểm phòng do máy chủ Cloudflare quản lý; trình duyệt không được tự gửi điểm.
- Xác minh va chạm, hạ gục và khôi phục điểm khi kết nối lại.
- Vật phẩm phòng, xu, skin và vệt di chuyển được lưu bằng Supabase.
- Điều khiển bàn phím trên máy tính và nút cảm ứng trên điện thoại.
- Hố đen, hiệu ứng va chạm, âm thanh, hồi sinh và bảng xếp hạng trong phòng.

## Bản đang chạy

<https://quai-vat-pho-multiplayer-test.vinbabylon90.workers.dev/>

Worker production nằm trong `cloudflare-multiplayer-`:

```text
cloudflare-multiplayer-/
  public/index.html
  src/index.ts
  test/game-room.test.ts
  wrangler.jsonc
```

Cloudflare Build:

```text
Root directory: /cloudflare-multiplayer-
Build command: npm test
Deploy command: npm run deploy
Production branch: main
```

## Kiểm tra trước khi deploy

```bash
cd cloudflare-multiplayer-
npm ci
npm test
npm run check
```

`SUPABASE_PUBLISHABLE_KEY` là khóa công khai dành cho trình duyệt. Không đưa
`service_role`, secret key, mật khẩu hoặc access token vào GitHub.

## Cơ sở dữ liệu

Các migration nằm trong `supabase/migrations`. File
`20260730170000_sync_production_schema.sql` là ảnh chụp schema production v1,
giúp repo có đủ bảng, hàm RPC, RLS và policy để phục hồi dự án.

## Phạm vi v1

Đây là game xả stress nhanh, không có thời gian trận và không có xếp hạng toàn
cầu. Bảng xếp hạng chỉ dùng trong phòng hiện tại. Quảng cáo trả tiền và thanh
toán thật chưa được bật.

Xem `PRODUCTION.md` trước khi phát hành rộng rãi.
