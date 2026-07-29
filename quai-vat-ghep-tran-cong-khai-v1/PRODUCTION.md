# Chuẩn bị để phát hành và nhận doanh thu

Hiện tại game đã có tài khoản Supabase và phòng chơi Realtime thử nghiệm. Hồ sơ được lưu trên Supabase; chuyển động và trạng thái phòng chỉ truyền trực tiếp qua WebSocket, không ghi liên tục vào cơ sở dữ liệu.

## Những phần đã sẵn sàng

- Cửa hàng skin không ảnh hưởng sức mạnh.
- Xu, phần thưởng từ hạ gục và quảng cáo nhận thưởng mô phỏng.
- Thiết kế giao diện cho shop và số dư xu.
- Phòng multiplayer dùng kênh riêng tư, chỉ dành cho người đã đăng nhập.
- Người chơi được tự động ghép theo quốc gia, tối đa 20 người trong mỗi phòng công khai.
- Bot chỉ dùng làm chế độ dự phòng khi mất kết nối.

## Những tài khoản chủ game cần tạo

1. Nền tảng phát hành web (Cloudflare Pages hoặc tương đương).
2. Dịch vụ tài khoản và cơ sở dữ liệu (Supabase) — đã kết nối bản thử nghiệm.
3. Nền tảng quảng cáo có thưởng phù hợp với game web.
4. Nhà cung cấp thanh toán có thể nhận tiền về tài khoản của chủ game.

Các tài khoản doanh thu phải do chủ game đứng tên vì chúng liên quan trực tiếp đến xác minh danh tính, hoàn tiền và thuế. Trước khi mở thanh toán hoặc phần thưởng có giá trị, cần có máy chủ authoritative xác nhận kết quả trận đấu; không tin điểm do trình duyệt tự gửi.

## Nguyên tắc an toàn cho doanh thu

- Chỉ bán cosmetic: skin, hiệu ứng va chạm, vệt di chuyển, biểu cảm, khung tên.
- Không bán lực đẩy, tốc độ hay bất kỳ lợi thế trong trận.
- Quảng cáo phải là lựa chọn rõ ràng; không che phần đang chơi.
- Trước khi phát hành cần có trang điều khoản sử dụng và chính sách quyền riêng tư.
- Trong frontend chỉ dùng Supabase publishable key; tuyệt đối không đưa secret key hoặc service-role key lên GitHub.
