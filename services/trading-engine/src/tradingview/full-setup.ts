import { TradingViewBridge } from './TradingViewBridge';
import * as fs from 'fs';
import * as path from 'path';

const WEBHOOK_SECRET = '3bfb2b0cf92b1681e98af8d8ec0133ae774c81deac9841b4';
const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';

const FIND_MONACO = `
  (function() {
    var els = document.querySelectorAll('.monaco-editor.pine-editor-monaco');
    for (var e = 0; e < els.length; e++) {
      if (els[e].offsetHeight === 0) continue;
      var el = els[e];
      var fk;
      for (var i = 0; i < 20; i++) { if (!el) break; fk = Object.keys(el).find(function(k){return k.startsWith('__reactFiber');}); if(fk) break; el=el.parentElement; }
      if (!fk) continue;
      var c = el[fk];
      for (var d = 0; d < 30; d++) { if(!c) break; if(c.memoizedProps&&c.memoizedProps.value&&c.memoizedProps.value.monacoEnv){var env=c.memoizedProps.value.monacoEnv; if(env.editor){var eds=env.editor.getEditors();if(eds.length>0){window.__pvx=env;return true;}}} c=c.return; }
    }
    return false;
  })()
`;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function injectAndCompile(ev: Function, source: string, label: string): Promise<boolean> {
  // Open Pine editor
  await ev(`document.querySelector('[data-name="pine-dialog-button"]').click()`);
  await sleep(2500);

  // Find Monaco
  let ready = await ev(FIND_MONACO);
  if (!ready) {
    await ev(`document.querySelector('[data-name="pine-dialog-button"]').click()`);
    await sleep(2500);
    ready = await ev(FIND_MONACO);
  }
  if (!ready) { console.error(`  Monaco not found for ${label}`); return false; }

  // Inject code
  await ev(`window.__pvx.editor.getEditors()[0].setValue(${JSON.stringify(source)})`);
  console.log(`  ${label}: code injected`);

  // Focus + Ctrl+Enter to compile
  await ev(`(function(){var ta=document.querySelector('[data-name="pine-dialog"] textarea.inputarea');if(ta)ta.focus();})()`);
  await sleep(300);

  // Try "Add to chart" button first, fall back to Ctrl+Enter
  const btn = await ev(`
    (function() {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var t = btns[i].getAttribute('title') || '';
        if (/add to chart|update on chart/i.test(t) && btns[i].offsetHeight > 0) { btns[i].click(); return t; }
      }
      return null;
    })()
  `);

  if (!btn) {
    // Ctrl+Enter fallback
    await ev(`(function(){var ta=document.querySelector('[data-name="pine-dialog"] textarea.inputarea');if(ta)ta.focus();})()`);
    await sleep(200);
    // Need to use the bridge's sendCDP
    return true; // Signal that we need Ctrl+Enter
  }

  console.log(`  ${label}: clicked "${btn}"`);
  return true;
}

