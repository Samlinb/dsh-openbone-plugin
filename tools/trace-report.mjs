import { readFile } from 'node:fs/promises';
import { zstdDecompressSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Aggregate DSH v4 event metadata without exporting prompts, reasoning or credentials. */
export function summarizeTrace(events) {
  const calls=events.filter(e=>e.type==='tool/call'),results=events.filter(e=>e.type==='tool/result');
  const byCall=new Map(calls.map(e=>[e.data.callId,e])),counts={};
  for(const call of calls)counts[call.data.name]=(counts[call.data.name]??0)+1;
  const assistants=events.filter(e=>e.type==='assistant/message');
  const usage={inputTokens:0,outputTokens:0,cacheReadTokens:0,totalTokens:0};
  let reasoningCharacters=0,environmentDetourMessages=0;
  for(const event of assistants) {
    for(const key of Object.keys(usage))usage[key]+=event.data.usage?.[key]??0;
    const reasoning=(event.data.message?.content??[]).filter(c=>c.type==='reasoning').map(c=>c.text??'').join('\n');
    reasoningCharacters+=reasoning.length;
    if(/workspaceRoot|pngPath|hosted machine|server.path|source.code|running.process/i.test(reasoning))environmentDetourMessages++;
  }
  const failed=results.filter(e=>e.data.message?.isError===true);
  const preview=results.find(e=>byCall.get(e.data.message?.toolCallId)?.data.name==='openbone_project_preview'&&!e.data.message?.isError);
  const start=events.find(e=>e.type==='turn/start')?.time;
  return {sessionId:events.find(e=>e.type==='session')?.id??null,steps:events.filter(e=>e.type==='step/start').length,toolCalls:calls.length,shellCalls:counts.bash??0,tools:counts,failedToolCalls:failed.length,failedTools:failed.map(e=>byCall.get(e.data.message?.toolCallId)?.data.name??'unknown'),usage,reasoningCharacters,environmentDetourMessages,timeToFirstExportMs:preview&&typeof start==='number'?preview.time-start:null,exportObserved:!!preview,actualPlayback:'Requires separate browser evidence; export is not playback.',rawContentIncluded:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  if(!process.argv[2])throw new Error('Usage: node tools/trace-report.mjs <session.v4.jsonl[.zstd]>');
  const file=process.argv[2],bytes=await readFile(file);
  const content=file.endsWith('.zstd')?zstdDecompressSync(bytes,{maxOutputLength:64*1024*1024}).toString('utf8'):bytes.toString('utf8');
  let events;
  try{events=content.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}catch{throw new Error('Invalid session JSONL; raw session contents have not been echoed.');}
  console.log(JSON.stringify(summarizeTrace(events),null,2));
}
