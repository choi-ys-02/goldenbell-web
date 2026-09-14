import Link from "next/link";
import { AppBrand } from "@/components/app-brand";

const routes = [
  {
    href: "/join",
    label: "참가자 등록",
    description: "이름을 입력하고 행사에 참가하는 모바일 화면",
    tag: "참가자",
  },
  {
    href: "/play",
    label: "게임 화면",
    description: "문제를 확인하고 답안을 제출하는 모바일 화면",
    tag: "참가자",
  },
  {
    href: "/screen",
    label: "프로젝터 화면",
    description: "강당의 대형 스크린에 표시하는 관객용 화면",
    tag: "관객",
  },
  {
    href: "/admin",
    label: "진행자 콘솔",
    description: "게임 진행과 현황을 확인하는 관리자 화면",
    tag: "관리자",
  },
];

export default function HomePage() {
  return (
    <main className="home-shell">
      <header className="home-header">
        <AppBrand />
        <span className="phase-pill">Phase 9</span>
      </header>

      <section className="home-hero">
        <p className="eyebrow">2026 추석 행사</p>
        <h1>모두의 답이 모이는<br />실시간 골든벨</h1>
        <p>
          참가 등록부터 실시간 진행, 안전한 채점과 프로젝터 행사 연출까지 연결되었습니다.
          아래 링크에서 각 역할별 화면을 확인할 수 있습니다.
        </p>
      </section>

      <section className="route-grid" aria-label="페이지 바로가기">
        {routes.map((route, index) => (
          <Link className="route-card" href={route.href} key={route.href}>
            <div className="route-card-top">
              <span className="route-number">0{index + 1}</span>
              <span className="route-tag">{route.tag}</span>
            </div>
            <div>
              <h2>{route.label}</h2>
              <p>{route.description}</p>
            </div>
            <span className="route-arrow" aria-hidden="true">→</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
