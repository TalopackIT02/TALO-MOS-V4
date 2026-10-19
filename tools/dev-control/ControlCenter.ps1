<#
TALO Dev Control Center - Windows PowerShell 5.1 / Windows Forms.
Normal launch: double click TALO-Control.cmd in the repository root.
Helper modes only used by independent PowerShell children; no Node/Electron/web dashboard.
#>
param(
    [ValidateSet('ui','probe','action','service')][string]$Mode='ui',
    [ValidateSet('start','stop','restart','reset')][string]$Action='start',
    [ValidateSet('backend','frontend')][string]$Service='backend'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Runtime.ps1')

if ($Mode -eq 'probe') { Run-Probe; exit 0 }
if ($Mode -eq 'action') { Run-Action $Action; exit 0 }
if ($Mode -eq 'service') { Service-Runner $Service; exit 0 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:Color = @{
    bg=[System.Drawing.Color]::FromArgb(18,22,30)
    surface=[System.Drawing.Color]::FromArgb(28,34,45)
    raised=[System.Drawing.Color]::FromArgb(36,44,58)
    text=[System.Drawing.Color]::FromArgb(232,238,247)
    muted=[System.Drawing.Color]::FromArgb(150,162,181)
    accent=[System.Drawing.Color]::FromArgb(66,146,233)
    good=[System.Drawing.Color]::FromArgb(77,209,157)
    bad=[System.Drawing.Color]::FromArgb(255,113,126)
    warn=[System.Drawing.Color]::FromArgb(248,192,88)
}
$script:FontNormal = New-Object System.Drawing.Font('Segoe UI',9,[System.Drawing.FontStyle]::Regular)
$script:FontMono = New-Object System.Drawing.Font('Consolas',9,[System.Drawing.FontStyle]::Regular)
$script:FontBig = New-Object System.Drawing.Font('Segoe UI',19,[System.Drawing.FontStyle]::Bold)
$script:FontHead = New-Object System.Drawing.Font('Segoe UI',10,[System.Drawing.FontStyle]::Bold)
$script:ActionProc = $null
$script:ProbeProc = $null
$script:LastProbeStart = [DateTime]::MinValue
$script:DisplayedStamp = ''

function Label-At([string]$title,[System.Drawing.Font]$font,[System.Drawing.Color]$color) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text=$title;$l.Font=$font;$l.ForeColor=$color;$l.BackColor=[System.Drawing.Color]::Transparent
    $l.AutoSize=$false
    return $l
}
function Status-Color([string]$status) {
    switch ($status) {
        'RUNNING' { return $script:Color.good }
        'AVAILABLE' { return $script:Color.good }
        'STOPPED' { return $script:Color.muted }
        'UNAVAILABLE' { return $script:Color.bad }
        'ERROR' { return $script:Color.bad }
        'UNHEALTHY' { return $script:Color.warn }
        default { return $script:Color.warn }
    }
}
function Make-Button([string]$text,[bool]$primary) {
    $b=New-Object System.Windows.Forms.Button
    $b.Text=$text;$b.Font=$script:FontHead;$b.FlatStyle=[System.Windows.Forms.FlatStyle]::Flat
    $b.FlatAppearance.BorderSize=0
    $b.Height=39;$b.Dock='Fill'
    $b.BackColor=if ($primary) {$script:Color.accent} else {$script:Color.raised}
    $b.ForeColor=$script:Color.text
    $b.Cursor=[System.Windows.Forms.Cursors]::Hand
    return $b
}
function Launch-Worker([string[]]$argsList) {
    $argString = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $script:ControlFile + '" ' + ($argsList -join ' ')
    return (Start-Process -FilePath 'powershell.exe' -ArgumentList $argString -WorkingDirectory $script:ProjectRoot -WindowStyle Hidden -PassThru)
}

$script:Form = New-Object System.Windows.Forms.Form
$script:Form.Text = 'TALO Dev Control Center'
$script:Form.StartPosition='CenterScreen'
$script:Form.Size=New-Object System.Drawing.Size(1160,820)
$script:Form.MinimumSize=New-Object System.Drawing.Size(940,690)
$script:Form.BackColor=$script:Color.bg
$script:Form.ForeColor=$script:Color.text
$script:Form.Font=$script:FontNormal

$outer=New-Object System.Windows.Forms.TableLayoutPanel
$outer.Dock='Fill';$outer.Padding=New-Object System.Windows.Forms.Padding(18,13,18,11)
$outer.ColumnCount=1;$outer.RowCount=6
$outer.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,62))) | Out-Null
$outer.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,106))) | Out-Null
$outer.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,66))) | Out-Null
$outer.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,204))) | Out-Null
$outer.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent,100))) | Out-Null
$outer.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,28))) | Out-Null
$script:Form.Controls.Add($outer)

