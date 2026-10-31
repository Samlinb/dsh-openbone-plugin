// DSH browser module factory. Uses the Host's React instance and supported slots.
window.__ModuleLoader__.load({ id: 'dsh-openbone-plugin', factory: require => {
  const { createElement: h, useState, useSyncExternalStore, useEffect, useRef } = require('react');
  const dictionaries = {
    en: {
      title: 'OpenBone Studio', intro: 'From your first character to a refined animation. Connect once, then create and review through chat.',
      setup: '1 · Connect your workspace', address: 'Service address', addressHint: 'The built-in service is https://openbone.dsh.roorobot.com/. Your DSH server and browser must be able to reach its network. You can enter another service address.',
      mode: 'Account', trial: 'Automatic trial', manual: 'I have an access key', trialHint: 'Use the service root address. Your first connection activates a trial and securely stores its access; retries keep the same account.',
      manualHint: 'Use your full account address, including /u/your-account/.', key: 'Access key', keyHint: 'Leave blank to keep the saved key or use the server environment credential. Never paste a key into chat.',
      save: 'Save connection', saving: 'Saving…', discard: 'Discard changes', clearKey: 'Remove saved key on save', unsaved: 'Unsaved changes', saved: 'Connection saved. Continue with step 2 to check access.', failed: 'Could not save. Your settings may have changed elsewhere. Reload this page and try again.',
      missing: 'Enter the service address to continue.', invalid: 'Enter a complete HTTPS address ending in /. Localhost may use HTTP. Do not include a key, query or fragment.',
      pending: 'Setup needed', configured: 'Settings saved · connection not checked', advanced: 'Advanced settings', env: 'Credential environment variable', timeout: 'Timeout (milliseconds)',
      check: '2 · Check your connection', checkHint: 'Save first, then check the real service here. Automatic trials activate at this step. Your access key stays on the DSH server.',
      checkPrompt: 'Check my OpenBone connection and list the available projects. Explain any connection problem and how I can fix it.', copyCheck: 'Copy connection check', copied: 'Copied — paste into your chat', copyFailed: 'Copy unavailable. Select and copy the text below.',
      create: '3 · Create your first animation', createHint: 'Start small, inspect the actual preview, and refine it with feedback.',
      createPrompt: 'Use OpenBone prepare to check this chat and the starter project. Create an original bouncing rabbit: generate missing character parts, inspect the assembled rig, animate it, show actual playback and save. Explain any unavailable capability.', copyCreate: 'Copy first task',
      tips: 'Keep creating', preview: 'After an edit, ask for a fresh preview. If the link expires, request another.', undo: 'To step back, say “Undo the last edit and show a new preview.”', saveTip: 'Ask to save your project before the service restarts.',
      recovery: 'Having trouble?', recoveryText: 'Address rejected: use the complete address from your administrator. Cannot connect: check that the service is running and reachable from the DSH server. Access denied or trial expired: contact your administrator; reinstalling does not extend a trial.', loading: 'Loading workspace settings…', unavailable: 'Settings are unavailable. Enable OpenBone Studio and check that your DSH version supports plugin settings.',
      checkNow: 'Check connection', checking: 'Checking connection…', connected: 'Connected · available projects:', saveFirst: 'Save your connection settings before checking.', connectionFailed: 'Could not connect. Check that the service is running and reachable from the DSH server.', accessDenied: 'Access denied. Check your account address and key, or contact your administrator if your trial has expired.', trialFailed: 'Trial activation failed. Check that the address is the service root and that your DSH supports credential storage. Contact your administrator if access expired.', responseFailed: 'This address did not return an OpenBone service response. Check the address with your administrator.', checkUnsupported: 'The connection check is unavailable on this DSH installation. Use the chat request below to check access.',
    },
    zh: {
      title: 'OpenBone Studio', intro: '从第一个角色到细致的动画。完成一次连接，就可以在聊天中创作、预览并持续调整。',
      setup: '1 · 连接创作空间', address: '服务地址', addressHint: '内置服务为 https://openbone.dsh.roorobot.com/。DSH 服务端和浏览器都需要能够访问其所在网络，也可以填写其他服务地址。',
      mode: '使用方式', trial: '自动开通试用', manual: '我已有访问密钥', trialHint: '填写服务根地址。首次连接会开通试用并安全保存访问凭据；重试将继续使用同一账号。',
      manualHint: '填写完整账号地址，保留 /u/你的账号/ 路径。', key: '访问密钥', keyHint: '留空可保留已保存的密钥，或使用服务端环境凭据。不要把密钥粘贴到聊天中。',
      save: '保存连接', saving: '正在保存…', discard: '放弃修改', clearKey: '保存时移除已存密钥', unsaved: '有尚未保存的修改', saved: '连接设置已保存。继续第 2 步，检查实际访问是否正常。', failed: '保存失败，设置可能已在其他地方更改。请重新打开此页后重试。',
      missing: '请先填写服务地址。', invalid: '请填写以 / 结尾的完整 HTTPS 地址。本机地址允许 HTTP。地址中不要包含密钥、查询参数或片段。',
      pending: '等待配置', configured: '设置已保存 · 尚未检查连接', advanced: '高级设置', env: '凭据环境变量', timeout: '超时时间（毫秒）',
      check: '2 · 检查连接', checkHint: '先保存设置，再在这里检查真实服务。自动试用会在此时开通；访问密钥始终保留在 DSH 服务端。',
      checkPrompt: '检查我的 OpenBone 连接并列出可用工程。如果连接失败，请解释原因和修复方法。', copyCheck: '复制连接检查请求', copied: '已复制，粘贴到聊天即可', copyFailed: '暂时无法自动复制，请手动选择下方文字复制。',
      create: '3 · 制作第一个动画', createHint: '从小任务开始，查看真实预览，再根据效果给出反馈。',
      createPrompt: '先用 OpenBone 创作准备检查连接和 starter 工程。创建一个原创的蹦跳兔子：生成缺少的分件贴图、检查组装后的绑定、制作动画、查看真实播放并保存。如果缺少能力，请直接解释原因。', copyCreate: '复制第一个创作任务',
      tips: '继续创作', preview: '每次修改后，请生成新预览；预览链接过期时，可以重新生成。', undo: '想退回一步时，可以说：“撤销上次修改，再给我看新预览。”', saveTip: '服务重启前，记得让助手保存工程。',
      recovery: '遇到问题？', recoveryText: '地址无效：使用管理员提供的完整地址。无法连接：检查服务是否运行，以及 DSH 服务端能否访问。访问被拒绝或试用到期：联系管理员；重新安装不会延长试用。', loading: '正在读取创作空间设置…', unavailable: '暂时无法读取设置。请启用 OpenBone Studio，并检查 DSH 版本是否支持插件配置页。',
      checkNow: '检查连接', checking: '正在检查连接…', connected: '已连接 · 可用工程数：', saveFirst: '请先保存连接设置，再检查访问。', connectionFailed: '无法连接。请检查服务是否运行，以及 DSH 服务端能否访问。', accessDenied: '访问被拒绝。请检查账号地址和密钥；试用到期时请联系管理员。', trialFailed: '试用开通失败。请检查是否填写了服务根地址，以及 DSH 是否支持凭据存储。访问到期时请联系管理员。', responseFailed: '此地址没有返回 OpenBone 服务响应，请向管理员确认地址。', checkUnsupported: '当前 DSH 安装暂不支持页面连接检查，可使用下方聊天请求检查访问。',
    },
  };
  function apply(ctx) {
    ctx.effect(() => {
      const style = document.createElement('style');
      style.textContent = `.openbone-studio{font-size:14px;color:var(--dsw-alias-label-primary,inherit)}.openbone-studio h3{margin:0 0 12px;font-size:17px}.openbone-studio small{color:var(--dsw-alias-label-secondary,#666);font-size:12px}.openbone-studio button{font:inherit;border:1px solid var(--dsw-alias-label-quaternary,#ccc);background:var(--dsw-alias-bg-layer-3,#fff);color:inherit}.openbone-studio button:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6)}.openbone-studio button:disabled{opacity:.45;cursor:default!important}.openbone-studio button:focus-visible,.openbone-studio input:focus-visible,.openbone-studio select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#526be9);outline-offset:2px}.openbone-studio button[data-primary]{background:var(--dsw-alias-label-primary,#222);color:var(--dsw-alias-bg-layer-3,#fff);border-color:transparent}.openbone-studio select{background:var(--dsw-alias-bg-layer-3,#fff);color:inherit;border:1px solid #8886;border-radius:8px;max-width:100%}.openbone-studio blockquote{padding:12px 16px;border-left:3px solid var(--dsw-alias-state-business-primary,#526be9);background:var(--dsw-alias-bg-layer-2,#f5f6f8);border-radius:0 8px 8px 0;font-size:13px}.openbone-studio summary{cursor:pointer}.openbone-studio [role=status]{font-size:13px}.openbone-studio details{margin-top:16px}@media(max-width:520px){.openbone-studio section{padding:16px!important}.openbone-studio select{display:block;margin:8px 0!important}}`;
      document.head.appendChild(style);
      return () => style.remove();
    });
    ctx.effect(() => ctx.locale.register('openbone.setup', dictionaries));
    const t = ctx.locale.bind('openbone.setup');
    const form = ctx.configForms.get('openbone');
    function Studio() {
      const state = useSyncExternalStore(cb => form.subscribe(cb), () => form.getSnapshot());
      const [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
      const [check, setCheck] = useState(null);
      const checkController = useRef(null);
      useEffect(() => () => checkController.current?.abort(), []);
      const checked = !draft && check?.revision === state.revision ? check : null;
      const value = draft?.value ?? state.value ?? {};
      const edit = (field, next) => setDraft(current => ({ revision: current?.revision ?? state.revision, value: { ...(current?.value ?? state.value), [field]: next } }));
      const field = (name, label, type = 'text', hint) => h('label', { style: { display: 'grid', gap: 6, margin: '16px 0' } }, t(label), h('input', { type, value: value[name] ?? '', disabled: busy || !state.writable, autoComplete: type === 'password' ? 'new-password' : 'off', placeholder: name === 'serviceUrl' ? 'https://animation.example.com/' : undefined, onChange: e => edit(name, type === 'number' ? Number(e.target.value) : e.target.value), style: { padding: 10, border: '1px solid #8886', borderRadius: 8, background: 'transparent', color: 'inherit', width: '100%', boxSizing: 'border-box' } }), hint && h('small', null, t(hint)));
      const button = (label, onClick, disabled = false) => h('button', { type: 'button', 'data-primary': label === 'save' || label === 'saving' ? '' : undefined, disabled: busy || disabled, onClick, style: { padding: '9px 16px', borderRadius: 8, cursor: 'pointer', margin: '8px 8px 0 0' } }, t(label));
      const copy = async key => { try { await navigator.clipboard.writeText(t(key)); setMessage('copied'); } catch { setMessage('copyFailed'); } };
      async function checkAccess() {
        if (draft || !state.value?.serviceUrl) { setMessage('saveFirst'); return; }
        setBusy(true); setCheck(null);
        const controller = new AbortController(); checkController.current = controller;
        const revision = state.revision;
        try {
          const response = await fetch(new URL('api/openbone-studio/check', document.baseURI), { method: 'POST', credentials: 'same-origin', redirect: 'error', signal: controller.signal });
          if (response.status === 404) { setCheck({ revision, message: 'checkUnsupported' }); return; }
          const result = await response.json();
          if (result.connected === true) setCheck({ revision, connected: true, count: result.projectCount });
          else setCheck({ revision, message: result.code === 'ACCESS_DENIED' ? 'accessDenied' : /TRIAL|CREDENTIAL/.test(result.code) ? 'trialFailed' : result.code === 'INVALID_CONFIG' || result.code === 'SETUP_REQUIRED' ? 'invalid' : result.code === 'INVALID_SERVICE_RESPONSE' ? 'responseFailed' : 'connectionFailed' });
        } catch { if (!controller.signal.aborted) setCheck({ revision, message: 'checkUnsupported' }); }
        finally { if (!controller.signal.aborted) setBusy(false); }
      }
      async function save() {
        const address = (value.serviceUrl ?? '').trim();
        if (!address) return setMessage('missing');
        try {
          const url = new URL(address);
          if (!(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) || !/^\/(?:[a-z0-9-]+\/)*$/.test(url.pathname) || url.username || url.password || url.search || url.hash) return setMessage('invalid');
        } catch { return setMessage('invalid'); }
        setBusy(true); setMessage('');
        try {
          const ops = ['serviceUrl', 'autoTrial', 'tokenEnv', 'timeoutMs'].map(name => ({ op: 'set', path: [name], value: name === 'serviceUrl' ? address : value[name] }));
          if (value.accessToken) ops.push({ op: 'set', path: ['accessToken'], value: value.accessToken });
          else if (value.clearKey) ops.push({ op: 'unset', path: ['accessToken'] });
          const accepted = await form.mutate(ops, draft?.revision ?? state.revision);
          if (accepted) setDraft(null);
          setMessage(accepted ? 'saved' : 'failed');
        } catch { setMessage('failed'); } finally { setBusy(false); }
      }
      if (state.status !== 'ready') return h('p', { role: 'status' }, t(state.status === 'loading' ? 'loading' : 'unavailable'));
      const section = (title, ...children) => h('section', { style: { border: '1px solid #8884', padding: 20, borderRadius: 12, margin: '18px 0' } }, h('h3', null, t(title)), ...children);
      return h('div', { className: 'openbone-studio', style: { maxWidth: 720, lineHeight: 1.6 } },
        h('p', null, t('intro')), h('p', { role: 'status' }, checked?.connected ? `${t('connected')} ${checked.count}` : t(state.value?.serviceUrl ? 'configured' : 'pending')),
        section('setup', field('serviceUrl', 'address', 'url', 'addressHint'),
          h('label', null, t('mode'), h('select', { value: value.autoTrial ? 'trial' : 'manual', disabled: busy || !state.writable, onChange: e => edit('autoTrial', e.target.value === 'trial'), style: { marginLeft: 12, padding: 8 } }, h('option', { value: 'trial' }, t('trial')), h('option', { value: 'manual' }, t('manual')))),
          h('p', null, t(value.autoTrial ? 'trialHint' : 'manualHint')),
          !value.autoTrial && field('accessToken', 'key', 'password', 'keyHint'),
          h('details', null, h('summary', null, t('advanced')), field('tokenEnv', 'env'), field('timeoutMs', 'timeout', 'number'), button('clearKey', () => { edit('clearKey', true); edit('accessToken', ''); }, !state.writable)),
          button(busy ? 'saving' : 'save', save, !state.writable),
          draft && button('discard', () => { setDraft(null); setMessage(''); }),
          draft && h('p', null, t('unsaved')),
          h('p', { role: 'status', 'aria-live': 'polite' }, message ? t(message) : '')),
        section('check', h('p', null, t('checkHint')), button(busy ? 'checking' : 'checkNow', checkAccess, !!draft || !state.value?.serviceUrl), checked && h('p', { role: 'status', 'aria-live': 'polite' }, checked.connected ? `${t('connected')} ${checked.count}` : t(checked.message)), h('details', null, h('summary', null, t('copyCheck')), button('copyCheck', () => copy('checkPrompt')), h('blockquote', { style: { userSelect: 'text', margin: '16px 0' } }, t('checkPrompt')))),
        section('create', h('p', null, t('createHint')), button('copyCreate', () => copy('createPrompt')), h('blockquote', { style: { userSelect: 'text', margin: '16px 0' } }, t('createPrompt'))),
        section('tips', h('ul', null, ...['preview', 'undo', 'saveTip'].map(key => h('li', { key }, t(key))))),
        h('details', null, h('summary', null, t('recovery')), h('p', null, t('recoveryText'))));
    }
    ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-openbone-plugin', locale: 'openbone.setup' }, Studio)));
    function ClientWorkshop(){
      const [sessionId,setSessionId]=useState(()=>localStorage.getItem('openbone.client.session.v1')||''),[error,setError]=useState('');
      async function start(){try{if(!ctx.sessions)throw new Error('DSH session service is unavailable.');const id=await ctx.sessions.create();localStorage.setItem('openbone.client.session.v1',id);setSessionId(id);}catch(e){setError(e.message);}}
      const src=new URL('api/openbone-studio/client-ui/client-studio.html',document.baseURI);src.hash=new URLSearchParams({session:sessionId}).toString();
      return h('div',{className:'openbone-studio'},error&&h('p',{role:'alert'},error),sessionId&&h('button',{onClick:()=>ctx.uiWorkspace?.openSession(sessionId)},'打开此工程的创作对话'),sessionId?h('iframe',{title:'OpenBone client image workbench',src:src.href,style:{width:'100%',height:'calc(100vh - 100px)',border:0}}):h('button',{onClick:start},'打开客户端图片工作台'),h('details',null,h('summary',null,'连接设置'),h(Studio)));
    }
    ctx.effect(()=>ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'openbone-studio',locale:'openbone.setup'},ClientWorkshop)));
    ctx.effect(()=>ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'openbone-studio',order:5,locale:'openbone.setup',label:()=> 'OpenBone'},({size})=>h('span',{'aria-hidden':true,style:{fontSize:size}},'◇'))));

    function Welcome(props) {
      return h('div', { style: { padding: 16 } }, h('h3', null, t('title')), h('p', null, t('intro')), h('button', { onClick: props.onOpenDetails }, t('setup')));
    }
    ctx.effect(() => ctx.slots.inject('plugins.bundle.activation', () => ctx.slots.register({ name: 'plugins.bundle.activation', key: 'dsh-openbone-plugin', locale: 'openbone.setup' }, Welcome)));
  }
  return { apply, inject: ['slots', 'locale', 'configForms', 'sessions', 'uiWorkspace'] };
} });
