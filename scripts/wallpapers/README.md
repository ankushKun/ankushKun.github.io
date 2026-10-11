# Desktop pictures

The pictures offered in System Preferences > Desktop are listed in
`data/wallpapers.yaml`. Apart from the original `wallpaper.webp` (Aurora),
they are drawn by `wallpapers.html` in this folder with the canvas API and a
fixed seed, so they are original artwork and re-exporting gives the same
image.

## Exporting one

1. Open `wallpapers.html?id=<id>` (for example `?id=wave`) in Chrome with a
   2560x1600 viewport, or use headless Chrome:

   ```sh
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
     --window-size=2560,1600 --hide-scrollbars --screenshot=wave.png \
     "file://$PWD/scripts/wallpapers/wallpapers.html?id=wave"
   ```

2. Encode the full-size picture and its 320x200 thumbnail:

   ```sh
   cwebp -q 90 -m 6 -sharp_yuv -sns 0 -f 0 wave.png -o static/wallpapers/wave.webp
   sips -z 200 320 wave.png --out wave-thumb.png
   cwebp -q 82 wave-thumb.png -o static/wallpapers/thumbs/wave.webp
   ```

   Quality 90 with filtering off keeps the film grain, which is what stops
   the gradients from banding.

3. Add (or update) the entry in `data/wallpapers.yaml`, with `color` set to the
   picture's average colour. That colour is painted while the image loads.

## Adding a new picture

Add a function to the `ART` object in `wallpapers.html`, export it as above and
give it a new `id` in `data/wallpapers.yaml`. Never rename an existing `id`:
it is what visitors have saved in their preferences.
