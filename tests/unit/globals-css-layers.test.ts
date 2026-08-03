import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the cascade-layer invariant recorded in CLAUDE.md: every rule in
// app/globals.css must sit inside a layer, and inside one that cannot outrank a
// Tailwind utility.
//
// This is a static check on purpose. The root cause of the invisible-CTA bug was
// not "contrast is bad", it was structural - an unlayered rule outbidding every
// Tailwind utility regardless of specificity. That condition is readable straight
// off the stylesheet, so it needs no browser and costs nothing per pull request.
//
// WHAT IT CATCHES, stated exactly rather than as a claim of completeness:
//   - any rule sitting outside a cascade layer in app/globals.css
//   - a layer block whose name is not one Tailwind declares before `utilities`,
//     because CSS orders layers by first declaration and a layer first named after
//     `utilities` beats every utility in it
//   - a bare local `@import`, which bundles that sheet's rules unlayered
//   - a bare import of Tailwind's split entry points, which ship unlayered on
//     purpose: `tailwindcss/preflight` contains the literal `a { color: inherit }`
//     that caused this bug, and `tailwindcss/utilities` is a bare
//     `@tailwind utilities;`. Only `tailwindcss` itself layers its own output.
//
// WHAT IT DOES NOT CATCH, because a guard assumed to cover more than it does is
// worse than none: a contrast regression arriving any other way - a changed design
// token, an edited Button variant, or a new component pairing the wrong ink on the
// wrong fill. None of that is visible from this one file. The computed-colour
// assertion in tests/e2e/auth-and-sag.spec.ts covers the rendered effect, but that
// suite is manual and does not gate pull requests. Neither guard replaces looking
// at the screen.
//
// KNOWN AND ACCEPTED LIMIT: the layers this file will accept as a target are the
// ones Tailwind declares before `utilities` - today `theme`, `base`, `components`.
// A project that later adopts the split-import setup and writes
// `@import "tailwindcss/utilities" layer(utilities);` is doing something legitimate
// that this guard rejects, and widening the accepted set for it should be a
// deliberate decision rather than a quiet loosening here.

const GLOBALS_CSS_PATH = fileURLToPath(new URL('../../app/globals.css', import.meta.url));

// Allowed at the top level. This is a closed allowlist rather than a blocklist of
// known-bad at-rules, so anything unrecognised fails. Each entry emits no style
// rule that could outrank a utility:
//
//   @theme           carries custom-property declarations, not style rules
//   @utility         Tailwind requires it at the top level and it CANNOT be nested in a layer;
//                    Tailwind emits the generated output into the utilities layer itself
//   @custom-variant  defines a variant at the top level, emits no style rules of its own
//   @source          tells Tailwind where to scan for class names, emits no CSS
//   @plugin          loads a JS plugin, emits no CSS itself
//   @config          loads a legacy JS config, emits no CSS itself
//   @reference       imports a stylesheet for reference only and deliberately emits no CSS
//
// `@layer` and `@import` are allowed too, but neither can be waved through on its
// name alone: both can name a cascade layer, and a layer's rank depends on which
// layer it is. They are checked by `isLayerBlockAllowed` and `isLayerSafeImport`
// below rather than listed here.
//
// `@variant` is deliberately absent: in Tailwind v4 it APPLIES an existing variant
// from inside a rule, and `@custom-variant` is the top-level spelling that defines
// one. `@apply` and `@slot` are nested-only for the same reason. `@media`,
// `@supports`, `@keyframes` and bare selectors are absent because each genuinely
// can outrank a layered utility.
const TOP_LEVEL_ALLOWED = [
  '@theme',
  '@utility',
  '@custom-variant',
  '@source',
  '@plugin',
  '@config',
  '@reference',
];

// Constructs that fail this guard but can simply be moved into a layer. Anything
// else that fails is an at-rule the allowlist does not recognise, which needs
// different advice - telling someone to wrap `@utility` in a layer, for instance,
// prescribes something Tailwind does not permit.
const LAYERABLE_AT_RULES = ['@keyframes', '@media', '@supports'];

