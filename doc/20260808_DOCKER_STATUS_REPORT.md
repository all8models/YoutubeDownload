# 도커 서비스 점검 및 정상화 보고서 (2026-08-08)

## 1. 개요
- **점검 일시**: 2026년 8월 8일
- **점검 목적**: 도커 컨테이너 기동 일부 실패 원인 파악 및 전체 서비스 정상화

---

## 2. 점검 및 원인 분석
1. **컨테이너 중지 상태**
   - `youtube-download-app`, `prometheus`, `otel-collector`, `jaeger`, `grafana` 등 [docker-compose.yml](file:///Users/windows/work/Util/YoutubeDownload/docker-compose.yml)에 정의된 모든 서비스 컨테이너가 이전 종료(`Exited`) 상태였습니다.
2. **독립 컨테이너 중지 이력**
   - 별도 CLI 명령어로 실행되었던 `infallible_taussig` (이미지 `youtubedownload-app:latest`) 컨테이너가 Exit Code 143으로 종료된 상태였습니다.

---

## 3. 조치 내용
- `docker compose up -d --build` 명령어를 수행하여 소스 코드 반영 및 최신 이미지를 리빌드한 후 백그라운드에서 모든 컴포즈 서비스를 재기동했습니다.

---

## 4. 서비스 기동 상태 및 검증 결과

| 서비스명 | 컨테이너 이름 | 호스트 포트 | 상태 | HTTP 응답 검증 |
| :--- | :--- | :--- | :--- | :--- |
| **App (Next.js)** | `youtube-download-app` | `3100` | **Up** | `200 OK` |
| **Grafana** | `grafana` | `3200` | **Up** | `302 Found` (정상 로그인 페이지 리다이렉트) |
| **Prometheus** | `prometheus` | `9090` | **Up** | `200 OK` |
| **Jaeger** | `jaeger` | `16686` | **Up** | `200 OK` |
| **OTEL Collector** | `otel-collector` | `4317`, `4318`, `8889` | **Up** | 정상 작동 |

---

## 5. 서비스 접속 URL 안내
- **메인 웹 앱**: [http://localhost:3100](http://localhost:3100)
- **Grafana 대시보드**: [http://localhost:3200](http://localhost:3200)
- **Prometheus UI**: [http://localhost:9090](http://localhost:9090)
- **Jaeger Tracing UI**: [http://localhost:16686](http://localhost:16686)

---

## 6. 주요 관리 명령어 참고
```bash
# 서비스 상태 확인
docker compose ps

# 로그 실시간 확인
docker compose logs -f

# 서비스 백그라운드 재기동 (빌드 포함)
docker compose up -d --build

# 서비스 전체 종료
docker compose down
```
