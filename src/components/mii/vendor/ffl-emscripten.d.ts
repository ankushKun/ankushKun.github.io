import type { FFLModule } from './ffl';

/** Instantiates the FFL WebAssembly module. `locateFile` maps the wasm file name to its URL. */
export default function ModuleFFL(options: { locateFile(path: string): string }): Promise<FFLModule>;
