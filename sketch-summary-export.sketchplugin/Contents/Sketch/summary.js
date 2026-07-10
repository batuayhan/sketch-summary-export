/* Summary Export — seçili page/frame'in LLM-dostu özet JSON'ı.
 * Sketch 2025.1 "Athens" ve sonrası (Frames, Stacks, yeni Swatch API) hedeflenir.
 *
 * Ne üretir:
 *  - Symbol instance'lar: bileşen adı, isimden ayrıştırılan proplar (key=value),
 *    default olmayan override'lar (metin, swap, stil), tint. İç yapısına GİRMEZ.
 *  - Container'lar (Frame/Graphic/Group): Stack Layout varsa GERÇEK layout
 *    (direction/gap/padding/align/justify) doğrudan API'den okunur; yoksa
 *    geometriden flexbox çıkarımı yapılır.
 *  - Shape/Text: color token (fill.swatch / textSwatch color variable adı,
 *    yoksa hex), shared style adı, corner radius.
 *
 * Kullanım: bir frame seç (ya da hiçbir şey seçme = tüm page),
 * Plugins ▸ Summary Export ▸ Copy Summary JSON.
 */

var sketch = require('sketch')
var UI = require('sketch/ui')

var TOL = 3 // px toleransı: geometrik fallback'te overlap / hizalama / gap kontrolleri

function onCopy() { safeRun('clipboard') }
function onSave() { safeRun('file') }

function safeRun(dest) {
  try {
    run(dest)
  } catch (e) {
    UI.alert('Summary Export hatası', String(e) + '\n' + (e && e.stack ? e.stack : ''))
  }
}

function run(dest) {
  var doc = sketch.getSelectedDocument()
  if (!doc) { UI.message('Açık doküman yok'); return }

  var ctx = { doc: doc, swatches: buildSwatchMap(doc) }

  var targets = doc.selectedLayers ? doc.selectedLayers.layers : []
  if (!targets || targets.length === 0) targets = [doc.selectedPage]

  var out = []
  targets.forEach(function (l) {
    var s = summarize(l, ctx)
    if (s) out.push(s)
  })
  var result = out.length === 1 ? out[0] : out
  var json = JSON.stringify(result, null, 1)

  if (dest === 'file') {
    var panel = NSSavePanel.savePanel()
    panel.setNameFieldStringValue(safeName(targets[0]) + '.summary.json')
    if (panel.runModal() == NSModalResponseOK) {
      NSString.stringWithString(json)
        .writeToFile_atomically_encoding_error(panel.URL().path(), true, NSUTF8StringEncoding, null)
      UI.message('Kaydedildi: ' + panel.URL().path())
    }
  } else {
    var pb = NSPasteboard.generalPasteboard()
    pb.clearContents()
    pb.setString_forType(json, NSPasteboardTypeString)
    UI.message('Özet JSON panoya kopyalandı — ' + Math.round(json.length / 102.4) / 10 + ' KB')
  }
}

function safeName(layer) {
  try { return String(layer.name).replace(/[\/:]/g, '-') } catch (e) { return 'summary' }
}

/* ---------- özetleyiciler ---------- */

function summarize(layer, ctx) {
  var node = null
  try {
    if (!layer || layer.hidden) return null
    switch (layer.type) {
      case 'Page':
        return summarizePage(layer, ctx)
      case 'Artboard': // yeni Sketch'te top-level Frame/Graphic da 'Artboard' döner
      case 'SymbolMaster':
      case 'Group':
        node = summarizeContainer(layer, ctx)
        break
      case 'SymbolInstance':
        node = summarizeInstance(layer, ctx)
        break
      case 'Text':
        node = summarizeText(layer, ctx)
        break
      case 'Shape':
      case 'ShapePath':
        node = summarizeShape(layer, ctx)
        break
      case 'Image':
        node = { type: 'image', name: String(layer.name), frame: frameOf(layer) }
        break
      default:
        return null // HotSpot, Slice vs.
    }
    if (node) addStackItemInfo(node, layer)
    return node
  } catch (e) {
    return { type: 'error', name: layer ? String(layer.name) : '?', error: String(e) }
  }
}

function summarizePage(page, ctx) {
  var kids = []
  page.layers.forEach(function (l) {
    var s = summarize(l, ctx)
    if (s) kids.push(s)
  })
  return { type: 'page', name: String(page.name), children: kids }
}

function summarizeContainer(layer, ctx) {
  var kids = []
  layer.layers.forEach(function (ch) {
    var s = summarize(ch, ctx)
    if (s) kids.push(s)
  })
  var node = { type: containerKind(layer), name: String(layer.name), frame: frameOf(layer) }

  var bg = containerBackground(layer, ctx)
  if (bg) node.background = bg
  var radius = cornersOf(layer)
  if (radius !== undefined) node.radius = radius

  var st = null
  try { st = layer.stackLayout } catch (e) {}
  if (st) {
    applyStackLayout(node, st, kids)
  } else {
    attachLayout(node, kids, layer.frame.width, layer.frame.height)
  }
  return node
}

