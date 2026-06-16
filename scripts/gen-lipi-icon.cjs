// Phase A placeholder icon generator.
// Creates a 1024x1024 PNG: a flat "L" letterform on a
// brand-color background. This is a placeholder — the
// project lead replaces it with the real Lipi logo
// before the first store submission.
//
// Used by `cargo tauri icon` to generate the full
// platform icon set (desktop, iOS, Android).
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const W = 1024, H = 1024;
// Lipi brand color: deep blue.
const BG = [0x1f, 0x6f, 0xeb];
const FG = [0xff, 0xff, 0xff];

const png = new PNG({ width: W, height: H });
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (W * y + x) << 2;
    png.data[idx] = BG[0]; png.data[idx + 1] = BG[1];
    png.data[idx + 2] = BG[2]; png.data[idx + 3] = 0xff;
    // The "L" — vertical bar (x 280..440, y 280..744) +
    // horizontal bar (x 280..744, y 660..744).
    const inVertical = x >= 280 && x < 440 && y >= 280 && y < 744;
    const inHorizontal = x >= 280 && x < 744 && y >= 660 && y < 744;
    if (inVertical || inHorizontal) {
      png.data[idx] = FG[0]; png.data[idx + 1] = FG[1];
      png.data[idx + 2] = FG[2]; png.data[idx + 3] = 0xff;
    }
  }
}

const out = path.resolve(
  __dirname, "..", "src-tauri", "icons", "lipi-icon-1024.png"
);
fs.mkdirSync(path.dirname(out), { recursive: true });
png.pack().pipe(fs.createWriteStream(out))
  .on("finish", () => {
    console.log(`Wrote ${out}`);
  });
