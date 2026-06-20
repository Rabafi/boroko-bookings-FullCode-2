# GitHub Terminal Workflow

This repo has two GitHub targets:

- Code repo: `https://github.com/Rabafi/boroko-bookings-FullCode-2.git`
- Desktop release repo: `Rabafi/boroko-bookings-releases`

## Daily Code Push

From the project root:

```powershell
cd "C:\path\to\Boroko Bookings"
git status
git add .
git commit -m "Describe the change"
git push -u origin <branch-name>
```

After the branch already exists on GitHub, future pushes can be:

```powershell
git push
```

## Deploy Manager PWA

```powershell
cd "C:\path\to\Boroko Bookings"
npm run pwa:deploy
```

The production alias should be:

```text
https://boroko-bookings.vercel.app
```

## Build Desktop Installer Locally

```powershell
cd "C:\path\to\Boroko Bookings"
npm run release:build
```

The installer is written to `dist`.

## Publish Desktop Release To GitHub

Electron Builder publishes to the release repo configured in `package.json`:

```json
"publish": {
  "provider": "github",
  "owner": "Rabafi",
  "repo": "boroko-bookings-releases"
}
```

You need a GitHub token available as `GH_TOKEN` or in a local file.

Recommended local file:

```text
.env.release
```

Example contents:

```text
GH_TOKEN=your_github_personal_access_token_here
```

For the current PowerShell window:

```powershell
$env:GH_TOKEN="paste_your_github_token_here"
npm run release:publish
```

For `cmd.exe`:

```bat
set GH_TOKEN=paste_your_github_token_here
npm run release:publish
```

To save it for future terminals:

```powershell
setx GH_TOKEN "paste_your_github_token_here"
```

Close and reopen PowerShell after `setx`.

## Automatic Version Bump

Use one of these if you do not want to edit `package.json` by hand:

```powershell
npm run release:patch
npm run release:minor
npm run release:major
npm run release:all
```

The first three commands bump the version automatically and then publish.

`npm run release:all` does the same and then reminds you to deploy the PWA next.

## Recommended Release Order

1. Build and test desktop:

```powershell
npm run build
npm test
```

2. Commit and push code:

```powershell
git add .
git commit -m "Release prep"
git push
```

3. Publish desktop installer:

```powershell
npm run release:publish
```

4. Deploy PWA when it changed:

```powershell
npm run pwa:deploy
```
