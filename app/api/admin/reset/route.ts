import { NextResponse, type NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/server/api-error";
import { validateUuid } from "@/lib/server/participant-session";
import { createClient } from "@/lib/supabase/server";

type ResetMode = "gameplay" | "full";

function mapResetError(error: { message?: string }) {
  const code = error.message ?? "RESET_FAILED";
  const messages: Record<string, string> = {
    ADMIN_REQUIRED: "이 행사에 대한 관리자 권한이 없습니다.",
    GAME_NOT_FOUND: "행사를 찾을 수 없습니다.",
    INVALID_RESET_MODE: "지원하지 않는 초기화 방식입니다.",
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
    const mode = body.mode === "gameplay" || body.mode === "full"
      ? body.mode as ResetMode
      : null;
    if (!mode) {
      throw new ApiError(400, "INVALID_RESET_MODE", "지원하지 않는 초기화 방식입니다.");
    }

    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    if (!claimsData?.claims) {
      throw new ApiError(401, "AUTH_REQUIRED", "관리자 로그인이 필요합니다.");
    }

    const { data, error } = await supabase.rpc("reset_game_for_testing", {
      p_game_id: gameId,
      p_mode: mode,
    });
    if (error) throw mapResetError(error);

    return NextResponse.json({ mode, state: data });
  } catch (error) {
    return errorResponse(error);
  }
}
