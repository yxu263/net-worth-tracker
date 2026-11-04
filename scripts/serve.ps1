# Serves the built app (out\) on http://localhost:<port>/ using Windows' built-in HTTP server.
# No Node.js, no admin rights, and localhost-only so Windows Firewall does not prompt.
param([int]$Port = 3000, [string]$Root = (Join-Path $PSScriptRoot "..\out"))

$Root = (Resolve-Path $Root).Path
$types = @{ ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript"; ".css" = "text/css"; ".json" = "application/json";
  ".txt" = "text/plain"; ".ico" = "image/x-icon"; ".png" = "image/png"; ".svg" = "image/svg+xml"; ".woff2" = "font/woff2"; ".webmanifest" = "application/manifest+json" }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch { Write-Host "Could not start on port $Port : $($_.Exception.Message)"; exit 1 }
Write-Host "Net Worth Tracker is running at http://localhost:$Port/  (close this window to stop)"

try {
  while ($listener.IsListening) {
    $pending = $listener.GetContextAsync()
    while (-not $pending.Wait(500)) { }
    $context = $pending.Result
    $response = $context.Response
    try {
      $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart("/").Replace("/", "\")
      $file = [IO.Path]::GetFullPath((Join-Path $Root $relative))
      if (-not $file.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { $file = $null }
      elseif (Test-Path $file -PathType Container) { $file = Join-Path $file "index.html" }
      if ($file -and (Test-Path $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $type = $types[[IO.Path]::GetExtension($file).ToLower()]
        $response.ContentType = $(if ($type) { $type } else { "application/octet-stream" })
        $response.Headers.Add("Cache-Control", "no-cache")
      } else {
        $response.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes("Not found")
      }
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch { } finally { $response.Close() }
  }
} finally { $listener.Stop() }
