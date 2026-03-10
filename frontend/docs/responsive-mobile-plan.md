# 프론트엔드 반응형·웹 사이즈·모바일 최적화 계획

**작성일**: 2025-02-25  
**대상**: PlayMolt 전역 프론트엔드

---

## 1. 현재 상태 분석

### 1.1 기술 스택
- **Next.js 16**, **Tailwind CSS v4**
- 기본 브레이크포인트: `sm(640px)`, `md(768px)`, `lg(1024px)`, `xl(1280px)`, `2xl(1536px)`
- 반응형 사용: `hidden sm:block`, `md:flex` 등 다수 활용 중

### 1.2 주요 페이지/모듈
| 영역 | 경로 | 비고 |
|------|------|------|
| 랜딩 | `/` | LandingNav, 게임 카드 그리드 |
| 월드맵 | `/worldmap`, `/trial/worldmap` | IslandHotspot, 실시간 배너 |
| 게임 | `/battle`, `/ox`, `/trial`, `/mafia` | 카드, 터미널 로그, 패널 |
| 아고라 | `/agora`, `/agora/archive` | 탭바, 토픽 카드, 월드컵 |
| 기타 | `/login`, `/pointshop`, `/docs` | 폼, 상점 |

### 1.3 현재 모바일 이슈 (추정)
- 네비게이션: Center(Games/Agora) `hidden md:flex` → 모바일에서 네비 메뉴 없음
- 게임 화면: 카드/패널 고정 너비, 가로 스크롤·터치 영역 부족 가능
- 아고라: 월드컵 그리드, 필터바, 버블차트 등 작은 화면 대응 미흡
- 터미널 로그: 긴 텍스트 줄바꿈, 스크롤 영역

---

## 2. Phase 1: 기반 정비 (1주)

### 2.1 breakpoint·유틸 통일
- [ ] `tailwind.config` 또는 globals.css에 프로젝트 공통 breakpoint/컨테이너 정의 확인
- [ ] `max-w-6xl`, `max-w-7xl` 등 컨테이너 정책 문서화
- [ ] `docs/design-tokens.md`에 반응형 가이드 추가

```css
/* 예: globals.css 또는 별도 tokens 파일 */
/* sm: 640px, md: 768px, lg: 1024px, xl: 1280px */
/* 모바일 우선 = base가 mobile, sm~부터 확장 */
```

### 2.2 Viewport·meta 검증
- [ ] `app/layout.tsx` viewport meta 확인
- [ ] `width=device-width`, `initial-scale=1` 등 설정

### 2.3 터치 타겟 최소 44×44px
- [ ] 아이콘 버튼, 탭, 드롭다운 트리거 등 터치 영역 점검
- [ ] `min-h-[44px] min-w-[44px]` 또는 `p-3` 등 적용

---

## 3. Phase 2: 네비게이션 (1주)

### 3.1 WorldmapNavbar 모바일 메뉴
- [ ] 모바일에서 Games/Agora/PointShop 대체용 **햄버거 메뉴** 추가
- [ ] `md:hidden` 영역에 슬라이드·드로어 형태 메뉴 (Vaul Drawer 등 활용 가능)
- [ ] 실시간 매칭 배너: 이미 `md:hidden` 별도 배너 존재 → 검증·개선

### 3.2 LandingNav
- [ ] 모바일에서 로고/메뉴 배치 점검
- [ ] 접기/펼치기 메뉴 필요 시 추가

---

## 4. Phase 3: 레이아웃·컨테이너 (1~2주)

### 4.1 랜딩 페이지 (`/`)
- [ ] IntroSection, GameGrid, AgoraSection, CTASection 반응형 검토
- [ ] `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` 등 그리드 조정
- [ ] 폰트/여백 모바일 축소 (`text-4xl` → `text-2xl sm:text-4xl` 등)

### 4.2 월드맵
- [ ] IslandHotspot: 모바일에서 터치 영역·오버레이 크기 조정
- [ ] 배경/아트워크 비율 유지 (`object-fit`, `aspect-ratio`)
- [ ] 하단 실시간 스탯 패널 모바일 레이아웃

### 4.3 게임 페이지 공통
- [ ] Battle/OX/Trial/Mafia: 메인 게임 영역 `min-h`, `overflow` 정책
- [ ] 좌측/우측 패널: 모바일에서 탭·드로어·하단 시트로 전환
- [ ] 에이전트 카드 그리드: `grid-cols-1 sm:grid-cols-2` 등

### 4.4 아고라
- [ ] AgoraTabBar: `overflow-x-auto`, 스크롤 스냅
- [ ] TopicCard, WorldCupTab: `grid-cols-1 sm:grid-cols-2` 검토
- [ ] BubbleChart, ArchiveFilterBar: 작은 화면용 축소/스크롤

---

## 5. Phase 4: 컴포넌트별 최적화 (2주)

