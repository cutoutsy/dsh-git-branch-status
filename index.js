/**
 * Host half of the git branch status bundle.
 *
 * The Client half renders a small label below the composer. It cannot touch
 * the filesystem or run git, so this half answers one authenticated JSON route:
 * resolve the Session's working directory, then report the Git branch that
 * encloses it. Only `rev-parse` / `symbolic-ref` run, so the repository is
 * never modified.
 */

/** Exact route the Client half reads. Must stay unique on the Host. */
const ROUTE = '/git-branch/status'

/** How long one Session's answer is reused before git runs again. */
const CACHE_MS = 2000

/** Upper bound for one git invocation; branch lookup must never stall the page. */
const GIT_TIMEOUT_MS = 4000

/** Bytes kept from each git stream; branch names and object ids are tiny. */
const OUTPUT_MAX_BYTES = 8192

export const inject = ['webServer', 'connection', 'sessions', 'workingDirectory', 'subprocess']

/**
 * Run one read-only git command in `cwd`.
 * @param subprocess - Host subprocess service.
 * @param cwd - absolute directory git runs in.
 * @param args - git arguments, never shell-interpreted.
 * @returns exit code and trimmed stdout; never throws for a failed command.
 */
async function git(subprocess, cwd, args) {
  let executable
  try {
    executable = await subprocess.resolveExecutable('git')
  } catch {
    return { code: -1, text: '' }
  }
  let handle
  try {
    handle = subprocess.spawn({
      argv: [executable, '-C', cwd, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: OUTPUT_MAX_BYTES },
        stderr: { maxBytes: OUTPUT_MAX_BYTES },
      },
      graceMs: 1000,
      signal: AbortSignal.timeout(GIT_TIMEOUT_MS),
      env: {
        GIT_CONFIG_COUNT: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C',
      },
    })
  } catch {
    return { code: -1, text: '' }
  }
  try {
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    return { code: outcome.exitCode, text: stdout }
  } catch {
    return { code: -1, text: '' }
  }
}

/**
 * Inspect the repository enclosing one directory.
 * @param subprocess - Host subprocess service.
 * @param cwd - absolute Session working directory.
 * @returns repository root and the current branch, or an empty answer outside a repository.
 */
async function inspect(subprocess, cwd) {
  const inside = await git(subprocess, cwd, ['rev-parse', '--show-toplevel'])
  if (inside.code !== 0) return { repo: null, branch: null, detached: false }
  const repo = inside.text.trim()
  const symbolic = await git(subprocess, cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])
  const branch = symbolic.code === 0 ? symbolic.text.trim() : ''
  if (branch !== '') return { repo, branch, detached: false }
  const short = await git(subprocess, cwd, ['rev-parse', '--short', 'HEAD'])
  const sha = short.code === 0 ? short.text.trim() : ''
  return { repo, branch: sha === '' ? null : sha, detached: sha !== '' }
}

/**
 * Write one JSON response with no caching at the HTTP layer.
 * @param res - HTTP response.
 * @param status - status code.
 * @param payload - JSON-serializable body.
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

export function apply(ctx) {
  /** Session id -> recent answer; a short window absorbs renders and focus refetches. */
  const cache = new Map()

  /**
   * Answer one Session, reusing a recent result.
   * @param sessionId - Session whose working directory is inspected.
   * @returns the answer, or undefined when this process does not know the Session.
   */
  async function statusOf(sessionId) {
    const hit = cache.get(sessionId)
    if (hit !== undefined && Date.now() - hit.at < CACHE_MS) return hit.value
    const session = ctx.sessions.get(sessionId)
    if (session === undefined) return undefined
    const cwd = ctx.workingDirectory.get(session)
    let value
    try {
      value = { session: sessionId, cwd, ...(await inspect(ctx.subprocess, cwd)) }
    } catch {
      value = { session: sessionId, cwd, repo: null, branch: null, detached: false }
    }
    cache.set(sessionId, { at: Date.now(), value })
    return value
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405
        res.setHeader('allow', 'GET, HEAD')
        res.end()
        return
      }
      const url = new URL(String(req.url), 'http://localhost')
      const sessionId = url.searchParams.get('session')
      if (sessionId === null || sessionId === '') {
        sendJson(res, 400, { ok: false, error: 'missing-session' })
        return
      }
      const value = await statusOf(sessionId).catch(() => undefined)
      if (value === undefined) {
        sendJson(res, 404, { ok: false, error: 'unknown-session' })
        return
      }
      sendJson(res, 200, { ok: true, ...value })
    },
  }), `git-branch: GET ${ROUTE}`)
}
