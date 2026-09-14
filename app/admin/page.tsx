import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { AppBrand } from "@/components/app-brand";
import { SetupRequired } from "@/components/game/setup-required";
import { getGameSlug, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "진행자 콘솔",
};

function AdminMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="admin-login-shell">
      <section className="admin-login-card"><AppBrand /><div>{children}</div></section>
    </main>
  );
}

export default async function AdminPage() {
  if (!isSupabaseConfigured()) {
    return <AdminMessage><SetupRequired /></AdminMessage>;
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (!userId) redirect("/admin/login");

  const gameSlug = getGameSlug();
  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id, slug, title")
    .eq("slug", gameSlug)
    .maybeSingle();

  if (gameError || !game) {
    return <AdminMessage><h1>행사를 찾을 수 없습니다.</h1><p>게임 slug와 마이그레이션 적용 상태를 확인해주세요.</p></AdminMessage>;
  }

  const { data: membership } = await supabase
    .from("game_admins")
    .select("game_id")
    .eq("game_id", game.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return <AdminMessage><h1>관리자 권한이 없습니다.</h1><p>이 계정을 game_admins에 등록해주세요.</p></AdminMessage>;
  }

  const { data: state, error: stateError } = await supabase
    .from("game_state")
    .select("*")
    .eq("game_id", game.id)
    .single();
  if (stateError) throw stateError;

  const questionsResult = await supabase
    .from("questions")
    .select("*")
    .eq("game_id", game.id)
    .order("question_order");
  if (questionsResult.error) throw questionsResult.error;

  const questionIds = questionsResult.data.map((question) => question.id);
  const answerKeysQuery = questionIds.length > 0
    ? supabase
        .from("question_answer_keys")
        .select("question_id, correct_answers, grading_note")
        .in("question_id", questionIds)
    : Promise.resolve({ data: [], error: null });
  const [answerKeysResult, participantsResult, answersResult] = await Promise.all([
    answerKeysQuery,
    supabase.from("participants").select("id, name, status, joined_at").eq("game_id", game.id).order("joined_at"),
    state.current_question_id
      ? supabase
          .from("answers")
          .select("id, participant_id, question_id, answer, submitted_at, grading_status, grading_note, is_finalized, finalized_at")
          .eq("question_id", state.current_question_id)
          .order("submitted_at")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (answerKeysResult.error) throw answerKeysResult.error;
  if (participantsResult.error) throw participantsResult.error;
  if (answersResult.error) throw answersResult.error;

  return (
    <AdminDashboard
      game={game}
      answerKeys={answerKeysResult.data ?? []}
      initialAnswers={answersResult.data ?? []}
      initialParticipants={participantsResult.data ?? []}
      initialState={state}
      questions={questionsResult.data ?? []}
    />
  );
}
