# Sketch Summary Export

Seçili page/artboard'un **LLM-dostu, küçük** özet JSON'ını üretir. Sketch'in kendi
JSON'unun aksine bileşen içlerine girmez — kit'ten gelen bileşen bir kara kutudur.

## Kurulum

`sketch-summary-export.sketchplugin` dosyasına çift tıkla (Sketch kurulu makinede).

## Kullanım

1. Bir artboard/frame (veya birkaç layer) seç — hiçbir şey seçmezsen **tüm page** alınır.
2. **Plugins ▸ Summary Export ▸ Copy Summary JSON** (`⌃⌥⌘J`) → panoya kopyalar.
   Dosya olarak istersen **Save Summary JSON…** (`⌃⌥⌘⇧J`).

## Çıktıda ne var

- **`component`** düğümleri (symbol instance): master adı, isimden ayrıştırılan
  proplar (`Size=lg` gibi `key=value` segmentleri), default olmayan override'lar
  (metin içerikleri, symbol swap'leri, stil değişimleri), tint. **İç yapısı yok.**
- **`frame` / `group`** düğümleri: flexbox çıkarımı —
  - `layout`: `column` | `row` | `absolute`
  - `gap`: çocuklar arası boşluk (eşitse tek sayı, değilse dizi)
  - `padding`: `{top, right, bottom, left}` container kenarlarından
  - `align`: çapraz eksen hizası (`start`/`center`/`end`/`mixed`)
  - `column`/`row` durumunda çocuklar görsel sıraya göre dizilir.
- **`shape`** (Paper/Box gibi ham kutular): `fill`/`border` **color token adı**
  (document color variable eşleşirse; yoksa hex), `radius`, shared style adı.
- **`text`**: içerik, text style adı (yoksa font size/weight), renk tokenı.
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

- Layout çıkarımı geometriden yapılır (3px tolerans). Üst üste binen serbest
  yerleşimlerde `layout: "absolute"` döner, frame'ler zaten her düğümde var.
- Color token eşleşmesi dokümandaki (kütüphaneden gelenler dahil) color
  variable'ların hex değerleri üzerinden yapılır.
- Script'i düzenledikten sonra Sketch'te tekrar çalıştırman yeterli; menü/manifest
  değişikliği için Sketch'i yeniden başlat.
