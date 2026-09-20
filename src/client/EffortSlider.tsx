/**
 * Composer thinking-strength control: a range slider seated at
 * `conversation.input.left`, in the composer tool row beside the model seat.
 *
 * State rides the official per-session {@link ModelDirectory} — the same
 * shared directory the built-in /model popup and the composer model seat use
 * (reached through `ctx.modelDirectories.directoryFor(sessionId)`), so a level
 * picked here is what every other surface shows next. The write is the
 * directory's own `select()` with the existing provider and model preserved
 * and only `reasoningEffort` replaced; there is no second copy of the
 * selection and no settings write.
 *
 * The levels offered come from the current model's own catalog reasoning
 * metadata (`ModelCatalogModel.reasoning.efforts`), never from a hard-coded
 * vocabulary: a model whose catalog declares no efforts renders nothing,
 * because offering a level the adapter would refuse is worse than offering
 * no control at all.
 * @module @linxin666/dsh-client-ui-model-capabilities/client/EffortSlider
 */

import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import type { ModelCatalogModel, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { t } from './locales.ts'
import css from './effort.module.css'

/**
 * The directory slice the control consumes, supplied by the apply body's
 * slot inject (which resolves the per-session directory).
 *
 * Typed locally for the same reason `settings-face.ts` types the settings
 * face locally: under this repo's dependency graph `skipLibCheck` swallows
 * the model-selection d.ts's own unresolved `RemoteResult` import, so
 * `select()`'s declared `Promise<RemoteResult<void>>` collapses to
 * `Promise<void>` at the call site. The runtime contract is the published
 * one, so the face restates it.
 */
export interface EffortDirectory {
  /** Subscribe to the shared snapshot; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
  /** Read the shared snapshot (the uSES getSnapshot half). */
  getSnapshot: () => ModelDirectoryState
  /** Reload the catalog; a no-op stub when the seat is unavailable. */
  load: () => void
  /** Commit a whole selection; resolves false when it is refused or unavailable. */
  select: (selection: ModelSelection) => Promise<boolean>
  /** Whether this session may use Agent-bound model RPCs. */
  available: boolean
}

/** Props of the composer thinking-strength control. */
export interface EffortSliderProps {
  /** The composer's lock state, supplied by the slot's owner share. */
  locked: boolean
  /** The resolved session directory, supplied by the apply body. */
  directory: EffortDirectory | undefined
}

/**
 * The snapshot answered while the seat has no directory: nothing selected, no
 * groups, idle. Shared by identity so the uSES comparison stays stable.
 */
const EMPTY_DIRECTORY_STATE: ModelDirectoryState = {
  current: null,
  routable: null,
  groups: [],
  failures: [],
  status: 'idle',
  error: null,
}

/**
 * Render the thinking-strength slider, or nothing when the current model
 * declares no reasoning efforts.
 * @param props - the composer lock state and the resolved session directory.
 * @returns the control, or null while there is nothing to control.
 */
export function EffortSlider(props: EffortSliderProps) {
  const { locked, directory } = props
  const sliderId = useId()
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [pendingId, setPendingId] = useState<string | undefined>(undefined)

  // The shared directory store is a uSES-safe subscribe/getSnapshot pair, so
  // read it through useSyncExternalStore rather than mirroring it into state —
  // that keeps the snapshots tear-free across the surface's concurrent renders.
  // The absent-directory case answers a single shared empty value rather than
  // undefined: useSyncExternalStore compares snapshots by identity, and a fresh
  // object per read would re-render on every store notification.
  const state = useSyncExternalStore(
    useCallback((listener: () => void) => directory === undefined ? () => {} : directory.subscribe(listener), [directory]),
    useCallback(() => directory?.getSnapshot() ?? EMPTY_DIRECTORY_STATE, [directory]),
  )

  useEffect(() => {
    directory?.load()
  }, [directory])

  const selection = state.current
  const groups = useMemo(() => state.groups, [state.groups])

  /** The catalog entry of the currently selected model, when the catalog knows it. */
  const model = useMemo<ModelCatalogModel | undefined>(() => {
    if (selection === null) return undefined
    const group = groups.find(candidate => candidate.id === selection.provider)
    return group?.models.find(candidate => candidate.id === selection.model)
  }, [groups, selection])

  const efforts = useMemo(() => model?.reasoning?.efforts ?? [], [model])

  // A model change invalidates both the optimistic pick and any stale failure.
  useEffect(() => {
    setFailure(undefined)
    setPendingId(undefined)
  }, [selection?.provider, selection?.model])

  /** The level in force: the pending optimistic pick, then the stored selection, then the catalog default. */
  const activeId = pendingId ?? selection?.reasoningEffort ?? model?.reasoning?.defaultEffort ?? efforts[0]?.id
  const activeIndex = efforts.findIndex(effort => effort.id === activeId)

  const commit = useCallback(async (nextId: string) => {
    if (directory === undefined || selection === null || locked || !directory.available) return
    // Optimistic: the slider tracks the drag even while the write is in flight,
    // so moving through levels feels continuous instead of snapping back.
    setPendingId(nextId)
    setFailure(undefined)
    const accepted = await directory.select({ ...selection, reasoningEffort: nextId })
    if (!accepted) {
      setPendingId(undefined)
      setFailure(t('effort.failed'))
    }
  }, [directory, locked, selection])

  // No declared efforts (or no selection yet) means no control: a level the
  // adapter would refuse must never be offered.
  if (directory === undefined || !directory.available || efforts.length === 0 || selection === null) return null

  const active = efforts[activeIndex >= 0 ? activeIndex : 0]
  const busy = state.status === 'selecting'

  return (
    <div className={css.wrap} data-dsh-plugin="model-capabilities" data-dsh-part="effort">
      <label className={css.label} htmlFor={sliderId}>{t('effort.label')}</label>
      <input
        id={sliderId}
        className={css.slider}
        type="range"
        min={0}
        max={Math.max(efforts.length - 1, 0)}
        step={1}
        value={activeIndex >= 0 ? activeIndex : 0}
        disabled={locked || busy || efforts.length < 2}
        aria-valuetext={active?.name}
        title={active === undefined ? t('effort.label') : t('effort.hint', { level: active.name })}
        data-dsh-part="effort-slider"
        onChange={event => {
          const next = efforts[Number(event.target.value)]
          if (next !== undefined) void commit(next.id)
        }}
      />
      <span className={css.value} role="status">{active?.name ?? activeId}</span>
      {failure !== undefined
        ? <span className={css.failed} role="alert">{failure}</span>
        : state.error !== null
          ? <span className={css.failed} role="alert">{state.error}</span>
          : null}
    </div>
  )
}
