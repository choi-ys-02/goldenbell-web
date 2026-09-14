import { NextResponse, type NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/server/api-error";
import { validateUuid } from "@/lib/server/participant-session";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type GradingStatus = Database["public"]["Enums"]["grading_status"];

const allowedActions = new Set([
  "auto_grade",
  "set_grade",
  "finalize",
  "undo_finalize",
]);

const allowedStatuses = new Set<GradingStatus>([
  "correct",
  "incorrect",
  "pending",
]);

function mapGradingError(error: { message?: string }) {
  const code = error.message ?? "GRADING_FAILED";
  const messages: Record<string, string> = {
    ADMIN_REQUIRED: "이 행사에 대한 관리자 권한이 없습니다.",
    ANSWER_ALREADY_REVEALED: "정답 공개를 먼저 Undo한 뒤 판정 확정을 취소해주세요.",
    ANSWER_KEY_NOT_FOUND: "이 문제의 정답 데이터가 없습니다.",
    ANSWER_NOT_FOUND: "답안을 찾을 수 없습니다.",
    GAME_NOT_FOUND: "행사를 찾을 수 없습니다.",
    GRADING_FINALIZED: "이미 판정이 확정되었습니다. 먼저 판정 확정을 취소해주세요.",
    GRADING_INCOMPLETE: "미채점 답안이 남아 있습니다.",
    GRADING_NOT_READY: "자동 채점을 완료한 뒤 판정을 확정해주세요.",
    INVALID_GRADE: "지원하지 않는 채점 상태입니다.",
    NOTHING_TO_UNDO: "취소할 판정 확정이 없습니다.",
    QUESTION_MISMATCH: "현재 문제와 요청한 문제가 일치하지 않습니다.",
    QUESTION_NOT_CLOSED: "답변을 먼저 마감해주세요.",
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
    const action = typeof body.action === "string" ? body.action : "";
    if (!allowedActions.has(action)) {
      throw new ApiError(400, "INVALID_ACTION", "지원하지 않는 채점 작업입니다.");
    }

    const gameId = validateUuid(body.gameId, "INVALID_GAME");
    const questionId = body.questionId == null
      ? null
      : validateUuid(body.questionId, "INVALID_QUESTION");
    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims) {
      throw new ApiError(401, "AUTH_REQUIRED", "관리자 로그인이 필요합니다.");
    }

    let result: unknown;
    if (action === "set_grade") {
      const answerId = validateUuid(body.answerId, "INVALID_ANSWER");
      const status = typeof body.status === "string" ? body.status as GradingStatus : "ungraded";
      if (!allowedStatuses.has(status)) {
        throw new ApiError(400, "INVALID_GRADE", "지원하지 않는 채점 상태입니다.");
      }
      const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
      const response = await supabase.rpc("set_answer_grade", {
        p_answer_id: answerId,
        p_game_id: gameId,
        p_note: note,
        p_status: status,
      });
      if (response.error) throw mapGradingError(response.error);
      result = response.data;
    } else {
      const functionName = action === "auto_grade"
        ? "auto_grade_question"
        : action === "finalize"
          ? "finalize_question_grades"
          : "undo_finalize_question_grades";
      const response = await supabase.rpc(functionName, {
        p_game_id: gameId,
        p_question_id: questionId,
      });
      if (response.error) throw mapGradingError(response.error);
      result = response.data;
    }

    const { data: state, error: stateError } = await supabase
      .from("game_state")
      .select("*")
      .eq("game_id", gameId)
      .single();
    if (stateError) throw stateError;

    return NextResponse.json({ result, state });
  } catch (error) {
    return errorResponse(error);
  }
}
