# TALO Dev Control Center runtime - compatible with Windows PowerShell 5.1.
# Intentionally independent of the Node servers, application database and modules.
Set-StrictMode -Version 2.0
$script:ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\')
$script:ControlFile = Join-Path $PSScriptRoot 'ControlCenter.ps1'
$script:ComposeFile = Join-Path $script:ProjectRoot 'docker-compose.yml'
$script:StateRoot = Join-Path $env:LOCALAPPDATA 'TALO-MOS-V4\dev-control'
$script:ComposeArgs = @('compose', '-f', $script:ComposeFile, '--project-directory', $script:ProjectRoot)
[void][System.IO.Directory]::CreateDirectory($script:StateRoot)

function State-File([string]$name) { return (Join-Path $script:StateRoot $name) }
function Read-EnvValue([string]$key, [string]$fallback) {
    $value = [Environment]::GetEnvironmentVariable($key)
    if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
    $file = Join-Path $script:ProjectRoot '.env'
    if (Test-Path -LiteralPath $file) {
        foreach ($line in [System.IO.File]::ReadAllLines($file)) {
            if ($line -match ('^\s*' + [regex]::Escape($key) + '\s*=\s*(.*?)\s*$')) {
                $value = $Matches[1].Trim().Trim('"').Trim("'")
                if ($value) { return $value }
            }
        }
    }
    return $fallback
}
function Read-Port([string]$key, [int]$fallback) {
    $v = Read-EnvValue $key ([string]$fallback)
    $n = 0
    if ([int]::TryParse($v, [ref]$n) -and $n -ge 1 -and $n -le 65535) { return $n }
    return $fallback
}
function Backend-Port { return (Read-Port 'PORT' 3000) }
function Frontend-Port { return 5173 }
function Database-Port { return (Read-Port 'POSTGRES_PORT' 5432) }

