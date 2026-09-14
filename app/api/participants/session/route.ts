import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/server/api-error";
import { requireParticipantSession } from "@/lib/server/participant-session";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { game, participant } = await requireParticipantSession({
      gameSlug: body.gameSlug,
      participantId: body.participantId,
      sessionToken: body.sessionToken,
    });
    const supabase = createAdminClient();

    await supabase
      .from("participants")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", participant.id);

    const { data: state, error: stateError } = await supabase
      .from("game_state")
      .select("*")
      .eq("game_id", game.id)
      .single();

    if (stateError) throw stateError;

    let answer = null;
    if (state.current_question_id) {
      const { data, error } = await supabase
        .from("answers")
        .select("id, answer, submitted_at, grading_status, is_finalized")
        .eq("question_id", state.current_question_id)
        .eq("participant_id", participant.id)
        .maybeSingle();
      if (error) throw error;
      answer = data;
    }

    return NextResponse.json({ game, participant, state, answer });
  } catch (error) {
    return errorResponse(error);
  }
}
