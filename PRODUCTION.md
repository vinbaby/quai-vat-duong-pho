# Checklist phát hành Quái Vật Đường Phố v1

## Mốc an toàn

- Nhánh production: `main`
- Worker: `quai-vat-pho-multiplayer-test`
- URL: <https://quai-vat-pho-multiplayer-test.vinbabylon90.workers.dev/>
- Mỗi phòng: 20 người
- Điểm phòng: Cloudflare Durable Object quản lý
- Hồ sơ, xu, vật phẩm và ghép phòng: Supabase

## Đã kiểm tra

- Hai tài khoản đăng nhập đồng thời trên máy tính và điện thoại.
- Đồng bộ vị trí, va chạm, hạ gục, vật phẩm và hiệu ứng.
- Điểm không lệch khi hai người hạ nhau gần như đồng thời.
- Thoát, kết nối lại và đăng nhập lại vẫn khôi phục đúng trạng thái.
- Worker từ chối phòng sai, token hết hạn và danh tính do trình duyệt giả mạo.
- Tin nhắn WebSocket có giới hạn kích thước và tần suất.
- RLS chỉ cho người chơi đọc hồ sơ và vé ghép phòng của chính mình.
- Không có secret hoặc service-role key trong frontend.
- Build chạy test trước khi deploy.

## Việc chủ tài khoản nên bật thủ công

Trong Supabase, vào **Authentication → Sign In / Security** và bật
**Leaked password protection** nếu gói hiện tại hỗ trợ. Đây là cảnh báo bảo mật
duy nhất cần thao tác trong Dashboard; nó không chặn bản v1 hoạt động.

## Trước mỗi lần cập nhật

1. Không sửa trực tiếp Worker production.
2. Chạy `npm test` và `npm run check`.
3. Commit lên `main` chỉ sau khi test hai thiết bị.
4. Chờ Cloudflare Build hoàn tất.
5. Kiểm tra `/api/health`, đăng nhập và chơi thử.
6. Nếu có lỗi, dùng lịch sử Deployment của Cloudflare để rollback.

## Giới hạn có chủ ý của v1

- Điểm chỉ xếp hạng trong phòng, không phải bảng thành tích toàn cầu.
- Xu và cosmetic không có giá trị tiền mặt.
- Phần thưởng hạ gục có giới hạn chống farm ở Supabase nhưng chưa phù hợp cho
  giải đấu hoặc vật phẩm quy đổi thành tiền.
- Nút quảng cáo chỉ là adapter giao diện; chưa kết nối mạng quảng cáo thật.

## Điều kiện trước khi bật doanh thu thật

- Có chính sách quyền riêng tư và điều khoản sử dụng.
- Tài khoản quảng cáo, thanh toán và thuế do chủ game đứng tên.
- Thêm CAPTCHA/rate limit cho đăng ký nếu bắt đầu có người dùng công khai.
- Chuyển xác nhận phần thưởng xu hoàn toàn sang Worker bằng bí mật máy chủ nếu
  xu có thể mua hoặc đổi thành giá trị thật.
- Thiết lập tên miền riêng và email hỗ trợ.
