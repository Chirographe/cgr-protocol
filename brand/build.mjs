// Generates all of dist/ from source/shape.glsl, the single definition of shape and colors.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, 'dist')
const HEADER = `#version 300 es
precision highp float; out vec4 o; uniform vec2 res, lo, hi; uniform float mode;
`
const SHAPE = readFileSync(join(HERE, 'source/shape.glsl'), 'utf8')
const LOOK = readFileSync(join(HERE, 'source/look.glsl'), 'utf8')
const RENDER = readFileSync(join(HERE, 'source/raster.glsl'), 'utf8')
const ANGLE_RENDER = readFileSync(join(HERE, 'source/raster-angle.glsl'), 'utf8')

// Sampled domain for the SVG and the GLB, in shape coordinates.
const GRID = { w: 1024, h: 352, x0: -1, x1: 1, y0: -0.344, y1: 0.344 }
// Volume of the 3D model.
const VOLUME = { step: 0.005, thickness: 0.075, bevel: 0.03, engraving: 0.014 }
// Tilted view, in degrees: the camera goes slightly under the key.
const VIEW = { pitch: 13, yaw: 6 }
const ENGRAVING_TINT = [150 / 255, 226 / 255, 1]

// --- GPU: runs shape.glsl in a headless browser ---

async function gpu(navigateur, frag, size, options = {}) {
  const page = await navigateur.newPage()
  await page.setContent('<canvas id="c"></canvas>')
  const result = await page.evaluate(
    ([frag, [w, h], { lo, hi, mode, float }]) => {
      const c = document.getElementById('c')
      c.width = w
      c.height = h
      const g = c.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true })
      const shader = (type, src) => {
        const s = g.createShader(type)
        g.shaderSource(s, src)
        g.compileShader(s)
        if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s))
        return s
      }
      const p = g.createProgram()
      const vertex = `#version 300 es
in vec2 a; void main(){ gl_Position=vec4(a,0.,1.); }`
      g.attachShader(p, shader(g.VERTEX_SHADER, vertex))
      g.attachShader(p, shader(g.FRAGMENT_SHADER, frag))
      g.linkProgram(p)
      g.useProgram(p)
      g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer())
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW)
      const a = g.getAttribLocation(p, 'a')
      g.enableVertexAttribArray(a)
      g.vertexAttribPointer(a, 2, g.FLOAT, false, 0, 0)
      const u = (n) => g.getUniformLocation(p, n)
      g.uniform2f(u('res'), w, h)
      g.uniform2f(u('lo'), ...(lo ?? [0, 0]))
      g.uniform2f(u('hi'), ...(hi ?? [1, 1]))
      g.uniform1f(u('mode'), mode ?? 0)
      g.viewport(0, 0, w, h)
      if (!float) {
        g.clearColor(0, 0, 0, 0)
        g.clear(g.COLOR_BUFFER_BIT)
        g.drawArrays(g.TRIANGLES, 0, 3)
        g.finish()
        return c.toDataURL('image/png').split(',')[1]
      }
      if (!g.getExtension('EXT_color_buffer_float')) throw new Error('float textures unavailable')
      const t = g.createTexture()
      g.bindTexture(g.TEXTURE_2D, t)
      g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA32F, w, h)
      g.bindFramebuffer(g.FRAMEBUFFER, g.createFramebuffer())
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t, 0)
      g.drawArrays(g.TRIANGLES, 0, 3)
      const px = new Float32Array(w * h * 4)
      g.readPixels(0, 0, w, h, g.RGBA, g.FLOAT, px)
      const o = new Uint8Array(px.buffer)
      let s = ''
      for (let i = 0; i < o.length; i += 32768) {
        s += String.fromCharCode(...o.subarray(i, i + 32768))
      }
      return btoa(s)
    },
    [frag, size, options],
  )
  await page.close()
  return Buffer.from(result, 'base64')
}

const image = (nav, size, mode) => gpu(nav, HEADER + SHAPE + LOOK + RENDER, [size, size], { mode })

const DEFINITIONS = `#define THICKNESS ${VOLUME.thickness}
#define BEVEL ${VOLUME.bevel}
#define PITCH ${VIEW.pitch}.
#define YAW ${VIEW.yaw}.
`
const angleImage = (nav, size, mode) =>
  gpu(nav, HEADER + DEFINITIONS + SHAPE + LOOK + ANGLE_RENDER, [size, size], { mode })

