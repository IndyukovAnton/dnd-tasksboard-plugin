const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

test('plugin entrypoint is self-contained for Obsidian loader', () => {
    const mainJs = fs.readFileSync('main.js', 'utf8')

    assert.equal(
        /require\((['"])\.{1,2}\//.test(mainJs),
        false,
        'main.js must not require local files without a bundler'
    )
})
