$ErrorActionPreference = 'Stop'
$codex = Get-Command codex -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $codex) {
    throw 'Codex CLI was not found. Open a terminal where the codex command is available.'
}

$keyName = 'XJTLU_MCP_TOKEN'
$secureKey = Read-Host 'In XJTLU-MCP, open Agent Connection and copy the access key. Paste it here' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    $secureKey.Dispose()
}

try {
    if ($key -cnotmatch '\A[0-9a-f]{64}\z') {
        throw 'Use the access key from the desktop application, without the Bearer prefix.'
    }
    Add-Type -AssemblyName System.Net.Http
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $body = [System.Net.Http.StringContent]::new(
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"xjtlu-plugin-setup","version":"1.0.0"}}}',
        [Text.Encoding]::UTF8,
        'application/json'
    )
    try {
        $client.Timeout = [TimeSpan]::FromSeconds(10)
        $client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $key)
        $client.DefaultRequestHeaders.Accept.ParseAdd('application/json, text/event-stream')
        $response = $client.PostAsync('http://127.0.0.1:39527/mcp', $body).GetAwaiter().GetResult()
        $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode -or $content -notmatch '"name"\s*:\s*"xjtlu-campus"') {
            throw 'Unexpected MCP response.'
        }
    } catch {
        throw 'Cannot connect to XJTLU-MCP. Keep Agent Connection open and copy the current access key.'
    } finally {
        $body.Dispose()
        if ($response) { $response.Dispose() }
        $client.Dispose()
    }
    & $codex.Source plugin marketplace add $PSScriptRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not add the XJTLU plugin marketplace.' }
    & $codex.Source plugin add 'xjtlu-campus@xjtlu-local'
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the XJTLU campus plugin.' }
    [Environment]::SetEnvironmentVariable($keyName, $key, [EnvironmentVariableTarget]::User)
    Write-Host 'Installed. Fully exit Codex and reopen it on this computer, then start a new local conversation.'
} finally {
    $key = $null
}
