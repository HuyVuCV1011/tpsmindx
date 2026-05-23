'use client'

import { PageContainer } from '@/components/PageContainer'
import { SecureDocViewer } from '@/components/secure-viewer/SecureDocViewer'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuth } from '@/lib/auth-context'
import { ArrowLeft, ChevronRight, ShieldCheck, Sparkles, Loader2, X } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

type DocumentMetadata = {
  id: number
  title: string
  description: string | null
  fileName: string
  fileType: string
  fileSize: number
  kind: 'docx' | 'pptx' | 'pdf' | 'image' | 'file'
  subjectName: string
  courseName: string | null
  documentLevel: string
  lessonNumber: string
}

type Highlight = {
  text: string
  issue: string
  suggestion: string
  priority: 'high' | 'medium' | 'low'
  type: 'add' | 'remove' | 'modify' | 'clarify'
}

type AIAnalysis = {
  teachingSpeed: {
    current: string
    recommendation: string
    reason: string
  }
  content: {
    covered: string[]
    toBeCovered: string[]
    adjustments: string[]
  }
  requiredKnowledge: string[]
  alternativeActivities: Array<{
    activity: string
    duration: string
    objective: string
  }>
  situationHandling: Array<{
    situation: string
    solution: string
  }>
  contingencyPlans: Array<{
    scenario: string
    plan: string
  }>
  highlights?: Highlight[]
}

async function readJsonResponse(response: Response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {
      success: false,
      error: text.startsWith('Internal Server Error')
        ? 'Máy chủ đang lỗi nội bộ. Vui lòng thử lại sau khi server ổn định.'
        : text,
    }
  }
}

function normalizeSubject(subject: string) {
  if (subject === 'Robotics') return 'Robotic'
  if (subject === 'Digital Art' || subject === 'Game Design' || subject === 'Khoa học máy tính') return 'Coding'
  return subject
}

function parentRouteForSubject(subject: string) {
  if (subject === 'Trải nghiệm') return '/user/giao-trinh-trai-nghiem'
  return '/user/giao-trinh-chuyen-mon'
}

