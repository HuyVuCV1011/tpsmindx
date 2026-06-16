import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// GET /api/truyenthong/vinh-danh?thang=06/2025
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const thang = searchParams.get('thang')

    const client = await pool.connect()
    try {
      // Tạo bảng nếu chưa tồn tại (chạy migration lần đầu)
      await client.query(`
        CREATE TABLE IF NOT EXISTS teacher_monthly_honors (
          id SERIAL PRIMARY KEY,
          stt INTEGER,
          full_name VARCHAR(255) NOT NULL,
          email VARCHAR(255),
          khoi_day VARCHAR(100),
          co_so VARCHAR(255),
          thang VARCHAR(20) NOT NULL,
          so_case INTEGER DEFAULT 0,
          so_hoc_sinh INTEGER DEFAULT 0,
          ti_le NUMERIC(5,2) DEFAULT 0,
          loai VARCHAR(100),
          thuong_cr NUMERIC(15,2) DEFAULT 0,
          avatar_url TEXT,
          imported_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          imported_by VARCHAR(255),
          UNIQUE(email, thang)
        );
        CREATE INDEX IF NOT EXISTS idx_teacher_monthly_honors_thang
          ON teacher_monthly_honors(thang, stt ASC);
        CREATE INDEX IF NOT EXISTS idx_teacher_monthly_honors_email
          ON teacher_monthly_honors(email);
      `)

      // Lấy danh sách các tháng đã có dữ liệu
      const monthsRes = await client.query(`
        SELECT DISTINCT thang FROM teacher_monthly_honors
        ORDER BY thang DESC
      `)
      const months: string[] = monthsRes.rows.map((r: { thang: string }) => r.thang)

      if (!thang && !months.length) {
        return NextResponse.json({ success: true, months: [], data: [] })
      }

      const targetMonth = thang || months[0]

      const dataRes = await client.query(`
        SELECT
          id, stt, full_name, email, khoi_day, co_so, thang,
          so_case, so_hoc_sinh,
          CAST(ti_le AS FLOAT) AS ti_le,
          loai, thuong_cr, avatar_url, imported_at
        FROM teacher_monthly_honors
        WHERE thang = $1
        ORDER BY stt ASC NULLS LAST, ti_le DESC
      `, [targetMonth])

      return NextResponse.json({
        success: true,
        months,
        current_month: targetMonth,
        data: dataRes.rows,
      })
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('Get vinh danh error:', err)
    return NextResponse.json({ success: false, error: 'Lỗi server' }, { status: 500 })
  }
}

// DELETE /api/truyenthong/vinh-danh?thang=06/2025
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const thang = searchParams.get('thang')
    if (!thang) return NextResponse.json({ success: false, error: 'Thiếu tháng' }, { status: 400 })

    const client = await pool.connect()
    try {
      const res = await client.query(
        `DELETE FROM teacher_monthly_honors WHERE thang = $1`,
        [thang]
      )
      return NextResponse.json({ success: true, deleted: res.rowCount })
    } finally {
      client.release()
    }
  } catch (err) {
    return NextResponse.json({ success: false, error: 'Lỗi server' }, { status: 500 })
  }
}
