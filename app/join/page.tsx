import type { Metadata } from "next";
import { JoinClient } from "@/components/join/join-client";
import { getGameSlug, isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "참가하기",
};

export default function JoinPage() {
  return <JoinClient configured={isSupabaseConfigured()} gameSlug={getGameSlug()} />;
}
