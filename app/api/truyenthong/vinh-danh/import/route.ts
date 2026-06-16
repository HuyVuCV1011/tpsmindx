import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { parseCsvLine } from '@/lib/csv-registration-import'
import { createSupabaseS3Client, isSupabaseS3Configured } from '@/lib/supabase-s3'
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3'

const BUCKET_NAME = 'mindx-thumbnails'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

async function ensureBucket() {
  const client = createSupabaseS3Client()
  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }))
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }))
  }
}

function makeProxyUrl(bucket: string, key: string): string {
  return `/api/storage-image?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`
}

// ─── Header Map ───────────────────────────────────────────────────────────────
// Map tên cột (lowercase, trimmed) → tên nội bộ
const HEADER_MAP: Record<string, string> = {
  // STT
  'stt': 'stt',
  'số thứ tự': 'stt',
  // Tên
  'tên': 'full_name',
  'họ và tên': 'full_name',
  'họ tên': 'full_name',
  'giảng viên': 'full_name',
  'name': 'full_name',
  // Email
  'email': 'email',
  // Khối dạy
  'khối dạy': 'khoi_day',
  'khoi day': 'khoi_day',
  // Cơ sở
  'cơ sở': 'co_so',
  'co so': 'co_so',
  'cơ sở làm việc': 'co_so',
  // Tháng
  'tháng': 'thang',
  'thang': 'thang',
  'month': 'thang',
  // Số case
  'số case': 'so_case',
  'so case': 'so_case',
  // Số học sinh
  'số học sinh': 'so_hoc_sinh',
  'so hoc sinh': 'so_hoc_sinh',
  // Tỉ lệ
  'tỉ lệ': 'ti_le',
  'ti le': 'ti_le',
  'tỷ lệ': 'ti_le',
  'tyle': 'ti_le',
  // Loại
  'loại': 'loai',
  'loai': 'loai',
  'loại/chọn': 'loai',
  // Thưởng
  'thưởng cr': 'thuong_cr',
  'thuong cr': 'thuong_cr',
  'bonus cr': 'thuong_cr',
  'thưởng': 'thuong_cr',
}

function normalizeKey(h: string): string {
  return h.toLowerCase().trim().replace(/\s+/g, ' ')
}

// ─── Multi-header parser ──────────────────────────────────────────────────────
// Hỗ trợ file có 2 dòng header (dòng 1: nhóm, dòng 2: tên cột thực)
// Tự động phát hiện dòng header thực bằng cách tìm dòng chứa nhiều field đã biết nhất

function detectHeaderRow(lines: string[]): { headerIdx: number; headers: string[] } {
  let bestIdx = 0
  let bestScore = -1

  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cells = parseCsvLine(line).map(h => h.replace(/^\uFEFF/, '').trim())
    // Đếm số cell khớp với HEADER_MAP
    const score = cells.filter(c => HEADER_MAP[normalizeKey(c)] !== undefined).length
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
      // Nếu dòng này là hàng có STT empty + Giảng viên, ưu tiên nó
    }
  }

  const headers = parseCsvLine(lines[bestIdx])
    .map(h => h.replace(/^\uFEFF/, '').trim())

  return { headerIdx: bestIdx, headers }
}

// ─── Number parsers ───────────────────────────────────────────────────────────

