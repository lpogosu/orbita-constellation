import * as THREE from 'three';

/**
 * Один общий спрайт мягкого пятна на все свечения аппаратов и наземных пунктов — тонируется
 * через `material.color` конкретного спрайта, поэтому не нужно рисовать канвас на каждый
 * цвет отдельно (в прототипе `glowSprite()` заново рисовал канвас на каждый вызов).
 */
function buildGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return new THREE.Texture();
  }
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let cached: THREE.Texture | null = null;

export function glowTexture(): THREE.Texture {
  cached ??= buildGlowTexture();
  return cached;
}
