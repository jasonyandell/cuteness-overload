// Canvas-baked textures: cute enemy faces and a soft round sprite for effects.
// Built once at startup — no per-frame allocation.

import * as THREE from 'three';

function hexStr(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

/**
 * Bake a pastel body color with a googly-eyed smiling face into a texture.
 * Applied as the material `map` of an enemy geometry, so every visible facet
 * shows an adorable little face at a glance.
 */
export function makeFaceTexture(bodyColor: number): THREE.CanvasTexture {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;

  // Body fill.
  g.fillStyle = hexStr(bodyColor);
  g.fillRect(0, 0, s, s);

  const cx = s / 2;
  const eyeY = s * 0.43;
  const eyeDx = s * 0.21;
  const eyeR = s * 0.21; // huge googly eyes

  // Rosy cheeks.
  g.fillStyle = 'rgba(255,110,150,0.45)';
  g.beginPath();
  g.arc(cx - eyeDx * 1.5, eyeY + eyeR * 1.5, eyeR * 0.75, 0, Math.PI * 2);
  g.arc(cx + eyeDx * 1.5, eyeY + eyeR * 1.5, eyeR * 0.75, 0, Math.PI * 2);
  g.fill();

  // Googly eye whites (dark outline so they pop on any pastel body).
  g.lineWidth = s * 0.03;
  g.strokeStyle = '#1c1d24';
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx - eyeDx, eyeY, eyeR, 0, Math.PI * 2);
  g.fill(); g.stroke();
  g.beginPath();
  g.arc(cx + eyeDx, eyeY, eyeR, 0, Math.PI * 2);
  g.fill(); g.stroke();

  // Big friendly pupils.
  g.fillStyle = '#1c1d24';
  g.beginPath();
  g.arc(cx - eyeDx + eyeR * 0.18, eyeY + eyeR * 0.15, eyeR * 0.62, 0, Math.PI * 2);
  g.arc(cx + eyeDx + eyeR * 0.18, eyeY + eyeR * 0.15, eyeR * 0.62, 0, Math.PI * 2);
  g.fill();

  // Eye glints.
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx - eyeDx - eyeR * 0.05, eyeY - eyeR * 0.15, eyeR * 0.22, 0, Math.PI * 2);
  g.arc(cx + eyeDx - eyeR * 0.05, eyeY - eyeR * 0.15, eyeR * 0.22, 0, Math.PI * 2);
  g.fill();

  // Smile.
  g.strokeStyle = '#1c1d24';
  g.lineWidth = s * 0.045;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(cx, s * 0.64, s * 0.15, Math.PI * 0.12, Math.PI * 0.88);
  g.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  // Keep the little face crisp at small on-screen sizes (avoid mip blur).
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Soft radial dot used for confetti / spark sprites. */
export function makeDotTexture(): THREE.CanvasTexture {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
