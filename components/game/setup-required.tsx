export function SetupRequired() {
  return (
    <section className="setup-card" role="status">
      <span aria-hidden="true">!</span>
      <div>
        <strong>Supabase 연결이 필요합니다</strong>
        <p><code>.env.local</code>을 설정하고 마이그레이션을 적용해주세요.</p>
      </div>
    </section>
  );
}
