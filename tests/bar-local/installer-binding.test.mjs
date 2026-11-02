import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {buildInstallerParameterSplat,buildInstallerWrapper,installerErrorMessage} from '../../src/main/bar-local/serverSetup.js'

const quote=value=>`'${value.replaceAll("'","''")}'`
test('Windows service wrapper parses options from its process command line',()=>{
  const source=readFileSync('services/bar-local/packaging/windows/service/BarLocalService.cs','utf8')
  assert.match(source,/private readonly string\[\] _configuredArguments;/)
  assert.match(source,/public BarLocalService\(string\[\] configuredArguments\)/)
  assert.match(source,/ServiceOptions\.Parse\(_configuredArguments\)/)
  assert.match(source,/ServiceBase\.Run\(new BarLocalService\(args\)\)/)
})
test('Windows service retry skips redundant configuration and account writes',()=>{
  const source=readFileSync('services/bar-local/packaging/windows/install-service.ps1','utf8')
  assert.match(source,/\$sameConfiguration\s*=\s*\$null -ne \$configured -and/)
  assert.match(source,/if\s*\(\$sameConfiguration\)\s*\{[\s\S]*?already has the requested command/)
  assert.match(source,/configured\.StartName,[\s\S]*?already runs as/)
  assert.match(source,/configured\.Description,[\s\S]*?already has the requested description/)
})

test('real installer parameter block binds named ports, paths and switches on Windows PowerShell', {skip:process.platform!=='win32'},()=>{
  mkdirSync('.tmp',{recursive:true})
  const root=mkdtempSync(resolve(".tmp/Owner's binding space "))
  const probe=join(root,"Owner's binding probe.ps1")
  const installer=resolve('services/bar-local/packaging/windows/install-server.ps1')
  const install={install_dir:join(root,'service'),data_dir:join(root,'data'),pg_bin:join(root,'postgres bin'),pg_data_dir:join(root,'pgdata'),db_port:55432,http_port:8787,node_path:join(root,'node runtime/node.exe'),server_root:join(root,'packaged server'),backup_dir:join(root,'backups'),upgrade:false,tls_cert_file:join(root,'identity/api.crt'),tls_key_file:join(root,'identity/api.key')}
  const command=`$ErrorActionPreference='Stop'
$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(installer)},[ref]$null,[ref]$null)
$body=$ast.ParamBlock.Extent.Text + [Environment]::NewLine + '[pscustomobject]@{ DbPort=$DbPort; HttpPort=$HttpPort; PgBin=$PgBin; InstallDir=$InstallDir; SetupSecretFile=$SetupSecretFile; InitDb=[bool]$InitDb; Upgrade=[bool]$Upgrade; ResumeExisting=[bool]$ResumeExisting; LoopbackDatabase=[bool]$LoopbackDatabase; RequirePrivateFirewall=[bool]$RequirePrivateFirewall; SkipFirewall=[bool]$SkipFirewall; DbPortType=$DbPort.GetType().Name } | ConvertTo-Json -Compress'
[IO.File]::WriteAllText(${quote(probe)},$body,(New-Object Text.UTF8Encoding($false)))
${buildInstallerParameterSplat(install)}
& ${quote(probe)} @arguments
`
  const ps=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
  const run=spawnSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:20000})
  assert.equal(run.status,0,run.stderr)
  const actual=JSON.parse(run.stdout.trim())
  assert.equal(actual.DbPort,55432);assert.equal(actual.HttpPort,8787);assert.equal(actual.DbPortType,'Int32')
  assert.equal(actual.PgBin,install.pg_bin);assert.equal(actual.InstallDir,install.install_dir)
  assert.equal(actual.SetupSecretFile,join(root,'secrets/setup-secret.txt'))
  assert.equal(actual.InitDb,true);assert.equal(actual.Upgrade,false);assert.equal(actual.ResumeExisting,false);assert.equal(actual.LoopbackDatabase,true);assert.equal(actual.RequirePrivateFirewall,true);assert.equal(actual.SkipFirewall,false)
  const legacy={...install,tls_cert_file:undefined,tls_key_file:undefined,upgrade:true}
  const legacyCommand=command.replace(buildInstallerParameterSplat(install),buildInstallerParameterSplat(legacy))
  const resumed=spawnSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(legacyCommand,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:20000})
  assert.equal(resumed.status,0,resumed.stderr)
  const resumedArgs=JSON.parse(resumed.stdout.trim())
  assert.equal(resumedArgs.DbPort,55432);assert.equal(resumedArgs.Upgrade,true);assert.equal(resumedArgs.InitDb,false);assert.equal(resumedArgs.ResumeExisting,false);assert.equal(resumedArgs.SkipFirewall,true);assert.equal(resumedArgs.LoopbackDatabase,true)
  const retry={...install,tls_cert_file:undefined,tls_key_file:undefined,resume_existing:true}
  const retryCommand=command.replace(buildInstallerParameterSplat(install),buildInstallerParameterSplat(retry))
  const resumedInstall=spawnSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(retryCommand,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:20000})
  assert.equal(resumedInstall.status,0,resumedInstall.stderr)
  const retryArgs=JSON.parse(resumedInstall.stdout.trim())
  assert.equal(retryArgs.ResumeExisting,true);assert.equal(retryArgs.Upgrade,false);assert.equal(retryArgs.InitDb,false)
  // Reproduce the original failure using the real parameter block, without
  // executing any installer body or touching its target directories.
  const broken=`$arguments=@('-InstallDir','a','-DataDir','b','-PgBin','c','-PgDataDir','d','-DbPort','55432','-HttpPort','8787'); & ${quote(probe)} @arguments`
  const old=spawnSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(broken,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:20000})
  assert.notEqual(old.status,0)
  assert.match(installerErrorMessage(old.stderr),/DbPort/)
  assert.match(installerErrorMessage(old.stderr),/-PgBin/)
  // Persist only non-secret binding evidence, not actual secret file contents.
  writeFileSync(join(root,'binding-result.json'),JSON.stringify(actual,null,2))
})

