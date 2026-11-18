/**
 * Client half of the git branch status bundle.
 *
 * Registers one ambient entry below the composer card and renders the branch
 * the Host resolved for this Session's working directory. Outside a Git
 * repository the entry renders nothing, so the composer keeps its plain shape.
 */

/** Dictionary namespace owned by this plugin. */
const NS = 'git-branch-status'

/** Host route answered by this package's Host half. */
const ROUTE = '/git-branch/status'

/** English dictionary (the key-set source of truth for this plugin). */
const en = {
  'branch.label': 'Git branch',
  'branch.aria': 'Git branch {branch}',
  'branch.detached': 'Detached at {sha}',
  'branch.title': '{branch} in {cwd}',
}

/** Simplified Chinese dictionary. */
const zh = {
  'branch.label': 'Git 分支',
  'branch.aria': 'Git 分支 {branch}',
  'branch.detached': '分离头指针，提交 {sha}',
  'branch.title': '{branch}，位于 {cwd}',
}

/** Component-local styles; rendered with the entry so unmounting removes them. */
const CSS = `
.dsh-git-branch {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  min-width: 0;
  padding: 1px 2px;
  font-size: 11px;
  line-height: 16px;
  font-family: inherit;
  color: var(--dsw-alias-label-secondary);
  user-select: none;
}
.dsh-git-branch svg {
  flex: none;
  opacity: 0.75;
}
.dsh-git-branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.dsh-git-branch[data-detached="true"] .dsh-git-branch-name {
  color: var(--dsw-alias-state-warn-primary);
}
`

window.__ModuleLoader__.load({
  id: '@local/git-branch-status',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /**
     * Read the branch of this Session's working directory.
     * @param sessionId - Session addressed by the Host route.
     * @returns resolved answer, or null while absent and outside a repository.
     */
    async function fetchStatus(sessionId, signal) {
      const response = await fetch(`${ROUTE}?session=${encodeURIComponent(String(sessionId))}`, {
        signal,
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return null
      const body = await response.json()
      return body !== null && typeof body === 'object' && body.repo ? body : null
    }

    /** Branch glyph: one trunk node, two branch nodes. */
    function BranchIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 12,
        height: 12,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        'aria-hidden': true,
      },
      h('circle', { cx: 4.5, cy: 3.5, r: 1.5 }),
      h('circle', { cx: 4.5, cy: 12.5, r: 1.5 }),
      h('circle', { cx: 11.5, cy: 6.5, r: 1.5 }),
      h('path', { d: 'M4.5 5v6M4.5 9c3.6 0 3.6-2.5 7-2.5' }))
    }

    /**
     * Ambient branch label below the composer card.
     * @param props - slot props; `sessionId` selects the directory, `t` translates.
     */
    function GitBranchStatus({ sessionId, t }) {
      const [status, setStatus] = React.useState(null)

      React.useEffect(() => {
        if (sessionId === undefined || sessionId === null) {
          setStatus(null)
          return undefined
        }
        let disposed = false
        let controller = null
        const load = () => {
          controller?.abort()
          const local = new AbortController()
          controller = local
          fetchStatus(sessionId, local.signal)
            .then((body) => {
              if (!disposed && controller === local) setStatus(body)
            })
            .catch(() => {
              if (!disposed && !local.signal.aborted && controller === local) setStatus(null)
            })
        }
        load()
        const onFocus = () => load()
        const onVisibility = () => {
          if (document.visibilityState === 'visible') load()
        }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibility)
        const timer = window.setInterval(load, 20000)
        return () => {
          disposed = true
          controller?.abort()
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisibility)
          window.clearInterval(timer)
        }
      }, [sessionId])

      if (status === null || status.branch === null || status.branch === '') return null
      const tr = typeof t === 'function' ? t : (key) => key
      const name = status.detached ? `@${status.branch}` : status.branch
      const title = status.detached
        ? tr('branch.detached', { sha: status.branch })
        : tr('branch.title', { branch: status.branch, cwd: status.cwd })
      const content = [h(BranchIcon, { key: 'icon' }), h('span', { key: 'name', className: 'dsh-git-branch-name' }, name)]
      return h(React.Fragment, null,
        h('style', { key: 'style' }, CSS),
        h('div', {
          key: 'entry',
          className: 'dsh-git-branch',
          style: { order: -1, marginRight: 'auto' },
          'data-git-branch': status.branch,
          'data-detached': status.detached ? 'true' : 'false',
          title,
          'aria-label': tr('branch.aria', { branch: name }),
        }, content),
        /*
         * The dock row centres every entry as one flex group. This invisible
         * twin claims the row's trailing free space with `margin-left: auto`,
         * so the label's `margin-right: auto` puts it on the left edge while
         * the shipped entries keep their exact centred position.
         */
        h('div', {
          key: 'balance',
          className: 'dsh-git-branch',
          style: { order: 11, marginLeft: 'auto', visibility: 'hidden' },
          'aria-hidden': true,
        }, content))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'git-branch-status: dictionaries')
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'git-branch-status',
          order: 10,
          locale: NS,
        }, GitBranchStatus))
      },
    }
  },
})
