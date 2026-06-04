import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getApiSecret } from '@/lib/internal-api-secret';
import { createNotification, createNotificationForEveryone } from '@/lib/notification-service';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Protect endpoint - only Vercel Cron or internal calls
  const authHeader = request.headers.get('authorization');
  const apiSecret = getApiSecret();
  
  const isCronRequest = authHeader === `Bearer ${apiSecret}`;
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  
  if (!isCronRequest && !isVercelCron) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, any> = {
    exam_reminders_sent: 0,
    registration_announcements_sent: 0,
    errors: []
  };

  let client;
  try {
    client = await pool.connect();

    // -------------------------------------------------------------
    // Part 1: Specialized Exam Reminders (10 minutes before starting)
    // -------------------------------------------------------------
    const examReminders = await client.query(`
      SELECT 
        r.id AS result_id,
        r.dia_chi_email AS email,
        r.ho_ten AS name,
        mh.ten_mon AS subject_name,
        COALESCE(
          (es.bat_dau_luc AT TIME ZONE 'Asia/Ho_Chi_Minh'), 
          (r.lich_thi_dk AT TIME ZONE 'Asia/Ho_Chi_Minh')
        ) AS start_time
      FROM chuyen_sau_results r
      LEFT JOIN event_schedules es ON es.id = r.id_su_kien
      LEFT JOIN chuyen_sau_monhoc mh ON mh.id = r.id_mon
      WHERE r.xu_ly_diem = 'chờ giải trình'
        AND r.diem IS NULL
        AND COALESCE(
          (es.bat_dau_luc AT TIME ZONE 'Asia/Ho_Chi_Minh'), 
          (r.lich_thi_dk AT TIME ZONE 'Asia/Ho_Chi_Minh')
        ) >= NOW() + INTERVAL '5 minutes'
        AND COALESCE(
          (es.bat_dau_luc AT TIME ZONE 'Asia/Ho_Chi_Minh'), 
          (r.lich_thi_dk AT TIME ZONE 'Asia/Ho_Chi_Minh')
        ) <= NOW() + INTERVAL '15 minutes'
    `);

    for (const row of examReminders.rows) {
      if (!row.email) continue;
      const email = row.email.trim().toLowerCase();
      const link = `/user/assignments?id=${row.result_id}`;

      // Check if notification already exists to avoid duplication
      const dupCheck = await client.query(
        `SELECT 1 FROM notifications 
         WHERE recipient_email = $1 
           AND type = 'exam_reminder' 
           AND link = $2 
         LIMIT 1`,
        [email, link]
      );

      if (dupCheck.rows.length === 0) {
        const formattedTime = new Intl.DateTimeFormat('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }).format(new Date(row.start_time));

        await createNotification({
          recipientEmail: email,
          title: 'Nhắc nhở: Sắp đến giờ thi chuyên sâu',
          content: `Kỳ thi chuyên sâu môn "${row.subject_name || 'chuyên môn'}" của bạn bắt đầu lúc ${formattedTime} (sau khoảng 10 phút). Vui lòng chuẩn bị tham gia.`,
          type: 'exam_reminder',
          link
        });
        results.exam_reminders_sent++;
      }
    }

    // -------------------------------------------------------------
    // Part 2: Registration Day Notifications (Starts Today)
    // -------------------------------------------------------------
    const regEvents = await client.query(`
      SELECT 
        es.id,
        es.ten AS title,
        (es.bat_dau_luc AT TIME ZONE 'Asia/Ho_Chi_Minh') AS start_time
      FROM event_schedules es
      WHERE es.loai_su_kien IN ('registration', 'dang_ky')
        AND es.trang_thai = 'scheduled'
        AND (es.bat_dau_luc AT TIME ZONE 'Asia/Ho_Chi_Minh') >= CURRENT_DATE
        AND (es.bat_dau_luc AT TIME ZONE 'Asia/Ho_Chi_Minh') < CURRENT_DATE + INTERVAL '1 day'
    `);

    for (const event of regEvents.rows) {
      const link = `/user/assignments?event_id=${event.id}`;
      
      // Check if a global notification for this registration event has already been published
      const dupCheck = await client.query(
        `SELECT 1 FROM notifications 
         WHERE type = 'registration_start' 
           AND link = $1 
         LIMIT 1`,
        [link]
      );

      if (dupCheck.rows.length === 0) {
        // Send notification to everyone
        await createNotificationForEveryone({
          title: 'Mở cổng đăng ký kiểm tra chuyên sâu',
          content: `Hệ thống đã mở đăng ký cho đợt kiểm tra: "${event.title}". Vui lòng đăng ký tham gia trước hạn chót.`,
          type: 'registration_start',
          link
        });
        results.registration_announcements_sent++;
      }
    }

    return NextResponse.json({
      success: true,
      ran_at: new Date().toISOString(),
      results
    });
  } catch (error: any) {
    console.error('[Cron: Event Reminders] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Reminders job failed', details: error.message },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}
