/* Summary Export — seçili page/frame'in LLM-dostu özet JSON'ı.
 *
 * Ne üretir:
 *  - Symbol instance'lar: bileşen adı, isimden ayrıştırılan proplar (key=value),
 *    default olmayan override'lar (metin, swap, stil), frame. İç yapısına GİRMEZ.
 *  - Container'lar (artboard/group): flexbox çıkarımı — row/column, gap, padding, align.
 *  - Shape/Text: color token (document color variable eşleşmesi) veya hex, shared style adı.
 *
 * Kullanım: bir artboard/frame seç (ya da hiçbir şey seçme = tüm page),
 * Plugins ▸ Summary Export ▸ Copy Summary JSON.
 */

var sketch = require('sketch')
var UI = require('sketch/ui')

var TOL = 3 // px toleransı: overlap / hizalama / gap eşitliği kontrolleri

function onCopy() { run('clipboard') }
function onSave() { run('file') }

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
  try {
    if (!layer || layer.hidden) return null
    switch (layer.type) {
      case 'Page': return summarizePage(layer, ctx)
      case 'Artboard':
      case 'SymbolMaster': return summarizeContainer(layer, ctx, true)
      case 'Group': return summarizeContainer(layer, ctx, false)
      case 'SymbolInstance': return summarizeInstance(layer, ctx)
      case 'Text': return summarizeText(layer, ctx)
      case 'Shape':
      case 'ShapePath': return summarizeShape(layer, ctx)
      case 'Image': return { type: 'image', name: String(layer.name), frame: frameOf(layer) }
      default: return null // HotSpot, Slice vs.
    }
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

function summarizeContainer(layer, ctx, isArtboard) {
  var kids = []
  layer.layers.forEach(function (ch) {
    var s = summarize(ch, ctx)
    if (s) kids.push(s)
  })
  var node = {
    type: isArtboard ? 'frame' : 'group',
    name: String(layer.name),
    frame: frameOf(layer)
  }
  if (isArtboard) {
    try {
      if (layer.background && layer.background.enabled) {
        node.background = token(layer.background.color, ctx)
      }
    } catch (e) {}
  }
  attachLayout(node, kids, layer.frame.width, layer.frame.height)
  return node
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

  // instance üstüne uygulanmış tint
  try {
    var fills = layer.style && layer.style.fills
    if (fills && fills.length) {
      var on = fills.filter(function (f) { return f.enabled !== false && f.fillType === 'Color' })
      if (on.length) node.tint = token(on[on.length - 1].color, ctx)
    }
  } catch (e) {}

  return node
}

function summarizeText(layer, ctx) {
  var node = { type: 'text', text: String(layer.text), frame: frameOf(layer) }
  try { if (layer.sharedStyle) node.textStyle = String(layer.sharedStyle.name) } catch (e) {}
  try {
    var st = layer.style
    if (st) {
      if (!node.textStyle) node.font = { size: st.fontSize, weight: st.fontWeight }
      if (st.textColor) node.color = token(st.textColor, ctx)
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
      var fills = (st.fills || []).filter(function (f) { return f.enabled !== false && f.fillType === 'Color' })
      if (fills.length) node.fill = token(fills[fills.length - 1].color, ctx)
      var borders = (st.borders || []).filter(function (b) { return b.enabled !== false && b.fillType === 'Color' })
      if (borders.length) {
        var b = borders[borders.length - 1]
        node.border = { color: token(b.color, ctx), width: b.thickness }
      }
    }
  } catch (e) {}
  try {
    if (layer.type === 'ShapePath' && layer.points && layer.points.length) {
      var r = layer.points[0].cornerRadius
      if (r) node.radius = r
    }
  } catch (e) {}
  return node
}

/* ---------- layout çıkarımı (flexbox) ---------- */

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

// "Button/Primary, Size=lg, State=hover" -> component + props
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

// document color variable'ları (kütüphaneden gelenler dahil) hex -> token adı
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
