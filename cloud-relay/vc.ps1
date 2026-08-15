# vc.ps1 — 通过代理跑 vercel CLI（本机直连 api.vercel.com 会被 WAF 403，走 127.0.0.1:7890）
# 用法:  .\vc.ps1 whoami
#        .\vc.ps1 deploy --prod
#        .\vc.ps1 env ls
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args_)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:HTTP_PROXY  = 'http://127.0.0.1:7890'
$env:NODE_OPTIONS = "--require $root\proxy-inject.cjs"
$vc = Join-Path $root 'node_modules\.bin\vercel.cmd'
& $vc @Args_
exit $LASTEXITCODE
