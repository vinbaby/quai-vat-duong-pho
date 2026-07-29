# Quái Vật Đường Phố — bản chơi thử

Mở `index.html` bằng trình duyệt để chơi.

## Có gì trong bản thử

- Nhập biệt danh và lưu người chơi ngay trên trình duyệt.
- Mỗi biệt danh nhận một nhân vật hoạt hình riêng.
- Điều khiển bằng **WASD** hoặc phím mũi tên để va chạm và đẩy đối thủ.
- Hố đen xuất hiện ngẫu nhiên; chạm vào hoặc bị đẩy vào sẽ bị hạ và hồi sinh sau 3 giây.
- Bot đối thủ, điểm cho cú đẩy hạ gục và bảng xếp hạng trực tiếp.
- Số hố đen bằng một nửa số người trong trận, có phạm vi lớn và lực hút khi đến gần.
- Nhặt vật phẩm 💥 để tăng 5% lực đẩy hoặc ⚡ để tăng 5% tốc độ trong 60 giây; nhặt lại chỉ làm mới thời gian.
- Hồ sơ người chơi, xu, cửa hàng skin cosmetic và nút quảng cáo nhận thưởng mô phỏng.
- Sáu vệt di chuyển cosmetic: không dùng vệt, cầu vồng, cỏ may mắn, tương ớt, nước mát và sao lấp lánh.

## Doanh thu trong bản phát hành

- Skin và vệt di chuyển chỉ thay đổi ngoại hình, không tác động tốc độ hay lực đẩy.
- Người chơi nhận 10 xu khi đẩy đối thủ vào hố đen; có thể chọn xem quảng cáo để nhận 20 xu.
- Nút quảng cáo hiện tại chỉ là mô phỏng. Muốn có quảng cáo trả tiền và thanh toán thật phải kết nối nhà cung cấp quảng cáo/thanh toán bằng tài khoản của chủ game.
- Giao diện thích ứng cho điện thoại và máy tính.

## Đưa lên web

Ba file `index.html`, `style.css`, và `game.js` là đủ để đưa bản chơi thử lên Cloudflare Pages, Netlify hoặc bất kỳ hosting web tĩnh nào.

## Để thành game trực tuyến thật

Bước sau cần thay các bot bằng phòng chơi dùng WebSocket, đồng thời dùng Supabase cho đăng ký/đăng nhập và lưu điểm. Khi đó, website vẫn triển khai gần như tự động; chỉ có phần phòng chơi được kết nối tới dịch vụ máy chủ.

Xem thêm `PRODUCTION.md` để biết phần nào cần tài khoản đứng tên chủ game trước khi phát hành.
