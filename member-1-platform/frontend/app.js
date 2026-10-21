const $ = id => document.getElementById(id);
const state = { access:'', profile:null, pct:'', pctUntil:0, session:null, user:'', busy:false, titles:[], featured:null, genre:'all', view:'home', titleMap:new Map(), subscribeKeys:new Map(), sessionKeys:new Map() };
const node = (tag,text='',className='') => { const element=document.createElement(tag); element.textContent=text; element.className=className; return element; };
const redact = (key,value) => /^(token|access_token|refresh_token|id_token|password)$/i.test(key) ? '[hidden]' : value;
function notice(text,error=false){ for(const element of [$('notice'),...document.querySelectorAll('[data-notice]')]) {element.textContent=text;element.classList.toggle('error',error);} }
async function guarded(action){
  if(state.busy) return;
  state.busy=true;
  const controls=[...document.querySelectorAll('button:not([data-close])')].map(button=>[button,button.disabled]);
  controls.forEach(([button])=>button.disabled=true);
  try { await action(); } catch(error){ notice(error.message,true); }
  finally { state.busy=false; controls.forEach(([button,disabled])=>{ if(button.isConnected) button.disabled=disabled; }); }
}
const button=(text,action)=>{ const element=node('button',text); element.type='button'; element.addEventListener('click',()=>guarded(action)); return element; };
function row(container,title,subtitle,actions=[]){
  const element=node('div','','row'),content=node('div'),group=node('div','','actions');
  content.append(node('strong',title),node('small',subtitle)); actions.forEach(action=>group.append(action)); element.append(content,group); container.append(element);
}
function empty(container,text='Nothing here yet.'){ container.replaceChildren(node('p',text,'empty')); }
function showResponse(method,path,response,data,milliseconds){
  $('response-label').textContent=method+' '+path; $('response-status').textContent=response.status+' · '+milliseconds+' ms';
  $('response').textContent=typeof data==='string'?data:JSON.stringify(data,redact,2);
}
async function request(path,{method='GET',body,headers={},binary=false}={}){
  const started=performance.now();
  const response=await fetch(path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path==='/auth/token'?60000:20000)});
  let data;
  if(binary&&response.ok) data=await response.blob();
  else { const text=await response.text(); try {data=text?JSON.parse(text):null;} catch {data=text;} }
  showResponse(method,path.replace(/^\/api/,''),response,data instanceof Blob?'['+data.size+' bytes · '+data.type+']':data,Math.round(performance.now()-started));
  if(!response.ok) throw new Error(response.status===502?'Services are unavailable. Open Account → Connection details to check connections.':'Request failed ('+response.status+'): '+(data?.title||data?.error_description||data?.detail||'Please try again.'));
  return data;
}
function openAccount(){ if(!$('account-dialog').open) $('account-dialog').showModal(); }
function identityLabel(){
  $('identity-state').textContent=state.access?state.user+' signed in · '+(state.profile?state.profile.name:'choose a profile'):'Choose an account to continue.';
  $('account-label').textContent=state.profile?.name||state.user||'Sign in';
  $('avatar').textContent=(state.profile?.name||state.user||'S').slice(0,1).toUpperCase();
  $('admin-tools').hidden=state.user!=='admin';
  $('open-player').hidden=!state.profile;
}
async function selectProfile(profile){
  const selected=await api('/profiles/'+encodeURIComponent(profile.id)+'/select',{method:'POST'});
  state.profile=profile; state.pct=selected.token; state.pctUntil=Date.now()+(selected.expiresIn-30)*1000; identityLabel();
}
async function api(path,{scope=false,publicApi=false,headers={},...options}={}){
  if(!publicApi&&!state.access){ openAccount(); throw new Error('Sign in to continue.'); }
  if(scope){
    if(!state.profile){ openAccount(); throw new Error('Choose a profile to see your collection.'); }
    if(Date.now()>=state.pctUntil) await selectProfile(state.profile);
    headers={'X-Profile-Token':state.pct,...headers};
  }
  if(state.access) headers={Authorization:'Bearer '+state.access,...headers};
  return request('/api'+path,{...options,headers});
}
function updateHero(){
  const title=state.featured;
  $('hero-title').textContent=title?title.name:'Your next story starts here.';
  $('hero-description').textContent=title?'Take a moment. Settle in. Your next chapter is ready when you are.':'Find something that stays with you. Explore your collection, save your favourites, and pick up where you left off.';
  $('hero-meta').replaceChildren(...(title?[(title.genres||[]).join(' · '),title.maturity+'+',title.maxQuality,formatDuration(title.durationSeconds)]:['Made for your profile','Watch at your own pace']).filter(Boolean).map(text=>node('span',text)));
  $('hero-play').textContent=title?'▶ Watch now':'▶ Start exploring'; $('hero-save').hidden=!title;
}
function resetIdentity(){
  $('video-player').pause(); $('video-player').removeAttribute('src'); $('video-player').load();
  state.access='';state.profile=null;state.pct='';state.user='';state.session=null;state.titles=[];state.featured=null;state.titleMap.clear();state.subscribeKeys.clear();state.sessionKeys.clear();
  for(const id of ['profiles','billing','catalog','watchlist','recommendations','history','continue-watching','sessions','session-state']) empty($(id),'Sign in and choose a profile to continue.');
  $('password').value='';$('response').textContent='Previous response cleared.';identityLabel();updateHero();
}
async function refreshCollection(){
  await catalog();
  try {await recommendations();} catch {empty($('recommendations'),'Recommendations are temporarily unavailable. Your collection is still available.');}
}
async function activateProfile(profile){
  if(state.session&&state.profile?.id!==profile.id) throw new Error('End your current viewing session before switching profiles.');
  await selectProfile(profile);
  state.titleMap.clear();state.titles=[];state.featured=null;
  for(const id of ['watchlist','history','continue-watching','sessions']) empty($(id),'Refresh to load this profile’s collection.');
  switchView('home');$('account-dialog').close();await refreshCollection();notice('Welcome, '+profile.name+'. Find something you love.');
}
async function profiles(){
  const result=await api('/profiles');empty($('profiles'),'Create your first profile below.');
  if(result.items.length) $('profiles').replaceChildren();
  if(state.profile&&!result.items.some(profile=>profile.id===state.profile.id)){state.profile=null;state.pct='';state.titles=[];state.featured=null;identityLabel();updateHero();empty($('catalog'),'Choose a profile to reload your collection.');}
  result.items.forEach(profile=>row($('profiles'),profile.name,'Age rating '+profile.maturity+'+',[button(state.profile?.id===profile.id?'Selected':'Watch as '+profile.name,()=>activateProfile(profile))]));
}
async function plans(){
  const result=await api('/plans',{publicApi:true});$('plans').replaceChildren();
  result.items.forEach(plan=>{
    const card=node('article','','plan');
    card.append(node('h3',plan.id[0].toUpperCase()+plan.id.slice(1)+' · '+new Intl.NumberFormat('en-IN',{style:'currency',currency:plan.currency}).format(plan.amount/100)),node('p',plan.maxStreams+' simultaneous stream'+(plan.maxStreams===1?'':'s')+' · '+plan.maxQuality+' · simulated payment'),button('Choose '+plan.id,async()=>{
      const key=state.subscribeKeys.get(plan.id)||crypto.randomUUID();state.subscribeKeys.set(plan.id,key);
      await api('/subscriptions',{method:'POST',body:{planId:plan.id},headers:{'Idempotency-Key':key}});await billing();notice('Your plan is being activated. Refresh membership in a moment.');
    }));$('plans').append(card);
  });
}
async function billing(){
  const subscriptions=await api('/subscriptions'),payments=await api('/payments'),invoices=await api('/invoices');
  empty($('billing'),'No membership yet. Choose a plan above.');if(subscriptions.items.length||payments.items.length||invoices.items.length) $('billing').replaceChildren();
  subscriptions.items.forEach(subscription=>row($('billing'),subscription.planId+' · '+subscription.status,'Membership', ['ACTIVE','PENDING'].includes(subscription.status)?[button('Cancel membership',async()=>{
    await api('/subscriptions/'+encodeURIComponent(subscription.id)+'/cancel',{method:'POST'});state.subscribeKeys.delete(subscription.planId);await billing();notice('Membership cancelled.');
  })]:[]));
  payments.items.forEach(payment=>row($('billing'),'Payment · '+payment.status,payment.currency+' '+(payment.amount/100).toFixed(2)+' · simulated'));
  invoices.items.forEach(invoice=>row($('billing'),'Invoice',invoice.currency+' '+(invoice.amount/100).toFixed(2)+' · sandbox document',[button('Download PDF',async()=>{
    const blob=await api('/invoices/'+encodeURIComponent(invoice.id)+'/pdf',{binary:true}),url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download='sandbox-invoice.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  })]));
}
function formatDuration(seconds){ return seconds>=60?Math.ceil(seconds/60)+' min':seconds+' sec'; }
async function titleDetails(id){
  if(state.titleMap.has(id)) return state.titleMap.get(id);
  const title=await api('/catalog/titles/'+encodeURIComponent(id),{scope:true});state.titleMap.set(id,title);return title;
}
async function saveTitle(title){
  await api('/watchlist/titles/'+encodeURIComponent(title.id),{method:'PUT',scope:true});notice('“'+title.name+'” added to My list.');
  if(state.view==='watchlist') await watchlist();
}
function titleCard(title,{remove=false,progress=null}={}){
  state.titleMap.set(title.id,title);
  const card=node('article','','card'),poster=node('div','','poster'),content=node('div','','card-body'),actions=node('div','','actions');
  poster.dataset.art=String([...title.id].reduce((total,char)=>total+char.charCodeAt(0),0)%5);poster.setAttribute('aria-hidden','true');poster.append(node('span',title.maxQuality||'HD','poster-badge'),node('span',title.name,'poster-title'));
  content.append(node('h3',title.name),node('p',(title.genres||[]).join(' · ')+' · '+formatDuration(title.durationSeconds)+' · '+title.maturity+'+'));
  if(progress){const track=node('div','','progress-track'),fill=node('span');fill.style.width=Math.max(0,Math.min(100,progress.positionSeconds/progress.durationSeconds*100))+'%';track.append(fill);content.append(track,node('p',progress.positionSeconds+' / '+progress.durationSeconds+' seconds watched'));}
  actions.append(button('▶ Watch',()=>startSession(title)),button(remove?'− Remove':'＋ My list',remove?async()=>{await api('/watchlist/titles/'+encodeURIComponent(title.id),{method:'DELETE',scope:true});await watchlist();notice('Removed from My list.');}:()=>saveTitle(title)));
  content.append(actions);card.append(poster,content);return card;
}
function renderCatalog(){
  const titles=state.titles.filter(title=>state.genre==='all'||(title.genres||[]).some(genre=>genre.toLowerCase()===state.genre));
  empty($('catalog'),state.titles.length?'No titles match this genre. Try All titles.':'No published titles match your profile yet. An admin can add a demo title from Account.');
  if(titles.length) $('catalog').replaceChildren(...titles.map(title=>titleCard(title)));
}
async function catalog(){
  const result=await api('/catalog/titles?q='+encodeURIComponent($('search').value)+'&limit=100',{scope:true});
  state.titles=result.items;state.featured=result.items[0]||null;updateHero();renderCatalog();
}
async function watchlist(){
  const result=await api('/watchlist',{scope:true});empty($('watchlist'),'Your list is waiting for its first story. Add a title from Discover.');
  if(result.items.length) $('watchlist').replaceChildren();
  for(const entry of result.items){
    try {$('watchlist').append(titleCard(await titleDetails(entry.titleId),{remove:true}));}
    catch {row($('watchlist'),'Title currently unavailable','This title may no longer match your profile.',[button('Remove',async()=>{await api('/watchlist/titles/'+encodeURIComponent(entry.titleId),{method:'DELETE',scope:true});await watchlist();})]);}
  }
}
async function recommendations(){
  const result=await api('/recommendations/home',{scope:true});empty($('recommendations'),'No recommendations yet. Explore the collection to find your next story.');
  if(result.items.length) $('recommendations').replaceChildren(...result.items.map(title=>titleCard(title)));
  if(result.degraded) $('recommendations').append(node('p','Showing available recommendations while personalised ranking is unavailable.','hint'));
}
async function viewingHistory(){
  const month=$('history-month').value,result=await api('/history'+(month?'?month='+month:''),{scope:true}),progress=await api('/history/continue',{scope:true});
  empty($('history'),'No viewing history for '+result.month+'. Your completed sessions appear here.');empty($('continue-watching'),'Start a story to pick it up here later.');
  if(result.items.length) $('history').replaceChildren();
  if(progress.items.length) $('continue-watching').replaceChildren();
  for(const entry of result.items){let title;try{title=await titleDetails(entry.titleId);}catch{} row($('history'),title?.name||'Unavailable title',entry.positionSeconds+' / '+entry.durationSeconds+' sec · '+new Date(entry.endedAt).toLocaleDateString(),title?[button('Watch again',()=>startSession(title))]:[]);}
  for(const entry of progress.items){try{$('continue-watching').append(titleCard(await titleDetails(entry.titleId),{progress:entry}));}catch{row($('continue-watching'),'Title currently unavailable',entry.positionSeconds+' seconds watched');}}
}
function renderSession(){
  empty($('session-state'),'No active viewing session.');if(!state.session) return;
  const session=state.session.session;$('session-state').replaceChildren();row($('session-state'),session.status,'Progress '+(session.positionSeconds||0)+' / '+session.durationSeconds+' seconds');
  $('position').max=session.durationSeconds;$('position').value=session.positionSeconds||0;
  const title=state.titleMap.get(session.titleId);$('player-title').textContent=title?.name||'Your viewing session';
  const video=$('video-player'),url=new URL(state.session.url);
  if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='8080'||!url.pathname.startsWith('/media/')) throw new Error('The service returned an unexpected media address.');
  const link=node('a','Open signed media manifest ↗');link.href=url.href;link.target='_blank';link.rel='noopener';$('session-state').append(link);
  if(video.canPlayType('application/vnd.apple.mpegurl')){
    if(video.getAttribute('src')!==url.href){video.src=url.href;video.load();}
    $('player-message').textContent='Play to watch. Your progress is saved while the video is playing.';
  }else{$('player-message').textContent='This browser does not support native HLS playback. Open the signed media link in an HLS-compatible player. You can save progress manually below; sessions expire after 90 seconds without an update.';}
}
async function startSession(title){
  if(state.session){if(state.session.session.titleId===title.id){$('player-dialog').showModal();return;} throw new Error('End your current viewing session before starting another title.');}
  const key=state.sessionKeys.get(title.id)||crypto.randomUUID();state.sessionKeys.set(title.id,key);
  state.session=await api('/sessions',{method:'POST',scope:true,body:{titleId:title.id},headers:{'Idempotency-Key':key}});
  renderSession();if(!$('player-dialog').open)$('player-dialog').showModal();notice('Ready to watch “'+title.name+'”.');
}
function requireSession(){if(!state.session)throw new Error('Choose a title to start watching first.');return encodeURIComponent(state.session.session.sessionId);}
async function checkpoint(){
  const id=requireSession(),position=Math.max(0,Math.min(state.session.session.durationSeconds,Math.floor(Number($('position').value))));
  state.session.session=await api('/sessions/'+id+'/heartbeat',{method:'POST',scope:true,body:{sequence:(state.session.session.sequence||0)+1,positionSeconds:position}});
  renderSession();notice('Viewing progress saved.');
}
async function stopSession(){
  const id=requireSession();$('video-player').pause();await api('/sessions/'+id+'/stop',{method:'POST',scope:true});
  state.sessionKeys.delete(state.session.session.titleId);state.session=null;$('video-player').removeAttribute('src');$('video-player').load();renderSession();$('player-dialog').close();notice('Session ended. Refresh History in a moment to see your progress.');
}
function switchView(view){
  state.view=view;
  for(const name of ['home','watchlist','history']) $(name+'-view').hidden=name!==view;
  document.querySelectorAll('[data-view]').forEach(button=>{button.classList.toggle('active',button.dataset.view===view);if(button.dataset.view===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  $('view-heading').textContent={home:'Find your next favourite',watchlist:'Your list. Your next chapter.',history:'Every story leaves a trace.'}[view];$('search-form').hidden=view!=='home';
}
function on(id,action){$(id).addEventListener('click',()=>guarded(action));}
function form(id,action){$(id).addEventListener('submit',event=>{event.preventDefault();guarded(action);});}
$('account-button').addEventListener('click',openAccount);
$('open-player').addEventListener('click',()=>{if(!$('player-dialog').open)$('player-dialog').showModal();});
$('welcome-signin').addEventListener('click',openAccount);
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
$('player-dialog').addEventListener('close',()=>$('video-player').pause());
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>guarded(async()=>{switchView(button.dataset.view);if(state.view==='watchlist')await watchlist();if(state.view==='history')await viewingHistory();})));
document.querySelectorAll('[data-genre]').forEach(button=>button.addEventListener('click',()=>{state.genre=button.dataset.genre;document.querySelectorAll('[data-genre]').forEach(filter=>{filter.classList.toggle('active',filter===button);filter.setAttribute('aria-pressed',String(filter===button));});renderCatalog();}));
on('hero-play',async()=>{if(state.featured)await startSession(state.featured);else if(!state.profile)openAccount();else{switchView('home');await refreshCollection();$('catalog').scrollIntoView({behavior:'smooth',block:'center'});}});
on('hero-save',async()=>{if(state.featured)await saveTitle(state.featured);});
form('login-form',async()=>{
  if(state.session) throw new Error('End your viewing session before switching accounts.');
  const username=$('username').value,password=$('password').value;resetIdentity();
  const result=await request('/auth/token',{method:'POST',body:{username,password}});state.access=result.access_token;state.user=username;identityLabel();await profiles();notice('Welcome back. Choose a profile to continue.');
});
on('logout',()=>{if(state.session)throw new Error('End your session before signing out.');resetIdentity();notice('You’re signed out.');});
on('load-profiles',profiles);
form('profile-form',async()=>{if(state.session)throw new Error('End your session before changing profiles.');const profile=await api('/profiles',{method:'POST',body:{name:$('profile-name').value,maturity:Number($('maturity').value)}});await profiles();await activateProfile(profile);});
on('load-plans',plans);on('load-billing',billing);form('search-form',async()=>{switchView('home');await catalog();});on('reload-catalog',refreshCollection);on('load-watchlist',watchlist);on('load-reco',recommendations);form('history-form',viewingHistory);
on('seed-title',async()=>{
  if(state.user!=='admin')throw new Error('Sign in as admin to manage the collection.');
  const title=await api('/admin/catalog/titles',{method:'POST',body:{name:'Local demo '+new Date().toISOString().slice(11,19),genres:['drama'],maturity:12,regions:['IN'],licenseStart:'2020-01-01T00:00:00Z',licenseEnd:'2099-01-01T00:00:00Z',assetPath:'demo/master.m3u8',durationSeconds:10,maxQuality:'HD'}});
  await api('/admin/catalog/titles/'+title.id+'/publish',{method:'POST',headers:{'If-Match':'"'+title.version+'"'}});notice('Demo title published. Refresh Discover in a few seconds. Media files must be generated separately.');
});
form('heartbeat-form',checkpoint);
on('refresh-session',async()=>{state.session=await api('/sessions/'+requireSession()+'/refresh',{method:'POST',scope:true});renderSession();notice('Playback refreshed.');});
on('stop-session',stopSession);
on('load-sessions',async()=>{
  const result=await api('/sessions',{scope:true});empty($('sessions'),'No active sessions.');if(result.items.length)$('sessions').replaceChildren();
  result.items.forEach(session=>row($('sessions'),session.status,'Viewing session',[button('Resume',async()=>{if(state.session&&state.session.session.sessionId!==session.sessionId)throw new Error('End your current session before resuming another.');state.session=await api('/sessions/'+encodeURIComponent(session.sessionId)+'/refresh',{method:'POST',scope:true});renderSession();})]));
});
on('check-status',async()=>{
  const result=await request('/status');$('service-grid').replaceChildren();
  for(const service of result.checks){const card=node('div','','service '+(service.ready?'ready':'failed'));card.append(node('strong',service.name),node('span',service.ready?'Connected':'Unavailable'));$('service-grid').append(card);}
  $('status-note').textContent=result.checks.filter(service=>service.ready).length+'/11 service probes ready. '+result.note;
});
$('video-player').addEventListener('timeupdate',()=>{if(state.session)$('position').value=Math.min(state.session.session.durationSeconds,Math.floor($('video-player').currentTime));});
$('video-player').addEventListener('error',()=>{$('player-message').textContent='The media could not load. Check that the demo media files exist, then refresh playback. You can still save progress manually.';});
setInterval(()=>{const video=$('video-player');if(state.session&&!video.paused&&!video.ended&&!state.busy)guarded(checkpoint);},25000);
$('video-player').addEventListener('ended',()=>guarded(async()=>{await checkpoint();await stopSession();}));
window.addEventListener('beforeunload',event=>{if(state.session){event.preventDefault();event.returnValue='';}});
updateHero();
