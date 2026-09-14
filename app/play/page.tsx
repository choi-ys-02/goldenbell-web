import type { Metadata } from "next";
import { PlayClient } from "@/components/game/play-client";
import { getGameSlug, isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "게임",
};

export default function PlayPage() {
  return <PlayClient configured={isSupabaseConfigured()} gameSlug={getGameSlug()} />;
}