function parsePercent(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  // "85,00%" → 85.00   hoặc "85.00%" → 85.00
  const s = String(v)
    .replace(/%/g, '')
    .replace(/\s/g, '')
    .replace(/,/g, '.')   // dấu phẩy thập phân kiểu VN
    .trim()
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

function parseMoney(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  // "1,500,000 ₫" → 1500000
  const s = String(v)
    .replace(/[₫đ\s]/gi, '')
    .replace(/\./g, '')   // dấu chấm ngàn
    .replace(/,/g, '')    // dấu phẩy ngàn
    .trim()
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

function parseNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const s = String(v).replace(/,/g, '').trim()
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const importedBy = (formData.get('imported_by') as string) || 'admin'

    if (!file) {
      return NextResponse.json({ success: false, error: 'Thiếu file CSV' }, { status: 400 })
    }

    const text = await file.text()
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines = normalized.split('\n').filter(l => l.trim().length > 0)

    if (lines.length < 2) {
      return NextResponse.json({ success: false, error: 'File cần có ít nhất 1 dòng tiêu đề và 1 dòng dữ liệu.' }, { status: 400 })
    }

    // Tự phát hiện dòng header
    const { headerIdx, headers } = detectHeaderRow(lines)

    // Map header index → tên nội bộ
    const colMap: Record<number, string> = {}
    headers.forEach((h, i) => {
      const key = HEADER_MAP[normalizeKey(h)]
      if (key) colMap[i] = key
    })

    // Parse các dòng dữ liệu (bỏ tất cả dòng <= headerIdx)
    const dataLines = lines.slice(headerIdx + 1)
    const rows: Record<string, string>[] = []
    for (const line of dataLines) {
      if (!line.trim() || line.startsWith('#')) continue
      const cells = parseCsvLine(line)
      const row: Record<string, string> = {}
      Object.entries(colMap).forEach(([idxStr, fieldName]) => {
        row[fieldName] = (cells[Number(idxStr)] ?? '').trim()
      })
      if (row.full_name) rows.push(row)
    }

    if (!rows.length) {
      return NextResponse.json({
        success: false,
        error: 'Không tìm thấy dữ liệu hợp lệ. Kiểm tra lại tên cột CSV (cần có cột "Giảng viên" hoặc "Tên").'
      }, { status: 400 })
    }

    const thangFromForm = (formData.get('thang') as string) || ''

    // Upload top 3 images if provided
    const topImages: Record<number, string> = {} // key: stt, value: url
    if (isSupabaseS3Configured()) {
      await ensureBucket()
      const client = createSupabaseS3Client()
      
      for (let i = 1; i <= 3; i++) {
        const fileKey = `top${i}Image`
        const file = formData.get(fileKey)
        if (file && typeof file !== 'string') {
          if (file.type.startsWith('image/') && file.size <= MAX_IMAGE_BYTES) {
            const buffer = Buffer.from(await file.arrayBuffer())
            const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
            const key = `top-honors/${Date.now()}-${Math.random().toString(36).slice(2)}-top${i}.${ext}`
            
            await client.send(new PutObjectCommand({
              Bucket: BUCKET_NAME,
              Key: key,
              Body: buffer,
              ContentType: file.type || 'image/jpeg',
            }))
            
            topImages[i] = makeProxyUrl(BUCKET_NAME, key)
          }
        }
      }
    }

    const client = await pool.connect()
    try {
      // Tạo bảng nếu chưa có
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

      let insertedCount = 0
      const errors: string[] = []
      const preview: Record<string, unknown>[] = []

      for (const row of rows) {
        const thang = (row.thang || thangFromForm || '').trim()
        if (!thang) {
          errors.push(`Bỏ qua "${row.full_name}": thiếu tháng`)
          continue
        }

        const email = (row.email || '').trim().toLowerCase()
        const stt = parseInt(row.stt || '0') || null

        // Check if we have a custom image for this rank
        let avatarUrl: string | null = null
        if (stt && topImages[stt]) {
          avatarUrl = topImages[stt]
        } else if (email) {
          // Fallback to teacher_avatars or app_users
          // 1. Thử teacher_avatars trước
          try {
            const avatarRes = await client.query(
              `SELECT avatar_url FROM teacher_avatars WHERE LOWER(teacher_email) = $1 LIMIT 1`,
              [email]
            )
            avatarUrl = avatarRes.rows[0]?.avatar_url || null
          } catch {
            // If teacher_avatars or avatar_url doesn't exist, skip
          }

          // 2. Fallback: app_users (nếu user đăng nhập bằng email này)
          if (!avatarUrl) {
            try {
              const userRes = await client.query(
                `SELECT avatar_url FROM app_users WHERE LOWER(email) = $1 LIMIT 1`,
                [email]
              )
              avatarUrl = userRes.rows[0]?.avatar_url || null
            } catch {
              // If app_users or avatar_url doesn't exist, skip
            }
          }
        }

        // Parse số liệu với format VN
        const tiLe = parsePercent(row.ti_le)
        const thuongCr = parseMoney(row.thuong_cr)
        const soCase = parseNum(row.so_case)
        const soHocSinh = parseNum(row.so_hoc_sinh)

        try {
          await client.query(
            `INSERT INTO teacher_monthly_honors
              (stt, full_name, email, khoi_day, co_so, thang, so_case, so_hoc_sinh, ti_le, loai, thuong_cr, avatar_url, imported_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (email, thang) DO UPDATE SET
               stt = EXCLUDED.stt,
               full_name = EXCLUDED.full_name,
               khoi_day = EXCLUDED.khoi_day,
               co_so = EXCLUDED.co_so,
               so_case = EXCLUDED.so_case,
               so_hoc_sinh = EXCLUDED.so_hoc_sinh,
               ti_le = EXCLUDED.ti_le,
               loai = EXCLUDED.loai,
               thuong_cr = EXCLUDED.thuong_cr,
               avatar_url = EXCLUDED.avatar_url,
               imported_at = NOW(),
               imported_by = EXCLUDED.imported_by`,
            [stt, row.full_name, email || null, row.khoi_day || null, row.co_so || null,
             thang, soCase, soHocSinh, tiLe, row.loai || null, thuongCr, avatarUrl, importedBy]
          )
          insertedCount++
          if (preview.length < 10) {
            preview.push({
              stt, full_name: row.full_name, co_so: row.co_so,
              thang, ti_le: tiLe, avatar_url: avatarUrl,
            })
          }
        } catch (err) {
          errors.push(`Lỗi dòng "${row.full_name}": ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      return NextResponse.json({
        success: true,
        inserted: insertedCount,
        total: rows.length,
        errors: errors.slice(0, 20),
        preview,
      })
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('Import honors error:', err)
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Lỗi server'
    }, { status: 500 })
  }
}
