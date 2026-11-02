// Explicit Windows/UAC stage smoke. Only an owned, unstarted disposable cluster.
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {defaultElevatedRunner} from '../../src/main/bar-local/serverSetup.js'
assert.equal(process.env.BAR_LOCAL_RUN_UAC_STAGE_SMOKE,'1','Explicit stage-smoke authorization required')
mkdirSync('.tmp',{recursive:true})
const root=mkdtempSync(resolve(".tmp/Owner's isolated installer stage "))
const data=join(root,'owned-unstarted-pgdata'), pg=resolve('build/bar-local-server/postgres/bin')
assert.ok(root.startsWith(resolve('.tmp')+'\\'))
const passwordFile=join(root,'secrets/disposable-test-password.txt')
mkdirSync(join(root,'secrets'))
writeFileSync(passwordFile,randomBytes(32).toString('hex'),{mode:0o600})
writeFileSync(join(root,'owned-stage-fixture.json'),JSON.stringify({purpose:'unstarted installer stage smoke',data,pg},null,2))
const quote=v=>"'"+v.replaceAll("'","''")+"'"
const script=join(root,"Owner's configure stage.ps1")
const output=join(root,'configure-stage.log'), marker=join(root,'stage-result.json')
const failure=join(root,'stage-error.txt')
writeFileSync(script,[
 "$ErrorActionPreference='Stop'",
 "try {",
 ". "+quote(resolve('services/bar-local/packaging/windows/lib/BarLocalCommon.ps1')),
 "$installerAst=[System.Management.Automation.Language.Parser]::ParseFile("+quote(resolve('services/bar-local/packaging/windows/install-server.ps1'))+",[ref]$null,[ref]$null)",
 "$aclFunction=$installerAst.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Set-PgDataDirectoryAcl'},$true)",
 "Invoke-Expression $aclFunction.Extent.Text",
 "Set-ServiceDirectoryAcl -Path "+quote(join(root,'secrets'))+" -ServiceAccount 'NT AUTHORITY\\LocalService' -NoInherit -AdditionalAccount @('NT AUTHORITY\\NetworkService')",
 "Set-PgDataDirectoryAcl -Path "+quote(data)+" -Account 'NT AUTHORITY\\NetworkService' -AllowInstaller",
 "Set-AdminOnlyFileAcl -Path "+quote(passwordFile),
 "$passwordAcl=Get-Acl -LiteralPath "+quote(passwordFile),
 "$passwordAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule([System.Security.Principal.WindowsIdentity]::GetCurrent().User,'Read','Allow')))",
 "Set-Acl -LiteralPath "+quote(passwordFile)+" -AclObject $passwordAcl",
 "try {",
 "& "+quote(join(pg,'initdb.exe'))+" '-D' "+quote(data)+" '-U' 'bar_stage_test' "+quote('--pwfile='+passwordFile)+" '--auth-host=scram-sha-256' '--auth-local=scram-sha-256' '--encoding=UTF8' '--locale=C' '--data-checksums' *> "+quote(join(root,'initdb-stage.log')),
 "if($LASTEXITCODE -ne 0){throw 'Isolated elevated initdb stage failed'}",
 "} finally { Remove-Item -LiteralPath "+quote(passwordFile)+" -Force; Set-PgDataDirectoryAcl -Path "+quote(data)+" -Account 'NT AUTHORITY\\NetworkService' }",
 "Set-PgDataDirectoryAcl -Path "+quote(data)+" -Account 'NT AUTHORITY\\NetworkService'",
 "$originalDataAcl=(Get-Acl -LiteralPath "+quote(data)+").Sddl",
 "$parameters=@{PgBin="+quote(pg)+";PgDataDir="+quote(data)+";DbPort=[int]55449;ListenAddresses='localhost';AllowedCidrs=@();PgServiceName='TsaBonnoIsolatedStageNeverRegistered';NoApply=$true}",
 "& "+quote(resolve('services/bar-local/packaging/windows/configure-postgres.ps1'))+" @parameters *> "+quote(output),
 "& "+quote(resolve('services/bar-local/packaging/windows/configure-postgres.ps1'))+" @parameters *>> "+quote(output),
 "$configuration=[IO.File]::ReadAllText("+quote(join(data,'postgresql.conf'))+")",
 "$hba=[IO.File]::ReadAllText("+quote(join(data,'pg_hba.conf'))+")",
 "if((Get-Acl -LiteralPath "+quote(data)+").Sddl -ne $originalDataAcl){throw 'Validation did not restore the original data directory ACL'}",
 "if(([regex]::Matches($configuration,[regex]::Escape('# >>> Tsa Bonno BarLocal managed settings >>>'))).Count -ne 1){throw 'Configuration is not idempotent'}",
 "if($configuration -notmatch 'port = 55449' -or $configuration -notmatch \"listen_addresses = 'localhost'\"){throw 'Incorrect scoped configuration'}",
 "if($hba -match '(?m)^hostssl '){throw 'Loopback fixture unexpectedly opened LAN database access'}",
 "[IO.File]::WriteAllText("+quote(marker)+",'"+JSON.stringify({passed:true,database_started:false,service_registered:false,port:55449})+"')",
 "exit 0",
 "} catch { [IO.File]::WriteAllText("+quote(failure)+",$_.Exception.ToString()); exit 1 }"
].join('\n'))
const result=await defaultElevatedRunner({wrapperPath:script,cwd:root})
assert.equal(result.exitCode,0,(existsSync(failure)?readFileSync(failure,'utf8'):result.stdout)+'\n'+result.stderr)
assert.deepEqual(JSON.parse(readFileSync(marker,'utf8')),{passed:true,database_started:false,service_registered:false,port:55449})
console.log('PASS: actual elevated initdb with restricted execution and temporary-password ACL, then configure-postgres.ps1 twice with NoApply under strict service ACL; typed port, loopback scope, idempotency and ACL restoration. No server started or customer database/service changed.')
