"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { PublicGameSnapshot, Question } from "@/lib/game/types";
import { createClient } from "@/lib/supabase/client";

type ConnectionStatus = "not_configured" | "connecting" | "connected" | "error";

export function useGameRealtime(configured: boolean, gameSlug: string) {
  const [snapshot, setSnapshot] = useState<PublicGameSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(
    configured ? "connecting" : "not_configured",
  );
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const loadQuestion = useCallback(async (questionId: string | null) => {
    if (!questionId) return null;
    const supabase = createClient();
    const { data, error: questionError } = await supabase
      .from("questions")
      .select("*")
      .eq("id", questionId)
      .maybeSingle();

    if (questionError) throw questionError;
    return data as Question | null;
  }, []);

  const refresh = useCallback(async () => {
    if (!configured) return null;
    const supabase = createClient();
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id, slug, title, join_open")
      .eq("slug", gameSlug)
      .maybeSingle();

    if (gameError) throw gameError;
    if (!game) throw new Error("행사 정보를 찾을 수 없습니다.");

    const { data: state, error: stateError } = await supabase
      .from("game_state")
      .select("*")
      .eq("game_id", game.id)
      .single();

    if (stateError) throw stateError;
    const question = await loadQuestion(state.current_question_id);
    const nextSnapshot = { game, state, question } as PublicGameSnapshot;
    setSnapshot(nextSnapshot);
    setError(null);
    return nextSnapshot;
  }, [configured, gameSlug, loadQuestion]);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const supabase = createClient();

    const connect = async () => {
      try {
        setStatus("connecting");
        const initial = await refresh();
        if (!active || !initial) return;

        const channel = supabase
          .channel(`game-state:${initial.game.id}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "game_state",
              filter: `game_id=eq.${initial.game.id}`,
            },
            async (payload) => {
              if (!active) return;
              const nextState = payload.new as PublicGameSnapshot["state"];
              try {
                const question = await loadQuestion(nextState.current_question_id);
                setSnapshot((previous) => {
                  if (!previous || nextState.revision < previous.state.revision) {
                    return previous;
                  }
                  return { ...previous, state: nextState, question };
                });
              } catch {
                setSnapshot((previous) => previous ? { ...previous, state: nextState } : previous);
              }
            },
          )
          .subscribe((nextStatus) => {
            if (!active) return;
            if (nextStatus === "SUBSCRIBED") {
              setStatus("connected");
              setError(null);
            }
            if (nextStatus === "CHANNEL_ERROR" || nextStatus === "TIMED_OUT") {
              setStatus("error");
              setError("실시간 연결이 지연되고 있습니다. 네트워크 복구 후 자동으로 다시 확인합니다.");
            }
          });

        channelRef.current = channel;
      } catch (cause) {
        if (!active) return;
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "실시간 연결에 실패했습니다.");
      }
    };

    void connect();
    return () => {
      active = false;
      if (channelRef.current) void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [configured, loadQuestion, refresh]);

  useEffect(() => {
    if (!configured) return;

    const recover = () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      void refresh().catch((cause) => {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "게임 상태를 다시 불러오지 못했습니다.");
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") recover();
    };

    window.addEventListener("online", recover);
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", recover);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [configured, refresh]);

  return { error, refresh, snapshot, status };
}
