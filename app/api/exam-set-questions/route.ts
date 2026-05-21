import pool from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { deleteObject, parsePublicUrl } from '@/lib/supabase-s3';

/** Xóa ảnh S3 an toàn, không throw */
async function deleteImageSilently(url: string | null) {
  if (!url) return;
  const parsed = parsePublicUrl(url);
  if (!parsed) return;
  try {
    await deleteObject(parsed.bucket, parsed.key);
  } catch (err) {
    console.error(`[S3 Cleanup] Failed to delete ${url}:`, err);
  }
}

/** Extract tất cả src URL từ HTML content */
function extractImageUrls(html: string): string[] {
  if (!html) return [];
  const urls: string[] = [];
  const regex = /src=["']([^"']+)["']/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    urls.push(match[1].replace(/&amp;/g, '&'));
  }
  return urls;
}

// Loại bỏ blob/data-url images khỏi HTML content khi lưu vào DB
const stripUnstableImageSources = (value: unknown) => {
  if (typeof value !== 'string') return value;
  return value.replace(
    /<img[^>]+src=["'](?:blob:[^"']*|data:image[^"']*)[^>]*>/gi,
    ''
  );
};

const normalizeDbQuestionType = (value: string | null | undefined) => {
  switch (value) {
    case 'trac_nghiem':
      return 'multiple_choice';
    case 'tu_luan':
      return 'essay';
    default:
      return value || 'multiple_choice';
  }
};

const normalizeDbDifficulty = (value: string | null | undefined) => {
  switch (value) {
    case 'de':
      return 'easy';
    case 'kho':
      return 'hard';
    case 'trung_binh':
      return 'medium';
    case 'easy':
    case 'medium':
    case 'hard':
      return value;
    default:
      return 'medium';
  }
};

const normalizeRequestQuestionType = (value: string | null | undefined) => {
  switch (value) {
    case 'multiple_choice':
      return 'trac_nghiem';
    case 'essay':
      return 'tu_luan';
    default:
      return value || 'trac_nghiem';
  }
};

const normalizeRequestDifficulty = (value: string | null | undefined) => {
  switch (value) {
    case 'easy':
      return 'de';
    case 'hard':
      return 'kho';
    case 'medium':
      return 'trung_binh';
    default:
      return value || 'trung_binh';
  }
};

// Cache kết quả hasColumn để tránh query information_schema mỗi request
// (tránh deadlock khi pool.max=1 và client đã được giữ trong transaction)
const columnCache = new Map<string, boolean>();

async function hasColumn(tableName: string, columnName: string) {
  const cacheKey = `${tableName}.${columnName}`;
  if (columnCache.has(cacheKey)) {
    return columnCache.get(cacheKey)!;
  }
  const result = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
    [tableName, columnName]
  );
  const exists = result.rows.length > 0;
  columnCache.set(cacheKey, exists);
  return exists;
}

