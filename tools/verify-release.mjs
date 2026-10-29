import assert from 'node:assert/strict';
import {appendFile} from 'node:fs/promises';
import {json} from '../src/files.js';

const pkg=await json('package.json');
assert.notEqual(pkg.private,true,'package.json private:true prevents publication.');
assert.equal(pkg.publishConfig?.registry,'https://registry.npmjs.org/');
assert.equal(pkg.publishConfig?.access,'public');
assert.match(pkg.version,/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,'Expected a release SemVer.');
if(process.env.GITHUB_EVENT_NAME==='release'){
  assert.equal(process.env.RELEASE_TAG,`v${pkg.version}`,'GitHub release tag must exactly match package.json: v<version>.');
  assert.equal(process.env.GITHUB_REPOSITORY,'Samlinb/dsh-openbone-plugin','Refusing publication from a fork or another repository.');
  assert.equal(process.env.RELEASE_IS_PRERELEASE==='true',pkg.version.includes('-'),'GitHub prerelease flag must match the package prerelease version.');
}
const distTag=pkg.version.includes('-')?'next':'latest';
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`dist-tag=${distTag}\n`);
console.log(JSON.stringify({package:pkg.name,version:pkg.version,distTag,publish:process.env.GITHUB_EVENT_NAME==='release'}));
