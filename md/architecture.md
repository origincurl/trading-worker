# Worker 아키텍처

> BE 프로젝트와 코드 스타일·계층 구조를 통일한다. 차이는 워커 고유 요소(역할 분리, 다양한 트리거, 메시지 버스, 다중 배포 토폴로지)에 한정한다.

---

## 1. 범위와 책임

### 워커가 하는 일
- **collector**: 3rd-party API/WS에서 시장 데이터/종목 정보 수집 → 정규화 → 영속화 + 라이브 채널 publish
- **calculator**: 영속화된 데이터 기반 지표 연산 → 영속화
- **executor**: 승인된 주문/취소/수정 요청을 계좌 credential로 증권사에 전송 → 주문 상태 publish
- **tracker**: 계좌 잔고/포지션/체결 stream 추적 → 계좌·체결 스냅샷 영속화
- **detector**: 리스크 + 정보 + 지표 조합 → 경보 생성
- **notifier**: signal/decision/order/alert 이벤트 소비 → notification outbox dispatch

### 워커가 하지 않는 일
- FE 직접 통신 (HTTP/WS 모두 금지)
- 사용자 인증 / 권한 / 계좌 소유권 판정
- credential의 권위 소유 (BE가 lease로 발급)
- 전략·리스크 정책의 권위 소유 (BE의 read-only 스냅샷만 소비)

### load-bearing 규칙
1. **FE는 BE를 통해서만 워커 산출물에 접근한다.** 워커는 FE에 직접 노출되지 않는다.
2. **platform credential 은 역할별로 격리한다.** 특히 executor 전용 key 는 collector key 와 절대 공유 금지 (rate limit 충돌 방지).
3. **워커는 stateless 하게 배포한다.** 모든 진실의 원천은 DB와 메시지 버스. 한 역할을 N개 팟에 분산해도 동작해야 한다.

### 용어
- vendor : 외부 시스템을 도메인 관점으로 추상화한 interface 와 그 impl 계층. (예: BrokerageVendor, NotifyVendor)
- platform : 실제 3rd-party 제공자 (예: kiwoom, korea-invest, slack, gmail, aligo). 한 vendor 가 여러 platform 의 impl 을 가진다.
- BE 의 WebSocket gateway 와 이름이 겹치는 것을 피하기 위해 본 계층 이름을 vendor 로 둔다.

---

## 2. 기술 스택

BE와 동일.

- **런타임**: Node.js 20 LTS
- **프레임워크**: NestJS 11
- **언어**: TypeScript 5.7+
- **패키지 매니저**: Yarn 1.x
- **DB**: PostgreSQL
- **캐시·pubsub·큐**: Redis (ioredis, BullMQ)
- **검증**: class-validator / class-transformer
- **테스트**: Jest + ts-jest
- **API 문서**: `@nestjs/swagger` (`/docs`, ops 전용)
- **컨테이너**: Docker

---

## 3. 역할(Role) 정의

각 역할은 독립된 NestJS Module로 구현하고, `ROLES` 환경변수로 활성화 모듈을 선택한다.

| Role | Platform 의존 | 주요 트리거 | 주요 산출 |
|---|---|---|---|
| collector | O | scheduler (cron/interval), platform WS subscriber | DB write + `live:*` pubsub |
| calculator | X | queue consumer (closed candle 등 upstream 이벤트), scheduler | DB write + `derived:*` pubsub |
| executor | O | scheduler / queue consumer | 주문/취소/수정 broker 호출 + `order:*` pubsub |
| tracker | O | scheduler, platform WS subscriber (체결 stream) | account balance / position / fill DB write + `account:*` / `order:*` pubsub |
| detector | X | queue consumer, scheduler | alert DB write + `alert:*` pubsub |
| notifier | O (notify only) | queue consumer, scheduler | notification outbox / delivery DB write + 외부 알림 채널 호출 |

### 역할 분리 원칙
- calculator/detector 는 platform 코드와 의존성을 갖지 않는다 (external 모듈 import 금지). 컴파일타임에 격리.
- collector/executor/tracker/notifier 는 vendor 계층을 통해서만 외부 호출. apiClient 직접 호출 금지.
- collector 는 collector credential pool만 사용한다. executor/tracker 는 account-scoped executor credential pool을 공유한다.
- notifier 는 Notify vendor만 사용하고 BrokerageModule을 import하지 않는다.
- 역할 간 직접 함수 호출 금지. 통신은 **DB + Redis Streams/BullMQ** 로만.

