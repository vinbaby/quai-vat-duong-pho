# Quái Vật Đường Phố — bản multiplayer thử nghiệm

Chạy bằng web server tĩnh (Cloudflare Workers/Pages, Netlify hoặc máy chủ cục bộ) rồi mở trong trình duyệt.

## Có gì trong bản thử

- Đăng ký/đăng nhập và lưu hồ sơ bằng Supabase.
- Mỗi biệt danh nhận một nhân vật hoạt hình riêng.
- Người chơi thật được tự động ghép vào phòng công khai theo quốc gia qua Supabase Realtime.
- Mỗi phòng tối đa 20 người; khi các phòng hiện có đầy, hệ thống tự tạo phòng tiếp theo.
- Presence đồng bộ người online; Broadcast đồng bộ vị trí, va chạm và hạ gục.
- Khi online chỉ hiển thị người chơi thật; bot và vật phẩm cục bộ chỉ dùng khi mất kết nối để tránh lệch trạng thái giữa thiết bị.
- Điều khiển bằng **WASD** hoặc phím mũi tên để va chạm và đẩy đối thủ.
- Điện thoại và máy tính bảng có cụm phím cảm ứng ở góc phải màn hình.
- Bố cục hố đen cố định theo phòng được ghép để mọi người nhìn thấy cùng một đấu trường; chạm vào hoặc bị đẩy vào sẽ bị hạ và hồi sinh sau 3 giây.
- Điểm cho cú đẩy hạ gục và bảng xếp hạng trực tiếp.
- Nhặt vật phẩm 💥 để tăng 5% lực đẩy hoặc ⚡ để tăng 5% tốc độ trong 60 giây; nhặt lại chỉ làm mới thời gian.
- Hồ sơ người chơi, xu, cửa hàng skin cosmetic và nút quảng cáo nhận thưởng mô phỏng.
- Sáu vệt di chuyển cosmetic: không dùng vệt, cầu vồng, cỏ may mắn, tương ớt, nước mát và sao lấp lánh.

## Doanh thu trong bản phát hành

- Skin và vệt di chuyển chỉ thay đổi ngoại hình, không tác động tốc độ hay lực đẩy.
- Người chơi nhận 10 xu khi đẩy đối thủ vào hố đen; có thể chọn xem quảng cáo để nhận 20 xu.
- Nút quảng cáo hiện tại chỉ là mô phỏng. Muốn có quảng cáo trả tiền và thanh toán thật phải kết nối nhà cung cấp quảng cáo/thanh toán bằng tài khoản của chủ game.
- Giao diện thích ứng cho điện thoại và máy tính.

## Đưa lên web

Đưa các file web ở thư mục gốc lên Cloudflare. `supabase-config.js` chỉ chứa URL và publishable key dành cho frontend, không được đặt secret/service-role key vào đây.

## Cấu hình multiplayer

- Chạy migration trong `supabase/migrations` để cấp quyền Broadcast và Presence cho người đã đăng nhập.
- Migration matchmaking tạo vé phòng có thời hạn; người rời trận được xóa ngay và kết nối mất đột ngột tự hết hạn sau 60 giây.
- Kênh game là kênh riêng tư và chỉ chấp nhận topic bắt đầu bằng `game:street-`.
- Đây là MVP client-authoritative. Trước khi tổ chức xếp hạng hoặc trao thưởng có giá trị, cần chuyển va chạm, điểm và hạ gục sang máy chủ authoritative để chống gian lận.

Xem thêm `PRODUCTION.md` để biết phần nào cần tài khoản đứng tên chủ game trước khi phát hành.
