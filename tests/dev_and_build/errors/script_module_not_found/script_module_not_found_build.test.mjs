import { assert } from "@jsenv/assert"

import { build } from "@jsenv/core"

try {
  await build({
    logLevel: "warn",
    rootDirectoryUrl: new URL("./client/", import.meta.url),
    buildDirectoryUrl: new URL("./dist/", import.meta.url),
    entryPoints: {
      "./main.html": "main.html",
    },
    minification: false,
  })
  throw new Error("should throw")
} catch (e) {
  const actual = e.message
  const expected = `Failed to fetch url content
--- reason ---
no entry on filesystem
--- url ---
${new URL("./client/404.js", import.meta.url).href}
--- url reference trace ---
${new URL("./client/main.html", import.meta.url).href}:10:27
  9  |   <body>
> 10 |     <script type="module" src="./404.js"></script>
                                 ^
  11 |   </body>
--- plugin name ---
"jsenv:file_url_fetching"`
  assert({ actual, expected })
}