---

## 4. 배포 토폴로지

### 단일 코드베이스, 다중 배포
- 모든 역할은 한 코드베이스에 존재
- `main.ts`는 `ROLES` env를 읽어 해당 역할 모듈만 `AppModule`에 동적 import
- 예: `ROLES=collector` / `ROLES=collector,calculator` / `ROLES=executor` 등

### 토폴로지 패턴
| 패턴 | 설정 | 용도 |
|---|---|---|
| 단일 역할 단일 팟 | `ROLES=executor`, replica=1 | 초기, 저부하 |
| 다중 역할 단일 팟 | `ROLES=collector,calculator,detector,notifier` | 자원 절약, 운영 단순화 |
| 단일 역할 다중 팟 (샤딩) | `ROLES=collector`, replica=N, `SHARD_INDEX`/`SHARD_COUNT` | 부하 분산 |
| 역할별 다중 팟 | 역할별 deployment 분리 | 표준 production |

### 샤딩 규약
- collector/calculator의 종목 분배는 `(hash(symbol) % SHARD_COUNT == SHARD_INDEX)` 결정론적 분할
- executor/tracker의 account 분배도 동일 방식 (`hash(accountId) % N`)
- 샤딩 책임은 각 역할 모듈의 entry layer (scheduler/consumer)에서 결정

---

## 5. 모듈 구조

```
src/
  main.ts                        # ROLES env로 활성 모듈 동적 부팅
  app.module.ts                  # role 모듈 conditional import
  config/                        # 검증된 env (role / db / redis / platform)
  common/                        # 에러, exception filter, shard util, serializer
  health/                        # /live /ready /health (HTTP ops)

  roles/
    collector/
      collector.module.ts
      trigger/                   # scheduler, platform-ws-subscriber, queue-consumer
      usecase/
      service/
      repository/                # interface + impl
    calculator/
      calculator.module.ts
      trigger/
      usecase/
      service/
      repository/
    executor/
      executor.module.ts
      trigger/
      usecase/
      service/
      repository/
    tracker/
      tracker.module.ts
      trigger/
      usecase/
      service/
      repository/
    detector/
      detector.module.ts
      trigger/
      usecase/
      service/
      repository/
    notifier/
      notifier.module.ts
      trigger/
      usecase/
      service/
      repository/

  shared/
    bus/                         # Redis pub/sub publisher, Streams producer/consumer, BullMQ wrapper
    cache/                       # Redis key schema, latest writer 등
    persistence/                 # 공용 entity, base repository
    model/                       # 공용 model
    mapper/                      # 공용 mapper

  external/                      # BE 규칙과 동일 (vendor interface + platform 구현체)
    brokerage/
      vendor/
        brokerage.vendor.ts
      service/
        brokerage-vendor.resolver.ts
      platforms/
        kiwoom/
          contract/
            request/
            response/
          kiwoom-brokerage.vendor.ts
          kiwoom.api-client.ts
        korea-invest/
          contract/
            request/
            response/
          korea-invest-brokerage.vendor.ts
          korea-invest.api-client.ts
      brokerage.module.ts
      brokerage.token.ts
    notify/                      # detector 용 알림 (slack/email/sms)
      vendor/
      platforms/
      notify.module.ts
      notify.token.ts

  admin/                         # HTTP 컨트롤러 (ops 전용)
    controller/
    usecase/
    dto/

migrations/                      # 수동 SQL
```

### 경로 별칭
```
@common, @config, @health, @shared, @external, @admin
@roles/collector, @roles/calculator, @roles/executor, @roles/detector
```

---

## 6. 계층별 역할

BE 의 `controller > usecase > service > repository/vendor` 흐름을 유지한다.
워커는 진입점이 다양하므로 **controller 자리에 여러 종류의 trigger** 가 들어간다.

### trigger (진입 계층)
HTTP 가 아닌 다른 이벤트를 받는 워커의 entry layer.

