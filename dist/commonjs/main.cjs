'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var module$1 = require('module');
var util = require('@jsenv/util');
var fs = require('fs');
var cancellation = require('@jsenv/cancellation');
var importMap = require('@jsenv/import-map');
var nodeModuleImportMap = require('@jsenv/node-module-import-map');
var server = require('@jsenv/server');
var logger = require('@jsenv/logger');
var https = require('https');
var path = require('path');
var crypto = require('crypto');
var os = require('os');
var readline = _interopDefault(require('readline'));
var nodeSignals = require('@jsenv/node-signals');
var vm = require('vm');
var child_process = require('child_process');
var _uneval = require('@jsenv/uneval');

/* global require, __filename */
const nodeRequire = require;
const filenameContainsBackSlashes = __filename.indexOf("\\") > -1;
const url = filenameContainsBackSlashes ? `file:///${__filename.replace(/\\/g, "/")}` : `file://${__filename}`;

const require$1 = module$1.createRequire(url);

/**

minimalBabelPluginArray exists so that jsenv support latest js syntax by default.
Otherwise users have to explicitely enable those syntax when they use it.

*/

const syntaxDynamicImport = require$1("@babel/plugin-syntax-dynamic-import");

const syntaxImportMeta = require$1("@babel/plugin-syntax-import-meta");

const syntaxNumericSeparator = require$1("@babel/plugin-syntax-numeric-separator");

const minimalBabelPluginArray = [syntaxDynamicImport, syntaxImportMeta, syntaxNumericSeparator];

/* eslint-disable */

const {
  template,
  types: t
} = require$1("@babel/core");

const {
  declare
} = require$1("@babel/helper-plugin-utils");

const {
  default: hoistVariables
} = require$1("@babel/helper-hoist-variables");

const buildTemplate = template(`
  SYSTEM_REGISTER(MODULE_NAME, SOURCES, function (EXPORT_IDENTIFIER, CONTEXT_IDENTIFIER) {
    "use strict";
    BEFORE_BODY;
    return {
      setters: SETTERS,
      execute: EXECUTE
    };
  });
`);
const buildExportAll = template(`
  for (var KEY in TARGET) {
    if (KEY !== "default" && KEY !== "__esModule") EXPORT_OBJ[KEY] = TARGET[KEY];
  }
`);

function constructExportCall(path, exportIdent, exportNames, exportValues, exportStarTarget) {
  const statements = [];

  if (exportNames.length === 1) {
    statements.push(t.expressionStatement(t.callExpression(exportIdent, [t.stringLiteral(exportNames[0]), exportValues[0]]))); // eslint-disable-next-line no-negated-condition
  } else if (!exportStarTarget) {
    const objectProperties = [];

    for (let i = 0; i < exportNames.length; i++) {
      const exportName = exportNames[i];
      const exportValue = exportValues[i];
      objectProperties.push(t.objectProperty(t.identifier(exportName), exportValue));
    }

    statements.push(t.expressionStatement(t.callExpression(exportIdent, [t.objectExpression(objectProperties)])));
  } else {
    const exportObj = path.scope.generateUid("exportObj");
    statements.push(t.variableDeclaration("var", [t.variableDeclarator(t.identifier(exportObj), t.objectExpression([]))]));
    statements.push(buildExportAll({
      KEY: path.scope.generateUidIdentifier("key"),
      EXPORT_OBJ: t.identifier(exportObj),
      TARGET: exportStarTarget
    }));

    for (let i = 0; i < exportNames.length; i++) {
      const exportName = exportNames[i];
      const exportValue = exportValues[i];
      statements.push(t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.identifier(exportObj), t.identifier(exportName)), exportValue)));
    }

    statements.push(t.expressionStatement(t.callExpression(exportIdent, [t.identifier(exportObj)])));
  }

  return statements;
}

const TYPE_IMPORT = "Import";
var transformModulesSystemJs = declare((api, options) => {
  api.assertVersion(7);
  const {
    systemGlobal = "System"
  } = options;
  const IGNORE_REASSIGNMENT_SYMBOL = Symbol();
  const reassignmentVisitor = {
    "AssignmentExpression|UpdateExpression"(path) {
      if (path.node[IGNORE_REASSIGNMENT_SYMBOL]) return;
      path.node[IGNORE_REASSIGNMENT_SYMBOL] = true;
      const arg = path.get(path.isAssignmentExpression() ? "left" : "argument");

      if (arg.isObjectPattern() || arg.isArrayPattern()) {
        const exprs = [path.node];

        for (const name of Object.keys(arg.getBindingIdentifiers())) {
          if (this.scope.getBinding(name) !== path.scope.getBinding(name)) {
            return;
          }

          const exportedNames = this.exports[name];
          if (!exportedNames) return;

          for (const exportedName of exportedNames) {
            exprs.push(this.buildCall(exportedName, t.identifier(name)).expression);
          }
        }

        path.replaceWith(t.sequenceExpression(exprs));
        return;
      }

      if (!arg.isIdentifier()) return;
      const name = arg.node.name; // redeclared in this scope

      if (this.scope.getBinding(name) !== path.scope.getBinding(name)) return;
      const exportedNames = this.exports[name];
      if (!exportedNames) return;
      let node = path.node; // if it is a non-prefix update expression (x++ etc)
      // then we must replace with the expression (_export('x', x + 1), x++)
      // in order to ensure the same update expression value

      const isPostUpdateExpression = path.isUpdateExpression({
        prefix: false
      });

      if (isPostUpdateExpression) {
        node = t.binaryExpression(node.operator[0], t.unaryExpression("+", t.cloneNode(node.argument)), t.numericLiteral(1));
      }

      for (const exportedName of exportedNames) {
        node = this.buildCall(exportedName, node).expression;
      }

      if (isPostUpdateExpression) {
        node = t.sequenceExpression([node, path.node]);
      }

      path.replaceWith(node);
    }

  };
  return {
    name: "transform-modules-systemjs",
    visitor: {
      CallExpression(path, state) {
        if (path.node.callee.type === TYPE_IMPORT) {
          path.replaceWith(t.callExpression(t.memberExpression(t.identifier(state.contextIdent), t.identifier("import")), path.node.arguments));
        }
      },

      MetaProperty(path, state) {
        if (path.node.meta.name === "import" && path.node.property.name === "meta") {
          path.replaceWith(t.memberExpression(t.identifier(state.contextIdent), t.identifier("meta")));
        }
      },

      ReferencedIdentifier(path, state) {
        if (path.node.name === "__moduleName" && !path.scope.hasBinding("__moduleName")) {
          path.replaceWith(t.memberExpression(t.identifier(state.contextIdent), t.identifier("id")));
        }
      },

      Program: {
        enter(path, state) {
          state.contextIdent = path.scope.generateUid("context");
        },

        exit(path, state) {
          const undefinedIdent = path.scope.buildUndefinedNode();
          const exportIdent = path.scope.generateUid("export");
          const contextIdent = state.contextIdent;
          const exportMap = Object.create(null);
          const modules = [];
          let beforeBody = [];
          const setters = [];
          const sources = [];
          const variableIds = [];
          const removedPaths = [];

          function addExportName(key, val) {
            exportMap[key] = exportMap[key] || [];
            exportMap[key].push(val);
          }

          function pushModule(source, key, specifiers) {
            let module;
            modules.forEach(function (m) {
              if (m.key === source) {
                module = m;
              }
            });

            if (!module) {
              modules.push(module = {
                key: source,
                imports: [],
                exports: []
              });
            }

            module[key] = module[key].concat(specifiers);
          }

          function buildExportCall(name, val) {
            return t.expressionStatement(t.callExpression(t.identifier(exportIdent), [t.stringLiteral(name), val]));
          }

          const exportNames = [];
          const exportValues = [];
          const body = path.get("body");

          for (const path of body) {
            if (path.isFunctionDeclaration()) {
              beforeBody.push(path.node);
              removedPaths.push(path);
            } else if (path.isClassDeclaration()) {
              variableIds.push(path.node.id);
              path.replaceWith(t.expressionStatement(t.assignmentExpression("=", t.cloneNode(path.node.id), t.toExpression(path.node))));
            } else if (path.isImportDeclaration()) {
              const source = path.node.source.value;
              pushModule(source, "imports", path.node.specifiers);

              for (const name of Object.keys(path.getBindingIdentifiers())) {
                path.scope.removeBinding(name);
                variableIds.push(t.identifier(name));
              }

              path.remove();
            } else if (path.isExportAllDeclaration()) {
              pushModule(path.node.source.value, "exports", path.node);
              path.remove();
            } else if (path.isExportDefaultDeclaration()) {
              const declar = path.get("declaration");
              const id = declar.node.id;

              if (declar.isClassDeclaration()) {
                if (id) {
                  exportNames.push("default");
                  exportValues.push(undefinedIdent);
                  variableIds.push(id);
                  addExportName(id.name, "default");
                  path.replaceWith(t.expressionStatement(t.assignmentExpression("=", t.cloneNode(id), t.toExpression(declar.node))));
                } else {
                  exportNames.push("default");
                  exportValues.push(t.toExpression(declar.node));
                  removedPaths.push(path);
                }
              } else if (declar.isFunctionDeclaration()) {
                if (id) {
                  beforeBody.push(declar.node);
                  exportNames.push("default");
                  exportValues.push(t.cloneNode(id));
                  addExportName(id.name, "default");
                } else {
                  exportNames.push("default");
                  exportValues.push(t.toExpression(declar.node));
                }

                removedPaths.push(path);
              } else {
                path.replaceWith(buildExportCall("default", declar.node));
              }
            } else if (path.isExportNamedDeclaration()) {
              const declar = path.get("declaration");

              if (declar.node) {
                path.replaceWith(declar);

                if (path.isFunction()) {
                  const node = declar.node;
                  const name = node.id.name;
                  addExportName(name, name);
                  beforeBody.push(node);
                  exportNames.push(name);
                  exportValues.push(t.cloneNode(node.id));
                  removedPaths.push(path);
                } else if (path.isClass()) {
                  const name = declar.node.id.name;
                  exportNames.push(name);
                  exportValues.push(undefinedIdent);
                  variableIds.push(declar.node.id);
                  path.replaceWith(t.expressionStatement(t.assignmentExpression("=", t.cloneNode(declar.node.id), t.toExpression(declar.node))));
                  addExportName(name, name);
                } else {
                  for (const name of Object.keys(declar.getBindingIdentifiers())) {
                    addExportName(name, name);
                  }
                }
              } else {
                const specifiers = path.node.specifiers;

                if (specifiers && specifiers.length) {
                  if (path.node.source) {
                    pushModule(path.node.source.value, "exports", specifiers);
                    path.remove();
                  } else {
                    const nodes = [];

                    for (const specifier of specifiers) {
                      const binding = path.scope.getBinding(specifier.local.name); // hoisted function export

                      if (binding && t.isFunctionDeclaration(binding.path.node)) {
                        exportNames.push(specifier.exported.name);
                        exportValues.push(t.cloneNode(specifier.local));
                      } // only globals also exported this way
                      else if (!binding) {
                          nodes.push(buildExportCall(specifier.exported.name, specifier.local));
                        }

                      addExportName(specifier.local.name, specifier.exported.name);
                    }

                    path.replaceWithMultiple(nodes);
                  }
                }
              }
            }
          }

          modules.forEach(function (specifiers) {
            let setterBody = [];
            const target = path.scope.generateUid(specifiers.key);

            for (let specifier of specifiers.imports) {
              if (t.isImportNamespaceSpecifier(specifier)) {
                setterBody.push(t.expressionStatement(t.assignmentExpression("=", specifier.local, t.identifier(target))));
              } else if (t.isImportDefaultSpecifier(specifier)) {
                specifier = t.importSpecifier(specifier.local, t.identifier("default"));
              }

              if (t.isImportSpecifier(specifier)) {
                setterBody.push(t.expressionStatement(t.assignmentExpression("=", specifier.local, t.memberExpression(t.identifier(target), specifier.imported))));
              }
            }

            if (specifiers.exports.length) {
              const exportNames = [];
              const exportValues = [];
              let hasExportStar = false;

              for (const node of specifiers.exports) {
                if (t.isExportAllDeclaration(node)) {
                  hasExportStar = true;
                } else if (t.isExportSpecifier(node)) {
                  exportNames.push(node.exported.name);
                  exportValues.push(t.memberExpression(t.identifier(target), node.local));
                }
              }

              setterBody = setterBody.concat(constructExportCall(path, t.identifier(exportIdent), exportNames, exportValues, hasExportStar ? t.identifier(target) : null));
            }

            sources.push(t.stringLiteral(specifiers.key));
            setters.push(t.functionExpression(null, [t.identifier(target)], t.blockStatement(setterBody)));
          });
          let moduleName = this.getModuleName();
          if (moduleName) moduleName = t.stringLiteral(moduleName);
          hoistVariables(path, (id, name, hasInit) => {
            variableIds.push(id);

            if (!hasInit) {
              exportNames.push(name);
              exportValues.push(undefinedIdent);
            }
          }, null);

          if (variableIds.length) {
            beforeBody.unshift(t.variableDeclaration("var", variableIds.map(id => t.variableDeclarator(id))));
          }

          if (exportNames.length) {
            beforeBody = beforeBody.concat(constructExportCall(path, t.identifier(exportIdent), exportNames, exportValues, null));
          }

          path.traverse(reassignmentVisitor, {
            exports: exportMap,
            buildCall: buildExportCall,
            scope: path.scope
          });

          for (const path of removedPaths) {
            path.remove();
          }

          path.node.body = [buildTemplate({
            SYSTEM_REGISTER: t.memberExpression(t.identifier(systemGlobal), t.identifier("register")),
            BEFORE_BODY: beforeBody,
            MODULE_NAME: moduleName,
            SETTERS: t.arrayExpression(setters),
            SOURCES: t.arrayExpression(sources),
            EXECUTE: t.functionExpression(null, [], t.blockStatement(path.node.body), false, options.topLevelAwait && programUsesTopLevelAwait(path)),
            EXPORT_IDENTIFIER: t.identifier(exportIdent),
            CONTEXT_IDENTIFIER: t.identifier(contextIdent)
          })];
        }

      }
    }
  };
});

const programUsesTopLevelAwait = path => {
  let hasTopLevelAwait = false;
  path.traverse({
    AwaitExpression(path) {
      const parent = path.getFunctionParent();
      if (!parent || parent.type === "Program") hasTopLevelAwait = true;
    }

  });
  return hasTopLevelAwait;
};

const findAsyncPluginNameInBabelPluginMap = babelPluginMap => {
  if ("transform-async-to-promises" in babelPluginMap) {
    return "transform-async-to-promises";
  }

  if ("transform-async-to-generator" in babelPluginMap) {
    return "transform-async-to-generator";
  }

  return "";
};

// https://github.com/drudru/ansi_up/blob/master/ansi_up.js

const Convert = require$1("ansi-to-html");

const ansiToHTML = ansiString => {
  return new Convert().toHtml(ansiString);
};

const {
  addSideEffect
} = require$1("@babel/helper-module-imports");

const ensureRegeneratorRuntimeImportBabelPlugin = (api, options) => {
  api.assertVersion(7);
  const {
    regeneratorRuntimeIdentifierName = "regeneratorRuntime",
    regeneratorRuntimeImportPath = "@jsenv/core/helpers/regenerator-runtime/regenerator-runtime.js"
  } = options;
  return {
    visitor: {
      Identifier(path, opts) {
        const {
          filename
        } = opts;
        const filepathname = filename.replace(/\\/g, "/");

        if (filepathname.endsWith("node_modules/regenerator-runtime/runtime.js")) {
          return;
        }

        const {
          node
        } = path;

        if (node.name === regeneratorRuntimeIdentifierName) {
          addSideEffect(path.scope.getProgramParent().path, regeneratorRuntimeImportPath);
        }
      }

    }
  };
};

const {
  addSideEffect: addSideEffect$1
} = require$1("@babel/helper-module-imports");

const ensureGlobalThisImportBabelPlugin = (api, options) => {
  api.assertVersion(7);
  const {
    globalThisIdentifierName = "globalThis",
    globalThisImportPath = "@jsenv/core/helpers/global-this/global-this.js"
  } = options;
  return {
    visitor: {
      Identifier(path, opts) {
        const {
          filename
        } = opts;
        const filepathname = filename.replace(/\\/g, "/");

        if (filepathname.endsWith("/helpers/global-this/global-this.js")) {
          return;
        }

        const {
          node
        } = path;

        if (node.name === globalThisIdentifierName) {
          addSideEffect$1(path.scope.getProgramParent().path, globalThisImportPath);
        }
      }

    }
  };
};

// https://github.com/babel/babel/blob/99f4f6c3b03c7f3f67cf1b9f1a21b80cfd5b0224/packages/babel-core/src/tools/build-external-helpers.js

const {
  list
} = require$1("@babel/helpers");

const babelHelperNameInsideJsenvCoreArray = ["applyDecoratedDescriptor", "arrayLikeToArray", "arrayWithHoles", "arrayWithoutHoles", "assertThisInitialized", "AsyncGenerator", "asyncGeneratorDelegate", "asyncIterator", "asyncToGenerator", "awaitAsyncGenerator", "AwaitValue", "classCallCheck", "classNameTDZError", "classPrivateFieldDestructureSet", "classPrivateFieldGet", "classPrivateFieldLooseBase", "classPrivateFieldLooseKey", "classPrivateFieldSet", "classPrivateMethodGet", "classPrivateMethodSet", "classStaticPrivateFieldSpecGet", "classStaticPrivateFieldSpecSet", "classStaticPrivateMethodGet", "classStaticPrivateMethodSet", "construct", "createClass", "createForOfIteratorHelper", "createForOfIteratorHelperLoose", "createSuper", "decorate", "defaults", "defineEnumerableProperties", "defineProperty", "extends", "get", "getPrototypeOf", "inherits", "inheritsLoose", "initializerDefineProperty", "initializerWarningHelper", "instanceof", "interopRequireDefault", "interopRequireWildcard", "isNativeFunction", "isNativeReflectConstruct", "iterableToArray", "iterableToArrayLimit", "iterableToArrayLimitLoose", "jsx", "newArrowCheck", "nonIterableRest", "nonIterableSpread", "objectDestructuringEmpty", "objectSpread", "objectSpread2", "objectWithoutProperties", "objectWithoutPropertiesLoose", "possibleConstructorReturn", "readOnlyError", "set", "setPrototypeOf", "skipFirstGeneratorNext", "slicedToArray", "slicedToArrayLoose", "superPropBase", "taggedTemplateLiteral", "taggedTemplateLiteralLoose", "tdz", "temporalRef", "temporalUndefined", "toArray", "toConsumableArray", "toPrimitive", "toPropertyKey", "typeof", "unsupportedIterableToArray", "wrapAsyncGenerator", "wrapNativeSuper", "wrapRegExp"];
const babelHelperScope = "@jsenv/core/helpers/babel/"; // maybe we can put back / in front of .jsenv here because we will
// "redirect" or at least transform everything inside .jsenv
// not only everything inside .dist

const babelHelperAbstractScope = `.jsenv/helpers/babel/`;
const babelHelperNameToImportSpecifier = babelHelperName => {
  if (babelHelperNameInsideJsenvCoreArray.includes(babelHelperName)) {
    return `${babelHelperScope}${babelHelperName}/${babelHelperName}.js`;
  }

  return `${babelHelperAbstractScope}${babelHelperName}/${babelHelperName}.js`;
};
const filePathToBabelHelperName = filePath => {
  const fileUrl = util.fileSystemPathToUrl(filePath);
  const babelHelperPrefix = "core/helpers/babel/";

  if (fileUrl.includes(babelHelperPrefix)) {
    const afterBabelHelper = fileUrl.slice(fileUrl.indexOf(babelHelperPrefix) + babelHelperPrefix.length);
    return afterBabelHelper.slice(0, afterBabelHelper.indexOf("/"));
  }

  if (fileUrl.includes(babelHelperAbstractScope)) {
    const afterBabelHelper = fileUrl.slice(fileUrl.indexOf(babelHelperAbstractScope) + babelHelperAbstractScope.length);
    return afterBabelHelper.slice(0, afterBabelHelper.indexOf("/"));
  }

  return null;
};

const {
  addDefault
} = require$1("@babel/helper-module-imports"); // named import approach found here:
// https://github.com/rollup/rollup-plugin-babel/blob/18e4232a450f320f44c651aa8c495f21c74d59ac/src/helperPlugin.js#L1
// for reference this is how it's done to reference
// a global babel helper object instead of using
// a named import
// https://github.com/babel/babel/blob/99f4f6c3b03c7f3f67cf1b9f1a21b80cfd5b0224/packages/babel-plugin-external-helpers/src/index.js


const transformBabelHelperToImportBabelPlugin = api => {
  api.assertVersion(7);
  return {
    pre: file => {
      const cachedHelpers = {};
      file.set("helperGenerator", name => {
        // the list of possible helpers name
        // https://github.com/babel/babel/blob/99f4f6c3b03c7f3f67cf1b9f1a21b80cfd5b0224/packages/babel-helpers/src/helpers.js#L13
        if (!file.availableHelper(name)) {
          return undefined;
        }

        if (cachedHelpers[name]) {
          return cachedHelpers[name];
        }

        const filePath = file.opts.filename;
        const babelHelperImportSpecifier = babelHelperNameToImportSpecifier(name);

        if (filePathToBabelHelperName(filePath) === name) {
          return undefined;
        }

        const helper = addDefault(file.path, babelHelperImportSpecifier, {
          nameHint: `_${name}`
        });
        cachedHelpers[name] = helper;
        return helper;
      });
    }
  };
};

/* eslint-disable import/max-dependencies */

const {
  transformAsync,
  transformFromAstAsync
} = require$1("@babel/core");

const jsenvTransform = async ({
  inputCode,
  inputPath,
  inputRelativePath,
  inputAst,
  inputMap,
  babelPluginMap,
  allowTopLevelAwait,
  transformTopLevelAwait,
  transformModuleIntoSystemFormat,
  transformGenerator,
  transformGlobalThis,
  regeneratorRuntimeImportPath,
  remap
}) => {
  // https://babeljs.io/docs/en/options
  const options = {
    filename: inputPath,
    filenameRelative: inputRelativePath,
    inputSourceMap: inputMap,
    configFile: false,
    babelrc: false,
    // trust only these options, do not read any babelrc config file
    ast: true,
    sourceMaps: remap,
    sourceFileName: inputPath,
    // https://babeljs.io/docs/en/options#parseropts
    parserOpts: {
      allowAwaitOutsideFunction: allowTopLevelAwait
    }
  };
  const babelHelperName = filePathToBabelHelperName(inputPath); // to prevent typeof circular dependency

  if (babelHelperName === "typeof") {
    const babelPluginMapWithoutTransformTypeOf = {};
    Object.keys(babelPluginMap).forEach(key => {
      if (key !== "transform-typeof-symbol") {
        babelPluginMapWithoutTransformTypeOf[key] = babelPluginMap[key];
      }
    });
    babelPluginMap = babelPluginMapWithoutTransformTypeOf;
  }

  if (transformGenerator) {
    babelPluginMap = { ...babelPluginMap,
      "ensure-regenerator-runtime-import": [ensureRegeneratorRuntimeImportBabelPlugin, {
        regeneratorRuntimeImportPath
      }]
    };
  }

  if (transformGlobalThis) {
    babelPluginMap = { ...babelPluginMap,
      "ensure-global-this-import": [ensureGlobalThisImportBabelPlugin]
    };
  }

  babelPluginMap = { ...babelPluginMap,
    "transform-babel-helpers-to-import": [transformBabelHelperToImportBabelPlugin]
  };
  const asyncPluginName = findAsyncPluginNameInBabelPluginMap(babelPluginMap);

  if (transformModuleIntoSystemFormat && transformTopLevelAwait && asyncPluginName) {
    const babelPluginArrayWithoutAsync = [];
    Object.keys(babelPluginMap).forEach(name => {
      if (name !== asyncPluginName) {
        babelPluginArrayWithoutAsync.push(babelPluginMap[name]);
      }
    }); // put body inside something like (async () => {})()

    const result = await babelTransform({
      ast: inputAst,
      code: inputCode,
      options: { ...options,
        plugins: [...minimalBabelPluginArray, ...babelPluginArrayWithoutAsync, [transformModulesSystemJs, {
          topLevelAwait: transformTopLevelAwait
        }]]
      }
    }); // we need to retranspile the await keywords now wrapped
    // inside Systemjs function.
    // They are ignored, at least by transform-async-to-promises
    // see https://github.com/rpetrich/babel-plugin-transform-async-to-promises/issues/26

    const finalResult = await babelTransform({
      // ast: result.ast,
      code: result.code,
      options: { ...options,
        // about inputSourceMap see
        // https://github.com/babel/babel/blob/eac4c5bc17133c2857f2c94c1a6a8643e3b547a7/packages/babel-core/src/transformation/file/generate.js#L57
        // https://github.com/babel/babel/blob/090c364a90fe73d36a30707fc612ce037bdbbb24/packages/babel-core/src/transformation/file/merge-map.js#L6s
        inputSourceMap: result.map,
        plugins: [...minimalBabelPluginArray, babelPluginMap[asyncPluginName]]
      }
    });
    return { ...result,
      ...finalResult,
      metadata: { ...result.metadata,
        ...finalResult.metadata
      }
    };
  }

  const babelPluginArray = [...minimalBabelPluginArray, ...Object.keys(babelPluginMap).map(babelPluginName => babelPluginMap[babelPluginName]), ...(transformModuleIntoSystemFormat ? [[transformModulesSystemJs, {
    topLevelAwait: transformTopLevelAwait
  }]] : [])];
  const result = await babelTransform({
    ast: inputAst,
    code: inputCode,
    options: { ...options,
      plugins: babelPluginArray
    }
  });
  return result;
};

const babelTransform = async ({
  ast,
  code,
  options
}) => {
  try {
    if (ast) {
      const result = await transformFromAstAsync(ast, code, options);
      return result;
    }

    return await transformAsync(code, options);
  } catch (error) {
    if (error && error.code === "BABEL_PARSE_ERROR") {
      const message = error.message;
      throw createParseError({
        message: message.replace(ansiRegex, ""),
        messageHTML: ansiToHTML(message),
        filename: options.filename,
        lineNumber: error.loc.line,
        columnNumber: error.loc.column
      });
    }

    throw error;
  }
};

const pattern = ["[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)", "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))"].join("|");
const ansiRegex = new RegExp(pattern, "g");

const createParseError = data => {
  const {
    message
  } = data;
  const parseError = new Error(message);
  parseError.code = "PARSE_ERROR";
  parseError.data = data;
  return parseError;
};

const transformJs = async ({
  projectDirectoryUrl,
  code,
  url,
  urlAfterTransform,
  map,
  babelPluginMap,
  convertMap = {},
  allowTopLevelAwait = true,
  transformTopLevelAwait = true,
  transformModuleIntoSystemFormat = true,
  transformGenerator = true,
  transformGlobalThis = true,
  remap = true
}) => {
  if (typeof projectDirectoryUrl !== "string") {
    throw new TypeError(`projectDirectoryUrl must be a string, got ${projectDirectoryUrl}`);
  }

  if (typeof babelPluginMap !== "object") {
    throw new TypeError(`babelPluginMap must be an object, got ${babelPluginMap}`);
  }

  if (typeof code !== "string") {
    throw new TypeError(`code must be a string, got ${code}`);
  }

  if (typeof url !== "string") {
    throw new TypeError(`url must be a string, got ${url}`);
  }

  const {
    inputCode,
    inputMap
  } = await computeInputCodeAndInputMap({
    code,
    url,
    urlAfterTransform,
    map,
    projectDirectoryUrl,
    convertMap,
    remap,
    allowTopLevelAwait
  });
  const inputPath = computeInputPath(url);
  const inputRelativePath = computeInputRelativePath(url, projectDirectoryUrl);
  return jsenvTransform({
    inputCode,
    inputMap,
    inputPath,
    inputRelativePath,
    babelPluginMap,
    convertMap,
    allowTopLevelAwait,
    transformTopLevelAwait,
    transformModuleIntoSystemFormat,
    transformGenerator,
    transformGlobalThis,
    remap
  });
};

const computeInputCodeAndInputMap = async ({
  code,
  url,
  urlAfterTransform,
  map,
  projectDirectoryUrl,
  convertMap,
  remap,
  allowTopLevelAwait
}) => {
  const specifierMetaMap = util.normalizeSpecifierMetaMap(util.metaMapToSpecifierMetaMap({
    convert: convertMap
  }), projectDirectoryUrl);
  const {
    convert
  } = util.urlToMeta({
    url,
    specifierMetaMap
  });

  if (!convert) {
    return {
      inputCode: code,
      inputMap: map
    };
  }

  if (typeof convert !== "function") {
    throw new TypeError(`convert must be a function, got ${convert}`);
  } // TODO: handle map when passed


  const conversionResult = await convert({
    projectDirectoryUrl,
    code,
    url,
    urlAfterTransform,
    map,
    remap,
    allowTopLevelAwait
  });

  if (typeof conversionResult !== "object") {
    throw new TypeError(`convert must return an object, got ${conversionResult}`);
  }

  const inputCode = conversionResult.code;

  if (typeof inputCode !== "string") {
    throw new TypeError(`convert must return { code } string, got { code: ${inputCode} } `);
  }

  const inputMap = conversionResult.map;
  return {
    inputCode,
    inputMap
  };
};

const computeInputPath = url => {
  if (url.startsWith("file://")) {
    return util.urlToFileSystemPath(url);
  }

  return url;
};

const computeInputRelativePath = (url, projectDirectoryUrl) => {
  if (url.startsWith(projectDirectoryUrl)) {
    return util.urlToRelativeUrl(url, projectDirectoryUrl);
  }

  return undefined;
};

// heavily inspired from https://github.com/jviide/babel-plugin-transform-replace-expressions
// last known commit: 57b608e0eeb8807db53d1c68292621dfafb5599c
const babelPluginReplaceExpressions = (api, options) => {
  const {
    traverse,
    parse,
    types
  } = api;
  const {
    replaceMap = {},
    allowConflictingReplacements = false
  } = options;
  const replacementMap = new Map();
  const valueExpressionSet = new Set();
  return {
    name: "transform-replace-expressions",
    pre: state => {
      // https://github.com/babel/babel/blob/d50e78d45b608f6e0f6cc33aeb22f5db5027b153/packages/babel-traverse/src/path/replacement.js#L93
      const parseExpression = value => {
        const expressionNode = parse(value, state.opts).program.body[0].expression;
        traverse.removeProperties(expressionNode);
        return expressionNode;
      };

      Object.keys(replaceMap).forEach(key => {
        const keyExpressionNode = parseExpression(key);
        const candidateArray = replacementMap.get(keyExpressionNode.type) || [];
        const value = replaceMap[key];
        const valueExpressionNode = parseExpression(value);
        const equivalentKeyExpressionIndex = candidateArray.findIndex(candidate => types.isNodesEquivalent(candidate.keyExpressionNode, keyExpressionNode));

        if (!allowConflictingReplacements && equivalentKeyExpressionIndex > -1) {
          throw new Error(`Expressions ${candidateArray[equivalentKeyExpressionIndex].key} and ${key} conflict`);
        }

        const newCandidate = {
          key,
          value,
          keyExpressionNode,
          valueExpressionNode
        };

        if (equivalentKeyExpressionIndex > -1) {
          candidateArray[equivalentKeyExpressionIndex] = newCandidate;
        } else {
          candidateArray.push(newCandidate);
        }

        replacementMap.set(keyExpressionNode.type, candidateArray);
      });
      replacementMap.forEach(candidateArray => {
        candidateArray.forEach(candidate => {
          valueExpressionSet.add(candidate.valueExpressionNode);
        });
      });
    },
    visitor: {
      Expression(path) {
        if (valueExpressionSet.has(path.node)) {
          path.skip();
          return;
        }

        const candidateArray = replacementMap.get(path.node.type);

        if (!candidateArray) {
          return;
        }

        const candidateFound = candidateArray.find(candidate => {
          return types.isNodesEquivalent(candidate.keyExpressionNode, path.node);
        });

        if (candidateFound) {
          try {
            types.validate(path.parent, path.key, candidateFound.valueExpressionNode);
          } catch (err) {
            if (!(err instanceof TypeError)) {
              throw err;
            }

            path.skip();
            return;
          }

          path.replaceWith(candidateFound.valueExpressionNode);
          return;
        }
      }

    }
  };
};

const transformCommonJs = require$1("babel-plugin-transform-commonjs");

const convertCommonJsWithBabel = async ({
  projectDirectoryUrl,
  code,
  url,
  replaceGlobalObject = true,
  replaceGlobalFilename = true,
  replaceGlobalDirname = true,
  replaceProcessEnvNodeEnv = true,
  processEnvNodeEnv = "undefined",
  replaceMap = {}
}) => {
  // maybe we should use babel core here instead of transformJs
  const result = await transformJs({
    projectDirectoryUrl,
    code,
    url,
    babelPluginMap: {
      "transform-commonjs": [transformCommonJs],
      "transform-replace-expressions": [babelPluginReplaceExpressions, {
        replaceMap: { ...(replaceProcessEnvNodeEnv ? {
            "process.env.NODE_ENV": `("${processEnvNodeEnv}")`
          } : {}),
          ...(replaceGlobalObject ? {
            global: "globalThis"
          } : {}),
          ...(replaceGlobalFilename ? {
            __filename: __filenameReplacement
          } : {}),
          ...(replaceGlobalDirname ? {
            __dirname: __dirnameReplacement
          } : {}),
          ...replaceMap
        }
      }]
    },
    transformModuleIntoSystemFormat: false
  });
  return result;
};
const __filenameReplacement = `import.meta.url.slice('file:///'.length)`;
const __dirnameReplacement = `import.meta.url.slice('file:///'.length).replace(/[\\\/\\\\][^\\\/\\\\]*$/, '')`; // const createInlineProcessNodeEnvBabelPlugin = ({ value = process.env.NODE_ENV }) => {
//   return ({ types: t }) => {
//     return {
//       name: "inline-process-node-env",
//       visitor: {
//         MemberExpression(path) {
//           if (path.matchesPattern("process.env.NODE_ENV")) {
//             path.replaceWith(t.valueToNode(value))
//             if (path.parentPath.isBinaryExpression()) {
//               const evaluated = path.parentPath.evaluate()
//               if (evaluated.confident) {
//                 path.parentPath.replaceWith(t.valueToNode(evaluated.value))
//               }
//             }
//           }
//         },
//       },
//     }
//   }
// }

const {
  rollup
} = require$1("rollup");

const commonjs = require$1("@rollup/plugin-commonjs");

const {
  nodeResolve
} = require$1("@rollup/plugin-node-resolve");

const createJSONRollupPlugin = require$1("@rollup/plugin-json");

const createReplaceRollupPlugin = require$1("@rollup/plugin-replace");

const builtins = require$1("rollup-plugin-node-builtins");

const createNodeGlobalRollupPlugin = require$1("rollup-plugin-node-globals");

const convertCommonJsWithRollup = async ({
  url,
  urlAfterTransform,
  replaceGlobalObject = true,
  replaceGlobalFilename = true,
  replaceGlobalDirname = true,
  replaceProcessEnvNodeEnv = true,
  replaceProcess = true,
  replaceBuffer = true,
  processEnvNodeEnv = "undefined",
  replaceMap = {},
  convertBuiltinsToBrowser = true,
  external = []
} = {}) => {
  if (!url.startsWith("file:///")) {
    // it's possible to make rollup compatible with http:// for instance
    // as we do in @jsenv/bundling
    // however it's an exotic use case for now
    throw new Error(`compatible only with file:// protocol, got ${url}`);
  }

  const filePath = util.urlToFileSystemPath(url);
  const nodeBuiltinsRollupPlugin = builtins();
  const nodeResolveRollupPlugin = nodeResolve({
    mainFields: ["main"]
  });
  const jsonRollupPlugin = createJSONRollupPlugin();
  const nodeGlobalRollupPlugin = createNodeGlobalRollupPlugin({
    global: false,
    // handled by replaceMap
    dirname: false,
    // handled by replaceMap
    filename: false,
    //  handled by replaceMap
    process: replaceProcess,
    buffer: replaceBuffer
  });
  const commonJsRollupPlugin = commonjs();
  const rollupBundle = await rollup({
    input: filePath,
    inlineDynamicImports: true,
    external,
    plugins: [commonJsRollupPlugin, createReplaceRollupPlugin({ ...(replaceProcessEnvNodeEnv ? {
        "process.env.NODE_ENV": JSON.stringify(processEnvNodeEnv)
      } : {}),
      ...(replaceGlobalObject ? {
        global: "globalThis"
      } : {}),
      ...(replaceGlobalFilename ? {
        __filename: __filenameReplacement$1
      } : {}),
      ...(replaceGlobalDirname ? {
        __dirname: __dirnameReplacement$1
      } : {}),
      ...replaceMap
    }), nodeGlobalRollupPlugin, ...(convertBuiltinsToBrowser ? [nodeBuiltinsRollupPlugin] : []), nodeResolveRollupPlugin, jsonRollupPlugin]
  });
  const generateOptions = {
    // https://rollupjs.org/guide/en#output-format
    format: "esm",
    // entryFileNames: `./[name].js`,
    // https://rollupjs.org/guide/en#output-sourcemap
    sourcemap: true,
    sourcemapExcludeSources: true,
    ...(urlAfterTransform ? {
      dir: util.urlToFileSystemPath(util.resolveUrl("./", urlAfterTransform))
    } : {})
  };
  const result = await rollupBundle.generate(generateOptions);
  return result.output[0];
};
const __filenameReplacement$1 = `import.meta.url.slice('file:///'.length)`;
const __dirnameReplacement$1 = `import.meta.url.slice('file:///'.length).replace(/[\\\/\\\\][^\\\/\\\\]*$/, '')`;