$header=New-Object System.Windows.Forms.Panel;$header.Dock='Fill';$outer.Controls.Add($header,0,0)
$heading=Label-At 'TALO  /  DEV CONTROL CENTER' $script:FontBig $script:Color.text
$heading.Location=New-Object System.Drawing.Point(0,0);$heading.Size=New-Object System.Drawing.Size(680,39)
$header.Controls.Add($heading)
$subtitle=Label-At 'TALO-MOS-V4  •  Local Development  •  Windows' $script:FontNormal $script:Color.muted
$subtitle.Location=New-Object System.Drawing.Point(2,39);$subtitle.Size=New-Object System.Drawing.Size(680,23)
$header.Controls.Add($subtitle)

$cards=New-Object System.Windows.Forms.TableLayoutPanel
$cards.Dock='Fill';$cards.ColumnCount=4;$cards.RowCount=1
0..3 | ForEach-Object { $cards.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent,25))) | Out-Null }
$outer.Controls.Add($cards,0,1)
$script:StatusLabels=@{};$script:DetailLabels=@{}
$cardNames=@(@('frontend','FRONTEND'),@('backend','BACKEND'),@('postgres','POSTGRESQL'),@('docker','DOCKER ENGINE'))
for ($i=0;$i -lt $cardNames.Count;$i++) {
    $name=$cardNames[$i][0];$title=$cardNames[$i][1]
    $box=New-Object System.Windows.Forms.Panel
    $box.Dock='Fill';$box.Margin=New-Object System.Windows.Forms.Padding(0,2,11,10)
    $box.BackColor=$script:Color.surface
    $cards.Controls.Add($box,$i,0)
    $label=Label-At $title $script:FontHead $script:Color.muted
    $label.Dock='Top';$label.Height=29;$label.Padding=New-Object System.Windows.Forms.Padding(13,10,0,0)
    $box.Controls.Add($label)
    $status=Label-At 'CHECKING' $script:FontHead $script:Color.warn
    $status.Dock='Top';$status.Height=26;$status.Padding=New-Object System.Windows.Forms.Padding(13,1,0,0)
    $box.Controls.Add($status);$status.BringToFront()
    $detail=Label-At 'Waiting for first probe' $script:FontNormal $script:Color.muted
    $detail.Dock='Fill';$detail.Padding=New-Object System.Windows.Forms.Padding(13,1,4,3)
    $detail.AutoEllipsis=$true
    $box.Controls.Add($detail)
    # Explicit docking stack order: label, status, detail.
    $box.Controls.SetChildIndex($label,0)
    $box.Controls.SetChildIndex($status,1)
    $box.Controls.SetChildIndex($detail,2)
    $script:StatusLabels[$name]=$status;$script:DetailLabels[$name]=$detail
}

$toolbar=New-Object System.Windows.Forms.TableLayoutPanel
$toolbar.Dock='Fill';$toolbar.ColumnCount=5;$toolbar.RowCount=1
0..4 | ForEach-Object { $toolbar.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent,20))) | Out-Null }
$outer.Controls.Add($toolbar,0,2)
$script:Buttons=@{}
$actions=@(@('start','START ALL'),@('stop','STOP ALL'),@('restart','RESTART WEB'),@('reset','RESET ALL'),@('open','OPEN WEB'))
for ($i=0;$i -lt $actions.Count;$i++) {
    $key=$actions[$i][0]
    $btn=Make-Button $actions[$i][1] ($key -eq 'start')
    $btn.Margin=New-Object System.Windows.Forms.Padding(0,4,11,10)
    $toolbar.Controls.Add($btn,$i,0)
    $script:Buttons[$key]=$btn
}

