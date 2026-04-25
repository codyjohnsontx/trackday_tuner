import { readFileSync } from 'node:fs';

const claudePath = new URL('../CLAUDE.md', import.meta.url);
const agentsPath = new URL('../AGENTS.md', import.meta.url);

let claude;
let agents;

try {
  claude = readFileSync(claudePath);
} catch (error) {
  console.error(`Unable to read ${claudePath.pathname}:`, error);
  process.exit(1);
}

try {
  agents = readFileSync(agentsPath);
} catch (error) {
  console.error(`Unable to read ${agentsPath.pathname}:`, error);
  process.exit(1);
}

if (!claude.equals(agents)) {
  console.error('CLAUDE.md and AGENTS.md are out of sync.');
  process.exit(1);
}

console.log('CLAUDE.md and AGENTS.md are in sync.');