const wrapExternalFunctionExecution = fn => util.wrapExternalFunction(fn, {
  catchCancellation: true,
  unhandledRejectionStrict: true
});

const assertProjectDirectoryUrl = ({
  projectDirectoryUrl
}) => {
  return util.assertAndNormalizeDirectoryUrl(projectDirectoryUrl);
};
const assertProjectDirectoryExists = ({
  projectDirectoryUrl
}) => {
  util.assertDirectoryPresence(projectDirectoryUrl);
};
const assertImportMapFileRelativeUrl = ({
  importMapFileRelativeUrl
}) => {
  if (importMapFileRelativeUrl === "") {
    throw new TypeError(`importMapFileRelativeUrl is an empty string`);
  }

  if (typeof importMapFileRelativeUrl !== "string") {
    throw new TypeError(`importMapFileRelativeUrl must be a string, received ${importMapFileRelativeUrl}`);
  }
};
const assertImportMapFileInsideProject = ({
  importMapFileUrl,
  projectDirectoryUrl
}) => {
  if (!util.urlIsInsideOf(importMapFileUrl, projectDirectoryUrl)) {
    throw new Error(`importmap file must be inside project directory
--- import map file url ---
${importMapFileUrl}
--- project directory url ---
${projectDirectoryUrl}`);
  }
};

const COMPILE_ID_BEST = "best";
const COMPILE_ID_OTHERWISE = "otherwise";
const COMPILE_ID_GLOBAL_BUNDLE = "otherwise-global-bundle";
const COMPILE_ID_GLOBAL_BUNDLE_FILES = "otherwise-global-bundle-files";
const COMPILE_ID_COMMONJS_BUNDLE = "otherwise-commonjs-bundle";
const COMPILE_ID_COMMONJS_BUNDLE_FILES = "otherwise-commonjs-bundle-files";

https.globalAgent.options.rejectUnauthorized = false;
const fetchUrl = async (url, {
  simplified = false,
  ignoreHttpsError = true,
  ...rest
} = {}) => {
  const response = await server.fetchUrl(url, {
    simplified,
    ignoreHttpsError,
    ...rest
  });
  return {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    headers: responseToHeaders(response),
    text: response.text.bind(response),
    json: response.json.bind(response),
    blob: response.blob.bind(response),
    arrayBuffer: response.arrayBuffer.bind(response)
  };
};

const responseToHeaders = response => {
  const headers = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
};

let jsenvCoreDirectoryUrl;

if (typeof __filename === "string") {
  jsenvCoreDirectoryUrl = util.resolveUrl( // get ride of dist/commonjs/main.js
  "../../", util.fileSystemPathToUrl(__filename));
} else {
  jsenvCoreDirectoryUrl = util.resolveUrl( // get ride of src/internal/jsenvCoreDirectoryUrl.js
  "../../", url);
}

const valueToVersion = value => {
  if (typeof value === "number") {
    return numberToVersion(value);
  }

  if (typeof value === "string") {
    return stringToVersion(value);
  }

  throw new TypeError(createValueErrorMessage({
    version: value
  }));
};

const numberToVersion = number => {
  return {
    major: number,
    minor: 0,
    patch: 0
  };
};

const stringToVersion = string => {
  if (string.indexOf(".") > -1) {
    const parts = string.split(".");
    return {
      major: Number(parts[0]),
      minor: parts[1] ? Number(parts[1]) : 0,
      patch: parts[2] ? Number(parts[2]) : 0
    };
  }

  if (isNaN(string)) {
    return {
      major: 0,
      minor: 0,
      patch: 0
    };
  }

  return {
    major: Number(string),
    minor: 0,
    patch: 0
  };
};

const createValueErrorMessage = ({
  value
}) => `value must be a number or a string.
value: ${value}`;

const versionCompare = (versionA, versionB) => {
  const semanticVersionA = valueToVersion(versionA);
  const semanticVersionB = valueToVersion(versionB);
  const majorDiff = semanticVersionA.major - semanticVersionB.major;

  if (majorDiff > 0) {
    return majorDiff;
  }

  if (majorDiff < 0) {
    return majorDiff;
  }

  const minorDiff = semanticVersionA.minor - semanticVersionB.minor;

  if (minorDiff > 0) {
    return minorDiff;
  }

  if (minorDiff < 0) {
    return minorDiff;
  }

  const patchDiff = semanticVersionA.patch - semanticVersionB.patch;

  if (patchDiff > 0) {
    return patchDiff;
  }

  if (patchDiff < 0) {
    return patchDiff;
  }

  return 0;
};

const versionIsBelow = (versionSupposedBelow, versionSupposedAbove) => {
  return versionCompare(versionSupposedBelow, versionSupposedAbove) < 0;
};

const findHighestVersion = (...values) => {
  if (values.length === 0) throw new Error(`missing argument`);
  return values.reduce((highestVersion, value) => {
    if (versionIsBelow(highestVersion, value)) {
      return value;
    }

    return highestVersion;
  });
};

// copied from
// https://github.com/babel/babel/blob/master/packages/babel-compat-data/data/plugins.json#L1
// now moved at https://github.com/babel/babel/blob/548cb3ee89552ffc08ee5625b084bd33f8107530/packages/babel-compat-data/data/plugins.json#L1
// Because this is an hidden implementation detail of @babel/preset-env
// it could be deprecated or moved anytime.
// For that reason it makes more sens to have it inlined here
// than importing it from an undocumented location.
// Ideally it would be documented or a separate module
const jsenvBabelPluginCompatMap = {
  "proposal-numeric-separator": {
    chrome: "75",
    edge: "79",
    firefox: "70",
    safari: "13",
    node: "12.5",
    ios: "13",
    opera: "62",
    electron: "6.1"
  },
  "proposal-nullish-coalescing-operator": {
    chrome: "80",
    edge: "80",
    firefox: "72",
    safari: "13.1",
    opera: "67",
    electron: "8.1"
  },
  "proposal-optional-chaining": {
    chrome: "80",
    edge: "80",
    firefox: "74",
    safari: "13.1",
    opera: "67",
    electron: "8.1"
  },
  "proposal-json-strings": {
    chrome: "66",
    edge: "79",
    firefox: "62",
    safari: "12",
    node: "10",
    ios: "12",
    samsung: "9",
    opera: "53",
    electron: "3.1"
  },
  "proposal-optional-catch-binding": {
    chrome: "66",
    edge: "79",
    firefox: "58",
    safari: "11.1",
    node: "10",
    ios: "11.3",
    samsung: "9",
    opera: "53",
    electron: "3.1"
  },
  "proposal-async-generator-functions": {
    chrome: "63",
    edge: "79",
    firefox: "57",
    safari: "12",
    node: "10",
    ios: "12",
    samsung: "8",
    opera: "50",
    electron: "3.1"
  },
  "proposal-object-rest-spread": {
    chrome: "60",
    edge: "79",
    firefox: "55",
    safari: "11.1",
    node: "8.3",
    ios: "11.3",
    samsung: "8",
    opera: "47",
    electron: "2.1"
  },
  "transform-dotall-regex": {
    chrome: "62",
    edge: "79",
    safari: "11.1",
    node: "8.10",
    ios: "11.3",
    samsung: "8",
    opera: "49",
    electron: "3.1"
  },
  "proposal-unicode-property-regex": {
    chrome: "64",
    edge: "79",
    safari: "11.1",
    node: "10",
    ios: "11.3",
    samsung: "9",
    opera: "51",
    electron: "3.1"
  },
  "transform-named-capturing-groups-regex": {
    chrome: "64",
    edge: "79",
    safari: "11.1",
    node: "10",
    ios: "11.3",
    samsung: "9",
    opera: "51",
    electron: "3.1"
  },
  // copy of transform-async-to-generator
  // so that async is not transpiled when supported
  "transform-async-to-promises": {
    chrome: "55",
    edge: "15",
    firefox: "52",
    safari: "11",
    node: "7.6",
    ios: "11",
    samsung: "6",
    opera: "42",
    electron: "1.6"
  },
  "transform-async-to-generator": {
    chrome: "55",
    edge: "15",
    firefox: "52",
    safari: "11",
    node: "7.6",
    ios: "11",
    samsung: "6",
    opera: "42",
    electron: "1.6"
  },
  "transform-exponentiation-operator": {
    chrome: "52",
    edge: "14",
    firefox: "52",
    safari: "10.1",
    node: "7",
    ios: "10.3",
    samsung: "6",
    opera: "39",
    electron: "1.3"
  },
  "transform-template-literals": {
    chrome: "41",
    edge: "13",
    firefox: "34",
    safari: "13",
    node: "4",
    ios: "13",
    samsung: "3.4",
    opera: "28",
    electron: "0.24"
  },
  "transform-literals": {
    chrome: "44",
    edge: "12",
    firefox: "53",
    safari: "9",
    node: "4",
    ios: "9",
    samsung: "4",
    opera: "31",
    electron: "0.31"
  },
  "transform-function-name": {
    chrome: "51",
    edge: "79",
    firefox: "53",
    safari: "10",
    node: "6.5",
    ios: "10",
    samsung: "5",
    opera: "38",
    electron: "1.2"
  },
  "transform-arrow-functions": {
    chrome: "47",
    edge: "13",
    firefox: "45",
    safari: "10",
    node: "6",
    ios: "10",
    samsung: "5",
    opera: "34",
    electron: "0.36"
  },
  "transform-block-scoped-functions": {
    chrome: "41",
    edge: "12",
    firefox: "46",
    safari: "10",
    node: "4",
    ie: "11",
    ios: "10",
    samsung: "3.4",
    opera: "28",
    electron: "0.24"
  },
  "transform-classes": {
    chrome: "46",
    edge: "13",
    firefox: "45",
    safari: "10",
    node: "5",
    ios: "10",
    samsung: "5",
    opera: "33",
    electron: "0.36"
  },
  "transform-object-super": {
    chrome: "46",
    edge: "13",
    firefox: "45",
    safari: "10",
    node: "5",
    ios: "10",
    samsung: "5",
    opera: "33",
    electron: "0.36"
  },
  "transform-shorthand-properties": {
    chrome: "43",
    edge: "12",
    firefox: "33",
    safari: "9",
    node: "4",
    ios: "9",
    samsung: "4",
    opera: "30",
    electron: "0.29"
  },
  "transform-duplicate-keys": {
    chrome: "42",
    edge: "12",
    firefox: "34",
    safari: "9",
    node: "4",
    ios: "9",
    samsung: "3.4",
    opera: "29",
    electron: "0.27"
  },
  "transform-computed-properties": {
    chrome: "44",
    edge: "12",
    firefox: "34",
    safari: "7.1",
    node: "4",
    ios: "8",
    samsung: "4",
    opera: "31",
    electron: "0.31"
  },
  "transform-for-of": {
    chrome: "51",
    edge: "15",
    firefox: "53",
    safari: "10",
    node: "6.5",
    ios: "10",
    samsung: "5",
    opera: "38",
    electron: "1.2"
  },
  "transform-sticky-regex": {
    chrome: "49",
    edge: "13",
    firefox: "3",
    safari: "10",
    node: "6",
    ios: "10",
    samsung: "5",
    opera: "36",
    electron: "1"
  },
  "transform-unicode-regex": {
    chrome: "50",
    edge: "13",
    firefox: "46",
    safari: "12",
    node: "6",
    ios: "12",
    samsung: "5",
    opera: "37",
    electron: "1.1"
  },
  "transform-spread": {
    chrome: "46",
    edge: "13",
    firefox: "36",
    safari: "10",
    node: "5",
    ios: "10",
    samsung: "5",
    opera: "33",
    electron: "0.36"
  },
  "transform-parameters": {
    chrome: "49",
    edge: "18",
    firefox: "53",
    safari: "10",
    node: "6",
    ios: "10",
    samsung: "5",
    opera: "36",
    electron: "1"
  },
  "transform-destructuring": {
    chrome: "51",
    edge: "15",
    firefox: "53",
    safari: "10",
    node: "6.5",
    ios: "10",
    samsung: "5",
    opera: "38",
    electron: "1.2"
  },
  "transform-block-scoping": {
    chrome: "49",
    edge: "14",
    firefox: "51",
    safari: "11",
    node: "6",
    ios: "11",
    samsung: "5",
    opera: "36",
    electron: "1"
  },
  "transform-typeof-symbol": {
    chrome: "38",
    edge: "12",
    firefox: "36",
    safari: "9",
    node: "0.12",
    ios: "9",
    samsung: "3",
    opera: "25",
    electron: "0.2"
  },
  "transform-new-target": {
    chrome: "46",
    edge: "14",
    firefox: "41",
    safari: "10",
    node: "5",
    ios: "10",
    samsung: "5",
    opera: "33",
    electron: "0.36"
  },
  "transform-regenerator": {
    chrome: "50",
    edge: "13",
    firefox: "53",
    safari: "10",
    node: "6",
    ios: "10",
    samsung: "5",
    opera: "37",
    electron: "1.1"
  },
  "transform-member-expression-literals": {
    chrome: "7",
    opera: "12",
    edge: "12",
    firefox: "2",
    safari: "5.1",
    node: "0.10",
    ie: "9",
    android: "4",
    ios: "6",
    phantom: "2",
    samsung: "1",
    electron: "5"
  },
  "transform-property-literals": {
    chrome: "7",
    opera: "12",
    edge: "12",
    firefox: "2",
    safari: "5.1",
    node: "0.10",
    ie: "9",
    android: "4",
    ios: "6",
    phantom: "2",
    samsung: "1",
    electron: "5"
  },
  "transform-reserved-words": {
    chrome: "13",
    opera: "10.50",
    edge: "12",
    firefox: "2",
    safari: "3.1",
    node: "0.10",
    ie: "9",
    android: "4.4",
    ios: "6",
    phantom: "2",
    samsung: "1",
    electron: "0.2"
  }
};

// we could reuse this to get a list of polyfill
// using https://github.com/babel/babel/blob/master/packages/babel-preset-env/data/built-ins.json#L1
// adding a featureNameArray to every group
// and according to that featureNameArray, add these polyfill
// to the generated bundle
const jsenvPluginCompatMap = {};

const computeBabelPluginMapForRuntime = ({
  babelPluginMap,
  babelPluginCompatMap = jsenvBabelPluginCompatMap,
  runtimeName,
  runtimeVersion
}) => {
  if (typeof babelPluginMap !== "object") {
    throw new TypeError(`babelPluginMap must be an object, got ${babelPluginMap}`);
  }

  if (typeof babelPluginCompatMap !== "object") {
    throw new TypeError(`babelPluginCompatMap must be an object, got ${babelPluginCompatMap}`);
  }

  if (typeof runtimeName !== "string") {
    throw new TypeError(`runtimeName must be a string, got ${runtimeName}`);
  }

  if (typeof runtimeVersion !== "string") {
    throw new TypeError(`runtimeVersion must be a string, got ${runtimeVersion}`);
  }

  const babelPluginMapForRuntime = {};
  Object.keys(babelPluginMap).forEach(key => {
    const compatible = runtimeIsCompatibleWithFeature({
      runtimeName,
      runtimeVersion,
      runtimeCompatMap: key in babelPluginCompatMap ? babelPluginCompatMap[key] : {}
    });

    if (!compatible) {
      babelPluginMapForRuntime[key] = babelPluginMap[key];
    }
  });
  return babelPluginMapForRuntime;
};

const runtimeIsCompatibleWithFeature = ({
  runtimeName,
  runtimeVersion,
  runtimeCompatMap
}) => {
  const runtimeCompatibleVersion = computeRuntimeCompatibleVersion({
    runtimeCompatMap,
    runtimeName
  });
  const highestVersion = findHighestVersion(runtimeVersion, runtimeCompatibleVersion);
  return highestVersion === runtimeVersion;
};

const computeRuntimeCompatibleVersion = ({
  runtimeCompatMap,
  runtimeName
}) => {
  return runtimeName in runtimeCompatMap ? runtimeCompatMap[runtimeName] : "Infinity";
};

const computeJsenvPluginMapForRuntime = ({
  jsenvPluginMap,
  jsenvPluginCompatMap: jsenvPluginCompatMap$1 = jsenvPluginCompatMap,
  runtimeName,
  runtimeVersion
}) => {
  if (typeof jsenvPluginMap !== "object") {
    throw new TypeError(`jsenvPluginMap must be a object, got ${jsenvPluginMap}`);
  }

  if (typeof jsenvPluginCompatMap$1 !== "object") {
    throw new TypeError(`jsenvPluginCompatMap must be a string, got ${jsenvPluginCompatMap$1}`);
  }

  if (typeof runtimeName !== "string") {
    throw new TypeError(`runtimeName must be a string, got ${runtimeName}`);
  }

  if (typeof runtimeVersion !== "string") {
    throw new TypeError(`runtimeVersion must be a string, got ${runtimeVersion}`);
  }

  const jsenvPluginMapForRuntime = {};
  Object.keys(jsenvPluginMap).forEach(key => {
    const compatible = runtimeIsCompatibleWithFeature$1({
      runtimeName,
      runtimeVersion,
      featureCompat: key in jsenvPluginCompatMap$1 ? jsenvPluginCompatMap$1[key] : {}
    });

    if (!compatible) {
      jsenvPluginMapForRuntime[key] = jsenvPluginMap[key];
    }
  });
  return jsenvPluginMapForRuntime;
};

const runtimeIsCompatibleWithFeature$1 = ({
  runtimeName,
  runtimeVersion,
  featureCompat
}) => {
  const runtimeCompatibleVersion = computeRuntimeCompatibleVersion$1({
    featureCompat,
    runtimeName
  });
  const highestVersion = findHighestVersion(runtimeVersion, runtimeCompatibleVersion);
  return highestVersion === runtimeVersion;
};

const computeRuntimeCompatibleVersion$1 = ({
  featureCompat,
  runtimeName
}) => {
  return runtimeName in featureCompat ? featureCompat[runtimeName] : "Infinity";
};

const groupHaveSameRequirements = (leftGroup, rightGroup) => {
  return leftGroup.babelPluginRequiredNameArray.join("") === rightGroup.babelPluginRequiredNameArray.join("") && leftGroup.jsenvPluginRequiredNameArray.join("") === rightGroup.jsenvPluginRequiredNameArray.join("");
};

const generateRuntimeGroupArray = ({
  babelPluginMap,
  jsenvPluginMap,
  babelPluginCompatMap = jsenvBabelPluginCompatMap,
  jsenvPluginCompatMap: jsenvPluginCompatMap$1 = jsenvPluginCompatMap,
  runtimeName
}) => {
  const versionArray = [];
  Object.keys(babelPluginMap).forEach(babelPluginKey => {
    if (babelPluginKey in babelPluginCompatMap) {
      const babelPluginCompat = babelPluginCompatMap[babelPluginKey];

      if (runtimeName in babelPluginCompat) {
        const version = String(babelPluginCompat[runtimeName]);

        if (!versionArray.includes(version)) {
          versionArray.push(version);
        }
      }
    }
  });
  Object.keys(jsenvPluginMap).forEach(jsenvPluginKey => {
    if (jsenvPluginKey in jsenvPluginCompatMap$1) {
      const jsenvPluginCompat = jsenvPluginCompatMap$1[jsenvPluginKey];

      if (runtimeName in jsenvPluginCompat) {
        const version = String(jsenvPluginCompat[runtimeName]);

        if (!versionArray.includes(version)) {
          versionArray.push(version);
        }
      }
    }
  });
  versionArray.push("0.0.0");
  versionArray.sort(versionCompare);
  const runtimeGroupArray = [];
  versionArray.forEach(version => {
    const babelPluginMapForRuntime = computeBabelPluginMapForRuntime({
      babelPluginMap,
      babelPluginCompatMap,
      runtimeName,
      runtimeVersion: version
    });
    const babelPluginRequiredNameArray = Object.keys(babelPluginMap).filter(babelPluginKey => babelPluginKey in babelPluginMapForRuntime).sort();
    const jsenvPluginMapForRuntime = computeJsenvPluginMapForRuntime({
      jsenvPluginMap,
      jsenvPluginCompatMap: jsenvPluginCompatMap$1,
      runtimeName,
      runtimeVersion: version
    });
    const jsenvPluginRequiredNameArray = Object.keys(jsenvPluginMap).filter(jsenvPluginKey => jsenvPluginKey in jsenvPluginMapForRuntime).sort();
    const group = {
      babelPluginRequiredNameArray,
      jsenvPluginRequiredNameArray,
      runtimeCompatMap: {
        [runtimeName]: version
      }
    };
    const groupWithSameRequirements = runtimeGroupArray.find(runtimeGroupCandidate => groupHaveSameRequirements(runtimeGroupCandidate, group));

    if (groupWithSameRequirements) {
      groupWithSameRequirements.runtimeCompatMap[runtimeName] = findHighestVersion(groupWithSameRequirements.runtimeCompatMap[runtimeName], version);
    } else {
      runtimeGroupArray.push(group);
    }
  });
  return runtimeGroupArray;
};

const composeRuntimeCompatMap = (runtimeCompatMap, secondRuntimeCompatMap) => {
  return objectComposeValue(normalizeRuntimeCompatMapVersions(runtimeCompatMap), normalizeRuntimeCompatMapVersions(secondRuntimeCompatMap), (version, secondVersion) => findHighestVersion(version, secondVersion));
};

const normalizeRuntimeCompatMapVersions = runtimeCompatibility => {
  return objectMapValue(runtimeCompatibility, version => String(version));
};

const objectMapValue = (object, callback) => {
  const mapped = {};
  Object.keys(object).forEach(key => {
    mapped[key] = callback(object[key], key, object);
  });
  return mapped;
};

const objectComposeValue = (previous, object, callback) => {
  const composed = { ...previous
  };
  Object.keys(object).forEach(key => {
    composed[key] = key in composed ? callback(composed[key], object[key]) : object[key];
  });
  return composed;
};

const composeGroupArray = (...arrayOfGroupArray) => {
  return arrayOfGroupArray.reduce(groupArrayReducer, []);
};

const groupArrayReducer = (previousGroupArray, groupArray) => {
  const reducedGroupArray = [];
  previousGroupArray.forEach(group => {
    reducedGroupArray.push(copyGroup(group));
  });
  groupArray.forEach(group => {
    const groupWithSameRequirements = reducedGroupArray.find(existingGroupCandidate => groupHaveSameRequirements(group, existingGroupCandidate));

    if (groupWithSameRequirements) {
      groupWithSameRequirements.runtimeCompatMap = composeRuntimeCompatMap(groupWithSameRequirements.runtimeCompatMap, group.runtimeCompatMap);
    } else {
      reducedGroupArray.push(copyGroup(group));
    }
  });
  return reducedGroupArray;
};

const copyGroup = ({
  babelPluginRequiredNameArray,
  jsenvPluginRequiredNameArray,
  runtimeCompatMap
}) => {
  return {
    babelPluginRequiredNameArray: babelPluginRequiredNameArray.slice(),
    jsenvPluginRequiredNameArray: jsenvPluginRequiredNameArray.slice(),
    runtimeCompatMap: { ...runtimeCompatMap
    }
  };
};

const generateAllRuntimeGroupArray = ({
  babelPluginMap,
  jsenvPluginMap,
  babelPluginCompatMap,
  jsenvPluginCompatMap,
  runtimeNames
}) => {
  const arrayOfGroupArray = runtimeNames.map(runtimeName => generateRuntimeGroupArray({
    babelPluginMap,
    jsenvPluginMap,
    babelPluginCompatMap,
    jsenvPluginCompatMap,
    runtimeName
  }));
  const groupArray = composeGroupArray(...arrayOfGroupArray);
  return groupArray;
};

const runtimeCompatMapToScore = (runtimeCompatMap, runtimeScoreMap) => {
  return Object.keys(runtimeCompatMap).reduce((previous, runtimeName) => {
    const runtimeVersion = runtimeCompatMap[runtimeName];
    return previous + runtimeToScore(runtimeName, runtimeVersion, runtimeScoreMap);
  }, 0);
};

const runtimeToScore = (runtimeName, runtimeVersion, runtimeScoreMap) => {
  if (runtimeName in runtimeScoreMap === false) return runtimeScoreMap.other || 0;
  const versionUsageMap = runtimeScoreMap[runtimeName];
  const versionArray = Object.keys(versionUsageMap);
  if (versionArray.length === 0) return runtimeScoreMap.other || 0;
  const versionArrayAscending = versionArray.sort(versionCompare);
  const highestVersion = versionArrayAscending[versionArray.length - 1];
  if (findHighestVersion(runtimeVersion, highestVersion) === runtimeVersion) return versionUsageMap[highestVersion];
  const closestVersion = versionArrayAscending.reverse().find(version => findHighestVersion(runtimeVersion, version) === runtimeVersion);
  if (!closestVersion) return runtimeScoreMap.other || 0;
  return versionUsageMap[closestVersion];
};

/*

# featureCompatMap legend

        featureName
             │
{ ┌──────────┴────────────┐
  "transform-block-scoping": {─┐
    "chrome": "10",            │
    "safari": "3.0",           runTimeCompatMap
    "firefox": "5.1"           │
}────┼─────────┼───────────────┘
}    │         └─────┐
  runtimeName  runtimeVersion

# group legend

{
  "best": {
    "babelPluginRequiredNameArray" : [
      "transform-block-scoping",
    ],
    "runtimeCompatMap": {
      "chrome": "10",
      "firefox": "6"
    }
  }
}

Take chars below to update legends
─│┌┐└┘├┤┴┬

*/
const generateGroupMap = ({
  babelPluginMap,
  // jsenv plugin are for later, for now, nothing is using them
  jsenvPluginMap = {},
  babelPluginCompatMap,
  jsenvPluginCompatMap,
  runtimeScoreMap,
  groupCount = 1,
  // pass this to true if you don't care if someone tries to run your code
  // on a runtime which is not inside runtimeScoreMap.
  runtimeAlwaysInsideRuntimeScoreMap = false,
  // pass this to true if you think you will always be able to detect
  // the runtime or that if you fail to do so you don't care.
  runtimeWillAlwaysBeKnown = false
}) => {
  if (typeof babelPluginMap !== "object") {
    throw new TypeError(`babelPluginMap must be an object, got ${babelPluginMap}`);
  }

  if (typeof jsenvPluginMap !== "object") {
    throw new TypeError(`jsenvPluginMap must be an object, got ${jsenvPluginMap}`);
  }

  if (typeof runtimeScoreMap !== "object") {
    throw new TypeError(`runtimeScoreMap must be an object, got ${runtimeScoreMap}`);
  }

  if (typeof groupCount < 1) {
    throw new TypeError(`groupCount must be above 1, got ${groupCount}`);
  }

  const groupWithoutFeature = {
    babelPluginRequiredNameArray: Object.keys(babelPluginMap),
    jsenvPluginRequiredNameArray: Object.keys(jsenvPluginMap),
    runtimeCompatMap: {}
  }; // when we create one group and we cannot ensure
  // code will be runned on a runtime inside runtimeScoreMap
  // then we return otherwise group to be safe

  if (groupCount === 1 && !runtimeAlwaysInsideRuntimeScoreMap) {
    return {
      [COMPILE_ID_OTHERWISE]: groupWithoutFeature
    };
  }

  const allRuntimeGroupArray = generateAllRuntimeGroupArray({
    babelPluginMap,
    babelPluginCompatMap,
    jsenvPluginMap,
    jsenvPluginCompatMap,
    runtimeNames: arrayWithoutValue(Object.keys(runtimeScoreMap), "other")
  });

  if (allRuntimeGroupArray.length === 0) {
    return {
      [COMPILE_ID_OTHERWISE]: groupWithoutFeature
    };
  }

  const groupToScore = ({
    runtimeCompatMap
  }) => runtimeCompatMapToScore(runtimeCompatMap, runtimeScoreMap);

  const allRuntimeGroupArraySortedByScore = allRuntimeGroupArray.sort((a, b) => groupToScore(b) - groupToScore(a));
  const length = allRuntimeGroupArraySortedByScore.length; // if we arrive here and want a single group
  // we take the worst group and consider it's our best group
  // because it's the lowest runtime we want to support

  if (groupCount === 1) {
    return {
      [COMPILE_ID_BEST]: allRuntimeGroupArraySortedByScore[length - 1]
    };
  }

  const addOtherwiseToBeSafe = !runtimeAlwaysInsideRuntimeScoreMap || !runtimeWillAlwaysBeKnown;
  const lastGroupIndex = addOtherwiseToBeSafe ? groupCount - 1 : groupCount;
  const groupArray = length + 1 > groupCount ? allRuntimeGroupArraySortedByScore.slice(0, lastGroupIndex) : allRuntimeGroupArraySortedByScore;
  const groupMap = {};
  groupArray.forEach((group, index) => {
    if (index === 0) {
      groupMap[COMPILE_ID_BEST] = group;
    } else {
      groupMap[`intermediate-${index + 1}`] = group;
    }
  });

  if (addOtherwiseToBeSafe) {
    groupMap[COMPILE_ID_OTHERWISE] = groupWithoutFeature;
  }

  return groupMap;
};

const arrayWithoutValue = (array, value) => array.filter(valueCandidate => valueCandidate !== value);

// https://www.statista.com/statistics/268299/most-popular-internet-browsers/
// this source of stat is what I found in 5min
// we could improve these default usage score using better stats
// and keep in mind this should be updated time to time or even better
// come from a project specific audience
const jsenvBrowserScoreMap = {
  android: 0.001,
  chrome: {
    "71": 0.3,
    "69": 0.19,
    "0": 0.01 // it means oldest version of chrome will get a score of 0.01

  },
  firefox: {
    "61": 0.3
  },
  edge: {
    "12": 0.1
  },
  electron: 0.001,
  ios: 0.001,
  opera: 0.001,
  other: 0.001,
  safari: {
    "10": 0.1
  }
};

// https://nodejs.org/metrics/summaries/version/nodejs.org-access.log.csv
const jsenvNodeVersionScoreMap = {
  "0.10": 0.02,
  "0.12": 0.01,
  4: 0.1,
  6: 0.25,
  7: 0.1,
  8: 1,
  9: 0.1,
  10: 0.5,
  11: 0.25
};

/* eslint-disable import/max-dependencies */

const proposalJSONStrings = require$1("@babel/plugin-proposal-json-strings");

const proposalNumericSeparator = require$1("@babel/plugin-proposal-numeric-separator");

const proposalObjectRestSpread = require$1("@babel/plugin-proposal-object-rest-spread");

const proposalOptionalCatchBinding = require$1("@babel/plugin-proposal-optional-catch-binding");

const proposalOptionalChaining = require$1("@babel/plugin-proposal-optional-chaining");

const proposalUnicodePropertyRegex = require$1("@babel/plugin-proposal-unicode-property-regex");

const syntaxObjectRestSpread = require$1("@babel/plugin-syntax-object-rest-spread");

const syntaxOptionalCatchBinding = require$1("@babel/plugin-syntax-optional-catch-binding");

const transformArrowFunction = require$1("@babel/plugin-transform-arrow-functions");

const transformAsyncToPromises = require$1("babel-plugin-transform-async-to-promises");

const transformBlockScopedFunctions = require$1("@babel/plugin-transform-block-scoped-functions");

const transformBlockScoping = require$1("@babel/plugin-transform-block-scoping");

const transformClasses = require$1("@babel/plugin-transform-classes");

const transformComputedProperties = require$1("@babel/plugin-transform-computed-properties");

const transformDestructuring = require$1("@babel/plugin-transform-destructuring");

const transformDotAllRegex = require$1("@babel/plugin-transform-dotall-regex");

const transformDuplicateKeys = require$1("@babel/plugin-transform-duplicate-keys");

const transformExponentiationOperator = require$1("@babel/plugin-transform-exponentiation-operator");

const transformForOf = require$1("@babel/plugin-transform-for-of");

const transformFunctionName = require$1("@babel/plugin-transform-function-name");

const transformLiterals = require$1("@babel/plugin-transform-literals");

const transformNewTarget = require$1("@babel/plugin-transform-new-target");

const transformObjectSuper = require$1("@babel/plugin-transform-object-super");

const transformParameters = require$1("@babel/plugin-transform-parameters");

const transformRegenerator = require$1("@babel/plugin-transform-regenerator");

const transformShorthandProperties = require$1("@babel/plugin-transform-shorthand-properties");

const transformSpread = require$1("@babel/plugin-transform-spread");

const transformStickyRegex = require$1("@babel/plugin-transform-sticky-regex");

const transformTemplateLiterals = require$1("@babel/plugin-transform-template-literals");

const transformTypeOfSymbol = require$1("@babel/plugin-transform-typeof-symbol");

const transformUnicodeRegex = require$1("@babel/plugin-transform-unicode-regex");

const jsenvBabelPluginMap = {
  "proposal-numeric-separator": [proposalNumericSeparator],
  "proposal-json-strings": [proposalJSONStrings],
  "proposal-object-rest-spread": [proposalObjectRestSpread],
  "proposal-optional-catch-binding": [proposalOptionalCatchBinding],
  "proposal-optional-chaining": [proposalOptionalChaining],
  "proposal-unicode-property-regex": [proposalUnicodePropertyRegex],
  "syntax-object-rest-spread": [syntaxObjectRestSpread],
  "syntax-optional-catch-binding": [syntaxOptionalCatchBinding],
  "transform-async-to-promises": [transformAsyncToPromises],
  "transform-arrow-functions": [transformArrowFunction],
  "transform-block-scoped-functions": [transformBlockScopedFunctions],
  "transform-block-scoping": [transformBlockScoping],
  "transform-classes": [transformClasses],
  "transform-computed-properties": [transformComputedProperties],
  "transform-destructuring": [transformDestructuring],
  "transform-dotall-regex": [transformDotAllRegex],
  "transform-duplicate-keys": [transformDuplicateKeys],
  "transform-exponentiation-operator": [transformExponentiationOperator],
  "transform-for-of": [transformForOf],
  "transform-function-name": [transformFunctionName],
  "transform-literals": [transformLiterals],
  "transform-new-target": [transformNewTarget],
  "transform-object-super": [transformObjectSuper],
  "transform-parameters": [transformParameters],
  "transform-regenerator": [transformRegenerator, {
    asyncGenerators: true,
    generators: true,
    async: false
  }],
  "transform-shorthand-properties": [transformShorthandProperties],
  "transform-spread": [transformSpread],
  "transform-sticky-regex": [transformStickyRegex],
  "transform-template-literals": [transformTemplateLiterals],
  "transform-typeof-symbol": [transformTypeOfSymbol],
  "transform-unicode-regex": [transformUnicodeRegex]
};

const createCallbackList = () => {
  const callbackSet = new Set();

  const register = callback => {
    callbackSet.add(callback);
    return () => {
      callbackSet.delete(callback);
    };
  };

  const notify = (...args) => {
    callbackSet.forEach(callback => {
      callback(...args);
    });
  };

  return {
    register,
    notify
  };
};

const readProjectImportMap = async ({
  projectDirectoryUrl,
  importMapFileRelativeUrl
}) => {
  if (typeof projectDirectoryUrl !== "string") {
    throw new TypeError(`projectDirectoryUrl must be a string, got ${projectDirectoryUrl}`);
  }

  const importMapForProject = importMapFileRelativeUrl ? await getProjectImportMap({
    projectDirectoryUrl,
    importMapFileRelativeUrl
  }) : null;
  const jsenvCoreImportKey = "@jsenv/core/";
  const jsenvCoreRelativeUrlForJsenvProject = projectDirectoryUrl === jsenvCoreDirectoryUrl ? "./" : `./${util.urlToRelativeUrl(jsenvCoreDirectoryUrl, projectDirectoryUrl)}`;
  const importsForJsenvCore = {
    [jsenvCoreImportKey]: jsenvCoreRelativeUrlForJsenvProject
  };

  if (!importMapForProject) {
    return {
      imports: importsForJsenvCore
    };
  }

  const importMapForJsenvCore = {
    imports: importsForJsenvCore,
    scopes: generateJsenvCoreScopes({
      importMapForProject,
      importsForJsenvCore
    })
  };
  return importMap.composeTwoImportMaps(importMapForJsenvCore, importMapForProject);
};

const generateJsenvCoreScopes = ({
  importMapForProject,
  importsForJsenvCore
}) => {
  const {
    scopes
  } = importMapForProject;

  if (!scopes) {
    return undefined;
  } // I must ensure jsenvCoreImports wins by default in every scope
  // because scope may contains stuff like
  // "/": "/"
  // "/": "/folder/"
  // to achieve this, we set jsenvCoreImports into every scope
  // they can still be overriden by importMapForProject
  // even if I see no use case for that


  const scopesForJsenvCore = {};
  Object.keys(scopes).forEach(scopeKey => {
    scopesForJsenvCore[scopeKey] = importsForJsenvCore;
  });
  return scopesForJsenvCore;
};

