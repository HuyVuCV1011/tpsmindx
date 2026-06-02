import pool from '@/lib/db';
import { writeAuditLog } from '@/lib/audit-logger';

export interface TrafficStatus {
  activeUsers: number;
  totalMentors: number;
  ratio: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

/**
 * Kiểm tra lưu lượng phiên đăng nhập đồng thời và đối chiếu với số lượng Mentor (Teachers).
 * Nếu vượt ngưỡng an toàn (90% hoặc 100% số Mentor) sẽ tự động kích hoạt ghi log CRITICAL/HIGH
 * để đẩy cảnh báo khẩn cấp về Telegram Group.
 */
export async function checkSessionTraffic(): Promise<TrafficStatus> {
  try {
    // 1. Lấy số lượng tài khoản hoạt động đồng thời (15 phút qua)
    const activeRes = await pool.query(
      `SELECT COUNT(DISTINCT user_email) as count 
       FROM public.session_tracking 
       WHERE last_activity > NOW() - INTERVAL '15 minutes'`
    );
    const activeUsers = parseInt(activeRes.rows[0]?.count ?? '0', 10);

    // 2. Lấy số lượng Mentor (teachers) trong hệ thống
    const mentorsRes = await pool.query('SELECT COUNT(*) as count FROM public.teachers');
    const totalMentors = parseInt(mentorsRes.rows[0]?.count ?? '0', 10);

    if (totalMentors === 0) {
      return { activeUsers, totalMentors: 0, ratio: 0, level: 'LOW' };
    }

    const ratio = activeUsers / totalMentors;
    let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';

    // Phân cấp mức độ lưu lượng
    if (ratio > 1.0) {
      level = 'CRITICAL'; // Vượt quá 100% số lượng mentor của web
    } else if (ratio > 0.9) {
      level = 'HIGH';     // Đạt trên 90% số lượng mentor (Ngưỡng nguy hiểm)
    } else if (ratio > 0.5) {
      level = 'MEDIUM';   // Đạt trên 50% số lượng mentor (Trung bình)
    }

    // 3. Nếu mức độ vượt ngưỡng HIGH/CRITICAL → Ghi audit log khẩn cấp để bắn Telegram Alert
    if (level === 'HIGH' || level === 'CRITICAL') {
      // Giới hạn tần suất cảnh báo (chỉ cảnh báo 1 lần trong mỗi 15 phút để tránh spam)
      const recentAlertCheck = await pool.query(
        `SELECT id FROM public.security_audit_logs 
         WHERE action = 'EXCESSIVE_LOGIN_TRAFFIC' 
           AND created_at > NOW() - INTERVAL '15 minutes'
         LIMIT 1`
      );

      if (recentAlertCheck.rows.length === 0) {
        writeAuditLog({
          event_type: 'SYSTEM',
          action: 'EXCESSIVE_LOGIN_TRAFFIC',
          severity: level === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
          resource_type: 'session_tracking',
          resource_id: 'active_sessions',
          new_data: { 
            active_users: activeUsers, 
            total_mentors: totalMentors, 
            ratio: `${Math.round(ratio * 100)}%`,
            traffic_level: level
          },
          risk_score: level === 'CRITICAL' ? 100 : 85,
          threat_flags: [
            'HIGH_CONCURRENT_SESSIONS', 
            level === 'CRITICAL' ? 'EXCEEDED_MENTOR_COUNT' : 'APPROACHING_MENTOR_LIMIT'
          ],
        });
      }
    }

    return { activeUsers, totalMentors, ratio, level };
  } catch (err) {
    console.error('[SessionMonitor] Error checking session traffic:', (err as Error).message);
    return { activeUsers: 0, totalMentors: 0, ratio: 0, level: 'LOW' };
  }
}