$resource=New-Object System.Windows.Forms.Panel;$resource.Dock='Fill';$resource.BackColor=$script:Color.surface
$resource.Margin=New-Object System.Windows.Forms.Padding(0,1,11,10)
$outer.Controls.Add($resource,0,3)
$rt=Label-At 'RESOURCE MONITORING  /  PROCESS OWNERSHIP' $script:FontHead $script:Color.text
$rt.Dock='Top';$rt.Height=33;$rt.Padding=New-Object System.Windows.Forms.Padding(11,9,0,0)
$resource.Controls.Add($rt)
$script:Grid=New-Object System.Windows.Forms.DataGridView
$script:Grid.Dock='Fill';$script:Grid.ReadOnly=$true;$script:Grid.AllowUserToAddRows=$false
$script:Grid.AllowUserToDeleteRows=$false;$script:Grid.AllowUserToResizeRows=$false
$script:Grid.RowHeadersVisible=$false;$script:Grid.MultiSelect=$false
$script:Grid.BorderStyle='None';$script:Grid.BackgroundColor=$script:Color.surface
$script:Grid.GridColor=$script:Color.raised
$script:Grid.EnableHeadersVisualStyles=$false;$script:Grid.ColumnHeadersHeight=34
$script:Grid.RowTemplate.Height=34
$script:Grid.ColumnHeadersDefaultCellStyle.BackColor=$script:Color.raised
$script:Grid.ColumnHeadersDefaultCellStyle.ForeColor=$script:Color.text
$script:Grid.ColumnHeadersDefaultCellStyle.Font=$script:FontHead
$script:Grid.DefaultCellStyle.BackColor=$script:Color.surface
$script:Grid.DefaultCellStyle.ForeColor=$script:Color.text
$script:Grid.DefaultCellStyle.SelectionBackColor=$script:Color.raised
$script:Grid.DefaultCellStyle.SelectionForeColor=$script:Color.text
$script:Grid.AutoSizeColumnsMode='Fill';$script:Grid.SelectionMode='FullRowSelect'
foreach ($col in @('Service','Status','Port','PID','CPU','RAM','Uptime','Evidence')) {
    [void]$script:Grid.Columns.Add($col,$col)
}
$script:Grid.Columns['Service'].FillWeight=85
$script:Grid.Columns['Status'].FillWeight=80
$script:Grid.Columns['Port'].FillWeight=45
$script:Grid.Columns['PID'].FillWeight=50
$script:Grid.Columns['CPU'].FillWeight=55
$script:Grid.Columns['RAM'].FillWeight=88
$script:Grid.Columns['Uptime'].FillWeight=80
$script:Grid.Columns['Evidence'].FillWeight=218
foreach ($svc in @('frontend','backend','postgres')) { [void]$script:Grid.Rows.Add($svc.ToUpper(),'CHECKING','—','—','—','—','—','Awaiting probe') }
$resource.Controls.Add($script:Grid);$script:Grid.BringToFront()

$bottom=New-Object System.Windows.Forms.TableLayoutPanel
$bottom.Dock='Fill';$bottom.ColumnCount=2;$bottom.RowCount=1
$bottom.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent,73))) | Out-Null
$bottom.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent,27))) | Out-Null
$outer.Controls.Add($bottom,0,4)

