/** @vitest-environment jsdom */

/**
 * The composer thinking-strength control: levels come from the current
 * model's own catalog reasoning metadata, committing preserves the selected
 * provider and model and replaces only `reasoningEffort`, and a model that
 * declares no efforts renders no control at all (offering a level the adapter
 * would refuse is worse than offering nothing).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { EffortSlider, type EffortDirectory } from '../src/client/EffortSlider.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Build a directory face over a fixed snapshot with a recording select. */
function face(state: Partial<ModelDirectoryState>, options?: { available?: boolean }): {
  directory: EffortDirectory
  calls: { provider: string, model: string, reasoningEffort?: string }[]
} {
  const snapshot: ModelDirectoryState = {
    current: { provider: 'acme', model: 'gpt-x', reasoningEffort: 'medium' },
    routable: true,
    groups: [],
    failures: [],
    status: 'ready',
    error: null,
    ...state,
  }
  const calls: { provider: string, model: string, reasoningEffort?: string }[] = []
  const directory: EffortDirectory = {
    available: options?.available ?? true,
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    load: () => {},
    select: async (selection) => {
      calls.push({ ...selection })
      return true
    },
  }
  return { directory, calls }
}

/** A provider group serving one model with the given declared efforts. */
function groupWith(efforts: string[], defaultEffort?: string) {
  return {
    groups: [{
      id: 'acme',
      name: 'ACME',
      models: [{
        id: 'gpt-x',
        name: 'GPT X',
        reasoning: {
          efforts: efforts.map(id => ({ id, name: id.toUpperCase() })),
          ...(defaultEffort === undefined ? {} : { defaultEffort }),
        },
      }],
    }],
  }
}

describe('EffortSlider', () => {
  it('offers one step per declared effort and shows the current level', () => {
    const { directory } = face(groupWith(['low', 'medium', 'high']))
    render(<EffortSlider locked={false} directory={directory} />)

    const slider = screen.getByRole('slider')
    expect(slider).toHaveProperty('min', '0')
    expect(slider).toHaveProperty('max', '2')
    // The stored selection ('medium') is the middle step.
    expect(slider).toHaveProperty('value', '1')
    expect(screen.getByRole('status').textContent).toBe('MEDIUM')
  })

  it('commits the chosen level while preserving provider and model', async () => {
    const { directory, calls } = face(groupWith(['low', 'medium', 'high']))
    render(<EffortSlider locked={false} directory={directory} />)

    fireEvent.change(screen.getByRole('slider'), { target: { value: '2' } })

    await waitFor(() => { expect(calls.length).toBe(1) })
    expect(calls[0]).toEqual({ provider: 'acme', model: 'gpt-x', reasoningEffort: 'high' })
  })

  it('renders nothing when the model declares no reasoning efforts', () => {
    const { directory } = face({ groups: [{ id: 'acme', name: 'ACME', models: [{ id: 'gpt-x', name: 'GPT X' }] }] })
    const { container } = render(<EffortSlider locked={false} directory={directory} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing before a selection exists', () => {
    const { directory } = face({ current: null, ...groupWith(['low', 'high']) })
    const { container } = render(<EffortSlider locked={false} directory={directory} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the session seat is unavailable', () => {
    const { directory } = face(groupWith(['low', 'high']), { available: false })
    const { container } = render(<EffortSlider locked={false} directory={directory} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing without a resolved directory (host without the seat)', () => {
    const { container } = render(<EffortSlider locked={false} directory={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('disables the control while the composer is locked', () => {
    const { directory } = face(groupWith(['low', 'medium', 'high']))
    render(<EffortSlider locked directory={directory} />)
    expect(screen.getByRole('slider')).toHaveProperty('disabled', true)
  })

  it('falls back to the catalog default when nothing is selected yet', () => {
    const { directory } = face({ current: { provider: 'acme', model: 'gpt-x' }, ...groupWith(['low', 'medium', 'high'], 'high') })
    render(<EffortSlider locked={false} directory={directory} />)
    expect(screen.getByRole('status').textContent).toBe('HIGH')
  })
})
