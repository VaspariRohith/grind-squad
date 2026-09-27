// Generates the app icons in /public from one SVG. Run: node scripts/make-icons.mjs
import sharp from "sharp";
const svg = (pad) => Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff4d8d"/><stop offset="1" stop-color="#ff9a3d"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="#09090f"/>
  <rect x="${pad}" y="${pad}" width="${512 - 2 * pad}" height="${512 - 2 * pad}" rx="${(512 - 2 * pad) * 0.28}" fill="url(#g)"/>
  <g transform="translate(256 262) scale(${(512 - 2 * pad) / 512 * 11}) translate(-12 -12)" fill="rgba(255,255,255,0.25)" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>
  </g>
</svg>`);
await sharp(svg(0)).resize(512).png().toFile("public/icon-512.png");
await sharp(svg(0)).resize(192).png().toFile("public/icon-192.png");
await sharp(svg(0)).resize(180).png().toFile("public/apple-touch-icon.png");
await sharp(svg(0)).resize(48).png().toFile("app/icon.png");
console.log("icons done");
