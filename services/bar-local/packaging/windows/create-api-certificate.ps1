#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$NodePath, [Parameter(Mandatory=$true)][string]$OutputDir)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$writer = Join-Path $PSScriptRoot '..\..\scripts\write-api-certificate.mjs'
if (Test-Path -LiteralPath $OutputDir) {
    $result = & $NodePath $writer $OutputDir --inspect
    if ($LASTEXITCODE -ne 0) { throw 'The saved Bar API certificate could not be verified. It was not replaced.' }
    Write-Output $result
    exit 0
}
$stage = $OutputDir + '.new-' + [guid]::NewGuid().ToString('N')
[void][IO.Directory]::CreateDirectory($stage)
# Establish a protected ACL before any private key material is written.
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) {
    $identity = New-Object Security.Principal.SecurityIdentifier($sid)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
}
$directory = [IO.DirectoryInfo]::new($stage)
if ($directory.PSObject.Methods.Name -contains 'SetAccessControl') { $directory.SetAccessControl($acl) }
else { [IO.FileSystemAclExtensions]::SetAccessControl($directory, $acl) }
if (-not ('Security.Cryptography.X509Certificates.CertificateRequest' -as [type])) {
    throw 'Secure Bar network setup requires .NET Framework 4.7.2 or newer on this main computer.'
}
$rsa = [Security.Cryptography.RSACryptoServiceProvider]::new(3072)
$rsa.PersistKeyInCsp = $false
try {
    $name = [Net.Dns]::GetHostName()
    $req = [Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=$name", $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddDnsName('localhost'); $san.AddDnsName($name)
    $san.AddIpAddress([Net.IPAddress]::Loopback)
    foreach ($address in [Net.Dns]::GetHostAddresses($name)) {
        if ($address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) { $san.AddIpAddress($address) }
    }
    $req.CertificateExtensions.Add($san.Build())
    $req.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $oids = New-Object Security.Cryptography.OidCollection
    [void]$oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
    $req.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $true))
    $certificate = $req.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddYears(5))
    try {
        $key = $rsa.ExportParameters($true)
        function B64Url([byte[]]$Value) { return [Convert]::ToBase64String($Value).TrimEnd('=').Replace('+','-').Replace('/','_') }
        $payload = @{certificate=[Convert]::ToBase64String($certificate.RawData); jwk=@{kty='RSA';n=(B64Url $key.Modulus);e=(B64Url $key.Exponent);d=(B64Url $key.D);p=(B64Url $key.P);q=(B64Url $key.Q);dp=(B64Url $key.DP);dq=(B64Url $key.DQ);qi=(B64Url $key.InverseQ)}}
        $result = ($payload | ConvertTo-Json -Compress) | & $NodePath $writer $stage
        if ($LASTEXITCODE -ne 0) { throw 'The generated Bar certificate could not be verified and saved.' }
        Move-Item -LiteralPath $stage -Destination $OutputDir
        Write-Output $result
    } finally { $certificate.Dispose() }
} finally { $rsa.Dispose() }
