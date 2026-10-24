// The injected recorder is bundled into a string at build time (see scripts/build.mjs).
import source from 'virtual:recorder';

export const RECORDER_SOURCE: string = source;
