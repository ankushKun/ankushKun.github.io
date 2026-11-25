// Types for the parts of FFL.js the site uses. The library itself is plain JavaScript.
import type * as THREE from 'three';

export interface FFLModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
  /** 0 when the CharInfo is valid, else why not. */
  _FFLiVerifyCharInfoWithReason(info: number, allowInvalidName: number): number;
  /** Reads 96 bytes of FFLStoreData into a CharInfo; false if they aren't a valid Mii. */
  _FFLpGetCharInfoFromStoreData(info: number, storeData: number): boolean;
}

export interface CharModelDesc {
  resolution: number;
  allExpressionFlag: Uint32Array;
  modelFlag: number;
  resourceType: number;
}

export interface CharInfoStruct {
  size: number;
  pack(info: CharInfo): Uint8Array;
  unpack(data: Uint8Array): CharInfo;
}

export interface CharInfo {
  personal: { gender: number; favoriteColor: number; name: string };
  body: { height: number; build: number };
  [key: string]: unknown;
}

export class CharModel {
  meshes: THREE.Group | null;
  readonly expression: number;
  expressions: number[];
  readonly favoriteColor: THREE.Color;
  readonly facelineColor: THREE.Color;
  readonly gender: number;
  readonly boundingBox: THREE.Box3;
  /** Each eye's iris color, left then right as you look, set before `initCharModelTextures` (an ankush.one patch). */
  eyeColors?: ([number, number, number] | undefined)[];
  setExpression(expression: number): void;
  getBodyScale(mode?: number): THREE.Vector3;
  dispose(disposeTargets?: boolean): void;
}

type MaterialClass = new (...args: never[]) => THREE.Material;

export const FFLExpression: Record<string, number>;
export const FFLModelFlag: { NORMAL: number; HAT: number; FACE_ONLY: number };
export const FFLModulateType: { SHAPE_HAIR: number };
export const FFLResourceType: { MIDDLE: number; HIGH: number };
export const FFLGender: { MALE: number; FEMALE: number; ALL: number };
export const FFLAge: { CHILD: number; ADULT: number; ELDER: number; ALL: number };
export const FFLRace: { BLACK: number; WHITE: number; ASIAN: number; ALL: number };
export const FFLiCharInfo: CharInfoStruct;

export function initializeFFL(resource: Uint8Array, module: FFLModule | Promise<FFLModule>): Promise<{ module: FFLModule }>;
export function createCharModel(
  data: Uint8Array,
  desc: CharModelDesc,
  materialClass: MaterialClass,
  module: FFLModule,
  verify?: boolean,
): CharModel;
export function initCharModelTextures(charModel: CharModel, renderer: THREE.WebGLRenderer, materialClass?: MaterialClass): void;
export function getRandomCharInfo(module: FFLModule, gender?: number, age?: number, race?: number): Uint8Array;
export function makeExpressionFlag(expressions: number[] | number): Uint32Array;
