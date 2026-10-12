// Downloads the OpenAPI spec from a RomM instance into docs/romm-openapi.json.
// Usage: npm run api:fetch -- https://romm.example.lan   (or set ROMM_URL)
import { writeFile } from 'node:fs/promises';

const baseUrl = (process.argv[2] ?? process.env.ROMM_URL ?? '').replace(/\/+$/, '');
if (!baseUrl) {
  console.error('Pass the RomM base URL as an argument or set ROMM_URL.');
  process.exit(1);
}

// RomM serves the spec at the root, not under /api (the Swagger UI lives at /api/docs).
const response = await fetch(`${baseUrl}/openapi.json`);
if (!response.ok) {
  console.error(`Failed to fetch spec: HTTP ${response.status}`);
  process.exit(1);
}

const spec = await response.json();
await writeFile('docs/romm-openapi.json', `${JSON.stringify(spec, null, 2)}\n`);
console.log(`Saved RomM API ${spec.info?.version} (${Object.keys(spec.paths).length} paths)`);
