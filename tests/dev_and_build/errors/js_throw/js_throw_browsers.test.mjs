import { assert } from "@jsenv/assert"

import { startDevServer, execute, chromium, firefox, webkit } from "@jsenv/core"

const test = async ({ runtime }) => {
  const devServer = await startDevServer({
    logLevel: "warn",
    rootDirectoryUrl: new URL("./client/", import.meta.url),
    keepProcessAlive: false,
    port: 0,
  })
  const { status, errors, consoleCalls } = await execute({
    // logLevel: "debug"
    rootDirectoryUrl: new URL("./client/", import.meta.url),
    devServerOrigin: devServer.origin,
    fileRelativeUrl: `./main.html`,
    runtime,
    // runtimeParams: {
    //   headful: true,
    // },
    // keepRunning: true,
    mirrorConsole: false,
    collectConsole: true,
    ignoreError: true,
  })
  devServer.stop()

  const error = errors[0]
  const actual = {
    status,
    errorMessage: error.message,
    consoleCalls,
  }
  const expected = {
    status: "errored",
    errorMessage: "SPECIAL_STRING_UNLIKELY_TO_COLLIDE",
    consoleCalls: [],
  }
  assert({ actual, expected })

  // error stack
  if (runtime === chromium) {
    const actual = error.originalStack
    const expected = `    at triggerError (${devServer.origin}/trigger_error.js:2:9)
    at ${devServer.origin}/main.js:3:1`
    assert({ actual, expected })
  }
  if (runtime === firefox) {
    const actual = error.originalStack
    const expected = `  triggerError@${devServer.origin}/trigger_error.js:2:9
@${devServer.origin}/main.js:2:1
`
    assert({ actual, expected })
  }
  if (runtime === webkit) {
    const expected = `  triggerError@${devServer.origin}/trigger_error.js:2:18
module code@${devServer.origin}/main.js:2:13`
    const actual = error.originalStack.slice(0, expected.length)
    assert({ actual, expected })
  }
}

await test({ runtime: chromium })
await test({ runtime: firefox })
await test({ runtime: webkit })
