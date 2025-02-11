import { assert } from "@jsenv/assert"

import { URL_META } from "@jsenv/url-meta"

{
  const actual = URL_META.applyAssociations({
    url: "file:///a",
    associations: {
      a: {
        "file:///**/*": true,
      },
    },
  })
  const expected = { a: true }
  assert({ actual, expected })
}

{
  const actual = URL_META.applyAssociations({
    url: "file:///node_modules",
    associations: {
      a: {
        "file:///**/*": true,
      },
    },
  })
  const expected = { a: true }
  assert({ actual, expected })
}

{
  const actual = URL_META.applyAssociations({
    url: "file:///a",
    associations: {
      a: {
        "file:///a/**/*.test.js": true,
      },
    },
  })
  const expected = {}
  assert({ actual, expected })
}

{
  const actual = URL_META.applyAssociations({
    url: "file:///a/b.test.js",
    associations: {
      a: {
        "file:///a/**/*.test.js": true,
      },
    },
  })
  const expected = { a: true }
  assert({ actual, expected })
}

{
  const actual = URL_META.applyAssociations({
    url: "file:///a/b.js",
    associations: {
      a: {
        "file:///a/**/*.test.js": true,
      },
    },
  })
  const expected = {}
  assert({ actual, expected })
}

{
  const actual = URL_META.applyAssociations({
    url: "file:///a/b/c.test.js",
    associations: {
      a: {
        "file:///a/**/*.test.js": true,
      },
    },
  })
  const expected = { a: true }
  assert({ actual, expected })
}

{
  const actual = URL_META.applyAssociations({
    url: "file:///index.test.js",
    associations: {
      a: {
        "file:///**/*.js": true,
      },
    },
  })
  const expected = { a: true }
  assert({ actual, expected })
}
