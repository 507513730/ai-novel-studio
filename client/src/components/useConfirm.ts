import { createElement, useCallback, useState } from 'react'
import { ConfirmDialog, type ConfirmOptions } from './ConfirmDialog'

export function useConfirm(): [(opts: ConfirmOptions & { action: () => void }) => void, React.JSX.Element | null] {
  const [state, setState] = useState<{ options: ConfirmOptions; action: () => void } | null>(null)
  const confirm = useCallback((options: ConfirmOptions & { action: () => void }): void => {
    setState({ options, action: options.action })
  }, [])
  const dialog = state ? createElement(ConfirmDialog, {
    options: state.options,
    onConfirm: state.action,
    onCancel: () => setState(null)
  }) : null
  return [confirm, dialog]
}
