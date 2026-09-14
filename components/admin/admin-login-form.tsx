"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("이메일 또는 비밀번호를 확인해주세요.");
      setSubmitting(false);
      return;
    }

    router.replace("/admin");
    router.refresh();
  };

  return (
    <form className="admin-login-form" onSubmit={login}>
      <label htmlFor="admin-email">관리자 이메일</label>
      <input
        autoComplete="username"
        id="admin-email"
        onChange={(event) => setEmail(event.target.value)}
        required
        type="email"
        value={email}
      />
      <label htmlFor="admin-password">비밀번호</label>
      <input
        autoComplete="current-password"
        id="admin-password"
        minLength={8}
        onChange={(event) => setPassword(event.target.value)}
        required
        type="password"
        value={password}
      />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" disabled={submitting} type="submit">
        {submitting ? "확인 중…" : "관리자 로그인"}
      </button>
    </form>
  );
}