async function fields(nav) {
  const { w, h, x0, x1, y0, y1 } = GRID
  const options = { lo: [x0, y0], hi: [x1, y1], float: true }
  const main = (body) =>
    HEADER + SHAPE + `void main(){ vec2 p=mix(lo,hi,gl_FragCoord.xy/res); ${body} }`
  const read = async (body) => {
    const b = await gpu(nav, main(body), [w, h], options)
    return new Float32Array(b.buffer, b.byteOffset, b.length / 4)
  }
  return {
    distances: await read('o=vec4(key2d(p),glyph(p),0.,1.);'),
    colors: await read('o=vec4(mesh(p),1.);'),
  }
}

function sampler(array) {
  const { w, h, x0, x1, y0, y1 } = GRID
  return (x, y, channel) => {
    const fx = Math.min(Math.max(((x - x0) / (x1 - x0)) * w - 0.5, 0), w - 1.001)
    const fy = Math.min(Math.max(((y - y0) / (y1 - y0)) * h - 0.5, 0), h - 1.001)
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const tx = fx - i
    const ty = fy - j
    const v = (a, b) => array[(b * w + a) * 4 + channel]
    const bottom = v(i, j) * (1 - tx) + v(i + 1, j) * tx
    const top = v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx
    return bottom * (1 - ty) + top * ty
  }
}

// --- SVG: contours of the shape, in layers ---

function contours(array, channel) {
  const { w, h, x0, x1, y0, y1 } = GRID
  const f = (i, j) => array[(j * w + i) * 4 + channel]
  const X = (i) => x0 + ((i + 0.5) / w) * (x1 - x0)
  const Y = (j) => y0 + ((j + 0.5) / h) * (y1 - y0)
  const points = new Map()
  const neighbors = new Map()
  const horizontal = (i, j) => {
    const id = 2 * (j * w + i)
    const a = f(i, j)
    if (!points.has(id)) points.set(id, [X(i) + (a / (a - f(i + 1, j))) * (X(i + 1) - X(i)), Y(j)])
    return id
  }
  const vertical = (i, j) => {
    const id = 2 * (j * w + i) + 1
    const a = f(i, j)
    if (!points.has(id)) points.set(id, [X(i), Y(j) + (a / (a - f(i, j + 1))) * (Y(j + 1) - Y(j))])
    return id
  }
  const link = (a, b) => {
    neighbors.set(a, [...(neighbors.get(a) ?? []), b])
    neighbors.set(b, [...(neighbors.get(b) ?? []), a])
  }
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const code =
        (f(i, j) < 0 ? 1 : 0) |
        (f(i + 1, j) < 0 ? 2 : 0) |
        (f(i + 1, j + 1) < 0 ? 4 : 0) |
        (f(i, j + 1) < 0 ? 8 : 0)
      if (code === 0 || code === 15) continue
      const bottom = () => horizontal(i, j)
      const top = () => horizontal(i, j + 1)
      const left = () => vertical(i, j)
      const right = () => vertical(i + 1, j)
      const pairs = {
        1: [[bottom, left]],
        2: [[bottom, right]],
        3: [[left, right]],
        4: [[top, right]],
        5: [
          [bottom, right],
          [top, left],
        ],
        6: [[bottom, top]],
        7: [[left, top]],
        8: [[left, top]],
        9: [[bottom, top]],
        10: [
          [bottom, left],
          [top, right],
        ],
        11: [[top, right]],
        12: [[left, right]],
        13: [[bottom, right]],
        14: [[bottom, left]],
      }[code]
      for (const [a, b] of pairs) link(a(), b())
    }
  }
  const seen = new Set()
  const loops = []
  for (const start of neighbors.keys()) {
    if (seen.has(start)) continue
    const loop = []
    let current = start
    while (current !== undefined && !seen.has(current)) {
      seen.add(current)
      loop.push(points.get(current))
      current = neighbors.get(current).find((n) => !seen.has(n))
    }
    loops.push(loop)
  }
  return loops
}

function simplify(points, tolerance) {
  if (points.length < 3) return points
  const [a, b] = [points[0], points[points.length - 1]]
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l = Math.hypot(dx, dy) || 1
  let worst = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs((points[i][0] - a[0]) * dy - (points[i][1] - a[1]) * dx) / l
    if (d > worst) [worst, index] = [d, i]
  }
  if (worst <= tolerance) return [a, b]
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ]
}

