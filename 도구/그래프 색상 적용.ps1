$VaultRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$ObsidianDir = Join-Path $VaultRoot '.obsidian'
$SnippetDir = Join-Path $ObsidianDir 'snippets'

New-Item -ItemType Directory -Force -Path $ObsidianDir | Out-Null
New-Item -ItemType Directory -Force -Path $SnippetDir | Out-Null

$GraphConfig = [ordered]@{
  'collapse-filter' = $true
  search = ''
  showTags = $false
  showAttachments = $false
  hideUnresolved = $false
  showOrphans = $true
  'collapse-color-groups' = $false
  colorGroups = @(
    [ordered]@{ query = 'path:홈'; color = [ordered]@{ a = 1; rgb = 16119807 } },
    [ordered]@{ query = 'path:개인'; color = [ordered]@{ a = 1; rgb = 55295 } },
    [ordered]@{ query = 'path:일정'; color = [ordered]@{ a = 1; rgb = 16770669 } },
    [ordered]@{ query = 'path:학업'; color = [ordered]@{ a = 1; rgb = 9395455 } },
    [ordered]@{ query = 'path:"자산과 일"'; color = [ordered]@{ a = 1; rgb = 3014536 } },
    [ordered]@{ query = 'path:AI'; color = [ordered]@{ a = 1; rgb = 16732120 } },
    [ordered]@{ query = 'path:개발'; color = [ordered]@{ a = 1; rgb = 3112447 } },
    [ordered]@{ query = 'path:자동화'; color = [ordered]@{ a = 1; rgb = 49062 } },
    [ordered]@{ query = 'path:"취미/게임"'; color = [ordered]@{ a = 1; rgb = 16752412 } },
    [ordered]@{ query = 'path:"취미/유튜브"'; color = [ordered]@{ a = 1; rgb = 16726832 } },
    [ordered]@{ query = 'path:"취미/음악"'; color = [ordered]@{ a = 1; rgb = 12123965 } }
  )
  'collapse-display' = $true
  showArrow = $false
  textFadeMultiplier = 0.15
  nodeSizeMultiplier = 1.15
  lineSizeMultiplier = 1.05
  'collapse-forces' = $true
  centerStrength = 0.518713248970312
  repelStrength = 10
  linkStrength = 1
  linkDistance = 235
  scale = 0.6189069269586974
  close = $true
}

$GraphPath = Join-Path $ObsidianDir 'graph.json'
$GraphConfig | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $GraphPath

$AppearancePath = Join-Path $ObsidianDir 'appearance.json'
$Appearance = [ordered]@{
  accentColor = '#00e5ff'
  enabledCssSnippets = @('cyberpunk-graph')
}
$Appearance | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $AppearancePath

Write-Host 'Obsidian graph cyberpunk colors applied.'
