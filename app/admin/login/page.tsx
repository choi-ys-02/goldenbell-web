import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { AppBrand } from "@/components/app-brand";
import { SetupRequired } from "@/components/game/setup-required";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "관리자 로그인",
};

export default async function AdminLoginPage() {
  const configured = isSupabaseConfigured();
  if (configured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims) redirect("/admin");
  }

  return (
    <main className="admin-login-shell">
      <section className="admin-login-card">
        <AppBrand />
        <div>
          <p className="eyebrow">SECURE CONSOLE</p>
          <h1>진행자 로그인</h1>
          <p>Supabase Auth에 등록된 관리자 계정만 접근할 수 있습니다.</p>
        </div>
        {configured ? <AdminLoginForm /> : <SetupRequired />}
      </section>
    </main>
  );
}
