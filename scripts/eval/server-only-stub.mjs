/**
 * Stand-in for the `server-only` package, which Next aliases at build time and
 * which is therefore not installed. Importing it is a compile-time assertion
 * that a module never reaches the browser; outside Next it has no runtime job,
 * so an empty module is the whole of it.
 */
export {};
