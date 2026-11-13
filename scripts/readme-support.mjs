import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export function supportSection(value) {
  if(!value)return '';
  let url;try{url=new URL(value)}catch{throw Error('DONATE_URL must be an HTTPS URL')}
  if(url.protocol!=='https:'||url.username||url.password||url.href.length>2048)throw Error('DONATE_URL must be an HTTPS URL without credentials');
  return `\n## Support\n\n[Support Incord](<${url.href.replaceAll('>','%3E').replaceAll('<','%3C')}>)\n`;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const config=readFileSync('wrangler.jsonc','utf8');
  const configured=/"DONATE_URL"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(config);
  const value=process.env.DONATE_URL??(configured?JSON.parse(configured[1]):'');
  const source=readFileSync('README.md','utf8');
  if(!source.includes('<!-- SUPPORT:START -->')||!source.includes('<!-- SUPPORT:END -->'))throw Error('README support markers are missing');
  writeFileSync('README.md',source.replace(/<!-- SUPPORT:START -->[\s\S]*?<!-- SUPPORT:END -->/,()=>`<!-- SUPPORT:START -->${supportSection(value)}\n<!-- SUPPORT:END -->`));
}
