# YouTube 다운로더 관측 가능성(Observability) 시스템 사용 가이드

본 프로젝트에 구성된 OpenTelemetry 기반 모니터링 시스템(Jaeger, Prometheus, Grafana)의 구체적인 활용법을 정리한 문서입니다. 

실제 애플리케이션 트래픽이 발생했을 때 각각의 도구에서 어떤 데이터를 확인하고 분석할 수 있는지 단계별 가이드와 유용한 쿼리 예시를 제공합니다.

---

## 🚦 사전 준비: 트래픽 발생시키기
수집된 데이터를 확인하려면 먼저 모니터링 대상인 애플리케이션을 기동하고 가짜/실제 트래픽을 발생시켜야 합니다.

1. **서비스 빌드 및 전체 스택 기동**
   ```bash
   docker compose up -d --build
   ```
2. **애플리케이션 접속 및 다운로드 실행**
   - [http://localhost:3100](http://localhost:3100)에 접속하여 유튜브 링크를 입력하고 분석([Analyze])을 진행합니다.
   - 분석 결과가 나타나면 **[MP3]** 또는 **[720p / 1080p]** 다운로드 버튼을 1~2회 클릭하여 실제 파일 다운로드 연산을 발생시킵니다.
   - (의도적인 에러 관측을 위해 잘못된 유튜브 URL을 넣고 다운로드를 시도해보는 것도 좋습니다.)

---

## 🔍 1. Jaeger (분산 추적 - Trace)
Jaeger는 사용자의 요청이 시작되어 서버 내부의 복잡한 로직 및 자식 프로세스로 전파되는 전체 과정을 폭포수 모양의 타임라인(Span)으로 시각화해 줍니다.

* **접속 주소**: [http://localhost:16686](http://localhost:16686)

### 💡 주요 사용법 및 흐름 분석
1. **Trace 검색 방법**
   - Jaeger 왼쪽 메뉴의 **Service** 드롭다운에서 `youtube-downloader`를 선택합니다.
   - **Operation** 드롭다운에서 분석을 원하는 연산을 선택합니다:
     - `api-download-mp3-post`: MP3 다운로드 요청 처리 전체 Span
     - `yt-dlp-execution`: 백엔드 내부에서 `yt-dlp` 자식 프로세스가 작동한 Span
   - 하단의 **[Find Traces]** 버튼을 클릭하여 수집된 트레이스 리스트를 불러옵니다.
2. **상세 병목 분석**
   - 검색된 트레이스 중 하나를 클릭하면 상세 타임라인이 펼쳐집니다.
   - **전체 실행 시간 분석**: API 진입 시점부터 다운로드가 완료될 때까지 걸린 전체 시간 중, 실제 `yt-dlp` 동작(`yt-dlp-execution`)이 차지하는 비율을 한눈에 파악해 병목 여부를 검증할 수 있습니다.
   - **태그 정보 확인**: `yt-dlp-execution` Span을 클릭해 열어보면 아래의 태그 속성이 기록되어 있습니다:
     - `yt-dlp.url`: 다운로드 대상 유튜브 주소
     - `yt-dlp.flags`: 실행 시 넘어간 커맨드라인 옵션 객체
3. **에러 및 예외 모니터링**
   - 다운로드 중 에러(예: 503 Rate Limiting, 잘못된 URL 등)가 발생하면 Span 오른쪽에 **빨간색 느낌표 아이콘**이 표시됩니다.
   - 해당 Span을 클릭하고 `Logs` 섹션을 펼치면 에러 메시지와 함께 자바스크립트의 **Stack Trace**가 기록되어 있어 어느 라인에서 실패했는지 바로 디버깅이 가능합니다.

---

## 📊 2. Prometheus (메트릭 지표 - Metric)
Prometheus는 다운로드 성능 지표나 요청 횟수 등 정량적인 시계열 수치 데이터를 수집하고 쿼리할 수 있는 도구입니다.

* **접속 주소**: [http://localhost:9090](http://localhost:9090)

### 💡 유용한 PromQL (Prometheus 쿼리) 예시
상단 검색창(Expression)에 아래의 쿼리를 입력하고 **[Execute]** 버튼을 누른 뒤 **[Graph]** 탭을 클릭하여 시각적으로 모니터링할 수 있습니다.

1. **총 다운로드 요청 카운트 누적값**
   ```promql
   youtube_download_download_requests_total
   ```
2. **포맷(MP3 vs MP4)별 다운로드 요청 비율 (그룹화)**
   ```promql
   sum(youtube_download_download_requests_total) by (format)
   ```
3. **성공/실패 여부별 요청 건수 분기**
   ```promql
   sum(youtube_download_download_requests_total) by (status)
   ```
4. **최근 5분 동안의 초당 평균 다운로드 처리 시간 (평균 지연 시간)**
   - 다운로드 소요 시간 히스토그램의 합(`sum`)을 카운트(`count`)로 나누어 평균 속도를 구합니다.
   ```promql
   rate(youtube_download_download_duration_seconds_sum[5m]) / rate(youtube_download_download_duration_seconds_count[5m])
   ```

---

## 🎨 3. Grafana (통합 모니터링 대시보드)
Grafana는 Prometheus의 메트릭 차트와 Jaeger의 분산 추적 링크를 한곳에 아름답게 모아 대시보드로 시각화하는 시각화 서버입니다.

* **접속 주소**: [http://localhost:3200](http://localhost:3200)
* **초기 계정**: `admin` / `admin` (비밀번호 변경 요청 시 Skip 가능)

### 💡 Grafana 데이터 소스 연동 및 대시보드 구성법

#### 단계 1: Prometheus 데이터 소스 등록
1. Grafana 메인 왼쪽 메뉴에서 **Connections** -> **Data sources**로 이동합니다.
2. **[Add data source]**를 클릭하고 **Prometheus**를 선택합니다.
3. **Connection URL**에 `http://prometheus:9090`을 입력합니다. (도커 기본 네트워크 내부 통신 주소)
4. 맨 밑으로 내려가 **[Save & test]** 버튼을 누릅니다. *"Successfully queried the Prometheus API."*라는 메시지가 뜨면 연결이 성공한 것입니다.

#### 단계 2: Jaeger 데이터 소스 등록
1. 동일하게 **[Add data source]**를 선택한 후 검색창에 **Jaeger**를 검색해 선택합니다.
2. **URL**에 `http://jaeger:16686`을 입력합니다.
3. 맨 밑으로 내려가 **[Save & test]** 버튼을 누릅니다.

#### 단계 3: 커스텀 대시보드 작성
1. 왼쪽 상단 `+` 버튼 -> **Dashboard** -> **[Add visualization]**을 누릅니다.
2. 데이터 소스로 **Prometheus**를 선택합니다.
3. **Metrics browser** 검색창에 위의 PromQL 예제(`youtube_download_download_requests_total` 등)를 입력합니다.
4. 우측 설정창에서 차트의 형태(Line chart, Bar gauge 등)를 고르고 패널 이름(예: *"Total Downloads"*)을 입력한 후 우측 상단의 **[Apply]**를 클릭해 완성합니다.
