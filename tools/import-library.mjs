import { parseArgs } from 'node:util';
import { importLibrary } from '../src/import.js';
const { values } = parseArgs({ options: { source: { type: 'string' }, destination: { type: 'string' }, 'dry-run': { type: 'boolean' } } });
if (!values.source || !values.destination) throw new Error('Required: --source <existing library> --destination <new private replica> [--dry-run]');
console.log(JSON.stringify(await importLibrary(values.source, values.destination, { dryRun: values['dry-run'] }), null, 2));
