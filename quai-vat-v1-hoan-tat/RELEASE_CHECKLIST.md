# Quái Vật Đường Phố v1.0.0

## Smoke test

- [ ] PC và điện thoại đăng nhập bằng hai tài khoản khác nhau.
- [ ] Hai thiết bị được ghép vào cùng phòng.
- [ ] Vị trí, skin và vệt di chuyển đồng bộ.
- [ ] Va chạm và lực đẩy hiển thị trên cả hai thiết bị.
- [ ] Vật phẩm chỉ được một người nhặt và hiệu ứng xuất hiện ở cả hai bên.
- [ ] Hạ gục cộng 15 điểm, người bị hạ trừ 8 điểm.
- [ ] Hai người hạ nhau gần đồng thời nhưng điểm vẫn giống nhau.
- [ ] Thoát vào lại vẫn khôi phục điểm và hồ sơ.
- [ ] Bảng xếp hạng trên PC và điện thoại hiển thị đúng.
- [ ] Nút âm thanh và điều khiển cảm ứng hoạt động.

## Kiểm tra hệ thống

- [ ] `npm test` đạt.
- [ ] `npm run check` đạt.
- [ ] Cloudflare `/api/health` trả `ok: true`.
- [ ] Cloudflare Build của commit cuối có trạng thái thành công.
- [ ] Supabase Security Advisor không có lỗi mức ERROR.
- [ ] Không có secret/service-role key trong GitHub.

## Chốt bản

- [ ] Gắn Git tag `v1.0.0`.
- [ ] Ghi lại URL Worker production.
- [ ] Không thêm tính năng mới vào bản v1.
- [ ] Quảng cáo và tên miền riêng chuyển sang giai đoạn sau.
