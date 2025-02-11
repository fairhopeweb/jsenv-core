import { assert } from "@jsenv/assert"

import { createChildExecOptions } from "@jsenv/core/src/execute/runtimes/node/child_exec_options.js"
import { ExecOptions } from "@jsenv/core/src/execute/runtimes/node/exec_options.js"

const test = async (params) => {
  const options = await createChildExecOptions(params)
  return ExecOptions.toExecArgv(options)
}

// debug mode inherited from nothing
{
  const actual = await test({
    processExecArgv: ["--test"],
    debugMode: "inherit",
    debugPort: 0,
  })
  const expected = ["--test"]
  assert({ actual, expected })
}

// debug mode inherited from inspect
{
  const actual = await test({
    processExecArgv: ["--before", "--inspect", "--after"],
    debugMode: "inherit",
    debugPort: 10,
  })
  const expected = ["--before", "--inspect=10", "--after"]
  assert({ actual, expected })
}

// debug mode inherited from inspect + port
{
  const actual = await test({
    processExecArgv: ["--before", "--inspect", "--inspect-port=10", "--after"],
    processDebugPort: 10,
    debugMode: "inherit",
    debugPort: 11,
  })
  const expected = ["--before", "--inspect=11", "--after"]
  assert({ actual, expected })
}

// debug mode becomes null from inspect
{
  const actual = await test({
    processExecArgv: ["--before", "--inspect", "--inspect-port=10", "--after"],
    processDebugPort: 10,
    debugMode: "none",
  })
  const expected = ["--before", "--after"]
  assert({ actual, expected })
}

// debug mode becomes inspect from nothing
{
  const actual = await test({
    processExecArgv: ["--before", "--after"],
    debugMode: "inspect",
    debugPort: 10,
  })
  const expected = ["--before", "--after", "--inspect=10"]
  assert({ actual, expected })
}

// debug mode becomes inspect from inspect-brk
{
  const actual = await test({
    processExecArgv: ["--before", "--inspect-brk=100", "--after"],
    debugMode: "inspect",
    debugPort: 10,
  })
  const expected = ["--before", "--after", "--inspect=10"]
  assert({ actual, expected })
}

// debugPort itself it not enough to enable debugging
{
  const actual = await test({
    processExecArgv: ["--before", "--after"],
    debugPort: 10,
  })
  const expected = ["--before", "--after"]
  assert({ actual, expected })
}
