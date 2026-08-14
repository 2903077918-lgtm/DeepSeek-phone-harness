// PWA icon integration script - replaces old favicon with black-gold Harness whale icon
const fs = require('fs');
const path = 'C:/Users/Joey/Documents/phone-harness/web/index.html';
let html = fs.readFileSync(path, 'utf8');

// Generate SVG data URL from source file
const svg = fs.readFileSync('C:/Users/Joey/Documents/phone-harness/design/icon-source-blackgold.svg', 'utf8');
const svgB64 = Buffer.from(svg).toString('base64');
const svgDataUrl = `data:image/svg+xml;base64,${svgB64}`;

// Generate PNG data URL for apple-touch-icon (512x512)
const png = fs.readFileSync('C:/Users/Joey/Documents/phone-harness/design/icon-512.png');
const pngB64 = png.toString('base64');
const pngDataUrl = `data:image/png;base64,${pngB64}`;

// New head section with PWA manifest + black-gold icons
const newHead = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="theme-color" content="#0A0A0A">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Harness Relay">
<meta name="description" content="DeepSeek Harness Relay —— 手机远程控制电脑上的 DSH Agent">
<meta name="format-detection" content="telephone=no">
<!-- PWA Manifest -->
<link rel="manifest" href="data:application/json;base64,${Buffer.from(JSON.stringify({
  name: "DeepSeek Harness Relay",
  short_name: "Harness",
  start_url: "/",
  display: "standalone",
  background_color: "#0A0A0A",
  theme_color: "#0A0A0A",
  icons: [
    { src: svgDataUrl, sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" },
    { src: pngDataUrl, sizes: "512x512", type: "image/png", purpose: "any maskable" }
  ]
})).toString('base64')}">
<title>deepseekharness-relay · 控制台 v2</title>
<!-- 黑金版图标（基于 DeepSeek Harness Logo 设计：鲸鱼+金色边框） -->
<link rel="icon" type="image/svg+xml" href="${svgDataUrl}">
<link rel="apple-touch-icon" sizes="180x180" href="${pngDataUrl}">`;

// Replace lines 1-14 with new head
const lines = html.split('\n');
lines.splice(0, 14, ...newHead.split('\n'));
html = lines.join('\n');

fs.writeFileSync(path, html, 'utf8');
console.log('PWA icons integrated. Head length:', newHead.length);
console.log('SVG data URL length:', svgDataUrl.length);
console.log('PNG data URL length:', pngDataUrl.length);