// ─── GET: Lấy câu hỏi của một bộ đề theo set_id ──────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const setId = searchParams.get('set_id');

    if (!setId) {
      return NextResponse.json({ error: 'set_id is required' }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT
         cq.id,
         bc.id_de                                           AS assignment_id,
         cq.noi_dung_cau_hoi                               AS question_text,
         cq.loai_cau_hoi                                   AS question_type,
         COALESCE(cq.dap_an_dung, '')                      AS correct_answer,
         CASE
           WHEN cq.lua_chon_a IS NULL AND cq.lua_chon_b IS NULL
            AND cq.lua_chon_c IS NULL AND cq.lua_chon_d IS NULL THEN NULL
           ELSE jsonb_build_array(cq.lua_chon_a, cq.lua_chon_b, cq.lua_chon_c, cq.lua_chon_d)
         END                                               AS options,
         COALESCE(cq.giai_thich, '')                       AS explanation,
         cq.diem                                           AS points,
         bc.thu_tu_hien_thi                                AS order_number,
         COALESCE(cq.do_kho, 'trung_binh')                 AS difficulty,
         cq.image_url                                      AS image_url,
         bd.ma_de                                          AS set_code,
         bd.ten_de                                         AS set_name,
         mh.ten_mon                                        AS subject_name
       FROM chuyen_sau_bode_cauhoi bc
       JOIN chuyen_sau_cauhoi cq ON cq.id = bc.id_cau
       JOIN chuyen_sau_bode bd   ON bd.id = bc.id_de
       JOIN chuyen_sau_monhoc mh ON mh.id = bd.id_mon
       WHERE bc.id_de = $1
       ORDER BY bc.thu_tu_hien_thi ASC`,
      [setId]
    );

    const normalizedRows = result.rows.map((row) => ({
      ...row,
      question_type: normalizeDbQuestionType(row.question_type),
      difficulty: normalizeDbDifficulty(row.difficulty),
    }));

    return NextResponse.json({ success: true, data: normalizedRows, count: normalizedRows.length });
  } catch (error) {
    console.error('Error fetching exam set questions:', error);
    return NextResponse.json({ error: 'Failed to fetch exam set questions' }, { status: 500 });
  }
}

// ─── POST: Thêm câu hỏi mới vào bộ đề ───────────────────────────────────────

export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const {
      set_id,
      question_text,
      question_type = 'trac_nghiem',
      correct_answer,
      options,
      explanation,
      points = 1,
      order_number,
      difficulty = 'trung_binh',
      image_url,
    } = body;

    if (!set_id) {
      return NextResponse.json({ error: 'set_id is required' }, { status: 400 });
    }

    const sanitizedText = String(stripUnstableImageSources(question_text) || '');
    const normalizedText = sanitizedText.trim() || '[Chưa có nội dung]';
    const sanitizedCorrectAnswerRaw = correct_answer == null ? null : String(stripUnstableImageSources(correct_answer) || '');
    const sanitizedCorrectAnswer = sanitizedCorrectAnswerRaw === '' ? null : sanitizedCorrectAnswerRaw;
    const sanitizedExplanation = explanation == null ? null : String(stripUnstableImageSources(explanation) || '');
    const sanitizedOptions = Array.isArray(options)
      ? options.map((item) => String(stripUnstableImageSources(item) || '')).filter(Boolean)
      : [];

    // Normalize question_type và difficulty về giá trị DB
    const dbQuestionType = normalizeRequestQuestionType(question_type);
    const dbDifficulty = normalizeRequestDifficulty(difficulty);

    await client.query('BEGIN');

    // Dùng client (không dùng pool.query) để tránh deadlock với pool.max=1
    // Kiểm tra cột image_url tồn tại không — dùng client đang có sẵn
    const colCheck = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'chuyen_sau_cauhoi' AND column_name = 'image_url' LIMIT 1`
    );
    const hasImageUrl = colCheck.rows.length > 0;

    let questionResult;
    if (hasImageUrl) {
      questionResult = await client.query(
        `INSERT INTO chuyen_sau_cauhoi (
           loai_cau_hoi, noi_dung_cau_hoi,
           lua_chon_a, lua_chon_b, lua_chon_c, lua_chon_d,
           dap_an_dung, image_url, giai_thich, diem, do_kho
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          dbQuestionType,
          normalizedText,
          sanitizedOptions[0] || null,
          sanitizedOptions[1] || null,
          sanitizedOptions[2] || null,
          sanitizedOptions[3] || null,
          sanitizedCorrectAnswer,
          image_url ?? null,
          sanitizedExplanation,
          Number(points || 1),
          dbDifficulty,
        ]
      );
    } else {
      questionResult = await client.query(
        `INSERT INTO chuyen_sau_cauhoi (
           loai_cau_hoi, noi_dung_cau_hoi,
           lua_chon_a, lua_chon_b, lua_chon_c, lua_chon_d,
           dap_an_dung, giai_thich, diem, do_kho
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          dbQuestionType,
          normalizedText,
          sanitizedOptions[0] || null,
          sanitizedOptions[1] || null,
          sanitizedOptions[2] || null,
          sanitizedOptions[3] || null,
          sanitizedCorrectAnswer,
          sanitizedExplanation,
          Number(points || 1),
          dbDifficulty,
        ]
      );
    }

    const questionId = questionResult.rows[0].id;

    await client.query(
      `INSERT INTO chuyen_sau_bode_cauhoi (id_de, id_cau, thu_tu_hien_thi)
       VALUES ($1, $2, $3)`,
      [set_id, questionId, Number(order_number || 1)]
    );

    // Fetch lại câu hỏi vừa tạo — dùng client đang có sẵn (không dùng pool.query)
    const resultRow = await client.query(
      `SELECT
         cq.id,
         bc.id_de AS assignment_id,
         cq.noi_dung_cau_hoi AS question_text,
         cq.loai_cau_hoi AS question_type,
         cq.dap_an_dung AS correct_answer,
         CASE
           WHEN cq.lua_chon_a IS NULL AND cq.lua_chon_b IS NULL
            AND cq.lua_chon_c IS NULL AND cq.lua_chon_d IS NULL THEN NULL
           ELSE jsonb_build_array(cq.lua_chon_a, cq.lua_chon_b, cq.lua_chon_c, cq.lua_chon_d)
         END AS options,
         cq.giai_thich AS explanation,
         cq.diem AS points,
         bc.thu_tu_hien_thi AS order_number,
         cq.do_kho AS difficulty
       FROM chuyen_sau_cauhoi cq
       JOIN chuyen_sau_bode_cauhoi bc ON bc.id_cau = cq.id
       WHERE cq.id = $1`,
      [questionId]
    );

    await client.query('COMMIT');

    const createdQuestion = resultRow.rows[0]
      ? {
          ...resultRow.rows[0],
          question_type: normalizeDbQuestionType(resultRow.rows[0].question_type),
          difficulty: normalizeDbDifficulty(resultRow.rows[0].difficulty),
        }
      : null;

    return NextResponse.json(
      { success: true, data: createdQuestion, message: 'Exam set question created successfully' },
      { status: 201 }
    );
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[exam-set-questions:POST] Error:', error?.message, error?.code);
    return NextResponse.json(
      { error: error?.message || 'Failed to create exam set question' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}


// ─── PUT: Cập nhật câu hỏi ───────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  let client: any = null;
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Question id is required' }, { status: 400 });
    }

    const includeImageUrl = await hasColumn('chuyen_sau_cauhoi', 'image_url');
    const allowedFields = [
      'question_text', 'question_type', 'correct_answer',
      'options', ...(includeImageUrl ? ['image_url'] : []), 'explanation', 'points', 'order_number', 'difficulty',
    ];

    const questionClauses: string[] = [];
    const questionValues: unknown[] = [];
    const mappingClauses: string[] = [];
    const mappingValues: unknown[] = [];

    for (const key of Object.keys(updates)) {
      if (!allowedFields.includes(key)) continue;

      if (key === 'order_number') {
        mappingClauses.push(`thu_tu_hien_thi = $${mappingValues.length + 1}`);
        mappingValues.push(Number(updates[key] || 1));
        continue;
      }

      if (key === 'points') {
        questionClauses.push(`diem = $${questionValues.length + 1}`);
        questionValues.push(Number(updates[key] || 1));
        continue;
      }

      if (key === 'options') {
        const sanitized = Array.isArray(updates[key])
          ? updates[key].map((item: unknown) => String(stripUnstableImageSources(item) || '')).filter(Boolean)
          : [];
        const fields = ['lua_chon_a', 'lua_chon_b', 'lua_chon_c', 'lua_chon_d'] as const;
        for (const [idx, field] of fields.entries()) {
          questionClauses.push(`${field} = $${questionValues.length + 1}`);
          questionValues.push(sanitized[idx] || null);
        }
        continue;
      }

      if (key === 'question_text') {
        questionClauses.push(`noi_dung_cau_hoi = $${questionValues.length + 1}`);
        questionValues.push(stripUnstableImageSources(updates[key]));
        continue;
      }

      if (key === 'correct_answer') {
        questionClauses.push(`dap_an_dung = $${questionValues.length + 1}`);
        questionValues.push(stripUnstableImageSources(updates[key]));
        continue;
      }

      if (key === 'image_url') {
        if (!includeImageUrl) continue;
        questionClauses.push(`image_url = $${questionValues.length + 1}`);
        questionValues.push(updates[key] ?? null);
        continue;
      }

      if (key === 'explanation') {
        questionClauses.push(`giai_thich = $${questionValues.length + 1}`);
        questionValues.push(stripUnstableImageSources(updates[key]));
        continue;
      }

      if (key === 'question_type') {
        questionClauses.push(`loai_cau_hoi = $${questionValues.length + 1}`);
        questionValues.push(normalizeRequestQuestionType(updates[key] as string));
        continue;
      }

      if (key === 'difficulty') {
        questionClauses.push(`do_kho = $${questionValues.length + 1}`);
        questionValues.push(normalizeRequestDifficulty(updates[key] as string));
        continue;
      }
    }

    if (questionClauses.length === 0 && mappingClauses.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    if (questionClauses.length > 0) {
      questionValues.push(id);
      await client.query(
        `UPDATE chuyen_sau_cauhoi SET ${questionClauses.join(', ')} WHERE id = $${questionValues.length}`,
        questionValues
      );
    }

    if (mappingClauses.length > 0) {
      mappingValues.push(id);
      await client.query(
        `UPDATE chuyen_sau_bode_cauhoi SET ${mappingClauses.join(', ')} WHERE id_cau = $${mappingValues.length}`,
        mappingValues
      );
    }

    const result = await client.query(`SELECT id FROM chuyen_sau_cauhoi WHERE id = $1`, [id]);
    await client.query('COMMIT');

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Exam set question not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result.rows[0], message: 'Exam set question updated successfully' });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    console.error('Error updating exam set question:', error);
    return NextResponse.json({ error: 'Failed to update exam set question' }, { status: 500 });
  } finally {
    client?.release();
  }
}

