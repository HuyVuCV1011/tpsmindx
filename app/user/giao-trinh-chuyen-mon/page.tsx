"use client";

import { PageContainer } from "@/components/PageContainer";
import { Card } from "@/components/ui/card";
import {
  TeachingDocumentLibrary,
  type TeachingDocument,
} from "@/components/teaching-documents/TeachingDocumentLibrary";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

const PROFESSIONAL_SUBJECTS = ["Coding", "Robotic", "Art", "E-Book", "Trải nghiệm"] as const;

function normalizeSubject(subject: string) {
  if (subject === "Robotics") return "Robotic";
  if (subject === "Digital Art" || subject === "Game Design" || subject === "Khoa học máy tính") return "Coding";
  return subject;
}

function normalizeStatus(document: TeachingDocument) {
  return document.document_status || "published";
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {
      success: false,
      error: text.startsWith("Internal Server Error")
        ? "Máy chủ đang lỗi nội bộ. Vui lòng thử lại sau khi server ổn định."
        : text,
    };
  }
}

// Helper function để tìm giáo trình phù hợp
function findMatchingDocument(
  documents: TeachingDocument[],
  courseName: string,
  sessionNumber: number
): TeachingDocument | null {
  console.log('[findMatchingDocument] Tìm kiếm:', { courseName, sessionNumber });
  
  // Parse course name để lấy thông tin
  // Ví dụ: "1:1 C4K-SA" -> SA = Scratch Advance
  // "Scratch Advance" -> Scratch + Advance
  const normalizedCourse = courseName.toLowerCase();
  
  // Detect course type và level từ tên
  let courseType = '';
  let courseLevel = '';
  
  // Pattern 1: "C4K-SA", "C4K-SB", "C4K-SI"
  if (normalizedCourse.includes('sa')) {
    courseType = 'scratch';
    courseLevel = 'advance';
  } else if (normalizedCourse.includes('sb')) {
    courseType = 'scratch';
    courseLevel = 'basic';
  } else if (normalizedCourse.includes('si')) {
    courseType = 'scratch';
    courseLevel = 'intensive';
  }
  // Pattern 2: "Scratch Advance", "Scratch Basic"
  else if (normalizedCourse.includes('scratch')) {
    courseType = 'scratch';
    if (normalizedCourse.includes('advance')) courseLevel = 'advance';
    else if (normalizedCourse.includes('basic')) courseLevel = 'basic';
    else if (normalizedCourse.includes('intensive')) courseLevel = 'intensive';
  }
  // Pattern 3: "Python Advance", "Python Basic"
  else if (normalizedCourse.includes('python')) {
    courseType = 'python';
    if (normalizedCourse.includes('advance')) courseLevel = 'advance';
    else if (normalizedCourse.includes('basic')) courseLevel = 'basic';
    else if (normalizedCourse.includes('intensive')) courseLevel = 'intensive';
  }
  
  console.log('[findMatchingDocument] Parsed:', { courseType, courseLevel });
  
  // Tìm tài liệu khớp
  const matches = documents.filter(doc => {
    const docCourse = doc.course_name?.toLowerCase() || '';
    const docLevel = doc.document_level?.toLowerCase() || '';
    const docLesson = doc.lesson_number?.toLowerCase() || '';
    
    // Check course type (Scratch, Python, etc.)
    const courseMatch = courseType ? docCourse.includes(courseType) : false;
    
    // Check level (Basic, Advance, Intensive)
    const levelMatch = courseLevel ? docLevel.includes(courseLevel) : true;
    
    // Check lesson number (e.g., "Buổi 4", "Lesson 4", "4")
    const lessonMatch = docLesson.includes(`${sessionNumber}`) ||
                       docLesson.includes(`buổi ${sessionNumber}`) ||
                       docLesson.includes(`lesson ${sessionNumber}`) ||
                       docLesson === `${sessionNumber}`;
    
    const isMatch = courseMatch && levelMatch && lessonMatch;
    
    if (isMatch) {
      console.log('[findMatchingDocument] Found match:', {
        id: doc.id,
        title: doc.title,
        course_name: doc.course_name,
        document_level: doc.document_level,
        lesson_number: doc.lesson_number,
      });
    }
    
    return isMatch;
  });
  
  if (matches.length === 0) {
    console.log('[findMatchingDocument] No matches found. Available documents:');
    documents.slice(0, 5).forEach(doc => {
      console.log('  -', {
        id: doc.id,
        title: doc.title,
        course_name: doc.course_name,
        document_level: doc.document_level,
        lesson_number: doc.lesson_number,
      });
    });
  }
  
  return matches[0] || null;
}

export default function UserGiaoTrinhChuyenMonPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [documents, setDocuments] = useState<TeachingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [searchingDocument, setSearchingDocument] = useState(false);

  // Get query params for AI analysis
  const shouldAnalyze = searchParams.get('analyze') === 'true';
  const courseName = searchParams.get('course') || '';
  const sessionParam = searchParams.get('session') || '';
  const classId = searchParams.get('class') || '';
  const className = searchParams.get('className') || '';
  const sessionNumber = parseInt(sessionParam.replace('buoi', '')) || 0;

  useEffect(() => {
    let mounted = true;

    async function loadDocuments() {
      setLoading(true);
      try {
        const response = await fetch("/api/teaching-documents", { cache: "no-store" });
        const data = await readJsonResponse(response);
        if (!response.ok || !data.success) throw new Error(data.error || "Không thể tải giáo trình");
        if (mounted) setDocuments(data.documents || []);
      } catch (error: any) {
        if (mounted) setMessage(error?.message || "Không thể tải giáo trình");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadDocuments();

    return () => {
      mounted = false;
    };
  }, []);

  // Auto-find and open document when analyze flag is set
  useEffect(() => {
    if (!shouldAnalyze || !courseName || !sessionNumber || documents.length === 0) return;
    
    setSearchingDocument(true);
    
    // Tìm giáo trình phù hợp
    const matchedDoc = findMatchingDocument(documents, courseName, sessionNumber);
    
    if (matchedDoc) {
      // Chuyển đến trang xem giáo trình với flag analyze
      const params = new URLSearchParams({
        analyze: 'true',
        session: sessionParam,
        class: classId,
        className: className,
      });
      router.push(`/user/giao-trinh/${matchedDoc.id}?${params.toString()}`);
    } else {
      setMessage(`Không tìm thấy giáo trình cho ${courseName} - Buổi ${sessionNumber}`);
      setSearchingDocument(false);
    }
  }, [shouldAnalyze, courseName, sessionNumber, documents, router, sessionParam, classId, className]);

  // Chỉ hiển thị tài liệu đã published
  const visibleDocuments = useMemo(
    () => {
      const filtered = documents.filter((document) => {
        const subject = normalizeSubject(document.subject_name);
        const status = normalizeStatus(document);
        const isProfessionalSubject = PROFESSIONAL_SUBJECTS.includes(subject as (typeof PROFESSIONAL_SUBJECTS)[number]);
        const isPublished = status === "published";
        
        // Debug logging
        if (document.title.includes("Tư duy máy tính")) {
          console.log("Debug document:", {
            title: document.title,
            subject_name: document.subject_name,
            normalized_subject: subject,
            document_status: document.document_status,
            normalized_status: status,
            isProfessionalSubject,
            isPublished,
            willShow: isProfessionalSubject && isPublished
          });
        }
        
        return isProfessionalSubject && isPublished;
      });
      
      console.log("Total documents:", documents.length);
      console.log("Visible documents:", filtered.length);
      
      return filtered;
    },
    [documents],
  );

  // Show searching state when auto-finding document
  if (searchingDocument) {
    return (
      <PageContainer
        title="Đang tìm giáo trình..."
        description="AI đang tìm giáo trình phù hợp để phân tích"
      >
        <Card className="p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <Loader2 className="w-12 h-12 text-purple-600 animate-spin mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Đang tìm giáo trình...</h3>
            <p className="text-sm text-gray-600 max-w-md">
              Đang tìm giáo trình cho <strong>{courseName}</strong> - <strong>Buổi {sessionNumber}</strong>
            </p>
            <div className="mt-4 flex items-center gap-2 text-xs text-purple-600">
              <Sparkles className="w-4 h-4" />
              <span>AI sẽ phân tích ngay khi tìm thấy giáo trình</span>
            </div>
          </div>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Giáo trình chuyên môn"
      description="Xem giáo trình chuyên môn và trải nghiệm dành cho giáo viên"
    >
      {message && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">{message}</p>
      )}
      <Card className="rounded-lg border border-slate-200 p-0">
        <TeachingDocumentLibrary 
          documents={visibleDocuments} 
          loading={loading} 
          subjects={PROFESSIONAL_SUBJECTS}
          viewerBasePath="/user/giao-trinh"
          emptyText="Chưa có tài liệu."
        />
      </Card>
    </PageContainer>
  );
}