function trace(loops) {
  const px = ([x, y]) => `${((x + 1) * 256).toFixed(2)} ${((1 - y) * 256).toFixed(2)}`
  return loops
    .map((loop) => {
      const m = Math.floor(loop.length / 2)
      const line = [
        ...simplify(loop.slice(0, m + 1), 0.0006).slice(0, -1),
        ...simplify([...loop.slice(m), loop[0]], 0.0006).slice(0, -1),
      ]
      return `M${line.map(px).join(' L')}Z`
    })
    .join(' ')
}

function svg({ distances, colors }) {
  const color = sampler(colors)
  const hex = (x, y) =>
    '#' +
    [0, 1, 2]
      .map((c) =>
        Math.round(color(x, y, c) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  const stops = Array.from({ length: 11 }, (_, i) => {
    const t = i / 10
    return `<stop offset="${t}" stop-color="${hex(-0.92 + 1.82 * t, 0.05)}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Chirographe">
<defs>
<linearGradient id="material" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="492" y2="0">${stops}</linearGradient>
<linearGradient id="light" gradientUnits="userSpaceOnUse" x1="0" y1="183" x2="0" y2="329"><stop offset="0" stop-color="#fff" stop-opacity=".30"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#0433B8" stop-opacity="0"/><stop offset="1" stop-color="#0433B8" stop-opacity=".40"/></linearGradient>
<path id="key-shape" fill-rule="evenodd" d="${trace(contours(distances, 0))}"/>
</defs>
<g id="chirographe">
<use id="key" href="#key-shape" fill="url(#material)"/>
<use id="key-light" href="#key-shape" fill="url(#light)"/>
<path id="initials" fill="#96E2FF" fill-opacity=".6" fill-rule="evenodd" d="${trace(contours(distances, 1))}"/>
</g>
</svg>
`
}

// --- GLB: extruded volume, meshed with surface nets ---

function buildMesh({ distances, colors }) {
  const { step, thickness, bevel, engraving } = VOLUME
  const d2 = sampler(distances)
  const rgb = sampler(colors)
  const x0 = -0.94
  const y0 = -0.32
  const z0 = -0.09
  const [nx, ny, nz] = [Math.ceil(1.88 / step), Math.ceil(0.64 / step), Math.ceil(0.18 / step)]
  const sd = (x, y, z) => {
    const wx = d2(x, y, 0) + bevel
    const wy = Math.abs(z) - (thickness - bevel)
    let s = Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - bevel
    if (z > 0) s = Math.max(s, -Math.max(d2(x, y, 1), thickness - engraving - z))
    return s
  }
  const field = new Float32Array(nx * ny * nz)
  const id = (i, j, k) => (k * ny + j) * nx + i
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        field[id(i, j, k)] = sd(x0 + i * step, y0 + j * step, z0 + k * step)
      }
    }
  }
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ]
  const edges = []
  for (let a = 0; a < 8; a++) {
    for (const bit of [1, 2, 4]) if (!(a & bit)) edges.push([a, a | bit])
  }
  const cell = new Int32Array(nx * ny * nz).fill(-1)
  const positions = []
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const v = corners.map(([a, b, c]) => field[id(i + a, j + b, k + c)])
        const negatives = v.filter((x) => x < 0).length
        if (negatives === 0 || negatives === 8) continue
        let [sx, sy, sz, n] = [0, 0, 0, 0]
        for (const [a, b] of edges) {
          if (v[a] < 0 === v[b] < 0) continue
          const t = v[a] / (v[a] - v[b])
          sx += corners[a][0] + t * (corners[b][0] - corners[a][0])
          sy += corners[a][1] + t * (corners[b][1] - corners[a][1])
          sz += corners[a][2] + t * (corners[b][2] - corners[a][2])
          n++
        }
        cell[id(i, j, k)] = positions.length / 3
        positions.push(x0 + (i + sx / n) * step, y0 + (j + sy / n) * step, z0 + (k + sz / n) * step)
      }
    }
  }
  const count = positions.length / 3
  const normals = new Float32Array(count * 3)
  const tints = new Uint16Array(count * 4)
  const e = step * 0.75
  const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  for (let v = 0; v < count; v++) {
    const [x, y, z] = positions.slice(v * 3, v * 3 + 3)
    const n = [
      sd(x + e, y, z) - sd(x - e, y, z),
      sd(x, y + e, z) - sd(x, y - e, z),
      sd(x, y, z + e) - sd(x, y, z - e),
    ]
    const l = Math.hypot(...n) || 1
    normals.set(
      n.map((c) => c / l),
      v * 3,
    )
    const engraved = z > 0 && d2(x, y, 1) < 0
    for (let c = 0; c < 3; c++) {
      const base = rgb(x, y, c)
      const tint = engraved ? base + (ENGRAVING_TINT[c] - base) * 0.42 : base
      tints[v * 4 + c] = Math.round(linear(Math.min(tint, 1)) * 65535)
    }
    tints[v * 4 + 3] = 65535
  }
  const indices = []
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    const p = (i) => positions.slice(i * 3, i * 3 + 3)
    const [pa, pb, pc] = [p(a), p(b), p(c)]
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]]
    const w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]]
    const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const outward =
      f[0] * normals[a * 3] + f[1] * normals[a * 3 + 1] + f[2] * normals[a * 3 + 2] > 0
    if (outward) indices.push(a, b, c, a, c, d)
    else indices.push(a, c, b, a, d, c)
  }
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const o = field[id(i, j, k)] < 0
        const c = (a, b, d) => cell[id(a, b, d)]
        if (o !== field[id(i + 1, j, k)] < 0) {
          quad(c(i, j - 1, k - 1), c(i, j, k - 1), c(i, j, k), c(i, j - 1, k))
        }
        if (o !== field[id(i, j + 1, k)] < 0) {
          quad(c(i - 1, j, k - 1), c(i, j, k - 1), c(i, j, k), c(i - 1, j, k))
        }
        if (o !== field[id(i, j, k + 1)] < 0) {
          quad(c(i - 1, j - 1, k), c(i, j - 1, k), c(i, j, k), c(i - 1, j, k))
        }
      }
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals,
    tints,
    indices: Uint32Array.from(indices),
  }
}