test('elevated installer classifies a saved retry without asking the app to read PG_VERSION', {skip:process.platform!=='win32'},()=>{
  const installer=resolve('services/bar-local/packaging/windows/install-server.ps1')
  const ps=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
  const classify=pgInitialized=>{
    const command=`$ast=[System.Management.Automation.Language.Parser]::ParseFile(${quote(installer)},[ref]$null,[ref]$null)
$branch=$ast.Find({param($n) $n -is [System.Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -eq '$ResumeExisting'},$true)
if($null -eq $branch){throw 'ResumeExisting branch not found'}
$ResumeExisting=$true;$Upgrade=$false;$InitDb=$false;$pgInitialized=${pgInitialized?'$true':'$false'}
Invoke-Expression $branch.Extent.Text
[pscustomobject]@{Upgrade=[bool]$Upgrade;InitDb=[bool]$InitDb} | ConvertTo-Json -Compress`
    const result=spawnSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:20000})
    assert.equal(result.status,0,result.stderr)
    return JSON.parse(result.stdout.trim())
  }
  assert.deepEqual(classify(true),{Upgrade:true,InitDb:false})
  assert.deepEqual(classify(false),{Upgrade:false,InitDb:true})
})

test('CLIXML progress is ignored and actual errors are decoded',()=>{
  const progress='#< CLIXML\n<Objs><Obj S="progress"><S>Preparing modules for first use.</S></Obj></Objs>'
  assert.equal(installerErrorMessage(progress),'')
  assert.equal(installerErrorMessage('#< CLIXML\n<Objs><S S="Error">Cannot bind DbPort: &quot;-PgBin&quot;._x000D__x000A_</S></Objs>'),'Cannot bind DbPort: "-PgBin".')
})
test('generated wrapper copies the runtime into its versioned bin path and preserves earlier/partial copies', {skip:process.platform!=='win32'},()=>{
  mkdirSync('.tmp',{recursive:true})
  const root=mkdtempSync(resolve(".tmp/Owner's runtime binding "))
  const source=join(root,'payload/postgres'),parent=join(root,'installed-postgres')
  mkdirSync(join(source,'bin'),{recursive:true});mkdirSync(join(source,'share'))
  writeFileSync(join(source,'bin/postgres.exe'),'isolated fake executable; never run')
  writeFileSync(join(source,'share/payload.txt'),'packaged data')
  mkdirSync(join(parent,'bin'),{recursive:true});writeFileSync(join(parent,'bin/postgres.exe'),'preserved earlier copy')
  const partial=join(root,'partial-runtime');mkdirSync(partial);writeFileSync(join(partial,'evidence.txt'),'preserve partial')
  const install={install_dir:join(root,'service'),data_dir:join(root,'data'),pg_bin:join(parent,'17.6/bin'),pg_data_dir:join(root,'pgdata'),db_port:55432,http_port:8787,node_path:join(root,'node/node.exe'),server_root:join(root,'payload/server'),installer_script:join(root,'unused.ps1'),backup_dir:join(root,'backups'),upgrade:false}
  const wrapper=join(root,'generated.ps1')
  writeFileSync(wrapper,buildInstallerWrapper({attempt_id:'runtime-fixture',install,secrets:{},staging:{root,secret_dir:join(root,'secrets'),status_path:join(root,'status.json'),log_path:join(root,'install.log')},payload:{dir:join(root,'payload')}}))
  const command=[
    "$ErrorActionPreference='Stop'",
    "$ast=[System.Management.Automation.Language.Parser]::ParseFile("+quote(wrapper)+",[ref]$null,[ref]$null)",
    "$copy=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Copy-RuntimeIfMissing'},$true)",
    "Invoke-Expression $copy.Extent.Text",
    "$target=$ast.Find({param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$pgTarget'},$true)",
    "Invoke-Expression $target.Extent.Text",
    "Copy-RuntimeIfMissing "+quote(source)+" $pgTarget 'bin/postgres.exe'",
    "Copy-RuntimeIfMissing "+quote(source)+" $pgTarget 'bin/postgres.exe'",
    "$partialRefused=$false;try{Copy-RuntimeIfMissing "+quote(source)+" "+quote(partial)+" 'bin/postgres.exe'}catch{$partialRefused=$true}",
    "[pscustomobject]@{ versioned=Test-Path -LiteralPath "+quote(join(install.pg_bin,'postgres.exe'))+"; legacy=[IO.File]::ReadAllText("+quote(join(parent,'bin/postgres.exe'))+"); partial=[IO.File]::ReadAllText("+quote(join(partial,'evidence.txt'))+"); partialRefused=$partialRefused } | ConvertTo-Json -Compress"
  ].join('\n')
  const result=spawnSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:20000})
  assert.equal(result.status,0,result.stderr)
  assert.deepEqual(JSON.parse(result.stdout.trim()),{versioned:true,legacy:'preserved earlier copy',partial:'preserve partial',partialRefused:true})
  assert.equal(readFileSync(join(parent,'17.6/share/payload.txt'),'utf8'),'packaged data')
})