export default function UserGiaoTrinhDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const documentId = Number(params.id)
  const validDocumentId = Number.isInteger(documentId) && documentId > 0 ? documentId : null
  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null)
  const [message, setMessage] = useState('')
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null)
  const [analysisError, setAnalysisError] = useState('')
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [selectedHighlight, setSelectedHighlight] = useState<number | null>(null)

  // Get query params for AI analysis
  const shouldAnalyze = searchParams.get('analyze') === 'true'
  const sessionParam = searchParams.get('session') || ''
  const classId = searchParams.get('class') || ''
  const className = searchParams.get('className') || ''
  const sessionNumber = parseInt(sessionParam.replace('buoi', '')) || 0

  useEffect(() => {
    if (!validDocumentId) return
    let mounted = true

    async function loadMetadata() {
      try {
        const response = await fetch(`/api/documents/stream/${validDocumentId}?action=metadata`, {
          cache: 'no-store',
        })
        const data = await readJsonResponse(response)
        if (!response.ok || !data.success) throw new Error(data.error || 'Không thể tải thông tin giáo trình')
        if (mounted) {
          setMetadata(data.document)
          setMessage('')
        }
      } catch (error: any) {
        if (mounted) setMessage(error?.message || 'Không thể tải thông tin giáo trình')
      }
    }

    void loadMetadata()

    return () => {
      mounted = false
    }
  }, [validDocumentId])

  // Auto-trigger AI analysis if analyze flag is set
  useEffect(() => {
    console.log('[AI Analysis] Check conditions:', {
      shouldAnalyze,
      classId,
      sessionNumber,
      hasMetadata: !!metadata,
      metadata: metadata ? {
        courseName: metadata.courseName,
        title: metadata.title,
      } : null,
    });

    if (!shouldAnalyze || !classId || !sessionNumber || !metadata) {
      console.log('[AI Analysis] Skipping - conditions not met');
      return;
    }
    
    console.log('[AI Analysis] Starting analysis...');
    setShowAnalysis(true)
    setLoadingAnalysis(true)
    setAnalysisError('')

    async function runAnalysis() {
      try {
        console.log('[AI Analysis] Calling API with:', {
          classId,
          className,
          courseName: metadata?.courseName || '',
          sessionNumber,
        });

        const response = await fetch('/api/ai/teaching-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classId,
            className,
            courseName: metadata?.courseName || '',
            sessionNumber,
          }),
        })

        console.log('[AI Analysis] API response status:', response.status);
        const data = await readJsonResponse(response)
        console.log('[AI Analysis] API response data:', data);

        if (!response.ok || !data.success) {
          setAnalysis(null)
          setAnalysisError(data.error || 'Không thể phân tích giáo trình')
          return
        }

        console.log('[AI Analysis] Analysis completed successfully');
        setAnalysis(data.analysis)
        setAnalysisError('')
      } catch (err: any) {
        console.warn('[AI Analysis] Request failed:', err?.message || err);
        setAnalysis(null)
        setAnalysisError(err?.message || 'Đã xảy ra lỗi khi phân tích')
      } finally {
        setLoadingAnalysis(false)
      }
    }

    runAnalysis()
  }, [shouldAnalyze, classId, sessionNumber, className, metadata])

  const breadcrumb = useMemo(() => {
    if (!metadata) return null

    const subject = normalizeSubject(metadata.subjectName)
    const course = metadata.courseName || 'Chưa phân môn'
    const levelLabel = `${course} ${metadata.documentLevel}`
    const baseRoute = parentRouteForSubject(subject)
    const subjectHref = `${baseRoute}?subject=${encodeURIComponent(subject)}`
    const courseHref = `${subjectHref}&course=${encodeURIComponent(course)}`
    const levelHref = `${courseHref}&level=${encodeURIComponent(metadata.documentLevel)}`

    return (
      <nav className="flex flex-wrap items-center gap-1 text-sm font-semibold text-slate-600" aria-label="Đường dẫn giáo trình">
        <Link href={subjectHref} className="rounded-sm hover:text-rose-700 hover:underline">
          {subject}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
        <Link href={courseHref} className="rounded-sm hover:text-rose-700 hover:underline">
          {course}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
        <Link href={levelHref} className="rounded-sm hover:text-rose-700 hover:underline">
          {levelLabel}
        </Link>
      </nav>
    )
  }, [metadata])

  return (
    <PageContainer
      title={metadata?.title || 'Đang tải giáo trình...'}
      description={breadcrumb || message || 'Đang tải đường dẫn giáo trình...'}
      maxWidth="full"
      headerActions={
        <div className="flex items-center gap-2">
          {shouldAnalyze && (
            <Button
              type="button"
              variant={showAnalysis ? "secondary" : "default"}
              onClick={() => setShowAnalysis(!showAnalysis)}
              className={showAnalysis ? "" : "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"}
            >
              {showAnalysis ? (
                <>
                  <X className="h-4 w-4" />
                  Ẩn phân tích
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Hiện phân tích AI
                </>
              )}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
            Quay lại
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main content - Document viewer */}
        <div className={showAnalysis ? "lg:col-span-2" : "lg:col-span-3"}>
          <Card className="rounded-lg border border-slate-200 p-3">
            <div className="mb-3 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
              <ShieldCheck className="h-4 w-4 text-rose-700" />
              Tài liệu chỉ được xem qua phiên đăng nhập hiện tại, có watermark và token xem tạm thời.
            </div>
            <SecureDocViewer
              documentId={validDocumentId}
              viewerEmail={user?.email}
              className="min-h-[calc(100vh-220px)]"
            />
          </Card>
        </div>

        {/* Sidebar - AI Analysis */}
        {showAnalysis && (
          <div className="lg:col-span-1">
            <Card className="rounded-lg border border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50 p-4 sticky top-4">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-purple-600" />
                <h3 className="font-bold text-gray-900">Phân tích AI</h3>
              </div>

              {loadingAnalysis ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-purple-600 animate-spin mb-3" />
                  <p className="text-sm text-gray-600 text-center">Đang phân tích giáo trình...</p>
                  <p className="text-xs text-gray-500 text-center mt-2">
                    Lớp: {className}<br/>
                    Buổi: {sessionNumber}
                  </p>
                </div>
              ) : analysisError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <p className="font-semibold">Không thể phân tích AI</p>
                  <p className="mt-1 text-xs leading-5">{analysisError}</p>
                  <p className="mt-2 text-xs leading-5 text-red-700">
                    Nếu lỗi liên quan quota OpenAI, hãy kiểm tra Billing, Usage Limits và API key trong OpenAI Platform.
                  </p>
                </div>
              ) : analysis ? (
                <div className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto pr-2">
                  {/* Tốc độ giảng dạy */}
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <h4 className="text-sm font-bold text-purple-900 mb-2">⚡ Tốc độ giảng dạy</h4>
                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="font-semibold text-gray-700">Đề xuất:</span>
                        <p className="text-gray-600 mt-0.5">{analysis.teachingSpeed.recommendation}</p>
                      </div>
                    </div>
                  </div>

                  {/* Nội dung điều chỉnh */}
                  {analysis.content.adjustments.length > 0 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                      <h4 className="text-sm font-bold text-yellow-900 mb-2">⚠ Điều chỉnh</h4>
                      <ul className="space-y-1 text-xs">
                        {analysis.content.adjustments.map((adj, idx) => (
                          <li key={idx} className="text-yellow-800 flex items-start gap-1">
                            <span className="mt-0.5">•</span>
                            <span>{adj}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Kiến thức cần thiết */}
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <h4 className="text-sm font-bold text-green-900 mb-2">🎯 Kiến thức cần thiết</h4>
                    <ul className="space-y-1 text-xs">
                      {analysis.requiredKnowledge.slice(0, 3).map((item, idx) => (
                        <li key={idx} className="text-gray-600 flex items-start gap-1">
                          <span className="text-green-600 font-bold">{idx + 1}.</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Hoạt động thay thế */}
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <h4 className="text-sm font-bold text-orange-900 mb-2">🎮 Hoạt động thay thế</h4>
                    <div className="space-y-2">
                      {analysis.alternativeActivities.slice(0, 2).map((activity, idx) => (
                        <div key={idx} className="text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-gray-700">{activity.activity}</span>
                            <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                              {activity.duration}
                            </span>
                          </div>
                          <p className="text-gray-600 mt-0.5 text-[11px]">{activity.objective}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Xử lý tình huống */}
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <h4 className="text-sm font-bold text-red-900 mb-2">🚨 Xử lý tình huống</h4>
                    <div className="space-y-2">
                      {analysis.situationHandling.slice(0, 2).map((item, idx) => (
                        <div key={idx} className="text-xs">
                          <p className="font-semibold text-red-800">{item.situation}</p>
                          <p className="text-red-700 mt-0.5 text-[11px]">{item.solution}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Highlights - Gợi ý chỉnh sửa */}
                  {analysis.highlights && analysis.highlights.length > 0 && (
                    <div className="bg-white rounded-lg p-3 shadow-sm border-2 border-purple-300">
                      <h4 className="text-sm font-bold text-purple-900 mb-2">✏️ Gợi ý chỉnh sửa</h4>
                      <div className="space-y-2">
                        {analysis.highlights.map((highlight, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedHighlight(idx === selectedHighlight ? null : idx)}
                            className={`w-full text-left p-2 rounded-md border transition-all ${
                              idx === selectedHighlight
                                ? 'border-purple-500 bg-purple-50'
                                : 'border-gray-200 bg-gray-50 hover:border-purple-300'
                            } ${
                              highlight.priority === 'high'
                                ? 'border-l-4 border-l-red-500'
                                : highlight.priority === 'medium'
                                ? 'border-l-4 border-l-yellow-500'
                                : 'border-l-4 border-l-blue-500'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-bold text-gray-900 truncate">
                                    {highlight.text}
                                  </span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                    highlight.type === 'add' ? 'bg-green-100 text-green-700' :
                                    highlight.type === 'remove' ? 'bg-red-100 text-red-700' :
                                    highlight.type === 'modify' ? 'bg-blue-100 text-blue-700' :
                                    'bg-gray-100 text-gray-700'
                                  }`}>
                                    {highlight.type === 'add' ? 'Thêm' :
                                     highlight.type === 'remove' ? 'Xóa' :
                                     highlight.type === 'modify' ? 'Sửa' : 'Làm rõ'}
                                  </span>
                                </div>
                                <p className="text-[11px] text-gray-600 mb-1">{highlight.issue}</p>
                                {idx === selectedHighlight && (
                                  <div className="mt-2 pt-2 border-t border-purple-200">
                                    <p className="text-xs font-semibold text-purple-900 mb-1">💡 Gợi ý:</p>
                                    <p className="text-[11px] text-purple-800">{highlight.suggestion}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Button xem đầy đủ */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const params = new URLSearchParams({
                        course: metadata?.courseName || '',
                        session: sessionParam,
                        class: classId,
                        className: className,
                      });
                      router.push(`/user/phan-tich-giao-trinh?${params.toString()}`);
                    }}
                  >
                    Xem phân tích đầy đủ
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-gray-600 text-center py-8">
                  Chưa có phân tích
                </p>
              )}
            </Card>
          </div>
        )}
      </div>
    </PageContainer>
  )
}
