# 📋 Phân Tích Lỗi Nộp Bài Thi - Exam Submission 500 Error

## 🔴 Tóm Tắt Vấn Đề

Khi user nộp bài thi tại `/user/assignments/exam/22928`, server trả về **500 error** với message:  
```
Failed to load resource: the server responded with a status of 500 ()
/api/exam-submissions:1
```

---

## 🎯 Nguyên Nhân Gốc Rễ (ROOT CAUSE)

**Vị trí lỗi:** [app/api/exam-submissions/route.ts](app/api/exam-submissions/route.ts) **dòng 540-548**

Code cố gắng cập nhật bảng `chuyen_sau_results` với **2 column không tồn tại**:

```typescript
// ❌ PROBLEMATIC CODE (Line 540-548)
await client.query(
  `UPDATE chuyen_sau_results SET
     diem         = $1,              // ✅ Tồn tại
     cau_dung     = $2,              // ✅ Tồn tại
     trang_thai   = 'da_nop',        // ❌ KHÔNG TỒN TẠI
     thoi_gian_nop = NOW(),          // ❌ KHÔNG TỒN TẠI
     xu_ly_diem   = 'đã hoàn thành'  // ✅ Tồn tại
   WHERE id = $3`,
  [score10, correctCount, result_id]
);
```

---

## 📊 Schema Database Thực Tế (FROM lib/migrations.ts)

### Bảng `chuyen_sau_results` - Các column thực tế:
```
id, khu_vuc, ho_ten, dia_chi_email, co_so_lam_viec, ma_giao_vien, 
hinh_thuc, khoi_giang_day, thang_dk, nam_dk, dot, 
thoi_gian_kiem_tra ⬅️ (KHÔNG PHẢI thoi_gian_nop),
cau_dung ✅, diem ✅, email_giai_trinh, xu_ly_diem ✅, 
id_su_kien, id_mon, id_de_thi, da_giai_thich, so_lan_giai_thich, 
tong_diem_bi_tru, dang_ky_luc, tao_luc, updated_at
```

### ❌ Column KHÔNG TỒN TẠI:
1. **`trang_thai`** - Không có trong `chuyen_sau_results`
   - Có trong `chuyen_sau_bainop` nhưng không phải bảng này
   
2. **`thoi_gian_nop`** - Không có trong `chuyen_sau_results`  
   - Có trong `chuyen_sau_bainop` nhưng không phải bảng này

---

## 🔍 Lỗi Chính Xác Từ PostgreSQL

Khi code cố gắng thực thi UPDATE:
```
ERROR: column "trang_thai" does not exist
```
hoặc  
```
ERROR: column "thoi_gian_nop" does not exist
```

Transaction **ROLLBACK** → HTTP 500 error trả về client

---

## 📝 Quy Trình Thực Thi (Execution Flow)

1. ✅ Client gửi PUT request `/api/exam-submissions` với answers
2. ✅ Server xử lý answers, tính toán điểm
3. ✅ INSERT vào `chuyen_sau_bainop` - **THÀNH CÔNG** (tất cả column tồn tại)
4. ✅ UPDATE `chuyen_sau_bainop` - **THÀNH CÔNG** (dòng 525-533, tất cả column tồn tại)
5. ❌ UPDATE `chuyen_sau_results` - **THẤT BẠI** ← **LỖI ÖN ĐÂY**
   - PostgreSQL không tìm thấy column `trang_thai` hoặc `thoi_gian_nop`
6. 🔄 ROLLBACK toàn bộ transaction
7. 📤 HTTP 500: "Failed to submit exam"

---

## 💾 Bảng `chuyen_sau_bainop` - OK (Không có lỗi)

UPDATE statement ở dòng 525-533 **hoạt động bình thường** vì:
```typescript
// ✅ ALL COLUMNS EXIST in chuyen_sau_bainop
UPDATE chuyen_sau_bainop SET
  trang_thai_nop      = 'da_nop',       // ✅ Tồn tại
  nop_luc             = NOW(),          // ✅ Tồn tại
  diem_tho            = $1,             // ✅ Tồn tại
  diem_tho_toi_da     = $2,             // ✅ Tồn tại
  phan_tram           = $3,             // ✅ Tồn tại
  diem_chuan_hoa      = $4,             // ✅ Tồn tại
  raw_score           = $1,             // ✅ Tồn tại
  percentage          = $3,             // ✅ Tồn tại
  submitted_at        = NOW()           // ✅ Tồn tại
WHERE id = $5
```

**KẾT LUẬN:** Cái DBML schema file là **outdated**. File migrations.ts là source of truth.

---

## ✋ Giải Pháp Cần Làm

Cần loại bỏ hoặc sửa UPDATE statement cho `chuyen_sau_results`:

**Option 1:** Xóa các column không tồn tại
- Bỏ `trang_thai = 'da_nop'`
- Bỏ `thoi_gian_nop = NOW()`
- Giữ lại: `diem`, `cau_dung`, `xu_ly_diem`

**Option 2:** Dùng column tồn tại thay thế
- Thay `thoi_gian_nop` → `thoi_gian_kiem_tra`
- Thay `trang_thai` → Không có tương đương (nếu cần thêm column)

---

## 📌 Tệp Cần Xem Xét

- [app/api/exam-submissions/route.ts](app/api/exam-submissions/route.ts) - Dòng 540-548
- [lib/migrations.ts](lib/migrations.ts) - Schema định nghĩa chuyen_sau_results
