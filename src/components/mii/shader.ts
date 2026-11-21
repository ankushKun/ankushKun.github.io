// Extends the Wii U Mii shader (FFLShader) for the plaza: distance fog on heads and bodies, and a
// batched body variant that skins every Mii in one draw call from a bone texture.
import * as THREE from 'three';
import FFLShaderMaterial from './vendor/FFLShaderMaterial.js';

/** Shared by every Mii material. Values are raw sRGB, like the rest of FFLShader. */
export const miiUniforms = {
  uFogColor: { value: new THREE.Color(1, 1, 1) },
  uFogNear: { value: 1e6 },
  uFogFar: { value: 2e6 },
  /** 1 while the floor reflection renders: bodies fade out with height there. */
  uReflectPass: { value: 0 },
};

const FOG_FRAG = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uReflectPass;
  varying float vWorldY;
`;

function addFog(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, miiUniforms);
  shader.fragmentShader = shader.fragmentShader
    .replace('void main()', `${FOG_FRAG}\nvoid main()`)
    .replace(
      'gl_FragColor = color;',
      `gl_FragColor = color;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, smoothstep(uFogNear, uFogFar, -v_position.z));
      if (uReflectPass > 0.5) {
        // Gloss fades the reflection with height above the floor, but a whole Mii, head and all, shows.
        float mirror = mix(0.35, 1.0, smoothstep(2.2, 0.0, vWorldY));
        gl_FragColor = vec4(gl_FragColor.rgb * mirror, mirror);
      }`,
    );
}

/** Head parts: fog only. */
export function patchHead(material: THREE.Material) {
  material.onBeforeCompile = headCompile;
  material.customProgramCacheKey = () => 'mii-head';
}

function headCompile(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace('void main()', 'varying float vWorldY;\nvoid main()')
    .replace('gl_Position =  projectionMatrix * v_position;', 'gl_Position =  projectionMatrix * v_position;\n    vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
  addFog(shader);
}

const SKIN_VERT = /* glsl */ `
  uniform highp sampler2D uBones;
  attribute vec4 aJoint;
  attribute vec4 aWeight;
  attribute vec3 aTint;
  varying vec3 vTint;
  varying float vWorldY;
  mat4 miiBone(float j) {
    int x = int(j) * 4;
    int y = gl_InstanceID;
    return mat4(
      texelFetch(uBones, ivec2(x, y), 0),
      texelFetch(uBones, ivec2(x + 1, y), 0),
      texelFetch(uBones, ivec2(x + 2, y), 0),
      texelFetch(uBones, ivec2(x + 3, y), 0)
    );
  }
`;

/**
 * Body material for one batch: every instance reads its bone matrices (already in world space)
 * from row gl_InstanceID of `bones`, and its color from `aTint`.
 * modulateType 9 is the Wii U shirt material, 10 the pants.
 */
export function bodyMaterial(bones: THREE.DataTexture, modulateType: 9 | 10) {
  const m = new FFLShaderMaterial({ modulateMode: 0, modulateType, color: new THREE.Color(1, 1, 1) });
  m.side = THREE.FrontSide;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBones = { value: bones };
    shader.vertexShader = shader.vertexShader
      .replace('void main()', `${SKIN_VERT}\nvoid main()`)
      .replace(
        'vec3 transformed = vec3( position );',
        `mat4 skinMat = miiBone(aJoint.x) * aWeight.x + miiBone(aJoint.y) * aWeight.y
          + miiBone(aJoint.z) * aWeight.z + miiBone(aJoint.w) * aWeight.w;
        vec3 transformed = (skinMat * vec4(position, 1.0)).xyz;
        vWorldY = transformed.y;
        vTint = aTint;`,
      )
      .replace('vec3 objectNormal = normal;', 'vec3 objectNormal = normalize(mat3(skinMat) * normal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main()', 'varying vec3 vTint;\nvoid main()')
      .replace('color = u_const1;', 'color = vec4(vTint, 1.0);');
    addFog(shader);
  };
  m.customProgramCacheKey = () => `mii-body-${modulateType}`;
  return m;
}
