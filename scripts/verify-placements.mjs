import { parseHTML } from '../node_modules/.pnpm/linkedom@0.18.13/node_modules/linkedom/esm/index.js';

const HOST_CSS={
  "thinking_indicator":"\n:host([data-placement=\"thinking_indicator\"]){\n  display:block;\n  position:relative;\n  width:100%;\n  max-width:100%;\n  margin:6px 0;\n  pointer-events:auto;\n  z-index:10;\n}",
  "above_composer":"\n:host([data-placement=\"above_composer\"]){\n  position:absolute;\n  bottom:100%;\n  left:0;\n  right:0;\n  height:0;\n  overflow:visible;\n  pointer-events:none;\n  z-index:40;\n  margin-bottom:8px;\n}",
};

const adapters=[
  { name:"openai", hostname:"chatgpt.com", pathname:"/",
    html:'<!DOCTYPE html><html><head></head><body><article data-turn-key="t1" class="group/user-message"><div data-user-message-bubble="true">user prompt</div></article><form data-chatgpt-composer><textarea id="prompt-textarea"></textarea></form></body></html>',
    userSelector:"[data-turn-key], .group/user-message", composerSelector:"form[data-chatgpt-composer], textarea#prompt-textarea" },
  { name:"gemini", hostname:"gemini.google.com", pathname:"/",
    html:'<!DOCTYPE html><html><head></head><body><div class="user-query-container"><div class="user-query" id="u1">user prompt</div></div><div class="input-area-container"><div class="input-area"><textarea></textarea></div></div></body></html>',
    userSelector:"user-query, .user-query, .user-query-container, div[class*='user_query'], div[class*='query_container']", composerSelector:".input-area-container, .input-area, form" },
  { name:"claude", hostname:"claude.ai", pathname:"/",
    html:'<!DOCTYPE html><html><head></head><body><div data-cds="UserMessage" class="user-row"><div data-testid="user-message">user prompt</div></div><form data-testid="composer"><div class="ProseMirror" contenteditable="true"></div></form></body></html>',
    userSelector:"[data-cds='UserMessage'], [data-testid='user-message']", composerSelector:"form, [data-testid='composer'], .composer" },
  { name:"deepseek", hostname:"chat.deepseek.com", pathname:"/",
    html:'<!DOCTYPE html><html><head></head><body><div class="message_row" data-testid="message_row_1"><div class="ds-message human">user prompt</div></div><form class="input-container"><textarea id="chat-input"></textarea></form></body></html>',
    userSelector:"[data-testid*='message_row'], [class*='message_row'], [class*='chat_message'], article, li", composerSelector:"form, [class*='input_container'], textarea#chat-input" },
  { name:"grok", hostname:"x.com", pathname:"/i/grok",
    html:'<!DOCTYPE html><html><head></head><body><div class="message_row" data-testid="message_row"><div class="message-bubble human">user prompt</div></div><form class="query-bar"><div contenteditable="true" class="notranslate"></div></form></body></html>',
    userSelector:"[data-testid='message_row'], [class*='message_row'], [class*='conversation_turn'], [class*='chat_message'], article, li", composerSelector:"form, [data-testid*='composer'], [class*='query_bar']" },
];

function resolveFor(hostname,pathname){
  if(hostname==="chatgpt.com"||hostname==="chat.openai.com") return "openai";
  if(hostname==="gemini.google.com") return "gemini";
  if(hostname==="claude.ai") return "claude";
  if(hostname==="grok.com"||hostname.endsWith(".grok.com")) return "grok";
  if(hostname==="x.com"||hostname.endsWith(".x.com")) return pathname.startsWith("/i/grok")?"grok":null;
  if(hostname==="chat.deepseek.com"||hostname==="deepseek.com") return "deepseek";
  return null;
}

function buildHost(doc, placement){
  const host=doc.createElement("div");
  host.dataset.meantime="ad";
  host.dataset.placement=placement;
  const shadow=host.attachShadow({mode:"closed"});
  const style=doc.createElement("style");
  style.textContent=HOST_CSS[placement];
  shadow.appendChild(style);
  const wrap=doc.createElement("div");
  wrap.className="mt-wrap";
  wrap.style.color="red";
  shadow.appendChild(wrap);
  doc.body.appendChild(host);
  return host;
}

function debug(item){ if(item){ return item.tagName||item.toString?.(); } else { return "none"; } }

function assert(condition, msg){ if(!condition) throw new Error("FAILED: "+msg); }

