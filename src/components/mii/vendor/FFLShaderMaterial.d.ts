import * as THREE from 'three';

/** The Wii U Mii shader (FFLShader), as a three.js ShaderMaterial. */
export default class FFLShaderMaterial extends THREE.ShaderMaterial {
  constructor(options?: THREE.ShaderMaterialParameters & { modulateMode?: number; modulateType?: number; color?: THREE.Color });
  modulateMode: number;
  modulateType: number;
  color: THREE.Color | null;
}
