# start.ps1 — Cheddar 개발 환경 한 번에 켜기
# 순서: Docker Desktop  ->  DB+백엔드 컨테이너  ->  프론트 dev 서버
# (직접 실행하지 말고 start.bat 을 더블클릭하세요)

$root   = $PSScriptRoot
$server = Join-Path $root 'server'

Write-Host ''
Write-Host '=== Cheddar 시작 ===' -ForegroundColor Cyan

function Test-Docker {
    docker info *> $null
    return ($LASTEXITCODE -eq 0)
}

# 1) Docker 준비
if (Test-Docker) {
    Write-Host '[1/4] Docker 이미 켜져 있음' -ForegroundColor Green
} else {
    Write-Host '[1/4] Docker Desktop 시작 중...' -ForegroundColor Yellow
    $dockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dockerExe) {
        Start-Process $dockerExe
    } else {
        Write-Host '  ! Docker Desktop 실행 파일을 못 찾았어요. 직접 켜주세요.' -ForegroundColor Red
    }
    Write-Host '  Docker 엔진 준비 대기 중 (최대 2분)...'
    $waited = 0
    while (-not (Test-Docker)) {
        Start-Sleep -Seconds 3
        $waited += 3
        if ($waited -ge 120) {
            Write-Host '  ! Docker가 2분 안에 안 켜졌어요. Docker Desktop 확인 후 다시 실행해 주세요.' -ForegroundColor Red
            Read-Host '엔터를 누르면 종료'
            exit 1
        }
    }
    Write-Host '[1/4] Docker 준비 완료' -ForegroundColor Green
}

# 2) DB + 백엔드 컨테이너
#    --build: requirements.txt 가 바뀌었으면 패키지를 다시 설치한다.
#    (안 붙이면 옛 이미지를 그대로 써서 'ModuleNotFoundError' 가 날 수 있음)
Write-Host '[2/4] DB + 백엔드 컨테이너 켜는 중... (필요시 이미지 재빌드, 처음엔 좀 걸려요)' -ForegroundColor Yellow
Push-Location $server
docker compose up -d --build
$composeExit = $LASTEXITCODE
Pop-Location
if ($composeExit -ne 0) {
    Write-Host '  ! 컨테이너 시작 실패. 위 메시지를 확인해 주세요.' -ForegroundColor Red
    Read-Host '엔터를 누르면 종료'
    exit 1
}

# 컨테이너가 'Up' 이어도 그 안의 uvicorn 이 아직 안 떴거나 죽었을 수 있다.
# /health 가 200 을 줄 때까지 기다린 뒤에야 '준비 완료'.
Write-Host '  백엔드 서버 응답 대기 중...'
$backendReady = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $resp = Invoke-WebRequest 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { $backendReady = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
}
if (-not $backendReady) {
    Write-Host '  ! 백엔드가 응답하지 않아요. 로그를 확인하세요:' -ForegroundColor Red
    Write-Host '    cd server ; docker compose logs --tail=40 backend' -ForegroundColor Red
    Read-Host '엔터를 누르면 종료'
    exit 1
}
Write-Host '[2/4] 백엔드 준비 완료  ->  http://localhost:8000/docs' -ForegroundColor Green

# 3) 프론트 패키지
if (Test-Path (Join-Path $root 'node_modules')) {
    Write-Host '[3/4] 프론트 패키지 이미 설치됨' -ForegroundColor Green
} else {
    Write-Host '[3/4] node_modules 없음 -> npm install 실행...' -ForegroundColor Yellow
    Push-Location $root
    npm install
    Pop-Location
}

# 4) 프론트 dev 서버 + (준비되면) 브라우저 자동 열기
Write-Host '[4/4] 프론트 서버 시작...' -ForegroundColor Yellow
# 이전 실행에서 남은 프론트 서버가 있으면 먼저 정리.
# (안 그러면 더블클릭할 때마다 3001, 3002... 로 중복 실행돼 쌓인다)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*vite*' -and $_.CommandLine -like "*$root*" } |
    ForEach-Object {
        Write-Host "  이전 프론트 서버 정리 (PID $($_.ProcessId))" -ForegroundColor DarkGray
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { }
    }
# Vite 가 응답하기 시작하면 그때 브라우저를 연다.
# npm run dev 는 이 창을 계속 점유하므로, 브라우저 여는 일은 백그라운드 작업으로 떼어 둔다.
$browserJob = Start-Job {
    for ($i = 0; $i -lt 120; $i++) {
        try {
            Invoke-WebRequest 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2 | Out-Null
            break
        } catch { Start-Sleep -Milliseconds 500 }
    }
    Start-Process 'http://localhost:3000'
}
Write-Host ''
Write-Host '프론트 서버 실행 중. 준비되면 브라우저가 자동으로 열려요.' -ForegroundColor Cyan
Write-Host '끄려면 이 창에서 Ctrl+C.' -ForegroundColor Cyan
Write-Host '(DB/백엔드는 Docker에 계속 떠 있어요. 끄려면: cd server ; docker compose stop)' -ForegroundColor DarkGray
Write-Host ''
Push-Location $root
npm run dev
Pop-Location
