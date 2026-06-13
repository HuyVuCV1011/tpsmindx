import pool from './db';
import { getPublicBaseUrl } from './public-base-url';

interface NotificationPayload {
  recipientEmail: string;
  title: string;
  content: string;
  type: string;
  link?: string;
}

/**
 * Creates an in-app notification for a user.
 */
export async function createNotification(payload: NotificationPayload): Promise<void> {
  const { recipientEmail, title, content, type, link } = payload;
  let client;
  try {
    client = await pool.connect();
    await client.query(
      `INSERT INTO notifications (recipient_email, title, content, type, link, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, FALSE, NOW())`,
      [recipientEmail.trim().toLowerCase(), title, content, type, link || null]
    );
  } catch (err) {
    console.error('[NotificationService] Failed to create in-app notification:', err);
  } finally {
    client?.release();
  }
}

/**
 * Creates an in-app notification for all active users.
 */
export async function createNotificationForEveryone(payload: Omit<NotificationPayload, 'recipientEmail'>): Promise<void> {
  const { title, content, type, link } = payload;
  let client;
  try {
    client = await pool.connect();
    const result = await client.query<{ inserted_count: number }>(
      `WITH active_recipients AS (
         SELECT LOWER(TRIM(email)) AS recipient_email
         FROM app_users
         WHERE is_active IS TRUE
           AND NULLIF(TRIM(email), '') IS NOT NULL

         UNION

         SELECT LOWER(
           TRIM(
             COALESCE(
               NULLIF(TRIM(work_email), ''),
               NULLIF(TRIM("Work email"), '')
             )
           )
         ) AS recipient_email
         FROM teachers
         WHERE LOWER(
           TRIM(
             COALESCE(
               NULLIF(TRIM(status), ''),
               NULLIF(TRIM("Status"), ''),
               'active'
             )
           )
         ) NOT IN ('deactive', 'inactive', 'disabled')
       ),
       inserted AS (
         INSERT INTO notifications (
           recipient_email,
           title,
           content,
           type,
           link,
           is_read,
           created_at
         )
         SELECT
           recipient_email,
           $1,
           $2,
           $3,
           $4,
           FALSE,
           NOW()
         FROM active_recipients
         WHERE recipient_email IS NOT NULL
           AND POSITION('@' IN recipient_email) > 1
         RETURNING id
       )
       SELECT COUNT(*)::int AS inserted_count
       FROM inserted`,
      [title, content, type, link || null]
    );

    console.info(
      `[NotificationService] Created notification for ${result.rows[0]?.inserted_count || 0} active recipients`
    );
  } catch (err) {
    console.error('[NotificationService] Failed to create notifications for everyone:', err);
  } finally {
    client?.release();
  }
}

/**
 * Sends an email notification via the internal /api/emails API.
 * This is ONLY called for leave request results (approvals/rejections/substitute confirmations).
 */
export async function sendEmailNotification(type: string, data: Record<string, unknown>): Promise<void> {
  try {
    const baseUrl = getPublicBaseUrl();
    const internalSecret =
      process.env.INTERNAL_API_SECRET ||
      process.env.EMAIL_INTERNAL_API_SECRET ||
      '';
    await fetch(`${baseUrl}/api/emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(internalSecret
          ? { 'x-internal-api-secret': internalSecret }
          : {}),
      },
      body: JSON.stringify({ type, data }),
    });
  } catch (err) {
    console.error('[NotificationService] Email send failed:', err);
  }
}

/**
 * Sends a Telegram notification to the administrator group.
 * Useful for alerting admins about critical requests (e.g. salary deals or new leave requests).
 */
export async function sendTelegramNotification(message: string): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
    });
  } catch (err) {
    console.error('[NotificationService] Telegram send failed:', err);
  }
}
