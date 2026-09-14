import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, errorResponse } from "@/lib/server/api-error";
import {
  getGameBySlug,
  hashSessionToken,
  normalizeParticipantName,
  validateGameSlug,
  validateSessionToken,
} from "@/lib/server/participant-session";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const gameSlug = validateGameSlug(body.gameSlug);
    const name = normalizeParticipantName(body.name);
    const sessionToken = validateSessionToken(body.sessionToken);
    const tokenHash = hashSessionToken(sessionToken);
    const game = await getGameBySlug(gameSlug);
    const supabase = createAdminClient();

    const { data: existing, error: existingError } = await supabase
      .from("participants")
      .select("id, game_id, name, status, joined_at, last_seen_at, updated_at")
      .eq("session_token_hash", tokenHash)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      if (existing.game_id !== game.id) {
        throw new ApiError(409, "SESSION_CONFLICT", "참가자 세션이 다른 행사에 등록되어 있습니다.");
      }

      await supabase
        .from("participants")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", existing.id);

      return NextResponse.json({ game, participant: existing, recovered: true });
    }

    if (!game.join_open) {
      throw new ApiError(409, "JOIN_CLOSED", "현재 참가 접수가 마감되었습니다.");
    }

    const { data: participant, error: insertError } = await supabase
      .from("participants")
      .insert({
        game_id: game.id,
        name,
        session_token_hash: tokenHash,
      })
      .select("id, game_id, name, status, joined_at, last_seen_at, updated_at")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: retriedParticipant, error: retryError } = await supabase
          .from("participants")
          .select("id, game_id, name, status, joined_at, last_seen_at, updated_at")
          .eq("session_token_hash", tokenHash)
          .eq("game_id", game.id)
          .maybeSingle();
        if (retryError) throw retryError;
        if (retriedParticipant) {
          return NextResponse.json({ game, participant: retriedParticipant, recovered: true });
        }
        throw new ApiError(409, "JOIN_RETRY", "참가 요청이 처리 중입니다. 다시 시도해주세요.");
      }
      throw insertError;
    }

    return NextResponse.json({ game, participant, recovered: false }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