// Gerçek Stack Layout verisi — tahmin yok
function applyStackLayout(node, st, kids) {
  node.layout = String(st.direction) === 'Row' ? 'row' : 'column'
  try { if (typeof st.gap === 'number') node.gap = st.gap } catch (e) {}
  var pad = normPadding(st.padding)
  if (pad) node.padding = pad
  try { if (st.alignItems) node.align = cssEnum(st.alignItems) } catch (e) {}
  try { if (st.justifyContent) node.justify = cssEnum(st.justifyContent) } catch (e) {}
  try {
    if (st.wraps) {
      node.wrap = true
      if (st.crossAxisGap) node.crossAxisGap = st.crossAxisGap
      if (st.alignContent) node.alignContent = cssEnum(st.alignContent)
    }
  } catch (e) {}
  // çocukları ana eksene göre görsel sıraya diz
  var pos = node.layout === 'row' ? 'x' : 'y'
  var framed = kids.filter(function (k) { return k.frame })
  var rest = kids.filter(function (k) { return !k.frame })
  framed.sort(function (a, b) { return a.frame[pos] - b.frame[pos] })
  node.children = framed.concat(rest)
}

function containerKind(layer) {
  try { if (layer.isGraphicFrame) return 'graphic' } catch (e) {}
  try { if (layer.isFrame) return 'frame' } catch (e) {}
  try {
    var GB = require('sketch/dom').GroupBehavior
    if (GB) {
      if (layer.groupBehavior === GB.Frame) return 'frame'
      if (GB.Graphic !== undefined && layer.groupBehavior === GB.Graphic) return 'graphic'
    }
  } catch (e) {}
  if (layer.type === 'Artboard' || layer.type === 'SymbolMaster') return 'frame'
  return 'group'
}

// Frame arka planı artık style.fills; legacy Artboard.background fallback
function containerBackground(layer, ctx) {
  try {
    var fills = layer.style && layer.style.fills
    if (fills && fills.length) {
      var on = fills.filter(function (f) { return f.enabled !== false && String(f.fillType) === 'Color' })
      if (on.length) return fillToken(on[on.length - 1], ctx)
    }
  } catch (e) {}
  try {
    if (layer.background && layer.background.enabled) return token(layer.background.color, ctx)
  } catch (e) {}
  return undefined
}

function summarizeInstance(layer, ctx) {
  var masterName = String(layer.name)
  try {
    if (layer.master && layer.master.name) masterName = String(layer.master.name)
  } catch (e) {}

  var parsed = parseComponentName(masterName)
  var node = { type: 'component', component: parsed.component, frame: frameOf(layer) }
  if (parsed.props) node.props = parsed.props
  if (String(layer.name) !== masterName) node.name = String(layer.name)

  var ovs = {}
  var hasOv = false
  try {
    layer.overrides.forEach(function (o) {
      if (!o || o.isDefault) return
      var key = o.affectedLayer ? String(o.affectedLayer.name) : String(o.property)
      if (o.property === 'stringValue') {
        ovs[key] = String(o.value); hasOv = true
      } else if (o.property === 'symbolID') {
        if (!o.value) { ovs[key] = null } // instance içinde gizlenmiş parça
        else {
          var m = null
          try { m = ctx.doc.getSymbolMasterWithID(o.value) } catch (e) {}
          ovs[key] = m ? '→ ' + String(m.name) : 'swapped'
        }
        hasOv = true
      } else if (o.property === 'layerStyle' || o.property === 'textStyle') {
        var pool = o.property === 'layerStyle' ? ctx.doc.sharedLayerStyles : ctx.doc.sharedTextStyles
        var st = null
        try { pool.forEach(function (s) { if (String(s.id) === String(o.value)) st = s }) } catch (e) {}
        ovs[key + ':style'] = st ? String(st.name) : String(o.value)
        hasOv = true
      } else if (o.property === 'fillColor') {
        ovs[key + ':fill'] = token(o.value, ctx); hasOv = true
      }
      // image override vb. atlanır — özet için gereksiz
    })
  } catch (e) {}
  if (hasOv) node.overrides = ovs

  // instance üstüne uygulanmış tint (yeni API: style.tint bir Fill objesi)
  try {
    if (layer.style && layer.style.tint) node.tint = fillToken(layer.style.tint, ctx)
  } catch (e) {}
  if (!node.tint) {
    try {
      var fills = layer.style && layer.style.fills
      if (fills && fills.length) {
        var on = fills.filter(function (f) { return f.enabled !== false && String(f.fillType) === 'Color' })
        if (on.length) node.tint = fillToken(on[on.length - 1], ctx)
      }
    } catch (e) {}
  }

  return node
}

