# Chuẩn bị để phát hành và nhận doanh thu

Hiện tại game là bản thử nghiệm chạy ngay trên trình duyệt. Xu, skin và quảng cáo nhận thưởng được lưu cục bộ để kiểm tra giao diện và luồng chơi.

## Những phần đã sẵn sàng

- Cửa hàng skin không ảnh hưởng sức mạnh.
- Xu, phần thưởng từ hạ gục và quảng cáo nhận thưởng mô phỏng.
- Thiết kế giao diện cho shop và số dư xu.

## Những tài khoản chủ game cần tạo

1. Nền tảng phát hành web (Cloudflare Pages hoặc tương đương).
2. Dịch vụ tài khoản và cơ sở dữ liệu (Supabase).
3. Nền tảng quảng cáo có thưởng phù hợp với game web.
4. Nhà cung cấp thanh toán có thể nhận tiền về tài khoản của chủ game.

Các tài khoản này phải do chủ game đứng tên vì chúng liên quan trực tiếp đến doanh thu, xác minh danh tính, hoàn tiền và thuế. Sau khi có các tài khoản đó, cấu hình kết nối sẽ được thêm vào game; người chơi sẽ đăng nhập thật, xu/skin được lưu trên máy chủ, quảng cáo mới tạo doanh thu và shop mới nhận tiền thật.

## Nguyên tắc an toàn cho doanh thu

- Chỉ bán cosmetic: skin, hiệu ứng va chạm, vệt di chuyển, biểu cảm, khung tên.
- Không bán lực đẩy, tốc độ hay bất kỳ lợi thế trong trận.
- Quảng cáo phải là lựa chọn rõ ràng; không che phần đang chơi.
- Trước khi phát hành cần có trang điều khoản sử dụng và chính sách quyền riêng tư.
