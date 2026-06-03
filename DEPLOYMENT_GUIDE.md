# 운영 서버(본방) 배포 가이드

본 프로젝트를 운영 서버(Production)에 배포할 때 사용할 수 있는 두 가지 방식(순수 도커, 도커 컴포즈)의 필요 파일과 절차를 정리한 문서입니다.

---

## 1. 순수 도커(Docker CLI)를 이용한 배포 방식

설정 파일 없이 터미널 명령어만으로 컨테이너를 직접 실행하는 방법입니다.

### ✅ 필요 파일
운영 서버에 다음 파일(또는 프로젝트 전체)이 업로드되어 있어야 합니다.
1. `Dockerfile` (컨테이너 이미지를 빌드하기 위한 설명서)
2. `.dockerignore` (빌드 시 제외할 불필요한 파일 목록)
3. 전체 소스 코드 (또는 이미 빌드된 이미지를 Docker Registry를 통해 가져오는 경우 코드 불필요)

*(참고: 이미지를 로컬에서 빌드한 뒤 Docker Hub나 AWS ECR 등에 올린다면 서버에는 소스 코드 없이 이미지 다운로드 명령어만 있으면 됩니다.)*

### 🚀 배포 절차

**1) 이미지 빌드**
소스 코드가 있는 폴더에서 아래 명령어를 통해 도커 이미지를 생성합니다.
```bash
docker build -t youtube-download-app:latest .
```

**2) 기존 컨테이너 중지 및 삭제 (재배포 시)**
```bash
docker stop youtube-download-app || true
docker rm youtube-download-app || true
```

**3) 컨테이너 실행**
빌드된 이미지를 기반으로 컨테이너를 백그라운드(`-d`)에서 실행합니다. 포트는 `3000`번으로 연결합니다.
```bash
docker run -d \
  --name youtube-download-app \
  -p 3000:3000 \
  -e NODE_ENV=production \
  --restart unless-stopped \
  youtube-download-app:latest
```

---

## 2. 도커 컴포즈(Docker Compose)를 이용한 배포 방식 (권장)

복잡한 `docker run` 명령어를 `docker-compose.yml` 파일에 정의해두고 간편하게 배포하는 방법입니다.

### ✅ 필요 파일
운영 서버에 다음 파일들이 업로드되어 있어야 합니다.
1. `Dockerfile`
2. `.dockerignore`
3. **`docker-compose.yml`** (컨테이너 실행 옵션이 정의된 파일)
4. 전체 소스 코드

### 🚀 배포 절차

**1) 컨테이너 빌드 및 백그라운드 실행**
아래 명령어 한 줄이면 이미지가 없을 경우 자동으로 빌드(`--build`)하고 컨테이너를 실행(`-d`)합니다.
*(재배포를 할 때도 소스 코드를 최신화한 뒤 아래 명령어만 치면 알아서 빌드 후 기존 컨테이너를 새 컨테이너로 교체합니다.)*
```bash
docker-compose up -d --build
```

**2) 실행 상태 확인**
```bash
docker-compose ps
```

**3) 컨테이너 로그 확인 (문제 발생 시)**
```bash
docker-compose logs -f
```

**4) 컨테이너 완전히 종료 및 삭제할 때**
```bash
docker-compose down
```

---

## 💡 요약 및 추천
* 처음 셋팅할 때나 서버를 이전할 때 **도커 컴포즈**를 사용하는 것이 명령어 오타를 줄이고 향후 관리가 훨씬 수월하므로 **2번 방식을 강력히 권장**합니다.
