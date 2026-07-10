# Sketch Summary Export

Seçili page/artboard'un **LLM-dostu, küçük** özet JSON'ını üretir. Sketch'in kendi
JSON'unun aksine bileşen içlerine girmez — kit'ten gelen bileşen bir kara kutudur.

## Kurulum

`sketch-summary-export.sketchplugin` dosyasına çift tıkla (Sketch kurulu makinede).

## Kullanım

1. Bir artboard/frame (veya birkaç layer) seç — hiçbir şey seçmezsen **tüm page** alınır.
2. **Plugins ▸ Summary Export ▸ Copy Summary JSON** (`⌃⌥⌘J`) → panoya kopyalar.
   Dosya olarak istersen **Save Summary JSON…** (`⌃⌥⌘⇧J`).

Sketch **2025.1 "Athens" ve sonrası** hedeflenir: Frames/Graphics, Stack Layout ve
yeni Swatch API'leri kullanılır (eski sürümler için geometrik fallback korunur).

## Çıktıda ne var

- **`component`** düğümleri (symbol instance): master adı, isimden ayrıştırılan
  proplar (`Size=lg` gibi `key=value` segmentleri), default olmayan override'lar
  (metin içerikleri, symbol swap'leri, stil değişimleri), tint. **İç yapısı yok.**
- **`frame` / `graphic` / `group`** düğümleri:
  - Container bir **Stack** ise layout doğrudan API'den okunur (tahmin yok):
    `layout` (`row`/`column`), `gap`, `padding`, `align` (align-items),
    `justify` (justify-content, CSS adlarıyla: `space-between` vb.),
    `wrap`/`crossAxisGap` (sarmalı stack'lerde).
  - Stack değilse geometriden flexbox çıkarımı yapılır ve `layoutSource:
    "inferred"` işaretlenir: `layout` (`column`/`row`/`absolute`), `gap`
    (eşitse tek sayı, değilse dizi), `padding`, `align`.
  - Her iki durumda da çocuklar görsel sıraya göre dizilir.
  - Stack içindeki çocuklarda `sizing: {w/h: "fill"|"fit"|"relative"}` ve
    `ignoresLayout` (stack'i yok sayan absolute eleman) bilgisi bulunur.
- **`shape`** (Paper/Box gibi ham kutular): `fill`/`border` **color token adı** —
  önce fill'e bağlı color variable (`fill.swatch`), yoksa hex üzerinden doküman
  color variable eşleşmesi, o da yoksa hex. `radius` (yeni `style.corners`
  API'sinden), shared style adı.
- **`text`**: içerik, text style adı (yoksa font size/weight), renk tokenı
  (`textSwatch` color variable adı öncelikli).
- Frame arka planları yeni modele göre `style.fills` üzerinden okunur.
- Gizli layer'lar, hotspot/slice'lar atlanır.

## Örnek çıktı

```json
{
 "type": "frame", "name": "Checkout", "frame": {"x": 0, "y": 0, "w": 390, "h": 844},
 "background": "Surface/Default",
 "layout": "column", "gap": 16, "align": "start",
 "padding": {"top": 24, "right": 20, "bottom": 32, "left": 20},
 "children": [
  {"type": "component", "component": "Kit/AppBar", "props": {"Variant": "Back"},
   "overrides": {"Title": "Ödeme"}, "frame": {"x": 20, "y": 24, "w": 350, "h": 56}},
  {"type": "component", "component": "Kit/TextField",
   "overrides": {"Label": "Kart numarası"}, "frame": {"x": 20, "y": 96, "w": 350, "h": 64}},
  {"type": "component", "component": "Kit/Button", "props": {"Size": "lg", "State": "default"},
   "overrides": {"Label": "Devam et"}, "frame": {"x": 20, "y": 176, "w": 350, "h": 48}}
 ]
}
```

## Notlar

- Stack olmayan container'larda layout geometriden çıkarılır (3px tolerans).
  Üst üste binen serbest yerleşimlerde `layout: "absolute"` döner, frame'ler
  zaten her düğümde var.
- Bir hata olursa artık sessizce yutulmaz: hata mesajı + stack trace alert
  olarak gösterilir.
- Script'i düzenledikten sonra Sketch'te tekrar çalıştırman yeterli; menü/manifest
  değişikliği için Sketch'i yeniden başlat.