const getProjectImportMap = async ({
  projectDirectoryUrl,
  importMapFileRelativeUrl
}) => {
  const importMapFileUrl = util.resolveUrl(importMapFileRelativeUrl, projectDirectoryUrl);
  const importMapFilePath = util.urlToFileSystemPath(importMapFileUrl);
  return new Promise((resolve, reject) => {
    fs.readFile(importMapFilePath, (error, buffer) => {
      if (error) {
        if (error.code === "ENOENT") {
          resolve(null);
        } else {
          reject(error);
        }
      } else {
        const importMapString = String(buffer);
        resolve(JSON.parse(importMapString));
      }
    });
  });
};

const nodeJsFileUrl = util.resolveUrl("./src/internal/node-launcher/node-js-file.js", jsenvCoreDirectoryUrl);
const browserJsFileUrl = util.resolveUrl("./src/internal/browser-launcher/jsenv-browser-system.js", jsenvCoreDirectoryUrl);
const jsenvHtmlFileUrl = util.resolveUrl("./src/internal/jsenv-html-file.html", jsenvCoreDirectoryUrl);
const exploringRedirectorHtmlFileUrl = util.resolveUrl("./src/internal/exploring/exploring.redirector.html", jsenvCoreDirectoryUrl);
const exploringRedirectorJsFileUrl = util.resolveUrl("./src/internal/exploring/exploring.redirector.js", jsenvCoreDirectoryUrl);
const exploringHtmlFileUrl = util.resolveUrl("./src/internal/exploring/exploring.html", jsenvCoreDirectoryUrl);
const sourcemapMainFileUrl = util.fileSystemPathToUrl(require$1.resolve("source-map/dist/source-map.js"));
const sourcemapMappingFileUrl = util.fileSystemPathToUrl(require$1.resolve("source-map/lib/mappings.wasm"));
const jsenvToolbarJsFileUrl = util.resolveUrl("./src/internal/toolbar/toolbar.js", jsenvCoreDirectoryUrl);
const jsenvToolbarHtmlFileUrl = util.resolveUrl("./src/internal/toolbar/toolbar.html", jsenvCoreDirectoryUrl);
const jsenvToolbarMainJsFileUrl = util.resolveUrl("./src/internal/toolbar/toolbar.main.js", jsenvCoreDirectoryUrl);

const {
  addNamed
} = require$1("@babel/helper-module-imports");

const createImportMetaUrlNamedImportBabelPlugin = ({
  importMetaSpecifier
}) => {
  return () => {
    return {
      visitor: {
        Program(programPath) {
          const metaPropertyMap = {};
          programPath.traverse({
            MemberExpression(path) {
              const {
                node
              } = path;
              const {
                object
              } = node;
              if (object.type !== "MetaProperty") return;
              const {
                property: objectProperty
              } = object;
              if (objectProperty.name !== "meta") return;
              const {
                property
              } = node;
              const {
                name
              } = property;

              if (name in metaPropertyMap) {
                metaPropertyMap[name].push(path);
              } else {
                metaPropertyMap[name] = [path];
              }
            }

          });
          Object.keys(metaPropertyMap).forEach(propertyName => {
            const importMetaPropertyId = propertyName;
            const result = addNamed(programPath, importMetaPropertyId, importMetaSpecifier);
            metaPropertyMap[propertyName].forEach(path => {
              path.replaceWith(result);
            });
          });
        }

      }
    };
  };
};

const createBabePluginMapForBundle = ({
  format
}) => {
  return { ...(format === "global" || format === "commonjs" ? {
      "import-meta-url-named-import": createImportMetaUrlNamedImportBabelPlugin({
        importMetaSpecifier: `@jsenv/core/src/internal/bundling/import-meta-${format}.js`
      })
    } : {})
  };
};

const startsWithWindowsDriveLetter = string => {
  const firstChar = string[0];
  if (!/[a-zA-Z]/.test(firstChar)) return false;
  const secondChar = string[1];
  if (secondChar !== ":") return false;
  return true;
};
const windowsFilePathToUrl = windowsFilePath => {
  return `file:///${replaceBackSlashesWithSlashes(windowsFilePath)}`;
};
const replaceBackSlashesWithSlashes = string => string.replace(/\\/g, "/");

const appendSourceMappingAsBase64Url = (source, map) => {
  const mapAsBase64 = Buffer.from(JSON.stringify(map)).toString("base64");
  return writeSourceMappingURL(source, `data:application/json;charset=utf-8;base64,${mapAsBase64}`);
};

const writeSourceMappingURL = (source, location) => `${source}
${"//#"} sourceMappingURL=${location}`;

const appendSourceMappingAsExternalUrl = writeSourceMappingURL;
const updateSourceMappingURL = (source, callback) => {
  const sourceMappingUrlRegExp = /\/\/# ?sourceMappingURL=([^\s'"]+)/g;
  let lastSourceMappingUrl;
  let matchSourceMappingUrl;

  while (matchSourceMappingUrl = sourceMappingUrlRegExp.exec(source)) {
    lastSourceMappingUrl = matchSourceMappingUrl;
  }

  if (lastSourceMappingUrl) {
    const index = lastSourceMappingUrl.index;
    const before = source.slice(0, index);
    const after = source.slice(index);
    const mappedAfter = after.replace(sourceMappingUrlRegExp, (match, firstGroup) => {
      return `${"//#"} sourceMappingURL=${callback(firstGroup)}`;
    });
    return `${before}${mappedAfter}`;
  }

  return source;
};
const readSourceMappingURL = source => {
  let sourceMappingURL;
  updateSourceMappingURL(source, value => {
    sourceMappingURL = value;
  });
  return sourceMappingURL;
};
const base64ToString = typeof window === "object" ? window.btoa : base64String => Buffer.from(base64String, "base64").toString("utf8");
const parseSourceMappingURL = source => {
  const sourceMappingURL = readSourceMappingURL(source);
  if (!sourceMappingURL) return null;
  const base64Prefix = "data:application/json;charset=utf-8;base64,";

  if (sourceMappingURL.startsWith(base64Prefix)) {
    const mapBase64Source = sourceMappingURL.slice(base64Prefix.length);
    const sourcemapString = base64ToString(mapBase64Source);
    return {
      sourcemapString
    };
  }

  return {
    sourcemapURL: sourceMappingURL
  };
};
const writeOrUpdateSourceMappingURL = (source, location) => {
  if (readSourceMappingURL(source)) {
    return updateSourceMappingURL(source, location);
  }

  return writeSourceMappingURL(source, location);
};

const urlIsAsset = url => {
  const pathname = new URL(url).pathname; // sourcemap are not inside the asset folder because
  // of https://github.com/microsoft/vscode-chrome-debug-core/issues/544

  if (pathname.endsWith(".map")) return true;
  return pathnameToBasename(pathname).includes("__asset__");
};
const getMetaJsonFileUrl = compileFileUrl => generateCompiledFileAssetUrl(compileFileUrl, "meta.json");
const generateCompiledFileAssetUrl = (compiledFileUrl, assetName) => {
  return `${compiledFileUrl}__asset__${assetName}`;
};
const pathnameToBasename = pathname => {
  const slashLastIndex = pathname.lastIndexOf("/");

  if (slashLastIndex === -1) {
    return pathname;
  }

  return pathname.slice(slashLastIndex + 1);
};

const isWindows = process.platform === "win32";
const transformResultToCompilationResult = async ({
  code,
  map,
  metadata = {}
}, {
  projectDirectoryUrl,
  originalFileContent,
  originalFileUrl,
  compiledFileUrl,
  sourcemapFileUrl,
  remap = true,
  remapMethod = "comment" // 'comment', 'inline'

}) => {
  if (typeof projectDirectoryUrl !== "string") {
    throw new TypeError(`projectDirectoryUrl must be a string, got ${projectDirectoryUrl}`);
  }

  if (typeof originalFileContent !== "string") {
    throw new TypeError(`originalFileContent must be a string, got ${originalFileContent}`);
  }

  if (typeof originalFileUrl !== "string") {
    throw new TypeError(`originalFileUrl must be a string, got ${originalFileUrl}`);
  }

  if (typeof compiledFileUrl !== "string") {
    throw new TypeError(`compiledFileUrl must be a string, got ${compiledFileUrl}`);
  }

  if (typeof sourcemapFileUrl !== "string") {
    throw new TypeError(`sourcemapFileUrl must be a string, got ${sourcemapFileUrl}`);
  }

  const sources = [];
  const sourcesContent = [];
  const assets = [];
  const assetsContent = [];
  let output = code;

  if (remap && map) {
    if (map.sources.length === 0) {
      // may happen in some cases where babel returns a wrong sourcemap
      // there is at least one case where it happens
      // a file with only import './whatever.js' inside
      sources.push(originalFileUrl);
      sourcesContent.push(originalFileContent);
    } else {
      await Promise.all(map.sources.map(async (source, index) => {
        // be careful here we might received C:/Directory/file.js path from babel
        // also in case we receive relative path like directory\file.js we replace \ with slash
        // for url resolution
        const sourceFileUrl = isWindows && startsWithWindowsDriveLetter(source) ? windowsFilePathToUrl(source) : util.ensureWindowsDriveLetter(util.resolveUrl(isWindows ? replaceBackSlashesWithSlashes(source) : source, sourcemapFileUrl), sourcemapFileUrl);

        if (!sourceFileUrl.startsWith(projectDirectoryUrl)) {
          // do not track dependency outside project
          // it means cache stays valid for those external sources
          return;
        }

        map.sources[index] = util.urlToRelativeUrl(sourceFileUrl, sourcemapFileUrl);
        sources[index] = sourceFileUrl;

        if (map.sourcesContent && map.sourcesContent[index]) {
          sourcesContent[index] = map.sourcesContent[index];
        } else {
          const sourceFileContent = await util.readFile(sourceFileUrl);
          sourcesContent[index] = sourceFileContent;
        }
      }));
    } // removing sourcesContent from map decrease the sourceMap
    // it also means client have to fetch source from server (additional http request)
    // some client ignore sourcesContent property such as vscode-chrome-debugger
    // Because it's the most complex scenario and we want to ensure client is always able
    // to find source from the sourcemap, we explicitely delete map.sourcesContent to test this.


    delete map.sourcesContent; // we don't need sourceRoot because our path are relative or absolute to the current location
    // we could comment this line because it is not set by babel because not passed during transform

    delete map.sourceRoot;

    if (remapMethod === "inline") {
      output = appendSourceMappingAsBase64Url(output, map);
    } else if (remapMethod === "comment") {
      const sourcemapFileRelativePathForModule = util.urlToRelativeUrl(sourcemapFileUrl, compiledFileUrl);
      output = appendSourceMappingAsExternalUrl(output, sourcemapFileRelativePathForModule);
      assets.push(sourcemapFileUrl);
      assetsContent.push(stringifyMap(map));
    }
  } else {
    sources.push(originalFileUrl);
    sourcesContent.push(originalFileContent);
  }

  const {
    coverage
  } = metadata;

  if (coverage) {
    const coverageAssetFileUrl = generateCompiledFileAssetUrl(compiledFileUrl, "coverage.json");
    assets.push(coverageAssetFileUrl);
    assetsContent.push(stringifyCoverage(coverage));
  }

  return {
    compiledSource: output,
    contentType: "application/javascript",
    sources,
    sourcesContent,
    assets,
    assetsContent
  };
};

const stringifyMap = object => JSON.stringify(object, null, "  ");

const stringifyCoverage = object => JSON.stringify(object, null, "  ");

// and in our case we are talking about a dev server
// in other words it's not super important to handle concurrent connections
// https://gist.github.com/adamhooper/9e0e2583e0f22ace0e0840b9c09e395d
// https://stackoverflow.com/questions/42321861/fs-readfile-is-very-slow-am-i-making-too-many-request

const readFileContent = async url => {
  const buffer = fs.readFileSync(util.urlToFileSystemPath(url));
  return String(buffer);
};
const writeFileContent = async (url, content, {
  fileLikelyNotFound = false
} = {}) => {
  const filePath = util.urlToFileSystemPath(url);
  const directoryPath = path.dirname(filePath);

  const ensureParentDirectory = () => {
    try {
      fs.mkdirSync(directoryPath, {
        recursive: true
      });
    } catch (error) {
      if (error.code === "EEXIST") {
        return;
      }

      throw error;
    }
  };

  if (fileLikelyNotFound) {
    // whenever outside knows file is likely not exisiting
    // ensure parent directory exists first
    ensureParentDirectory();
    fs.writeFileSync(filePath, content);
  } else {
    // most of the time when you want to write a file it's likely existing (at least the parent directory)
    try {
      fs.writeFileSync(filePath, content);
    } catch (error) {
      if (error.code === "ENOENT") {
        ensureParentDirectory();
        fs.writeFileSync(filePath, content);
        return;
      }

      throw error;
    }
  }
};
const testFilePresence = async url => {
  return fs.existsSync(util.urlToFileSystemPath(url));
};

const readMeta = async ({
  logger,
  compiledFileUrl
}) => {
  const metaJsonFileUrl = getMetaJsonFileUrl(compiledFileUrl);

  try {
    const metaJsonString = await readFileContent(metaJsonFileUrl);
    const metaJsonObject = JSON.parse(metaJsonString);
    return metaJsonObject;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      logger.debug(`no meta.json.
--- meta.json path ---
${util.urlToFileSystemPath(metaJsonFileUrl)}
--- compiled file ---
${util.urlToFileSystemPath(compiledFileUrl)}`);
      return null;
    }

    if (error && error.name === "SyntaxError") {
      logger.error(createCacheSyntaxErrorMessage({
        syntaxError: error,
        metaJsonFileUrl
      }));
      return null;
    }

    throw error;
  }
};

const createCacheSyntaxErrorMessage = ({
  syntaxError,
  metaJsonFileUrl
}) => `meta.json syntax error.
--- syntax error stack ---
${syntaxError.stack}
--- meta.json path ---
${util.urlToFileSystemPath(metaJsonFileUrl)}`;

const validateMeta = async ({
  logger,
  meta,
  compiledFileUrl,
  ifEtagMatch,
  ifModifiedSinceDate,
  compileCacheSourcesValidation = true,
  compileCacheAssetsValidation = true
}) => {
  const [compiledFileValidationTiming, compiledFileValidation] = await server.timeFunction("cache compiled file validation", () => validateCompiledFile({
    compiledFileUrl,
    ifEtagMatch,
    ifModifiedSinceDate
  }));

  if (!compiledFileValidation.valid) {
    logger.debug(`${util.urlToFileSystemPath(compiledFileUrl)} modified (${compiledFileValidation.code})`);
    return { ...compiledFileValidation,
      timing: compiledFileValidationTiming
    };
  }

  logger.debug(`${util.urlToFileSystemPath(compiledFileUrl)} not modified`);

  if (meta.sources.length === 0) {
    logger.warn(`meta.sources is empty, cache considered as invalid by precaution`);
    return {
      code: "SOURCES_EMPTY",
      valid: false,
      timing: compiledFileValidationTiming
    };
  }

  const [[sourcesValidationTiming, sourcesValidations], [assetsValidationTiming, assetValidations]] = await Promise.all([server.timeFunction("cache sources validation", () => compileCacheSourcesValidation ? validateSources({
    meta,
    compiledFileUrl
  }) : []), server.timeFunction("cache assets validation", () => compileCacheAssetsValidation ? validateAssets({
    meta,
    compiledFileUrl
  }) : [])]);
  const invalidSourceValidation = sourcesValidations.find(({
    valid
  }) => !valid);

  if (invalidSourceValidation) {
    logger.debug(`${util.urlToFileSystemPath(invalidSourceValidation.data.sourceFileUrl)} source modified (${invalidSourceValidation.code})`);
    return { ...invalidSourceValidation,
      timing: { ...compiledFileValidationTiming,
        ...sourcesValidationTiming,
        ...assetsValidationTiming
      }
    };
  }

  const invalidAssetValidation = assetValidations.find(({
    valid
  }) => !valid);

  if (invalidAssetValidation) {
    logger.debug(`${util.urlToFileSystemPath(invalidAssetValidation.data.assetFileUrl)} asset modified (${invalidAssetValidation.code})`);
    return { ...invalidAssetValidation,
      timing: { ...compiledFileValidationTiming,
        ...sourcesValidationTiming,
        ...assetsValidationTiming
      }
    };
  }

  logger.debug(`${util.urlToFileSystemPath(compiledFileUrl)} cache is valid`);
  const compiledSource = compiledFileValidation.data.compiledSource;
  const sourcesContent = sourcesValidations.map(({
    data
  }) => data.sourceContent);
  const assetsContent = assetValidations.find(({
    data
  }) => data.assetContent);
  return {
    valid: true,
    data: {
      compiledSource,
      sourcesContent,
      assetsContent
    },
    timing: { ...compiledFileValidationTiming,
      ...sourcesValidationTiming,
      ...assetsValidationTiming
    }
  };
};

const validateCompiledFile = async ({
  compiledFileUrl,
  ifEtagMatch,
  ifModifiedSinceDate
}) => {
  try {
    const compiledSource = await readFileContent(compiledFileUrl);

    if (ifEtagMatch) {
      const compiledEtag = util.bufferToEtag(Buffer.from(compiledSource));

      if (ifEtagMatch !== compiledEtag) {
        return {
          code: "COMPILED_FILE_ETAG_MISMATCH",
          valid: false,
          data: {
            compiledSource,
            compiledEtag
          }
        };
      }
    }

    if (ifModifiedSinceDate) {
      const compiledMtime = await util.readFileSystemNodeModificationTime(compiledFileUrl);

      if (ifModifiedSinceDate < dateToSecondsPrecision(compiledMtime)) {
        return {
          code: "COMPILED_FILE_MTIME_OUTDATED",
          valid: false,
          data: {
            compiledSource,
            compiledMtime
          }
        };
      }
    }

    return {
      valid: true,
      data: {
        compiledSource
      }
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        code: "COMPILED_FILE_NOT_FOUND",
        valid: false,
        data: {
          compiledFileUrl
        }
      };
    }

    return Promise.reject(error);
  }
};

const validateSources = ({
  meta,
  compiledFileUrl
}) => {
  return Promise.all(meta.sources.map((source, index) => validateSource({
    compiledFileUrl,
    source,
    eTag: meta.sourcesEtag[index]
  })));
};

const validateSource = async ({
  compiledFileUrl,
  source,
  eTag
}) => {
  const metaJsonFileUrl = getMetaJsonFileUrl(compiledFileUrl);
  const sourceFileUrl = util.resolveUrl(source, metaJsonFileUrl);

  try {
    const sourceContent = await readFileContent(sourceFileUrl);
    const sourceETag = util.bufferToEtag(Buffer.from(sourceContent));

    if (sourceETag !== eTag) {
      return {
        code: "SOURCE_ETAG_MISMATCH",
        valid: false,
        data: {
          source,
          sourceFileUrl,
          sourceContent
        }
      };
    }

    return {
      valid: true,
      data: {
        sourceContent
      }
    };
  } catch (e) {
    if (e && e.code === "ENOENT") {
      // missing source invalidates the cache because
      // we cannot check its validity
      // HOWEVER inside writeMeta we will check if a source can be found
      // when it cannot we will not put it as a dependency
      // to invalidate the cache.
      // It is important because some files are constructed on other files
      // which are not truly on the filesystem
      // (IN theory the above happens only for convertCommonJsWithRollup because jsenv
      // always have a concrete file especially to avoid that kind of thing)
      return {
        code: "SOURCE_NOT_FOUND",
        valid: false,
        data: {
          source,
          sourceFileUrl,
          sourceContent: ""
        }
      };
    }

    throw e;
  }
};

const validateAssets = ({
  compiledFileUrl,
  meta
}) => Promise.all(meta.assets.map((asset, index) => validateAsset({
  asset,
  compiledFileUrl,
  eTag: meta.assetsEtag[index]
})));

const validateAsset = async ({
  asset,
  compiledFileUrl,
  eTag
}) => {
  const metaJsonFileUrl = getMetaJsonFileUrl(compiledFileUrl);
  const assetFileUrl = util.resolveUrl(asset, metaJsonFileUrl);

  try {
    const assetContent = await readFileContent(assetFileUrl);
    const assetContentETag = util.bufferToEtag(Buffer.from(assetContent));

    if (eTag !== assetContentETag) {
      return {
        code: "ASSET_ETAG_MISMATCH",
        valid: false,
        data: {
          asset,
          assetFileUrl,
          assetContent,
          assetContentETag
        }
      };
    }

    return {
      valid: true,
      data: {
        assetContent,
        assetContentETag
      }
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        code: "ASSET_FILE_NOT_FOUND",
        valid: false,
        data: {
          asset,
          assetFileUrl
        }
      };
    }

    return Promise.reject(error);
  }
};

const dateToSecondsPrecision = date => {
  const dateWithSecondsPrecision = new Date(date);
  dateWithSecondsPrecision.setMilliseconds(0);
  return dateWithSecondsPrecision;
};

const updateMeta = async ({
  logger,
  meta,
  compiledFileUrl,
  cacheHitTracking,
  compileResult,
  compileResultStatus
}) => {
  const isNew = compileResultStatus === "created";
  const isUpdated = compileResultStatus === "updated";
  const isCached = compileResultStatus === "cached";
  const {
    compiledSource,
    contentType,
    assets,
    assetsContent
  } = compileResult;
  let {
    sources,
    sourcesContent
  } = compileResult;
  const promises = [];

  if (isNew || isUpdated) {
    // ensure source that does not leads to concrete files are not capable to invalidate the cache
    const sourceExists = await Promise.all(sources.map(async sourceFileUrl => {
      const sourceFileExists = await testFilePresence(sourceFileUrl);

      if (sourceFileExists) {
        return true;
      } // this can lead to cache never invalidated by itself
      // it's a very important warning


      logger.warn(`a source file cannot be found -> excluded from meta.sources & meta.sourcesEtag.
--- source ---
${sourceFileUrl}`);
      return false;
    }));
    sources = sources.filter((source, index) => sourceExists[index]);
    sourcesContent = sourcesContent.filter((sourceContent, index) => sourceExists[index]);
    const {
      writeCompiledSourceFile = true,
      writeAssetsFile = true
    } = compileResult;

    if (writeCompiledSourceFile) {
      logger.debug(`write compiled file at ${util.urlToFileSystemPath(compiledFileUrl)}`);
      promises.push(writeFileContent(compiledFileUrl, compiledSource, {
        fileLikelyNotFound: isNew
      }));
    }

    if (writeAssetsFile) {
      promises.push(...assets.map((assetFileUrl, index) => {
        logger.debug(`write compiled file asset at ${util.urlToFileSystemPath(assetFileUrl)}`);
        return writeFileContent(assetFileUrl, assetsContent[index], {
          fileLikelyNotFound: isNew
        });
      }));
    }
  }

  const metaJsonFileUrl = getMetaJsonFileUrl(compiledFileUrl);

  if (isNew || isUpdated || isCached && cacheHitTracking) {
    let latestMeta;
    const sourceAndAssetProps = {
      sources: sources.map(source => util.urlToRelativeUrl(source, metaJsonFileUrl)),
      sourcesEtag: sourcesContent.map(sourceContent => util.bufferToEtag(Buffer.from(sourceContent))),
      assets: assets.map(asset => util.urlToRelativeUrl(asset, metaJsonFileUrl)),
      assetsEtag: assetsContent.map(assetContent => util.bufferToEtag(Buffer.from(assetContent)))
    };

    if (isNew) {
      latestMeta = {
        contentType,
        ...sourceAndAssetProps,
        createdMs: Number(Date.now()),
        lastModifiedMs: Number(Date.now())
      };
    } else if (isUpdated) {
      latestMeta = { ...meta,
        ...sourceAndAssetProps,
        lastModifiedMs: Number(Date.now())
      };
    } else {
      latestMeta = { ...meta
      };
    }

    if (cacheHitTracking) {
      latestMeta = { ...latestMeta,
        matchCount: 1,
        lastMatchMs: Number(Date.now())
      };
    }

    logger.debug(`write compiled file meta at ${util.urlToFileSystemPath(metaJsonFileUrl)}`);
    promises.push(writeFileContent(metaJsonFileUrl, JSON.stringify(latestMeta, null, "  "), {
      fileLikelyNotFound: isNew
    }));
  }

  return Promise.all(promises);
};

const createLockRegistry = () => {
  let lockArray = [];

  const lockForRessource = async ressource => {
    const currentLock = lockArray.find(lock => lock.ressource === ressource);
    let unlockResolve;
    const unlocked = new Promise(resolve => {
      unlockResolve = resolve;
    });
    const lock = {
      ressource,
      unlocked
    };
    lockArray = [...lockArray, lock];
    if (currentLock) await currentLock.unlocked;

    const unlock = () => {
      lockArray = lockArray.filter(lockCandidate => lockCandidate !== lock);
      unlockResolve();
    };

    return unlock;
  };

  return {
    lockForRessource
  };
};

const {
  lockForRessource
} = createLockRegistry();

const lockfile = require$1("proper-lockfile");

const getOrGenerateCompiledFile = async ({
  logger,
  projectDirectoryUrl,
  originalFileUrl,
  compiledFileUrl = originalFileUrl,
  writeOnFilesystem,
  useFilesystemAsCache,
  cacheHitTracking = false,
  cacheInterProcessLocking = false,
  compileCacheSourcesValidation,
  compileCacheAssetsValidation,
  ifEtagMatch,
  ifModifiedSinceDate,
  compile
}) => {
  if (typeof projectDirectoryUrl !== "string") {
    throw new TypeError(`projectDirectoryUrl must be a string, got ${projectDirectoryUrl}`);
  }

  if (typeof originalFileUrl !== "string") {
    throw new TypeError(`originalFileUrl must be a string, got ${originalFileUrl}`);
  }

  if (!originalFileUrl.startsWith(projectDirectoryUrl)) {
    throw new Error(`origin file must be inside project
--- original file url ---
${originalFileUrl}
--- project directory url ---
${projectDirectoryUrl}`);
  }

  if (typeof compiledFileUrl !== "string") {
    throw new TypeError(`compiledFileUrl must be a string, got ${compiledFileUrl}`);
  }

  if (!compiledFileUrl.startsWith(projectDirectoryUrl)) {
    throw new Error(`compiled file must be inside project
--- compiled file url ---
${compiledFileUrl}
--- project directory url ---
${projectDirectoryUrl}`);
  }

  if (typeof compile !== "function") {
    throw new TypeError(`compile must be a function, got ${compile}`);
  }

  const lockTimeEnd = server.timeStart("lock");
  return startAsap(async () => {
    const lockTiming = lockTimeEnd();
    const {
      meta,
      compileResult,
      compileResultStatus,
      timing
    } = await computeCompileReport({
      originalFileUrl,
      compiledFileUrl,
      compile,
      ifEtagMatch,
      ifModifiedSinceDate,
      useFilesystemAsCache,
      compileCacheSourcesValidation,
      compileCacheAssetsValidation,
      logger
    });
    let cacheWriteTiming = {};

    if (writeOnFilesystem) {
      const result = await server.timeFunction("cache write", () => updateMeta({
        logger,
        meta,
        compileResult,
        compileResultStatus,
        compiledFileUrl,
        cacheHitTracking
      }));
      cacheWriteTiming = result[0];
    }

    return {
      meta,
      compileResult,
      compileResultStatus,
      timing: { ...lockTiming,
        ...timing,
        ...cacheWriteTiming
      }
    };
  }, {
    compiledFileUrl,
    cacheInterProcessLocking,
    logger
  });
};

const computeCompileReport = async ({
  originalFileUrl,
  compiledFileUrl,
  compile,
  ifEtagMatch,
  ifModifiedSinceDate,
  useFilesystemAsCache,
  compileCacheSourcesValidation,
  compileCacheAssetsValidation,
  logger
}) => {
  const [cacheReadTiming, meta] = await server.timeFunction("cache read", async () => {
    if (useFilesystemAsCache) {
      return readMeta({
        logger,
        compiledFileUrl
      });
    }

    return null;
  });

  if (!meta) {
    const [compileTiming, compileResult] = await server.timeFunction("compile", () => callCompile({
      logger,
      originalFileUrl,
      compile
    }));
    return {
      meta: null,
      compileResult,
      compileResultStatus: "created",
      timing: { ...cacheReadTiming,
        ...compileTiming
      }
    };
  }

  const metaValidation = await validateMeta({
    logger,
    meta,
    compiledFileUrl,
    ifEtagMatch,
    ifModifiedSinceDate,
    compileCacheSourcesValidation,
    compileCacheAssetsValidation
  });

  if (!metaValidation.valid) {
    const [compileTiming, compileResult] = await server.timeFunction("compile", () => callCompile({
      logger,
      originalFileUrl,
      compile
    }));
    return {
      meta,
      compileResult,
      compileResultStatus: "updated",
      timing: { ...cacheReadTiming,
        ...metaValidation.timing,
        ...compileTiming
      }
    };
  }

  const {
    contentType,
    sources,
    assets
  } = meta;
  const {
    compiledSource,
    sourcesContent,
    assetsContent
  } = metaValidation.data;
  return {
    meta,
    compileResult: {
      contentType,
      compiledSource,
      sources,
      sourcesContent,
      assets,
      assetsContent
    },
    compileResultStatus: "cached",
    timing: { ...cacheReadTiming,
      ...metaValidation.timing
    }
  };
};

const callCompile = async ({
  logger,
  originalFileUrl,
  compile
}) => {
  logger.debug(`compile ${originalFileUrl}`);
  const {
    sources = [],
    sourcesContent = [],
    assets = [],
    assetsContent = [],
    contentType,
    compiledSource,
    ...rest
  } = await compile(compile.length ? await readFileContent(originalFileUrl) : undefined);

  if (typeof contentType !== "string") {
    throw new TypeError(`compile must return a contentType string, got ${contentType}`);
  }

  if (typeof compiledSource !== "string") {
    throw new TypeError(`compile must return a compiledSource string, got ${compiledSource}`);
  }

  return {
    contentType,
    compiledSource,
    sources,
    sourcesContent,
    assets,
    assetsContent,
    ...rest
  };
};

const startAsap = async (fn, {
  logger,
  compiledFileUrl,
  cacheInterProcessLocking
}) => {
  const metaJsonFileUrl = getMetaJsonFileUrl(compiledFileUrl);
  const metaJsonFilePath = util.urlToFileSystemPath(metaJsonFileUrl);
  logger.debug(`lock ${metaJsonFilePath}`); // in case this process try to concurrently access meta we wait for previous to be done

  const unlockLocal = await lockForRessource(metaJsonFilePath);

  let unlockInterProcessLock = () => {};

  if (cacheInterProcessLocking) {
    // after that we use a lock pathnameRelative to be sure we don't conflict with other process
    // trying to do the same (mapy happen when spawining multiple server for instance)
    // https://github.com/moxystudio/node-proper-lockfile/issues/69
    await util.ensureParentDirectories(metaJsonFilePath); // https://github.com/moxystudio/node-proper-lockfile#lockfile-options

    unlockInterProcessLock = await lockfile.lock(metaJsonFilePath, {
      realpath: false,
      retries: {
        retries: 20,
        minTimeout: 20,
        maxTimeout: 500
      }
    });
  }

  try {
    return await fn();
  } finally {
    // we want to unlock in case of error too
    logger.debug(`unlock ${metaJsonFilePath}`);
    unlockLocal();
    unlockInterProcessLock();
  } // here in case of error.code === 'ELOCKED' thrown from here
  // https://github.com/moxystudio/node-proper-lockfile/blob/1a478a43a077a7a7efc46ac79fd8f713a64fd499/lib/lockfile.js#L54
  // we could give a better failure message when server tries to compile a file
  // otherwise he'll get a 500 without much more info to debug
  // we use two lock because the local lock is very fast, it's a sort of perf improvement

};

const compileFile = async ({
  // cancellatioToken,
  logger,
  projectDirectoryUrl,
  originalFileUrl,
  compiledFileUrl,
  projectFileRequestedCallback = () => {},
  request,
  compile,
  writeOnFilesystem,
  useFilesystemAsCache,
  compileCacheStrategy = "etag",
  serverCompileCacheHitTracking = false,
  serverCompileCacheInterProcessLocking = false,
  compileCacheSourcesValidation,
  compileCacheAssetsValidation
}) => {
  if (writeOnFilesystem && compileCacheStrategy !== "etag" && compileCacheStrategy !== "mtime") {
    throw new Error(`compileCacheStrategy must be etag or mtime , got ${compileCacheStrategy}`);
  }

  const {
    headers = {}
  } = request;
  const clientCacheDisabled = headers["cache-control"] === "no-cache";
  const cacheWithETag = writeOnFilesystem && compileCacheStrategy === "etag";
  let ifEtagMatch;

  if (cacheWithETag && "if-none-match" in headers) {
    ifEtagMatch = headers["if-none-match"];
  }

  const cacheWithMtime = writeOnFilesystem && compileCacheStrategy === "mtime";
  let ifModifiedSinceDate;

  if (cacheWithMtime && "if-modified-since" in headers) {
    const ifModifiedSince = headers["if-modified-since"];

    try {
      ifModifiedSinceDate = new Date(ifModifiedSince);
    } catch (e) {
      return {
        status: 400,
        statusText: "if-modified-since header is not a valid date"
      };
    }
  }

  try {
    const {
      compileResult,
      compileResultStatus,
      timing
    } = await getOrGenerateCompiledFile({
      logger,
      projectDirectoryUrl,
      originalFileUrl,
      compiledFileUrl,
      ifEtagMatch,
      ifModifiedSinceDate,
      writeOnFilesystem,
      useFilesystemAsCache,
      cacheHitTracking: serverCompileCacheHitTracking,
      cacheInterProcessLocking: serverCompileCacheInterProcessLocking,
      compileCacheSourcesValidation,
      compileCacheAssetsValidation,
      compile
    });
    projectFileRequestedCallback(util.urlToRelativeUrl(originalFileUrl, projectDirectoryUrl), request);
    compileResult.sources.forEach(source => {
      const sourceFileUrl = util.resolveUrl(source, compiledFileUrl);
      projectFileRequestedCallback(util.urlToRelativeUrl(sourceFileUrl, projectDirectoryUrl), request);
    });
    const {
      contentType,
      compiledSource
    } = compileResult;

    if (cacheWithETag && !clientCacheDisabled) {
      if (ifEtagMatch && compileResultStatus === "cached") {
        return {
          status: 304,
          timing
        };
      }

      return {
        status: 200,
        headers: {
          "content-length": Buffer.byteLength(compiledSource),
          "content-type": contentType,
          "eTag": util.bufferToEtag(Buffer.from(compiledSource))
        },
        body: compiledSource,
        timing
      };
    }

    if (cacheWithMtime && !clientCacheDisabled) {
      if (ifModifiedSinceDate && compileResultStatus === "cached") {
        return {
          status: 304,
          timing
        };
      }

      return {
        status: 200,
        headers: {
          "content-length": Buffer.byteLength(compiledSource),
          "content-type": contentType,
          "last-modified": new Date(await util.readFileSystemNodeModificationTime(compiledFileUrl)).toUTCString()
        },
        body: compiledSource,
        timing
      };
    }

    return {
      status: 200,
      headers: {
        "content-length": Buffer.byteLength(compiledSource),
        "content-type": contentType
      },
      body: compiledSource,
      timing
    };
  } catch (error) {
    if (error && error.code === "PARSE_ERROR") {
      const relativeUrl = util.urlToRelativeUrl(util.fileSystemPathToUrl(error.data.filename), projectDirectoryUrl);
      projectFileRequestedCallback(relativeUrl, request); // on the correspondig file

      const json = JSON.stringify(error.data);
      return {
        status: 500,
        statusText: "parse error",
        headers: {
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(json),
          "content-type": "application/json"
        },
        body: json
      };
    }

    if (error && error.statusText === "Unexpected directory operation") {
      return {
        status: 403
      };
    }

    return server.convertFileSystemErrorToResponseProperties(error);
  }
};

const validateResponseStatusIsOk = ({
  status,
  url
}) => {
  if (responseStatusIsOk(status)) {
    return {
      valid: true
    };
  }

  return {
    valid: false,
    message: `unexpected response status.
--- response status ---
${status}
--- expected status ---
200 to 299
--- url ---
${url}`
  };
};

const responseStatusIsOk = responseStatus => responseStatus >= 200 && responseStatus < 300;

// https://github.com/browserify/resolve/blob/a09a2e7f16273970be4639313c83b913daea15d7/lib/core.json#L1
// https://nodejs.org/api/modules.html#modules_module_builtinmodules
// https://stackoverflow.com/a/35825896
// https://github.com/browserify/resolve/blob/master/lib/core.json#L1
const NATIVE_NODE_MODULE_SPECIFIER_ARRAY = ["assert", "async_hooks", "buffer_ieee754", "buffer", "child_process", "cluster", "console", "constants", "crypto", "_debugger", "dgram", "dns", "domain", "events", "freelist", "fs", "fs/promises", "_http_agent", "_http_client", "_http_common", "_http_incoming", "_http_outgoing", "_http_server", "http", "http2", "https", "inspector", "_linklist", "module", "net", "node-inspect/lib/_inspect", "node-inspect/lib/internal/inspect_client", "node-inspect/lib/internal/inspect_repl", "os", "path", "perf_hooks", "process", "punycode", "querystring", "readline", "repl", "smalloc", "_stream_duplex", "_stream_transform", "_stream_wrap", "_stream_passthrough", "_stream_readable", "_stream_writable", "stream", "string_decoder", "sys", "timers", "_tls_common", "_tls_legacy", "_tls_wrap", "tls", "trace_events", "tty", "url", "util", "v8/tools/arguments", "v8/tools/codemap", "v8/tools/consarray", "v8/tools/csvparser", "v8/tools/logreader", "v8/tools/profile_view", "v8/tools/splaytree", "v8", "vm", "worker_threads", "zlib", // global is special
"global"];
const isBareSpecifierForNativeNodeModule = specifier => {
  return NATIVE_NODE_MODULE_SPECIFIER_ARRAY.includes(specifier);
};

