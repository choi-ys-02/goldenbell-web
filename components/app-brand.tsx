import Link from "next/link";

type AppBrandProps = {
  compact?: boolean;
};

export function AppBrand({ compact = false }: AppBrandProps) {
  return (
    <Link className={`brand${compact ? " brand-compact" : ""}`} href="/">
      <span className="brand-mark" aria-hidden="true">
        울림
      </span>
      <span>
        <strong>한가위 골든벨</strong>
        {!compact && <small>2026 실시간 퀴즈</small>}
      </span>
    </Link>
  );
}
