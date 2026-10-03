export {
  configure,
  getConfig,
  emit,
  timed,
  Tracks,
  type Config,
  type EmitOptions,
  type Strategy,
  type TrackColor,
} from "./emit.js";
export {
  definePerf,
  instrumentElement,
  type InstrumentOptions,
  type LifecycleCallback,
} from "./define.js";
export { rerouteMeasures, type RerouteTarget } from "./reroute.js";
