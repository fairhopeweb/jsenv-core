import { assert } from "@jsenv/assert"

import { replacePlaceholders } from "@jsenv/core"

const result = replacePlaceholders(
  `const foo = __FOO__
const t = __FOO__
const bar = __BAR__`,
  {
    __FOO__: JSON.stringify("hello"),
    __BAR__: JSON.stringify("world"),
  },
)
const actual = result.content
const expected = `const foo = "hello"
const t = "hello"
const bar = "world"`
assert({ actual, expected })