#### 종류
- **HttpController** — admin/ops HTTP 엔드포인트 전용. BE 규칙과 동일.
- **Scheduler** — `@nestjs/schedule` cron/interval. collector 정기 수집, EOD 집계 등.
- **QueueConsumer** — BullMQ Processor. 신뢰성 필요한 inter-role 작업 분배.
- **StreamConsumer** — Redis Streams consumer-group 구독. 손실 불가 이벤트 (체결, 시그널, 경보).
- **PubsubSubscriber** — Redis pub/sub 구독. 휘발 OK 이벤트 (시세 fan-out 에서 파생되는 trigger).
- **PlatformWsSubscriber** — platform WebSocket 프레임 핸들러. collector/executor 에만 존재.

#### 역할
- 트리거 입력을 dto로 검증
- usecase만 호출
- 비즈니스 로직 작성 금지
- 샤딩 결정 (필요 시): `shouldHandle(key)` 가드 후 usecase 호출

#### 사용 모델
- dto

#### 파일 규칙
- 한 파일에 한 트리거. `xxx.scheduler.ts`, `xxx.consumer.ts`, `xxx.subscriber.ts`, `xxx.controller.ts`
- 트리거 종류가 다르면 폴더 분리: `trigger/scheduler/`, `trigger/consumer/`, `trigger/subscriber/`, `trigger/controller/`

### usecase
BE와 동일.

- 트리거와 service 사이의 애플리케이션 로직
- service만 호출
- 한 파일 한 usecase. `execute` 함수 단 한개
- dto → model 변환, model → dto 변환은 usecase에서

### service
BE와 동일.

- 도메인 중심 비즈니스 로직
- model 기준으로 처리
- repository / vendor 만 호출
- 정책/검증 service 는 service → service 호출 허용 (BE 규칙 동일)

### repository
BE와 동일.

- DB 접근 전용
- interface + impl 필수
- model ↔ entity 변환은 impl 내부
- entity 외부 노출 금지

### vendor / apiClient / contract
BE 와 동일.

- `external/{domain}/vendor` — interface
- `external/{domain}/platforms/{platform}` — vendor impl, apiClient, contract
- vendor interface 는 model 기준
- contract 는 platform 폴더 밖으로 노출 금지

#### Kiwoom token recovery invariant

Kiwoom collector REST/WS 경로는 stale access token을 영구 credential failure로
바로 확정하지 않는다. Token rejection으로 판단되는 응답을 받으면 다음 순서로
1회 self-heal을 시도한다.

1. 현재 credential의 access-token cache를 invalidate한다.
2. 동일 token supplier를 다시 호출해 fresh token을 받는다.
3. 새 token이 비어 있거나 이전 token과 같으면 retry하지 않는다.
4. 새 token이 다르면 동일 요청을 한 번만 retry한다.
5. retry도 실패하거나 token rejection이 아니면 기존 failure path로 넘어간다.

REST는 HTTP non-2xx와 HTTP 200 + non-zero `return_code` 양쪽에서 이 정책을
적용한다. WS는 LOGIN ack failure가 token rejection으로 보일 때 같은 socket에서
LOGIN을 한 번 더 보낸다. 같은 socket retry가 broker에서 거부되더라도 timeout /
failure path가 기존 reconnect loop로 회수하므로 안전한 실패가 된다.

`TOKEN` source의 credential success는 appKey/appSecret 유효성에 대한 강한
신호로 취급한다. 따라서 stale token 때문에 찍힌 REST/WS `AUTH_FAILED` 또는
`COOLDOWN`은 token 발급 성공 시 `ACTIVE`로 회복한다. 단 endpoint-specific
permission revoke가 존재하는 broker 정책에서는 `AUTH_FAILED -> ACTIVE` 진동이
가능하므로 운영 metric/alert로 감시해야 한다.

#### Chart catchup retry invariant

Chart catchup은 logical error를 successful BullMQ job으로 숨기지 않는다.
`ProcessChartCatchupUsecase`는 worker completion event를 먼저 publish한 뒤,
`result.errors.length > 0`이면 `IntegrationError`를 throw하여 BullMQ failed /
retry 상태로 올린다.