function summarizeText(layer, ctx) {
  var node = { type: 'text', text: String(layer.text), frame: frameOf(layer) }
  try { if (layer.sharedStyle) node.textStyle = String(layer.sharedStyle.name) } catch (e) {}
  try {
    var st = layer.style
    if (st) {
      if (!node.textStyle) node.font = { size: st.fontSize, weight: st.fontWeight }
      if (st.textSwatch && st.textSwatch.name) node.color = String(st.textSwatch.name)
      else if (st.textColor) node.color = token(st.textColor, ctx)
    }
  } catch (e) {}
  return node
}

function summarizeShape(layer, ctx) {
  var node = { type: 'shape', name: String(layer.name), frame: frameOf(layer) }
  try { if (layer.sharedStyle) node.style = String(layer.sharedStyle.name) } catch (e) {}
  try {
    var st = layer.style
    if (st) {
      var fills = (st.fills || []).filter(function (f) { return f.enabled !== false && String(f.fillType) === 'Color' })
      if (fills.length) node.fill = fillToken(fills[fills.length - 1], ctx)
      var borders = (st.borders || []).filter(function (b) { return b.enabled !== false && String(b.fillType) === 'Color' })
      if (borders.length) {
        var b = borders[borders.length - 1]
        node.border = { color: fillToken(b, ctx), width: b.thickness }
      }
    }
  } catch (e) {}
  var radius = cornersOf(layer)
  if (radius !== undefined) node.radius = radius
  return node
}

/* ---------- stack item bilgisi (FlexSizing / ignoresStackLayout) ---------- */

function addStackItemInfo(node, layer) {
  try {
    var h = layer.horizontalSizing
    var v = layer.verticalSizing
    var sizing = {}
    var has = false
    if (h && String(h) !== 'Fixed') { sizing.w = String(h).toLowerCase(); has = true }
    if (v && String(v) !== 'Fixed') { sizing.h = String(v).toLowerCase(); has = true }
    if (has) node.sizing = sizing
  } catch (e) {}
  try { if (layer.ignoresStackLayout) node.ignoresLayout = true } catch (e) {}
}

/* ---------- layout çıkarımı: stack olmayan container'lar için fallback ---------- */

function attachLayout(node, kids, w, h) {
  node.children = kids
  var framed = kids.filter(function (k) { return k.frame })
  if (framed.length === 0) return

  var minX = Infinity, minY = Infinity, maxR = -Infinity, maxB = -Infinity
  framed.forEach(function (k) {
    if (k.frame.x < minX) minX = k.frame.x
    if (k.frame.y < minY) minY = k.frame.y
    if (k.frame.x + k.frame.w > maxR) maxR = k.frame.x + k.frame.w
    if (k.frame.y + k.frame.h > maxB) maxB = k.frame.y + k.frame.h
  })
  node.padding = {
    top: Math.round(minY),
    right: Math.round(w - maxR),
    bottom: Math.round(h - maxB),
    left: Math.round(minX)
  }

  if (framed.length < 2) return

  var byY = framed.slice().sort(function (a, b) { return a.frame.y - b.frame.y })
  var byX = framed.slice().sort(function (a, b) { return a.frame.x - b.frame.x })
  var col = isStacked(byY, 'y', 'h')
  var row = isStacked(byX, 'x', 'w')

  if (col && !row) {
    node.layout = 'column'
    node.gap = gapsOf(byY, 'y', 'h')
    node.align = crossAlign(byY, 'x', 'w')
    node.children = reorder(kids, byY)
  } else if (row) {
    node.layout = 'row'
    node.gap = gapsOf(byX, 'x', 'w')
    node.align = crossAlign(byX, 'y', 'h')
    node.children = reorder(kids, byX)
  } else {
    node.layout = 'absolute' // üst üste / serbest yerleşim; frame'ler zaten mevcut
  }
  node.layoutSource = 'inferred' // gerçek Stack değil, geometriden tahmin
}

// sıralı çocuklar ana eksende üst üste binmiyor mu?
function isStacked(sorted, pos, size) {
  for (var i = 1; i < sorted.length; i++) {
    var prev = sorted[i - 1].frame
    var cur = sorted[i].frame
    if (cur[pos] < prev[pos] + prev[size] - TOL) return false
  }
  return true
}