// `kind` is recorded by the walker from the terminator it actually saw - `{` for a
// block, `;` for a statement - never inferred from the prelude text. `@layer base {
// ... }` and `@layer theme, base, components, utilities;` are different constructs
// with the same at-rule name, and only the first one carries rules.
type TopLevelConstruct = {
  prelude: string;
  line: number;
  kind: 'block' | 'statement';
};

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

// Sitting inside a layer is necessary but not sufficient. CSS orders layers by
// first declaration and a later layer beats an earlier one, so a layer whose name
// is first seen after Tailwind's `utilities` outranks every utility in it - the
// invisible-CTA defect all over again, just spelled with a layer. Only the layers
// Tailwind declares BEFORE `utilities` are safe to write into.
//
// That set is read out of the installed package rather than hardcoded, so the guard
// stays correct if Tailwind changes its layer order. `utilities` itself is not in
// the set, deliberately: the rule is "declared before utilities", and a rule added
// to `utilities` alongside Tailwind's own output is not what this stylesheet is for.
const TAILWIND_ENTRY_CSS_PATH = fileURLToPath(
  new URL('../../node_modules/tailwindcss/index.css', import.meta.url),
);

const LAYER_ORDER_UNRESOLVED =
  'This guard could not determine Tailwind\'s cascade layer order from node_modules/tailwindcss/index.css';

function readPreUtilitiesLayers(): string[] {
  let entry: string;
  try {
    entry = readFileSync(TAILWIND_ENTRY_CSS_PATH, 'utf8');
  } catch {
    throw new Error(`${LAYER_ORDER_UNRESOLVED}: the file could not be read at ${TAILWIND_ENTRY_CSS_PATH}.`);
  }

  const statement = stripComments(entry).match(/@layer\s+([^;{}]+);/);
  if (statement === null) {
    throw new Error(`${LAYER_ORDER_UNRESOLVED}: no '@layer a, b, c;' order statement was found in it.`);
  }

  const declared = statement[1]
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const utilities = declared.indexOf('utilities');

  if (utilities === -1) {
    throw new Error(
      `${LAYER_ORDER_UNRESOLVED}: 'utilities' is absent from the declared order [${declared.join(', ')}].`,
    );
  }
  if (utilities === 0) {
    throw new Error(
      `${LAYER_ORDER_UNRESOLVED}: 'utilities' is declared first in [${declared.join(', ')}], so no layer precedes it.`,
    );
  }

  return declared.slice(0, utilities);
}

const PRE_UTILITIES_LAYERS = readPreUtilitiesLayers();

function readConstruct(
  source: string,
  start: number,
  end: number,
  kind: TopLevelConstruct['kind'],
): TopLevelConstruct {
  const raw = source.slice(start, end);
  const leadingWhitespace = raw.length - raw.trimStart().length;
  const line = source.slice(0, start + leadingWhitespace).split('\n').length;
  return { prelude: raw.trim().replace(/\s+/g, ' '), line, kind };
}

// Walks the stylesheet tracking brace depth and collects every construct that
// opens at depth 0, whether it is a block (`selector { ... }`) or a statement
// (`@import ...;`). Quoted strings are skipped so a brace or semicolon inside one
// cannot shift the depth count.
function findTopLevelConstructs(css: string): TopLevelConstruct[] {
  const source = stripComments(css);
  const constructs: TopLevelConstruct[] = [];
  let depth = 0;
  let preludeStart = 0;
  let quote: string | null = null;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quote !== null) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '{') {
      if (depth === 0) constructs.push(readConstruct(source, preludeStart, i, 'block'));
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) preludeStart = i + 1;
      continue;
    }

    if (char === ';' && depth === 0) {
      constructs.push(readConstruct(source, preludeStart, i, 'statement'));
      preludeStart = i + 1;
    }
  }

  return constructs;
}

function matchesAtRule(prelude: string, atRule: string): boolean {
  return prelude === atRule || prelude.startsWith(`${atRule} `) || prelude.startsWith(`${atRule}(`);
}