// ─── DELETE: Xóa câu hỏi và mapping ─────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  let client: any = null;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Question id is required' }, { status: 400 });
    }

    client = await pool.connect();
    await client.query('BEGIN');

    // Lấy nội dung câu hỏi trước để cleanup ảnh S3
    const existing = await client.query(
      'SELECT noi_dung_cau_hoi, image_url FROM chuyen_sau_cauhoi WHERE id = $1',
      [id]
    );

    // Xóa mapping trước (id_cau là FK)
    await client.query('DELETE FROM chuyen_sau_bode_cauhoi WHERE id_cau = $1', [id]);

    const result = await client.query(
      `DELETE FROM chuyen_sau_cauhoi cq
       WHERE cq.id = $1
         AND NOT EXISTS (
           SELECT 1 FROM chuyen_sau_bode_cauhoi bc WHERE bc.id_cau = cq.id
         )
       RETURNING *`,
      [id]
    );

    await client.query('COMMIT');

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Exam set question not found' }, { status: 404 });
    }

    // Xóa ảnh S3 nhúng trong nội dung câu hỏi
    if (existing.rows[0]?.noi_dung_cau_hoi) {
      const urls = extractImageUrls(existing.rows[0].noi_dung_cau_hoi);
      urls.forEach(url => deleteImageSilently(url));
    }
    if (existing.rows[0]?.image_url) {
      deleteImageSilently(existing.rows[0].image_url);
    }

    return NextResponse.json({ success: true, message: 'Exam set question deleted successfully' });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    console.error('Error deleting exam set question:', error);
    return NextResponse.json({ error: 'Failed to delete exam set question' }, { status: 500 });
  } finally {
    client?.release();
  }
}
