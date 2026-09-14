import { NextResponse, type NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/server/api-error";
import { validateUuid } from "@/lib/server/participant-session";
import { createClient } from "@/lib/supabase/server";

const allowedActions = new Set([
  "select_question",
  "publish_question",
  "start_timer",
  "close_submissions",
  "reveal_answer",
  "next_question",
  "finish_game",
  "undo",
]);

function mapAdminError(error: { message?: string }) {
  const code = error.message ?? "ACTION_FAILED";
  const messages: Record<string, string> = {
    ADMIN_REQUIRED: "이 행사에 대한 관리자 권한이 없습니다.",
    ANSWER_KEY_NOT_FOUND: "선택한 문제의 정답이 등록되지 않았습니다.",
    ANSWER_NOT_REVEALED: "판정 확정과 정답 공개를 먼저 완료해주세요.",
    GRADING_NOT_FINALIZED: "판정 확정을 먼저 완료해주세요.",
    NOTHING_TO_UNDO: "취소할 작업이 없습니다.",
    QUESTION_NOT_ACTIVE: "현재 진행 중인 문제가 없습니다.",
    QUESTION_NOT_CLOSED: "답변을 먼저 마감해주세요.",
    QUESTION_NOT_FOUND: "선택한 문제를 찾을 수 없습니다.",
    QUESTION_NOT_PUBLISHED: "문제를 먼저 공개해주세요.",
    QUESTION_NOT_SELECTED: "문제를 먼저 선택해주세요.",
    TIMER_ALREADY_STARTED: "타이머가 이미 시작되었습니다.",
    USE_GRADING_UNDO: "채점 중에는 판정 확정 취소 버튼을 사용해주세요.",
  };
  return messages[code] ? new ApiError(409, code, messages[code]) : error;
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      throw new ApiError(403, "INVALID_ORIGIN", "허용되지 않은 요청입니다.");
    }

    const body = await request.json() as Record<string, unknown>;
    const gameId = validateUuid(body.gameId, "INVALID_GAME");
    const action = typeof body.action === "string" ? body.action : "";
    if (!allowedActions.has(action)) {
      throw new ApiError(400, "INVALID_ACTION", "지원하지 않는 진행 작업입니다.");
    }
    const questionId = body.questionId == null
      ? null
      : validateUuid(body.questionId, "INVALID_QUESTION");

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims) {
      throw new ApiError(401, "AUTH_REQUIRED", "관리자 로그인이 필요합니다.");
    }

    const { data, error } = await supabase.rpc("admin_control_game", {
      p_action: action,
      p_game_id: gameId,
      p_question_id: questionId,
    });
    if (error) throw mapAdminError(error);

    return NextResponse.json({ state: data });
  } catch (error) {
    return errorResponse(error);
  }
}
