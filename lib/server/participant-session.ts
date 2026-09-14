import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "./api-error";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function normalizeParticipantName(value: unknown) {
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_NAME", "이름을 입력해주세요.");
  }

  const name = value.trim().replace(/\s+/gu, " ");
  if (name.length < 1 || name.length > 40) {
    throw new ApiError(400, "INVALID_NAME", "이름은 1~40자로 입력해주세요.");
  }

  return name;
}

export function validateGameSlug(value: unknown) {
  if (typeof value !== "string" || !slugPattern.test(value)) {
    throw new ApiError(400, "INVALID_GAME", "행사 정보가 올바르지 않습니다.");
  }
  return value;
}

export function validateSessionToken(value: unknown) {
  if (typeof value !== "string" || !tokenPattern.test(value)) {
    throw new ApiError(401, "INVALID_SESSION", "참가자 세션이 올바르지 않습니다.");
  }
  return value;
}

export function validateUuid(value: unknown, code = "INVALID_SESSION") {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new ApiError(400, code, "요청 정보가 올바르지 않습니다.");
  }
  return value;
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function getGameBySlug(gameSlug: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("games")
    .select("id, slug, title, join_open, is_public")
    .eq("slug", gameSlug)
    .maybeSingle();

  if (error) throw error;
  if (!data || !data.is_public) {
    throw new ApiError(404, "GAME_NOT_FOUND", "참가 가능한 행사를 찾을 수 없습니다.");
  }

  return data;
}

export async function requireParticipantSession(input: {
  gameSlug: unknown;
  participantId: unknown;
  sessionToken: unknown;
}) {
  const gameSlug = validateGameSlug(input.gameSlug);
  const participantId = validateUuid(input.participantId);
  const sessionToken = validateSessionToken(input.sessionToken);
  const game = await getGameBySlug(gameSlug);
  const supabase = createAdminClient();

  const { data: participant, error } = await supabase
    .from("participants")
    .select("id, game_id, name, status, joined_at, last_seen_at, updated_at")
    .eq("id", participantId)
    .eq("game_id", game.id)
    .eq("session_token_hash", hashSessionToken(sessionToken))
    .maybeSingle();

  if (error) throw error;
  if (!participant) {
    throw new ApiError(401, "SESSION_NOT_FOUND", "참가자 정보를 복구할 수 없습니다.");
  }

  return { game, participant, sessionToken };
}