Catchup request dedupe의 1차 책임은 BE의 deterministic requestId Redis lock이다.
Worker subscriber는 BullMQ `jobId=requestId`를 사용하지 않는다. 그래야 한 번
completed/failed 된 gap도 lock expiry 이후 다시 enqueue될 수 있다.

현재 chart catchup queue 정책:

- `attempts: 3`
- exponential backoff 1s
- BE catchup request lock TTL: 60s

이 조합은 일반 stale-token / transient REST failure를 lock TTL 안에서 재시도하기
위한 값이다. Worker REST latency P99가 커지면 BE lock TTL을 120s 이상으로
조정해야 한다. Candle write는 `(symbol, market, source, bucket_start)` 계열의
idempotent key 충돌 처리를 전제로 한다.

남은 운영 follow-up:

- WS LOGIN retry spec은 유지한다. REST retry와 동일하게 invalidate, token supplier
  2회, stale/fresh LOGIN 2회, auth failure 미기록, WS success 기록을 검증한다.
- Completion consumer/dashboard를 추가할 때는 `requestId` 기준 last-write-wins
  또는 attempt-aware dedupe를 적용한다. attempts=3이면 같은 requestId completion
  event가 최대 3회 publish될 수 있다.
- `AUTH_FAILED -> ACTIVE` transition rate metric/alert를 추가해 false recovery loop를
  감지한다.
- Catchup failedReason을 운영 dashboard에 노출한다.

### bus (워커 고유)
역할 간 메시지 송수신 전용 계층. service에서 사용한다.

- **BusPublisher** — pubsub publish (휘발) / streams produce (영속)
- **BusConsumer** — trigger 계층에서 wrap. service에서 직접 import 금지.
- 매체 추상화: 코드는 `BusPublisher` 인터페이스에 의존. Redis 구현체가 기본. NATS/Kafka 전환 시 impl만 교체.
- payload는 항상 별도 정의된 **event** 타입 (`xxx.event.ts`) 사용. model을 그대로 publish하지 않음.

---

## 7. 데이터 모델 계층

BE와 동일하게 `dto / model / entity / contract`. 추가로 워커에서는 **event** 타입을 둔다.

### event
역할 간 메시지 버스를 통해 주고받는 데이터 구조.

#### 규칙
- `src/shared/bus/event/` 또는 도메인 하위 `event/` 폴더
- 이름에 반드시 `Event` 붙이기 (`CandleClosedEvent`, `SignalDetectedEvent`, `OrderFilledEvent`)
- model을 직접 publish하지 않음. event는 wire 포맷 (직렬화 가능, 안정적 스키마)
- model ↔ event 변환은 별도 mapper 파일 (`xxx.event-mapper.ts`)
- 버전 필드 권장 (`schemaVersion`)
- consumer는 idempotency key로 동일 event 재처리 방지 (BullMQ jobId, Streams entryId 활용)

### dto / model / entity / contract
BE 규칙 그대로 적용. `# 파일 규칙` 섹션도 BE와 동일.

---

## 8. 통신 패턴

### 매체 선택 가이드

| 용도 | 매체 | 이유 |
|---|---|---|
| 시세, 호가창 push | Redis Pub/Sub | 휘발 OK, 처리량 큼, 다음 tick이 곧 옴 |
| 자산 스냅샷 push | Redis Pub/Sub | 휘발 OK, 다음 스냅샷이 곧 옴 |
| 주문/체결 이벤트 | Redis Streams | 손실 불가, replay 필요할 수 있음 |
| 경보 이벤트 | Redis Streams | 손실 불가 |
| 시그널 → executor 분배 | BullMQ | 재시도/지연/우선순위 필요 |
| calculator 작업 분배 | BullMQ | concurrency 제어 + 재시도 |
| ops 동기 호출 | HTTP | k8s probe, credential 테스트 등 |

### 데이터 흐름

