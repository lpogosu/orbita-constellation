import * as THREE from 'three';

/**
 * Геометрия аппарата и наземных пунктов из прототипа (`orbita-design/_globe/scene.html`),
 * созданная один раз на модуль и переиспользуемая для каждого спутника и пункта — вместо
 * того, чтобы заводить новый `BufferGeometry` на каждый инстанс (`docs/18_GLOBE_3D.md`,
 * требование к производительности).
 */
export const SATELLITE_BODY_GEOMETRY = new THREE.BoxGeometry(0.019, 0.015, 0.024);
export const SATELLITE_COLLAR_GEOMETRY = new THREE.CylinderGeometry(0.0075, 0.0075, 0.0085, 12);
export const SATELLITE_PANEL_GEOMETRY = new THREE.BoxGeometry(0.038, 0.0016, 0.021);
export const SATELLITE_ARM_GEOMETRY = new THREE.BoxGeometry(0.010, 0.0022, 0.0022);
export const SATELLITE_DISH_GEOMETRY = new THREE.ConeGeometry(0.0085, 0.011, 14, 1, true);
/** Невидимая, но кликабельная область вокруг маленького аппарата — иначе в него не попасть курсором. */
export const SATELLITE_HITBOX_GEOMETRY = new THREE.SphereGeometry(0.02, 8, 6);

export const GROUND_PIN_GEOMETRY = new THREE.CylinderGeometry(0.003, 0.003, 0.042, 10);
export const GROUND_KNOB_GEOMETRY = new THREE.SphereGeometry(0.0105, 18, 14);
export const GATEWAY_BASE_GEOMETRY = new THREE.CylinderGeometry(0.01, 0.013, 0.008, 16);
export const GATEWAY_DISH_GEOMETRY = new THREE.SphereGeometry(
  0.017, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42,
);
export const SITE_HITBOX_GEOMETRY = new THREE.SphereGeometry(0.028, 8, 6);
