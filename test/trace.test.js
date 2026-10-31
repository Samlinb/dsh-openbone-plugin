import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTrace } from '../tools/trace-report.mjs';

test('trajectory report correlates tools and exports metadata without raw reasoning or tool arguments',()=>{
  const report=summarizeTrace([
    {type:'session',id:'fixture-session'},{type:'turn/start',time:100},{type:'step/start',data:{step:1}},
    {type:'assistant/message',data:{usage:{inputTokens:10,outputTokens:5,cacheReadTokens:20,totalTokens:35},message:{content:[{type:'reasoning',text:'pngPath and private-secret reasoning'}]}}},
    {type:'tool/call',data:{callId:'one',name:'bash',arguments:'private-secret command'}},
    {type:'tool/result',data:{message:{toolCallId:'one',isError:true,content:[{text:'private-secret failure'}]}}},
    {type:'tool/call',data:{callId:'two',name:'openbone_project_preview',arguments:'private-secret request'}},
    {type:'tool/result',time:200,data:{message:{toolCallId:'two',isError:false}}},
  ]);
  assert.equal(report.steps,1);assert.equal(report.shellCalls,1);assert.equal(report.failedToolCalls,1);assert.equal(report.timeToFirstExportMs,100);
  assert.equal(report.environmentDetourMessages,1);assert.equal(report.usage.totalTokens,35);assert.equal(report.rawContentIncluded,false);
  assert.ok(!JSON.stringify(report).includes('private-secret'));
});
