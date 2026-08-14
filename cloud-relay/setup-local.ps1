# cloud-relay/setup-local.ps1 —— 一键把本地 Supabase 连接写入 .dev.vars
# 用法：在 cloud-relay 目录运行  .\setup-local.ps1
# 作用：交互式让你粘贴 Supabase URL 与 service_role key（不回显），写入 .dev.vars，
#       然后可选启动 `wrangler dev` 连接验证。
# 安全：只在本地写文件，不打印明文密钥，不联网上传。

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$devVars = Join-Path $here '.dev.vars'

Write-Host "=== cloud-relay 本地连接配置（.dev.vars）===" -ForegroundColor Cyan
Write-Host "将粘贴两次：Supabase Project URL 与 service_role key（均不回显）`n"

# 1. URL
[Console]::Write('1/2 粘贴 Supabase Project URL（https://xxx.supabase.co）后回车: ')
$url = Read-Host
$url = $url.Trim().TrimEnd('/')
if ($url -notmatch '^https://.+\.supabase\.co$') {
    Write-Host 'URL 不像有效的 Supabase 地址（需 https://...supabase.co）。请检查后重试。' -ForegroundColor Yellow
    exit 1
}

# 2. service_role key（隐藏输入）
[Console]::Write('2/2 粘贴 service_role key（eyJ...）后回车: ')
$key = Read-Host

Write-Host "`n写入 .dev.vars ..." -ForegroundColor Cyan
$lines = @(
    "SUPABASE_URL=$url",
    "SUPABASE_SERVICE_ROLE_KEY=$key"
)
Set-Content -Path $devVars -Value $lines -Encoding UTF8
Write-Host "已写入: $devVars" -ForegroundColor Green

# 脱敏确认
$mask = ($url -replace 'https://','') 
$klen = $key.Length
Write-Host ("   SUPABASE_URL            -> " + $mask.Substring(0, [Math]::Min(20, $mask.Length)) + '…')
Write-Host ("   SERVICE_ROLE_KEY (长度) -> $klen （不回显明文）")

Write-Host "`n接下来可选：启动本地 Worker 验证数据库连接：" -ForegroundColor Cyan
$r = Read-Host "  启动 wrangler dev 验证?(y/n)"
if ($r -match '^[Yy]') {
    & 'npx' 'wrangler' 'dev'
} else {
    Write-Host "  跳过。之后手动运行: npx wrangler dev" -ForegroundColor Yellow
}