async function main() {
  const bridge = new TradingViewBridge();

  // Wait for chart to load after restart
  console.log('Waiting for chart to load...');
  for (let i = 0; i < 15; i++) {
    try {
      await bridge.ensureConnected();
      const s = await bridge.getChartState();
      if (s.symbol) { console.log(`Chart loaded: ${s.symbol} @ ${s.resolution}`); break; }
    } catch {}
    await sleep(2000);
  }

  const ev = (bridge as any).evaluate.bind(bridge);

  // Step 1: Switch to M15
  console.log('\nStep 1: Switching to M15...');
  await bridge.setTimeframe('15');
  await sleep(5000);
  const state = await bridge.getChartState();
  console.log(`  Now on: ${state.resolution}`);

  // Step 2: Remove existing ProvidenceX strategy (we'll re-add both)
  console.log('\nStep 2: Removing old ProvidenceX study...');
  const pvxStudy = state.studies.find(s => /ProvidenceX/i.test(s.name));
  if (pvxStudy) {
    await ev(`
      (function() {
        var api = ${CHART_API};
        api.removeEntity('${pvxStudy.id}');
      })()
    `);
    console.log(`  Removed: ${pvxStudy.name}`);
    await sleep(2000);
  }

  // Step 3: Inject the STRATEGY (for backtesting)
  console.log('\nStep 3: Adding Strategy (backtest)...');
  const stratSrc = fs.readFileSync(path.resolve(__dirname, '../../pine/ProvidenceX_MTF_ICT_Strategy.pine'), 'utf8');

  await ev(`document.querySelector('[data-name="pine-dialog-button"]').click()`);
  await sleep(3000);
  let ready = await ev(FIND_MONACO);
  if (!ready) {
    await ev(`document.querySelector('[data-name="pine-dialog-button"]').click()`);
    await sleep(3000);
    ready = await ev(FIND_MONACO);
  }
  if (!ready) { console.error('Monaco not found'); bridge.disconnect(); process.exit(1); }

  await ev(`window.__pvx.editor.getEditors()[0].setValue(${JSON.stringify(stratSrc)})`);
  console.log('  Strategy code injected');

  // Compile
  await ev(`(function(){var ta=document.querySelector('[data-name="pine-dialog"] textarea.inputarea');if(ta)ta.focus();})()`);
  await sleep(300);
  await (bridge as any).sendCDP('Input.dispatchKeyEvent', { type:'keyDown', modifiers:2, key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  await (bridge as any).sendCDP('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter' });
  console.log('  Compiling strategy...');
  await sleep(10000);

  // Verify strategy
  let state2 = await bridge.getChartState();
  const hasStrat = state2.studies.some(s => /Strategy/i.test(s.name));
  console.log(`  Strategy on chart: ${hasStrat ? 'YES' : 'NO'}`);

  // Step 4: Now inject the SIGNAL INDICATOR (for live webhook alerts)
  // We need to create a new script for it
  console.log('\nStep 4: Adding Signal Indicator (live alerts)...');
  const signalSrc = fs.readFileSync(path.resolve(__dirname, '../../pine/ProvidenceX_MTF_ICT.pine'), 'utf8');

  // The editor currently has the strategy. Set it to the indicator code.
  await ev(`window.__pvx.editor.getEditors()[0].setValue(${JSON.stringify(signalSrc)})`);
  console.log('  Signal indicator code injected');

  // Compile (this will either update or add)
  await ev(`(function(){var ta=document.querySelector('[data-name="pine-dialog"] textarea.inputarea');if(ta)ta.focus();})()`);
  await sleep(300);
  await (bridge as any).sendCDP('Input.dispatchKeyEvent', { type:'keyDown', modifiers:2, key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  await (bridge as any).sendCDP('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter' });
  console.log('  Compiling indicator...');
  await sleep(10000);

  // Verify indicator
  let state3 = await bridge.getChartState();
  const hasSignal = state3.studies.some(s => /ProvidenceX.*Signal/i.test(s.name));
  const hasStrat2 = state3.studies.some(s => /ProvidenceX.*Strategy/i.test(s.name));
  console.log(`  Signal indicator on chart: ${hasSignal ? 'YES' : 'NO'}`);
  console.log(`  Strategy still on chart: ${hasStrat2 ? 'YES' : 'NO'}`);

  // Step 5: Set webhook secret on the signal indicator
  if (hasSignal) {
    console.log('\nStep 5: Setting webhook secret...');
    const signalStudy = state3.studies.find(s => /ProvidenceX.*Signal/i.test(s.name));
    if (signalStudy) {
      const inputs = await ev(`
        (function() {
          var api = ${CHART_API};
          var study = api.getStudyById('${signalStudy.id}');
          if (!study) return null;
          return study.getInputValues();
        })()
      `);
      if (inputs) {
        // Find the empty string input (webhook secret)
        const secretInput = inputs.find((inp: any) => typeof inp.value === 'string' && inp.value === '' && inp.id.startsWith('in_'));
        if (secretInput) {
          secretInput.value = WEBHOOK_SECRET;
          await ev(`
            (function() {
              var api = ${CHART_API};
              var study = api.getStudyById('${signalStudy.id}');
              study.setInputValues(${JSON.stringify(inputs)});
            })()
          `);
          console.log('  Webhook secret set!');
        }
      }
    }
  }

  // Final summary
  console.log('\n=== FINAL STATE ===');
  const finalState = await bridge.getChartState();
  console.log(`Chart: ${finalState.symbol} @ M${finalState.resolution}`);
  console.log('Studies:');
  finalState.studies.forEach((s: any, i: number) => {
    const tag = /Strategy/i.test(s.name) ? ' [BACKTEST]' : /Signal/i.test(s.name) ? ' [LIVE ALERTS]' : '';
    console.log(`  ${i + 1}. ${s.name}${tag}`);
  });

  bridge.disconnect();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
