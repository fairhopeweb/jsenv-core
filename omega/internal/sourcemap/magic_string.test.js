import { createMagicString } from "./magic_string.js"

const content = `import { inferContextFrom, createUrlContext } from "../url_context.js";
// toto
`
const magic = createMagicString({ content })
magic.replace({
  start: 51,
  end: 70,
  replacement: `"/@fs/Users/d.maillard/dev/jsenv/jsenv-core/src/internal/url_context.js"`,
})
const ret = magic.toContentAndSourcemap()
console.log(ret)
