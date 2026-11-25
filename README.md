# 우리동네 쿠폰마을

경기도 소상공인을 위한 쿠폰 · 단골관리(CRM) 서비스입니다.
손님은 쿠폰을 받고, 사장님은 손님 명단과 재방문을 자동으로 관리합니다.

## 화면 주소

| 주소 | 화면 |
|---|---|
| `/` | 동네 쿠폰 피드 (카테고리·지역·마감임박·인기순·내 주변) |
| `/region.html` | 관심 지역 설정 (경기 31개 시·군 먼저 오픈) |
| `/s/가게주소` | 가게별 쿠폰 랜딩페이지 (숏폼·QR·광고 링크용) |
| `/c/쿠폰번호` | 손님 쿠폰 화면 + 직원 확인(사용 처리) |
| `/me` | 마이페이지 (내 쿠폰, 단골 등급, 알림 수신 설정) |
| `/owner` | 사장님 관리 화면 (현황·사용처리·쿠폰 설정·손님 명단·알림톡 기록) |
| `/owner/poster` | 릴스 영상 · QR 포스터 만들기 |
| `/join` | 사장님 입점 안내 (영업용) |

체험 계정: 가게 주소 `hanuri` / 비밀번호 `demo1234` / 직원 확인 번호 `0000`

## 자동으로 돌아가는 것

- 쿠폰 발급 즉시: 쿠폰 + 지도 링크 알림톡
- 이벤트 쿠폰 만료 2일 전 오전 11시: 리마인드
- 매장에서 쿠폰 사용 → 리뷰 유도 화면, **7일 골든타임 쿠폰** 자동 발급, 이웃가게 크로스 쿠폰 발급
- 사용 1시간 30분 뒤: 골든타임 1차 메시지 / 만료 전날 11시: 리마인드
- 30일 동안 다시 안 오면: 안부 + 시크릿 쿠폰
- 밤 9시~아침 8시에는 광고 메시지를 보내지 않음(다음날 11시로 미룸), 수신 동의한 손님에게만 발송

## 배포 (Netlify)

1. Netlify에서 이 저장소를 연결하면 끝 (빌드 명령 불필요, 데이터는 Netlify Blobs에 저장)
2. **Site settings → Environment variables** 에 아래 값을 넣으면 실제 기능이 켜집니다.

| 변수 | 용도 | 없으면 |
|---|---|---|
| `JOIN_CODE` | 사장님 가입 코드 (영업사원이 전달) | 누구나 가게 등록 가능 |
| `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER` | 솔라피 문자 발송 (인증번호·안내) | 테스트 모드: 인증번호가 화면에 표시, 메시지는 기록만 |
| `SOLAPI_PFID`, `ALIMTALK_TPL_ISSUED` 등 | 카카오 알림톡 (채널 ID, 승인된 템플릿 ID) | 문자로 발송 |
| `KAKAO_REST_KEY`, `KAKAO_CLIENT_SECRET` | 카카오 1초 로그인 | 버튼 숨김 (휴대폰 인증만) |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 네이버 로그인 | 버튼 숨김 |
| `SESSION_SECRET` | 로그인 암호 키 | 자동 생성 |
| `DEMO_SEED=off` | 체험용 가상 가게 끄기 | 가상 가게 10곳 표시 |
| `CRON_KEY` | 예약 발송 수동 실행용 | – |

알림톡 템플릿 종류: `ISSUED`(발급), `EVENT_D2`(만료 D-2), `GOLDEN`(골든타임 1차), `GOLDEN_REMIND`(골든타임 리마인드), `CHURN`(30일 안부).
템플릿 변수: `#{가게명}`, `#{혜택}`, `#{쿠폰링크}`, `#{만료일}`, `#{지도}`.

카카오/네이버 개발자 센터의 Redirect URI: `https://내사이트주소/api/auth/kakao/callback`, `/api/auth/naver/callback`

## 내 컴퓨터에서 실행

```bash
npm install
npm run dev     # http://localhost:8888
npm test        # 발급 → 사용 → 골든타임 → 30일 안부 흐름 자동 점검
```

## 구조

- `site/` 화면 (HTML·CSS·JS)
- `netlify/lib/` 업무 규칙 (`logic.mjs`), 서버 주소 처리 (`api.mjs`), 문자·알림톡 (`messaging.mjs`), 저장소 (`db.mjs`), 체험 데이터 (`seed.mjs`)
- `netlify/functions/api.mjs` 서버, `scheduler.mjs` 10분마다 예약 메시지 발송
