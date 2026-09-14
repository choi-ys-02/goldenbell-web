"use client";

import Image from "next/image";
import { ConnectionIndicator } from "@/components/game/connection-indicator";
import { SetupRequired } from "@/components/game/setup-required";
import { useCountdown } from "@/hooks/use-countdown";
import { useGameRealtime } from "@/hooks/use-game-realtime";
import { getFinalStage } from "@/lib/game/final-stage";

type ScreenClientProps = {
  configured: boolean;
  gameSlug: string;
  joinUrl: string;
};

export function ScreenClient({ configured, gameSlug, joinUrl }: ScreenClientProps) {
  const { error, snapshot, status } = useGameRealtime(configured, gameSlug);
  const { expired, remainingSeconds } = useCountdown(snapshot?.state.deadline_at);

  if (!configured) {
    return (
      <main className="projector-shell projector-setup">
        <SetupRequired />
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="projector-shell">
        <section className="screen-loading">
          <div className="pulse-bell">울림</div>
          <p className="screen-kicker">CONNECTING</p>
          <h1>{error ?? "행사 정보를 불러오고 있습니다."}</h1>
        </section>
      </main>
    );
  }

  const game = snapshot.game;
  const state = snapshot.state;
  const question = snapshot.question;
  const phase = state.phase;
  const finalStage = getFinalStage(state.active_count, state.participant_count);
  const submissionsClosed = phase === "closed" || phase === "judging" || expired;

  return (
    <main className={`projector-shell projector-phase-${phase}`}>
      <div className="projector-pattern" aria-hidden="true" />
      <header className="projector-header">
        <div className="projector-brand">
          <span className="brand-mark">울림</span>
          <div>
            <strong>{game?.title ?? "2026 한가위 골든벨"}</strong>
            <small>2026 CHUSEOK GOLDEN BELL</small>
          </div>
        </div>

        {phase !== "lobby" && phase !== "finished" && (
          <div className={`screen-stage-badge${finalStage ? " final" : ""}`}>
            {finalStage ?? (phase === "answer" ? "ANSWER" : phase === "judging" ? "JUDGING" : "LIVE")}
          </div>
        )}

        <div className="screen-header-stats">
          <ConnectionIndicator status={status} />
          <div className="live-count">
            <span>{phase === "lobby" ? "참가 완료" : "현재 생존"}</span>
            <strong>{phase === "lobby" ? state.participant_count : state.active_count}</strong>
            <small>명</small>
          </div>
        </div>
      </header>

      {phase === "finished" ? (
        <section className="screen-finished">
          <div className="screen-confetti" aria-hidden="true">
            {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
          </div>
          <div className="winner-medal" aria-hidden="true"><span>★</span></div>
          <p className="screen-kicker">CONGRATULATIONS</p>
          <h1>{state.active_count === 1 ? "최후의 1인" : "골든벨 종료"}</h1>
          <p className="winner-copy">
            {state.active_count === 1
              ? "2026 한가위 골든벨의 주인공이 탄생했습니다!"
              : "뜨거운 도전을 마친 모든 참가자에게 박수를 보냅니다!"}
          </p>
          <div className="survivor-count"><strong>{state.active_count}</strong>명의 최종 생존자</div>
        </section>
      ) : phase === "lobby" || !question ? (
        <section className="projector-content projector-lobby">
          <div className="qr-frame">
            <div className="qr-code-wrap">
              <Image
                alt="참가 페이지 QR 코드"
                className="screen-qr-code"
                height={720}
                priority
                src="/api/qr"
                unoptimized
                width={720}
              />
            </div>
            <div className="qr-scan-label"><span aria-hidden="true">⌁</span> 카메라로 스캔</div>
          </div>
          <div className="projector-copy">
            <p className="screen-kicker">READY TO PLAY?</p>
            <h1>휴대폰으로 접속하고<br /><em>골든벨에 참가하세요!</em></h1>
            <div className="join-route">
              <span>참가 주소</span>
              <strong>{joinUrl.replace(/^https?:\/\//, "")}</strong>
            </div>
            <p className="lobby-participant-count">현재 <strong>{state.participant_count}</strong>명이 함께하고 있습니다</p>
          </div>
        </section>
      ) : phase === "answer" ? (
        <section className="screen-answer-reveal">
          <p className="screen-kicker">ANSWER REVEAL</p>
          <span className="screen-question-number">QUESTION {question.question_order}</span>
          <h1>{question.question_text}</h1>
          <div className="screen-correct-answer">
            <small>정답</small>
            <span>
              {Array.isArray(state.revealed_answer)
                ? state.revealed_answer.map((answer) => typeof answer === "number"
                  ? `${answer + 1}번`
                  : String(answer)).join(" · ")
                : String(state.revealed_answer ?? "")}
            </span>
          </div>
          <p className="screen-survivors">현재 생존자 <strong>{state.active_count}</strong>명</p>
        </section>
      ) : (
        <section className="screen-question">
          <div className="screen-question-top">
            <div>
              <span className="screen-question-number">QUESTION {question.question_order}</span>
              <small>{question.type === "ox" ? "O · X" : question.type === "multiple_choice" ? "객관식" : "주관식"}</small>
            </div>
            <div className={remainingSeconds <= 5 && state.submissions_open ? "screen-timer danger" : "screen-timer"}>
              <strong>{state.timer_started_at ? remainingSeconds : question.time_limit_seconds}</strong>
              <small>SEC</small>
            </div>
          </div>
          <h1>{question.question_text}</h1>
          {question.type === "multiple_choice" && Array.isArray(question.choices) && (
            <div className="screen-choices">
              {question.choices.map((choice, index) => (
                <div key={`${index}-${String(choice)}`}><span>{index + 1}</span>{String(choice)}</div>
              ))}
            </div>
          )}
          {question.type === "ox" && <div className="screen-ox"><span>O</span><i /><span>X</span></div>}
          {question.type === "short_answer" && (
            <div className="screen-short-answer"><span>가장 정확한 답을</span><strong>휴대폰에 입력해주세요</strong></div>
          )}
          <footer className={`screen-question-footer${submissionsClosed ? " closed" : ""}`}>
            <div className="screen-phase-copy">
              <span className="screen-live-dot" aria-hidden="true" />
              <strong>
                {phase === "judging" ? "판정 중" : submissionsClosed ? "답변 마감" : state.submissions_open ? "답변 접수 중" : "문제 공개"}
              </strong>
            </div>
            <div className="screen-submission-total">
              <small>답변 제출</small>
              <span><strong>{state.submission_count}</strong> / {state.active_count}</span>
            </div>
          </footer>
        </section>
      )}

      {phase === "lobby" && (
        <footer className="projector-footer">
          <span><b>1</b> QR 스캔</span><i />
          <span><b>2</b> 이름 입력</span><i />
          <span><b>3</b> 참가 완료</span>
        </footer>
      )}
    </main>
  );
}