$logsPanel=New-Object System.Windows.Forms.Panel
$logsPanel.BackColor=$script:Color.surface;$logsPanel.Dock='Fill'
$logsPanel.Margin=New-Object System.Windows.Forms.Padding(0,0,11,0)
$bottom.Controls.Add($logsPanel,0,0)
$logsHead=Label-At 'LIVE LOGS' $script:FontHead $script:Color.text
$logsHead.Dock='Top';$logsHead.Height=31;$logsHead.Padding=New-Object System.Windows.Forms.Padding(10,8,0,0)
$logsPanel.Controls.Add($logsHead)
$script:Tabs=New-Object System.Windows.Forms.TabControl
$script:Tabs.Dock='Fill';$script:Tabs.Font=$script:FontNormal
$script:Tabs.BackColor=$script:Color.surface
$script:Logs=@{}
foreach ($entry in @(@('Backend','backend.log'),@('Frontend','frontend.log'),@('PostgreSQL','postgres.log'),@('Actions','actions.log'),@('DB Actions','postgres-actions.log'))) {
    $tab=New-Object System.Windows.Forms.TabPage;$tab.Text=$entry[0];$tab.BackColor=$script:Color.surface
    $txt=New-Object System.Windows.Forms.TextBox
    $txt.Multiline=$true;$txt.ReadOnly=$true;$txt.WordWrap=$false
    $txt.ScrollBars='Both';$txt.Dock='Fill';$txt.BorderStyle='None'
    $txt.BackColor=$script:Color.surface;$txt.ForeColor=$script:Color.text;$txt.Font=$script:FontMono
    $tab.Controls.Add($txt);$script:Tabs.TabPages.Add($tab)
    $script:Logs[$entry[1]]=$txt
}
$logsPanel.Controls.Add($script:Tabs);$script:Tabs.BringToFront()

$modulePanel=New-Object System.Windows.Forms.Panel
$modulePanel.BackColor=$script:Color.surface;$modulePanel.Dock='Fill'
$modulePanel.Margin=New-Object System.Windows.Forms.Padding(0,0,11,0)
$bottom.Controls.Add($modulePanel,1,0)
$moduleHead=Label-At 'MODULE STATUS' $script:FontHead $script:Color.text
$moduleHead.Dock='Top';$moduleHead.Height=35;$moduleHead.Padding=New-Object System.Windows.Forms.Padding(12,10,0,0)
$modulePanel.Controls.Add($moduleHead)
$moduleText=Label-At "Runtime modules: UNAVAILABLE`r`n`r`nSYSTEM_TEST: UNAVAILABLE`r`n`r`nFoundation registration: UNAVAILABLE`r`n`r`nNo unauthenticated module-status endpoint was verified. The tool does not modify Auth or Foundation." $script:FontNormal $script:Color.muted
$moduleText.Dock='Fill';$moduleText.Padding=New-Object System.Windows.Forms.Padding(12,6,10,10)
$modulePanel.Controls.Add($moduleText)
$moduleHead.BringToFront()

$footer=Label-At 'Initialising runtime probe...' $script:FontNormal $script:Color.muted
$footer.Dock='Fill';$outer.Controls.Add($footer,0,5)

