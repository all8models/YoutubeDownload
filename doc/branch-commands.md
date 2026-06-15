# 브랜치 관리 명령어 정리

## 브랜치 생성 및 전환

```bash
# 새 브랜치 생성 + 전환
git checkout -b <브랜치명>

# 예: 멤버십 기능 브랜치
git checkout -b feature/membership-detection
```

## 현재 브랜치 확인

```bash
git branch          # 로컬 브랜치 목록 (* = 현재)
git branch -a       # 원격 포함 전체 목록
```

## 변경사항 커밋

```bash
# 상태 확인
git status

# 특정 파일만 스테이징
git add <파일경로1> <파일경로2> ...

# 전체 변경사항 스테이징 (추적 중인 파일만)
git add -u

# 커밋
git commit -m "커밋 메시지"
```

## 브랜치 푸시 (원격 저장소)

```bash
# 새 브랜치를 원격에 처음 올릴 때
git push origin <브랜치명>

# 예
git push origin feature/membership-detection
```

## 브랜치 전환 (되돌아가기)

```bash
# main 브랜치로 복원
git checkout main

# 작업 중인 브랜치로 다시 이동
git checkout feature/membership-detection
```

## 기존 브랜치로 돌아가 작업 재개

```bash
# 1. main 브랜치에서
git checkout feature/membership-detection

# 2. 필요하면 main의 최신 변경사항 병합
git merge main
```

## 활용 예시

```bash
# 1. 새 기능 브랜치 생성
git checkout -b feature/membership-detection

# 2. 작업 후 커밋
git add src/app/api/playlist/route.js src/app/globals.css
git commit -m "feat: 멤버십 한정 콘텐츠 차단"

# 3. 원격에 저장
git push origin feature/membership-detection

# 4. 원복이 필요하면 main으로 복원
git checkout main
```
