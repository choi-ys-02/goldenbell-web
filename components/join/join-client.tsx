"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppBrand } from "@/components/app-brand";
import { ConnectionIndicator } from "@/components/game/connection-indicator";
import { SetupRequired } from "@/components/game/setup-required";
import {
  clearPendingJoin,
  createSessionToken,
  loadParticipantSession,
  loadPendingJoin,
  saveParticipantSession,
  savePendingJoin,
} from "@/lib/game/session-storage";
import { useGameRealtime } from "@/hooks/use-game-realtime";
import { fetchWithTimeout, networkErrorMessage } from "@/lib/client/fetch-with-timeout";

type JoinClientProps = {
  configured: boolean;
  gameSlug: string;
};

type JoinResponse = {
  game: { id: string; slug: string; title: string };
  participant: { id: string; game_id: string; name: string };
  recovered: boolean;
};

export function JoinClient({ configured, gameSlug }: JoinClientProps) {
  const router = useRouter();
  const { snapshot, status } = useGameRealtime(configured, gameSlug);
  const [name, setName] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [restoring, setRestoring] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const recover = async () => {
      await Promise.resolve();
      const existing = loadParticipantSession(gameSlug);
      const pending = loadPendingJoin(gameSlug);
      if (pending && active) {
        setName(pending.name);
        setPendingToken(pending.sessionToken);
      }
      if (!existing) {
        if (active) setRestoring(false);
        return;
      }

      // 서버 확인은 /play에서 수행한다. 일시적인 네트워크 장애만으로 로컬 세션을
      // 삭제하거나 새 참가자를 만들지 않는다.
      router.replace("/play");
    };

    void recover();
    return () => { active = false; };
  }, [configured, gameSlug, router]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    const normalizedName = name.trim().replace(/\s+/gu, " ");
    if (!normalizedName) {
      setError("이름을 입력해주세요.");
      return;
    }

    const sessionToken = pendingToken ?? createSessionToken();
    savePendingJoin(gameSlug, { name: normalizedName, sessionToken });
    setPendingToken(sessionToken);
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetchWithTimeout("/api/participants/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameSlug, name: normalizedName, sessionToken }),
      });
      const data = await response.json() as JoinResponse & { message?: string };
      if (!response.ok) throw new Error(data.message || "참가 요청에 실패했습니다.");

      saveParticipantSession({
        gameId: data.game.id,
        gameSlug,
        name: data.participant.name,
        participantId: data.participant.id,
        sessionToken,
      });
      clearPendingJoin(gameSlug);
      router.replace("/play");
    } catch (cause) {
      setError(networkErrorMessage(cause));
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const joinOpen = Boolean(snapshot?.game.join_open);

  return (
    <main className="mobile-shell join-shell">
      <header className="mobile-header">
        <AppBrand />
        <ConnectionIndicator status={status} />
      </header>

      <section className="join-card">
        <div className="event-emblem" aria-hidden="true">
          <span>2026</span>
          <strong>秋夕</strong>
        </div>
        <p className="eyebrow">함께 울리는 한가위</p>
        <h1>골든벨에<br />도전하세요!</h1>
        <p className="supporting-copy">
          {snapshot?.game.title ?? "2026 한가위 골든벨"}<br />
          사용할 이름을 입력해주세요.
        </p>

        {snapshot && (
          <div className="join-live-count">
            <span aria-hidden="true" />
            현재 <strong>{snapshot.state.participant_count}</strong>명 참가 완료
          </div>
        )}

        {!configured ? <SetupRequired /> : (
          <form className="join-form" onSubmit={submit}>
            <label htmlFor="participant-name">참가자 이름</label>
            <input
              id="participant-name"
              name="participantName"
              placeholder="예: 홍길동"
              type="text"
              autoComplete="name"
              maxLength={40}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              disabled={submitting || restoring}
            />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button
              className="primary-button"
              type="submit"
              disabled={submitting || restoring || !joinOpen}
            >
              {restoring ? "참가 정보 확인 중…" : submitting ? "참가 처리 중…" : joinOpen ? "참가하기" : "참가 접수 마감"}
            </button>
          </form>
        )}
      </section>

      <p className="phase-notice">서버에 참가 정보가 저장된 뒤 게임 화면으로 이동합니다.</p>
    </main>
  );
}