const fetchSourcemap = async ({
  cancellationToken,
  logger,
  moduleUrl,
  moduleContent
}) => {
  const sourcemapParsingResult = parseSourceMappingURL(moduleContent);

  if (!sourcemapParsingResult) {
    return null;
  }

  if (sourcemapParsingResult.sourcemapString) {
    return generateSourcemapFromString(sourcemapParsingResult.sourcemapString, {
      sourcemapUrl: moduleUrl,
      moduleUrl,
      logger
    });
  }

  const sourcemapUrl = util.resolveUrl(sourcemapParsingResult.sourcemapURL, moduleUrl);
  const sourcemapResponse = await fetchUrl(sourcemapUrl, {
    cancellationToken,
    ignoreHttpsError: true
  });
  const okValidation = validateResponseStatusIsOk(sourcemapResponse);

  if (!okValidation.valid) {
    logger.warn(`unexpected response for sourcemap file:
${okValidation.message}`);
    return null;
  } // in theory we should also check sourcemapResponse content-type is correctly set
  // but not really important.


  const sourcemapBodyAsText = await sourcemapResponse.text();
  return generateSourcemapFromString(sourcemapBodyAsText, {
    logger,
    sourcemapUrl,
    moduleUrl
  });
};

const generateSourcemapFromString = async (sourcemapString, {
  logger,
  sourcemapUrl,
  moduleUrl
}) => {
  const map = parseSourcemapString(sourcemapString, {
    logger,
    sourcemapUrl,
    moduleUrl
  });

  if (!map) {
    return null;
  }

  return map;
};

const parseSourcemapString = (sourcemapString, {
  logger,
  sourcemapUrl,
  moduleUrl
}) => {
  try {
    return JSON.parse(sourcemapString);
  } catch (e) {
    if (e.name === "SyntaxError") {
      if (sourcemapUrl === moduleUrl) {
        logger.error(`syntax error while parsing inlined sourcemap.
--- syntax error stack ---
${e.stack}
--- module url ---
${moduleUrl}`);
      } else {
        logger.error(`syntax error while parsing remote sourcemap.
--- syntax error stack ---
${e.stack}
--- sourcemap url ---
${sourcemapUrl}
--- module url ---
${moduleUrl}`);
      }

      return null;
    }

    throw e;
  }
};

const {
  minify
} = require$1("html-minifier");

const minifyHtml = (htmlString, options) => {
  return minify(htmlString, options);
};

const {
  minify: minify$1
} = require$1("terser");

const minifyJs = (jsString, options) => {
  return minify$1(jsString, options);
};

const CleanCSS = require$1("clean-css");

const minifyCss = (cssString, options) => {
  return new CleanCSS(options).minify(cssString).styles;
};

/* eslint-disable import/max-dependencies */
/**

A word about bundler choosing to return an absolute url for import like

import styleFileUrl from "./style.css"
import iconFileUrl from "./icon.png"

Bundler choose to return an url so that you can still access your bundled files.
In a structure like this one I would rather choose to keep target asset with "/directory/icon.png"

dist/
  esmodule/
    index.js
directory/
  icon.png

Considering it's possible to target original file from bundled files (using import starting with '/'),
Jsenv bundle do not emit any asset file.

Using import to import something else than a JavaScript file convert it to
a JavaScript module with an export default of that file content as text.
Non textual files (png, jpg, video) are converted to base64 text.

*/

const STATIC_COMPILE_SERVER_AUTHORITY = "//jsenv.com";
const createJsenvRollupPlugin = async ({
  cancellationToken,
  logger,
  projectDirectoryUrl,
  entryPointMap,
  bundleDirectoryUrl,
  compileDirectoryRelativeUrl,
  compileServerOrigin,
  compileServerImportMap,
  importDefaultExtension,
  externalImportSpecifiers,
  node,
  browser,
  babelPluginMap,
  format,
  minify,
  // https://github.com/terser/terser#minify-options
  minifyJsOptions,
  // https://github.com/jakubpawlowicz/clean-css#constructor-options
  minifyCssOptions,
  // https://github.com/kangax/html-minifier#options-quick-reference
  minifyHtmlOptions,
  manifestFile,
  detectAndTransformIfNeededAsyncInsertedByRollup = format === "global"
}) => {
  const moduleContentMap = {};
  const redirectionMap = {}; // use a fake and predictable compile server origin
  // because rollup will check the dependencies url
  // when computing the file hash
  // see https://github.com/rollup/rollup/blob/d6131378f9481a442aeaa6d4e608faf3303366dc/src/Chunk.ts#L795
  // this way file hash remains the same when file content does not change

  const compileServerOriginForRollup = String(new URL(STATIC_COMPILE_SERVER_AUTHORITY, compileServerOrigin)).slice(0, -1);
  const compileDirectoryRemoteUrl = util.resolveDirectoryUrl(compileDirectoryRelativeUrl, compileServerOriginForRollup);
  const chunkId = `${Object.keys(entryPointMap)[0]}.js`;
  const importMap$1 = importMap.normalizeImportMap(compileServerImportMap, compileDirectoryRemoteUrl);

  const nativeModulePredicate = specifier => {
    if (node && isBareSpecifierForNativeNodeModule(specifier)) return true; // for now browser have no native module
    // and we don't know how we will handle that

    if (browser) return false;
    return false;
  };

  const jsenvRollupPlugin = {
    name: "jsenv",
    resolveId: (specifier, importer = compileDirectoryRemoteUrl) => {
      if (nativeModulePredicate(specifier)) {
        logger.debug(`${specifier} is native module -> marked as external`);
        return false;
      }

      if (externalImportSpecifiers.includes(specifier)) {
        logger.debug(`${specifier} verifies externalImportSpecifiers  -> marked as external`);
        return {
          id: specifier,
          external: true
        };
      }

      if (util.isFileSystemPath(importer)) {
        importer = util.fileSystemPathToUrl(importer);
      }

      const importUrl = importMap.resolveImport({
        specifier,
        importer,
        importMap: importMap$1,
        defaultExtension: importDefaultExtension
      }); // const rollupId = urlToRollupId(importUrl, { projectDirectoryUrl, compileServerOrigin })

      logger.debug(`${specifier} resolved to ${importUrl}`);
      return importUrl;
    },
    // https://rollupjs.org/guide/en#resolvedynamicimport
    // resolveDynamicImport: (specifier, importer) => {
    // },
    load: async urlForRollup => {
      const realUrl = urlToRealUrl(urlForRollup) || urlForRollup;
      logger.debug(`loads ${realUrl}`);
      const {
        responseUrl,
        contentRaw,
        content,
        map
      } = await loadModule(realUrl);
      const responseUrlForRollup = urlToUrlForRollup(responseUrl) || responseUrl;
      saveModuleContent(responseUrlForRollup, {
        content,
        contentRaw
      }); // handle redirection

      if (responseUrlForRollup !== urlForRollup) {
        saveModuleContent(urlForRollup, {
          content,
          contentRaw
        });
        redirectionMap[urlForRollup] = responseUrlForRollup;
      }

      return {
        code: content,
        map
      };
    },
    // resolveImportMeta: () => {}
    // transform should not be required anymore as
    // we will receive
    // transform: async (moduleContent, rollupId) => {}
    outputOptions: options => {
      // rollup does not expects to have http dependency in the mix
      const bundleSourcemapFileUrl = util.resolveUrl(`./${chunkId}.map`, bundleDirectoryUrl); // options.sourcemapFile = bundleSourcemapFileUrl

      options.sourcemapPathTransform = relativePath => {
        const url = relativePathToUrlForRollup(relativePath);

        if (url.startsWith(`${compileServerOriginForRollup}/`)) {
          const relativeUrl = url.slice(`${compileServerOriginForRollup}/`.length);
          const fileUrl = `${projectDirectoryUrl}${relativeUrl}`;
          relativePath = util.urlToRelativeUrl(fileUrl, bundleSourcemapFileUrl);
          return relativePath;
        }

        if (url.startsWith(projectDirectoryUrl)) {
          return relativePath;
        }

        return url;
      };

      const relativePathToUrlForRollup = relativePath => {
        const rollupUrl = util.resolveUrl(relativePath, bundleSourcemapFileUrl);
        let url; // fix rollup not supporting source being http

        const httpIndex = rollupUrl.indexOf(`http:/`);

        if (httpIndex > -1) {
          url = `http://${rollupUrl.slice(httpIndex + `http:/`.length)}`;
        } else {
          const httpsIndex = rollupUrl.indexOf("https:/");

          if (httpsIndex > -1) {
            url = `https://${rollupUrl.slice(httpsIndex + `https:/`.length)}`;
          } else {
            url = rollupUrl;
          }
        }

        if (url in redirectionMap) {
          return redirectionMap[url];
        }

        return url;
      };

      return options;
    },
    renderChunk: source => {
      if (!minify) return null; // https://github.com/terser-js/terser#minify-options

      const result = minifyJs(source, {
        sourceMap: true,
        ...(format === "global" ? {
          toplevel: false
        } : {
          toplevel: true
        }),
        ...minifyJsOptions
      });

      if (result.error) {
        throw result.error;
      } else {
        return result;
      }
    },
    generateBundle: async (outputOptions, bundle) => {
      if (!manifestFile) {
        return;
      }

      const mappings = {};
      Object.keys(bundle).forEach(key => {
        const chunk = bundle[key];
        mappings[`${chunk.name}.js`] = chunk.fileName;
      });
      const mappingKeysSorted = Object.keys(mappings).sort(util.comparePathnames);
      const manifest = {};
      mappingKeysSorted.forEach(key => {
        manifest[key] = mappings[key];
      });
      const manifestFileUrl = util.resolveUrl("manifest.json", bundleDirectoryUrl);
      await util.writeFile(manifestFileUrl, JSON.stringify(manifest, null, "  "));
    },
    writeBundle: async (options, bundle) => {
      if (detectAndTransformIfNeededAsyncInsertedByRollup) {
        await transformAsyncInsertedByRollup({
          projectDirectoryUrl,
          bundleDirectoryUrl,
          babelPluginMap,
          bundle
        });
      }

      Object.keys(bundle).forEach(bundleFilename => {
        logger.info(`-> ${bundleDirectoryUrl}${bundleFilename}`);
      });
    }
  };

  const urlToRealUrl = url => {
    if (url.startsWith(`${compileServerOriginForRollup}/`)) {
      return `${compileServerOrigin}/${url.slice(`${compileServerOriginForRollup}/`.length)}`;
    }

    return null;
  };

  const urlToUrlForRollup = url => {
    if (url.startsWith(`${compileServerOrigin}/`)) {
      return `${compileServerOriginForRollup}/${url.slice(`${compileServerOrigin}/`.length)}`;
    }

    return null;
  };

  const saveModuleContent = (moduleUrl, value) => {
    const realUrl = urlToRealUrl(moduleUrl) || moduleUrl;
    const url = urlToProjectUrl(realUrl) || moduleUrl;
    moduleContentMap[url] = value;
  };

  const urlToProjectUrl = url => {
    if (url.startsWith(`${compileServerOrigin}/`)) {
      return `${projectDirectoryUrl}${url.slice(`${compileServerOrigin}/`.length)}`;
    }

    return null;
  };

  const loadModule = async moduleUrl => {
    const moduleResponse = await fetchModule(moduleUrl);
    const contentType = moduleResponse.headers["content-type"] || "";
    const moduleText = await moduleResponse.text();
    const commonData = {
      responseUrl: moduleResponse.url,
      contentRaw: moduleText
    }; // keep this in sync with module-registration.js

    if (contentType === "application/javascript" || contentType === "text/javascript") {
      return { ...commonData,
        content: moduleText,
        map: await fetchSourcemap({
          cancellationToken,
          logger,
          moduleUrl,
          moduleContent: moduleText
        })
      };
    }

    if (contentType === "application/json" || contentType === "application/importmap+json") {
      return { ...commonData,
        content: jsonToJavascript(moduleText)
      };
    }

    if (contentType === "text/html") {
      return { ...commonData,
        content: htmlToJavascript(moduleText)
      };
    }

    if (contentType === "text/css") {
      return { ...commonData,
        content: cssToJavascript(moduleText)
      };
    }

    if (contentType === "image/svg+xml") {
      return { ...commonData,
        content: svgToJavaScript(moduleText)
      };
    }

    if (contentType.startsWith("text/")) {
      return { ...commonData,
        content: textToJavascript(moduleText)
      };
    }

    logger.debug(`Using base64 to bundle module because of its content-type.
--- content-type ---
${contentType}
--- module url ---
${moduleUrl}`); // fallback to base64 text

    return { ...commonData,
      content: textToJavascript(Buffer.from(moduleText).toString("base64"))
    };
  };

  const jsonToJavascript = jsonString => {
    // there is no need to minify the json string
    // because it becomes valid javascript
    // that will be minified by minifyJs inside renderChunk
    return `export default ${jsonString}`;
  };

  const htmlToJavascript = htmlString => {
    if (minify) {
      htmlString = minifyHtml(htmlString, minifyHtmlOptions);
    }

    return `export default ${JSON.stringify(htmlString)}`;
  };

  const cssToJavascript = cssString => {
    if (minify) {
      cssString = minifyCss(cssString, minifyCssOptions);
    }

    return `export default ${JSON.stringify(cssString)}`;
  };

  const svgToJavaScript = svgString => {
    // could also benefit of minification https://github.com/svg/svgo
    return `export default ${JSON.stringify(svgString)}`;
  };

  const textToJavascript = textString => {
    return `export default ${JSON.stringify(textString)}`;
  };

  const fetchModule = async moduleUrl => {
    const response = await fetchUrl(moduleUrl, {
      cancellationToken,
      ignoreHttpsError: true
    });
    const okValidation = validateResponseStatusIsOk(response);

    if (!okValidation.valid) {
      throw new Error(okValidation.message);
    }

    return response;
  };

  return {
    jsenvRollupPlugin,
    getExtraInfo: () => {
      return {
        moduleContentMap
      };
    }
  };
}; // const urlToRollupId = (url, { compileServerOrigin, projectDirectoryUrl }) => {
//   if (url.startsWith(`${compileServerOrigin}/`)) {
//     return urlToFileSystemPath(`${projectDirectoryUrl}${url.slice(`${compileServerOrigin}/`.length)}`)
//   }
//   if (url.startsWith("file://")) {
//     return urlToFileSystemPath(url)
//   }
//   return url
// }
// const urlToServerUrl = (url, { projectDirectoryUrl, compileServerOrigin }) => {
//   if (url.startsWith(projectDirectoryUrl)) {
//     return `${compileServerOrigin}/${url.slice(projectDirectoryUrl.length)}`
//   }
//   return null
// }
// const rollupIdToFileServerUrl = (rollupId, { projectDirectoryUrl, compileServerOrigin }) => {
//   const fileUrl = rollupIdToFileUrl(rollupId)
//   if (!fileUrl) {
//     return null
//   }
//   if (!fileUrl.startsWith(projectDirectoryUrl)) {
//     return null
//   }
//   const fileRelativeUrl = urlToRelativeUrl(fileUrl, projectDirectoryUrl)
//   return `${compileServerOrigin}/${fileRelativeUrl}`
// }

const transformAsyncInsertedByRollup = async ({
  projectDirectoryUrl,
  bundleDirectoryUrl,
  babelPluginMap,
  bundle
}) => {
  const asyncPluginName = findAsyncPluginNameInBabelPluginMap(babelPluginMap);
  if (!asyncPluginName) return; // we have to do this because rollup ads
  // an async wrapper function without transpiling it
  // if your bundle contains a dynamic import

  await Promise.all(Object.keys(bundle).map(async bundleFilename => {
    const bundleInfo = bundle[bundleFilename];
    const bundleFileUrl = util.resolveUrl(bundleFilename, bundleDirectoryUrl);
    const {
      code,
      map
    } = await transformJs({
      projectDirectoryUrl,
      code: bundleInfo.code,
      url: bundleFileUrl,
      map: bundleInfo.map,
      babelPluginMap: {
        [asyncPluginName]: babelPluginMap[asyncPluginName]
      },
      transformModuleIntoSystemFormat: false,
      // already done by rollup
      transformGenerator: false,
      // already done
      transformGlobalThis: false
    });
    await Promise.all([util.writeFile(bundleFileUrl, appendSourceMappingAsExternalUrl(code, `./${bundleFilename}.map`)), util.writeFile(`${bundleFileUrl}.map`, JSON.stringify(map))]);
  }));
};

const {
  rollup: rollup$1
} = require$1("rollup");

const generateBundleUsingRollup = async ({
  cancellationToken,
  logger,
  projectDirectoryUrl,
  entryPointMap,
  bundleDirectoryUrl,
  compileDirectoryRelativeUrl,
  compileServerOrigin,
  compileServerImportMap,
  importDefaultExtension,
  externalImportSpecifiers,
  node,
  browser,
  babelPluginMap,
  format,
  formatInputOptions,
  formatOutputOptions,
  minify,
  minifyJsOptions,
  minifyCssOptions,
  minifyHtmlOptions,
  sourcemapExcludeSources,
  writeOnFileSystem,
  manifestFile = false
}) => {
  const {
    jsenvRollupPlugin,
    getExtraInfo
  } = await createJsenvRollupPlugin({
    cancellationToken,
    logger,
    projectDirectoryUrl,
    entryPointMap,
    bundleDirectoryUrl,
    compileDirectoryRelativeUrl,
    compileServerOrigin,
    compileServerImportMap,
    importDefaultExtension,
    externalImportSpecifiers,
    node,
    browser,
    babelPluginMap,
    format,
    minify,
    minifyJsOptions,
    minifyCssOptions,
    minifyHtmlOptions,
    manifestFile
  });
  const rollupBundle = await useRollup({
    cancellationToken,
    logger,
    entryPointMap,
    jsenvRollupPlugin,
    format,
    formatInputOptions,
    formatOutputOptions,
    bundleDirectoryUrl,
    sourcemapExcludeSources,
    writeOnFileSystem
  });
  return {
    rollupBundle,
    ...getExtraInfo()
  };
};

const useRollup = async ({
  cancellationToken,
  logger,
  entryPointMap,
  jsenvRollupPlugin,
  format,
  formatInputOptions,
  formatOutputOptions,
  bundleDirectoryUrl,
  sourcemapExcludeSources,
  writeOnFileSystem
}) => {
  logger.info(`
parse bundle
--- entry point map ---
${JSON.stringify(entryPointMap, null, "  ")}
`);
  const rollupBundle = await cancellation.createOperation({
    cancellationToken,
    start: () => rollup$1({
      // about cache here, we should/could reuse previous rollup call
      // to get the cache from the entryPointMap
      // as shown here: https://rollupjs.org/guide/en#cache
      // it could be passed in arguments to this function
      // however parallelism and having different rollup options per
      // call make it a bit complex
      // cache: null
      // https://rollupjs.org/guide/en#experimentaltoplevelawait
      //  experimentalTopLevelAwait: true,
      // if we want to ignore some warning
      // please use https://rollupjs.org/guide/en#onwarn
      // to be very clear about what we want to ignore
      onwarn: (warning, warn) => {
        if (warning.code === "THIS_IS_UNDEFINED") return;
        warn(warning);
      },
      input: entryPointMap,
      plugins: [jsenvRollupPlugin],
      ...formatInputOptions
    })
  });

  if (!formatOutputOptions.entryFileNames) {
    formatOutputOptions.entryFileNames = `[name]${path.extname(entryPointMap[Object.keys(entryPointMap)[0]])}`;
  }

  if (!formatOutputOptions.chunkFileNames) {
    formatOutputOptions.chunkFileNames = `[name]-[hash]${path.extname(entryPointMap[Object.keys(entryPointMap)[0]])}`;
  }

  const rollupGenerateOptions = {
    // https://rollupjs.org/guide/en#experimentaltoplevelawait
    // experimentalTopLevelAwait: true,
    // we could put prefConst to true by checking 'transform-block-scoping'
    // presence in babelPluginMap
    preferConst: false,
    // https://rollupjs.org/guide/en#output-dir
    dir: util.urlToFileSystemPath(bundleDirectoryUrl),
    // https://rollupjs.org/guide/en#output-format
    format: formatToRollupFormat(format),
    // https://rollupjs.org/guide/en#output-sourcemap
    sourcemap: true,
    sourcemapExcludeSources,
    ...formatOutputOptions
  };
  const rollupOutputArray = await cancellation.createOperation({
    cancellationToken,
    start: () => {
      if (writeOnFileSystem) {
        logger.info(`write bundle at ${rollupGenerateOptions.dir}`);
        return rollupBundle.write(rollupGenerateOptions);
      }

      logger.info("generate bundle");
      return rollupBundle.generate(rollupGenerateOptions);
    }
  });
  return rollupOutputArray;
};

const formatToRollupFormat = format => {
  if (format === "global") return "iife";
  if (format === "commonjs") return "cjs";
  if (format === "systemjs") return "system";
  if (format === "esm") return "esm";
  throw new Error(`unexpected format, got ${format}`);
};

/*

One thing to keep in mind:
the sourcemap.sourcesContent will contains a json file transformed to js
while sourcesContent will contain the json file raw source because the corresponding
json file etag is used to invalidate the cache

*/
const bundleToCompilationResult = ({
  rollupBundle,
  moduleContentMap
}, {
  projectDirectoryUrl,
  compiledFileUrl,
  sourcemapFileUrl
}) => {
  if (typeof projectDirectoryUrl !== "string") {
    throw new TypeError(`projectDirectoryUrl must be a string, got ${projectDirectoryUrl}`);
  }

  if (typeof compiledFileUrl !== "string") {
    throw new TypeError(`compiledFileUrl must be a string, got ${compiledFileUrl}`);
  }

  if (typeof sourcemapFileUrl !== "string") {
    throw new TypeError(`sourcemapFileUrl must be a string, got ${sourcemapFileUrl}`);
  }

  const sources = [];
  const sourcesContent = [];

  const trackDependencies = dependencyMap => {
    Object.keys(dependencyMap).forEach(moduleUrl => {
      // do not track dependency outside project
      if (!moduleUrl.startsWith(projectDirectoryUrl)) {
        return;
      }

      if (!sources.includes(moduleUrl)) {
        sources.push(moduleUrl);
        sourcesContent.push(dependencyMap[moduleUrl].contentRaw);
      }
    });
  };

  const assets = [];
  const assetsContent = [];
  const mainChunk = parseRollupChunk(rollupBundle.output[0], {
    moduleContentMap,
    sourcemapFileUrl,
    sourcemapFileRelativeUrlForModule: util.urlToRelativeUrl(sourcemapFileUrl, compiledFileUrl)
  }); // mainChunk.sourcemap.file = fileUrlToRelativePath(originalFileUrl, sourcemapFileUrl)

  trackDependencies(mainChunk.dependencyMap);
  assets.push(sourcemapFileUrl);
  assetsContent.push(JSON.stringify(mainChunk.sourcemap, null, "  "));
  rollupBundle.output.slice(1).forEach(rollupChunk => {
    const chunkFileName = rollupChunk.fileName;
    const chunk = parseRollupChunk(rollupChunk, {
      moduleContentMap,
      compiledFileUrl,
      sourcemapFileUrl: util.resolveUrl(rollupChunk.map.file, compiledFileUrl)
    });
    trackDependencies(chunk.dependencyMap);
    assets.push(util.resolveUrl(chunkFileName), compiledFileUrl);
    assetsContent.push(chunk.content);
    assets.push(util.resolveUrl(`${rollupChunk.fileName}.map`, compiledFileUrl));
    assetsContent.push(JSON.stringify(chunk.sourcemap, null, "  "));
  });
  return {
    contentType: "application/javascript",
    compiledSource: mainChunk.content,
    sources,
    sourcesContent,
    assets,
    assetsContent
  };
};

const parseRollupChunk = (rollupChunk, {
  moduleContentMap,
  sourcemapFileUrl,
  sourcemapFileRelativeUrlForModule = `./${rollupChunk.fileName}.map`
}) => {
  const dependencyMap = {};
  const mainModuleSourcemap = rollupChunk.map;
  mainModuleSourcemap.sources.forEach((source, index) => {
    const moduleUrl = util.resolveUrl(source, sourcemapFileUrl);
    dependencyMap[moduleUrl] = getModuleContent({
      moduleContentMap,
      mainModuleSourcemap,
      moduleUrl,
      moduleIndex: index
    });
  });
  const sourcemap = rollupChunk.map;
  const content = writeOrUpdateSourceMappingURL(rollupChunk.code, sourcemapFileRelativeUrlForModule);
  return {
    dependencyMap,
    content,
    sourcemap
  };
};

const getModuleContent = ({
  moduleContentMap,
  mainModuleSourcemap,
  moduleUrl,
  moduleIndex
}) => {
  if (moduleUrl in moduleContentMap) {
    return moduleContentMap[moduleUrl];
  } // try to read it from mainModuleSourcemap


  const sourcesContent = mainModuleSourcemap.sourcesContent || [];

  if (moduleIndex in sourcesContent) {
    const contentFromRollupSourcemap = sourcesContent[moduleIndex];
    return {
      content: contentFromRollupSourcemap,
      contentRaw: contentFromRollupSourcemap
    };
  } // try to get it from filesystem


  if (moduleUrl.startsWith("file:///")) {
    const moduleFilePath = util.urlToFileSystemPath(moduleUrl); // this could be async but it's ok for now
    // making it async could be harder than it seems
    // because sourcesContent must be in sync with sources

    try {
      const moduleFileBuffer = fs.readFileSync(moduleFilePath);
      const moduleFileString = String(moduleFileBuffer);
      return {
        content: moduleFileString,
        contentRaw: moduleFileString
      };
    } catch (e) {
      if (e && e.code === "ENOENT") {
        throw new Error(`module file not found at ${moduleUrl}`);
      }

      throw e;
    }
  } // it's an external ressource like http, throw


  throw new Error(`cannot fetch module content from ${moduleUrl}`);
};

const serveBundle = async ({
  cancellationToken,
  logger,
  projectDirectoryUrl,
  originalFileUrl,
  compiledFileUrl,
  outDirectoryRelativeUrl,
  compileServerOrigin,
  compileServerImportMap,
  importDefaultExtension,
  externalImportSpecifiers = [],
  compileCacheStrategy,
  format,
  formatOutputOptions = {},
  node = format === "commonjs",
  browser = format === "global",
  projectFileRequestedCallback,
  request,
  babelPluginMap
}) => {
  const compile = async () => {
    const originalFileRelativeUrl = util.urlToRelativeUrl(originalFileUrl, projectDirectoryUrl);
    const entryExtname = path.extname(originalFileRelativeUrl);
    const entryBasename = path.basename(originalFileRelativeUrl, entryExtname);
    const entryName = entryBasename;
    const entryPointMap = {
      [entryName]: `./${originalFileRelativeUrl}`
    };
    const compileId = format === "global" ? COMPILE_ID_GLOBAL_BUNDLE_FILES : COMPILE_ID_COMMONJS_BUNDLE_FILES;
    const bundle = await generateBundleUsingRollup({
      cancellationToken,
      logger,
      projectDirectoryUrl,
      entryPointMap,
      // bundleDirectoryUrl is just theorical because of writeOnFileSystem: false
      // but still important to know where the files will be written
      bundleDirectoryUrl: util.resolveDirectoryUrl("./", compiledFileUrl),
      compileDirectoryRelativeUrl: `${outDirectoryRelativeUrl}${compileId}/`,
      compileServerOrigin,
      compileServerImportMap,
      importDefaultExtension,
      externalImportSpecifiers,
      node,
      browser,
      babelPluginMap,
      format,
      formatOutputOptions,
      writeOnFileSystem: false,
      sourcemapExcludeSources: true
    });
    const sourcemapFileUrl = `${compiledFileUrl}.map`;
    return bundleToCompilationResult(bundle, {
      projectDirectoryUrl,
      originalFileUrl,
      compiledFileUrl,
      sourcemapFileUrl
    });
  }; // might want to put this to false while working on jsenv
  // to that cache gets verified


  const isJenvInternalFile = false ;
  return compileFile({
    logger,
    projectDirectoryUrl,
    originalFileUrl,
    compiledFileUrl,
    writeOnFilesystem: true,
    useFilesystemAsCache: true,
    compileCacheStrategy,
    projectFileRequestedCallback,
    compile,
    request,
    compileCacheSourcesValidation: !isJenvInternalFile,
    compileCacheAssetsValidation: !isJenvInternalFile
  });
};

/**

An important concern here:

All script type="module" will be converted to inline script.
These inline script execution order is non predictible it depends
which one is being done first

*/

const parse5 = require$1("parse5");

const compileHtml = (htmlBeforeCompilation, {
  scriptManipulations = [],
  replaceModuleScripts = true,
  replaceImportmapScript = true,
  // resolveScriptSrc = (src) => src,
  generateInlineScriptSrc = ({
    hash
  }) => `./${hash}.js`
} = {}) => {
  // https://github.com/inikulin/parse5/blob/master/packages/parse5/docs/tree-adapter/interface.md
  const document = parse5.parse(htmlBeforeCompilation);
  manipulateScripts(document, scriptManipulations);
  const scriptsExternalized = polyfillScripts(document, {
    replaceModuleScripts,
    replaceImportmapScript,
    generateInlineScriptSrc
  }); // resolveScripts(document, resolveScriptSrc)

  const htmlAfterCompilation = parse5.serialize(document);
  return {
    htmlAfterCompilation,
    scriptsExternalized
  };
};

const manipulateScripts = (document, scriptManipulations) => {
  const htmlNode = document.childNodes.find(node => node.nodeName === "html");
  const headNode = htmlNode.childNodes[0];
  const bodyNode = htmlNode.childNodes[1];
  const scriptsToPreprendInHead = [];
  scriptManipulations.forEach(({
    replaceExisting = false,
    ...script
  }) => {
    const scriptExistingInHead = findExistingScript(headNode, script);

    if (scriptExistingInHead) {
      if (replaceExisting) {
        replaceNode(scriptExistingInHead, scriptToNode(script));
      }

      return;
    }

    const scriptExistingInBody = findExistingScript(bodyNode, script);

    if (scriptExistingInBody) {
      if (replaceExisting) {
        replaceNode(scriptExistingInBody, scriptToNode(script));
      }

      return;
    }

    scriptsToPreprendInHead.push(script);
  });
  const headScriptsFragment = scriptsToFragment(scriptsToPreprendInHead);
  insertFragmentBefore(headNode, headScriptsFragment, findChild(headNode, node => node.nodeName === "script"));
};

const insertFragmentBefore = (node, fragment, childNode) => {
  const {
    childNodes = []
  } = node;

  if (childNode) {
    const childNodeIndex = childNodes.indexOf(childNode);
    node.childNodes = [...childNodes.slice(0, childNodeIndex), ...fragment.childNodes.map(child => {
      return { ...child,
        parentNode: node
      };
    }), ...childNodes.slice(childNodeIndex)];
  } else {
    node.childNodes = [...childNodes, ...fragment.childNodes.map(child => {
      return { ...child,
        parentNode: node
      };
    })];
  }
};

const scriptToNode = script => {
  return scriptsToFragment([script]).childNodes[0];
};

const scriptsToFragment = scripts => {
  const html = scripts.reduce((previous, script) => {
    const scriptAttributes = objectToHtmlAttributes(script);
    return `${previous}<script ${scriptAttributes}></script>
      `;
  }, "");
  const fragment = parse5.parseFragment(html);
  return fragment;
};

const findExistingScript = (node, script) => findChild(node, childNode => {
  return childNode.nodeName === "script" && sameScript(childNode, script);
});

const findChild = ({
  childNodes = []
}, predicate) => childNodes.find(predicate);

const sameScript = (node, {
  type = "text/javascript",
  src
}) => {
  const nodeType = getAttributeValue(node, "type") || "text/javascript";
  const nodeSrc = getAttributeValue(node, "src");

  if (type === "importmap") {
    return nodeType === type;
  }

  return nodeType === type && nodeSrc === src;
};

const objectToHtmlAttributes = object => {
  return Object.keys(object).map(key => `${key}=${valueToHtmlAttributeValue(object[key])}`).join(" ");
};

const valueToHtmlAttributeValue = value => {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return `"${JSON.stringify(value)}"`;
};

const polyfillScripts = (document, {
  replaceModuleScripts,
  replaceImportmapScript,
  generateInlineScriptSrc
}) => {
  /*
  <script type="module" src="*" /> are going to be inlined
  <script type="module">** </script> are going to be transformed to import a file so that we can transform the script content.
   but we don't want that a script with an src to be considered as an inline script after it was inlined.
   For that reason we perform mutation in the end
  */
  const mutations = [];
  const scriptsExternalized = {};
  visitDocument(document, node => {
    if (node.nodeName !== "script") {
      return;
    }

    const attributes = node.attrs;
    const nodeType = getAttributeValue(node, "type");

    if (replaceModuleScripts && nodeType === "module") {
      const nodeSrc = getAttributeValue(node, "src");

      if (nodeSrc) {
        mutations.push(() => {
          const script = parseHtmlAsSingleElement(generateScriptForJsenv(nodeSrc)); // inherit script attributes (except src and type)

          script.attrs = [...script.attrs, ...attributes.filter(attr => attr.name !== "type" && attr.name !== "src")];
          replaceNode(node, script);
        });
        return;
      }

      const firstChild = node.childNodes[0];

      if (firstChild && firstChild.nodeName === "#text") {
        const scriptText = firstChild.value;
        mutations.push(() => {
          const nodeId = getAttributeValue(node, "id");
          const hash = createScriptContentHash(scriptText);
          const src = generateInlineScriptSrc({
            hash,
            id: nodeId
          });
          const script = parseHtmlAsSingleElement(generateScriptForJsenv(src)); // inherit script attributes (except src and type)

          script.attrs = [...script.attrs, ...attributes.filter(attr => attr.name !== "type" && attr.name !== "src")];
          replaceNode(node, script);
          scriptsExternalized[src] = scriptText;
        });
        return;
      }
    }

    if (replaceImportmapScript && nodeType === "importmap") {
      const typeAttribute = getAttributeByName(node.attrs, "type");
      typeAttribute.value = "jsenv-importmap";
    }
  });
  mutations.forEach(fn => fn());
  return scriptsExternalized;
}; // const resolveScripts = (document, resolveScriptSrc) => {
//   visitDocument(document, (node) => {
//     if (node.nodeName !== "script") {
//       return
//     }
//     const attributes = node.attrs
//     const srcAttribute = getAttributeByName(attributes, "src")
//     if (!srcAttribute) {
//       return
//     }
//     const srcAttributeValue = srcAttribute.value
//     srcAttribute.value = resolveScriptSrc(srcAttributeValue)
//   })
// }


const getAttributeValue = (node, attributeName) => {
  const attribute = getAttributeByName(node.attrs, attributeName);
  return attribute ? attribute.value : undefined;
};

const getAttributeByName = (attributes, attributeName) => attributes.find(attr => attr.name === attributeName);

const generateScriptForJsenv = src => {
  return `<script>
      window.__jsenv__.importFile(${JSON.stringify(src)})
    </script>`;
};

const createScriptContentHash = content => {
  const hash = crypto.createHash("sha256");
  hash.update(content);
  return hash.digest("hex").slice(0, 8);
};

const parseHtmlAsSingleElement = html => {
  const fragment = parse5.parseFragment(html);
  return fragment.childNodes[0];
};

const replaceNode = (node, newNode) => {
  const {
    parentNode
  } = node;
  const parentNodeChildNodes = parentNode.childNodes;
  const nodeIndex = parentNodeChildNodes.indexOf(node);
  parentNodeChildNodes[nodeIndex] = newNode;
};

const visitDocument = (document, fn) => {
  const visitNode = node => {
    fn(node);
    const {
      childNodes
    } = node;

    if (childNodes) {
      let i = 0;

      while (i < childNodes.length) {
        visitNode(childNodes[i++]);
      }
    }
  };

  visitNode(document);
};

