import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { status: "configuration_required" },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.from("games").select("id").limit(1);

  if (error) {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }

  return NextResponse.json({ status: "ok" });
}