function glb({ positions, normals, tints, indices }) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i])
    max[i % 3] = Math.max(max[i % 3], positions[i])
  }
  const chunks = [positions, normals, tints, indices]
  let offset = 0
  const views = chunks.map((b, i) => {
    const target = i === 3 ? 34963 : 34962
    const view = { buffer: 0, byteOffset: offset, byteLength: b.byteLength, target }
    offset += Math.ceil(b.byteLength / 4) * 4
    return view
  })
  const n = positions.length / 3
  const json = {
    asset: { version: '2.0', generator: 'brand/build.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Chirographe', mesh: 0 }],
    meshes: [
      {
        name: 'Key',
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 },
        ],
      },
    ],
    materials: [
      {
        name: 'Material',
        pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.35 },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, normalized: true, count: n, type: 'VEC4' },
      { bufferView: 3, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  }
  const text = Buffer.from(JSON.stringify(json))
  const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)])
  const binary = Buffer.alloc(offset)
  chunks.forEach((b, i) =>
    Buffer.from(b.buffer, b.byteOffset, b.byteLength).copy(binary, views[i].byteOffset),
  )
  const chunk = (type, data) => {
    const h = Buffer.alloc(8)
    h.writeUInt32LE(data.length, 0)
    h.writeUInt32LE(type, 4)
    return Buffer.concat([h, data])
  }
  const body = Buffer.concat([chunk(0x4e4f534a, jsonChunk), chunk(0x004e4942, binary)])
  const head = Buffer.alloc(12)
  head.writeUInt32LE(0x46546c67, 0)
  head.writeUInt32LE(2, 4)
  head.writeUInt32LE(12 + body.length, 8)
  return Buffer.concat([head, body])
}

// --- Generation ---

mkdirSync(DIST, { recursive: true })
const nav = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
for (const [name, mode] of [
  ['chirographe-icon', 1],
  ['chirographe-logo', 0],
]) {
  for (const size of [1024, 2048]) {
    writeFileSync(join(DIST, `${name}-${size}.png`), await image(nav, size, mode))
    writeFileSync(join(DIST, `${name}-angle-${size}.png`), await angleImage(nav, size, mode))
  }
}
const data = await fields(nav)
await nav.close()
writeFileSync(join(DIST, 'chirographe.svg'), svg(data))
const m = buildMesh(data)
writeFileSync(join(DIST, 'chirographe.glb'), glb(m))
console.log(
  `dist/ is up to date: ${m.positions.length / 3} vertices, ${m.indices.length / 3} triangles`,
)
