import { assert } from "@jsenv/assert"

import { URL_META } from "@jsenv/url-meta"

{
  const pattern = "file:///*.js"
  const url = "file:///file.js"
  const actual = URL_META.applyPatternMatching({ pattern, url })
  const expected = {
    matched: true,
    patternIndex: pattern.length,
    urlIndex: url.length,
    matchGroups: ["file"],
  }
  assert({ actual, expected })
}

{
  const pattern = "file:///*.js"
  const url = "file:///file.json"
  const actual = URL_META.applyPatternMatching({ pattern, url })
  const expected = {
    matched: false,
    patternIndex: pattern.length,
    urlIndex: url.indexOf("o"),
    matchGroups: ["file"],
  }
  assert({ actual, expected })
}

{
  const pattern = "file:///**/*.js"
  const url = "file:///folder/file.js"
  const actual = URL_META.applyPatternMatching({ pattern, url })
  const expected = {
    matched: true,
    patternIndex: pattern.length,
    urlIndex: url.length,
    matchGroups: ["file"],
  }
  assert({ actual, expected })
}

{
  const pattern = "file:///**/*.js"
  const url = "file:///folder/file.json"
  const actual = URL_META.applyPatternMatching({ pattern, url })
  const expected = {
    matched: false,
    patternIndex: pattern.length,
    urlIndex: url.length,
    matchGroups: ["file"],
  }
  assert({ actual, expected })
}

{
  const pattern = "file:///a/b*/c"
  const url = "file:///a/bZ"
  const actual = URL_META.applyPatternMatching({ pattern, url })
  const expected = {
    matched: false,
    patternIndex: pattern.indexOf("c") - 1,
    urlIndex: url.indexOf("Z"),
    matchGroups: [""],
  }
  assert({ actual, expected })
}

{
  const pattern = "file:///**/*"
  const url = "file:///Users/directory/file.js"
  const actual = URL_META.applyPatternMatching({ pattern, url })
  const expected = {
    matched: true,
    patternIndex: pattern.length,
    urlIndex: url.length,
    matchGroups: ["file.js"],
  }
  assert({ actual, expected })
}

{
  const pattern = "file:///**/*.test.*"
  const url = "file:///folder/file.test.js"
  const actual = URL_META.applyPatternMatching({ pattern, url })
  const expected = {
    matched: true,
    patternIndex: pattern.length,
    urlIndex: url.length,
    matchGroups: ["file", "js"],
  }
  assert({ actual, expected })
}

{
  const pattern = "file:///**/*.js"
  const url = "file:///file.es5.js/file.es5.js.map"
  const actual = URL_META.applyPatternMatching({ pattern, url })
  const expected = {
    matched: false,
    patternIndex: pattern.length,
    urlIndex: url.length,
    matchGroups: ["file.es5"],
  }
  assert({ actual, expected })
}

{
  const pattern = "file:///src/**/*.js"
  const url = "file:///src/folder/file"
  const actual = URL_META.applyPatternMatching({ pattern, url })
  const expected = {
    matched: false,
    patternIndex: pattern.indexOf("."),
    urlIndex: url.length,
    matchGroups: [""],
  }
  assert({ actual, expected })
}

{
  const pattern = "file:///src/**/*.js"
  const url = "file:///src/folder/file.js"
  const actual = URL_META.applyPatternMatching({ pattern, url })
  const expected = {
    matched: true,
    patternIndex: pattern.length,
    urlIndex: url.length,
    matchGroups: ["file"],
  }
  assert({ actual, expected })
}

{
  const pattern = "file:///src/**/*.js"
  const url = "file:///src/folder/file.json"
  const actual = URL_META.applyPatternMatching({ pattern, url })
  const expected = {
    matched: false,
    patternIndex: pattern.length,
    urlIndex: url.length,
    matchGroups: ["file"],
  }
  assert({ actual, expected })
}

{
  const pattern = "file:///src/**/*.js"
  const url = "file:///src/folder"
  const actual = URL_META.applyPatternMatching({ pattern, url })
  const expected = {
    matched: false,
    patternIndex: pattern.indexOf("."),
    urlIndex: url.length,
    matchGroups: [""],
  }
  assert({ actual, expected })
}