function runCase(ad){
  const w=parseHTML(ad.html);
  const doc=w.document;
  const resolved=resolveFor(ad.hostname, ad.pathname);
  assert(!!doc.body, ad.name+" doc.body null");
  assert(typeof doc.body.appendChild==='function', ad.name+" doc.body.appendChild not a function");
  const userEl=doc.querySelector(ad.userSelector);
  const composerEl=doc.querySelector(ad.composerSelector);
  console.log(ad.name+" resolved:", resolved, "user:", !!userEl, debug(userEl), "composer:", !!composerEl, debug(composerEl));
  assert(resolved===ad.name, ad.name+" adapter resolution");
  assert(!!userEl, ad.name+" thinking_slot anchor missing (selector "+ad.userSelector+")");
  assert(!!composerEl, ad.name+" above_composer anchor missing (selector "+ad.composerSelector+")");
  assert(!!userEl.parentNode, ad.name+" userEl.parentNode null");
  const beforeParent=userEl.parentNode;
  console.log(ad.name+" userEl.parentNode.tagName:", debug(beforeParent));
  const thinkHost=buildHost(doc, "thinking_indicator");
  console.log(ad.name+" after buildHost thinkHost.parentNode:", debug(thinkHost.parentNode), " doc.body===thinkHost.parentNode:", doc.body===thinkHost.parentNode);
  userEl.after(thinkHost);
  const prev=thinkHost.previousElementSibling;
  console.log(ad.name+" prev.tagName:", prev?prev.tagName:'null', " === userEl.tagName:", userEl.tagName, " prev===userEl:", prev===userEl);
  console.log(ad.name+" prev.idx:", doc.body.children.indexOf(prev), "prev.tagName:", prev?prev.tagName:'null');
  console.log(ad.name+" prev === userEl?", prev===userEl, "prev.tagName === userEl.tagName?", prev?prev.tagName===userEl.tagName:false);
  assert(prev===userEl, ad.name+" thinking_host not immediately after user anchor");
  assert(prev.tagName===userEl.tagName, ad.name+" prev.tagName !== userEl.tagName:", prev?prev.tagName:'null', userEl.tagName);
  assert(thinkHost.parentNode===beforeParent, ad.name+" thinking_host parent is not user anchor parent");
  const idxOfThink=doc.body.children.indexOf(thinkHost);
  const idxOfUser=doc.body.children.indexOf(userEl);
  console.log(ad.name+" idxOfThink:", idxOfThink, "idxOfUser:", idxOfUser);
  console.log(ad.name+" idxOfThink>idxOfUser?", idxOfThink>idxOfUser);
  if(!(idxOfThink>idxOfUser)) throw new Error("ORDER FAIL idxOfThink="+idxOfThink+" idxOfUser="+idxOfUser);
  const attr=thinkHost.getAttribute("data-placement");
  if(attr!=='thinking_indicator') throw new Error("ATTR FAIL attr="+attr);
  const aboveHost=buildHost(doc, "above_composer");
  console.log(ad.name+" before append above.parentNode:", debug(aboveHost.parentNode));
  console.log(ad.name+" BEFORE APPEND composerEl children:", Array.from(composerEl.children||[]).map(debug).join(' '), "composerEl.contains(aboveHost)=", composerEl.contains(aboveHost));
  composerEl.append(aboveHost);
  console.log(ad.name+" AFTER APPEND composerEl children:", Array.from(composerEl.children||[]).map(debug).join(' '), "composerEl.contains(aboveHost)=", composerEl.contains(aboveHost));
  const composerContains=(Array.from(composerEl.children||[]).indexOf(aboveHost)!==-1);
  console.log(ad.name+" composerContains:", composerContains, "arrayIndexOf=", Array.from(composerEl.children||[]).indexOf(aboveHost));
  if(!composerContains) throw new Error("CONTAINS FAIL4 composerContains="+composerContains+" arrayIndexOf="+Array.from(composerEl.children||[]).indexOf(aboveHost));
  const placementAttr=aboveHost.getAttribute("data-placement");
  console.log(ad.name+" placementAttr:", placementAttr, "typeof:", typeof placementAttr);
  if(placementAttr!=='above_composer') throw new Error("PLACEMENT FAIL placementAttr="+placementAttr);
  thinkHost.remove();
  aboveHost.remove();
  console.log(ad.name+" runCase returning ok at end");
}

for(const ad of adapters){ assert(runCase(ad), ad.name+" case failed"); }
console.log("PASS_PLATFORM_PLACEMENT:", adapters.map(a=>a.name).join(", "));
console.log("ALL_PLATFORM_PLACEMENTS_OK");
