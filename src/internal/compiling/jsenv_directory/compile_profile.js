import { featuresCompatFromRuntime } from "./features_compat_from_runtime.js"

export const createCompileProfile = ({
  featureNames,
  babelPluginMap,
  sourcemapMethod,
  sourcemapExcludeSources,
  runtimeReport,
}) => {
  const runtimeName = runtimeReport.runtime.name
  const runtimeVersion = runtimeReport.runtime.version
  const { availableFeatureNames } = featuresCompatFromRuntime({
    runtimeName,
    runtimeVersion,
    featureNames,
  })
  const featuresReport = {}
  availableFeatureNames.forEach((availableFeatureName) => {
    featuresReport[availableFeatureName] = true
  })
  Object.assign(featuresReport, runtimeReport.featuresReport)
  const requiredBabelPluginDescription = {}
  Object.keys(babelPluginMap).forEach((babelPluginName) => {
    const supported = featuresReport[babelPluginName]
    if (!supported) {
      requiredBabelPluginDescription[babelPluginName] = babelPluginValueAsJSON(
        babelPluginMap[babelPluginName],
      )
    }
  })
  const requiredFeatureNames = featureNames.filter((featureName) => {
    return !featuresReport[featureName]
  })
  return {
    requiredFeatureNames,
    requiredBabelPluginDescription,
    sourcemapMethod,
    sourcemapExcludeSources,
  }
}

const babelPluginValueAsJSON = (babelPluginValue) => {
  if (Array.isArray(babelPluginValue)) {
    return babelPluginValue
  }
  if (typeof babelPluginValue === "object") {
    return { options: babelPluginValue.options }
  }
  return babelPluginValue
}

const COMPARERS = {
  requiredFeatureNames: (a, b) => valueInArrayAreTheSame(a, b),
  requiredBabelPluginDescription: () => true, // TODO
  sourcemapMethod: (a, b) => a === b,
  sourcemapExcludeSources: (a, b) => a === b,
}

const valueInArrayAreTheSame = (array, secondArray) => {
  return array.every((value) => secondArray.includes(value))
}

export const compareCompileProfiles = (
  compileProfile,
  secondCompileProfile,
) => {
  return Object.keys(COMPARERS).every((key) => {
    return COMPARERS[key](compileProfile[key], secondCompileProfile[key])
  })
}
