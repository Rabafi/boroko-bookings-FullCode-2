const token = process.env.GH_TOKEN || ''

if (!token.trim()) {
  console.error('GH_TOKEN is not set.')
  console.error('PowerShell: $env:GH_TOKEN="your_token_here"')
  console.error('cmd.exe: set GH_TOKEN=your_token_here')
  process.exit(1)
}
