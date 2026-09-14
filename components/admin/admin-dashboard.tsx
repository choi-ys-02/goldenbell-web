"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { AppBrand } from "@/components/app-brand";
import { ConnectionIndicator } from "@/components/game/connection-indicator";
import type { Answer, Game, GameState, Participant, Question } from "@/lib/game/types";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";
import { getFinalStage } from "@/lib/game/final-stage";

type SafeParticipant = Pick<Participant, "id" | "joined_at" | "name" | "status">;
type SafeAnswer = Pick<Answer, "answer" | "finalized_at" | "grading_note" | "grading_status" | "id" | "is_finalized" | "participant_id" | "question_id" | "submitted_at">;
type AnswerKey = {
  correct_answers: Json;
  grading_note: string | null;
  question_id: string;
};
type GradingStatus = Database["public"]["Enums"]["grading_status"];
type ResetMode = "gameplay" | "full";

type AdminDashboardProps = {
  answerKeys: AnswerKey[];
  initialAnswers: SafeAnswer[];
  initialParticipants: SafeParticipant[];
  initialState: GameState;
  game: Pick<Game, "id" | "slug" | "title">;
  questions: Question[];
};

const phaseLabels: Record<GameState["phase"], string> = {
  answer: "정답 공개",
  closed: "답변 마감",
  finished: "행사 종료",
  judging: "채점 중",
  lobby: "행사 대기",
  question: "문제 진행",
};

const confirmMessages: Partial<Record<string, string>> = {
  close_submissions: "답변을 마감하면 참가자는 더 이상 제출할 수 없습니다. 마감할까요?",
  finish_game: "행사를 종료할까요?",
  next_question: "현재 상태를 마치고 다음 문제로 이동할까요?",
  reveal_answer: "정답을 프로젝터와 참가자 화면에 공개할까요?",
  undo: "직전 진행 작업을 취소하고 이전 상태로 되돌릴까요?",
};

const gradingLabels: Record<GradingStatus, string> = {
  correct: "정답",
  incorrect: "오답",
  pending: "판정보류",
  ungraded: "미채점",
};

const gradingConfirmMessages: Partial<Record<string, string>> = {
  finalize: "판정을 확정하면 오답자와 미제출자가 탈락 처리됩니다. 확정할까요?",
  undo_finalize: "직전 판정 확정을 취소하고 참가자 상태를 복구할까요?",
};

function formatSubmittedTime(submittedAt: string) {
  const submittedTime = new Date(submittedAt);
  if (Number.isNaN(submittedTime.getTime())) return "--:--:--";

  // 한국은 연중 UTC+9이므로 런타임 로케일에 의존하지 않고 같은 문자열을 만든다.
  const koreanTime = new Date(submittedTime.getTime() + 9 * 60 * 60 * 1000);
  return [
    koreanTime.getUTCHours(),
    koreanTime.getUTCMinutes(),
    koreanTime.getUTCSeconds(),
  ].map((unit) => String(unit).padStart(2, "0")).join(":");
}