// Splits `@import <specifier> <conditions>` into its two halves, accepting both
// quote styles and the `url(...)` form. Returns null when no specifier parses.
function parseImport(prelude: string): { specifier: string; conditions: string } | null {
  const rest = prelude.slice('@import'.length).trim();

  const url = rest.match(/^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/);
  if (url) return { specifier: url[1] ?? url[2] ?? url[3] ?? '', conditions: rest.slice(url[0].length) };

  const quoted = rest.match(/^(?:"([^"]*)"|'([^']*)')/);
  if (quoted) return { specifier: quoted[1] ?? quoted[2] ?? '', conditions: rest.slice(quoted[0].length) };

  return null;
}

// `@import` is the one construct that cannot be judged by its name. A bare
// `@import "./legacy.css";` bundles that sheet's rules unlayered, which reproduces
// the shipped defect exactly: an unlayered `a { color: inherit }` arriving that way
// outranks `text-canvas` at any specificity while this guard reports nothing. Only
// two shapes are safe.
//
// 1. Tailwind's LAYERED entry point, `tailwindcss` exactly - that is index.css,
//    which declares the layer order and wraps preflight, the theme and the
//    utilities in it - optionally followed by Tailwind's import functions
//    `source()`, `prefix()` or `theme()`.
// 2. Any specifier carrying an explicit `layer(...)` clause naming a pre-utilities
//    layer, which forces the imported sheet into that layer.
//
// The split entry points under `tailwindcss/` are NOT in shape 1. They ship
// unlayered on purpose and expect the consumer to supply the clause: preflight.css
// contains no `@layer` at all and holds the literal `a { color: inherit }` this
// branch exists to keep layered, and utilities.css is a bare `@tailwind utilities;`
// that would outrank the very `@layer base` defaults this file protects. They stay
// reachable through shape 2 - `@import "tailwindcss/preflight" layer(base);` is the
// documented pattern and passes.
//
// The specifier is matched by exact equality, so a look-alike package such as
// `tailwindcss-animate` cannot slip through on a prefix.
function isTailwindEntryPoint(specifier: string): boolean {
  return specifier === 'tailwindcss';
}

function isTailwindSplitEntryPoint(specifier: string): boolean {
  return specifier.startsWith('tailwindcss/');
}

function importLayerName(conditions: string): string | null {
  const clause = conditions.match(/\blayer\(\s*([^)]*?)\s*\)/);
  return clause ? clause[1] : null;
}

function isLayerSafeImport(prelude: string): boolean {
  const parsed = parseImport(prelude);
  if (parsed === null) return false;
  if (isTailwindEntryPoint(parsed.specifier)) return true;

  const layer = importLayerName(parsed.conditions);
  return layer !== null && PRE_UTILITIES_LAYERS.includes(layer);
}