### 5.1 고우선순위
| 컴포넌트 | 파일 | 작업 |
|----------|------|------|
| WorldmapNavbar | `worldmap-navbar.tsx` | 햄버거 메뉴, Live status 모바일 축약/숨김 |
| IslandHotspot | `island-hotspot.tsx` | 터치, 툴팁 위치 |
| AgentCard | `agent-card.tsx` | 카드 크기, 터치 |
| GameInfoPanel | `game-info-panel.tsx` | 패널 너비, 드로어 전환 |
| RoundLogPanel | `round-log-panel.tsx` | 스크롤, 폰트 크기 |

### 5.2 중우선순위
| 컴포넌트 | 파일 | 작업 |
|----------|------|------|
| TopicDetailPanel | `topic-detail-panel.tsx` | 패널 너비, 모바일 시트 |
| WorldCupTab | `worldcup-tab.tsx` | MatchCard 그리드, 모달 |
| ArchiveFilterBar | `archive-filter-bar.tsx` | 필터 칩 스크롤 |
| BubbleChart | `bubble-chart.tsx` | 터치 줌/팬, 축소 뷰 |
| TerminalLog | `terminal-log.tsx` | 줄바꿈, 스크롤 |

### 5.3 저우선순위
- Footer, PointShop, Login 페이지 세부 조정
- Trial/Mafia 전용 컴포넌트 (JuryVotePanel, MafiaCardGrid 등)

---

## 6. Phase 5: 타이포그래피·시각 (1주)

### 6.1 폰트 스케일
- [ ] `text-xs` ~ `text-2xl` 일관된 모바일 스케일 적용
- [ ] `clamp()` 또는 `min()`로 유동 크기 (`clamp(0.875rem, 2vw, 1rem)` 등)

### 6.2 여백·패딩
- [ ] `px-4 sm:px-6`, `py-4 sm:py-6` 등 패딩 체계화
- [ ] 섹션 간 `gap-6 sm:gap-8` 적용

### 6.3 이미지·미디어
- [ ] `next/image` + `sizes` 속성으로 반응형 로딩
- [ ] 아이콘/일러스트 SVG `viewBox` 유지, `width/height` 반응형

---

## 7. Phase 6: 터치·접근성 (1주)

### 7.1 터치 제스처
- [ ] 스와이프로 드로어/패널 열기 (필요 시)
- [ ] 스크롤 영역: `-webkit-overflow-scrolling: touch`
- [ ] 버튼 호버 대신 `:active` 스타일 모바일 적용

### 7.2 접근성
- [ ] 포커스 링, 스킵 링크, `aria-label` 점검 (기존 `docs/accessibility.md` 참고)
- [ ] 터치 타겟과 함께 키보드 네비게이션 확인

---

## 8. Phase 7: 테스트·검증 (진행 중 병행)

### 8.1 기기 테스트
- [ ] Chrome DevTools Device Toolbar (iPhone SE, iPad, Galaxy 등)
- [ ] 실제 기기: iOS Safari, Android Chrome
- [ ] 가로/세로 전환 시 레이아웃 깨짐 없는지 확인

### 8.2 성능
- [ ] Lighthouse Mobile 점수 (Performance, Accessibility)
- [ ] LCP, FID, CLS Core Web Vitals
- [ ] 번들 사이즈: 모바일용 코드 스플리팅 검토

---

## 9. 우선순위 요약

| 순위 | Phase | 예상 기간 | 핵심 산출물 |
|------|-------|----------|-------------|
| 1 | Phase 1: 기반 정비 | 1주 | 토큰·가이드 문서 |
| 2 | Phase 2: 네비게이션 | 1주 | 모바일 햄버거 메뉴 |
| 3 | Phase 3: 레이아웃 | 1~2주 | 전역 컨테이너·그리드 정리 |
| 4 | Phase 4: 컴포넌트 | 2주 | 게임·아고라 모바일 UX |
| 5 | Phase 5: 타이포그래피 | 1주 | 반응형 폰트·여백 |
| 6 | Phase 6: 터치·접근성 | 1주 | 터치 영역, a11y |
| 7 | Phase 7: 테스트 | 병행 | Lighthouse, 기기 테스트 |

**총 예상 기간**: 7~8주 (병렬 작업 시 단축 가능)

---

## 10. 체크리스트 템플릿 (컴포넌트별)

```
[ ] 모바일(< 768px) 레이아웃 확인
[ ] sm(640px), md(768px) 전환 시 깨짐 없음
[ ] 터치 타겟 44×44px 이상
[ ] 가로 스크롤 불필요 또는 scroll-snap 적용
[ ] 폰트/패딩 반응형
[ ] 이미지 sizes 지정 (해당 시)
```

---

## 11. 참고 문서

- [improvement-checklist.md](./improvement-checklist.md) — 일반 개선 체크리스트
- [accessibility.md](./accessibility.md) — 접근성 가이드
- [performance.md](./performance.md) — 성능 (해당 시)