export function AdminDashboard({
  answerKeys,
  game,
  initialAnswers,
  initialParticipants,
  initialState,
  questions,
}: AdminDashboardProps) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const stateRef = useRef(initialState);
  const [participants, setParticipants] = useState(initialParticipants);
  const [answers, setAnswers] = useState(initialAnswers);
  const [selectedQuestionId, setSelectedQuestionId] = useState(
    initialState.current_question_id ?? questions[0]?.id ?? "",
  );
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const answerRefreshTimerRef = useRef<number | null>(null);

  const currentQuestion = useMemo(
    () => questions.find((question) => question.id === state.current_question_id) ?? null,
    [questions, state.current_question_id],
  );

  const currentAnswerKey = useMemo(
    () => answerKeys.find((answerKey) => answerKey.question_id === state.current_question_id) ?? null,
    [answerKeys, state.current_question_id],
  );

  const gradingSummary = useMemo(() => ({
    correct: answers.filter((answer) => answer.grading_status === "correct").length,
    incorrect: answers.filter((answer) => answer.grading_status === "incorrect").length,
    pending: answers.filter((answer) => answer.grading_status === "pending").length,
    ungraded: answers.filter((answer) => answer.grading_status === "ungraded").length,
  }), [answers]);

  const participantNames = useMemo(
    () => new Map(participants.map((participant) => [participant.id, participant.name])),
    [participants],
  );
  const finalStage = getFinalStage(state.active_count, state.participant_count);

  const loadParticipants = useCallback(async () => {
    const supabase = createClient();
    const { data, error: queryError } = await supabase
      .from("participants")
      .select("id, name, status, joined_at")
      .eq("game_id", game.id)
      .order("joined_at");
    if (queryError) throw queryError;
    setParticipants(data as SafeParticipant[]);
  }, [game.id]);

  const loadAnswers = useCallback(async (questionId: string | null) => {
    if (!questionId) {
      setAnswers([]);
      return;
    }
    const supabase = createClient();
    const { data, error: queryError } = await supabase
      .from("answers")
      .select("id, participant_id, question_id, answer, submitted_at, grading_status, grading_note, is_finalized, finalized_at")
      .eq("question_id", questionId)
      .order("submitted_at");
    if (queryError) throw queryError;
    setAnswers(data as SafeAnswer[]);
  }, []);

  const refreshDashboard = useCallback(async () => {
    const supabase = createClient();
    const { data, error: queryError } = await supabase
      .from("game_state")
      .select("*")
      .eq("game_id", game.id)
      .single();
    if (queryError) throw queryError;

    const nextState = data as GameState;
    const previousQuestionId = stateRef.current.current_question_id;
    stateRef.current = nextState;
    setState(nextState);
    if (nextState.current_question_id !== previousQuestionId) {
      setSelectedQuestionId(nextState.current_question_id ?? "");
    }

    await Promise.all([
      loadParticipants(),
      loadAnswers(nextState.current_question_id),
    ]);
    setConnectionStatus("connected");
  }, [game.id, loadAnswers, loadParticipants]);

  const scheduleAnswerRefresh = useCallback(() => {
    if (answerRefreshTimerRef.current !== null) {
      window.clearTimeout(answerRefreshTimerRef.current);
    }
    answerRefreshTimerRef.current = window.setTimeout(() => {
      answerRefreshTimerRef.current = null;
      void loadAnswers(stateRef.current.current_question_id).catch(() => {
        setConnectionStatus("error");
      });
    }, 400);
  }, [loadAnswers]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`admin-game:${game.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "game_state", filter: `game_id=eq.${game.id}` },
        (payload) => {
          const nextState = payload.new as GameState;
          const previous = stateRef.current;
          stateRef.current = nextState;
          setState(nextState);

          if (
            nextState.participant_count !== previous.participant_count
            || nextState.active_count !== previous.active_count
          ) {
            void loadParticipants();
          }
          if (nextState.current_question_id !== previous.current_question_id) {
            setSelectedQuestionId(nextState.current_question_id ?? "");
            void loadAnswers(nextState.current_question_id);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "answers", filter: `game_id=eq.${game.id}` },
        (payload) => {
          const nextAnswer = payload.new as SafeAnswer;
          if (!nextAnswer?.id || nextAnswer.question_id !== stateRef.current.current_question_id) {
            scheduleAnswerRefresh();
            return;
          }
          setAnswers((previous) => {
            const withoutCurrent = previous.filter((answer) => answer.id !== nextAnswer.id);
            return [...withoutCurrent, nextAnswer].sort(
              (a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime(),
            );
          });
          scheduleAnswerRefresh();
        },
      )
      .subscribe((nextStatus) => {
        if (nextStatus === "SUBSCRIBED") setConnectionStatus("connected");
        if (nextStatus === "CHANNEL_ERROR" || nextStatus === "TIMED_OUT") setConnectionStatus("error");
      });

    channelRef.current = channel;
    return () => {
      if (answerRefreshTimerRef.current !== null) {
        window.clearTimeout(answerRefreshTimerRef.current);
        answerRefreshTimerRef.current = null;
      }
      if (channelRef.current) void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [game.id, loadAnswers, loadParticipants, scheduleAnswerRefresh]);

  useEffect(() => {
    const recover = () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      void refreshDashboard().catch(() => setConnectionStatus("error"));
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") recover();
    };
    const interval = window.setInterval(recover, 5_000);

    window.addEventListener("online", recover);
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", recover);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshDashboard]);

  const performAction = async (action: string, questionId?: string | null) => {
    const confirmation = confirmMessages[action];
    if (confirmation && !window.confirm(confirmation)) return;

    setBusyAction(action);
    setError(null);
    try {
      const response = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, gameId: game.id, questionId: questionId ?? null }),
      });
      const data = await response.json() as { message?: string; state?: GameState };
      if (!response.ok || !data.state) throw new Error(data.message || "진행 작업에 실패했습니다.");

      const previousQuestionId = stateRef.current.current_question_id;
      stateRef.current = data.state;
      setState(data.state);
      if (data.state.current_question_id !== previousQuestionId) {
        setSelectedQuestionId(data.state.current_question_id ?? "");
        await loadAnswers(data.state.current_question_id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "진행 작업에 실패했습니다.");
    } finally {
      setBusyAction(null);
    }
  };

  const performGrading = async (
    action: "auto_grade" | "set_grade" | "finalize" | "undo_finalize",
    options: { answerId?: string; note?: string; status?: GradingStatus } = {},
  ) => {
    const confirmation = gradingConfirmMessages[action];
    if (confirmation && !window.confirm(confirmation)) return;

    const actionKey = options.answerId ? `${action}:${options.answerId}` : action;
    setBusyAction(actionKey);
    setError(null);
    try {
      const response = await fetch("/api/admin/grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          answerId: options.answerId,
          gameId: game.id,
          note: options.note,
          questionId: state.current_question_id,
          status: options.status,
        }),
      });
      const data = await response.json() as {
        message?: string;
        result?: SafeAnswer;
        state?: GameState;
      };
      if (!response.ok || !data.state) {
        throw new Error(data.message || "채점 작업에 실패했습니다.");
      }

      stateRef.current = data.state;
      setState(data.state);
      if (action === "set_grade" && data.result?.id) {
        setAnswers((previous) => previous.map((answer) => (
          answer.id === data.result?.id ? data.result : answer
        )));
      } else {
        await Promise.all([
          loadAnswers(data.state.current_question_id),
          loadParticipants(),
        ]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "채점 작업에 실패했습니다.");
    } finally {
      setBusyAction(null);
    }
  };

  const performReset = async (mode: ResetMode) => {
    const confirmation = mode === "full"
      ? "참가자, 답안, 채점 결과와 진행 기록을 모두 삭제합니다. 모든 참가자가 다시 QR로 참가해야 합니다. 전체 초기화할까요?"
      : "참가자는 유지하고 답안, 채점 결과와 진행 기록을 삭제합니다. 첫 문제 대기 상태로 초기화할까요?";
    if (!window.confirm(confirmation)) return;

    setBusyAction(`reset:${mode}`);
    setError(null);
    try {
      const response = await fetch("/api/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId: game.id, mode }),
      });
      const data = await response.json() as { message?: string; state?: GameState };
      if (!response.ok || !data.state) {
        throw new Error(data.message || "테스트 데이터를 초기화하지 못했습니다.");
      }

      stateRef.current = data.state;
      setState(data.state);
      setSelectedQuestionId(data.state.current_question_id ?? "");
      setAnswers([]);
      await loadParticipants();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "테스트 데이터를 초기화하지 못했습니다.");
    } finally {
      setBusyAction(null);
    }
  };

  const logout = async () => {
    await createClient().auth.signOut();
    router.replace("/admin/login");
    router.refresh();
  };

  const displayAnswer = (answer: SafeAnswer) => {
    if (currentQuestion?.type === "multiple_choice" && typeof answer.answer === "number") {
      const choices = Array.isArray(currentQuestion.choices) ? currentQuestion.choices : [];
      return `${answer.answer + 1}번 · ${String(choices[answer.answer] ?? "")}`;
    }
    return String(answer.answer);
  };

  const displayAnswerKey = () => {
    if (!currentAnswerKey || !Array.isArray(currentAnswerKey.correct_answers)) return "정답 미등록";
    if (currentQuestion?.type === "multiple_choice") {
      return currentAnswerKey.correct_answers
        .map((answer) => typeof answer === "number" ? `${answer + 1}번` : String(answer))
        .join(" · ");
    }
    return currentAnswerKey.correct_answers.map(String).join(" · ");
  };

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <AppBrand compact />
        <div>
          <Link className="screen-open-link" href="/screen" rel="noopener noreferrer" target="_blank">프로젝터 열기 ↗</Link>
          <ConnectionIndicator status={connectionStatus} />
          <button className="text-button" onClick={logout} type="button">로그아웃</button>
        </div>
      </header>

      <div className="admin-content">
        <section className="admin-title-row">
          <div>
            <p className="eyebrow">GAME CONTROL</p>
            <h1>{game.title}</h1>
          </div>
          <div className="admin-status-stack">
            {finalStage && state.phase !== "lobby" && state.phase !== "finished" && (
              <span className="admin-final-stage">{finalStage}</span>
            )}
            <span className="phase-status">{phaseLabels[state.phase]}</span>
          </div>
        </section>

        <section className="stats-grid" aria-label="게임 현황">
          <article className="stat-card"><span>전체 참가자</span><p><strong>{state.participant_count}</strong> 명</p></article>
          <article className="stat-card"><span>현재 생존자</span><p><strong>{state.active_count}</strong> 명</p></article>
          <article className="stat-card"><span>현재 제출</span><p><strong>{state.submission_count} / {state.active_count}</strong> 명</p></article>
        </section>

        {error && <p className="admin-error" role="alert">{error}</p>}

        <section className="admin-grid">
          <article className="control-panel">
            <div className="panel-heading">
              <div>
                <span>현재 문제</span>
                <h2>{currentQuestion ? `${currentQuestion.question_order}. ${currentQuestion.question_text}` : "선택된 문제가 없습니다"}</h2>
              </div>
              <span className="question-count">{currentQuestion?.question_order ?? 0} / {questions.length}</span>
            </div>

            <div className="question-picker">
              <label htmlFor="question-select">문제 선택</label>
              <select
                id="question-select"
                onChange={(event) => setSelectedQuestionId(event.target.value)}
                value={selectedQuestionId}
              >
                <option value="">문제를 선택하세요</option>
                {questions.map((question) => (
                  <option key={question.id} value={question.id}>
                    {question.question_order}. {question.question_text}
                  </option>
                ))}
              </select>
              <button
                className="secondary-button"
                disabled={!selectedQuestionId || Boolean(busyAction)}
                onClick={() => performAction("select_question", selectedQuestionId)}
                type="button"
              >선택 적용</button>
            </div>

            <div className="current-question-preview">
              {currentQuestion ? (
                <>
                  <span>{currentQuestion.type.toUpperCase()} · {currentQuestion.time_limit_seconds}초</span>
                  <p>{currentQuestion.question_text}</p>
                </>
              ) : <p>문제를 선택하면 여기에 표시됩니다.</p>}
            </div>

            <section className="grading-panel" aria-label="채점 관리">
              <div className="grading-panel-heading">
                <div>
                  <span>정답 및 채점</span>
                  <strong>{displayAnswerKey()}</strong>
                </div>
                <span className={state.grading_finalized ? "finalization-badge finalized" : "finalization-badge"}>
                  {state.grading_finalized ? "판정 확정됨" : "확정 전"}
                </span>
              </div>
              <div className="grading-summary">
                <span>정답 <strong>{gradingSummary.correct}</strong></span>
                <span>오답 <strong>{gradingSummary.incorrect}</strong></span>
                <span>보류 <strong>{gradingSummary.pending}</strong></span>
                <span>미채점 <strong>{gradingSummary.ungraded}</strong></span>
              </div>
              <div className="grading-actions">
                <button
                  className="secondary-button"
                  disabled={
                    !(["closed", "judging"] as string[]).includes(state.phase)
                    || state.grading_finalized
                    || Boolean(busyAction)
                  }
                  onClick={() => performGrading("auto_grade")}
                  type="button"
                >자동 채점</button>
                <button
                  className="primary-button gold-button"
                  disabled={
                    state.phase !== "judging"
                    || state.grading_finalized
                    || gradingSummary.ungraded > 0
                    || Boolean(busyAction)
                  }
                  onClick={() => performGrading("finalize")}
                  type="button"
                >판정 확정</button>
                <button
                  className="secondary-button"
                  disabled={!state.grading_finalized || state.phase !== "judging" || Boolean(busyAction)}
                  onClick={() => performGrading("undo_finalize")}
                  type="button"
                >판정 확정 취소</button>
              </div>
              <p>주관식 불일치는 자동 오답 대신 판정보류로 분류됩니다. 미제출자는 판정 확정 시 탈락합니다.</p>
            </section>

            <div className="control-actions admin-actions">
              <button
                className="primary-button"
                disabled={!currentQuestion || state.phase !== "lobby" || Boolean(busyAction)}
                onClick={() => performAction("publish_question")}
                type="button"
              >문제 공개</button>
              <button
                className="primary-button gold-button"
                disabled={state.phase !== "question" || Boolean(state.timer_started_at) || Boolean(busyAction)}
                onClick={() => performAction("start_timer")}
                type="button"
              >타이머 시작</button>
              <button
                className="danger-button"
                disabled={state.phase !== "question" || Boolean(busyAction)}
                onClick={() => performAction("close_submissions")}
                type="button"
              >답변 마감</button>
              <button
                className="secondary-button"
                disabled={state.phase !== "judging" || !state.grading_finalized || Boolean(busyAction)}
                onClick={() => performAction("reveal_answer")}
                type="button"
              >정답 공개</button>
              <button
                className="secondary-button"
                disabled={state.phase !== "answer" || Boolean(busyAction)}
                onClick={() => performAction("next_question")}
                type="button"
              >다음 문제</button>
              <button
                className="secondary-button"
                disabled={state.phase === "judging" || Boolean(busyAction)}
                onClick={() => performAction("undo")}
                type="button"
              >직전 작업 Undo</button>
            </div>
            <button
              className="finish-button"
              disabled={state.phase === "finished" || Boolean(busyAction)}
              onClick={() => performAction("finish_game")}
              type="button"
            >행사 종료</button>
          </article>

          <aside className="activity-panel">
            <div className="panel-heading">
              <div><span>실시간 현황</span><h2>참가자 답안</h2></div>
              <span className="answer-total">{answers.length}</span>
            </div>
            <div className="answer-list">
              {answers.length === 0 ? (
                <div className="activity-empty"><p>제출된 답안이 없습니다.</p></div>
              ) : answers.map((answer) => (
                <article className="answer-row" key={answer.id}>
                  <div><strong>{participantNames.get(answer.participant_id) ?? "참가자"}</strong><span>{formatSubmittedTime(answer.submitted_at)}</span></div>
                  <p>{displayAnswer(answer)}</p>
                  <div className="answer-grade-meta">
                    <span className={`grading-chip grade-${answer.grading_status}`}>{gradingLabels[answer.grading_status]}</span>
                    {answer.is_finalized && <span className="answer-finalized">확정</span>}
                  </div>
                  {answer.grading_note && <small className="grading-note">{answer.grading_note}</small>}
                  <div className="answer-grade-actions" aria-label={`${participantNames.get(answer.participant_id) ?? "참가자"} 답안 판정`}>
                    {(["correct", "incorrect", "pending"] as GradingStatus[]).map((status) => (
                      <button
                        className={answer.grading_status === status ? `selected grade-${status}` : ""}
                        disabled={
                          answer.is_finalized
                          || state.grading_finalized
                          || !(["closed", "judging"] as string[]).includes(state.phase)
                          || Boolean(busyAction)
                        }
                        key={status}
                        onClick={() => performGrading("set_grade", {
                          answerId: answer.id,
                          note: "관리자 수동 판정",
                          status,
                        })}
                        type="button"
                      >{gradingLabels[status]}</button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </aside>
        </section>

        <section className="test-reset-panel" aria-labelledby="test-reset-title">
          <div>
            <p className="eyebrow">TEST RESET</p>
            <h2 id="test-reset-title">테스트 데이터 초기화</h2>
            <p>문제와 정답, 관리자 계정은 유지됩니다. 초기화한 답안과 참가자는 복구할 수 없습니다.</p>
          </div>
          <div className="test-reset-actions">
            <button
              className="secondary-button"
              disabled={Boolean(busyAction)}
              onClick={() => performReset("gameplay")}
              type="button"
            >참가자 유지하고 초기화</button>
            <button
              className="danger-button"
              disabled={Boolean(busyAction)}
              onClick={() => performReset("full")}
              type="button"
            >참가자까지 전체 초기화</button>
          </div>
        </section>

        <p className="admin-phase-note">모든 상태 전이는 서버에서 검증되고 작업 로그에 기록됩니다.</p>
      </div>
    </main>
  );
}