// ardışık boşluklar; hepsi eşitse tek sayı, değilse dizi
function gapsOf(sorted, pos, size) {
  var gaps = []
  for (var i = 1; i < sorted.length; i++) {
    var prev = sorted[i - 1].frame
    gaps.push(Math.round(sorted[i].frame[pos] - (prev[pos] + prev[size])))
  }
  var uniform = true
  for (var j = 1; j < gaps.length; j++) {
    if (Math.abs(gaps[j] - gaps[0]) > 1) { uniform = false; break }
  }
  return uniform ? gaps[0] : gaps
}

// çapraz eksende hizalama: hepsi aynı sol/orta/sağ çizgide mi?
function crossAlign(sorted, pos, size) {
  var starts = sorted.map(function (k) { return k.frame[pos] })
  var centers = sorted.map(function (k) { return k.frame[pos] + k.frame[size] / 2 })
  var ends = sorted.map(function (k) { return k.frame[pos] + k.frame[size] })
  if (allClose(starts)) return 'start'
  if (allClose(centers)) return 'center'
  if (allClose(ends)) return 'end'
  return 'mixed'
}

function allClose(nums) {
  for (var i = 1; i < nums.length; i++) {
    if (Math.abs(nums[i] - nums[0]) > TOL) return false
  }
  return true
}

function reorder(all, sortedFramed) {
  var rest = all.filter(function (k) { return !k.frame })
  return sortedFramed.concat(rest)
}

/* ---------- yardımcılar ---------- */

function frameOf(layer) {
  var f = layer.frame
  return { x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.width), h: Math.round(f.height) }
}

// StackLayout.padding: sayı | {vertical, horizontal} | {top,right,bottom,left} karışımı
function normPadding(p) {
  if (p === null || p === undefined) return undefined
  if (typeof p === 'number') return { top: p, right: p, bottom: p, left: p }
  function edge(individual, axis) {
    if (typeof individual === 'number') return individual
    if (typeof axis === 'number') return axis
    return 0
  }
  return {
    top: edge(p.top, p.vertical),
    right: edge(p.right, p.horizontal),
    bottom: edge(p.bottom, p.vertical),
    left: edge(p.left, p.horizontal)
  }
}

// Sketch enum adları → CSS karşılıkları
function cssEnum(v) {
  var s = String(v).toLowerCase()
  if (s === 'between') return 'space-between'
  if (s === 'around') return 'space-around'
  if (s === 'evenly') return 'space-evenly'
  return s // start, center, end, stretch, none
}

// "Kit/Button, Size=lg, State=hover" -> component + props
function parseComponentName(name) {
  var segs = String(name).split(',')
  var base = [segs[0]]
  var props = null
  for (var i = 1; i < segs.length; i++) {
    var s = segs[i].trim()
    var eq = s.indexOf('=')
    if (eq > -1) {
      if (!props) props = {}
      props[s.slice(0, eq).trim()] = s.slice(eq + 1).trim()
    } else {
      base.push(s)
    }
  }
  return { component: base.join(', ').trim(), props: props }
}

// Yeni corners API'si (style.corners.radii); eski points fallback'i
function cornersOf(layer) {
  try {
    var c = layer.style && layer.style.corners
    if (c && c.radii !== undefined && c.radii !== null) {
      if (typeof c.radii === 'number') return c.radii || undefined
      if (c.radii.length) {
        var first = c.radii[0]
        var uniform = true
        for (var i = 1; i < c.radii.length; i++) {
          if (c.radii[i] !== first) { uniform = false; break }
        }
        var val = uniform ? first : Array.prototype.slice.call(c.radii)
        return val || undefined
      }
    }
  } catch (e) {}
  try {
    if (layer.type === 'ShapePath' && layer.points && layer.points.length) {
      var r = layer.points[0].cornerRadius
      if (r) return r
    }
  } catch (e) {}
  return undefined
}

// Fill/Border: önce bağlı color variable (swatch), yoksa hex-map, yoksa hex
function fillToken(f, ctx) {
  try {
    if (f.swatch && f.swatch.name) return String(f.swatch.name)
  } catch (e) {}
  return token(f.color, ctx)
}

// dokümandaki color variable'lar (kütüphaneden gelenler dahil) hex -> token adı
function buildSwatchMap(doc) {
  var map = {}
  try {
    doc.swatches.forEach(function (s) {
      var hex = String(s.color).toLowerCase()
      map[hex] = String(s.name)
      if (hex.length === 9 && hex.slice(7) === 'ff') map[hex.slice(0, 7)] = String(s.name)
    })
  } catch (e) {}
  return map
}

function token(color, ctx) {
  var hex = String(color || '').toLowerCase()
  if (ctx.swatches[hex]) return ctx.swatches[hex]
  if (hex.length === 9 && hex.slice(7) === 'ff' && ctx.swatches[hex.slice(0, 7)]) {
    return ctx.swatches[hex.slice(0, 7)]
  }
  return hex
}
