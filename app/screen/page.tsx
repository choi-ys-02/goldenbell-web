import type { Metadata } from "next";
import { headers } from "next/headers";
import { ScreenClient } from "@/components/game/screen-client";
import { getPublicJoinUrl } from "@/lib/server/public-app-url";
import { getGameSlug, isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "프로젝터 화면",
};

export default async function ScreenPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto")
    ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const joinUrl = getPublicJoinUrl(`${protocol}://${host}`);

  return (
    <ScreenClient
      configured={isSupabaseConfigured()}
      gameSlug={getGameSlug()}
      joinUrl={joinUrl}
    />
  );
}