/* eslint-disable import/max-dependencies */
const createCompiledFileService = ({
  cancellationToken,
  logger,
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  browserBundledJsFileRelativeUrl,
  compileServerImportMap,
  importMapFileRelativeUrl,
  importDefaultExtension,
  transformTopLevelAwait,
  transformModuleIntoSystemFormat,
  babelPluginMap,
  groupMap,
  convertMap,
  scriptManipulations,
  projectFileRequestedCallback,
  useFilesystemAsCache,
  writeOnFilesystem,
  compileCacheStrategy
}) => {
  return request => {
    const {
      origin,
      ressource,
      method,
      headers
    } = request;
    const requestUrl = `${origin}${ressource}`;
    const outDirectoryRemoteUrl = util.resolveDirectoryUrl(outDirectoryRelativeUrl, origin); // not inside compile directory -> nothing to compile

    if (!requestUrl.startsWith(outDirectoryRemoteUrl)) {
      return null;
    }

    const afterOutDirectory = requestUrl.slice(outDirectoryRemoteUrl.length); // serve files inside /.jsenv/out/* directly without compilation
    // this is just to allow some files to be written inside outDirectory and read directly
    // if asked by the client (such as env.json, groupMap.json, meta.json)

    if (!afterOutDirectory.includes("/") || afterOutDirectory[0] === "/") {
      return server.serveFile(`${projectDirectoryUrl}${ressource.slice(1)}`, {
        method,
        headers
      });
    }

    const parts = afterOutDirectory.split("/");
    const compileId = parts[0];
    const remaining = parts.slice(1).join("/");
    const contentType = server.urlToContentType(requestUrl); // no compileId, we don't know what to compile (not supposed so happen)

    if (compileId === "") {
      return null;
    }

    const allowedCompileIds = [...Object.keys(groupMap), COMPILE_ID_GLOBAL_BUNDLE, COMPILE_ID_GLOBAL_BUNDLE_FILES, COMPILE_ID_COMMONJS_BUNDLE, COMPILE_ID_COMMONJS_BUNDLE_FILES];

    if (!allowedCompileIds.includes(compileId)) {
      return {
        status: 400,
        statusText: `compileId must be one of ${allowedCompileIds}, received ${compileId}`
      };
    } // nothing after compileId, we don't know what to compile (not supposed to happen)


    if (remaining === "") {
      return null;
    }

    const originalFileRelativeUrl = remaining;
    const originalFileUrl = `${projectDirectoryUrl}${originalFileRelativeUrl}`;
    const compileDirectoryRelativeUrl = `${outDirectoryRelativeUrl}${compileId}/`;
    const compileDirectoryUrl = util.resolveDirectoryUrl(compileDirectoryRelativeUrl, projectDirectoryUrl);
    const compiledFileUrl = util.resolveUrl(originalFileRelativeUrl, compileDirectoryUrl); // send out/best/*.importmap untouched

    if (originalFileRelativeUrl === importMapFileRelativeUrl) {
      if (compileId === COMPILE_ID_GLOBAL_BUNDLE_FILES || compileId === COMPILE_ID_COMMONJS_BUNDLE_FILES) {
        const otherwiseImportmapFileUrl = util.resolveUrl(originalFileRelativeUrl, `${projectDirectoryUrl}${outDirectoryRelativeUrl}otherwise/`); // for otherwise-commonjs-bundle, server did not write *.importmap
        // let's just return otherwise/importMapFileRelativeUrl

        return server.serveFile(otherwiseImportmapFileUrl, {
          method,
          headers
        });
      }

      return server.serveFile(compiledFileUrl, {
        method,
        headers
      });
    }

    if (contentType === "application/javascript") {
      if (compileId === COMPILE_ID_GLOBAL_BUNDLE || compileId === COMPILE_ID_COMMONJS_BUNDLE) {
        return serveBundle({
          cancellationToken,
          logger,
          projectDirectoryUrl,
          originalFileUrl,
          compiledFileUrl,
          outDirectoryRelativeUrl,
          compileServerOrigin: request.origin,
          compileServerImportMap,
          importDefaultExtension,
          babelPluginMap,
          projectFileRequestedCallback,
          request,
          format: compileId === COMPILE_ID_GLOBAL_BUNDLE ? "global" : "commonjs"
        });
      }

      return compileFile({
        cancellationToken,
        logger,
        projectDirectoryUrl,
        originalFileUrl,
        compiledFileUrl,
        writeOnFilesystem,
        useFilesystemAsCache,
        compileCacheStrategy,
        projectFileRequestedCallback,
        request,
        compile: async originalFileContent => {
          const transformResult = await transformJs({
            projectDirectoryUrl,
            code: originalFileContent,
            url: originalFileUrl,
            urlAfterTransform: compiledFileUrl,
            babelPluginMap: compileIdToBabelPluginMap(compileId, {
              groupMap,
              babelPluginMap
            }),
            convertMap,
            transformTopLevelAwait,
            transformModuleIntoSystemFormat: compileIdIsForBundleFiles(compileId) ? // we are compiling for rollup, do not transform into systemjs format
            false : transformModuleIntoSystemFormat
          });
          const sourcemapFileUrl = `${compiledFileUrl}.map`;
          return transformResultToCompilationResult(transformResult, {
            projectDirectoryUrl,
            originalFileContent,
            originalFileUrl,
            compiledFileUrl,
            sourcemapFileUrl,
            remapMethod: writeOnFilesystem ? "comment" : "inline"
          });
        }
      });
    }

    if (contentType === "text/html") {
      return compileFile({
        cancellationToken,
        logger,
        projectDirectoryUrl,
        originalFileUrl,
        compiledFileUrl,
        writeOnFilesystem,
        useFilesystemAsCache,
        compileCacheStrategy,
        projectFileRequestedCallback,
        request,
        compile: async htmlBeforeCompilation => {
          const {
            htmlAfterCompilation,
            scriptsExternalized
          } = compileHtml(htmlBeforeCompilation, {
            scriptManipulations: [{
              // when html file already contains an importmap script tag
              // its src is replaced to target the importmap used for compiled files
              replaceExisting: true,
              type: "importmap",
              src: `/${outDirectoryRelativeUrl}${compileId}/${importMapFileRelativeUrl}`
            }, {
              src: `/${browserBundledJsFileRelativeUrl}`
            }, // todo: this is dirty because it means
            // compile server is aware of exploring and jsenv toolbar
            // instead this should be moved to startExploring
            ...(originalFileUrl === jsenvToolbarHtmlFileUrl ? [] : scriptManipulations)],
            generateInlineScriptSrc: ({
              id,
              hash
            }) => {
              const scriptAssetUrl = generateCompiledFileAssetUrl(compiledFileUrl, id ? `${id}.js` : `${hash}.js`);
              return `./${util.urlToRelativeUrl(scriptAssetUrl, compiledFileUrl)}`;
            }
          });
          let assets = [];
          let assetsContent = [];
          await Promise.all(Object.keys(scriptsExternalized).map(async scriptSrc => {
            const scriptAssetUrl = util.resolveUrl(scriptSrc, compiledFileUrl);
            const scriptBasename = util.urlToRelativeUrl(scriptAssetUrl, compiledFileUrl);
            const scriptOriginalFileUrl = util.resolveUrl(scriptBasename, originalFileUrl);
            const scriptAfterTransformFileUrl = util.resolveUrl(scriptBasename, compiledFileUrl);
            const scriptBeforeCompilation = scriptsExternalized[scriptSrc];
            const scriptTransformResult = await transformJs({
              projectDirectoryUrl,
              code: scriptBeforeCompilation,
              url: scriptOriginalFileUrl,
              urlAfterTransform: scriptAfterTransformFileUrl,
              babelPluginMap: compileIdToBabelPluginMap(compileId, {
                groupMap,
                babelPluginMap
              }),
              convertMap,
              transformTopLevelAwait,
              transformModuleIntoSystemFormat: true
            });
            const sourcemapFileUrl = util.resolveUrl(`${scriptBasename}.map`, scriptAfterTransformFileUrl);
            let {
              code,
              map
            } = scriptTransformResult;
            const sourcemapFileRelativePathForModule = util.urlToRelativeUrl(sourcemapFileUrl, compiledFileUrl);
            code = appendSourceMappingAsExternalUrl(code, sourcemapFileRelativePathForModule);
            assets = [...assets, scriptAssetUrl, sourcemapFileUrl];
            assetsContent = [...assetsContent, code, JSON.stringify(map, null, "  ")];
          }));
          return {
            compiledSource: htmlAfterCompilation,
            contentType: "text/html",
            sources: [originalFileUrl],
            sourcesContent: [htmlBeforeCompilation],
            assets,
            assetsContent
          };
        }
      });
    } // json, css etc does not need to be compiled, they are redirected to their source version that will be served as file


    return {
      status: 307,
      headers: {
        location: util.resolveUrl(originalFileRelativeUrl, origin)
      }
    };
  };
};

const compileIdIsForBundleFiles = compileId => {
  return compileId === COMPILE_ID_GLOBAL_BUNDLE_FILES || compileId === COMPILE_ID_COMMONJS_BUNDLE_FILES;
};

const getWorstCompileId = groupMap => {
  if (COMPILE_ID_OTHERWISE in groupMap) {
    return COMPILE_ID_OTHERWISE;
  }

  return Object.keys(groupMap)[Object.keys(groupMap).length - 1];
};

const compileIdToBabelPluginMap = (compileId, {
  babelPluginMap,
  groupMap
}) => {
  let compiledIdForGroupMap;
  let babelPluginMapForGroupMap;

  if (compileIdIsForBundleFiles(compileId)) {
    compiledIdForGroupMap = getWorstCompileId(groupMap);
    babelPluginMapForGroupMap = createBabePluginMapForBundle({
      format: compileId === COMPILE_ID_GLOBAL_BUNDLE_FILES ? "global" : "commonjs"
    });
  } else {
    compiledIdForGroupMap = compileId;
    babelPluginMapForGroupMap = {};
  }

  const groupBabelPluginMap = {};
  groupMap[compiledIdForGroupMap].babelPluginRequiredNameArray.forEach(babelPluginRequiredName => {
    if (babelPluginRequiredName in babelPluginMap) {
      groupBabelPluginMap[babelPluginRequiredName] = babelPluginMap[babelPluginRequiredName];
    }
  });
  return { ...groupBabelPluginMap,
    ...babelPluginMapForGroupMap
  };
};

/* eslint-disable import/max-dependencies */
const startCompileServer = async ({
  cancellationToken = cancellation.createCancellationToken(),
  compileServerLogLevel,
  projectDirectoryUrl,
  importMapFileRelativeUrl = "import-map.importmap",
  importDefaultExtension,
  jsenvDirectoryRelativeUrl = ".jsenv",
  jsenvDirectoryClean = false,
  outDirectoryName = "out",
  writeOnFilesystem = true,
  useFilesystemAsCache = true,
  compileCacheStrategy = "etag",
  // js compile options
  transformTopLevelAwait = true,
  transformModuleIntoSystemFormat = true,
  env = {},
  processEnvNodeEnv = "undefined",
  replaceProcessEnvNodeEnv = true,
  replaceGlobalObject = false,
  replaceGlobalFilename = false,
  replaceGlobalDirname = false,
  replaceMap = {},
  babelPluginMap = jsenvBabelPluginMap,
  convertMap = {},
  // options related to the server itself
  compileServerProtocol = "https",
  compileServerPrivateKey,
  compileServerCertificate,
  compileServerIp = "0.0.0.0",
  compileServerPort = 0,
  keepProcessAlive = false,
  stopOnPackageVersionChange = false,
  // remaining options are complex or private
  compileGroupCount = 1,
  babelCompatMap = jsenvBabelPluginCompatMap,
  browserScoreMap = jsenvBrowserScoreMap,
  nodeVersionScoreMap = jsenvNodeVersionScoreMap,
  runtimeAlwaysInsideRuntimeScoreMap = false,
  livereloadWatchConfig = {
    "./**": true,
    "./.*/": true,
    // any folder starting with a dot is ignored (includes .git for instance)
    "./**/node_modules/": false
  },
  livereloadLogLevel = "info",
  customServices = {},
  livereloadSSE = false,
  scriptManipulations = [],
  browserInternalFileAnticipation = false,
  nodeInternalFileAnticipation = false
}) => {
  assertArguments({
    projectDirectoryUrl,
    importMapFileRelativeUrl,
    jsenvDirectoryRelativeUrl,
    outDirectoryName
  });
  const importMapFileUrl = util.resolveUrl(importMapFileRelativeUrl, projectDirectoryUrl);
  const jsenvDirectoryUrl = util.resolveDirectoryUrl(jsenvDirectoryRelativeUrl, projectDirectoryUrl);
  const outDirectoryUrl = util.resolveDirectoryUrl(outDirectoryName, jsenvDirectoryUrl);
  const outDirectoryRelativeUrl = util.urlToRelativeUrl(outDirectoryUrl, projectDirectoryUrl); // normalization

  importMapFileRelativeUrl = util.urlToRelativeUrl(importMapFileUrl, projectDirectoryUrl);
  jsenvDirectoryRelativeUrl = util.urlToRelativeUrl(jsenvDirectoryUrl, projectDirectoryUrl);
  const logger$1 = logger.createLogger({
    logLevel: compileServerLogLevel
  });
  babelPluginMap = {
    "transform-replace-expressions": [babelPluginReplaceExpressions, {
      replaceMap: { ...(replaceProcessEnvNodeEnv ? {
          "process.env.NODE_ENV": `("${processEnvNodeEnv}")`
        } : {}),
        ...(replaceGlobalObject ? {
          global: "globalThis"
        } : {}),
        ...(replaceGlobalFilename ? {
          __filename: __filenameReplacement$2
        } : {}),
        ...(replaceGlobalDirname ? {
          __dirname: __dirnameReplacement$2
        } : {}),
        ...replaceMap
      },
      allowConflictingReplacements: true
    }],
    ...babelPluginMap
  };
  const compileServerGroupMap = generateGroupMap({
    babelPluginMap,
    babelCompatMap,
    runtimeScoreMap: { ...browserScoreMap,
      node: nodeVersionScoreMap
    },
    groupCount: compileGroupCount,
    runtimeAlwaysInsideRuntimeScoreMap
  });
  const compileServerImportMap = await generateImportMapForCompileServer({
    logLevel: compileServerLogLevel,
    projectDirectoryUrl,
    outDirectoryRelativeUrl,
    importMapFileRelativeUrl
  });
  await setupOutDirectory(outDirectoryUrl, {
    logger: logger$1,
    jsenvDirectoryUrl,
    jsenvDirectoryClean,
    useFilesystemAsCache,
    babelPluginMap,
    convertMap,
    compileServerGroupMap
  });
  const serverStopCancellationSource = cancellation.createCancellationSource();

  let projectFileRequestedCallback = () => {};

  if (livereloadSSE) {
    const sseSetup = setupServerSentEventsForLivereload({
      cancellationToken: cancellation.composeCancellationToken(cancellationToken, serverStopCancellationSource.token),
      projectDirectoryUrl,
      jsenvDirectoryRelativeUrl,
      outDirectoryRelativeUrl,
      livereloadLogLevel,
      livereloadWatchConfig
    });
    projectFileRequestedCallback = sseSetup.projectFileRequestedCallback;
    const serveSSEForLivereload = createSSEForLivereloadService({
      cancellationToken,
      outDirectoryRelativeUrl,
      trackMainAndDependencies: sseSetup.trackMainAndDependencies
    });
    customServices = {
      "service:livereload sse": serveSSEForLivereload,
      ...customServices
    };
  }

  const browserjsFileRelativeUrl = util.urlToRelativeUrl(browserJsFileUrl, projectDirectoryUrl);
  const browserBundledJsFileRelativeUrl = `${outDirectoryRelativeUrl}${COMPILE_ID_GLOBAL_BUNDLE}/${browserjsFileRelativeUrl}`;
  const serveAssetFile = createAssetFileService({
    projectDirectoryUrl
  });
  const serveBrowserScript = createBrowserScriptService({
    projectDirectoryUrl,
    outDirectoryRelativeUrl,
    browserBundledJsFileRelativeUrl
  });
  const serveCompiledFile = createCompiledFileService({
    cancellationToken,
    logger: logger$1,
    projectDirectoryUrl,
    outDirectoryRelativeUrl,
    browserBundledJsFileRelativeUrl,
    compileServerImportMap,
    importMapFileRelativeUrl,
    importDefaultExtension,
    transformTopLevelAwait,
    transformModuleIntoSystemFormat,
    babelPluginMap,
    groupMap: compileServerGroupMap,
    convertMap,
    scriptManipulations,
    projectFileRequestedCallback,
    useFilesystemAsCache,
    writeOnFilesystem,
    compileCacheStrategy
  });
  const serveProjectFile = createProjectFileService({
    projectDirectoryUrl,
    projectFileRequestedCallback
  });
  const compileServer = await server.startServer({
    cancellationToken,
    logLevel: compileServerLogLevel,
    protocol: compileServerProtocol,
    http2: compileServerProtocol === "https",
    redirectHttpToHttps: compileServerProtocol === "https",
    privateKey: compileServerPrivateKey,
    certificate: compileServerCertificate,
    ip: compileServerIp,
    port: compileServerPort,
    sendServerTiming: true,
    nagle: false,
    sendInternalErrorStack: true,
    requestToResponse: server.firstServiceWithTiming({ ...customServices,
      "service:asset files": serveAssetFile,
      "service:browser script": serveBrowserScript,
      "service:compiled files": serveCompiledFile,
      "service:project files": serveProjectFile
    }),
    accessControlAllowRequestOrigin: true,
    accessControlAllowRequestMethod: true,
    accessControlAllowRequestHeaders: true,
    accessControlAllowedRequestHeaders: [...server.jsenvAccessControlAllowedHeaders, "x-jsenv-execution-id"],
    accessControlAllowCredentials: true,
    keepProcessAlive
  });
  compileServer.stoppedPromise.then(serverStopCancellationSource.cancel);
  await installOutFiles(compileServer, {
    projectDirectoryUrl,
    jsenvDirectoryRelativeUrl,
    outDirectoryRelativeUrl,
    importDefaultExtension,
    importMapFileRelativeUrl,
    compileServerImportMap,
    compileServerGroupMap,
    env,
    writeOnFilesystem
  });

  if (stopOnPackageVersionChange) {
    installStopOnPackageVersionChange(compileServer, {
      projectDirectoryUrl,
      jsenvDirectoryRelativeUrl
    });
  }

  const internalFilesToPing = [];

  if (browserInternalFileAnticipation) {
    const browserJsFileRelativeUrl = util.urlToRelativeUrl(browserJsFileUrl, projectDirectoryUrl);
    internalFilesToPing.push(`${compileServer.origin}/${outDirectoryRelativeUrl}${COMPILE_ID_GLOBAL_BUNDLE}/${browserJsFileRelativeUrl}`);
  }

  if (nodeInternalFileAnticipation) {
    const nodeJsFileRelativeUrl = util.urlToRelativeUrl(nodeJsFileUrl, projectDirectoryUrl);
    internalFilesToPing.push(`${compileServer.origin}/${outDirectoryRelativeUrl}${COMPILE_ID_COMMONJS_BUNDLE}/${nodeJsFileRelativeUrl}`);
  }

  if (internalFilesToPing.length) {
    logger$1.info(`preparing jsenv internal files (${internalFilesToPing.length})...`);
    await internalFilesToPing.reduce(async (previous, internalFileUrl) => {
      await previous;
      logger$1.debug(`ping internal file at ${internalFileUrl} to have it in filesystem cache`);
      return fetchUrl(internalFileUrl, {
        ignoreHttpsError: true
      });
    }, Promise.resolve());
  }

  return {
    jsenvDirectoryRelativeUrl,
    outDirectoryRelativeUrl,
    importMapFileRelativeUrl,
    ...compileServer,
    compileServerImportMap,
    compileServerGroupMap
  };
};
const computeOutDirectoryRelativeUrl = ({
  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl = ".jsenv",
  outDirectoryName = "out"
}) => {
  const jsenvDirectoryUrl = util.resolveDirectoryUrl(jsenvDirectoryRelativeUrl, projectDirectoryUrl);
  const outDirectoryUrl = util.resolveDirectoryUrl(outDirectoryName, jsenvDirectoryUrl);
  const outDirectoryRelativeUrl = util.urlToRelativeUrl(outDirectoryUrl, projectDirectoryUrl);
  return outDirectoryRelativeUrl;
};

const assertArguments = ({
  projectDirectoryUrl,
  importMapFileRelativeUrl,
  jsenvDirectoryRelativeUrl,
  outDirectoryName
}) => {
  if (typeof projectDirectoryUrl !== "string") {
    throw new TypeError(`projectDirectoryUrl must be a string. got ${projectDirectoryUrl}`);
  }

  assertImportMapFileRelativeUrl({
    importMapFileRelativeUrl
  });
  const importMapFileUrl = util.resolveUrl(importMapFileRelativeUrl, projectDirectoryUrl);
  assertImportMapFileInsideProject({
    importMapFileUrl,
    projectDirectoryUrl
  });

  if (typeof jsenvDirectoryRelativeUrl !== "string") {
    throw new TypeError(`jsenvDirectoryRelativeUrl must be a string. got ${jsenvDirectoryRelativeUrl}`);
  }

  const jsenvDirectoryUrl = util.resolveDirectoryUrl(jsenvDirectoryRelativeUrl, projectDirectoryUrl);

  if (!jsenvDirectoryUrl.startsWith(projectDirectoryUrl)) {
    throw new TypeError(`jsenv directory must be inside project directory
--- jsenv directory url ---
${jsenvDirectoryUrl}
--- project directory url ---
${projectDirectoryUrl}`);
  }

  if (typeof outDirectoryName !== "string") {
    throw new TypeError(`outDirectoryName must be a string. got ${outDirectoryName}`);
  }
};
/**
 * generateImportMapForCompileServer allows the following:
 *
 * import importMap from '/jsenv.importmap'
 *
 * returns the project importMap.
 * Note that if importMap file does not exists an empty object is returned.
 * Note that if project uses a custom importMapFileRelativeUrl jsenv internal import map
 * remaps '/jsenv.importmap' to the real importMap
 *
 * This pattern exists so that jsenv can resolve some dynamically injected import such as
 *
 * @jsenv/core/helpers/regenerator-runtime/regenerator-runtime.js
 */


const generateImportMapForCompileServer = async ({
  logLevel,
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  importMapFileRelativeUrl
}) => {
  const importMapForJsenvCore = await nodeModuleImportMap.getImportMapFromNodeModules({
    logLevel,
    projectDirectoryUrl: jsenvCoreDirectoryUrl,
    rootProjectDirectoryUrl: projectDirectoryUrl,
    projectPackageDevDependenciesIncluded: false
  });
  const importmapForSelfImport = {
    imports: {
      "@jsenv/core/": `./${util.urlToRelativeUrl(jsenvCoreDirectoryUrl, projectDirectoryUrl)}`
    }
  }; // lorsque /.jsenv/out n'est pas la ou on l'attends
  // il faut alors faire un scope /.jsenv/out/ qui dit hey

  const importMapInternal = {
    imports: { ...(outDirectoryRelativeUrl === ".jsenv/out/" ? {} : {
        "/.jsenv/out/": `./${outDirectoryRelativeUrl}`
      }),
      "/jsenv.importmap": `./${importMapFileRelativeUrl}`
    }
  };
  const importMapForProject = await readProjectImportMap({
    projectDirectoryUrl,
    importMapFileRelativeUrl
  });
  const importMap$1 = [importMapForJsenvCore, importmapForSelfImport, importMapInternal, importMapForProject].reduce((previous, current) => importMap.composeTwoImportMaps(previous, current), {});
  return importMap$1;
};

const setupOutDirectory = async (outDirectoryUrl, {
  logger,
  jsenvDirectoryClean,
  jsenvDirectoryUrl,
  useFilesystemAsCache,
  babelPluginMap,
  convertMap,
  compileServerGroupMap
}) => {
  if (jsenvDirectoryClean) {
    logger.info(`clean jsenv directory at ${jsenvDirectoryUrl}`);
    await util.ensureEmptyDirectory(jsenvDirectoryUrl);
  }

  if (useFilesystemAsCache) {
    const jsenvCorePackageFileUrl = util.resolveUrl("./package.json", jsenvCoreDirectoryUrl);
    const jsenvCorePackageFilePath = util.urlToFileSystemPath(jsenvCorePackageFileUrl);
    const jsenvCorePackageVersion = readPackage(jsenvCorePackageFilePath).version;
    const outDirectoryMeta = {
      jsenvCorePackageVersion,
      babelPluginMap,
      convertMap,
      compileServerGroupMap
    };
    const metaFileUrl = util.resolveUrl("./meta.json", outDirectoryUrl);
    let previousOutDirectoryMeta;

    try {
      const source = await util.readFile(metaFileUrl);
      previousOutDirectoryMeta = JSON.parse(source);
    } catch (e) {
      if (e && e.code === "ENOENT") {
        previousOutDirectoryMeta = null;
      } else {
        throw e;
      }
    }

    if (previousOutDirectoryMeta !== null) {
      const previousMetaString = JSON.stringify(previousOutDirectoryMeta, null, "  ");
      const metaString = JSON.stringify(outDirectoryMeta, null, "  ");

      if (previousMetaString !== metaString) {
        if (!jsenvDirectoryClean) {
          logger.warn(`clean out directory at ${util.urlToFileSystemPath(outDirectoryUrl)}`);
        }

        await util.ensureEmptyDirectory(outDirectoryUrl);
      }
    }

    await util.writeFile(metaFileUrl, JSON.stringify(outDirectoryMeta, null, "  "));
  }
}; // eslint-disable-next-line valid-jsdoc

/**
 * We need to get two things:
 * { projectFileRequestedCallback, trackMainAndDependencies }
 *
 * projectFileRequestedCallback
 * This function will be called by the compile server every time a file inside projectDirectory
 * is requested so that we can build up the dependency tree of any file
 *
 * trackMainAndDependencies
 * This function is meant to be used to implement server sent events in order for a client to know
 * when a given file or any of its dependencies changes in order to implement livereloading.
 * At any time this function can be called with (mainRelativeUrl, { modified, removed, lastEventId })
 * modified is called
 *  - immediatly if lastEventId is passed and mainRelativeUrl or any of its dependencies have
 *  changed since that event (last change is passed to modified if their is more than one change)
 *  - when mainRelativeUrl or any of its dependencies is modified
 * removed is called
 *  - with same spec as modified but when a file is deleted from the filesystem instead of modified
 *
 */


const setupServerSentEventsForLivereload = ({
  cancellationToken,
  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl,
  outDirectoryRelativeUrl,
  livereloadLogLevel,
  livereloadWatchConfig
}) => {
  const livereloadLogger = logger.createLogger({
    logLevel: livereloadLogLevel
  });
  const trackerMap = new Map();
  const projectFileRequested = createCallbackList();
  const projectFileModified = createCallbackList();
  const projectFileRemoved = createCallbackList();
  const projectFileAdded = createCallbackList();

  const projectFileRequestedCallback = (relativeUrl, request) => {
    // I doubt an asset like .js.map will change
    // in theory a compilation asset should not change
    // if the source file did not change
    // so we can avoid watching compilation asset
    if (urlIsAsset(`${projectDirectoryUrl}${relativeUrl}`)) {
      return;
    }

    projectFileRequested.notify(relativeUrl, request);
  };

  const unregisterDirectoryLifecyle = util.registerDirectoryLifecycle(projectDirectoryUrl, {
    watchDescription: { ...livereloadWatchConfig,
      [jsenvDirectoryRelativeUrl]: false
    },
    updated: ({
      relativeUrl
    }) => {
      projectFileModified.notify(relativeUrl);
    },
    removed: ({
      relativeUrl
    }) => {
      projectFileRemoved.notify(relativeUrl);
    },
    added: ({
      relativeUrl
    }) => {
      projectFileAdded.notify(relativeUrl);
    },
    keepProcessAlive: false,
    recursive: true
  });
  cancellationToken.register(unregisterDirectoryLifecyle);

  const getDependencySet = mainRelativeUrl => {
    if (trackerMap.has(mainRelativeUrl)) {
      return trackerMap.get(mainRelativeUrl);
    }

    const dependencySet = new Set();
    dependencySet.add(mainRelativeUrl);
    trackerMap.set(mainRelativeUrl, dependencySet);
    return dependencySet;
  };
  /**
   the reason why sometimes livereloading does not happen:
   1. js file modified (state A)
  2. browser reloads
  3. browser request html file (dependency set becomes empty)
  4. browser request js file -> recognized as dependency
  5. js file modified (state B)
  6. client connects to livereload
   At this stage browser has loaded and executed js file on state A
  File was modified for state B before browser could connect to livereload
  state B is the current state but browser shows state A
   the correct fix for that would be to connect to livereload events before doing anything else
  but jsenv toolbar is injected as a script type module
  (it means the script is non blocking even if in head tag)
   moreover it loads an html page which loads the toolbar script
  all this is non blocking and delay the moment browser gets
  connected to event source
   several ideas:
   - put a blocking script tag in main page head to together with toolbar injection
    :( need yet an other script to inject in recente browsers using uncompiled files
   - make toolbar a regular script tag instead of module
    :( cannot hope for using type="module" in recent browsers
   - whenever browser request html page send a cookie to keep track of files until the browser
  connects to livereload
    :( hack, ugly
   - first line of toolbar should be to inject a regular script tag (or just connect to event source)
  while the toolbar script is loading we could still miss livereload events
  but that's only one file, should be very fast
     :) type module friendly
    :) no hack
    :( have to share the livereload connection logic between src/toolbar.js
    and src/internal/toolbar/toolbar.main.js
    But I could use a basic connection in src/toolbar.js with the most simple implem
    and keep the nice integration in toolbar later (and kill the connection from the main page)
    */
  // each time a file is requested for the first time its dependencySet is computed


  projectFileRequested.register(mainRelativeUrl => {
    // for now node use case of livereloading + node.js
    // and for browsers only html file can be main files
    // this avoid collecting dependencies of non html files that will never be used
    if (!mainRelativeUrl.endsWith(".html")) {
      return;
    } // when a file is requested, always rebuild its dependency in case it has changed
    // since the last time it was requested


    const dependencySet = new Set();
    dependencySet.add(mainRelativeUrl);
    trackerMap.set(mainRelativeUrl, dependencySet);
    const unregisterDependencyRequested = projectFileRequested.register((relativeUrl, request) => {
      if (dependencySet.has(relativeUrl)) {
        return;
      }

      const dependencyReport = reportDependency(relativeUrl, mainRelativeUrl, request);

      if (dependencyReport.dependency === false) {
        livereloadLogger.debug(`${relativeUrl} not a dependency of ${mainRelativeUrl} because ${dependencyReport.reason}`);
        return;
      }

      livereloadLogger.debug(`${relativeUrl} is a dependency of ${mainRelativeUrl} because ${dependencyReport.reason}`);
      dependencySet.add(relativeUrl);
    });
    const unregisterMainRemoved = projectFileRemoved.register(relativeUrl => {
      if (relativeUrl === mainRelativeUrl) {
        unregisterDependencyRequested();
        unregisterMainRemoved();
        trackerMap.delete(mainRelativeUrl);
      }
    });
  });

  const trackMainAndDependencies = (mainRelativeUrl, {
    modified,
    removed,
    added
  }) => {
    livereloadLogger.debug(`track ${mainRelativeUrl} and its dependencies`);
    const unregisterModified = projectFileModified.register(relativeUrl => {
      const dependencySet = getDependencySet(mainRelativeUrl);

      if (dependencySet.has(relativeUrl)) {
        modified(relativeUrl);
      }
    });
    const unregisterRemoved = projectFileRemoved.register(relativeUrl => {
      const dependencySet = getDependencySet(mainRelativeUrl);

      if (dependencySet.has(relativeUrl)) {
        removed(relativeUrl);
      }
    });
    const unregisterAdded = projectFileAdded.register(relativeUrl => {
      const dependencySet = getDependencySet(mainRelativeUrl);

      if (dependencySet.has(relativeUrl)) {
        added(relativeUrl);
      }
    });
    return () => {
      livereloadLogger.debug(`stop tracking ${mainRelativeUrl} and its dependencies.`);
      unregisterModified();
      unregisterRemoved();
      unregisterAdded();
    };
  };

  const reportDependency = (relativeUrl, mainRelativeUrl, request) => {
    if (relativeUrl === mainRelativeUrl) {
      return {
        dependency: true,
        reason: "it's main"
      };
    }

    if ("x-jsenv-execution-id" in request.headers) {
      const executionId = request.headers["x-jsenv-execution-id"];

      if (executionId === mainRelativeUrl) {
        return {
          dependency: true,
          reason: "x-jsenv-execution-id request header"
        };
      }

      return {
        dependency: false,
        reason: "x-jsenv-execution-id request header"
      };
    }

    if ("referer" in request.headers) {
      const {
        origin
      } = request;
      const {
        referer
      } = request.headers; // referer is likely the exploringServer

      if (referer !== origin && !util.urlIsInsideOf(referer, origin)) {
        return {
          dependency: false,
          reason: "referer is an other origin"
        };
      } // here we know the referer is inside compileServer


      const refererRelativeUrl = urlToOriginalRelativeUrl(referer, util.resolveUrl(outDirectoryRelativeUrl, request.origin));

      if (refererRelativeUrl) {
        // search if referer (file requesting this one) is tracked as being a dependency of main file
        // in that case because the importer is a dependency the importee is also a dependency
        // eslint-disable-next-line no-unused-vars
        for (const tracker of trackerMap) {
          if (tracker[0] === mainRelativeUrl && tracker[1].has(refererRelativeUrl)) {
            return {
              dependency: true,
              reason: "referer is a dependency"
            };
          }
        }
      }
    }

    return {
      dependency: true,
      reason: "it was requested"
    };
  };

  return {
    projectFileRequestedCallback,
    trackMainAndDependencies
  };
};

const createSSEForLivereloadService = ({
  cancellationToken,
  outDirectoryRelativeUrl,
  trackMainAndDependencies
}) => {
  const cache = [];
  const sseRoomLimit = 100;

  const getOrCreateSSERoom = mainFileRelativeUrl => {
    const cacheEntry = cache.find(cacheEntryCandidate => cacheEntryCandidate.mainFileRelativeUrl === mainFileRelativeUrl);

    if (cacheEntry) {
      return cacheEntry.sseRoom;
    }

    const sseRoom = server.createSSERoom({
      retryDuration: 2000,
      historyLength: 100,
      welcomeEvent: true
    }); // each time something is modified or removed we send event to the room

    const stopTracking = trackMainAndDependencies(mainFileRelativeUrl, {
      modified: relativeUrl => {
        sseRoom.sendEvent({
          type: "file-modified",
          data: relativeUrl
        });
      },
      removed: relativeUrl => {
        sseRoom.sendEvent({
          type: "file-removed",
          data: relativeUrl
        });
      },
      added: relativeUrl => {
        sseRoom.sendEvent({
          type: "file-added",
          data: relativeUrl
        });
      }
    });
    sseRoom.start();
    cancellationToken.register(() => {
      sseRoom.stop();
      stopTracking();
    });
    cache.push({
      mainFileRelativeUrl,
      sseRoom
    });

    if (cache.length >= sseRoomLimit) {
      cache.shift();
    }

    return sseRoom;
  };

  return request => {
    const {
      accept
    } = request.headers;

    if (!accept || !accept.includes("text/event-stream")) {
      return null;
    }

    const fileRelativeUrl = urlToOriginalRelativeUrl(util.resolveUrl(request.ressource, request.origin), util.resolveUrl(outDirectoryRelativeUrl, request.origin));
    const room = getOrCreateSSERoom(fileRelativeUrl);
    return room.connect(request.headers["last-event-id"] || new URL(request.ressource, request.origin).searchParams.get("last-event-id"));
  };
};

const urlToOriginalRelativeUrl = (url, outDirectoryRemoteUrl) => {
  if (util.urlIsInsideOf(url, outDirectoryRemoteUrl)) {
    const afterCompileDirectory = util.urlToRelativeUrl(url, outDirectoryRemoteUrl);
    const fileRelativeUrl = afterCompileDirectory.slice(afterCompileDirectory.indexOf("/") + 1);
    return fileRelativeUrl;
  }

  return new URL(url).pathname.slice(1);
};

const createAssetFileService = ({
  projectDirectoryUrl
}) => {
  return request => {
    const {
      origin,
      ressource,
      method,
      headers
    } = request;
    const requestUrl = `${origin}${ressource}`;

    if (urlIsAsset(requestUrl)) {
      return server.serveFile(util.resolveUrl(ressource.slice(1), projectDirectoryUrl), {
        method,
        headers
      });
    }

    return null;
  };
};

const createBrowserScriptService = ({
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  browserBundledJsFileRelativeUrl
}) => {
  const sourcemapMainFileRelativeUrl = util.urlToRelativeUrl(sourcemapMainFileUrl, projectDirectoryUrl);
  const sourcemapMappingFileRelativeUrl = util.urlToRelativeUrl(sourcemapMappingFileUrl, projectDirectoryUrl);
  return request => {
    if (request.method === "GET" && request.ressource === "/.jsenv/compile-meta.json" && "x-jsenv" in request.headers) {
      const body = JSON.stringify({
        outDirectoryRelativeUrl,
        errorStackRemapping: true,
        sourcemapMainFileRelativeUrl,
        sourcemapMappingFileRelativeUrl
      });
      return {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body)
        },
        body
      };
    }

    if (request.ressource === "/.jsenv/browser-script.js") {
      const browserBundledJsFileRemoteUrl = `${request.origin}/${browserBundledJsFileRelativeUrl}`;
      return {
        status: 307,
        headers: {
          location: browserBundledJsFileRemoteUrl
        }
      };
    }

    return null;
  };
};

const createProjectFileService = ({
  projectDirectoryUrl,
  projectFileRequestedCallback
}) => {
  return request => {
    const {
      ressource,
      method,
      headers
    } = request;
    const relativeUrl = ressource.slice(1);
    projectFileRequestedCallback(relativeUrl, request);
    const fileUrl = util.resolveUrl(relativeUrl, projectDirectoryUrl);
    const filePath = util.urlToFileSystemPath(fileUrl);
    const responsePromise = server.serveFile(filePath, {
      method,
      headers
    });
    return responsePromise;
  };
};

