import * as THREE from 'three';

/**
 * Материалы корпуса аппарата — физическая окраска спутника, не тема интерфейса, поэтому
 * цвета фиксированы, как в прототипе (`orbita-design/_globe/scene.html`), а не читаются из
 * токенов. Каждый материал один на все аппараты — переиспользуется, а не создаётся заново.
 */
export const SATELLITE_BODY_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xe6edfb,
  metalness: 0.6,
  roughness: 0.32,
});
export const SATELLITE_COLLAR_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xd8a54a,
  metalness: 0.85,
  roughness: 0.3,
});
export const SATELLITE_PANEL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x1b3f96,
  metalness: 0.45,
  roughness: 0.3,
  emissive: 0x0b1e52,
  emissiveIntensity: 1,
});
export const SATELLITE_PANEL_FAILED_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x7a2438,
  metalness: 0.45,
  roughness: 0.3,
  emissive: 0x50101f,
  emissiveIntensity: 1,
});
export const SATELLITE_DISH_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xcfdcf3,
  metalness: 0.35,
  roughness: 0.45,
  side: THREE.DoubleSide,
});

export const GATEWAY_BASE_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xb9c9e6,
  metalness: 0.5,
  roughness: 0.45,
});
export const GATEWAY_DISH_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xdfeaff,
  metalness: 0.35,
  roughness: 0.35,
  side: THREE.DoubleSide,
});

/** Невидимая, но кликабельная оболочка: сами детали аппарата слишком мелкие для курсора. */
export const HITBOX_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

/**
 * Приглушённая версия корпуса — аппарат снимка с `active: false` (ещё не запущен на этом
 * этапе очереди, `SnapshotSatellite.active`). 2D-карта в этом случае тоже не прячет
 * аппарат, а гасит его прозрачностью (`draw.ts`, `drawSatellite`), поэтому и здесь это
 * настоящая прозрачность материала, а не фокус с масштабом.
 */
export const SATELLITE_BODY_DIMMED_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xe6edfb,
  metalness: 0.6,
  roughness: 0.32,
  transparent: true,
  opacity: 0.32,
});
export const SATELLITE_COLLAR_DIMMED_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xd8a54a,
  metalness: 0.85,
  roughness: 0.3,
  transparent: true,
  opacity: 0.32,
});
export const SATELLITE_PANEL_DIMMED_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x1b3f96,
  metalness: 0.45,
  roughness: 0.3,
  transparent: true,
  opacity: 0.32,
});
export const SATELLITE_DISH_DIMMED_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xcfdcf3,
  metalness: 0.35,
  roughness: 0.45,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.32,
});
