// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import esbuild from 'esbuild';
import { writeFileSync } from 'fs';

const options = {
  entryPoints: ['./src/index.ts'],
  bundle: true,
  platform: 'browser',
  loader: { '.ts': 'ts', '.tsx': 'tsx' },
  logLevel: 'info',
  resolveExtensions: ['.ts', '.tsx'],
  target: 'es2021',
  tsconfig: 'tsconfig.json',
  minifyWhitespace: true,
  minifyIdentifiers: false,
  minifySyntax: true,
  sourcemap: true,
  external: ['@mantine/core', '@medplum/core', '@medplum/fhirtypes', '@medplum/react', '@tabler/icons-react', 'react'],
};

for (const [format, outfile, packageType] of [
  ['cjs', './dist/cjs/index.cjs', 'commonjs'],
  ['esm', './dist/esm/index.mjs', 'module'],
]) {
  esbuild
    .build({ ...options, format, outfile })
    .then(() => writeFileSync(outfile.replace(/index\.(cjs|mjs)$/, 'package.json'), `{"type":"${packageType}"}`))
    .catch((error) => {
      console.error('Build failed:', JSON.stringify(error, null, 2));
      process.exit(1);
    });
}