const installOutFiles = async (compileServer, {
  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl,
  outDirectoryRelativeUrl,
  importDefaultExtension,
  importMapFileRelativeUrl,
  compileServerImportMap,
  compileServerGroupMap,
  env,
  writeOnFilesystem
}) => {
  const outDirectoryUrl = util.resolveUrl(outDirectoryRelativeUrl, projectDirectoryUrl);
  env = { ...env,
    jsenvDirectoryRelativeUrl,
    outDirectoryRelativeUrl,
    importDefaultExtension,
    importMapFileRelativeUrl
  };

  const importMapToString = () => JSON.stringify(compileServerImportMap, null, "  ");

  const groupMapToString = () => JSON.stringify(compileServerGroupMap, null, "  ");

  const envToString = () => JSON.stringify(env, null, "  ");

  const groupMapOutFileUrl = util.resolveUrl("./groupMap.json", outDirectoryUrl);
  const envOutFileUrl = util.resolveUrl("./env.json", outDirectoryUrl);
  const importmapFiles = Object.keys(compileServerGroupMap).map(compileId => {
    return util.resolveUrl(importMapFileRelativeUrl, `${outDirectoryUrl}${compileId}/`);
  });
  await Promise.all([util.writeFile(groupMapOutFileUrl, groupMapToString()), util.writeFile(envOutFileUrl, envToString()), ...importmapFiles.map(importmapFile => util.writeFile(importmapFile, importMapToString()))]);

  if (!writeOnFilesystem) {
    compileServer.stoppedPromise.then(() => {
      importmapFiles.forEach(importmapFile => {
        util.removeFileSystemNode(importmapFile, {
          allowUseless: true
        });
      });
      util.removeFileSystemNode(groupMapOutFileUrl, {
        allowUseless: true
      });
      util.removeFileSystemNode(envOutFileUrl);
    });
  }
};

const installStopOnPackageVersionChange = (compileServer, {
  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl
}) => {
  const jsenvCoreDirectoryUrl = util.resolveUrl(jsenvDirectoryRelativeUrl, projectDirectoryUrl);
  const packageFileUrl = util.resolveUrl("./package.json", jsenvCoreDirectoryUrl);
  const packageFilePath = util.urlToFileSystemPath(packageFileUrl);
  let packageVersion;

  try {
    packageVersion = readPackage(packageFilePath).version;
  } catch (e) {
    if (e.code === "ENOENT") return;
  }

  const checkPackageVersion = () => {
    let packageObject;

    try {
      packageObject = readPackage(packageFilePath);
    } catch (e) {
      // package json deleted ? not a problem
      // let's wait for it to show back
      if (e.code === "ENOENT") return; // package.json malformed ? not a problem
      // let's wait for use to fix it or filesystem to finish writing the file

      if (e.name === "SyntaxError") return;
      throw e;
    }

    if (packageVersion !== packageObject.version) {
      compileServer.stop(STOP_REASON_PACKAGE_VERSION_CHANGED);
    }
  };

  const unregister = util.registerFileLifecycle(packageFilePath, {
    added: checkPackageVersion,
    updated: checkPackageVersion,
    keepProcessAlive: false
  });
  compileServer.stoppedPromise.then(() => {
    unregister();
  }, () => {});
};

const readPackage = packagePath => {
  const buffer = fs.readFileSync(packagePath);
  const string = String(buffer);
  const packageObject = JSON.parse(string);
  return packageObject;
};

const STOP_REASON_PACKAGE_VERSION_CHANGED = {
  toString: () => `package version changed`
};
const __filenameReplacement$2 = `import.meta.url.slice('file:///'.length)`;
const __dirnameReplacement$2 = `import.meta.url.slice('file:///'.length).replace(/[\\\/\\\\][^\\\/\\\\]*$/, '')`;

const {
  createFileCoverage
} = require$1("istanbul-lib-coverage"); // https://github.com/istanbuljs/istanbuljs/blob/5405550c3868712b14fd8bfe0cbd6f2e7ac42279/packages/istanbul-lib-coverage/lib/coverage-map.js#L43


const composeCoverageMap = (...coverageMaps) => {
  const finalCoverageMap = {};
  coverageMaps.forEach(coverageMap => {
    Object.keys(coverageMap).forEach(filename => {
      const coverage = coverageMap[filename];
      finalCoverageMap[filename] = filename in finalCoverageMap ? merge(finalCoverageMap[filename], coverage) : coverage;
    });
  });
  return finalCoverageMap;
};

const merge = (coverageA, coverageB) => {
  const fileCoverage = createFileCoverage(coverageA);
  fileCoverage.merge(coverageB);
  return fileCoverage.toJSON();
};

const TIMING_BEFORE_EXECUTION = "before-execution";
const TIMING_DURING_EXECUTION = "during-execution";
const TIMING_AFTER_EXECUTION = "after-execution";
const launchAndExecute = async ({
  cancellationToken = cancellation.createCancellationToken(),
  executionLogLevel,
  fileRelativeUrl,
  launch,
  // stopAfterExecute false by default because you want to keep browser alive
  // or nodejs process
  // however unit test will pass true because they want to move on
  stopAfterExecute = false,
  stopAfterExecuteReason = "stop after execute",
  // when launch returns { disconnected, gracefulStop, stop }
  // the launched runtime have that amount of ms for disconnected to resolve
  // before we call stop
  gracefulStopAllocatedMs = 4000,
  runtimeConsoleCallback = () => {},
  runtimeStartedCallback = () => {},
  runtimeStoppedCallback = () => {},
  runtimeErrorCallback = () => {},
  runtimeDisconnectCallback = () => {},
  measureDuration = false,
  mirrorConsole = false,
  captureConsole = false,
  // rename collectConsole ?
  collectRuntimeName = false,
  collectRuntimeVersion = false,
  inheritCoverage = false,
  collectCoverage = false,
  ...rest
} = {}) => {
  const logger$1 = logger.createLogger({
    logLevel: executionLogLevel
  });

  if (typeof fileRelativeUrl !== "string") {
    throw new TypeError(`fileRelativeUrl must be a string, got ${fileRelativeUrl}`);
  }

  if (typeof launch !== "function") {
    throw new TypeError(`launch launch must be a function, got ${launch}`);
  }

  let executionResultTransformer = executionResult => executionResult;

  if (measureDuration) {
    const startMs = Date.now();
    executionResultTransformer = composeTransformer(executionResultTransformer, executionResult => {
      const endMs = Date.now();
      executionResult.startMs = startMs;
      executionResult.endMs = endMs;
      return executionResult;
    });
  }

  if (mirrorConsole) {
    runtimeConsoleCallback = composeCallback(runtimeConsoleCallback, ({
      type,
      text
    }) => {
      if (type === "error") {
        process.stderr.write(text);
      } else {
        process.stdout.write(text);
      }
    });
  }

  if (captureConsole) {
    const consoleCalls = [];
    runtimeConsoleCallback = composeCallback(runtimeConsoleCallback, ({
      type,
      text
    }) => {
      consoleCalls.push({
        type,
        text
      });
    });
    executionResultTransformer = composeTransformer(executionResultTransformer, executionResult => {
      executionResult.consoleCalls = consoleCalls;
      return executionResult;
    });
  }

  if (collectRuntimeName) {
    runtimeStartedCallback = composeCallback(runtimeStartedCallback, ({
      name
    }) => {
      executionResultTransformer = composeTransformer(executionResultTransformer, executionResult => {
        executionResult.runtimeName = name;
        return executionResult;
      });
    });
  }

  if (collectRuntimeVersion) {
    runtimeStartedCallback = composeCallback(runtimeStartedCallback, ({
      version
    }) => {
      executionResultTransformer = composeTransformer(executionResultTransformer, executionResult => {
        executionResult.runtimeVersion = version;
        return executionResult;
      });
    });
  }

  if (inheritCoverage) {
    const collectCoverageSaved = collectCoverage;
    collectCoverage = true;
    executionResultTransformer = composeTransformer(executionResultTransformer, executionResult => {
      const {
        coverageMap,
        ...rest
      } = executionResult; // ensure the coverage of the executed file is taken into account

      global.__coverage__ = composeCoverageMap(global.__coverage__ || {}, coverageMap || {});

      if (collectCoverageSaved) {
        return executionResult;
      }

      if (fileRelativeUrl.endsWith(".html") && rest.namespace) {
        Object.keys(rest.namespace).forEach(file => {
          delete rest.namespace[file].coverageMap;
        });
      }

      return rest;
    });
  }

  const executionResult = await computeRawExecutionResult({
    cancellationToken,
    logger: logger$1,
    fileRelativeUrl,
    launch,
    stopAfterExecute,
    stopAfterExecuteReason,
    gracefulStopAllocatedMs,
    runtimeConsoleCallback,
    runtimeErrorCallback,
    runtimeDisconnectCallback,
    runtimeStartedCallback,
    runtimeStoppedCallback,
    collectCoverage,
    ...rest
  });
  return executionResultTransformer(executionResult);
};

const composeCallback = (previousCallback, callback) => {
  return (...args) => {
    previousCallback(...args);
    return callback(...args);
  };
};

const composeTransformer = (previousTransformer, transformer) => {
  return value => {
    const transformedValue = previousTransformer(value);
    return transformer(transformedValue);
  };
};

const computeRawExecutionResult = async ({
  cancellationToken,
  allocatedMs,
  ...rest
}) => {
  const hasAllocatedMs = typeof allocatedMs === "number" && allocatedMs !== Infinity;

  if (!hasAllocatedMs) {
    return computeExecutionResult({
      cancellationToken,
      ...rest
    });
  } // here if allocatedMs is very big
  // setTimeout may be called immediatly
  // in that case we should just throw that hte number is too big


  const TIMEOUT_CANCEL_REASON = "timeout";
  const id = setTimeout(() => {
    timeoutCancellationSource.cancel(TIMEOUT_CANCEL_REASON);
  }, allocatedMs);

  const timeoutCancel = () => clearTimeout(id);

  cancellationToken.register(timeoutCancel);
  const timeoutCancellationSource = cancellation.createCancellationSource();
  const externalOrTimeoutCancellationToken = cancellation.composeCancellationToken(cancellationToken, timeoutCancellationSource.token);

  try {
    const executionResult = await computeExecutionResult({
      cancellationToken: externalOrTimeoutCancellationToken,
      ...rest
    });
    timeoutCancel();
    return executionResult;
  } catch (e) {
    if (cancellation.errorToCancelReason(e) === TIMEOUT_CANCEL_REASON) {
      return createTimedoutExecutionResult();
    }

    throw e;
  }
};

const computeExecutionResult = async ({
  cancellationToken,
  logger,
  fileRelativeUrl,
  launch,
  stopAfterExecute,
  stopAfterExecuteReason,
  gracefulStopAllocatedMs,
  runtimeStartedCallback,
  runtimeStoppedCallback,
  runtimeConsoleCallback,
  runtimeErrorCallback,
  runtimeDisconnectCallback,
  ...rest
}) => {
  logger.debug(`launch runtime environment for ${fileRelativeUrl}`);
  const launchOperation = cancellation.createStoppableOperation({
    cancellationToken,
    start: async () => {
      const value = await launch({
        cancellationToken,
        logger,
        ...rest
      });
      runtimeStartedCallback({
        name: value.name,
        version: value.version
      });
      return value;
    },
    stop: async ({
      name: runtimeName,
      version: runtimeVersion,
      gracefulStop,
      stop
    }, reason) => {
      const runtime = `${runtimeName}/${runtimeVersion}`; // external code can cancel using cancellationToken at any time.
      // it is important to keep the code inside this stop function because once cancelled
      // all code after the operation won't execute because it will be rejected with
      // the cancellation error

      let stoppedGracefully;

      if (gracefulStop && gracefulStopAllocatedMs) {
        logger.debug(`${fileRelativeUrl} ${runtime}: runtime.gracefulStop() because ${reason}`);

        const gracefulStopPromise = (async () => {
          await gracefulStop({
            reason
          });
          return true;
        })();

        const stopPromise = (async () => {
          stoppedGracefully = await new Promise(async resolve => {
            const timeoutId = setTimeout(() => {
              resolve(false);
            }, gracefulStopAllocatedMs);

            try {
              await gracefulStopPromise;
              resolve(true);
            } finally {
              clearTimeout(timeoutId);
            }
          });

          if (stoppedGracefully) {
            return stoppedGracefully;
          }

          logger.debug(`${fileRelativeUrl} ${runtime}: runtime.stop() because gracefulStop still pending after ${gracefulStopAllocatedMs}ms`);
          await stop({
            reason,
            gracefulFailed: true
          });
          return false;
        })();

        stoppedGracefully = await Promise.race([gracefulStopPromise, stopPromise]);
      } else {
        await stop({
          reason,
          gracefulFailed: false
        });
        stoppedGracefully = false;
      }

      logger.debug(`${fileRelativeUrl} ${runtime}: runtime stopped${stoppedGracefully ? " gracefully" : ""}`);
      runtimeStoppedCallback({
        stoppedGracefully
      });
    }
  });
  const {
    name: runtimeName,
    version: runtimeVersion,
    options,
    executeFile,
    registerErrorCallback,
    registerConsoleCallback,
    disconnected
  } = await launchOperation;
  const runtime = `${runtimeName}/${runtimeVersion}`;
  logger.debug(`${fileRelativeUrl} ${runtime}: runtime launched.
--- options ---
options: ${JSON.stringify(options, null, "  ")}`);
  logger.debug(`${fileRelativeUrl} ${runtime}: start file execution.`);
  registerConsoleCallback(runtimeConsoleCallback);
  const executeOperation = cancellation.createOperation({
    cancellationToken,
    start: async () => {
      let timing = TIMING_BEFORE_EXECUTION;
      disconnected.then(() => {
        logger.debug(`${fileRelativeUrl} ${runtime}: runtime disconnected ${timing}.`);
        runtimeDisconnectCallback({
          timing
        });
      });
      const executed = executeFile(fileRelativeUrl, rest);
      timing = TIMING_DURING_EXECUTION;
      registerErrorCallback(error => {
        logger.error(`${fileRelativeUrl} ${runtime}: error ${timing}.
--- error stack ---
${error.stack}`);
        runtimeErrorCallback({
          error,
          timing
        });
      });
      const raceResult = await promiseTrackRace([disconnected, executed]);
      timing = TIMING_AFTER_EXECUTION;

      if (raceResult.winner === disconnected) {
        return createDisconnectedExecutionResult();
      }

      if (stopAfterExecute) {
        launchOperation.stop(stopAfterExecuteReason);
      }

      const executionResult = raceResult.value;
      const {
        status
      } = executionResult;

      if (status === "errored") {
        // debug log level because this error happens during execution
        // there is no need to log it.
        // the code will know the execution errored because it receives
        // an errored execution result
        logger.debug(`${fileRelativeUrl} ${runtime}: error ${TIMING_DURING_EXECUTION}.
--- error stack ---
${executionResult.error.stack}`);
        return createErroredExecutionResult(executionResult, rest);
      }

      logger.debug(`${fileRelativeUrl} ${runtime}: execution completed.`);
      return createCompletedExecutionResult(executionResult, rest);
    }
  });
  const executionResult = await executeOperation;
  return executionResult;
};

const createTimedoutExecutionResult = () => {
  return {
    status: "timedout"
  };
};

const createDisconnectedExecutionResult = () => {
  return {
    status: "disconnected"
  };
};

const createErroredExecutionResult = ({
  error,
  coverageMap
}, {
  collectCoverage
}) => {
  return {
    status: "errored",
    error,
    ...(collectCoverage ? {
      coverageMap
    } : {})
  };
};

const createCompletedExecutionResult = ({
  namespace,
  coverageMap
}, {
  collectCoverage
}) => {
  return {
    status: "completed",
    namespace: normalizeNamespace(namespace),
    ...(collectCoverage ? {
      coverageMap
    } : {})
  };
};

const normalizeNamespace = namespace => {
  if (typeof namespace !== "object") return namespace;
  if (namespace instanceof Promise) return namespace;
  const normalized = {}; // remove "__esModule" or Symbol.toStringTag from namespace object

  Object.keys(namespace).forEach(key => {
    normalized[key] = namespace[key];
  });
  return normalized;
};

const promiseTrackRace = promiseArray => {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const visit = index => {
      const promise = promiseArray[index];
      promise.then(value => {
        if (resolved) return;
        resolved = true;
        resolve({
          winner: promise,
          value,
          index
        });
      }, reject);
    };

    let i = 0;

    while (i < promiseArray.length) {
      visit(i++);
    }
  });
};

const execute = async ({
  cancellationToken = util.createCancellationTokenForProcess(),
  logLevel = "warn",
  compileServerLogLevel = logLevel,
  executionLogLevel = logLevel,
  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl,
  jsenvDirectoryClean,
  importMapFileRelativeUrl,
  importDefaultExtension,
  fileRelativeUrl,
  compileServerProtocol,
  compileServerPrivateKey,
  compileServerCertificate,
  compileServerIp,
  compileServerPort,
  babelPluginMap,
  convertMap,
  compileGroupCount = 2,
  launch,
  mirrorConsole = true,
  stopAfterExecute = false,
  gracefulStopAllocatedMs,
  ignoreError = false,
  ...rest
}) => {
  const executionPromise = wrapExternalFunctionExecution(async () => {
    projectDirectoryUrl = assertProjectDirectoryUrl({
      projectDirectoryUrl
    });
    await assertProjectDirectoryExists({
      projectDirectoryUrl
    });

    if (typeof fileRelativeUrl !== "string") {
      throw new TypeError(`fileRelativeUrl must be a string, got ${fileRelativeUrl}`);
    }

    fileRelativeUrl = fileRelativeUrl.replace(/\\/g, "/");

    if (typeof launch !== "function") {
      throw new TypeError(`launch must be a function, got ${launch}`);
    }

    const {
      outDirectoryRelativeUrl,
      origin: compileServerOrigin,
      stop
    } = await startCompileServer({
      cancellationToken,
      compileServerLogLevel,
      projectDirectoryUrl,
      jsenvDirectoryRelativeUrl,
      jsenvDirectoryClean,
      importMapFileRelativeUrl,
      importDefaultExtension,
      compileServerProtocol,
      compileServerPrivateKey,
      compileServerCertificate,
      compileServerIp,
      compileServerPort,
      babelPluginMap,
      convertMap,
      compileGroupCount,
      browserInternalFileAnticipation: fileRelativeUrl.endsWith(".html"),
      nodeInternalFileAnticipation: fileRelativeUrl.endsWith(".js") || fileRelativeUrl.endsWith(".jsx") || fileRelativeUrl.endsWith(".ts")
    });
    const result = await launchAndExecute({
      cancellationToken,
      executionLogLevel,
      fileRelativeUrl,
      launch: params => launch({
        projectDirectoryUrl,
        outDirectoryRelativeUrl,
        compileServerOrigin,
        ...params
      }),
      mirrorConsole,
      stopAfterExecute,
      gracefulStopAllocatedMs,
      ...rest
    });
    stop("single-execution-done");
    return result;
  });

  if (ignoreError) {
    return executionPromise;
  }

  const result = await executionPromise;

  if (result.status === "errored") {
    /*
    Warning: when node launched with --unhandled-rejections=strict, despites
    this promise being rejected by throw result.error node will compltely ignore it.
     The error can be logged by doing
    ```js
    process.setUncaughtExceptionCaptureCallback((error) => {
      console.error(error.stack)
    })
    ```
    But it feels like a hack.
    */
    throw result.error;
  }

  return result;
};

const {
  programVisitor
} = require$1("istanbul-lib-instrument"); // https://github.com/istanbuljs/babel-plugin-istanbul/blob/321740f7b25d803f881466ea819d870f7ed6a254/src/index.js


const babelPluginInstrument = (api, options) => {
  const {
    types
  } = api;
  const {
    useInlineSourceMaps = false,
    projectDirectoryUrl,
    coverageConfig = {
      "./**/*": true
    }
  } = options;
  const specifierMetaMapForCover = util.normalizeSpecifierMetaMap(util.metaMapToSpecifierMetaMap({
    cover: coverageConfig
  }), projectDirectoryUrl);

  const shouldInstrument = relativeUrl => {
    return util.urlToMeta({
      url: util.resolveUrl(relativeUrl, projectDirectoryUrl),
      specifierMetaMap: specifierMetaMapForCover
    }).cover;
  };

  return {
    name: "transform-instrument",
    visitor: {
      Program: {
        enter(path) {
          const {
            file
          } = this;
          const {
            opts
          } = file;
          const relativeUrl = optionsToRelativeUrl(opts);

          if (!relativeUrl) {
            console.warn("file without relativeUrl", relativeUrl);
            return;
          }

          if (!shouldInstrument(relativeUrl)) return;
          this.__dv__ = null;
          let inputSourceMap;

          if (useInlineSourceMaps) {
            // https://github.com/istanbuljs/babel-plugin-istanbul/commit/a9e15643d249a2985e4387e4308022053b2cd0ad#diff-1fdf421c05c1140f6d71444ea2b27638R65
            inputSourceMap = opts.inputSourceMap || file.inputMap ? file.inputMap.sourcemap : null;
          } else {
            inputSourceMap = opts.inputSourceMap;
          }

          this.__dv__ = programVisitor(types, opts.filenameRelative || opts.filename, {
            coverageVariable: "__coverage__",
            inputSourceMap
          });

          this.__dv__.enter(path);
        },

        exit(path) {
          if (!this.__dv__) {
            return;
          }

          const object = this.__dv__.exit(path); // object got two properties: fileCoverage and sourceMappingURL


          this.file.metadata.coverage = object.fileCoverage;
        }

      }
    }
  };
};

const optionsToRelativeUrl = ({
  filenameRelative
}) => {
  if (filenameRelative) return filenameRelative;
  return "";
};

const generateFileExecutionSteps = ({
  fileRelativeUrl,
  filePlan
}) => {
  const fileExecutionSteps = [];
  Object.keys(filePlan).forEach(name => {
    const stepConfig = filePlan[name];

    if (stepConfig === null || stepConfig === undefined) {
      return;
    }

    if (typeof stepConfig !== "object") {
      throw new TypeError(`found unexpected value in plan, they must be object.
--- file relative path ---
${fileRelativeUrl}
--- name ---
${name}
--- value ---
${stepConfig}`);
    }

    fileExecutionSteps.push({
      name,
      fileRelativeUrl,
      ...stepConfig
    });
  });
  return fileExecutionSteps;
};

const generateExecutionSteps = async (plan, {
  cancellationToken,
  projectDirectoryUrl
}) => {
  const specifierMetaMap = util.metaMapToSpecifierMetaMap({
    filePlan: plan
  });
  const fileResultArray = await util.collectFiles({
    cancellationToken,
    directoryUrl: projectDirectoryUrl,
    specifierMetaMap,
    predicate: ({
      filePlan
    }) => filePlan
  });
  const executionSteps = [];
  fileResultArray.forEach(({
    relativeUrl,
    meta
  }) => {
    const fileExecutionSteps = generateFileExecutionSteps({
      fileRelativeUrl: relativeUrl,
      filePlan: meta.filePlan
    });
    executionSteps.push(...fileExecutionSteps);
  });
  return executionSteps;
};

const {
  createFileCoverage: createFileCoverage$1
} = require$1("istanbul-lib-coverage");

const createEmptyCoverage = relativeUrl => createFileCoverage$1(relativeUrl).toJSON();

const {
  transformAsync: transformAsync$1
} = require$1("@babel/core");

const relativeUrlToEmptyCoverage = async (relativeUrl, {
  cancellationToken,
  projectDirectoryUrl,
  babelPluginMap
}) => {
  const fileUrl = util.resolveUrl(relativeUrl, projectDirectoryUrl);
  const source = await cancellation.createOperation({
    cancellationToken,
    start: () => util.readFile(fileUrl)
  });
  const plugins = [...minimalBabelPluginArray];
  Object.keys(babelPluginMap).forEach(babelPluginName => {
    if (babelPluginName !== "transform-instrument") {
      plugins.push(babelPluginMap[babelPluginName]);
    }
  });
  plugins.push([babelPluginInstrument, {
    projectDirectoryUrl
  }]);

  try {
    const {
      metadata
    } = await cancellation.createOperation({
      cancellationToken,
      start: () => transformAsync$1(source, {
        filename: util.urlToFileSystemPath(fileUrl),
        filenameRelative: relativeUrl,
        configFile: false,
        babelrc: false,
        parserOpts: {
          allowAwaitOutsideFunction: true
        },
        plugins
      })
    });
    const {
      coverage
    } = metadata;

    if (!coverage) {
      throw new Error(`missing coverage for file`);
    } // https://github.com/gotwarlost/istanbul/blob/bc84c315271a5dd4d39bcefc5925cfb61a3d174a/lib/command/common/run-with-cover.js#L229


    Object.keys(coverage.s).forEach(function (key) {
      coverage.s[key] = 0;
    });
    return coverage;
  } catch (e) {
    if (e && e.code === "BABEL_PARSE_ERROR") {
      // return an empty coverage for that file when
      // it contains a syntax error
      return createEmptyCoverage(relativeUrl);
    }

    throw e;
  }
};

const ensureRelativePathsInCoverage = coverageMap => {
  const coverageMapRelative = {};
  Object.keys(coverageMap).forEach(key => {
    const coverageForFile = coverageMap[key];
    coverageMapRelative[key] = coverageForFile.path.startsWith("./") ? coverageForFile : { ...coverageForFile,
      path: `./${coverageForFile.path}`
    };
  });
  return coverageMapRelative;
};

const reportToCoverageMap = async (report, {
  cancellationToken,
  projectDirectoryUrl,
  babelPluginMap,
  coverageConfig,
  coverageIncludeMissing
}) => {
  const coverageMapForReport = executionReportToCoverageMap(report);

  if (!coverageIncludeMissing) {
    return ensureRelativePathsInCoverage(coverageMapForReport);
  }

  const relativeFileUrlToCoverArray = await listRelativeFileUrlToCover({
    cancellationToken,
    projectDirectoryUrl,
    coverageConfig
  });
  const relativeFileUrlMissingCoverageArray = relativeFileUrlToCoverArray.filter(relativeFileUrlToCover => relativeFileUrlToCover in coverageMapForReport === false);
  const coverageMapForMissedFiles = {};
  await Promise.all(relativeFileUrlMissingCoverageArray.map(async relativeFileUrlMissingCoverage => {
    const emptyCoverage = await relativeUrlToEmptyCoverage(relativeFileUrlMissingCoverage, {
      cancellationToken,
      projectDirectoryUrl,
      babelPluginMap
    });
    coverageMapForMissedFiles[relativeFileUrlMissingCoverage] = emptyCoverage;
    return emptyCoverage;
  }));
  return ensureRelativePathsInCoverage({ ...coverageMapForReport,
    ...coverageMapForMissedFiles
  });
};

const listRelativeFileUrlToCover = async ({
  cancellationToken,
  projectDirectoryUrl,
  coverageConfig
}) => {
  const specifierMetaMapForCoverage = util.metaMapToSpecifierMetaMap({
    cover: coverageConfig
  });
  const matchingFileResultArray = await util.collectFiles({
    cancellationToken,
    directoryUrl: projectDirectoryUrl,
    specifierMetaMap: specifierMetaMapForCoverage,
    predicate: ({
      cover
    }) => cover
  });
  return matchingFileResultArray.map(({
    relativeUrl
  }) => relativeUrl);
};

const executionReportToCoverageMap = report => {
  const coverageMapArray = [];
  Object.keys(report).forEach(file => {
    const executionResultForFile = report[file];
    Object.keys(executionResultForFile).forEach(executionName => {
      const executionResultForFileOnRuntime = executionResultForFile[executionName];
      const {
        coverageMap
      } = executionResultForFileOnRuntime;

      if (!coverageMap) {
        // several reasons not to have coverageMap here:
        // 1. the file we executed did not import an instrumented file.
        // - a test file without import
        // - a test file importing only file excluded from coverage
        // - a coverDescription badly configured so that we don't realize
        // a file should be covered
        // 2. the file we wanted to executed timedout
        // - infinite loop
        // - too extensive operation
        // - a badly configured or too low allocatedMs for that execution.
        // 3. the file we wanted to execute contains syntax-error
        // in any scenario we are fine because
        // coverDescription will generate empty coverage for files
        // that were suppose to be coverage but were not.
        return;
      }

      coverageMapArray.push(coverageMap);
    });
  });
  const executionCoverageMap = composeCoverageMap(...coverageMapArray);
  return executionCoverageMap;
};

const stringWidth = require$1("string-width");

const writeLog = (string, {
  stream = process.stdout
} = {}) => {
  string = `${string}
`;
  stream.write(string);
  const consoleModified = spyConsoleModification();

  const moveCursorToLineAbove = () => {
    readline.moveCursor(stream, 0, -1);
  };

  const clearCursorLine = () => {
    readline.clearLine(stream, 0);
  };

  const remove = util.memoize(() => {
    const {
      columns = 80,
      rows = 24
    } = stream;
    const logLines = string.split(/\r\n|\r|\n/);
    let visualLineCount = 0;
    logLines.forEach(logLine => {
      const width = stringWidth(logLine);
      visualLineCount += width === 0 ? 1 : Math.ceil(width / columns);
    });

    if (visualLineCount > rows) {
      // the whole log cannot be cleared because it's vertically to long
      // (longer than terminal height)
      // readline.moveCursor cannot move cursor higher than screen height
      // it means we would only clear the visible part of the log
      // better keep the log untouched
      return;
    }

    while (visualLineCount--) {
      clearCursorLine();

      if (visualLineCount > 0) {
        moveCursorToLineAbove();
      }
    } // an other version of the while above could the code below
    // readline.moveCursor(stream, 0, -visualLineCount)
    // readline.clearScreenDown(stream)

  });
  let updated = false;

  const update = newString => {
    if (updated) {
      throw new Error(`cannot update twice`);
    }

    updated = true;

    if (!consoleModified()) {
      remove();
    }

    return writeLog(newString, {
      stream
    });
  };

  return {
    remove,
    update
  };
}; // maybe https://github.com/gajus/output-interceptor/tree/v3.0.0 ?
// the problem with listening data on stdout
// is that node.js will later throw error if stream gets closed
// while something listening data on it

const spyConsoleModification = () => {
  const {
    stdout,
    stderr
  } = process;
  const originalStdoutWrite = stdout.write;
  const originalStdErrWrite = stderr.write;
  let modified = false;

  stdout.write = (chunk, encoding, callback) => {
    modified = true;
    return originalStdoutWrite.call(stdout, chunk, encoding, callback);
  };

  stderr.write = (chunk, encoding, callback) => {
    modified = true;
    return originalStdErrWrite.call(stderr, chunk, encoding, callback);
  };

  const uninstall = () => {
    stdout.write = originalStdoutWrite;
    stderr.write = originalStdErrWrite;
  };

  return () => {
    uninstall();
    return modified;
  };
};

const cross = "☓"; // "\u2613"

const checkmark = "✔"; // "\u2714"

const yellow = "\x1b[33m";
const magenta = "\x1b[35m";
const red = "\x1b[31m";
const green = "\x1b[32m";
const grey = "\x1b[39m";
const ansiResetSequence = "\x1b[0m";

const humanizeDuration = require$1("humanize-duration");

const formatDuration = duration => {
  return humanizeDuration(duration, {
    largest: 2,
    maxDecimalPoints: 2
  });
};

const createSummaryLog = summary => `
-------------- summary -----------------
${createSummaryMessage(summary)}${createTotalDurationMessage(summary)}
----------------------------------------
`;

const createSummaryMessage = ({
  executionCount,
  disconnectedCount,
  timedoutCount,
  erroredCount,
  completedCount
}) => {
  if (executionCount === 0) return `0 execution.`;
  return `${executionCount} execution: ${createSummaryDetails({
    executionCount,
    disconnectedCount,
    timedoutCount,
    erroredCount,
    completedCount
  })}.`;
};

const createSummaryDetails = ({
  executionCount,
  disconnectedCount,
  timedoutCount,
  erroredCount,
  completedCount
}) => {
  if (disconnectedCount === executionCount) {
    return createAllDisconnectedDetails();
  }

  if (timedoutCount === executionCount) {
    return createAllTimedoutDetails();
  }

  if (erroredCount === executionCount) {
    return createAllErroredDetails();
  }

  if (completedCount === executionCount) {
    return createAllCompletedDetails();
  }

  return createMixedDetails({
    executionCount,
    disconnectedCount,
    timedoutCount,
    erroredCount,
    completedCount
  });
};

const createAllDisconnectedDetails = () => `all ${magenta}disconnected${ansiResetSequence}`;

const createAllTimedoutDetails = () => `all ${yellow}timedout${ansiResetSequence}`;

const createAllErroredDetails = () => `all ${red}errored${ansiResetSequence}`;

const createAllCompletedDetails = () => `all ${green}completed${ansiResetSequence}`;

const createMixedDetails = ({
  disconnectedCount,
  timedoutCount,
  erroredCount,
  completedCount
}) => {
  const parts = [];

  if (disconnectedCount) {
    parts.push(`${disconnectedCount} ${magenta}disconnected${ansiResetSequence}`);
  }

  if (timedoutCount) {
    parts.push(`${timedoutCount} ${yellow}timed out${ansiResetSequence}`);
  }

  if (erroredCount) {
    parts.push(`${erroredCount} ${red}errored${ansiResetSequence}`);
  }

  if (completedCount) {
    parts.push(`${completedCount} ${green}completed${ansiResetSequence}`);
  }

  return `${parts.join(", ")}`;
};

const createTotalDurationMessage = ({
  startMs,
  endMs
}) => {
  if (!endMs) return "";
  return `
total duration: ${formatDuration(endMs - startMs)}`;
};

const createExecutionResultLog = ({
  status,
  fileRelativeUrl,
  allocatedMs,
  runtimeName,
  runtimeVersion,
  consoleCalls,
  startMs,
  endMs,
  error,
  executionIndex
}, {
  completedExecutionLogAbbreviation,
  executionCount,
  disconnectedCount,
  timedoutCount,
  erroredCount,
  completedCount
}) => {
  const executionNumber = executionIndex + 1;
  const summary = `(${createSummaryDetails({
    executionCount: executionNumber,
    disconnectedCount,
    timedoutCount,
    erroredCount,
    completedCount
  })})`;
  const runtime = `${runtimeName}/${runtimeVersion}`;

  if (status === "completed") {
    if (completedExecutionLogAbbreviation) {
      return `
${green}${checkmark} execution ${executionNumber} of ${executionCount} completed${ansiResetSequence} ${summary}.`;
    }

    return `
${green}${checkmark} execution ${executionNumber} of ${executionCount} completed${ansiResetSequence} ${summary}.
file: ${fileRelativeUrl}
runtime: ${runtime}${appendDuration({
      startMs,
      endMs
    })}${appendConsole(consoleCalls)}${appendError(error)}`;
  }

  if (status === "disconnected") {
    return `
${magenta}${cross} execution ${executionNumber} of ${executionCount} disconnected${ansiResetSequence} ${summary}.
file: ${fileRelativeUrl}
runtime: ${runtime}${appendDuration({
      startMs,
      endMs
    })}${appendConsole(consoleCalls)}${appendError(error)}`;
  }

  if (status === "timedout") {
    return `
${yellow}${cross} execution ${executionNumber} of ${executionCount} timeout after ${allocatedMs}ms${ansiResetSequence} ${summary}.
file: ${fileRelativeUrl}
runtime: ${runtime}${appendDuration({
      startMs,
      endMs
    })}${appendConsole(consoleCalls)}${appendError(error)}`;
  }

  return `
${red}${cross} execution ${executionNumber} of ${executionCount} error${ansiResetSequence} ${summary}.
file: ${fileRelativeUrl}
runtime: ${runtime}${appendDuration({
    startMs,
    endMs
  })}${appendConsole(consoleCalls)}${appendError(error)}`;
};

const appendDuration = ({
  endMs,
  startMs
}) => {
  if (!endMs) return "";
  return `
duration: ${formatDuration(endMs - startMs)}`;
};

const appendConsole = consoleCalls => {
  if (!consoleCalls || consoleCalls.length === 0) return "";
  const consoleOutput = consoleCalls.reduce((previous, {
    text
  }) => {
    return `${previous}${text}`;
  }, "");
  const consoleOutputTrimmed = consoleOutput.trim();
  if (consoleOutputTrimmed === "") return "";
  return `
${grey}-------- console --------${ansiResetSequence}
${consoleOutputTrimmed}
${grey}-------------------------${ansiResetSequence}`;
};

const appendError = error => {
  if (!error) return ``;
  return `
error: ${error.stack}`;
};

/* eslint-disable import/max-dependencies */

const wrapAnsi = require$1("wrap-ansi");

