"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppBrand } from "@/components/app-brand";
import { ConnectionIndicator } from "@/components/game/connection-indicator";
import { QuestionInput } from "@/components/game/question-input";
import { SetupRequired } from "@/components/game/setup-required";
import { useCountdown } from "@/hooks/use-countdown";
import { useGameRealtime } from "@/hooks/use-game-realtime";
import { fetchWithTimeout, networkErrorMessage } from "@/lib/client/fetch-with-timeout";
import { getFinalStage } from "@/lib/game/final-stage";
import {
  clearParticipantSession,
  clearPendingAnswer,
  loadParticipantSession,
  loadPendingAnswer,
  savePendingAnswer,
} from "@/lib/game/session-storage";
import type { ParticipantSession, SubmissionReceipt, SubmissionValue } from "@/lib/game/types";

type PlayClientProps = {
  configured: boolean;
  gameSlug: string;
};

type SafeParticipant = {
  id: string;
  name: string;
  status: "active" | "eliminated" | "pending" | "revived";
};

type StoredAnswer = {
  answer: SubmissionValue;
  grading_status: "ungraded" | "correct" | "incorrect" | "pending";
  id: string;
  is_finalized: boolean;
  submitted_at: string;
};

export function PlayClient({ configured, gameSlug }: PlayClientProps) {
  const router = useRouter();
  const { snapshot, status } = useGameRealtime(configured, gameSlug);
  const { expired, remainingSeconds } = useCountdown(snapshot?.state.deadline_at);
  const [session, setSession] = useState<ParticipantSession | null>(null);
  const [participant, setParticipant] = useState<SafeParticipant | null>(null);
  const [storedAnswer, setStoredAnswer] = useState<StoredAnswer | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<SubmissionValue | null>(null);
  const [submissionState, setSubmissionState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(configured);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const sessionSyncKey = snapshot
    ? `${snapshot.state.revision}:${snapshot.state.current_question_id ?? "none"}:${snapshot.state.phase}:${snapshot.state.grading_finalized}:${snapshot.state.answer_revealed}`
    : null;

  const syncSession = useCallback(async (currentSession: ParticipantSession) => {
    const response = await fetchWithTimeout("/api/participants/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentSession),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null) as { message?: string } | null;
      if (response.status === 401 || response.status === 404) {
        clearParticipantSession(gameSlug);
        router.replace("/join");
        return null;
      }
      throw new Error(errorData?.message || "참가 정보를 확인하지 못했습니다.");
    }

    const data = await response.json() as {
      answer: StoredAnswer | null;
      participant: SafeParticipant;
      state: { current_question_id: string | null };
    };
    setParticipant(data.participant);
    setStoredAnswer(data.answer);
    if (data.answer) {
      setSubmissionState("success");
      setSelectedAnswer(data.answer.answer);
      if (data.state.current_question_id) {
        clearPendingAnswer(gameSlug, data.state.current_question_id);
      }
    } else {
      setSubmissionState("idle");
      const pending = data.state.current_question_id
        ? loadPendingAnswer(gameSlug, data.state.current_question_id)
        : null;
      setSelectedAnswer(pending?.answer ?? null);
      setMessage(pending
        ? "이전에 전송이 완료되지 않은 답안을 복구했습니다. 다시 제출해주세요."
        : null);
    }
    setRestoreError(null);
    setRestoring(false);
    return data;
  }, [gameSlug, router]);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const restore = async () => {
      await Promise.resolve();
      const currentSession = loadParticipantSession(gameSlug);
      if (!currentSession) {
        router.replace("/join");
        return;
      }
      if (!active) return;
      setSession(currentSession);
      try {
        await syncSession(currentSession);
      } catch (cause) {
        if (!active) return;
        setRestoreError(networkErrorMessage(cause));
        setRestoring(false);
      }
    };
    void restore();
    return () => { active = false; };
  }, [configured, gameSlug, router, syncSession]);

  useEffect(() => {
    if (!session || !sessionSyncKey) return;
    const timer = window.setTimeout(() => {
      void syncSession(session).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [session, sessionSyncKey, syncSession]);

  useEffect(() => {
    if (!session) return;

    const recoverSession = () => {
      if (!navigator.onLine) return;
      void syncSession(session).catch(() => undefined);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") recoverSession();
    };

    window.addEventListener("online", recoverSession);
    window.addEventListener("focus", recoverSession);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", recoverSession);
      window.removeEventListener("focus", recoverSession);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [session, syncSession]);

  const submitAnswer = async () => {
    if (
      submittingRef.current
      || !session
      || !snapshot?.question
      || selectedAnswer === null
    ) return;
    submittingRef.current = true;
    setSubmissionState("submitting");
    setMessage(null);
    savePendingAnswer(gameSlug, {
      answer: selectedAnswer,
      questionId: snapshot.question.id,
    });

    try {
      const response = await fetchWithTimeout("/api/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answer: selectedAnswer,
          gameSlug,
          participantId: session.participantId,
          questionId: snapshot.question.id,
          sessionToken: session.sessionToken,
        }),
      });
      const data = await response.json() as SubmissionReceipt & { message?: string };
      if (!response.ok) throw new Error(data.message || "전송에 실패했습니다. 다시 제출해주세요.");

      setStoredAnswer({
        answer: data.answer as SubmissionValue,
        grading_status: data.gradingStatus,
        id: data.id,
        is_finalized: false,
        submitted_at: data.submittedAt,
      });
      clearPendingAnswer(gameSlug, snapshot.question.id);
      setSubmissionState("success");
      setMessage(data.isDuplicate ? "이미 저장된 답변을 확인했습니다." : "답변이 제출되었습니다.");
    } catch (cause) {
      try {
        const reconciled = await syncSession(session);
        if (reconciled?.answer) {
          clearPendingAnswer(gameSlug, snapshot.question.id);
          setSubmissionState("success");
          setMessage("서버에 저장된 답변을 다시 확인했습니다.");
          return;
        }
      } catch {
        // 원래 제출 오류를 사용자에게 안내하고 답안은 재시도를 위해 보존한다.
      }
      setSubmissionState("error");
      setMessage(networkErrorMessage(cause));
    } finally {
      submittingRef.current = false;
    }
  };

  if (!configured) {
    return (
      <main className="mobile-shell play-shell">
        <header className="mobile-header"><AppBrand compact /><ConnectionIndicator status={status} /></header>
        <SetupRequired />
      </main>
    );
  }

  if ((restoring || !snapshot) && !restoreError) {
    return (
      <main className="mobile-shell play-shell">
        <header className="mobile-header">
          <AppBrand compact />
          <div className="mobile-header-actions">
            <ConnectionIndicator status={status} />
            <span className="participant-pill">{participant?.name ?? session?.name ?? "참가자"}</span>
          </div>
        </header>
        <section className="waiting-card compact-waiting">
          <div className="pulse-bell" aria-hidden="true">울림</div>
          <p className="eyebrow">참가 정보 복구 중</p>
          <h1>잠시만<br />기다려주세요.</h1>
        </section>
      </main>
    );
  }

  if (restoreError && session) {
    return (
      <main className="mobile-shell play-shell">
        <header className="mobile-header">
          <AppBrand compact />
          <ConnectionIndicator status={status} />
        </header>
        <section className="waiting-card compact-waiting recovery-card">
          <div className="pulse-bell" aria-hidden="true">!</div>
          <p className="eyebrow">참가 정보는 이 기기에 보관되어 있습니다</p>
          <h1>연결을 다시<br />확인해주세요.</h1>
          <p>{restoreError}</p>
          <button
            className="primary-button"
            onClick={() => {
              setRestoring(true);
              setRestoreError(null);
              void syncSession(session).catch((cause) => {
                setRestoreError(networkErrorMessage(cause));
                setRestoring(false);
              });
            }}
            type="button"
          >다시 연결하기</button>
        </section>
      </main>
    );
  }

  if (!snapshot) return null;

  const state = snapshot.state;
  const question = snapshot.question;
  const participantCanPlay = participant?.status === "active" || participant?.status === "revived";
  const inputOpen = Boolean(
    state?.phase === "question"
    && state.submissions_open
    && !expired
    && !storedAnswer
    && participantCanPlay,
  );

  const finalizedGrade = storedAnswer?.is_finalized
    ? storedAnswer.grading_status
    : state.grading_finalized
      ? participant?.status === "eliminated"
        ? "incorrect"
        : participant?.status === "pending"
          ? "pending"
          : participantCanPlay
            ? "correct"
            : null
      : null;

  const resultMessage = finalizedGrade
    ? finalizedGrade === "correct"
      ? "정답입니다. 다음 문제를 준비해주세요."
      : finalizedGrade === "incorrect"
        ? "아쉽습니다. 패자부활전을 기다려주세요."
        : "판정 보류 중입니다. 진행자의 안내를 기다려주세요."
    : null;

  const displayedRevealedAnswer = Array.isArray(state.revealed_answer)
    ? state.revealed_answer.map((answer) => (
      question?.type === "multiple_choice" && typeof answer === "number"
        ? `${answer + 1}번`
        : String(answer)
    )).join(" · ")
    : String(state.revealed_answer ?? "");
  const finalStage = getFinalStage(state.active_count, state.participant_count);

  return (
    <main className="mobile-shell play-shell">
      <header className="mobile-header">
        <AppBrand compact />
        <div className="mobile-header-actions">
          {finalStage && state.phase !== "lobby" && state.phase !== "finished" && (
            <span className="mobile-final-stage">{finalStage}</span>
          )}
          <ConnectionIndicator status={status} />
          <span className="participant-pill">{participant?.name ?? session?.name ?? "참가자"}</span>
        </div>
      </header>

      {state.phase === "finished" ? (
        <section className="result-card winner-result">
          <span className="result-icon" aria-hidden="true">★</span>
          <p className="eyebrow">GAME FINISHED</p>
          <h1>골든벨이<br />종료되었습니다.</h1>
          <p>끝까지 함께해주셔서 감사합니다.</p>
        </section>
      ) : state.phase === "judging" && state.grading_finalized ? (
        <section className={`result-card result-${finalizedGrade ?? "pending"}`}>
          <span className="result-icon" aria-hidden="true">
            {finalizedGrade === "correct" ? "✓" : finalizedGrade === "incorrect" ? "×" : "?"}
          </span>
          <p className="eyebrow">판정 완료</p>
          <h1>{resultMessage ?? "판정 결과를 확인하고 있습니다."}</h1>
          <p>정답 공개와 다음 안내를 기다려주세요.</p>
        </section>
      ) : state.phase === "lobby" || !question ? (
        participant?.status === "eliminated" ? (
          <section className="result-card result-incorrect">
            <span className="result-icon" aria-hidden="true">×</span>
            <p className="eyebrow">WAITING FOR REVIVAL</p>
            <h1>패자부활전을<br />기다려주세요.</h1>
            <p>진행자의 안내에 따라 다시 참가할 수 있습니다.</p>
          </section>
        ) : participant?.status === "pending" ? (
          <section className="result-card result-pending">
            <span className="result-icon" aria-hidden="true">?</span>
            <p className="eyebrow">판정 보류</p>
            <h1>진행자의 판정을<br />기다려주세요.</h1>
            <p>판정이 변경되면 이 화면이 자동으로 갱신됩니다.</p>
          </section>
        ) : (
        <section className="waiting-card">
          <div className="pulse-bell" aria-hidden="true">울림</div>
          <p className="eyebrow">잠시만 기다려주세요</p>
          <h1>다음 문제를<br />준비하고 있어요.</h1>
          <p>문제가 공개되면 이 화면이 자동으로 바뀝니다.</p>
          <div className="waiting-dots" aria-label="대기 중"><span /><span /><span /></div>
        </section>
        )
      ) : state.phase === "answer" ? (
        <section className={`result-card result-${finalizedGrade ?? "pending"}`}>
          <span className="result-icon" aria-hidden="true">
            {finalizedGrade === "correct" ? "✓" : finalizedGrade === "incorrect" ? "×" : "?"}
          </span>
          <p className="eyebrow">정답 공개</p>
          <h1>{resultMessage ?? "정답이 공개되었습니다."}</h1>
          <div className="revealed-answer">{displayedRevealedAnswer}</div>
        </section>
      ) : (
        <section className="question-card">
          <div className="question-meta">
            <span>QUESTION {question.question_order}</span>
            <strong className={remainingSeconds <= 5 && state.submissions_open ? "timer danger" : "timer"}>
              {state.timer_started_at ? remainingSeconds : question.time_limit_seconds}
            </strong>
          </div>
          <h1>{question.question_text}</h1>

          <QuestionInput
            disabled={!inputOpen || submissionState === "submitting"}
            onChange={(value) => {
              setSelectedAnswer(value);
              if (submissionState === "error") setSubmissionState("idle");
            }}
            question={question}
            value={selectedAnswer}
          />

          {!participantCanPlay ? (
            <div className="submission-feedback closed" role="status">
              <strong>{participant?.status === "pending" ? "판정 보류 상태입니다." : "현재 문제에 참여할 수 없습니다."}</strong>
              <span>진행자의 안내를 기다려주세요.</span>
            </div>
          ) : storedAnswer ? (
            <div className="submission-feedback success" role="status">
              <strong>답변이 제출되었습니다.</strong>
              <span>서버 저장 완료 · 새로고침해도 유지됩니다.</span>
            </div>
          ) : state.phase !== "question" || expired ? (
            <div className="submission-feedback closed" role="status">
              <strong>답변이 마감되었습니다.</strong>
              <span>더 이상 답안을 제출할 수 없습니다.</span>
            </div>
          ) : !state.submissions_open ? (
            <div className="submission-feedback waiting" role="status">
              <strong>문제가 공개되었습니다.</strong>
              <span>진행자가 타이머를 시작하면 제출할 수 있습니다.</span>
            </div>
          ) : (
            <button
              className="primary-button submit-answer-button"
              disabled={selectedAnswer === null || submissionState === "submitting"}
              onClick={submitAnswer}
              type="button"
            >
              {submissionState === "submitting" ? "서버에 저장 중…" : submissionState === "error" ? "다시 제출하기" : "답 제출"}
            </button>
          )}
          {message && (
            <p className={submissionState === "error" ? "form-error" : "form-message"} role="status">
              {message}
            </p>
          )}
        </section>
      )}

      <aside className="info-strip">
        <span aria-hidden="true">{status === "connected" ? "✓" : "!"}</span>
        <p><strong>{status === "connected" ? "실시간 연결됨" : "연결 상태 확인 중"}</strong><br />제출 완료 문구는 서버 저장 후에만 표시됩니다.</p>
      </aside>
    </main>
  );
}