function Redact([string]$message) {
    $clean = [string]$message
    $clean = [regex]::Replace($clean, '(?i)(postgres(?:ql)?://)[^\s:/@]+:[^\s/@]+@', '$1***:***@')
    $clean = [regex]::Replace($clean, '(?i)\b(DATABASE_URL|POSTGRES_PASSWORD|PASSWORD|TOKEN|SECRET|API_KEY|PRIVATE_KEY)\b\s*[:=]\s*("[^"]*"|''[^'']*''|\S+)', '$1=[REDACTED]')
    $file = Join-Path $script:ProjectRoot '.env'
    if (Test-Path -LiteralPath $file) {
        foreach ($line in [System.IO.File]::ReadAllLines($file)) {
            if ($line -match '(?i)^\s*(?:[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY)|DATABASE_URL)\s*=\s*(.*)$') {
                $secret = $Matches[1].Trim().Trim('"').Trim("'")
                if ($secret.Length -ge 4) { $clean = $clean.Replace($secret, '[REDACTED]') }
            }
        }
    }
    return $clean
}
function Log-Line([string]$name, [string]$message) {
    $path = State-File $name
    $line = ('[{0:yyyy-MM-dd HH:mm:ss}] {1}{2}' -f (Get-Date), (Redact $message), [Environment]::NewLine)
    try {
        if ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path).Length -gt 5000000) {
            Move-Item -LiteralPath $path -Destination ($path + '.old') -Force -ErrorAction SilentlyContinue
        }
        [System.IO.File]::AppendAllText($path, $line, [System.Text.Encoding]::UTF8)
    } catch { } # A locked log must not break runtime control.
}
function Action-Log([string]$message) { Log-Line 'actions.log' $message }
function Read-Log([string]$name, [int]$lines=130) {
    $path = State-File $name
    if (-not (Test-Path -LiteralPath $path)) { return '(no log entries)' }
    try { return (Redact ((Get-Content -LiteralPath $path -Tail $lines -ErrorAction Stop) -join [Environment]::NewLine)) }
    catch { return '(log temporarily unavailable)' }
}
function Snapshot-ProcessMap {
    $map = @{}
    foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction Stop)) { $map[[int]$p.ProcessId] = $p }
    return ,$map
}
function Is-Runner([object]$p, [string]$service) {
    if ($null -eq $p) { return $false }
    if ($p.Name -notmatch '^(?i:powershell\.exe|pwsh\.exe)$') { return $false }
    $line = [string]$p.CommandLine
    # Exact script path AND purpose, not just a window title or a port number.
    return ($line.IndexOf($script:ControlFile, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $line -match ('(?i)(?:^|\s)-Mode\s+service\b') -and
            $line -match ('(?i)(?:^|\s)-Service\s+' + [regex]::Escape($service) + '(?:\s|$)'))
}
function Is-LegacyRoot([object]$p, [string]$service) {
    if ($null -eq $p) { return $false }
    if ($p.Name -notmatch '^(?i:cmd\.exe|node\.exe|nodew\.exe|powershell\.exe|pwsh\.exe)$') { return $false }
    $line = [string]$p.CommandLine
    $folder = Join-Path $script:ProjectRoot $service
    if ($line.IndexOf($folder, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
    return ($line -match '(?i)(npm(?:\.cmd)?\s+run\s+(dev|test)\b|tsx(?:\.cmd)?|vite(?:\.cmd)?|node_modules|src[\\/]server\.ts|cmd\.exe\s+/k)')
}
function Is-DescendantOwned([int]$processId, [string]$service, [hashtable]$map) {
    $cursor = $processId; $seen = @{}
    for ($j=0; $j -lt 32; $j++) {
        if ($cursor -le 0 -or $seen.ContainsKey($cursor) -or -not $map.ContainsKey($cursor)) { return $false }
        $seen[$cursor] = $true
        $p = $map[$cursor]
        if ((Is-Runner $p $service) -or (Is-LegacyRoot $p $service)) { return $true }
        $cursor = [int]$p.ParentProcessId
    }
    return $false
}
function Listener-Pid([int]$port) {
    try {
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
            Where-Object { $_.LocalPort -eq $port -and $_.LocalAddress -in @('127.0.0.1','0.0.0.0','::1','::') })
        if ($listeners.Count -eq 0) { return 0 }
        return [int]$listeners[0].OwningProcess
    } catch { return -1 } # Never treat an API failure as confirmed STOPPED.
}
function Check-Http([int]$port, [string]$path) {
    try {
        $url = 'http://127.0.0.1:' + $port + $path
        $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2 -ErrorAction Stop
        return ([int]$r.StatusCode -eq 200)
    } catch { return $false }
}
function Web-State([string]$service, [hashtable]$map) {
    $port = if ($service -eq 'backend') { Backend-Port } else { Frontend-Port }
    $pidValue = Listener-Pid $port
    if ($pidValue -eq -1) { return @{status='ERROR';detail='Cannot inspect listener';pid=0;port=$port} }
    if ($pidValue -eq 0) {
        $count = @($map.Keys | Where-Object { Is-DescendantOwned ([int]$_) $service $map }).Count
        if ($count -gt 0) { return @{status='ERROR';detail='Process exists, listener absent';pid=0;port=$port} }
        return @{status='STOPPED';detail='No listener';pid=0;port=$port}
    }
    if (-not (Is-DescendantOwned $pidValue $service $map)) {
        return @{status='ERROR';detail='Port owned by foreign/unverified process';pid=$pidValue;port=$port}
    }
    $path = if ($service -eq 'backend') { '/api/health' } else { '/' }
    if (-not (Check-Http $port $path)) {
        return @{status='ERROR';detail='Owned listener, HTTP check failed';pid=$pidValue;port=$port}
    }
    return @{status='RUNNING';detail='Owned process + HTTP 200';pid=$pidValue;port=$port}
}
function Docker-Available {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
    try {
        $null = & docker info --format '{{.ServerVersion}}' 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}
function Database-State([bool]$dockerOk) {
    $port = Database-Port
    if (-not $dockerOk) { return @{status='STOPPED';detail='Docker Engine unavailable';pid=0;port=$port;cid=''} }
    $ids = @(& docker @script:ComposeArgs ps -a -q postgres 2>$null)
    if ($LASTEXITCODE -ne 0) { return @{status='UNHEALTHY';detail='Compose inspection failed';pid=0;port=$port;cid=''} }
    if ($ids.Count -eq 0 -or [string]$ids[0] -notmatch '^[a-fA-F0-9]{12,64}$') {
        return @{status='STOPPED';detail='Compose container absent';pid=0;port=$port;cid=''}
    }
    $cid = [string]$ids[0]
    $running = [string](& docker inspect --format '{{.State.Running}}' $cid 2>$null)
    $health = [string](& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $cid 2>$null)
    if ($running -ne 'true') { return @{status='STOPPED';detail='Container stopped';pid=0;port=$port;cid=$cid} }
    if ($health -ne 'healthy') { return @{status='UNHEALTHY';detail=('Health: ' + $health);pid=0;port=$port;cid=$cid} }
    return @{status='RUNNING';detail='Docker healthcheck healthy';pid=0;port=$port;cid=$cid}
}
function Resource-Data([hashtable]$state, [object]$prior) {
    $info = @{cpu='—';ram='—';uptime='—';seconds=0}
    if ($state.status -ne 'RUNNING' -or $state.pid -le 0) { return $info }
    try {
        $p = Get-Process -Id $state.pid -ErrorAction Stop
        $info.ram = ('{0:N1} MB' -f ($p.WorkingSet64 / 1MB))
        $age = [DateTime]::Now - $p.StartTime
        $info.uptime = ('{0:00}:{1:00}:{2:00}' -f [int][Math]::Floor($age.TotalHours),$age.Minutes,$age.Seconds)
        $info.seconds = [double]$p.CPU
        if ($null -ne $prior -and $prior.pid -eq $state.pid -and $prior.sampleTime -and $prior.cpuSeconds -ne $null) {
            $deltaTime = ((Get-Date).ToUniversalTime() - [datetime]$prior.sampleTime).TotalSeconds
            $deltaCpu = ([double]$p.CPU - [double]$prior.cpuSeconds)
            if ($deltaTime -gt 0 -and $deltaCpu -ge 0) {
                $info.cpu = ('{0:N1}%' -f ([Math]::Min(100, $deltaCpu * 100 / $deltaTime / [Environment]::ProcessorCount)))
            }
        }
    } catch { }
    return $info
}
function Write-AtomicJson([string]$path, [object]$data) {
    $temp = $path + '.' + $PID + '.tmp'
    try {
        [System.IO.File]::WriteAllText($temp, ($data | ConvertTo-Json -Depth 8 -Compress), [System.Text.Encoding]::UTF8)
        Move-Item -LiteralPath $temp -Destination $path -Force
    } finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
}
function Run-Probe {
    try {
        $prior = $null
        $path = State-File 'status.json'
        if (Test-Path -LiteralPath $path) {
            try { $prior = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { }
        }
        $docker = Docker-Available
        $processes = Snapshot-ProcessMap
        $backend = Web-State 'backend' $processes
        $frontend = Web-State 'frontend' $processes
        $database = Database-State $docker
        $bPrior = if ($null -ne $prior) { $prior.backend } else { $null }
        $fPrior = if ($null -ne $prior) { $prior.frontend } else { $null }
        $bRes = Resource-Data $backend $bPrior
        $fRes = Resource-Data $frontend $fPrior
        $backend.cpu = $bRes.cpu; $backend.ram=$bRes.ram; $backend.uptime=$bRes.uptime
        $backend.cpuSeconds=$bRes.seconds; $backend.sampleTime=(Get-Date).ToUniversalTime().ToString('o')
        $frontend.cpu=$fRes.cpu; $frontend.ram=$fRes.ram; $frontend.uptime=$fRes.uptime
        $frontend.cpuSeconds=$fRes.seconds; $frontend.sampleTime=(Get-Date).ToUniversalTime().ToString('o')
        $database.cpu='—';$database.ram='—';$database.uptime='—'
        if ($database.cid -and $docker) {
            try {
                $stats = [string](& docker stats --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}' $database.cid 2>$null)
                if ($LASTEXITCODE -eq 0 -and $stats.Contains('|')) {
                    $columns = $stats.Split('|')
                    $database.cpu=$columns[0].Trim();$database.ram=$columns[1].Trim()
                }
                $started = [string](& docker inspect --format '{{.State.StartedAt}}' $database.cid 2>$null)
                if ($LASTEXITCODE -eq 0) {
                    $age=(Get-Date).ToUniversalTime() - ([datetime]$started).ToUniversalTime()
                    if ($age.TotalSeconds -ge 0) { $database.uptime=('{0:00}:{1:00}:{2:00}' -f [int][Math]::Floor($age.TotalHours),$age.Minutes,$age.Seconds) }
                }
            } catch { }
            try {
                $lines = @(& docker logs --tail 100 $database.cid 2>&1)
                $all = Redact (($lines | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
                [System.IO.File]::WriteAllText((State-File 'postgres.log'), $all, [System.Text.Encoding]::UTF8)
            } catch { }
        }
        $payload = @{timestamp=(Get-Date).ToUniversalTime().ToString('o');docker=if ($docker) {'AVAILABLE'} else {'UNAVAILABLE'};backend=$backend;frontend=$frontend;postgres=$database;moduleRuntime='UNAVAILABLE';moduleFoundation='UNAVAILABLE'}
        Write-AtomicJson $path $payload
    } catch { Action-Log ('Monitor failure: '+$_.Exception.Message) }
}
function Check-Prerequisites {
    if (-not (Test-Path -LiteralPath $script:ComposeFile)) { throw 'docker-compose.yml missing' }
    foreach ($svc in @('backend','frontend')) {
        $dir = Join-Path $script:ProjectRoot $svc
        $package = Join-Path $dir 'package.json'
        if (-not (Test-Path -LiteralPath $package)) { throw "$svc/package.json missing" }
        $manifest = ([System.IO.File]::ReadAllText($package) | ConvertFrom-Json)
        if (-not $manifest.scripts.dev) { throw "$svc has no npm dev script" }
        if (-not (Test-Path -LiteralPath (Join-Path $dir 'node_modules'))) { throw "$svc/node_modules missing. Run npm install first." }
    }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd unavailable' }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI unavailable' }
    if (-not (Docker-Available)) { throw 'Docker Engine unavailable. Open Docker Desktop and retry.' }
    $null = & docker @script:ComposeArgs config --quiet 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose config invalid. Check project .env.' }
}
function Compose-Action([string[]]$arguments) {
    Action-Log ('Compose '+($arguments -join ' '))
    $output = @(& docker @script:ComposeArgs @arguments 2>&1)
    foreach ($entry in $output) { Log-Line 'postgres-actions.log' ([string]$entry) }
    if ($LASTEXITCODE -ne 0) { throw ('Compose ' + $arguments[0] + ' failed. See PostgreSQL Actions log.') }
}
function Wait-Database([int]$timeout=100) {
    $deadline = [DateTime]::UtcNow.AddSeconds($timeout)
    while ([DateTime]::UtcNow -lt $deadline) {
        $state = Database-State (Docker-Available)
        if ($state.status -eq 'RUNNING') { Action-Log 'PostgreSQL healthy'; return }
        Start-Sleep -Seconds 2
    }
    throw 'PostgreSQL did not reach healthy status before timeout.'
}
function Stop-ProjectWeb {
    $map = Snapshot-ProcessMap
    $owned = @{}
    foreach ($key in @($map.Keys)) {
        if ((Is-DescendantOwned ([int]$key) 'backend' $map) -or (Is-DescendantOwned ([int]$key) 'frontend' $map)) { $owned[[int]$key] = $true }
    }
    $roots = @($owned.Keys | Where-Object { -not $owned.ContainsKey([int]$map[$_].ParentProcessId) })
    foreach ($rootPid in $roots) {
        # Verify the PID still corresponds to a TALO dev tree immediately before termination.
        $fresh = Snapshot-ProcessMap
        if (-not ((Is-DescendantOwned ([int]$rootPid) 'backend' $fresh) -or (Is-DescendantOwned ([int]$rootPid) 'frontend' $fresh))) {
            Action-Log ("Skip PID ${rootPid}: ownership changed")
            continue
        }
        $result = @(& taskkill.exe /PID ([string]$rootPid) /T /F 2>&1)
        Action-Log ("Stop TALO process tree PID ${rootPid}: " + ($result -join ' '))
    }
    foreach ($svc in @('backend','frontend')) { Remove-Item -LiteralPath (State-File ($svc+'.runner.json')) -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
}
function Start-WebService([string]$service) {
    $state = Web-State $service (Snapshot-ProcessMap)
    if ($state.status -eq 'RUNNING') { Action-Log "$service already RUNNING"; return }
    if ($state.pid -gt 0) { throw ("$service has a listener or conflicting port (PID " + $state.pid + "); stop/fix it first") }
    if ($state.status -eq 'ERROR') { throw "$service has a process but is not ready; use Restart Web." }
    $runner = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$script:ControlFile+'"'),'-Mode','service','-Service',$service) -WorkingDirectory $script:ProjectRoot -WindowStyle Hidden -PassThru
    Write-AtomicJson (State-File ($service+'.runner.json')) @{pid=$runner.Id;startedAt=(Get-Date).ToUniversalTime().ToString('o')}
    Action-Log ("Launch $service runner PID " + $runner.Id)
    $limit = [DateTime]::UtcNow.AddSeconds(50)
    while ([DateTime]::UtcNow -lt $limit) {
        Start-Sleep -Seconds 1
        $status = Web-State $service (Snapshot-ProcessMap)
        if ($status.status -eq 'RUNNING') { Action-Log "$service HTTP 200 + PID ownership verified"; return }
        if ($runner.HasExited) { break }
    }
    throw "$service failed readiness. Check its log."
}
function Service-Runner([string]$service) {
    $dir = Join-Path $script:ProjectRoot $service
    Set-Location -LiteralPath $dir
    try {
        Log-Line ($service+'.log') 'Starting npm run dev'
        & npm.cmd run dev 2>&1 | ForEach-Object { Log-Line ($service+'.log') ([string]$_) }
        Log-Line ($service+'.log') ('npm run dev ended: code '+$LASTEXITCODE)
    } catch { Log-Line ($service+'.log') ('Runner error: '+$_.Exception.Message) }
}
function Run-Action([string]$operation) {
    # Mutex protects against concurrent resets across multiple Control Center windows.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $token = [BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($script:ProjectRoot))).Replace('-','').Substring(0,16) }
    finally { $sha.Dispose() }
    $mutex = New-Object System.Threading.Mutex($false,('Local\TALO_CC_'+$token))
    $locked = $false
    try {
        $locked = $mutex.WaitOne(0)
        if (-not $locked) { Action-Log "$operation rejected: another action is running"; return }
        Set-Content -LiteralPath (State-File 'busy.pid') -Value $PID -Encoding Ascii
        Action-Log "BEGIN $operation"
        switch ($operation) {
            'stop' {
                Stop-ProjectWeb
                if (Docker-Available) { Compose-Action @('stop','postgres') }
                else { throw 'Web stopped, but Docker unavailable; PostgreSQL status cannot be changed' }
            }
            'start' {
                Check-Prerequisites
                Compose-Action @('up','-d','postgres')
                Wait-Database
                Start-WebService 'backend'
                Start-WebService 'frontend'
            }
            'restart' {
                Check-Prerequisites
                Wait-Database
                Stop-ProjectWeb
                Start-WebService 'backend'
                Start-WebService 'frontend'
            }
            'reset' {
                Check-Prerequisites
                Stop-ProjectWeb
                # Keep PostgreSQL volume intact, and touch ONLY this Compose service.
                Compose-Action @('stop','postgres')
                Compose-Action @('up','-d','postgres')
                Wait-Database
                Start-WebService 'backend'
                Start-WebService 'frontend'
            }
            default { throw "Unsupported operation: $operation" }
        }
        Action-Log "PASS $operation"
    } catch { Action-Log ("FAIL $operation : " + $_.Exception.Message) }
    finally {
        if ($locked) {
            Remove-Item -LiteralPath (State-File 'busy.pid') -Force -ErrorAction SilentlyContinue
            [void]$mutex.ReleaseMutex()
        }
        $mutex.Dispose()
    }
}
