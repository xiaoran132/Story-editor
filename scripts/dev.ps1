<#
.SYNOPSIS
    Story-editor 本地开发启动脚本（Windows / PowerShell）。

.DESCRIPTION
    一键拉起 Agent 服务（Python FastAPI，:8001）、Go 后端（Gin，:8080）与前端（Next.js，:3000）。
    - 每个服务在**独立窗口**运行，便于看日志、单独 Ctrl+C。
    - 启动前做前置检查：Go 工具链、Python 虚拟环境、依赖、.env、PostgreSQL 可达性、DeepSeek 密钥、Node 工具链与前端依赖。
    - 不负责启动 PostgreSQL（用户自备）；不可达时给出明确提示。

.PARAMETER Only
    只启动某个服务：all（默认）| agent | backend | frontend。

.PARAMETER SkipChecks
    跳过前置检查，直接启动（用于快速重启）。

.EXAMPLE
    .\dev.ps1                 # 检查并启动全部
    .\dev.ps1 -Only agent     # 只起 Agent 服务
    .\dev.ps1 -Only backend   # 只起 Go 后端
    .\dev.ps1 -Only frontend  # 只起前端
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'agent', 'backend', 'frontend')]
    [string]$Only = 'all',
    [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'

# ---------- 路径 ----------
$root      = Split-Path -Parent $PSScriptRoot   # 脚本在 scripts/，仓库根在上一级
$agentDir     = Join-Path $root 'agent'
$backDir   = Join-Path $root 'backend'
$frontDir  = Join-Path $root 'frontend'
$venvPy    = Join-Path $agentDir '.venv\Scripts\python.exe'
$agentPort    = 8001
$backPort  = 8080   # 仅用于提示，真实端口由 backend/.env 的 SERVER_PORT 决定
$frontPort = 3000

# ---------- 输出辅助 ----------
function Info($m) { Write-Host "[dev] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[dev] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[dev] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[dev] $m" -ForegroundColor Red; exit 1 }

# ---------- 工具函数 ----------
# 读取 .env 为哈希表（忽略注释/空行）
# 显式按 UTF-8 读取：PowerShell 5.1 在中文系统下会把无 BOM 的 UTF-8 当 GBK 解码，
# 导致含中文注释的 .env 乱码、注释行与 KEY 行粘连，进而读不到键值。
function Read-DotEnv($path) {
    $h = @{}
    if (Test-Path $path) {
        foreach ($line in [System.IO.File]::ReadAllLines($path, [System.Text.UTF8Encoding]::new($false))) {
            $t = $line.Trim()
            if ($t -and -not $t.StartsWith('#') -and $t.Contains('=')) {
                $kv = $t.Split('=', 2)
                $h[$kv[0].Trim()] = $kv[1].Trim()
            }
        }
    }
    return $h
}

# 快速 TCP 探测（带超时，避免 Test-NetConnection 卡顿）
function Test-Tcp($h, $p, $timeoutMs = 2000) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect($h, [int]$p, $null, $null)
        $hit = $iar.AsyncWaitHandle.WaitOne($timeoutMs)
        if ($hit -and $client.Connected) { $client.EndConnect($iar); $client.Close(); return $true }
        $client.Close(); return $false
    } catch { return $false }
}

# .env 不存在则从 .env.example 复制
function Ensure-EnvFile($example, $target) {
    if (-not (Test-Path $target)) {
        if (Test-Path $example) {
            Copy-Item $example $target
            Warn "已从 $(Split-Path $example -Leaf) 生成 $(Split-Path $target -Leaf)，请检查其中的配置。"
        }
    }
}

# 在独立窗口启动一个服务
function Start-InWindow($title, $workdir, $innerCmd) {
    $script = "`$host.UI.RawUI.WindowTitle = '$title'; Set-Location -LiteralPath '$workdir'; $innerCmd"
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-Command', $script) | Out-Null
    Ok "已在新窗口启动：$title"
}

