import { NextResponse } from "next/server";
import type { Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, errorResponse } from "@/lib/server/api-error";
import {
  hashSessionToken,
  validateGameSlug,
  validateSessionToken,
  validateUuid,
} from "@/lib/server/participant-session";

function validateAnswer(value: unknown): string | number {
  if (typeof value === "string") {
    const answer = value.trim();
    if (answer.length < 1 || answer.length > 500) {
      throw new ApiError(400, "INVALID_ANSWER", "답안을 1~500자로 입력해주세요.");
    }
    return answer;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4) {
    return value;
  }

  throw new ApiError(400, "INVALID_ANSWER", "답안 형식이 올바르지 않습니다.");
}

function mapSubmissionError(error: { message?: string }) {
  const code = error.message ?? "SUBMISSION_FAILED";
  const mapping: Record<string, [number, string]> = {
    ANSWER_CLOSED: [409, "답변이 마감되었습니다."],
    GAME_NOT_FOUND: [404, "행사를 찾을 수 없습니다."],
    INVALID_ANSWER: [400, "답안 형식이 올바르지 않습니다."],
    INVALID_PARTICIPANT: [401, "참가자 정보를 확인할 수 없습니다."],
    NOT_ACTIVE: [409, "현재 답안을 제출할 수 없는 상태입니다."],
    QUESTION_MISMATCH: [409, "현재 진행 중인 문제가 아닙니다."],
  };
  const match = mapping[code];
  if (!match) return error;
  return new ApiError(match[0], code, match[1]);
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const gameSlug = validateGameSlug(body.gameSlug);
    const participantId = validateUuid(body.participantId);
    const questionId = validateUuid(body.questionId, "INVALID_QUESTION");
    const sessionToken = validateSessionToken(body.sessionToken);
    const answer = validateAnswer(body.answer);
    const supabase = createAdminClient();

    const { data, error } = await supabase.rpc("submit_answer", {
      p_answer: answer as Json,
      p_game_slug: gameSlug,
      p_participant_id: participantId,
      p_question_id: questionId,
      p_session_token_hash: hashSessionToken(sessionToken),
    });

    if (error) throw mapSubmissionError(error);

    return NextResponse.json(data);
  } catch (error) {
    return errorResponse(error);
  }
}
