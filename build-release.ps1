# LookHome - 打包发布脚本（Windows）
# 生成 lookhome-release/ 目录与 lookhome-release.tar.gz
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $root "lookhome-release"
$tgz = Join-Path $root "lookhome-release.tar.gz"

Write-Host "==> 清理旧发布包"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
if (Test-Path $tgz) { Remove-Item $tgz -Force }

Write-Host "==> 检查构建产物"
if (-not (Test-Path (Join-Path $root "web\dist\index.html"))) {
  Write-Host "[错误] 缺少 web/dist 构建产物，请先执行: cd web && npm run build"
  exit 1
}

Write-Host "==> 组装发布目录"
New-Item (Join-Path $out "server") -ItemType Directory -Force | Out-Null
New-Item (Join-Path $out "web\dist") -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $root "server\*") (Join-Path $out "server") -Recurse -Force
Copy-Item (Join-Path $root "web\dist\*") (Join-Path $out "web\dist") -Recurse -Force
Copy-Item (Join-Path $root "package.json") $out -Force
Copy-Item (Join-Path $root "reset-password.js") $out -Force
Copy-Item (Join-Path $root "README-部署.md") (Join-Path $out "README-deploy.md") -Force

# install.sh 转 LF 换行（避免 Linux 执行错误）
$sh = Join-Path $out "install.sh"
$content = [System.IO.File]::ReadAllText((Join-Path $root "install.sh"))
[System.IO.File]::WriteAllText($sh, $content.Replace("`r`n", "`n"), [System.Text.UTF8Encoding]::new($false))

Write-Host "==> 打包 tar.gz"
tar -czf $tgz -C $out .
Write-Host ""
Write-Host "✅ 打包完成:"
Write-Host "    $tgz"
Write-Host "    $out"
Write-Host ""
Write-Host "部署: 上传 tar.gz 到服务器 -> tar -xzf -> cd lookhome-release -> bash install.sh"