```
[collector worker]
  platform WS / REST → service → repository (Postgres write)
                             → BusPublisher.publish(market.tick / market.orderbook)  → Redis pub/sub
                             → BusPublisher.produce(market.candle.closed)            → Redis Streams
                                                                ↓
[BE]                                                            ↓ consumer-group subscribe
  WS gateway ←─────────────── Redis pub/sub (시세) ←────────────┘
  FE ← WS                       Redis Streams (체결/시그널 등)
                                ↓
                                BE consumer → 검증/권한/persistence → FE WS fan-out
[calculator worker]
  Redis Streams (candle.closed) → StreamConsumer → usecase → service → repository (지표 write)
                                                                      → BusPublisher.produce(indicator.updated)

[executor worker]
  BullMQ (signal.detected) → QueueConsumer → usecase → service → BrokerageVendor (주문)
  platform WS (체결 stream)  → PlatformWsSubscriber → usecase → service → repository (체결 write)
                                                                    → BusPublisher.produce(order.filled)

[detector worker]
  Scheduler / Streams → trigger → usecase → service → NotifyVendor (slack/sms/email)
                                                    → BusPublisher.produce(alert.raised)
```

### FE 까지의 호가창 경로
```
platform → collector worker → Redis Pub/Sub → BE → WebSocket → FE
```
- collector는 BusPublisher만 호출. FE 라우팅을 알지 못함.
- BE는 모든 replica가 동일 채널 subscribe → 접속한 FE 클라이언트에 fan-out.
- BE에서 종목별 throttle/coalesce (10~30fps). FE 부담과 네트워크 부담 감소.
- 종목 단위 토픽 분할 (`market.{env}.orderbook.{symbol}`). BE는 활성 FE가 보는 종목만 동적 subscribe.

### idempotency
- Pub/Sub: 휘발성. 손실 허용. consumer는 sequence/timestamp로 out-of-order 감지.
- Streams: `(provider, marketEnv, symbol, intervalType, bucketStart)` 같은 도메인 key로 BE측 중복 제거. consumer-group + entryId로 재처리 보장.
- BullMQ: job key (`signalId` 등) 명시. 중복 enqueue 시 같은 job.

---

## 9. HTTP 진입점 (ops 전용)

워커는 HTTP listener를 연다. **단, FE-facing이 아니라 운영용**.

| Method | Path | 용도 |
|---|---|---|
| GET | `/live` | k8s liveness |
| GET | `/ready` | k8s readiness (DB/Redis/platform 연결 확인) |
| GET | `/health` | uptime, role, shard info |
| GET | `/metrics` | Prometheus scrape |
| POST | `/admin/credentials/test` | credential 동기 검증 (BE 호출) |
| POST | `/admin/jobs/trigger` | 수동 작업 트리거 |
| GET | `/docs` | Swagger (내부망 전용) |

### 규칙
- 내부망 only. ingress를 통한 외부 노출 금지.
- BE가 호출. FE는 절대 직접 호출 안함.
- controller / usecase / dto는 BE 규칙 그대로 적용.
- `admin/` 폴더 하위에 격리.

---

## 10. Platform / Credential 격리

### 격리 원칙
- collector 용 key 와 executor 용 key 는 **반드시 분리**.
- 같은 platform 이라도 collector vendor 와 executor vendor 는 별도 토큰으로 주입.
- rate limit 이 빠듯한 executor 호출 경로에 collector 트래픽이 섞이지 않도록 보장.

### DI 구조
```
external/brokerage/
  brokerage.token.ts
    COLLECTOR_BROKERAGE_VENDOR = Symbol('COLLECTOR_BROKERAGE_VENDOR')
    EXECUTOR_BROKERAGE_VENDOR  = Symbol('EXECUTOR_BROKERAGE_VENDOR')
  brokerage.module.ts
    providers: [
      { provide: COLLECTOR_BROKERAGE_VENDOR, useFactory: ... uses COLLECTOR_* env },
      { provide: EXECUTOR_BROKERAGE_VENDOR,  useFactory: ... uses EXECUTOR_* env },
    ]
```

- collector service 는 `@Inject(COLLECTOR_BROKERAGE_VENDOR)`
- executor service 는 `@Inject(EXECUTOR_BROKERAGE_VENDOR)`
- platform 별 rate limiter 도 토큰별로 독립 인스턴스

### Credential 출처
- 정적 credential: env 변수 (`KIWOOM_COLLECTOR_APP_KEY`, `KIWOOM_EXECUTOR_APP_KEY`, ...)
- 동적 credential: BE control-plane에서 HMAC-signed lease로 발급 (chart backfill 등 SPEC.md Phase 7.8 패턴 차용)
- lease bundle은 **메모리 전용**. Redis/PG/로그/메트릭/에러 메시지/event payload 진입 금지.

