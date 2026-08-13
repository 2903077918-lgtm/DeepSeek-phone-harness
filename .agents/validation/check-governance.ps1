param([string]$Root = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$required = @('AGENTS.md','docs/ai-governance/WORKFLOW.md','.agents/project-profile.json','.agents/skills-index.md','.agents/task-templates/task.md')
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Root $_)) })
if ($missing.Count -gt 0) { $missing | ForEach-Object { Write-Error "Missing: $_" }; exit 1 }
Write-Output "Governance baseline OK ($($required.Count) files checked)."