const executeConcurrently = async (executionSteps, {
  cancellationToken,
  logger: logger$1,
  executionLogLevel,
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  compileServerOrigin,
  babelPluginMap,
  concurrencyLimit = Math.max(os.cpus.length - 1, 1),
  executionDefaultOptions = {},
  stopAfterExecute,
  logSummary,
  completedExecutionLogMerging,
  completedExecutionLogAbbreviation,
  coverage,
  coverageConfig,
  coverageIncludeMissing,
  ...rest
}) => {
  if (typeof compileServerOrigin !== "string") {
    throw new TypeError(`compileServerOrigin must be a string, got ${compileServerOrigin}`);
  }

  const executionOptionsFromDefault = {
    allocatedMs: 30000,
    measureDuration: true,
    // mirrorConsole: false because file will be executed in parallel
    // so log would be a mess to read
    mirrorConsole: false,
    captureConsole: true,
    collectRuntimeName: true,
    collectRuntimeVersion: true,
    collectCoverage: coverage,
    mainFileNotFoundCallback: ({
      fileRelativeUrl
    }) => {
      logger$1.error(new Error(`an execution main file does not exists.
--- file relative path ---
${fileRelativeUrl}`));
    },
    beforeExecutionCallback: () => {},
    afterExecutionCallback: () => {},
    ...executionDefaultOptions
  };
  const startMs = Date.now();
  const allExecutionDoneCancellationSource = cancellation.createCancellationSource();
  const executionCancellationToken = cancellation.composeCancellationToken(cancellationToken, allExecutionDoneCancellationSource.token);
  const report = {};
  const executionCount = executionSteps.length;
  let previousExecutionResult;
  let previousExecutionLog;
  let disconnectedCount = 0;
  let timedoutCount = 0;
  let erroredCount = 0;
  let completedCount = 0;
  await cancellation.createConcurrentOperations({
    cancellationToken,
    concurrencyLimit,
    array: executionSteps,
    start: async executionOptionsFromStep => {
      const executionIndex = executionSteps.indexOf(executionOptionsFromStep);
      const executionOptions = { ...executionOptionsFromDefault,
        ...executionOptionsFromStep
      };
      const {
        name,
        executionId,
        fileRelativeUrl,
        launch,
        allocatedMs,
        measureDuration,
        mirrorConsole,
        captureConsole,
        collectRuntimeName,
        collectRuntimeVersion,
        collectCoverage,
        mainFileNotFoundCallback,
        beforeExecutionCallback,
        afterExecutionCallback,
        gracefulStopAllocatedMs
      } = executionOptions;
      const beforeExecutionInfo = {
        allocatedMs,
        name,
        executionId,
        fileRelativeUrl,
        executionIndex
      };
      const filePath = util.urlToFileSystemPath(`${projectDirectoryUrl}${fileRelativeUrl}`);
      const fileExists = await pathLeadsToFile(filePath);

      if (!fileExists) {
        mainFileNotFoundCallback(beforeExecutionInfo);
        return;
      }

      beforeExecutionCallback(beforeExecutionInfo);
      const executionResult = await launchAndExecute({
        cancellationToken: executionCancellationToken,
        executionLogLevel,
        launch: params => launch({
          projectDirectoryUrl,
          outDirectoryRelativeUrl,
          compileServerOrigin,
          ...params
        }),
        allocatedMs,
        measureDuration,
        collectRuntimeName,
        collectRuntimeVersion,
        mirrorConsole,
        captureConsole,
        gracefulStopAllocatedMs,
        stopAfterExecute,
        stopAfterExecuteReason: "execution-done",
        executionId,
        fileRelativeUrl,
        collectCoverage,
        ...rest
      });
      const afterExecutionInfo = { ...beforeExecutionInfo,
        ...executionResult
      };
      afterExecutionCallback(afterExecutionInfo);

      if (executionResult.status === "timedout") {
        timedoutCount++;
      } else if (executionResult.status === "disconnected") {
        disconnectedCount++;
      } else if (executionResult.status === "errored") {
        erroredCount++;
      } else if (executionResult.status === "completed") {
        completedCount++;
      }

      if (logger.loggerToLevels(logger$1).info) {
        let log = createExecutionResultLog(afterExecutionInfo, {
          completedExecutionLogAbbreviation,
          executionCount,
          disconnectedCount,
          timedoutCount,
          erroredCount,
          completedCount
        });
        const {
          columns = 80
        } = process.stdout;
        log = wrapAnsi(log, columns, {
          trim: false,
          hard: true,
          wordWrap: false
        });

        if (previousExecutionLog && completedExecutionLogMerging && previousExecutionResult && previousExecutionResult.status === "completed" && (previousExecutionResult.consoleCalls ? previousExecutionResult.consoleCalls.length === 0 : true) && executionResult.status === "completed") {
          previousExecutionLog = previousExecutionLog.update(log);
        } else {
          previousExecutionLog = writeLog(log);
        }
      }

      if (fileRelativeUrl in report === false) {
        report[fileRelativeUrl] = {};
      }

      report[fileRelativeUrl][name] = executionResult;
      previousExecutionResult = executionResult;
    }
  }); // tell everyone we are done
  // (used to stop potential chrome browser still opened to be reused)

  allExecutionDoneCancellationSource.cancel("all execution done");
  const summary = reportToSummary(report);
  summary.startMs = startMs;
  summary.endMs = Date.now();

  if (logSummary) {
    logger$1.info(createSummaryLog(summary));
  }

  return {
    summary,
    report,
    ...(coverage ? {
      coverageMap: await reportToCoverageMap(report, {
        cancellationToken,
        projectDirectoryUrl,
        babelPluginMap,
        coverageConfig,
        coverageIncludeMissing
      })
    } : {})
  };
};

const pathLeadsToFile = path => new Promise((resolve, reject) => {
  fs.stat(path, (error, stats) => {
    if (error) {
      if (error.code === "ENOENT") {
        resolve(false);
      } else {
        reject(error);
      }
    } else {
      resolve(stats.isFile());
    }
  });
});

const reportToSummary = report => {
  const fileNames = Object.keys(report);
  const executionCount = fileNames.reduce((previous, fileName) => {
    return previous + Object.keys(report[fileName]).length;
  }, 0);

  const countResultMatching = predicate => {
    return fileNames.reduce((previous, fileName) => {
      const fileExecutionResult = report[fileName];
      return previous + Object.keys(fileExecutionResult).filter(executionName => {
        const fileExecutionResultForRuntime = fileExecutionResult[executionName];
        return predicate(fileExecutionResultForRuntime);
      }).length;
    }, 0);
  };

  const disconnectedCount = countResultMatching(({
    status
  }) => status === "disconnected");
  const timedoutCount = countResultMatching(({
    status
  }) => status === "timedout");
  const erroredCount = countResultMatching(({
    status
  }) => status === "errored");
  const completedCount = countResultMatching(({
    status
  }) => status === "completed");
  return {
    executionCount,
    disconnectedCount,
    timedoutCount,
    erroredCount,
    completedCount
  };
};

const executePlan = async (plan, {
  cancellationToken,
  compileServerLogLevel,
  logger,
  executionLogLevel,
  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl,
  jsenvDirectoryClean,
  importMapFileRelativeUrl,
  importDefaultExtension,
  compileServerProtocol,
  compileServerPrivateKey,
  compileServerCertificate,
  compileServerIp,
  compileServerPort,
  babelPluginMap,
  convertMap,
  compileGroupCount,
  concurrencyLimit,
  executionDefaultOptions,
  stopAfterExecute,
  completedExecutionLogMerging,
  completedExecutionLogAbbreviation,
  logSummary,
  // coverage parameters
  coverage,
  coverageConfig,
  coverageIncludeMissing,
  ...rest
} = {}) => {
  if (coverage) {
    babelPluginMap = { ...babelPluginMap,
      "transform-instrument": [babelPluginInstrument, {
        projectDirectoryUrl,
        coverageConfig
      }]
    };
  }

  const {
    origin: compileServerOrigin,
    outDirectoryRelativeUrl,
    stop
  } = await startCompileServer({
    cancellationToken,
    compileServerLogLevel,
    projectDirectoryUrl,
    jsenvDirectoryRelativeUrl,
    jsenvDirectoryClean,
    importMapFileRelativeUrl,
    importDefaultExtension,
    compileServerProtocol,
    compileServerPrivateKey,
    compileServerCertificate,
    compileServerIp,
    compileServerPort,
    keepProcessAlive: true,
    // to be sure it stays alive
    babelPluginMap,
    convertMap,
    compileGroupCount,
    browserInternalFileAnticipation: Object.keys(plan).some(key => key.endsWith(".html")),
    nodeInternalFileAnticipation: Object.keys(plan).some(key => key.endsWith(".js") || key.endsWith(".jsx") || key.endsWith(".ts"))
  });
  const executionSteps = await generateExecutionSteps({ ...plan,
    [outDirectoryRelativeUrl]: null
  }, {
    cancellationToken,
    projectDirectoryUrl
  });
  const executionResult = await executeConcurrently(executionSteps, {
    cancellationToken,
    logger,
    executionLogLevel,
    projectDirectoryUrl,
    outDirectoryRelativeUrl,
    compileServerOrigin,
    importMapFileRelativeUrl,
    importDefaultExtension,
    babelPluginMap,
    stopAfterExecute,
    concurrencyLimit,
    executionDefaultOptions,
    completedExecutionLogMerging,
    completedExecutionLogAbbreviation,
    logSummary,
    coverage,
    coverageConfig,
    coverageIncludeMissing,
    ...rest
  });
  stop("all execution done");
  return executionResult;
};

const executionIsPassed = ({
  summary
}) => summary.executionCount === summary.completedCount;

const generateCoverageJsonFile = async (coverageMap, coverageJsonFileUrl) => {
  await util.writeFile(coverageJsonFileUrl, JSON.stringify(coverageMap, null, "  "));
};

const {
  readFileSync
} = require$1("fs");

const libReport = require$1("istanbul-lib-report");

const reports = require$1("istanbul-reports");

const {
  createCoverageMap
} = require$1("istanbul-lib-coverage");

const generateCoverageHtmlDirectory = async (coverageMap, htmlDirectoryRelativeUrl, projectDirectoryUrl) => {
  const context = libReport.createContext({
    dir: util.urlToFileSystemPath(projectDirectoryUrl),
    coverageMap: createCoverageMap(coverageMap),
    sourceFinder: path => {
      return readFileSync(util.urlToFileSystemPath(util.resolveUrl(path, projectDirectoryUrl)), "utf8");
    }
  });
  const report = reports.create("html", {
    skipEmpty: true,
    skipFull: true,
    subdir: htmlDirectoryRelativeUrl
  });
  report.execute(context);
};

const libReport$1 = require$1("istanbul-lib-report");

const reports$1 = require$1("istanbul-reports");

const {
  createCoverageMap: createCoverageMap$1
} = require$1("istanbul-lib-coverage");

const generateCoverageTextLog = coverageMap => {
  const context = libReport$1.createContext({
    coverageMap: createCoverageMap$1(coverageMap)
  });
  const report = reports$1.create("text", {
    skipEmpty: true,
    skipFull: true
  });
  report.execute(context);
};

const jsenvCoverageConfig = {
  "./index.js": true,
  "./src/**/*.js": true,
  "./**/*.test.*": false,
  // contains .test. -> nope
  "./**/test/": false // inside a test folder -> nope,

};

const executeTestPlan = async ({
  cancellationToken = util.createCancellationTokenForProcess(),
  logLevel = "info",
  compileServerLogLevel = "warn",
  executionLogLevel = "warn",
  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl,
  jsenvDirectoryClean,
  importMapFileRelativeUrl,
  importDefaultExtension,
  compileServerProtocol,
  compileServerPrivateKey,
  compileServerCertificate,
  compileServerIp,
  compileServerPort,
  babelPluginMap,
  convertMap,
  compileGroupCount = 2,
  testPlan,
  concurrencyLimit,
  executionDefaultOptions = {},
  // stopAfterExecute: true to ensure runtime is stopped once executed
  // because we have what we wants: execution is completed and
  // we have associated coverageMap and capturedConsole
  // you can still pass false to debug what happens
  // meaning all node process and browsers launched stays opened
  stopAfterExecute = true,
  completedExecutionLogAbbreviation = false,
  completedExecutionLogMerging = false,
  logSummary = true,
  updateProcessExitCode = true,
  coverage = process.argv.includes("--cover") || process.argv.includes("--coverage"),
  coverageConfig = jsenvCoverageConfig,
  coverageIncludeMissing = true,
  coverageAndExecutionAllowed = false,
  coverageTextLog = true,
  coverageJsonFile = Boolean(process.env.CI),
  coverageJsonFileLog = true,
  coverageJsonFileRelativeUrl = "./coverage/coverage.json",
  coverageHtmlDirectory = !process.env.CI,
  coverageHtmlDirectoryRelativeUrl = "./coverage",
  coverageHtmlDirectoryIndexLog = true,
  // for chromiumExecutablePath, firefoxExecutablePath and webkitExecutablePath
  // but we need something angostic that just forward the params hence using ...rest
  ...rest
}) => {
  return wrapExternalFunctionExecution(async () => {
    const logger$1 = logger.createLogger({
      logLevel
    });
    cancellationToken.register(cancelError => {
      if (cancelError.reason === "process SIGINT") {
        logger$1.info(`process SIGINT -> cancelling test execution`);
      }
    });
    projectDirectoryUrl = assertProjectDirectoryUrl({
      projectDirectoryUrl
    });
    await assertProjectDirectoryExists({
      projectDirectoryUrl
    });

    if (typeof testPlan !== "object") {
      throw new Error(`testPlan must be an object, got ${testPlan}`);
    }

    if (coverage) {
      if (typeof coverageConfig !== "object") {
        throw new TypeError(`coverageConfig must be an object, got ${coverageConfig}`);
      }

      if (Object.keys(coverageConfig).length === 0) {
        logger$1.warn(`coverageConfig is an empty object. Nothing will be instrumented for coverage so your coverage will be empty`);
      }

      if (!coverageAndExecutionAllowed) {
        const fileSpecifierMapForExecute = util.normalizeSpecifierMetaMap(util.metaMapToSpecifierMetaMap({
          execute: testPlan
        }), "file:///");
        const fileSpecifierMapForCover = util.normalizeSpecifierMetaMap(util.metaMapToSpecifierMetaMap({
          cover: coverageConfig
        }), "file:///");
        const fileSpecifierMatchingCoverAndExecuteArray = Object.keys(fileSpecifierMapForExecute).filter(fileUrl => {
          return util.urlToMeta({
            url: fileUrl,
            specifierMetaMap: fileSpecifierMapForCover
          }).cover;
        });

        if (fileSpecifierMatchingCoverAndExecuteArray.length) {
          // I think it is an error, it would be strange, for a given file
          // to be both covered and executed
          throw new Error(`some file will be both covered and executed
--- specifiers ---
${fileSpecifierMatchingCoverAndExecuteArray.join("\n")}`);
        }
      }
    }

    const result = await executePlan(testPlan, {
      cancellationToken,
      compileServerLogLevel,
      logger: logger$1,
      executionLogLevel,
      projectDirectoryUrl,
      jsenvDirectoryRelativeUrl,
      jsenvDirectoryClean,
      importMapFileRelativeUrl,
      importDefaultExtension,
      compileServerProtocol,
      compileServerPrivateKey,
      compileServerCertificate,
      compileServerIp,
      compileServerPort,
      babelPluginMap,
      convertMap,
      compileGroupCount,
      concurrencyLimit,
      executionDefaultOptions,
      stopAfterExecute,
      completedExecutionLogMerging,
      completedExecutionLogAbbreviation,
      logSummary,
      coverage,
      coverageConfig,
      coverageIncludeMissing,
      ...rest
    });

    if (updateProcessExitCode && !executionIsPassed(result)) {
      process.exitCode = 1;
    }

    const promises = []; // keep this one first because it does ensureEmptyDirectory
    // and in case coverage json file gets written in the same directory
    // it must be done before

    if (coverage && coverageHtmlDirectory) {
      const coverageHtmlDirectoryUrl = util.resolveDirectoryUrl(coverageHtmlDirectoryRelativeUrl, projectDirectoryUrl);
      await util.ensureEmptyDirectory(coverageHtmlDirectoryUrl);

      if (coverageHtmlDirectoryIndexLog) {
        const htmlCoverageDirectoryIndexFileUrl = `${coverageHtmlDirectoryUrl}index.html`;
        logger$1.info(`-> ${util.urlToFileSystemPath(htmlCoverageDirectoryIndexFileUrl)}`);
      }

      promises.push(generateCoverageHtmlDirectory(result.coverageMap, coverageHtmlDirectoryRelativeUrl, projectDirectoryUrl));
    }

    if (coverage && coverageJsonFile) {
      const coverageJsonFileUrl = util.resolveUrl(coverageJsonFileRelativeUrl, projectDirectoryUrl);

      if (coverageJsonFileLog) {
        logger$1.info(`-> ${util.urlToFileSystemPath(coverageJsonFileUrl)}`);
      }

      promises.push(generateCoverageJsonFile(result.coverageMap, coverageJsonFileUrl));
    }

    if (coverage && coverageTextLog) {
      promises.push(generateCoverageTextLog(result.coverageMap));
    }

    await Promise.all(promises);
    return result;
  });
};

/* eslint-disable import/max-dependencies */
const generateBundle = async ({
  cancellationToken = util.createCancellationTokenForProcess(),
  logLevel = "info",
  compileServerLogLevel = "warn",
  logger: logger$1,
  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl,
  jsenvDirectoryClean,
  importMapFileRelativeUrl,
  importDefaultExtension,
  externalImportSpecifiers = [],
  env = {},
  browser = false,
  node = false,
  compileServerProtocol,
  compileServerPrivateKey,
  compileServerCertificate,
  compileServerIp,
  compileServerPort,
  babelPluginMap = jsenvBabelPluginMap,
  compileGroupCount = 1,
  runtimeScoreMap = { ...jsenvBrowserScoreMap,
    node: jsenvNodeVersionScoreMap
  },
  balancerTemplateFileUrl,
  entryPointMap = {
    main: "./index.js"
  },
  bundleDirectoryRelativeUrl,
  bundleDirectoryClean = false,
  format,
  formatInputOptions = {},
  formatOutputOptions = {},
  minify = false,
  minifyJsOptions = {},
  minifyCssOptions = {},
  minifyHtmlOptions = {},
  sourcemapExcludeSources = true,
  writeOnFileSystem = true,
  manifestFile = false,
  // when true .jsenv/out-bundle directory is generated
  // with all intermediated files used to produce the final bundle.
  // it might improve generateBundle speed for subsequent bundle generation
  // but this is to be proven and not absolutely required
  // When false intermediates files are transformed and served in memory
  // by the compile server
  // must be true by default otherwise rollup cannot find sourcemap files
  // when asking them to the compile server
  // (to fix that sourcemap could be inlined)
  filesystemCache = true,
  ...rest
}) => {
  return wrapExternalFunctionExecution(async () => {
    logger$1 = logger$1 || logger.createLogger({
      logLevel
    });
    projectDirectoryUrl = assertProjectDirectoryUrl({
      projectDirectoryUrl
    });
    await assertProjectDirectoryExists({
      projectDirectoryUrl
    });
    assertEntryPointMap({
      entryPointMap
    });
    assertBundleDirectoryRelativeUrl({
      bundleDirectoryRelativeUrl
    });
    const bundleDirectoryUrl = util.resolveDirectoryUrl(bundleDirectoryRelativeUrl, projectDirectoryUrl);
    assertBundleDirectoryInsideProject({
      bundleDirectoryUrl,
      projectDirectoryUrl
    });

    if (bundleDirectoryClean) {
      await util.ensureEmptyDirectory(bundleDirectoryUrl);
    }

    const extension = formatOutputOptions && formatOutputOptions.entryFileNames ? path.extname(formatOutputOptions.entryFileNames) : ".js";
    const chunkId = `${Object.keys(entryPointMap)[0]}${extension}`;
    env = { ...env,
      chunkId
    };
    babelPluginMap = { ...babelPluginMap,
      ...createBabePluginMapForBundle({
        format
      })
    };
    assertCompileGroupCount({
      compileGroupCount
    });

    if (compileGroupCount > 1) {
      if (typeof balancerTemplateFileUrl === "undefined") {
        throw new Error(`${format} format not compatible with balancing.`);
      }

      await util.assertFilePresence(balancerTemplateFileUrl);
    }

    const {
      outDirectoryRelativeUrl,
      origin: compileServerOrigin,
      compileServerImportMap,
      compileServerGroupMap
    } = await startCompileServer({
      cancellationToken,
      compileServerLogLevel,
      projectDirectoryUrl,
      jsenvDirectoryRelativeUrl,
      jsenvDirectoryClean,
      outDirectoryName: "out-bundle",
      importMapFileRelativeUrl,
      importDefaultExtension,
      compileServerProtocol,
      compileServerPrivateKey,
      compileServerCertificate,
      compileServerIp,
      compileServerPort,
      env,
      babelPluginMap,
      compileGroupCount,
      runtimeScoreMap,
      writeOnFilesystem: filesystemCache,
      useFilesystemAsCache: filesystemCache,
      // override with potential custom options
      ...rest,
      transformModuleIntoSystemFormat: false // will be done by rollup

    });

    if (compileGroupCount === 1) {
      return generateBundleUsingRollup({
        cancellationToken,
        logger: logger$1,
        projectDirectoryUrl,
        entryPointMap,
        bundleDirectoryUrl,
        compileDirectoryRelativeUrl: `${outDirectoryRelativeUrl}${COMPILE_ID_OTHERWISE}/`,
        compileServerOrigin,
        compileServerImportMap,
        importDefaultExtension,
        externalImportSpecifiers,
        babelPluginMap,
        node,
        browser,
        minify,
        minifyJsOptions,
        minifyCssOptions,
        minifyHtmlOptions,
        format,
        formatInputOptions,
        formatOutputOptions,
        writeOnFileSystem,
        sourcemapExcludeSources,
        manifestFile
      });
    }

    return await Promise.all([generateEntryPointsDirectories({
      cancellationToken,
      logger: logger$1,
      projectDirectoryUrl,
      outDirectoryRelativeUrl,
      bundleDirectoryUrl,
      entryPointMap,
      compileServerOrigin,
      compileServerImportMap,
      importDefaultExtension,
      externalImportSpecifiers,
      babelPluginMap,
      compileServerGroupMap,
      node,
      browser,
      format,
      formatInputOptions,
      formatOutputOptions,
      minify,
      writeOnFileSystem,
      sourcemapExcludeSources,
      manifestFile
    }), generateEntryPointsBalancerFiles({
      cancellationToken,
      logger: logger$1,
      projectDirectoryUrl,
      balancerTemplateFileUrl,
      outDirectoryRelativeUrl,
      entryPointMap,
      bundleDirectoryUrl,
      compileServerOrigin,
      compileServerImportMap,
      importDefaultExtension,
      externalImportSpecifiers,
      babelPluginMap,
      node,
      browser,
      format,
      formatInputOptions,
      formatOutputOptions,
      minify,
      writeOnFileSystem,
      sourcemapExcludeSources,
      manifestFile
    })]);
  });
};

const assertEntryPointMap = ({
  entryPointMap
}) => {
  if (typeof entryPointMap !== "object") {
    throw new TypeError(`entryPointMap must be an object, got ${entryPointMap}`);
  }

  Object.keys(entryPointMap).forEach(entryName => {
    const entryRelativeUrl = entryPointMap[entryName];

    if (typeof entryRelativeUrl !== "string") {
      throw new TypeError(`found unexpected value in entryPointMap, it must be a string but found ${entryRelativeUrl} for key ${entryName}`);
    }

    if (!entryRelativeUrl.startsWith("./")) {
      throw new TypeError(`found unexpected value in entryPointMap, it must start with ./ but found ${entryRelativeUrl} for key ${entryName}`);
    }
  });
};

const assertBundleDirectoryRelativeUrl = ({
  bundleDirectoryRelativeUrl
}) => {
  if (typeof bundleDirectoryRelativeUrl !== "string") {
    throw new TypeError(`bundleDirectoryRelativeUrl must be a string, received ${bundleDirectoryRelativeUrl}`);
  }
};

const assertBundleDirectoryInsideProject = ({
  bundleDirectoryUrl,
  projectDirectoryUrl
}) => {
  if (!bundleDirectoryUrl.startsWith(projectDirectoryUrl)) {
    throw new Error(`bundle directory must be inside project directory
--- bundle directory url ---
${bundleDirectoryUrl}
--- project directory url ---
${projectDirectoryUrl}`);
  }
};

const assertCompileGroupCount = ({
  compileGroupCount
}) => {
  if (typeof compileGroupCount !== "number") {
    throw new TypeError(`compileGroupCount must be a number, got ${compileGroupCount}`);
  }

  if (compileGroupCount < 1) {
    throw new Error(`compileGroupCount must be >= 1, got ${compileGroupCount}`);
  }
};

const generateEntryPointsDirectories = ({
  compileServerGroupMap,
  bundleDirectoryUrl,
  outDirectoryRelativeUrl,
  ...rest
}) => Promise.all(Object.keys(compileServerGroupMap).map(compileId => generateBundleUsingRollup({
  bundleDirectoryUrl: util.resolveDirectoryUrl(compileId, bundleDirectoryUrl),
  compileDirectoryRelativeUrl: `${outDirectoryRelativeUrl}${compileId}/`,
  ...rest
})));

const generateEntryPointsBalancerFiles = ({
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  entryPointMap,
  balancerTemplateFileUrl,
  ...rest
}) => Promise.all(Object.keys(entryPointMap).map(entryPointName => generateBundleUsingRollup({
  projectDirectoryUrl,
  compileDirectoryRelativeUrl: `${outDirectoryRelativeUrl}${COMPILE_ID_OTHERWISE}/`,
  entryPointMap: {
    [entryPointName]: `./${util.urlToRelativeUrl(balancerTemplateFileUrl, projectDirectoryUrl)}`
  },
  sourcemapExcludeSources: true,
  ...rest,
  format: "global"
})));

const generateCommonJsBundle = ({
  bundleDirectoryRelativeUrl = "./dist/commonjs",
  cjsExtension = true,
  node = true,
  formatOutputOptions = {},
  ...rest
}) => generateBundle({
  format: "commonjs",
  bundleDirectoryRelativeUrl,
  node,
  formatOutputOptions: { ...formatOutputOptions,
    ...(cjsExtension ? {
      // by default it's [name].js
      entryFileNames: `[name].cjs`,
      chunkFileNames: `[name]-[hash].cjs`
    } : {})
  },
  balancerTemplateFileUrl: util.resolveUrl("./src/internal/bundling/commonjs-balancer-template.js", jsenvCoreDirectoryUrl),
  ...rest
});

const generateCommonJsBundleForNode = ({
  babelPluginMap = jsenvBabelPluginMap,
  bundleDirectoryRelativeUrl,
  nodeMinimumVersion = decideNodeMinimumVersion(),
  cjsExtension,
  ...rest
}) => {
  const babelPluginMapForNode = computeBabelPluginMapForRuntime({
    babelPluginMap,
    runtimeName: "node",
    runtimeVersion: nodeMinimumVersion
  });
  return generateCommonJsBundle({
    bundleDirectoryRelativeUrl,
    cjsExtension,
    compileGroupCount: 1,
    babelPluginMap: babelPluginMapForNode,
    ...rest
  });
};

const decideNodeMinimumVersion = () => {
  return process.version.slice(1);
};

const generateEsModuleBundle = ({
  bundleDirectoryRelativeUrl = "./dist/esmodule",
  ...rest
}) => generateBundle({
  format: "esm",
  bundleDirectoryRelativeUrl,
  ...rest
});

const generateGlobalBundle = async ({
  bundleDirectoryRelativeUrl = "./dist/global",
  globalName,
  globals = {},
  browser = true,
  ...rest
}) => generateBundle({
  format: "global",
  browser,
  formatOutputOptions: {
    globals,
    ...(globalName ? {
      name: globalName
    } : {})
  },
  bundleDirectoryRelativeUrl,
  compileGroupCount: 1,
  ...rest
});

const generateSystemJsBundle = async ({
  bundleDirectoryRelativeUrl = "./dist/systemjs",
  ...rest
}) => generateBundle({
  format: "systemjs",
  balancerTemplateFileUrl: util.resolveUrl("./src/internal/bundling/systemjs-balancer-template.js", jsenvCoreDirectoryUrl),
  bundleDirectoryRelativeUrl,
  ...rest
});

const jsenvExplorableConfig = {
  source: {
    "./*.html": true,
    "./src/**/*.html": true
  },
  test: {
    "./test/**/*.html": true
  }
};

const trackRessources = () => {
  const callbackArray = [];

  const registerCleanupCallback = callback => {
    if (typeof callback !== "function") throw new TypeError(`callback must be a function
callback: ${callback}`);
    callbackArray.push(callback);
    return () => {
      const index = callbackArray.indexOf(callback);
      if (index > -1) callbackArray.splice(index, 1);
    };
  };

  const cleanup = util.memoize(async reason => {
    const localCallbackArray = callbackArray.slice();
    await Promise.all(localCallbackArray.map(callback => callback(reason)));
  });
  return {
    registerCleanupCallback,
    cleanup
  };
};

const trackPageToNotify = (page, {
  onError,
  onConsole
}) => {
  // https://github.com/GoogleChrome/puppeteer/blob/v1.4.0/docs/api.md#event-error
  const removeErrorListener = registerEvent({
    object: page,
    eventType: "error",
    callback: onError
  }); // https://github.com/GoogleChrome/puppeteer/blob/v1.4.0/docs/api.md#event-pageerror

  const removePageErrorListener = registerEvent({
    object: page,
    eventType: "pageerror",
    callback: onError
  }); // https://github.com/GoogleChrome/puppeteer/blob/v1.4.0/docs/api.md#event-console

  const removeConsoleListener = registerEvent({
    object: page,
    eventType: "console",
    // https://github.com/microsoft/playwright/blob/master/docs/api.md#event-console
    callback: async consoleMessage => {
      onConsole({
        type: consoleMessage.type(),
        text: appendNewLine(extractTextFromConsoleMessage(consoleMessage))
      });
    }
  });
  return () => {
    removeErrorListener();
    removePageErrorListener();
    removeConsoleListener();
  };
};

const appendNewLine = string => `${string}
`;

const extractTextFromConsoleMessage = consoleMessage => {
  return consoleMessage.text(); // ensure we use a string so that istanbul won't try
  // to put any coverage statement inside it
  // ideally we should use uneval no ?
  // eslint-disable-next-line no-new-func
  //   const functionEvaluatedBrowserSide = new Function(
  //     "value",
  //     `if (value instanceof Error) {
  //   return value.stack
  // }
  // return value`,
  //   )
  //   const argValues = await Promise.all(
  //     message.args().map(async (arg) => {
  //       const jsHandle = arg
  //       try {
  //         return await jsHandle.executionContext().evaluate(functionEvaluatedBrowserSide, jsHandle)
  //       } catch (e) {
  //         return String(jsHandle)
  //       }
  //     }),
  //   )
  //   const text = argValues.reduce((previous, value, index) => {
  //     let string
  //     if (typeof value === "object") string = JSON.stringify(value, null, "  ")
  //     else string = String(value)
  //     if (index === 0) return `${previous}${string}`
  //     return `${previous} ${string}`
  //   }, "")
  //   return text
};

const registerEvent = ({
  object,
  eventType,
  callback
}) => {
  object.on(eventType, callback);
  return () => {
    object.removeListener(eventType, callback);
  };
};

const createSharing = ({
  argsToId = argsToIdFallback
} = {}) => {
  const tokenMap = {};

  const getSharingToken = (...args) => {
    const id = argsToId(args);

    if (id in tokenMap) {
      return tokenMap[id];
    }

    const sharingToken = createSharingToken({
      unusedCallback: () => {
        delete tokenMap[id];
      }
    });
    tokenMap[id] = sharingToken;
    return sharingToken;
  };

  const getUniqueSharingToken = () => {
    return createSharingToken();
  };

  return {
    getSharingToken,
    getUniqueSharingToken
  };
};

const createSharingToken = ({
  unusedCallback = () => {}
} = {}) => {
  let useCount = 0;
  let sharedValue;
  let cleanup;
  const sharingToken = {
    isUsed: () => useCount > 0,
    setSharedValue: (value, cleanupFunction = () => {}) => {
      sharedValue = value;
      cleanup = cleanupFunction;
    },
    useSharedValue: () => {
      useCount++;
      let stopped = false;
      let stopUsingReturnValue;

      const stopUsing = () => {
        // ensure if stopUsing is called many times
        // it returns the same value and does not decrement useCount more than once
        if (stopped) {
          return stopUsingReturnValue;
        }

        stopped = true;
        useCount--;

        if (useCount === 0) {
          unusedCallback();
          sharedValue = undefined;
          stopUsingReturnValue = cleanup();
        } else {
          stopUsingReturnValue = undefined;
        }

        return stopUsingReturnValue;
      };

      return [sharedValue, stopUsing];
    }
  };
  return sharingToken;
};

const argsToIdFallback = args => JSON.stringify(args);

const evalSource = (code, filePath) => {
  const script = new vm.Script(code, {
    filename: filePath
  });
  return script.runInThisContext();
};

// https://github.com/benjamingr/RegExp.escape/blob/master/polyfill.js
const escapeRegexpSpecialCharacters = string => {
  string = String(string);
  let i = 0;
  let escapedString = "";

  while (i < string.length) {
    const char = string[i];
    i++;
    escapedString += isRegExpSpecialChar(char) ? `\\${char}` : char;
  }

  return escapedString;
};

const isRegExpSpecialChar = char => regexpSpecialChars.indexOf(char) > -1;

const regexpSpecialChars = ["/", "^", "\\", "[", "]", "(", ")", "{", "}", "?", "+", "*", ".", "|", "$"];

const executeHtmlFile = async (fileRelativeUrl, {
  cancellationToken,
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  compileServerOrigin,
  page,
  collectCoverage
}) => {
  const fileUrl = util.resolveUrl(fileRelativeUrl, projectDirectoryUrl);

  if (path.extname(fileUrl) !== ".html") {
    throw new Error(`the file to execute must use .html extension, received ${fileRelativeUrl}.`);
  }

  await util.assertFilePresence(fileUrl);
  const compileDirectoryRelativeUrl = `${outDirectoryRelativeUrl}otherwise/`;
  const compileDirectoryRemoteUrl = util.resolveUrl(compileDirectoryRelativeUrl, compileServerOrigin);
  const fileClientUrl = util.resolveUrl(fileRelativeUrl, compileDirectoryRemoteUrl);
  await page.goto(fileClientUrl, {
    timeout: 0
  });
  await page.waitForFunction(
  /* istanbul ignore next */
  () => {
    return Boolean(window.__jsenv__);
  }, [], {
    timeout: 0
  });
  let executionResult;

  try {
    executionResult = await page.evaluate(
    /* istanbul ignore next */
    () => {
      return window.__jsenv__.executionResultPromise;
    });
  } catch (e) {
    // if browser is closed due to cancellation
    // before it is able to finish evaluate we can safely ignore
    // and rethrow with current cancelError
    if (e.message.match(/^Protocol error \(.*?\): Target closed/) && cancellationToken.cancellationRequested) {
      cancellationToken.throwIfRequested();
    }

    throw e;
  }

  const {
    fileExecutionResultMap
  } = executionResult;
  const fileErrored = Object.keys(fileExecutionResultMap).find(fileRelativeUrl => {
    const fileExecutionResult = fileExecutionResultMap[fileRelativeUrl];
    return fileExecutionResult.status === "errored";
  });

  if (!collectCoverage) {
    Object.keys(fileExecutionResultMap).forEach(fileRelativeUrl => {
      delete fileExecutionResultMap[fileRelativeUrl].coverageMap;
    });
  }

  if (fileErrored) {
    const {
      exceptionSource
    } = fileExecutionResultMap[fileErrored];
    return {
      status: "errored",
      error: evalException(exceptionSource, {
        projectDirectoryUrl,
        compileServerOrigin
      }),
      namespace: fileExecutionResultMap,
      ...(collectCoverage ? {
        coverageMap: generateCoverageForPage(fileExecutionResultMap)
      } : {})
    };
  }

  return {
    status: "completed",
    namespace: fileExecutionResultMap,
    ...(collectCoverage ? {
      coverageMap: generateCoverageForPage(fileExecutionResultMap)
    } : {})
  };
};

const generateCoverageForPage = fileExecutionResultMap => {
  const coverageMap = composeCoverageMap(...Object.keys(fileExecutionResultMap).map(fileRelativeUrl => {
    return fileExecutionResultMap[fileRelativeUrl].coverageMap || {};
  }));
  return coverageMap;
};

const evalException = (exceptionSource, {
  projectDirectoryUrl,
  compileServerOrigin
}) => {
  const error = evalSource(exceptionSource);

  if (error && error instanceof Error) {
    const remoteRootRegexp = new RegExp(escapeRegexpSpecialCharacters(`${compileServerOrigin}/`), "g");
    error.stack = error.stack.replace(remoteRootRegexp, projectDirectoryUrl);
    error.message = error.message.replace(remoteRootRegexp, projectDirectoryUrl);
  }

  return error;
};

