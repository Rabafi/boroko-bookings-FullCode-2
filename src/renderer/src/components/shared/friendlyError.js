// Plain-language safety net for error banners.
//
// Operators should never see database internals (function names, SQL codes,
// PostgREST/Electron plumbing). Known technical signatures are translated to
// actionable guidance; everything else passes through untouched so useful
// specifics (names, amounts, times, reference codes) are never stripped.
//
// Technical detail still belongs in logs and the support bundle — this only
// shapes what a person reads on screen.

const RULES = [
  {
    test: /permission denied for function/i,
    message:
      'The app is not allowed to do that yet. Your work is kept — ask a manager to update the app permissions, then relaunch and try again.',
  },
  {
    test: /failed to fetch|fetch failed|networkerror|network request failed|couldn'?t reach (the )?server|server.?unreachable/i,
    message:
      'There is no connection to the server. Check the internet, then try again — anything already saved on this device is kept.',
  },
  {
    test: /canceling statement|statement timeout|etimedout|request timed out|query timed out/i,
    message:
      'That took too long and was stopped safely. Nothing was recorded twice — wait a moment and try again.',
  },
  {
    test: /unique (violation|constraint)|duplicate key|already exists|23505|idempotency_conflict|already recorded/i,
    message: 'That was already recorded. Refresh and check before trying again.',
  },
  {
    test: /violates foreign key|foreign key constraint|23503|still in use|still referenced/i,
    message: 'That item is still in use, so it cannot be removed or changed right now.',
  },
  {
    test: /invalid input syntax|22p02|malformed|unexpected token/i,
    message: 'Something was not in the right format. Check what you typed and try again.',
  },
  {
    test: /too many (requests|attempts)|rate.?limit|429/i,
    message: 'Too many tries in a short time. Wait a minute and try again.',
  },
  {
    test: /\b(typeerror|referenceerror|syntaxerror|rangeerror)\b|undefined is not|not a function|null is not an object/i,
    message: 'Something went wrong on this device. Relaunch the app and try again.',
  },
]

function stripRemotePrefix(text) {
  return String(text).replace(/error invoking remote method\s+['"]?[^'":]+['"]?\s*:\s*/i, '')
}

export function friendlyErrorMessage(value) {
  if (value === null || value === undefined) return 'Something did not work. Try again.'
  if (typeof value !== 'string') return value
  let text = value.trim()
  if (!text) return 'Something did not work. Try again.'
  // Peel transport wrapping first so the real cause underneath is classified.
  for (let i = 0; i < 3; i += 1) {
    const stripped = stripRemotePrefix(text)
    if (stripped === text) break
    text = stripped.trim()
  }
  for (const rule of RULES) {
    if (rule.test.test(text)) return rule.message
  }
  return text
}
