/**
 * Import this first, before any components load:
 *
 *   import "tuppence/register";
 *
 * Every custom element defined afterwards is instrumented, and Lit elements
 * also get their updates tracked, with no change to their code.
 */
import { trackAllLitElements } from "./adapters/lit.js";

trackAllLitElements();