function Set-Busy([bool]$busy) {
    foreach ($key in @('start','stop','restart','reset')) { $script:Buttons[$key].Enabled = -not $busy }
}
function Start-UiAction([string]$operation) {
    if ($null -ne $script:ActionProc -and -not $script:ActionProc.HasExited) { return }
    if ($operation -eq 'reset') {
        $answer=[System.Windows.Forms.MessageBox]::Show(
            "CLEAN RESTART will stop TALO development processes and restart only the project's PostgreSQL container.`r`n`r`nDatabase data/volumes are preserved. Continue?",
            'Confirm RESET ALL',[System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning,[System.Windows.Forms.MessageBoxDefaultButton]::Button2)
        if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    }
    try {
        $script:ActionProc=Launch-Worker @('-Mode','action','-Action',$operation)
        Set-Busy $true
        $footer.Text='Running '+$operation.ToUpper()+' — see Actions log for outcome.'
    } catch {
        [void][System.Windows.Forms.MessageBox]::Show('Could not start control action: '+$_.Exception.Message,'TALO Control Error')
    }
}
$script:Buttons['start'].Add_Click({ Start-UiAction 'start' })
$script:Buttons['stop'].Add_Click({ Start-UiAction 'stop' })
$script:Buttons['restart'].Add_Click({ Start-UiAction 'restart' })
$script:Buttons['reset'].Add_Click({ Start-UiAction 'reset' })
$script:Buttons['open'].Add_Click({
    try { Start-Process 'http://127.0.0.1:5173' | Out-Null }
    catch { [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Open Web Error') }
})
function Render-Status([object]$snapshot) {
    $when = [datetime]$snapshot.timestamp
    $age = ((Get-Date).ToUniversalTime() - $when.ToUniversalTime()).TotalSeconds
    if ($age -gt 18 -or $age -lt -5) {
        foreach ($svc in @('frontend','backend','postgres','docker')) {
            $script:StatusLabels[$svc].Text='STALE'
            $script:StatusLabels[$svc].ForeColor=$script:Color.warn
            $script:DetailLabels[$svc].Text='Probe outdated; status not reliable'
        }
        for ($i=0;$i -lt 3;$i++) { $script:Grid.Rows[$i].Cells[1].Value='STALE' }
        $footer.Text='Live status unavailable: last probe is '+[int]$age+' seconds old.'
        return
    }
    foreach ($svc in @('frontend','backend','postgres','docker')) {
        if ($svc -eq 'docker') { $status=[string]$snapshot.docker; $detail='Docker CLI / Engine' }
        else {
            $obj=$snapshot.$svc
            $status=[string]$obj.status
            $detail=[string]$obj.detail
            if ($obj.port -gt 0) { $detail = ('Port '+$obj.port+'  •  '+$detail) }
        }
        $script:StatusLabels[$svc].Text=$status
        $script:StatusLabels[$svc].ForeColor=Status-Color $status
        $script:DetailLabels[$svc].Text=$detail
    }
    for ($i=0;$i -lt 3;$i++) {
        $svc=@('frontend','backend','postgres')[$i]
        $obj=$snapshot.$svc
        $vals=@($svc.ToUpper(),[string]$obj.status,[string]$obj.port,
                $(if ($obj.pid -gt 0) {[string]$obj.pid} else {'—'}),
                [string]$obj.cpu,[string]$obj.ram,[string]$obj.uptime,[string]$obj.detail)
        for ($j=0;$j -lt $vals.Count;$j++) { $script:Grid.Rows[$i].Cells[$j].Value=$vals[$j] }
        $script:Grid.Rows[$i].Cells[1].Style.ForeColor=Status-Color ([string]$obj.status)
    }
    $footer.Text='Last verified '+$when.ToLocalTime().ToString('HH:mm:ss')+'  |  Monitoring every ~5s  |  Closing this window leaves services running.'
}
function Refresh-Logs {
    foreach ($name in $script:Logs.Keys) {
        $box=$script:Logs[$name]
        $latest=Read-Log $name 115
        if ($box.Text -ne $latest) {
            $box.Text=$latest
            $box.SelectionStart=$box.TextLength
            $box.ScrollToCaret()
        }
    }
}
function Refresh-Ui {
    if ($null -ne $script:ActionProc -and $script:ActionProc.HasExited) {
        $script:ActionProc.Dispose();$script:ActionProc=$null
        Set-Busy $false
    }
    if ($null -ne $script:ProbeProc -and $script:ProbeProc.HasExited) {
        $script:ProbeProc.Dispose();$script:ProbeProc=$null
    }
    if ($null -eq $script:ProbeProc -and ((Get-Date)-$script:LastProbeStart).TotalSeconds -ge 5) {
        try {
            $script:ProbeProc=Launch-Worker @('-Mode','probe')
            $script:LastProbeStart=Get-Date
        } catch { $footer.Text='Monitor could not start: '+$_.Exception.Message }
    }
    $file=State-File 'status.json'
    if (Test-Path -LiteralPath $file) {
        try { Render-Status (Get-Content -LiteralPath $file -Raw -ErrorAction Stop | ConvertFrom-Json) }
        catch { $footer.Text='Waiting for a valid runtime status snapshot.' }
    }
    Refresh-Logs
}
$script:Timer=New-Object System.Windows.Forms.Timer
$script:Timer.Interval=1750
$script:Timer.Add_Tick({
    try { Refresh-Ui } catch { $footer.Text='Dashboard refresh error: '+$_.Exception.Message }
})
$script:Form.Add_Shown({ $script:Timer.Start();Refresh-Ui })
$script:Form.Add_FormClosed({ $script:Timer.Stop() })
[void][System.Windows.Forms.Application]::Run($script:Form)
