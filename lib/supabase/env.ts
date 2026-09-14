const publicEnvKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

export function isSupabaseConfigured() {
  return publicEnvKeys.every((key) => Boolean(process.env[key]));
}

export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase 환경변수가 없습니다. .env.example을 참고해 .env.local을 설정해주세요.",
    );
  }

  return { url, publishableKey };
}

export function getGameSlug() {
  return process.env.NEXT_PUBLIC_GAME_SLUG?.trim() || "2026-chuseok";
}