// `@layer base { ... }`, `@layer components { ... }` - and nothing first declared
// after `utilities`, which would outrank it. An anonymous `@layer { ... }` names
// nothing and is declared wherever it sits, so it fails too.
//
// A layer ORDER STATEMENT - `@layer theme, base, components, utilities;` with no
// block - is a different construct and always passes. It carries no rules, so it
// cannot outrank anything, and pinning the order explicitly is normal Tailwind v4
// practice.
function layerNames(prelude: string): string[] {
  return prelude
    .slice('@layer'.length)
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function isLayerBlockAllowed(prelude: string): boolean {
  const names = layerNames(prelude);
  return names.length > 0 && names.every((name) => PRE_UTILITIES_LAYERS.includes(name));
}

function isImport(prelude: string): boolean {
  return matchesAtRule(prelude, '@import');
}

function isLayer(prelude: string): boolean {
  return matchesAtRule(prelude, '@layer');
}

function isAllowedAtTopLevel(construct: TopLevelConstruct): boolean {
  const { prelude, kind } = construct;
  if (isImport(prelude)) return isLayerSafeImport(prelude);
  if (isLayer(prelude)) return kind === 'statement' || isLayerBlockAllowed(prelude);
  return TOP_LEVEL_ALLOWED.some((atRule) => matchesAtRule(prelude, atRule));
}

function isLayerable(prelude: string): boolean {
  if (!prelude.startsWith('@')) return true;
  return LAYERABLE_AT_RULES.some((atRule) => matchesAtRule(prelude, atRule));
}

function findUnlayeredRules(css: string): TopLevelConstruct[] {
  return findTopLevelConstructs(css).filter(
    (construct) => construct.prelude.length > 0 && !isAllowedAtTopLevel(construct),
  );
}

type ViolationReason =
  | 'disallowed-layer'
  | 'unlayered-split-entry'
  | 'unlayered-import'
  | 'layerable'
  | 'unrecognised';

function reasonFor(prelude: string): ViolationReason {
  if (isLayer(prelude)) return 'disallowed-layer';
  if (isImport(prelude)) {
    const parsed = parseImport(prelude);
    if (parsed === null) return 'unlayered-import';
    if (importLayerName(parsed.conditions) !== null) return 'disallowed-layer';
    return isTailwindSplitEntryPoint(parsed.specifier) ? 'unlayered-split-entry' : 'unlayered-import';
  }
  if (isLayerable(prelude)) return 'layerable';
  return 'unrecognised';
}

function explainViolations(violations: TopLevelConstruct[]): string {
  const withReason = (reason: ViolationReason) =>
    violations.filter((violation) => reasonFor(violation.prelude) === reason);

  const disallowedLayer = withReason('disallowed-layer');
  const splitEntry = withReason('unlayered-split-entry');
  const imports = withReason('unlayered-import');
  const layerable = withReason('layerable');
  const unrecognised = withReason('unrecognised');

  const message = [
    `app/globals.css has ${violations.length} rule(s) outside a cascade layer:`,
    ...violations.map((violation) => `  line ${violation.line}: ${violation.prelude} { ... }`),
    '',
    'Why this matters, because the failure is silent otherwise:',
    'Tailwind v4 emits every utility inside `@layer utilities`, and unlayered CSS',
    'beats layered CSS at any specificity. So one unlayered rule outranks a whole',
    'family of utilities while the build, the linter, and the types all stay green.',
    '',
    'This already shipped once. An unlayered `a { color: inherit }` outranked',
    '`text-canvas` on every anchor in the app, so the primary CTA rendered as white',
    'text on a white pill - #f4f4f5 on #f4f4f5, contrast 1.00:1, invisible.',
  ];

  if (layerable.length > 0) {
    message.push(
      '',
      `Fix for ${layerable.map((violation) => violation.prelude).join(', ')}:`,
      'wrap the rule in `@layer base` if it is an element default, or',
      '`@layer components` if it is a helper class. Put `@keyframes` and `@media`',
      'blocks inside the layer holding the classes that consume them.',
    );
  }

  if (disallowedLayer.length > 0) {
    message.push(
      '',
      `Fix for ${disallowedLayer.map((violation) => violation.prelude).join(', ')}:`,
      'CSS orders layers by first declaration and a later layer beats an earlier one,',
      'so a layer first declared after Tailwind\'s `utilities` outranks every utility',
      'in it. Write into one of the layers Tailwind declares before `utilities` -',
      `${PRE_UTILITIES_LAYERS.join(', ')} - rather than adding a layer of your own.`,
      '`utilities` itself is not one of them, by the same rule.',
    );
  }

  if (splitEntry.length > 0) {
    message.push(
      '',
      `Fix for ${splitEntry.map((violation) => violation.prelude).join(', ')}:`,
      'Tailwind\'s split entry points ship unlayered on purpose - preflight.css holds',
      'the literal `a { color: inherit }` that caused this bug and utilities.css is a',
      'bare `@tailwind utilities;` - and expect you to supply the layer. Only',
      '`tailwindcss` itself layers its own output, so either use `@import',
      '"tailwindcss";` or keep the split import and add a `layer(...)` clause naming',
      `one of ${PRE_UTILITIES_LAYERS.join(', ')}. Do NOT wrap the \`@import\` statement`,
      'in an `@layer` block - an import has to stay at the top level.',
    );
  }

  if (imports.length > 0) {
    message.push(
      '',
      `Fix for ${imports.map((violation) => violation.prelude).join(', ')}:`,
      'this import arrives unlayered, so every rule in the imported sheet outranks the',
      'utilities. Add a `layer(...)` clause naming one of Tailwind\'s pre-utilities',
      `layers (${PRE_UTILITIES_LAYERS.join(', ')}), or move the imported rules into a`,
      'layer. Do NOT wrap the `@import` statement itself in `@layer` - an import has to',
      'stay at the top level.',
    );
  }

  if (unrecognised.length > 0) {
    message.push(
      '',
      `Fix for ${unrecognised.map((violation) => violation.prelude).join(', ')}:`,
      'this guard does not recognise that at-rule, so it cannot tell you where it',
      'belongs. If it is a Tailwind directive that must live at the top level, add it',
      'to TOP_LEVEL_ALLOWED in this file along with a note on why it cannot outrank a',
      'utility. Otherwise wrap it in a layer.',
    );
  }

  return message.join('\n');
}

const PASSING_FIXTURE = `
@import "tailwindcss";

@theme {
  --color-canvas: #08080a;
}

@layer base {
  a {
    color: inherit;
  }
}

@layer components {
  @keyframes tt-pop {
    from { opacity: 0; }
  }

  .tt-pop {
    animation: tt-pop 0.4s ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .tt-pop { animation: none; }
  }
}
`;

// The exact shape this branch fixed: element defaults and motion keyframes sitting
// at the top level, where they outrank every utility.
const FAILING_FIXTURE = `
@import "tailwindcss";

a {
  color: inherit;
}

@keyframes tt-pop {
  from { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .tt-pop { animation: none; }
}
`;

// The Tailwind v4 directives that belong at the top level, including `@utility`,
// which cannot be nested in a layer at all. None of them emits a style rule that
// could outrank a utility, so none of them may fail this guard.
const TOP_LEVEL_DIRECTIVES_FIXTURE = `
@import "tailwindcss";
@source "../components";
@plugin "@tailwindcss/typography";
@config "../tailwind.config.js";
@reference "./globals.css";
@custom-variant pointer-coarse (@media (pointer: coarse));

@utility tab-4 {
  tab-size: 4;
}

@theme {
  --color-canvas: #08080a;
}
`;

// An at-rule the allowlist does not know about. It must still fail: the guard is
// only worth having because anything unrecognised trips it rather than slipping
// through on a prefix match.
const UNRECOGNISED_AT_RULE_FIXTURE = `
@import "tailwindcss";

@font-face {
  font-family: "Instrument Serif";
  src: url("/fonts/instrument-serif.woff2") format("woff2");
}
`;

// The only two import shapes that cannot deliver a rule that outranks a utility:
// Tailwind's layered entry point, and a specifier pinned into a pre-utilities
// layer - including a split entry point once the consumer supplies the clause.
const SAFE_IMPORT_FIXTURE = `
@import "tailwindcss";
@import "tailwindcss" source(none);
@import "tailwindcss/preflight" layer(base);
@import './legacy.css' layer(base);
@import "./legacy.css" layer(components);
`;

// Unlayered on purpose, and accepted wholesale until now. preflight.css contains no
// `@layer` and its line 87 is `a { color: inherit; }` - the exact rule that rendered
// every primary CTA invisible. utilities.css is a bare `@tailwind utilities;` which
// would outrank the `@layer base` defaults this stylesheet exists to protect.
const SPLIT_ENTRY_POINT_FIXTURE = `
@import "tailwindcss";
@import "tailwindcss/preflight";
@import "tailwindcss/utilities";
@import "tailwindcss/theme";
`;

// Every one of these bundles its sheet unlayered. `tailwindcss-animate` is the
// look-alike a prefix match would wrongly admit: it is a third-party package, not
// Tailwind's entry point, and it can carry unlayered rules.
const UNSAFE_IMPORT_FIXTURE = `
@import "tailwindcss";
@import "./legacy.css";
@import url("./legacy.css");
@import "tailwindcss-animate";
`;

// Layered, and still fatal. `legacy` is first declared here, after Tailwind's
// `utilities`, so it wins over every utility - the same invisible CTA, reached
// through a layer rather than around one.
const DISALLOWED_LAYER_FIXTURE = `
@import "tailwindcss";

@import "./legacy.css" layer(legacy);

@layer legacy {
  a { color: inherit; }
}
`;

// A layer order statement carries no rules. It names `utilities`, which is not an
// accepted target for a layer BLOCK, and it must still pass - the two constructs
// share an at-rule name and nothing else.
const LAYER_ORDER_STATEMENT_FIXTURE = `
@layer theme, base, components, utilities;

@import "tailwindcss";

@layer base {
  a { color: inherit; }
}

@layer components {
  .tt-pop { animation: none; }
}
`;

describe('app/globals.css cascade layers', () => {
  const css = readFileSync(GLOBALS_CSS_PATH, 'utf8');

  it('keeps every rule inside a cascade layer', () => {
    const violations = findUnlayeredRules(css);
    expect(violations, explainViolations(violations)).toEqual([]);
  });

  it('parses the real stylesheet rather than passing vacuously', () => {
    const preludes = findTopLevelConstructs(css).map((construct) => construct.prelude);

    expect(preludes).toContain('@import "tailwindcss"');
    expect(preludes).toContain('@theme');

    // Present, not exhaustive. A third layer is a legitimate addition and must not
    // fail a required check just for existing.
    const layers = preludes.filter((prelude) => prelude.startsWith('@layer '));
    expect(layers).toContain('@layer base');
    expect(layers).toContain('@layer components');
  });

  it('keeps the element defaults and the motion keyframes layered', () => {
    expect(css).toMatch(/@layer base\s*\{[\s\S]*\ba\s*\{\s*color:\s*inherit/);
    expect(css).toMatch(/@layer components\s*\{[\s\S]*@keyframes tt-ripple-grow/);
    expect(css).toMatch(/@layer components\s*\{[\s\S]*@keyframes tt-btn-pop/);
  });
});

describe('unlayered-rule detection', () => {
  it('accepts a stylesheet whose rules are all layered', () => {
    expect(findUnlayeredRules(PASSING_FIXTURE)).toEqual([]);
  });

  it('flags bare selectors, keyframes, and media blocks at the top level', () => {
    expect(findUnlayeredRules(FAILING_FIXTURE).map((violation) => violation.prelude)).toEqual([
      'a',
      '@keyframes tt-pop',
      '@media (prefers-reduced-motion: reduce)',
    ]);
  });

  it('accepts the Tailwind v4 directives that belong at the top level', () => {
    expect(findUnlayeredRules(TOP_LEVEL_DIRECTIVES_FIXTURE)).toEqual([]);
  });

  it('still flags an at-rule the allowlist does not recognise', () => {
    expect(findUnlayeredRules(UNRECOGNISED_AT_RULE_FIXTURE).map((violation) => violation.prelude)).toEqual([
      '@font-face',
    ]);
  });

  it('accepts Tailwind entry points and imports pinned into a layer', () => {
    expect(findUnlayeredRules(SAFE_IMPORT_FIXTURE)).toEqual([]);
  });

  it('flags a bare import of Tailwind\'s unlayered split entry points', () => {
    expect(findUnlayeredRules(SPLIT_ENTRY_POINT_FIXTURE).map((violation) => violation.prelude)).toEqual([
      '@import "tailwindcss/preflight"',
      '@import "tailwindcss/utilities"',
      '@import "tailwindcss/theme"',
    ]);
  });

  it('accepts a layer order statement, which declares no rules', () => {
    expect(findUnlayeredRules(LAYER_ORDER_STATEMENT_FIXTURE)).toEqual([]);
  });

  it('records whether each construct was a block or a statement', () => {
    const constructs = findTopLevelConstructs(LAYER_ORDER_STATEMENT_FIXTURE);

    expect(constructs.find((c) => c.prelude === '@layer theme, base, components, utilities')?.kind).toBe(
      'statement',
    );
    expect(constructs.find((c) => c.prelude === '@layer base')?.kind).toBe('block');
  });

  it('flags bare imports, including a look-alike package name', () => {
    expect(findUnlayeredRules(UNSAFE_IMPORT_FIXTURE).map((violation) => violation.prelude)).toEqual([
      '@import "./legacy.css"',
      '@import url("./legacy.css")',
      '@import "tailwindcss-animate"',
    ]);
  });

  it('derives the accepted layer names from the installed Tailwind entry point', () => {
    expect(PRE_UTILITIES_LAYERS.length).toBeGreaterThan(0);
    expect(PRE_UTILITIES_LAYERS).toContain('base');
    expect(PRE_UTILITIES_LAYERS).toContain('components');
    expect(PRE_UTILITIES_LAYERS).not.toContain('utilities');
  });

  it('flags a layer first declared after utilities, however it is reached', () => {
    expect(findUnlayeredRules(DISALLOWED_LAYER_FIXTURE).map((violation) => violation.prelude)).toEqual([
      '@import "./legacy.css" layer(legacy)',
      '@layer legacy',
    ]);
  });

  it('is not fooled by braces or selectors inside comments', () => {
    const css = `
/* An unlayered a { color: inherit } used to outrank text-canvas. */
@layer base {
  a { color: inherit; }
}
`;
    expect(findUnlayeredRules(css)).toEqual([]);
  });

  it('names the mechanism, the consequence, and the fix when it fails', () => {
    const message = explainViolations(findUnlayeredRules(FAILING_FIXTURE));

    expect(message).toContain('@layer utilities');
    expect(message).toContain('1.00:1');
    expect(message).toContain('@layer base');
    expect(message).toContain('@keyframes tt-pop { ... }');
  });

  it('does not prescribe wrapping an unrecognised at-rule in a layer', () => {
    const message = explainViolations(findUnlayeredRules(UNRECOGNISED_AT_RULE_FIXTURE));

    expect(message).toContain('@font-face');
    expect(message).toContain('1.00:1');
    expect(message).toContain('TOP_LEVEL_ALLOWED');
    expect(message).not.toContain('helper class');
  });

  it('tells a bare import to carry a layer clause, not to wrap the statement', () => {
    const message = explainViolations(findUnlayeredRules(UNSAFE_IMPORT_FIXTURE));

    expect(message).toContain('@import "./legacy.css"');
    expect(message).toContain('@import "tailwindcss-animate"');
    expect(message).toContain('1.00:1');
    expect(message).toContain('`layer(...)` clause');
    expect(message).not.toContain('helper class');
    expect(message).not.toContain('TOP_LEVEL_ALLOWED');
  });

  it('tells a disallowed layer to use a pre-utilities layer, not to add one', () => {
    const message = explainViolations(findUnlayeredRules(DISALLOWED_LAYER_FIXTURE));

    expect(message).toContain('@layer legacy');
    expect(message).toContain('@import "./legacy.css" layer(legacy)');
    expect(message).toContain('1.00:1');
    expect(message).toContain('first declaration');
    expect(message).toContain(PRE_UTILITIES_LAYERS.join(', '));
    expect(message).not.toContain('helper class');
    expect(message).not.toContain('TOP_LEVEL_ALLOWED');
  });

  it('tells a split entry point to use the layered import or supply a clause', () => {
    const message = explainViolations(findUnlayeredRules(SPLIT_ENTRY_POINT_FIXTURE));

    expect(message).toContain('@import "tailwindcss/preflight"');
    expect(message).toContain('1.00:1');
    expect(message).toContain('a { color: inherit }');
    expect(message).toContain('layer(...)');
    expect(message).not.toContain('helper class');
    expect(message).not.toContain('TOP_LEVEL_ALLOWED');
  });
});
