/*
TODO: rename just Abortable
and favor something like const buildProjectAbortable = Abortable.start()
 */

import { createCleaner } from "./cleaner.js"
import { raceCallbacks } from "./callback_race.js"

export const AbortableOperation = {
  throwIfAborted: (operation) => {
    if (operation.signal.aborted) {
      const error = new Error(`The operation was aborted`)
      error.name = "AbortError"
      error.type = "aborted"
      throw error
    }
  },

  start: () => {
    const abortController = new AbortController()
    const cleaner = createCleaner()
    const operation = {
      abort: (value) => abortController.abort(value),
      signal: abortController.signal,
      cleaner,
    }
    return operation
  },

  fromSignal: (signal) => {
    const operation = AbortableOperation.start()
    AbortableOperation.followSignal(operation, signal)
    return operation
  },

  followSignal: (operation, signal, cleanup = cleanupNoop) => {
    if (operation.signal.aborted) {
      return
    }

    if (signal.aborted) {
      operation.abort()
      return
    }

    raceCallbacks(
      {
        parent_abort: (cb) => {
          return addEventListener(operation.signal, "abort", cb)
        },
        child_abort: (cb) => {
          return addEventListener(signal, "abort", cb)
        },
        cleaned: (cb) => {
          return operation.cleaner.addCallback(cb)
        },
      },
      (winner) => {
        const raceEffects = {
          parent_abort: () => {
            // Nothing to do, exists to remove
            // - "abort" event listener on parent
            // - "abort" event listener on child
            cleanup()
          },
          child_abort: () => {
            operation.abort()
          },
          cleaned: () => {
            // Nothing to do, exists to remove
            // - "abort" event listener on parent
            // - "abort" event listener on child
            cleanup()
          },
        }
        raceEffects[winner.name](winner.value)
      },
    )
  },

  effect: (operation, effect) => {
    const abortController = new AbortController()
    const returnValue = effect(abortController.abort)
    const cleanup =
      typeof returnValue === "function" ? returnValue : cleanupNoop
    const signal = abortController.signal

    AbortableOperation.followSignal(operation, signal, cleanup)
    return {
      signal,
      cleanup,
    }
  },

  timeout: (operation, ms) => {
    return AbortableOperation.effect(operation, (abort) => {
      const timeoutId = setTimeout(abort, ms)
      return () => {
        clearTimeout(timeoutId)
      }
    })
  },
}

const cleanupNoop = () => {}

const addEventListener = (target, eventName, cb) => {
  target.addEventListener(eventName, cb)
  return () => {
    target.removeEventListener(eventName, cb)
  }
}
