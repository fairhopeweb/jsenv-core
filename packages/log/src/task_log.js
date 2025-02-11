import { msAsDuration } from "./duration_log.js"
import { UNICODE } from "./unicode.js"
import { createLog } from "./log.js"
import { startSpinner } from "./spinner.js"

export const createTaskLog = (
  label,
  { disabled = false, stopOnWriteFromOutside } = {},
) => {
  if (disabled) {
    return {
      setRightText: () => {},
      done: () => {},
      happen: () => {},
      fail: () => {},
    }
  }
  const startMs = Date.now()
  const log = createLog()
  let message = label
  const taskSpinner = startSpinner({
    log,
    render: () => message,
    stopOnWriteFromOutside,
  })
  return {
    setRightText: (value) => {
      message = `${label} ${value}`
    },
    done: () => {
      const msEllapsed = Date.now() - startMs
      taskSpinner.stop(
        `${UNICODE.OK} ${label} (done in ${msAsDuration(msEllapsed)})`,
      )
    },
    happen: (message) => {
      taskSpinner.stop(
        `${UNICODE.INFO} ${message} (at ${new Date().toLocaleTimeString()})`,
      )
    },
    fail: (message = `failed to ${label}`) => {
      taskSpinner.stop(`${UNICODE.FAILURE} ${message}`)
    },
  }
}
