// Explicit Windows/UAC smoke, never part of an unattended test run.
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { defaultElevatedRunner } from '../../src/main/bar-local/serverSetup.js'
assert.equal(process.env.BAR_LOCAL_RUN_UAC_SMOKE, '1', 'Explicitly enable this harmless UAC smoke')
const root = resolve('.tmp/bar-uac-smoke')
mkdirSync(root, { recursive: true })
const cwd = mkdtempSync(join(root, "Owner's Bar space "))
const wrapperPath = join(cwd, "Owner's harmless script.ps1")
const marker = join(cwd, 'marker.txt')
const quote = (value) => `'${value.replaceAll("'", "''")}'`
writeFileSync(wrapperPath, `$ErrorActionPreference='Stop'\n$p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())\nif (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Not elevated' }\n[System.IO.File]::WriteAllText(${quote(marker)}, 'elevated-marker-only')\nexit 0\n`)
const result = await defaultElevatedRunner({ wrapperPath, cwd })
assert.equal(result.exitCode, 0, result.stderr)
assert.equal(readFileSync(marker, 'utf8'), 'elevated-marker-only')
console.log('PASS: single-UAC Windows command host, canonical PowerShell child, encoded command, spaces/apostrophes, elevated harmless marker. No service/database actions.')
