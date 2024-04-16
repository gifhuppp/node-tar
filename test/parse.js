import t from 'tap'
import { Parser } from '../dist/esm/parse.js'
import { makeTar } from './fixtures/make-tar.js'
import fs, { readFileSync } from 'fs'
import path, { dirname } from 'path'
import zlib from 'zlib'
import { Minipass } from 'minipass'
import { Header } from '../dist/esm/header.js'
import EE from 'events'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const tardir = path.resolve(__dirname, 'fixtures/tars')

t.test('fixture tests', t => {
  class ByteStream extends Minipass {
    write(chunk) {
      for (let i = 0; i < chunk.length - 1; i++) {
        super.write(chunk.subarray(i, i + 1))
      }

      const ret = super.write(
        chunk.subarray(chunk.length - 1, chunk.length),
      )
      if (ret === false) {
        throw new Error('BS write return false')
      }
      return ret
    }
  }

  const trackEvents = (t, expect, p, slow) => {
    let ok = true
    let cursor = 0
    p.on('entry', entry => {
      ok =
        ok && t.match(['entry', entry], expect[cursor++], entry.path)
      if (slow) {
        setTimeout(() => entry.resume())
      } else {
        entry.resume()
      }
    })
    p.on('ignoredEntry', entry => {
      ok =
        ok &&
        t.match(
          ['ignoredEntry', entry],
          expect[cursor++],
          'ignored: ' + entry.path,
        )
    })
    p.on('warn', (c, message, _data) => {
      ok =
        ok && t.match(['warn', c, message], expect[cursor++], 'warn')
    })
    p.on('nullBlock', () => {
      ok = ok && t.match(['nullBlock'], expect[cursor++], 'null')
    })
    p.on('error', er => {
      ok = ok && t.match(['error', er], expect[cursor++], 'error')
    })
    p.on('meta', meta => {
      ok = ok && t.match(['meta', meta], expect[cursor++], 'meta')
    })
    p.on('eof', () => {
      ok = ok && t.match(['eof'], expect[cursor++], 'eof')
    })
    p.on('end', () => {
      ok = ok && t.match(['end'], expect[cursor++], 'end')
      t.end()
    })
  }

  t.jobs = 4
  const parsedir = path.resolve(__dirname, 'fixtures/parse')
  const files = fs.readdirSync(tardir)
  const maxMetaOpt = [250, undefined]
  const filterOpt = [true, false]
  const strictOpt = [true, false]
  const runTest = (file, maxMeta, filter, strict) => {
    const tardata = fs.readFileSync(file)
    const base = path.basename(file, '.tar')
    t.test(
      'file=' +
        base +
        '.tar' +
        ' maxmeta=' +
        maxMeta +
        ' filter=' +
        filter +
        ' strict=' +
        strict,
      t => {
        const o =
          (maxMeta ? '-meta-' + maxMeta : '') +
          (filter ? '-filter' : '') +
          (strict ? '-strict' : '')
        const tail = (o ? '-' + o : '') + '.json'
        const eventsFile = parsedir + '/' + base + tail
        const expect = JSON.parse(readFileSync(eventsFile, 'utf8'))

        t.test('uncompressed one byte at a time', t => {
          const bs = new ByteStream()
          bs.on('data', c => {
            if (!Buffer.isBuffer(c)) throw new Error('wat1')
            if (c.length !== 1) throw new Error('wat2')
          })
          const opt =
            maxMeta || filter || strict ?
              {
                maxMetaEntrySize: maxMeta,
                filter:
                  filter ?
                    (_path, entry) => entry.size % 2 !== 0
                  : undefined,
                strict: strict,
              }
            : undefined
          const p = new Parser(opt)
          trackEvents(t, expect, p)
          bs.pipe(p)
          bs.write(tardata)
          bs.end()
        })

        t.test('uncompressed all at once', t => {
          const p = new Parser({
            maxMetaEntrySize: maxMeta,
            filter:
              filter ?
                (_path, entry) => entry.size % 2 !== 0
              : undefined,
            strict: strict,
          })
          trackEvents(t, expect, p)
          p.end(tardata)
        })

        t.test(
          'uncompressed one byte at a time, filename .tbr',
          t => {
            const bs = new ByteStream()
            const opt =
              maxMeta || filter || strict ?
                {
                  maxMetaEntrySize: maxMeta,
                  filter:
                    filter ?
                      (_path, entry) => entry.size % 2 !== 0
                    : undefined,
                  strict: strict,
                  file: 'example.tbr',
                }
              : undefined
            const bp = new Parser(opt)
            trackEvents(t, expect, bp)
            bs.pipe(bp)
            bs.end(tardata)
          },
        )

        t.test('uncompressed all at once, filename .tar.br', t => {
          const p = new Parser({
            maxMetaEntrySize: maxMeta,
            filter:
              filter ?
                (_path, entry) => entry.size % 2 !== 0
              : undefined,
            strict: strict,
            file: 'example.tar.br',
          })
          trackEvents(t, expect, p)
          p.end(tardata)
        })

        t.test('gzipped all at once', t => {
          const p = new Parser({
            maxMetaEntrySize: maxMeta,
            filter:
              filter ?
                (_path, entry) => entry.size % 2 !== 0
              : undefined,
            strict: strict,
          })
          trackEvents(t, expect, p)
          p.end(zlib.gzipSync(tardata))
        })

        t.test('gzipped all at once, filename .tbr', t => {
          const p = new Parser({
            maxMetaEntrySize: maxMeta,
            filter:
              filter ?
                (_path, entry) => entry.size % 2 !== 0
              : undefined,
            strict: strict,
            file: 'example.tbr',
          })
          trackEvents(t, expect, p)
          p.end(zlib.gzipSync(tardata))
        })

        t.test('gzipped byte at a time', t => {
          const bs = new ByteStream()
          const bp = new Parser({
            maxMetaEntrySize: maxMeta,
            filter:
              filter ?
                (_path, entry) => entry.size % 2 !== 0
              : undefined,
            strict: strict,
          })
          trackEvents(t, expect, bp)
          bs.pipe(bp)
          bs.end(zlib.gzipSync(tardata))
        })

        t.test(
          'compress with brotli based on filename .tar.br',
          t => {
            const p = new Parser({
              maxMetaEntrySize: maxMeta,
              filter:
                filter ?
                  (_path, entry) => entry.size % 2 !== 0
                : undefined,
              strict: strict,
              file: 'example.tar.br',
            })
            trackEvents(t, expect, p)
            p.end(zlib.brotliCompressSync(tardata))
          },
        )

        t.test('compress with brotli based on filename .tbr', t => {
          const p = new Parser({
            maxMetaEntrySize: maxMeta,
            filter:
              filter ?
                (_path, entry) => entry.size % 2 !== 0
              : undefined,
            strict: strict,
            file: 'example.tbr',
          })
          trackEvents(t, expect, p)
          p.end(zlib.brotliCompressSync(tardata))
        })

        t.test('compress with brotli all at once', t => {
          const p = new Parser({
            maxMetaEntrySize: maxMeta,
            filter:
              filter ?
                (_path, entry) => entry.size % 2 !== 0
              : undefined,
            strict: strict,
            brotli: {},
          })
          trackEvents(t, expect, p)
          p.end(zlib.brotliCompressSync(tardata))
        })

        t.test('compress with brotli byte at a time', t => {
          const bs = new ByteStream()
          const bp = new Parser({
            maxMetaEntrySize: maxMeta,
            filter:
              filter ?
                (_path, entry) => entry.size % 2 !== 0
              : undefined,
            strict: strict,
            brotli: {},
          })
          trackEvents(t, expect, bp)
          bs.pipe(bp)
          bs.end(zlib.brotliCompressSync(tardata))
        })

        t.test('compress with brotli .tbr byte at a time', t => {
          const bs = new ByteStream()
          const bp = new Parser({
            maxMetaEntrySize: maxMeta,
            filter:
              filter ?
                (_path, entry) => entry.size % 2 !== 0
              : undefined,
            strict: strict,
            file: 'example.tbr',
          })
          trackEvents(t, expect, bp)
          bs.pipe(bp)
          bs.end(zlib.brotliCompressSync(tardata))
        })

        t.test('async chunks', t => {
          const p = new Parser({
            maxMetaEntrySize: maxMeta,
            filter:
              filter ?
                (_path, entry) => entry.size % 2 !== 0
              : undefined,
            strict: strict,
          })
          trackEvents(t, expect, p, true)
          p.write(tardata.subarray(0, Math.floor(tardata.length / 2)))
          process.nextTick(() =>
            p.end(tardata.subarray(Math.floor(tardata.length / 2))),
          )
        })

        t.end()
      },
    )
  }

  files
    .map(f => path.resolve(tardir, f))
    .forEach(file =>
      maxMetaOpt.forEach(maxMeta =>
        strictOpt.forEach(strict =>
          filterOpt.forEach(filter =>
            runTest(file, maxMeta, filter, strict),
          ),
        ),
      ),
    )
  t.end()
})