---

## 11. 환경 변수

BE 규칙 그대로: UPPER_SNAKE_CASE, `.env`/`.env.local`/`process.env.XXX` 모두 동일.

### 공통
| Variable | Required | 비고 |
|---|---|---|
| `NODE_ENV` | yes | `development` / `production` |
| `ROLES` | yes | CSV. `collector,calculator,executor,detector` 중 활성화할 것 |
| `WORKER_INSTANCE_ID` | yes | 인스턴스 unique 식별자 |
| `SHARD_INDEX` | conditional | 샤딩 시 필수. 0-based |
| `SHARD_COUNT` | conditional | 샤딩 시 필수. `SHARD_INDEX < SHARD_COUNT` 강제 |
| `PORT` | no (기본 4002) | HTTP ops 포트 |

### Persistence / Bus
| Variable | Required | 비고 |
|---|---|---|
| `WORKER_DATABASE_URL` | yes | Postgres |
| `REDIS_URL` | yes | pubsub / streams / bullmq 공용 |
| `REDIS_KEY_PREFIX` | no (기본 `worker`) | 키 네임스페이스 |

### Platform (예: Kiwoom)
| Variable | Required | 비고 |
|---|---|---|
| `KIWOOM_MARKET_ENV` | yes | `mock` / `production` |
| `KIWOOM_COLLECTOR_APP_KEY` | conditional | collector role 활성 시 |
| `KIWOOM_COLLECTOR_APP_SECRET` | conditional | 로깅 금지 |
| `KIWOOM_EXECUTOR_APP_KEY` | conditional | executor role 활성 시. collector key와 반드시 다름 |
| `KIWOOM_EXECUTOR_APP_SECRET` | conditional | 로깅 금지 |
| `KIWOOM_WS_URL` | conditional | hostname이 MARKET_ENV와 매치 |
| `KIWOOM_REST_URL` | conditional | hostname이 MARKET_ENV와 매치 |

### BE 연동
| Variable | Required | 비고 |
|---|---|---|
| `BE_CONTROL_PLANE_URL` | yes | credential lease / signal report 등 |
| `BE_HMAC_SECRET` | yes | 로깅 금지 |

mock/production은 별도 인스턴스로 배포. 한 프로세스 내 환경 혼합 금지.

---

## 12. 파일 규칙

BE 규칙 + 워커 고유 항목.

- controller, usecase, service, repository, vendor, apiClient, dto, model, mapper, entity, contract: BE 규칙 동일
- **trigger**: 종류별 폴더 분리. 한 파일 한 트리거
  - `roles/{role}/trigger/scheduler/xxx.scheduler.ts`
  - `roles/{role}/trigger/consumer/xxx.consumer.ts`
  - `roles/{role}/trigger/subscriber/xxx.subscriber.ts`
  - `roles/{role}/trigger/controller/xxx.controller.ts` (있을 경우)
- **event**: `xxx.event.ts`. `Event` 접미사
- **event-mapper**: `xxx.event-mapper.ts`. model ↔ event 변환

---

## 13. 비협상 사항

- 워커는 FE에 직접 노출되지 않는다 (HTTP ops endpoint 포함 모두 내부망)
- 워커는 인증/권한/credential의 권위 소유자가 아니다 (BE가 발급, 워커는 소비)
- collector key와 executor key는 절대 공유하지 않는다
- calculator / detector 는 external/ 의 platform 종속 코드 (vendor impl, apiClient, contract) 를 import 하지 않는다
- 역할 간 직접 함수 호출 금지. DB + 메시지 버스로만 통신
- 토큰·시크릿·credential·lease는 절대 로깅 금지. `redactSecrets` 강제
- event payload에 credential 자료 진입 금지
- mock / production은 별도 프로세스로 배포 (env 혼합 금지)
- Redis pub/sub은 실시간 fan-out 전용, replay 소스 아님. 영속성 필요하면 Streams 사용
- 워커는 stateless하게 설계 (모든 상태는 DB / Redis에 위임)
