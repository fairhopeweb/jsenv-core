import { programVisitor } from "istanbul-lib-instrument"
import { transpileWithBabel } from "./transpileWithBabel.js"

// https://github.com/istanbuljs/babel-plugin-istanbul/blob/321740f7b25d803f881466ea819d870f7ed6a254/src/index.js

const createInstrumentPlugin = ({ filename, useInlineSourceMaps = false } = {}) => {
  return ({ types }) => {
    return {
      visitor: {
        Program: {
          enter(path) {
            this.__dv__ = null

            let inputSourceMap
            const { file } = this
            const { opts } = file
            if (useInlineSourceMaps) {
              // https://github.com/istanbuljs/babel-plugin-istanbul/commit/a9e15643d249a2985e4387e4308022053b2cd0ad#diff-1fdf421c05c1140f6d71444ea2b27638R65
              inputSourceMap = opts.inputSourceMap || file.inputMap ? file.inputMap.sourcemap : null
            } else {
              inputSourceMap = opts.inputSourceMap
            }

            this.__dv__ = programVisitor(types, filename, {
              coverageVariable: "__coverage__",
              inputSourceMap,
            })
            this.__dv__.enter(path)
          },

          exit(path) {
            if (!this.__dv__) {
              return
            }
            const object = this.__dv__.exit(path)
            // object got two properties: fileCoverage and sourceMappingURL
            this.file.metadata.coverage = object.fileCoverage
          },
        },
      },
    }
  }
}

export const instrumenter = (context) => {
  const {
    root,
    inputName,
    inputSource,
    inputSourceMap,
    inputAst,
    options,
    sourceMapName,
    sourceLocationForSourceMap,
    sourceNameForSourceMap,
  } = context

  const babelOptions = {
    plugins: [
      // we are missing some plugins here, the syntax plugins are required to be able to traverse the tree no ?
      // yes indeed, we could copy/paste all syntax plugins here
      createInstrumentPlugin({ filename: inputName, useInlineSourceMaps: false }),
    ],
    filename: inputName,
    inputSourceMap,
  }

  return transpileWithBabel({
    root,
    inputAst,
    inputSource,
    options: babelOptions,
    remap: options.remap,
    sourceMapName,
    sourceLocationForSourceMap,
    sourceNameForSourceMap,
  })
}
