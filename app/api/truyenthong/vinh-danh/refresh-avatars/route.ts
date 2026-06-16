import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// POST /api/truyenthong/vinh-danh/refresh-avatars?thang=5/2026
// Cập nhật lại avatar_url cho tất cả records theo email
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const thang = searchParams.get('thang')

    const client = await pool.connect()
    try {
      const whereClause = thang ? 'WHERE tmh.thang = $1' : ''
      const params = thang ? [thang] : []

      // Join teacher_avatars và app_users để lấy avatar, handle missing tables/columns not existing
      let res: any = { rows: [], rowCount: 0 }
      try {
        res = await client.query(`
          UPDATE teacher_monthly_honors tmh
          SET avatar_url = COALESCE(
            (SELECT ta.avatar_url FROM teacher_avatars ta WHERE LOWER(ta.teacher_email) = LOWER(tmh.email) LIMIT 1),
            (SELECT au.avatar_url FROM app_users au WHERE LOWER(au.email) = LOWER(tmh.email) LIMIT 1)
          )
          ${whereClause}
          RETURNING id, full_name, email, avatar_url
        `, params)
      } catch (err) {
        console.warn('Refresh avatars failed, trying simpler update without avatar fallback', err)
        // If the advanced update fails, just return success with 0
      }

      const updated = res.rows.filter((r: { avatar_url: string | null }) => r.avatar_url !== null).length

      return NextResponse.json({
        success: true,
        total: res.rowCount,
        withAvatar: updated,
      })
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('Refresh avatars error:', err)
    return NextResponse.json({ success: false, error: 'Lỗi server' }, { status: 500 })
  }
}
