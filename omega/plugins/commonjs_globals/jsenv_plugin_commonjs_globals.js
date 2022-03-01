/*
 * Some code uses globals specific to Node.js in code meant to run in browsers...
 * This plugin will replace some node globals to things compatible with web:
 * - process.env.NODE_ENV
 * - __filename
 * - __dirname
 * - global
 */

import { babelTransform } from "@jsenv/core/src/internal/transform_js/babel_transform.js"

import { transformReplaceExpressions } from "./babel_plugin_transform_replace_expressions.js"

export const jsenvPluginCommonJsGlobals = () => {
  return {
    name: "jsenv:commonjs_globals",
    appliesDuring: {
      dev: true,
      test: true,
      preview: true,
      prod: true,
    },

    transform: async ({ scenario, url, content }) => {
      const { code, map } = await babelTransform({
        options: {
          plugins: [
            transformReplaceExpressions,
            {
              replaceMap: {
                "process.env.NODE_ENV": `("${
                  scenario === "dev" || scenario === "test" ? "dev" : "prod"
                }")`,
                "global": "globalThis",
                "__filename": `import.meta.url.slice('file:///'.length)`,
                "__dirname": `import.meta.url.slice('file:///'.length).replace(/[\\\/\\\\][^\\\/\\\\]*$/, '')`,
              },
              allowConflictingReplacements: true,
            },
          ],
        },
        url,
        content,
      })
      return {
        content: code,
        sourcemap: map,
      }
    },
  }
}