# ================= 前置检查 =================
if (-not $SkipChecks) {
    Info '前置检查…'

    # Go
    if ($Only -in @('all', 'backend')) {
        if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
            Die 'go 未安装或不在 PATH。请安装 Go 1.25+ 后重试。'
        }
    }

    # agent 服务：虚拟环境 + 依赖 + .env + DeepSeek 密钥
    if ($Only -in @('all', 'agent')) {
        Ensure-EnvFile (Join-Path $agentDir '.env.example') (Join-Path $agentDir '.env')

        if (-not (Test-Path $venvPy)) {
            Warn '未发现 agent\.venv，正在创建虚拟环境并安装依赖（首次较慢）…'
            python -m venv (Join-Path $agentDir '.venv')
            & $venvPy -m pip install --upgrade pip | Out-Null
            & $venvPy -m pip install -r (Join-Path $agentDir 'requirements.txt')
            Ok '依赖安装完成。'
        }

        # DeepSeek 密钥检查（.env 与环境变量都没有才告警；服务仍可启动，但 /generate 会 502）
        $agentEnv = Read-DotEnv (Join-Path $agentDir '.env')
        $key = $agentEnv['DEEPSEEK_API_KEY']
        $fromEnv = (-not [string]::IsNullOrWhiteSpace($key)) -and ($key -ne 'your-key-here')
        $fromOs = -not [string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)
        if (-not ($fromEnv -or $fromOs)) {
            Warn 'DEEPSEEK_API_KEY 未配置（.env 与环境变量均无）——AI 生成接口会返回 502，请在 agent\.env 填入真实密钥。'
        }
    }

    # 后端：.env + PostgreSQL 可达性
    if ($Only -in @('all', 'backend')) {
        Ensure-EnvFile (Join-Path $backDir '.env.example') (Join-Path $backDir '.env')

        $backEnv = Read-DotEnv (Join-Path $backDir '.env')
        $dbHost = if ($backEnv['DB_HOST']) { $backEnv['DB_HOST'] } else { 'localhost' }
        $dbPort = if ($backEnv['DB_PORT']) { $backEnv['DB_PORT'] } else { '5432' }
        $dbName = if ($backEnv['DB_NAME']) { $backEnv['DB_NAME'] } else { 'story_editor' }
        if ($backEnv['SERVER_PORT']) { $backPort = $backEnv['SERVER_PORT'].TrimStart(':') }

        if (Test-Tcp $dbHost $dbPort) {
            Ok "PostgreSQL 可达（$dbHost`:$dbPort）。"
        } else {
            Warn "PostgreSQL 不可达（$dbHost`:$dbPort）——后端启动会失败。"
            Warn "  1) 确认 PostgreSQL 已启动；"
            Warn "  2) 确认数据库 '$dbName' 已存在（GORM 只建表，不建库）："
            Warn "       createdb -U $($backEnv['DB_USER']) $dbName    # 或用 pgAdmin/psql 创建"
        }
    }

    # 前端：Node 工具链 + 依赖 + .env.local
    if ($Only -in @('all', 'frontend')) {
        # 用 npm.cmd 显式调用 Windows 批处理垫片：直接 `npm` 可能被解析到 npm 随包附带的
        # 无扩展名 Unix 脚本，触发「选择打开方式」对话框。
        if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
            Die 'npm 未安装或不在 PATH。请安装 Node.js 18+ 后重试。'
        }
        Ensure-EnvFile (Join-Path $frontDir '.env.local.example') (Join-Path $frontDir '.env.local')
        if (-not (Test-Path (Join-Path $frontDir 'node_modules'))) {
            Warn '未发现 frontend\node_modules，正在安装前端依赖（首次较慢）…'
            Push-Location $frontDir
            npm.cmd install
            Pop-Location
            Ok '前端依赖安装完成。'
        }
    }
}

# ================= 启动 =================
Info "启动服务（Only=$Only）…"

if ($Only -in @('all', 'agent')) {
    $agentCmd = "& '$venvPy' -m uvicorn app.main:app --host 0.0.0.0 --port $agentPort --reload"
    Start-InWindow 'story-agent (:8001)' $agentDir $agentCmd
}

if ($Only -in @('all', 'backend')) {
    # 后端必须在 backend/ 下运行（LoadHTMLGlob 与 viper 配置路径依赖工作目录）
    Start-InWindow 'story-backend (:8080)' $backDir 'go run .'
}

if ($Only -in @('all', 'frontend')) {
    # 同上：用 npm.cmd 避免「选择打开方式」对话框。
    Start-InWindow 'story-frontend (:3000)' $frontDir 'npm.cmd run dev'
}

Write-Host ''
Ok '已拉起以下服务（各自独立窗口）：'
if ($Only -in @('all', 'agent'))     { Write-Host "  · Agent 服务 http://localhost:$agentPort/health" }
if ($Only -in @('all', 'backend'))  { Write-Host "  · Go 后端   http://localhost:$backPort  (API: /api/v1)" }
if ($Only -in @('all', 'frontend')) { Write-Host "  · 前端      http://localhost:$frontPort" }
Write-Host ''
Info '关闭对应窗口即可停止服务。'
