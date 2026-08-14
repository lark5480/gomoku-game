# play-online.ps1 — Gomoku 联机一键通道（零部署）
# 双击 play-online.bat 即可：自动启动游戏服务 + Cloudflare 隧道，
# 抓到公网链接后复制到剪贴板。关掉本窗口 = 断开通道。

# 注意：这里不设置 $ErrorActionPreference='Stop'——cloudflared 把大量日志
# 写到 stderr，Windows PowerShell 5.1 会将其包装为 ErrorRecord，一旦 Stop
# 会在第一行日志处中断管道。所有错误路径都改为显式检查。

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$port = 8000
$cloudflared = Join-Path $root 'cloudflared.exe'

if (-not (Test-Path $cloudflared)) {
    Write-Host '错误：项目根目录找不到 cloudflared.exe。' -ForegroundColor Red
    Write-Host '请从 https://developers.cloudflare.com/cloudflared/ 下载后放到项目根目录。' -ForegroundColor Red
    pause
    exit 1
}

function Test-PortInUse([int]$p) {
    $listener = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    return [bool]$listener
}

# ---- 1. 游戏服务（npm start，独立最小化窗口） ----
$serverPid = $null
if (Test-PortInUse $port) {
    Write-Host ("端口 {0} 已有服务在运行，直接复用（结束对局后请手动关闭那个窗口）。" -f $port) -ForegroundColor Cyan
} else {
    $serverPid = (Start-Process -FilePath 'cmd.exe' `
            -ArgumentList '/c', 'npm start' `
            -WorkingDirectory $root `
            -WindowStyle Minimized `
            -PassThru).Id
    Write-Host '正在启动游戏服务（npm start）...' -ForegroundColor Cyan

    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        if (Test-PortInUse $port) { break }
    }
    if (-not (Test-PortInUse $port)) {
        Write-Host '错误：游戏服务启动失败，请确认已安装 Node.js 并可在本项目运行 npm start。' -ForegroundColor Red
        if ($serverPid) { Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue }
        pause
        exit 1
    }
    Write-Host '游戏服务已就绪。' -ForegroundColor Green
}

# ---- 2. Cloudflare 隧道（本窗口前台运行，关窗即断） ----
Write-Host '正在建立公网隧道（首次连接可能需要十几秒）...' -ForegroundColor Cyan
Write-Host ''

$url = $null
$recentLines = @()

& $cloudflared tunnel --url ("http://localhost:{0}" -f $port) 2>&1 | ForEach-Object {
    $line = [string]$_
    $recentLines = @($recentLines + $line) | Select-Object -Last 6

    if (-not $url -and $line -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
        $url = $matches[0]
        $url | clip
        Write-Host '============================================================' -ForegroundColor Green
        Write-Host ('  对局链接（已自动复制到剪贴板）：' + $url) -ForegroundColor Green
        Write-Host '  直接粘贴发给朋友即可。' -ForegroundColor Green
        Write-Host '============================================================' -ForegroundColor Green
        Write-Host ''
        Write-Host '玩法：' -ForegroundColor Cyan
        Write-Host '  1. 双方都打开这个链接；' -ForegroundColor Cyan
        Write-Host '  2. 一方点“在线对战” → 创建房间，把 4 位房间码告诉对方；' -ForegroundColor Cyan
        Write-Host '  3. 另一方输入房间码加入，即可开战。' -ForegroundColor Cyan
        Write-Host ''
        Write-Host '注意：对局期间保持本机开机、不要睡眠；关掉本窗口即断开通道。' -ForegroundColor Yellow
        Write-Host ''
    } elseif (-not $url -and $line.Trim().Length -gt 0) {
        # 隧道建立过程的日志（cloudflared 主要写到 stderr）
        Write-Host $line -ForegroundColor DarkGray
    }
}

# ---- 3. 收尾：隧道退出后关掉本次启动的游戏服务 ----
if ($serverPid) {
    Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
}

if (-not $url) {
    Write-Host ''
    Write-Host '隧道未能建立（可能网络不通或被杀软拦截）。最后输出：' -ForegroundColor Red
    $recentLines | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
    Write-Host ''
    Write-Host '提示：确认能正常上网后重试；或手动执行下面命令排查：' -ForegroundColor Yellow
    Write-Host ("  .\cloudflared.exe tunnel --url http://localhost:{0}" -f $port) -ForegroundColor Yellow
} else {
    Write-Host ''
    Write-Host '联机通道已关闭。' -ForegroundColor DarkGray
}