t.test('strict warn with an error emits that error', t => {
  t.plan(1)
  const p = new Parser({
    strict: true,
  })
  p.on('error', emitted => t.equal(emitted, er))
  const er = new Error('yolo')
  p.warn('TAR_TEST', er)
})

t.test('onwarn gets added to the warn event', t => {
  t.plan(1)
  const p = new Parser({
    onwarn(_code, message) {
      t.equal(message, 'this is fine')
    },
  })
  p.warn('TAR_TEST', 'this is fine')
})

t.test('onentry gets added to entry event', t => {
  t.plan(1)
  const p = new Parser({
    onentry: entry => t.equal(entry, 'yes hello this is dog'),
  })
  p.emit('entry', 'yes hello this is dog')
})

t.test('drain event timings', t => {
  let sawOndone = false
  const ondone = function () {
    sawOndone = true
    this.emit('prefinish')
    this.emit('finish')
    this.emit('end')
    this.emit('close')
  }

  // write 1 header and body, write 2 header, verify false return
  // wait for drain event before continuing.
  // write 2 body, 3 header and body, 4 header, verify false return
  // wait for drain event
  // write 4 body and null blocks

  const data = [
    [
      {
        path: 'one',
        size: 513,
        type: 'File',
      },
      new Array(513).join('1'),
      '1',
      {
        path: 'two',
        size: 513,
        type: 'File',
      },
      new Array(513).join('2'),
      '2',
      {
        path: 'three',
        size: 1024,
        type: 'File',
      },
    ],
    [
      new Array(513).join('3'),
      new Array(513).join('3'),
      {
        path: 'four',
        size: 513,
        type: 'File',
      },
    ],
    [
      new Array(513).join('4'),
      '4',
      {
        path: 'five',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('5'),
      new Array(513).join('5'),
      {
        path: 'six',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('6'),
      new Array(513).join('6'),
      {
        path: 'seven',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('7'),
      new Array(513).join('7'),
      {
        path: 'eight',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('8'),
      new Array(513).join('8'),
      {
        path: 'four',
        size: 513,
        type: 'File',
      },
      new Array(513).join('4'),
      '4',
      {
        path: 'five',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('5'),
      new Array(513).join('5'),
      {
        path: 'six',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('6'),
      new Array(513).join('6'),
      {
        path: 'seven',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('7'),
      new Array(513).join('7'),
      {
        path: 'eight',
        size: 1024,
        type: 'File',
      },
      new Array(513).join('8'),
    ],
    [
      new Array(513).join('8'),
      {
        path: 'nine',
        size: 1537,
        type: 'File',
      },
      new Array(513).join('9'),
    ],
    [new Array(513).join('9')],
    [new Array(513).join('9')],
    ['9'],
  ].map(chunks => makeTar(chunks))

  const expect = [
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
  ]

  class SlowStream extends EE {
    write() {
      setTimeout(() => this.emit('drain'))
      return false
    }

    end() {
      return this.write()
    }
  }

  let currentEntry
  const autoPipe = true
  const p = new Parser({
    ondone,
    onentry: entry => {
      t.equal(entry.path, expect.shift())
      currentEntry = entry
      if (autoPipe) {
        setTimeout(() => entry.pipe(new SlowStream()))
      }
    },
  })

  data.forEach(d => {
    if (!t.equal(p.write(d), false, 'write should return false')) {
      return t.end()
    }
  })

  let interval
  const go = () => {
    const d = data.shift()
    if (d === undefined) {
      return p.end()
    }

    let paused
    if (currentEntry) {
      currentEntry.pause()
      paused = true
    }

    const hunklen = Math.floor(d.length / 2)
    const hunks = [d.subarray(0, hunklen), d.subarray(hunklen)]
    p.write(hunks[0])

    if (currentEntry && !paused) {
      currentEntry.pause()
      paused = true
    }

    if (
      !t.equal(
        p.write(hunks[1]),
        false,
        'write should return false: ' + d,
      )
    ) {
      return t.end()
    }

    p.once('drain', go)

    if (paused) {
      currentEntry.resume()
    }
  }

  p.once('drain', go)
  p.on('end', () => {
    clearInterval(interval)
    t.ok(sawOndone)
    t.end()
  })
  go()
})

t.test('consume while consuming', t => {
  const data = makeTar([
    {
      path: 'one',
      size: 0,
      type: 'File',
    },
    {
      path: 'zero',
      size: 0,
      type: 'File',
    },
    {
      path: 'two',
      size: 513,
      type: 'File',
    },
    new Array(513).join('2'),
    '2',
    {
      path: 'three',
      size: 1024,
      type: 'File',
    },
    new Array(513).join('3'),
    new Array(513).join('3'),
    {
      path: 'zero',
      size: 0,
      type: 'File',
    },
    {
      path: 'zero',
      size: 0,
      type: 'File',
    },
    {
      path: 'four',
      size: 1024,
      type: 'File',
    },
    new Array(513).join('4'),
    new Array(513).join('4'),
    {
      path: 'zero',
      size: 0,
      type: 'File',
    },
    {
      path: 'zero',
      size: 0,
      type: 'File',
    },
  ])

  const runTest = (t, size) => {
    const p = new Parser()
    const first = data.subarray(0, size)
    const rest = data.subarray(size)
    p.once('entry', _entry => {
      for (let pos = 0; pos < rest.length; pos += size) {
        p.write(rest.subarray(pos, pos + size))
      }

      p.end()
    })
      .on('entry', entry => entry.resume())
      .on('end', () => t.end())
      .write(first)
  }

  // one that aligns, and another that doesn't, so that we
  // get some cases where there's leftover chunk and a buffer
  t.test('size=1000', t => runTest(t, 1000))
  t.test('size=1024', t => runTest(t, 4096))
  t.end()
})

t.test('truncated input', t => {
  const data = makeTar([
    {
      path: 'foo/',
      type: 'Directory',
    },
    {
      path: 'foo/bar',
      type: 'File',
      size: 18,
    },
  ])

  t.test('truncated at block boundary', t => {
    const warnings = []
    const p = new Parser({
      onwarn: (_c, message) => warnings.push(message),
    })
    p.end(data)
    t.same(warnings, [
      'Truncated input (needed 512 more bytes, only 0 available)',
    ])
    t.end()
  })

  t.test('truncated mid-block', t => {
    const warnings = []
    const p = new Parser({
      onwarn: (_c, message) => warnings.push(message),
    })
    p.write(data)
    p.end(Buffer.from('not a full block'))
    t.same(warnings, [
      'Truncated input (needed 512 more bytes, only 16 available)',
    ])
    t.end()
  })

  t.end()
})

t.test('truncated gzip input', t => {
  const raw = makeTar([
    {
      path: 'foo/',
      type: 'Directory',
    },
    {
      path: 'foo/bar',
      type: 'File',
      size: 18,
    },
    new Array(19).join('x'),
    '',
    '',
  ])
  const tgz = zlib.gzipSync(raw)
  const split = Math.floor((tgz.length * 2) / 3)
  const trunc = tgz.subarray(0, split)

  const skipEarlyEnd = process.version.match(/^v4\./)
  t.test(
    'early end',
    {
      skip: skipEarlyEnd ? 'not a zlib error on v4' : false,
    },
    t => {
      const warnings = []
      const p = new Parser()
      p.on('error', er => warnings.push(er.message))
      let aborted = false
      p.on('abort', () => (aborted = true))
      p.end(trunc)
      t.equal(aborted, true, 'aborted writing')
      t.same(warnings, ['zlib: unexpected end of file'])
      t.end()
    },
  )

  t.test('just wrong', t => {
    const warnings = []
    const p = new Parser()
    p.on('error', er => warnings.push(er.message))
    let aborted = false
    p.on('abort', () => (aborted = true))
    p.write(trunc)
    p.write(trunc)
    p.write(tgz.subarray(split))
    p.end()
    t.equal(aborted, true, 'aborted writing')
    t.match(warnings, [/^zlib: /])
    t.end()
  })

  t.end()
})

t.test('end while consuming', t => {
  // https://github.com/npm/node-tar/issues/157
  const data = zlib.gzipSync(
    makeTar([
      {
        path: 'package/package.json',
        type: 'File',
        size: 130,
      },
      new Array(131).join('x'),
      {
        path: 'package/node_modules/@c/d/node_modules/e/package.json',
        type: 'File',
        size: 30,
      },
      new Array(31).join('e'),
      {
        path: 'package/node_modules/@c/d/package.json',
        type: 'File',
        size: 33,
      },
      new Array(34).join('d'),
      {
        path: 'package/node_modules/a/package.json',
        type: 'File',
        size: 59,
      },
      new Array(60).join('a'),
      {
        path: 'package/node_modules/b/package.json',
        type: 'File',
        size: 30,
      },
      new Array(31).join('b'),
      '',
      '',
    ]),
  )

  const actual = []
  const expect = [
    'package/package.json',
    'package/node_modules/@c/d/node_modules/e/package.json',
    'package/node_modules/@c/d/package.json',
    'package/node_modules/a/package.json',
    'package/node_modules/b/package.json',
  ]

  const mp = new Minipass()
  const p = new Parser({
    onentry: entry => {
      actual.push(entry.path)
      entry.resume()
    },
    onwarn: (c, m, data) => t.fail(`${c}: ${m}`, data),
  })
  p.on('end', () => {
    t.same(actual, expect)
    t.end()
  })
  mp.end(data)
  mp.pipe(p)
})

t.test('bad archives', t => {
  const p = new Parser()
  const warnings = []
  p.on('warn', (code, msg, data) => {
    warnings.push([code, msg, data])
  })
  p.on('end', () => {
    // last one should be 'this archive sucks'
    t.match(warnings.pop(), [
      'TAR_BAD_ARCHIVE',
      'Unrecognized archive format',
      { code: 'TAR_BAD_ARCHIVE', tarCode: 'TAR_BAD_ARCHIVE' },
    ])
    t.end()
  })
  // javascript test is not a tarball.
  p.end(fs.readFileSync(__filename))
})

t.test('header that throws', t => {
  const p = new Parser()
  p.on('warn', (_c, m, d) => {
    t.equal(m, 'invalid base256 encoding')
    t.match(d, {
      code: 'TAR_ENTRY_INVALID',
    })
    t.end()
  })
  const h = new Header({
    path: 'path',
    mode: 0o07777, // gonna make this one invalid
    uid: 1234,
    gid: 4321,
    type: 'File',
    size: 1,
  })
  h.encode()
  const buf = h.block
  const bad = Buffer.from([
    0x81, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  ])
  bad.copy(buf, 100)
  t.throws(
    () => new Header(buf),
    'the header with that buffer throws',
  )
  p.write(buf)
})

t.test('warnings that are not so bad', t => {
  const p = new Parser()
  const warnings = []
  p.on('warn', (code, m, d) => {
    warnings.push([code, m, d])
    t.fail('should get no warnings')
  })
  // the parser doesn't actually decide what's "ok" or "supported",
  // it just parses.  So we have to set it ourselves like unpack does
  p.once('entry', entry => (entry.invalid = true))
  p.on('entry', entry => entry.resume())
  const data = makeTar([
    {
      path: '/a/b/c',
      type: 'File',
      size: 1,
    },
    'a',
    {
      path: 'a/b/c',
      type: 'Directory',
    },
    '',
    '',
  ])
  p.on('end', () => {
    t.same(warnings, [])
    t.end()
  })
  p.end(data)
})