/* eslint-disable import/max-dependencies */
const chromiumSharing = createSharing();
const launchChromium = async ({
  cancellationToken = cancellation.createCancellationToken(),
  chromiumExecutablePath,
  browserServerLogLevel,
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  compileServerOrigin,
  headless = true,
  // about debug check https://github.com/microsoft/playwright/blob/master/docs/api.md#browsertypelaunchserveroptions
  debug = false,
  debugPort = 0,
  stopOnExit = true,
  share = false
}) => {
  const ressourceTracker = trackRessources();
  const sharingToken = share ? chromiumSharing.getSharingToken({
    chromiumExecutablePath,
    headless,
    debug,
    debugPort
  }) : chromiumSharing.getUniqueSharingToken();

  if (!sharingToken.isUsed()) {
    const launchOperation = launchBrowser("chromium", {
      cancellationToken,
      ressourceTracker,
      options: {
        headless,
        executablePath: chromiumExecutablePath,
        ...(debug ? {
          devtools: true
        } : {}),
        args: [// https://github.com/GoogleChrome/puppeteer/issues/1834
        // https://github.com/GoogleChrome/puppeteer/blob/master/docs/troubleshooting.md#tips
        // "--disable-dev-shm-usage",
        ...(debug ? [`--remote-debugging-port=${debugPort}`] : [])]
      },
      stopOnExit
    });
    sharingToken.setSharedValue(launchOperation);
  }

  const [launchOperation, stopUsingBrowser] = sharingToken.useSharedValue();
  ressourceTracker.registerCleanupCallback(stopUsingBrowser);
  const browser = await launchOperation;

  if (debug) {
    // https://github.com/puppeteer/puppeteer/blob/v2.0.0/docs/api.md#browserwsendpoint
    // https://chromedevtools.github.io/devtools-protocol/#how-do-i-access-the-browser-target
    const webSocketEndpoint = browser.wsEndpoint();
    const webSocketUrl = new URL(webSocketEndpoint);
    const browserEndpoint = `http://${webSocketUrl.host}/json/version`;
    const browserResponse = await fetchUrl(browserEndpoint, {
      cancellationToken,
      ignoreHttpsError: true
    });
    const {
      valid,
      message
    } = validateResponseStatusIsOk(browserResponse);

    if (!valid) {
      throw new Error(message);
    }

    const browserResponseObject = JSON.parse(browserResponse.body);
    const {
      webSocketDebuggerUrl
    } = browserResponseObject;
    console.log(`Debugger listening on ${webSocketDebuggerUrl}`);
  }

  return {
    browser,
    name: "chromium",
    version: "82.0.4057.0",
    stop: ressourceTracker.cleanup,
    ...browserToRuntimeHooks(browser, {
      cancellationToken,
      ressourceTracker,
      browserServerLogLevel,
      projectDirectoryUrl,
      outDirectoryRelativeUrl,
      compileServerOrigin
    })
  };
};
const launchChromiumTab = namedArgs => launchChromium({
  share: true,
  ...namedArgs
});
const firefoxSharing = createSharing();
const launchFirefox = async ({
  cancellationToken = cancellation.createCancellationToken(),
  firefoxExecutablePath,
  browserServerLogLevel,
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  compileServerOrigin,
  headless = true,
  stopOnExit = true,
  share = false
}) => {
  const ressourceTracker = trackRessources();
  const sharingToken = share ? firefoxSharing.getSharingToken({
    firefoxExecutablePath,
    headless
  }) : firefoxSharing.getUniqueSharingToken();

  if (!sharingToken.isUsed()) {
    const launchOperation = launchBrowser("firefox", {
      cancellationToken,
      ressourceTracker,
      options: {
        headless,
        executablePath: firefoxExecutablePath
      },
      stopOnExit
    });
    sharingToken.setSharedValue(launchOperation);
  }

  const [launchOperation, stopUsingBrowser] = sharingToken.useSharedValue();
  ressourceTracker.registerCleanupCallback(stopUsingBrowser);
  const browser = await launchOperation;
  return {
    browser,
    name: "firefox",
    version: "73.0b13",
    stop: ressourceTracker.cleanup,
    ...browserToRuntimeHooks(browser, {
      cancellationToken,
      ressourceTracker,
      browserServerLogLevel,
      projectDirectoryUrl,
      outDirectoryRelativeUrl,
      compileServerOrigin
    })
  };
};
const launchFirefoxTab = namedArgs => launchFirefox({
  share: true,
  ...namedArgs
});
const webkitSharing = createSharing();
const launchWebkit = async ({
  cancellationToken = cancellation.createCancellationToken(),
  webkitExecutablePath,
  browserServerLogLevel,
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  compileServerOrigin,
  headless = true,
  stopOnExit = true,
  share = false
}) => {
  const ressourceTracker = trackRessources();
  const sharingToken = share ? webkitSharing.getSharingToken({
    webkitExecutablePath,
    headless
  }) : webkitSharing.getUniqueSharingToken();

  if (!sharingToken.isUsed()) {
    const launchOperation = launchBrowser("webkit", {
      cancellationToken,
      ressourceTracker,
      options: {
        headless,
        executablePath: webkitExecutablePath
      },
      stopOnExit
    });
    sharingToken.setSharedValue(launchOperation);
  }

  const [launchOperation, stopUsingBrowser] = sharingToken.useSharedValue();
  ressourceTracker.registerCleanupCallback(stopUsingBrowser);
  const browser = await launchOperation;
  return {
    browser,
    name: "webkit",
    version: "13.0.4",
    stop: ressourceTracker.cleanup,
    ...browserToRuntimeHooks(browser, {
      cancellationToken,
      ressourceTracker,
      browserServerLogLevel,
      projectDirectoryUrl,
      outDirectoryRelativeUrl,
      compileServerOrigin
    })
  };
};
const launchWebkitTab = namedArgs => launchWebkit({
  share: true,
  ...namedArgs
});

const launchBrowser = async (browserName, {
  cancellationToken,
  ressourceTracker,
  options,
  stopOnExit
}) => {
  // eslint-disable-next-line import/no-dynamic-require
  const browserClass = require$1(`playwright-${browserName}`)[browserName];

  const launchOperation = cancellation.createStoppableOperation({
    cancellationToken,
    start: async () => {
      try {
        const result = await browserClass.launch({ ...options,
          // let's handle them to close properly browser, remove listener
          // and so on, instead of relying on playwright
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false
        });
        return result;
      } catch (e) {
        if (cancellationToken.cancellationRequested && isTargetClosedError(e)) {
          return e;
        }

        throw e;
      }
    },
    stop: async browser => {
      const disconnected = browser.isConnected() ? new Promise(resolve => {
        const disconnectedCallback = () => {
          browser.removeListener("disconnected", disconnectedCallback);
          resolve();
        };

        browser.on("disconnected", disconnectedCallback);
      }) : Promise.resolve(); // for some reason without this 100ms timeout
      // browser.close() never resolves (playwright does not like something)

      await new Promise(resolve => setTimeout(resolve, 100));
      await browser.close();
      await disconnected;
    }
  });
  ressourceTracker.registerCleanupCallback(launchOperation.stop);

  if (stopOnExit) {
    const unregisterProcessTeadown = nodeSignals.teardownSignal.addCallback(reason => {
      launchOperation.stop(`process ${reason}`);
    });
    ressourceTracker.registerCleanupCallback(unregisterProcessTeadown);
  }

  return launchOperation;
};

const browserToRuntimeHooks = (browser, {
  cancellationToken,
  ressourceTracker,
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  compileServerOrigin
}) => {
  const disconnected = new Promise(resolve => {
    // https://github.com/GoogleChrome/puppeteer/blob/v1.4.0/docs/api.md#event-disconnected
    browser.on("disconnected", resolve);
  });
  const errorCallbackArray = [];

  const registerErrorCallback = callback => {
    errorCallbackArray.push(callback);
  };

  const consoleCallbackArray = [];

  const registerConsoleCallback = callback => {
    consoleCallbackArray.push(callback);
  };

  const executeFile = async (fileRelativeUrl, {
    // because we use a self signed certificate
    collectCoverage,
    ignoreHTTPSErrors = true
  }) => {
    // open a tab to execute to the file
    const browserContext = await browser.newContext({
      ignoreHTTPSErrors
    });
    const page = await browserContext.newPage();
    ressourceTracker.registerCleanupCallback(async () => {
      try {
        await browserContext.close();
      } catch (e) {
        if (isTargetClosedError(e)) {
          return;
        }

        throw e;
      }
    }); // track tab error and console

    const stopTrackingToNotify = trackPageToNotify(page, {
      onError: error => {
        errorCallbackArray.forEach(callback => {
          callback(error);
        });
      },
      onConsole: ({
        type,
        text
      }) => {
        consoleCallbackArray.forEach(callback => {
          callback({
            type,
            text
          });
        });
      }
    });
    ressourceTracker.registerCleanupCallback(stopTrackingToNotify);
    return executeHtmlFile(fileRelativeUrl, {
      cancellationToken,
      projectDirectoryUrl,
      outDirectoryRelativeUrl,
      compileServerOrigin,
      page,
      collectCoverage
    });
  };

  return {
    disconnected,
    registerErrorCallback,
    registerConsoleCallback,
    executeFile
  };
};

const isTargetClosedError = error => {
  if (error.message.match(/^Protocol error \(.*?\): Target closed/)) {
    return true;
  }

  if (error.message.match(/^Protocol error \(.*?\): Browser has been closed/)) {
    return true;
  }

  return false;
};

const supportsDynamicImport = util.memoize(async () => {
  const fileUrl = util.resolveUrl("./src/internal/dynamicImportSource.js", jsenvCoreDirectoryUrl);
  const filePath = util.urlToFileSystemPath(fileUrl);
  const fileAsString = String(fs.readFileSync(filePath));

  try {
    return await evalSource$1(fileAsString, filePath);
  } catch (e) {
    return false;
  }
});

const evalSource$1 = (code, filePath) => {
  const script = new vm.Script(code, {
    filename: filePath
  });
  return script.runInThisContext();
};

const getCommandArgument = (argv, name) => {
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === name) {
      return {
        name,
        index: i,
        value: ""
      };
    }

    if (arg.startsWith(`${name}=`)) {
      return {
        name,
        index: i,
        value: arg.slice(`${name}=`.length)
      };
    }

    i++;
  }

  return null;
};
const removeCommandArgument = (argv, name) => {
  const argvCopy = argv.slice();
  const arg = getCommandArgument(argv, name);

  if (arg) {
    argvCopy.splice(arg.index, 1);
  }

  return argvCopy;
};

const AVAILABLE_DEBUG_MODE = ["none", "inherit", "inspect", "inspect-brk", "debug", "debug-brk"];
const createChildExecArgv = async ({
  cancellationToken = cancellation.createCancellationToken(),
  // https://code.visualstudio.com/docs/nodejs/nodejs-debugging#_automatically-attach-debugger-to-nodejs-subprocesses
  processExecArgv = process.execArgv,
  processDebugPort = process.debugPort,
  debugPort = 0,
  debugMode = "inherit",
  debugModeInheritBreak = true,
  traceWarnings = "inherit",
  unhandledRejection = "inherit",
  jsonModules = "inherit"
} = {}) => {
  if (typeof debugMode === "string" && AVAILABLE_DEBUG_MODE.indexOf(debugMode) === -1) {
    throw new TypeError(`unexpected debug mode.
--- debug mode ---
${debugMode}
--- allowed debug mode ---
${AVAILABLE_DEBUG_MODE}`);
  }

  let childExecArgv = processExecArgv.slice();
  const {
    debugModeArg,
    debugPortArg
  } = getCommandDebugArgs(processExecArgv);
  let childDebugMode;

  if (debugMode === "inherit") {
    if (debugModeArg) {
      childDebugMode = debugModeArg.name.slice(2);

      if (debugModeInheritBreak === false) {
        if (childDebugMode === "--debug-brk") childDebugMode = "--debug";
        if (childDebugMode === "--inspect-brk") childDebugMode = "--inspect";
      }
    } else {
      childDebugMode = "none";
    }
  } else {
    childDebugMode = debugMode;
  }

  if (childDebugMode === "none") {
    // remove debug mode or debug port arg
    if (debugModeArg) {
      childExecArgv = removeCommandArgument(childExecArgv, debugModeArg.name);
    }

    if (debugPortArg) {
      childExecArgv = removeCommandArgument(childExecArgv, debugPortArg.name);
    }
  } else {
    // this is required because vscode does not
    // support assigning a child spwaned without a specific port
    const childDebugPort = debugPort === 0 ? await server.findFreePort(processDebugPort + 1, {
      cancellationToken
    }) : debugPort; // remove process debugMode, it will be replaced with the child debugMode

    const childDebugModeArgName = `--${childDebugMode}`;

    if (debugPortArg) {
      // replace the debug port arg
      const childDebugPortArgFull = `--${childDebugMode}-port${portToArgValue(childDebugPort)}`;
      childExecArgv[debugPortArg.index] = childDebugPortArgFull; // replace debug mode or create it (would be strange to have to create it)

      if (debugModeArg) {
        childExecArgv[debugModeArg.index] = childDebugModeArgName;
      } else {
        childExecArgv.push(childDebugModeArgName);
      }
    } else {
      const childDebugArgFull = `${childDebugModeArgName}${portToArgValue(childDebugPort)}`; // replace debug mode for child

      if (debugModeArg) {
        childExecArgv[debugModeArg.index] = childDebugArgFull;
      } // add debug mode to child
      else {
          childExecArgv.push(childDebugArgFull);
        }
    }
  }

  if (traceWarnings !== "inherit") {
    const traceWarningsArg = getCommandArgument(childExecArgv, "--trace-warnings");

    if (traceWarnings && !traceWarningsArg) {
      childExecArgv.push("--trace-warnings");
    } else if (!traceWarnings && traceWarningsArg) {
      childExecArgv.splice(traceWarningsArg.index, 1);
    }
  } // https://nodejs.org/api/cli.html#cli_unhandled_rejections_mode


  if (unhandledRejection !== "inherit") {
    const unhandledRejectionArg = getCommandArgument(childExecArgv, "--unhandled-rejections");

    if (unhandledRejection && !unhandledRejectionArg) {
      childExecArgv.push(`--unhandled-rejections=${unhandledRejection}`);
    } else if (unhandledRejection && unhandledRejectionArg) {
      childExecArgv[unhandledRejectionArg.index] = `--unhandled-rejections=${unhandledRejection}`;
    } else if (!unhandledRejection && unhandledRejectionArg) {
      childExecArgv.splice(unhandledRejectionArg.index, 1);
    }
  } // https://nodejs.org/api/cli.html#cli_experimental_json_modules


  if (jsonModules !== "inherit") {
    const jsonModulesArg = getCommandArgument(childExecArgv, "--experimental-json-modules");

    if (jsonModules && !jsonModulesArg) {
      childExecArgv.push(`--experimental-json-modules`);
    } else if (!jsonModules && jsonModulesArg) {
      childExecArgv.splice(jsonModulesArg.index, 1);
    }
  }

  return childExecArgv;
};

const portToArgValue = port => {
  if (typeof port !== "number") return "";
  if (port === 0) return "";
  return `=${port}`;
}; // https://nodejs.org/en/docs/guides/debugging-getting-started/


const getCommandDebugArgs = argv => {
  const inspectArg = getCommandArgument(argv, "--inspect");

  if (inspectArg) {
    return {
      debugModeArg: inspectArg,
      debugPortArg: getCommandArgument(argv, "--inspect-port")
    };
  }

  const inspectBreakArg = getCommandArgument(argv, "--inspect-brk");

  if (inspectBreakArg) {
    return {
      debugModeArg: inspectBreakArg,
      debugPortArg: getCommandArgument(argv, "--inspect-port")
    };
  }

  const debugArg = getCommandArgument(argv, "--debug");

  if (debugArg) {
    return {
      debugModeArg: debugArg,
      debugPortArg: getCommandArgument(argv, "--debug-port")
    };
  }

  const debugBreakArg = getCommandArgument(argv, "--debug-brk");

  if (debugBreakArg) {
    return {
      debugModeArg: debugBreakArg,
      debugPortArg: getCommandArgument(argv, "--debug-port")
    };
  }

  return {};
};

/* eslint-disable import/max-dependencies */

const killProcessTree = require$1("tree-kill");

const EVALUATION_STATUS_OK = "evaluation-ok"; // https://nodejs.org/api/process.html#process_signal_events

const SIGINT_SIGNAL_NUMBER = 2;
const SIGABORT_SIGNAL_NUMBER = 6;
const SIGTERM_SIGNAL_NUMBER = 15;
const SIGINT_EXIT_CODE = 128 + SIGINT_SIGNAL_NUMBER;
const SIGABORT_EXIT_CODE = 128 + SIGABORT_SIGNAL_NUMBER;
const SIGTERM_EXIT_CODE = 128 + SIGTERM_SIGNAL_NUMBER; // http://man7.org/linux/man-pages/man7/signal.7.html
// https:// github.com/nodejs/node/blob/1d9511127c419ec116b3ddf5fc7a59e8f0f1c1e4/lib/internal/child_process.js#L472

const GRACEFUL_STOP_SIGNAL = "SIGTERM";
const STOP_SIGNAL = "SIGKILL"; // it would be more correct if GRACEFUL_STOP_FAILED_SIGNAL was SIGHUP instead of SIGKILL.
// but I'm not sure and it changes nothing so just use SIGKILL

const GRACEFUL_STOP_FAILED_SIGNAL = "SIGKILL";
const nodeJsFileUrl$1 = util.resolveUrl("./src/internal/node-launcher/node-js-file.js", jsenvCoreDirectoryUrl);
const launchNode = async ({
  cancellationToken = cancellation.createCancellationToken(),
  logger,
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  compileServerOrigin,
  debugPort,
  debugMode,
  debugModeInheritBreak,
  traceWarnings,
  unhandledRejection,
  jsonModules,
  env,
  remap = true,
  collectCoverage = false
}) => {
  if (typeof projectDirectoryUrl !== "string") {
    throw new TypeError(`projectDirectoryUrl must be a string, got ${projectDirectoryUrl}`);
  }

  if (typeof compileServerOrigin !== "string") {
    throw new TypeError(`compileServerOrigin must be a string, got ${compileServerOrigin}`);
  }

  if (typeof outDirectoryRelativeUrl !== "string") {
    throw new TypeError(`outDirectoryRelativeUrl must be a string, got ${outDirectoryRelativeUrl}`);
  }

  if (env === undefined) {
    env = { ...process.env
    };
  } else if (typeof env !== "object") {
    throw new TypeError(`env must be an object, got ${env}`);
  }

  const dynamicImportSupported = await supportsDynamicImport();
  const nodeControllableFileUrl = util.resolveUrl(dynamicImportSupported ? "./src/internal/node-launcher/nodeControllableFile.js" : "./src/internal/node-launcher/nodeControllableFile.cjs", jsenvCoreDirectoryUrl);
  await util.assertFilePresence(nodeControllableFileUrl);
  const execArgv = await createChildExecArgv({
    cancellationToken,
    debugPort,
    debugMode,
    debugModeInheritBreak,
    traceWarnings,
    unhandledRejection,
    jsonModules
  });
  env.COVERAGE_ENABLED = collectCoverage;
  const childProcess = child_process.fork(util.urlToFileSystemPath(nodeControllableFileUrl), {
    execArgv,
    // silent: true
    stdio: "pipe",
    env
  });
  logger.debug(`${process.argv[0]} ${execArgv.join(" ")} ${util.urlToFileSystemPath(nodeControllableFileUrl)}`);
  const childProcessReadyPromise = new Promise(resolve => {
    onceProcessMessage(childProcess, "ready", resolve);
  });
  const consoleCallbackArray = [];

  const registerConsoleCallback = callback => {
    consoleCallbackArray.push(callback);
  };

  installProcessOutputListener(childProcess, ({
    type,
    text
  }) => {
    consoleCallbackArray.forEach(callback => {
      callback({
        type,
        text
      });
    });
  }); // keep listening process outputs while child process is killed to catch
  // outputs until it's actually disconnected
  // registerCleanupCallback(removeProcessOutputListener)

  const errorCallbackArray = [];

  const registerErrorCallback = callback => {
    errorCallbackArray.push(callback);
  };

  let killing = false;
  installProcessErrorListener(childProcess, error => {
    if (!childProcess.connected && error.code === "ERR_IPC_DISCONNECTED") {
      return;
    } // on windows killProcessTree uses taskkill which seems to kill the process
    // with an exitCode of 1


    if (process.platform === "win32" && killing && error.exitCode === 1) {
      return;
    }

    errorCallbackArray.forEach(callback => {
      callback(error);
    });
  }); // keep listening process errors while child process is killed to catch
  // errors until it's actually disconnected
  // registerCleanupCallback(removeProcessErrorListener)
  // https://nodejs.org/api/child_process.html#child_process_event_disconnect

  let resolveDisconnect;
  const disconnected = new Promise(resolve => {
    resolveDisconnect = resolve;
    onceProcessMessage(childProcess, "disconnect", () => {
      resolve();
    });
  }); // child might exit without disconnect apparently, exit is disconnect for us

  childProcess.once("exit", () => {
    disconnectChildProcess();
  });

  const disconnectChildProcess = () => {
    try {
      childProcess.disconnect();
    } catch (e) {
      if (e.code === "ERR_IPC_DISCONNECTED") {
        resolveDisconnect();
      } else {
        throw e;
      }
    }

    return disconnected;
  };

  const killChildProcess = async ({
    signal
  }) => {
    killing = true;
    logger.debug(`send ${signal} to child process with pid ${childProcess.pid}`);
    await new Promise(resolve => {
      killProcessTree(childProcess.pid, signal, error => {
        if (error) {
          // on windows: process with pid cannot be found
          if (error.stack.includes(`The process "${childProcess.pid}" not found`)) {
            resolve();
            return;
          } // on windows: child process with a pid cannot be found


          if (error.stack.includes("Reason: There is no running instance of the task")) {
            resolve();
            return;
          } // windows too


          if (error.stack.includes("The operation attempted is not supported")) {
            resolve();
            return;
          }

          logger.error(`error while killing process tree with ${signal}
    --- error stack ---
    ${error.stack}
    --- process.pid ---
    ${childProcess.pid}`); // even if we could not kill the child
          // we will ask it to disconnect

          resolve();
          return;
        }

        resolve();
      });
    }); // in case the child process did not disconnect by itself at this point
    // something is keeping it alive and it cannot be propely killed
    // disconnect it manually.
    // something inside makeProcessControllable.cjs ensure process.exit()
    // when the child process is disconnected.

    return disconnectChildProcess();
  };

  const stop = ({
    gracefulFailed
  } = {}) => {
    return killChildProcess({
      signal: gracefulFailed ? GRACEFUL_STOP_FAILED_SIGNAL : STOP_SIGNAL
    });
  };

  const gracefulStop = () => {
    return killChildProcess({
      signal: GRACEFUL_STOP_SIGNAL
    });
  };

  const executeFile = async (fileRelativeUrl, {
    collectCoverage,
    executionId
  }) => {
    const execute = async () => {
      return new Promise(async (resolve, reject) => {
        onceProcessMessage(childProcess, "evaluate-result", ({
          status,
          value
        }) => {
          logger.debug(`child process sent the following evaluation result.
--- status ---
${status}
--- value ---
${value}`);
          if (status === EVALUATION_STATUS_OK) resolve(value);else reject(value);
        });
        const executeParams = {
          jsenvCoreDirectoryUrl,
          projectDirectoryUrl,
          outDirectoryRelativeUrl,
          fileRelativeUrl,
          compileServerOrigin,
          collectCoverage,
          executionId,
          remap
        };
        const source = await generateSourceToEvaluate({
          dynamicImportSupported,
          cancellationToken,
          projectDirectoryUrl,
          outDirectoryRelativeUrl,
          compileServerOrigin,
          executeParams
        });
        logger.debug(`ask child process to evaluate
--- source ---
${source}`);
        await childProcessReadyPromise;

        try {
          await sendToProcess(childProcess, "evaluate", source);
        } catch (e) {
          logger.error(`error while sending message to child
--- error stack ---
${e.stack}`);
          throw e;
        }
      });
    };

    const executionResult = await execute();
    const {
      status
    } = executionResult;

    if (status === "errored") {
      const {
        exceptionSource,
        coverageMap
      } = executionResult;
      return {
        status,
        error: evalException$1(exceptionSource, {
          compileServerOrigin,
          projectDirectoryUrl
        }),
        coverageMap
      };
    }

    const {
      namespace,
      coverageMap
    } = executionResult;
    return {
      status,
      namespace,
      coverageMap
    };
  };

  return {
    name: "node",
    version: process.version.slice(1),
    options: {
      execArgv // for now do not pass env, it make debug logs to verbose
      // because process.env is very big
      // env,

    },
    gracefulStop,
    stop,
    disconnected,
    registerErrorCallback,
    registerConsoleCallback,
    executeFile
  };
};

const evalException$1 = (exceptionSource, {
  compileServerOrigin,
  projectDirectoryUrl
}) => {
  const error = evalSource$2(exceptionSource);

  if (error && error instanceof Error) {
    const compileServerOriginRegexp = new RegExp(escapeRegexpSpecialCharacters(`${compileServerOrigin}/`), "g");
    error.stack = error.stack.replace(compileServerOriginRegexp, projectDirectoryUrl);
    error.message = error.message.replace(compileServerOriginRegexp, projectDirectoryUrl); // const projectDirectoryPath = urlToFileSystemPath(projectDirectoryUrl)
    // const projectDirectoryPathRegexp = new RegExp(
    //   `(?<!file:\/\/)${escapeRegexpSpecialCharacters(projectDirectoryPath)}`,
    //   "g",
    // )
    // error.stack = error.stack.replace(projectDirectoryPathRegexp, projectDirectoryUrl)
    // error.message = error.message.replace(projectDirectoryPathRegexp, projectDirectoryUrl)
  }

  return error;
};

const sendToProcess = async (childProcess, type, data) => {
  const source = _uneval.uneval(data, {
    functionAllowed: true
  });
  return new Promise((resolve, reject) => {
    childProcess.send({
      type,
      data: source
    }, error => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
};

const installProcessOutputListener = (childProcess, callback) => {
  // beware that we may receive ansi output here, should not be a problem but keep that in mind
  const stdoutDataCallback = chunk => {
    callback({
      type: "log",
      text: String(chunk)
    });
  };

  childProcess.stdout.on("data", stdoutDataCallback);

  const stdErrorDataCallback = chunk => {
    callback({
      type: "error",
      text: String(chunk)
    });
  };

  childProcess.stderr.on("data", stdErrorDataCallback);
  return () => {
    childProcess.stdout.removeListener("data", stdoutDataCallback);
    childProcess.stderr.removeListener("data", stdoutDataCallback);
  };
};

const installProcessErrorListener = (childProcess, callback) => {
  // https://nodejs.org/api/child_process.html#child_process_event_error
  const errorListener = error => {
    removeExitListener(); // if an error occured we ignore the child process exitCode

    callback(error);
    onceProcessMessage(childProcess, "error", errorListener);
  };

  const removeErrorListener = onceProcessMessage(childProcess, "error", errorListener); // process.exit(1) in child process or process.exitCode = 1 + process.exit()
  // means there was an error even if we don't know exactly what.

  const removeExitListener = onceProcessEvent(childProcess, "exit", code => {
    if (code !== null && code !== 0 && code !== SIGINT_EXIT_CODE && code !== SIGTERM_EXIT_CODE && code !== SIGABORT_EXIT_CODE) {
      removeErrorListener();
      callback(createExitWithFailureCodeError(code));
    }
  });
  return () => {
    removeErrorListener();
    removeExitListener();
  };
};

const createExitWithFailureCodeError = code => {
  if (code === 12) {
    return new Error(`child exited with 12: forked child wanted to use a non available port for debug`);
  }

  const error = new Error(`child exited with ${code}`);
  error.exitCode = code;
  return error;
};

const onceProcessMessage = (childProcess, type, callback) => {
  return onceProcessEvent(childProcess, "message", message => {
    if (message.type === type) {
      // eslint-disable-next-line no-eval
      callback(message.data ? eval(`(${message.data})`) : "");
    }
  });
};

const onceProcessEvent = (childProcess, type, callback) => {
  childProcess.on(type, callback);
  return () => {
    childProcess.removeListener(type, callback);
  };
};

const generateSourceToEvaluate = async ({
  dynamicImportSupported,
  executeParams,
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  compileServerOrigin
}) => {
  if (dynamicImportSupported) {
    return `import { execute } from ${JSON.stringify(nodeJsFileUrl$1)}

export default execute(${JSON.stringify(executeParams, null, "    ")})`;
  }

  const nodeJsFileRelativeUrl = util.urlToRelativeUrl(nodeJsFileUrl$1, projectDirectoryUrl);
  const nodeBundledJsFileRelativeUrl = `${outDirectoryRelativeUrl}${COMPILE_ID_COMMONJS_BUNDLE}/${nodeJsFileRelativeUrl}`;
  const nodeBundledJsFileUrl = `${projectDirectoryUrl}${nodeBundledJsFileRelativeUrl}`;
  const nodeBundledJsFileRemoteUrl = `${compileServerOrigin}/${nodeBundledJsFileRelativeUrl}`; // The compiled nodeRuntime file will be somewhere else in the filesystem
  // than the original nodeRuntime file.
  // It is important for the compiled file to be able to require
  // node modules that original file could access
  // hence the requireCompiledFileAsOriginalFile

  return `(() => {
  const { readFileSync } = require("fs")
  const Module = require('module')
  const { dirname } = require("path")
  const { fetchUrl } = require("@jsenv/server")

  const run = async () => {
    await fetchUrl(${JSON.stringify(nodeBundledJsFileRemoteUrl)}, { ignoreHttpsError: true })

    const nodeFilePath = ${JSON.stringify(util.urlToFileSystemPath(nodeJsFileUrl$1))}
    const nodeBundledJsFilePath = ${JSON.stringify(util.urlToFileSystemPath(nodeBundledJsFileUrl))}
    const { execute } = requireCompiledFileAsOriginalFile(nodeBundledJsFilePath, nodeFilePath)

    return execute(${JSON.stringify(executeParams, null, "    ")})
  }

  const requireCompiledFileAsOriginalFile = (compiledFilePath, originalFilePath) => {
    const fileContent = String(readFileSync(compiledFilePath))
    const moduleObject = new Module(compiledFilePath)
    moduleObject.paths = Module._nodeModulePaths(dirname(originalFilePath))
    moduleObject._compile(fileContent, compiledFilePath)
    return moduleObject.exports
  }

  return {
    default: run()
  }
})()`;
};

const evalSource$2 = (code, href) => {
  const script = new vm.Script(code, {
    filename: href
  });
  return script.runInThisContext();
};

const startExploring = async ({
  cancellationToken = util.createCancellationTokenForProcess(),
  explorableConfig = jsenvExplorableConfig,
  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl,
  outDirectoryName,
  toolbar = true,
  livereloading = true,
  browserInternalFileAnticipation = false,
  ...rest
}) => {
  return wrapExternalFunctionExecution(async () => {
    projectDirectoryUrl = assertProjectDirectoryUrl({
      projectDirectoryUrl
    });
    await assertProjectDirectoryExists({
      projectDirectoryUrl
    });
    const outDirectoryRelativeUrl = computeOutDirectoryRelativeUrl({
      projectDirectoryUrl,
      jsenvDirectoryRelativeUrl,
      outDirectoryName
    });
    const redirectFiles = createRedirectFilesService({
      projectDirectoryUrl,
      outDirectoryRelativeUrl
    });
    const serveExploringData = createExploringDataService({
      projectDirectoryUrl,
      outDirectoryRelativeUrl,
      explorableConfig
    });
    const serveExplorableListAsJson = createExplorableListAsJsonService({
      projectDirectoryUrl,
      outDirectoryRelativeUrl,
      explorableConfig
    });
    const compileServer = await startCompileServer({
      cancellationToken,
      projectDirectoryUrl,
      keepProcessAlive: true,
      cors: true,
      livereloadSSE: livereloading,
      accessControlAllowRequestOrigin: true,
      accessControlAllowRequestMethod: true,
      accessControlAllowRequestHeaders: true,
      accessControlAllowCredentials: true,
      stopOnPackageVersionChange: true,
      compileGroupCount: 2,
      scriptManipulations: [...(toolbar ? [{
        type: "module",
        src: "@jsenv/core/src/toolbar.js"
      }] : [])],
      customServices: {
        "service:exploring-redirect": request => redirectFiles(request),
        "service:exploring-data": request => serveExploringData(request),
        "service:explorables": request => serveExplorableListAsJson(request)
      },
      jsenvDirectoryRelativeUrl,
      outDirectoryName,
      browserInternalFileAnticipation,
      ...rest
    });
    return compileServer;
  });
};

const createRedirectFilesService = ({
  projectDirectoryUrl,
  outDirectoryRelativeUrl
}) => {
  const exploringRedirectorHtmlFileRelativeUrl = util.urlToRelativeUrl(exploringRedirectorHtmlFileUrl, projectDirectoryUrl);
  const exploringRedirectorJsFileRelativeUrl = util.urlToRelativeUrl(exploringRedirectorJsFileUrl, projectDirectoryUrl);
  const exploringRedirectorJsCompiledFileRelativeUrl = `${outDirectoryRelativeUrl}${COMPILE_ID_GLOBAL_BUNDLE}/${exploringRedirectorJsFileRelativeUrl}`;
  const toolbarMainJsFileRelativeUrl = util.urlToRelativeUrl(jsenvToolbarMainJsFileUrl, projectDirectoryUrl);
  const toolbarMainJsCompiledFileRelativeUrl = `${outDirectoryRelativeUrl}${COMPILE_ID_GLOBAL_BUNDLE}/${toolbarMainJsFileRelativeUrl}`;
  return request => {
    if (request.ressource === "/") {
      const exploringRedirectorHtmlFileUrl = `${request.origin}/${exploringRedirectorHtmlFileRelativeUrl}`;
      return {
        status: 307,
        headers: {
          location: exploringRedirectorHtmlFileUrl
        }
      };
    }

    if (request.ressource === "/.jsenv/toolbar.main.js") {
      const toolbarMainJsCompiledFileUrl = `${request.origin}/${toolbarMainJsCompiledFileRelativeUrl}`;
      return {
        status: 307,
        headers: {
          location: toolbarMainJsCompiledFileUrl
        }
      };
    }

    if (request.ressource === "/.jsenv/exploring.redirector.js") {
      const exploringRedirectorJsCompiledFileUrl = `${request.origin}/${exploringRedirectorJsCompiledFileRelativeUrl}`;
      return {
        status: 307,
        headers: {
          location: exploringRedirectorJsCompiledFileUrl
        }
      };
    }

    return null;
  };
};

const createExploringDataService = ({
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  explorableConfig
}) => {
  return request => {
    if (request.ressource === "/.jsenv/exploring.json" && request.method === "GET" && "x-jsenv" in request.headers) {
      const data = {
        projectDirectoryUrl,
        outDirectoryRelativeUrl,
        jsenvDirectoryRelativeUrl: util.urlToRelativeUrl(projectDirectoryUrl, jsenvCoreDirectoryUrl),
        exploringHtmlFileRelativeUrl: util.urlToRelativeUrl(exploringHtmlFileUrl, projectDirectoryUrl),
        sourcemapMainFileRelativeUrl: util.urlToRelativeUrl(sourcemapMainFileUrl, jsenvCoreDirectoryUrl),
        sourcemapMappingFileRelativeUrl: util.urlToRelativeUrl(sourcemapMappingFileUrl, jsenvCoreDirectoryUrl),
        explorableConfig
      };
      const json = JSON.stringify(data);
      return {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(json)
        },
        body: json
      };
    }

    return null;
  };
};

const createExplorableListAsJsonService = ({
  projectDirectoryUrl,
  outDirectoryRelativeUrl,
  explorableConfig
}) => {
  return async request => {
    if (request.ressource === "/.jsenv/explorables.json" && request.method === "GET" && "x-jsenv" in request.headers) {
      const metaMap = {};
      Object.keys(explorableConfig).forEach(key => {
        metaMap[key] = {
          ["**/.jsenv/"]: false,
          // temporary (in theory) to avoid visting .jsenv directory in jsenv itself
          ...explorableConfig[key],
          [outDirectoryRelativeUrl]: false
        };
      });
      const specifierMetaMapRelativeForExplorable = util.metaMapToSpecifierMetaMap(metaMap);
      const specifierMetaMapForExplorable = util.normalizeSpecifierMetaMap({ ...specifierMetaMapRelativeForExplorable,
        // ensure outDirectoryRelativeUrl is last
        // so that it forces not explorable files
        [outDirectoryRelativeUrl]: specifierMetaMapRelativeForExplorable[outDirectoryRelativeUrl]
      }, projectDirectoryUrl);
      const matchingFileResultArray = await util.collectFiles({
        directoryUrl: projectDirectoryUrl,
        specifierMetaMap: specifierMetaMapForExplorable,
        predicate: meta => Object.keys(meta).some(key => Boolean(meta[key]))
      });
      const explorableFiles = matchingFileResultArray.map(({
        relativeUrl,
        meta
      }) => ({
        relativeUrl,
        meta
      }));
      const json = JSON.stringify(explorableFiles);
      return {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(json)
        },
        body: json
      };
    }

    return null;
  };
};

exports.convertCommonJsWithBabel = convertCommonJsWithBabel;
exports.convertCommonJsWithRollup = convertCommonJsWithRollup;
exports.execute = execute;
exports.executeTestPlan = executeTestPlan;
exports.generateCommonJsBundle = generateCommonJsBundle;
exports.generateCommonJsBundleForNode = generateCommonJsBundleForNode;
exports.generateEsModuleBundle = generateEsModuleBundle;
exports.generateGlobalBundle = generateGlobalBundle;
exports.generateSystemJsBundle = generateSystemJsBundle;
exports.jsenvBabelPluginCompatMap = jsenvBabelPluginCompatMap;
exports.jsenvBabelPluginMap = jsenvBabelPluginMap;
exports.jsenvBrowserScoreMap = jsenvBrowserScoreMap;
exports.jsenvCoverageConfig = jsenvCoverageConfig;
exports.jsenvExplorableConfig = jsenvExplorableConfig;
exports.jsenvNodeVersionScoreMap = jsenvNodeVersionScoreMap;
exports.jsenvPluginCompatMap = jsenvPluginCompatMap;
exports.launchChromium = launchChromium;
exports.launchChromiumTab = launchChromiumTab;
exports.launchFirefox = launchFirefox;
exports.launchFirefoxTab = launchFirefoxTab;
exports.launchNode = launchNode;
exports.launchWebkit = launchWebkit;
exports.launchWebkitTab = launchWebkitTab;
exports.startExploring = startExploring;
//# sourceMappingURL=main.cjs.map
