# phone-harness Agent 启动脚本
# 作用：从用户级环境变量加载 DEEPSEEK_API_KEY，再启动 Node Agent
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

# 1. 加载用户级 DEEPSEEK_API_KEY（headless 调用必需）
$userKey = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY', 'User')
if ($userKey) {
    $env:DEEPSEEK_API_KEY = $userKey
    Write-Host "[ok] DEEPSEEK_API_KEY 已从用户环境加载"
} else {
    Write-Warning "[warn] 用户环境未找到 DEEPSEEK_API_KEY，headless 调用可能失败"
}

# 2. 启动 Agent
Write-Host "[..] 启动 phone-harness Agent ..."
node "$here\agent.mjs"
