/* Standalone checklist exporter — builds ONE self-contained .html file per
   checklist (inline CSS + inline JS + embedded data, zero network calls,
   no sidebar / nav / views). Works from file:// and survives sharing. */
(function (global) {
  "use strict";

  function slug(name) {
    const s = String(name || "checklist").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || "checklist";
  }
  function escHTML(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  const ICONS = {
    search: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.34-4.34"/></svg>',
    sun: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>'
  };

  const CSS = [
    ':root{--bg:#f1f5f9;--surface:#fff;--surface2:#f8fafc;--fg:#0f172a;--mut:#64748b;--line:#e2e8f0;--acc:#2563eb;--ok:#059669;--okbg:#ecfdf5;--shadow:0 1px 2px rgba(15,23,42,.06)}',
    '[data-theme="dark"]{--bg:#020617;--surface:#0f172a;--surface2:#111e36;--fg:#e2e8f0;--mut:#94a3b8;--line:rgba(148,163,184,.18);--acc:#60a5fa;--ok:#34d399;--okbg:rgba(52,211,153,.12);--shadow:0 1px 2px rgba(0,0,0,.4)}',
    '*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);font-size:14.5px;line-height:1.55;-webkit-font-smoothing:antialiased}',
    '.wrap{max-width:760px;margin:0 auto;padding:28px 16px 64px}',
    '.head{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px}',
    '.head h1{margin:0;font-size:24px;letter-spacing:-.02em;flex:1;min-width:200px}',
    '.meta{color:var(--mut);font-size:13px;margin-top:4px;font-weight:400}',
    '.iconbtn{width:36px;height:36px;border-radius:10px;display:inline-grid;place-items:center;cursor:pointer;background:var(--surface);border:1px solid var(--line);color:var(--mut);flex:none}',
    '.iconbtn:hover{color:var(--fg)}',
    '.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}',
    '.pad{padding:16px}',
    '.big{font-size:26px;font-weight:800;letter-spacing:-.02em}',
    '.track{height:10px;border-radius:999px;background:var(--line);overflow:hidden;margin-top:10px}',
    '.track>div{height:100%;border-radius:inherit;background:linear-gradient(90deg,#2563eb,#4f46e5 60%,#06b6d4);transition:width .3s}',
    '.toolbar{display:flex;gap:8px;flex-wrap:wrap;padding:12px;align-items:center}',
    '.search{flex:1;min-width:180px;display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:8px 11px;color:var(--mut)}',
    '.search input{border:0;background:transparent;outline:none;width:100%;font-size:13.5px;color:var(--fg)}',
    '.seg{display:inline-flex;gap:2px;background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:3px}',
    '.seg button{border:0;background:transparent;cursor:pointer;font-size:12.5px;font-weight:600;color:var(--mut);padding:6px 10px;border-radius:7px;white-space:nowrap}',
    '.seg button.on{background:var(--surface);color:var(--fg);box-shadow:var(--shadow)}',
    'select,.txt{background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:13px;color:var(--fg);outline:none}',
    '.btn{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;padding:8px 13px;border-radius:10px;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--fg)}',
    '.btn.danger{color:#dc2626}[data-theme="dark"] .btn.danger{color:#f87171}',
    'ul{list-style:none;margin:0;padding:6px;display:flex;flex-direction:column;gap:6px}',
    '.row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:start;padding:11px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}',
    '.row.done{background:var(--okbg)}',
    '.cbx{appearance:none;width:20px;height:20px;margin:2px 0 0;cursor:pointer;border-radius:7px;border:1.5px solid var(--mut);background:var(--surface);display:grid;place-items:center;color:#fff}',
    '.cbx:checked{background:var(--ok);border-color:var(--ok)}',
    '.cbx:checked::after{content:"";width:11px;height:11px;background:#fff;clip-path:polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0%,43% 62%)}',
    '.t{font-size:13.8px;font-weight:600;line-height:1.45;word-break:break-word;cursor:pointer}',
    '.row.done .t{color:var(--mut);text-decoration:line-through}',
    '.pill{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:4px 9px;border-radius:999px;border:1px solid var(--line);color:var(--mut);white-space:nowrap}',
    '.pill.done{color:var(--ok);border-color:currentColor}',
    '.mini{width:28px;height:28px;border-radius:8px;display:inline-grid;place-items:center;cursor:pointer;background:transparent;border:0;color:var(--mut);font-size:14px}',
    '.mini:hover{background:var(--surface2);color:var(--fg)}',
    '.row-check{display:flex;align-items:flex-start;gap:2px;flex:none}',
    '.expander{width:22px;height:24px;border-radius:7px;display:grid;place-items:center;cursor:pointer;background:transparent;border:0;color:var(--mut);font-size:12px}',
    '.expander.off{visibility:hidden}',
    '.expander.closed{transform:rotate(-90deg)}',
    '.meta{font-size:11.5px;color:var(--mut);margin-top:4px}',
    '.submain{min-width:0}',
    '.sdesc{font-size:12px;color:var(--mut);margin-top:3px;line-height:1.5;word-break:break-word;white-space:pre-wrap}',
    '.sdesc.expanded,.ldesc.expanded{-webkit-line-clamp:unset;display:block}',
    '.ldesc{font-size:13px;color:var(--mut);margin-top:6px;line-height:1.55;white-space:pre-wrap}',
    '.codeblock{margin:8px 0 2px;padding:0;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:var(--surface2);display:block}',
    '.codeblock code{display:block;padding:10px 12px;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.8px;line-height:1.55;color:var(--fg);white-space:pre}',
    '.codehead{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--mut)}',
    '.codehead .lang{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.codecopy{border:1px solid var(--line);background:var(--surface);color:var(--mut);border-radius:7px;font-size:11px;font-weight:700;padding:3px 8px;cursor:pointer}',
    'code.icode{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86em;background:var(--surface2);border:1px solid var(--line);border-radius:6px;padding:1px 5px;color:var(--fg)}',
    '.tok-k{color:#c4b5fd;font-weight:600}.tok-s{color:#86efac}.tok-c{color:#8b949e;font-style:italic}.tok-n{color:#fbbf24}.tok-f{color:#7dd3fc}',
    '[data-theme=\"light\"] .tok-k{color:#7c3aed}[data-theme=\"light\"] .tok-s{color:#15803d}[data-theme=\"light\"] .tok-c{color:#6b7280}[data-theme=\"light\"] .tok-n{color:#b45309}[data-theme=\"light\"] .tok-f{color:#0369a1}',
    '.tags{display:inline-flex;flex-wrap:wrap;gap:5px}',
    '.title-row{display:flex;flex-wrap:wrap;align-items:center;gap:3px 8px;min-width:0}',
    '.tag{display:inline-flex;align-items:center;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;border:1px solid var(--line);background:var(--surface2);color:var(--acc)}',
    '.subs{list-style:none;margin:10px 0 2px;padding:0 0 0 12px;display:flex;flex-direction:column;gap:4px;border-left:2px solid var(--line)}',
    '.sub{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:9px;align-items:start;padding:7px 9px;border-radius:9px;background:var(--surface2);border:1px solid var(--line)}',
    '.sub .cbx{width:17px;height:17px}',
    '.sub .t{font-size:13px;font-weight:500}',
    '.sub.done .t{color:var(--mut);text-decoration:line-through}',
    '.subadd{display:flex;gap:8px;padding:8px 4px 2px 12px}',
    '.subadd input{flex:1}',
    '.side{display:flex;gap:4px;align-items:center}',
    '.addrow{display:flex;gap:8px;padding:12px}.addrow input{flex:1}',
    '.empty{padding:36px 20px;text-align:center;color:var(--mut)}',
    '.foot{margin-top:14px;font-size:12px;color:var(--mut);display:flex;gap:8px;flex-wrap:wrap}',
    '.toast{position:fixed;bottom:18px;right:18px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:11px 14px;font-size:13px;box-shadow:0 12px 32px rgba(0,0,0,.25);z-index:9}',
    '@media print{.toolbar,.addrow,.iconbtn,.toast{display:none}.wrap{max-width:100%}}'
  ].join("\n");

  // Inner runtime. Rule: double-quoted JS strings ONLY, HTML attributes use
  // single quotes inside them — so the outer file never needs backslash hell.
  const APP = [
    "(function(){",
    "\"use strict\";",
    "var data=JSON.parse(document.getElementById(\"cl-data\").textContent);",
    "var KEY=\"scl-\"+data.listId,TKEY=KEY+\"-theme\";",
    "function $(s){return document.querySelector(s)}",
    "function esc(s){return String(s).replace(/[&<>\"']/g,function(m){return {\"&\":\"&amp;\",\"<\":\"&lt;\",\">\":\"&gt;\",'\"':\"&quot;\",\"'\":\"&#39;\"}[m]})}",
    "function load(k,f){try{var v=localStorage.getItem(k);return v==null?f:JSON.parse(v)}catch(e){return f}}",
    "function save(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}",
    "var store=load(KEY,{checked:{},added:[]});",
    "if(!store||!store.checked)store={checked:{},added:[]};",
    "if(!Array.isArray(store.added))store.added=[];",
    "if(!Array.isArray(store.cut))store.cut=[];",
    "if(!store.subs)store.subs={};",
    "function cutit(id){if(store.cut.indexOf(id)===-1)store.cut.push(id)}",
    "function alive(id){return store.cut.indexOf(id)===-1}",
    "var filter=\"all\",q=\"\",sort=\"newest\",shut={},addingTo=null;",
    "function all(){var base=data.items.filter(function(r){return alive(r.id)});",
    "var ext=store.added.filter(function(r){return alive(r.id)});",
    "return base.concat(ext).map(function(r){var extra=store.subs[r.id]||[];",
    "return {id:r.id,title:r.title,desc:r.desc||'',tags:r.tags||[],createdAt:r.createdAt,subs:(r.subs||[]).concat(extra).filter(function(s){return alive(s.id)}).map(function(s){return {id:s.id,title:s.title,desc:s.desc||'',tags:s.tags||[],createdAt:s.createdAt}})}})}",
    "function done(id){return !!store.checked[id]}",
    "function effd(r){return done(r.id)}",
    "function setd(id,v){if(v)store.checked[id]=true;else delete store.checked[id]}",
    "var HLQ=String.fromCharCode(39);",
    "function hlSp(cls,txt){return '<span class='+HLQ+'tok-'+cls+HLQ+'>'+esc(txt)+'</span>'}",
    "var HLW={js:'await async break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return static super switch this throw try typeof var void while with yield of from as get set null undefined true false NaN Infinity',ts:'await async break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return static super switch this throw try typeof var void while with yield of from as get set interface type enum implements private public protected readonly abstract namespace declare module null undefined true false',py:'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self',sh:'if then elif else fi for while until do done case esac function select in time coproc export readonly local declare typeset echo printf cd exit return shift source alias unalias test sudo',sql:'select from where group by order having limit offset join left right full inner outer cross on as and or not null in is like ilike between exists union all distinct insert into values update set delete create table alter drop index view primary key foreign references default check unique constraint into',json:'true false null',css:'color background border margin padding display flex grid position top left right bottom width height font size weight family style text align justify content items self overflow opacity transform transition animation shadow radius cursor import media charset supports keyframes face page layer container block inline none relative absolute fixed sticky',yaml:'true false null yes no on off'};",
    "function hlFam(l){l=String(l||'').toLowerCase();var m={javascript:'js',jsx:'js',typescript:'ts',tsx:'ts',java:'js',c:'js',cpp:'js',cs:'js',go:'js',rust:'js',php:'js',swift:'js',kotlin:'js',dart:'js',python:'py',bash:'sh',shell:'sh',zsh:'sh',console:'sh',terminal:'sh',dockerfile:'sh',yml:'yaml',toml:'yaml',ini:'yaml',rb:'py',ruby:'py',lua:'sql'};if(HLW[l]!==undefined)return l;if(m[l]!==undefined&&HLW[m[l]]!==undefined)return m[l];return 'js'}",
    "function hlIsKw(fam,w){return (' '+HLW[fam]+' ').indexOf(' '+w+' ')>-1}",
    "function hlTagInner(tag){var m=tag.match(/^<(\\/?)([A-Za-z][\\w:.-]*)([\\s\\S]*?)(\\/?)>$/);if(!m)return esc(tag);var h=esc('<'+m[1])+hlSp('k',m[2]);var rest=m[3]||'';var are=/(\\w[\\w:.-]*)(\\s*=\\s*(\\x22[^\\x22]*\\x22|\\x27[^\\x27]*\\x27))?/g;var l=0,am;while((am=are.exec(rest))){h+=esc(rest.slice(l,am.index));h+=hlSp('f',am[1]);if(am[2]){var vm=am[2].match(/^(\\s*=\\s*)([\\s\\S]*)$/);if(vm)h+=esc(vm[1])+hlSp('s',vm[2]);else h+=esc(am[2])}l=am.index+am[0].length}h+=esc(rest.slice(l))+esc(m[4]+'>');return h}",
    "function hlTagHTML(raw){var re=/(<!--[\\s\\S]*?-->)|(<\\/?[A-Za-z][^<>]*\\/?>)/g;var out='',last=0,m;while((m=re.exec(raw))){out+=esc(raw.slice(last,m.index));out+=m[1]?hlSp('c',m[1]):hlTagInner(m[2]);last=m.index+m[0].length}out+=esc(raw.slice(last));return out}",
    "function hlCode(code,lang){code=String(code||'');if(!code)return '';var L=String(lang||'').toLowerCase();if(L==='html'||L==='xml'||L==='svg')return hlTagHTML(code);var fam=hlFam(L);var cmt=/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*/;if(fam==='py'||fam==='yaml'||fam==='sh')cmt=/#[^\\n]*/;if(fam==='sql')cmt=/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*|\\-\\-[^\\n]*|#[^\\n]*/;var STD_PAT=/\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`/;var PY_PAT=/\"\"\"[\\s\\S]*?\"\"\"|'''[\\s\\S]*?'''|\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'/;var str=STD_PAT;if(fam==='py')str=PY_PAT;var re=new RegExp('('+cmt.source+')|('+str.source+')|\\\\b(\\\\d+(?:\\\\.\\\\d+)?)\\\\b|([A-Za-z_$][\\\\w$]*)','g');var out2='',last2=0,mm;while((mm=re.exec(code))){out2+=esc(code.slice(last2,mm.index));if(mm[1]!==undefined)out2+=hlSp('c',mm[1]);else if(mm[2]!==undefined)out2+=hlSp('s',mm[2]);else if(mm[3]!==undefined)out2+=hlSp('n',mm[3]);else if(mm[4]!==undefined){if(hlIsKw(fam,mm[4]))out2+=hlSp('k',mm[4]);else if(/^\\s*\\(/.test(code.slice(re.lastIndex,re.lastIndex+8)))out2+=hlSp('f',mm[4]);else out2+=esc(mm[4])}last2=mm.index+mm[0].length}out2+=esc(code.slice(last2));return out2}",
    "function tagsHTML(tags){var list=[];for(var ti=0;ti<(tags||[]).length;ti++){if(tags[ti])list.push(tags[ti])}if(!list.length)return '';var h='<span class='+HLQ+'tags'+HLQ+'>';for(var tj=0;tj<list.length;tj++){h+='<span class='+HLQ+'tag'+HLQ+'>#'+esc(list[tj])+'</span>'}return h+'</span>'}",
    "function matchQ(o,q){if(!q)return true;if(o.title.toLowerCase().indexOf(q)>-1)return true;var tg=o.tags||[];for(var mi=0;mi<tg.length;mi++){if(String(tg[mi]).toLowerCase().indexOf(q)>-1)return true}return false}",
    "function tagSuffix(tags){var l2=[];for(var si=0;si<(tags||[]).length;si++){if(tags[si])l2.push(tags[si])}return l2.length?' #'+l2.join(' #'):''}",
    "function inlineRich(t){var e=esc(t);e=e.replace(/`([^`\\n]+)`/g,\"<code class='icode'>$1</code>\");e=e.replace(/\\n/g,\"<br>\");return e}",
    "function rich(raw){var text=String(raw||'');if(!text)return '';var re=/```(\\w*)\\n?([\\s\\S]*?)(?:```|$)/g;var last=0,m,has=false,html='';while((m=re.exec(text))){has=true;html+=inlineRich(text.slice(last,m.index));var lang=(m[1]||'code').slice(0,20);var code=String(m[2]||'').replace(/\\n$/,'');html+=\"<pre class='codeblock'><div class='codehead'><span class='lang'>\"+esc(lang)+\"</span><button class='codecopy' data-cc='1' type='button'>Copy</button></div><code>\"+hlCode(code,lang)+\"</code></pre>\";last=m.index+m[0].length}html+=inlineRich(text.slice(last));return has?html:inlineRich(text)}",
    "function findRow(id){var rows=all();for(var i=0;i<rows.length;i++){if(rows[i].id===id)return {row:rows[i],sub:null};var ss=rows[i].subs||[];for(var j=0;j<ss.length;j++){if(ss[j].id===id)return {row:rows[i],sub:ss[j]}}}return null}",
    "function svis(s){var d=done(s.id);",
    "if(filter===\"active\"&&d)return false;",
    "if(filter===\"completed\"&&!d)return false;",
    "if(!matchQ(s,q))return false;",
    "return true;}",
    "function sorted(rows){var c=rows.slice();",
    "if(sort===\"oldest\")c.sort(function(a,b){return a.createdAt-b.createdAt});",
    "else if(sort===\"az\")c.sort(function(a,b){return a.title<b.title?-1:1});",
    "else if(sort===\"done\")c.sort(function(a,b){return (effd(b)?1:0)-(effd(a)?1:0)});",
    "else c.sort(function(a,b){return b.createdAt-a.createdAt});",
    "return c;}",
    "function visible(){var rows=all().map(function(r){return {id:r.id,title:r.title,desc:r.desc||'',tags:r.tags||[],createdAt:r.createdAt,subs:(r.subs||[]).filter(function(s){return svis(s)})}});",
    "rows=rows.filter(function(r){var d=effd(r);var self=(filter===\"all\"||(filter===\"active\"?!d:d))&&matchQ(r,q);return self||r.subs.length>0});",
    "return sorted(rows);}",
    "function subHTML(s,pid){var d=done(s.id);",
    "return \"<li class='sub\"+(d?\" done\":\"\")+\"' data-id='\"+esc(s.id)+\"' data-pid='\"+esc(pid)+\"'>\"+",
    "\"<input class='cbx' type='checkbox'\"+(d?\" checked\":\"\")+\" aria-label='\"+esc(s.title)+\"'>\"+",
    "\"<div class='submain'><div class='title-row'><span class='t'>\"+esc(s.title)+\"</span>\"+tagsHTML(s.tags)+\"</div>\"+(s.desc?\"<div class='sdesc'>\"+rich(s.desc)+\"</div>\":\"\")+\"</div>\"+",
    "\"<div class='side'><button class='mini' data-sdel='1' title='Delete'>&#10005;</button></div></li>\"}",
    "function rowHTML(r,idx){var d=effd(r);var subs=r.subs||[];var dn=subs.filter(function(s){return done(s.id)}).length;",
    "var open=!shut[r.id]||q||addingTo===r.id;var inner=subs.map(function(s){return subHTML(s,r.id)}).join(\"\");",
    "if(addingTo===r.id){inner+=\"<li class='subaddrow'><input id='subInput' class='txt' maxlength='200' placeholder='Type subtask, Enter to add, Esc to cancel'></li>\"}",
    "var sublist=((subs.length&&open)||addingTo===r.id)?\"<ul class='subs'>\"+inner+\"</ul>\":\"\";",
    "return \"<li class='row\"+(d?\" done\":\"\")+\"' data-id='\"+esc(r.id)+\"'>\"+",
    "\"<div class='row-check'><button class='expander\"+(subs.length?\"\":\" off\")+((subs.length&&shut[r.id]&&!q)?\" closed\":\"\")+\"' data-exp='1' title='Toggle subtasks'>&#9662;</button>\"+",
    "\"<input class='cbx' type='checkbox'\"+(d?\" checked\":\"\")+\" aria-label='\"+esc(r.title)+\" (independent)'>\"+\"</div>\"+",
    "\"<div class='submain'><div class='title-row'><span class='t'>\"+esc(r.title)+\"</span>\"+tagsHTML(r.tags)+\"</div>\"+(r.desc?\"<div class='sdesc'>\"+rich(r.desc)+\"</div>\":\"\")+\"<div class='meta'>#\"+(idx+1)+(subs.length?\" · \"+dn+\"/\"+subs.length+\" subs · parent separate\":\"\")+\"</div>\"+sublist+\"</div>\"+",
    "\"<div class='side'><span class='pill\"+(d?\" done\":\"\")+\"'>\"+(d?\"done\":\"pending\")+\"</span>\"+",
    "\"<button class='mini' data-addsub='1' title='Add subtask'>+</button>\"+",
    "\"<button class='mini' data-del='1' title='Delete'>&#10005;</button></div></li>\"}",
    "function rows2txt(rows){var out=[];rows.forEach(function(r){out.push(data.date+\" - [\"+(effd(r)?\"Completed\":\"Active\")+\"] - \"+r.title+tagSuffix(r.tags));(r.subs||[]).forEach(function(s){out.push(data.date+\" - [\"+(done(s.id)?\"Completed\":\"Active\")+\"] -   \\u2514 \"+s.title+tagSuffix(s.tags))})});return out.join(\"\\n\")}",
    "function render(){var rows=visible();var items=all();var tot=0,dn=0;items.forEach(function(r){tot++;if(effd(r))dn++;(r.subs||[]).forEach(function(s){tot++;if(done(s.id))dn++})});",
    "var pct=tot?Math.round(dn/tot*100):0;",
    "$(\"#ptext\").textContent=dn+\" / \"+tot+\" done (\"+pct+\"%)\";",
    "$(\"#bar\").style.width=pct+\"%\";",
    "$(\"#count\").textContent=rows.length+\" shown · \"+items.length+\" items\";",
    "var ul=$(\"#list\");",
    "if(!rows.length){ul.innerHTML=\"<div class='empty'>No items match. Adjust the search or filter.</div>\";return}",
    "ul.innerHTML=rows.map(function(r,i){return rowHTML(r,i)}).join(\"\");",
    "if(addingTo){var si=$(\"#subInput\");if(si)si.focus()}}",
    "function toast(m){var t=document.createElement(\"div\");t.className=\"toast\";t.textContent=m;document.body.appendChild(t);setTimeout(function(){t.remove()},2200)}",
    "function dl(name,text){var b=new Blob([text],{type:\"text/plain\"});var u=URL.createObjectURL(b);var a=document.createElement(\"a\");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u)},800)}",
    "$(\"#list\").addEventListener(\"click\",function(e){",
    "var t=e.target;if(t&&t.id===\"subInput\")return;",
    "function up(sel){return (t&&t.closest)?t.closest(sel):null}",
    "var cc=up(\"[data-cc]\");",
    "if(cc){e.stopPropagation();var pre=cc.closest(\"pre.codeblock\");var cel=pre?pre.querySelector(\"code\"):null;if(cel&&cel.innerText){if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(cel.innerText).then(function(){toast(\"Code copied\")})}}return}",
    "if(t&&t.classList&&t.classList.contains(\"sdesc\")){t.classList.toggle(\"expanded\");return}",
    "var eb=up(\"[data-exp]\");",
    "if(eb){e.stopPropagation();var pli=eb.closest(\"li[data-id]\");var pid=pli&&pli.getAttribute(\"data-id\");if(pid){if(shut[pid])delete shut[pid];else shut[pid]=1;addingTo=null;render()}return}",
    "var ab=up(\"[data-addsub]\");",
    "if(ab){e.stopPropagation();var ali=ab.closest(\"li[data-id]\");var aid=ali&&ali.getAttribute(\"data-id\");if(aid){addingTo=aid;delete shut[aid];render()}return}",
    "var sdel=up(\"[data-sdel]\");",
    "if(sdel){e.stopPropagation();var sli=sdel.closest(\"li[data-id]\");var sid=sli&&sli.getAttribute(\"data-id\");if(sid){cutit(sid);delete store.checked[sid];addingTo=null;save(KEY,store);render();toast(\"Subtask deleted\")}return}",
    "var li=up(\"li[data-id]\");if(!li)return;",
    "var id=li.getAttribute(\"data-id\");",
    "if(up(\"[data-del]\")){e.stopPropagation();var f=findRow(id);if(f&&!f.sub){cutit(id);(f.row.subs||[]).forEach(function(s){cutit(s.id);delete store.checked[s.id]})}else{cutit(id)}delete store.checked[id];addingTo=null;save(KEY,store);render();toast(\"Item deleted\");return}",
    "if(t.classList&&t.classList.contains(\"cbx\"))return;",
    "if(!up(\".t\"))return;",
    "var g=findRow(id);if(!g)return;",
    "if(g.sub){if(done(g.sub.id))delete store.checked[g.sub.id];else store.checked[g.sub.id]=true}",
    "else{var on=!done(g.row.id);setd(g.row.id,on)}",
    "save(KEY,store);render();});",
    "$(\"#list\").addEventListener(\"change\",function(e){",
    "var cb=e.target.closest?e.target.closest(\".cbx\"):null;if(!cb)return;",
    "var li2=cb.closest(\"li[data-id]\");if(!li2)return;var id2=li2.getAttribute(\"data-id\");",
    "var h=findRow(id2);if(!h)return;",
    "if(h.sub){if(cb.checked)store.checked[id2]=true;else delete store.checked[id2]}",
    "else{setd(h.row.id,cb.checked)}",
    "save(KEY,store);render();});",
    "$(\"#list\").addEventListener(\"keydown\",function(e){",
    "if(!(e.target&&e.target.id===\"subInput\")||!addingTo)return;",
    "if(e.key===\"Escape\"){addingTo=null;render()}",
    "else if(e.key===\"Enter\"){var v=(e.target.value||\"\").replace(/^\\s+|\\s+$/g,\"\");if(!v)return;",
    "var sub={id:\"s-\"+Date.now().toString(36)+\"-\"+Math.floor(Math.random()*1e6),title:v,desc:\"\",createdAt:Date.now()};",
    "var box=store.subs[addingTo];if(!box){box=[];store.subs[addingTo]=box}box.push(sub);",
    "save(KEY,store);addingTo=null;render();toast(\"Subtask added\")}});",
    "var s=$(\"#search\");s.addEventListener(\"input\",function(){q=s.value.trim().toLowerCase();render()});",
    "var seg=$(\"#seg\");seg.addEventListener(\"click\",function(e){var b=e.target.closest?e.target.closest(\"button\"):null;if(!b||!b.getAttribute(\"data-f\"))return;filter=b.getAttribute(\"data-f\");",
    "Array.prototype.forEach.call(seg.querySelectorAll(\"button\"),function(x){if(x.classList)x.classList.toggle(\"on\",x===b)});render()});",
    "$(\"#sort\").addEventListener(\"change\",function(e){sort=e.target.value;render()});",
    "$(\"#checkAll\").addEventListener(\"click\",function(){all().forEach(function(r){setd(r.id,true);(r.subs||[]).forEach(function(s){setd(s.id,true)})});save(KEY,store);render();toast(\"All checked\")});",
    "$(\"#uncheckAll\").addEventListener(\"click\",function(){store.checked={};save(KEY,store);render();toast(\"All unchecked\")});",
    "$(\"#resetBtn\").addEventListener(\"click\",function(){if(!confirm(\"Reset progress saved in this browser for this checklist?\"))return;store={checked:{},added:[],cut:[],subs:{}};save(KEY,store);addingTo=null;render();toast(\"Progress reset\")});",
    "$(\"#copyBtn\").addEventListener(\"click\",function(){var rows=visible().length?visible():all();var t=rows2txt(rows);if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){toast(\"Copied to clipboard\")},function(){toast(\"Copy failed\")})}else{toast(\"Copy not available\")}});",
    "$(\"#txtBtn\").addEventListener(\"click\",function(){var rows=visible().length?visible():all();dl(data.slug+\"-\"+data.date+\".txt\",rows2txt(rows));toast(\"Exported .txt\")});",
    "$(\"#addBtn\").addEventListener(\"click\",function(){var inp=$(\"#newItem\");var v=(inp.value||\"\").replace(/^\\s+|\\s+$/g,\"\");if(!v){inp.focus();return}",
    "store.added.push({id:\"a-\"+Date.now().toString(36)+\"-\"+Math.floor(Math.random()*1e6),title:v,desc:\"\",createdAt:Date.now(),subs:[]});save(KEY,store);inp.value=\"\";filter=\"all\";q=\"\";s.value=\"\";",
    "Array.prototype.forEach.call(seg.querySelectorAll(\"button\"),function(x){if(x.classList)x.classList.toggle(\"on\",x.getAttribute(\"data-f\")===\"all\")});render();toast(\"Item added\")});",
    "function theme(t){document.documentElement.setAttribute(\"data-theme\",t);save(TKEY,t);$(\"#themeBtn\").innerHTML=t===\"dark\"?window.__icons.sun:window.__icons.moon}",
    "$(\"#themeBtn\").addEventListener(\"click\",function(){var cur=document.documentElement.getAttribute(\"data-theme\");theme(cur===\"dark\"?\"light\":\"dark\")});",
    "theme(load(TKEY,\"dark\"));",
    "render();",
    "})();"
  ].join("\n");

  function buildRich(raw) {
    const text = String(raw || "");
    if (!text) return "";
    const inline = (t) => escHTML(t).replace(/`([^`\n]+)`/g, "<code class=\"icode\">$1</code>").replace(/\n/g, "<br>");
    const HL = (typeof window !== "undefined" && window.ChecklistHighlight) ? window.ChecklistHighlight : null;
    const re = /```(\w*)\n?([\s\S]*?)(?:```|$)/g;
    let last = 0, m, has = false, html = "";
    while ((m = re.exec(text))) {
      has = true;
      html += inline(text.slice(last, m.index));
      const lang = (m[1] || "code").slice(0, 20);
      const code = String(m[2] || "").replace(/\n$/, "");
      const body = HL ? HL(code, lang) : escHTML(code);
      html += `<pre class="codeblock"><div class="codehead"><span class="lang">` + escHTML(lang) + `</span></div><code>` + body + `</code></pre>`;
      last = m.index + m[0].length;
    }
    html += inline(text.slice(last));
    return has ? html : inline(text);
  }

  function buildTags(v) {
    const src = Array.isArray(v) ? v : [];
    const seen = new Set();
    const out = [];
    src.forEach((t) => {
      const s = String(t || "").trim().replace(/^#+/, "").toLowerCase().slice(0, 30);
      if (s && !seen.has(s) && out.length < 12) { seen.add(s); out.push(s); }
    });
    return out;
  }

  function build(name, listId, items, opts) {
    const o = opts || {};
    const date = o.date || new Date().toISOString().split("T")[0];
    const payload = {
      listId: String(listId),
      name: String(name),
      description: String(o.description || ""),
      slug: slug(name),
      date: date,
      items: (items || []).map((r) => ({
        id: String(r.id),
        title: String(r.title),
        desc: String(r.description || r.desc || ""),
        tags: buildTags(r.tags),
        createdAt: r.createdAt || 0,
        subs: ((r.subs || r.shownSubs) || []).map((s) => ({ id: String(s.id), title: String(s.title), desc: String(s.description || s.desc || ""), tags: buildTags(s.tags), createdAt: s.createdAt || 0 })),
      })),
    };
    const json = JSON.stringify(payload).replace(/</g, "\\u003c");
    const title = escHTML(name);
    const closeTag = "</scr" + "ipt>";
    return (
      "<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>\n<meta charset=\"UTF-8\">\n" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
      "<meta name=\"color-scheme\" content=\"dark light\">\n" +
      "<title>" + title + " — Checklist</title>\n" +
      "<meta name=\"description\" content=\"Standalone checklist export — works offline, progress saved in this browser.\">\n" +
      "<style>\n" + CSS + "\n</style>\n</head>\n<body>\n" +
      "<div class=\"wrap\">\n" +
      "  <div class=\"head\">\n" +
      "    <h1>" + title + "<div class=\"meta\">Standalone export · " + escHTML(date) + " · " + payload.items.length + " items · progress auto-saves in this browser</div>"
      + (payload.description ? "<div class=\"ldesc\">" + buildRich(payload.description) + "</div>" : "")
      + "</h1>\n" +
      "    <button class=\"iconbtn\" id=\"themeBtn\" aria-label=\"Toggle theme\">" + ICONS.moon + "</button>\n" +
      "  </div>\n" +
      "  <div class=\"card pad\" style=\"margin-bottom:12px\">\n" +
      "    <div class=\"big\" id=\"ptext\">0 / 0 done</div>\n" +
      "    <div class=\"track\"><div id=\"bar\" style=\"width:0%\"></div></div>\n" +
      "  </div>\n" +
      "  <div class=\"card\" style=\"margin-bottom:12px\">\n" +
      "    <div class=\"toolbar\">\n" +
      "      <label class=\"search\">" + ICONS.search + "<input id=\"search\" type=\"search\" placeholder=\"Filter items...\" autocomplete=\"off\"></label>\n" +
      "      <div class=\"seg\" id=\"seg\"><button data-f=\"all\" class=\"on\">All</button><button data-f=\"active\">Pending</button><button data-f=\"completed\">Done</button></div>\n" +
      "      <select id=\"sort\" aria-label=\"Sort order\"><option value=\"newest\">Newest first</option><option value=\"oldest\">Oldest first</option><option value=\"az\">Name A–Z</option><option value=\"done\">Done first</option></select>\n" +
      "    </div>\n" +
      "    <div class=\"toolbar\" style=\"padding-top:0\">\n" +
      "      <button class=\"btn\" id=\"checkAll\">Check all</button>\n" +
      "      <button class=\"btn\" id=\"uncheckAll\">Uncheck all</button>\n" +
      "      <button class=\"btn\" id=\"copyBtn\">" + ICONS.copy + "Copy</button>\n" +
      "      <button class=\"btn\" id=\"txtBtn\">" + ICONS.download + ".txt</button>\n" +
      "      <button class=\"btn danger\" id=\"resetBtn\">Reset</button>\n" +
      "    </div>\n" +
      "    <div class=\"addrow\"><input class=\"txt\" id=\"newItem\" type=\"text\" placeholder=\"Add an item...\" maxlength=\"200\"><button class=\"btn\" id=\"addBtn\">" + ICONS.plus + "Add</button></div>\n" +
      "    <ul id=\"list\"></ul>\n" +
      "  </div>\n" +
      "  <div class=\"foot\"><span id=\"count\"></span><span>·</span><span>Standalone export — no account, no network. Open this file anywhere.</span></div>\n" +
      "</div>\n" +
      "<script id=\"cl-data\" type=\"application/json\">\n" + json + "\n" + closeTag + "\n" +
      "<script>\nwindow.__icons={sun:\"" + ICONS.sun.replace(/"/g, "'") + "\",moon:\"" + ICONS.moon.replace(/"/g, "'") + "\"};\n" + APP + "\n" + closeTag + "\n" +
      "</body>\n</html>\n"
    );
  }

  function filename(name, date) {
    return slug(name) + "-" + (date || new Date().toISOString().split("T")[0]) + ".html";
  }
  function download(fname, text) {
    const blob = new Blob([text], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  global.ChecklistExport = { build, slug, filename, download };
})(window);
