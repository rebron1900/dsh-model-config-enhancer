/**
 * Browser-half entry for the dsh-model-capabilities plugin — runs inside the dsh web GUI.
 *
 * Seats two Models-page extension areas for the `llm-pi-ai` adapter family:
 * the `settings.models.provider-card` capability editor (image input +
 * reasoning efforts + provider disable/enable) on every custom-provider card,
 * and the `settings.models.footer` archive listing where disabled providers
 * come back. Both read and write the official `llm-pi-ai` settings namespace
 * plus the plugin's own archive namespace over the standard remote settings
 * wire; the host half registers that archive namespace.
 *
 * It also seats the composer thinking-strength control at
 * `conversation.input.left`, which reads and writes the official per-session
 * model directory instead of the settings document.
 * @module @linxin666/dsh-client-ui-model-capabilities/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the Models-page SlotMap declarations
// ('settings.models.provider-card' / 'settings.models.footer'), our own
// LocaleNamespaceMap merge, and the owner-props types the panel reads.
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
// Type-only: pulls the conversation composer SlotMap declarations
// ('conversation.input.left').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the modelDirectories service declaration this plugin's
// composer control resolves its per-session directory through.
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { CapabilitiesPanel } from './CapabilitiesPanel.tsx'
import { DisabledProvidersFooter } from './DisabledProvidersFooter.tsx'
import { EffortSlider, type EffortDirectory } from './EffortSlider.tsx'
import { coalesceDescribe, type RefreshBus } from './settings-face.ts'
import { CAPS_SETTINGS_NAMESPACE } from '../core/provider-toggle.ts'
import { PI_AI_SETTINGS_NAMESPACE } from '../core/capabilities.ts'
import { NS, zh, en } from './locales.ts'

/**
 * Required services: slot registry, dictionary registry, the remote wire, and
 * the traced settings namespace — accessing `remote.settings` without
 * declaring the dotted path fails at runtime. The model directory and session
 * services back the composer control; they are read through `ctx.get` rather
 * than declared, so a host without them degrades to leaving that one control
 * unrendered instead of failing the whole plugin.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings']

/**
 * Client plugin body: register dictionaries, wire the refresh bus, and seat
 * both Models-page extension areas for the pi-ai family plus the composer
 * thinking-strength control.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-model-capabilities: dictionaries')

  // Concurrent readers (every provider-card panel plus the footer area) share
  // one describe per refresh instead of one full-document read each.
  const settings = coalesceDescribe((ctx.get('remote') as unknown as ClientRemote).settings)

  // Refresh bus: our own toggles notify directly; the host's committed-change
  // event covers every other surface (official cards, other tabs) the same way
  // the official model picker refreshes its catalog.
  const listeners = new Set<() => void>()
  const refresh: RefreshBus = {
    subscribe(callback) {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    notify() {
      for (const listener of [...listeners]) listener()
    },
  }
  ctx.effect(() => {
    try {
      // Only the two namespaces this plugin renders from: a write anywhere else
      // in the settings document cannot change what a panel shows.
      return ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns === PI_AI_SETTINGS_NAMESPACE || ns === CAPS_SETTINGS_NAMESPACE) refresh.notify()
      })
    } catch {
      return () => {}
    }
  }, 'dsh-model-capabilities: document events')

  ctx.slots.inject('settings.models.provider-card', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'settings.models.provider-card',
        key: 'llm-pi-ai',
        inject: () => ({ settings, refresh }),
      }, CapabilitiesPanel)
      return () => {
        unregister()
      }
    } catch {
      // The seat is declared by the official Models section; a host without
      // it (older deployment) offers no slot to fill, so register nothing.
      return () => {}
    }
  })

  ctx.slots.inject('settings.models.footer', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'settings.models.footer',
        id: 'ui-model-capabilities',
        inject: () => ({ settings, refresh }),
      }, DisabledProvidersFooter)
      return () => {
        unregister()
      }
    } catch {
      // Same posture as the provider-card seat: no declaration, no entry.
      return () => {}
    }
  })

  // Composer thinking-strength control, seated in the tool row beside the
  // model selector. The session directory comes from the official
  // `ctx.modelDirectories` service — the same per-session state the built-in
  // /model popup and the model seat share — so this control never keeps a
  // second copy of the selection. Resolved per session through the inject,
  // which receives the occurrence's `sessionId`.
  ctx.slots.inject('conversation.input.left', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'conversation.input.left',
        id: 'ui-model-capabilities-effort',
        inject: (sessionId: string) => ({ directory: directoryFace(ctx, sessionId as SessionId) }),
      }, EffortSlider)
      return () => {
        unregister()
      }
    } catch {
      // A host without the conversation composer declares no such seat.
      return () => {}
    }
  })
}

/**
 * Resolve the effort control's directory face for one session.
 *
 * Every failure mode degrades to an inert face rather than a throw: a host
 * without the model-selection package (`ctx.get('modelDirectories')` absent)
 * or an unknown session simply leaves the control unrendered, which is the
 * same posture a missing seat takes.
 * @param ctx - client root context.
 * @param sessionId - the session the composer occurrence belongs to.
 * @returns the directory face, or undefined when the seat cannot be served.
 */
function directoryFace(ctx: ClientContext, sessionId: SessionId): EffortDirectory | undefined {
  try {
    const models = ctx.get('modelDirectories')
    if (models === undefined || typeof models.directoryFor !== 'function') return undefined
    const directory = models.directoryFor(sessionId)
    const sessions = ctx.get('sessions')
    const available = sessions === undefined || typeof sessions.subagentAddress !== 'function'
      ? true
      : sessions.subagentAddress(sessionId) === undefined
    const store = directory.store
    // `select()`'s declared return collapses to void under skipLibCheck (see
    // EffortDirectory); the runtime resolves a RemoteResult, so the published
    // shape is asserted here rather than believed from the declaration.
    const commit = directory.select as unknown as (selection: ModelSelection) => Promise<RemoteResult<void>>
    return {
      available,
      subscribe: listener => store.subscribe(listener),
      getSnapshot: () => store.getSnapshot(),
      load: () => {
        if (available) void directory.load().catch(() => { /* surfaced on the store */ })
      },
      select: selection => available
        ? commit(selection).then(outcome => outcome.ok, () => false)
        : Promise.resolve(false),
    }
  } catch {
    return undefined
  }
}
