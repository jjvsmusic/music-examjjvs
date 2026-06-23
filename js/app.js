(function(){
'use strict';

function __init__(){
// ════════════════════════════════════════════════
// DATA
// ════════════════════════════════════════════════
// ════════════════════════════════════════════════
// ★ 安全 helper（XSS 防護 + 權限驗證）
// ════════════════════════════════════════════════
// ★ C2：DEBUG 模式判斷（localhost 或加上 ?debug=1 才開啟 console.log）
const DEBUG = (location.hostname==='localhost'||location.hostname==='127.0.0.1'||location.search.includes('debug=1'));
if(!DEBUG){
  // 生產環境：保留 warn/error，靜音 log（避免敏感資料外洩）
  const _origLog=console.log;
  console.log=()=>{};
  window._enableLog=()=>{console.log=_origLog;console.log('[DEBUG] log 已啟用');};
}
window.DEBUG=DEBUG;

// ★ 大螢幕展示模式：?display=1&room=xxx — 此視窗只顯示大電視畫面，跳過登入
// 資料完全由監考分頁透過 BroadcastChannel 送來（或跨裝置時由 Firebase liveScreen 輪詢）
if(new URLSearchParams(location.search).get('display')==='1'){
  const _bootDisplay=()=>{
    const ls=document.getElementById('login-screen'); if(ls)ls.classList.add('gone');
    if(typeof window._initDisplayMode==='function')window._initDisplayMode();
  };
  // 延遲到 init 結束、所有函式都掛上 window 後再啟動
  setTimeout(_bootDisplay,0);
}

// XSS 防護：所有使用者輸入插入 innerHTML 前都應該 escape
function escHtml(s){
  if(s==null)return '';
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
window.escHtml=escHtml;

// ★ 過濾 null/非物件評審記錄的 helper（防 Firebase delete 殘留導致 .absent 等存取錯誤）
function _safeJurors(jurorData){
  if(!jurorData)return [];
  return Object.values(jurorData).filter(s=>s&&typeof s==='object');
}
window._safeJurors=_safeJurors;

// ════════════════════════════════════════════════
// ★ 快取系統：學生/教師讀取靜態資料時使用 localStorage
//   降低 Firebase 讀取量（公告制：管理員按「公告」時才更新版本號）
// ════════════════════════════════════════════════
// 快取資料集定義
const CACHE_DATASETS = {
  scores:    {label:'成績總表', key:'_cache_scores'},
  comments:  {label:'評語',     key:'_cache_comments'},
  schedule:  {label:'考試順序', key:'_cache_schedule'},
  examRules: {label:'考試規則', key:'_cache_examRules'},
};
const CACHE_VERSION_KEY = '_cache_versions';

function getLocalCacheVersions(){
  try{const raw=localStorage.getItem(CACHE_VERSION_KEY);return raw?JSON.parse(raw):{};}catch(e){return {};}
}
function setLocalCacheVersions(versions){
  try{localStorage.setItem(CACHE_VERSION_KEY,JSON.stringify(versions));}catch(e){}
}
async function fetchSnapshotVersions(){
  if(!window._FB)return {};
  try{
    if(window._FB._rest){
      const v=await window._FB._get('config/snapshotVersions').catch(()=>null);
      return v||{};
    } else {
      const doc=await window._FB.db.collection('config').doc('snapshotVersions').get();
      return doc.exists?doc.data():{};
    }
  }catch(e){console.warn('[cache] 讀取版本號失敗',e);return {};}
}
async function publishSnapshot(dataset){
  if(!requireRole('admin'))return false;
  if(!CACHE_DATASETS[dataset]){console.warn('[publishSnapshot] 未知 dataset:',dataset);return false;}
  const versions=await fetchSnapshotVersions();
  versions[dataset]=new Date().toISOString();
  versions._lastPublishedBy=ST.user?.name||'admin';
  versions._lastPublishedAt=Date.now();
  if(window._FB){
    try{
      if(window._FB._rest){
        await window._FB._set('config/snapshotVersions',versions);
      } else {
        await window._FB.db.collection('config').doc('snapshotVersions').set(versions);
      }
      const local=getLocalCacheVersions();
      local[dataset]=versions[dataset];
      setLocalCacheVersions(local);
      return true;
    }catch(e){console.warn('[publishSnapshot] 寫入失敗',e);return false;}
  }
  return false;
}
function getCachedDataset(dataset){
  if(!CACHE_DATASETS[dataset])return null;
  try{const raw=localStorage.getItem(CACHE_DATASETS[dataset].key);return raw?JSON.parse(raw):null;}catch(e){return null;}
}
function setCachedDataset(dataset,data){
  if(!CACHE_DATASETS[dataset])return;
  try{localStorage.setItem(CACHE_DATASETS[dataset].key,JSON.stringify(data));}catch(e){
    console.warn('[cache] 寫入失敗（容量？），清空所有快取',e);
    Object.values(CACHE_DATASETS).forEach(d=>{try{localStorage.removeItem(d.key);}catch(e){}});
    try{localStorage.setItem(CACHE_DATASETS[dataset].key,JSON.stringify(data));}catch(e){}
  }
}
function shouldFetchFresh(dataset,remoteVersions){
  const local=getLocalCacheVersions();
  return (local[dataset]||'')!==(remoteVersions[dataset]||'');
}
window.publishSnapshot=publishSnapshot;
window.getLocalCacheVersions=getLocalCacheVersions;
window.fetchSnapshotVersions=fetchSnapshotVersions;
window.shouldFetchFresh=shouldFetchFresh;
window.getCachedDataset=getCachedDataset;
window.setCachedDataset=setCachedDataset;
window.setLocalCacheVersions=setLocalCacheVersions;



// 權限驗證：寫入操作前呼叫，非法時阻擋並提示
function requireRole(...allowedRoles){
  if(!allowedRoles.includes(ST.role)){
    if(typeof showToast==='function')showToast('權限不足，無法執行此操作','err');
    console.warn('[權限攔截] role='+ST.role+' 嘗試執行需要 '+allowedRoles.join('/')+' 權限的操作');
    return false;
  }
  return true;
}
window.requireRole=requireRole;

const DB = {
  classes: ['甲班','乙班','丙班'],
  instruments: {
    categories: [
      {id:'ww',name:'木管樂器',order:0},{id:'br',name:'銅管樂器',order:1},
      {id:'kb',name:'鍵盤樂器',order:2},{id:'st',name:'弦樂器',order:3},{id:'pc',name:'打擊樂器',order:4},
    ],
    items: [
      {id:'flute',cat:'ww',name:'長笛',order:0},{id:'oboe',cat:'ww',name:'雙簧管',order:1},
      {id:'clarinet',cat:'ww',name:'單簧管',order:2},{id:'bassoon',cat:'ww',name:'低音管',order:3},
      {id:'sax',cat:'ww',name:'薩克斯風',order:4},{id:'trumpet',cat:'br',name:'小號',order:0},
      {id:'trombone',cat:'br',name:'長號',order:1},{id:'horn',cat:'br',name:'法國號',order:2},
      {id:'tuba',cat:'br',name:'大號',order:3},{id:'piano',cat:'kb',name:'鋼琴',order:0},
      {id:'organ',cat:'kb',name:'管風琴',order:1},{id:'violin',cat:'st',name:'小提琴',order:0},
      {id:'viola',cat:'st',name:'中提琴',order:1},{id:'cello',cat:'st',name:'大提琴',order:2},
      {id:'bass',cat:'st',name:'低音提琴',order:3},{id:'marimba',cat:'pc',name:'木琴',order:0},
      {id:'timpani',cat:'pc',name:'定音鼓',order:1},
    ]
  },
  rooms: [
    {id:'r1',name:'木管考場',code:'WW2024',cats:['ww'],allowedCats:['ww'],allowedItems:[],location:''},
    {id:'r2',name:'銅管考場',code:'BR2024',cats:['br']},
    {id:'r3',name:'鍵盤弦樂考場',code:'KB2024',cats:['kb','st','pc']},
  ],
  users: [
    {id:'a001',name:'王國霖',account:'admin',pass:'000',role:'admin'},
    {id:'t001',name:'李老師',account:'teacher01',pass:'000',role:'teacher'},
    {id:'t002',name:'張老師',account:'teacher02',pass:'000',role:'teacher'},
    {id:'s001',name:'陳雅婷',account:'s001',pass:'000',role:'student',class:'甲班',seat:1,
      major:'flute',minor:'piano',elective:null,
      major_ac:'Mozart, W.A.',major_at:'Concerto in D major, K.314, 1st mvt.',
      major_fc:'Ibert, J.',major_ft:'Pièce pour flûte seule',
      minor_ac:'Chopin, F.',minor_at:'Nocturne Op.9 No.2',
      minor_fc:'Debussy, C.',minor_ft:'Clair de lune',
      repDone:true,teaDone:true},
    {id:'s002',name:'林宗翰',account:'s002',pass:'000',role:'student',class:'甲班',seat:2,
      major:'clarinet',minor:null,elective:'violin',
      major_ac:'Weber, C.M.',major_at:'Concerto No.1 Op.73',
      major_fc:'Brahms, J.',major_ft:'Sonata Op.120 No.1, 1st mvt.',
      elec_ac:'Bach, J.S.',elec_at:'Partita No.2 BWV 1004',
      elec_fc:'Bartók, B.',elec_ft:'Romanian Folk Dances',
      repDone:true,teaDone:true},
    {id:'s003',name:'黃詩涵',account:'s003',pass:'000',role:'student',class:'甲班',seat:3,
      major:'violin',minor:'piano',elective:null,
      major_ac:'Mendelssohn, F.',major_at:'Violin Concerto Op.64, 1st mvt.',
      major_fc:'Bach, J.S.',major_ft:'Partita No.3 BWV 1006',
      minor_ac:'Beethoven, L.',minor_at:'Sonata Op.27 No.2, 1st mvt.',
      minor_fc:'Schubert, F.',minor_ft:'Impromptu Op.90 No.3',
      repDone:false,teaDone:false},
    {id:'s004',name:'王建志',account:'s004',pass:'000',role:'student',class:'乙班',seat:1,
      major:'trumpet',minor:null,elective:null,
      major_ac:'Haydn, F.J.',major_at:'Trumpet Concerto in E♭, 3rd mvt.',
      major_fc:'Arutunian, A.',major_ft:'Trumpet Concerto in A♭',
      repDone:true,teaDone:true},
    {id:'s005',name:'李佳穎',account:'s005',pass:'000',role:'student',class:'乙班',seat:2,
      major:'piano',minor:'flute',elective:'clarinet',
      major_ac:'Beethoven, L.',major_at:'Sonata Op.2 No.1, 1st mvt.',
      major_fc:'Rachmaninoff, S.',major_ft:'Prelude Op.23 No.5',
      minor_ac:'Mozart, W.A.',minor_at:'Andante in C major K.315',
      minor_fc:'Doppler, F.',minor_ft:'Fantaisie pastorale hongroise',
      elec_ac:'Weber, C.M.',elec_at:'Concertino Op.26',
      elec_fc:'Saint-Saëns, C.',elec_ft:'Sonata Op.167, 1st mvt.',
      repDone:true,teaDone:false},
    {id:'s006',name:'張明哲',account:'s006',pass:'000',role:'student',class:'丙班',seat:1,
      major:'cello',minor:'piano',elective:null,
      major_ac:'Dvorak, A.',major_at:'Cello Concerto Op.104, 1st mvt.',
      major_fc:'Bach, J.S.',major_ft:'Suite No.1 BWV 1007',
      minor_ac:'Ravel, M.',minor_at:"Jeux d'eau",
      minor_fc:'Liszt, F.',minor_ft:'Liebestraum No.3',
      repDone:true,teaDone:true},
  ],
  juryScores: {}, // {roomId: {entryKey: {jurorId: {scale,assigned,free,comment,absent}}}}
  teacherComments: {}, // {studentId: {major/minor/elective: {score,comment}}}
  teacherStudents: {'t001':['s001','s002','s003'],'t002':['s004','s005','s006']}, // {teacherId: [studentId]}
  deductions: {}, // {entryKey: {amount, reason}}
  disqualified: {}, // {entryKey: {reason, note}} - 扣考名單
  blackSign: {}, // {roomId: {entryKey: true}} - 黑簽全曲
  liveExam: {}, // {roomId: {playing: entryKey, scaleKey: string}} - 現場演奏同步
  drawnScales: {}, // {roomId: {entryKey: '調性'}} - 考生預備席預抽的音階調性（暫存，上台才顯示於大螢幕）
  savedScheduleSnapshot: {}, // {roomId: [{entryKey,studentId,name,class,seat,instId,instName,type,order,...}]}
  jurySignup: {}, // {teacherId: {roomId, status, subName, subPhone, note, submittedAt}} - 評分報名
  pendingApprovals: {}, // ★ 90分以上分數審核：{id: {kind:'teacher'|'jury', score, reason, status:'pending'|'approved'|'rejected', submittedBy, submittedByName, submittedAt, reviewedAt, reviewedBy, ...其他依kind不同的欄位}}
  config: {
    repHint:'💡 示範寫法：作曲家 → Mozart, W.A. ／ 曲目 → Concerto in D major, K. 314, 1st mvt.',
    tyTitle:'感謝您的評分',
    tyText:'感謝老師本學期的辛苦指導與細心評分，您的專業意見將是學生最珍貴的回饋。',
    weights:{scale:0.2,assigned:0.4,free:0.4},
    scoreCaps:{1:85,2:87,3:89}, // ★ 各年級評分上限：超過需評審說明並經管理員審核
    // ★ 大螢幕：音階調性規則庫，按「年級_修別」存：{ '1_major':['C 大調','G 大調',...], ... }
    scaleRules:{},
    // ★ 大螢幕：每考場套用的調性規則模式（'auto'＝依考生年級×修別自動取池；或指定 key）
    roomScaleMode:{}, // {roomId:'auto'|'1_major'|...}
    hardCap:95, // ★ 全域硬上限：所有分數不得超過此值（輸入時直接擋下）
    trimRules:[
      {id:1,minJ:0,maxJ:3,trimH:0,trimT:0},
      {id:2,minJ:4,maxJ:5,trimH:0,trimT:1},
      {id:3,minJ:6,maxJ:99,trimH:1,trimT:1},
    ],
    pages:{
      rep:{open:'2024-01-01T08:00',close:'2024-12-31T23:59',visible:true,announce:''},
      scores:{open:'2024-01-01T08:00',close:'2024-12-31T23:59',visible:true,announce:''},
      jury:{open:'2024-01-01T08:00',close:'2024-12-31T23:59',visible:true,announce:''},
      teacher:{open:'2024-01-01T08:00',close:'2024-12-31T23:59',visible:true,announce:''},
      schedule:{open:'2024-01-01T08:00',close:'2024-12-31T23:59',visible:true,announce:''},
    },
    // access control per role: {pageId: true/false}
    studentAccess:{rep:true,scores:true,'stu-schedule':true,'exam-rules':true,'live-results':false},
    teacherAccess:{teacher:true,'tea-schedule':false,'jury-signup':true,'exam-rules':true,'live-results':false,'tea-jury-comments':false},
    teacherScheduleClosedMsg:'考試排程尚未開放查看，請等候管理員公告。',
    instRestrict:{major:[],minor:[],elective:[]},
    repConfirmMsg:'',
    pendingMsg:{},
    jurySignupNote:'有兩位（含）以上學生的老師需參與期末考現場評分。若考試當天有事無法出席，請務必自行安排代評老師，並填寫代評資訊。',
    bulletin:{student:'',teacher:''},  // 公布欄
    examRules:{classical:'',pop:'',assigned:''},  // ★ 考試規則 & 指定曲 HTML 內容
    assignedPieces:'',                              // 指定曲頁富文本（管理員自由說明）
    assignedPiecesRules:[],                         // ★ 指定曲自動帶入規則 [{id,catIds,instIds,types,classes,pieces:[{composer,title}]}]
    jurySignupOptions:[
      {id:'opt_attend',label:'確認參加',isAttend:true,isSub:false,hasText:false},
      {id:'opt_sub',label:'已找代評老師',isAttend:false,isSub:true,hasText:false},
      {id:'opt_one',label:'學生僅一人，免評',isAttend:false,isSub:false,hasText:false},
    ],
  }
};

window.DB = DB; // expose to Firebase callbacks
DB.repInstChanges = {}; // ★ 需求1：樂器異動通知（管理員用）
DB.jurySignup = DB.jurySignup || {};
DB.juryScores = DB.juryScores || {};
DB.deductions = DB.deductions || {};
DB.teacherComments = DB.teacherComments || {};
DB.blackSign = DB.blackSign || {};
DB.liveExam = DB.liveExam || {};
DB.drawnScales = DB.drawnScales || {};
DB.pendingApprovals = DB.pendingApprovals || {};
DB.teacherTypeOverrides = DB.teacherTypeOverrides || {}; // ★ 師生修別人工指定：key = studentId_type，值 = {teacherName} 或 {none:true}
const ST = {user:null,role:null,juryRoom:null,juryName:'',juryId:'',
  npTarget:null,npVal:'',npCallback:null,isOnline:navigator.onLine,
  invigRoom:null,invigName:'',_remarkFilterOn:false};
window.ST = ST; // ★ 修正：暴露 ST 給其他 IIFE（如 Firebase 輪詢）使用

// ★ #8 管理員重整不登出：從 sessionStorage 恢復登入狀態
(function restoreAdminSession(){
  try{
    const saved=sessionStorage.getItem('_adminSession');
    if(!saved)return;
    const sess=JSON.parse(saved);
    if(!sess||sess.role!=='admin')return;
    window._pendingAdminRestore=sess;
  }catch(e){}
})();

// ★ 移除 demo seed（避免污染真實資料）；若需測試請以管理員身分手動評分

// ════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════
const iname = id => DB.instruments.items.find(i=>i.id===id)?.name||'—';

// ★ #5 取得考場的評分欄位設定（預設三欄：音階/指定/自選）
function getRoomFields(roomId){
  const room=DB.rooms.find(r=>r.id===roomId);
  if(room&&room.scoreFields&&room.scoreFields.length){
    const total=room.scoreFields.reduce((s,f)=>s+(f.pct||0),0);
    return room.scoreFields.map(f=>({
      ...f,
      pct:total?Math.round((f.pct||0)/total*100):Math.round(100/room.scoreFields.length),
      // skipRules: [{catId,type,cls}] — 符合任一rule（AND內部條件）即 skip
      skipRules:f.skipRules||[],
    }));
  }
  return [
    {id:'scale',label:'音階/視奏',pct:Math.round((DB.config.weights?.scale||0.2)*100),skipRules:[]},
    {id:'assigned',label:'指定曲',pct:Math.round((DB.config.weights?.assigned||0.4)*100),skipRules:[]},
    {id:'free',label:'自選曲',pct:Math.round((DB.config.weights?.free||0.4)*100),skipRules:[]},
  ];
}

// ★ 判斷某 entry 是否被某欄的 skipRules 命中（任一 rule OR；rule 內各條件 AND，空=不限）
// ★ 取得學生某修別的扣考資訊（若無則 null）
function _getDQ(studentId,type){
  return DB.disqualified?.[studentId+'_'+type]||null;
}
window._getDQ=_getDQ;

// ★ 扣考徽章 HTML（用於各考試順序頁面）
function _dqBadgeHtml(studentId,type){
  const dq=_getDQ(studentId,type);
  if(!dq)return '';
  const reason=escHtml(dq.reason||dq.note||'');
  return `<span class="badge b-absent" style="margin-left:6px;font-size:9px" title="扣考原因：${reason}">⛔ 扣考${reason?'：'+reason:''}</span>`;
}
window._dqBadgeHtml=_dqBadgeHtml;

function isFieldSkipped(field, entry){
  if(!field)return false;

  // ★ 個別學生例外：不分條件，直接以「學生×修別」(entryKey) 指定哪些考生此欄不計分
  //   （必須在 rules.length 檢查之前，否則「只設例外、沒設條件規則」時會被提前 return 跳過）
  const entryKey=(entry.studentId||'')+'_'+(entry.type||'');
  if((field.skipEntries||[]).includes(entryKey))return true;

  const rules=field.skipRules||[];
  if(!rules.length)return false;

  // ★ 修正：直接用 entry 本身的 type/catId 比對
  //   entry 結構：{studentId, type:'major'|'minor'|'elective', catId, class, ...}
  //   每筆 entry 代表「學生 × 修別」的特定組合，這正是要排除的對象
  //   舊邏輯會去查 DB.users 的所有修別，導致「主修豎笛 + 選修豎笛」的學生
  //   在評主修那欄時，因為選修也是木管而被誤跳。

  // ★ 取得 entry 的樂器大項（catId 可能為空，從 instruments 查）
  let entryCatId=entry.catId;
  if(!entryCatId&&entry.instId){
    const inst=DB.instruments.items.find(i=>i.id===entry.instId);
    entryCatId=inst?.cat||'';
  }

  return rules.some(r=>{
    // ① 班級條件（空=不限）
    const matchCls=!r.cls||r.cls===entry.class;
    if(!matchCls)return false;

    // ② 修別條件（空=不限；有指定則必須與 entry.type 相同）
    const matchType=!r.type||r.type===entry.type;
    if(!matchType)return false;

    // ③ 樂器大項條件（空=不限；有指定則必須與 entry 的 catId 相同）
    const matchCat=!r.catId||r.catId===entryCatId;
    if(!matchCat)return false;

    // ④ 細項樂器條件（空=不限；有指定則必須與 entry 的 instId 相同）
    const matchInst=!r.instId||r.instId===entry.instId;
    if(!matchInst)return false;

    return true;
  });
}
window.isFieldSkipped=isFieldSkipped;
window.getRoomFields=getRoomFields;
const cname = id => DB.instruments.categories.find(c=>c.id===id)?.name||'';
const students = () => DB.users.filter(u=>u.role==='student');
const teachers = () => DB.users.filter(u=>u.role==='teacher');
const admins = () => DB.users.filter(u=>u.role==='admin');
const typeName = t=>({major:'主修',minor:'副修',elective:'選修'}[t]||'');
const typeBadge = t=>`<span class="badge b-${t}">${typeName(t)}</span>`;
const scoreClass = v => (v!==null && v!==undefined && v!=='' && parseFloat(v)<60) ? 'red-score' : '';
const fmtScore = v => {
  if(v===null||v===undefined||v==='') return '—';
  const n = parseFloat(v);
  const cls = n < 60 ? ' class="red-score"' : '';
  return `<span${cls}>${n.toFixed(1)}</span>`;
};

// ════════════════════════════════════════════════
// LOGIN
// ════════════════════════════════════════════════
function doLogin(){
  const acc=document.getElementById('l-user').value.trim();
  const pass=document.getElementById('l-pass').value.trim()||'000';
  const errEl=document.getElementById('l-err');
  errEl.textContent='';

  function _tryLogin(){
    // ★ S1：先嘗試同步驗證（向下相容舊密碼），失敗再嘗試 async SHA-256
    const candidate=DB.users.find(u=>u.account===acc);
    if(!candidate){errEl.textContent='帳號不存在或密碼錯誤';return;}
    const tryProceed=u=>{
      ST.user=u;ST.role=u.role;
      if(u.role==='admin'){
        try{sessionStorage.setItem('_adminSession',JSON.stringify({id:u.id,role:u.role}));}catch(e){}
      }
      launchApp();
      if(pass==='000'&&u.role!=='jury'){
        setTimeout(()=>{
          document.getElementById('fl-new').value='';
          document.getElementById('fl-confirm').value='';
          document.getElementById('fl-err').textContent='';
          openOverlay('first-login-modal');
        },600);
      }
    };
    // 新版 SHA-256 ($S$) 必須走 async
    if(typeof candidate.pass==='string'&&candidate.pass.startsWith('$S$')){
      _passVerifyAsync(pass,candidate.pass,candidate.id).then(ok=>{
        if(ok)tryProceed(candidate);
        else errEl.textContent='密碼錯誤';
      });
      return;
    }
    // 舊版 $X$ 或明文走同步
    if(_passVerify(pass,candidate.pass,candidate.id))tryProceed(candidate);
    else errEl.textContent='密碼錯誤';
  }

  // ★ 若 preloadUsersForLogin 已同步 users（DB.users 有資料）就直接比對，省掉一次 fetch
  if(window._FB && DB.users.length===0){
    errEl.textContent='驗證中...';
    const authWait=window._fbAuthReady||Promise.resolve(null);
    authWait.then(()=>{
      fbLoad('users',docs=>{
        if(docs.length){
          DB.users.length=0;
          docs.forEach(fd=>{const{_updatedAt,...rest}=fd;DB.users.push(rest);});
          // ★ 標記 users 已是最新，loadAllFromFirebase 可跳過 users 重讀
          DB._usersFreshAt=Date.now();
        }
        errEl.textContent='';
        _tryLogin();
      });
    });
  } else {
    // DB.users 已由 preloadUsersForLogin 填充，直接比對
    errEl.textContent='';
    _tryLogin();
  }
}
window.doLogin=doLogin;
// Event listeners wrapped safely
(function(){
  function attachListeners(){
    var lp=document.getElementById('l-pass');
    var lu=document.getElementById('l-user');
    var jc=document.getElementById('l-jury-code');
    if(lp) lp.addEventListener('keydown',function(e){if(e.key==='Enter')doLogin();});
    if(lu) lu.addEventListener('keydown',function(e){if(e.key==='Enter')doLogin();});
    if(jc) jc.addEventListener('keydown',function(e){if(e.key==='Enter')doJuryDirectLogin();});
    const ic2=document.getElementById('l-invig-code');
    if(ic2) ic2.addEventListener('keydown',function(e){if(e.key==='Enter')doInvigLogin();});
    // overlay click-to-close
    document.querySelectorAll('.overlay').forEach(function(o){
      o.addEventListener('click',function(e){if(e.target===o)o.classList.remove('on');});
    });
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',attachListeners);
  } else {
    attachListeners();
  }
})();

function doJuryDirectLogin(){
  const rawCode=document.getElementById('l-jury-code').value.trim();
  const code=rawCode.toUpperCase();
  const errEl=document.getElementById('l-jury-err');
  if(!code){errEl.textContent='請輸入考場代碼';return;}
  errEl.textContent='驗證中...';
  console.log('[jury login] 嘗試代碼:',code,'當前 rooms:',DB.rooms.length);

  function tryFindRoom(){
    errEl.textContent='';
    // ★ 列出所有可用代碼供 debug
    const allCodes=DB.rooms.map(r=>(r.code||'').toUpperCase()).filter(Boolean);
    console.log('[jury login] 所有考場代碼:',allCodes);
    const room=DB.rooms.find(r=>(r.code||'').toUpperCase()===code);
    if(!room){
      if(DB.rooms.length===0){
        errEl.textContent='系統尚未載入考場資料，請稍候再試';
      } else if(allCodes.length===0){
        errEl.textContent='考場尚未設定代碼，請聯絡管理員';
      } else {
        errEl.textContent='代碼錯誤（請確認大小寫和拼寫）';
      }
      return;
    }
    console.log('[jury login] 找到考場:',room.name,'(id=',room.id,', code=',room.code,')');
    ST.juryRoom=room;
    try{
      const savedJury=localStorage.getItem('_jurySession_'+room.id);
      if(savedJury){
        const sess=JSON.parse(savedJury);
        // ★ 修正：72 小時內的 session 才提示恢復（跨天考試常見）；超過視為過期
        const ageMs=Date.now()-(sess.savedAt||0);
        const ageOk=ageMs<72*3600*1000;
        if(sess.juryId&&sess.name&&ageOk){
          console.log('[jury login] 偵測到 72hr 內的舊 session:',sess.name,'asking confirm');
          if(confirm(
            `偵測到先前在此考場登入過：「${sess.name}」\n\n` +
            `★ 強烈建議按「確定」沿用此身分，分數會自動接續。\n` +
            `（按「取消」改用新身分輸入時，務必輸入完全相同的姓名，否則會視為新評審）\n\n` +
            `要繼續使用「${sess.name}」嗎？`
          )){
            ST.juryId=sess.juryId;ST.juryName=sess.name;ST.role='jury';
            ST.user={id:ST.juryId,name:sess.name,role:'jury'};
            console.log('[jury login] 沿用舊身分，啟動 launchApp');
            launchApp();return;
          }
          console.log('[jury login] 使用者選擇重新輸入');
        } else if(sess&&!ageOk){
          console.log('[jury login] 舊 session 已過期（>72hr），清除');
          try{localStorage.removeItem('_jurySession_'+room.id);}catch(e){}
        }
      }
    }catch(e){console.warn('[jury login] localStorage 讀取失敗',e);}
    console.log('[jury login] 開啟姓名輸入對話框');
    document.getElementById('jn-name').value='';
    document.getElementById('jn-err').textContent='';
    const nameEl=document.getElementById('jn-room-name');
    const locEl=document.getElementById('jn-room-loc');
    if(nameEl)nameEl.textContent=room.name;
    if(locEl)locEl.textContent=room.location?('📍 '+room.location):'';
    const modal=document.getElementById('jury-name-modal');
    if(!modal){
      errEl.textContent='系統錯誤：找不到姓名對話框元件';
      console.error('[jury login] 找不到 #jury-name-modal 元素');
      return;
    }
    modal.classList.add('on');
    setTimeout(()=>document.getElementById('jn-name')?.focus(),200);
  }

  // ★ 修正：先檢查記憶體（preloadUsersForLogin 應已載入 rooms）
  if(DB.rooms.length>0){
    tryFindRoom();
    return;
  }
  // ★ Firebase 不可用時直接報錯
  if(!window._FB){
    errEl.textContent='系統尚未連線，請重新整理頁面';
    return;
  }
  // ★ 主動載入 rooms（preload 可能還沒完成）
  let _done=false;
  const timeoutTimer=setTimeout(()=>{
    if(_done)return;_done=true;
    errEl.textContent='連線逾時，請重新整理頁面後再試';
    console.warn('[jury login] timeout 6s 等待 rooms 失敗');
  },6000);
  const authWait=window._fbAuthReady||Promise.resolve(null);
  authWait.then(()=>{
    if(_done)return;
    fbLoad('rooms',docs=>{
      if(_done)return;_done=true;clearTimeout(timeoutTimer);
      console.log('[jury login] 即時載入 rooms：', docs.length);
      if(docs.length){
        DB.rooms.length=0;
        docs.sort((a,b)=>(a._order||0)-(b._order||0)).forEach(d=>{const{id,_updatedAt,_order,...r}=d;DB.rooms.push({id,...r});});
      }
      tryFindRoom();
    });
  }).catch(err=>{
    if(_done)return;_done=true;clearTimeout(timeoutTimer);
    console.error('[jury login] auth 錯誤',err);
    errEl.textContent='連線失敗，請稍後重試';
  });
}
window.doJuryDirectLogin=doJuryDirectLogin;

function doJuryLogin(){
  const name=document.getElementById('jn-name').value.trim();
  const errEl=document.getElementById('jn-err');
  if(!name){if(errEl)errEl.textContent='請填入您的姓名';else showToast('請填入姓名','err');return;}
  if(errEl)errEl.textContent='';
  ST.juryName=name;
  // ★ 根本修正：以「考場ID + 姓名」作為穩定 juryId
  //   同一位評審重新登入永遠得到相同 key，徹底消除幽靈評審問題
  const roomId=ST.juryRoom?.id||'r';
  const stableId='JN_'+roomId+'_'+String(name).trim().replace(/\s+/g,'').replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g,'');
  ST.juryId=stableId;
  ST.role='jury';
  ST.user={id:ST.juryId,name,role:'jury'};
  // ★ 同名評審在不同考場不衝突（key 含 roomId），同一考場同名才需確認
  try{
    if(roomId&&DB.juryScores[roomId]){
      // 找出此考場中「同名但不同 key」的舊記錄，一併清理
      const existingNames=new Set();
      Object.entries(DB.juryScores[roomId]).forEach(([ek,entry])=>{
        Object.entries(entry||{}).forEach(([jid,data])=>{
          if(data&&data._jurorName===name&&jid!==stableId){
            // 有舊的非穩定 key，寫入 Firestore 時合併到新 key 並刪除舊 key
            console.log('[jury login] 偵測到同名舊 key：',jid,'→ 將合併至',stableId);
            if(!DB.juryScores[roomId][ek][stableId]){
              DB.juryScores[roomId][ek][stableId]={...data};
            }
            // 在 Firestore 更新：新 key 寫入，舊 key 設為 null（刪除欄位）
            if(window._FB){
              const {db,serverTimestamp,FieldValue}=window._FB;
              const patch={};
              patch[stableId]={...data,_jurorName:name};
              patch[jid]=FieldValue?.delete?.()??null;
              patch['_updatedAt']=serverTimestamp?.()??new Date().toISOString();
              db.collection('juryScores').doc(roomId)
                .collection('entries').doc(ek)
                .set(patch,{merge:true})
                .catch(e=>console.warn('[jury merge]',e));
            }
            delete DB.juryScores[roomId][ek][jid];
          }
        });
      });
    }
  }catch(e){console.warn('[jury login] 舊 key 合併失敗',e);}
  closeOverlay('jury-name-modal');
  // ★ 持久化評審身分到 localStorage
  try{
    if(roomId){
      localStorage.setItem('_jurySession_'+roomId,JSON.stringify({juryId:ST.juryId,name:ST.juryName,savedAt:Date.now()}));
    }
  }catch(e){}
  // ★ 離線化方案：第一次進入時提示重要事項（同一裝置只提示一次）
  try{
    const noticeKey='_jurySession_offlineNotice_'+roomId;
    if(!localStorage.getItem(noticeKey)){
      setTimeout(()=>{
        alert(
          '⚠️ 重要提醒（離線評分模式）\n\n' +
          '本系統採離線評分以節省網路用量：\n\n' +
          '• 評分過程「不會即時上傳」，請使用同一裝置全程評分\n' +
          '• 中途想備份可按「💾 中場儲存」按鈕\n' +
          '• 評分結束務必按「↑ 送出全部評分」\n' +
          '• 切勿中途清除瀏覽器資料或更換裝置'
        );
        try{localStorage.setItem(noticeKey,'1');}catch(e){}
      },500);
    }
  }catch(e){}
  launchApp();
}
window.doJuryLogin=doJuryLogin;

// ════════════════════════════════════════════════
// INVIGILATOR LOGIN
// ════════════════════════════════════════════════
function doInvigLogin(){
  const rawCode=(document.getElementById('l-invig-code')?.value||'').trim();
  const code=rawCode.toUpperCase();
  const errEl=document.getElementById('l-invig-err');
  if(!errEl)return;
  if(!code){errEl.textContent='請輸入監考代碼';return;}
  errEl.textContent='驗證中...';
  function tryFind(){
    errEl.textContent='';
    const room=DB.rooms.find(r=>{
      const ic=(r.invigCode||('I-'+r.code)).toUpperCase();
      return ic===code || (r.code||'').toUpperCase()===code;
    });
    if(!room){errEl.textContent='監考代碼錯誤，請重新輸入';return;}
    ST.invigRoom=room;
    ST.invigName='監考員';
    ST.role='invigilator';
    ST.user={id:'INVIG_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),name:'監考員',role:'invigilator'};
    launchApp();
  }
  // ★ 修正 R3：與評審登入相同邏輯（記憶體優先 + timeout 保護）
  if(DB.rooms.length>0){tryFind();return;}
  if(!window._FB){errEl.textContent='系統尚未連線，請稍後再試';return;}
  let _done=false;
  const timeoutTimer=setTimeout(()=>{
    if(_done)return;_done=true;
    errEl.textContent='連線逾時，請檢查網路後重試';
  },6000);
  const authWait=window._fbAuthReady||Promise.resolve(null);
  authWait.then(()=>{
    if(_done)return;
    fbLoad('rooms',docs=>{
      if(_done)return;_done=true;clearTimeout(timeoutTimer);
      if(docs.length){
        DB.rooms.length=0;
        docs.sort((a,b)=>(a._order||0)-(b._order||0)).forEach(d=>{const{id,_updatedAt,_order,...r}=d;DB.rooms.push({id,...r});});
      }
      tryFind();
    });
  }).catch(()=>{
    if(_done)return;_done=true;clearTimeout(timeoutTimer);
    errEl.textContent='連線失敗，請稍後重試';
  });
}
window.doInvigLogin=doInvigLogin;

function doLogout(){
  // ★ 修正 #E5：清理輪詢 timer 防止登出後仍持續讀 Firebase
  try{
    if(window._pollTimers){
      Object.values(window._pollTimers).forEach(t=>{if(t.id)clearInterval(t.id);});
      window._pollTimers={};
    }
    // ★ C3：清理所有 debounce timer（評分輸入的 800ms 寫入）
    if(window._jcDebounce){
      Object.values(window._jcDebounce).forEach(t=>clearTimeout(t));
      window._jcDebounce={};
    }
  }catch(e){}

  // ★ 重置 ST 整個物件（保留 isOnline 因為這跟使用者無關）
  const wasOnline=ST.isOnline;
  Object.keys(ST).forEach(k=>{delete ST[k];});
  ST.user=null;ST.role=null;ST.juryRoom=null;ST.juryName='';ST.juryId='';
  ST.npTarget=null;ST.npVal='';ST.npCallback=null;ST.isOnline=wasOnline;
  ST.invigRoom=null;ST.invigName='';ST._remarkFilterOn=false;

  // ★ 徹底清空 DB（避免下個使用者看到上個人的資料殘影）
  //   保留 instruments/classes/rooms 等預設值由 Firebase 重載即可
  DB.users.length=0;
  DB.teacherStudents={};
  DB.juryScores={};
  DB.teacherComments={};
  DB.deductions={};
  DB.disqualified={};
  DB.teacherTypeOverrides={};
  DB.blackSign={};
  DB.liveExam={};
  DB.savedScheduleSnapshot={};
  DB.scheduleState={};
  DB.jurySignup={};
  DB.repInstChanges={};
  if(DB._jurorOrderCache)DB._jurorOrderCache={};
  delete DB._usersFreshAt;

  // ★ 清空所有頁面渲染內容，避免下個使用者看到舊畫面
  document.querySelectorAll('.pg').forEach(pg=>{
    // 找出每個頁面的主要 body 容器（含 -body 後綴的、或 tbody）
    pg.querySelectorAll('[id$="-body"], [id$="-tbody"], tbody').forEach(el=>{
      if(el.id!=='login-screen-body')el.innerHTML='';
    });
    // 移除頁面顯示狀態
    pg.classList.remove('on');
  });

  // 清除導覽列（角色不同會有不同 nav 項目）
  const nav=document.getElementById('nav');
  if(nav)nav.innerHTML='';

  // 清除浮動元素（toast、modal、覆蓋層）
  document.querySelectorAll('.overlay.show, .toast').forEach(el=>{
    if(el.classList.contains('overlay'))el.classList.remove('show');
  });

  try{sessionStorage.removeItem('_adminSession');}catch(e){}

  // 切換登入畫面
  document.getElementById('app').classList.remove('on');
  document.getElementById('login-screen').classList.remove('gone');
  document.getElementById('l-user').value='';
  document.getElementById('l-pass').value='';
  document.getElementById('l-jury-code').value='';
  document.getElementById('l-err').textContent='';
  const je=document.getElementById('l-jury-err');if(je)je.textContent='';
  const ie=document.getElementById('l-invig-err');if(ie)ie.textContent='';
  const ic=document.getElementById('l-invig-code');if(ic)ic.value='';

  // 清除可能殘留的「已送出評分」感謝畫面、「忘記密碼」之類的 modal 內容
  const tyTitle=document.getElementById('ty-title-el');if(tyTitle)tyTitle.textContent='';
  const tyText=document.getElementById('ty-text-el');if(tyText)tyText.textContent='';
}

function openChPwd(){
  if(!ST.user||ST.role==='jury'){showToast('評審帳號無需密碼','warn');return;}
  document.getElementById('chpwd-old').value='';
  document.getElementById('chpwd-new').value='';
  document.getElementById('chpwd-confirm').value='';
  document.getElementById('chpwd-err').textContent='';
  openOverlay('chpwd-modal');
  setTimeout(()=>document.getElementById('chpwd-old').focus(),200);
}
window.openChPwd=openChPwd;

async function saveFirstPassword(){
  const newVal=document.getElementById('fl-new').value;
  const cfmVal=document.getElementById('fl-confirm').value;
  const errEl=document.getElementById('fl-err');
  if(!newVal||newVal.length<1){errEl.textContent='請輸入新密碼';return;}
  if(newVal==='000'){errEl.textContent='新密碼不可與預設密碼相同';return;}
  if(newVal===cfmVal){}else{errEl.textContent='兩次輸入不一致';return;}
  // ★ S1：用 SHA-256 加密
  const encoded=await _passEncodeAsync(newVal,ST.user.id);
  ST.user.pass=encoded;
  fbSet('users',ST.user.id,{pass:encoded});
  closeOverlay('first-login-modal');
  showToast('密碼已設定完成 ✓','ok');
}
window.saveFirstPassword=saveFirstPassword;

async function doChangePassword(){
  const oldVal=document.getElementById('chpwd-old').value;
  const newVal=document.getElementById('chpwd-new').value;
  const cfmVal=document.getElementById('chpwd-confirm').value;
  const errEl=document.getElementById('chpwd-err');
  if(!ST.user){errEl.textContent='請先登入';return;}
  // ★ S1：用 async verify（支援 SHA-256 + 向下相容）
  const oldOk=await _passVerifyAsync(oldVal,ST.user.pass,ST.user.id);
  if(!oldOk){errEl.textContent='舊密碼錯誤';return;}
  if(!newVal){errEl.textContent='新密碼不可為空';return;}
  if(newVal!==cfmVal){errEl.textContent='兩次密碼不一致';return;}
  const encoded=await _passEncodeAsync(newVal,ST.user.id);
  ST.user.pass=encoded;
  fbSet('users',ST.user.id,{pass:encoded});
  closeOverlay('chpwd-modal');
  showToast('密碼已更新 ✓','ok');
}
window.doChangePassword=doChangePassword;


// ════ Firebase 共用 helper（REST 模式相容）════
function fbSet(col, docId, data){
  if(!window._FB)return;
  (window._fbAuthReady||Promise.resolve()).then(()=>{
    try{
      const clean=JSON.parse(JSON.stringify({...data}));
      if(window._FB._rest){
        // REST 模式
        window._FB._set(col+'/'+docId, {...clean, _updatedAt: new Date().toISOString()})
          .catch(e=>console.warn('[FB write]',col,docId,e));
      } else {
        const {db,serverTimestamp}=window._FB;
        db.collection(col).doc(docId)
          .set({...clean, _updatedAt:serverTimestamp()},{merge:true})
          .catch(e=>console.warn('[FB write]',col,docId,e));
      }
    }catch(e){console.warn('[fbSet]',e);}
  });
}
function fbDelete(col, docId){
  if(!window._FB)return;
  (window._fbAuthReady||Promise.resolve()).then(()=>{
    try{
      if(window._FB._rest){
        window._FB._delete(col+'/'+docId).catch(e=>console.warn('[FB delete]',col,docId,e));
      } else {
        window._FB.db.collection(col).doc(docId).delete()
          .catch(e=>console.warn('[FB delete]',col,docId,e));
      }
    }catch(e){console.warn('[fbDelete]',e);}
  });
}
function fbLoad(col, cb){
  if(!window._FB){cb([]);return;}
  (window._fbAuthReady||Promise.resolve()).then(()=>{
    try{
      if(window._FB._rest){
        // REST 模式：直接 fetch list
        window._FB._list(col)
          .then(docs=>cb(docs))
          .catch(e=>{console.warn('[FB load]',col,e);cb([]);});
      } else {
        window._FB.db.collection(col).get()
          .then(snap=>{const docs=[];snap.forEach(d=>docs.push({id:d.id,...d.data()}));cb(docs);})
          .catch(e=>{console.warn('[FB load]',col,e);cb([]);});
      }
    }catch(e){console.warn('[fbLoad]',e);cb([]);}
  });
}

// ════ 頁面一載入就預先從 Firebase 讀取 users，確保登入時帳密已同步 ════
// ════════════════════════════════════════════════
// ★ 修正 #F3：密碼混淆（不是強加密，但避免明文存於 Firestore）
// ════════════════════════════════════════════════
// ★ S1 安全升級：密碼改用 SHA-256 雜湊（瀏覽器原生 crypto.subtle）
//   - 新格式：'$S$' + base64(sha256(plain + '|' + salt))
//   - 向下相容：仍可驗證舊的 '$X$'（Base64）和明文密碼
async function _sha256Hex(text){
  const buf=new TextEncoder().encode(text);
  const hash=await crypto.subtle.digest('SHA-256',buf);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}
async function _passEncodeAsync(plainPass,userId){
  if(plainPass==null||plainPass==='')return '';
  if(typeof plainPass==='string'&&(plainPass.startsWith('$S$')||plainPass.startsWith('$X$')))return plainPass;
  const salt='mep_v2_'+(userId||'').slice(-6);
  try{
    const hashed=await _sha256Hex(String(plainPass)+'|'+salt);
    return '$S$'+hashed;
  }catch(e){
    // crypto.subtle 不可用時 fallback 到舊 Base64
    return _passEncode(plainPass,userId);
  }
}
window._passEncodeAsync=_passEncodeAsync;

// 舊版 Base64 編碼（保留以驗證舊密碼）
function _passEncode(plainPass, userId){
  if(plainPass===undefined||plainPass===null)return '';
  if(plainPass==='')return '';
  // 已混淆的不再重複處理
  if(typeof plainPass==='string'&&(plainPass.startsWith('$X$')||plainPass.startsWith('$S$')))return plainPass;
  try{
    const salt='mep_'+(userId||'').slice(-4);
    const raw=String(plainPass)+'|'+salt;
    return '$X$'+btoa(unescape(encodeURIComponent(raw)));
  }catch(e){return plainPass;}
}
function _passVerify(input,stored,userId){
  if(stored===undefined||stored===null||stored==='')return input===''||input===undefined;
  // 新版 SHA-256：同步無法驗證，需要呼叫 _passVerifyAsync
  if(typeof stored==='string'&&stored.startsWith('$S$')){
    console.warn('[passVerify] $S$ 格式必須使用 _passVerifyAsync 驗證');
    return false;
  }
  // 舊版 $X$ Base64
  if(typeof stored==='string'&&stored.startsWith('$X$')){
    try{return _passEncode(input,userId)===stored;}catch(e){return false;}
  }
  // 明文（最舊版）
  return input===stored;
}
async function _passVerifyAsync(input,stored,userId){
  if(stored===undefined||stored===null||stored==='')return input===''||input===undefined;
  // 新版 $S$ SHA-256
  if(typeof stored==='string'&&stored.startsWith('$S$')){
    try{
      const hashed=await _passEncodeAsync(input,userId);
      return hashed===stored;
    }catch(e){return false;}
  }
  // 向下相容：$X$ Base64 或明文
  return _passVerify(input,stored,userId);
}
window._passEncode=_passEncode;
window._passVerify=_passVerify;
window._passVerifyAsync=_passVerifyAsync;

function preloadUsersForLogin(){
  if(!window._FB){return;}
  // ★ 修正：同時預先載入 users 和 rooms，讓評審/監考按鈕能立即用記憶體判斷代碼
  fbLoad('users',docs=>{
    if(docs.length){
      DB.users.length=0;
      docs.forEach(fd=>{const{_updatedAt,...rest}=fd;DB.users.push(rest);});
      if(ST.user&&ST.user.id){
        const fresh=DB.users.find(u=>u.id===ST.user.id);
        if(fresh){ST.user=fresh;}
      }
      console.log('[preload] users 已載入',DB.users.length);
    }
  });
  fbLoad('rooms',docs=>{
    if(docs.length){
      DB.rooms.length=0;
      docs.sort((a,b)=>(a._order||0)-(b._order||0)).forEach(d=>{const{id,_updatedAt,_order,...r}=d;DB.rooms.push({id,...r});});
      console.log('[preload] rooms 已載入',DB.rooms.length,DB.rooms.map(r=>r.code).join(','));
    }
  });
}

// ════ 啟動時從 Firebase 讀回所有資料（全並行版本） ════
function loadAllFromFirebase(done, lightMode){
  if(!window._FB){done();return;}

  // ★ 整體最長等待：12 秒後強制完成，避免任何情況卡死
  let _allDone=false;
  const forceDone=()=>{if(!_allDone){_allDone=true;done();}};
  const _forceTimer=setTimeout(()=>{console.warn('[loadAll] 整體超時，強制完成');forceDone();},12000);

  // ★ 登入時 doLogin 已讀過 users，跳過重讀（由呼叫端傳入 skipUsers=true）
  // lightMode：學生/評審/監考只需核心資料，跳過 juryScores/teacherComments/deductions/blackSign

  // 用 fbLoad 包成 Promise
  const load=col=>new Promise(res=>{
    try{fbLoad(col,docs=>res(docs));}catch(e){res([]);}
  });

  // ── 並行讀取所有需要的集合 ──
  // ★ juryScores 在 allSettled.then 後串行讀取（確保 DB.rooms 已載入後才執行）
  const _loadJuryScores=async ()=>{
    if(!window._FB)return;
    DB.juryScores={};

    // ★ 學生快取機制：先嘗試從 localStorage 載入（避免 ~830 文件讀取）
    if(lightMode&&ST.role==='student'){
      try{
        const remoteVersions=await fetchSnapshotVersions();
        const needScores=shouldFetchFresh('scores',remoteVersions);
        if(!needScores){
          const cached=getCachedDataset('scores')||getCachedDataset('comments');
          const cacheHasContent=cached&&cached.juryScores&&Object.keys(cached.juryScores||{}).some(rid=>{
            const room=cached.juryScores[rid];
            return room&&Object.keys(room).length>0;
          });
          if(cacheHasContent){
            DB.juryScores=cached.juryScores||{};
            console.log('[student] juryScores 命中快取（version='+(remoteVersions.scores||'?')+'），跳過 Firebase 讀取');
            return;
          }
        }
        // 快取未命中或無內容：往下走 fresh load + 寫入快取
      }catch(e){console.warn('[student] 快取檢查失敗，改走 fresh load',e);}
    } else if(lightMode && (ST.role==='jury' || ST.role==='invigilator')){
      // 評審/監考：不需要 juryScores
      return;
    }
    // ★ 教師(lightMode)：需要 juryScores 看成績總表，不 return，往下走 fresh load

    try{
      if(window._FB._rest){
        // ★ 此時 allSettled 已完成，DB.rooms 已載入，直接用 roomId 讀 entries
        const roomIds=(DB.rooms||[]).map(r=>r.id).filter(Boolean);
        if(!roomIds.length){console.warn('[juryScores] DB.rooms 空，無法讀取成績');return;}
        await Promise.all(roomIds.map(async roomId=>{
          const entryDocs=await window._FB._list('juryScores/'+roomId+'/entries').catch(()=>[]);
          if(!entryDocs||!entryDocs.length)return;
          DB.juryScores[roomId]={};
          entryDocs.forEach(ed=>{
            const{id,_updatedAt,...jurors}=ed;
            if(!id)return;
            // ★ 過濾 null/非物件評審 key（FieldValue.delete() 在 REST 模式下殘留）
            const cleanJurors={};
            Object.entries(jurors).forEach(([k,v])=>{if(v&&typeof v==='object')cleanJurors[k]=v;});
            DB.juryScores[roomId][id]=cleanJurors;
          });
        }));
      } else {
        // SDK 模式：collection().get() 可正常列出所有 roomId 文件（即使無欄位）
        const db=window._FB.db;
        // 同時用 DB.rooms 補充（防止 Firestore 沒有父文件的 roomId）
        const roomIds=new Set();
        try{
          const roomSnap=await db.collection('juryScores').get();
          roomSnap.docs.forEach(d=>roomIds.add(d.id));
        }catch(e){}
        (DB.rooms||[]).forEach(r=>r.id&&roomIds.add(r.id));
        await Promise.all([...roomIds].map(async roomId=>{
          try{
            DB.juryScores[roomId]={};
            const entrySnap=await db.collection('juryScores').doc(roomId).collection('entries').get();
            entrySnap.forEach(ed=>{
              const raw=ed.data();const jurors={};
              Object.keys(raw).forEach(k=>{
                if(k.startsWith('_'))return;
                if(raw[k]&&typeof raw[k]==='object')jurors[k]=raw[k];
              });
              DB.juryScores[roomId][ed.id]=jurors;
            });
          }catch(e){delete DB.juryScores[roomId];}
        }));
      }
      // 清理沒有成績的考場
      Object.keys(DB.juryScores).forEach(r=>{
        if(!Object.keys(DB.juryScores[r]).length)delete DB.juryScores[r];
      });

      // ★ 自動合併「同姓名的重複評審 ID」（根源解決幽靈評審）
      //   情境：同一位評審用不同 juryId 進入考場（早期版本的隨機 ID + 後期穩定 ID 並存）
      //   邏輯：以 _jurorName 為合併鍵，所有同名 ID 合併到「JN_{roomId}_{name}」標準 key
      try{
        await _autoMergeSameNameJurors();
      }catch(e){console.warn('[juryScores] 自動合併失敗',e);}

      console.log('[juryScores] 載入完成 ✓ 考場數：',Object.keys(DB.juryScores).length,
        '總成績筆數：',Object.values(DB.juryScores).reduce((s,r)=>s+Object.keys(r).length,0));

      // ★ 學生：把 fresh-loaded 資料寫入快取，下次登入可用
      if(lightMode&&ST.role==='student'){
        const totalEntries=Object.values(DB.juryScores||{}).reduce((s,r)=>s+Object.keys(r||{}).length,0);
        if(totalEntries>0){
          try{
            const remoteVersions=await fetchSnapshotVersions();
            const snapshot={juryScores:DB.juryScores};
            setCachedDataset('scores',snapshot);
            setCachedDataset('comments',snapshot);
            const local=getLocalCacheVersions();
            local.scores=remoteVersions.scores||('local-'+Date.now());
            local.comments=remoteVersions.comments||local.scores;
            setLocalCacheVersions(local);
            console.log('[student] 寫入快取，總成績筆數：',totalEntries);
          }catch(e){console.warn('[student] 寫入快取失敗',e);}
        }
      }
    }catch(e){console.warn('[juryScores] 載入失敗',e);}
  };

  // ★ 自動合併同名評審：在記憶體合併 + 寫回 Firebase
  async function _autoMergeSameNameJurors(){
    if(!window._FB)return;
    let totalMerged=0,totalRoomsAffected=0;
    const fv=window._FB?.FieldValue;
    const db=window._FB?.db;
    const st=window._FB?.serverTimestamp;
    const isRest=window._FB?._rest;

    for(const roomId of Object.keys(DB.juryScores)){
      const room=DB.juryScores[roomId];
      let roomDirty=false;
      const fields=(typeof getRoomFields==='function'?getRoomFields(roomId):[{id:'scale'},{id:'assigned'},{id:'free'}]).map(f=>f.id);

      // ★ 統一判斷：是否有實際分數或評語
      const SYS_KEYS=new Set(['comment','absent']);
      const hasContent=(data)=>{
        if(!data||typeof data!=='object')return false;
        const hasScore=Object.keys(data).some(fk=>{
          if(fk.startsWith('_')||SYS_KEYS.has(fk))return false;
          const v=data[fk];
          return v!==undefined&&v!==''&&v!==null&&v!=='*';
        });
        const hasComment=data.comment&&String(data.comment).trim();
        return hasScore||hasComment;
      };

      for(const entryKey of Object.keys(room)){
        const entry=room[entryKey];
        if(!entry||typeof entry!=='object')continue;
        // 依姓名分組
        const byName={};
        const namelessIds=[]; // 無姓名的幽靈
        Object.entries(entry).forEach(([jid,data])=>{
          if(jid.startsWith('_'))return;
          if(!data||typeof data!=='object'){namelessIds.push(jid);return;}
          const name=(data._jurorName||'').trim();
          if(!name){
            // ★ 修正：無姓名但「有實際分數或評語」的記錄一律保留，避免誤刪真實成績
            //   （例如批次編輯/老師帳號評分等流程產生、尚未補上姓名的記錄）
            //   只有「無姓名且無內容」才視為幽靈刪除；要強制清理請用手動按鈕。
            const SYS_KEYS=new Set(['comment','absent']);
            const hasContent=Object.keys(data).some(fk=>{
              if(fk.startsWith('_'))return false;
              const v=data[fk];
              if(SYS_KEYS.has(fk))return fk==='comment'&&v&&String(v).trim();
              return v!==undefined&&v!==null&&v!=='';
            });
            if(!hasContent)namelessIds.push(jid); // 無姓名又無內容 → 幽靈
            return;
          }
          // ★ 有姓名的評審一律保留參與合併（即使暫時沒分數），
          //   避免誤刪剛登入但還沒打分的評審。
          //   若要清「有姓名無分數」的殘留，請管理員手動按「清理幽靈評審」按鈕。
          if(!byName[name])byName[name]=[];
          byName[name].push([jid,data]);
        });

        // 找出有重複的姓名
        const patch={};let entryDirty=false;
        for(const [name,records] of Object.entries(byName)){
          if(records.length<=1)continue;
          // 標準穩定 key
          const stableId='JN_'+roomId+'_'+String(name).trim().replace(/\s+/g,'').replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g,'');
          // 取最新版本：依 _localUpdatedAt 排序，後來的覆蓋先前
          records.sort((a,b)=>(a[1]._localUpdatedAt||0)-(b[1]._localUpdatedAt||0));
          const merged={_jurorName:name};
          records.forEach(([,data])=>{
            Object.keys(data).forEach(k=>{
              if(k==='_jurorName')return;
              const v=data[k];
              if(v!==undefined&&v!==null&&v!=='')merged[k]=v;
            });
          });
          merged._localUpdatedAt=Date.now();

          // 寫入記憶體
          DB.juryScores[roomId][entryKey][stableId]=merged;
          patch[stableId]=merged;

          // 刪除舊 key（除了 stableId 本身）
          records.forEach(([jid])=>{
            if(jid===stableId)return;
            delete DB.juryScores[roomId][entryKey][jid];
            if(isRest)patch[jid]=null;
            else if(fv?.delete)patch[jid]=fv.delete();
            else patch[jid]=null;
            totalMerged++;
          });
          entryDirty=true;
        }

        // ★ 刪除無姓名的幽靈
        namelessIds.forEach(jid=>{
          delete DB.juryScores[roomId][entryKey][jid];
          if(isRest)patch[jid]=null;
          else if(fv?.delete)patch[jid]=fv.delete();
          else patch[jid]=null;
          totalMerged++;
          entryDirty=true;
        });

        // ★ 自動執行不刪「有姓名但無分數」的評審（避免誤刪剛登入未打分的）
        //   若有此類殘留需清理，請管理員手動執行「清理幽靈評審」按鈕

        // ★ 寫回 Firebase
        //   策略：REST 模式無法真正刪除 field，會留下 nullValue，
        //   改採「整個文件覆寫」或「整個文件刪除」確保 Firebase 也乾淨
        if(entryDirty&&db){
          const cleanData={...DB.juryScores[roomId][entryKey]};
          Object.keys(cleanData).forEach(k=>{if(k.startsWith('_'))delete cleanData[k];});
          try{
            if(Object.keys(cleanData).length===0){
              // 整個 entry 沒有任何有效評審，直接刪除整個文件
              if(isRest){
                await window._FB._delete('juryScores/'+roomId+'/entries/'+entryKey).catch(()=>{});
              } else {
                await db.collection('juryScores').doc(roomId).collection('entries').doc(entryKey).delete().catch(()=>{});
              }
              delete DB.juryScores[roomId][entryKey];
            } else {
              cleanData._updatedAt=st?.()??new Date().toISOString();
              if(isRest){
                await window._FB._delete('juryScores/'+roomId+'/entries/'+entryKey).catch(()=>{});
                await window._FB._set('juryScores/'+roomId+'/entries/'+entryKey,cleanData);
              } else {
                await db.collection('juryScores').doc(roomId).collection('entries').doc(entryKey).set(cleanData);
              }
            }
            roomDirty=true;
          }catch(e){console.warn('[autoMerge] 寫回失敗',entryKey,e);}
        }
      }
      if(roomDirty)totalRoomsAffected++;
    }
    if(totalMerged>0){
      // 清空評審順序快取（合併後需重建）
      DB._jurorOrderCache={};
      console.log('[autoMerge] ✓ 自動合併 '+totalMerged+' 筆同名重複/幽靈評審記錄，影響 '+totalRoomsAffected+' 個考場');
    }
  }

  const tasks={
    config:   load('config'),
    rooms:    load('rooms'),
    classes:  load('classes'),
    instruments: load('instruments'),
    teacherStudents: load('teacherStudents'),
    disqualified: load('disqualified'),
    teacherTypeOverrides: load('teacherTypeOverrides'),
    liveExam: load('liveExam'),
    jurySignup: load('jurySignup'),
    jurySignupConfig: load('jurySignupConfig'),
    scheduleState: load('scheduleState'),
    // ★ 快取機制：學生/教師 + 快取版本一致時，跳過 scheduleSnapshots 載入
    scheduleSnapshots: (async()=>{
      if(lightMode&&(ST.role==='student'||ST.role==='teacher')){
        try{
          const remoteVersions=await fetchSnapshotVersions();
          if(!shouldFetchFresh('schedule',remoteVersions)){
            const cached=getCachedDataset('schedule');
            if(cached&&cached.scheduleSnapshots){
              console.log('['+ST.role+'] scheduleSnapshots 命中快取，跳過 Firebase 讀取');
              // ★ 回傳格式必須符合 load() 慣例：[{id, entries:[...], _updatedAt}]
              //   下游程式碼 (r.scheduleSnapshots.forEach) 用 d.entries 取陣列
              return Object.entries(cached.scheduleSnapshots).map(([id,arr])=>({id,entries:arr||[]}));
            }
          }
        }catch(e){console.warn('[cache] schedule 版本檢查失敗，改為直接載入',e);}
      }
      return load('scheduleSnapshots');
    })(),
    repInstChanges: lightMode ? Promise.resolve([]) : load('repInstChanges'),
    // lightMode 跳過的慢速集合（但學生需要 teacherComments 看自己評語）
    teacherComments: (lightMode && ST.role!=='student') ? Promise.resolve([]) : load('teacherComments'),
    deductions: (lightMode && ST.role!=='student' && ST.role!=='teacher') ? Promise.resolve([]) : load('deductions'),
    blackSign: (lightMode && ST.role!=='jury' && ST.role!=='invigilator') ? Promise.resolve([]) : load('blackSign'),
    pendingApprovals: load('pendingApprovals'), // ★ 90分以上審核資料，所有角色都需載入
    users: load('users'),
    // juryScores 在 allSettled.then 後才讀（確保 DB.rooms 已載入）
  };

  // ★ 修正 #A3：用 allSettled 確保單一集合失敗不影響其他集合
  Promise.allSettled(Object.entries(tasks).map(([k,p])=>p.then(v=>({k,v})).catch(e=>({k,v:[],err:e})))).then(settled=>{
    const r={};
    Object.keys(tasks).forEach(k=>r[k]=[]);
    settled.forEach(res=>{
      if(res.status==='fulfilled'&&res.value){r[res.value.k]=res.value.v||[];}
    });

    // — users —
    if(r.users.length){
      const alreadyFresh=DB._usersFreshAt&&(Date.now()-DB._usersFreshAt<60000)&&DB.users.length>0;
      if(!alreadyFresh){
        DB.users.length=0;
        r.users.forEach(fd=>{const{_updatedAt,...rest}=fd;DB.users.push(rest);});
      }
      if(ST.user){const fresh=DB.users.find(u=>u.id===ST.user.id);if(fresh)ST.user=fresh;}
    }
    // ★ 費用優化：移除所有 else 分支的預設資料寫入，避免每次首次連線大量觸發 Firebase 寫入費用

    // — config —
    const cfg=r.config.find(d=>d.id==='main');
    if(cfg){
      const{id,_updatedAt,...rest}=cfg;
      if(rest.weights)DB.config.weights=rest.weights;
      if(rest.scoreCaps)DB.config.scoreCaps=rest.scoreCaps;
      if(rest.hardCap!=null)DB.config.hardCap=rest.hardCap;
      if(rest.trimRules)DB.config.trimRules=rest.trimRules;
      if(rest.pages)Object.assign(DB.config.pages,rest.pages);
      if(rest.studentAccess)Object.assign(DB.config.studentAccess,rest.studentAccess);
      if(rest.teacherAccess)Object.assign(DB.config.teacherAccess,rest.teacherAccess);
      if(DB.config.teacherAccess['jury-signup']===undefined)DB.config.teacherAccess['jury-signup']=true;
      if(DB.config.teacherAccess['tea-jury-comments']===undefined)DB.config.teacherAccess['tea-jury-comments']=false;
      // ★ 遷移：舊資料用 stu-schedule，新版改為 tea-schedule
      if(DB.config.teacherAccess['stu-schedule']!==undefined&&DB.config.teacherAccess['tea-schedule']===undefined){
        DB.config.teacherAccess['tea-schedule']=DB.config.teacherAccess['stu-schedule'];
      }
      delete DB.config.teacherAccess['stu-schedule'];
      if(DB.config.teacherAccess['tea-schedule']===undefined)DB.config.teacherAccess['tea-schedule']=false;
      if(rest.repHint)DB.config.repHint=rest.repHint;
      if(rest.tyTitle)DB.config.tyTitle=rest.tyTitle;
      if(rest.tyText)DB.config.tyText=rest.tyText;
      if(rest.teacherScheduleClosedMsg!==undefined)DB.config.teacherScheduleClosedMsg=rest.teacherScheduleClosedMsg;
      if(rest.instRestrict)DB.config.instRestrict=rest.instRestrict;
      if(rest.instRestrictMsg)DB.config.instRestrictMsg=rest.instRestrictMsg;
      if(rest.repConfirmMsg!==undefined)DB.config.repConfirmMsg=rest.repConfirmMsg;
      if(rest.pendingMsg)DB.config.pendingMsg=rest.pendingMsg;
      if(rest.bulletin)Object.assign(DB.config.bulletin,rest.bulletin);
      if(rest.examRules)Object.assign(DB.config.examRules,rest.examRules);
      if(rest.examRules)Object.assign(DB.config.examRules,rest.examRules);
      if(rest.assignedPieces!==undefined)DB.config.assignedPieces=rest.assignedPieces;
      if(rest.assignedPiecesRules!==undefined)DB.config.assignedPiecesRules=rest.assignedPiecesRules||[];
      if(rest.resultsPublished!==undefined)DB.config.resultsPublished=rest.resultsPublished; // ★ 需求4
      if(rest.resultsPublishedAt!==undefined)DB.config.resultsPublishedAt=rest.resultsPublishedAt; // ★ 需求4
    }

    // — rooms —
    if(r.rooms.length){
      DB.rooms.length=0;
      r.rooms.sort((a,b)=>(a._order||0)-(b._order||0));
      r.rooms.forEach(d=>{const{id,_updatedAt,_order,...rm}=d;DB.rooms.push({id,...rm});});
    }

    // — classes —
    if(r.classes.length){
      const cl=r.classes.find(d=>d.id==='main');
      if(cl&&cl.list)DB.classes.splice(0,DB.classes.length,...cl.list);
    }

    // — instruments —
    if(r.instruments.length){
      const cats=r.instruments.find(d=>d.id==='categories');
      const items=r.instruments.find(d=>d.id==='items');
      if(cats&&cats.list)DB.instruments.categories=cats.list;
      if(items&&items.list)DB.instruments.items=items.list;
    }

    // — teacherStudents —
    if(r.teacherStudents.length){
      r.teacherStudents.forEach(d=>{if(d.id)DB.teacherStudents[d.id]=(d.list||d.students||[]);});
    }

    // — disqualified —
    r.disqualified.forEach(d=>{const{id,_updatedAt,...rest}=d;DB.disqualified[id]=rest;});
    if(r.teacherTypeOverrides)r.teacherTypeOverrides.forEach(d=>{const{id,_updatedAt,...rest}=d;DB.teacherTypeOverrides[id]=rest;});

    // — teacherComments —
    r.teacherComments.forEach(d=>{const{id,_updatedAt,...rest}=d;DB.teacherComments[id]=rest;});

    // — pendingApprovals — ★ 90分以上審核資料
    if(r.pendingApprovals){
      DB.pendingApprovals={};
      r.pendingApprovals.forEach(d=>{const{id,_updatedAt,...rest}=d;DB.pendingApprovals[id]=rest;});
    }

    // — deductions —
    (r.deductions||[]).forEach(d=>{const{id,_updatedAt,...rest}=d;DB.deductions[id]=rest;});
    console.log('[載入] deductions 筆數：',Object.keys(DB.deductions).length,'（角色：'+ST.role+'）');

    // — blackSign —
    r.blackSign.forEach(d=>{const{id,_updatedAt,...rest}=d;DB.blackSign[id]=rest;});

    // — liveExam —
    r.liveExam.forEach(d=>{const{id,...rest}=d;DB.liveExam[id]=rest;});

    // — jurySignup —
    r.jurySignup.forEach(d=>{const{id,_updatedAt,...rest}=d;DB.jurySignup[id]=rest;});

    // — repInstChanges（需求1：樂器異動通知） —
    if(r.repInstChanges){
      DB.repInstChanges={};
      r.repInstChanges.forEach(d=>{const{id,_updatedAt,...rest}=d;DB.repInstChanges[id]=rest;});
    }

    // — jurySignupConfig —
    const jscfg=r.jurySignupConfig.find(d=>d.id==='main');
    if(jscfg){
      if(jscfg.note!==undefined)DB.config.jurySignupNote=jscfg.note;
      if(jscfg.options)DB.config.jurySignupOptions=jscfg.options;
    }

    // — scheduleState（同步快照，不阻塞主流程） —
    const stateDoc=r.scheduleState.find(d=>d.id==='main');
    const snapDoc=r.scheduleState.find(d=>d.id==='snapshot');
    if(stateDoc&&stateDoc.data){try{_applyScheduleState(JSON.parse(stateDoc.data));}catch(e){}}
    // ★ 修正 #F1：優先讀取分拆的 scheduleSnapshots collection
    if(r.scheduleSnapshots&&r.scheduleSnapshots.length){
      DB.savedScheduleSnapshot={};
      r.scheduleSnapshots.forEach(d=>{
        const{id,_updatedAt,_savedAt,entries,...rest}=d;
        DB.savedScheduleSnapshot[id]=entries||rest.data||[];
      });
      // ★ 學生/教師：把載入結果寫入快取（下次同版本時跳過 Firebase 讀取）
      if(lightMode&&(ST.role==='student'||ST.role==='teacher')){
        try{
          (async()=>{
            const remoteVersions=await fetchSnapshotVersions();
            setCachedDataset('schedule',{scheduleSnapshots:DB.savedScheduleSnapshot});
            const local=getLocalCacheVersions();
            // ★ 即使遠端沒有版本（管理員未公告），也設本地版本以避免反覆 fresh load
            local.schedule=remoteVersions.schedule||('local-'+Date.now());
            setLocalCacheVersions(local);
          })();
        }catch(e){}
      }
    } else if(snapDoc&&snapDoc.data){
      // 向下相容舊版 snapshot
      try{DB.savedScheduleSnapshot=JSON.parse(snapDoc.data);}catch(e){}
    }
    // ★ 修正：載入後自動去重（清理「同一學生同一修別在多考場」的歷史殘留資料）
    try{
      if(DB.savedScheduleSnapshot){
        // ★ 先深拷貝原始資料（避免邊讀邊改造成 race）
        const original={};
        Object.keys(DB.savedScheduleSnapshot).forEach(roomId=>{
          original[roomId]=(DB.savedScheduleSnapshot[roomId]||[]).slice();
        });
        const orderedRoomIds=[
          ...DB.rooms.map(r=>r.id),
          ...Object.keys(original).filter(id=>!DB.rooms.some(r=>r.id===id))
        ];
        const cleaned={};
        const claimed=new Set();
        const dirtyRooms=new Set();
        let dupCount=0;
        // 第一輪：保留 _forceInclude=true（管理員手動指派優先佔位）
        orderedRoomIds.forEach(roomId=>{
          (original[roomId]||[]).forEach(e=>{
            if(!e._forceInclude)return;
            const key=e.studentId+'_'+e.type;
            if(claimed.has(key)){dupCount++;dirtyRooms.add(roomId);return;}
            claimed.add(key);
            if(!cleaned[roomId])cleaned[roomId]=[];
            cleaned[roomId].push(e);
          });
        });
        // 第二輪：自動篩選分配的，依考場順序取「第一個匹配」
        orderedRoomIds.forEach(roomId=>{
          (original[roomId]||[]).forEach(e=>{
            if(e._forceInclude)return; // 已處理
            const key=e.studentId+'_'+e.type;
            if(claimed.has(key)){dupCount++;dirtyRooms.add(roomId);return;}
            claimed.add(key);
            if(!cleaned[roomId])cleaned[roomId]=[];
            cleaned[roomId].push(e);
          });
        });
        // 確保沒有遺漏的考場 key
        Object.keys(original).forEach(roomId=>{
          if(!cleaned[roomId])cleaned[roomId]=[];
        });
        DB.savedScheduleSnapshot=cleaned;
        if(dupCount>0){
          console.log('[snapshot] 自動清理',dupCount,'筆重複學生分配（同一修別出現在多考場）');
          // ★ 改：任何角色都可以觸發寫回（資料修復）
          if(window._FB){
            dirtyRooms.forEach(roomId=>{
              fbSet('scheduleSnapshots',roomId,{entries:DB.savedScheduleSnapshot[roomId]||[],_savedAt:new Date().toISOString()});
            });
            console.log('[snapshot] 已寫回',dirtyRooms.size,'個考場到 Firebase');
          }
        }
      }
    }catch(e){console.warn('[snapshot] 去重失敗',e);}

    // ★ 其他集合已全部載入；接著讀 juryScores（此時 DB.rooms 已有資料）
    clearTimeout(_forceTimer);
    // ★ 在所有其他集合載入完後，才讀 juryScores（確保 DB.rooms 已有資料）
    _loadJuryScores().finally(()=>forceDone());

  }).catch(e=>{
    console.warn('[loadAll] Promise.all 失敗',e);
    clearTimeout(_forceTimer);
    forceDone();
  });
}

function launchApp(){
  // ★ 清除上一個使用者可能殘留的渲染（防止 session 切換時看到舊畫面）
  const nav=document.getElementById('nav');
  if(nav)nav.innerHTML='';
  document.querySelectorAll('.pg').forEach(pg=>pg.classList.remove('on'));

  document.getElementById('login-screen').classList.add('gone');
  document.getElementById('app').classList.add('on');
  document.getElementById('role-pill').textContent={admin:'管理員・教師',teacher:'教師',student:'學生',jury:'評審',invigilator:'監考'}[ST.role]||'';
  document.getElementById('tb-uname').textContent=ST.user.name;
  // 顯示載入提示
  const loadEl=document.createElement('div');
  loadEl.id='fb-loading';
  loadEl.style.cssText='position:fixed;inset:0;background:rgba(24,21,15,.55);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px';
  loadEl.innerHTML='<div style="font-family:\'DM Mono\',monospace;font-size:13px;color:var(--gold);letter-spacing:3px" id="fb-load-msg">連線中...</div><div style="width:160px;height:3px;background:var(--border);border-radius:3px"><div id="fb-bar" style="height:100%;width:0%;background:var(--gold);border-radius:3px;transition:width .3s"></div></div>';
  document.body.appendChild(loadEl);
  const bar=document.getElementById('fb-bar');
  const loadMsg=document.getElementById('fb-load-msg');
  // ★ 效能修正③：更快的進度動畫，讓使用者感覺更流暢
  let prog=0;
  const progTimer=setInterval(()=>{
    prog=Math.min(prog+(prog<30?12:prog<70?6:2),92);
    if(bar)bar.style.width=prog+'%';
  },100);
  // ★ 等匿名 Auth 完成後再讀 Firestore
  const authWait = window._fbAuthReady || Promise.resolve(null);
  authWait.then(()=>{
    if(loadMsg)loadMsg.textContent='載入資料中...';
    // ★ 效能修正③：非管理員角色（學生/評審/監考）只需要最少資料集，快速完成
    const isLightRole=ST.role==='student'||ST.role==='jury'||ST.role==='invigilator';
    loadAllFromFirebase(()=>{
      clearInterval(progTimer);if(bar)bar.style.width='100%';
      setTimeout(()=>{
        loadEl.remove();
        // ★ #8 嘗試恢復管理員 session（重整後自動登回）
        if(window._pendingAdminRestore){
          const sess=window._pendingAdminRestore;
          window._pendingAdminRestore=null;
          const u=DB.users.find(x=>x.id===sess.id&&x.role==='admin');
          if(u){
            ST.user=u;ST.role='admin';
            document.getElementById('role-pill').textContent='管理員・教師';
            document.getElementById('tb-uname').textContent=u.name;
          }
        }
        buildNav();initDropdowns();renderAll();setTimeout(navFirst,80);
        // ★ 管理員：排程狀態已在記憶體，立即套用（不需要延遲）
        if(ST.role==='admin')schLoadSchedule();
        // ★ 延遲啟動輪詢監聽（不阻塞首屏渲染）
        setTimeout(()=>{
          if(window._startJuryListener)window._startJuryListener();
          // ★ 離線化方案：已停用 _startLiveExamListener（liveExam 不再雲端同步）
        },500);
        // ★ 改進 A+C：評審進場時一次性讀取自己考場的歷史分數（不啟動輪詢）
        //   ★ 離線化修正：先還原 localStorage 本機分數，再從 Firebase 補上「本機沒有」的部分
        //                 避免 Firebase 上的舊版本覆蓋掉本機未上傳的新分數
        if(ST.role==='jury'&&ST.juryRoom?.id&&window._FB){
          // ── Step 1: 立即從 localStorage 還原本機分數（不等 Firebase）──
          try{
            const myJurorId=ST.juryId;
            const roomId=ST.juryRoom.id;
            if(myJurorId){
              if(!DB.juryScores[roomId])DB.juryScores[roomId]={};
              let restoredCount=0;
              // ★ Bug 修正：原本用 split('_') 拆解 lsKey 會在 studentId/roomId 含底線時切錯
              //   例如 lsKey='jury_r1730_s1730_5_major_JN_r1730_王小明'，split 會切出 7 段
              //   導致 entryKey 變成 's1730_5'（漏掉 _major），jurorId 變成 'major_JN_r1730_王小明'
              //   修正：用「右側 myJurorId 的位置」反向切割，不依賴 split 段數
              const myJurorIdSuffix='_'+myJurorId;
              for(let i=0;i<localStorage.length;i++){
                const key=localStorage.key(i);
                if(!key||!key.startsWith('jury_'))continue;
                if(!key.endsWith(myJurorIdSuffix))continue;
                try{
                  const data=JSON.parse(localStorage.getItem(key)||'null');
                  if(!data||typeof data!=='object')continue;
                  // 去頭 'jury_' 與去尾 '_{myJurorId}'，剩下是 'roomId_studentId_type'
                  const middle=key.slice(5, key.length-myJurorIdSuffix.length);
                  // 從左找第一個 '_' 切出 roomId（roomId 格式 r{timestamp} 沒底線，安全）
                  const firstUnderscore=middle.indexOf('_');
                  if(firstUnderscore<0)continue;
                  const lsRoomId=middle.slice(0,firstUnderscore);
                  const entryKey=middle.slice(firstUnderscore+1); // 'studentId_type'
                  if(!entryKey)continue;
                  if(lsRoomId!==roomId)continue; // 只還原本考場
                  if(!DB.juryScores[lsRoomId])DB.juryScores[lsRoomId]={};
                  if(!DB.juryScores[lsRoomId][entryKey])DB.juryScores[lsRoomId][entryKey]={};
                  // ★ 永遠以 localStorage 為真相（離線優先架構）
                  DB.juryScores[lsRoomId][entryKey][myJurorId]=data;
                  restoredCount++;
                }catch(e){console.warn('[jury restore] 解析 lsKey 失敗:',key,e);}
              }
              if(restoredCount>0){
                console.log('[jury] 已從 localStorage 還原 '+restoredCount+' 筆本機分數');
                // ★ 不論 pg-jury 是否已 on，都嘗試 render（navFirst 80ms 後可能還沒切過去）
                //   若元素還沒準備好，renderJuryTable 自己會 return（line 5534）
                setTimeout(()=>{
                  try{if(typeof renderJuryTable==='function')renderJuryTable();}catch(e){}
                },150); // 等 navFirst (80ms) 切過去 + tbody DOM 就緒
              }
            }
          }catch(e){console.warn('[jury] 還原本機分數失敗',e);}

          // ── Step 2: 從 Firebase 補上「本機完全沒打過」的歷史分數（不覆蓋本機資料）──
          setTimeout(async()=>{
            try{
              const roomId=ST.juryRoom.id;
              const myJurorId=ST.juryId;
              const myJurorName=ST.juryName;
              if(typeof _fsList==='function'){
                const docs=await _fsList('juryScores/'+roomId+'/entries');
                if(!DB.juryScores[roomId])DB.juryScores[roomId]={};
                let mergedCount=0;
                let ghostMergedCount=0;
                const ghostIdsToDelete=new Set(); // 待刪的幽靈 ID
                docs.forEach(d=>{
                  const{id,...rest}=d;
                  if(!DB.juryScores[roomId][id])DB.juryScores[roomId][id]={};
                  // ★ 對每位評審分別處理
                  Object.keys(rest).forEach(jurorKey=>{
                    if(jurorKey.startsWith('_'))return;
                    if(!rest[jurorKey]||typeof rest[jurorKey]!=='object')return;
                    const remoteData=rest[jurorKey];

                    // ★ Case 1：「自己」的分數 → 本機才是最新，不覆蓋
                    if(jurorKey===myJurorId){
                      if(!DB.juryScores[roomId][id][jurorKey]){
                        DB.juryScores[roomId][id][jurorKey]=remoteData;
                        mergedCount++;
                      }
                      return;
                    }

                    // ★ Case 2：「同名但 ID 不同」→ 幽靈評審，自動合併到自己
                    //   這發生於：同一位評審用不同裝置/不同 session 進入過考場
                    //   合併策略：把 ghost 資料併入自己的 stableId
                    if(myJurorName && remoteData._jurorName === myJurorName){
                      console.log('[ghost merge] 偵測到幽靈評審',jurorKey,'→ 合併到',myJurorId,'(entry:',id,')');
                      // 合併：以「自己現有資料」為主，缺欄位才從 ghost 補
                      const myExisting=DB.juryScores[roomId][id][myJurorId]||{};
                      const merged={...remoteData,...myExisting,_jurorName:myJurorName};
                      DB.juryScores[roomId][id][myJurorId]=merged;
                      // 標記 ghost 為待刪
                      delete DB.juryScores[roomId][id][jurorKey];
                      ghostIdsToDelete.add(id+'|'+jurorKey);
                      ghostMergedCount++;
                      // ★ 把合併後的資料寫回 localStorage 並標記 pending
                      //   （送出時會上傳，順帶把 ghost 從 Firebase 刪除）
                      try{
                        const lsKey=`jury_${roomId}_${id}_${myJurorId}`;
                        merged._localUpdatedAt=Date.now();
                        localStorage.setItem(lsKey,JSON.stringify(merged));
                        markPending(lsKey);
                      }catch(e){}
                      return;
                    }

                    // ★ Case 3：其他評審的分數 → 照常帶進來（顯示用）
                    DB.juryScores[roomId][id][jurorKey]=remoteData;
                  });
                });

                // ★ 把待刪的 ghost ID 從 Firebase 真實刪除（背景執行，不阻塞）
                if(ghostIdsToDelete.size > 0 && navigator.onLine && window._FB){
                  setTimeout(()=>{
                    ghostIdsToDelete.forEach(async key=>{
                      const [entryId,ghostId] = key.split('|');
                      try{
                        // 用 set + null 的方式刪除欄位（REST 模式下沒有 FieldValue.delete）
                        const patch={};
                        patch[ghostId]=null;
                        if(window._FB._rest){
                          await window._FB._set('juryScores/'+roomId+'/entries/'+entryId,patch);
                        }else{
                          const {db,FieldValue,serverTimestamp}=window._FB;
                          const realPatch={};
                          realPatch[ghostId]=FieldValue?.delete?.()??null;
                          realPatch._updatedAt=serverTimestamp?.()??new Date().toISOString();
                          await db.collection('juryScores').doc(roomId).collection('entries').doc(entryId).set(realPatch,{merge:true});
                        }
                        console.log('[ghost merge] 已刪除幽靈評審',ghostId,'(entry:',entryId,')');
                      }catch(e){console.warn('[ghost merge] 刪除失敗',ghostId,e);}
                    });
                  },1500);
                }

                if(document.getElementById('pg-jury')?.classList.contains('on'))renderJuryTable();
                console.log('[jury] Firebase 補讀完成，本機新增',mergedCount,'筆，合併幽靈評審',ghostMergedCount,'筆');
                if(ghostMergedCount>0){
                  showToast(`已自動合併 ${ghostMergedCount} 筆先前的評分紀錄 ✓`,'ok');
                }
              }
            }catch(e){console.warn('[jury] 歷史分數載入失敗',e);}
          },800);
        }
        // ★ 學生快取邏輯已整合進主流程 _loadJuryScores（見上方），此處只保留教師延遲載入評語
        if(ST.role==='teacher'&&window._FB){
          // 教師走完整載入，已在主流程中讀取 juryScores，此處不需要額外動作
          // 但需要在資料就緒後重新渲染相關頁面
          setTimeout(()=>{
            if(typeof renderTeaJuryComments==='function')renderTeaJuryComments();
            if(typeof renderLiveResults==='function')renderLiveResults();
          },300);
        }
        if(ST.role==='student'&&window._FB){
          // 學生主流程已透過 _loadJuryScores 讀取（含快取），此處只觸發頁面渲染
          setTimeout(()=>{
            if(typeof renderScoresPage==='function')renderScoresPage();
            if(typeof renderLiveResults==='function')renderLiveResults();
          },300);
        }
        // ★ 修正 #O2：進入頁面時若已連線且有 pending，主動 sync 一次
        //   ★ 離線化修正：原本 sync 完後會做「localStorage merge 回 DB」的還原邏輯，
        //                 但該邏輯已移到 launchApp 上方（評審進場時立即還原），
        //                 此處只保留 sync 動作（把任何遺留的 pending 補傳）
        setTimeout(()=>{
          if(navigator.onLine&&window._FB&&typeof syncPendingToFirebase==='function'){
            syncPendingToFirebase();
          }
        },2000);
      },200);
    },isLightRole);
  });
}

// ════════════════════════════════════════════════
// NAV
// ════════════════════════════════════════════════
const NAV_MAP = {
  student:[
    {label:'曲目填寫',page:'rep'},
    {label:'評語',page:'scores'},
    {label:'考試順序',page:'stu-schedule'},
    {label:'考試規則與指定曲',page:'exam-rules'},
    {label:'成績總表',page:'live-results'},
  ],
  teacher:[{label:'平時評量',page:'teacher'},{label:'考試順序',page:'tea-schedule'},{label:'考試規則與指定曲',page:'exam-rules'},{label:'成績總表',page:'live-results'},{label:'學生評語',page:'tea-jury-comments'}],
  jury:[{label:'現場評分',page:'jury'}],
  invigilator:[{label:'監考管理',page:'invigilator'}],
  admin:[
    {label:'管理後台',page:'admin'},
    {label:'考試排程',page:'schedule'},
    {label:'術科成績',page:'results'},
    {label:'成績總表',page:'admin-results'},
    {label:'平時評量',page:'teacher'},
    {label:'現場評分',page:'jury'},
    {label:'監考管理',page:'invigilator'},
  ],
};

function buildNav(){
  const nav=document.getElementById('tb-nav');
  nav.innerHTML='';
  let items=(NAV_MAP[ST.role]||[]);
  if(ST.role==='student'){
    items=items.filter(item=>{
      const acc=DB.config.studentAccess;
      return acc[item.page]!==false; // false=完全隱藏；true或'pending'=顯示
    });
  }
  if(ST.role==='teacher'){
    items=items.filter(item=>{
      const acc=DB.config.teacherAccess;
      return acc[item.page]!==false;
    });
  }
  items.forEach((item,i)=>{
    const b=document.createElement('button');
    b.className='nb';b.textContent=item.label;b.dataset.page=item.page;
    b.onclick=()=>{
      nav.querySelectorAll('.nb').forEach(x=>x.classList.remove('on'));b.classList.add('on');
      // ★ 若為 pending，顯示提示頁而非正式頁面（管理員不受此限制，後台一律可見）
      if(ST.role==='admin'){
        showPage(item.page);
        return;
      }
      const accKey=ST.role==='student'?'studentAccess':'teacherAccess';
      const accVal=DB.config[accKey]?.[item.page];
      if(accVal==='pending'){
        showPendingPage(item.page,item.label);
      } else {
        showPage(item.page);
      }
    };
    nav.appendChild(b);
  });
}

function showPendingPage(pageId,label){
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
  // 顯示或建立 pending 佔位頁
  let pp=document.getElementById('pg-pending');
  if(!pp){
    pp=document.createElement('div');pp.id='pg-pending';pp.className='pg';
    document.querySelector('.main').appendChild(pp);
  }
  const msg=(DB.config.pendingMsg?.[pageId])||'此功能尚未開放，請等候管理員公告。';
  pp.innerHTML=`<div class="ph"><h1>${label}</h1><span>Not Yet Available</span></div>
    <div class="card" style="text-align:center;padding:40px 24px">
      <div style="font-size:36px;margin-bottom:14px">🔒</div>
      <div style="font-family:Cormorant Garamond,serif;font-size:22px;font-weight:300;margin-bottom:12px">尚未開放</div>
      <div style="font-size:13px;line-height:1.9;color:var(--muted);max-width:400px;margin:0 auto">${msg}</div>
    </div>`;
  pp.classList.add('on');
}
window.showPendingPage=showPendingPage;

function navFirst(){const f=document.querySelector('.nb');if(f)f.click();}
function showPage(id){
  // ★ #3 教師角色也需要檢查 pending 狀態
  if(ST.role==='teacher'){
    const accVal=DB.config.teacherAccess?.[id];
    if(accVal==='pending'){const label=document.querySelector(`.nb[data-page="${id}"]`)?.textContent||id;showPendingPage(id,label);return;}
    if(accVal===false){return;}
  }
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
  document.getElementById('pg-'+id)?.classList.add('on');
  if(id==='jury'){if(ST.role==='admin')initJuryAdminRoomBar();renderJuryTable();}
  if(id==='tea-schedule')renderTeaSchedulePage();
  if(id==='invigilator')renderInvigPage();
  // ★ 效能優化：切換到排程/成績頁時才 render（避免 renderAll 重複渲染）
  if(id==='schedule')renderSchedule();
  if(id==='results')renderResults();
  if(id==='live-results')renderLiveResults(); // ★ Bug8
  if(id==='admin-results')renderAdminResults(); // ★ 管理員成績總表
  if(id==='tea-jury-comments')renderTeaJuryComments(); // ★ 教師查看學生評語
  // ★ 切換到管理後台時重新診斷連動警告
  if(id==='admin'&&ST.role==='admin')_renderAdminLinkageWarnings();
  // ★ 進入考試規則頁時初始化並渲染
  if(id==='exam-rules')renderExamRulesPage();
}

// ════════════════════════════════════════════════
// DROPDOWNS INIT
// ════════════════════════════════════════════════
function initDropdowns(){
  // Rep instrument selects — 注意選修的 id 是 r-elec-cat 不是 r-elective-cat
  const catIds={major:'r-major-cat', minor:'r-minor-cat', elective:'r-elec-cat'};
  ['major','minor','elective'].forEach(t=>{
    const s=document.getElementById(catIds[t]);if(!s)return;
    while(s.options.length>1)s.remove(1);
    DB.instruments.categories.sort((a,b)=>a.order-b.order).forEach(c=>s.appendChild(new Option(c.name,c.id)));
  });
  // Lookup
  const li=document.getElementById('lookup-inst');
  if(li){li.innerHTML='<option value="">全部樂器</option>';DB.instruments.items.forEach(i=>li.appendChild(new Option(i.name,i.id)));}
  const lr=document.getElementById('lookup-room');
  if(lr){lr.innerHTML='<option value="">全部考場</option>';DB.rooms.forEach(r=>lr.appendChild(new Option(r.name,r.id)));}
  // Teacher class
  const tc=document.getElementById('tea-class');
  if(tc){const _v=tc.value;while(tc.options.length>1)tc.remove(1);DB.classes.forEach(c=>tc.appendChild(new Option(c,c)));tc.value=_v;}
  // Admin class filter
  const acf=document.getElementById('admin-class-filter');
  if(acf){const _v=acf.value;while(acf.options.length>1)acf.remove(1);DB.classes.forEach(c=>acf.appendChild(new Option(c,c)));acf.value=_v;}
  // Admin instrument filter
  const aif=document.getElementById('admin-inst-filter');
  if(aif){const _v=aif.value;aif.innerHTML='<option value="">全部樂器</option>';DB.instruments.items.forEach(i=>aif.appendChild(new Option(i.name,i.id)));aif.value=_v;}
  renderAdminStudents();
  // Room selects (result only; schedule now uses room tab buttons)
  const rs=document.getElementById('result-room');
  if(rs){const _v=rs.value;rs.innerHTML='<option value="">選擇考場</option>';DB.rooms.forEach(r=>rs.appendChild(new Option(r.name,r.id)));rs.value=_v;}
  // ★ Bug8：成績總表考場/班級下拉初始化
  const lrRoom=document.getElementById('lr-room');
  if(lrRoom){const _v=lrRoom.value;lrRoom.innerHTML='<option value="">全部考場</option>';DB.rooms.forEach(r=>lrRoom.appendChild(new Option(r.name,r.id)));lrRoom.value=_v;}
  const lrClass=document.getElementById('lr-class');
  if(lrClass){const _v=lrClass.value;lrClass.innerHTML='<option value="">全部班級</option>';DB.classes.forEach(c=>lrClass.appendChild(new Option(c,c)));lrClass.value=_v;}
  // ★ 管理員成績總表下拉初始化
  const arRoom=document.getElementById('ar-room');
  if(arRoom){const _v=arRoom.value;arRoom.innerHTML='<option value="">全部考場</option>';DB.rooms.forEach(r=>arRoom.appendChild(new Option(r.name,r.id)));arRoom.value=_v;}
  const arClass=document.getElementById('ar-class');
  if(arClass){const _v=arClass.value;arClass.innerHTML='<option value="">全部班級</option>';DB.classes.forEach(c=>arClass.appendChild(new Option(c,c)));arClass.value=_v;}
  // Schedule room tabs
  schInitRoomTabs();
  // Inst cat sel
  const ics=document.getElementById('inst-cat-sel');
  if(ics){ics.innerHTML='<option value="">選擇大項</option>';DB.instruments.categories.forEach(c=>ics.appendChild(new Option(c.name,c.id)));}
  // Jury room/name display
  if(ST.role==='jury'&&ST.juryRoom){
    document.getElementById('jury-room-disp').textContent=ST.juryRoom.name;
    document.getElementById('jury-name-disp').textContent=ST.juryName;
    const locEl=document.getElementById('jury-location-disp');
    if(locEl)locEl.textContent=ST.juryRoom.location?('📍 '+ST.juryRoom.location):'';
    const dtEl=document.getElementById('jury-datetime-disp');
    if(dtEl){
      const r=ST.juryRoom;
      const fmtDt=dt=>{if(!dt)return '';const d=new Date(dt);return isNaN(d)?dt:d.toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});};
      const dtStr=(r.dateStart)?`🗓 ${fmtDt(r.dateStart)}${r.dateEnd?' — '+fmtDt(r.dateEnd):''}` :'';
      dtEl.textContent=dtStr;
    }
  }
}

function filterRepInst(type){
  // ★ 修正：'elective' 在 HTML 中縮寫為 'elec'，需做 id 對照
  const idPrefix=type==='elective'?'r-elec':('r-'+type);
  const catEl=document.getElementById(idPrefix+'-cat');
  const sel=document.getElementById(idPrefix+'-inst');
  if(!catEl||!sel){console.warn('[filterRepInst] 找不到元素 type=',type);return;}
  const catId=catEl.value;
  sel.innerHTML='';sel.appendChild(new Option('— 請選 —',''));
  if(catId){
    let items=DB.instruments.items.filter(i=>i.cat===catId).sort((a,b)=>a.order-b.order);
    items.forEach(i=>sel.appendChild(new Option(i.name,i.id)));
  }
  if(type==='minor')document.getElementById('r-minor-rep').style.display=catId?'block':'none';
  // 清除之前的附加訊息框
  const msgBoxId='inst-restrict-msg-'+type;
  const old=document.getElementById(msgBoxId);if(old)old.remove();

  // ★ 抽出訊息顯示邏輯，供 onchange 和預填後共用
  function showInstMsg(){
    const old2=document.getElementById(msgBoxId);if(old2)old2.remove();
    const instId=sel.value;
    const restrict=DB.config.instRestrict?.[type]||[];
    if(instId&&restrict.includes(instId)){
      const msgData=DB.config.instRestrictMsg?.[type];
      const rawText=msgData?.text||'';
      if(rawText){
        // 解析 [文字](URL) 格式為可點擊連結
        const htmlText=rawText.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
          `<a href="$2" target="_blank" rel="noopener" onclick="window.open('$2','_blank');return false;" style="color:var(--gold);text-decoration:underline;cursor:pointer">$1</a>`);
        const box=document.createElement('div');
        box.id=msgBoxId;
        box.style.cssText='margin-top:10px;background:#fff8e6;border:1px solid var(--gold);border-left:4px solid var(--gold);border-radius:var(--r);padding:12px 14px';
        box.innerHTML=`<div style="font-family:DM Mono,monospace;font-size:8px;letter-spacing:2px;color:var(--gold);margin-bottom:6px">📌 注意事項</div>
          <div style="font-size:13px;line-height:1.9;color:var(--ink)">${htmlText}</div>`;
        sel.parentNode.after(box);
      }
    }
  }

  // 監聽樂器選擇變化，顯示附加訊息
  sel.onchange=function(){
    showInstMsg();
    // ★ 樂器變更時觸發指定曲規則檢查
    aprApply(type);
  };
  // ★ Bug 修正：預填後立即執行一次，處理 .value 設值不觸發 onchange 的情況
  // 用 requestAnimationFrame 確保 setV() 已執行完畢後再讀取 sel.value
  requestAnimationFrame(()=>{showInstMsg();aprApply(type);});
}

// ════════════════════════════════════════════════
// ★ 指定曲自動帶入規則（APR = Assigned Pieces Rules）
// ════════════════════════════════════════════════

// 從學生班級名稱推測年級（取第一個中文數字字元，例：「音一莊」→ 1）
// ★ 取得某筆考試 entry 對應的評分上限（依學生班級年級）
function _scoreCapForEntry(e){
  const grade=aprGradeFromClass(e?.class);
  const caps=DB.config.scoreCaps||{1:85,2:87,3:89};
  return caps[grade]??99;
}
window._scoreCapForEntry=_scoreCapForEntry;

function aprGradeFromClass(cls){
  if(!cls)return '';
  const m=String(cls).match(/[一二三四五六七八九十1-9]/);
  if(!m)return '';
  const map={'一':'1','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9','十':'10'};
  return map[m[0]]||m[0];
}

// 規則匹配
function aprFindMatchingRules(stu,type,instId,catId){
  const rules=DB.config.assignedPiecesRules||[];
  if(!rules.length)return [];
  const stuGrade=aprGradeFromClass(stu?.class);
  return rules.filter(r=>{
    if(r.types&&r.types.length&&!r.types.includes(type))return false;
    if(r.instIds&&r.instIds.length&&!r.instIds.includes(instId))return false;
    if(r.catIds&&r.catIds.length&&!r.catIds.includes(catId))return false;
    if(r.classes&&r.classes.length&&!r.classes.includes(stu?.class))return false;
    if(r.grades&&r.grades.length&&!r.grades.includes(stuGrade))return false;
    if(!r.pieces||!r.pieces.length)return false;
    return true;
  });
}

// 學生端：套用規則並渲染建議區
function aprApply(type){
  const box=document.getElementById('r-'+type+'-apr');
  if(!box)return;
  const stu=ST.user;if(!stu||stu.role!=='student'){box.innerHTML='';return;}
  const catId=document.getElementById('r-'+type+'-cat')?.value||'';
  const instId=document.getElementById('r-'+type+'-inst')?.value||'';
  if(!instId){box.innerHTML='';return;}
  const rules=aprFindMatchingRules(stu,type,instId,catId);
  const allPieces=[];const seen=new Set();
  rules.forEach(r=>{
    (r.pieces||[]).forEach(p=>{
      const key=(p.composer||'')+'|'+(p.title||'');
      if(seen.has(key))return;
      seen.add(key);
      allPieces.push(p);
    });
  });
  if(!allPieces.length){box.innerHTML='';return;}
  const acEl=document.getElementById('r-'+type+'-ac');
  const atEl=document.getElementById('r-'+type+'-at');
  const curAc=acEl?.value||'';
  const curAt=atEl?.value||'';
  const html=`<div class="apr-suggest-card">
    <div class="apr-h">📋 系統偵測到適用此學生的指定曲（請選一首自動帶入）</div>
    ${allPieces.map((p,idx)=>{
      const isOn=(p.composer===curAc&&p.title===curAt);
      return `<label class="${isOn?'on':''}">
        <input type="radio" name="apr-${type}" ${isOn?'checked':''} onchange="aprPick('${type}',${idx})">
        <div class="apr-piece">
          <strong>${(p.title||'').replace(/</g,'&lt;')}</strong>
          ${p.composer?`<em>${p.composer.replace(/</g,'&lt;')}</em>`:''}
        </div>
      </label>`;
    }).join('')}
    <div class="apr-clear" onclick="aprClear('${type}')">✕ 清除帶入（手動填寫）</div>
  </div>`;
  box.innerHTML=html;
  box._pieces=allPieces;
}
window.aprApply=aprApply;

function aprPick(type,idx){
  const box=document.getElementById('r-'+type+'-apr');
  const p=box?._pieces?.[idx];if(!p)return;
  const acEl=document.getElementById('r-'+type+'-ac');
  const atEl=document.getElementById('r-'+type+'-at');
  if(acEl)acEl.value=p.composer||'';
  if(atEl)atEl.value=p.title||'';
  aprApply(type);
}
window.aprPick=aprPick;

function aprClear(type){
  const acEl=document.getElementById('r-'+type+'-ac');
  const atEl=document.getElementById('r-'+type+'-at');
  if(acEl)acEl.value='';
  if(atEl)atEl.value='';
  aprApply(type);
}
window.aprClear=aprClear;

// ────── 後台管理：規則 CRUD ──────
function aprRender(){
  const list=document.getElementById('apr-rules-list');
  if(!list)return;
  const rules=DB.config.assignedPiecesRules||[];
  if(!rules.length){
    list.innerHTML='<div style="color:var(--muted);font-size:12px;font-style:italic;padding:12px">尚未設定任何規則。點下方「＋ 新增規則」開始。</div>';
    return;
  }
  const allGrades=Array.from(new Set(DB.classes.map(c=>aprGradeFromClass(c)).filter(Boolean))).sort();
  list.innerHTML=rules.map((r,idx)=>{
    const cats=DB.instruments.categories||[];
    const items=DB.instruments.items||[];
    const types=[{key:'major',l:'主修'},{key:'minor',l:'副修'},{key:'elective',l:'選修'}];
    const pillsCat=cats.map(c=>{
      const on=(r.catIds||[]).includes(c.id);
      return `<label class="${on?'on':''}"><input type="checkbox" data-rule="${r.id}" data-field="catIds" value="${c.id}" ${on?'checked':''} onchange="aprToggleCond(this)">${c.name}</label>`;
    }).join('');
    const pillsInst=items.map(i=>{
      const on=(r.instIds||[]).includes(i.id);
      const c=cats.find(x=>x.id===i.cat);
      return `<label class="${on?'on':''}"><input type="checkbox" data-rule="${r.id}" data-field="instIds" value="${i.id}" ${on?'checked':''} onchange="aprToggleCond(this)">${c?.name?c.name+'-':''}${i.name}</label>`;
    }).join('');
    const pillsType=types.map(t=>{
      const on=(r.types||[]).includes(t.key);
      return `<label class="${on?'on':''}"><input type="checkbox" data-rule="${r.id}" data-field="types" value="${t.key}" ${on?'checked':''} onchange="aprToggleCond(this)">${t.l}</label>`;
    }).join('');
    const pillsClass=DB.classes.map(cls=>{
      const on=(r.classes||[]).includes(cls);
      return `<label class="${on?'on':''}"><input type="checkbox" data-rule="${r.id}" data-field="classes" value="${cls}" ${on?'checked':''} onchange="aprToggleCond(this)">${cls}</label>`;
    }).join('');
    const pillsGrade=allGrades.map(g=>{
      const on=(r.grades||[]).includes(g);
      return `<label class="${on?'on':''}"><input type="checkbox" data-rule="${r.id}" data-field="grades" value="${g}" ${on?'checked':''} onchange="aprToggleCond(this)">${g}年級</label>`;
    }).join('');
    const piecesHtml=(r.pieces||[]).map((p,pidx)=>`
      <div class="apr-piece-row">
        <input type="text" placeholder="作曲家" value="${(p.composer||'').replace(/"/g,'&quot;')}" style="flex:1" oninput="aprUpdatePiece('${r.id}',${pidx},'composer',this.value)">
        <input type="text" placeholder="曲目名稱" value="${(p.title||'').replace(/"/g,'&quot;')}" style="flex:2" oninput="aprUpdatePiece('${r.id}',${pidx},'title',this.value)">
        <button class="apr-del-piece" onclick="aprDelPiece('${r.id}',${pidx})" title="刪除此曲">✕</button>
      </div>`).join('');
    return `<div class="apr-rule-row" data-rule-id="${r.id}">
      <div class="apr-rule-h">
        <span class="apr-rule-t">規則 #${idx+1}</span>
        <button class="btn btn-s btn-sm" onclick="aprDelRule('${r.id}')">🗑 刪除規則</button>
      </div>
      <div class="apr-cond-grid">
        <div><div class="apr-cond">大項（空=全部）</div><div class="apr-cond-pills">${pillsCat||'<span style="color:var(--muted);font-size:11px">無大項</span>'}</div></div>
        <div><div class="apr-cond">樂器（空=全部）</div><div class="apr-cond-pills" style="max-height:80px;overflow-y:auto">${pillsInst||'<span style="color:var(--muted);font-size:11px">無樂器</span>'}</div></div>
        <div><div class="apr-cond">修別（空=全部）</div><div class="apr-cond-pills">${pillsType}</div></div>
        <div><div class="apr-cond">班級（空=全部）</div><div class="apr-cond-pills">${pillsClass||'<span style="color:var(--muted);font-size:11px">無班級</span>'}</div></div>
        <div><div class="apr-cond">年級（空=全部）</div><div class="apr-cond-pills">${pillsGrade||'<span style="color:var(--muted);font-size:11px">無</span>'}</div></div>
      </div>
      <div class="apr-pieces">
        <div class="apr-cond" style="margin-bottom:5px">指定曲（學生會看到此清單，可選一首帶入）</div>
        ${piecesHtml||'<div style="font-size:11px;color:var(--muted);padding:4px 0">尚無曲目</div>'}
        <button class="btn btn-s btn-sm" onclick="aprAddPiece('${r.id}')" style="margin-top:5px">＋ 新增曲目</button>
      </div>
    </div>`;
  }).join('');
}
window.aprRender=aprRender;

function aprAddRule(){
  if(!DB.config.assignedPiecesRules)DB.config.assignedPiecesRules=[];
  DB.config.assignedPiecesRules.push({
    id:'apr_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
    catIds:[],instIds:[],types:[],classes:[],grades:[],pieces:[{composer:'',title:''}]
  });
  aprRender();
}
window.aprAddRule=aprAddRule;

function aprDelRule(id){
  if(!confirm('確定刪除此規則？'))return;
  DB.config.assignedPiecesRules=(DB.config.assignedPiecesRules||[]).filter(r=>r.id!==id);
  aprRender();
}
window.aprDelRule=aprDelRule;

function aprAddPiece(ruleId){
  const r=(DB.config.assignedPiecesRules||[]).find(x=>x.id===ruleId);if(!r)return;
  if(!r.pieces)r.pieces=[];
  r.pieces.push({composer:'',title:''});
  aprRender();
}
window.aprAddPiece=aprAddPiece;

function aprDelPiece(ruleId,pidx){
  const r=(DB.config.assignedPiecesRules||[]).find(x=>x.id===ruleId);if(!r)return;
  r.pieces.splice(pidx,1);
  aprRender();
}
window.aprDelPiece=aprDelPiece;

function aprUpdatePiece(ruleId,pidx,field,val){
  const r=(DB.config.assignedPiecesRules||[]).find(x=>x.id===ruleId);if(!r)return;
  if(!r.pieces[pidx])r.pieces[pidx]={};
  r.pieces[pidx][field]=val;
}
window.aprUpdatePiece=aprUpdatePiece;

function aprToggleCond(checkbox){
  const ruleId=checkbox.dataset.rule;
  const field=checkbox.dataset.field;
  const val=checkbox.value;
  const r=(DB.config.assignedPiecesRules||[]).find(x=>x.id===ruleId);if(!r)return;
  if(!r[field])r[field]=[];
  if(checkbox.checked){
    if(!r[field].includes(val))r[field].push(val);
  } else {
    r[field]=r[field].filter(x=>x!==val);
  }
  const label=checkbox.closest('label');
  if(label)label.classList.toggle('on',checkbox.checked);
}
window.aprToggleCond=aprToggleCond;

function aprSaveAll(){
  if(window._aprSaving)return;
  window._aprSaving=true;
  setTimeout(()=>{window._aprSaving=false;},2000);
  const rules=(DB.config.assignedPiecesRules||[]).filter(r=>{
    if(!r.pieces||!r.pieces.length)return false;
    const validPieces=r.pieces.filter(p=>(p.composer||'').trim()||(p.title||'').trim());
    if(!validPieces.length)return false;
    r.pieces=validPieces;
    return true;
  });
  DB.config.assignedPiecesRules=rules;
  if(typeof fbSaveConfig==='function'){
    fbSaveConfig();
    showToast(`已儲存 ${rules.length} 條指定曲規則 ✓`,'ok');
  }
  aprRender();
}
window.aprSaveAll=aprSaveAll;

function toggleElective(){
  const on=document.getElementById('r-elec-tog').checked;
  document.getElementById('r-elec-area').style.display=on?'block':'none';
  if(!on){
    ['r-elec-cat','r-elec-inst'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    ['r-elec-ac','r-elec-at','r-elec-fc','r-elec-ft'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    return;
  }
  // ★ Bug2：展開選修時確保大項下拉已有 options（若 initDropdowns 尚未填入）
  const catSel=document.getElementById('r-elec-cat');
  if(catSel&&catSel.options.length<=1){
    DB.instruments.categories.sort((a,b)=>a.order-b.order)
      .forEach(c=>catSel.appendChild(new Option(c.name,c.id)));
  }
  // 若已有大項值，補觸發細項填入
  if(catSel&&catSel.value)filterRepInst('elective');
}

// ════════════════════════════════════════════════
// RENDER ALL
// ════════════════════════════════════════════════
function renderAll(){
  // ★ 初次載入時設定教師 sub-tabs 預設狀態（只在尚未選擇時）
  const tsub=document.getElementById('tea-sub-tabs');
  if(tsub&&!tsub.dataset.initialized){
    const signupDiv=document.getElementById('tea-jury-signup');
    const overviewDiv=document.getElementById('tea-overview');
    if(signupDiv)signupDiv.style.display='none';
    if(overviewDiv)overviewDiv.style.display='block';
    tsub.querySelectorAll('.tab').forEach((t,i)=>{t.classList.toggle('on',i===0);});
    tsub.dataset.initialized='1';
  }
  // ★ 修正 #L3：依角色分流，避免不必要的 DOM 查詢和渲染
  const role=ST.role;
  const pgVisible=id=>!!document.getElementById(id)?.classList.contains('on');

  // 公用：所有角色都需要
  renderBulletin();updateStats();

  if(role==='admin'){
    renderRepPage();renderRepHint();renderTeaTable();
    renderAdminStudents();renderAdminTeachers();renderAdminAdmins();
    renderCatList();renderInstDropdown();renderRooms();renderClassList();renderTiming();
    renderTrimRules();renderRoomFields();renderScoreCapsConfig();renderScaleRules();schInitRoomTabs();schInitSortUI();
    if(pgVisible('pg-schedule'))renderSchedule();
    renderDisqList();
    if(pgVisible('pg-results'))renderResults();
    renderJuryTable();renderAccessControl();renderInstRestrictUI();
    renderTeaSchedulePage();renderInvigPage();
    adminCommentInit();_renderAdminLinkageWarnings();
  }
  else if(role==='teacher'){
    renderTeaTable();renderTeaSchedulePage();
  }
  else if(role==='student'){
    renderRepPage();renderRepHint();renderScoresPage();renderStuSchedule();
  }
  else if(role==='jury'){
    renderJuryTable();
  }
  else if(role==='invigilator'){
    renderInvigPage();
  }
  updateJurySignupTabVisibility();
}

// ════════════════════════════════════════════════
// STUDENT: REPERTOIRE
// ════════════════════════════════════════════════
function renderRepHint(){const e=document.getElementById('rep-hint');if(e)e.textContent=DB.config.repHint;}

function previewRep(){
  const majorInst=document.getElementById('r-major-inst').value;
  if(!majorInst){showToast('請選擇主修樂器','err');return;}
  const majorAC=document.getElementById('r-major-ac').value;
  const majorAT=document.getElementById('r-major-at').value;
  if(!majorAC||!majorAT){showToast('請填寫主修指定曲作曲家及曲目','err');return;}
  const minorInst=document.getElementById('r-minor-inst').value;
  const hasElec=document.getElementById('r-elec-tog').checked;
  const elecInst=hasElec?document.getElementById('r-elec-inst').value:'';
  const sections=[];
  sections.push({header:'主修 · '+iname(majorInst),rows:[
    {lbl:'指定曲',val:(document.getElementById('r-major-ac').value||'—')+' — '+(document.getElementById('r-major-at').value||'—')},
    {lbl:'自選曲',val:(document.getElementById('r-major-fc').value||'—')+' — '+(document.getElementById('r-major-ft').value||'—')},
  ]});
  if(minorInst)sections.push({header:'副修 · '+iname(minorInst),rows:[
    {lbl:'指定曲',val:(document.getElementById('r-minor-ac').value||'—')+' — '+(document.getElementById('r-minor-at').value||'—')},
    {lbl:'自選曲',val:(document.getElementById('r-minor-fc').value||'—')+' — '+(document.getElementById('r-minor-ft').value||'—')},
  ]});
  if(hasElec&&elecInst)sections.push({header:'選修 · '+iname(elecInst),rows:[
    {lbl:'指定曲',val:(document.getElementById('r-elec-ac').value||'—')+' — '+(document.getElementById('r-elec-at').value||'—')},
    {lbl:'自選曲',val:(document.getElementById('r-elec-fc').value||'—')+' — '+(document.getElementById('r-elec-ft').value||'—')},
  ]});
  document.getElementById('rep-preview-body').innerHTML=sections.map(s=>`
    <div style="margin-bottom:14px">
      <div style="background:var(--ink);color:var(--gold);padding:7px 13px;font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:2px;border-radius:var(--r) var(--r) 0 0">${s.header}</div>
      <div style="border:1px solid var(--border);border-top:none;border-radius:0 0 var(--r) var(--r)">
        ${s.rows.map(r=>`<div class="cp-row"><div class="cp-lbl">${r.lbl}</div><div class="cp-val">${r.val}</div></div>`).join('')}
      </div>
    </div>`).join('');
  document.getElementById('rep-form-area').style.display='none';
  document.getElementById('rep-preview').style.display='block';
}

function renderRepDoneInfo(){
  const el=document.getElementById('rep-done-info');if(!el)return;
  const u=ST.user;if(!u){el.innerHTML='';return;}
  // 基本資料列
  const infoRows=[
    {lbl:'姓名',val:u.name},
    {lbl:'班級',val:u.class||'—'},
    {lbl:'座號',val:u.seat||'—'},
  ];
  const infoHtml=`
    <div style="background:var(--cream);border-radius:var(--r);padding:12px 16px;margin-bottom:16px;display:flex;gap:24px;flex-wrap:wrap">
      ${infoRows.map(r=>`
        <div>
          <div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;color:var(--muted);text-transform:uppercase;margin-bottom:3px">${r.lbl}</div>
          <div style="font-size:15px;font-weight:600;color:var(--ink)">${r.val}</div>
        </div>`).join('')}
    </div>`;
  // 各修課區塊
  const sections=[];
  if(u.major){
    sections.push({
      icon:'♩',label:'主修',inst:iname(u.major),
      rows:[
        {lbl:'指定曲',composer:u.major_ac,title:u.major_at},
        {lbl:'自選曲',composer:u.major_fc,title:u.major_ft},
      ]
    });
  }
  if(u.minor){
    sections.push({
      icon:'♪',label:'副修',inst:iname(u.minor),
      rows:[
        {lbl:'指定曲',composer:u.minor_ac,title:u.minor_at},
        {lbl:'自選曲',composer:u.minor_fc,title:u.minor_ft},
      ]
    });
  }
  if(u.elective){
    sections.push({
      icon:'♫',label:'選修加考',inst:iname(u.elective),
      rows:[
        {lbl:'指定曲',composer:u.elec_ac,title:u.elec_at},
        {lbl:'自選曲',composer:u.elec_fc,title:u.elec_ft},
      ]
    });
  }
  const sectHtml=sections.map(s=>`
    <div style="border:1px solid var(--border);border-radius:var(--r);overflow:hidden;margin-bottom:12px">
      <div style="background:var(--ink);color:var(--gold);padding:9px 16px;display:flex;align-items:center;gap:10px">
        <span style="font-family:Cormorant Garamond,serif;font-size:18px">${s.icon}</span>
        <span style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase">${s.label}</span>
        <span style="font-size:13px;font-weight:600;color:var(--paper)">${s.inst}</span>
      </div>
      <div style="background:var(--white)">
        ${s.rows.map(r=>`
          <div style="display:grid;grid-template-columns:72px 1fr;border-bottom:1px solid var(--cream)">
            <div style="padding:10px 14px;font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;color:var(--muted);display:flex;align-items:center;background:var(--cream);text-transform:uppercase">${r.lbl}</div>
            <div style="padding:10px 14px">
              ${r.composer||r.title
                ? `<div style="font-size:12px;color:var(--muted);margin-bottom:2px">${r.composer||'—'}</div>
                   <div style="font-size:14px;color:var(--ink);font-style:italic">${r.title||'—'}</div>`
                : `<span style="font-family:DM Mono,monospace;font-size:11px;color:var(--border)">未填寫</span>`}
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
  el.innerHTML = infoHtml + (sectHtml || '<p style="color:var(--muted);font-size:13px">無填報資料</p>');
}
window.renderRepDoneInfo=renderRepDoneInfo;

function backToRepForm(){document.getElementById('rep-form-area').style.display='block';document.getElementById('rep-preview').style.display='none';}
function editRep(){
  document.getElementById('rep-done-card').style.display='none';
  document.getElementById('rep-form-area').style.display='block';
  // 預填回原本資料
  const u=ST.user;if(!u)return;
  const setV=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||'';};
  // 主修
  if(u.major){
    const inst=DB.instruments.items.find(i=>i.id===u.major);
    if(inst){setV('r-major-cat',inst.cat);filterRepInst('major');}
    setV('r-major-inst',u.major);
    setV('r-major-ac',u.major_ac);setV('r-major-at',u.major_at);
    setV('r-major-fc',u.major_fc);setV('r-major-ft',u.major_ft);
  }
  // 副修
  if(u.minor){
    const inst=DB.instruments.items.find(i=>i.id===u.minor);
    if(inst){setV('r-minor-cat',inst.cat);filterRepInst('minor');}
    setV('r-minor-inst',u.minor);
    setV('r-minor-ac',u.minor_ac);setV('r-minor-at',u.minor_at);
    setV('r-minor-fc',u.minor_fc);setV('r-minor-ft',u.minor_ft);
    document.getElementById('r-minor-rep').style.display='block';
  }
  // 選修
  if(u.elective){
    document.getElementById('r-elec-tog').checked=true;
    document.getElementById('r-elec-area').style.display='block';
    const inst=DB.instruments.items.find(i=>i.id===u.elective);
    if(inst){
      // ★ 確保 r-elec-cat 的 options 已填入
      const catSel=document.getElementById('r-elec-cat');
      if(catSel&&![...catSel.options].some(o=>o.value===inst.cat)){
        DB.instruments.categories.sort((a,b)=>a.order-b.order)
          .forEach(c=>catSel.appendChild(new Option(c.name,c.id)));
      }
      setV('r-elec-cat',inst.cat);
      filterRepInst('elective');
      // 若 options 裡沒有目標樂器，手動補入
      const instSel=document.getElementById('r-elec-inst');
      if(instSel&&![...instSel.options].some(o=>o.value===u.elective)){
        instSel.innerHTML='';
        DB.instruments.items.filter(i=>i.cat===inst.cat).sort((a,b)=>a.order-b.order)
          .forEach(i=>instSel.appendChild(new Option(i.name,i.id)));
      }
    }
    setV('r-elec-inst',u.elective);
    setV('r-elec-ac',u.elec_ac);setV('r-elec-at',u.elec_at);
    setV('r-elec-fc',u.elec_fc);setV('r-elec-ft',u.elec_ft);
    // 延遲確認
    requestAnimationFrame(()=>{
      const instSel2=document.getElementById('r-elec-inst');
      if(instSel2&&u.elective&&instSel2.value!==u.elective){
        const inst2=DB.instruments.items.find(i=>i.id===u.elective);
        if(inst2){const c=document.getElementById('r-elec-cat');if(c)c.value=inst2.cat;filterRepInst('elective');instSel2.value=u.elective;}
      }
    });
  }
}
function submitRep(){
  // ★ 修正 #E2：防重複送出
  if(window._submittingRep)return;
  window._submittingRep=true;
  setTimeout(()=>{window._submittingRep=false;},2000);
  const u=ST.user;if(!u)return;
  const majorInst=document.getElementById('r-major-inst').value;
  if(!majorInst){showToast('請選擇主修樂器','err');window._submittingRep=false;return;}
  // ★ 修正 #E4：長度檢查（避免單一文件超過 1MB 上限）
  const tooLong=(s)=>s&&typeof s==='string'&&s.length>500;
  const checkFields=['r-major-ac','r-major-at','r-major-fc','r-major-ft','r-minor-ac','r-minor-at','r-minor-fc','r-minor-ft','r-elec-ac','r-elec-at','r-elec-fc','r-elec-ft'];
  for(const id of checkFields){
    const el=document.getElementById(id);
    if(el&&tooLong(el.value)){
      showToast('某欄位文字過長（請控制在 500 字以內）','err');
      window._submittingRep=false;return;
    }
  }
  // Save ALL rep fields in one atomic write
  u.major=majorInst;
  u.major_ac=document.getElementById('r-major-ac').value;
  u.major_at=document.getElementById('r-major-at').value;
  u.major_fc=document.getElementById('r-major-fc').value;
  u.major_ft=document.getElementById('r-major-ft').value;
  const minorInst=document.getElementById('r-minor-inst').value;
  u.minor=minorInst||null;
  u.minor_ac=minorInst?document.getElementById('r-minor-ac').value:'';
  u.minor_at=minorInst?document.getElementById('r-minor-at').value:'';
  u.minor_fc=minorInst?document.getElementById('r-minor-fc').value:'';
  u.minor_ft=minorInst?document.getElementById('r-minor-ft').value:'';
  const hasElec=document.getElementById('r-elec-tog').checked;
  const elecInst=hasElec?document.getElementById('r-elec-inst').value:'';
  u.elective=elecInst||null;
  u.elec_ac=elecInst?document.getElementById('r-elec-ac').value:'';
  u.elec_ac=elecInst?document.getElementById('r-elec-ac').value:'';
  u.elec_at=elecInst?document.getElementById('r-elec-at').value:'';
  u.elec_fc=elecInst?document.getElementById('r-elec-fc').value:'';
  u.elec_ft=elecInst?document.getElementById('r-elec-ft').value:'';
  // ★ 需求1：偵測學生填報的樂器是否與管理員原設定不同，若有差異則寫入通知供管理員查看
  (function _checkInstChange(){
    // 從 DB 取得「送出前」的原始值（submit 前 u 已被覆蓋，需從 DB.users 取快照）
    const orig=DB.users.find(x=>x.id===u.id)||{};
    const diffs=[];
    const instLabel=(id)=>DB.instruments.items.find(i=>i.id===id)?.name||id||'（無）';
    const typeCN={major:'主修',minor:'副修',elective:'選修'};
    ['major','minor','elective'].forEach(t=>{
      // 原始值（submit 之前，在 _autoFillRepInstruments 帶入的）
      // 管理員設定的參考值儲存在 u._adminMajor 等，若無則 fallback 到 orig 值
      const adminVal=orig['_admin_'+t]||orig[t]||null;
      const newVal=u[t]||null;
      if(adminVal&&newVal&&adminVal!==newVal){
        diffs.push({type:t,label:typeCN[t],from:instLabel(adminVal),to:instLabel(newVal)});
      }
    });
    if(!diffs.length)return;
    // 寫入 repInstChanges collection，管理員後台可查看
    const notice={
      studentId:u.id,studentName:u.name,class:u.class,seat:u.seat,
      changes:diffs,
      at:new Date().toISOString(),
      read:false,
    };
    fbSet('repInstChanges',u.id+'_'+Date.now(),notice);
    // 在 DB 記憶體也記錄，讓後台即時顯示
    if(!DB.repInstChanges)DB.repInstChanges={};
    DB.repInstChanges[u.id]=notice;
    console.log('[需求1] 學生樂器與管理員設定不符，已通知：',diffs);
  })();
  u.repDone=true;
  // ★ Write the COMPLETE user object to avoid partial-write data loss
  fbSet('users',u.id,u);
  // ★ Bug1 修正：曲目提交後同步更新已存檔排程快照，讓考試排程及現場評分立即看到最新曲目
  (function _syncRepToSnapshot(uid,pieces){
    const snap=DB.savedScheduleSnapshot||{};
    const dirtyRooms=new Set();
    Object.entries(snap).forEach(([roomId,entries])=>{
      if(!entries||!entries.length)return;
      entries.forEach(e=>{
        if(e.studentId!==uid)return;
        const p=pieces[e.type];if(!p)return;
        e.ac=p.ac||'';e.at=p.at||'';e.fc=p.fc||'';e.ft=p.ft||'';
        dirtyRooms.add(roomId);
      });
    });
    dirtyRooms.forEach(roomId=>{
      fbSet('scheduleSnapshots',roomId,{entries:snap[roomId],_savedAt:new Date().toISOString()});
    });
    if(dirtyRooms.size>0)console.log('[Bug1] 已同步曲目至快照考場：',Array.from(dirtyRooms).join(','));
  })(u.id,{
    major:   {ac:u.major_ac, at:u.major_at, fc:u.major_fc, ft:u.major_ft},
    minor:   {ac:u.minor_ac, at:u.minor_at, fc:u.minor_fc, ft:u.minor_ft},
    elective:{ac:u.elec_ac,  at:u.elec_at,  fc:u.elec_fc,  ft:u.elec_ft},
  });
  document.getElementById('rep-form-area').style.display='none';
  document.getElementById('rep-preview').style.display='none';
  document.getElementById('rep-done-card').style.display='block';
  renderRepDoneInfo();
  // ★ 顯示管理員設定的填報確認訊息
  const msg=DB.config.repConfirmMsg||'';
  const msgEl=document.getElementById('rep-confirm-msg');
  if(msgEl){msgEl.style.display=msg?'block':'none';msgEl.querySelector('.rep-confirm-text').textContent=msg;}
  renderAdminStudents();updateStats();
  showToast('曲目填報已送出 ✓','ok');
}


// ════════════════════════════════════════════════
// STUDENT: SCORES
// ════════════════════════════════════════════════
function renderRepPage(){
  if(!ST.user||ST.user.role!=='student')return;
  // ★ 確保 ST.user 是最新的 DB.users 物件（防止背景更新後引用失效）
  const _fresh=DB.users.find(u=>u.id===ST.user.id);if(_fresh)ST.user=_fresh;
  if(ST.user.repDone){
    document.getElementById('rep-done-card').style.display='block';
    document.getElementById('rep-form-area').style.display='none';
    document.getElementById('rep-preview').style.display='none';
    renderRepDoneInfo();
    const msg=DB.config.repConfirmMsg||'';
    const msgEl=document.getElementById('rep-confirm-msg');
    if(msgEl){msgEl.style.display=msg?'block':'none';if(msg)msgEl.querySelector('.rep-confirm-text').textContent=msg;}
  } else {
    document.getElementById('rep-done-card').style.display='none';
    document.getElementById('rep-form-area').style.display='block';
    // ★ 後台已設定樂器 → 自動帶入並鎖定，讓學生只需填曲目
    _autoFillRepInstruments();
  }
}

window._autoFillRepInstruments=_autoFillRepInstruments;
function _autoFillRepInstruments(){
  const u=ST.user;if(!u)return;
  const setV=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||'';};
  // ★ 不再鎖定樂器選單：學生可自行修改（若管理員設定有誤）
  // 顯示提示說明已有預設值
  const hasAdminSet=u.major||u.minor||u.elective;
  if(hasAdminSet){
    let hint=document.getElementById('rep-admin-set-hint');
    if(!hint){
      hint=document.createElement('div');hint.id='rep-admin-set-hint';
      hint.style.cssText='margin-bottom:10px;padding:8px 12px;background:#e8f4fd;border-left:3px solid var(--steel);border-radius:var(--r);font-family:DM Mono,monospace;font-size:10px;color:var(--steel)';
      hint.textContent='ℹ 管理員已為您預設樂器，如有錯誤可自行修改。';
      const formArea=document.getElementById('rep-form-area');
      if(formArea)formArea.insertBefore(hint,formArea.firstChild);
    }
  }
  // 主修：帶入但不鎖定
  if(u.major){
    const inst=DB.instruments.items.find(i=>i.id===u.major);
    if(inst){setV('r-major-cat',inst.cat);filterRepInst('major');}
    setV('r-major-inst',u.major);
    if(u.major_ac)setV('r-major-ac',u.major_ac);
    if(u.major_at)setV('r-major-at',u.major_at);
    if(u.major_fc)setV('r-major-fc',u.major_fc);
    if(u.major_ft)setV('r-major-ft',u.major_ft);
  }
  // 副修：帶入但不鎖定
  if(u.minor){
    const inst=DB.instruments.items.find(i=>i.id===u.minor);
    if(inst){setV('r-minor-cat',inst.cat);filterRepInst('minor');}
    setV('r-minor-inst',u.minor);
    document.getElementById('r-minor-rep').style.display='block';
    if(u.minor_ac)setV('r-minor-ac',u.minor_ac);
    if(u.minor_at)setV('r-minor-at',u.minor_at);
    if(u.minor_fc)setV('r-minor-fc',u.minor_fc);
    if(u.minor_ft)setV('r-minor-ft',u.minor_ft);
  }
  // 選修：帶入但不鎖定
  if(u.elective){
    const tog=document.getElementById('r-elec-tog');
    if(tog)tog.checked=true;
    document.getElementById('r-elec-area').style.display='block';
    const inst=DB.instruments.items.find(i=>i.id===u.elective);
    if(inst){
      // ★ 確保 r-elec-cat 選單已有此大項的 option（防止 initDropdowns 還沒跑完）
      const catSel=document.getElementById('r-elec-cat');
      if(catSel&&![...catSel.options].some(o=>o.value===inst.cat)){
        DB.instruments.categories.sort((a,b)=>a.order-b.order)
          .forEach(c=>catSel.appendChild(new Option(c.name,c.id)));
      }
      setV('r-elec-cat',inst.cat);
      filterRepInst('elective');
      // ★ 若 filterRepInst 後 r-elec-inst 還沒有目標樂器的 option，手動補入
      const instSel=document.getElementById('r-elec-inst');
      if(instSel&&![...instSel.options].some(o=>o.value===u.elective)){
        instSel.innerHTML='';
        DB.instruments.items.filter(i=>i.cat===inst.cat).sort((a,b)=>a.order-b.order)
          .forEach(i=>instSel.appendChild(new Option(i.name,i.id)));
      }
    }
    setV('r-elec-inst',u.elective);
    if(u.elec_ac)setV('r-elec-ac',u.elec_ac);
    if(u.elec_at)setV('r-elec-at',u.elec_at);
    if(u.elec_fc)setV('r-elec-fc',u.elec_fc);
    if(u.elec_ft)setV('r-elec-ft',u.elec_ft);
    // ★ 延遲再確認一次（應對 DOM 渲染時序問題）
    requestAnimationFrame(()=>{
      const instSel2=document.getElementById('r-elec-inst');
      if(instSel2&&u.elective&&instSel2.value!==u.elective){
        if(inst){
          const catSel2=document.getElementById('r-elec-cat');
          if(catSel2)catSel2.value=inst.cat;
          filterRepInst('elective');
          instSel2.value=u.elective;
        }
      }
    });
  }
  // ★ 載入完成後觸發指定曲規則建議
  setTimeout(()=>{
    if(u.major)aprApply('major');
    if(u.minor)aprApply('minor');
    if(u.elective)aprApply('elective');
  },50);
}
window.renderRepPage=renderRepPage;

function renderScoresPage(){
  const el=document.getElementById('scores-body');if(!el)return;
  const u=ST.user;if(!u||u.role!=='student'){el.innerHTML='';return;}
  const types=[];
  if(u.major)types.push({type:'major',inst:u.major,ac:u.major_ac,at:u.major_at,fc:u.major_fc,ft:u.major_ft});
  if(u.minor)types.push({type:'minor',inst:u.minor,ac:u.minor_ac,at:u.minor_at,fc:u.minor_fc,ft:u.minor_ft});
  if(u.elective)types.push({type:'elective',inst:u.elective,ac:u.elec_ac,at:u.elec_at,fc:u.elec_fc,ft:u.elec_ft});

  // ★ Bug1：types 為空時（管理員尚未設定樂器 or 成績未開放）顯示友善說明
  if(!types.length){
    // 確認存取控制狀態
    const access=DB.config.studentAccess?.scores;
    if(access===false){
      el.innerHTML=`<div class="card" style="text-align:center;padding:36px">
        <div style="font-size:36px;margin-bottom:12px">🔒</div>
        <div style="font-family:'DM Mono',monospace;font-size:12px;color:var(--muted)">此功能尚未開放</div>
      </div>`;
    } else {
      el.innerHTML=`<div class="card" style="text-align:center;padding:36px">
        <div style="font-size:36px;margin-bottom:12px">📭</div>
        <div style="font-size:15px;color:var(--ink);margin-bottom:8px">尚無評語資料</div>
        <div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);line-height:1.9">
          可能原因：<br>
          ① 管理員尚未設定您的樂器別<br>
          ② 評審尚未完成評分<br>
          ③ 成績尚未開放查閱
        </div>
      </div>`;
    }
    return;
  }

  el.innerHTML=types.map(t=>{
    const entryKey=u.id+'_'+t.type;
    const tCatId=DB.instruments.items.find(i=>i.id===t.inst)?.cat;
    const roomId=_findScoredRoomForEntry(u.id, t.type, tCatId);
    const jurorData=DB.juryScores[roomId]?.[entryKey]||{};
    const scoreArr=_safeJurors(jurorData).filter(s=>!s.absent);
    // ★ 修正：傳入 entry 資訊，讓 calcFinal 能正確處理 * 不計分欄位的權重重分配
    const _entryForCalc={studentId:u.id,type:t.type,catId:tCatId,instId:t.inst,class:u.class};
    const result=scoreArr.length?calcFinal(scoreArr,roomId,_entryForCalc):{finalScore:null,fS:null,fA:null,fF:null,fieldAvgs:{}};
    // ★ 修正：套用違規扣分（與後台/成績單一致）。學生頁先前漏算，導致該扣分的沒扣、原因也沒顯示。
    const ded=DB.deductions[entryKey]||{amount:0,reason:''};
    const fsRaw=result.finalScore;
    const fs=fsRaw!==null?Math.max(0,fsRaw-(ded.amount||0)):null;
    const hasDed=(ded.amount||0)>0;
    // ★ 動態欄位：只顯示「該生實際有考」的評分項目（過濾掉管理員設定不計分、或全體評審打 * 的欄）
    const _allFields=getRoomFields(roomId);
    const _shownFields=_allFields.filter(f=>{
      if(isFieldSkipped(f,_entryForCalc))return false;          // 管理員設定此生此欄不計分
      if(scoreArr.length&&scoreArr.every(s=>s[f.id]==='*'||s[f.id+'_skip']===true))return false; // 全體評審皆打 *
      return true;
    });
    // ★ H1：成績未發佈時隱藏分數區，只顯示評語
    const resultsPublished=!!DB.config.resultsPublished;

    // ① 老師平時評語（不顯示分數）
    const tc=DB.teacherComments[u.id]?.[t.type];
    const teacherComment=tc?.comment||'';

    // ② 現場評審期末評語（只顯示自己的，依評審順序）
    const _getSortedJurorIds=(rId,jData)=>{
      const allIds=new Set();
      Object.values(DB.juryScores[rId]||{}).forEach(ed=>{Object.keys(ed||{}).forEach(k=>{if(!k.startsWith('_'))allIds.add(k);});});
      const globalOrder=[...allIds].sort();
      const localIds=Object.keys(jData);
      const sorted=globalOrder.filter(id=>localIds.includes(id));
      localIds.forEach(id=>{if(!sorted.includes(id))sorted.push(id);});
      return sorted;
    };
    const sortedJurorIds=_getSortedJurorIds(roomId,jurorData);
    const juryComments=sortedJurorIds
      .map((jid,ji)=>({idx:ji+1,comment:(jurorData[jid]?.comment||''),absent:jurorData[jid]?.absent}))
      .filter(j=>!j.absent&&j.comment);

    return `<div class="isb">
      <div class="isb-h">
        <div>
          <span style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:2px;color:rgba(181,137,42,.7)">${escHtml(typeName(t.type))} · </span>
          <span class="isb-h-name">${escHtml(iname(t.inst))}</span>
        </div>
        ${resultsPublished
          ? `<div class="isb-h-score ${fs!==null&&fs<60?'red-score':''}">${fs!==null?fs.toFixed(2):'—'}</div>`
          : `<div style="font-family:'DM Mono',monospace;font-size:9px;color:rgba(181,137,42,.6);letter-spacing:1px">成績待發佈</div>`}
      </div>
      <div class="isb-b">
        ${resultsPublished&&hasDed?`<div style="color:var(--rust);font-size:13px;margin-bottom:12px;font-weight:500">⚠ 違規扣分 -${ded.amount}${ded.reason?`　原因：${escHtml(ded.reason)}`:''}</div>`:''}
        ${resultsPublished?`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:14px">
          ${_shownFields.map(f=>{
            const avg=result.fieldAvgs?.[f.id]??null;
            // 內建欄位附帶曲目資訊（指定曲：ac—at；自選曲：fc—ft），自訂欄位則不顯示曲目
            let songInfo='';
            if(f.id==='assigned')songInfo=`${escHtml(t.ac||'')} — ${escHtml(t.at||'')}`;
            else if(f.id==='free')songInfo=`${escHtml(t.fc||'')} — ${escHtml(t.ft||'')}`;
            return `<div>
              <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);letter-spacing:2px;margin-bottom:4px">${escHtml(f.label)}</div>
              <div style="font-family:Cormorant Garamond,serif;font-size:28px;color:var(--ink)" class="${avg!==null&&avg<60?'red-score':''}">${avg!==null?avg.toFixed(1):'—'}</div>
              ${songInfo.trim()!=='—'&&songInfo?`<div style="font-size:11px;color:var(--muted);margin-top:3px">${songInfo}</div>`:''}
            </div>`;
          }).join('')}
        </div>`:''}

        <!-- ① 老師的平時評語（不顯示分數） -->
        <div style="background:var(--cream);border-left:3px solid var(--steel);border-radius:0 var(--r) var(--r) 0;padding:10px 14px;margin-bottom:10px">
          <div style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:2px;color:var(--steel);margin-bottom:5px">評語 ① 指導老師平時評語</div>
          <div style="font-size:13px;line-height:1.9;color:var(--ink);white-space:pre-wrap">${escHtml(teacherComment)||'（老師尚未填寫評語）'}</div>
        </div>

        <!-- ② 現場評審期末評語（只顯示自己） -->
        <div style="background:#f0f4ff;border-left:3px solid var(--blue);border-radius:0 var(--r) var(--r) 0;padding:10px 14px">
          <div style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:2px;color:var(--blue);margin-bottom:5px">評語 ② 現場評審期末評語</div>
          ${juryComments.length
            ? juryComments.map(j=>`
                <div style="margin-bottom:${j===juryComments[juryComments.length-1]?'0':'8px'}">
                  <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-right:6px">評審 ${j.idx}</span>
                  <span style="font-size:13px;line-height:1.9;color:var(--ink);white-space:pre-wrap">${escHtml(j.comment)}</span>
                </div>`).join('')
            : '<div style="font-size:12px;color:var(--muted)">（尚無評審評語）</div>'
          }
        </div>
      </div>
    </div>`;
  }).join('')||'<p style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:12px">尚無成績資料</p>';
}

// ════════════════════════════════════════════════
// STUDENT: SCHEDULE LOOKUP
// ════════════════════════════════════════════════
function _findRoomForCat(catId){
  // 先用 allowedCats，再 fallback 到 cats，最後 fallback 第一個考場
  return DB.rooms.find(r=>(r.allowedCats||[]).includes(catId))
      || DB.rooms.find(r=>(r.cats||[]).includes(catId))
      || DB.rooms[0]
      || null;
}
window._findRoomForCat=_findRoomForCat;

// ★ 修正：找出某學生某修別「實際被排入並有評分」的考場 id。
//   舊作法只用 _findRoomForCat（依樂器大項反查），當學生實際被排到非預設考場
//   （例如同一大項分多考場、手動排場、聲樂流行等跨類考場）時會抓錯考場，
//   導致成績單／我的成績「分數與評語整段帶不進來」。
//   ★ 再修正：原本優先用「排程快照」找考場，但快照只代表「排在哪」，不代表
//     「分數/評語存在哪」。若現場臨時換考場、或副修集中到另一考場評分，
//     快照考場可能沒有評語 → 出現「分數有、評語沒帶入」。
//   新優先順序：
//     ① DB.juryScores 中『同時存有評語(comment)』的考場（最可靠）
//     ② DB.juryScores 中存有任一評分資料的考場
//     ③ 排程快照中記錄此 studentId_type 的考場
//     ④ fallback：_findRoomForCat（樂器大項預設考場）
function _findScoredRoomForEntry(studentId, type, catId){
  const ek=studentId+'_'+type;
  const js=DB.juryScores||{};
  // ① 有「評語」的考場最優先
  for(const rId of Object.keys(js)){
    const ed=js[rId]?.[ek];
    if(ed&&Object.keys(ed).some(k=>!k.startsWith('_')&&ed[k]&&typeof ed[k]==='object'&&ed[k].comment))
      return rId;
  }
  // ② 有任一評分資料（含分數或缺考）的考場
  for(const rId of Object.keys(js)){
    const ed=js[rId]?.[ek];
    if(ed&&Object.keys(ed).some(k=>!k.startsWith('_')))
      return rId;
  }
  // ③ 排程快照
  const snap=DB.savedScheduleSnapshot||{};
  for(const rId of Object.keys(snap)){
    const arr=snap[rId]||[];
    if(arr.some(e=>e&&(e.entryKey===ek||(e.studentId===studentId&&e.type===type))))
      return rId;
  }
  // ④ fallback：樂器大項預設考場
  return _findRoomForCat(catId)?.id||'';
}
window._findScoredRoomForEntry=_findScoredRoomForEntry;
function getScheduleEntries(){
  // ★ 每個學生每個修別都放入「全部考場清單」，roomId 固定為當前排程選擇的考場。
  // 考場歸屬完全由排程篩選決定，不依賴 allowedCats。
  const entries=[];
  students().forEach(s=>{
    const types=[];
    if(s.major)types.push({type:'major',instId:s.major,ac:s.major_ac,at:s.major_at,fc:s.major_fc,ft:s.major_ft});
    if(s.minor)types.push({type:'minor',instId:s.minor,ac:s.minor_ac,at:s.minor_at,fc:s.minor_fc,ft:s.minor_ft});
    if(s.elective)types.push({type:'elective',instId:s.elective,ac:s.elec_ac,at:s.elec_at,fc:s.elec_fc,ft:s.elec_ft});
    types.forEach(t=>{
      const inst=DB.instruments.items.find(i=>i.id===t.instId);
      const cat=inst?DB.instruments.categories.find(c=>c.id===inst.cat):null;
      // 每個修別產生一筆 entry，roomId 由排程篩選時的 SCH_STATE.roomId 決定
      // 此處 roomId 預設空字串，renderSchedule 過濾時再比對
      entries.push({
        studentId:s.id,name:s.name,class:s.class,seat:s.seat,
        instId:t.instId,instName:iname(t.instId),catId:inst?.cat,catOrder:cat?.order??99,
        type:t.type,typeOrder:{major:0,minor:1,elective:2}[t.type],
        ac:t.ac||'',at:t.at||'',fc:t.fc||'',ft:t.ft||'',
        roomId:SCH_STATE?.roomId||'',
        roomName:SCH_STATE?.roomId?(DB.rooms.find(r=>r.id===SCH_STATE.roomId)?.name||'—'):'全部考場',
        roomLocation:SCH_STATE?.roomId?(DB.rooms.find(r=>r.id===SCH_STATE.roomId)?.location||''):'',
        order:0,
      });
    });
  });
  entries.sort((a,b)=>a.catOrder-b.catOrder||a.typeOrder-b.typeOrder||DB.classes.indexOf(a.class)-DB.classes.indexOf(b.class)||a.seat-b.seat);
  let cnt=0;
  entries.forEach(e=>{e.order=++cnt;});
  return entries;
}

// ─── 學生考試順序：初始化考場按鈕 ───
function renderStuSchedule(){
  // 建立考場按鈕（與教師介面相同）
  const btnContainer=document.getElementById('stu-schedule-room-btns');
  if(btnContainer){
    const snap=DB.savedScheduleSnapshot||{};
    const hasSnap=Object.values(snap).some(arr=>arr&&arr.length>0);
    const activeRooms=hasSnap
      ? DB.rooms.filter(r=>(snap[r.id]||[]).length>0)
      : DB.rooms;
    btnContainer.innerHTML=
      '<button class="btn btn-p btn-sm" onclick="stuSchSelectRoom(\'\',this)">全部考場</button>'+
      activeRooms.map(r=>`<button class="btn btn-s btn-sm" onclick="stuSchSelectRoom('${r.id}',this)">${r.name}</button>`).join('');
  }
  stuSchSelectRoom('',null);
}

let _stuSchActiveRoom='';
function stuSchSelectRoom(roomId,btn){
  _stuSchActiveRoom=roomId;
  // 高亮按鈕
  const bc=document.getElementById('stu-schedule-room-btns');
  if(bc){bc.querySelectorAll('button').forEach(b=>{b.className='btn btn-s btn-sm';});if(btn)btn.className='btn btn-p btn-sm';else{const f=bc.querySelector('button');if(f)f.className='btn btn-p btn-sm';}}

  // 顯示考場時間資訊
  const infoDiv=document.getElementById('stu-schedule-room-info');
  const infoText=document.getElementById('stu-schedule-room-info-text');
  if(infoDiv&&infoText){
    if(roomId){
      const room=DB.rooms.find(r=>r.id===roomId);
      if(room){
        const dt=_fmtRoomDatetime(room);
        const loc=room.location?'📍 '+room.location:'';
        const lines=[dt,loc].filter(Boolean);
        if(lines.length){
          infoText.innerHTML='<strong>'+escHtml(room.name)+'</strong>　'+lines.map(l=>escHtml(l)).join('　');
          infoDiv.style.display='block';
        } else {infoDiv.style.display='none';}
      } else {infoDiv.style.display='none';}
    } else {
      // 全部考場：列出所有有時間的考場
      const snap=DB.savedScheduleSnapshot||{};
      const hasSnap=Object.values(snap).some(arr=>arr&&arr.length>0);
      const activeRooms=hasSnap?DB.rooms.filter(r=>(snap[r.id]||[]).length>0):DB.rooms;
      const lines=activeRooms.map(r=>{
        const dt=_fmtRoomDatetime(r);
        return dt?('<strong>'+escHtml(r.name)+'</strong>　'+escHtml(dt)+(r.location?'　📍 '+escHtml(r.location):'')):'';
      }).filter(Boolean);
      if(lines.length){infoText.innerHTML=lines.join('<br>');infoDiv.style.display='block';}
      else{infoDiv.style.display='none';}
    }
  }

  // 渲染名單（邏輯同教師介面 teaSchSelectRoom，並過濾 removedEntries）
  const tbody=document.getElementById('stu-sched-tbody');if(!tbody)return;
  const nameQ=(document.getElementById('lookup-name')?.value||'').toLowerCase();
  const instQ=(document.getElementById('lookup-inst')?.value||'');

  const snap=DB.savedScheduleSnapshot||{};
  const hasSnap=Object.values(snap).some(arr=>arr&&arr.length>0);
  let entries=[];

  const _getRemovedForRoom=(rid)=>{
    const st=(_SCH_ROOM_STATES&&_SCH_ROOM_STATES[rid])||{};
    const raw=st.removedEntries;
    return raw instanceof Set?raw:new Set(Array.isArray(raw)?raw:[]);
  };

  if(hasSnap){
    if(roomId){
      const removed=_getRemovedForRoom(roomId);
      entries=(snap[roomId]||[])
        .filter(e=>!removed.has(e.studentId+'_'+e.type))
        .slice().sort((a,b)=>(a.order||0)-(b.order||0));
      const room=DB.rooms.find(r=>r.id===roomId);
      entries.forEach((e,i)=>{e._roomName=e.roomName||room?.name||roomId;e._roomLoc=e.roomLocation||room?.location||'';e._displayOrder=e.order||i+1;});
    } else {
      DB.rooms.forEach(r=>{
        const removed=_getRemovedForRoom(r.id);
        (snap[r.id]||[]).filter(e=>!removed.has(e.studentId+'_'+e.type))
          .slice().sort((a,b)=>(a.order||0)-(b.order||0))
          .forEach(e=>{entries.push({...e,_roomName:e.roomName||r.name,_roomLoc:e.roomLocation||r.location||'',_displayOrder:e.order||0});});
      });
    }
  } else {
    entries=getScheduleEntries();
    if(roomId)entries=entries.filter(e=>e.roomId===roomId);
    entries.forEach(e=>{e._roomName=e.roomName;e._roomLoc=e.roomLocation||'';e._displayOrder=e.order||0;});
  }

  const shown=entries.filter(e=>(!nameQ||e.name.toLowerCase().includes(nameQ))&&(!instQ||e.instId===instQ));
  tbody.innerHTML=shown.map(e=>{
    const {ac,at,fc,ft}=_getEntryRep(e);
    return `<tr>
    <td style="font-family:'DM Mono',monospace;color:var(--ink);font-weight:600">${e._displayOrder}</td>
    <td style="color:var(--ink)">${escHtml(e._roomName)}</td>
    <td style="color:var(--ink);font-family:'DM Mono',monospace;font-size:11px">${escHtml(e._roomLoc||'—')}</td>
    <td style="color:var(--ink)">${escHtml(e.class)}</td>
    <td style="color:var(--ink);font-weight:600">${escHtml(e.name)}${_dqBadgeHtml(e.studentId,e.type)}</td>
    <td style="color:var(--ink)">${escHtml(e.instName)}</td>
    <td>${typeBadge(e.type)}</td>
    <td style="font-size:12px;color:var(--ink)">${ac?escHtml(ac)+' — <em>'+escHtml(at)+'</em>':'—'}</td>
    <td style="font-size:12px;color:var(--ink)">${fc?escHtml(fc)+' — <em>'+escHtml(ft)+'</em>':'—'}</td>
  </tr>`;}).join('')||'<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:20px;font-family:\'DM Mono\',monospace;font-size:12px">查無資料（請確認管理員已存檔排程）</td></tr>';
}
window.stuSchSelectRoom=stuSchSelectRoom;

// ★ 即時姓名搜尋
function onStuNameInput(){
  const nameQ=(document.getElementById('lookup-name')?.value||'').trim();
  const infoBar=document.getElementById('stu-name-search-info');
  const roomBtns=document.getElementById('stu-schedule-room-btns');
  const roomInfo=document.getElementById('stu-schedule-room-info');
  const roomCard=roomBtns?.closest('.card');

  if(nameQ){
    // 有姓名：跨所有考場搜尋，隱藏考場按鈕區
    if(roomCard)roomCard.style.display='none';
    if(roomInfo)roomInfo.style.display='none';

    // 取全部快照資料
    const snap=DB.savedScheduleSnapshot||{};
    const hasSnap=Object.values(snap).some(arr=>arr&&arr.length>0);
    let allEntries=[];
    const _getRemovedForRoom=(rid)=>{const st=(_SCH_ROOM_STATES&&_SCH_ROOM_STATES[rid])||{};const raw=st.removedEntries;return raw instanceof Set?raw:new Set(Array.isArray(raw)?raw:[]);};

    if(hasSnap){
      DB.rooms.forEach(r=>{
        const removed=_getRemovedForRoom(r.id);
        (snap[r.id]||[]).filter(e=>!removed.has(e.studentId+'_'+e.type))
          .slice().sort((a,b)=>(a.order||0)-(b.order||0))
          .forEach(e=>allEntries.push({...e,_roomName:e.roomName||r.name,_roomLoc:e.roomLocation||r.location||'',_displayOrder:e.order||0}));
      });
    } else {
      allEntries=getScheduleEntries().map(e=>({...e,_roomName:e.roomName,_roomLoc:e.roomLocation||'',_displayOrder:e.order||0}));
    }

    // 模糊比對姓名
    const q=nameQ.toLowerCase();
    const matched=allEntries.filter(e=>e.name&&e.name.toLowerCase().includes(q));

    // 更新提示列
    if(infoBar){
      if(matched.length){
        // 找出匹配的不重複姓名
        const names=[...new Set(matched.map(e=>e.name))];
        infoBar.innerHTML='🔍 找到 <strong>'+escHtml(names.join('、'))+'</strong> 共 '+matched.length+' 筆考試記錄';
        infoBar.style.display='block';
      } else {
        infoBar.innerHTML='🔍 查無符合「'+escHtml(nameQ)+'」的學生';
        infoBar.style.display='block';
      }
    }

    // 渲染結果
    const tbody=document.getElementById('stu-sched-tbody');if(!tbody)return;
    tbody.innerHTML=matched.map(e=>{
      const {ac,at,fc,ft}=_getEntryRep(e);
      return `<tr>
      <td style="font-family:'DM Mono',monospace;color:var(--ink);font-weight:600">${e._displayOrder}</td>
      <td style="color:var(--ink)">${escHtml(e._roomName)}</td>
      <td style="color:var(--ink);font-family:'DM Mono',monospace;font-size:11px">${escHtml(e._roomLoc||'—')}</td>
      <td style="color:var(--ink)">${escHtml(e.class)}</td>
      <td style="color:var(--ink);font-weight:600">${escHtml(e.name)}</td>
      <td style="color:var(--ink)">${escHtml(e.instName)}</td>
      <td>${typeBadge(e.type)}</td>
      <td style="font-size:12px;color:var(--ink)">${ac?escHtml(ac)+' — <em>'+escHtml(at)+'</em>':'—'}</td>
      <td style="font-size:12px;color:var(--ink)">${fc?escHtml(fc)+' — <em>'+escHtml(ft)+'</em>':'—'}</td>
    </tr>`;}).join('')||'<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:20px;font-family:\'DM Mono\',monospace;font-size:12px">查無資料</td></tr>';
  } else {
    // 清空搜尋：恢復考場按鈕區，顯示目前選定考場
    if(roomCard)roomCard.style.display='';
    if(infoBar)infoBar.style.display='none';
    stuSchSelectRoom(_stuSchActiveRoom,null);
  }
}

function doLookup(){onStuNameInput();}
function clearLookup(){const n=document.getElementById('lookup-name');if(n)n.value='';onStuNameInput();}

// ════════════════════════════════════════════════
// TEACHER MODULE
// ════════════════════════════════════════════════
// ── 取得「該教師負責的學生」 ──
// ST._teaViewAll=true 時，admin 顯示全部學生；false 時依 teacherStudents 篩選
function getMyStudents(){
  const tid=ST.user?.id;
  if(ST.role==='admin'){
    if(ST._teaViewAll)return students(); // 全部模式
    const ids=DB.teacherStudents[tid]||[];
    if(!ids.length)return students(); // 若尚未設定指導學生，顯示全部
    return students().filter(s=>ids.includes(s.id));
  }
  const ids=DB.teacherStudents[tid]||[];
  return students().filter(s=>ids.includes(s.id));
}

// ── 管理員教師模式切換 ──
function setTeaView(viewAll){
  ST._teaViewAll=!!viewAll;
  const mine=document.getElementById('tea-view-mine');
  const all=document.getElementById('tea-view-all');
  if(mine)mine.className='btn btn-xs '+(viewAll?'btn-s':'btn-p');
  if(all)all.className='btn btn-xs '+(viewAll?'btn-p':'btn-s');
  renderTeaTable();
}
window.setTeaView=setTeaView;

// ── 總覽表格 ──
function renderTeaTable(){
  // ★ 管理員顯示切換按鈕
  const toggleEl=document.getElementById('tea-view-toggle');
  if(toggleEl)toggleEl.style.display=ST.role==='admin'?'flex':'none';
  if(ST.role==='admin'&&ST._teaViewAll===undefined)ST._teaViewAll=false;
  const cf=document.getElementById('tea-class')?.value||'';
  // 教師模式：直接顯示全部學生，班級 select 只做快速篩選
  let stus=getMyStudents()
    .filter(s=>!cf||s.class===cf)
    .sort((a,b)=>DB.classes.indexOf(a.class)-DB.classes.indexOf(b.class)||a.seat-b.seat);
  const done=stus.filter(s=>s.teaDone).length;
  const el1=document.getElementById('tea-done-n'),el2=document.getElementById('tea-total-n'),el3=document.getElementById('tea-prog');
  if(el1)el1.textContent=done;if(el2)el2.textContent=stus.length;
  if(el3)el3.style.width=stus.length?(done/stus.length*100)+'%':'0%';

  const ob=document.getElementById('tea-overview-body');if(!ob)return;
  if(!stus.length){
    const isAdminMine=ST.role==='admin'&&!ST._teaViewAll;
    ob.innerHTML=`<div style="padding:16px;background:var(--cream);border-radius:var(--r);text-align:center">
      <div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--muted);margin-bottom:12px">
        ${isAdminMine?'您目前在「我的學生」模式，尚未設定指導學生。可切換至「全部學生」，或至後台教師名單設定指導學生。':'目前尚無指派給您的學生。您可以自行搜尋並開始填寫評量，或等候管理員指派。'}
      </div>
      <button class="btn btn-p btn-sm" onclick="openTeaSelfAddPanel()">🔍 搜尋學生填寫評量</button>
    </div>`;
    return;
  }
  ob.innerHTML=stus.map(s=>{
    const tc=DB.teacherComments[s.id]||{};
    const types=['major','minor','elective'].filter(k=>s[k]);
    // ★ 任一修別有填即為完成（綠點）
    const allDone=types.some(k=>tc[k]?.score!==undefined);
    // 每個修別：inline 勾選框 + 展開填寫
    const typeRows=types.map(k=>{
      const t=tc[k];
      const done=t?.score!==undefined;
      const scoreColor=done&&t.score<60?'color:var(--red)':'color:var(--sage)';
      return `<div class="tea-type-row" id="ttr-${s.id}-${k}" style="border-bottom:1px solid var(--cream);padding:8px 14px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:7px;cursor:pointer;flex:1;min-width:160px">
            <input type="checkbox" ${done?'checked':''} style="width:15px;height:15px;cursor:pointer;accent-color:var(--gold)"
              onchange="teaInlineToggle('${s.id}','${k}',this.checked)">
            <span style="font-family:DM Mono,monospace;font-size:9px;letter-spacing:1px;color:${done?'var(--sage)':'var(--muted)'}">${typeName(k)}</span>
            <strong style="font-size:13px">${iname(s[k])}</strong>
            ${done?`<span style="font-family:DM Mono,monospace;font-size:15px;font-weight:700;${scoreColor}">${t.score}</span>`:`<span style="font-family:DM Mono,monospace;font-size:11px;color:var(--border)">未填</span>`}
          </label>
          ${done?`<button class="btn btn-s btn-xs" onclick="teaInlineEdit('${s.id}','${k}')">修改</button>`:''}
        </div>
        <div id="tea-inline-form-${s.id}-${k}" style="display:none;margin-top:10px;padding:12px;background:var(--cream);border-radius:var(--r)">
          <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
            <div style="flex:0 0 120px">
              <div style="font-family:DM Mono,monospace;font-size:8px;letter-spacing:1px;color:var(--muted);margin-bottom:4px">平時成績（0–99）</div>
              <input type="text" inputmode="decimal" id="ti-score-${s.id}-${k}" value="${t?.score??''}"
                placeholder="輸入分數" readonly
                onclick="openNP('ti-score-${s.id}-${k}','平時成績',v=>{document.getElementById('ti-score-${s.id}-${k}').value=v;})"
                style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:var(--r);font-family:DM Mono,monospace;font-size:20px;font-weight:700;text-align:center;cursor:pointer;outline:none;background:var(--white)">
            </div>
            <div style="flex:1;min-width:180px">
              <div style="font-family:DM Mono,monospace;font-size:8px;letter-spacing:1px;color:var(--muted);margin-bottom:4px">評語</div>
              <textarea id="ti-comment-${s.id}-${k}" style="width:100%;min-height:64px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--r);font-family:Noto Serif TC,serif;font-size:13px;line-height:1.7;resize:vertical;outline:none;background:var(--white)" placeholder="填寫評語...">${t?.comment??''}</textarea>
            </div>
          </div>
          <div style="display:flex;gap:7px;margin-top:8px">
            <button class="btn btn-g btn-sm" onclick="teaInlineSave('${s.id}','${k}')">✓ 儲存</button>
            <button class="btn btn-s btn-sm" onclick="document.getElementById('tea-inline-form-${s.id}-${k}').style.display='none'">取消</button>
          </div>
        </div>
      </div>`;
    }).join('');
    return `<div style="border:1px solid var(--border);border-radius:var(--r);margin-bottom:10px;overflow:hidden" id="tcard-${s.id}">
      <div style="background:var(--cream);padding:8px 14px;display:flex;align-items:center;gap:12px;justify-content:space-between">
        <div>
          <strong>${s.name}</strong>
          <span style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted);margin-left:8px">${s.class}·座${s.seat}</span>
          ${s.repDone?'<span class="badge b-elective" style="margin-left:6px">已填報</span>':'<span class="badge b-absent" style="margin-left:6px">未填報</span>'}
        </div>
        <span class="dot ${allDone?'dg':'dr'}" title="${allDone?'已完成評量':'尚未完成評量'}"></span>
      </div>
      ${typeRows}
    </div>`;
  }).join('');
}

window.renderTeaTable=renderTeaTable;

// ── Inline 評量：勾選修別展開表單 ──
function teaInlineToggle(sid,type,checked){
  const formEl=document.getElementById('tea-inline-form-'+sid+'-'+type);
  if(!formEl)return;
  if(checked){
    formEl.style.display='block';
    // 帶入現有分數
    const existing=DB.teacherComments[sid]?.[type]||{};
    const scoreEl=document.getElementById('ti-score-'+sid+'-'+type);
    const commentEl=document.getElementById('ti-comment-'+sid+'-'+type);
    if(scoreEl)scoreEl.value=existing.score??'';
    if(commentEl)commentEl.value=existing.comment??'';
    // scroll to form
    formEl.scrollIntoView({behavior:'smooth',block:'nearest'});
  } else {
    formEl.style.display='none';
  }
}
window.teaInlineToggle=teaInlineToggle;

function teaInlineEdit(sid,type){
  // 展開表單（修改模式）
  teaInlineToggle(sid,type,true);
  // 同時勾上 checkbox
  const chk=document.querySelector(`#ttr-${sid}-${type} input[type=checkbox]`);
  if(chk)chk.checked=true;
}
window.teaInlineEdit=teaInlineEdit;

function teaInlineSave(sid,type){
  const scoreEl=document.getElementById('ti-score-'+sid+'-'+type);
  const commentEl=document.getElementById('ti-comment-'+sid+'-'+type);
  if(!scoreEl)return;
  const score=parseFloat(scoreEl.value);
  const comment=(commentEl?.value||'').trim();
  if(isNaN(score)){showToast('請填入有效分數','err');return;}
  // ★ 分數上限 99 分
  if(score>99){showToast('分數上限為 99 分','err');return;}
  if(score<0){showToast('分數不可為負','err');return;}
  if(!DB.teacherComments[sid])DB.teacherComments[sid]={};
  // ★ 記錄填寫此評語的老師（供成績單顯示指導老師用）
  {const _a=ST.user&&ST.user.role==='teacher'?ST.user:null;
   DB.teacherComments[sid][type]={score,comment,
     teacherId:_a?_a.id:(DB.teacherComments[sid][type]?.teacherId||''),
     teacherName:_a?_a.name:(DB.teacherComments[sid][type]?.teacherName||'')};}
  const s=DB.users.find(u=>u.id===sid);
  if(s){
    const types=['major','minor','elective'].filter(k=>s[k]);
    // ★ 只要有任何一個修別已填，就標記為 teaDone
    s.teaDone=types.some(k=>DB.teacherComments[sid]?.[k]?.score!==undefined);
    fbSet('users',s.id,s);
  }
  fbSet('teacherComments',sid,{...DB.teacherComments[sid]});
  showToast('已儲存 ✓','ok');
  renderTeaTable();
  setTimeout(teaCheckAllDone, 200);
  // ★ 90分（含）以上：背景送入審核佇列並請教師填理由（分數已生效不擋）
  if(score>=90 && ST.role!=='admin'){
    const pendingId='tea_'+sid+'_'+type;
    const existing=DB.pendingApprovals?.[pendingId];
    if(!(existing && existing.status==='pending' && existing.score===score)){
      openHighScoreReasonModal({
        kind:'teacher',
        score:score,
        comment:comment,
        sid:sid,
        scoreType:type,
        pendingId:pendingId,
      });
    }
  }
}
window.teaInlineSave=teaInlineSave;

// ── 匯出評量總覽 CSV ──
function exportTeaOverviewCSV(allClasses){
  const cf=allClasses?'':(document.getElementById('tea-class')?.value||'');
  let stus=getMyStudents().filter(s=>!cf||s.class===cf)
    .sort((a,b)=>DB.classes.indexOf(a.class)-DB.classes.indexOf(b.class)||a.seat-b.seat);
  const rows=[];
  stus.forEach(s=>{
    const tc=DB.teacherComments[s.id]||{};
    ['major','minor','elective'].filter(k=>s[k]).forEach(k=>{
      const t=tc[k]||{};
      rows.push({'班級':s.class,'座號':s.seat,'姓名':s.name,'修別':typeName(k),'樂器':iname(s[k]),'平時成績':t.score||'','評語':t.comment||''});
    });
  });
  const fname=cf?(cf+'評量總覽'):'全班評量總覽';
  exportCSV(rows,fname);
}
window.exportTeaOverviewCSV=exportTeaOverviewCSV;
const TWZ={cls:'',sid:'',type:'',remaining:[]};

// ★ #2 教師自行搜尋學生（無指派時）
function openTeaSelfAddPanel(){
  let panel=document.getElementById('tea-self-add-overlay');
  if(!panel){
    panel=document.createElement('div');panel.id='tea-self-add-overlay';panel.className='overlay';
    panel.innerHTML=`<div class="modal" style="width:520px">
      <h2 class="modal-t">🔍 搜尋學生開始填寫</h2>
      <p style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);margin-bottom:12px;line-height:1.7">
        搜尋並選擇學生後即可直接填寫評量。此操作不會永久指派給您。
      </p>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <input type="text" id="tsa-search" placeholder="輸入學生姓名或班級…" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:var(--r);font-size:14px;outline:none" oninput="tsaSearch()">
        <select id="tsa-class" style="padding:7px 10px;border:1px solid var(--border);border-radius:var(--r);font-size:13px;outline:none" onchange="tsaSearch()">
          <option value="">全部班級</option>
          ${DB.classes.map(c=>`<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div id="tsa-results" style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r)"></div>
      <div class="modal-ft">
        <button class="btn btn-s" onclick="closeOverlay('tea-self-add-overlay')">關閉</button>
      </div>
    </div>`;
    document.body.appendChild(panel);
    panel.addEventListener('click',e=>{if(e.target===panel)panel.classList.remove('on');});
  }
  document.getElementById('tsa-search').value='';
  tsaSearch();
  panel.classList.add('on');
}
window.openTeaSelfAddPanel=openTeaSelfAddPanel;

function tsaSearch(){
  const q=(document.getElementById('tsa-search')?.value||''). trim();
  const cls=document.getElementById('tsa-class')?.value||'';  const res=document.getElementById('tsa-results');if(!res)return;
  const stus=students().filter(s=>(!q||s.name.includes(q)||s.account.includes(q))&&(!cls||s.class===cls))
    .sort((a,b)=>DB.classes.indexOf(a.class)-DB.classes.indexOf(b.class)||a.seat-b.seat)
    .slice(0,30);
  res.innerHTML=stus.map(s=>{
    const types=['major','minor','elective'].filter(t=>s[t]);
    return `<div style="padding:9px 14px;border-bottom:1px solid var(--cream)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <strong>${s.name}</strong>
        <span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted)">${s.class}·座${s.seat}</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${types.map(t=>{
          const done=DB.teacherComments[s.id]?.[t];
          return `<button class="btn ${done?'btn-g':'btn-p'} btn-xs" onclick="teaWizOpenDirect('${s.id}','${t}');closeOverlay('tea-self-add-overlay')">${typeName(t)}·${iname(s[t])}${done?' ✓':''}</button>`;
        }).join('')}
      </div>
    </div>`;
  }).join('') || '<div style="padding:12px;color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px">查無學生</div>';
}
window.tsaSearch=tsaSearch;

function teaWizStart(){
  const myStus=getMyStudents().sort((a,b)=>{
    const ci=DB.classes.indexOf(a.class)-DB.classes.indexOf(b.class);
    return ci!==0?ci:a.seat-b.seat;
  });
  // 班級下拉（快速跳轉用）
  const cls=[...new Set(myStus.map(s=>s.class))].sort((a,b)=>DB.classes.indexOf(a)-DB.classes.indexOf(b));
  const sel=document.getElementById('tea-wiz-class');
  sel.innerHTML='<option value="">— 班級 —</option>'+cls.map(c=>`<option value="${c}">${c}</option>`).join('');
  // 學生下拉：直接列出全部（按班級+座號）
  const stuSel=document.getElementById('tea-wiz-stu');
  stuSel.innerHTML='<option value="">— 請選學生 —</option>'+
    myStus.map(s=>{
      const done=['major','minor','elective'].filter(k=>s[k]).every(k=>DB.teacherComments[s.id]?.[k]?.score!==undefined);
      return `<option value="${s.id}">${s.class}·${s.seat} ${s.name}${done?' ✓':''}`;
    }).join('');
  TWZ.cls='';TWZ.sid='';TWZ.type='';
  const s1inp=document.getElementById('tea-s1-name-search');if(s1inp)s1inp.value='';
  const s1hint=document.getElementById('tea-s1-name-hint');if(s1hint)s1hint.textContent='';
  teaWizShowStep(1);
  document.getElementById('tea-wizard').style.display='block';
  document.getElementById('tea-wizard').scrollIntoView({behavior:'smooth',block:'start'});
}
window.teaWizStart=teaWizStart;

// ★ Step 1 直接姓名搜尋（自動帶入班級並跳到修別步驟）
function teaWizS1NameSearch(){
  const q=(document.getElementById('tea-s1-name-search')?.value||'').trim();
  const hint=document.getElementById('tea-s1-name-hint');
  if(!q){if(hint)hint.textContent='';return;}
  const allStus=getMyStudents();
  const found=allStus.filter(s=>s.name.includes(q));
  if(!found.length){
    if(hint)hint.innerHTML='<span style="color:var(--rust)">查無此人，請確認姓名</span>';
    return;
  }
  if(found.length===1){
    const s=found[0];
    TWZ.cls=s.class;
    document.getElementById('tea-wiz-class').value=s.class;
    if(hint)hint.innerHTML=`<span style="color:var(--sage)">✓ 找到：${s.name}（${s.class}·座${s.seat}）</span>`;
    // 直接設定學生並跳到修別選擇
    const classStus=getMyStudents().filter(ss=>ss.class===s.class).sort((a,b)=>a.seat-b.seat);
    const stuSel=document.getElementById('tea-wiz-stu');
    stuSel.innerHTML='<option value="">— 請選學生 —</option>'+classStus.map(ss=>`<option value="${ss.id}">${ss.name}（座${ss.seat}）</option>`).join('');
    stuSel.value=s.id;
    TWZ.sid=s.id;
    teaWizPickStu();
  } else {
    if(hint)hint.innerHTML=`<span style="color:var(--muted)">找到 ${found.length} 位，請選擇班級後再從下拉選單挑選</span>`;
    // 把多個結果塞進 step 2 下拉並跳過去
    const stuSel=document.getElementById('tea-wiz-stu');
    stuSel.innerHTML='<option value="">— 請選學生 —</option>'+found.map(s=>`<option value="${s.id}">${s.name}（${s.class}·座${s.seat}）</option>`).join('');
    const ns=document.getElementById('tea-wiz-name-search');if(ns)ns.value=q;
    teaWizShowStep(2);
  }
}
window.teaWizS1NameSearch=teaWizS1NameSearch;

function teaWizShowStep(n){
  [1,2,3,4].forEach(i=>{
    document.getElementById('tea-s'+i).style.display=i===n?'block':'none';
    const el=document.getElementById('tstep-'+i);
    if(el){el.classList.toggle('on',i===n);el.classList.toggle('done',i<n);}
  });
}

function teaWizPickClass(){
  const cls=document.getElementById('tea-wiz-class').value;
  TWZ.cls=cls;
  // 重新過濾學生下拉（班級選了就篩，沒選就顯示全部）
  const myStus=getMyStudents()
    .filter(s=>!cls||s.class===cls)
    .sort((a,b)=>{const ci=DB.classes.indexOf(a.class)-DB.classes.indexOf(b.class);return ci!==0?ci:a.seat-b.seat;});
  const stuSel=document.getElementById('tea-wiz-stu');
  stuSel.innerHTML='<option value="">— 請選學生 —</option>'+
    myStus.map(s=>{
      const done=['major','minor','elective'].filter(k=>s[k]).every(k=>DB.teacherComments[s.id]?.[k]?.score!==undefined);
      return `<option value="${s.id}">${s.class}·${s.seat} ${s.name}${done?' ✓':''}`;
    }).join('');
  // 保持在 step1，讓使用者繼續從學生下拉選
}
window.teaWizPickClass=teaWizPickClass;

function teaWizNameSearch(){
  const q=(document.getElementById('tea-wiz-name-search')?.value||'').trim();
  const hint=document.getElementById('tea-wiz-name-hint');
  const sel=document.getElementById('tea-wiz-stu');
  if(!q){if(hint)hint.textContent='';return;}
  // Search across all my students regardless of class filter
  const allStus=getMyStudents();
  const found=allStus.filter(s=>s.name.includes(q));
  if(!found.length){
    if(hint)hint.innerHTML='<span style="color:var(--rust)">查無此人，請確認姓名是否正確</span>';
    return;
  }
  if(found.length===1){
    const s=found[0];
    // switch class if needed
    TWZ.cls=s.class;
    document.getElementById('tea-wiz-class').value=s.class;
    // repopulate student dropdown for that class
    const classStus=getMyStudents().filter(ss=>ss.class===s.class).sort((a,b)=>a.seat-b.seat);
    sel.innerHTML='<option value="">— 請選學生 —</option>'+classStus.map(ss=>`<option value="${ss.id}">${ss.name}（座${ss.seat}）</option>`).join('');
    sel.value=s.id;
    if(hint)hint.innerHTML=`<span style="color:var(--sage)">✓ 找到：${s.name}（${s.class}·座${s.seat}）</span>`;
    TWZ.sid=s.id;
    teaWizPickStu();
  } else {
    if(hint)hint.innerHTML='<span style="color:var(--muted)">找到 '+found.length+' 位，請從下拉選單選擇</span>';
    // filter dropdown to matching students
    sel.innerHTML='<option value="">— 請選學生 —</option>'+found.map(s=>`<option value="${s.id}">${s.name}（${s.class}·座${s.seat}）</option>`).join('');
  }
}
window.teaWizNameSearch=teaWizNameSearch;

function teaWizPickStu(){
  const sid=document.getElementById('tea-wiz-stu').value;
  if(!sid)return;
  TWZ.sid=sid;
  const s=DB.users.find(u=>u.id===sid);if(!s)return;
  const types=[];
  if(s.major)types.push({key:'major',label:'主修 · '+iname(s.major)});
  if(s.minor)types.push({key:'minor',label:'副修 · '+iname(s.minor)});
  if(s.elective)types.push({key:'elective',label:'選修加考 · '+iname(s.elective)});
  TWZ.remaining=[...types];
  const btns=document.getElementById('tea-wiz-type-btns');
  btns.innerHTML=types.map(t=>{
    const done=DB.teacherComments[sid]?.[t.key];
    return `<button class="btn ${done?'btn-g':'btn-p'} btn-sm" onclick="teaWizPickType('${t.key}')">${t.label}${done?' ✓':''}</button>`;
  }).join('');
  // update the type dropdown to only show types this student has
  const typeSel=document.getElementById('tea-wiz-type-sel');
  if(typeSel){
    typeSel.innerHTML='<option value="">— 請選修別 —</option>';
    types.forEach(t=>typeSel.appendChild(new Option(t.label,t.key)));
  }
  teaWizShowStep(3);
}
window.teaWizPickStu=teaWizPickStu;

function teaWizPickType(type){
  TWZ.type=type;
  const s=DB.users.find(u=>u.id===TWZ.sid);if(!s)return;
  const existing=DB.teacherComments[TWZ.sid]?.[type]||{};
  const acKey=type==='elective'?'elec_ac':type+'_ac';
  const atKey=type==='elective'?'elec_at':type+'_at';
  const fcKey=type==='elective'?'elec_fc':type+'_fc';
  const ftKey=type==='elective'?'elec_ft':type+'_ft';
  const instName=iname(s[type])||'—';
  document.getElementById('tea-wiz-info').innerHTML=
    `<strong>${s.name}</strong> <span style="color:var(--muted);font-size:12px">${s.class}·座${s.seat}</span>`+
    ` — <span style="font-family:DM Mono,monospace;font-size:11px;color:var(--steel)">${typeName(type)}</span>`+
    ` <strong style="color:var(--ink)">${instName}</strong>`+
    (s[acKey]?`<div style="font-size:11px;color:var(--muted);margin-top:4px">🎵 指定：${s[acKey]||''} — <em>${s[atKey]||''}</em></div>`:'<div style="font-size:10px;color:var(--border);margin-top:4px">（曲目尚未填報）</div>')+
    (s[fcKey]?`<div style="font-size:11px;color:var(--muted)">🎼 自選：${s[fcKey]||''} — <em>${s[ftKey]||''}</em></div>`:'');
  document.getElementById('tea-wiz-score').value=existing.score||'';
  document.getElementById('tea-wiz-comment').value=existing.comment||'';
  teaWizShowStep(4);
}
window.teaWizPickType=teaWizPickType;

function teaWizBack(toStep){teaWizShowStep(toStep);}
window.teaWizBack=teaWizBack;

function teaWizSave(){
  const sid=TWZ.sid;const type=TWZ.type;
  if(!sid||!type)return;
  const score=parseFloat(document.getElementById('tea-wiz-score').value);
  const comment=document.getElementById('tea-wiz-comment').value;
  if(isNaN(score)){showToast('請填入分數','err');return;}
  // ★ 分數上限 99 分
  if(score>99){showToast('分數上限為 99 分','err');return;}
  if(score<0){showToast('分數不可為負','err');return;}
  // ★ 分數立刻生效寫入（不擋）
  if(!DB.teacherComments[sid])DB.teacherComments[sid]={};
  // ★ 記錄填寫此評語的老師（供成績單顯示指導老師用）
  {const _a=ST.user&&ST.user.role==='teacher'?ST.user:null;
   DB.teacherComments[sid][type]={score,comment,
     teacherId:_a?_a.id:(DB.teacherComments[sid][type]?.teacherId||''),
     teacherName:_a?_a.name:(DB.teacherComments[sid][type]?.teacherName||'')};}
  const s=DB.users.find(u=>u.id===sid);
  if(s){
    const types=['major','minor','elective'].filter(k=>s[k]);
    s.teaDone=types.some(k=>DB.teacherComments[sid]?.[k]?.score!==undefined);
    fbSet('users',s.id,s);
  }
  fbSet('teacherComments',sid,{...DB.teacherComments[sid]});
  renderTeaTable();
  // ★ 90分（含）以上：要求教師填寫理由（背景送入審核佇列，分數已生效不擋）
  //   管理員自己改不需審核
  if(score>=90 && ST.role!=='admin'){
    const pendingId='tea_'+sid+'_'+type;
    const existing=DB.pendingApprovals?.[pendingId];
    // 已有相同 90+ 待審紀錄且分數一致 → 跳過避免重複打擾
    if(!(existing && existing.status==='pending' && existing.score===score)){
      // 開啟理由輸入彈窗（背景記錄，分數已生效）
      openHighScoreReasonModal({
        kind:'teacher',
        score:score,
        comment:comment,
        sid:sid,
        scoreType:type,
        pendingId:pendingId,
      });
      return 'pending_reason'; // 提示 caller：開了理由視窗，但分數已存
    }
  }
  return true;
}

function teaWizSaveAndNext(){
  const result=teaWizSave();
  // ★ 把「跳下一位」邏輯封裝成函式
  const doNext=()=>{
    const allStus=getMyStudents().sort((a,b)=>{
      const ci=DB.classes.indexOf(a.class)-DB.classes.indexOf(b.class);
      return ci!==0?ci:a.seat-b.seat;
    });
    const curIdx=allStus.findIndex(s=>s.id===TWZ.sid);
    // 從下一位開始找未完成的
    const nextPending=allStus.slice(curIdx+1).find(s=>{
      const types=['major','minor','elective'].filter(k=>s[k]);
      // ★ 任一修別填完就不算 incomplete
      return !types.some(k=>DB.teacherComments[s.id]?.[k]?.score!==undefined);
    });
    if(nextPending){
      const stuSel=document.getElementById('tea-wiz-stu');
      if(stuSel)stuSel.value=nextPending.id;
      showToast('已儲存 ✓，跳到：'+nextPending.name,'ok');
      TWZ.sid=nextPending.id;
      TWZ.cls=nextPending.class;
      teaWizPickStu();
    } else {
      document.getElementById('tea-wizard').style.display='none';
      renderTeaTable();
      teaCheckAllDone();
    }
  };
  // ★ 若觸發了 90+ 理由視窗 → 等填完理由再跳下一位（修正：避免視窗被「跳下一位」蓋掉）
  if(result==='pending_reason'){
    _hsAfterReason=doNext;
    return;
  }
  doNext();
}
window.teaWizSaveAndNext=teaWizSaveAndNext;

function teaWizSubmitAll(){
  const result=teaWizSave();
  // ★ 把「結束 wizard」邏輯封裝成函式
  const doFinish=()=>{
    document.getElementById('tea-wizard').style.display='none';
    renderTeaTable();
    showToast('評量已儲存 ✓','ok');
    teaCheckAllDone();
  };
  // ★ 若觸發了 90+ 理由視窗 → 等填完理由再結束（修正：避免視窗被結束流程蓋掉）
  if(result==='pending_reason'){
    _hsAfterReason=doFinish;
    return;
  }
  doFinish();
}
window.teaWizSubmitAll=teaWizSubmitAll;

// 全部學生評量完成後的提醒與跳轉
function teaCheckAllDone(){
  const allStus=getMyStudents();
  // ★ 修正：每位學生「任一修別」填寫即算完成（與 teaDone 邏輯一致）
  //   不再要求每個修別都填，老師只要在每位學生上選一樣修別打分就算完成
  const incomplete=allStus.filter(s=>{
    const types=['major','minor','elective'].filter(k=>s[k]);
    if(!types.length)return false;
    // ★ score===0 也算填寫完成（用 !== undefined 而非 truthy 判斷）
    // ★ 改為 some：只要有任一修別已填即算完成
    return !types.some(k=>DB.teacherComments[s.id]?.[k]?.score!==undefined&&DB.teacherComments[s.id]?.[k]?.score!==null);
  });
  if(!incomplete.length&&allStus.length>0){
    const confirmDiv=document.getElementById('tea-all-done-banner');
    if(confirmDiv){
      confirmDiv.style.display='block';
      confirmDiv.scrollIntoView({behavior:'smooth',block:'start'});
    }
  } else {
    const bannerDiv=document.getElementById('tea-all-done-banner');
    if(bannerDiv)bannerDiv.style.display='none';
    const incompleteDiv=document.getElementById('tea-incomplete-banner');
    if(incompleteDiv){
      incompleteDiv.style.display='block';
      incompleteDiv.innerHTML=`<div style="background:#fff8e6;border:1px solid var(--gold);border-left:4px solid var(--gold);border-radius:var(--r);padding:14px 16px;margin-bottom:14px">
        <div style="font-family:DM Mono,monospace;font-size:10px;letter-spacing:2px;color:var(--gold);margin-bottom:8px">⚠ 以下學生尚未填寫任何評量（每位學生只需任一修別即可）</div>
        ${incomplete.map(s=>{
          // ★ 因為改為 some 邏輯，這裡列出的學生代表「所有修別都沒填」
          //   提供任一修別讓他點進去填寫
          const availableTypes=['major','minor','elective'].filter(k=>s[k]);
          const firstType=availableTypes[0]||'major';
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:13px">${s.name} <span style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted)">${s.class}·座${s.seat}</span></span>
            <span style="font-family:DM Mono,monospace;font-size:9px;color:var(--rust)">尚未評量（可填寫：${availableTypes.map(k=>typeName(k)).join('、')}）</span>
            <button class="btn btn-p btn-xs" onclick="teaWizOpenDirect('${s.id}','${firstType}')">去填寫</button>
          </div>`;
        }).join('')}
        <div class="bg" style="margin-top:12px">
          <button class="btn btn-p btn-sm" onclick="document.getElementById('tea-incomplete-banner').style.display='none'">先略過</button>
        </div>
      </div>`;
      incompleteDiv.scrollIntoView({behavior:'smooth',block:'start'});
    }
  }
}
window.teaCheckAllDone=teaCheckAllDone;

// 從總覽直接修改某學生某修別
function teaWizOpenDirect(sid,type){
  TWZ.sid=sid;TWZ.type=type;
  const s=DB.users.find(u=>u.id===sid);if(!s)return;
  TWZ.cls=s.class;
  const existing=DB.teacherComments[sid]?.[type]||{};
  document.getElementById('tea-wiz-info').innerHTML=
    `<strong>${s.name}</strong> <span style="color:var(--muted);font-size:12px">${s.class}·座${s.seat}</span> — ${typeName(type)} · ${iname(s[type])}`;
  document.getElementById('tea-wiz-score').value=existing.score||'';
  document.getElementById('tea-wiz-comment').value=existing.comment||'';
  [1,2,3].forEach(i=>{
    document.getElementById('tea-s'+i).style.display='none';
    const el=document.getElementById('tstep-'+i);if(el){el.classList.remove('on');el.classList.add('done');}
  });
  teaWizShowStep(4);
  document.getElementById('tea-wizard').style.display='block';
  document.getElementById('tea-wizard').scrollIntoView({behavior:'smooth',block:'start'});
}
window.teaWizOpenDirect=teaWizOpenDirect;

// ── 管理員指派學生 ──
function openTeaStuModal(tid){
  const t=DB.users.find(u=>u.id===tid);if(!t)return;
  document.getElementById('tsm-teacher-name').textContent=t.name;
  document.getElementById('tsm-teacher-name').dataset.tid=tid;
  const sel=DB.teacherStudents[tid]||[];
  // class tabs
  const clsEl=document.getElementById('tsm-class-tabs');
  clsEl.innerHTML=DB.classes.map((c,i)=>`<button class="btn btn-s btn-sm ${i===0?'btn-p':''}" onclick="tsmFilterClass('${c}',this)">${c}</button>`).join('')+
    `<button class="btn btn-s btn-sm" onclick="tsmFilterClass('',this)">全部</button>`;
  tsmRenderList(tid,'');
  openOverlay('tea-stu-modal');
}
window.openTeaStuModal=openTeaStuModal;

function tsmFilterClass(cls,btn){
  document.querySelectorAll('#tsm-class-tabs button').forEach(b=>b.classList.remove('btn-p'));
  btn.classList.add('btn-p');
  const tid=document.getElementById('tsm-teacher-name').dataset.tid;
  tsmRenderList(tid,cls);
}
window.tsmFilterClass=tsmFilterClass;

function tsmRenderList(tid,cls){
  const sel=DB.teacherStudents[tid]||[];
  const stus=students().filter(s=>!cls||s.class===cls).sort((a,b)=>DB.classes.indexOf(a.class)-DB.classes.indexOf(b.class)||a.seat-b.seat);
  document.getElementById('tsm-stu-list').innerHTML=stus.map(s=>`
    <label style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--cream);cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--gold-bg)'" onmouseout="this.style.background=''">
      <input type="checkbox" value="${s.id}" ${sel.includes(s.id)?'checked':''} style="width:15px;height:15px;accent-color:var(--gold)">
      <div>
        <strong>${s.name}</strong>
        <span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted);margin-left:6px">${s.class}·座${s.seat}</span>
        <div style="font-size:11px;color:var(--muted)">${[s.major&&iname(s.major),s.minor&&iname(s.minor),s.elective&&iname(s.elective)].filter(Boolean).join(' / ')}</div>
      </div>
    </label>`).join('');
}
window.tsmRenderList=tsmRenderList;

function saveTeaStu(){
  const tid=document.getElementById('tsm-teacher-name').dataset.tid;
  const checked=[...document.querySelectorAll('#tsm-stu-list input[type=checkbox]:checked')].map(cb=>cb.value);
  DB.teacherStudents[tid]=checked;
  fbSet('teacherStudents',tid,{list:checked});
  closeOverlay('tea-stu-modal');
  renderAdminTeachers();
  showToast('學生指派已儲存 ✓','ok');
}
window.saveTeaStu=saveTeaStu;

// ── 舊 Modal 相容（admin 模式仍可用） ──
function openTeaModal(sid){
  teaWizOpenDirect(sid,'major');
}
function swTeaTab(key,el){}
function saveTeaComment(){teaWizSubmitAll();}

// ════════════════════════════════════════════════
// JURY MODULE
// ════════════════════════════════════════════════
function getJuryEntries(){
  // ★ 優先使用已存檔的排程快照（反映後台的篩選/排序/移除）
  const roomId=ST.juryRoom?.id||(ST.role==='admin'?(ST._adminJuryRoomId||DB.rooms[0]?.id||''):'');
  if(roomId&&DB.savedScheduleSnapshot[roomId]&&DB.savedScheduleSnapshot[roomId].length){
    // 從快照補回最新學生資料（曲目可能有更新）
    return DB.savedScheduleSnapshot[roomId].map((snap,idx)=>{
      const stu=DB.users.find(u=>u.id===snap.studentId)||{};
      const acKey=snap.type==='elective'?'elec_ac':(snap.type+'_ac');
      const atKey=snap.type==='elective'?'elec_at':(snap.type+'_at');
      const fcKey=snap.type==='elective'?'elec_fc':(snap.type+'_fc');
      const ftKey=snap.type==='elective'?'elec_ft':(snap.type+'_ft');
      // ★ Bug8：動態從 DB.users 補 instName（快照的 instName 可能是舊的或空的）
      const instKey=snap.type==='elective'?'elective':snap.type;
      const freshInstId=stu[instKey]||snap.instId||'';
      const freshInstName=freshInstId?iname(freshInstId):snap.instName||'—';
      return {...snap,
        instId:freshInstId, instName:freshInstName,
        ac:stu[acKey]??'',at:stu[atKey]??'',
        fc:stu[fcKey]??'',ft:stu[ftKey]??'',
        catOrder:snap.catOrder??99,typeOrder:{major:0,minor:1,elective:2}[snap.type]??99,
        order:idx+1,
      };
    });
  }
  // fallback：快照不存在時動態計算（兼容舊資料）
  const all=getScheduleEntries();
  if(!roomId)return all;
  return all.filter(e=>e.roomId===roomId).map((e,idx)=>({...e,order:idx+1}));
}

function renderJuryTable(){
  const tbody=document.getElementById('jury-tbody');if(!tbody)return;
  // ★ Bug6 修正：管理員現場評分頁顯示唯讀提示橫幅
  const adminBanner=document.getElementById('jury-admin-readonly-banner');
  if(ST.role==='admin'){
    if(!adminBanner){
      const banner=document.createElement('div');
      banner.id='jury-admin-readonly-banner';
      banner.style.cssText='background:#fff3cd;border:1px solid #ffc107;border-left:4px solid var(--gold);border-radius:var(--r);padding:10px 16px;margin-bottom:14px;font-family:\'DM Mono\',monospace;font-size:11px;color:#856404;display:flex;align-items:center;gap:10px';
      banner.innerHTML='<span style="font-size:16px">👁</span><span><strong>管理員觀看模式（唯讀）</strong> — 此頁面僅供觀察現場評分狀況，管理員無法參與評分或送出分數，以防止產生無姓名的評審資料。</span>';
      const juryPg=document.getElementById('pg-jury');
      if(juryPg){const ph=juryPg.querySelector('.ph');if(ph)ph.insertAdjacentElement('afterend',banner);else juryPg.insertBefore(banner,juryPg.firstChild);}
    }
  } else {
    if(adminBanner)adminBanner.remove();
  }
  // ★ 管理員：初始化考場切換按鈕 & 設定 juryRoom
  if(ST.role==='admin')initJuryAdminRoomBar();
  const entries=getJuryEntries();
  const roomId=ST.juryRoom?.id||(ST.role==='admin'?(ST._adminJuryRoomId||DB.rooms[0]?.id||'r1'):'r1');
  if(!DB.juryScores[roomId])DB.juryScores[roomId]={};
  // ★ #5 動態取得考場評分欄位
  const roomFields=getRoomFields(roomId);
  // ★ 重建 thead：兩列 header，配合新版排版
  // 排版：序(r2) | 學生資訊(r2) | 扣/缺(r2) | [所有評分欄位](r2) | 曲目欄(r2) | 備註(r2)
  // 列2（評語列）：評語欄跨越所有評分欄位＋曲目欄
  const jthWrap=document.querySelector('#jury-table thead');
  if(jthWrap){
    const stickyBase='position:sticky;z-index:25;background:var(--ink)';
    const scoreColCount=roomFields.length;
    // 曲目欄 header：依後台有無 assigned/free 欄動態顯示
    const hasA=roomFields.some(f=>f.id==='assigned');
    const hasF=roomFields.some(f=>f.id==='free');
    // ★ 修正：自訂評分欄位的考場（如聲樂／流行演唱）也要顯示曲目欄標題
    const pieceColLabel=(hasA&&hasF)?'指定曲／自選曲':hasA?'指定曲':hasF?'自選曲':'曲目';
    jthWrap.innerHTML=
      '<tr>'+
        `<th rowspan="2" style="width:28px;${stickyBase};left:0">序</th>`+
        `<th rowspan="2" style="width:120px;text-align:left;padding-left:6px;${stickyBase};left:28px">學生資訊</th>`+
        `<th rowspan="2" style="width:36px">扣/<br>缺</th>`+
        roomFields.map(f=>`<th rowspan="2" style="width:58px;text-align:center;border-left:1px solid rgba(255,255,255,.15)">${f.label}<br><span style="font-size:7px;opacity:.6">${f.pct}%</span></th>`).join('')+
        `<th rowspan="2" style="min-width:220px;text-align:left;padding-left:8px;border-left:2px solid rgba(181,137,42,.4)">${pieceColLabel}<br><span style="font-size:7px;opacity:.6;font-weight:400">作曲家 · 曲目</span></th>`+
        `<th rowspan="2" style="width:90px;max-width:110px;text-align:left;padding-left:6px">備註<br><span style="font-size:7px;opacity:.6">REMARK</span></th>`+
      '</tr>'+
      '<tr></tr>';
  }
  // live exam state
  const liveState=DB.liveExam[roomId]||{};
  const liveEntryKey=liveState.playing||'';
  const liveScaleKey=liveState.scaleKey||'';

  const rows=[];
  entries.forEach((e,i)=>{
    const entryKey=e.studentId+'_'+e.type;
    if(!DB.juryScores[roomId][entryKey])DB.juryScores[roomId][entryKey]={};
    const myId=ST.juryId||ST.user?.id||'admin';
    const my=DB.juryScores[roomId][entryKey][myId]||{};
    const dq=DB.disqualified?.[entryKey];
    const absent=dq?true:(my.absent||false);
    if(dq&&!my._dqApplied){
      if(!DB.juryScores[roomId][entryKey][myId])DB.juryScores[roomId][entryKey][myId]={};
      (roomFields||[{id:'scale'},{id:'assigned'},{id:'free'}]).forEach(fld=>DB.juryScores[roomId][entryKey][myId][fld.id]=0);
      DB.juryScores[roomId][entryKey][myId].absent=true;
      DB.juryScores[roomId][entryKey][myId]._dqApplied=true;
    }
    const locked=dq||absent;

    // Black sign status
    const isBlack=!!(DB.blackSign[roomId]?.[entryKey]);
    // Live exam status
    const isLive=(liveEntryKey===entryKey);

    // Row class
    let rowClass='';
    if(locked)rowClass='jst-row-a';
    else if(isBlack)rowClass='jst-row-black';
    else if(isLive)rowClass='jst-row-live';

    // ★ 分數格（支援 * 跳過 + 動態欄位名稱 + 自動 skip 判斷）
    const sc=(f,lbl,fieldDef)=>{
      const autoSkip=fieldDef?isFieldSkipped(fieldDef,e):false;
      const rawVal=my[f]??'';
      const effectiveLocked=locked||autoSkip;
      const v=autoSkip?'*':(locked?'0':rawVal);
      const isSkipVal=v==='*';
      const isEmpty=!isSkipVal&&!effectiveLocked&&(rawVal===''||rawVal===null||rawVal===undefined);
      const red=!isSkipVal&&!effectiveLocked&&!isEmpty&&parseFloat(v)<60;
      const skipStyle=autoSkip?'background:rgba(202,111,30,0.08);color:var(--orange);font-weight:700;cursor:not-allowed':isSkipVal?'color:var(--orange);font-weight:700':'';
      if(autoSkip&&rawVal!=='*'&&!locked){
        if(!DB.juryScores[roomId][entryKey])DB.juryScores[roomId][entryKey]={};
        if(!DB.juryScores[roomId][entryKey][myId])DB.juryScores[roomId][entryKey][myId]={};
        DB.juryScores[roomId][entryKey][myId][f]='*';
      }
      return `<input class="score-inp${isEmpty?' empty-warn':''}${red?' red-score':''}" id="js-${f}-${i}" type="text" inputmode="decimal" value="${isSkipVal?'*':(effectiveLocked?'0':rawVal)}" placeholder="—" ${effectiveLocked?'disabled':''} style="${skipStyle}" title="${autoSkip?'管理員設定：此欄不適用此學生（不計分）':''}" onclick="if(!this.disabled)openNP('js-${f}-${i}','${lbl||f}',v=>{saveJCell(${i},'${roomId}','${entryKey}','${f}',v);})" readonly>`;
    };

    // 曲目格（直接從 DB.users 取最新填報值，確保永遠顯示最新資料）
    const _stu=DB.users.find(u=>u.id===e.studentId)||{};
    const _acKey=e.type==='elective'?'elec_ac':e.type+'_ac';
    const _atKey=e.type==='elective'?'elec_at':e.type+'_at';
    const _fcKey=e.type==='elective'?'elec_fc':e.type+'_fc';
    const _ftKey=e.type==='elective'?'elec_ft':e.type+'_ft';
    let _ac=_stu[_acKey]||e.ac||'';
    let _at=_stu[_atKey]||e.at||'';
    let _fc=_stu[_fcKey]||e.fc||'';
    let _ft=_stu[_ftKey]||e.ft||'';
    // ★ 修正：某些考場（如聲樂／流行演唱）學生的曲目可能填在「與本考場記錄修別不同」的修別下
    //   （例如以選修身分排入流行演唱考場，但曲目填在主修欄）。
    //   若本修別四個欄位皆為空，則自動回退到該生其他修別已填的曲目，避免曲目欄整列空白。
    if(!_ac&&!_at&&!_fc&&!_ft){
      const _fallbackTypes=['major','minor','elective'].filter(t=>t!==e.type);
      for(const _t of _fallbackTypes){
        const _ak=_t==='elective'?'elec_ac':_t+'_ac';
        const _tk=_t==='elective'?'elec_at':_t+'_at';
        const _ck=_t==='elective'?'elec_fc':_t+'_fc';
        const _fk=_t==='elective'?'elec_ft':_t+'_ft';
        if(_stu[_ak]||_stu[_tk]||_stu[_ck]||_stu[_fk]){
          _ac=_stu[_ak]||'';_at=_stu[_tk]||'';
          _fc=_stu[_ck]||'';_ft=_stu[_fk]||'';
          break;
        }
      }
    }
    const pieceCell=(composer,title)=>`<td class="piece-cell" style="min-width:180px">
      <div class="pc-composer" title="${composer||''}" style="word-break:break-word">${composer||'<span style="color:var(--border)">—</span>'}</div>
      <div class="pc-title" title="${title||''}" style="word-break:break-word;white-space:normal">${title||''}</div>
    </td>`;

    // 扣/缺考欄
    const absentCell=dq
      ?`<td style="text-align:center;padding:4px;vertical-align:middle">
          <span class="badge b-absent" style="font-size:8px;display:inline-block;line-height:1.4">⛔<br>扣考</span>
        </td>`
      :`<td class="absent-cell" style="vertical-align:middle">
          <input type="checkbox" ${absent?'checked':''} onchange="toggleAbsent(${i},'${roomId}','${entryKey}')" style="width:16px;height:16px;cursor:pointer;accent-color:var(--rust)">
        </td>`;

    // 學生資訊欄（字體放大、顏色清楚、寬度保持120px讓文字自然換行）
    const nameCell=`<td class="s-name-col" style="vertical-align:middle;padding:5px 7px;position:sticky;left:28px;z-index:10;background:inherit;width:120px;max-width:120px">
      <div style="font-size:14px;font-weight:800;color:var(--ink);word-break:break-word;white-space:normal;line-height:1.3;letter-spacing:.2px" title="${e.name}">${e.name}${isLive?`<span class="live-badge" style="margin-left:4px;font-size:11px">🎵</span>`:''}${isLive&&liveScaleKey?`<span class="scale-key-badge">${liveScaleKey}</span>`:''}
      </div>
      <div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--steel);font-weight:600;margin-top:3px;line-height:1.4">${e.class} · 座${e.seat}</div>
      <div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--ink);margin-top:1px;word-break:break-word;white-space:normal;line-height:1.4">${e.instName} <span style="color:var(--muted)">·</span> ${typeName(e.type)}</div>
      ${isBlack?`<div class="black-sign-badge" style="margin-top:3px">黑簽全曲</div>`:''}
      ${dq?`<div style="font-size:9px;font-weight:700;color:var(--red);word-break:break-word;white-space:normal;margin-top:2px" title="⛔ ${dq.reason}">⛔ ${dq.reason}</div>`:''}
    </td>`;

    // 備註欄
    const remarkVal=my._remark||'';
    const remarkText=my._remarkText||'';
    const remarkOptions=['','全曲未演奏完','曲目填寫不正確','曲目與演奏不符','樂曲不符合考試規定','未背譜（看譜演奏）','其他'];
    const remarkSel=`<select class="remark-sel${remarkVal?' has-remark':''}" id="jr-rem-${i}" onchange="saveJRemark(${i},'${roomId}','${entryKey}',this.value)">
      ${remarkOptions.map(o=>`<option value="${o}" ${remarkVal===o?'selected':''}>${o||'— 無備註 —'}</option>`).join('')}
    </select>
    ${remarkVal==='其他'?`<textarea class="remark-text-inp" id="jr-remtxt-${i}" placeholder="請說明..." onblur="saveJRemarkText(${i},'${roomId}','${entryKey}',this.value)">${remarkText}</textarea>`:''}`;

    const remarkCell=`<td class="remark-cell" style="vertical-align:top;border-left:1px solid var(--border)">${remarkSel}</td>`;

    // ★ 新版排版：
    // 列1（分數＋曲目行）：序(r2) | 學生(r2) | 扣缺(r2) | [評分欄×N] | 曲目欄 | 備註(r2)
    // 列2（評語行）      ：評語（colspan = 評分欄數+1，延伸至曲目欄下方）
    const scoreColCount=roomFields.length;

    // ★ 修正：曲目顯示不應綁定評分欄位 id。某些考場（如聲樂／流行演唱）使用自訂評分欄位
    //   （非 assigned/free），舊邏輯會因此完全不顯示曲目。改為「只要有指定曲或自選曲資料就顯示」，
    //   並在兩者皆無資料但有 assigned/free 欄位時仍保留空欄位提示。
    const _hasAssigned=roomFields.some(f=>f.id==='assigned');
    const _hasFree=roomFields.some(f=>f.id==='free');
    const _hasAssignedData=!!(_ac||_at);
    const _hasFreeData=!!(_fc||_ft);
    const _showAssigned=_hasAssigned||_hasAssignedData;
    const _showFree=_hasFree||_hasFreeData;
    const pieceLineStyle=`display:flex;gap:4px;align-items:baseline;line-height:1.55;word-break:break-word;flex-wrap:wrap`;
    const composerStyle=`font-size:12px;font-weight:600;color:var(--ink);white-space:nowrap`;
    const titleStyle=`font-size:11px;font-style:italic;color:var(--steel)`;
    const labelStyle=`font-family:DM Mono,monospace;font-size:9px;color:var(--muted);letter-spacing:.5px;white-space:nowrap;flex-shrink:0`;
    const pieceCellContent=
      `<div style="padding:5px 0 4px 0">`+
        (_showAssigned
          ?`<div style="${pieceLineStyle}">
              <span style="${labelStyle}">指定</span>
              <span style="${composerStyle}">${_ac||'<span style="color:var(--border)">—</span>'}</span>
              ${_at?`<span style="font-size:10px;color:var(--border)">/</span><span style="${titleStyle}">${_at}</span>`:''}
            </div>`
          :'')+
        (_showFree
          ?`<div style="${pieceLineStyle}${_showAssigned?';margin-top:4px;padding-top:4px;border-top:1px dashed var(--border)':''}">
              <span style="${labelStyle}">自選</span>
              <span style="${composerStyle}">${_fc||'<span style="color:var(--border)">—</span>'}</span>
              ${_ft?`<span style="font-size:10px;color:var(--border)">/</span><span style="${titleStyle}">${_ft}</span>`:''}
            </div>`
          :'')+
        ((!_showAssigned&&!_showFree)
          ?`<div style="font-size:11px;color:var(--border)">—</div>`
          :'')+
      `</div>`;

    // 列1
    let _row1=`<tr id="jr-${i}" class="${rowClass}">`;
    _row1+=`<td rowspan="2" style="text-align:center;font-family:DM Mono,monospace;font-size:11px;color:var(--muted);vertical-align:middle;border-right:1px solid var(--border);width:28px;padding:4px 1px;position:sticky;left:0;z-index:10;background:inherit">${String(e.order).padStart(2,'0')}</td>`;
    _row1+=`<td rowspan="2" style="padding:0;border-right:1px solid var(--border);width:120px;max-width:120px;position:sticky;left:28px;z-index:10;background:inherit">${nameCell.replace(/<td[^>]*>/,'').replace('</td>','')}</td>`;
    _row1+=`<td rowspan="2" style="border-right:1px solid var(--border);text-align:center;vertical-align:middle;width:36px">${absentCell.replace(/<td[^>]*>/,'').replace('</td>','')}</td>`;
    // 所有評分欄位（分數格）
    roomFields.forEach(f=>{
      const isAutoSkip=isFieldSkipped(f,e);
      _row1+=`<td style="border-left:1px solid var(--border);text-align:center;padding:3px 2px;width:58px;vertical-align:middle;${isAutoSkip?'background:rgba(202,111,30,0.05);':''}">${sc(f.id,f.label,f)}</td>`;
    });
    // 曲目欄（只在列1，列2由評語colspan覆蓋）
    _row1+=`<td style="padding:4px 10px;vertical-align:top;border-left:2px solid var(--gold);min-width:220px;background:inherit">${pieceCellContent}</td>`;
    // 備註欄（跨兩列）
    _row1+=`<td rowspan="2" style="vertical-align:top;border-left:1px solid var(--border);width:90px;max-width:110px;overflow:hidden">${remarkSel}</td>`;
    _row1+='</tr>';

    // 列2（評語行）：colspan = 評分欄數 + 1（延伸至曲目欄下方）
    let _row2=`<tr class="${rowClass}" style="border-bottom:2px solid var(--border)">`;
    _row2+=`<td colspan="${scoreColCount+1}" style="padding:2px 4px;border-top:1px dashed var(--border);border-left:1px solid var(--border)">
      <textarea class="comment-inp" id="jco-${i}" ${locked?'disabled':''} placeholder="${dq?'扣考，無需評語':'請填寫評語，如音色、音準、詮釋、技巧等...'}" onblur="saveJCell(${i},'${roomId}','${entryKey}','comment',this.value)" data-jc-i="${i}" data-jc-room="${roomId}" data-jc-key="${entryKey}" style="height:72px;font-size:12px;width:100%">${dq?'':(my.comment||'')}</textarea>
    </td>`;
    _row2+='</tr>';

    rows.push(_row1+_row2);
  });
  tbody.innerHTML=rows.join('');
}

function toggleAbsent(i,roomId,entryKey){
  const cb=document.querySelector(`#jr-${i} input[type=checkbox]`);
  const absent=cb.checked;
  const myId=ST.juryId||ST.user?.id||'admin';
  if(!DB.juryScores[roomId][entryKey])DB.juryScores[roomId][entryKey]={};
  if(!DB.juryScores[roomId][entryKey][myId])DB.juryScores[roomId][entryKey][myId]={};
  DB.juryScores[roomId][entryKey][myId].absent=absent;
  const r1=document.getElementById(`jr-${i}`);
  // ★ Bug3：動態取得考場所有評分欄位（不寫死 scale/assigned/free）
  const fields=getRoomFields(roomId).map(f=>f.id);
  if(absent){
    fields.forEach(f=>{const inp=document.getElementById(`js-${f}-${i}`);if(inp){inp.value='0';inp.disabled=true;}});
    const ta=document.getElementById(`jco-${i}`);if(ta){ta.disabled=true;}
    if(r1)r1.classList.add('jst-row-a');
    fields.forEach(f=>saveJCell(i,roomId,entryKey,f,'0'));
  }else{
    fields.forEach(f=>{const inp=document.getElementById(`js-${f}-${i}`);if(inp){inp.value='';inp.disabled=false;inp.classList.add('empty-warn');}});
    const ta=document.getElementById(`jco-${i}`);if(ta){ta.disabled=false;}
    if(r1)r1.classList.remove('jst-row-a');
  }
}

function saveJCell(i,roomId,entryKey,field,val){
  // ★ Bug6/9：管理員及監考員角色為唯讀，禁止寫入評分
  if(ST.role==='admin'||ST.role==='invigilator'){
    if(ST.role==='admin')showToast('管理員模式為唯讀，無法參與評分','warn');
    const inp=document.getElementById(`js-${field}-${i}`);
    if(inp)inp.value=inp.defaultValue||'';
    return;
  }
  const myId=ST.juryId||ST.user?.id||'admin';
  if(!DB.juryScores[roomId])DB.juryScores[roomId]={};
  if(!DB.juryScores[roomId][entryKey])DB.juryScores[roomId][entryKey]={};
  if(!DB.juryScores[roomId][entryKey][myId])DB.juryScores[roomId][entryKey][myId]={};
  const isSkip=(field!=='comment'&&val==='*');
  const v=field==='comment'?val:(isSkip?'*':(parseFloat(val)??0));
  DB.juryScores[roomId][entryKey][myId][field]=v;
  if(isSkip)DB.juryScores[roomId][entryKey][myId][field+'_skip']=true;
  else if(field!=='comment')delete DB.juryScores[roomId][entryKey][myId][field+'_skip'];
  const _jn=ST.juryName||ST.user?.name||'';
  if(_jn)DB.juryScores[roomId][entryKey][myId]._jurorName=_jn;
  // ★ 修正 #A1+#O1：附加本地時間戳，用於衝突偵測
  DB.juryScores[roomId][entryKey][myId]._localUpdatedAt=Date.now();

  const inp=document.getElementById(`js-${field}-${i}`);
  if(inp&&field!=='comment'){
    inp.classList.remove('empty-warn','red-score');
    if(isSkip){inp.style.color='var(--orange)';}
    else{inp.style.color='';inp.classList.toggle('red-score',parseFloat(v)<60);}
  }

  // ── 1. 永遠先存 localStorage ──
  const lsKey=`jury_${roomId}_${entryKey}_${myId}`;
  const snapshot=JSON.stringify(DB.juryScores[roomId][entryKey][myId]);
  try{localStorage.setItem(lsKey,snapshot);}catch(e){}

  // ── 2. 標記 pending ──
  markPending(lsKey);

  // ── 3. ★ 離線化方案：所有評分僅寫 localStorage，等中場儲存或送出時才上傳 ──
  showSyncStatus('pend','已暫存（送出時上傳）');
}

// ════════════════════════════════════════════════
// JURY REMARKS (備註)
// ════════════════════════════════════════════════
function saveJRemark(i,roomId,entryKey,val){
  const myId=ST.juryId||ST.user?.id||'admin';
  if(!DB.juryScores[roomId])DB.juryScores[roomId]={};
  if(!DB.juryScores[roomId][entryKey])DB.juryScores[roomId][entryKey]={};
  if(!DB.juryScores[roomId][entryKey][myId])DB.juryScores[roomId][entryKey][myId]={};
  DB.juryScores[roomId][entryKey][myId]._remark=val;
  const sel=document.getElementById('jr-rem-'+i);
  if(sel){sel.className='remark-sel'+(val?' has-remark':'');}
  const cell=sel?.closest('td');
  if(cell){
    let ta=document.getElementById('jr-remtxt-'+i);
    if(val==='其他'&&!ta){
      ta=document.createElement('textarea');ta.className='remark-text-inp';ta.id='jr-remtxt-'+i;ta.placeholder='請說明...';ta.rows=2;
      ta.addEventListener('blur',()=>saveJRemarkText(i,roomId,entryKey,ta.value));
      cell.appendChild(ta);
    }else if(val!=='其他'&&ta){ta.remove();}
  }
  const data=DB.juryScores[roomId][entryKey][myId];
  // ★ 離線化：備註只寫 localStorage，送出時批次上傳
  try{const lsKey=`jury_${roomId}_${entryKey}_${myId}`;localStorage.setItem(lsKey,JSON.stringify(data));markPending(lsKey);}catch(e){}
}
window.saveJRemark=saveJRemark;

function saveJRemarkText(i,roomId,entryKey,val){
  const myId=ST.juryId||ST.user?.id||'admin';
  if(!DB.juryScores[roomId]?.[entryKey]?.[myId])return;
  DB.juryScores[roomId][entryKey][myId]._remarkText=val;
  const data=DB.juryScores[roomId][entryKey][myId];
  // ★ 離線化：備註說明只寫 localStorage，送出時批次上傳
  try{const lsKey=`jury_${roomId}_${entryKey}_${myId}`;localStorage.setItem(lsKey,JSON.stringify(data));markPending(lsKey);}catch(e){}
}
window.saveJRemarkText=saveJRemarkText;

// ════════════════════════════════════════════════
// INVIGILATOR MODULE
// ════════════════════════════════════════════════
function renderInvigPage(){
  if(ST.role!=='invigilator'&&ST.role!=='admin')return;
  renderInvigRoomTabs();
  if(!ST.invigRoom&&DB.rooms.length)ST.invigRoom=DB.rooms[0];
  // 確保管理員也有 invigRoom（使用第一個考場）
  if(!ST.invigRoom&&DB.rooms.length)ST.invigRoom=DB.rooms[0];
  renderInvigTable();
}
window.renderInvigPage=renderInvigPage;

function renderInvigRoomTabs(){
  const el=document.getElementById('invig-room-tabs');if(!el)return;
  el.innerHTML=DB.rooms.map(r=>
    `<button class="invig-room-btn${(ST.invigRoom?.id===r.id||(!ST.invigRoom&&r===DB.rooms[0]))?' on':''}" onclick="invigSelectRoom('${r.id}',this)">${r.name}</button>`
  ).join('');
}
window.renderInvigRoomTabs=renderInvigRoomTabs;

function invigSelectRoom(roomId,btn){
  ST.invigRoom=DB.rooms.find(r=>r.id===roomId)||ST.invigRoom;
  document.querySelectorAll('.invig-room-btn').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  renderInvigTable();
}
window.invigSelectRoom=invigSelectRoom;

// ★ 取得某考場的排程 entries（供監考頁與大螢幕共用）
function _invigEntries(roomId){
  if(!roomId)return [];
  let entries;
  if(DB.savedScheduleSnapshot[roomId]&&DB.savedScheduleSnapshot[roomId].length){
    entries=DB.savedScheduleSnapshot[roomId].map(snap=>{
      const stu=DB.users.find(u=>u.id===snap.studentId)||{};
      const acKey=snap.type==='elective'?'elec_ac':(snap.type+'_ac');
      const atKey=snap.type==='elective'?'elec_at':(snap.type+'_at');
      const fcKey=snap.type==='elective'?'elec_fc':(snap.type+'_fc');
      const ftKey=snap.type==='elective'?'elec_ft':(snap.type+'_ft');
      return {...snap,ac:stu[acKey]??'',at:stu[atKey]??'',fc:stu[fcKey]??'',ft:stu[ftKey]??''};
    });
  } else {
    entries=getScheduleEntries().filter(e=>e.roomId===roomId);
  }
  return entries;
}
window._invigEntries=_invigEntries;

// ★ 取得某考生（此修別）適用的音階調性池：依「樂器大項 × 年級 × 修別」
function _scalePoolFor(roomId,entry){
  const mode=(DB.config.roomScaleMode||{})[roomId]||'auto';
  const rules=DB.config.scaleRules||{};
  if(mode!=='auto'){return rules[mode]||[];}
  const grade=aprGradeFromClass(entry.class);
  // 取考生樂器的大項（catId）；若 entry 沒帶 catId 則從樂器表查
  let catId=entry.catId;
  if(!catId&&entry.instId){
    const inst=(DB.instruments.items||[]).find(i=>i.id===entry.instId);
    catId=inst?inst.cat:'';
  }
  // 優先：樂器大項_年級_修別；退而求其次：年級_修別（相容舊資料）
  const key3=catId+'_'+grade+'_'+entry.type;
  if(rules[key3]&&rules[key3].length)return rules[key3];
  const key2=grade+'_'+entry.type;
  return rules[key2]||[];
}
window._scalePoolFor=_scalePoolFor;

function renderInvigTable(){
  const tbody=document.getElementById('invig-tbody');if(!tbody)return;
  const roomId=ST.invigRoom?.id;
  _renderInvigBigScreenBar(roomId);
  if(!roomId){tbody.innerHTML='<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--muted)">請先選擇考場</td></tr>';return;}
  const entries=_invigEntries(roomId);
  if(!entries.length){tbody.innerHTML='<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--muted)">此考場尚無排程資料（請先在後台「存檔排程」）</td></tr>';return;}
  if(!DB.blackSign[roomId])DB.blackSign[roomId]={};
  if(!DB.drawnScales[roomId])DB.drawnScales[roomId]={};
  const liveState=DB.liveExam[roomId]||{};
  const liveKey=liveState.playing||'';
  const liveStatus=liveState.status||'';
  const drawn=DB.drawnScales[roomId]||{};

  tbody.innerHTML=entries.map((e,i)=>{
    const entryKey=e.studentId+'_'+e.type;
    const isLive=liveKey===entryKey;
    const isBlack=isLive&&liveStatus==='black';
    const isAbsent=isLive&&liveStatus==='absent';
    const isTemp=isLive&&liveStatus==='temp';
    const pool=_scalePoolFor(roomId,e);
    const drawnVal=drawn[entryKey]||'';
    const hasDrawn=!!drawnVal;
    const rowBg=isBlack?'background:rgba(20,20,20,.10)':isAbsent?'background:rgba(166,77,53,.10)':isTemp?'background:rgba(123,79,160,.10)':isLive?'background:rgba(36,113,163,0.10)':'';
    // 抽籤欄：已抽→大字顯示調性(可改/重抽/清除)；未抽→抽籤鈕(有池) + 內建手動輸入(免彈窗)
    let drawCell;
    if(hasDrawn){
      drawCell=`<div style="display:flex;flex-direction:column;align-items:center;gap:5px">
        <div style="display:flex;align-items:center;gap:4px;background:var(--gold-bg);border:1.5px solid var(--gold);border-radius:14px;padding:3px 10px">
          <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--sage);font-weight:700">✓</span>
          <input class="scale-key-inp" id="iv-scale-${i}" type="text" value="${escHtml(drawnVal)}" style="width:84px;border:none;background:transparent;font-size:14px;font-weight:600;color:var(--ink);text-align:center" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" oninput="invigEditScale('${roomId}','${entryKey}',this.value)" onkeydown="if(event.key==='Enter'){this.blur();}">
        </div>
        <div style="display:flex;gap:5px">
          ${pool.length?`<button class="iv-draw-btn" style="font-size:8.5px;padding:3px 10px" onclick="invigDrawScale('${roomId}','${entryKey}',${i})" title="重新隨機抽一次">🎲 重抽</button>`:''}
          <button class="iv-st-btn" style="font-size:8px" onclick="invigResetScale('${roomId}','${entryKey}',${i})" title="清除此考生的抽籤">↺ 清除</button>
        </div>
      </div>`;
    } else {
      drawCell=`<div style="display:flex;flex-direction:column;align-items:center;gap:5px">
        ${pool.length?`<button class="iv-draw-btn" style="font-size:12px;padding:7px 18px" onclick="invigDrawScale('${roomId}','${entryKey}',${i})" title="${escHtml('調性池：'+pool.join('、'))}">🎲 抽籤</button>
        <span style="font-family:'DM Mono',monospace;font-size:7.5px;color:var(--muted)">考生上場前自行抽</span>`:''}
        <div style="display:flex;align-items:center;gap:3px;margin-top:${pool.length?'2px':'0'}">
          <input class="scale-key-inp" id="iv-scale-${i}" type="text" placeholder="或手動輸入調性" style="width:96px;font-size:12px" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" onkeydown="if(event.key==='Enter'){event.preventDefault();invigEditScale('${roomId}','${entryKey}',this.value,true);}" onblur="if(this.value.trim())invigEditScale('${roomId}','${entryKey}',this.value,true);">
        </div>
        ${pool.length?'':'<span style="font-family:\'DM Mono\',monospace;font-size:7.5px;color:var(--orange)">未設調性池·請手動輸入</span>'}
      </div>`;
    }
    return `<tr id="iv-row-${i}" style="${rowBg};transition:background .2s">
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);text-align:center">${String(e.order).padStart(2,'0')}</td>
      <td>
        <div style="font-weight:600;font-size:13px">${escHtml(e.name)}${isLive?'<span style="margin-left:6px;font-size:10px;color:#2471a3;font-family:\'DM Mono\',monospace">● 螢幕顯示中</span>':''}${hasDrawn&&!isLive?'<span style="margin-left:6px;font-size:9px;color:var(--sage);font-family:\'DM Mono\',monospace">●已抽待上台</span>':''}${_dqBadgeHtml(e.studentId,e.type)}</div>
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${escHtml(e.class)}·座${e.seat} · ${escHtml(e.instName)}·${typeName(e.type)}</div>
      </td>
      <td style="font-size:11px;color:var(--muted)">
        ${e.ac?`<div><span style="color:var(--ink)">${escHtml(e.ac)}</span> — ${escHtml(e.at)}</div>`:'—'}
        ${e.fc?`<div style="margin-top:2px;opacity:.7"><span style="color:var(--ink)">${escHtml(e.fc)}</span> — ${escHtml(e.ft)}</div>`:''}
      </td>
      <td style="text-align:center">
        <div class="iv-status-grp">
          <button class="iv-st-btn ${isBlack?'on-black':''}" onclick="invigSetStatus('${roomId}','${entryKey}',${i},'black')" title="黑籤：須演奏全曲">★ 黑籤</button>
          <button class="iv-st-btn ${isAbsent?'on-absent':''}" onclick="invigSetStatus('${roomId}','${entryKey}',${i},'absent')" title="缺考">缺考</button>
          <button class="iv-st-btn ${isTemp?'on-temp':''}" onclick="invigSetStatus('${roomId}','${entryKey}',${i},'temp')" title="臨時號">臨時號</button>
        </div>
      </td>
      <td style="text-align:center">
        <button class="playing-btn ${isLive?'playing':'idle'}" id="iv-play-${i}" onclick="toggleLivePlay('${roomId}','${entryKey}',${i})">
          ${isLive?'🎵 螢幕顯示中（點擊結束）':'▶ 上場顯示於大螢幕'}
        </button>
      </td>
      <td style="text-align:center">${drawCell}</td>
    </tr>`;
  }).join('');
}
window.renderInvigTable=renderInvigTable;

// ★ 監考頁頂部：大螢幕控制列
function _renderInvigBigScreenBar(roomId){
  let bar=document.getElementById('invig-bigscreen-bar');
  const tabs=document.getElementById('invig-room-tabs');
  if(!bar){
    bar=document.createElement('div');bar.id='invig-bigscreen-bar';bar.className='iv-bigscreen-bar';
    if(tabs&&tabs.parentNode)tabs.parentNode.insertBefore(bar,tabs.nextSibling);
  }
  const room=DB.rooms.find(r=>r.id===roomId);
  const mode=(DB.config.roomScaleMode||{})[roomId]||'auto';
  const modeLabel=mode==='auto'?'依考生年級×修別自動':_scaleRuleLabel(mode);
  bar.innerHTML=`
    <span class="lbl">🖥 大電視螢幕</span>
    <button class="iv-open-screen-btn" onclick="openBigScreen()">開啟大螢幕（新視窗）</button>
    <span class="lbl" style="margin-left:8px">音階規則：</span>
    <span class="iv-mode-pill" title="此考場套用的調性規則來源，可於管理後台設定">${escHtml(modeLabel)}</span>
    <span style="font-family:'DM Mono',monospace;font-size:8px;color:rgba(245,238,221,.5);margin-left:auto">${room?escHtml(room.name):''} · 上場時才把考生預抽的調性顯示到大螢幕</span>`;
}

// ★ 設定當前上場者狀態（black/absent/temp 三選一，再按一次取消）
function invigSetStatus(roomId,entryKey,rowIdx,status){
  if(!DB.liveExam[roomId])DB.liveExam[roomId]={};
  const cur=DB.liveExam[roomId];
  if(cur.playing!==entryKey){cur.playing=entryKey;}
  cur.status=(cur.status===status&&cur.playing===entryKey)?'':status;
  _afterLiveChange(roomId);
}
window.invigSetStatus=invigSetStatus;

// ★ 考生預抽：從調性池隨機抽一個，存到該考生暫存（不影響台上、不上大螢幕）
function invigDrawScale(roomId,entryKey,rowIdx){
  const entries=_invigEntries(roomId);
  const e=entries.find(x=>(x.studentId+'_'+x.type)===entryKey);
  if(!e)return;
  const pool=_scalePoolFor(roomId,e);
  if(!pool.length){
    // 沒有調性池：不彈窗（WebView/手機常被擋），改提示用該列的手動輸入框
    showToast(e.name+'：此樂器/年級/修別尚未設定調性池，請用右側欄位手動輸入調性','warn');
    // 把游標移到該列的手動輸入框，方便直接打字
    setTimeout(()=>{ const inp=document.getElementById('iv-scale-'+rowIdx); if(inp){inp.focus();} },50);
    return;
  }
  const pick=pool[Math.floor(Math.random()*pool.length)];
  if(!DB.drawnScales[roomId])DB.drawnScales[roomId]={};
  DB.drawnScales[roomId][entryKey]=pick;
  renderInvigTable();
  // 若這位剛好正在台上，立即同步到大螢幕
  if((DB.liveExam[roomId]||{}).playing===entryKey)_broadcastLive(roomId);
  showToast(e.name+' 抽到：'+pick,'ok');
}
window.invigDrawScale=invigDrawScale;

// ★ 監考手動修改/登記考生抽到的調性。commit=true 表示提交（會重繪以切換為「已抽」顯示）
function invigEditScale(roomId,entryKey,val,commit){
  if(!DB.drawnScales[roomId])DB.drawnScales[roomId]={};
  const had=!!DB.drawnScales[roomId][entryKey];
  if(val.trim()===''){delete DB.drawnScales[roomId][entryKey];}
  else DB.drawnScales[roomId][entryKey]=val.trim();
  const has=!!DB.drawnScales[roomId][entryKey];
  if((DB.liveExam[roomId]||{}).playing===entryKey)_broadcastLive(roomId);
  // 從「未抽」變「已抽」(或相反)時重繪，讓欄位切換成大字顯示／清除鈕
  if(commit||had!==has){
    const ae=document.activeElement;
    renderInvigTable();
    if(has){ const inp=document.getElementById('iv-scale-'+_rowIdxOf(roomId,entryKey)); if(inp&&ae&&ae.tagName==='INPUT'){/* 已切換顯示，不強制 focus */} }
  }
}
window.invigEditScale=invigEditScale;
// 找某 entryKey 在目前考場排序中的列索引
function _rowIdxOf(roomId,entryKey){
  const es=_invigEntries(roomId);
  for(let i=0;i<es.length;i++){ if((es[i].studentId+'_'+es[i].type)===entryKey)return i; }
  return -1;
}

// ★ 監考重置考生抽籤（清空，可重抽）
function invigResetScale(roomId,entryKey,rowIdx){
  if(DB.drawnScales[roomId])delete DB.drawnScales[roomId][entryKey];
  renderInvigTable();
  if((DB.liveExam[roomId]||{}).playing===entryKey)_broadcastLive(roomId);
  showToast('已重置，可重新抽籤','ok');
}
window.invigResetScale=invigResetScale;

// ★ 修正 R6：debounce helper for high-freq Firebase writes
const _fbDebouncers={};
function _debouncedFbSet(col,docId,data,ms=600){
  const k=col+'/'+docId;
  if(_fbDebouncers[k])clearTimeout(_fbDebouncers[k]);
  _fbDebouncers[k]=setTimeout(()=>{
    fbSet(col,docId,data);
    delete _fbDebouncers[k];
  },ms);
}

function toggleBlackSign(roomId,entryKey,rowIdx,checked){
  // ★ 舊黑簽改由 invigSetStatus('black') 處理，此函式保留相容
  invigSetStatus(roomId,entryKey,rowIdx,'black');
}
window.toggleBlackSign=toggleBlackSign;

function toggleLivePlay(roomId,entryKey,rowIdx){
  if(!DB.liveExam[roomId])DB.liveExam[roomId]={};
  const cur=DB.liveExam[roomId].playing||'';
  if(cur===entryKey){
    DB.liveExam[roomId]={playing:'',scaleKey:'',status:''};
  }else{
    DB.liveExam[roomId]={playing:entryKey,scaleKey:'',status:''};
  }
  _afterLiveChange(roomId);
}
window.toggleLivePlay=toggleLivePlay;

function saveScaleKey(roomId,entryKey,val){
  if(!DB.liveExam[roomId])DB.liveExam[roomId]={};
  if(DB.liveExam[roomId].playing!==entryKey)DB.liveExam[roomId].playing=entryKey;
  DB.liveExam[roomId].scaleKey=val;
  // 不重建監考表格（保護輸入 focus），但要把狀態推到大螢幕
  _broadcastLive(roomId);
}
window.saveScaleKey=saveScaleKey;

// ════════════════════════════════════════════════
// ★ 大螢幕同步層（BroadcastChannel + 選用 Firebase）
// ════════════════════════════════════════════════
// 切換考生/狀態後：更新本機監考頁 + 廣播到大螢幕
function _afterLiveChange(roomId){
  if(document.getElementById('pg-invigilator')&&document.getElementById('pg-invigilator').classList.contains('on')){
    renderInvigTable();
  }
  _broadcastLive(roomId);
}
window._afterLiveChange=_afterLiveChange;

// 取得某考場目前要顯示的完整資料（給大螢幕用）
function _liveDisplayData(roomId){
  const room=DB.rooms.find(r=>r.id===roomId);
  const st=DB.liveExam[roomId]||{};
  const entries=_invigEntries(roomId);
  const liveKey=st.playing||'';
  let cur=null,curIdx=-1;
  entries.forEach((e,i)=>{ if((e.studentId+'_'+e.type)===liveKey){cur=e;curIdx=i;} });
  let nextEntry=null;
  for(let i=curIdx+1;i<entries.length;i++){ nextEntry=entries[i]; break; }
  return {
    roomId,
    roomName:room?room.name:'',
    roomLocation:room?(room.location||''):'',
    playing:liveKey,
    status:st.status||'',
    scaleKey: liveKey ? ((DB.drawnScales[roomId]||{})[liveKey]||'') : '',
    current: cur?{
      order:cur.order, name:cur.name, class:cur.class, seat:cur.seat,
      instName:cur.instName, type:cur.type, typeName:typeName(cur.type),
      ac:cur.ac||'', at:cur.at||'', fc:cur.fc||'', ft:cur.ft||''
    }:null,
    next: nextEntry?{order:nextEntry.order,name:nextEntry.name}:null,
    ts: Date.now()
  };
}
window._liveDisplayData=_liveDisplayData;

// BroadcastChannel（同瀏覽器跨分頁，零延遲、零 Firebase 讀取）
let _liveBC=null;
function _getLiveBC(){
  if(_liveBC)return _liveBC;
  try{ _liveBC=new BroadcastChannel('exam_live_screen'); }catch(e){ _liveBC=null; }
  return _liveBC;
}
function _broadcastLive(roomId){
  const data=_liveDisplayData(roomId);
  // 1) 本機（同一分頁就是大螢幕的情況）
  if(typeof window._renderBigScreen==='function')window._renderBigScreen(data);
  // 2) 跨分頁
  const bc=_getLiveBC();
  if(bc){ try{ bc.postMessage(data); }catch(e){} }
  // 3) 跨裝置（選用）：寫一份到 Firebase，讓另一台電腦的大螢幕輪詢
  if(window._FB && (DB.config.liveScreenCrossDevice)){
    if(typeof _debouncedFbSet==='function')_debouncedFbSet('liveScreen',roomId,data,400);
    else fbSet('liveScreen',roomId,data);
  }
}
window._broadcastLive=_broadcastLive;

// 規則 key → 標籤
function _scaleRuleLabel(key){
  if(!key||key==='auto')return '依考生樂器×年級×修別自動';
  const gname=g=>'高'+({'1':'一','2':'二','3':'三'}[g]||g);
  const m3=String(key).match(/^([a-zA-Z]+)_(\d+)_(major|minor|elective)$/);
  if(m3){
    const cat=(DB.instruments.categories||[]).find(c=>c.id===m3[1]);
    return (cat?cat.name:m3[1])+'·'+gname(m3[2])+'·'+typeName(m3[3]);
  }
  const m2=String(key).match(/^(\d+)_(major|minor|elective)$/);
  if(m2){ return gname(m2[1])+' · '+typeName(m2[2]); }
  return key;
}
window._scaleRuleLabel=_scaleRuleLabel;

// ════════ 大螢幕：開啟 / 渲染 / 離開 ════════
function openBigScreen(){
  const roomId=ST.invigRoom?.id;
  if(!roomId){showToast('請先選擇考場','warn');return;}
  // 在新視窗開啟同一頁，帶上 display 參數與考場
  const url=location.pathname+'?display=1&room='+encodeURIComponent(roomId);
  const w=window.open(url,'exam_bigscreen_'+roomId,'width=1280,height=720');
  if(!w){showToast('瀏覽器阻擋了新視窗，請允許彈出視窗','warn');return;}
  // 立即推一次目前狀態
  setTimeout(()=>_broadcastLive(roomId),600);
  showToast('已開啟大螢幕視窗，請拖曳到電視並按 F11 全螢幕','ok');
}
window.openBigScreen=openBigScreen;

function exitBigScreen(){
  const bs=document.getElementById('bigscreen');
  if(bs)bs.classList.remove('show');
  // 若是獨立 display 視窗，直接關閉
  if(new URLSearchParams(location.search).get('display')==='1'){ window.close(); }
}
window.exitBigScreen=exitBigScreen;

// 渲染大螢幕內容
window._renderBigScreen=function(data){
  const bs=document.getElementById('bigscreen');
  if(!bs)return;
  // 只有在「display 模式視窗」或使用者主動切到大螢幕時才顯示
  if(!bs.classList.contains('show') && new URLSearchParams(location.search).get('display')!=='1')return;
  const roomEl=document.getElementById('bs-room');
  const centerEl=document.getElementById('bs-center');
  const nextEl=document.getElementById('bs-next');
  if(roomEl)roomEl.textContent=(data.roomName||'考場')+(data.roomLocation?(' · '+data.roomLocation):'');
  const c=data.current;
  if(!c){
    centerEl.innerHTML='<div class="bs-idle">等待考生上場…</div>';
    if(nextEl)nextEl.innerHTML = data.next?('下一位：<b>'+escHtml(data.next.name)+'</b>'):'';
    return;
  }
  let html='';
  html+='<div class="bs-order">第 '+String(c.order).padStart(2,'0')+' 號</div>';
  html+='<div class="bs-name">'+escHtml(c.name)+'</div>';
  html+='<div class="bs-meta">'+escHtml(c.class)+'<span class="sep">·</span>座號 '+escHtml(String(c.seat))
      +'<span class="sep">·</span><span class="bs-type-'+c.type+'">'+escHtml(c.typeName)+'</span>'
      +'<span class="sep">·</span>'+escHtml(c.instName)+'</div>';
  // 曲目
  let pieces='';
  if(c.ac)pieces+='<div><span class="composer">指定曲</span>　'+escHtml(c.ac)+' — '+escHtml(c.at)+'</div>';
  if(c.fc)pieces+='<div style="margin-top:.8vh"><span class="composer">自選曲</span>　'+escHtml(c.fc)+' — '+escHtml(c.ft)+'</div>';
  if(pieces)html+='<div class="bs-piece">'+pieces+'</div>';
  // 狀態 badge（黑籤/缺考/臨時號）優先大字顯示
  if(data.status==='black'){
    html+='<div class="bs-badge black">★ 黑　籤 ★</div><div class="bs-scale" style="margin-top:2vh"><div class="lbl">須演奏全曲</div></div>';
  }else if(data.status==='absent'){
    html+='<div class="bs-badge absent">缺　考</div>';
  }else if(data.status==='temp'){
    html+='<div class="bs-badge temp">臨　時　號</div>';
  }
  // 抽到的調性
  if(data.scaleKey){
    html+='<div class="bs-scale"><div class="lbl">抽　籤　調　性</div><div class="val">'+escHtml(data.scaleKey)+'</div></div>';
  }
  centerEl.innerHTML=html;
  if(nextEl)nextEl.innerHTML = data.next?('下一位：<b>'+escHtml(data.next.name)+'</b>'):'（最後一位）';
};

// 大螢幕時鐘
function _startBigScreenClock(){
  const tick=()=>{ const el=document.getElementById('bs-clock'); if(el){ const d=new Date(); el.textContent=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0'); } };
  tick(); setInterval(tick,1000);
}

// ════════ display 模式啟動（獨立大螢幕視窗）════════
window._initDisplayMode=function(){
  const params=new URLSearchParams(location.search);
  if(params.get('display')!=='1')return false;
  const roomId=params.get('room')||'';
  const bs=document.getElementById('bigscreen');
  if(bs)bs.classList.add('show');
  _startBigScreenClock();
  // 接收 BroadcastChannel
  try{
    const bc=new BroadcastChannel('exam_live_screen');
    bc.onmessage=(ev)=>{ if(ev.data && (!roomId || ev.data.roomId===roomId)) window._renderBigScreen(ev.data); };
  }catch(e){}
  // 跨裝置 fallback：若啟用，輪詢 Firebase liveScreen/{roomId}
  let lastTs=0;
  async function pollScreen(){
    if(!window._FB || !roomId)return;
    try{
      const doc= window._FB._rest ? await window._FB._get('liveScreen/'+roomId).catch(()=>null) : null;
      if(doc && doc.ts && doc.ts!==lastTs){ lastTs=doc.ts; window._renderBigScreen(doc); }
    }catch(e){}
  }
  // 只有跨裝置模式才輪詢（3 秒），否則完全不碰 Firebase
  if(DB.config && DB.config.liveScreenCrossDevice){
    pollScreen(); setInterval(pollScreen,3000);
  }
  // 初始畫面
  window._renderBigScreen(_liveDisplayData(roomId));
  return true;
};


// ── 離線 Pending 管理 ──
const PENDING_KEY='jury_pending_queue';
function markPending(lsKey){
  const p=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');
  if(!p.includes(lsKey)){p.push(lsKey);localStorage.setItem(PENDING_KEY,JSON.stringify(p));}
}
function unmarkPending(lsKey){
  const p=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');
  localStorage.setItem(PENDING_KEY,JSON.stringify(p.filter(k=>k!==lsKey)));
}

// ── 重新連線後批次同步所有 pending ──
async function syncPendingToFirebase(){
  if(!window._FB)return;
  if(window._fbAuthReady)await window._fbAuthReady;
  const pending=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');
  if(!pending.length)return;
  showSyncStatus('sync',`同步 ${pending.length} 筆離線資料...`);
  let ok=0,fail=0;
  // ★ 離線化方案：改成並行寫入（10 筆一批），90 筆從 ~60 秒縮到 ~10 秒
  const BATCH=10;
  for(let i=0;i<pending.length;i+=BATCH){
    const batch=pending.slice(i,i+BATCH);
    await Promise.all(batch.map(async lsKey=>{
      try{
        const data=JSON.parse(localStorage.getItem(lsKey)||'null');
        if(!data){unmarkPending(lsKey);return;}
        const stripped=lsKey.replace(/^jury_/,'');
        // ★ 修正：roomId 一定是「第一個底線之前」的部分（格式 r+數字，本身不含底線）
        //   entryKey 一定以 _major / _minor / _elective 結尾，剩下的才是 jurorId
        //   這個方法不依賴 jurorId 的格式，無論是 JN_roomId_姓名 或老師帳號 ID（如 a001）都能正確切割
        let roomId='', entryKey='', jurorId='';
        const firstUnderscore=stripped.indexOf('_');
        if(firstUnderscore<0){console.warn('[sync] lsKey 缺少 roomId 分隔：',lsKey);return;}
        roomId=stripped.slice(0,firstUnderscore);
        const rest=stripped.slice(firstUnderscore+1); // studentId_type_jurorId
        const TYPES=['major','minor','elective'];
        for(const t of TYPES){
          const marker='_'+t;
          const idx=rest.lastIndexOf(marker);
          if(idx>=0){
            entryKey=rest.slice(0, idx+marker.length); // studentId_type
            jurorId=rest.slice(idx+marker.length+1);   // 剩下的是 jurorId（不限格式）
            break;
          }
        }
        if(!roomId||!entryKey||!jurorId){console.warn('[sync] lsKey 解析失敗：',lsKey);return;}
        const patch={};
        patch[jurorId]={...data};
        try{
          if(window._FB._rest){
            const success=await window._FB._set('juryScores/'+roomId+'/entries/'+entryKey,patch);
            if(success){unmarkPending(lsKey);ok++;}else{fail++;}
          }else{
            const {db,serverTimestamp}=window._FB;
            const finalPatch={...patch,_updatedAt:serverTimestamp()};
            await db.collection('juryScores').doc(roomId).collection('entries').doc(entryKey).set(finalPatch,{merge:true});
            unmarkPending(lsKey);ok++;
          }
        }catch(e){fail++;}
      }catch(e){fail++;}
    }));
    // 每批之間更新一下進度
    showSyncStatus('sync',`同步中... ${ok}/${pending.length}`);
  }
  if(fail>0)showSyncStatus('pend',`已同步 ${ok} 筆 ✓（${fail} 筆失敗，下次再試）`);
  else showSyncStatus('ok',`已同步 ${ok} 筆 ✓`);
}

window.addEventListener('online',()=>{
  ST.isOnline=true;
  document.getElementById('off-bar').classList.remove('show');
  showToast('已重新連線，正在同步...','ok');
  setTimeout(syncPendingToFirebase,800);
});

// ★ U2：頁面關閉/重整前 flush pending Firebase 寫入
window.addEventListener('beforeunload',()=>{
  // 立即執行所有 debounce 中的寫入
  if(window._jcDebounce){
    Object.entries(window._jcDebounce).forEach(([k,timerId])=>{
      clearTimeout(timerId);
      // 注意：beforeunload 只有 ~5ms，async 寫入可能無法完成
      // 但已先存到 localStorage，下次連線會 sync
    });
  }
  // 嘗試同步 pending 資料（瀏覽器可能阻擋 fetch，但已有 LS 備份）
  if(navigator.onLine&&window._FB&&typeof syncPendingToFirebase==='function'){
    try{syncPendingToFirebase();}catch(e){}
  }
});

// ★ 頁面隱藏時也 flush（更可靠，因為 beforeunload 在 mobile 不一定觸發）
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'&&navigator.onLine&&window._FB){
    if(window._jcDebounce){
      Object.values(window._jcDebounce).forEach(t=>clearTimeout(t));
      window._jcDebounce={};
    }
    if(typeof syncPendingToFirebase==='function')syncPendingToFirebase();
  }
});

// ★ 管理員後台現場評分 - 考場切換按鈕 + 下拉選單
function initJuryAdminRoomBar(){
  const bar=document.getElementById('jury-admin-room-bar');
  if(!bar)return;
  if(ST.role!=='admin'){bar.style.display='none';return;}
  bar.style.display='flex';
  const curId=ST._adminJuryRoomId||(DB.rooms[0]?.id||'');
  if(!ST._adminJuryRoomId&&DB.rooms.length){
    ST._adminJuryRoomId=DB.rooms[0].id;
    ST.juryRoom=DB.rooms[0];
  }
  // ── 填入 select ──
  const sel=document.getElementById('jury-admin-room-select');
  if(sel){
    sel.innerHTML=DB.rooms.map(r=>`<option value="${r.id}"${r.id===curId?' selected':''}>${r.name}</option>`).join('');
  }
  // ── 填入按鈕列（輔助，小螢幕可自動換行） ──
  const btnsWrap=document.getElementById('jury-admin-room-btns');
  if(btnsWrap){
    btnsWrap.innerHTML='';
    DB.rooms.forEach(r=>{
      const btn=document.createElement('button');
      btn.className='btn btn-sm '+(r.id===curId?'btn-p':'btn-s');
      btn.textContent=r.name;
      btn.onclick=()=>adminJurySelectRoom(r.id,btn);
      btnsWrap.appendChild(btn);
    });
  }
  // 更新考場顯示標題
  const activeRoom=DB.rooms.find(r=>r.id===curId)||DB.rooms[0];
  if(activeRoom)_updateJuryRoomDisplay(activeRoom);
}
window.initJuryAdminRoomBar=initJuryAdminRoomBar;

function adminJurySelectRoom(roomId,btn){
  ST._adminJuryRoomId=roomId;
  const r=DB.rooms.find(x=>x.id===roomId);
  if(r){ST.juryRoom=r;_updateJuryRoomDisplay(r);}
  // 同步 select 選單
  const sel=document.getElementById('jury-admin-room-select');
  if(sel)sel.value=roomId;
  // 同步按鈕狀態
  const btnsWrap=document.getElementById('jury-admin-room-btns');
  if(btnsWrap)btnsWrap.querySelectorAll('button').forEach(b=>{
    b.className='btn btn-sm '+(b.textContent===(r?.name||'')&&b===btn?'btn-p':b===btn?'btn-p':'btn-s');
  });
  // 更精準：用 roomId 比較
  if(btnsWrap)btnsWrap.querySelectorAll('button').forEach(b=>{
    const isActive=DB.rooms.find(x=>x.id===roomId)?.name===b.textContent;
    b.className='btn btn-sm '+(isActive?'btn-p':'btn-s');
  });
  renderJuryTable();
}
window.adminJurySelectRoom=adminJurySelectRoom;

function _updateJuryRoomDisplay(r){
  const rd=document.getElementById('jury-room-disp');if(rd)rd.textContent=r.name||'—';
  const ld=document.getElementById('jury-location-disp');if(ld)ld.textContent=r.location||'';
  const dd=document.getElementById('jury-datetime-disp');
  if(dd){
    const fmt=dt=>{if(!dt)return'';const d=new Date(dt);return isNaN(d)?dt:d.toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit'});};
    if(r.dateStart)dd.textContent=fmt(r.dateStart)+(r.dateEnd?' ～ '+fmt(r.dateEnd):'');
    else dd.textContent='';
  }
  const nd=document.getElementById('jury-name-disp');if(nd)nd.textContent=ST.juryName||ST.user?.name||'—';
}

// Check before submit
// ★ 強制儲存所有尚未 blur 的評語（防止直接按送出/確認時評語遺漏）
function flushAllComments(){
  // ★ 修正 #FE1：用 dataset 而非 regex 解析 onblur 字串
  document.querySelectorAll('.comment-inp[id^="jco-"]').forEach(ta=>{
    const i=ta.dataset.jcI;
    const roomId=ta.dataset.jcRoom;
    const entryKey=ta.dataset.jcKey;
    if(i!==undefined&&roomId&&entryKey){
      saveJCell(parseInt(i),roomId,entryKey,'comment',ta.value);
    }
  });
}

function checkJuryBeforeSubmit(){
  // ★ Bug6 修正：管理員唯讀，禁止送出評分
  if(ST.role==='admin'){showToast('管理員模式為唯讀，無法送出評分','warn');return;}
  flushAllComments(); // ★ 先強制存評語
  const entries=getJuryEntries();
  const roomId=ST.juryRoom?.id||'r1';
  const myId=ST.juryId||ST.user?.id||'admin';
  // ★ 修正 #L1：用動態欄位（getRoomFields）而非硬編碼三欄位
  const allFields=getRoomFields(roomId);
  const missing=[];
  entries.forEach((e,i)=>{
    const entryKey=e.studentId+'_'+e.type;
    const my=DB.juryScores[roomId]?.[entryKey]?.[myId]||{};
    const isDQ=DB.disqualified?.[entryKey];if(my.absent||isDQ)return;
    // ★ 排除被 skipRules 命中的欄位（autoSkip 不需評）
    const activeFields=allFields.filter(f=>!isFieldSkipped(f,e));
    const emptyFields=activeFields.filter(f=>my[f.id]===undefined||my[f.id]===''||my[f.id]===null);
    if(emptyFields.length)missing.push({name:e.name,inst:e.instName,type:typeName(e.type),fields:emptyFields.map(f=>f.label||f.id)});
  });
  const body=document.getElementById('check-modal-body');
  const confirmBtn=document.getElementById('check-confirm-btn');
  if(missing.length){
    body.innerHTML=`<div style="color:var(--rust);font-family:DM Mono,monospace;font-size:11px;margin-bottom:14px">⚠ 以下學生尚有未填分數</div>`+
      missing.map(m=>`<div style="padding:8px 12px;background:var(--cream);border-radius:var(--r);margin-bottom:6px;font-size:13px">
        <strong>${m.name}</strong> <span style="color:var(--muted);font-size:11px">${m.inst}·${m.type}</span>
        <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--rust);margin-top:4px">未填：${m.fields.join('、')}</div>
      </div>`).join('');
    confirmBtn.style.display='none';
  }else{
    body.innerHTML=`<div style="color:var(--sage);font-family:DM Mono,monospace;font-size:12px;text-align:center;padding:16px">✓ 所有分數均已填寫完畢，可以送出。</div>`;
    confirmBtn.style.display='inline-flex';
  }
  openOverlay('check-modal');
}

function confirmSubmitJury(){closeOverlay('check-modal');submitJuryAll();}

// ★ 中場儲存：把目前 localStorage 的暫存推上 Firebase，但不結束評分流程
//   評審可隨時按此按鈕做雲端備份（如午休、休息時段）
async function midSaveJury(){
  if(ST.role==='admin'){showToast('管理員模式為唯讀','warn');return;}
  if(window._midSavingJury){return;}
  window._midSavingJury=true;

  flushAllComments(); // 把還在編輯中的評語先寫進 DB

  if(!navigator.onLine){
    showToast('目前離線，無法上傳。請連上網路後再試','err');
    window._midSavingJury=false;
    return;
  }
  if(!window._FB){
    showToast('系統未初始化，無法上傳','err');
    window._midSavingJury=false;
    return;
  }

  showSyncStatus('sync','中場儲存中...');
  try{
    await syncPendingToFirebase();
    const stillPending=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');
    // ★ 重新更新 session 時間戳（避免 72hr 過期）
    try{
      const roomId=ST.juryRoom?.id;
      if(roomId&&ST.juryId&&ST.juryName){
        localStorage.setItem('_jurySession_'+roomId,JSON.stringify({juryId:ST.juryId,name:ST.juryName,savedAt:Date.now()}));
      }
    }catch(e){}
    if(stillPending.length){
      showToast(`部分資料未上傳成功（${stillPending.length} 筆），下次儲存或送出時會再試`,'warn');
      showSyncStatus('pend',`${stillPending.length} 筆待上傳`);
    } else {
      showToast('✓ 中場儲存完成，可繼續評分','ok');
      showSyncStatus('ok','已儲存 ✓');
    }
  }catch(e){
    showToast('中場儲存失敗：'+(e.message||e),'err');
    showSyncStatus('pend','儲存失敗');
  }finally{
    setTimeout(()=>{window._midSavingJury=false;},2000);
  }
}
window.midSaveJury=midSaveJury;

async function submitJuryAll(){
  // ★ Bug6 修正：管理員唯讀，禁止送出
  if(ST.role==='admin'){showToast('管理員模式為唯讀，無法送出評分','warn');return;}
  // ★ 修正 #A2：真實等待 pending queue 同步完成
  flushAllComments();
  showSyncStatus('sync','正在送出...');
  // 防重複點擊
  if(window._submittingJury){return;}
  window._submittingJury=true;
  try{
    if(window._FB&&navigator.onLine){
      await syncPendingToFirebase();
      const stillPending=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');
      if(stillPending.length){
        showSyncStatus('pend',`${stillPending.length} 筆未同步，請保持連線後重試`);
        if(!confirm(`目前還有 ${stillPending.length} 筆評分等待上傳，是否仍要送出？\n（建議：點「取消」並等待網路恢復後再送出）`)){
          window._submittingJury=false;
          return;
        }
      }
    } else if(!navigator.onLine){
      const pending=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');
      if(!confirm(`目前離線，有 ${pending.length} 筆評分尚未上傳。\n離線送出後仍需等網路恢復才會同步至伺服器。確定送出？`)){
        window._submittingJury=false;
        return;
      }
    }
    document.getElementById('ty-title-el').textContent=DB.config.tyTitle||'感謝您的評分';
    document.getElementById('ty-text-el').textContent=DB.config.tyText||'';
    showSyncStatus('ok','全部已同步 ✓');
    openOverlay('ty-modal');
    // ★ Bug7：送出後重新讀取此考場的 juryScores，確保管理員介面立即看到最新成績
    const submitRoomId=ST.juryRoom?.id||DB.rooms[0]?.id||'';
    if(submitRoomId&&window._FB){
      try{
        const fresh=await window._FB._list('juryScores/'+submitRoomId+'/entries');
        if(fresh&&fresh.length){
          if(!DB.juryScores[submitRoomId])DB.juryScores[submitRoomId]={};
          fresh.forEach(d=>{const{id,...rest}=d;DB.juryScores[submitRoomId][id]=rest;});
          if(typeof renderResults==='function')renderResults();
          if(typeof renderAdminResults==='function')renderAdminResults();
        }
      }catch(e){console.warn('[Bug7] reload juryScores failed',e);}
    }

    // ★ 送出成功後清除 localStorage 中本評審的所有 jury_* 資料
    //   避免下次重新登入時舊資料被誤還原覆蓋掉 Firebase 上的最新版
    try{
      const myJurorId=ST.juryId;
      if(myJurorId){
        const keysToRemove=[];
        for(let i=0;i<localStorage.length;i++){
          const key=localStorage.key(i);
          if(!key||!key.startsWith('jury_'))continue;
          // 該 key 是否屬於本評審
          if(key.endsWith('_'+myJurorId))keysToRemove.push(key);
        }
        keysToRemove.forEach(k=>{
          try{localStorage.removeItem(k);}catch(e){}
        });
        // ★ 修正：pending queue 只移除自己的 key，不影響別人
        try{
          const p=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');
          const remaining=p.filter(k=>!k.endsWith('_'+myJurorId));
          if(remaining.length){
            localStorage.setItem(PENDING_KEY,JSON.stringify(remaining));
          }else{
            localStorage.removeItem(PENDING_KEY);
          }
        }catch(e){}
        // ★ 同時清掉本評審的 session（送出後不應再「沿用舊身分」）
        try{localStorage.removeItem('_jurySession_'+(ST.juryRoom?.id||''));}catch(e){}
        console.log('[jury submit] 已清除 '+keysToRemove.length+' 筆本機暫存資料 + session');
      }
    }catch(e){console.warn('[jury submit] 清除 localStorage 失敗',e);}
  }finally{
    setTimeout(()=>{window._submittingJury=false;},2000);
  }
}

// ════════════════════════════════════════════════
// SCORING ALGORITHM (per-item trimming)
// ════════════════════════════════════════════════
function getTrimRule(n){
  return DB.config.trimRules.find(r=>n>=r.minJ&&n<=r.maxJ)||{trimH:0,trimT:0};
}

function trimmedAvg(scores,field){
  // ★ #6 排除 * 標記的分數（評審選擇不評此項）
  const activeScores=scores.filter(s=>s[field]!=='*'&&s[field+'_skip']!==true);
  const vals=activeScores.map(s=>{
    // ★ 評分超過年級上限、尚待管理員審核時，暫以該年級上限計分
    if(s[field+'_pendingCap']!=null)return s[field+'_pendingCap'];
    return parseFloat(s[field])||0;
  });
  const n=vals.length;
  if(!n)return{avg:0,kept:[],removed:[],rule:{trimH:0,trimT:0},skipped:scores.length-n};
  const rule=getTrimRule(n);
  const sorted=[...vals].sort((a,b)=>a-b);
  const kept=sorted.slice(rule.trimT,rule.trimH?-rule.trimH:undefined);
  if(!kept.length)return{avg:0,kept,removed:[],rule,skipped:scores.length-n};
  return{avg:kept.reduce((s,v)=>s+v,0)/kept.length,kept,removed:sorted.filter(v=>!kept.includes(v)),rule,skipped:scores.length-n};
}

function calcFinal(scoreArr,roomId,entry){
  const active=scoreArr.filter(s=>!s.absent);
  if(!active.length)return{finalScore:0,fS:0,fA:0,fF:0,fieldAvgs:{},detail:{}};
  const fields=getRoomFields(roomId||'r1');
  const fieldRes={};

  // ★ 修正：對每個 entry 個別計算哪些欄被 skipRules 命中（autoSkip），
  //    被排除的欄不計分，其比重按「redistribution 設定」重分配給其他欄；
  //    若無設定 redistribution，則按其他欄各自的 pct 比例均攤。
  let finalScore=0;
  if(entry){
    // 計算各欄是否被 autoSkip（管理員設定的排除條件）
    const skipped=new Set(fields.filter(f=>isFieldSkipped(f,entry)).map(f=>f.id));
    // ★ 修正 Q2：即使管理員沒設排除條件，只要「全部評審」都把該欄打 *（不計分），
    //    也視為該欄被跳過，比重同樣按 redistribution 規則重分配給其他欄
    fields.forEach(f=>{
      if(skipped.has(f.id))return;
      const allStar=active.every(s=>s[f.id]==='*'||s[f.id+'_skip']===true);
      if(allStar)skipped.add(f.id);
    });
    const activeFields=fields.filter(f=>!skipped.has(f.id));
    const skippedFields=fields.filter(f=>skipped.has(f.id));

    // 計算各欄最終有效 pct（重分配後）
    const effectivePct={};
    activeFields.forEach(f=>effectivePct[f.id]=f.pct);

    // 處理 skipped 欄的 redistribution
    skippedFields.forEach(sf=>{
      const redist=sf.redistribution||[];
      if(redist.length){
        // 有明確的重分配設定：按設定把 sf.pct 分給指定欄
        const total=redist.reduce((s,r)=>s+(r.pct||0),0);
        redist.forEach(r=>{
          if(effectivePct[r.fieldId]!==undefined&&total>0){
            effectivePct[r.fieldId]+=(r.pct/total)*sf.pct;
          }
        });
      } else {
        // 無設定：按其他 active 欄的 pct 比例均攤
        const activePctSum=activeFields.reduce((s,f)=>s+(f.pct||0),0);
        if(activePctSum>0){
          activeFields.forEach(f=>{
            effectivePct[f.id]+=(f.pct/activePctSum)*sf.pct;
          });
        }
      }
    });

    // 計算最終分數
    fields.forEach(f=>{
      const res=trimmedAvg(active,f.id);
      fieldRes[f.id]=res;
      if(!skipped.has(f.id)){
        finalScore+=res.avg*((effectivePct[f.id]||0)/100);
      }
    });
  } else {
    // 無 entry 資訊時（舊相容模式）：直接用 pct 計算
    fields.forEach(f=>{
      const res=trimmedAvg(active,f.id);
      fieldRes[f.id]=res;
      finalScore+=res.avg*(f.pct/100);
    });
  }

  finalScore=Math.round(finalScore*100)/100;
  const fS=fieldRes['scale']?.avg??fieldRes[fields[0]?.id]?.avg??0;
  const fA=fieldRes['assigned']?.avg??fieldRes[fields[1]?.id]?.avg??0;
  const fF=fieldRes['free']?.avg??fieldRes[fields[2]?.id]?.avg??0;
  return{finalScore,fS,fA,fF,fieldAvgs:Object.fromEntries(fields.map(f=>[f.id,fieldRes[f.id]?.avg??0])),detail:fieldRes};
}

// ════════════════════════════════════════════════
// SCHEDULE
// ════════════════════════════════════════════════
function generateSchedule(){schApplySort();showToast('已自動生成出場順序 ✓','ok');}

// ── 排序狀態 ──
// instOrder: [{id,active}] / typeOrder: [{key,label,active}] / classOrder: [{cls,active}]
// ★ 每個考場有獨立狀態，用 _roomStates map 儲存
const _SCH_ROOM_STATES = {}; // {roomId: SCH_STATE_snapshot}

function _makeDefaultSchState(){
  return {
    roomId:'',
    catOrder:[],
    instOrder:[],
    typeOrder:[{key:'major',label:'主修',active:true},{key:'minor',label:'副修',active:true},{key:'elective',label:'選修',active:true}],
    classOrder:[],
    excludeRules:[],  // [{catId, type}] 排除這些「大項×修別」組合的學生
    seatDir:1,
    extraEntries:[],
    removedEntries:new Set(),
  };
}

let SCH_STATE=_makeDefaultSchState();

function _saveRoomState(roomId){
  const key=roomId||'__all__';
  _SCH_ROOM_STATES[key]={
    catOrder:SCH_STATE.catOrder.map(c=>({...c})),
    instOrder:SCH_STATE.instOrder.map(i=>({...i})),
    typeOrder:SCH_STATE.typeOrder.map(t=>({...t})),
    classOrder:SCH_STATE.classOrder.map(c=>({...c})),
    seatDir:SCH_STATE.seatDir,
    extraEntries:[...SCH_STATE.extraEntries],
    removedEntries:new Set(SCH_STATE.removedEntries),
    excludeRules:[...(SCH_STATE.excludeRules||[])],
    manualOrder:[...(SCH_STATE.manualOrder||[])],  // ★ 保留手動排序
  };
}
function _loadRoomState(roomId){
  const key=roomId||'__all__';
  const saved=_SCH_ROOM_STATES[key];
  if(saved){
    SCH_STATE.catOrder=saved.catOrder.map(c=>({...c}));
    SCH_STATE.instOrder=saved.instOrder.map(i=>({...i}));
    SCH_STATE.typeOrder=saved.typeOrder.map(t=>({...t}));
    SCH_STATE.classOrder=saved.classOrder.map(c=>({...c}));
    SCH_STATE.seatDir=saved.seatDir;
    SCH_STATE.extraEntries=[...saved.extraEntries];
    SCH_STATE.removedEntries=new Set(saved.removedEntries);
    SCH_STATE.excludeRules=[...(saved.excludeRules||[])];
    SCH_STATE.manualOrder=[...(saved.manualOrder||[])];  // ★ 還原手動排序
    return true;
  }
  // 新考場：清掉舊 manualOrder
  SCH_STATE.manualOrder=[];
  return false;
}

function schSelectRoom(roomId,btn){
  // 儲存目前考場的篩選狀態
  _saveRoomState(SCH_STATE.roomId);
  // 切換 roomId
  SCH_STATE.roomId=roomId;
  // 更新按鈕樣式
  document.querySelectorAll('#sch-room-tabs button').forEach(b=>{
    b.className='btn btn-s btn-sm';
  });
  if(btn){btn.className='btn btn-p btn-sm';}
  // 載入目標考場的篩選狀態（若有），否則重新初始化
  const hasState=_loadRoomState(roomId);
  if(!hasState){
    // 新考場，清空所有 order 讓 schInitSortUI 根據考場預設值重建
    SCH_STATE.catOrder=[];SCH_STATE.instOrder=[];SCH_STATE.classOrder=[];
    SCH_STATE.seatDir=1;
  } else {
    // 已有儲存狀態，但若考場 allowedCats 和已存的 catOrder 有衝突，不覆蓋（尊重使用者設定）
  }
  schInitSortUI();
  renderSchedule();
  // ★ 顯示考場時間資訊
  const _sd=document.getElementById('sch-room-info');
  const _st=document.getElementById('sch-room-info-text');
  if(_sd&&_st){
    if(roomId){
      const _r=DB.rooms.find(r=>r.id===roomId);
      if(_r){
        const dt=_fmtRoomDatetime(_r);
        const loc=_r.location?'📍 '+_r.location:'';
        const parts=[dt,loc].filter(Boolean);
        if(parts.length){_st.innerHTML='<strong>'+escHtml(_r.name)+'</strong>　'+parts.map(p=>escHtml(p)).join('　');_sd.style.display='block';}
        else _sd.style.display='none';
      } else _sd.style.display='none';
    } else {
      const lines=DB.rooms.map(r=>{const dt=_fmtRoomDatetime(r);return dt?('<strong>'+escHtml(r.name)+'</strong>　'+escHtml(dt)+(r.location?'　📍 '+escHtml(r.location):'')):'';}).filter(Boolean);
      if(lines.length){_st.innerHTML=lines.join('<br>');_sd.style.display='block';}
      else _sd.style.display='none';
    }
  }
}
window.schSelectRoom=schSelectRoom;

function schInitRoomTabs(){
  const el=document.getElementById('sch-room-tabs');if(!el)return;
  el.innerHTML='';
  const curId=SCH_STATE.roomId;
  const all=document.createElement('button');
  all.className='btn btn-sm '+(curId===''?'btn-p':'btn-s');
  all.textContent='全部考場';
  all.onclick=()=>schSelectRoom('',all);
  el.appendChild(all);
  DB.rooms.forEach(r=>{
    const btn=document.createElement('button');
    btn.className='btn btn-sm '+(curId===r.id?'btn-p':'btn-s');
    btn.textContent=r.name;
    btn.onclick=()=>schSelectRoom(r.id,btn);
    el.appendChild(btn);
  });
}

function schInitSortUI(){
  // ─── 決定此考場「預設應顯示」的 cats ───
  // 若選了特定考場，根據其 allowedCats/cats 判斷
  // 若為全部考場，全部 active
  const roomId=SCH_STATE.roomId;
  const curRoom=roomId?DB.rooms.find(r=>r.id===roomId):null;
  // allowedCats 作為「依考場重設」時的預設，不自動套用
  const roomAllowedCats=curRoom?(curRoom.allowedCats||curRoom.cats||[]):null;

  const allCatIds=DB.instruments.categories.sort((a,b)=>a.order-b.order).map(c=>c.id);
  const prevCatMap=Object.fromEntries(SCH_STATE.catOrder.map(c=>[c.id,c]));
  SCH_STATE.catOrder=allCatIds.map(cid=>{
    const cat=DB.instruments.categories.find(c=>c.id===cid);
    const prev=prevCatMap[cid];
    if(prev)return {id:cid,name:cat?.name||cid,active:prev.active};
    // 新考場：若有 allowedCats 就按它預設，無考場（全部）則全 active
    const defaultActive=roomAllowedCats?roomAllowedCats.includes(cid):true;
    return {id:cid,name:cat?.name||cid,active:defaultActive};
  });

  // instOrder — 全部樂器，依大項順序排列
  const allInsts=DB.instruments.items.slice().sort((a,b)=>{
    const ci=allCatIds.indexOf(a.cat)-allCatIds.indexOf(b.cat);
    return ci!==0?ci:(a.order-b.order);
  });
  const prevInstMap=Object.fromEntries(SCH_STATE.instOrder.map(i=>[i.id,i]));
  SCH_STATE.instOrder=allInsts.map(i=>{
    const prev=prevInstMap[i.id];
    if(prev)return {id:i.id,name:i.name,active:prev.active};
    const catActive=roomAllowedCats?roomAllowedCats.includes(i.cat):true;
    return {id:i.id,name:i.name,active:catActive};
  });

  // 班級
  if(!SCH_STATE.classOrder.length||SCH_STATE.classOrder.map(c=>c.cls).join()!==DB.classes.join()){
    SCH_STATE.classOrder=DB.classes.map(c=>({cls:c,active:true}));
  }
  renderSchCatUI();
  renderSchInstUI();
  renderSchTypeUI();
  renderSchClassUI();
  schRenderSeatBtns();
  renderSchExcludeUI();
}
window.schInitSortUI=schInitSortUI;

// ★ 排除規則 UI
function renderSchExcludeUI(){
  // 填入大項下拉
  const catSel=document.getElementById('sch-excl-cat');
  if(catSel){
    const prev=catSel.value;
    catSel.innerHTML='<option value="">全部大項</option>'+
      DB.instruments.categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
    catSel.value=prev;
  }
  // 填入班級下拉
  const clsSel=document.getElementById('sch-excl-cls');
  if(clsSel){
    const prev=clsSel.value;
    clsSel.innerHTML='<option value="">全部班級</option>'+
      DB.classes.map(c=>`<option value="${c}">${c}</option>`).join('');
    clsSel.value=prev;
  }
  // 顯示已加入的排除規則
  const listEl=document.getElementById('sch-excl-list');
  if(!listEl)return;
  const rules=SCH_STATE.excludeRules||[];
  if(!rules.length){
    listEl.innerHTML=`<span style="font-family:DM Mono,monospace;font-size:9px;color:var(--border)">尚無排除規則</span>`;
    return;
  }
  listEl.innerHTML='';
  rules.forEach((r,idx)=>{
    const catName=r.catId?DB.instruments.categories.find(c=>c.id===r.catId)?.name||r.catId:'全部大項';
    const typeName2={major:'主修',minor:'副修',elective:'選修'}[r.type]||'全部修別';
    const clsName=r.cls||'全部班級';
    const tag=document.createElement('div');
    tag.style.cssText="display:inline-flex;align-items:center;gap:5px;padding:4px 8px;background:#f8d7da;border:1px solid var(--rust);border-radius:20px;font-family:DM Mono,monospace;font-size:9px;color:var(--rust)";
    tag.innerHTML=`${catName} × ${typeName2} × ${clsName} <button onclick="schRemoveExcludeRule(${idx})" style="background:none;border:none;cursor:pointer;color:var(--rust);font-size:12px;padding:0;line-height:1;margin-left:2px">✕</button>`;
    listEl.appendChild(tag);
  });
}
window.renderSchExcludeUI=renderSchExcludeUI;

function schAddExcludeRule(){
  const catId=document.getElementById('sch-excl-cat')?.value||'';
  const type=document.getElementById('sch-excl-type')?.value||'';
  const cls=document.getElementById('sch-excl-cls')?.value||'';
  if(!catId&&!type&&!cls){showToast('請至少選擇一個條件','warn');return;}
  if(!SCH_STATE.excludeRules)SCH_STATE.excludeRules=[];
  const exists=SCH_STATE.excludeRules.some(r=>r.catId===catId&&r.type===type&&r.cls===cls);
  if(exists){showToast('此規則已存在','warn');return;}
  SCH_STATE.excludeRules.push({catId,type,cls});
  renderSchExcludeUI();
  renderSchedule();
  showToast('排除規則已加入','ok');
}
window.schAddExcludeRule=schAddExcludeRule;

function schRemoveExcludeRule(idx){
  if(!SCH_STATE.excludeRules)return;
  SCH_STATE.excludeRules.splice(idx,1);
  renderSchExcludeUI();
  renderSchedule();
}
window.schRemoveExcludeRule=schRemoveExcludeRule;

function renderSchCatUI(){
  const el=document.getElementById('sch-cat-order');if(!el)return;
  el.innerHTML='';
  SCH_STATE.catOrder.forEach((c,idx)=>{
    const tag=document.createElement('div');
    tag.style.cssText=`display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border:1px solid var(--border);border-radius:20px;cursor:grab;font-family:DM Mono,monospace;font-size:9px;transition:all .15s;background:${c.active?'var(--gold);color:var(--ink)':'var(--white)'}`;
    tag.draggable=true;tag.dataset.idx=idx;
    tag.innerHTML=c.name;
    tag.addEventListener('click',()=>{c.active=!c.active;tag.style.background=c.active?'var(--gold)':'var(--white)';tag.style.color=c.active?'var(--ink)':'';renderSchInstUI();});
    tag.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain','cat:'+idx);tag.style.opacity='.4';});
    tag.addEventListener('dragend',()=>{tag.style.opacity='1';});
    tag.addEventListener('dragover',e=>{e.preventDefault();});
    tag.addEventListener('drop',e=>{
      e.preventDefault();const data=e.dataTransfer.getData('text/plain');
      if(!data.startsWith('cat:'))return;
      const fromIdx=+data.split(':')[1];const toIdx=idx;
      if(fromIdx===toIdx)return;
      const moved=SCH_STATE.catOrder.splice(fromIdx,1)[0];
      SCH_STATE.catOrder.splice(toIdx,0,moved);renderSchCatUI();
    });
    el.appendChild(tag);
  });
}
window.renderSchCatUI=renderSchCatUI;

function renderSchInstUI(){
  // 細項樂器 chips
  const el=document.getElementById('sch-inst-order');if(!el)return;
  el.innerHTML='';
  // 依照 catOrder 分組顯示（只顯示已勾選的大項）
  SCH_STATE.catOrder.forEach(cat=>{
    if(!cat.active)return; // ★ 未勾選的大項，不顯示其樂器
    const insts=SCH_STATE.instOrder.filter(i=>DB.instruments.items.find(x=>x.id===i.id)?.cat===cat.id);
    if(!insts.length)return;
    // 大項分隔標題
    const header=document.createElement('div');
    header.style.cssText='width:100%;font-family:\'DM Mono\',monospace;font-size:8px;color:var(--muted);letter-spacing:1px;margin-bottom:4px;margin-top:6px;padding-bottom:2px;border-bottom:1px solid var(--cream)';
    header.textContent=cat.name;
    el.appendChild(header);
    insts.forEach(inst=>{
      const idx=SCH_STATE.instOrder.indexOf(inst);
      const tag=document.createElement('div');
      tag.style.cssText=`display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border:1px solid var(--border);border-radius:20px;cursor:grab;font-family:DM Mono,monospace;font-size:9px;transition:all .15s;background:${inst.active?'var(--ink);color:var(--gold)':'var(--white)'}`;
      tag.draggable=true;tag.dataset.idx=idx;
      tag.innerHTML=inst.name;
      tag.addEventListener('click',()=>{
        inst.active=!inst.active;
        tag.style.background=inst.active?'var(--ink)':'var(--white)';
        tag.style.color=inst.active?'var(--gold)':'';
      });
      tag.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain','inst:'+idx);tag.style.opacity='.4';});
      tag.addEventListener('dragend',()=>{tag.style.opacity='1';});
      tag.addEventListener('dragover',e=>{e.preventDefault();});
      tag.addEventListener('drop',e=>{
        e.preventDefault();const data=e.dataTransfer.getData('text/plain');
        if(!data.startsWith('inst:'))return;
        const fromIdx=+data.split(':')[1];const toIdx=idx;
        if(fromIdx===toIdx)return;
        const moved=SCH_STATE.instOrder.splice(fromIdx,1)[0];
        SCH_STATE.instOrder.splice(toIdx,0,moved);renderSchInstUI();
      });
      el.appendChild(tag);
    });
  });
}
function renderSchTypeUI(){
  const el=document.getElementById('sch-type-order');if(!el)return;
  el.innerHTML='';
  SCH_STATE.typeOrder.forEach((t,idx)=>{
    const tag=document.createElement('div');
    tag.style.cssText=`display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border:1px solid var(--border);border-radius:20px;cursor:grab;font-family:DM Mono,monospace;font-size:9px;transition:all .15s;background:${t.active?'var(--steel);color:#fff':'var(--white)'}`;
    tag.draggable=true;tag.dataset.idx=idx;
    tag.innerHTML=t.label;
    tag.addEventListener('click',()=>{t.active=!t.active;tag.style.background=t.active?'var(--steel)':'var(--white)';tag.style.color=t.active?'#fff':'';});
    tag.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain','type:'+idx);tag.style.opacity='.4';});
    tag.addEventListener('dragend',()=>{tag.style.opacity='1';});
    tag.addEventListener('dragover',e=>{e.preventDefault();});
    tag.addEventListener('drop',e=>{
      e.preventDefault();const data=e.dataTransfer.getData('text/plain');
      if(!data.startsWith('type:'))return;
      const fromIdx=+data.split(':')[1];const toIdx=idx;
      if(fromIdx===toIdx)return;
      const moved=SCH_STATE.typeOrder.splice(fromIdx,1)[0];
      SCH_STATE.typeOrder.splice(toIdx,0,moved);renderSchTypeUI();
    });
    el.appendChild(tag);
  });
}

function renderSchClassUI(){
  const el=document.getElementById('sch-class-order');if(!el)return;
  el.innerHTML='';
  SCH_STATE.classOrder.forEach((c,idx)=>{
    const tag=document.createElement('div');
    tag.style.cssText=`display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border:1px solid var(--border);border-radius:20px;cursor:grab;font-family:DM Mono,monospace;font-size:9px;transition:all .15s;background:${c.active?'var(--sage);color:#fff':'var(--white)'}`;
    tag.draggable=true;tag.dataset.idx=idx;
    tag.innerHTML=c.cls;
    tag.addEventListener('click',()=>{c.active=!c.active;tag.style.background=c.active?'var(--sage)':'var(--white)';tag.style.color=c.active?'#fff':'';});
    tag.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain','cls:'+idx);tag.style.opacity='.4';});
    tag.addEventListener('dragend',()=>{tag.style.opacity='1';});
    tag.addEventListener('dragover',e=>{e.preventDefault();});
    tag.addEventListener('drop',e=>{
      e.preventDefault();const data=e.dataTransfer.getData('text/plain');
      if(!data.startsWith('cls:'))return;
      const fromIdx=+data.split(':')[1];const toIdx=idx;
      if(fromIdx===toIdx)return;
      const moved=SCH_STATE.classOrder.splice(fromIdx,1)[0];
      SCH_STATE.classOrder.splice(toIdx,0,moved);renderSchClassUI();
    });
    el.appendChild(tag);
  });
}

function schRenderSeatBtns(){
  const a=document.getElementById('sch-seat-asc');const d=document.getElementById('sch-seat-desc');
  if(a){a.className='btn btn-sm '+(SCH_STATE.seatDir===1?'btn-p':'btn-s');}
  if(d){d.className='btn btn-sm '+(SCH_STATE.seatDir===-1?'btn-p':'btn-s');}
}
function schSeatDir(dir){SCH_STATE.seatDir=dir;schRenderSeatBtns();}
window.schSeatDir=schSeatDir;

function schApplySort(){
  _saveRoomState(SCH_STATE.roomId); // ★ 套用時儲存此考場狀態
  renderSchedule();showToast('排序已套用 ✓','ok');
}
window.schApplySort=schApplySort;

function renderSchedule(){
  const container=document.getElementById('sch-list');if(!container)return;
  const roomId=SCH_STATE.roomId;
  if(!roomId){
    container.innerHTML='<p style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px;padding:14px">請先選擇考場</p>';
    return;
  }

  // ★ 統一資料源：直接呼叫 _buildFilteredEntries 並做跨考場去重
  //    這樣排程頁、snapshot、評審頁三者順序完全一致
  const _origRoomId=SCH_STATE.roomId;
  _saveRoomState(_origRoomId);
  const allCandidates={};
  DB.rooms.forEach(room=>{
    SCH_STATE.roomId=room.id;
    _loadRoomState(room.id);
    allCandidates[room.id]=_buildFilteredEntries(room.id);
  });
  SCH_STATE.roomId=_origRoomId;
  _loadRoomState(_origRoomId);

  // 跨考場去重：每個 (studentId, type) 只保留一個考場
  const assignment={}; // 'studentId_type' -> roomId
  // 第一輪：_forceInclude 優先佔位
  DB.rooms.forEach(room=>{
    (allCandidates[room.id]||[]).forEach(e=>{
      if(!e._forceInclude)return;
      const key=e.studentId+'_'+e.type;
      if(!assignment[key])assignment[key]=room.id;
    });
  });
  // 第二輪：自動篩選依考場順序取第一個
  DB.rooms.forEach(room=>{
    (allCandidates[room.id]||[]).forEach(e=>{
      const key=e.studentId+'_'+e.type;
      if(!assignment[key])assignment[key]=room.id;
    });
  });

  // 取出當前考場的 entries（依該考場 _buildFilteredEntries 已算好的順序）
  const entries=(allCandidates[roomId]||[]).filter(e=>{
    const key=e.studentId+'_'+e.type;
    return assignment[key]===roomId;
  });

  // ★ entries 已由 _buildFilteredEntries 處理完所有篩選/排序/合併邏輯，直接使用
  entries.forEach((e,i)=>e._displayOrder=i+1);
  const titleEl=document.getElementById('sch-list-title');
  const countEl=document.getElementById('sch-count');
  const rName=roomId?DB.rooms.find(r=>r.id===roomId)?.name||'':'全部考場';
  if(titleEl)titleEl.textContent=`出場順序 — ${rName}（共 ${entries.length} 筆，可拖曳調整）`;
  if(countEl)countEl.textContent='';
  container.innerHTML='';
  if(!entries.length){container.innerHTML='<p style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px;padding:14px">無符合條件的資料</p>';return;}
  entries.forEach((e,i)=>{
    const entryKey=e.studentId+'_'+e.type;
    const dq=DB.disqualified[entryKey];
    const isExtra=!!e._extra;
    const div=document.createElement('div');div.className='exam-item'+(dq?' jst-row-a':'')+(isExtra?' ':'')+'';div.draggable=true;
    if(isExtra)div.style.cssText='border-left:3px solid var(--steel)';
    div.innerHTML=`<div class="dh">⠿</div>
      <div class="ei-num" style="${dq?'color:var(--red)':''}">${String(e._displayOrder).padStart(2,'0')}</div>
      <div class="ei-info" style="flex:1">
        <div class="ei-name">${e.name} <span style="font-size:12px;font-weight:400;color:var(--muted)">${e.class}·座${e.seat}</span>${dq?`<span class="badge b-absent" style="margin-left:6px">⛔ 扣考</span>`:''} ${isExtra?'<span style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--steel);margin-left:4px">手動加入</span>':''}</div>
        <div class="ei-detail">${e.instName}·${typeName(e.type)}·${e.roomName}${e.roomLocation?' 📍'+e.roomLocation:''}</div>
        ${dq?`<div style="font-family:DM Mono,monospace;font-size:9px;color:var(--red);margin-top:2px">原因：${dq.reason}${dq.note?' ／ '+dq.note:''}</div>`:''}
        <div class="ei-rep">${e.ac?'指定：'+e.ac+' — '+e.at:''}${e.fc?'\n自選：'+e.fc+' — '+e.ft:''}</div>
      </div>
      ${typeBadge(e.type)}
      <div class="bg" style="margin-left:8px;flex-shrink:0">
        <button class="btn ${dq?'btn-s':'btn-o'} btn-xs" onclick="openDisqModal('${e.studentId}','${e.type}','${e.name}','${e.instName}')">${dq?'修改扣考':'設扣考'}</button>
        ${dq?`<button class="btn btn-s btn-xs" onclick="removeDisq('${entryKey}')">取消扣考</button>`:''}
        <button class="btn btn-d btn-xs" onclick="schRemoveEntry('${entryKey}')" title="從本排程移除">✕ 移除</button>
      </div>`;
    setupDrag(div,container);container.appendChild(div);
  });
}

function schResetFilters(){
  SCH_STATE.catOrder.forEach(c=>c.active=true);
  SCH_STATE.instOrder.forEach(i=>i.active=true);
  SCH_STATE.typeOrder.forEach(t=>t.active=true);
  SCH_STATE.classOrder.forEach(c=>c.active=true);
  SCH_STATE.seatDir=1;
  SCH_STATE.excludeRules=[];
  renderSchCatUI();renderSchInstUI();renderSchTypeUI();renderSchClassUI();schRenderSeatBtns();
  renderSchedule();
  _saveRoomState(SCH_STATE.roomId); // ★ 重設後也儲存
  showToast('篩選已重設','ok');
}
window.schResetFilters=schResetFilters;

// ★ 依目前考場的 allowedCats 強制重設篩選（清空已儲存狀態再重建）
function schResetToRoomDefaults(){
  const roomId=SCH_STATE.roomId;
  delete _SCH_ROOM_STATES[roomId];  // 清掉儲存的狀態
  SCH_STATE.catOrder=[];SCH_STATE.instOrder=[];SCH_STATE.classOrder=[];
  SCH_STATE.seatDir=1;
  schInitSortUI();renderSchedule();
  showToast('已依考場設定重設篩選','ok');
}
window.schResetToRoomDefaults=schResetToRoomDefaults;

// ★ 儲存排程（所有考場的篩選/排序狀態 + removed/extra entries）
function schSaveSchedule(){
  // ★ 修正 #E1：先檢查伺服器版本，防止多管理員同時編輯互相覆蓋
  if(window._schSaving){showToast('儲存中，請稍候...','warn');return;}
  window._schSaving=true;
  const _doSave=()=>{
    _saveRoomState(SCH_STATE.roomId);
    const data={};
    Object.entries(_SCH_ROOM_STATES).forEach(([roomId,st])=>{
      data[roomId]={
        catOrder:st.catOrder,instOrder:st.instOrder,
        typeOrder:st.typeOrder,classOrder:st.classOrder,
        seatDir:st.seatDir,
        extraEntries:st.extraEntries,
        removedEntries:[...st.removedEntries],
        excludeRules:st.excludeRules||[],
        manualOrder:st.manualOrder||[],  // ★ 新增：拖曳手動排序
      };
    });
    const curId=SCH_STATE.roomId;
    if(curId){
      data[curId]={
        catOrder:SCH_STATE.catOrder.map(c=>({...c})),
        instOrder:SCH_STATE.instOrder.map(i=>({...i})),
        typeOrder:SCH_STATE.typeOrder.map(t=>({...t})),
        classOrder:SCH_STATE.classOrder.map(c=>({...c})),
        seatDir:SCH_STATE.seatDir,
        extraEntries:[...SCH_STATE.extraEntries],
        removedEntries:[...SCH_STATE.removedEntries],
        excludeRules:[...(SCH_STATE.excludeRules||[])],
        manualOrder:[...(SCH_STATE.manualOrder||[])],  // ★ 新增：當前考場的手動排序
      };
    }
    const snapshot={};
    const _origRoomId=SCH_STATE.roomId;
    _saveRoomState(_origRoomId);
    // ★ 收集每個考場的 candidate entries（已含 manualOrder 排序）
    const allCandidates={}; // {roomId: entries[]}
    DB.rooms.forEach(room=>{
      SCH_STATE.roomId=room.id;
      _loadRoomState(room.id);
      allCandidates[room.id]=_buildFilteredEntries(room.id);
    });
    SCH_STATE.roomId=_origRoomId;
    _loadRoomState(_origRoomId);

    // ★ 修正：去重邏輯——「同一學生同修別跨多考場」只保留一個
    //   優先順序：(1) 該考場有 _forceInclude 標記的優先（手動指派）
    //            (2) 否則依 DB.rooms 順序取第一個出現的考場
    //   ★ 重要：保留每個考場內 _buildFilteredEntries 已算好的「行內順序」（含 manualOrder）
    
    // Step 1：先掃描所有考場，建立「每個 (studentId,type) 應分配給哪個考場」的決策表
    const assignment={}; // 'studentId_type' -> roomId
    // 第一輪：_forceInclude 優先佔位
    DB.rooms.forEach(room=>{
      (allCandidates[room.id]||[]).forEach(e=>{
        if(!e._forceInclude)return;
        const key=e.studentId+'_'+e.type;
        if(!assignment[key])assignment[key]=room.id;
      });
    });
    // 第二輪：自動篩選依考場順序取第一個
    DB.rooms.forEach(room=>{
      (allCandidates[room.id]||[]).forEach(e=>{
        const key=e.studentId+'_'+e.type;
        if(!assignment[key])assignment[key]=room.id;
      });
    });
    
    // Step 2：依各考場原順序產生 snapshot（順序完全等同 _buildFilteredEntries 的回傳順序）
    DB.rooms.forEach(room=>{
      const candidates=allCandidates[room.id]||[];
      // 在該考場的原順序中，過濾出「分配給這個考場」的學生
      const filtered=candidates.filter(e=>{
        const key=e.studentId+'_'+e.type;
        return assignment[key]===room.id;
      });
      if(filtered.length){
        snapshot[room.id]=filtered;
      }
    });
    // 確保每個考場都有（即使空）
    DB.rooms.forEach(room=>{
      if(!snapshot[room.id])snapshot[room.id]=[];
    });
    // 排序與重新編號：每個考場內依原本 entries 的順序
    Object.keys(snapshot).forEach(roomId=>{
      snapshot[roomId]=snapshot[roomId].map((e,idx)=>({
        entryKey:e.studentId+'_'+e.type,
        studentId:e.studentId,name:e.name,class:e.class,seat:e.seat,
        instId:e.instId,instName:e.instName,catId:e.catId,
        type:e.type,order:idx+1,
        ac:e.ac,at:e.at,fc:e.fc,ft:e.ft,
        roomId:roomId,
        roomName:DB.rooms.find(r=>r.id===roomId)?.name||'—',
        roomLocation:DB.rooms.find(r=>r.id===roomId)?.location||'',
        // ★ 關鍵修正：保留強制加入標記，否則重新整理後手動指派失效
        ...(e._forceInclude?{_forceInclude:true}:{}),
        ...(e._extra?{_extra:true}:{}),
      }));
    });
    DB.savedScheduleSnapshot=snapshot;

    // ★ 修正 #E3：空排程警告
    const totalEntries=Object.values(snapshot).reduce((s,arr)=>s+(arr?.length||0),0);
    if(totalEntries===0){
      if(!confirm('目前排程沒有任何學生（可能尚未填曲目或被排除規則過濾）。確定要儲存空排程？')){
        window._schSaving=false;return;
      }
    }

    // 寫入版本號
    const newVer=(DB.savedScheduleSnapshot._ver||0)+1;
    fbSet('scheduleState','main',{data:JSON.stringify(data),_ver:newVer});
    Object.entries(snapshot).forEach(([roomId,entries])=>{
      fbSet('scheduleSnapshots',roomId,{entries:entries||[],_savedAt:new Date().toISOString(),_ver:newVer});
    });
    try{
      const snapStr=JSON.stringify(snapshot);
      if(snapStr.length<800000)fbSet('scheduleState','snapshot',{data:snapStr,_ver:newVer});
    }catch(e){}
    try{
      localStorage.setItem('scheduleState',JSON.stringify(data));
      localStorage.setItem('scheduleSnapshot',JSON.stringify(snapshot));
    }catch(e){}
    renderAdminStudents();
    renderStuSchedule();
    showToast('排程已儲存 ✓（學生考場分配已同步）','ok');
    window._schSaving=false;
  };

  // 先讀取伺服器版本比對
  if(window._FB){
    fbLoad('scheduleState',docs=>{
      const cur=docs.find(d=>d.id==='main');
      const curVer=cur?._ver||0;
      const myVer=DB.savedScheduleSnapshot?._ver||0;
      if(curVer>myVer&&myVer>0){
        if(!confirm(`偵測到其他管理員已修改排程（伺服器版本 ${curVer} > 你的版本 ${myVer}）\n\n你存檔會覆蓋對方的修改。\n\n確定繼續？\n（建議：先重新整理頁面看最新版本，再決定是否覆蓋）`)){
          window._schSaving=false;return;
        }
      }
      _doSave();
    });
  } else {
    _doSave();
  }
}

// ★ 依目前 SCH_STATE 篩選/排序，回傳此考場的 entry 陣列（不修改 DOM）
function _buildFilteredEntries(roomId){
  let entries=getScheduleEntries();
  // ★ 修正：依 roomId 取對應考場的 state（不再只看當前 SCH_STATE）
  const isCurRoom=(SCH_STATE.roomId===roomId);
  const targetState=isCurRoom?SCH_STATE:(_SCH_ROOM_STATES[roomId]||{});
  const targetExtra=targetState.extraEntries||[];
  const targetRemovedRaw=targetState.removedEntries;
  const targetRemoved=targetRemovedRaw instanceof Set?targetRemovedRaw:new Set(Array.isArray(targetRemovedRaw)?targetRemovedRaw:[]);

  entries=entries.filter(e=>!targetRemoved.has(e.studentId+'_'+e.type));
  // ★ 把 entry 的 roomId 都改寫為目標 roomId
  entries.forEach(e=>{e.roomId=roomId;});

  // ★ 修正核心：建立「強制加入」的索引（含手動指派的學生）
  //    若 entry 在 targetExtra 中，標記 _forceInclude=true，後續篩選會 bypass
  const forceKeys=new Set(targetExtra.map(ex=>ex.studentId+'_'+ex.type));
  entries.forEach(e=>{
    if(forceKeys.has(e.studentId+'_'+e.type)){
      e._forceInclude=true;
      e._extra=true;
    }
  });
  // 若 targetExtra 的學生不在 entries 裡（沒有相關修別資料）才 push 新 entry
  targetExtra.forEach(ex=>{
    const key=ex.studentId+'_'+ex.type;
    if(targetRemoved.has(key))return;
    const alreadyIn=entries.some(e=>e.studentId===ex.studentId&&e.type===ex.type);
    if(alreadyIn)return; // 已在 entries 且已標記 _forceInclude
    const stu=DB.users.find(u=>u.id===ex.studentId);if(!stu)return;
    const inst=stu[ex.type]?DB.instruments.items.find(i=>i.id===stu[ex.type]):null;
    const cat=inst?DB.instruments.categories.find(c=>c.id===inst.cat):null;
    const room=DB.rooms.find(r=>r.id===ex.roomId)||DB.rooms.find(r=>r.id===roomId)||_findRoomForCat(inst?.cat)||DB.rooms[0];
    const acKey=ex.type==='elective'?'elec_ac':(ex.type+'_ac');
    const atKey=ex.type==='elective'?'elec_at':(ex.type+'_at');
    const fcKey=ex.type==='elective'?'elec_fc':(ex.type+'_fc');
    const ftKey=ex.type==='elective'?'elec_ft':(ex.type+'_ft');
    entries.push({
      studentId:stu.id,name:stu.name,class:stu.class,seat:stu.seat,
      instId:inst?.id||'',instName:inst?iname(inst.id):'（無樂器）',catId:inst?.cat||'',
      type:ex.type,typeOrder:{major:0,minor:1,elective:2}[ex.type],
      ac:stu[acKey]||'',at:stu[atKey]||'',fc:stu[fcKey]||'',ft:stu[ftKey]||'',
      roomId:roomId,roomName:room?.name||'—',roomLocation:room?.location||'',order:0,
      _extra:true,_forceInclude:true,
    });
  });
  // ★ 修正核心：用目標考場（targetState）的篩選條件，而非 SCH_STATE 的
  const tCatOrder=targetState.catOrder||[];
  const tInstOrder=targetState.instOrder||[];
  const tTypeOrder=targetState.typeOrder||SCH_STATE.typeOrder||[];
  const tClassOrder=targetState.classOrder||[];
  const tExcludeRules=targetState.excludeRules||[];

  const activeCats=new Set(tCatOrder.filter(c=>c.active).map(c=>c.id));
  if(activeCats.size)entries=entries.filter(e=>e._forceInclude||activeCats.has(e.catId));
  const activeInsts=new Set(tInstOrder.filter(i=>i.active).map(i=>i.id));
  if(activeInsts.size)entries=entries.filter(e=>e._forceInclude||activeInsts.has(e.instId));
  const activeTypes=new Set(tTypeOrder.filter(t=>t.active).map(t=>t.key));
  if(activeTypes.size)entries=entries.filter(e=>e._forceInclude||activeTypes.has(e.type));
  const activeClasses=new Set(tClassOrder.filter(c=>c.active).map(c=>c.cls));
  if(activeClasses.size)entries=entries.filter(e=>e._forceInclude||activeClasses.has(e.class));
  if(tExcludeRules.length){
    entries=entries.filter(e=>{
      if(e._forceInclude)return true;
      const stu=DB.users.find(u=>u.id===e.studentId)||{};
      return !tExcludeRules.some(r=>{
        const matchCls=!r.cls||r.cls===e.class;
        if(!matchCls)return false;
        if(!r.catId&&!r.type)return true;
        if(r.type&&!r.catId)return !!stu[r.type];
        const typesToCheck=r.type?[r.type]:['major','minor','elective'];
        return typesToCheck.some(t=>{
          const instId=stu[t];if(!instId)return false;
          const inst=DB.instruments.items.find(i=>i.id===instId);
          return inst&&inst.cat===r.catId;
        });
      });
    });
  }
  // ★ 修正：排序也用 targetState（與篩選一致），否則跨考場呼叫時用錯狀態
  const sortCatOrder=targetState.catOrder||SCH_STATE.catOrder||[];
  const sortInstOrder=targetState.instOrder||SCH_STATE.instOrder||[];
  const sortTypeOrder=targetState.typeOrder||SCH_STATE.typeOrder||[
    {key:'major',label:'主修',active:true},
    {key:'minor',label:'副修',active:true},
    {key:'elective',label:'選修',active:true}
  ];
  const sortClassOrder=targetState.classOrder||SCH_STATE.classOrder||[];
  const sortSeatDir=targetState.seatDir||SCH_STATE.seatDir||1;
  const catIndexOf=catId=>{const i=sortCatOrder.findIndex(c=>c.id===catId);return i>=0?i:999;};
  const instIndexOf=id=>{const i=sortInstOrder.findIndex(it=>it.id===id);return i>=0?i:999;};
  const typeIndexOf=key=>{const i=sortTypeOrder.findIndex(t=>t.key===key);return i>=0?i:({major:0,minor:1,elective:2}[key]??99);};
  const classIndexOf=cls=>{const i=sortClassOrder.findIndex(c=>c.cls===cls);return i>=0?i:999;};
  // ★ 修正：優先使用使用者拖曳的順序（manualOrder）
  const manualOrder=targetState.manualOrder||[];
  if(manualOrder.length){
    const manualIdx=new Map(manualOrder.map((k,i)=>[k,i]));
    entries.sort((a,b)=>{
      const ka=a.studentId+'_'+a.type, kb=b.studentId+'_'+b.type;
      const ia=manualIdx.has(ka)?manualIdx.get(ka):999999;
      const ib=manualIdx.has(kb)?manualIdx.get(kb):999999;
      if(ia!==ib)return ia-ib;
      // fallback：不在 manualOrder 中的（新加入的學生）依五層排序
      const dc=catIndexOf(a.catId||'')-catIndexOf(b.catId||'');if(dc!==0)return dc;
      const di=instIndexOf(a.instId)-instIndexOf(b.instId);if(di!==0)return di;
      const dt=typeIndexOf(a.type)-typeIndexOf(b.type);if(dt!==0)return dt;
      const dcl=classIndexOf(a.class)-classIndexOf(b.class);if(dcl!==0)return dcl;
      return (a.seat-b.seat)*sortSeatDir;
    });
  } else {
    entries.sort((a,b)=>{
      const dc=catIndexOf(a.catId||'')-catIndexOf(b.catId||'');if(dc!==0)return dc;
      const di=instIndexOf(a.instId)-instIndexOf(b.instId);if(di!==0)return di;
      const dt=typeIndexOf(a.type)-typeIndexOf(b.type);if(dt!==0)return dt;
      const dcl=classIndexOf(a.class)-classIndexOf(b.class);if(dcl!==0)return dcl;
      return (a.seat-b.seat)*sortSeatDir;
    });
  }
  return entries;
}
window._buildFilteredEntries=_buildFilteredEntries;
window.schSaveSchedule=schSaveSchedule;

// ★ 載入排程狀態（launchApp 後呼叫）
function schLoadSchedule(cb){
  // ★ loadAllFromFirebase 已將 scheduleState 並行讀入並呼叫 _applyScheduleState
  if(!window._FB){
    try{
      const raw=localStorage.getItem('scheduleState');
      if(raw)_applyScheduleState(JSON.parse(raw));
      const snap=localStorage.getItem('scheduleSnapshot');
      if(snap)DB.savedScheduleSnapshot=JSON.parse(snap);
    }catch(e){}
  }
  // 資料已在記憶體中，直接重新渲染
  schInitSortUI();
  renderSchedule();
  // ★ 修正：快照載入後同步更新後台學生名單的考場欄位
  if(ST.role==='admin'&&typeof renderAdminStudents==='function')renderAdminStudents();
  if(cb)cb();
}
window.schLoadSchedule=schLoadSchedule;

function _applyScheduleState(data){
  if(!data)return;
  Object.entries(data).forEach(([roomId,st])=>{
    _SCH_ROOM_STATES[roomId]={
      catOrder:st.catOrder||[],instOrder:st.instOrder||[],
      typeOrder:st.typeOrder||[{key:'major',label:'主修',active:true},{key:'minor',label:'副修',active:true},{key:'elective',label:'選修',active:true}],
      classOrder:st.classOrder||[],seatDir:st.seatDir||1,
      extraEntries:st.extraEntries||[],
      removedEntries:new Set(st.removedEntries||[]),
      excludeRules:st.excludeRules||[],
      manualOrder:st.manualOrder||[],  // ★ 還原拖曳排序
    };
  });
  _loadRoomState(SCH_STATE.roomId);
}

// ★ 手動移除出場名單中的某項目（同時清除 extraEntries，確保真正消失）
function schRemoveEntry(entryKey){
  SCH_STATE.removedEntries.add(entryKey);
  // 同時從 extraEntries 移除，避免 extra 把人加回來
  const [sid,type]=entryKey.split('_');
  SCH_STATE.extraEntries=SCH_STATE.extraEntries.filter(e=>!(e.studentId===sid&&e.type===type));
  renderSchedule();
  showToast('已從排程移除','warn');
}
window.schRemoveEntry=schRemoveEntry;

// ★ 開啟「手動加入出場名單」視窗
function openSchAddModal(){
  let modal=document.getElementById('sch-add-modal');
  const roomOpts='<option value="">（不指定考場）</option>'+DB.rooms.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  if(!modal){
    modal=document.createElement('div');modal.id='sch-add-modal';modal.className='overlay';
    modal.innerHTML=`<div class="modal" style="width:620px;max-width:98vw">
      <h2 class="modal-t">＋ 手動加入出場名單</h2>
      <p style="font-family:DM Mono,monospace;font-size:10px;color:var(--muted);margin-bottom:10px;line-height:1.8">
        可搜尋<strong style="color:var(--ink)">任意學生</strong>，強制加入（覆蓋排除規則、篩選條件），<br>
        包含未填樂器資料的學生，所有修別（主修／副修／選修）均可加入。<br>
        點「移出」可從目前考場名單移除。
      </p>
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center">
        <input type="text" id="sch-add-search" placeholder="搜尋姓名或帳號…" style="flex:1;min-width:120px;padding:8px 12px;border:1px solid var(--border);border-radius:var(--r);font-size:14px;outline:none" oninput="schAddSearch()">
        <select id="sch-add-room-sel" style="padding:7px 10px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;outline:none;max-width:140px">
          ${roomOpts}
        </select>
      </div>
      <div id="sch-add-results" style="max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r)"></div>
      <div class="modal-ft">
        <button class="btn btn-s" onclick="closeOverlay('sch-add-modal')">關閉</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('on');});
  } else {
    const roomSel=document.getElementById('sch-add-room-sel');
    if(roomSel)roomSel.innerHTML=roomOpts;
    // 預設選目前考場
    if(SCH_STATE.roomId&&roomSel)roomSel.value=SCH_STATE.roomId;
  }
  document.getElementById('sch-add-search').value='';
  // 預設選目前考場
  const rs=document.getElementById('sch-add-room-sel');
  if(rs&&SCH_STATE.roomId)rs.value=SCH_STATE.roomId;
  schAddSearch();
  modal.classList.add('on');
}
window.openSchAddModal=openSchAddModal;

function schAddSearch(){
  const q=(document.getElementById('sch-add-search')?.value||'').trim();
  const res=document.getElementById('sch-add-results');if(!res)return;
  // ★ 修正①：搜尋範圍擴大——無論是否有樂器、任何修別都可搜尋並強制加入
  const allStus=students();
  const stus=allStus.filter(s=>!q||s.name.includes(q)||(s.account||'').includes(q)||(s.class||'').includes(q)).slice(0,60);
  if(!stus.length){res.innerHTML=`<div style="padding:14px;color:var(--muted);font-family:DM Mono,monospace;font-size:11px;text-align:center">查無學生</div>`;return;}

  // 取得目前排程中實際在名單的 entryKeys（不受排除規則影響，只看 extra+正常通過的）
  const currentKeys=new Set();
  {
    let tmp=getScheduleEntries();
    // 僅過濾 removedEntries，不再套用排除規則（手動加入模式應顯示完整狀態）
    tmp.filter(e=>!SCH_STATE.removedEntries.has(e.studentId+'_'+e.type)).forEach(e=>currentKeys.add(e.studentId+'_'+e.type));
    SCH_STATE.extraEntries.filter(ex=>!SCH_STATE.removedEntries.has(ex.studentId+'_'+ex.type)).forEach(ex=>currentKeys.add(ex.studentId+'_'+ex.type));
  }

  // ★ 修正②：所有修別（major/minor/elective）都顯示，不再因為 s[t] 為空就跳過
  const ALL_TYPES=['major','minor','elective'];
  const typeLabels={major:'主修',minor:'副修',elective:'選修'};

  res.innerHTML=stus.map(s=>{
    const rows=ALL_TYPES.map(t=>{
      const key=s.id+'_'+t;
      const inList=currentKeys.has(key);
      const isRemoved=SCH_STATE.removedEntries.has(key);
      const isExtra=SCH_STATE.extraEntries.some(ex=>ex.studentId===s.id&&ex.type===t);
      const hasInst=!!s[t]; // 是否已設定樂器
      // ★ 判斷被排除規則過濾（僅用於顯示標記，不阻止加入）
      const rules=SCH_STATE.excludeRules||[];
      const isExcluded=!isExtra&&rules.length&&rules.some(r=>{
        if(r.cls&&r.cls!==s.class)return false;
        if(!r.catId&&!r.type)return true;
        if(r.type&&!r.catId)return !!s[r.type];
        const ch=r.type?[r.type]:['major','minor','elective'];
        return ch.some(tt=>{const inst=DB.instruments.items.find(x=>x.id===s[tt]);return inst&&inst.cat===r.catId;});
      });

      let statusBadge='';
      if(isExtra||inList)statusBadge=`<span style="font-family:DM Mono,monospace;font-size:8px;color:var(--sage);background:#d4edda;border:1px solid #c3e6cb;border-radius:10px;padding:1px 7px">✓ 已在名單${isExtra?' (手動)':''}</span>`;
      else if(isRemoved)statusBadge=`<span style="font-family:DM Mono,monospace;font-size:8px;color:var(--rust);background:#f8d7da;border:1px solid #f5c6cb;border-radius:10px;padding:1px 7px">已移出</span>`;
      else if(isExcluded)statusBadge=`<span style="font-family:DM Mono,monospace;font-size:8px;color:var(--orange);background:#fff3cd;border:1px solid #ffc107;border-radius:10px;padding:1px 7px">排除規則</span>`;
      else if(!hasInst)statusBadge=`<span style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted);background:var(--cream);border:1px solid var(--border);border-radius:10px;padding:1px 7px">無樂器資料</span>`;

      // ★ 修正③：任何狀態都能加入（強制覆蓋），包含無樂器、排除規則、不同修別
      const addBtn=`<button class="btn btn-g btn-xs" onclick="schAddEntry('${s.id}','${t}')" title="強制加入（忽略排除規則和篩選條件）" style="${isExtra||inList?'opacity:.55':''}">＋ 強制加入</button>`;
      const removeBtn=(inList||isExtra)&&!isRemoved?`<button class="btn btn-d btn-xs" onclick="schRemoveEntry('${key}')">移出</button>`:'';
      const restoreBtn=isRemoved?`<button class="btn btn-b btn-xs" onclick="schRestoreEntry('${key}')">恢復</button>`:'';

      const instDisplay=hasInst?`<span style="font-family:DM Mono,monospace;font-size:10px;color:var(--steel);margin-left:3px">${iname(s[t])}</span>`:`<span style="font-family:DM Mono,monospace;font-size:9px;color:var(--border);margin-left:3px">（未設定樂器）</span>`;

      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 14px;border-bottom:1px solid var(--cream);flex-wrap:wrap${!hasInst?';opacity:.8':''}">
        <div style="flex:1;min-width:0">
          <span style="font-size:12px;font-weight:600">${s.name}</span>
          <span style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted);margin-left:5px">${s.class||'—'}·座${s.seat||'?'}</span>
          ${typeBadge(t)}
          ${instDisplay}
        </div>
        <div style="display:flex;gap:5px;align-items:center;flex-shrink:0;flex-wrap:wrap">
          ${statusBadge}
          ${restoreBtn}
          ${removeBtn}
          ${addBtn}
        </div>
      </div>`;
    }).join('');
    // 學生標題行
    return `<div style="background:var(--ink);color:var(--paper);padding:5px 14px;font-family:DM Mono,monospace;font-size:9px;letter-spacing:1.5px">
      ${s.name} <span style="opacity:.6">${s.class||'（無班級）'}・${s.account||''}</span>
    </div>${rows}`;
  }).join('')||'<div style="padding:14px;color:var(--muted);font-family:DM Mono,monospace;font-size:11px;text-align:center">查無學生</div>';
}
window.schAddSearch=schAddSearch;

function schAddEntry(studentId,type){
  const roomSel=document.getElementById('sch-add-room-sel')?.value||SCH_STATE.roomId||'';
  // ★ 修正：先清除 removedEntries，再更新或新增 extraEntries（確保 _forceInclude 正確）
  SCH_STATE.removedEntries.delete(studentId+'_'+type);
  const existing=SCH_STATE.extraEntries.findIndex(e=>e.studentId===studentId&&e.type===type);
  if(existing>-1){
    // ★ 更新已存在的 entry（覆蓋 roomId 和 _forceInclude）
    SCH_STATE.extraEntries[existing]={studentId,type,roomId:roomSel,_forceInclude:true};
  } else {
    SCH_STATE.extraEntries.push({studentId,type,roomId:roomSel,_forceInclude:true});
  }
  schAddSearch();renderSchedule();
  const stu=DB.users.find(u=>u.id===studentId);
  const hasInst=stu&&stu[type];
  showToast(`已強制加入：${stu?.name||studentId}（${type==='major'?'主修':type==='minor'?'副修':'選修'}）${hasInst?'':'⚠️ 無樂器資料，請確認'}`,'ok');
}
window.schAddEntry=schAddEntry;

function schRestoreEntry(entryKey){
  SCH_STATE.removedEntries.delete(entryKey);
  const [sid,type]=entryKey.split('_');
  schAddSearch();renderSchedule();
  showToast('已恢復 ✓','ok');
}
window.schRestoreEntry=schRestoreEntry;

function schAddCurrentFilter(){
  // Add all currently shown entries via filter
  let entries=getScheduleEntries();
  if(SCH_STATE.roomId)entries=entries.filter(e=>e.roomId===SCH_STATE.roomId);
  const activeCats=new Set(SCH_STATE.catOrder.filter(c=>c.active).map(c=>c.id));
  if(activeCats.size)entries=entries.filter(e=>{const inst=DB.instruments.items.find(i=>i.id===e.instId);return inst&&activeCats.has(inst.cat);});
  const activeInsts=new Set(SCH_STATE.instOrder.filter(i=>i.active).map(i=>i.id));
  if(activeInsts.size)entries=entries.filter(e=>activeInsts.has(e.instId));
  const activeTypes=new Set(SCH_STATE.typeOrder.filter(t=>t.active).map(t=>t.key));
  entries=entries.filter(e=>activeTypes.has(e.type));
  const activeClasses=new Set(SCH_STATE.classOrder.filter(c=>c.active).map(c=>c.cls));
  if(activeClasses.size)entries=entries.filter(e=>activeClasses.has(e.class));
  let added=0;
  entries.forEach(e=>{
    const key=e.studentId+'_'+e.type;
    SCH_STATE.removedEntries.delete(key);
    if(!SCH_STATE.extraEntries.some(x=>x.studentId===e.studentId&&x.type===e.type)){
      SCH_STATE.extraEntries.push({studentId:e.studentId,type:e.type,roomId:e.roomId});added++;
    }
  });
  closeOverlay('sch-add-modal');renderSchedule();
  showToast(`已加入 ${added} 筆 ✓`,'ok');
}
window.schAddCurrentFilter=schAddCurrentFilter;

// legacy stubs（避免舊呼叫出錯）
function schInitSortBar(){}
function onSchRoomChange(){}
function schRoomCatToggle(){}
function schRoomInstToggle(){}
window.schInitSortBar=schInitSortBar;
window.onSchRoomChange=onSchRoomChange;
window.schRoomCatToggle=schRoomCatToggle;
window.schRoomInstToggle=schRoomInstToggle;

// ════════════════════════════════════════════════
// DISQUALIFIED LIST
// ════════════════════════════════════════════════
function renderDisqList(){
  const el=document.getElementById('disq-list');if(!el)return;
  const keys=Object.keys(DB.disqualified);
  if(!keys.length){el.innerHTML='<p style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--muted);padding:6px 0">目前無扣考名單</p>';return;}
  const rows=keys.map(k=>{
    const dq=DB.disqualified[k];
    const [sid,type]=k.split('_');
    const stu=DB.users.find(u=>u.id===sid);
    const name=stu?stu.name:'(已刪除)';
    const cls=stu?stu.class:'';
    const inst=stu?iname(stu[type]):'';
    return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr auto auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--cream)">
      <div><strong>${name}</strong> <span style="font-size:11px;color:var(--muted)">${cls}</span></div>
      <div style="font-size:12px">${inst}·${typeName(type)}</div>
      <div style="font-size:12px;color:var(--red)">${dq.reason}${dq.note?' <span style=\"color:var(--muted)\">/ '+dq.note+'</span>':''}</div>
      <button class="btn btn-s btn-xs" onclick="openDisqModal('${sid}','${type}','${name}','${inst}')">修改</button>
      <button class="btn btn-d btn-xs" onclick="removeDisq('${k}')">移除</button>
    </div>`;
  }).join('');
  el.innerHTML=rows;
}
window.renderDisqList=renderDisqList;

function openDisqModal(studentId,type,name,instName){
  const entryKey=studentId+'_'+type;
  const dq=DB.disqualified[entryKey]||{};
  document.getElementById('disq-modal-name').textContent=name+' — '+instName+'·'+typeName(type);
  document.getElementById('disq-reason').value=dq.reason||'';
  document.getElementById('disq-note').value=dq.note||'';
  document.getElementById('disq-err').textContent='';
  document.getElementById('disq-modal').dataset.entryKey=entryKey;
  openOverlay('disq-modal');
  setTimeout(()=>document.getElementById('disq-reason').focus(),200);
}
window.openDisqModal=openDisqModal;

function saveDisq(){
  const entryKey=document.getElementById('disq-modal').dataset.entryKey;
  const reason=document.getElementById('disq-reason').value.trim();
  if(!reason){document.getElementById('disq-err').textContent='請填寫扣考原因';return;}
  const note=document.getElementById('disq-note').value.trim();
  DB.disqualified[entryKey]={reason,note};
  fbSet('disqualified',entryKey,{reason,note});
  closeOverlay('disq-modal');
  renderDisqList();renderSchedule();
  showToast('已設定扣考 ✓','warn');
}
window.saveDisq=saveDisq;

function removeDisq(entryKey){
  delete DB.disqualified[entryKey];
  fbDelete('disqualified',entryKey);
  renderDisqList();renderSchedule();
  showToast('已取消扣考','ok');
}
window.removeDisq=removeDisq;

function importDisqCSV(){
  const input=document.createElement('input');input.type='file';input.accept='.csv,.txt';
  input.onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const lines=ev.target.result.split('\n').slice(1).filter(l=>l.trim());
      let count=0,errors=[];
      lines.forEach((line,li)=>{
        const cols=line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
        const [account,reason,note]=cols;
        if(!account||!reason){errors.push('第'+(li+2)+'行格式錯誤');return;}
        const stu=DB.users.find(u=>u.account===account&&u.role==='student');
        if(!stu){errors.push('帳號不存在：'+account);return;}
        // 對主修建立扣考（可視需求擴充為多類別）
        const types=[];
        if(stu.major)types.push('major');
        if(stu.minor)types.push('minor');
        if(stu.elective)types.push('elective');
        types.forEach(t=>{DB.disqualified[stu.id+'_'+t]={reason,note:note||''};});
        count++;
      });
      renderDisqList();renderSchedule();
      if(errors.length)showToast('匯入 '+count+' 筆，'+errors.length+' 筆錯誤','warn');
      else showToast('已匯入 '+count+' 筆扣考名單 ✓','ok');
    };
    reader.readAsText(f,'UTF-8');
  };
  input.click();
}
window.importDisqCSV=importDisqCSV;

function exportDisqCSV(){
  const keys=Object.keys(DB.disqualified);
  if(!keys.length){showToast('目前無扣考名單','err');return;}
  const data=keys.map(k=>{
    const dq=DB.disqualified[k];
    const [sid,type]=k.split('_');
    const stu=DB.users.find(u=>u.id===sid);
    return {'帳號':stu?.account||sid,'姓名':stu?.name||'','班級':stu?.class||'','樂器':stu?iname(stu[type]):'','類別':typeName(type),'扣考原因':dq.reason,'備註':dq.note||''};
  });
  exportCSV(data,'扣考名單');
}
window.exportDisqCSV=exportDisqCSV;

function downloadDisqSample(e){
  e.preventDefault();
  const csv='帳號,扣考原因,備註\ns001,曠課超過三分之一,\ns002,違反考試規定,已通知家長';
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='扣考名單範例.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
window.downloadDisqSample=downloadDisqSample;

function exportScheduleCSV(){
  const roomId=document.getElementById('sch-room')?.value||'';
  const entries=getScheduleEntries().filter(e=>!roomId||e.roomId===roomId);
  exportCSV(entries.map(e=>({'序':e.order,'考場':e.roomName,'班級':e.class,'座號':e.seat,'姓名':e.name,'樂器':e.instName,'類別':typeName(e.type),'指定曲作曲家':e.ac||'','指定曲曲目':e.at||'','自選曲作曲家':e.fc||'','自選曲曲目':e.ft||''})),'考試排程');
}

// ════════════════════════════════════════════════
// SCHEDULE EXPORT — XLSX / PDF
// ════════════════════════════════════════════════

// ── 核心：取得各考場已去重的出場名單 ──
function _getScheduleByRoom(){
  const snap=DB.savedScheduleSnapshot||{};
  const hasSnap=Object.values(snap).some(a=>Array.isArray(a)&&a.length>0);
  if(hasSnap){
    const byRoom={};
    // ★ 修正：收集所有考場的 removedEntries，過濾已被手動移除的學生
    const _getRemovedForRoom=(roomId)=>{
      const st=(SCH_STATE.roomId===roomId)?SCH_STATE:(_SCH_ROOM_STATES[roomId]||{});
      const raw=st.removedEntries;
      return raw instanceof Set?raw:new Set(Array.isArray(raw)?raw:[]);
    };
    DB.rooms.forEach(room=>{
      const removed=_getRemovedForRoom(room.id);
      const es=(snap[room.id]||[]).filter(e=>!removed.has(e.studentId+'_'+e.type));
      byRoom[room.id]={_roomId:room.id,name:room.name||room.id,location:room.location||'',entries:es.map((e,i)=>({...e,order:e.order??i+1}))};
    });
    Object.keys(snap).forEach(roomId=>{
      if(byRoom[roomId])return;
      const es=snap[roomId];if(!Array.isArray(es)||!es.length)return;
      const removed=_getRemovedForRoom(roomId);
      const filtered=es.filter(e=>!removed.has(e.studentId+'_'+e.type));
      byRoom[roomId]={_roomId:roomId,name:roomId,location:'',entries:filtered.map((e,i)=>({...e,order:e.order??i+1}))};
    });
    return byRoom;
  }
  const _origRoomId=SCH_STATE.roomId;
  _saveRoomState(_origRoomId);
  const allCandidates={};
  DB.rooms.forEach(room=>{
    SCH_STATE.roomId=room.id;
    _loadRoomState(room.id);
    allCandidates[room.id]=_buildFilteredEntries(room.id);
  });
  SCH_STATE.roomId=_origRoomId;
  _loadRoomState(_origRoomId);
  const assignment={};
  DB.rooms.forEach(room=>{
    (allCandidates[room.id]||[]).forEach(e=>{
      if(!e._forceInclude)return;
      const key=e.studentId+'_'+e.type;
      if(!assignment[key])assignment[key]=room.id;
    });
  });
  DB.rooms.forEach(room=>{
    (allCandidates[room.id]||[]).forEach(e=>{
      const key=e.studentId+'_'+e.type;
      if(!assignment[key])assignment[key]=room.id;
    });
  });
  const byRoom={};
  DB.rooms.forEach(room=>{
    const entries=(allCandidates[room.id]||[]).filter(e=>assignment[e.studentId+'_'+e.type]===room.id);
    entries.forEach((e,i)=>e.order=i+1);
    byRoom[room.id]={name:room.name||room.id,location:room.location||'',entries};
  });
  return byRoom;
}

// ── 共用：從 entry 取曲目（相容快照及即時 entry，均備從 DB 補回）──
function _getEntryRep(e){
  // ★ 修正：永遠優先從 DB.users 讀最新曲目，再 fallback 到快照值
  // 快照存檔時間點和學生填報時間點不同，快照中的曲目可能是舊值或空值
  let ac=e.ac||'',at=e.at||'',fc=e.fc||'',ft=e.ft||'';
  if(e.studentId){
    const stu=DB.users.find(u=>u.id===e.studentId);
    if(stu){
      let sa='',st='',sf='',sft='';
      if(e.type==='major'){sa=stu.major_ac||'';st=stu.major_at||'';sf=stu.major_fc||'';sft=stu.major_ft||'';}
      else if(e.type==='minor'){sa=stu.minor_ac||'';st=stu.minor_at||'';sf=stu.minor_fc||'';sft=stu.minor_ft||'';}
      else if(e.type==='elective'){sa=stu.elec_ac||'';st=stu.elec_at||'';sf=stu.elec_fc||'';sft=stu.elec_ft||'';}
      // DB.users 有值就用，沒有才保留快照值
      if(sa||st){ac=sa;at=st;}
      if(sf||sft){fc=sf;ft=sft;}
    }
  }
  return {ac,at,fc,ft};
}

// ── 共用：worksheet 欄寬 ──
function _wsColWidths(ws){
  ws['!cols']=[{wch:6},{wch:8},{wch:6},{wch:10},{wch:10},{wch:6},{wch:55}];
}

// ★ 清除 Excel sheet name 非法字元（: \ / ? * [ ] 及超過31字元）
function _sanitizeSheetName(name){
  return name.replace(/[:\\\/?*\[\]]/g,'_').slice(0,31)||'考場';
}

// ── 匯出目前考場 xlsx（單一工作表）──
function exportScheduleXLSX(){
  if(typeof XLSX==='undefined'){showToast('Excel 套件載入中，請稍後重試','err');return;}
  const roomId=SCH_STATE.roomId||'';
  if(!roomId){showToast('請先點選一個考場（非「全部考場」）','err');return;}
  const byRoom=_getScheduleByRoom();
  const roomData=byRoom[roomId];
  if(!roomData||!roomData.entries.length){showToast('此考場目前無出場名單','err');return;}
  const wb=XLSX.utils.book_new();
  const wsData=[['出場順序名單 — '+roomData.name+(roomData.location?' ('+roomData.location+')':'')]];
  wsData.push(['序號','班級','座號','姓名','樂器','修別','指定曲','自選曲']);
  roomData.entries.forEach(e=>{
    const {ac,at,fc,ft}=_getEntryRep(e);
    wsData.push([String(e.order).padStart(2,'0'),e.class||'',String(e.seat||''),e.name||'',e.instName||'',typeName(e.type),(ac||at)?(ac||'')+(at?' — '+at:''):'',(fc||ft)?(fc||'')+(ft?' — '+ft:''):'']);
  });
  const ws=XLSX.utils.aoa_to_sheet(wsData);
  ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:7}}];
  ws['!cols']=[{wch:6},{wch:8},{wch:6},{wch:10},{wch:10},{wch:6},{wch:32},{wch:32}];
  XLSX.utils.book_append_sheet(wb,ws,_sanitizeSheetName(roomData.name));
  XLSX.writeFile(wb,'出場順序_'+roomData.name+'.xlsx');
  showToast('已匯出「'+roomData.name+'」出場名單 ✓','ok');
}

// ── 統一匯出全部考場（每考場一個工作表）──
function exportAllRoomsXLSX(){
  if(typeof XLSX==='undefined'){showToast('Excel 套件載入中，請稍後重試','err');return;}
  const byRoom=_getScheduleByRoom();
  const wb=XLSX.utils.book_new();
  let sheetCount=0;
  const usedNames=new Set();
  Object.values(byRoom).forEach(roomData=>{
    if(!roomData.entries.length)return;
    const wsData=[['出場順序名單 — '+roomData.name+(roomData.location?' ('+roomData.location+')':'')]];
    wsData.push(['序號','班級','座號','姓名','樂器','修別','指定曲','自選曲']);
    roomData.entries.forEach(e=>{
      const {ac,at,fc,ft}=_getEntryRep(e);
      wsData.push([String(e.order).padStart(2,'0'),e.class||'',String(e.seat||''),e.name||'',e.instName||'',typeName(e.type),(ac||at)?(ac||'')+(at?' — '+at:''):'',(fc||ft)?(fc||'')+(ft?' — '+ft:''):'']);
    });
    const ws=XLSX.utils.aoa_to_sheet(wsData);
    ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:7}}];
    ws['!cols']=[{wch:6},{wch:8},{wch:6},{wch:10},{wch:10},{wch:6},{wch:32},{wch:32}];
    let sheetName=_sanitizeSheetName(roomData.name);
    if(usedNames.has(sheetName)){let n=2;while(usedNames.has(sheetName.slice(0,28)+'_'+n))n++;sheetName=sheetName.slice(0,28)+'_'+n;}
    usedNames.add(sheetName);
    XLSX.utils.book_append_sheet(wb,ws,sheetName);
    sheetCount++;
  });
  if(!sheetCount){showToast('目前無任何考場出場名單，請先完成排程並存檔','err');return;}
  const today=new Date().toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'}).replace(/\//g,'');
  XLSX.writeFile(wb,'出場順序_全考場_'+today+'.xlsx');
  showToast('已統一匯出 '+sheetCount+' 個考場的出場名單 ✓','ok');
}

// ── 匯出目前考場 PDF ──
function exportSchedulePDF(){
  const roomId=SCH_STATE.roomId||'';
  if(!roomId){showToast('請先點選一個考場（非「全部考場」）','err');return;}
  const byRoom=_getScheduleByRoom();
  const roomData=byRoom[roomId];
  if(!roomData||!roomData.entries.length){showToast('此考場目前無出場名單','err');return;}
  _openSchedulePrintWindow([roomData]);
}

// ── 統一匯出全部考場 PDF ──
function exportAllRoomsPDF(){
  const byRoom=_getScheduleByRoom();
  const rooms=Object.values(byRoom).filter(r=>r.entries.length>0);
  if(!rooms.length){showToast('目前無任何考場出場名單','err');return;}
  _openSchedulePrintWindow(rooms,{maxPagesPerRoom:2});
}

// ── 共用：開啟列印視窗 ──
function _openSchedulePrintWindow(rooms,opts){
  const today=new Date().toLocaleDateString('zh-TW',{year:'numeric',month:'long',day:'numeric'});
  const maxPagesPerRoom=(opts&&opts.maxPagesPerRoom)||0;
  const isMultiRoom=rooms.length>1;

  // ★ 依學生數動態計算 zoom（全考場模式才壓縮）
  // A4 可用高度（邊距 8mm x2 = 16mm，共 297-16=281mm）
  // header ≈ 26mm，table-header ≈ 8mm，footer ≈ 6mm → 可用 ≈ 241mm
  // 每列高度：正常 8.5mm，縮小模式 6mm
  // zoom 最小 0.6
  function _calcZoom(n){
    if(!maxPagesPerRoom||!isMultiRoom)return 1;
    const usableMmPerPage=241;
    const rowMm=8.5;
    const rowsPerPage=Math.floor(usableMmPerPage/rowMm); // ≈28
    const maxRows=rowsPerPage*maxPagesPerRoom;
    if(n<=maxRows)return 1;
    return Math.max(0.6, maxRows/n);
  }

  let html='<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">'
    +'<title>出場順序名單</title>'
    +'<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    +'<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@300;400;500;600;700&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap" rel="stylesheet">'
    +'<style>'
    +'*{box-sizing:border-box;margin:0;padding:0}'
    +'body{font-family:"Noto Serif TC","Microsoft JhengHei",serif;font-size:12px;color:#1a1a1a;background:#fff}'
    +'@page{margin:8mm 8mm}'
    +'.room-block{padding:10px 12px;page-break-after:always}'
    +'.room-block:last-child{page-break-after:auto}'
    +'.header{border-bottom:2px solid #8b6914;padding-bottom:6px;margin-bottom:8px}'
    +'.header-top{display:flex;align-items:flex-start;justify-content:space-between}'
    +'.room-title{font-size:15px;font-weight:700;color:#1a1a1a;margin:0 0 2px}'
    +'.room-meta{font-size:10px;color:#666}'
    +'.room-dt{font-size:11px;color:#8b6914;font-weight:600;margin:2px 0 1px;letter-spacing:.3px}'
    +'.school-name{font-size:10px;color:#888;letter-spacing:1px;white-space:nowrap;padding-top:2px}'
    +'table{width:100%;border-collapse:collapse;margin-top:6px}'
    +'thead tr{background:#2c2418;color:#f0e6c8}'
    +'th{padding:4px 6px;text-align:left;font-size:10px;letter-spacing:.5px;font-weight:500;white-space:nowrap}'
    +'tbody tr{border-bottom:1px solid #e8e0d0}'
    +'tbody tr:nth-child(even){background:#faf7f1}'
    +'td{padding:4px 6px;font-size:11px;vertical-align:top;line-height:1.4}'
    +'.seq{font-family:monospace;font-size:12px;font-weight:700;color:#8b6914;text-align:center}'
    +'.sname{font-weight:700;font-size:12px;display:block}'
    +'.sinfo{font-size:10px;color:#666;display:block;margin-top:0}'
    +'.inst{font-weight:600;color:#2c4a1c}'
    +'.tbadge{display:inline-block;padding:0px 5px;border-radius:8px;font-size:9px;font-weight:700;margin-left:4px;vertical-align:middle}'
    +'.major{background:#fff3cd;color:#856404}'
    +'.minor{background:#d1ecf1;color:#0c5460}'
    +'.elective{background:#d4edda;color:#155724}'
    +'.rep-line{display:block;font-size:10.5px;line-height:1.5;color:#333}'
    +'.rep-lbl{font-weight:700;color:#5a4010;margin-right:2px}'
    +'.no-rep{color:#bbb;font-style:italic;font-size:10px}'
    +'.footer{text-align:right;font-size:9px;color:#aaa;margin-top:6px;padding-top:4px;border-top:1px solid #e8e0d0}'
    +'.dq-row{background:#fff0f0!important}'
    +'.dq-badge{display:inline-block;padding:0px 5px;border-radius:8px;font-size:9px;font-weight:700;background:#dc3545;color:#fff;margin-left:4px;vertical-align:middle}'
    +'.dq-reason{display:block;font-size:9px;color:#c00;margin-top:1px;font-style:italic}'
    +'</style></head><body>';

  rooms.forEach(function(roomData){
    // ★ 計算考場日期時間字串（列印用）
    var _roomObj=DB.rooms.find(function(r){return r.id===roomData._roomId;});
    if(!_roomObj&&roomData.entries.length)_roomObj=DB.rooms.find(function(r){return r.name===roomData.name;});
    var _dtStr='';
    if(_roomObj){
      var _wk=['日','一','二','三','四','五','六'];
      var _fmtDt=function(iso){if(!iso)return null;var d=new Date(iso);if(isNaN(d))return null;return d.getFullYear()+'／'+(d.getMonth()+1<10?'0':'')+(d.getMonth()+1)+'／'+(d.getDate()<10?'0':'')+d.getDate()+'（'+_wk[d.getDay()]+'）'+(d.getHours()<10?'0':'')+d.getHours()+':'+(d.getMinutes()<10?'0':'')+d.getMinutes();};
      var _s=_fmtDt(_roomObj.dateStart),_e=_fmtDt(_roomObj.dateEnd);
      if(_s&&_e)_dtStr='📅 '+_s+' ～ '+_e;
      else if(_s)_dtStr='📅 '+_s;
    }
    roomData.datetime=_dtStr;
    var zoom=_calcZoom(roomData.entries.length);
    var zoomStyle=zoom<1?' style="zoom:'+zoom.toFixed(3)+'"':'';
    var scNote=zoom<1?'<span style="font-size:9px;color:#aaa;margin-left:8px">（縮放 '+(zoom*100).toFixed(0)+'%）</span>':'';
    html+='<div class="room-block"'+zoomStyle+'>'
      +'<div class="header"><div class="header-top">'
      +'<div><div class="room-title">\uD83D\uDCCB 出場順序名單\u3000'+roomData.name+scNote+'</div>'
      +(roomData.datetime?'<div class="room-dt">'+roomData.datetime+'</div>':'')
      +'<div class="room-meta">'+(roomData.location?'\uD83D\uDCCD '+roomData.location+'\u3000':'')+'共 '+roomData.entries.length+' 位學生\u3000列印日期：'+today+'</div></div>'
      +'<div class="school-name">音樂術科期末考評量系統</div>'
      +'</div></div>'
      +'<table><thead><tr>'
      +'<th style="width:38px;text-align:center">序</th>'
      +'<th style="width:90px">班級・座號<br><span style="font-weight:400;opacity:.7">姓名</span></th>'
      +'<th style="width:110px">樂器・修別</th>'
      +'<th>指定曲</th>'
      +'<th>自選曲</th>'
      +'</tr></thead><tbody>';
    roomData.entries.forEach(function(e){
      var rep=_getEntryRep(e);
      var ac=rep.ac,at=rep.at,fc=rep.fc,ft=rep.ft;
      var assignedHtml=(ac||at)?('<span class="rep-lbl"></span>'+(ac||'')+(at?' \u2014 '+at:'')):'<span class="no-rep">（未填）</span>';
      var freeHtml=(fc||ft)?('<span class="rep-lbl"></span>'+(fc||'')+(ft?' \u2014 '+ft:'')):'<span class="no-rep">（未填）</span>';
      var typeCls={major:'major',minor:'minor',elective:'elective'}[e.type]||'major';
      // ★ 修正：讀取扣考狀態並標注
      var entryKey=e.studentId+'_'+e.type;
      var dq=DB.disqualified&&DB.disqualified[entryKey];
      var dqBadge=dq?'<span class="dq-badge">⛔ 扣考</span>':'';
      var dqReason=dq?('<span class="dq-reason">原因：'+escHtml(dq.reason||'')+'</span>'):'';
      var trCls=dq?' class="dq-row"':'';
      html+='<tr'+trCls+'>'
        +'<td class="seq">'+String(e.order).padStart(2,'0')+'</td>'
        +'<td><span class="sname">'+escHtml(e.name||'')+dqBadge+'</span>'
        +dqReason
        +'<span class="sinfo">'+escHtml(e.class||'')+'\u30FB\u5EA7 '+escHtml(String(e.seat||''))+'</span></td>'
        +'<td><span class="inst">'+escHtml(e.instName||'')+'</span>'
        +'<span class="tbadge '+typeCls+'">'+typeName(e.type)+'</span></td>'
        +'<td><span class="rep-line">'+(dq?'<span class="no-rep">（扣考）</span>':assignedHtml)+'</span></td>'
        +'<td><span class="rep-line">'+(dq?'<span class="no-rep">（扣考）</span>':freeHtml)+'</span></td>'
        +'</tr>';
    });
    html+='</tbody></table>'
      +'<div class="footer">出場順序名單 \u2014 '+roomData.name+'\u3000共 '+roomData.entries.length+' 筆</div>'
      +'</div>';
  });
  html+='</body></html>';

  var win=window.open('','_blank','width=1050,height=780');
  if(!win){showToast('請允許彈出視窗以列印 PDF（瀏覽器可能封鎖了彈出視窗）','err');return;}
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.addEventListener('load',function(){setTimeout(function(){win.focus();win.print();},600);});
}

async function publishSchedule(){
  if(!requireRole('admin'))return;
  // ★ 自動推送：學生/教師下次登入會自動取得最新排程
  await publishSnapshot('schedule');
  showToast('已公告排程並推送給學生/教師 ✓','ok');
  renderStuSchedule();
}

// ════════════════════════════════════════════════
// ADMIN - USERS
// ════════════════════════════════════════════════
function adminStuFilterClass(cls,btn){
  const acf=document.getElementById('admin-class-filter');
  if(acf)acf.value=cls;
  document.querySelectorAll('#stu-class-btns button').forEach(b=>b.classList.remove('btn-p'));
  if(btn)btn.classList.add('btn-p');
  renderAdminStudents();
}
window.adminStuFilterClass=adminStuFilterClass;
// ★ 後台學生考場調整 Modal
function openStuRoomModal(stuId){
  const s=DB.users.find(u=>u.id===stuId);if(!s)return;
  // 找該生目前在各考場的狀態
  const inRooms={major:new Set(),minor:new Set(),elective:new Set()};

  // ── 來源 1（最權威）：savedScheduleSnapshot ──
  // 已按下「儲存排程」後產生的實際分配，每個 type 只在一個考場出現
  const snap=DB.savedScheduleSnapshot||{};
  const hasSnap=Object.values(snap).some(arr=>arr&&arr.length>0);
  if(hasSnap){
    Object.entries(snap).forEach(([roomId,entries])=>{
      (entries||[]).forEach(e=>{if(e.studentId===stuId)inRooms[e.type]?.add(roomId);});
    });
  } else {
    // ── Fallback：未存檔時用即時預測，每個 type 取第一個匹配的考場（避免重複勾選）──
    if(typeof _buildFilteredEntries==='function'){
      const foundTypes=new Set();
      DB.rooms.forEach(room=>{
        try{
          const entries=_buildFilteredEntries(room.id);
          entries.forEach(e=>{
            // 同一 type 已找到匹配考場就跳過（避免一個修別勾多個考場）
            const key=e.studentId+'_'+e.type;
            if(e.studentId===stuId&&!foundTypes.has(key)&&inRooms[e.type]){
              inRooms[e.type].add(room.id);
              foundTypes.add(key);
            }
          });
        }catch(err){}
      });
    }
  }

  // ── 來源 2：手動加入（extraEntries）— 永遠加入，覆蓋自動分配 ──
  Object.entries(_SCH_ROOM_STATES).forEach(([roomId,st])=>{
    (st.extraEntries||[]).forEach(ex=>{
      if(ex.studentId===stuId&&inRooms[ex.type])inRooms[ex.type].add(roomId);
    });
    // removedEntries：手動移除的
    const removed=st.removedEntries instanceof Set?st.removedEntries:new Set(st.removedEntries||[]);
    ['major','minor','elective'].forEach(t=>{
      if(removed.has(stuId+'_'+t))inRooms[t].delete(roomId);
    });
  });
  // 當前 SCH_STATE
  (SCH_STATE.extraEntries||[]).forEach(ex=>{
    if(ex.studentId===stuId&&inRooms[ex.type])inRooms[ex.type].add(ex.roomId||SCH_STATE.roomId||'');
  });
  ['major','minor','elective'].forEach(t=>{
    if(SCH_STATE.removedEntries?.has?.(stuId+'_'+t)&&SCH_STATE.roomId){
      inRooms[t].delete(SCH_STATE.roomId);
    }
  });

  // ★ 修正：顯示全部三個修別（含無樂器的）
  const ALL_TYPES=[
    {t:'major', l:'主修', inst:s.major},
    {t:'minor', l:'副修', inst:s.minor},
    {t:'elective',l:'選修',inst:s.elective},
  ];

  let modal=document.getElementById('stu-room-modal');
  if(!modal){
    modal=document.createElement('div');modal.id='stu-room-modal';modal.className='overlay';
    modal.innerHTML=`<div class="modal" style="width:560px;max-width:98vw">
      <h2 class="modal-t" id="srm-title"></h2>
      <div id="srm-body"></div>
      <div class="modal-ft">
        <button class="btn btn-s" onclick="closeOverlay('stu-room-modal')">關閉</button>
        <button class="btn btn-p" id="srm-save-btn">💾 儲存並強制加入排程</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('on');});
  }
  document.getElementById('srm-save-btn').onclick=()=>saveStuRoomModal(stuId);
  document.getElementById('srm-title').textContent=`調整考場 — ${s.name}（${s.class}·座${s.seat}）`;

  const roomOpts=DB.rooms.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  document.getElementById('srm-body').innerHTML=`
    <p style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted);margin-bottom:14px;line-height:1.9;background:var(--cream);padding:8px 12px;border-radius:var(--r);border-left:3px solid var(--gold)">
      勾選後儲存：該修別將<strong style="color:var(--ink)">強制加入</strong>指定考場的出場名單，<br>
      不受考場篩選條件、排除規則或樂器資料限制。<br>
      取消勾選儲存：從該考場名單中移除。
    </p>
    ${ALL_TYPES.map(({t,l,inst})=>{
      const assigned=[...inRooms[t]];
      const instLabel=inst?`<span style="color:var(--steel);font-size:10px;margin-left:4px">${iname(inst)}</span>`
                         :`<span style="color:var(--border);font-size:9px;margin-left:4px">（未填樂器）</span>`;
      const checkboxes=DB.rooms.map(r=>`
        <label style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border:1px solid ${assigned.includes(r.id)?'var(--gold)':'var(--border)'};border-radius:var(--r);cursor:pointer;font-size:12px;background:${assigned.includes(r.id)?'var(--gold-bg)':'var(--white)'};margin:3px;transition:all .15s" onmousedown="this.style.background='var(--gold-bg)'">
          <input type="checkbox" data-srm-type="${t}" data-srm-room="${r.id}" ${assigned.includes(r.id)?'checked':''}
            style="accent-color:var(--gold);width:14px;height:14px"
            onchange="this.closest('label').style.borderColor=this.checked?'var(--gold)':'var(--border)';this.closest('label').style.background=this.checked?'var(--gold-bg)':'var(--white)'">
          ${r.name}
        </label>`).join('');
      return `<div style="border:1px solid var(--border);border-radius:var(--r);margin-bottom:10px;overflow:hidden">
        <div style="background:var(--cream);padding:7px 12px;display:flex;align-items:center;gap:6px">
          <span style="font-family:DM Mono,monospace;font-size:9px;letter-spacing:1.5px;font-weight:600">${l}</span>
          ${instLabel}
          ${!inst?`<span style="font-family:DM Mono,monospace;font-size:8px;color:var(--orange);background:#fff3cd;border:1px solid #ffc107;border-radius:10px;padding:1px 7px;margin-left:auto">無樂器仍可強制加入</span>`:''}
        </div>
        <div style="padding:10px 12px;display:flex;flex-wrap:wrap;gap:4px">${checkboxes||'<span style="font-size:11px;color:var(--muted);font-family:DM Mono,monospace">尚未設定任何考場</span>'}</div>
      </div>`;
    }).join('')}`;
  openOverlay('stu-room-modal');
}
window.openStuRoomModal=openStuRoomModal;

// ★ 儲存學生考場調整，強制寫入排程快照 + SCH_STATE extraEntries 雙軌同步
function saveStuRoomModal(stuId){
  const modal=document.getElementById('stu-room-modal');if(!modal)return;
  const s=DB.users.find(u=>u.id===stuId);if(!s)return;

  // 讀取所有勾選的 type → roomId 配對
  const checks=[...modal.querySelectorAll('[data-srm-type]')];
  const assignments={major:[],minor:[],elective:[]};
  checks.filter(cb=>cb.checked).forEach(cb=>{
    const t=cb.dataset.srmType, r=cb.dataset.srmRoom;
    if(assignments[t]&&!assignments[t].includes(r))assignments[t].push(r);
  });
  // 取消勾選的（原本有、現在沒有）
  const removedAssignments={major:[],minor:[],elective:[]};
  checks.filter(cb=>!cb.checked).forEach(cb=>{
    const t=cb.dataset.srmType, r=cb.dataset.srmRoom;
    if(removedAssignments[t]&&!removedAssignments[t].includes(r))removedAssignments[t].push(r);
  });

  // ── 1. 更新 DB.savedScheduleSnapshot ──
  const snap=DB.savedScheduleSnapshot||{};
  // 移除此學生所有舊紀錄
  Object.keys(snap).forEach(roomId=>{
    snap[roomId]=(snap[roomId]||[]).filter(e=>e.studentId!==stuId);
  });
  // 加入新紀錄（強制，不受樂器/篩選限制）
  const getInst=(t)=>s[t]?DB.instruments.items.find(i=>i.id===s[t]):null;
  const getCat=(t)=>{const i=getInst(t);return i?DB.instruments.categories.find(c=>c.id===i.cat):null;};
  ['major','minor','elective'].forEach(t=>{
    (assignments[t]||[]).forEach(roomId=>{
      if(!snap[roomId])snap[roomId]=[];
      const room=DB.rooms.find(r=>r.id===roomId)||{name:'—',location:''};
      const acKey=t==='elective'?'elec_ac':t+'_ac';
      const atKey=t==='elective'?'elec_at':t+'_at';
      const fcKey=t==='elective'?'elec_fc':t+'_fc';
      const ftKey=t==='elective'?'elec_ft':t+'_ft';
      const existingOrders=snap[roomId].map(e=>e.order||0);
      const nextOrder=existingOrders.length?Math.max(...existingOrders)+1:1;
      const instObj=getInst(t);
      snap[roomId].push({
        entryKey:stuId+'_'+t,studentId:stuId,name:s.name,class:s.class,seat:s.seat,
        instId:s[t]||'',instName:instObj?iname(instObj.id):'（無樂器）',
        catId:getCat(t)?.id||'',
        type:t,order:nextOrder,
        ac:s[acKey]||'',at:s[atKey]||'',fc:s[fcKey]||'',ft:s[ftKey]||'',
        roomId,roomName:room.name,roomLocation:room.location||'',
        _forceInclude:true,
      });
    });
  });
  DB.savedScheduleSnapshot=snap;

  // ── 2. 同步更新 SCH_STATE extraEntries / removedEntries（雙軌同步）──
  // 先清除此學生在所有考場的 extraEntries
  DB.rooms.forEach(room=>{
    const st=_SCH_ROOM_STATES[room.id];
    if(st){
      st.extraEntries=(st.extraEntries||[]).filter(ex=>ex.studentId!==stuId);
    }
  });
  SCH_STATE.extraEntries=(SCH_STATE.extraEntries||[]).filter(ex=>ex.studentId!==stuId);

  // 依新 assignments 加入 extraEntries（強制加入，不受排除規則影響）
  ['major','minor','elective'].forEach(t=>{
    (assignments[t]||[]).forEach(roomId=>{
      const entry={studentId:stuId,type:t,roomId,_forceInclude:true};
      // 寫入對應 _SCH_ROOM_STATES
      if(!_SCH_ROOM_STATES[roomId]){
        _SCH_ROOM_STATES[roomId]={
          catOrder:[],instOrder:[],
          typeOrder:[{key:'major',label:'主修',active:true},{key:'minor',label:'副修',active:true},{key:'elective',label:'選修',active:true}],
          classOrder:[],seatDir:1,extraEntries:[],removedEntries:new Set(),excludeRules:[],
        };
      }
      const st=_SCH_ROOM_STATES[roomId];
      // 清除 removedEntries 中的舊記錄
      st.removedEntries.delete(stuId+'_'+t);
      if(!st.extraEntries.some(ex=>ex.studentId===stuId&&ex.type===t)){
        st.extraEntries.push(entry);
      }
      // 若目前考場就是這個 room，也更新 SCH_STATE
      if(SCH_STATE.roomId===roomId||!SCH_STATE.roomId){
        SCH_STATE.removedEntries.delete(stuId+'_'+t);
        if(!SCH_STATE.extraEntries.some(ex=>ex.studentId===stuId&&ex.type===t)){
          SCH_STATE.extraEntries.push(entry);
        }
      }
    });
    // 取消勾選的考場：加入 removedEntries
    (removedAssignments[t]||[]).forEach(roomId=>{
      const st=_SCH_ROOM_STATES[roomId];
      if(st){
        st.extraEntries=(st.extraEntries||[]).filter(ex=>!(ex.studentId===stuId&&ex.type===t));
        st.removedEntries.add(stuId+'_'+t);
      }
      if(SCH_STATE.roomId===roomId){
        SCH_STATE.extraEntries=(SCH_STATE.extraEntries||[]).filter(ex=>!(ex.studentId===stuId&&ex.type===t));
        SCH_STATE.removedEntries.add(stuId+'_'+t);
      }
    });
  });

  // ── 3. 存入 Firebase ──
  if(window._FB){
    // ★ 修正 R9：寫入分拆的 scheduleSnapshots（與 schSaveSchedule 保持一致）
    Object.entries(snap).forEach(([roomId,entries])=>{
      fbSet('scheduleSnapshots',roomId,{entries:entries||[],_savedAt:new Date().toISOString()});
    });
    // 舊版相容（小於 800KB 才寫）
    try{
      const snapStr=JSON.stringify(snap);
      if(snapStr.length<800000)fbSet('scheduleState','snapshot',{data:snapStr});
    }catch(e){}
    // ★ 關鍵修正：同時寫入 scheduleState/main，把 _SCH_ROOM_STATES.extraEntries 持久化
    //    否則重新整理後 _SCH_ROOM_STATES 會被舊資料覆蓋，extraEntries 消失
    try{
      _saveRoomState(SCH_STATE.roomId);
      const stateData={};
      Object.entries(_SCH_ROOM_STATES).forEach(([rid,st])=>{
        stateData[rid]={
          catOrder:st.catOrder||[],instOrder:st.instOrder||[],
          typeOrder:st.typeOrder||[],classOrder:st.classOrder||[],
          seatDir:st.seatDir||1,
          extraEntries:st.extraEntries||[],
          removedEntries:[...(st.removedEntries||[])],
          excludeRules:st.excludeRules||[],
          manualOrder:st.manualOrder||[],
        };
      });
      fbSet('scheduleState','main',{data:JSON.stringify(stateData)});
    }catch(e){console.warn('[saveStuRoom] 寫入 scheduleState/main 失敗',e);}
    showToast(`${s.name} 考場已強制更新並同步 ✓`,'ok');
  } else {
    try{localStorage.setItem('scheduleSnapshot',JSON.stringify(snap));}catch(e){}
    showToast(`${s.name} 考場已更新（本機）✓`,'ok');
  }
  closeOverlay('stu-room-modal');

  // ── 4. 立即重新渲染所有相關頁面 ──
  renderSchedule();
  if(typeof renderAdminStudents==='function')renderAdminStudents();
  renderStuSchedule();
}
window.saveStuRoomModal=saveStuRoomModal;

function renderAdminStudents(){
  const tbody=document.getElementById('admin-stu-tbody');if(!tbody)return;
  // ★ 同步更新班級下拉選單（確保切換有效）
  const acf=document.getElementById('admin-class-filter');
  if(acf){
    const prev=acf.value;
    while(acf.options.length>1)acf.remove(1);
    DB.classes.forEach(c=>acf.appendChild(new Option(c,c)));
    if(DB.classes.includes(prev))acf.value=prev;
  }
  // ★ #4 同步班級快速按鈕
  const btnBar=document.getElementById('stu-class-btns');
  if(btnBar){
    btnBar.innerHTML='<button class="btn btn-sm '+((!acf||!acf.value)?'btn-p':'btn-s')+'" onclick="adminStuFilterClass(\'\',this)">全部班級</button>';
    DB.classes.forEach(c=>{
      const b=document.createElement('button');
      b.className='btn btn-sm '+(acf&&acf.value===c?'btn-p':'btn-s');
      b.textContent=c;
      b.onclick=function(){adminStuFilterClass(c,this);};
      btnBar.appendChild(b);
    });
  }
  const cf=acf?.value||'';
  const instF=document.getElementById('admin-inst-filter')?.value||'';
  let stus=students().filter(s=>!cf||s.class===cf);
  if(instF)stus=stus.filter(s=>s.major===instF||s.minor===instF||s.elective===instF);
  // ★ Fix: sort by class order first, then seat
  stus=stus.sort((a,b)=>{
    const ci=DB.classes.indexOf(a.class)-DB.classes.indexOf(b.class);
    if(ci!==0)return ci;
    return (a.seat||0)-(b.seat||0);
  });
  if(!stus.length){
    tbody.innerHTML='<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px">此班級無學生資料</td></tr>';
    return;
  }
  // ★ 建立學生→考場對照表（從快照）
  // 同時支援 snap.roomId 欄位和外層 key 兩種來源，確保對得上
  const stuRoomMap={};
  const snapData=DB.savedScheduleSnapshot||{};
  Object.entries(snapData).forEach(([outerRoomId,snaps])=>{
    if(!snaps||!snaps.length)return;
    (snaps).forEach(snap=>{
      // roomId 優先用 snap.roomId，fallback 外層 key
      const roomId=snap.roomId||outerRoomId;
      const rName=DB.rooms.find(r=>r.id===roomId)?.name
                ||DB.rooms.find(r=>r.id===outerRoomId)?.name
                ||(snap.roomName||roomId);
      if(!stuRoomMap[snap.studentId])stuRoomMap[snap.studentId]={major:[],minor:[],elective:[]};
      const t=snap.type;
      if((t==='major'||t==='minor'||t==='elective')&&!stuRoomMap[snap.studentId][t].includes(rName)){
        stuRoomMap[snap.studentId][t].push(rName);
      }
    });
  });
  tbody.innerHTML=stus.map(s=>{
    const rm=stuRoomMap[s.id]||{major:[],minor:[],elective:[]};
    const roomLines=[
      s.major?`<div style="font-size:10px;font-family:DM Mono,monospace;line-height:1.7"><span style="color:var(--muted);letter-spacing:.5px">主</span> ${rm.major.length?rm.major.join('、'):'<span style="color:var(--border)">未分配</span>'}</div>`:'',
      s.minor?`<div style="font-size:10px;font-family:DM Mono,monospace;line-height:1.7"><span style="color:var(--muted);letter-spacing:.5px">副</span> ${rm.minor.length?rm.minor.join('、'):'<span style="color:var(--border)">未分配</span>'}</div>`:'',
      s.elective?`<div style="font-size:10px;font-family:DM Mono,monospace;line-height:1.7"><span style="color:var(--muted);letter-spacing:.5px">選</span> ${rm.elective.length?rm.elective.join('、'):'<span style="color:var(--border)">未分配</span>'}</div>`:'',
    ].filter(Boolean);
    const roomCell=`<div style="display:flex;flex-direction:column;gap:1px">${roomLines.join('')}</div><button class="btn btn-s btn-xs" style="margin-top:4px;font-size:8px" onclick="openStuRoomModal('${s.id}')">✎ 調整考場</button>`;
    return `<tr>
    <td style="text-align:center"><input type="checkbox" class="stu-chk" data-id="${s.id}" onchange="updateBulkBar('student')" style="cursor:pointer;width:14px;height:14px"></td>
    <td><strong style="color:var(--ink)">${s.class}</strong></td>
    <td style="font-family:DM Mono,monospace;font-size:12px;color:var(--ink)">${s.seat}</td>
    <td><strong style="color:var(--ink)">${s.name}</strong></td>
    <td style="color:var(--ink)">${iname(s.major)||'—'}</td>
    <td style="color:var(--muted)">${iname(s.minor)||'—'}</td>
    <td style="color:var(--muted)">${iname(s.elective)||'—'}</td>
    <td style="vertical-align:top;padding-top:5px">${roomCell}</td>
    <td style="text-align:center"><span class="dot ${s.repDone?'dg':'dr'}" title="${s.repDone?'已填報':'未填報'}"></span></td>
    <td style="text-align:center"><span class="dot ${s.teaDone?'dg':'dr'}" title="${s.teaDone?'已評量':'未評量'}"></span></td>
    <td><div class="bg"><button class="btn btn-s btn-xs" onclick="editUser('${s.id}')">編輯</button><button class="btn btn-s btn-xs" onclick="resetUserPwd('${s.id}')">重置</button><button class="btn btn-d btn-xs" onclick="deleteUser('${s.id}')">刪</button></div></td>
  </tr>`;}).join('');
  // 每次重繪後重設全選狀態
  const allChk=document.getElementById('stu-chk-all');
  if(allChk)allChk.checked=false;
  updateBulkBar('student');
}

// ★ 專長樂器：解析 id → 顯示名稱與所屬大項（相容舊資料的大項 id 與新的細項樂器 id）
function _specInfo(id){
  const cats=DB.instruments.categories||[];
  const items=DB.instruments.items||[];
  const item=items.find(i=>i.id===id);
  if(item){
    const cat=cats.find(c=>c.id===item.cat);
    return {name:item.name, catId:item.cat||'', catName:cat?.name||'', catOrder:cats.findIndex(c=>c.id===item.cat)};
  }
  const cat=cats.find(c=>c.id===id);
  if(cat)return {name:cat.name+'（大項）', catId:cat.id, catName:cat.name, catOrder:cats.findIndex(c=>c.id===cat.id)};
  return {name:id, catId:'', catName:'', catOrder:999};
}

// ★ 專長樂器下拉選項：依大項分組列出細項樂器
function _specSelectOptions(){
  const cats=DB.instruments.categories||[];
  const items=DB.instruments.items||[];
  let html='<option value="">— 選擇樂器 —</option>';
  cats.forEach(c=>{
    const group=items.filter(i=>i.cat===c.id);
    if(!group.length)return;
    html+=`<optgroup label="${c.name}">${group.map(i=>`<option value="${i.id}">${i.name}</option>`).join('')}</optgroup>`;
  });
  const orphan=items.filter(i=>!cats.some(c=>c.id===i.cat));
  if(orphan.length)html+=`<optgroup label="其他">${orphan.map(i=>`<option value="${i.id}">${i.name}</option>`).join('')}</optgroup>`;
  return html;
}
window._specSelectOptions=_specSelectOptions;

// ★ 編輯視窗：渲染專長標籤
function _renderEmSpecChips(){
  const el=document.getElementById('em-spec-chips');if(!el)return;
  const sp=ST._emSpecs||[];
  el.innerHTML=sp.length?sp.map(id=>{
    const info=_specInfo(id);
    return `<span class="badge b-major" style="display:inline-flex;align-items:center;gap:4px;font-size:10px">${info.name}<button type="button" onclick="emRemoveSpec('${id}')" style="background:none;border:none;cursor:pointer;color:inherit;font-size:12px;line-height:1;padding:0">✕</button></span>`;
  }).join(''):'<span style="font-size:11px;color:var(--muted)">尚未設定專長</span>';
}
window._renderEmSpecChips=_renderEmSpecChips;

function emAddSpec(){
  const sel=document.getElementById('em-spec-add');
  const v=sel?.value;
  if(!v){showToast('請先選擇樂器','err');return;}
  if(!ST._emSpecs)ST._emSpecs=[];
  if(ST._emSpecs.includes(v)){showToast('已在專長清單中','warn');return;}
  ST._emSpecs.push(v);
  sel.value='';
  _renderEmSpecChips();
}
window.emAddSpec=emAddSpec;

function emRemoveSpec(id){
  ST._emSpecs=(ST._emSpecs||[]).filter(x=>x!==id);
  _renderEmSpecChips();
}
window.emRemoveSpec=emRemoveSpec;

// ★ 取得某專長 id 的「全域樂器順序」index：先依大項順序，再依大項內細項順序
//   讓「依樂器別」排序符合樂器設定裡的細項排列；回傳大數值代表排最後
function _specGlobalOrder(id){
  const cats=DB.instruments.categories||[];
  const items=DB.instruments.items||[];
  const item=items.find(i=>i.id===id);
  if(item){
    const ci=cats.findIndex(c=>c.id===item.cat);
    const itemsInCat=items.filter(i=>i.cat===item.cat);
    const ii=itemsInCat.findIndex(i=>i.id===id);
    return (ci<0?999:ci)*1000 + (ii<0?999:ii);
  }
  // 舊資料：存的是大項 id
  const ci=cats.findIndex(c=>c.id===id);
  return (ci<0?999:ci)*1000 + 999;
}

// ★ 渲染「篩選專長」下拉（依大項分組列出細項樂器）
function teaSpecFilterChanged(){ renderAdminTeachers(); }
window.teaSpecFilterChanged=teaSpecFilterChanged;

function _renderTeaSpecFilter(keepVal){
  const sel=document.getElementById('tea-spec-filter');if(!sel)return;
  const cur=keepVal!==undefined?keepVal:(sel.value||'');
  const cats=DB.instruments.categories||[];
  const items=DB.instruments.items||[];
  let html='<option value="">全部專長</option><option value="__none__">尚未設定專長</option>';
  cats.forEach(c=>{
    const group=items.filter(i=>i.cat===c.id);
    if(!group.length)return;
    html+=`<optgroup label="${c.name}">${group.map(i=>`<option value="${i.id}">${i.name}</option>`).join('')}</optgroup>`;
  });
  sel.innerHTML=html;
  sel.value=cur; // 保留目前選擇
}
window._renderTeaSpecFilter=_renderTeaSpecFilter;

let _teaSortDir=1; // 1=筆畫正序 -1=倒序
let _teaSortMode='stroke'; // 'stroke' = 依姓名筆畫；'inst' = 依專長樂器別順序
function sortTeaList(dir){
  _teaSortDir=dir;
  _teaSortMode='stroke';
  document.getElementById('tea-sort-asc').className='btn btn-sm '+(dir===1?'btn-p':'btn-s');
  document.getElementById('tea-sort-desc').className='btn btn-sm '+(dir===-1?'btn-p':'btn-s');
  document.getElementById('tea-sort-inst').className='btn btn-sm btn-s';
  renderAdminTeachers();
}
window.sortTeaList=sortTeaList;
// ★ 依「樂器大項」設定順序排序（同樂器別內再依姓名筆畫排序）；無專長設定者排最後
function sortTeaListByInst(){
  _teaSortMode='inst';
  document.getElementById('tea-sort-asc').className='btn btn-sm btn-s';
  document.getElementById('tea-sort-desc').className='btn btn-sm btn-s';
  document.getElementById('tea-sort-inst').className='btn btn-sm btn-p';
  renderAdminTeachers();
}
window.sortTeaListByInst=sortTeaListByInst;
function renderAdminTeachers(){
  const tbody=document.getElementById('admin-tea-tbody');if(!tbody)return;
  // ★ 先讀取目前篩選值，再重建下拉（重建會清掉 value，需先存後復原）
  const filter=document.getElementById('tea-spec-filter')?.value||'';
  _renderTeaSpecFilter(filter);
  let list=teachers().slice();
  // ★ 篩選專長
  if(filter==='__none__'){
    list=list.filter(t=>!(t.specialtyInsts&&t.specialtyInsts.length));
  } else if(filter){
    list=list.filter(t=>(t.specialtyInsts||[]).includes(filter));
  }
  let sorted;
  if(_teaSortMode==='inst'){
    // ★ 依「全域樂器順序」（大項順序 → 大項內細項順序）排序
    sorted=list.sort((a,b)=>{
      const ao=Math.min(...((a.specialtyInsts&&a.specialtyInsts.length)?a.specialtyInsts.map(_specGlobalOrder):[999999]));
      const bo=Math.min(...((b.specialtyInsts&&b.specialtyInsts.length)?b.specialtyInsts.map(_specGlobalOrder):[999999]));
      if(ao!==bo)return ao-bo;
      return a.name.localeCompare(b.name,'zh-TW-u-co-stroke');
    });
  } else {
    sorted=list.sort((a,b)=>_teaSortDir*(a.name.localeCompare(b.name,'zh-TW-u-co-stroke')));
  }
  tbody.innerHTML=sorted.map(t=>{
    const specHtml=(t.specialtyInsts||[]).map(id=>{
      const info=_specInfo(id);
      return `<span class="badge b-major" style="font-size:9px" title="${info.catName}">${info.name}</span>`;
    }).join(' ')||'<span style="color:var(--border);font-size:11px">—</span>';
    const rawStuIds=DB.teacherStudents[t.id]||[];
    // ★ 聯動修正：過濾孤兒 ID（對應學生已被刪除），並自動清理 Firebase
    const validStuIds=rawStuIds.filter(sid=>DB.users.find(u=>u.id===sid));
    const orphanCount=rawStuIds.length-validStuIds.length;
    if(orphanCount>0){
      DB.teacherStudents[t.id]=validStuIds;
      fbSet('teacherStudents',t.id,{list:validStuIds});
    }
    const myStus=validStuIds.map(sid=>DB.users.find(u=>u.id===sid)?.name||'').filter(Boolean).join('、')||'尚未設定';
    return `<tr>
    <td style="text-align:center"><input type="checkbox" class="tea-chk" data-id="${t.id}" onchange="updateBulkBar('teacher')" style="cursor:pointer;width:14px;height:14px"></td>
    <td><strong>${t.name}</strong></td>
    <td style="font-family:\'DM Mono\',monospace;font-size:11px">${t.account}</td>
    <td style="font-size:12px">${specHtml}</td>
    <td style="font-size:12px;color:var(--muted);max-width:220px">${myStus}</td>
    <td><div class="bg">
      <button class="btn btn-b btn-xs" onclick="openTeaStuModal('${t.id}')">指導的學生</button>
      <button class="btn btn-s btn-xs" onclick="editUser('${t.id}')">編輯</button>
      <button class="btn btn-s btn-xs" onclick="resetUserPwd('${t.id}')">重置密碼</button>
      <button class="btn btn-d btn-xs" onclick="deleteUser('${t.id}')">刪</button>
    </div></td>
  </tr>`;}).join('');
  // 每次重繪後重設全選狀態
  const allChk=document.getElementById('tea-chk-all');
  if(allChk)allChk.checked=false;
  updateBulkBar('teacher');
}

function renderAdminAdmins(){
  const tbody=document.getElementById('admin-adm-tbody');if(!tbody)return;
  tbody.innerHTML=admins().map(a=>`<tr>
    <td><strong>${a.name}</strong></td>
    <td style="font-family:\'DM Mono\',monospace;font-size:11px">${a.account}</td>
    <td><div class="bg"><button class="btn btn-s btn-xs" onclick="editUser('${a.id}')">編輯</button><button class="btn btn-s btn-xs" onclick="resetUserPwd('${a.id}')">重置密碼</button><button class="btn btn-d btn-xs" onclick="deleteUser('${a.id}')">刪除</button></div></td>
  </tr>`).join('');
}

function showAddUser(role){
  const rLabel={student:'學生',teacher:'教師',admin:'管理員'}[role];
  document.getElementById('edit-modal-title').textContent='新增'+rLabel;
  let extra='';
  if(role==='student')extra=`
    <div class="fr">
      <div class="fg"><label>班級</label><select id="em-class">${DB.classes.map(c=>`<option>${c}</option>`).join('')}</select></div>
      <div class="fg"><label>座號</label><input type="number" id="em-seat" min="1" value="1"></div>
    </div>`;
  if(role==='teacher'){
    const stuOptions=students().sort((a,b)=>{const ci=DB.classes.indexOf(a.class)-DB.classes.indexOf(b.class);return ci!==0?ci:(a.seat-b.seat);}).map(s=>`<option value="${s.id}">${s.class}·${s.seat} ${s.name}</option>`).join('');
    extra=`<div class="fg" style="margin-top:8px"><label>指導的學生（可多選，按 Ctrl/Cmd 複選）</label>
      <select id="em-stu-multi" multiple style="height:140px;padding:4px 6px;font-size:13px;border:1px solid var(--border);border-radius:var(--r);outline:none;background:var(--paper)">${stuOptions}</select>
      <div style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted);margin-top:4px;letter-spacing:.5px">選擇後也可至教師名單列表隨時修改</div>
    </div>`;
  }
  document.getElementById('edit-modal-body').innerHTML=`
    <div class="fr"><div class="fg"><label>姓名</label><input type="text" id="em-name" placeholder="姓名"></div><div class="fg"><label>帳號（登入用）</label><input type="text" id="em-account" placeholder="帳號（英數字）" autocomplete="off"></div></div>
    ${extra}
    <div class="fg" style="max-width:220px"><label>初始密碼</label><input type="text" id="em-pass" value="000" autocomplete="off"></div>`;
  document.getElementById('edit-modal-save').onclick=()=>{
    const name=document.getElementById('em-name').value.trim();
    const account=document.getElementById('em-account').value.trim();
    const pass=document.getElementById('em-pass').value.trim()||'000';
    if(!name||!account){showToast('請填寫姓名及帳號','err');return;}
    // Check duplicate account
    if(DB.users.find(u=>u.account===account)){showToast('此帳號已存在，請換一個','err');return;}
    const nu={id:role[0]+Date.now(),name,account,pass,role};
    if(role==='student'){nu.class=document.getElementById('em-class').value;nu.seat=+document.getElementById('em-seat').value;nu.repDone=false;nu.teaDone=false;}
    if(role==='teacher'){
      const sel=document.getElementById('em-stu-multi');
      if(sel){const ids=[...sel.selectedOptions].map(o=>o.value);if(ids.length){DB.teacherStudents[nu.id]=ids;fbSet('teacherStudents',nu.id,{list:ids});}}
    }
    fbSet('users',nu.id,nu);
    DB.users.push(nu);closeOverlay('edit-modal');showToast('已新增 '+name+'（帳號：'+account+'）✓','ok');renderAll();updateStats();
  };
  openOverlay('edit-modal');setTimeout(()=>document.getElementById('em-name').focus(),200);
}

function editUser(id){
  const u=DB.users.find(x=>x.id===id);if(!u)return;
  document.getElementById('edit-modal-title').textContent='編輯 — '+u.name;
  let extra='';
  if(u.role==='student')extra=`
    <div class="fr">
      <div class="fg"><label>班級</label><select id="em-class">${DB.classes.map(c=>`<option ${c===u.class?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="fg"><label>座號</label><input type="number" id="em-seat" value="${u.seat}"></div>
    </div>
    <div class="fr">
      <div class="fg"><label>主修</label><select id="em-major"><option value="">—</option>${DB.instruments.items.map(i=>`<option value="${i.id}" ${i.id===u.major?'selected':''}>${i.name}</option>`).join('')}</select></div>
      <div class="fg"><label>副修</label><select id="em-minor"><option value="">—</option>${DB.instruments.items.map(i=>`<option value="${i.id}" ${i.id===u.minor?'selected':''}>${i.name}</option>`).join('')}</select></div>
      <div class="fg"><label>選修</label><select id="em-elective"><option value="">—</option>${DB.instruments.items.map(i=>`<option value="${i.id}" ${i.id===u.elective?'selected':''}>${i.name}</option>`).join('')}</select></div>
    </div>`;
  if(u.role==='teacher'){
    ST._emSpecs=[...(u.specialtyInsts||[])];
    extra=`
    <div class="fg">
      <label>專長樂器（可複選，不限數量）</label>
      <div id="em-spec-chips" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px;min-height:24px"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <select id="em-spec-add" style="flex:1;min-width:180px">${_specSelectOptions()}</select>
        <button type="button" class="btn btn-s btn-sm" onclick="emAddSpec()">＋ 加入專長</button>
      </div>
    </div>`;
  }
  document.getElementById('edit-modal-body').innerHTML=`
    <div class="fr"><div class="fg"><label>姓名</label><input type="text" id="em-name" value="${u.name}"></div><div class="fg"><label>帳號</label><input type="text" id="em-account" value="${u.account}"></div></div>
    ${extra}
    <div class="fg" style="max-width:220px"><label>修改密碼（留空則不變）</label><input type="text" id="em-pass-edit" placeholder="輸入新密碼，留空不改"></div>`;
  if(u.role==='teacher')_renderEmSpecChips();
  document.getElementById('edit-modal-save').onclick=async ()=>{
    u.name=document.getElementById('em-name').value.trim()||u.name;
    u.account=document.getElementById('em-account').value.trim()||u.account;
    const newPass=document.getElementById('em-pass-edit').value.trim();
    if(newPass) u.pass=_passEncode(newPass,u.id); // ★ 修正 R4：混淆密碼
    if(u.role==='student'){u.class=document.getElementById('em-class').value;u.seat=+document.getElementById('em-seat').value;u.major=document.getElementById('em-major').value;u.minor=document.getElementById('em-minor').value;u.elective=document.getElementById('em-elective').value;}
    if(u.role==='teacher'){
      u.specialtyInsts=[...new Set(ST._emSpecs||[])];
    }
    // ★ 修正：改用 await 寫入並確認結果，避免 fire-and-forget 寫入失敗卻仍顯示「已更新」
    let ok=true;
    try{
      const clean=JSON.parse(JSON.stringify({...u, _updatedAt:new Date().toISOString()}));
      if(window._FB&&window._FB._rest){
        ok=await window._FB._set('users/'+u.id, clean);
      }else if(window._FB){
        await window._FB.db.collection('users').doc(u.id).set(clean,{merge:true});
      }
    }catch(e){console.warn('[editUser save]',e);ok=false;}
    closeOverlay('edit-modal');
    showToast(ok?'已更新 ✓':'更新失敗，請檢查網路連線後重試','warn');
    renderAll();
  };
  openOverlay('edit-modal');
}

function resetUserPwd(id){const u=DB.users.find(x=>x.id===id);if(!u)return;const enc=_passEncode('000',id);u.pass=enc;fbSet('users',id,{pass:enc});showToast(u.name+' 密碼已重置為 000','ok');}
// 刪除使用者並清理所有關聯資料
function _deleteUserCascade(id){
  const u=DB.users.find(x=>x.id===id);
  if(!u)return;
  // 1. 刪除 Firebase 使用者文件
  fbDelete('users',id);
  // 2. 若為學生：清理 teacherComments、juryScores extraEntries、savedScheduleSnapshot、SCH_STATE extraEntries
  if(u.role==='student'){
    // teacherComments
    if(DB.teacherComments[id]){delete DB.teacherComments[id];fbDelete('teacherComments',id);}
    // 從所有教師的 teacherStudents 中移除
    Object.keys(DB.teacherStudents).forEach(tid=>{
      const before=DB.teacherStudents[tid]||[];
      const after=before.filter(sid=>sid!==id);
      if(after.length!==before.length){DB.teacherStudents[tid]=after;fbSet('teacherStudents',tid,{list:after});}
    });
    // savedScheduleSnapshot：移除此學生的所有紀錄
    let snapChanged=false;
    const changedRooms=[];
    Object.keys(DB.savedScheduleSnapshot||{}).forEach(roomId=>{
      const before=DB.savedScheduleSnapshot[roomId]||[];
      const after=before.filter(e=>e.studentId!==id);
      if(after.length!==before.length){DB.savedScheduleSnapshot[roomId]=after;snapChanged=true;changedRooms.push(roomId);}
    });
    if(snapChanged){
      // ★ 修正 R9：寫入分拆的 scheduleSnapshots（只更動的考場才寫）
      changedRooms.forEach(roomId=>{
        fbSet('scheduleSnapshots',roomId,{entries:DB.savedScheduleSnapshot[roomId]||[],_savedAt:new Date().toISOString()});
      });
      try{
        const snapStr=JSON.stringify(DB.savedScheduleSnapshot);
        if(snapStr.length<800000)fbSet('scheduleState','snapshot',{data:snapStr});
      }catch(e){}
    }
    // SCH_STATE extraEntries / removedEntries
    SCH_STATE.extraEntries=(SCH_STATE.extraEntries||[]).filter(e=>e.studentId!==id);
    SCH_STATE.removedEntries.forEach(k=>{if(k.startsWith(id+'_'))SCH_STATE.removedEntries.delete(k);});
    Object.values(_SCH_ROOM_STATES).forEach(st=>{
      st.extraEntries=(st.extraEntries||[]).filter(e=>e.studentId!==id);
      if(st.removedEntries)st.removedEntries.forEach(k=>{if(k.startsWith(id+'_'))st.removedEntries.delete(k);});
    });
    // disqualified
    if(DB.disqualified){Object.keys(DB.disqualified).forEach(k=>{if(k.startsWith(id+'_')){delete DB.disqualified[k];fbDelete('disqualified',k);}});}
    // blackSign
    Object.keys(DB.blackSign||{}).forEach(roomId=>{if(DB.blackSign[roomId]?.[id+'_major']||DB.blackSign[roomId]?.[id+'_minor']||DB.blackSign[roomId]?.[id+'_elective']){['major','minor','elective'].forEach(t=>{delete (DB.blackSign[roomId]||{})[id+'_'+t];});fbSet('blackSign',roomId,{...DB.blackSign[roomId]});}});
  }
  // 3. 若為教師：清理 teacherStudents
  if(u.role==='teacher'){
    if(DB.teacherStudents[id]){delete DB.teacherStudents[id];fbDelete('teacherStudents',id);}
    if(DB.teacherComments[id]){delete DB.teacherComments[id];fbDelete('teacherComments',id);}
  }
  // 4. 從記憶體移除
  const idx=DB.users.findIndex(x=>x.id===id);
  if(idx>-1)DB.users.splice(idx,1);
}

function deleteUser(id){
  const u=DB.users.find(x=>x.id===id);if(!u)return;
  _deleteUserCascade(id);
  renderAll();updateStats();
  showToast('已刪除 '+u.name+'（關聯資料已同步清理）','err');
}
window.deleteUser=deleteUser;

// ════ 複選刪除 ════
function updateBulkBar(type){
  const cls=type==='student'?'.stu-chk':'.tea-chk';
  const checked=document.querySelectorAll(cls+':checked');
  const n=checked.length;
  if(type==='student'){
    const btn=document.getElementById('stu-bulk-del-btn');
    const cnt=document.getElementById('stu-sel-count');
    if(btn)btn.style.display=n>0?'':'none';
    if(cnt)cnt.textContent=n;
    // 更新全選狀態
    const all=document.querySelectorAll(cls);
    const allChk=document.getElementById('stu-chk-all');
    if(allChk)allChk.indeterminate=(n>0&&n<all.length);
    if(allChk&&n===all.length&&all.length>0)allChk.checked=true;
    if(allChk&&n===0)allChk.checked=false;
  } else {
    const btn=document.getElementById('tea-bulk-del-btn');
    const cnt=document.getElementById('tea-sel-count');
    if(btn)btn.style.display=n>0?'':'none';
    if(cnt)cnt.textContent=n;
    const all=document.querySelectorAll(cls);
    const allChk=document.getElementById('tea-chk-all');
    if(allChk)allChk.indeterminate=(n>0&&n<all.length);
    if(allChk&&n===all.length&&all.length>0)allChk.checked=true;
    if(allChk&&n===0)allChk.checked=false;
  }
}
window.updateBulkBar=updateBulkBar;

function toggleAllCheck(type,masterChk){
  const cls=type==='student'?'.stu-chk':'.tea-chk';
  document.querySelectorAll(cls).forEach(c=>{c.checked=masterChk.checked;});
  updateBulkBar(type);
}
window.toggleAllCheck=toggleAllCheck;

function bulkDeleteUsers(type){
  const cls=type==='student'?'.stu-chk':'.tea-chk';
  const ids=[...document.querySelectorAll(cls+':checked')].map(c=>c.dataset.id);
  if(!ids.length)return;
  const label=type==='student'?'學生':'教師';
  if(!confirm('確定要刪除已勾選的 '+ids.length+' 位'+label+'？\n關聯資料（評分、排程等）也會一併清除，此操作不可復原。'))return;
  ids.forEach(id=>_deleteUserCascade(id));
  renderAll();updateStats();
  showToast('已刪除 '+ids.length+' 位'+label+'（關聯資料已同步清理）','err');
}
window.bulkDeleteUsers=bulkDeleteUsers;

// CSV Import/Export
function importCSV(role){
  // ★ 修正 #F6：防重複匯入
  if(window._csvImporting){showToast('匯入中，請稍候...','warn');return;}
  window._csvImporting=true;
  const input=document.createElement('input');input.type='file';input.accept='.csv,.txt';
  input.onchange=e=>{
    const f=e.target.files[0];
    if(!f){window._csvImporting=false;return;}
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const lines=ev.target.result.split('\n').slice(1).filter(l=>l.trim());
        let count=0,skipped=0;
        lines.forEach((line,idx)=>{
          const cols=line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
          if(role==='student'){
            const [cls,seat,name,account,...rest]=cols;
            if(!name||!account){skipped++;return;}
            if(DB.users.find(u=>u.account===account)){skipped++;return;} // ★ 重複帳號跳過
            // ★ 用 idx 確保同毫秒匯入時 ID 不衝突
            const nu2={id:'s'+Date.now()+'_'+idx,name,account,pass:_passEncode('000','s'+Date.now()+'_'+idx),role:'student',class:cls||'甲班',seat:+seat||1,repDone:false,teaDone:false};
            DB.users.push(nu2);fbSet('users',nu2.id,nu2);
          }else if(role==='teacher'){
            const [name,account,stuAccounts]=cols;
            if(!name||!account){skipped++;return;}
            if(DB.users.find(u=>u.account===account)){skipped++;return;}
            const nt={id:'t'+Date.now()+'_'+idx,name,account,pass:_passEncode('000','t'+Date.now()+'_'+idx),role:'teacher'};
            DB.users.push(nt);fbSet('users',nt.id,nt);
            if(stuAccounts&&stuAccounts.trim()){
              const ids=stuAccounts.split(/[;|]/).map(s=>s.trim()).filter(Boolean).map(acc=>{const u=DB.users.find(x=>x.account===acc&&x.role==='student');return u?.id;}).filter(Boolean);
              if(ids.length){DB.teacherStudents[nt.id]=ids;fbSet('teacherStudents',nt.id,{list:ids});}
            }
          }
          count++;
        });
        renderAll();updateStats();
        showToast(`已匯入 ${count} 筆${skipped?`（${skipped} 筆重複/錯誤已跳過）`:''} ✓`,'ok');
      }finally{window._csvImporting=false;}
    };
    reader.onerror=()=>{window._csvImporting=false;showToast('檔案讀取失敗','err');};
    reader.readAsText(f,'UTF-8');
  };
  input.click();
}

function downloadSample(e,role){
  e.preventDefault();
  const samples={
    student:'班級,座號,姓名,帳號\n甲班,1,王小明,s999\n甲班,2,李小華,s998\n乙班,1,陳美玲,s997',
    teacher:'姓名,帳號,指導學生帳號（分號分隔，可空白）\n王老師,teacher99,s001;s002;s003\n陳老師,teacher98,s004;s005',
  };
  const blob=new Blob(['\uFEFF'+(samples[role]||'')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=(role==='student'?'學生':'教師')+'名單範例.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('範例檔下載中 ✓','ok');
}

function importTeaStudentsCSV(){
  const input=document.createElement('input');input.type='file';input.accept='.csv,.txt';
  input.onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const lines=ev.target.result.split('\n').slice(1).filter(l=>l.trim());
      let updated=0,notFound=[];
      lines.forEach(line=>{
        const cols=line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
        const [teaAccount,stuAccountsRaw]=cols;
        if(!teaAccount)return;
        // 比對教師帳號
        const tea=DB.users.find(u=>u.account===teaAccount&&u.role==='teacher');
        if(!tea){notFound.push(teaAccount);return;}
        // 解析學生帳號（允許 ; | 分隔，也允許全空代表清空）
        const stuAccStr=stuAccountsRaw||'';
        const stuIds=stuAccStr.trim()===''?[]:
          stuAccStr.split(/[;|]/).map(s=>s.trim()).filter(Boolean).map(acc=>{
            const u=DB.users.find(x=>x.account===acc&&x.role==='student');
            return u?.id||null;
          }).filter(Boolean);
        DB.teacherStudents[tea.id]=stuIds;
        fbSet('teacherStudents',tea.id,{list:stuIds});
        updated++;
      });
      renderAdminTeachers();renderTeaTable();
      let msg='已更新 '+updated+' 位教師的指導學生 ✓';
      if(notFound.length)msg+='\n找不到帳號：'+notFound.join('、');
      showToast(msg,'ok');
      if(notFound.length)alert('以下教師帳號在系統中找不到，已跳過：\n'+notFound.join('\n'));
    };
    reader.readAsText(f,'UTF-8');
  };
  input.click();
}
window.importTeaStudentsCSV=importTeaStudentsCSV;

function downloadTeaStudentsSample(e){
  e.preventDefault();
  // 自動用現有教師 + 學生帳號生成範例
  const teaRows=teachers().slice(0,3).map(t=>{
    const stus=(DB.teacherStudents[t.id]||[]).map(sid=>DB.users.find(u=>u.id===sid)?.account||sid);
    return t.account+','+(stus.join(';')||'');
  });
  const header='教師帳號,指導學生帳號（分號分隔，清空留白即可移除）';
  const sample=teaRows.length?teaRows.join('\n'):'teacher01,s001;s002;s003\nteacher02,s004;s005';
  const blob=new Blob(['\uFEFF'+header+'\n'+sample],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='更新指導學生範例.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('範例檔下載中 ✓','ok');
}
window.downloadTeaStudentsSample=downloadTeaStudentsSample;

function exportCSV(data,filename){
  if(!data.length){showToast('無資料可匯出','err');return;}
  const headers=Object.keys(data[0]);
  const rows=[headers.join(','),...data.map(r=>headers.map(h=>`"${(r[h]??'').toString().replace(/"/g,'""')}"`).join(','))];
  const blob=new Blob(['\uFEFF'+rows.join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename+'.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('匯出成功 ✓','ok');
}

// ════════════════════════════════════════════════
// ADMIN - INSTRUMENTS
// ════════════════════════════════════════════════
function renderCatList(){
  const c=document.getElementById('cat-list');if(!c)return;c.innerHTML='';
  DB.instruments.categories.sort((a,b)=>a.order-b.order).forEach((cat,i)=>{
    const div=document.createElement('div');div.className='exam-item';div.draggable=true;
    div.dataset.catId=cat.id;
    div.innerHTML=`<div class="dh">⠿</div><div class="ei-info"><div class="ei-name">${cat.name}</div></div>
      <button class="btn btn-s btn-xs" onclick="renameCategory('${cat.id}')">改名</button>
      <button class="btn btn-d btn-xs" onclick="delCategory('${cat.id}')">刪</button>`;
    div.addEventListener('dragstart',e=>{div.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
    div.addEventListener('dragend',()=>{
      div.classList.remove('dragging');
      // Rebuild order from DOM and save
      [...c.querySelectorAll('.exam-item')].forEach((el,i)=>{
        const cat=DB.instruments.categories.find(x=>x.id===el.dataset.catId);
        if(cat)cat.order=i;
      });
      fbSaveInstruments();
    });
    div.addEventListener('dragover',e=>{e.preventDefault();const after=getDragAfter(c,e.clientY);const dr=c.querySelector('.dragging');if(after)c.insertBefore(dr,after);else c.appendChild(dr);});
    c.appendChild(div);
  });
  const sel=document.getElementById('inst-cat-sel');
  if(sel){sel.innerHTML='<option value="">選擇大項</option>';DB.instruments.categories.forEach(cat=>sel.appendChild(new Option(cat.name,cat.id)));}
}
function renderInstList(){
  const catId=document.getElementById('inst-cat-sel')?.value||'';
  const c=document.getElementById('inst-list');if(!c)return;c.innerHTML='';
  DB.instruments.items.filter(i=>i.cat===catId).sort((a,b)=>a.order-b.order).forEach(inst=>{
    const div=document.createElement('div');div.className='exam-item';div.draggable=true;
    div.dataset.instId=inst.id;
    div.innerHTML=`<div class="dh">⠿</div><div class="ei-info"><div class="ei-name">${inst.name}</div></div>
      <button class="btn btn-s btn-xs" onclick="renameInst('${inst.id}')">改名</button>
      <button class="btn btn-d btn-xs" onclick="delInst('${inst.id}')">刪</button>`;
    div.addEventListener('dragstart',e=>{div.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
    div.addEventListener('dragend',()=>{
      div.classList.remove('dragging');
      [...c.querySelectorAll('.exam-item')].forEach((el,i)=>{
        const inst=DB.instruments.items.find(x=>x.id===el.dataset.instId);
        if(inst)inst.order=i;
      });
      fbSaveInstruments();
    });
    div.addEventListener('dragover',e=>{e.preventDefault();const after=getDragAfter(c,e.clientY);const dr=c.querySelector('.dragging');if(after)c.insertBefore(dr,after);else c.appendChild(dr);});
    c.appendChild(div);
  });
}
function renderInstDropdown(){renderCatList();}
// ★ 修正 #F4：分開儲存樂器和大項，避免單一操作觸發雙寫
function fbSaveInstrumentsItems(){fbSet('instruments','items',{list:DB.instruments.items});}
function fbSaveInstrumentsCats(){fbSet('instruments','categories',{list:DB.instruments.categories});}
function fbSaveInstruments(){fbSaveInstrumentsItems();fbSaveInstrumentsCats();}
window.fbSaveInstruments=fbSaveInstruments;
function addCategory(){
  const n=prompt('新增大項名稱：');if(!n)return;
  DB.instruments.categories.push({id:'cat_'+Date.now(),name:n,order:DB.instruments.categories.length});
  fbSaveInstrumentsCats();renderCatList();initDropdowns();showToast('已新增 '+n,'ok');
}
function renameCategory(id){
  const c=DB.instruments.categories.find(x=>x.id===id);
  const n=prompt('新名稱：',c?.name);
  if(n&&c){c.name=n;fbSaveInstrumentsCats();renderCatList();initDropdowns();showToast('已更新','ok');}
}
function delCategory(id){
  const idx=DB.instruments.categories.findIndex(c=>c.id===id);
  if(idx<0)return;
  const cat=DB.instruments.categories[idx];
  // ★ 聯動檢查：找出使用此大項樂器的學生
  const affectedInsts=DB.instruments.items.filter(i=>i.cat===id).map(i=>i.id);
  const affectedStus=students().filter(s=>['major','minor','elective'].some(t=>affectedInsts.includes(s[t])));
  if(affectedStus.length){
    const names=affectedStus.slice(0,5).map(s=>s.name).join('、')+(affectedStus.length>5?'…等':'');
    if(!confirm(`警告：刪除大項「${cat.name}」會影響 ${affectedStus.length} 名學生的樂器引用（${names}），\n建議先更新學生樂器設定。確定仍要刪除？`))return;
  }
  DB.instruments.categories.splice(idx,1);
  fbSaveInstrumentsCats();renderCatList();
  if(affectedStus.length)showToast(`已刪除大項（${affectedStus.length} 名學生樂器引用失效，請更新）`,'warn');
  else showToast('已刪除','err');
}
function delInst(id){
  const idx=DB.instruments.items.findIndex(i=>i.id===id);
  if(idx<0)return;
  const inst=DB.instruments.items[idx];
  // ★ 聯動檢查：找出使用此樂器的學生
  const affectedStus=students().filter(s=>s.major===id||s.minor===id||s.elective===id);
  if(affectedStus.length){
    const names=affectedStus.slice(0,5).map(s=>s.name).join('、')+(affectedStus.length>5?'…等':'');
    if(!confirm(`警告：刪除樂器「${inst.name}」會影響 ${affectedStus.length} 名學生（${names}），\n建議先更新學生樂器設定。確定仍要刪除？`))return;
  }
  DB.instruments.items.splice(idx,1);
  fbSaveInstrumentsItems();renderInstList();
  if(affectedStus.length)showToast(`已刪除樂器（${affectedStus.length} 名學生樂器引用失效，請更新）`,'warn');
  else showToast('已刪除','err');
}
window.delInst=delInst;
function addInstrument(){
  const catId=document.getElementById('inst-cat-sel')?.value;
  if(!catId){showToast('請先選擇大項','err');return;}
  const n=prompt('新增樂器名稱：');if(!n)return;
  DB.instruments.items.push({id:'inst_'+Date.now(),cat:catId,name:n,order:DB.instruments.items.filter(i=>i.cat===catId).length});
  fbSaveInstrumentsItems();renderInstList();showToast('已新增 '+n,'ok');
}
function renameInst(id){const inst=DB.instruments.items.find(i=>i.id===id);const n=prompt('新名稱：',inst?.name);if(n&&inst){inst.name=n;fbSaveInstrumentsItems();renderInstList();showToast('已更新','ok');}}

// ════════════════════════════════════════════════
// ADMIN - ROOMS & CLASSES
// ════════════════════════════════════════════════
function renderRooms(){
  const tbody=document.getElementById('rooms-tbody');if(!tbody)return;
  tbody.innerHTML='';
  let _dragRoomIdx=null;
  const _WD=['日','一','二','三','四','五','六'];
  DB.rooms.forEach((r,idx)=>{
    // ★ 修正①：日期格式加入星期顯示
    const fmtDt=dt=>{
      if(!dt)return '—';
      const d=new Date(dt);if(isNaN(d))return dt;
      const wd=_WD[d.getDay()];
      const mm=String(d.getMonth()+1).padStart(2,'0');
      const dd2=String(d.getDate()).padStart(2,'0');
      const hh=String(d.getHours()).padStart(2,'0');
      const mi=String(d.getMinutes()).padStart(2,'0');
      return `${mm}/${dd2}（${wd}）${hh}:${mi}`;
    };
    const fmtDtDateOnly=dt=>{
      if(!dt)return '';
      const d=new Date(dt);if(isNaN(d))return dt;
      const wd=_WD[d.getDay()];
      const mm=String(d.getMonth()+1).padStart(2,'0');
      const dd2=String(d.getDate()).padStart(2,'0');
      return `${mm}/${dd2}（${wd}）`;
    };
    // 若開始與結束是同一天，只在開始顯示日期+星期，結束只顯示時間
    let dtStr='—';
    if(r.dateStart||r.dateEnd){
      if(r.dateStart&&r.dateEnd){
        const ds=new Date(r.dateStart),de=new Date(r.dateEnd);
        const sameDay=ds.getFullYear()===de.getFullYear()&&ds.getMonth()===de.getMonth()&&ds.getDate()===de.getDate();
        if(sameDay){
          const dateLabel=fmtDtDateOnly(r.dateStart);
          const hhs=String(ds.getHours()).padStart(2,'0'),mis=String(ds.getMinutes()).padStart(2,'0');
          const hhe=String(de.getHours()).padStart(2,'0'),mie=String(de.getMinutes()).padStart(2,'0');
          dtStr=`${dateLabel} ${hhs}:${mis} ～ ${hhe}:${mie}`;
        } else {
          dtStr=`${fmtDt(r.dateStart)} ～ ${fmtDt(r.dateEnd)}`;
        }
      } else {
        dtStr=fmtDt(r.dateStart||r.dateEnd);
      }
    }
    const tr=document.createElement('tr');
    tr.draggable=true;tr.dataset.idx=idx;
    tr.innerHTML=`
    <td style="cursor:grab;color:var(--border);font-size:15px;text-align:center;padding:4px 8px" class="dh">⠿</td>
    <td><strong>${r.name}</strong></td>
    <td style="font-family:DM Mono,monospace;font-size:11px;color:var(--muted)">${r.location||'—'}</td>
    <td style="font-family:DM Mono,monospace;font-size:10px;color:var(--ink)">${dtStr}</td>
    <td><span style="font-family:DM Mono,monospace;background:var(--ink);color:var(--paper);padding:2px 7px;border-radius:var(--r);letter-spacing:2px">••••••</span>
      <button class="btn btn-s btn-xs" style="margin-left:6px" onclick="revealCode('${r.id}',this)">顯示</button></td>
    <td style="font-family:DM Mono,monospace;font-size:10px;color:#546e7a">${r.invigCode||('I-'+r.code)}</td>
    <td><div class="bg"><button class="btn btn-s btn-xs" onclick="editRoom('${r.id}')">編輯</button><button class="btn btn-d btn-xs" onclick="delRoom('${r.id}')">刪</button></div></td>`;
    tr.addEventListener('dragstart',e=>{_dragRoomIdx=idx;tr.style.opacity='.4';e.dataTransfer.effectAllowed='move';});
    tr.addEventListener('dragend',()=>{tr.style.opacity='1';});
    tr.addEventListener('dragover',e=>{e.preventDefault();});
    tr.addEventListener('drop',e=>{
      e.preventDefault();
      if(_dragRoomIdx===null||_dragRoomIdx===idx)return;
      const moved=DB.rooms.splice(_dragRoomIdx,1)[0];
      DB.rooms.splice(idx,0,moved);
      // 更新 Firebase _order
      DB.rooms.forEach((room,i)=>fbSet('rooms',room.id,{...room,_order:i}));
      renderRooms();schInitRoomTabs();initDropdowns();
      showToast('考場順序已更新 ✓','ok');
    });
    tbody.appendChild(tr);
  });
}
function revealCode(id,btn){const r=DB.rooms.find(x=>x.id===id);if(!r)return;btn.parentNode.innerHTML=`<code style="font-family:DM Mono,monospace;background:var(--cream);padding:3px 8px;border-radius:var(--r);letter-spacing:3px">${r.code}</code>`;}
function addRoom(){
  document.getElementById('edit-modal-title').textContent='新增考場';
  const catCheckboxes=DB.instruments.categories.map(cat=>`
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer">
      <input type="checkbox" value="${cat.id}">
      <span style="font-size:13px">${cat.name}</span>
    </label>`).join('');
  document.getElementById('edit-modal-body').innerHTML=`
    <div class="fr">
      <div class="fg"><label>考場名稱</label><input type="text" id="rm-name" placeholder="如：木管考場"></div>
      <div class="fg"><label>評審代碼</label><input type="text" id="rm-code" placeholder="如：WW2025" style="font-family:\'DM Mono\',monospace;letter-spacing:3px"></div>
      <div class="fg"><label>監考代碼（選填）</label><input type="text" id="rm-invig-code" placeholder="預設：I-評審代碼" style="font-family:\'DM Mono\',monospace;letter-spacing:3px"></div>
    </div>
    <div class="fg" style="margin-bottom:12px"><label>考試地點</label><input type="text" id="rm-location" placeholder="如：音樂廳 A 室、二樓演奏廳..."></div>
    <div class="fr" style="margin-bottom:12px">
      <div class="fg"><label>考試日期時間（開始）</label><input type="datetime-local" id="rm-date-start"></div>
      <div class="fg"><label>考試日期時間（結束）</label><input type="datetime-local" id="rm-date-end"></div>
    </div>
    <div style="padding:8px 10px;background:var(--cream);border-radius:var(--r);font-family:DM Mono,monospace;font-size:9px;color:var(--muted);line-height:1.7">
      💡 樂器篩選請至「考試排程」頁面設定，無需在此勾選。
    </div>`;
  document.getElementById('edit-modal-save').onclick=()=>{
    const name=document.getElementById('rm-name').value.trim();
    const code=document.getElementById('rm-code').value.trim();
    const location=document.getElementById('rm-location').value.trim();
    const dateStart=document.getElementById('rm-date-start').value||'';
    const dateEnd=document.getElementById('rm-date-end').value||'';
    if(!name||!code){showToast('請填寫名稱及代碼','err');return;}
    const invigCode=document.getElementById('rm-invig-code').value.trim()||('I-'+code);
    const nr={id:'r'+Date.now(),name,code,invigCode,location,dateStart,dateEnd,allowedCats:[],cats:[],allowedItems:[]};
    DB.rooms.push(nr);fbSet('rooms',nr.id,{...nr,_order:DB.rooms.length-1});
    closeOverlay('edit-modal');showToast('已新增 '+name,'ok');renderRooms();initDropdowns();
  };
  openOverlay('edit-modal');
}
function editRoom(id){
  const r=DB.rooms.find(x=>x.id===id);if(!r)return;
  document.getElementById('edit-modal-title').textContent='編輯考場 — '+r.name;
  const catCheckboxes=DB.instruments.categories.map(cat=>`
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer">
      <input type="checkbox" value="${cat.id}" ${(r.allowedCats||r.cats||[]).includes(cat.id)?'checked':''}>
      <span style="font-size:13px">${cat.name}</span>
    </label>`).join('');
  document.getElementById('edit-modal-body').innerHTML=`
    <div class="fr">
      <div class="fg"><label>考場名稱</label><input type="text" id="rm-name" value="${r.name}"></div>
      <div class="fg"><label>評審代碼</label><input type="text" id="rm-code" value="${r.code}" style="font-family:\'DM Mono\',monospace;letter-spacing:3px"></div>
      <div class="fg"><label>監考代碼</label><input type="text" id="rm-invig-code" value="${r.invigCode||('I-'+r.code)}" style="font-family:\'DM Mono\',monospace;letter-spacing:3px"></div>
    </div>
    <div class="fg" style="margin-bottom:12px"><label>考試地點</label><input type="text" id="rm-location" value="${r.location||''}" placeholder="如：音樂廳 A 室..."></div>
    <div class="fr" style="margin-bottom:12px">
      <div class="fg"><label>考試日期時間（開始）</label><input type="datetime-local" id="rm-date-start" value="${r.dateStart||''}" ></div>
      <div class="fg"><label>考試日期時間（結束）</label><input type="datetime-local" id="rm-date-end" value="${r.dateEnd||''}" ></div>
    </div>
    <div style="padding:8px 10px;background:var(--cream);border-radius:var(--r);font-family:DM Mono,monospace;font-size:9px;color:var(--muted);line-height:1.7">
      💡 樂器篩選請至「考試排程」頁面設定，無需在此勾選。
    </div>`;
  document.getElementById('edit-modal-save').onclick=()=>{
    r.name=document.getElementById('rm-name').value.trim()||r.name;
    r.code=document.getElementById('rm-code').value.trim()||r.code;
    r.invigCode=document.getElementById('rm-invig-code').value.trim()||('I-'+r.code);
    r.location=document.getElementById('rm-location').value.trim();
    r.dateStart=document.getElementById('rm-date-start').value||'';
    r.dateEnd=document.getElementById('rm-date-end').value||'';
    fbSet('rooms',r.id,{...r,_order:DB.rooms.indexOf(r)});
    closeOverlay('edit-modal');showToast('已更新','ok');renderRooms();initDropdowns();
  };
  openOverlay('edit-modal');
}
function delRoom(id){
  const idx=DB.rooms.findIndex(r=>r.id===id);
  if(idx<0)return;
  const name=DB.rooms[idx].name;
  if(!confirm(`確定刪除考場「${name}」？\n該考場的所有評分、排程快照也會一併清除，不可復原。`))return;
  // ★ 級聯清理
  fbDelete('rooms',id);
  // juryScores（REST：刪 collection 需逐筆刪 entries）
  if(DB.juryScores[id]){
    const entryKeys=Object.keys(DB.juryScores[id]);
    entryKeys.forEach(ek=>fbDelete('juryScores/'+id+'/entries',ek));
    delete DB.juryScores[id];
  }
  // liveExam
  if(DB.liveExam[id]){delete DB.liveExam[id];fbDelete('liveExam',id);}
  // blackSign
  if(DB.blackSign[id]){delete DB.blackSign[id];fbDelete('blackSign',id);}
  // savedScheduleSnapshot
  if(DB.savedScheduleSnapshot[id]){
    delete DB.savedScheduleSnapshot[id];
    // ★ 修正 R9：刪除分拆的 scheduleSnapshots 文件
    fbDelete('scheduleSnapshots',id);
    // 舊版相容
    try{
      const snapStr=JSON.stringify(DB.savedScheduleSnapshot);
      if(snapStr.length<800000)fbSet('scheduleState','snapshot',{data:snapStr});
    }catch(e){}
  }
  // SCH_STATE
  delete _SCH_ROOM_STATES[id];
  if(SCH_STATE.roomId===id){SCH_STATE.roomId='';SCH_STATE.extraEntries=[];SCH_STATE.removedEntries=new Set();}
  // 從陣列移除
  DB.rooms.splice(idx,1);
  renderRooms();renderRoomFields();schInitRoomTabs();initDropdowns();
  showToast('已刪除考場「'+name+'」（關聯評分與排程資料已清除）','err');
}
window.delRoom=delRoom;

function renderClassList(){
  const c=document.getElementById('class-list');if(!c)return;c.innerHTML='';
  DB.classes.forEach((cls,i)=>{
    const div=document.createElement('div');div.className='exam-item';div.draggable=true;
    div.innerHTML=`<div class="dh">⠿</div><div class="ei-info"><div class="ei-name">${cls}</div></div>
      <button class="btn btn-s btn-xs" onclick="renameClass(${i})">改名</button>
      <button class="btn btn-d btn-xs" onclick="delClass(${i})">刪</button>`;
    // drag for classes
    div.addEventListener('dragstart',e=>{div.classList.add('dragging');e.dataTransfer.setData('text/plain',i);});
    div.addEventListener('dragend',()=>div.classList.remove('dragging'));
    div.addEventListener('dragover',e=>{e.preventDefault();const after=getDragAfter(c,e.clientY);const dr=c.querySelector('.dragging');if(after)c.insertBefore(dr,after);else c.appendChild(dr);});
    div.addEventListener('drop',()=>{
      // Rebuild DB.classes from current DOM order
      const items=[...c.querySelectorAll('.exam-item')];
      const newOrder=items.map(el=>el.querySelector('.ei-name').textContent);
      DB.classes.length=0;newOrder.forEach(n=>DB.classes.push(n));
      fbSet('classes','main',{list:[...DB.classes]});initDropdowns();
    });
    c.appendChild(div);
  });
}
function addClass(){const n=prompt('新班級名稱：');if(!n)return;DB.classes.push(n);fbSet('classes','main',{list:[...DB.classes]});renderClassList();initDropdowns();showToast('已新增 '+n,'ok');}
function renameClass(i){const n=prompt('新名稱：',DB.classes[i]);if(n){DB.classes[i]=n;fbSet('classes','main',{list:[...DB.classes]});renderClassList();initDropdowns();showToast('已更新','ok');}}
function delClass(i){DB.classes.splice(i,1);fbSet('classes','main',{list:[...DB.classes]});renderClassList();initDropdowns();showToast('已刪除','err');}

// ════════════════════════════════════════════════
// ADMIN - TIMING
// ════════════════════════════════════════════════
const pageLabels={rep:'學生曲目填寫',scores:'成績查閱',jury:'評審評分',teacher:'教師評量',schedule:'考試排程'};
function renderTiming(){
  const tb=document.getElementById('timing-body');const ab=document.getElementById('announce-body');if(!tb||!ab)return;
  tb.innerHTML=Object.entries(DB.config.pages).map(([k,v])=>`
    <div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--cream)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-family:\'DM Mono\',monospace;font-size:10px">${pageLabels[k]}</span>
        <label class="tgl"><input type="checkbox" ${v.visible?'checked':''} onchange="DB.config.pages['${k}'].visible=this.checked"><span class="tgl-sl"></span></label>
      </div>
      <div class="fr" style="margin-bottom:0">
        <div class="fg"><label>開放</label><input type="datetime-local" value="${v.open}" onchange="DB.config.pages['${k}'].open=this.value"></div>
        <div class="fg"><label>截止</label><input type="datetime-local" value="${v.close}" onchange="DB.config.pages['${k}'].close=this.value"></div>
      </div>
    </div>`).join('');
  ab.innerHTML=Object.entries(DB.config.pages).map(([k,v])=>`
    <div class="fg" style="margin-bottom:10px"><label>${pageLabels[k]} 公告</label><input type="text" value="${v.announce||''}" placeholder="（留空不顯示）" onchange="DB.config.pages['${k}'].announce=this.value"></div>`).join('')+
    '<button class="btn btn-p" onclick="saveAnnounce()">儲存公告</button>';
}
function fbSaveConfig(){
  fbSet('config','main',{
    weights:DB.config.weights,
    scoreCaps:DB.config.scoreCaps,
    hardCap:DB.config.hardCap,
    trimRules:DB.config.trimRules,
    pages:DB.config.pages,
    studentAccess:DB.config.studentAccess,
    teacherAccess:DB.config.teacherAccess,
    repHint:DB.config.repHint,
    tyTitle:DB.config.tyTitle,
    tyText:DB.config.tyText,
    teacherScheduleClosedMsg:DB.config.teacherScheduleClosedMsg||'',
    instRestrict:DB.config.instRestrict||{major:[],minor:[],elective:[]},
    instRestrictMsg:DB.config.instRestrictMsg||{major:{},minor:{},elective:{}},
    repConfirmMsg:DB.config.repConfirmMsg||'',
    pendingMsg:DB.config.pendingMsg||{},
    bulletin:DB.config.bulletin||{student:'',teacher:''},
    examRules:DB.config.examRules||{classical:'',pop:''},
    assignedPieces:DB.config.assignedPieces||'',
    assignedPiecesRules:DB.config.assignedPiecesRules||[],
    resultsPublished:DB.config.resultsPublished||false,           // ★ 需求4
    resultsPublishedAt:DB.config.resultsPublishedAt||null,        // ★ 需求4
  });
}
function saveTiming(){fbSaveConfig();showToast('時間設定已儲存 ✓','ok');}
function saveAnnounce(){fbSaveConfig();showToast('公告已更新 ✓','ok');}

function saveBulletin(){
  const s=(document.getElementById('bulletin-student')?.value||'').trim();
  const t=(document.getElementById('bulletin-teacher')?.value||'').trim();
  if(!DB.config.bulletin)DB.config.bulletin={};
  DB.config.bulletin.student=s;
  DB.config.bulletin.teacher=t;
  fbSaveConfig();
  showToast('公布欄已儲存 ✓','ok');
  renderBulletin();
}
window.saveBulletin=saveBulletin;

// ════════════════════════════════════════════════
// 考試規則 & 指定曲（富文本系統）
// ════════════════════════════════════════════════

let _erCurrentTab='classical';
let _erDirty=false;

// 前台：切換顯示面板
function switchExamRulesTab(tab,btn){
  document.querySelectorAll('#exam-rules-tabs .btn').forEach(b=>{
    const isActive=b.id===`ertab-${tab}`;
    b.className=isActive?'btn btn-p':'btn btn-s';
    b.style.cssText='font-size:14px;padding:11px 26px;display:flex;align-items:center;gap:7px';
  });
  document.querySelectorAll('.er-panel').forEach(p=>p.style.display='none');
  const panel=document.getElementById(`er-panel-${tab}`);
  const empty=document.getElementById('er-empty');
  const content=document.getElementById(`er-content-${tab}`);
  const html=tab==='assigned'?(DB.config.assignedPieces||''):(DB.config.examRules?.[tab]||'');
  if(html&&html.replace(/<[^>]+>/g,'').trim()){
    if(panel)panel.style.display='block';
    if(empty)empty.style.display='none';
    if(content){
      content.innerHTML=html;
      // ★ 為過寬的表格加上「可左右滑動」提示（手機常見問題）
      setTimeout(()=>{
        try{
          content.querySelectorAll('table').forEach(t=>{
            // 表格實際內容寬 vs 顯示寬
            if(t.scrollWidth>t.clientWidth+2){
              if(!t.dataset.scrollHinted){
                t.dataset.scrollHinted='1';
                // 在表格上方插入提示
                const hint=document.createElement('div');
                hint.style.cssText='font-family:DM Mono,monospace;font-size:10px;color:var(--gold);margin:4px 0 -2px;letter-spacing:1px;display:flex;align-items:center;gap:4px';
                hint.innerHTML='← 表格可左右滑動 →';
                t.parentNode.insertBefore(hint,t);
                // 滑動後淡出提示
                t.addEventListener('scroll',()=>{
                  if(t.scrollLeft>4)hint.style.opacity='0.3';
                },{passive:true});
              }
            }
          });
          // 圖片過寬時自動縮放
          content.querySelectorAll('img').forEach(img=>{
            img.style.maxWidth='100%';
            img.style.height='auto';
          });
        }catch(e){console.warn('[exam-rules] 表格捲動偵測失敗',e);}
      },80);
    }
  } else {
    if(panel)panel.style.display='none';
    if(empty)empty.style.display='block';
  }
}
window.switchExamRulesTab=switchExamRulesTab;

// 後台：切換編輯 tab
function switchErAdminTab(tab){
  if(_erDirty&&!confirm('目前有未儲存的變更，切換分頁將會遺失。確定要切換嗎？'))return;
  _erCurrentTab=tab;_erDirty=false;
  ['classical','pop','assigned'].forEach(t=>{
    const b=document.getElementById(`er-admin-tab-${t}`);
    if(b)b.className=t===tab?'btn btn-p btn-sm':'btn btn-s btn-sm';
  });
  const editor=document.getElementById('er-editor');if(!editor)return;
  const html=tab==='assigned'?(DB.config.assignedPieces||''):(DB.config.examRules?.[tab]||'');
  editor.innerHTML=html||'<p><br></p>';
  const d=document.getElementById('er-dirty-indicator'),s=document.getElementById('er-saved-indicator');
  if(d)d.style.display='none';if(s)s.style.display='none';
}
window.switchErAdminTab=switchErAdminTab;

// 初始化編輯器
function initExamRulesEditor(){
  const editor=document.getElementById('er-editor');if(!editor)return;
  const html=DB.config.examRules?.classical||'';
  editor.innerHTML=html||'<p><br></p>';
  _erCurrentTab='classical';_erDirty=false;
}
window.initExamRulesEditor=initExamRulesEditor;

// execCommand 包裝
function erExec(cmd,val){
  const editor=document.getElementById('er-editor');if(!editor)return;
  editor.focus();document.execCommand(cmd,false,val||null);erMarkDirty();
}
window.erExec=erExec;

function erMarkDirty(){
  if(!_erDirty){
    _erDirty=true;
    const d=document.getElementById('er-dirty-indicator'),s=document.getElementById('er-saved-indicator');
    if(d)d.style.display='block';if(s)s.style.display='none';
  }
}
window.erMarkDirty=erMarkDirty;

function erHandleTab(e){
  if(e.key==='Tab'){e.preventDefault();document.execCommand('insertHTML',false,'&nbsp;&nbsp;&nbsp;&nbsp;');}
}
window.erHandleTab=erHandleTab;

// 插入表格
function erInsertTable(){
  const cols=parseInt(prompt('欄數（1–10）：','3'))||3;
  const rows=parseInt(prompt('列數（1–20）：','4'))||4;
  if(cols<1||cols>10||rows<1||rows>20){showToast('欄列數超出範圍','err');return;}
  const header='<tr>'+Array.from({length:cols},(_,i)=>`<th>標題${i+1}</th>`).join('')+'</tr>';
  const body=Array.from({length:rows},()=>'<tr>'+Array.from({length:cols},()=>'<td><br></td>').join('')+'</tr>').join('');
  const html=`<table><thead>${header}</thead><tbody>${body}</tbody></table><p><br></p>`;
  const editor=document.getElementById('er-editor');if(!editor)return;
  editor.focus();document.execCommand('insertHTML',false,html);erMarkDirty();
}
window.erInsertTable=erInsertTable;

// 插入圖片（base64）
function erInsertImage(){
  const input=document.createElement('input');input.type='file';input.accept='image/*';
  input.onchange=e=>{
    const file=e.target.files[0];if(!file)return;
    if(file.size>3*1024*1024){showToast('圖片請勿超過 3MB','err');return;}
    const reader=new FileReader();
    reader.onload=ev=>{
      const src=ev.target.result;
      const html=`<img src="${src}" alt="插入圖片" style="max-width:100%;height:auto"><p><br></p>`;
      const editor=document.getElementById('er-editor');if(!editor)return;
      editor.focus();document.execCommand('insertHTML',false,html);erMarkDirty();
    };
    reader.readAsDataURL(file);
  };input.click();
}
window.erInsertImage=erInsertImage;

// 儲存
async function saveExamRules(){
  if(!requireRole('admin'))return;
  const editor=document.getElementById('er-editor');if(!editor)return;
  const html=editor.innerHTML;
  if(!DB.config.examRules)DB.config.examRules={classical:'',pop:''};
  if(_erCurrentTab==='assigned'){DB.config.assignedPieces=html;}
  else{DB.config.examRules[_erCurrentTab]=html;}
  fbSet('config','main',{examRules:DB.config.examRules,assignedPieces:DB.config.assignedPieces||''});
  // ★ 自動推送 examRules：學生/教師下次登入會自動看到最新規則
  await publishSnapshot('examRules');
  _erDirty=false;
  const d=document.getElementById('er-dirty-indicator'),s=document.getElementById('er-saved-indicator');
  if(d)d.style.display='none';
  if(s){s.style.display='block';setTimeout(()=>{s.style.display='none';},3000);}
  const label=_erCurrentTab==='classical'?'古典音樂規則':_erCurrentTab==='pop'?'流行音樂規則':'部分項目指定曲';
  showToast(`「${label}」已儲存並推送 ✓`,'ok');
  renderExamRulesPage();
}
window.saveExamRules=saveExamRules;

// 渲染前台
function renderExamRulesPage(){
  // ★ 快取機制：學生/教師只看「公告版」考試規則（避免看到管理員草稿）
  let rules=DB.config.examRules||{};
  let assigned=DB.config.assignedPieces||'';
  if((ST.role==='student'||ST.role==='teacher')){
    const cached=getCachedDataset('examRules');
    if(cached){
      if(cached.examRules)rules=cached.examRules;
      if(cached.assignedPieces!==undefined)assigned=cached.assignedPieces;
    } else {
      // 第一次：用目前資料寫入快取
      try{setCachedDataset('examRules',{examRules:rules,assignedPieces:assigned});}catch(e){}
    }
  }
  ['classical','pop'].forEach(t=>{
    const el=document.getElementById(`er-content-${t}`);
    if(el)el.innerHTML=rules[t]||'';
  });
  const ap=document.getElementById('er-content-assigned');
  if(ap)ap.innerHTML=assigned;
  // 預設顯示第一個有內容的 tab
  const hasClassical=!!(rules.classical||'').replace(/<[^>]+>/g,'').trim();
  if(hasClassical)switchExamRulesTab('classical');
  else{document.querySelectorAll('.er-panel').forEach(p=>p.style.display='none');const e=document.getElementById('er-empty');if(e)e.style.display='block';}
}
window.renderExamRulesPage=renderExamRulesPage;

function renderBulletin(){
  // 學生公布欄
  const sb=document.getElementById('bulletin-display-student');
  if(sb){
    const txt=DB.config.bulletin?.student||'';
    sb.style.display=txt?'block':'none';
    sb.querySelector('.bulletin-text').textContent=txt;
  }
  // 教師公布欄
  const tb=document.getElementById('bulletin-display-teacher');
  if(tb){
    const txt=DB.config.bulletin?.teacher||'';
    tb.style.display=txt?'block':'none';
    tb.querySelector('.bulletin-text').textContent=txt;
  }
  // 後台編輯框
  const bsi=document.getElementById('bulletin-student');
  if(bsi)bsi.value=DB.config.bulletin?.student||'';
  const bti=document.getElementById('bulletin-teacher');
  if(bti)bti.value=DB.config.bulletin?.teacher||'';
}
window.renderBulletin=renderBulletin;

// ════════════════════════════════════════════════
// ADMIN - SCORING
// ════════════════════════════════════════════════

// ── 舊版 er 函式 stub（向下相容，_fnMap 引用） ──
function erShowTab(key,btn){switchExamRulesTab(key,btn);}
window.erShowTab=erShowTab;
function erAdminTab(key,btn){switchErAdminTab(key);}
window.erAdminTab=erAdminTab;
function erCmd(key,cmd,val){erExec(cmd,val);}
window.erCmd=erCmd;
function erSave(key){saveExamRules();}
window.erSave=erSave;
function erInitAdminEditors(){initExamRulesEditor();setTimeout(()=>switchErAdminTab('classical'),30);}
window.erInitAdminEditors=erInitAdminEditors;
function renderTrimRules(){
  const c=document.getElementById('trim-list');if(!c)return;
  c.innerHTML=DB.config.trimRules.map((r,i)=>`
    <div style="display:flex;gap:7px;align-items:center;margin-bottom:7px;flex-wrap:wrap">
      <div class="fg" style="min-width:60px;margin-bottom:0"><label>≥ 人</label><input type="number" value="${r.minJ}" min="0" onchange="DB.config.trimRules[${i}].minJ=+this.value"></div>
      <div class="fg" style="min-width:60px;margin-bottom:0"><label>≤ 人</label><input type="number" value="${r.maxJ}" min="0" onchange="DB.config.trimRules[${i}].maxJ=+this.value"></div>
      <div class="fg" style="min-width:60px;margin-bottom:0"><label>去最高</label><input type="number" value="${r.trimH}" min="0" max="5" onchange="DB.config.trimRules[${i}].trimH=+this.value"></div>
      <div class="fg" style="min-width:60px;margin-bottom:0"><label>去最低</label><input type="number" value="${r.trimT}" min="0" max="5" onchange="DB.config.trimRules[${i}].trimT=+this.value"></div>
      <button class="btn btn-d btn-xs" style="margin-top:16px" onclick="DB.config.trimRules.splice(${i},1);renderTrimRules()">✕</button>
    </div>`).join('');
}
function addTrim(){DB.config.trimRules.push({id:Date.now(),minJ:0,maxJ:0,trimH:0,trimT:0});renderTrimRules();}
function saveTrimRules(){fbSaveConfig();showToast('去頭去尾規則已儲存 ✓','ok');}
window.saveTrimRules=saveTrimRules;
function saveWeights(){
  const s=+document.getElementById('w-scale').value,a=+document.getElementById('w-assigned').value,f=+document.getElementById('w-free').value;
  if(s+a+f!==100){showToast('三項必須合計 100%','err');return;}
  DB.config.weights={scale:s/100,assigned:a/100,free:f/100};fbSaveConfig();showToast('權重已儲存 ✓','ok');
}

// ★ 各年級評分上限：儲存 + 渲染
function saveScoreCaps(){
  const g1=+document.getElementById('cap-g1').value||0;
  const g2=+document.getElementById('cap-g2').value||0;
  const g3=+document.getElementById('cap-g3').value||0;
  const hard=+document.getElementById('cap-hard').value||95;
  DB.config.scoreCaps={1:g1,2:g2,3:g3};
  DB.config.hardCap=hard;
  fbSaveConfig();
  showToast('評分上限已儲存 ✓','ok');
  renderPendingCapSummary();
}
window.saveScoreCaps=saveScoreCaps;

function renderScoreCapsConfig(){
  const caps=DB.config.scoreCaps||{1:85,2:87,3:89};
  const g1=document.getElementById('cap-g1'),g2=document.getElementById('cap-g2'),g3=document.getElementById('cap-g3');
  if(g1)g1.value=caps[1]??85;
  if(g2)g2.value=caps[2]??87;
  if(g3)g3.value=caps[3]??89;
  const gh=document.getElementById('cap-hard');
  if(gh)gh.value=DB.config.hardCap??95;
  renderPendingCapSummary();
}
window.renderScoreCapsConfig=renderScoreCapsConfig;

// ★ 顯示目前待審「超過評分上限」筆數摘要
function renderPendingCapSummary(){
  const el=document.getElementById('cap-pending-summary');if(!el)return;
  const pending=Object.values(DB.pendingApprovals||{}).filter(r=>r.kind==='jury'&&r.status==='pending');
  el.textContent=pending.length?`⚠ 目前有 ${pending.length} 筆現場評分超過上限，待審核（請至「成績總表」分頁的審核區處理）`:'';
}
window.renderPendingCapSummary=renderPendingCapSummary;

// ════════════════════════════════════════════════
// ★ 大螢幕：音階調性規則設定（年級 × 修別）
// ════════════════════════════════════════════════
// 編輯期間的暫存（避免每次輸入都動 DB）
let _sclDraft=null;
function _sclGetDraft(){
  if(_sclDraft)return _sclDraft;
  _sclDraft=JSON.parse(JSON.stringify(DB.config.scaleRules||{}));
  return _sclDraft;
}
function renderScaleRules(preserveDraft){
  const grid=document.getElementById('scl-rule-grid');
  if(!grid)return;
  // 只有在「非保留草稿」時才從 DB 重載（避免內部重繪把編輯中的內容洗掉）
  if(!preserveDraft||!_sclDraft) _sclDraft=JSON.parse(JSON.stringify(DB.config.scaleRules||{}));
  const cats=(DB.instruments.categories||[]).slice().sort((a,b)=>(a.order??99)-(b.order??99));
  const grades=[['1','高一'],['2','高二'],['3','高三']];
  const types=[['major','主修'],['minor','副修'],['elective','選修']];
  // 以「樂器大項」分組，每組可摺疊；組內 9 格（年級×修別）
  let html='';
  cats.forEach((cat,ci)=>{
    // 計算此大項已設定幾格
    let setCount=0;
    grades.forEach(([g])=>types.forEach(([t])=>{ const k=cat.id+'_'+g+'_'+t; if((_sclDraft[k]||[]).length)setCount++; }));
    const open = ci===0; // 預設展開第一個
    html+=`<div class="scl-cat-group" data-cat="${cat.id}">
      <div class="scl-cat-head ${open?'open':''}" onclick="sclToggleCat('${cat.id}')">
        <span class="scl-cat-arrow">▸</span>
        <span class="scl-cat-name">${escHtml(cat.name)}</span>
        <span class="scl-cat-count">${setCount?('已設 '+setCount+' / 9 格'):'尚未設定'}</span>
      </div>
      <div class="scl-cat-body" id="scl-cat-body-${cat.id}" style="${open?'':'display:none'}">
        <div class="scl-rule-grid-inner">`;
    grades.forEach(([g,gl])=>{
      types.forEach(([t,tl])=>{
        const key=cat.id+'_'+g+'_'+t;
        const list=_sclDraft[key]||[];
        const chips=list.map((v,vi)=>`<span class="scl-chip">${escHtml(v)}<button onclick="sclRemove('${key}',${vi})" title="移除">×</button></span>`).join('')
          ||'<span style="font-size:11px;color:var(--muted)">尚未設定</span>';
        html+=`<div class="scl-rule-card">
          <h4>${gl} · ${tl}</h4>
          <div id="scl-chips-${key}" style="margin-bottom:8px;min-height:24px">${chips}</div>
          <div style="display:flex;gap:6px">
            <input type="text" id="scl-inp-${key}" placeholder="輸入調性後按 +" style="flex:1;min-width:0;padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-family:Noto Serif TC,serif;font-size:13px;outline:none" onkeydown="if(event.key==='Enter'){event.preventDefault();sclAdd('${key}');}">
            <button class="btn btn-p btn-sm" style="flex:0 0 auto" onclick="sclAdd('${key}')">＋</button>
          </div>
        </div>`;
      });
    });
    html+=`</div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
          <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">快速套用：把某一格的清單複製到此大項全部 9 格</span>
          <div style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap">
            <input type="text" id="scl-bulk-${cat.id}" placeholder="多個調性用逗號或頓號分隔，如：C 大調、G 大調、F 大調" style="flex:1;min-width:200px;padding:5px 9px;border:1px solid var(--border);border-radius:var(--r);font-family:Noto Serif TC,serif;font-size:12px;outline:none">
            <button class="btn btn-b btn-sm" onclick="sclBulkApply('${cat.id}')" title="覆蓋此大項全部9格">套用到此大項全部</button>
          </div>
        </div>
      </div>
    </div>`;
  });
  grid.innerHTML=html;
  renderScaleRoomMode();
  const cd=document.getElementById('scl-cross-device');
  if(cd)cd.checked=!!DB.config.liveScreenCrossDevice;
}
window.renderScaleRules=renderScaleRules;

// 摺疊/展開某樂器大項
function sclToggleCat(catId){
  const body=document.getElementById('scl-cat-body-'+catId);
  const head=document.querySelector(`.scl-cat-group[data-cat="${catId}"] .scl-cat-head`);
  if(!body)return;
  const show=body.style.display==='none';
  body.style.display=show?'':'none';
  if(head)head.classList.toggle('open',show);
}
window.sclToggleCat=sclToggleCat;

// 快速套用：把一串調性覆蓋到此大項的全部 9 格
function sclBulkApply(catId){
  const inp=document.getElementById('scl-bulk-'+catId);
  if(!inp)return;
  const raw=inp.value.trim();
  if(!raw){showToast('請先輸入調性','warn');return;}
  const list=raw.split(/[,，、;；]+/).map(s=>s.trim()).filter(Boolean);
  if(!list.length)return;
  const d=_sclGetDraft();
  const grades=['1','2','3'],types=['major','minor','elective'];
  grades.forEach(g=>types.forEach(t=>{ d[catId+'_'+g+'_'+t]=list.slice(); }));
  inp.value='';
  renderScaleRules(true);
  // 重新展開此大項
  const body=document.getElementById('scl-cat-body-'+catId);
  if(body){body.style.display='';const h=document.querySelector(`.scl-cat-group[data-cat="${catId}"] .scl-cat-head`);if(h)h.classList.add('open');}
  showToast('已套用到此大項全部 9 格','ok');
}
window.sclBulkApply=sclBulkApply;

function renderScaleRoomMode(){
  const wrap=document.getElementById('scl-room-mode');
  if(!wrap)return;
  const cats=(DB.instruments.categories||[]).slice().sort((a,b)=>(a.order??99)-(b.order??99));
  const grades=[['1','高一'],['2','高二'],['3','高三']];
  const types=[['major','主修'],['minor','副修'],['elective','選修']];
  let opts='<option value="auto">依考生樂器×年級×修別自動</option>';
  cats.forEach(c=>{
    grades.forEach(([g,gl])=>types.forEach(([t,tl])=>{
      opts+=`<option value="${c.id}_${g}_${t}">固定用：${escHtml(c.name)}·${gl}·${tl} 清單</option>`;
    }));
  });
  wrap.innerHTML=DB.rooms.map(r=>{
    return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="min-width:120px;font-family:'DM Mono',monospace;font-size:11px">${escHtml(r.name)}</span>
      <select id="scl-mode-${r.id}" style="padding:5px 10px;border:1px solid var(--border);border-radius:var(--r);font-family:Noto Serif TC,serif;font-size:13px;max-width:320px">${opts}</select>
    </div>`;
  }).join('');
  DB.rooms.forEach(r=>{
    const sel=document.getElementById('scl-mode-'+r.id);
    if(sel)sel.value=(DB.config.roomScaleMode||{})[r.id]||'auto';
  });
}

function sclAdd(key){
  const inp=document.getElementById('scl-inp-'+key);
  if(!inp)return;
  const v=inp.value.trim();
  if(!v)return;
  const d=_sclGetDraft();
  if(!d[key])d[key]=[];
  if(d[key].includes(v)){showToast('已有此調性','warn');return;}
  d[key].push(v);
  inp.value='';
  _sclRefreshChips(key);
  inp.focus();
}
window.sclAdd=sclAdd;

function sclRemove(key,idx){
  const d=_sclGetDraft();
  if(d[key])d[key].splice(idx,1);
  _sclRefreshChips(key);
}
window.sclRemove=sclRemove;

function _sclRefreshChips(key){
  const el=document.getElementById('scl-chips-'+key);
  if(!el)return;
  const d=_sclGetDraft();
  const list=d[key]||[];
  el.innerHTML=list.map((v,vi)=>`<span class="scl-chip">${escHtml(v)}<button onclick="sclRemove('${key}',${vi})" title="移除">×</button></span>`).join('')
    ||'<span style="font-size:11px;color:var(--muted)">尚未設定</span>';
}

function saveScaleRules(){
  const d=_sclGetDraft();
  // 清掉空清單
  Object.keys(d).forEach(k=>{ if(!d[k]||!d[k].length)delete d[k]; });
  DB.config.scaleRules=JSON.parse(JSON.stringify(d));
  // 各考場套用方式
  const mode={};
  DB.rooms.forEach(r=>{ const sel=document.getElementById('scl-mode-'+r.id); if(sel&&sel.value!=='auto')mode[r.id]=sel.value; });
  DB.config.roomScaleMode=mode;
  // 跨裝置
  const cd=document.getElementById('scl-cross-device');
  DB.config.liveScreenCrossDevice=!!(cd&&cd.checked);
  fbSaveConfig();
  _sclDraft=null;
  showToast('音階規則已儲存 ✓','ok');
}
window.saveScaleRules=saveScaleRules;

// ★ #5 渲染各考場評分欄位設定
function renderRoomFields(){
  const el=document.getElementById('room-fields-body');if(!el)return;
  if(!DB.rooms.length){el.innerHTML='<p style="color:var(--muted);font-size:12px">尚無考場</p>';return;}
  const allCats=DB.instruments.categories||[];
  const allInsts=DB.instruments.items||[];
  const allClasses=DB.classes||[];
  el.innerHTML=DB.rooms.map(r=>{
    const fields=getRoomFields(r.id);
    const fieldRows=fields.map((f,fi)=>{
      const rules=f.skipRules||[];
      // 每條排除規則的 UI
      const rulesHtml=rules.length?rules.map((rule,ri)=>`
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:5px 8px;background:var(--cream);border-radius:var(--r);margin-bottom:4px" id="rf-rule-${r.id}-${fi}-${ri}">
          <span style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted);white-space:nowrap">規則${ri+1}</span>
          <select data-rule-cat style="padding:3px 6px;border:1px solid var(--border);border-radius:var(--r);font-size:11px;outline:none;background:var(--white);max-width:100px">
            <option value="">全部大項</option>
            ${allCats.map(c=>`<option value="${c.id}" ${rule.catId===c.id?'selected':''}>${c.name}</option>`).join('')}
          </select>
          <select data-rule-inst style="padding:3px 6px;border:1px solid var(--border);border-radius:var(--r);font-size:11px;outline:none;background:var(--white);max-width:110px">
            <option value="">全部樂器（細項）</option>
            ${allInsts.map(i=>`<option value="${i.id}" ${rule.instId===i.id?'selected':''}>${i.name}</option>`).join('')}
          </select>
          <select data-rule-type style="padding:3px 6px;border:1px solid var(--border);border-radius:var(--r);font-size:11px;outline:none;background:var(--white)">
            <option value="">全部修別</option>
            <option value="major" ${rule.type==='major'?'selected':''}>主修</option>
            <option value="minor" ${rule.type==='minor'?'selected':''}>副修</option>
            <option value="elective" ${rule.type==='elective'?'selected':''}>選修</option>
          </select>
          <select data-rule-cls style="padding:3px 6px;border:1px solid var(--border);border-radius:var(--r);font-size:11px;outline:none;background:var(--white);max-width:90px">
            <option value="">全部班級</option>
            ${allClasses.map(c=>`<option value="${c}" ${rule.cls===c?'selected':''}>${c}</option>`).join('')}
          </select>
          <button onclick="rfRemoveRule('${r.id}',${fi},${ri})" style="background:none;border:none;cursor:pointer;color:var(--rust);font-size:13px;padding:0 2px;line-height:1" title="刪除此規則">✕</button>
        </div>`).join('')
        :'<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--border);padding:4px 2px">尚無排除條件，此欄對所有人計分</div>';

      // ★ 個別學生例外（不受上述條件限制，直接指定特定學生×修別此欄不計分）
      const skipEntries=f.skipEntries||[];
      const skipStuHtml=`
        <div style="margin-top:8px;padding:6px 8px;background:var(--cream);border-radius:var(--r)">
          <div style="font-family:DM Mono,monospace;font-size:8px;letter-spacing:1px;color:var(--rust);margin-bottom:5px;text-transform:uppercase">👤 個別學生例外（直接指定，不受上方條件限制）</div>
          <div id="rf-skipstu-${r.id}-${fi}" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px">
            ${skipEntries.length?skipEntries.map(ek=>{
              const pe=_parseEntryKey(ek);
              const stu=DB.users.find(u=>u.id===pe.studentId);
              const lbl=(stu?stu.name:pe.studentId)+'（'+typeName(pe.type)+'）';
              return `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--white);border:1px solid var(--border);border-radius:var(--r);padding:3px 6px;font-size:11px">${lbl}<button onclick="rfRemoveSkipStudent('${r.id}',${fi},'${ek}')" style="background:none;border:none;cursor:pointer;color:var(--rust);font-size:12px;line-height:1;padding:0">✕</button></span>`;
            }).join(''):'<span style="font-size:10px;color:var(--muted)">尚未指定個別學生</span>'}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <select id="rf-addstu-${r.id}-${fi}" style="flex:1;min-width:180px;padding:3px 6px;border:1px solid var(--border);border-radius:var(--r);font-size:11px;outline:none;background:var(--white)">
              ${_allStudentTypeOptions().filter(o=>!skipEntries.includes(o.value)).map(o=>`<option value="${o.value}">${o.label}</option>`).join('')}
            </select>
            <button class="btn btn-s btn-xs" onclick="rfAddSkipStudent('${r.id}',${fi})">＋ 新增例外</button>
          </div>
        </div>`;

      // ★ 新增：重分配 UI（只有在有排除規則時才顯示）
      const otherFields=fields.filter((_,oi)=>oi!==fi);
      const redistData=f.redistribution||[];
      const redistHtml=rules.length&&otherFields.length?`
        <div style="margin-top:10px;padding:8px 10px;background:#f0f8ff;border:1px solid #bee3f8;border-radius:var(--r)">
          <div style="font-family:DM Mono,monospace;font-size:8px;letter-spacing:1px;color:var(--steel);margin-bottom:6px;text-transform:uppercase">
            ↩ 被排除時，此欄 <strong style="color:var(--ink)">${f.pct}%</strong> 如何重分配給其他欄（留空 = 自動按比例均攤）
          </div>
          <div id="rf-redist-${r.id}-${fi}" style="display:flex;flex-direction:column;gap:4px">
            ${otherFields.map((of,oi)=>{
              const existing=redistData.find(rd=>rd.fieldId===of.id);
              return `<div style="display:flex;align-items:center;gap:8px">
                <span style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted);min-width:70px;white-space:nowrap">${of.label}</span>
                <input type="number" data-redist-field="${of.id}" value="${existing?existing.pct:''}" min="0" max="100" placeholder="留空=自動"
                  style="width:68px;padding:3px 6px;border:1px solid var(--border);border-radius:var(--r);font-size:11px;font-family:DM Mono,monospace;outline:none;text-align:center"
                  title="此欄被排除時，多少%分給「${of.label}」（留空表示自動按比例均攤）">
                <span style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted)">%</span>
              </div>`;
            }).join('')}
          </div>
          <div style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted);margin-top:5px">
            💡 填寫加總應等於 ${f.pct}%。若總和不足或留空，系統自動按其餘欄位比重補足。
          </div>
        </div>`:
        (rules.length&&!otherFields.length?'':'');

      return `<div style="border:1px solid var(--cream);border-radius:var(--r);margin-bottom:10px;overflow:hidden" id="rf-row-${r.id}-${fi}">
        <div style="background:var(--cream);padding:7px 10px;display:flex;gap:7px;align-items:flex-end;flex-wrap:wrap">
          <div class="fg" style="min-width:110px;margin-bottom:0"><label>欄位名稱</label>
            <input type="text" value="${f.label}" id="rf-lbl-${r.id}-${fi}" style="font-size:12px;padding:5px 8px">
          </div>
          <div class="fg" style="min-width:58px;max-width:68px;margin-bottom:0"><label>% 比重</label>
            <input type="number" value="${f.pct}" id="rf-pct-${r.id}-${fi}" min="0" max="100" style="font-size:12px;padding:5px 8px">
          </div>
          <button class="btn btn-d btn-xs" onclick="removeRoomField('${r.id}',${fi})">✕ 刪除欄位</button>
        </div>
        <div style="padding:8px 10px;background:var(--white)">
          <div style="font-family:DM Mono,monospace;font-size:8px;letter-spacing:1px;color:var(--rust);margin-bottom:6px;text-transform:uppercase">
            ⊘ 此欄自動標 * 不計分的條件（多條件為 OR；同一條件內大項、樂器（細項）、修別、班級為 AND；以「該筆 entry 本身」的修別＋大項＋樂器做比對，例：「木管組+選修」只跳「選修木管」，不影響該生主修木管；亦可指定到單一樂器）
          </div>
          <div id="rf-rules-${r.id}-${fi}">${rulesHtml}</div>
          <button class="btn btn-s btn-xs" style="margin-top:4px" onclick="rfAddRule('${r.id}',${fi})">＋ 新增排除條件</button>
          ${skipStuHtml}
          ${redistHtml}
        </div>
      </div>`;
    }).join('');
    return `<div style="border:1px solid var(--border);border-radius:var(--r);margin-bottom:14px;overflow:hidden">
      <div style="background:var(--ink);color:var(--gold);padding:8px 14px;font-family:DM Mono,monospace;font-size:9px;letter-spacing:2px;display:flex;align-items:center;justify-content:space-between">
        <span>${r.name}</span>
        <span style="font-size:8px;opacity:.6">評語欄固定存在</span>
      </div>
      <div style="padding:12px 14px;background:var(--white)">
        <div id="rf-fields-${r.id}">${fieldRows}</div>
        <div class="bg" style="margin-top:10px">
          <button class="btn btn-s btn-xs" onclick="addRoomField('${r.id}')">＋ 新增評分欄位</button>
          <button class="btn btn-p btn-xs" onclick="saveRoomFields('${r.id}')">💾 儲存此考場設定</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
window.renderRoomFields=renderRoomFields;

// ★ 新增一條排除規則（即時 re-render）
function rfAddRule(roomId,fi){
  const r=DB.rooms.find(x=>x.id===roomId);if(!r)return;
  if(!r.scoreFields)r.scoreFields=getRoomFields(roomId);
  if(!r.scoreFields[fi].skipRules)r.scoreFields[fi].skipRules=[];
  // 先從畫面讀取目前所有規則，避免覆蓋
  rfReadRulesFromDOM(roomId,fi);
  r.scoreFields[fi].skipRules.push({catId:'',instId:'',type:'',cls:''});
  renderRoomFields();
}
window.rfAddRule=rfAddRule;

// ★ 取得「學生×修別」下拉選項（給個別學生例外使用）
function _allStudentTypeOptions(){
  const opts=[];
  students().forEach(u=>{
    ['major','minor','elective'].forEach(t=>{
      if(u[t]){
        opts.push({value:u.id+'_'+t, label:`${u.name}（${u.class||'-'}/${u.seat||'-'}）${typeName(t)}・${iname(u[t])}`});
      }
    });
  });
  opts.sort((a,b)=>a.label.localeCompare(b.label,'zh-TW'));
  return opts;
}
window._allStudentTypeOptions=_allStudentTypeOptions;

// ★ 將 entryKey（studentId_type）拆解回 {studentId,type}
function _parseEntryKey(ek){
  for(const t of ['major','minor','elective']){
    if(ek.endsWith('_'+t))return{studentId:ek.slice(0,-(t.length+1)),type:t};
  }
  return{studentId:ek,type:''};
}
window._parseEntryKey=_parseEntryKey;

// ★ 新增個別學生例外（指定學生×修別此欄不計分）
function rfAddSkipStudent(roomId,fi){
  const r=DB.rooms.find(x=>x.id===roomId);if(!r)return;
  if(!r.scoreFields)r.scoreFields=getRoomFields(roomId);
  rfReadRulesFromDOM(roomId,fi);
  const sel=document.getElementById('rf-addstu-'+roomId+'-'+fi);
  const val=sel?.value;
  if(!val){showToast('請先選擇學生','err');return;}
  if(!r.scoreFields[fi].skipEntries)r.scoreFields[fi].skipEntries=[];
  if(!r.scoreFields[fi].skipEntries.includes(val))r.scoreFields[fi].skipEntries.push(val);
  renderRoomFields();
}
window.rfAddSkipStudent=rfAddSkipStudent;

// ★ 刪除個別學生例外
function rfRemoveSkipStudent(roomId,fi,entryKey){
  const r=DB.rooms.find(x=>x.id===roomId);if(!r||!r.scoreFields)return;
  rfReadRulesFromDOM(roomId,fi);
  r.scoreFields[fi].skipEntries=(r.scoreFields[fi].skipEntries||[]).filter(e=>e!==entryKey);
  renderRoomFields();
}
window.rfRemoveSkipStudent=rfRemoveSkipStudent;

// ★ 刪除一條排除規則
function rfRemoveRule(roomId,fi,ri){
  const r=DB.rooms.find(x=>x.id===roomId);if(!r)return;
  if(!r.scoreFields)r.scoreFields=getRoomFields(roomId);
  rfReadRulesFromDOM(roomId,fi);
  r.scoreFields[fi].skipRules.splice(ri,1);
  renderRoomFields();
}
window.rfRemoveRule=rfRemoveRule;

// ★ 從 DOM 讀取目前某欄的 skipRules（儲存前同步用）
function rfReadRulesFromDOM(roomId,fi){
  const r=DB.rooms.find(x=>x.id===roomId);if(!r||!r.scoreFields)return;
  const rulesEl=document.getElementById('rf-rules-'+roomId+'-'+fi);if(!rulesEl)return;
  const ruleDivs=rulesEl.querySelectorAll('[id^="rf-rule-"]');
  r.scoreFields[fi].skipRules=[];
  ruleDivs.forEach(div=>{
    const catId=div.querySelector('[data-rule-cat]')?.value||'';
    const instId=div.querySelector('[data-rule-inst]')?.value||'';
    const type=div.querySelector('[data-rule-type]')?.value||'';
    const cls=div.querySelector('[data-rule-cls]')?.value||'';
    r.scoreFields[fi].skipRules.push({catId,instId,type,cls});
  });
}
window.rfReadRulesFromDOM=rfReadRulesFromDOM;

function addRoomField(roomId){
  const r=DB.rooms.find(x=>x.id===roomId);if(!r)return;
  if(!r.scoreFields)r.scoreFields=getRoomFields(roomId);
  r.scoreFields.push({id:'field_'+Date.now(),label:'新欄位',pct:0});
  renderRoomFields();
}
window.addRoomField=addRoomField;

function removeRoomField(roomId,fi){
  const r=DB.rooms.find(x=>x.id===roomId);if(!r)return;
  if(!r.scoreFields)r.scoreFields=getRoomFields(roomId);
  if(r.scoreFields.length<=1){showToast('至少須保留一個評分欄位','err');return;}
  r.scoreFields.splice(fi,1);
  renderRoomFields();
}
window.removeRoomField=removeRoomField;

function saveRoomFields(roomId){
  const r=DB.rooms.find(x=>x.id===roomId);if(!r)return;
  const container=document.getElementById('rf-fields-'+roomId);if(!container)return;
  const rows=[...container.querySelectorAll('[id^="rf-row-"]')];
  const prevFields=getRoomFields(roomId);
  r.scoreFields=[];
  rows.forEach((row,fi)=>{
    const lbl=document.getElementById('rf-lbl-'+roomId+'-'+fi)?.value.trim()||'欄位'+(fi+1);
    const pct=parseInt(document.getElementById('rf-pct-'+roomId+'-'+fi)?.value)||0;
    const existingId=(prevFields[fi]?.id)||'field_'+(fi+Date.now());
    // 從 DOM 讀取所有 skipRules
    const rulesEl=document.getElementById('rf-rules-'+roomId+'-'+fi);
    const skipRules=[];
    if(rulesEl){
      rulesEl.querySelectorAll('[id^="rf-rule-"]').forEach(div=>{
        const catId=div.querySelector('[data-rule-cat]')?.value||'';
        const instId=div.querySelector('[data-rule-inst]')?.value||'';
        const type=div.querySelector('[data-rule-type]')?.value||'';
        const cls=div.querySelector('[data-rule-cls]')?.value||'';
        skipRules.push({catId,instId,type,cls});
      });
    }
    // ★ 從 DOM 讀取重分配設定
    const redistEl=document.getElementById('rf-redist-'+roomId+'-'+fi);
    const redistribution=[];
    if(redistEl){
      redistEl.querySelectorAll('[data-redist-field]').forEach(inp=>{
        const fieldId=inp.dataset.redistField;
        const val=inp.value.trim();
        if(val!==''&&!isNaN(parseInt(val))&&parseInt(val)>0){
          redistribution.push({fieldId,pct:parseInt(val)});
        }
      });
    }
    const skipEntries=prevFields[fi]?.skipEntries||[];
    r.scoreFields.push({id:existingId,label:lbl,pct,skipRules,redistribution,skipEntries});
  });
  fbSet('rooms',r.id,{...r,_order:DB.rooms.indexOf(r)});
  renderRoomFields();
  showToast(r.name+' 評分欄位已儲存 ✓','ok');
}
window.saveRoomFields=saveRoomFields;

// ════════════════════════════════════════════════
// ADMIN - ACCESS CONTROL
// ════════════════════════════════════════════════
// access value: true=公開, 'pending'=尚未開放(可見但鎖定), false=關閉(不可見)
function renderAccessControl(){
  const studentPages=[
    {id:'rep',label:'曲目填寫'},
    {id:'scores',label:'評語'},
    {id:'stu-schedule',label:'考試順序查詢'},
    {id:'exam-rules',label:'考試規則與指定曲'},
    {id:'live-results',label:'📊 現場評分成績總表'},
  ];
  const teacherPages=[
    {id:'teacher',label:'平時評量'},
    {id:'tea-schedule',label:'考試順序查看'},
    {id:'jury-signup',label:'📋 期末考評分報名'},
    {id:'exam-rules',label:'考試規則與指定曲'},
    {id:'live-results',label:'📊 現場評分成績總表'},
    {id:'tea-jury-comments',label:'💬 我的學生期末評語'},
  ];
  const stateLabel=(v)=>{
    if(v===true||v===undefined||v===null)return {txt:'公開',cls:'background:#d4edda;color:#155724'};
    if(v==='pending')return {txt:'尚未開放',cls:'background:#fff3cd;color:#856404'};
    return {txt:'關閉',cls:'background:#f8d7da;color:#721c24'};
  };
  const render=(pages,configKey,containerId)=>{
    const el=document.getElementById(containerId);if(!el)return;
    el.innerHTML=pages.map(p=>{
      const s=stateLabel(DB.config[configKey][p.id]);
      return `<div class="access-grid" style="grid-template-columns:1fr auto auto auto auto">
        <div class="access-label">${p.label}</div>
        <button class="btn btn-g btn-sm" onclick="setAccess('${configKey}','${p.id}',true)">公開</button>
        <button class="btn btn-o btn-sm" onclick="setAccess('${configKey}','${p.id}','pending')">尚未開放</button>
        <button class="btn btn-d btn-sm" onclick="setAccess('${configKey}','${p.id}',false)">關閉</button>
        <div style="font-family:\'DM Mono\',monospace;font-size:9px;padding:3px 10px;border-radius:20px;${s.cls}">${s.txt}</div>
      </div>`;
    }).join('');
    // pending 訊息文字輸入（每頁一個）
    const msgDiv=document.getElementById(containerId+'-pending-msgs');
    if(!msgDiv){
      const wrap=document.createElement('div');wrap.id=containerId+'-pending-msgs';wrap.style.cssText='margin-top:14px;padding-top:12px;border-top:1px solid var(--cream)';
      wrap.innerHTML='<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1px;color:var(--muted);margin-bottom:8px">「尚未開放」時顯示的提示文字（各頁可分別設定）</div>'+
        pages.map(p=>`<div class="fg" style="margin-bottom:8px">
          <label>${p.label}</label>
          <input type="text" id="pending-msg-${p.id}" value="${DB.config.pendingMsg?.[p.id]||''}" placeholder="例：成績尚未公布，敬請期待。" style="font-size:12px">
        </div>`).join('')+
        `<button class="btn btn-s btn-sm" onclick="savePendingMsgs('${configKey}','${containerId}')">儲存提示文字</button>`;
      el.appendChild(wrap);
    } else {
      pages.forEach(p=>{const inp=document.getElementById('pending-msg-'+p.id);if(inp)inp.value=DB.config.pendingMsg?.[p.id]||'';});
    }
  };
  render(studentPages,'studentAccess','access-student');
  render(teacherPages,'teacherAccess','access-teacher');
  // Teacher schedule closed message (legacy)
  const tsmEl=document.getElementById('access-teacher-schedule-msg');
  if(!tsmEl){
    const el=document.getElementById('access-teacher');
    if(el){
      const wrap=document.createElement('div');wrap.id='access-teacher-schedule-msg';wrap.style.cssText='margin-top:12px;padding-top:12px;border-top:1px solid var(--cream)';
      wrap.innerHTML=`<div style="font-family:DM Mono,monospace;font-size:9px;letter-spacing:1px;color:var(--muted);margin-bottom:6px">教師考試排程「尚未開放」時顯示的文字</div>
        <input type="text" id="tea-schedule-closed-msg" value="${DB.config.teacherScheduleClosedMsg||'考試排程尚未開放查看，請等候管理員公告。'}" style="width:100%;padding:8px 12px;border:1px solid var(--border);background:var(--paper);border-radius:var(--r);font-size:13px;outline:none" onchange="DB.config.teacherScheduleClosedMsg=this.value">
        <button class="btn btn-s btn-sm" style="margin-top:6px" onclick="saveTeaScheduleMsg()">儲存提示文字</button>`;
      el.appendChild(wrap);
    }
  }
}
function setAccess(configKey,pageId,val){
  if(!requireRole('admin'))return;
  DB.config[configKey][pageId]=val;
  fbSaveConfig();renderAccessControl();
  updateJurySignupTabVisibility();
  // ★ Bug10：重建導覽列，讓學生/教師介面立即看到開放/關閉的頁面
  buildNav();renderAll();
  const label={true:'公開',pending:'尚未開放',false:'關閉'}[val]||'關閉';
  showToast(`已設為「${label}」`,'ok');
}
function savePendingMsgs(configKey,containerId){
  if(!DB.config.pendingMsg)DB.config.pendingMsg={};
  document.querySelectorAll(`#${containerId} [id^="pending-msg-"]`).forEach(inp=>{
    const pageId=inp.id.replace('pending-msg-','');
    DB.config.pendingMsg[pageId]=inp.value;
  });
  fbSaveConfig();showToast('提示文字已儲存 ✓','ok');
}
window.savePendingMsgs=savePendingMsgs;
function saveTeaScheduleMsg(){DB.config.teacherScheduleClosedMsg=document.getElementById('tea-schedule-closed-msg')?.value||'';fbSaveConfig();showToast('提示文字已儲存 ✓','ok');}
window.saveTeaScheduleMsg=saveTeaScheduleMsg;

// ════════════════════════════════════════════════
// ADMIN - CONTENT
// ════════════════════════════════════════════════
function saveRepHint(){DB.config.repHint=document.getElementById('rep-hint-txt').value;fbSaveConfig();renderRepHint();showToast('已儲存 ✓','ok');}
function saveTyText(){DB.config.tyTitle=document.getElementById('ty-title-inp').value;DB.config.tyText=document.getElementById('ty-body-inp').value;fbSaveConfig();showToast('已儲存 ✓','ok');}

// ════════════════════════════════════════════════
// ADMIN - COMMENT MANAGEMENT (補填評語)
// ════════════════════════════════════════════════
function adminCommentInit(){
  const sel=document.getElementById('admin-comment-stu');if(!sel)return;
  const prev=sel.value;sel.innerHTML='<option value="">— 請選學生 —</option>';
  students().sort((a,b)=>DB.classes.indexOf(a.class)-DB.classes.indexOf(b.class)||a.seat-b.seat)
    .forEach(s=>sel.appendChild(new Option(s.class+' '+s.name+' ('+s.account+')',s.id)));
  if(prev)sel.value=prev;
}
function adminCommentLoadStudent(){
  const sid=document.getElementById('admin-comment-stu').value;
  if(!sid)return;
  adminCommentLoadType();
}
function adminCommentLoadType(){
  const sid=document.getElementById('admin-comment-stu').value;
  const type=document.getElementById('admin-comment-type').value;
  if(!sid||!type)return;
  // Load existing jury comments for this student/type
  const stu=DB.users.find(u=>u.id===sid);
  if(!stu)return;
  const _catId=DB.instruments.items.find(i=>i.id===stu[type])?.cat;
  const roomId=_findScoredRoomForEntry(sid, type, _catId);
  const room=DB.rooms.find(r=>r.id===roomId)||null;
  const entryKey=sid+'_'+type;
  const jurorData=roomId&&DB.juryScores[roomId]?.[entryKey]?{}:null;
  const existing=jurorData?_safeJurors(jurorData).filter(j=>!j.absent&&j.comment).map(j=>j.comment).join('\n\n'):'';
  const ta=document.getElementById('admin-comment-text');
  if(ta&&!ta.value)ta.value=existing;
  const status=document.getElementById('admin-comment-status');
  if(status)status.textContent=stu.name+' · '+typeName(type)+' · '+(iname(stu[type])||'未填報');
}
function adminCommentSave(){
  const sid=document.getElementById('admin-comment-stu').value;
  const type=document.getElementById('admin-comment-type').value;
  const text=document.getElementById('admin-comment-text').value.trim();
  if(!sid||!type){showToast('請選擇學生及修別','err');return;}
  // Save as a special admin juror entry
  const stu=DB.users.find(u=>u.id===sid);if(!stu)return;
  const _catId=DB.instruments.items.find(i=>i.id===stu[type])?.cat;
  const roomId=_findScoredRoomForEntry(sid, type, _catId);if(!roomId){showToast('找不到對應考場','err');return;}
  const entryKey=sid+'_'+type;
  if(!DB.juryScores[roomId])DB.juryScores[roomId]={};
  if(!DB.juryScores[roomId][entryKey])DB.juryScores[roomId][entryKey]={};
  const adminJurorId='ADMIN_COMMENT';
  DB.juryScores[roomId][entryKey][adminJurorId]={
    ...(DB.juryScores[roomId][entryKey][adminJurorId]||{}),
    comment:text,absent:false,_adminFilled:true
  };
  // Firebase
  if(window._FB){
    const {db,serverTimestamp}=window._FB;
    const patch={};patch[adminJurorId]={...DB.juryScores[roomId][entryKey][adminJurorId]};
    patch._updatedAt=serverTimestamp();
    db.collection('juryScores').doc(roomId).collection('entries').doc(entryKey).set(patch,{merge:true});
  }
  showToast('評語已儲存 ✓','ok');
  document.getElementById('admin-comment-text').value='';
}
function adminCommentFromImage(input){
  const file=input.files[0];if(!file)return;
  const status=document.getElementById('admin-comment-status');
  if(status)status.textContent='圖片辨識中，請稍候...';
  const reader=new FileReader();
  reader.onload=ev=>{
    const img=new Image();
    img.onload=()=>{
      const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
      canvas.getContext('2d').drawImage(img,0,0);
      // Use Tesseract if available, else prompt user
      if(window.Tesseract){
        window.Tesseract.recognize(canvas,'chi_tra+eng',{logger:m=>{}}).then(({data:{text}})=>{
          const ta=document.getElementById('admin-comment-text');
          if(ta)ta.value=(ta.value?ta.value+'\n\n':'')+text.trim();
          if(status)status.textContent='圖片辨識完成 ✓';
        }).catch(()=>{
          if(status)status.textContent='辨識失敗，請手動輸入文字';
        });
      } else {
        // Fallback: just show image in a modal for manual copy
        if(status)status.textContent='圖片已載入。由於環境限制，請手動輸入圖片中的文字。';
        showToast('請手動輸入圖片評語','warn');
      }
    };
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
  input.value='';
}
function adminCommentImportCSV(){
  const input=document.createElement('input');input.type='file';input.accept='.csv,.txt';
  input.onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const lines=ev.target.result.split('\n').slice(1).filter(l=>l.trim());
      let count=0,errors=[];
      lines.forEach((line,li)=>{
        // 格式：帳號,修別(major/minor/elective),評語
        const cols=line.split(',').map(s=>s.trim().replace(/^"|"$/g,''));
        const [account,type,comment]=cols;
        if(!account||!type||!comment){errors.push('第'+(li+2)+'行格式錯誤');return;}
        const stu=DB.users.find(u=>u.account===account&&u.role==='student');
        if(!stu){errors.push('帳號不存在：'+account);return;}
        const _catId=DB.instruments.items.find(i=>i.id===stu[type])?.cat;
        const roomId=_findScoredRoomForEntry(stu.id, type, _catId);if(!roomId){errors.push('找不到考場：'+account);return;}
        const entryKey=stu.id+'_'+type;
        if(!DB.juryScores[roomId])DB.juryScores[roomId]={};
        if(!DB.juryScores[roomId][entryKey])DB.juryScores[roomId][entryKey]={};
        DB.juryScores[roomId][entryKey]['ADMIN_COMMENT']={comment,absent:false,_adminFilled:true};
        if(window._FB){
          const {db,serverTimestamp}=window._FB;
          const patch={ADMIN_COMMENT:{comment,absent:false,_adminFilled:true},_updatedAt:serverTimestamp()};
          db.collection('juryScores').doc(roomId).collection('entries').doc(entryKey).set(patch,{merge:true});
        }
        count++;
      });
      if(errors.length)showToast('匯入 '+count+' 筆，'+errors.length+' 筆錯誤','warn');
      else showToast('已匯入 '+count+' 筆評語 ✓','ok');
    };
    reader.readAsText(f,'UTF-8');
  };
  input.click();
}
function adminCommentDownloadSample(e){
  e.preventDefault();
  const csv='帳號,修別,評語\ns001,major,"音色圓潤，音準穩定，技巧成熟"\ns002,major,"節奏感佳，建議加強音色控制"';
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='評語匯入範例.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
window.adminCommentSave=adminCommentSave;
window.adminCommentLoadStudent=adminCommentLoadStudent;
window.adminCommentLoadType=adminCommentLoadType;
window.adminCommentFromImage=adminCommentFromImage;
window.adminCommentImportCSV=adminCommentImportCSV;
window.adminCommentDownloadSample=adminCommentDownloadSample;

function renderInstRestrictUI(){
  const el=document.getElementById('inst-restrict-body');if(!el)return;
  if(!DB.config.instRestrict)DB.config.instRestrict={major:[],minor:[],elective:[]};
  if(!DB.config.instRestrictMsg)DB.config.instRestrictMsg={major:{},minor:{},elective:{}};
  const types=[{key:'major',label:'主修'},{key:'minor',label:'副修'},{key:'elective',label:'選修'}];
  el.innerHTML=types.map(t=>`
    <div style="margin-bottom:14px">
      <div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:1.5px;color:var(--muted);margin-bottom:8px;text-transform:uppercase">${t.label}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${DB.instruments.items.map(i=>{
          const active=(DB.config.instRestrict[t.key]||[]).includes(i.id);
          return `<label style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border:1px solid ${active?'var(--gold)':'var(--border)'};border-radius:20px;cursor:pointer;font-family:DM Mono,monospace;font-size:9px;background:${active?'var(--gold)':'var(--white)'};color:${active?'var(--ink)':'inherit'};transition:all .15s">
            <input type="checkbox" data-type="${t.key}" value="${i.id}" ${active?'checked':''} style="display:none" onchange="this.parentElement.style.background=this.checked?&apos;var(--gold)&apos;:&apos;var(--white)&apos;;this.parentElement.style.borderColor=this.checked?&apos;var(--gold)&apos;:&apos;var(--border)&apos;">
            ${i.name}
          </label>`;
        }).join('')}
      </div>
    </div>`).join('');

  // 各修別附加訊息
  const msgEl=document.getElementById('inst-restrict-msg-body');
  if(msgEl){
    msgEl.innerHTML=types.map(t=>`
      <div style="margin-bottom:12px">
        <div style="font-family:\'DM Mono\',monospace;font-size:8px;color:var(--muted);margin-bottom:4px;text-transform:uppercase">${t.label} 附加訊息</div>
        <textarea id="irm-${t.key}" style="width:100%;padding:8px 12px;border:1px solid var(--border);background:var(--paper);border-radius:var(--r);font-family:Noto Serif TC,serif;font-size:13px;outline:none;resize:vertical;min-height:56px;line-height:1.7" placeholder="例：請點此確認準備資料 [查看說明](https://example.com)">${DB.config.instRestrictMsg?.[t.key]?.text||''}</textarea>
        <div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted);margin-top:3px">連結格式：[顯示文字](https://網址)　留空表示無附加訊息</div>
      </div>`).join('');
  }
  // 填入確認訊息文字
  const msgInp=document.getElementById('rep-confirm-msg-inp');
  if(msgInp)msgInp.value=DB.config.repConfirmMsg||'';
}

function saveInstRestrict(){
  if(!DB.config.instRestrict)DB.config.instRestrict={major:[],minor:[],elective:[]};
  if(!DB.config.instRestrictMsg)DB.config.instRestrictMsg={major:{},minor:{},elective:{}};
  ['major','minor','elective'].forEach(type=>{
    DB.config.instRestrict[type]=[...document.querySelectorAll(`#inst-restrict-body input[data-type="${type}"]:checked`)].map(cb=>cb.value);
    const msgTa=document.getElementById('irm-'+type);
    if(msgTa)DB.config.instRestrictMsg[type]={text:msgTa.value};
  });
  fbSaveConfig();showToast('樂器附加訊息設定已儲存 ✓','ok');
}
window.saveInstRestrict=saveInstRestrict;

function saveRepConfirmMsg(){
  DB.config.repConfirmMsg=document.getElementById('rep-confirm-msg-inp')?.value||'';
  fbSaveConfig();showToast('確認訊息已儲存 ✓','ok');
}
window.saveRepConfirmMsg=saveRepConfirmMsg;

// ════════════════════════════════════════════════
// ADMIN - DANGER: CLEAR DATA
// ════════════════════════════════════════════════
async function clearData(type){
  if(!requireRole('admin'))return;
  const labels={rep:'學生曲目填報',teacher:'教師平時成績',jury:'考試成績與評語',jurySignup:'教師期末考評分報名',all:'全部考試資料'};
  if(!confirm(`確定要清除「${labels[type]}」？此操作不可復原。`))return;
  let estimateOps=0;
  if(type==='rep'||type==='all')estimateOps+=students().length;
  if(type==='teacher'||type==='all')estimateOps+=Object.keys(DB.teacherComments).length+students().length;
  if(type==='jury'||type==='all'){
    Object.values(DB.juryScores||{}).forEach(r=>estimateOps+=Object.keys(r||{}).length);
  }
  if(type==='jurySignup')estimateOps+=Object.keys(DB.jurySignup||{}).length;
  if(estimateOps>50&&!confirm(`此操作將觸發約 ${estimateOps} 次 Firebase 寫入/刪除操作。\n\n再次確認要繼續？`))return;
  if(window._clearingData){showToast('清除中，請稍候...','warn');return;}
  window._clearingData=true;
  showToast(`正在清除「${labels[type]}」...`,'sync');

  // ★ helper：真正可靠的刪除（await + 控制併發）
  const isRest=window._FB?._rest;
  const db=window._FB?.db;
  const reliableDelete=async (path)=>{
    if(!window._FB)return;
    try{
      if(isRest){
        await window._FB._delete(path);
      } else if(db){
        // path: collection/doc 或 collection/doc/sub/doc
        const parts=path.split('/');
        let ref=db;
        for(let i=0;i<parts.length;i++){
          ref=i%2===0?ref.collection(parts[i]):ref.doc(parts[i]);
        }
        await ref.delete();
      }
    }catch(e){console.warn('[clearData delete]',path,e);}
  };
  // 控制併發：每批 10 個 promise 一起送，避免一次發太多失敗
  const batchAwait=async (tasks,batchSize=10)=>{
    for(let i=0;i<tasks.length;i+=batchSize){
      await Promise.all(tasks.slice(i,i+batchSize).map(t=>t()));
    }
  };

  try{
    if(type==='rep'||type==='all'){
      students().forEach(s=>{
        s.major_ac=s.major_at=s.major_fc=s.major_ft='';
        s.minor_ac=s.minor_at=s.minor_fc=s.minor_ft='';
        s.elec_ac=s.elec_at=s.elec_fc=s.elec_ft='';
        s.repDone=false;
        const fullUser={...s,
          major_ac:'',major_at:'',major_fc:'',major_ft:'',
          minor_ac:'',minor_at:'',minor_fc:'',minor_ft:'',
          elec_ac:'',elec_at:'',elec_fc:'',elec_ft:'',
          repDone:false,
        };
        if(window._FB?._rest){
          window._FB._set('users/'+s.id,{...fullUser,_updatedAt:new Date().toISOString()})
            .catch(e=>console.warn('[clearRep]',e));
        } else if(window._FB?.db){
          window._FB.db.collection('users').doc(s.id)
            .set({...fullUser,_updatedAt:new Date().toISOString()})
            .catch(e=>console.warn('[clearRep]',e));
        }
      });
      const pieceFields=['ac','at','fc','ft'];
      const snap=DB.savedScheduleSnapshot||{};
      Object.entries(snap).forEach(([roomId,entries])=>{
        if(!entries||!entries.length)return;
        let dirty=false;
        entries.forEach(e=>{
          pieceFields.forEach(f=>{if(e[f]){e[f]='';dirty=true;}});
        });
        if(dirty){
          fbSet('scheduleSnapshots',roomId,{entries,_savedAt:new Date().toISOString()});
        }
      });
      if(DB.repInstChanges){
        Object.keys(DB.repInstChanges).forEach(k=>fbDelete('repInstChanges',k));
        DB.repInstChanges={};
      }
      if(typeof renderAdminInstChangeNotices==='function')renderAdminInstChangeNotices();
    }
    if(type==='teacher'||type==='all'){
      Object.keys(DB.teacherComments).forEach(k=>{fbDelete('teacherComments',k);delete DB.teacherComments[k];});
      students().forEach(s=>{s.teaDone=false;fbSet('users',s.id,{teaDone:false});});
      // ★ 同時清除教師端的審核紀錄
      Object.keys(DB.pendingApprovals||{}).forEach(k=>{
        if(DB.pendingApprovals[k]?.kind==='teacher'){
          fbDelete('pendingApprovals',k);
          delete DB.pendingApprovals[k];
        }
      });
    }
    if(type==='jury'||type==='all'){
      // ★ 改為真正 await：先收集所有要刪的 path，再批次 await
      // ★ 從 Firebase 直接列出所有 entries（不依賴記憶體狀態，避免漏刪）
      const deleteTasks=[];
      const allRoomIds=new Set();
      // 來源1：DB.juryScores 記憶體
      Object.keys(DB.juryScores||{}).forEach(rid=>allRoomIds.add(rid));
      // 來源2：DB.rooms 設定（涵蓋所有可能的考場）
      (DB.rooms||[]).forEach(r=>r.id&&allRoomIds.add(r.id));

      // 對每個考場：直接從 Firebase 列出實際 entries 並刪除
      for(const roomId of allRoomIds){
        try{
          let entryDocs=[];
          if(isRest){
            entryDocs=await window._FB._list('juryScores/'+roomId+'/entries').catch(()=>[]);
          } else if(db){
            const snap=await db.collection('juryScores').doc(roomId).collection('entries').get();
            entryDocs=snap.docs.map(d=>({id:d.id}));
          }
          entryDocs.forEach(ed=>{
            if(ed.id)deleteTasks.push(()=>reliableDelete('juryScores/'+roomId+'/entries/'+ed.id));
          });
        }catch(e){console.warn('[clearData jury] 列出 '+roomId+' 失敗',e);}
      }
      // 加上 deductions
      Object.keys(DB.deductions||{}).forEach(k=>{
        deleteTasks.push(()=>reliableDelete('deductions/'+k));
      });
      console.log('[clearData jury] 從 Firebase 實際列出 '+deleteTasks.length+' 筆要刪除');
      await batchAwait(deleteTasks,10);
      console.log('[clearData jury] 刪除完成');

      // 清空記憶體
      DB.juryScores={};
      DB.deductions={};
      if(DB._jurorOrderCache)DB._jurorOrderCache={};

      // ★ 同時清除現場評分的審核紀錄
      Object.keys(DB.pendingApprovals||{}).forEach(k=>{
        if(DB.pendingApprovals[k]?.kind==='jury'){
          fbDelete('pendingApprovals',k);
          delete DB.pendingApprovals[k];
        }
      });

      // ★ 同時清空管理員自己的快取
      try{
        Object.values(CACHE_DATASETS).forEach(d=>{try{localStorage.removeItem(d.key);}catch(e){}});
      }catch(e){}

      // 推送 snapshot 讓學生/教師更新快取
      try{
        await publishSnapshot('scores');
        await publishSnapshot('comments');
      }catch(e){console.warn('[clearData] snapshot push',e);}

      try{
        const p=JSON.parse(localStorage.getItem(PENDING_KEY)||'[]');
        p.forEach(k=>localStorage.removeItem(k));
        localStorage.removeItem(PENDING_KEY);
      }catch(e){}
    }
    if(type==='jurySignup'||type==='all'){
      Object.keys(DB.jurySignup||{}).forEach(tid=>{
        fbDelete('jurySignup',tid);
      });
      DB.jurySignup={};
      if(typeof renderJsupAdminTable==='function')renderJsupAdminTable();
      if(typeof renderJurySignupPage==='function')renderJurySignupPage();
    }
    renderAll();
    showToast(`已清除「${labels[type]}」✓`,'ok');
    setTimeout(()=>{
      if(confirm(`「${labels[type]}」已清除完成。\n\n是否立即重新整理頁面以確認 Firebase 資料已更新？`)){
        location.reload();
      }
    },500);
  }finally{
    window._clearingData=false;
  }
}
window.clearData=clearData;

// ════════════════════════════════════════════════
// RESULTS (術科成績)
// ════════════════════════════════════════════════
let _showRealJurorNames=false;
function toggleJurorNames(){
  _showRealJurorNames=!_showRealJurorNames;
  const btn=document.getElementById('toggle-real-names-btn');
  const lbl=document.getElementById('jury-name-mode-label');
  if(btn)btn.textContent=_showRealJurorNames?'🙈 隱藏真實姓名':'👁 顯示評審真實姓名';
  if(lbl)lbl.textContent=_showRealJurorNames?'顯示真實姓名':'僅顯示代號';
  renderResults();
}
window.toggleJurorNames=toggleJurorNames;

function toggleRemarkFilter(){
  ST._remarkFilterOn=!ST._remarkFilterOn;
  const btn=document.getElementById('result-remark-filter-btn');
  if(btn){
    btn.textContent=ST._remarkFilterOn?'✕ 取消疑似扣分篩選':'⚠ 疑似扣分篩選';
    btn.style.background=ST._remarkFilterOn?'var(--rust)':'';
    btn.style.color=ST._remarkFilterOn?'#fff':'';
  }
  renderResults();
}
window.toggleRemarkFilter=toggleRemarkFilter;
let _resultViewMode='exam'; // 'exam' | 'class'
function setResultView(mode){
  _resultViewMode=mode;
  const eb=document.getElementById('res-view-exam');
  const cb=document.getElementById('res-view-class');
  const rl=document.getElementById('res-room-label');
  if(eb)eb.className='btn btn-xs '+(mode==='exam'?'btn-p':'btn-s');
  if(cb)cb.className='btn btn-xs '+(mode==='class'?'btn-p':'btn-s');
  // 班級彙整模式下考場選擇變為「可選（可篩選特定考場）」
  if(rl)rl.textContent=mode==='class'?'考場（選填）':'考場';
  const roomSel=document.getElementById('result-room');
  if(roomSel)roomSel.querySelector('option').textContent=mode==='class'?'全部考場':'選擇考場';
  renderResults();
}
window.setResultView=setResultView;

// ★ 取得某考場的排程 entries，排序邏輯與排程頁面一致（依考場 allowedCats 過濾 + 排序）
function _getEntriesForRoom(roomId, allSched){
  if(!roomId) return allSched.slice().sort((a,b)=>a.order-b.order);

  // Step 1: 只取屬於此考場的 entries
  let entries=allSched.filter(e=>e.roomId===roomId);

  // Step 2: 過濾手動移除的項目
  entries=entries.filter(e=>!SCH_STATE.removedEntries.has(e.studentId+'_'+e.type));

  // Step 3: 取得該考場的 SCH_STATE（若有儲存就用，否則用預設）
  const savedState=_SCH_ROOM_STATES[roomId];
  const room=DB.rooms.find(r=>r.id===roomId);
  const allowedCats=room?(room.allowedCats||room.cats||[]):[];

  // Step 4: 若有儲存的篩選狀態，依它過濾；否則只用 allowedCats
  if(savedState){
    const activeCats=new Set(savedState.catOrder.filter(c=>c.active).map(c=>c.id));
    if(activeCats.size) entries=entries.filter(e=>activeCats.has(e.catId));
    const activeInsts=new Set(savedState.instOrder.filter(i=>i.active).map(i=>i.id));
    if(activeInsts.size) entries=entries.filter(e=>activeInsts.has(e.instId));
    const activeTypes=new Set(savedState.typeOrder.filter(t=>t.active).map(t=>t.key));
    if(activeTypes.size) entries=entries.filter(e=>activeTypes.has(e.type));
    const activeClasses=new Set(savedState.classOrder.filter(c=>c.active).map(c=>c.cls));
    if(activeClasses.size) entries=entries.filter(e=>activeClasses.has(e.class));

    // 依儲存的排序順序
    const catIdx=id=>savedState.catOrder.findIndex(c=>c.id===id);
    const instIdx=id=>savedState.instOrder.findIndex(i=>i.id===id);
    const typeIdx=k=>savedState.typeOrder.findIndex(t=>t.key===k);
    const clsIdx=c=>{const i=savedState.classOrder.findIndex(x=>x.cls===c);return i>=0?i:999;};
    entries.sort((a,b)=>{
      const dc=catIdx(a.catId)-catIdx(b.catId);if(dc!==0)return dc;
      const di=instIdx(a.instId)-instIdx(b.instId);if(di!==0)return di;
      const dt=typeIdx(a.type)-typeIdx(b.type);if(dt!==0)return dt;
      const dcl=clsIdx(a.class)-clsIdx(b.class);if(dcl!==0)return dcl;
      return (a.seat-b.seat)*(savedState.seatDir||1);
    });
  } else {
    // 無儲存狀態：用 getScheduleEntries 的自然排序（catOrder → typeOrder → class → seat）
    entries.sort((a,b)=>a.order-b.order);
  }

  // 重新指定本考場的連續序號
  entries.forEach((e,i)=>e._resultOrder=i+1);
  return entries;
}
window._getEntriesForRoom=_getEntriesForRoom;

// ════════════════════════════════════════════════
// 幽靈評審清理工具（管理員用）
// ════════════════════════════════════════════════
async function cleanGhostJurors(){
  if(!requireRole('admin'))return;
  if(!confirm('確定要清理幽靈評審？\n\n系統將：\n① 合併同名評審的重複記錄\n② 移除無姓名且無分數的幽靈\n③ 移除「有姓名但無實際分數或評語」的殘留評審\n④ 整個文件覆寫，徹底清除 null 欄位\n\n此操作不可復原。'))return;

  let mergeCount=0,deleteCount=0;
  const isRest=window._FB?._rest;
  const db=window._FB?.db;
  const st=window._FB?.serverTimestamp;
  showToast('正在清理...','sync');

  for(const roomId of Object.keys(DB.juryScores)){
    const roomScores=DB.juryScores[roomId]||{};
    const fields=getRoomFields(roomId).map(f=>f.id);

    for(const [entryKey,entryData] of Object.entries(roomScores)){
      if(!entryData||typeof entryData!=='object')continue;
      const jurors=Object.entries(entryData).filter(([k])=>!k.startsWith('_'));
      const byName={};
      const toDelete=[];

      // 統一判斷標準
      const SYS_KEYS=new Set(['comment','absent']);
      const hasContent=(data)=>{
        if(!data||typeof data!=='object')return false;
        const hasScore=Object.keys(data).some(fk=>{
          if(fk.startsWith('_')||SYS_KEYS.has(fk))return false;
          const v=data[fk];
          return v!==undefined&&v!==''&&v!==null&&v!=='*';
        });
        const hasComment=data.comment&&String(data.comment).trim();
        return hasScore||hasComment;
      };

      jurors.forEach(([jid,data])=>{
        if(!data||typeof data!=='object'){toDelete.push(jid);return;}
        const n=(data._jurorName||'').trim();
        // ★ 沒實際內容的評審（不管有無姓名）一律刪除
        if(!hasContent(data)){toDelete.push(jid);return;}
        // 有內容才參與合併判斷
        if(n){
          if(!byName[n])byName[n]=[];
          byName[n].push([jid,data]);
        }
        // 有內容但沒姓名：保留（這種情況罕見，可能是評審還沒登錄就直接打分）
      });

      let dirty=false;
      // ① 合併同名重複 key（保留 stableId，刪除其他）
      for(const [name,records] of Object.entries(byName)){
        if(records.length<=1)continue;
        const stableId='JN_'+roomId+'_'+String(name).trim().replace(/\s+/g,'').replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g,'');
        const merged={_jurorName:name};
        records.sort((a,b)=>(b[1]._localUpdatedAt||0)-(a[1]._localUpdatedAt||0));
        records.forEach(([,d])=>{Object.keys(d).forEach(k=>{if(!merged[k]&&k!=='_jurorName'&&k!=='_localUpdatedAt')merged[k]=d[k];});});
        merged._localUpdatedAt=Date.now();
        DB.juryScores[roomId][entryKey][stableId]=merged;
        records.forEach(([jid])=>{
          if(jid!==stableId){delete DB.juryScores[roomId][entryKey][jid];mergeCount++;dirty=true;}
        });
      }
      // ② 刪除幽靈 key
      toDelete.forEach(jid=>{
        delete DB.juryScores[roomId][entryKey][jid];deleteCount++;dirty=true;
      });

      // ③ 整個文件覆寫到 Firebase（徹底清除舊欄位）
      if(dirty&&window._FB){
        const cleanData={...DB.juryScores[roomId][entryKey]};
        Object.keys(cleanData).forEach(k=>{if(k.startsWith('_'))delete cleanData[k];});
        cleanData._updatedAt=st?.()??new Date().toISOString();
        try{
          if(Object.keys(cleanData).length===1){
            // 只剩 _updatedAt：整個 entry 沒評審了，直接刪除文件
            if(isRest){
              await window._FB._delete('juryScores/'+roomId+'/entries/'+entryKey).catch(()=>{});
            } else if(db){
              await db.collection('juryScores').doc(roomId).collection('entries').doc(entryKey).delete();
            }
            delete DB.juryScores[roomId][entryKey];
          } else {
            if(isRest){
              await window._FB._delete('juryScores/'+roomId+'/entries/'+entryKey).catch(()=>{});
              await window._FB._set('juryScores/'+roomId+'/entries/'+entryKey,cleanData);
            } else if(db){
              await db.collection('juryScores').doc(roomId).collection('entries').doc(entryKey).set(cleanData);
            }
          }
        }catch(e){console.warn('[cleanGhost]',entryKey,e);}
      }
    }
  }

  // 重新整理快取
  if(DB._jurorOrderCache)DB._jurorOrderCache={};
  // 推送 snapshot 讓學生/教師也更新
  await publishSnapshot('scores');
  await publishSnapshot('comments');

  renderResults();
  if(typeof renderAdminResults==='function')renderAdminResults();
  if(typeof renderLiveResults==='function')renderLiveResults();
  if(typeof updateDelJurorList==='function')updateDelJurorList();

  showToast(`清理完成：合併 ${mergeCount} 筆重複、刪除 ${deleteCount} 筆幽靈評審 ✓`,'ok');
}
window.cleanGhostJurors=cleanGhostJurors;

// ════════════════════════════════════════════════
// H6：手動重新載入評分資料（管理員用）
// ════════════════════════════════════════════════
async function reloadJuryScores(){
  if(!requireRole('admin','teacher','student'))return;
  showToast('正在重新載入...','sync');
  try{
    if(typeof _loadJuryScores==='function'){
      await _loadJuryScores();
    } else {
      // fallback：直接讀
      const roomIds=(DB.rooms||[]).map(r=>r.id).filter(Boolean);
      DB.juryScores={};
      await Promise.all(roomIds.map(async roomId=>{
        if(window._FB?._rest){
          const docs=await window._FB._list('juryScores/'+roomId+'/entries').catch(()=>[]);
          if(!docs||!docs.length)return;
          DB.juryScores[roomId]={};
          docs.forEach(d=>{const{id,_updatedAt,...j}=d;if(!id)return;const cj={};Object.entries(j).forEach(([k,v])=>{if(v&&typeof v==='object')cj[k]=v;});DB.juryScores[roomId][id]=cj;});
        } else if(window._FB?.db){
          DB.juryScores[roomId]={};
          const snap=await window._FB.db.collection('juryScores').doc(roomId).collection('entries').get();
          snap.forEach(ed=>{const raw=ed.data();const j={};Object.keys(raw).forEach(k=>{if(k.startsWith('_'))return;if(raw[k]&&typeof raw[k]==='object')j[k]=raw[k];});DB.juryScores[roomId][ed.id]=j;});
        }
      }));
    }
    if(DB._jurorOrderCache)DB._jurorOrderCache={};
    if(typeof renderResults==='function')renderResults();
    if(typeof renderAdminResults==='function')renderAdminResults();
    if(typeof renderLiveResults==='function')renderLiveResults();
    if(typeof renderScoresPage==='function')renderScoresPage();
    showToast('已更新最新成績 ✓','ok');
  }catch(e){
    console.warn('[reloadJuryScores]',e);
    showToast('重新載入失敗','err');
  }
}
window.reloadJuryScores=reloadJuryScores;

// ════════════════════════════════════════════════
// 管理員：刪除某考場某評審的所有成績
// ════════════════════════════════════════════════
function updateDelJurorList(){
  const roomId=document.getElementById('del-juror-room')?.value||'';
  const jurorSel=document.getElementById('del-juror-id');
  if(!jurorSel)return;
  jurorSel.innerHTML='<option value="">— 選擇評審 —</option>';
  if(!roomId)return;

  // 蒐集此考場所有「實際有分數或評語」的評審
  const jurorMap={};// id -> {name, count}
  const fieldList=(typeof getRoomFields==='function'?getRoomFields(roomId):[{id:'scale'},{id:'assigned'},{id:'free'}]).map(f=>f.id);
  Object.entries(DB.juryScores[roomId]||{}).forEach(([entryKey,scores])=>{
    Object.entries(scores||{}).forEach(([jid,data])=>{
      if(jid.startsWith('_'))return;
      if(!data||typeof data!=='object')return;
      // ★ 只列出「有實際分數或評語」的評審（避免顯示已刪除但姓名殘留的舊評審）
      const SYS_KEYS=new Set(['comment','absent']);
      const hasScore=Object.keys(data).some(fk=>{
        if(fk.startsWith('_')||SYS_KEYS.has(fk))return false;
        const v=data[fk];
        return v!==undefined&&v!==''&&v!==null&&v!=='*';
      });
      const hasComment=data.comment&&String(data.comment).trim();
      if(!hasScore&&!hasComment)return;
      if(!jurorMap[jid]){jurorMap[jid]={name:data._jurorName||'',count:0};}
      jurorMap[jid].count++;
    });
  });

  const entries=Object.entries(jurorMap).sort(([a],[b])=>a.localeCompare(b));
  if(!entries.length){
    jurorSel.innerHTML='<option value="">（此考場尚無評分資料）</option>';
    return;
  }
  entries.forEach(([jid,{name,count}],idx)=>{
    const label=name?`評審${idx+1} — ${name}（${count} 筆）`:`評審${idx+1}（${count} 筆成績，無姓名）`;
    jurorSel.appendChild(new Option(label,jid));
  });
}
window.updateDelJurorList=updateDelJurorList;

// ★ 批次編輯：取得指定考場的考試名單（含 studentId/type/catId/instId 等）
function _getRoomEntries(roomId){
  const snap=DB.savedScheduleSnapshot||{};
  if(snap[roomId]&&snap[roomId].length){
    return snap[roomId].map(e=>({...e,roomId})).sort((a,b)=>(a.order||0)-(b.order||0));
  }
  return getScheduleEntries().filter(e=>e.roomId===roomId);
}
window._getRoomEntries=_getRoomEntries;

// ★ 批次編輯：依考場更新評審下拉（沿用 updateDelJurorList 的邏輯，但用獨立 id）
function updateBulkJuryList(){
  const roomId=document.getElementById('bulk-jury-room')?.value||'';
  const jurorSel=document.getElementById('bulk-jury-id');
  if(!jurorSel)return;
  jurorSel.innerHTML='<option value="">— 選擇評審 —</option>';
  if(!roomId)return;

  const jurorMap={};
  Object.entries(DB.juryScores[roomId]||{}).forEach(([entryKey,scores])=>{
    Object.entries(scores||{}).forEach(([jid,data])=>{
      if(jid.startsWith('_'))return;
      if(!data||typeof data!=='object')return;
      const SYS_KEYS=new Set(['comment','absent']);
      const hasScore=Object.keys(data).some(fk=>{
        if(fk.startsWith('_')||SYS_KEYS.has(fk))return false;
        const v=data[fk];
        return v!==undefined&&v!==''&&v!==null;
      });
      const hasComment=data.comment&&String(data.comment).trim();
      if(!hasScore&&!hasComment)return;
      if(!jurorMap[jid]){jurorMap[jid]={name:data._jurorName||'',count:0};}
      if(data._jurorName)jurorMap[jid].name=data._jurorName;
      jurorMap[jid].count++;
    });
  });

  const entries=Object.entries(jurorMap).sort(([a],[b])=>a.localeCompare(b));
  if(!entries.length){
    jurorSel.innerHTML='<option value="">（此考場尚無評分資料）</option>';
    return;
  }
  entries.forEach(([jid,{name,count}],idx)=>{
    const label=name?`評審${idx+1} — ${name}（${count} 筆）`:`評審${idx+1}（${count} 筆成績，無姓名）`;
    jurorSel.appendChild(new Option(label,jid));
  });
}
window.updateBulkJuryList=updateBulkJuryList;

// ★ 批次編輯：開啟 modal，列出此考場 × 此評審對所有學生的分數/評語
let _bulkJuryCtx={roomId:'',jurorId:'',entryKeys:[]};
function openBulkJuryEdit(){
  if(!requireRole('admin'))return;
  const roomId=document.getElementById('bulk-jury-room')?.value||'';
  const jurorId=document.getElementById('bulk-jury-id')?.value||'';
  if(!roomId){showToast('請先選擇考場','err');return;}
  if(!jurorId){showToast('請選擇評審','err');return;}

  const roomName=DB.rooms.find(r=>r.id===roomId)?.name||roomId;
  const jurorName=Object.values(DB.juryScores[roomId]||{}).map(s=>s?.[jurorId]?._jurorName).find(Boolean)||jurorId;
  document.getElementById('bulk-jury-modal-title').textContent=`批次編輯 — ${roomName} / ${jurorName}`;

  const entries=_getRoomEntries(roomId);
  const fields=getRoomFields(roomId);
  _bulkJuryCtx={roomId,jurorId,jurorName,entryKeys:entries.map(e=>e.studentId+'_'+e.type)};

  const rows=entries.map((e,i)=>{
    const entryKey=e.studentId+'_'+e.type;
    const s=DB.juryScores[roomId]?.[entryKey]?.[jurorId]||{};
    const cells=fields.map(f=>{
      const autoSkip=isFieldSkipped(f,e);
      const isSkipVal=s[f.id]==='*'||autoSkip;
      const val=isSkipVal?'':(s[f.id]||0);
      return `<td style="padding:4px;text-align:center">
        <input type="number" id="bj-${f.id}-${i}" value="${val}" min="0" max="99" step="0.5" ${autoSkip?'disabled title="管理員設定：此欄不適用此學生（不計分）"':''} style="width:56px;padding:4px;text-align:center;border:1px solid var(--border);border-radius:var(--r);${autoSkip?'opacity:.4':''}">
        <label style="display:flex;align-items:center;justify-content:center;gap:3px;font-size:9px;margin-top:2px;font-weight:normal">
          <input type="checkbox" id="bj-${f.id}-skip-${i}" style="width:auto" ${isSkipVal?'checked':''} ${autoSkip?'disabled':''} onchange="document.getElementById('bj-${f.id}-${i}').disabled=this.checked;document.getElementById('bj-${f.id}-${i}').style.opacity=this.checked?'.4':'1'">*
        </label>
      </td>`;
    }).join('');
    return `<tr>
      <td style="padding:4px 8px;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted)">${i+1}</td>
      <td style="padding:4px 8px;font-size:12px;white-space:nowrap">${e.class||''}/${e.seat||''}</td>
      <td style="padding:4px 8px;font-size:13px;white-space:nowrap">${e.name||''}</td>
      <td style="padding:4px 8px;font-size:11px;color:var(--muted);white-space:nowrap">${e.instName||''}（${typeName(e.type)}）</td>
      ${cells}
      <td style="padding:4px 8px"><input type="text" id="bj-comment-${i}" value="${(s.comment||'').replace(/"/g,'&quot;')}" placeholder="評語" style="width:160px;padding:4px 6px;border:1px solid var(--border);border-radius:var(--r);font-size:12px"></td>
    </tr>`;
  }).join('');

  const headCells=fields.map(f=>`<th style="padding:4px 8px;text-align:center;white-space:nowrap">${f.label}<br><span style="font-size:9px;color:var(--muted)">${f.pct}%</span></th>`).join('');

  document.getElementById('bulk-jury-modal-body').innerHTML=entries.length?`
    <table style="width:100%;border-collapse:collapse;font-family:'Noto Serif TC',serif">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="padding:4px 8px">序</th><th style="padding:4px 8px">班/座</th><th style="padding:4px 8px;text-align:left">姓名</th><th style="padding:4px 8px;text-align:left">樂器/別</th>
        ${headCells}
        <th style="padding:4px 8px">評語</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:8px">勾選「*」表示此項不計分；變灰且無法勾選的欄位為管理員規則自動排除。</p>
  `:'<p style="color:var(--muted);font-size:13px">此考場目前沒有排程資料</p>';

  openOverlay('bulk-jury-modal');
}
window.openBulkJuryEdit=openBulkJuryEdit;

// ★ 批次編輯：儲存全部修改，逐筆寫回 Firebase
async function saveBulkJuryEdit(){
  const {roomId,jurorId,jurorName,entryKeys}=_bulkJuryCtx;
  if(!roomId||!jurorId){closeOverlay('bulk-jury-modal');return;}
  const fields=getRoomFields(roomId);
  const clamp99=v=>{const n=parseFloat(v)||0;return Math.max(0,Math.min(99,n));};

  showToast('儲存中...','sync');
  let ok=0,fail=0;
  for(let i=0;i<entryKeys.length;i++){
    const entryKey=entryKeys[i];
    if(!DB.juryScores[roomId])DB.juryScores[roomId]={};
    if(!DB.juryScores[roomId][entryKey])DB.juryScores[roomId][entryKey]={};
    const s=DB.juryScores[roomId][entryKey][jurorId]||{};
    fields.forEach(f=>{
      const inp=document.getElementById(`bj-${f.id}-${i}`);
      if(!inp)return; // 此學生此欄被管理員規則排除（沒有輸入框）時不動原值
      const skipChk=document.getElementById(`bj-${f.id}-skip-${i}`);
      if(skipChk?.checked){s[f.id]='*';}
      else{s[f.id]=clamp99(inp.value);}
    });
    const commentInp=document.getElementById(`bj-comment-${i}`);
    if(commentInp)s.comment=commentInp.value||'';
    // ★ 修正：確保 _jurorName 一定存在，否則重新整理時會被「清除無姓名幽靈評審」誤刪
    if(!s._jurorName)s._jurorName=jurorName;
    s._localUpdatedAt=Date.now();
    DB.juryScores[roomId][entryKey][jurorId]=s;

    const patch={};patch[jurorId]={...s};
    try{
      const r=window._FB?await window._FB._set('juryScores/'+roomId+'/entries/'+entryKey,patch):false;
      if(r)ok++;else fail++;
    }catch(e){console.warn('[saveBulkJuryEdit]',entryKey,e);fail++;}
  }
  closeOverlay('bulk-jury-modal');
  renderResults();
  showToast(`已儲存 ${ok} 筆${fail?`，${fail} 筆同步失敗`:''} ✓`, fail?'warn':'ok');
}
window.saveBulkJuryEdit=saveBulkJuryEdit;

async function deleteJurorScores(){
  if(!requireRole('admin'))return;
  const roomId=document.getElementById('del-juror-room')?.value||'';
  const jurorId=document.getElementById('del-juror-id')?.value||'';
  if(!roomId){showToast('請先選擇考場','err');return;}
  if(!jurorId){showToast('請選擇要刪除的評審','err');return;}

  const roomName=DB.rooms.find(r=>r.id===roomId)?.name||roomId;
  const jurorName=DB.juryScores[roomId]
    ? Object.values(DB.juryScores[roomId]).filter(s=>s&&typeof s==='object').map(s=>s[jurorId]?._jurorName).find(Boolean)||jurorId
    : jurorId;

  const affected=Object.keys(DB.juryScores[roomId]||{}).filter(ek=>DB.juryScores[roomId][ek]?.[jurorId]);
  if(!affected.length){showToast('此評審在此考場沒有任何成績資料','warn');return;}

  if(!confirm(`確定要刪除「${roomName}」中「${jurorName}」的所有成績？\n\n共 ${affected.length} 位學生的成績將被刪除，此操作無法復原。`))return;
  if(!confirm(`⚠ 再次確認：永久刪除「${roomName}」—「${jurorName}」共 ${affected.length} 筆成績？`))return;

  if(DB._jurorOrderCache)delete DB._jurorOrderCache[roomId];
  showToast('正在刪除...','sync');

  const isRest=window._FB?._rest;
  const db=window._FB?.db;
  const st=window._FB?.serverTimestamp;
  let done=0;

  // ★ 改為 async：每筆都用「先刪除文件再寫入剩餘評審」確保乾淨
  for(const entryKey of affected){
    if(DB.juryScores[roomId]?.[entryKey]?.[jurorId]){
      delete DB.juryScores[roomId][entryKey][jurorId];
    }
    const remaining={...DB.juryScores[roomId][entryKey]};
    Object.keys(remaining).forEach(k=>{if(k.startsWith('_'))delete remaining[k];});

    try{
      if(Object.keys(remaining).length===0){
        // 如果該 entry 沒有剩餘評審，直接刪除整個文件
        if(isRest){
          await window._FB._delete('juryScores/'+roomId+'/entries/'+entryKey).catch(()=>{});
        } else if(db){
          await db.collection('juryScores').doc(roomId).collection('entries').doc(entryKey).delete();
        }
      } else {
        // 還有其他評審：完整覆寫文件（不用 merge，避免 jurorId 殘留）
        remaining._updatedAt=st?.()??new Date().toISOString();
        if(isRest){
          // REST 先刪除整個文件再 set，徹底清除舊欄位
          await window._FB._delete('juryScores/'+roomId+'/entries/'+entryKey).catch(()=>{});
          await window._FB._set('juryScores/'+roomId+'/entries/'+entryKey,remaining);
        } else if(db){
          await db.collection('juryScores').doc(roomId).collection('entries').doc(entryKey).set(remaining);
        }
      }
      done++;
    }catch(e){console.warn('[deleteJurorScores]',entryKey,e);}
  }

  // 推送 snapshot 版本，學生/教師下次登入會更新快取
  await publishSnapshot('scores');
  await publishSnapshot('comments');

  // 重置選單
  document.getElementById('del-juror-id').innerHTML='<option value="">— 選擇評審 —</option>';
  document.getElementById('del-juror-room').value='';

  // 重新渲染
  if(DB._jurorOrderCache)DB._jurorOrderCache={};
  renderResults();
  if(typeof renderAdminResults==='function')renderAdminResults();
  if(typeof renderLiveResults==='function')renderLiveResults();

  showToast(`已刪除「${roomName}」—「${jurorName}」共 ${done} 筆成績 ✓`,'ok');
}
window.deleteJurorScores=deleteJurorScores;

function renderResults(){
  const el=document.getElementById('results-body');if(!el)return;
  // ★ Bug7：每次渲染成績前清除評審排序快取，確保使用最新資料
  if(DB._jurorOrderCache)DB._jurorOrderCache={};
  const toggleBar=document.getElementById('jury-name-toggle-bar');
  if(toggleBar)toggleBar.style.display=(ST.role==='admin')?'block':'none';
  // ★ 需求4：管理員顯示發佈控制列
  const publishBar=document.getElementById('results-publish-bar');
  if(publishBar){
    publishBar.style.display=(ST.role==='admin')?'block':'none';
    if(ST.role==='admin')_updatePublishBarUI();
  }
  // ★ 管理員顯示刪除評審成績列，並更新考場下拉
  const delBar=document.getElementById('results-delete-juror-bar');
  if(delBar){
    delBar.style.display=(ST.role==='admin')?'block':'none';
    if(ST.role==='admin'){
      const delRoomSel=document.getElementById('del-juror-room');
      if(delRoomSel&&delRoomSel.options.length<=1){
        DB.rooms.forEach(r=>delRoomSel.appendChild(new Option(r.name,r.id)));
      }
    }
  }
  // ★ 批次編輯指定評審成績/評語列
  const bulkBar=document.getElementById('results-bulk-juror-bar');
  if(bulkBar){
    bulkBar.style.display=(ST.role==='admin')?'block':'none';
    if(ST.role==='admin'){
      const bulkRoomSel=document.getElementById('bulk-jury-room');
      if(bulkRoomSel&&bulkRoomSel.options.length<=1){
        DB.rooms.forEach(r=>bulkRoomSel.appendChild(new Option(r.name,r.id)));
      }
    }
  }
  const roomId=document.getElementById('result-room')?.value||'';
  const classF=document.getElementById('result-class')?.value||'';
  // 更新班級下拉
  const rcl=document.getElementById('result-class');
  if(rcl){const prev=rcl.value;while(rcl.options.length>1)rcl.remove(1);DB.classes.forEach(c=>rcl.appendChild(new Option(c,c)));if(DB.classes.includes(prev))rcl.value=prev;}

  // 班級彙整模式不需要先選考場
  if(_resultViewMode==='exam'&&!roomId&&!ST._remarkFilterOn){
    el.innerHTML='<p style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px;padding:14px">請選擇考場</p>';return;
  }

  // Helper: get all remarks
  const getEntryRemarks=(rId,entryKey)=>{
    const jd=DB.juryScores[rId]?.[entryKey]||{};
    const remarks=[];
    Object.values(jd).forEach(j=>{
      if(!j||typeof j!=='object')return;
      if(j._remark)remarks.push({label:j._remark,text:j._remarkText||'',jurorName:j._jurorName||''});
    });
    return remarks;
  };

  // ★ 修正：改從 savedScheduleSnapshot 取得 entries（含正確 roomId/order），
  //    fallback 到 getScheduleEntries（未存檔時）
  // ★ 進一步修正：若選定的考場沒有快照但有評分資料，用即時排程補上
  const snap=DB.savedScheduleSnapshot||{};
  const hasSnap=Object.values(snap).some(arr=>arr&&arr.length>0);
  let allSched=[];
  if(hasSnap){
    Object.entries(snap).forEach(([snapRoomId,snaps])=>{
      const room=DB.rooms.find(r=>r.id===snapRoomId);
      (snaps||[]).forEach(e=>{
        allSched.push({
          order:e.order,roomId:snapRoomId,
          roomName:e.roomName||(room?.name||snapRoomId),
          roomLocation:e.roomLocation||(room?.location||''),
          class:e.class,name:e.name,seat:e.seat,studentId:e.studentId,
          instId:e.instId,instName:e.instName,type:e.type,
          ac:e.ac||'',at:e.at||'',fc:e.fc||'',ft:e.ft||'',
          catId:e.catId||'',
        });
      });
    });
    // ★ 補上「沒存快照但有評分資料」的考場（避免成績卻看不到資料的窘境）
    const snapRoomIds=new Set(Object.keys(snap).filter(k=>snap[k]&&snap[k].length));
    const scoredRoomIds=Object.keys(DB.juryScores||{}).filter(rid=>{
      const entries=DB.juryScores[rid]||{};
      return Object.keys(entries).length>0;
    });
    const missingRoomIds=scoredRoomIds.filter(rid=>!snapRoomIds.has(rid));
    if(missingRoomIds.length){
      const liveAll=getScheduleEntries();
      missingRoomIds.forEach(rid=>{
        const liveEntries=liveAll.filter(e=>e.roomId===rid);
        liveEntries.forEach(e=>allSched.push(e));
      });
      console.warn('[renderResults] 偵測到無快照但有評分資料的考場：',missingRoomIds,'（已用即時排程補上）');
    }
  } else {
    allSched=getScheduleEntries();
  }

  let entries=[];
  if(ST._remarkFilterOn){
    if(roomId)allSched=allSched.filter(e=>e.roomId===roomId);
    if(classF)allSched=allSched.filter(e=>e.class===classF);
    entries=allSched.filter(e=>getEntryRemarks(e.roomId,e.studentId+'_'+e.type).length>0);
    if(!entries.length){el.innerHTML='<div style="padding:24px;text-align:center;font-family:\'DM Mono\',monospace;font-size:12px;color:var(--sage)">✓ 目前無任何備註記錄</div>';return;}
  } else if(_resultViewMode==='class'){
    if(roomId)allSched=allSched.filter(e=>e.roomId===roomId);
    if(classF)allSched=allSched.filter(e=>e.class===classF);
    entries=allSched.slice().sort((a,b)=>{
      const ci=DB.classes.indexOf(a.class)-DB.classes.indexOf(b.class);
      if(ci!==0)return ci;
      if(a.seat!==b.seat)return a.seat-b.seat;
      return {major:0,minor:1,elective:2}[a.type]-{major:0,minor:1,elective:2}[b.type];
    });
    if(!entries.length){el.innerHTML='<p style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:12px;padding:14px">無符合資料</p>';return;}
    _renderResultsByClass(el,entries,getEntryRemarks);return;
  } else {
    // 考場順序模式：從快照取得此考場的 entries，依 order 排序
    if(!roomId){el.innerHTML='<p style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:11px;padding:14px">請選擇考場</p>';return;}
    entries=allSched.filter(e=>e.roomId===roomId);
    if(classF)entries=entries.filter(e=>e.class===classF);
    entries=entries.slice().sort((a,b)=>(a.order||0)-(b.order||0));
    entries.forEach((e,i)=>e._resultOrder=i+1);
    console.log('[renderResults] roomId=',roomId,'classF=',classF||'(全部)','entries 數=',entries.length);
    if(!entries.length){el.innerHTML='<p style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:12px;padding:14px">此考場尚無符合資料</p>';return;}
  }

  el.innerHTML=entries.map((e,ei)=>{
    try{
      return _buildResultCard(e,ei,getEntryRemarks);
    }catch(err){
      console.error('[renderResults] entry 渲染失敗：',e,err);
      return `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--red);padding:12px 16px">
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--red);letter-spacing:1px">⚠ 此筆資料渲染失敗</div>
        <div style="margin-top:6px;font-size:13px">${escHtml(e.name||'?')} ・ ${escHtml(e.class||'?')}・座${escHtml(e.seat||'?')}</div>
        <div style="margin-top:4px;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted)">錯誤：${escHtml(String(err.message||err))}</div>
      </div>`;
    }
  }).join('');
}

// ── 班級彙整模式渲染 ──
function _renderResultsByClass(el,entries,getEntryRemarks){
  // 依班級分組
  const classGroups={};
  entries.forEach(e=>{
    if(!classGroups[e.class])classGroups[e.class]={major:[],minor:[],elective:[]};
    classGroups[e.class][e.type].push(e);
  });
  const targetClasses=DB.classes.filter(c=>classGroups[c]);
  let html='';
  targetClasses.forEach(cls=>{
    const g=classGroups[cls];
    html+=`<div style="margin-bottom:28px">
      <div style="background:var(--ink);color:var(--gold);padding:10px 18px;border-radius:var(--r);display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="font-family:Cormorant Garamond,serif;font-size:22px;font-weight:300">${cls}</span>
        <span style="font-family:DM Mono,monospace;font-size:9px;letter-spacing:2px;opacity:.6">${g.major.length+g.minor.length+g.elective.length} 筆</span>
      </div>`;
    // 主修
    if(g.major.length){
      html+=`<div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 12px;background:#fff3e0;border-left:4px solid var(--gold);border-radius:0 var(--r) var(--r) 0">
          <span class="badge b-major">主修</span>
          <span style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted)">${g.major.length} 人</span>
        </div>`;
      g.major.forEach((e,ei)=>{try{html+=_buildResultCard(e,ei,getEntryRemarks,true);}catch(err){console.error('[byClass major]',e,err);html+='<div class="card" style="border-left:3px solid var(--red);padding:8px 12px;margin-bottom:8px"><span style="font-size:11px;color:var(--red)">⚠ 渲染失敗：'+(e.name||'?')+'</span></div>';}});
      html+='</div>';
    }
    // 副修
    if(g.minor.length){
      html+=`<div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 12px;background:#e3f2fd;border-left:4px solid var(--steel);border-radius:0 var(--r) var(--r) 0">
          <span class="badge b-minor">副修</span>
          <span style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted)">${g.minor.length} 人</span>
        </div>`;
      g.minor.forEach((e,ei)=>{try{html+=_buildResultCard(e,ei,getEntryRemarks,true);}catch(err){console.error('[byClass minor]',e,err);html+='<div class="card" style="border-left:3px solid var(--red);padding:8px 12px;margin-bottom:8px"><span style="font-size:11px;color:var(--red)">⚠ 渲染失敗：'+(e.name||'?')+'</span></div>';}});
      html+='</div>';
    }
    // 選修
    if(g.elective.length){
      html+=`<div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 12px;background:#e8f5e9;border-left:4px solid var(--sage);border-radius:0 var(--r) var(--r) 0">
          <span class="badge b-elective">選修</span>
          <span style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted)">${g.elective.length} 人</span>
        </div>`;
      g.elective.forEach((e,ei)=>{try{html+=_buildResultCard(e,ei,getEntryRemarks,true);}catch(err){console.error('[byClass elective]',e,err);html+='<div class="card" style="border-left:3px solid var(--red);padding:8px 12px;margin-bottom:8px"><span style="font-size:11px;color:var(--red)">⚠ 渲染失敗：'+(e.name||'?')+'</span></div>';}});
      html+='</div>';
    }
    html+='</div>';
  });
  el.innerHTML=html;
}

// ── 單張成績卡（考場順序 & 班級彙整共用）──
function _buildResultCard(e,ei,getEntryRemarks,showRoom){
  const useRoomId=e.roomId;
  const entryKey=e.studentId+'_'+e.type;
  const jurorData=DB.juryScores[useRoomId]?.[entryKey]||{};
  const scoreArr=_safeJurors(jurorData);
  const result=scoreArr.length?calcFinal(scoreArr,useRoomId,e):{finalScore:null,fS:null,fA:null,fF:null,fieldAvgs:{},detail:{}};
  const ded=DB.deductions[entryKey]||{amount:0,reason:''};
  const finalWithDed=result.finalScore!==null?Math.max(0,result.finalScore-(ded.amount||0)):null;
  const isBlack=!!(DB.blackSign[useRoomId]?.[entryKey]);
  const remarksList=getEntryRemarks(useRoomId,entryKey);
  const hasRemarks=remarksList.length>0;
  // ★ 問題1 修正：評審清單統一使用考場全域清單，並過濾幽靈評審
  const _getConsistentJurorIds=(roomId,_jData)=>{
    if(!DB._jurorOrderCache)DB._jurorOrderCache={};
    if(!DB._jurorOrderCache[roomId]){
      const validIds=new Set();
      const fieldList=(typeof getRoomFields==='function'?getRoomFields(roomId):[{id:'scale'},{id:'assigned'},{id:'free'}]).map(f=>f.id);
      Object.values(DB.juryScores[roomId]||{}).filter(e=>e&&typeof e==='object').forEach(entry=>{
        Object.entries(entry||{}).forEach(([k,data])=>{
          if(k.startsWith('_'))return;
          if(!data||typeof data!=='object')return;
          // ★ 必須「有實際分數或評語」才納入（光有姓名不算，因為刪除分數後姓名可能殘留）
          // ★ 條件：有姓名 OR 有實際分數 OR 有評語 才算有效評審
          //   有姓名但沒分數的：可能是剛登入未打分的評審，仍需顯示在欄位（顯示「未評」）
          //   光是 null 或無姓名無分數的幽靈才會被過濾
          const SYS_KEYS=new Set(['comment','absent']);
          const hasName=data._jurorName&&String(data._jurorName).trim();
          const hasScore=Object.keys(data).some(fk=>{
            if(fk.startsWith('_')||SYS_KEYS.has(fk))return false;
            const v=data[fk];
            return v!==undefined&&v!==''&&v!==null&&v!=='*';
          });
          const hasComment=data.comment&&String(data.comment).trim();
          if(hasName||hasScore||hasComment)validIds.add(k);
        });
      });
      DB._jurorOrderCache[roomId]=[...validIds].sort();
    }
    return DB._jurorOrderCache[roomId];
  };
  const jurorIds=_getConsistentJurorIds(useRoomId,jurorData);
  const buildJurorRows=(field)=>{
    return jurorIds.map((jid,ji)=>{
      const s=jurorData[jid];
      // ★ 該評審未評分此學生：顯示「未評」並淡化（保持可讀）
      if(!s){
        return `<div class="rjs-item" style="opacity:.7">
          <span style="color:var(--ink)">評審 ${ji+1}</span>
          <span style="color:var(--muted);font-size:11px;font-weight:600">— 未評 —</span>
        </div>`;
      }
      const isSkip=s[field]==='*'||s[field+'_skip']===true;
      const val=s.absent?0:(isSkip?null:parseFloat(s[field])||0);
      const isRemoved=!isSkip&&result.detail?.[field]?.removed?.includes(val);
      const jurorLabel=(ST.role==='admin'&&_showRealJurorNames&&s._jurorName)?('評審 '+(ji+1)+' ('+s._jurorName+')'): ('評審 '+(ji+1));
      return `<div class="rjs-item ${isRemoved?'rjs-removed':''}">
        <span style="color:var(--muted)">${jurorLabel}</span>
        <span class="${(!isSkip&&val!==null&&val<60)?'red-score':''}">
          ${s.absent?'缺考':(isSkip?'<span style="color:var(--orange);font-weight:700">＊未評</span>':val.toFixed(1))}
        </span>
      </div>`;
    }).join('');
  };
  return `<div class="card ${hasRemarks?'has-remark-card':''}" style="margin-bottom:10px;${hasRemarks?'border-left:3px solid var(--rust);':''}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--muted);min-width:28px">
        ${_resultViewMode==='exam'?String(e._resultOrder||e.order||ei+1).padStart(2,'0'):(String(ei+1).padStart(2,'0'))}
      </div>
      <div>
        <strong style="font-size:15px">${e.name}</strong>
        <span style="color:var(--muted);font-size:12px;margin-left:6px">${e.class}·座${e.seat}</span>
        ${isBlack?'<span style="display:inline-block;margin-left:8px;background:#8b6914;color:#fff;padding:1px 8px;border-radius:10px;font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px">★ 黑簽全曲</span>':''}
      </div>
      <div style="color:var(--muted);font-size:12px">${e.instName}</div>
      ${typeBadge(e.type)}
      ${showRoom||ST._remarkFilterOn?`<span style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted);margin-left:4px">${e.roomName}</span>`:''}
      <div style="margin-left:auto;text-align:right">
        ${result.finalScore!==null?`<div style="font-family:Cormorant Garamond,serif;font-size:28px;color:var(--gold)" class="${finalWithDed<60?'red-score':''}">${finalWithDed!==null?finalWithDed.toFixed(2):'—'}</div><div style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted)">最終成績</div>`:'<div style="font-family:\'DM Mono\',monospace;font-size:11px;color:var(--muted)">尚無評分</div>'}
      </div>
    </div>
    ${hasRemarks?`<div class="remark-display">
      <div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;margin-bottom:6px;color:var(--red)">⚠ 評審備註（疑似需扣分）</div>
      ${remarksList.map((r,ri)=>`<div style="margin-bottom:${ri<remarksList.length-1?'6px':'0'}">
        ${r.jurorName?`<span style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted)">${r.jurorName}：</span>`:''}
        <strong>${r.label}</strong>${r.text?`<span style="font-size:12px;color:var(--rust)"> — ${r.text}</span>`:''}
      </div>`).join('')}
    </div>`:''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
      ${getRoomFields(useRoomId).map(f=>{
        const avg=result.fieldAvgs?.[f.id]??null;
        return `<div>
          <div style="font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:2px;color:var(--gold);margin-bottom:6px">${f.label} <span style="opacity:.5">${f.pct}%</span><span style="color:var(--muted);margin-left:8px">${avg!==null?'平均 '+avg.toFixed(1):''}</span></div>
          ${buildJurorRows(f.id)}
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:10px">
      <div class="comment-folder">
        <div class="comment-folder-h" onclick="this.nextElementSibling.classList.toggle('open');this.querySelector('.cf-arrow').textContent=this.nextElementSibling.classList.contains('open')?'▲':'▼'">
          <span>評語彙整（共 ${jurorIds.length} 位評審）</span><span class="cf-arrow">▼</span>
        </div>
        <div class="comment-folder-b">
          ${jurorIds.map((jid,ji)=>{
            const s=jurorData[jid];
            if(!s)return '';
            const nameTag=(ST.role==='admin'&&_showRealJurorNames&&s._jurorName)?'評審 '+(ji+1)+' ('+s._jurorName+')':'評審 '+(ji+1);
            return s.comment?`<div style="margin-bottom:8px;padding:8px 10px;background:var(--cream);border-radius:var(--r)"><div style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted);margin-bottom:4px">${escHtml(nameTag)}</div><div style="font-size:13px;line-height:1.8;white-space:pre-wrap">${escHtml(s.comment)}</div></div>`:'';
          }).join('')||'<div style="color:var(--muted);font-size:12px">尚無評語</div>'}
        </div>
      </div>
    </div>
    <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--cream)">
      <span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted)">扣分</span>
      <input type="number" value="${ded.amount||0}" min="0" step="0.5" style="width:70px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--r);font-family:\'DM Mono\',monospace;font-size:13px;outline:none" onchange="DB.deductions['${entryKey}']={...DB.deductions['${entryKey}']||{},amount:+this.value};renderResults();fbSet('deductions','${entryKey}',DB.deductions['${entryKey}']||{})">
      <input type="text" value="${ded.reason||''}" placeholder="扣分原因..." style="flex:1;padding:5px 10px;border:1px solid var(--border);border-radius:var(--r);font-size:13px;outline:none" onchange="DB.deductions['${entryKey}']={...DB.deductions['${entryKey}']||{},reason:this.value};fbSet('deductions','${entryKey}',DB.deductions['${entryKey}']||{})">
      <button class="btn btn-o btn-xs" onclick="editJuryScores('${useRoomId}','${entryKey}','${e.name}')">✏ 修改評分</button>
    </div>
  </div>`;
}

function editJuryScores(roomId,entryKey,studentName){
  const jurorData=DB.juryScores[roomId]?.[entryKey]||{};
  document.getElementById('edit-modal-title').textContent='修改評分 — '+studentName;
  const jurorIds=Object.keys(jurorData);
  const fieldRow=(jid,ji,fid,label,s)=>{
    const isSkip=s[fid]==='*';
    const val=isSkip?'':(s[fid]||0);
    return `<div class="fg" style="min-width:110px;flex:0 0 auto">
      <label>${label}</label>
      <input type="number" id="ej-${fid}-${ji}" value="${val}" min="0" max="99" step="0.5" ${isSkip?'disabled':''} style="${isSkip?'opacity:.4':''}">
      <label style="display:flex;align-items:center;gap:4px;margin-top:3px;font-size:11px;font-weight:normal;font-family:\'Noto Serif TC\',serif;letter-spacing:normal;text-transform:none;color:var(--ink);white-space:nowrap">
        <input type="checkbox" id="ej-${fid}-skip-${ji}" style="width:auto" ${isSkip?'checked':''} onchange="document.getElementById('ej-${fid}-${ji}').disabled=this.checked;document.getElementById('ej-${fid}-${ji}').style.opacity=this.checked?'.4':'1'">
        不計分（*）
      </label>
    </div>`;
  };
  document.getElementById('edit-modal-body').innerHTML=jurorIds.length?
    jurorIds.map((jid,ji)=>{const s=jurorData[jid];return `<div style="padding:10px;background:var(--cream);border-radius:var(--r);margin-bottom:8px">
      <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:8px">評審 ${ji+1}${s._jurorName?'：'+s._jurorName:''} ${s.absent?'（缺考）':''}</div>
      <div class="fr">
        ${fieldRow(jid,ji,'scale','音階',s)}
        ${fieldRow(jid,ji,'assigned','指定曲',s)}
        ${fieldRow(jid,ji,'free','自選曲',s)}
      </div>
      <div class="fg" style="margin-top:8px"><label>評語</label><textarea id="ej-comment-${ji}" rows="2" style="width:100%;font-size:12px;padding:6px;border:1px solid var(--border);border-radius:var(--r);font-family:inherit">${s.comment||''}</textarea></div>
    </div>`;}).join('')
    :'<p style="color:var(--muted);font-size:13px">尚無評審資料</p>';
  document.getElementById('edit-modal-save').onclick=async ()=>{
    // ★ 分數上限 99 分 — clamp 防止 paste 或手動輸入超過 99
    const clamp99=v=>{const n=parseFloat(v)||0;return Math.max(0,Math.min(99,n));};
    const patch={};
    jurorIds.forEach((jid,ji)=>{
      const s=DB.juryScores[roomId][entryKey][jid];
      ['scale','assigned','free'].forEach(fid=>{
        const skipped=document.getElementById(`ej-${fid}-skip-${ji}`)?.checked;
        s[fid]=skipped?'*':clamp99(document.getElementById(`ej-${fid}-${ji}`)?.value);
      });
      s.comment=document.getElementById(`ej-comment-${ji}`)?.value||'';
      s._localUpdatedAt=Date.now();
      patch[jid]={...s};
    });
    closeOverlay('edit-modal');renderResults();
    // ★ 寫回 Firebase，否則重新整理後修改會消失
    if(window._FB){
      const ok=await window._FB._set('juryScores/'+roomId+'/entries/'+entryKey, patch);
      showToast(ok?'評分已更新並同步 ✓':'評分已更新，但同步失敗（請檢查連線）','warn');
    }else{
      showToast('評分已更新（本機）','ok');
    }
  };
  openOverlay('edit-modal');
}

function exportResultsCSV(allClasses){
  const roomId=document.getElementById('result-room')?.value||'';
  const classF=allClasses?'':(document.getElementById('result-class')?.value||'');
  // ★ Bug5 修正：優先從已存檔快照取得 entries（與 renderResults 邏輯一致）
  //   避免重新整理後 SCH_STATE 被重設導致 getScheduleEntries 回傳空陣列
  const snap=DB.savedScheduleSnapshot||{};
  const hasSnap=Object.values(snap).some(arr=>arr&&arr.length>0);
  let allSched=[];
  if(hasSnap){
    Object.entries(snap).forEach(([snapRoomId,snaps])=>{
      const room=DB.rooms.find(r=>r.id===snapRoomId);
      (snaps||[]).forEach(e=>allSched.push({
        ...e,
        roomId:snapRoomId,
        roomName:e.roomName||(room?.name||snapRoomId),
      }));
    });
    allSched.sort((a,b)=>{
      const ri=DB.rooms.findIndex(r=>r.id===a.roomId)-DB.rooms.findIndex(r=>r.id===b.roomId);
      return ri!==0?ri:(a.order||0)-(b.order||0);
    });
  } else {
    allSched=getScheduleEntries();
  }
  let entries=allSched;
  if(roomId)entries=entries.filter(e=>e.roomId===roomId);
  if(classF)entries=entries.filter(e=>e.class===classF);
  if(!entries.length){showToast('無資料可匯出，請確認已選擇考場或排程已存檔','err');return;}
  const data=entries.map((e,i)=>{
    const entryKey=e.studentId+'_'+e.type;
    const rId=e.roomId;
    const jurorData=DB.juryScores[rId]?.[entryKey]||{};
    const scoreArr=_safeJurors(jurorData);
    // ★ 修正：傳入 entry(e)，讓 calcFinal 能正確處理 * 不計分欄位的權重重分配
    const result=scoreArr.length?calcFinal(scoreArr,rId,e):{finalScore:null,fS:null,fA:null,fF:null};
    const ded=DB.deductions[entryKey]||{amount:0,reason:''};
    const finalWithDed=result.finalScore!==null?Math.max(0,result.finalScore-(ded.amount||0)):null;
    const isAbsent=scoreArr.some(s=>s.absent);
    return {'序':i+1,'考場':e.roomName,'班級':e.class,'座號':e.seat,'姓名':e.name,'樂器':e.instName,'別':typeName(e.type),
      '音階平均':isAbsent?0:(result.fS?.toFixed(1)||''),
      '指定曲平均':isAbsent?0:(result.fA?.toFixed(1)||''),
      '自選曲平均':isAbsent?0:(result.fF?.toFixed(1)||''),
      '術科成績':isAbsent?0:(result.finalScore?.toFixed(2)||''),
      '扣分':ded.amount||0,'扣分原因':ded.reason||'',
      '最終成績':isAbsent?0:(finalWithDed?.toFixed(2)||''),
    };
  });
  const fname=(classF?classF+'_':'')+(roomId?(DB.rooms.find(r=>r.id===roomId)?.name||'')+'_':'')+'術科成績';
  exportCSV(data,fname);
}

// ════════════════════════════════════════════════
// ★ 彙整成績下載：按班級、按學生（一位學生一筆）
//   欄位：座號 / 姓名 / 主修細項 / 副修細項 / 選修細項 /
//         主修總成績 / 副修總成績 / 選修總成績 /
//         主修平時成績 / 副修平時成績 / 選修平時成績 /
//         主修平時評語 / 副修平時評語 / 選修平時評語
// ════════════════════════════════════════════════
function openExportSummaryModal(){
  // 蒐集現有班級
  const classSet=new Set();
  DB.users.filter(u=>u.role==='student').forEach(s=>{if(s.class)classSet.add(s.class);});
  const classList=[...classSet].sort();
  if(!classList.length){showToast('找不到任何班級資料','err');return;}

  // 動態建一個簡單 modal（不重複用既有 edit-modal 以免衝突）
  let modal=document.getElementById('export-summary-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='export-summary-modal';
    modal.className='overlay';
    modal.innerHTML=`<div class="modal" style="max-width:520px">
      <div class="modal-h"><span>📑 彙整成績下載</span><button class="modal-x" onclick="closeOverlay('export-summary-modal')">✕</button></div>
      <div style="padding:8px 0 14px;font-size:13px;color:var(--muted);line-height:1.7">
        每位學生一列，包含座號、姓名、主修／副修／選修的<strong style="color:var(--ink)">樂器細項、總成績（術科最終分）、平時成績、平時評語</strong>。
      </div>
      <div class="lf">
        <label style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--muted);text-transform:uppercase">下載班級</label>
        <select id="export-summary-class" style="padding:7px 12px;border:1px solid var(--border);background:var(--paper);font-family:Noto Serif TC,serif;font-size:14px;outline:none;border-radius:var(--r);width:100%">
          <option value="__all_zip__">全部班級（ZIP，每班一個 CSV 檔）</option>
          <option value="__all_one__">全部班級（合併在一個 CSV）</option>
          <optgroup label="—— 單一班級 ——">
          ${classList.map(c=>`<option value="${c}">${c}</option>`).join('')}
          </optgroup>
        </select>
      </div>
      <div class="modal-ft" style="margin-top:14px">
        <button class="btn btn-s" onclick="closeOverlay('export-summary-modal')">取消</button>
        <button class="btn btn-p" onclick="doExportSummary()">↓ 下載</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
  } else {
    // 重整班級列表（避免快取舊資料）
    const sel=modal.querySelector('#export-summary-class');
    if(sel){
      sel.innerHTML=`<option value="__all_zip__">全部班級（ZIP，每班一個 CSV 檔）</option>
        <option value="__all_one__">全部班級（合併在一個 CSV）</option>
        <optgroup label="—— 單一班級 ——">
        ${classList.map(c=>`<option value="${c}">${c}</option>`).join('')}
        </optgroup>`;
    }
  }
  openOverlay('export-summary-modal');
}
window.openExportSummaryModal=openExportSummaryModal;

// ════════════════════════════════════════════════
// ★ 家長用圖檔式成績單（每位學生一張 A4，列印/存PDF）
// ════════════════════════════════════════════════
// ════════════════════════════════════════════════
// ★ 師生修別對照確認：只列出有疑慮的（多人待確認／無法判定），可手動指定並儲存
// ════════════════════════════════════════════════
function _collectAmbiguousMatches(){
  // 回傳需要人工確認的清單
  const list=[];
  const students=DB.users.filter(u=>u.role==='student');
  students.forEach(u=>{
    ['major','minor','elective'].forEach(tp=>{
      if(!u[tp])return;
      const info=_resolveTeacherForType(u.id, u[tp], tp);
      // override / unique / override-none 視為已確認，不列出
      if(info.confidence==='multi'||info.confidence==='none'){
        list.push({
          studentId:u.id, name:u.name, class:u.class||'', seat:u.seat||'',
          type:tp, typeName:typeName(tp), instId:u[tp], instName:iname(u[tp]),
          confidence:info.confidence, candidates:info.names,
        });
      }
    });
  });
  // 排序：班級 → 座號 → 修別
  const tpOrder={major:0,minor:1,elective:2};
  list.sort((a,b)=>{
    const c=(a.class||'').localeCompare(b.class||'','zh-TW-u-co-stroke'); if(c)return c;
    const s=(parseInt(a.seat)||0)-(parseInt(b.seat)||0); if(s)return s;
    return tpOrder[a.type]-tpOrder[b.type];
  });
  return list;
}

function openTeacherMatchModal(){
  if(!requireRole('admin'))return;
  let modal=document.getElementById('teacher-match-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.className='overlay'; modal.id='teacher-match-modal';
    document.body.appendChild(modal);
  }
  _renderTeacherMatchModal(modal);
  openOverlay('teacher-match-modal');
}
window.openTeacherMatchModal=openTeacherMatchModal;

function _renderTeacherMatchModal(modal){
  modal=modal||document.getElementById('teacher-match-modal');
  if(!modal)return;
  const items=_collectAmbiguousMatches();
  const allTeachers=DB.users.filter(u=>u.role==='teacher').slice()
    .sort((a,b)=>a.name.localeCompare(b.name,'zh-TW-u-co-stroke'));

  const rowHtml=items.map((it,i)=>{
    // 指導這位學生的老師（預設下拉只列這些）
    const myTeacherIds=Object.keys(DB.teacherStudents||{}).filter(tid=>(DB.teacherStudents[tid]||[]).includes(it.studentId));
    const myTeachers=myTeacherIds.map(tid=>DB.users.find(u=>u.id===tid)).filter(Boolean);
    const ov=DB.teacherTypeOverrides?.[it.studentId+'_'+it.type];
    const curVal = ov?(ov.none?'__none__':(ov.teacherName||'')):'';
    const badge = it.confidence==='multi'
      ? `<span style="background:rgba(181,137,42,.18);color:var(--gold);font-size:9px;padding:2px 7px;border-radius:10px;font-family:'DM Mono',monospace">⚠ 多人待確認</span>`
      : `<span style="background:rgba(122,39,24,.12);color:var(--rust);font-size:9px;padding:2px 7px;border-radius:10px;font-family:'DM Mono',monospace">— 無法判定</span>`;
    const candText = it.candidates.length?`候選：${escHtml(it.candidates.join('、'))}`:'（指導老師中無人專長符合）';
    // 下拉：預設只列「有指導該生的老師」+ 已選 override（若不在清單內也補上）
    const optList=[...myTeachers];
    if(ov&&ov.teacherName&&!optList.some(t=>t.name===ov.teacherName)){
      const extra=allTeachers.find(t=>t.name===ov.teacherName); if(extra)optList.push(extra);
    }
    const opts=`<option value="">— 請選擇 —</option>`+
      optList.map(t=>`<option value="${escHtml(t.name)}" ${curVal===t.name?'selected':''}>${escHtml(t.name)}</option>`).join('')+
      `<option value="__none__" ${curVal==='__none__'?'selected':''}>（此修別無指導老師）</option>`;
    const allOpts=`<option value="">— 全部老師 —</option>`+
      allTeachers.map(t=>`<option value="${escHtml(t.name)}" ${curVal===t.name?'selected':''}>${escHtml(t.name)}</option>`).join('');
    return `<tr data-i="${i}" data-sid="${it.studentId}" data-type="${it.type}" style="border-bottom:1px solid var(--border)">
      <td style="padding:7px 8px;white-space:nowrap"><strong>${escHtml(it.name)}</strong><br><span style="font-size:10px;color:var(--muted)">${escHtml(it.class)}·座${escHtml(String(it.seat))}</span></td>
      <td style="padding:7px 8px;white-space:nowrap"><span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--gold)">${escHtml(it.typeName)}</span> ${escHtml(it.instName)}</td>
      <td style="padding:7px 8px">${badge}<div style="font-size:10px;color:var(--muted);margin-top:3px">${candText}</div></td>
      <td style="padding:7px 8px">
        <select class="tm-sel" style="min-width:150px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--r);font-size:12px">${opts}</select>
        <label style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--muted);margin-top:3px"><input type="checkbox" class="tm-all" style="width:auto" onchange="_tmToggleAll(this,${i})"> 顯示全部老師</label>
        <select class="tm-sel-all" style="display:none;min-width:150px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--r);font-size:12px;margin-top:3px">${allOpts}</select>
      </td>
    </tr>`;
  }).join('');

  modal.innerHTML=`
    <div class="modal" style="max-width:820px">
      <div class="modal-h"><span>🔎 師生對照確認（僅列出有疑慮項目）</span><button class="modal-x" onclick="closeOverlay('teacher-match-modal')">✕</button></div>
      <div style="padding:2px 2px 10px">
        <p style="font-size:12px;color:var(--muted);line-height:1.7;margin-bottom:10px">
          以下是系統<strong>無法自動確定</strong>指導老師的項目（唯一命中的已自動採用、不列於此）。請為每筆指定正確老師，或標記「此修別無指導老師」。儲存後成績單將優先採用您的指定。
        </p>
        ${items.length?`
        <div style="max-height:50vh;overflow:auto;border:1px solid var(--border);border-radius:var(--r)">
          <table style="width:100%;border-collapse:collapse;font-family:'Noto Serif TC',serif">
            <thead><tr style="background:var(--ink);color:var(--paper);position:sticky;top:0">
              <th style="padding:7px 8px;text-align:left;font-size:11px">學生</th>
              <th style="padding:7px 8px;text-align:left;font-size:11px">修別／樂器</th>
              <th style="padding:7px 8px;text-align:left;font-size:11px">狀態</th>
              <th style="padding:7px 8px;text-align:left;font-size:11px">指定指導老師</th>
            </tr></thead>
            <tbody>${rowHtml}</tbody>
          </table>
        </div>`
        :'<div style="text-align:center;padding:30px;color:var(--sage);font-size:14px">✓ 沒有需要確認的項目，所有修別都已自動對應到唯一的指導老師。</div>'}
      </div>
      <div class="modal-ft">
        <button class="btn btn-s" onclick="closeOverlay('teacher-match-modal')">關閉</button>
        ${items.length?'<button class="btn btn-p" onclick="saveTeacherMatches()">💾 儲存指定</button>':''}
      </div>
    </div>`;
}

// 切換「顯示全部老師」下拉
function _tmToggleAll(chk, i){
  const tr=chk.closest('tr');
  const sel=tr.querySelector('.tm-sel');
  const selAll=tr.querySelector('.tm-sel-all');
  if(chk.checked){ sel.style.display='none'; selAll.style.display=''; }
  else { sel.style.display=''; selAll.style.display='none'; }
}
window._tmToggleAll=_tmToggleAll;

async function saveTeacherMatches(){
  if(!requireRole('admin'))return;
  const rows=document.querySelectorAll('#teacher-match-modal tbody tr');
  let saved=0, fail=0;
  showToast('儲存中...','sync');
  for(const tr of rows){
    const sid=tr.dataset.sid, type=tr.dataset.type;
    const useAll=tr.querySelector('.tm-all')?.checked;
    const val=(useAll?tr.querySelector('.tm-sel-all'):tr.querySelector('.tm-sel'))?.value||'';
    const key=sid+'_'+type;
    if(!val){ // 未指定 → 移除既有 override（回到自動判斷）
      if(DB.teacherTypeOverrides[key]){
        delete DB.teacherTypeOverrides[key];
        try{ await (window._FB?window._FB._delete('teacherTypeOverrides/'+key):Promise.resolve()); }catch(e){}
      }
      continue;
    }
    const rec = val==='__none__' ? {none:true} : {teacherName:val};
    DB.teacherTypeOverrides[key]=rec;
    try{
      const ok=window._FB?await window._FB._set('teacherTypeOverrides/'+key, {...rec, _updatedAt:new Date().toISOString()}):true;
      if(ok)saved++; else fail++;
    }catch(e){console.warn('[saveTeacherMatches]',key,e);fail++;}
  }
  showToast(`已儲存 ${saved} 筆指定${fail?`，${fail} 筆失敗`:' ✓'}`, fail?'warn':'ok');
  // 重新渲染（已確認的會從清單消失）
  _renderTeacherMatchModal();
}
window.saveTeacherMatches=saveTeacherMatches;

function openReportCardModal(){
  if(!requireRole('admin'))return;
  let modal=document.getElementById('report-card-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.className='overlay';
    modal.id='report-card-modal';
    modal.innerHTML=`
      <div class="modal" style="max-width:520px">
        <div class="modal-h"><span>🎓 成績單下載（家長用）</span><button class="modal-x" onclick="closeOverlay('report-card-modal')">✕</button></div>
        <div style="padding:4px 2px 12px">
          <p style="font-size:13px;color:var(--muted);line-height:1.8;margin-bottom:12px">
            產生每位學生一張 A4 的成績單，內容包含：班級・姓名・座號、各修別樂器、<strong>平時評語</strong>（不含平時成績）、<strong>現場評分總成績與評審評語</strong>，若有違規扣分會顯示扣分原因。<br>
            開啟後可用瀏覽器「列印 → 另存為 PDF」整批下載。
          </p>
          <div class="fg" style="margin-bottom:10px">
            <label>選擇班級</label>
            <select id="rc-class-sel" style="width:100%"></select>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);margin-bottom:4px">
            <input type="checkbox" id="rc-only-published" style="width:auto"> 僅產生已發佈成績（未發佈者不顯示分數，只顯示評語）
          </label>
        </div>
        <div class="modal-ft">
          <button class="btn btn-s" onclick="closeOverlay('report-card-modal')">取消</button>
          <button class="btn btn-p" onclick="generateReportCards()">🎓 產生成績單</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  // 填入班級選項
  const sel=modal.querySelector('#rc-class-sel');
  const classes=[...new Set(DB.users.filter(u=>u.role==='student'&&u.class).map(u=>u.class))]
    .sort((a,b)=>a.localeCompare(b,'zh-TW-u-co-stroke'));
  sel.innerHTML='<option value="__all__">全部班級</option>'+classes.map(c=>`<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  openOverlay('report-card-modal');
}
window.openReportCardModal=openReportCardModal;

// 組出單一學生的成績單資料（與學生端「我的成績」走相同資料路徑）
// ★ 交叉比對：判斷某學生某修別的指導老師
//   邏輯：在「指導這位學生的老師」中，找專長樂器符合該修別樂器的老師
//   人工指定（teacherTypeOverrides）優先；回傳 {names:[...], confidence:'override'|'unique'|'multi'|'none'|'override-none'}
function _resolveTeacherForType(studentId, instId, type){
  // ① 人工指定優先
  if(type){
    const ov=DB.teacherTypeOverrides?.[studentId+'_'+type];
    if(ov){
      if(ov.none)return {names:[], confidence:'override-none'};
      if(ov.teacherName)return {names:[ov.teacherName], confidence:'override'};
    }
  }
  // 哪些老師指導這位學生
  const teacherIds=Object.keys(DB.teacherStudents||{}).filter(tid=>(DB.teacherStudents[tid]||[]).includes(studentId));
  const teacherObjs=teacherIds.map(tid=>DB.users.find(u=>u.id===tid&&u.role==='teacher')).filter(Boolean);

  // ② 專長比對：在「指導這位學生的老師」中，找專長樂器符合該修別樂器（或其大項）的老師
  if(instId){
    const item=(DB.instruments.items||[]).find(i=>i.id===instId);
    const catId=item?.cat||'';
    const matched=teacherObjs.filter(t=>{
      const specs=t.specialtyInsts||[];
      return specs.some(s=>s===instId||(catId&&s===catId));
    }).map(t=>t.name);
    if(matched.length===1)return {names:matched, confidence:'unique'};
    if(matched.length>1)return {names:matched, confidence:'multi'};
  }

  // ③ 評語作者：若該修別的平時評語有記錄填寫老師，採用之（最貼近實際指導者）
  if(type){
    const tc=DB.teacherComments?.[studentId]?.[type];
    const authorName=tc?.teacherName||(tc?.teacherId?(DB.users.find(u=>u.id===tc.teacherId)?.name||''):'');
    if(authorName)return {names:[authorName], confidence:'unique'};
  }

  // ④ fallback：此生只有一位指導老師時，直接採用（即使專長未標記符合）
  if(teacherObjs.length===1)return {names:[teacherObjs[0].name], confidence:'unique'};
  if(teacherObjs.length>1)return {names:teacherObjs.map(t=>t.name), confidence:'multi'};

  return {names:[], confidence:'none'};
}
window._resolveTeacherForType=_resolveTeacherForType;

function _buildStudentReportData(u){
  const types=[];
  ['major','minor','elective'].forEach(tp=>{
    if(!u[tp])return;
    const instId=u[tp];
    const catId=DB.instruments.items.find(i=>i.id===instId)?.cat;
    const ek=u.id+'_'+tp;
    // ★ 先用 _findScoredRoomForEntry 找考場
    let roomId=_findScoredRoomForEntry(u.id, tp, catId);
    let jurorData=DB.juryScores[roomId]?.[ek]||{};
    // ★ 保險：若解析出的考場該筆為空，掃描所有考場，挑出「資料最完整」(有評語優先，其次評分筆數最多)
    //   的那個考場，徹底避免副修等跨考場情形抓不到成績/評語。
    const _hasComment=jd=>Object.keys(jd||{}).some(k=>!k.startsWith('_')&&jd[k]&&typeof jd[k]==='object'&&jd[k].comment);
    const _scoreCount=jd=>Object.keys(jd||{}).filter(k=>!k.startsWith('_')&&jd[k]&&typeof jd[k]==='object').length;
    if(!_scoreCount(jurorData)){
      let bestRoom='', bestData={}, bestComment=false, bestCount=-1;
      Object.keys(DB.juryScores||{}).forEach(rId=>{
        const cand=DB.juryScores[rId]?.[ek];
        if(!cand)return;
        const cmt=_hasComment(cand), cnt=_scoreCount(cand);
        // 有評語的優先；同樣有/無評語時取評分筆數較多者
        if(cmt&&!bestComment || (cmt===bestComment&&cnt>bestCount)){
          bestRoom=rId; bestData=cand; bestComment=cmt; bestCount=cnt;
        }
      });
      if(_scoreCount(bestData)||_hasComment(bestData)){
        roomId=bestRoom; jurorData=bestData;
      }
    }
    const scoreArr=_safeJurors(jurorData);
    const isAbsent=scoreArr.some(s=>s.absent);
    const isDQ=!!DB.disqualified?.[ek];
    const result=scoreArr.length?calcFinal(scoreArr,roomId,{type:tp,catId,class:u.class}):{finalScore:null};
    const ded=DB.deductions[ek]||{amount:0,reason:''};
    const finalWithDed=result.finalScore!==null?Math.max(0,result.finalScore-(ded.amount||0)):null;
    const tc=DB.teacherComments[u.id]?.[tp]||{};
    // 評審評語（依評審順序，跳過缺考、空白）
    const allIds=new Set();
    Object.values(DB.juryScores[roomId]||{}).forEach(ed=>Object.keys(ed||{}).forEach(k=>{if(!k.startsWith('_'))allIds.add(k);}));
    const order=[...allIds].sort();
    const localIds=Object.keys(jurorData).filter(k=>!k.startsWith('_'));
    const sortedIds=order.filter(id=>localIds.includes(id));
    localIds.forEach(id=>{if(!sortedIds.includes(id))sortedIds.push(id);});
    const juryComments=sortedIds.map((jid,ji)=>({idx:ji+1, name:jurorData[jid]?._jurorName||'', comment:jurorData[jid]?.comment||'', absent:jurorData[jid]?.absent}))
      .filter(j=>!j.absent&&j.comment);
    // ★ 診斷：若此修別最終既無成績也無評語，於 console 輸出，方便定位是哪位學生/修別/考場
    if(!isDQ&&!isAbsent&&finalWithDed===null&&!juryComments.length){
      const _rooms=Object.keys(DB.juryScores||{}).filter(rId=>DB.juryScores[rId]?.[ek]);
      console.warn('[成績單] '+u.class+' '+u.name+' / '+typeName(tp)+'('+iname(instId)+') 無成績與評語。ek='+ek+'，解析考場='+(roomId||'(無)')+'，含此筆的考場='+(_rooms.join(',')||'(無)'));
    }
    const teacherInfo=_resolveTeacherForType(u.id, instId, tp);
    types.push({
      type:tp, typeName:typeName(tp), instName:iname(instId),
      finalScore: isDQ?'扣考':(isAbsent?'缺考':(finalWithDed!==null?finalWithDed.toFixed(2):'—')),
      finalIsNumber: !isDQ&&!isAbsent&&finalWithDed!==null,
      teacherComment: tc.comment||'',
      teacherName: (teacherInfo.confidence==='unique'||teacherInfo.confidence==='override')?teacherInfo.names[0]:'',
      teacherConfidence: teacherInfo.confidence,
      teacherCandidates: teacherInfo.names,
      dedAmount: ded.amount||0, dedReason: ded.reason||'',
      isDQ, dqReason: isDQ?(DB.disqualified[ek]?.reason||DB.disqualified[ek]?.note||''):'',
      juryComments,
    });
  });
  return {name:u.name, class:u.class||'', seat:u.seat||'', types};
}

// 單張學生成績單的 HTML（一張 A4，內容過多時自動縮放塞進一頁）
function _reportCardHtml(stu, resultsPublished){
  const teacherLine=(t)=>{
    if((t.teacherConfidence==='unique'||t.teacherConfidence==='override')&&t.teacherName){
      return `<span style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;color:var(--sage);margin-left:8px">指導老師：${escHtml(t.teacherName)}</span>`;
    }
    if(t.teacherConfidence==='multi'){
      return `<span style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;color:var(--muted);margin-left:8px">指導老師：${escHtml(t.teacherCandidates.join('／'))}（待確認）</span>`;
    }
    return '';
  };
  const typeBlocks=stu.types.map(t=>{
    const scoreLine = resultsPublished
      ? `<div style="display:flex;align-items:baseline;gap:6px">
           <span style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;color:var(--muted)">現場評分總成績</span>
           <span style="font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:600;color:${t.finalIsNumber&&parseFloat(t.finalScore)<60?'var(--red)':'var(--gold)'}">${escHtml(t.finalScore)}</span>
         </div>`
      : `<div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">成績待發佈</div>`;
    const dedLine = (t.dedAmount>0)
      ? `<div style="font-size:10px;color:var(--rust);margin-top:2px">⚠ 違規扣分 -${t.dedAmount}　原因：${escHtml(t.dedReason||'—')}</div>`
      : '';
    const dqLine = t.isDQ
      ? `<div style="font-size:10px;color:var(--rust);margin-top:2px">⛔ 扣考${t.dqReason?'　原因：'+escHtml(t.dqReason):''}</div>`
      : '';
    const teaBlock = `
      <div style="background:var(--cream);border-left:3px solid var(--steel);border-radius:0 3px 3px 0;padding:6px 10px;margin-top:6px">
        <div style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;color:var(--steel);margin-bottom:2px">指導老師平時評語</div>
        <div style="font-size:12px;line-height:1.55;color:var(--ink);white-space:pre-wrap">${escHtml(t.teacherComment)||'（老師尚未填寫評語）'}</div>
      </div>`;
    const juryBlock = `
      <div style="background:#f0f4ff;border-left:3px solid var(--blue);border-radius:0 3px 3px 0;padding:6px 10px;margin-top:5px">
        <div style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;color:var(--blue);margin-bottom:2px">現場評審評語</div>
        ${t.juryComments.length
          ? t.juryComments.map(j=>`<div style="font-size:12px;line-height:1.55;color:var(--ink);margin-bottom:2px;white-space:pre-wrap"><span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-right:5px">評審${j.idx}</span>${escHtml(j.comment)}</div>`).join('')
          : '<div style="font-size:11px;color:var(--muted)">（無評審評語）</div>'}
      </div>`;
    return `
      <div style="border:1px solid var(--border);border-radius:4px;padding:8px 12px;margin-bottom:8px;break-inside:avoid">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:3px">
          <div style="display:flex;align-items:baseline;flex-wrap:wrap">
            <span style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--gold)">${escHtml(t.typeName)}</span>
            <span style="font-size:15px;font-weight:700;margin-left:6px">${escHtml(t.instName)}</span>
            ${teacherLine(t)}
          </div>
          ${scoreLine}
        </div>
        ${dqLine}${dedLine}
        ${teaBlock}
        ${juryBlock}
      </div>`;
  }).join('');

  // 內層 .rc-inner 量測高度後，若超過可用高度會被 JS 自動縮放（見列印視窗腳本）
  return `
  <div class="report-card" style="width:210mm;height:297mm;padding:8mm 9mm;box-sizing:border-box;page-break-after:always;break-after:page;background:#fff;color:var(--ink);font-family:'Noto Serif TC',serif;overflow:hidden">
    <div class="rc-inner" style="transform-origin:top center">
      <div style="text-align:center;border-bottom:2px solid var(--gold);padding-bottom:7px;margin-bottom:9px">
        <div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:600;letter-spacing:2px">音樂科術科成績單</div>
        <div class="rc-en-sub" style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);letter-spacing:1px;margin-top:1px">Music Practical Exam Report</div>
      </div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:10px;padding:7px 12px;background:var(--cream);border-radius:4px">
        <div><span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);letter-spacing:1px">班級</span><div style="font-size:14px;font-weight:600">${escHtml(stu.class||'—')}</div></div>
        <div><span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);letter-spacing:1px">座號</span><div style="font-size:14px;font-weight:600">${escHtml(String(stu.seat||'—'))}</div></div>
        <div><span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);letter-spacing:1px">姓名</span><div style="font-size:14px;font-weight:600">${escHtml(stu.name||'—')}</div></div>
      </div>
      ${typeBlocks||'<div style="font-size:13px;color:var(--muted);padding:20px;text-align:center">（此學生尚無樂器別/成績資料）</div>'}
      <div style="padding-top:8px;margin-top:6px;border-top:1px solid var(--border);font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);text-align:center;letter-spacing:1px">
        本成績單由音樂術科評量系統產生　${new Date().toLocaleDateString('zh-TW')}
      </div>
    </div>
  </div>`;
}

function generateReportCards(){
  if(!requireRole('admin'))return;
  const sel=document.getElementById('rc-class-sel');
  const classF=sel?.value||'__all__';
  const onlyPub=document.getElementById('rc-only-published')?.checked;
  const resultsPublished=!!DB.config.resultsPublished;
  if(onlyPub && !resultsPublished){
    showToast('目前成績尚未發佈，無法只產生已發佈成績','warn');
    return;
  }
  let students=DB.users.filter(u=>u.role==='student');
  if(classF!=='__all__')students=students.filter(u=>u.class===classF);
  // 排序：班級 → 座號
  students.sort((a,b)=>{
    const c=(a.class||'').localeCompare(b.class||'','zh-TW-u-co-stroke');
    if(c!==0)return c;
    return (parseInt(a.seat)||0)-(parseInt(b.seat)||0);
  });
  if(!students.length){showToast('此班級沒有學生','warn');return;}

  const cards=students.map(u=>_reportCardHtml(_buildStudentReportData(u), resultsPublished)).join('');
  const title=classF==='__all__'?'全校成績單':(classF+' 成績單');
  closeOverlay('report-card-modal');
  _openReportCardPrintWindow(title, cards, students.length);
}
window.generateReportCards=generateReportCards;

function _openReportCardPrintWindow(title, cardsHtml, count){
  const rootVars=_collectRootVars();
  const win=window.open('','_rcprint','width=900,height=1000');
  if(!win){showToast('瀏覽器封鎖了彈出視窗，請允許後再試','err');return;}
  const doc=`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@300;400;500;600;700&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap" rel="stylesheet">
  <style>
    :root{${rootVars}}
    *{box-sizing:border-box}
    body{margin:0;background:#e9e6df;font-family:'Noto Serif TC',serif}
    .report-card{margin:0 auto 6mm;box-shadow:0 1px 6px rgba(0,0,0,.15);overflow:hidden}
    .print-toolbar{position:fixed;top:8px;right:12px;display:flex;gap:8px;z-index:99}
    .print-toolbar button{font-family:'Noto Serif TC',serif;font-size:13px;padding:8px 16px;border:1px solid var(--gold);background:var(--gold);color:#fff;border-radius:4px;cursor:pointer}
    .print-toolbar button.sec{background:#fff;color:var(--ink);border-color:var(--border)}
    .rc-hint{text-align:center;font-family:'DM Mono',monospace;font-size:11px;color:#555;padding:10px}
    @page{size:A4;margin:0}
    @media print{
      body{background:#fff}
      .no-print{display:none !important}
      .report-card{margin:0;box-shadow:none}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    }
    /* ★ 列印穩定性修正：報表卡片內凡用 DM Mono 顯示中文的小標籤，
       改用中文字體 Noto Serif TC。DM Mono 無中文字符，列印時 Chrome
       會丟字導致「指導老師/主修/評審N」等標籤消失。純英文標題不受影響。 */
    .report-card [style*="DM Mono"]:not(.rc-en-sub){font-family:'Noto Serif TC',serif !important}
  </style></head>
  <body>
    <div class="print-toolbar no-print">
      <button id="rc-print-btn" onclick="doRcPrint()" disabled>⏳ 字體載入中…</button>
      <button class="sec" onclick="window.close()">關閉</button>
    </div>
    <div class="rc-hint no-print">共 ${count} 位學生，每位一張 A4（內容多時會自動縮放塞進一頁）。請按上方按鈕列印或「另存為 PDF」。列印時請選 A4、邊界設為「無」、並勾選「背景圖形」。</div>
    ${cardsHtml}
    <script>
      // ★ 自動縮放：若某張卡片內容超過 A4 可用高度，等比縮小該卡片內層，確保不溢出一頁
      function fitCards(){
        document.querySelectorAll('.report-card').forEach(function(card){
          var inner=card.querySelector('.rc-inner');
          if(!inner)return;
          inner.style.transform='';
          // 可用高度 = 卡片內距後的高度
          var cs=getComputedStyle(card);
          var padTop=parseFloat(cs.paddingTop)||0, padBot=parseFloat(cs.paddingBottom)||0;
          var avail=card.clientHeight-padTop-padBot;
          var need=inner.scrollHeight;
          if(need>avail && need>0){
            var scale=Math.max(0.6, avail/need); // 最多縮到 60%
            inner.style.transform='scale('+scale+')';
            inner.style.transformOrigin='top center';
          }
        });
      }
      window.addEventListener('load', function(){
        // 等字體載入完成再縮放，避免 DM Mono 未載入導致量測錯誤
        if(document.fonts && document.fonts.ready){
          document.fonts.ready.then(function(){ setTimeout(fitCards, 100); _enablePrintBtn(); });
        } else {
          setTimeout(function(){ fitCards(); _enablePrintBtn(); }, 800);
        }
      });
      window.addEventListener('beforeprint', fitCards);
      function _enablePrintBtn(){
        var b=document.getElementById('rc-print-btn');
        if(b){ b.disabled=false; b.textContent='🖨 列印／存成 PDF（共 ${count} 張）'; }
      }
      // 主動強制載入 DM Mono（Chrome 不會等被動字體，需明確觸發）
      if(document.fonts && document.fonts.load){
        try{
          Promise.all([
            document.fonts.load("400 12px 'DM Mono'"),
            document.fonts.load("500 12px 'DM Mono'"),
            document.fonts.load("400 12px 'Noto Serif TC'"),
            document.fonts.load("700 12px 'Noto Serif TC'")
          ]).then(function(){ _enablePrintBtn(); fitCards(); });
        }catch(e){}
      }
      function doRcPrint(){
        // 列印前再次確保字體已就緒（Chrome 保險）
        function go(){ fitCards(); setTimeout(function(){ window.print(); }, 60); }
        if(document.fonts && document.fonts.ready){ document.fonts.ready.then(go); }
        else { go(); }
      }
    <\/script>
  </body></html>`;
  win.document.open();
  win.document.write(doc);
  win.document.close();
  win.focus();
}

// ★ 計算彙整成績資料（給定班級或全部，回傳 row 物件陣列）
function _buildSummaryRows(classFilter){
  let stus=DB.users.filter(u=>u.role==='student');
  if(classFilter)stus=stus.filter(s=>s.class===classFilter);

  // 排序：班級 → 座號
  stus.sort((a,b)=>{
    const cc=String(a.class||'').localeCompare(String(b.class||''),'zh-TW');
    if(cc!==0)return cc;
    return (parseInt(a.seat,10)||0)-(parseInt(b.seat,10)||0);
  });

  // 為了拿術科總成績，需要從 schedule snapshot 找 entryKey
  const snap=DB.savedScheduleSnapshot||{};
  const hasSnap=Object.values(snap).some(arr=>arr&&arr.length>0);
  let allSched=[];
  if(hasSnap){
    Object.entries(snap).forEach(([snapRoomId,snaps])=>{
      (snaps||[]).forEach(e=>allSched.push({...e,roomId:snapRoomId}));
    });
  } else {
    allSched=getScheduleEntries();
  }
  const examScoreMap={};
  allSched.forEach(e=>{
    const entryKey=e.studentId+'_'+e.type;
    const jurorData=DB.juryScores[e.roomId]?.[entryKey]||{};
    const scoreArr=_safeJurors(jurorData);
    if(!scoreArr.length){examScoreMap[entryKey]={final:null,isAbsent:false};return;}
    // ★ 修正：傳入 entry(e)，讓 calcFinal 能正確處理 * 不計分欄位的權重重分配
    const result=calcFinal(scoreArr,e.roomId,e);
    const ded=DB.deductions[entryKey]||{amount:0,reason:''};
    const finalWithDed=result.finalScore!==null?Math.max(0,result.finalScore-(ded.amount||0)):null;
    const isAbsent=scoreArr.some(s=>s.absent);
    const isDQ=!!DB.disqualified?.[entryKey];
    examScoreMap[entryKey]={final:isAbsent?0:finalWithDed,isAbsent,isDQ};
  });

  const instById={};
  (DB.instruments?.items||[]).forEach(it=>{instById[it.id]=it;});
  const nameOfInst=(id)=>id?(instById[id]?.name||id):'';
  const getExamFinal=(stuId,type)=>{
    const k=stuId+'_'+type;
    const r=examScoreMap[k];
    if(!r)return '';
    if(r.isDQ)return '扣考';
    if(r.isAbsent)return '缺考';
    return r.final===null||r.final===undefined?'':r.final.toFixed(2);
  };
  const getTeaScore=(stuId,type)=>{
    const tc=DB.teacherComments[stuId]?.[type];
    if(!tc)return '';
    return tc.score!==undefined&&tc.score!==null?tc.score:'';
  };
  const getTeaComment=(stuId,type)=>{
    const tc=DB.teacherComments[stuId]?.[type];
    return tc?.comment||'';
  };

  return stus.map(s=>({
    '班級':s.class||'',
    '座號':s.seat||'',
    '姓名':s.name||'',
    '主修樂器':nameOfInst(s.major),
    '副修樂器':nameOfInst(s.minor),
    '選修樂器':nameOfInst(s.elective),
    '主修總成績':getExamFinal(s.id,'major'),
    '副修總成績':getExamFinal(s.id,'minor'),
    '選修總成績':getExamFinal(s.id,'elective'),
    '主修平時成績':getTeaScore(s.id,'major'),
    '副修平時成績':getTeaScore(s.id,'minor'),
    '選修平時成績':getTeaScore(s.id,'elective'),
    '主修平時評語':getTeaComment(s.id,'major'),
    '副修平時評語':getTeaComment(s.id,'minor'),
    '選修平時評語':getTeaComment(s.id,'elective'),
  }));
}

// ★ 把 row 物件陣列轉成 CSV 字串（含 BOM）
function _rowsToCsvString(data){
  if(!data.length)return '\uFEFF';
  const headers=Object.keys(data[0]);
  const rows=[headers.join(','),...data.map(r=>headers.map(h=>`"${(r[h]??'').toString().replace(/"/g,'""')}"`).join(','))];
  return '\uFEFF'+rows.join('\n');
}

function doExportSummary(){
  const classF=document.getElementById('export-summary-class')?.value||'__all_zip__';

  // ── 模式 1：全部班級 ZIP ──
  if(classF==='__all_zip__'){
    const classSet=new Set();
    DB.users.filter(u=>u.role==='student').forEach(s=>{if(s.class)classSet.add(s.class);});
    const classList=[...classSet].sort();
    if(!classList.length){showToast('無班級資料','err');return;}

    const files=[];
    let totalStu=0;
    classList.forEach(cls=>{
      const rows=_buildSummaryRows(cls);
      if(!rows.length)return;
      totalStu+=rows.length;
      files.push({name:`${cls}_彙整成績.csv`, content:_rowsToCsvString(rows)});
    });
    if(!files.length){showToast('所有班級皆無資料','err');return;}

    const zipBlob=_buildZip(files);
    const url=URL.createObjectURL(zipBlob);
    const a=document.createElement('a');
    a.href=url;a.download='全部班級_彙整成績.zip';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    closeOverlay('export-summary-modal');
    showToast(`已下載 ${files.length} 個班級、共 ${totalStu} 位學生的彙整成績`,'ok');
    return;
  }

  // ── 模式 2：全部班級合併成單一 CSV ──
  if(classF==='__all_one__'){
    const rows=_buildSummaryRows('');
    if(!rows.length){showToast('無學生資料','err');return;}
    exportCSV(rows,'全部班級_彙整成績');
    closeOverlay('export-summary-modal');
    showToast(`已下載 ${rows.length} 位學生的彙整成績`,'ok');
    return;
  }

  // ── 模式 3：單一班級 ──
  const rows=_buildSummaryRows(classF);
  if(!rows.length){showToast('該班級無學生資料','err');return;}
  exportCSV(rows,classF+'_彙整成績');
  closeOverlay('export-summary-modal');
  showToast(`已下載 ${rows.length} 位學生的彙整成績`,'ok');
}
window.doExportSummary=doExportSummary;

// ════════════════════════════════════════════════
// ★ 純 JS ZIP 編碼器（STORE 模式，無壓縮）
//   單檔系統不引入 JSZip；CSV 內容小，無壓縮也只多幾 KB
// ════════════════════════════════════════════════
function _buildZip(files){
  // CRC-32 表（一次建好即可）
  if(!_buildZip._crcTable){
    const t=new Uint32Array(256);
    for(let i=0;i<256;i++){
      let c=i;
      for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);
      t[i]=c>>>0;
    }
    _buildZip._crcTable=t;
  }
  const crcTable=_buildZip._crcTable;
  function crc32(bytes){
    let c=0xFFFFFFFF;
    for(let i=0;i<bytes.length;i++)c=(crcTable[(c^bytes[i])&0xFF]^(c>>>8))>>>0;
    return (c^0xFFFFFFFF)>>>0;
  }

  // 把字串轉 UTF-8 bytes（檔名與內容皆用）
  const enc=new TextEncoder();
  const localChunks=[];
  const centralChunks=[];
  let offset=0;

  files.forEach(f=>{
    const nameBytes=enc.encode(f.name);
    const contentBytes=enc.encode(f.content);
    const crc=crc32(contentBytes);
    const size=contentBytes.length;

    // ── Local file header ──
    const lh=new Uint8Array(30+nameBytes.length);
    const dv=new DataView(lh.buffer);
    dv.setUint32(0,0x04034b50,true);   // signature
    dv.setUint16(4,20,true);            // version needed
    dv.setUint16(6,0x0800,true);        // general purpose bit flag (UTF-8 filename)
    dv.setUint16(8,0,true);             // compression method (0 = STORE)
    dv.setUint16(10,0,true);            // mod time
    dv.setUint16(12,0,true);            // mod date
    dv.setUint32(14,crc,true);          // crc-32
    dv.setUint32(18,size,true);         // compressed size
    dv.setUint32(22,size,true);         // uncompressed size
    dv.setUint16(26,nameBytes.length,true); // filename length
    dv.setUint16(28,0,true);            // extra field length
    lh.set(nameBytes,30);
    localChunks.push(lh,contentBytes);

    // ── Central directory header ──
    const ch=new Uint8Array(46+nameBytes.length);
    const cv=new DataView(ch.buffer);
    cv.setUint32(0,0x02014b50,true);
    cv.setUint16(4,20,true);            // version made by
    cv.setUint16(6,20,true);            // version needed
    cv.setUint16(8,0x0800,true);        // general purpose flag
    cv.setUint16(10,0,true);            // compression
    cv.setUint16(12,0,true);
    cv.setUint16(14,0,true);
    cv.setUint32(16,crc,true);
    cv.setUint32(20,size,true);
    cv.setUint32(24,size,true);
    cv.setUint16(28,nameBytes.length,true);
    cv.setUint16(30,0,true);            // extra field length
    cv.setUint16(32,0,true);            // file comment length
    cv.setUint16(34,0,true);            // disk number start
    cv.setUint16(36,0,true);            // internal attrs
    cv.setUint32(38,0,true);            // external attrs
    cv.setUint32(42,offset,true);       // relative offset of local header
    ch.set(nameBytes,46);
    centralChunks.push(ch);

    offset+=lh.length+contentBytes.length;
  });

  // ── End of central directory record ──
  const centralSize=centralChunks.reduce((s,c)=>s+c.length,0);
  const eocd=new Uint8Array(22);
  const ev=new DataView(eocd.buffer);
  ev.setUint32(0,0x06054b50,true);
  ev.setUint16(4,0,true);               // disk number
  ev.setUint16(6,0,true);               // disk where central starts
  ev.setUint16(8,files.length,true);    // entries on this disk
  ev.setUint16(10,files.length,true);   // total entries
  ev.setUint32(12,centralSize,true);    // central directory size
  ev.setUint32(16,offset,true);         // central directory offset
  ev.setUint16(20,0,true);              // comment length

  return new Blob([...localChunks,...centralChunks,eocd],{type:'application/zip'});
}

// ════════════════════════════════════════════════
// DISQ - ADD INDIVIDUAL
// ════════════════════════════════════════════════
let _adimSelectedSid=null,_adimSelectedType=null;
function openAddDisqIndividual(){
  _adimSelectedSid=null;_adimSelectedType=null;
  document.getElementById('adim-search').value='';
  document.getElementById('adim-results').innerHTML='';
  document.getElementById('adim-selected').style.display='none';
  document.getElementById('adim-reason-area').style.display='none';
  document.getElementById('adim-note-area').style.display='none';
  document.getElementById('adim-reason').value='';
  document.getElementById('adim-note').value='';
  document.getElementById('adim-err').textContent='';
  openOverlay('add-disq-individual-modal');
  setTimeout(()=>document.getElementById('adim-search').focus(),200);
}
window.openAddDisqIndividual=openAddDisqIndividual;

function adimSearch(){
  const q=(document.getElementById('adim-search').value||'').trim();
  const res=document.getElementById('adim-results');
  if(!q){res.innerHTML='';return;}
  const found=students().filter(s=>s.name.includes(q)||s.account.includes(q));
  if(!found.length){res.innerHTML='<div style="padding:12px;font-family:\'DM Mono\',monospace;font-size:11px;color:var(--muted)">查無學生</div>';return;}
  res.innerHTML=found.slice(0,15).map(s=>{
    const types=[];
    if(s.major)types.push({key:'major',label:'主修·'+iname(s.major)});
    if(s.minor)types.push({key:'minor',label:'副修·'+iname(s.minor)});
    if(s.elective)types.push({key:'elective',label:'選修·'+iname(s.elective)});
    return types.map(t=>`
      <div onclick="adimSelect('${s.id}','${t.key}','${s.name}','${t.label}')"
        style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--cream);transition:background .15s"
        onmouseover="this.style.background='var(--gold-bg)'" onmouseout="this.style.background=''">
        <strong>${s.name}</strong>
        <span style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted);margin-left:6px">${s.class}·座${s.seat}·${s.account}</span>
        <span style="font-family:\'DM Mono\',monospace;font-size:9px;margin-left:8px;color:var(--steel)">${t.label}</span>
      </div>`).join('');
  }).join('');
}
window.adimSearch=adimSearch;

function adimSelect(sid,type,name,label){
  _adimSelectedSid=sid;_adimSelectedType=type;
  document.getElementById('adim-selected').style.display='block';
  document.getElementById('adim-selected').innerHTML=`<strong>${name}</strong> <span style="color:var(--muted);font-size:12px">${label}</span> <span style="color:var(--sage);font-size:12px">✓ 已選擇</span>`;
  document.getElementById('adim-results').innerHTML='';
  document.getElementById('adim-reason-area').style.display='block';
  document.getElementById('adim-note-area').style.display='block';
}
window.adimSelect=adimSelect;

function saveDisqIndividual(){
  if(!_adimSelectedSid||!_adimSelectedType){document.getElementById('adim-err').textContent='請先選擇學生';return;}
  const reason=document.getElementById('adim-reason').value.trim();
  if(!reason){document.getElementById('adim-err').textContent='請填寫扣考原因';return;}
  const note=document.getElementById('adim-note').value.trim();
  const entryKey=_adimSelectedSid+'_'+_adimSelectedType;
  DB.disqualified[entryKey]={reason,note};
  fbSet('disqualified',entryKey,{reason,note});
  closeOverlay('add-disq-individual-modal');
  renderDisqList();renderSchedule();
  showToast('已設定扣考 ✓','warn');
}
window.saveDisqIndividual=saveDisqIndividual;

// ════════════════════════════════════════════════
// ★ 需求4：發佈 / 收回成績
// ════════════════════════════════════════════════
function _updatePublishBarUI(){
  const isPublished=!!(DB.config.resultsPublished);
  const statusEl=document.getElementById('results-publish-status');
  const timeEl=document.getElementById('results-publish-time');
  const pubBtn=document.getElementById('publish-results-btn');
  const unpubBtn=document.getElementById('unpublish-results-btn');
  if(statusEl)statusEl.textContent=isPublished?'✅ 已發佈':'⚑ 尚未發佈';
  if(statusEl)statusEl.style.color=isPublished?'var(--sage)':'var(--rust)';
  if(timeEl)timeEl.textContent=isPublished&&DB.config.resultsPublishedAt?('發佈時間：'+new Date(DB.config.resultsPublishedAt).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})):'';
  if(pubBtn)pubBtn.style.display=isPublished?'none':'inline-flex';
  if(unpubBtn)unpubBtn.style.display=isPublished?'inline-flex':'none';
}
window._updatePublishBarUI=_updatePublishBarUI;

async function publishResults(){
  if(!requireRole('admin'))return;
  if(!confirm('確定要發佈成績？學生及教師將可看到完整術科成績（含扣分及評語）。'))return;
  DB.config.resultsPublished=true;
  DB.config.resultsPublishedAt=new Date().toISOString();
  DB.config.studentAccess['live-results']=true;
  DB.config.teacherAccess['live-results']=true;
  fbSaveConfig();
  fbSet('resultsPublish','main',{published:true,publishedAt:DB.config.resultsPublishedAt});
  // ★ 自動推送 snapshot：學生/教師下次登入會看到最新成績
  await publishSnapshot('scores');
  await publishSnapshot('comments');
  _updatePublishBarUI();
  buildNav();renderAll();
  showToast('成績已發佈並推送給學生/教師 ✓','ok');
}
window.publishResults=publishResults;

// ★ 管理員手動推送 snapshot 更新（讓學生/教師下次登入看到最新資料）
async function adminPublishSnapshot(dataset){
  if(!requireRole('admin'))return;
  const labels={scores:'成績總表',comments:'評語',schedule:'考試順序',examRules:'考試規則'};
  const label=labels[dataset]||dataset;
  if(!confirm(`確定要推送「${label}」最新版給學生/教師？\n\n下次他們登入時會自動看到最新內容。`))return;
  showToast('正在推送...','sync');
  const ok=await publishSnapshot(dataset);
  if(ok){
    showToast(`「${label}」已推送 ✓ 學生/教師下次登入即可看到最新內容`,'ok');
  } else {
    showToast('推送失敗，請檢查網路','err');
  }
}
window.adminPublishSnapshot=adminPublishSnapshot;

function unpublishResults(){
  if(!requireRole('admin'))return;
  if(!confirm('確定要收回成績發佈？學生及教師將無法查看成績總表。'))return;
  DB.config.resultsPublished=false;
  DB.config.resultsPublishedAt=null;
  DB.config.studentAccess['live-results']=false;
  DB.config.teacherAccess['live-results']=false;
  fbSaveConfig();
  fbSet('resultsPublish','main',{published:false,publishedAt:null});
  _updatePublishBarUI();
  buildNav();renderAll(); // ★ Bug10
  showToast('成績已收回，學生及教師無法查看','warn');
}
window.unpublishResults=unpublishResults;

// ════════════════════════════════════════════════
// ★ 需求4 & Bug8：現場評分成績總表（學生 & 教師唯讀）
//   含扣分及原因、各考場前三名、所有評審評語
// ════════════════════════════════════════════════
function renderLiveResults(){
  // ★ 直接呼叫通用渲染函數，與管理員後台「成績總表」介面一致
  //   學生/教師強制隱藏評審真實姓名（showRealNames:false）
  return _renderResultsTable({
    bodyId:'lr-body',
    roomFilterId:'lr-room',
    classFilterId:'lr-class',
    allowRoles:['student','teacher','admin'],
    showRealNames:false,  // 永遠隱藏真實姓名
    showExportBtn:false,  // 學生/教師不能匯出
  });
}
window.renderLiveResults=renderLiveResults;

// ════════════════════════════════════════════════
// 教師查看自己學生的期末評審評語（不顯示分數）
// ════════════════════════════════════════════════
function renderTeaJuryComments(){
  const el=document.getElementById('tjc-body');if(!el)return;
  if(ST.role!=='teacher'&&ST.role!=='admin'){el.innerHTML='';return;}

  // 取得此教師的學生清單
  const myStus=getMyStudents();
  if(!myStus.length){
    el.innerHTML='<div class="card" style="text-align:center;padding:32px"><div style="font-size:32px;margin-bottom:10px">👥</div><div style="font-family:\'DM Mono\',monospace;font-size:12px;color:var(--muted)">尚未有指導學生，請聯絡管理員設定</div></div>';
    return;
  }

  // 取得各評審一致排序（同 renderLiveResults 邏輯）
  if(DB._jurorOrderCache)DB._jurorOrderCache={};
  const _getRoomJurorIds=(rId)=>{
    if(!DB._jurorOrderCache)DB._jurorOrderCache={};
    if(!DB._jurorOrderCache[rId]){
      // ★ 問題1：只列出「實際有評分內容」的評審，過濾幽靈
      const validIds=new Set();
      const fieldList=(typeof getRoomFields==='function'?getRoomFields(rId):[{id:'scale'},{id:'assigned'},{id:'free'}]).map(f=>f.id);
      Object.values(DB.juryScores[rId]||{}).forEach(ed=>{
        Object.entries(ed||{}).forEach(([k,data])=>{
          if(k.startsWith('_'))return;
          if(!data||typeof data!=='object')return;
          // ★ 必須「有實際分數或評語」才納入（光有姓名不算，因為刪除分數後姓名可能殘留）
          // ★ 條件：有姓名 OR 有實際分數 OR 有評語 才算有效評審
          //   有姓名但沒分數的：可能是剛登入未打分的評審，仍需顯示在欄位（顯示「未評」）
          //   光是 null 或無姓名無分數的幽靈才會被過濾
          const SYS_KEYS=new Set(['comment','absent']);
          const hasName=data._jurorName&&String(data._jurorName).trim();
          const hasScore=Object.keys(data).some(fk=>{
            if(fk.startsWith('_')||SYS_KEYS.has(fk))return false;
            const v=data[fk];
            return v!==undefined&&v!==''&&v!==null&&v!=='*';
          });
          const hasComment=data.comment&&String(data.comment).trim();
          if(hasName||hasScore||hasComment)validIds.add(k);
        });
      });
      DB._jurorOrderCache[rId]=[...validIds].sort();
    }
    return DB._jurorOrderCache[rId];
  };

  // 從快照找每位學生的 entry（可能有 major/minor/elective 多筆）
  const snap=DB.savedScheduleSnapshot||{};
  let html='';
  // ★ 全部展開／收合工具列
  html+=`<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
    <button class="btn btn-s btn-sm" onclick="document.querySelectorAll('[id^=tjc_]:not([id$=_arr])').forEach(function(c){c.style.display='block';});document.querySelectorAll('[id$=_arr]').forEach(function(a){a.textContent='▾';})">全部展開</button>
    <button class="btn btn-s btn-sm" onclick="document.querySelectorAll('[id^=tjc_]:not([id$=_arr])').forEach(function(c){c.style.display='none';});document.querySelectorAll('[id$=_arr]').forEach(function(a){a.textContent='▸';})">全部收合</button>
  </div>`;

  myStus.sort((a,b)=>{
    const cc=a.class.localeCompare(b.class);
    return cc!==0?cc:(a.seat||0)-(b.seat||0);
  }).forEach(stu=>{
    // 找出這位學生在所有考場快照中的 entries
    const stuEntries=[];
    Object.entries(snap).forEach(([roomId,entries])=>{
      (entries||[]).forEach(e=>{
        if(e.studentId===stu.id)stuEntries.push({...e,roomId});
      });
    });
    if(!stuEntries.length)return; // 此學生不在排程中

    const entryCards=stuEntries.map(e=>{
      const entryKey=stu.id+'_'+e.type;
      const jurorData=DB.juryScores[e.roomId]?.[entryKey]||{};
      const jurorIds=_getRoomJurorIds(e.roomId);

      // 只取有評語的評審（跳過缺考）
      const comments=jurorIds.map((jid,ji)=>{
        const s=jurorData[jid];
        if(!s||s.absent||!s.comment)return null;
        return {idx:ji+1,text:s.comment};
      }).filter(Boolean);

      if(!comments.length){
        return `<div style="background:var(--cream);border-radius:var(--r);padding:10px 14px;margin-top:6px;display:flex;align-items:center;gap:10px">
          ${typeBadge(e.type)}
          <span style="font-size:13px;color:var(--muted);font-family:'DM Mono',monospace;font-size:11px">${escHtml(iname(stu[e.type]||'')||e.instName||'—')}</span>
          <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-left:auto">（尚無評語）</span>
        </div>`;
      }

      return `<div style="border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:0 var(--r) var(--r) 0;padding:12px 16px;margin-top:8px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          ${typeBadge(e.type)}
          <span style="font-size:13px;color:var(--ink)">${escHtml(iname(stu[e.type]||'')||e.instName||'—')}</span>
          <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${escHtml(e.roomName||'')}</span>
          <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-left:auto">${comments.length} 位評審評語</span>
        </div>
        ${comments.map(c=>`
          <div style="margin-bottom:${c===comments[comments.length-1]?'0':'10px'};padding-left:10px;border-left:2px solid var(--cream)">
            <div style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;color:var(--muted);margin-bottom:3px">評審 ${c.idx}</div>
            <div style="font-size:13px;line-height:1.9;color:var(--ink);white-space:pre-wrap">${escHtml(c.text)}</div>
          </div>`).join('')}
      </div>`;
    }).join('');

    if(!entryCards.trim())return;

    // ★ 可收合：點標題列展開/收合該生評語（預設收合，因教師學生多）
    const _tjcId='tjc_'+stu.id;
    // 計算該生總評語數，顯示在收合狀態下供教師快速判斷
    let _totalComments=0;
    stuEntries.forEach(e=>{
      const ek=stu.id+'_'+e.type;
      const jd=DB.juryScores[e.roomId]?.[ek]||{};
      _getRoomJurorIds(e.roomId).forEach(jid=>{
        const s=jd[jid];
        if(s&&!s.absent&&s.comment)_totalComments++;
      });
    });
    html+=`<div class="card" style="margin-bottom:10px;padding:0;overflow:hidden">
      <div onclick="(function(b){var c=document.getElementById('${_tjcId}');var a=document.getElementById('${_tjcId}_arr');if(!c)return;var open=c.style.display!=='none';c.style.display=open?'none':'block';if(a)a.textContent=open?'▸':'▾';})(this)"
           style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 16px;cursor:pointer;user-select:none">
        <span id="${_tjcId}_arr" style="font-size:12px;color:var(--gold);width:14px">▸</span>
        <strong style="font-size:15px">${escHtml(stu.name)}</strong>
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${escHtml(stu.class||'')}·座${escHtml(stu.seat||'')}</span>
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${escHtml(iname(stu.major)||'')}</span>
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-left:auto">${_totalComments} 則評語</span>
      </div>
      <div id="${_tjcId}" style="display:none;padding:0 16px 14px">
        ${entryCards}
      </div>
    </div>`;
  });

  el.innerHTML=html||`<div class="card" style="text-align:center;padding:32px">
    <div style="font-size:32px;margin-bottom:10px">💬</div>
    <div style="font-family:'DM Mono',monospace;font-size:12px;color:var(--muted)">尚無評語資料（評審尚未填寫，或學生不在任何排程考場中）</div>
  </div>`;
}
window.renderTeaJuryComments=renderTeaJuryComments;
function _buildAdminResultsData(roomIdFilter,classFFilter){
  const snap=DB.savedScheduleSnapshot||{};
  const hasSnap=Object.values(snap).some(arr=>arr&&arr.length>0);
  let allSched=[];
  if(hasSnap){
    Object.entries(snap).forEach(([snapRoomId,snaps])=>{
      const room=DB.rooms.find(r=>r.id===snapRoomId);
      (snaps||[]).forEach(e=>allSched.push({...e,roomId:snapRoomId,roomName:e.roomName||(room?.name||snapRoomId)}));
    });
    // ★ 補上「沒存快照但有評分資料」的考場
    const snapRoomIds=new Set(Object.keys(snap).filter(k=>snap[k]&&snap[k].length));
    const scoredRoomIds=Object.keys(DB.juryScores||{}).filter(rid=>Object.keys(DB.juryScores[rid]||{}).length>0);
    const missing=scoredRoomIds.filter(rid=>!snapRoomIds.has(rid));
    if(missing.length){
      const liveAll=getScheduleEntries();
      missing.forEach(rid=>liveAll.filter(e=>e.roomId===rid).forEach(e=>allSched.push(e)));
    }
    allSched.sort((a,b)=>{
      const ri=DB.rooms.findIndex(r=>r.id===a.roomId)-DB.rooms.findIndex(r=>r.id===b.roomId);
      return ri!==0?ri:(a.order||0)-(b.order||0);
    });
  } else {
    allSched=getScheduleEntries();
  }
  let entries=allSched;
  if(roomIdFilter)entries=entries.filter(e=>e.roomId===roomIdFilter);
  if(classFFilter)entries=entries.filter(e=>e.class===classFFilter);
  return entries;
}
window._buildAdminResultsData=_buildAdminResultsData;

// ════════════════════════════════════════════════
// 管理員：刪除某考場某評審的所有成績
// ════════════════════════════════════════════════
function renderDeleteJurorBar(){
  const bar=document.getElementById('delete-juror-bar');
  if(!bar||ST.role!=='admin')return;
  const roomId=document.getElementById('result-room')?.value||'';
  if(!roomId){bar.style.display='none';return;}

  // 蒐集此考場所有出現過的評審 id 及其名稱
  const jurorMap={};
  Object.entries(DB.juryScores[roomId]||{}).forEach(([entryKey,entryData])=>{
    Object.entries(entryData||{}).forEach(([jid,jData])=>{
      if(jid.startsWith('_'))return;
      if(!jurorMap[jid])jurorMap[jid]={name:jData._jurorName||'',entryCount:0};
      jurorMap[jid].entryCount++;
      if(jData._jurorName&&!jurorMap[jid].name)jurorMap[jid].name=jData._jurorName;
    });
  });

  const jurorIds=Object.keys(jurorMap).sort();
  if(!jurorIds.length){bar.style.display='none';return;}

  const roomName=DB.rooms.find(r=>r.id===roomId)?.name||roomId;
  const jurorBadges=jurorIds.map((jid,ji)=>{
    const info=jurorMap[jid];
    const label=info.name?`評審${ji+1}（${info.name}）`:`評審${ji+1}`;
    const safeLbl=label.replace(/'/g,'').replace(/"/g,'');
    return `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--white);border:1px solid var(--border);border-radius:var(--r);padding:5px 10px;margin:3px">
      <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--ink)">${label}</span>
      <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${info.entryCount} 筆</span>
      <button class="btn btn-d btn-xs" style="padding:2px 8px;font-size:11px" onclick="deleteJurorFromRoom('${roomId}','${jid}','${safeLbl}')">🗑 刪除此評審所有成績</button>
    </span>`;
  }).join('');

  bar.style.display='block';
  bar.innerHTML=`<div style="background:#fff3f3;border:1px solid #f5c6cb;border-left:4px solid var(--red);border-radius:var(--r);padding:12px 16px">
    <div style="margin-bottom:10px">
      <div style="font-family:'DM Mono',monospace;font-size:10px;font-weight:700;letter-spacing:2px;color:var(--red)">🗑 刪除考場評審成績｜${roomName}</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:3px">選擇要刪除的評審 — 將移除該評審對本考場所有學生的評分及評語，刪除後無法還原</div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:0">${jurorBadges}</div>
  </div>`;
}
window.renderDeleteJurorBar=renderDeleteJurorBar;

async function deleteJurorFromRoom(roomId,jurorId,jurorLabel){
  if(ST.role!=='admin'){showToast('僅管理員可執行此操作','err');return;}
  const roomName=DB.rooms.find(r=>r.id===roomId)?.name||roomId;
  if(!confirm(`確定要刪除「${roomName}」中「${jurorLabel}」的所有評分資料？\n\n此操作不可還原。`))return;
  if(!confirm(`再次確認：刪除「${jurorLabel}」在「${roomName}」的全部評分及評語？`))return;

  const entries=DB.juryScores[roomId]||{};
  const entryKeys=Object.keys(entries).filter(k=>entries[k]&&entries[k][jurorId]);
  if(!entryKeys.length){showToast('此考場找不到該評審的成績','warn');return;}

  showToast(`正在刪除 ${jurorLabel} 的 ${entryKeys.length} 筆評分...`,'sync');

  for(const entryKey of entryKeys){
    delete DB.juryScores[roomId][entryKey][jurorId];
    const updatedEntry={...DB.juryScores[roomId][entryKey]};
    try{
      // ★ 用 fbSet 整筆更新（移除此評審 key 後重寫），確保 Firebase 同步
      await new Promise((res,rej)=>{
        try{fbSet('juryScores/'+roomId+'/entries',entryKey,updatedEntry);setTimeout(res,60);}
        catch(e){rej(e);}
      });
    }catch(e){console.warn('[deleteJuror] failed:',entryKey,e);}
  }

  // 清除評審排序快取
  if(DB._jurorOrderCache)delete DB._jurorOrderCache[roomId];

  renderResults();
  renderDeleteJurorBar();
  if(typeof renderAdminResults==='function')renderAdminResults();
  showToast(`已刪除 ${jurorLabel} 的 ${entryKeys.length} 筆評分 ✓`,'ok');
}
window.deleteJurorFromRoom=deleteJurorFromRoom;

function renderAdminResults(){
  return _renderResultsTable({
    bodyId:'ar-body',
    roomFilterId:'ar-room',
    classFilterId:'ar-class',
    allowRoles:['admin'],
    showRealNames:_showRealJurorNames,  // 跟管理員的真實姓名 toggle 連動
    showExportBtn:true,
  });
}
window.renderAdminResults=renderAdminResults;

// ★ 通用的成績總表渲染（管理員 + 學生 + 教師共用，差別在 DOM 容器和是否顯示真實姓名）
function _renderResultsTable(opts){
  const {bodyId,roomFilterId,classFilterId,allowRoles,showRealNames,showExportBtn,returnHtml,forceRoomId,forceClassF}=opts;
  const el=returnHtml?null:document.getElementById(bodyId);
  if(!returnHtml&&!el)return;
  if(allowRoles&&!allowRoles.includes(ST.role)){if(el)el.innerHTML='';return returnHtml?'':undefined;}
  const roomId=forceRoomId!==undefined?forceRoomId:(document.getElementById(roomFilterId)?.value||'');
  const classF=forceClassF!==undefined?forceClassF:(document.getElementById(classFilterId)?.value||'');

  const entries=_buildAdminResultsData(roomId,classF);
  if(!entries.length){
    const emptyHtml='<div class="card" style="text-align:center;padding:36px"><div style="font-size:36px;margin-bottom:10px">📭</div><div style="font-family:\'DM Mono\',monospace;font-size:12px;color:var(--muted)">尚無排程資料</div></div>';
    if(returnHtml)return emptyHtml;
    el.innerHTML=emptyHtml;
    return;
  }
  if(DB._jurorOrderCache)DB._jurorOrderCache={};

  // 取得各考場一致評審順序
  const _getRoomJurorIds=(rId)=>{
    if(!DB._jurorOrderCache)DB._jurorOrderCache={};
    if(!DB._jurorOrderCache[rId]){
      // ★ 問題1：只列出「實際有評分內容」的評審，過濾幽靈
      const validIds=new Set();
      const fieldList=(typeof getRoomFields==='function'?getRoomFields(rId):[{id:'scale'},{id:'assigned'},{id:'free'}]).map(f=>f.id);
      Object.values(DB.juryScores[rId]||{}).forEach(ed=>{
        Object.entries(ed||{}).forEach(([k,data])=>{
          if(k.startsWith('_'))return;
          if(!data||typeof data!=='object')return;
          // ★ 必須「有實際分數或評語」才納入（光有姓名不算，因為刪除分數後姓名可能殘留）
          // ★ 條件：有姓名 OR 有實際分數 OR 有評語 才算有效評審
          //   有姓名但沒分數的：可能是剛登入未打分的評審，仍需顯示在欄位（顯示「未評」）
          //   光是 null 或無姓名無分數的幽靈才會被過濾
          const SYS_KEYS=new Set(['comment','absent']);
          const hasName=data._jurorName&&String(data._jurorName).trim();
          const hasScore=Object.keys(data).some(fk=>{
            if(fk.startsWith('_')||SYS_KEYS.has(fk))return false;
            const v=data[fk];
            return v!==undefined&&v!==''&&v!==null&&v!=='*';
          });
          const hasComment=data.comment&&String(data.comment).trim();
          if(hasName||hasScore||hasComment)validIds.add(k);
        });
      });
      DB._jurorOrderCache[rId]=[...validIds].sort();
    }
    return DB._jurorOrderCache[rId];
  };

  // 各考場前三名
  const roomRankMap={};
  const roomGroups={};
  // ★ 各考場「第一名是否從缺」：第一名須達 80 分，未達則第一名從缺
  const FIRST_PLACE_MIN=80;
  const roomFirstVacant={};
  entries.forEach(e=>{
    if(!roomGroups[e.roomId])roomGroups[e.roomId]=[];
    const ek=e.studentId+'_'+e.type;
    const jurorData=DB.juryScores[e.roomId]?.[ek]||{};
    const scoreArr=_safeJurors(jurorData);
    const isAbsent=scoreArr.some(s=>s.absent);
    const result=scoreArr.length&&!isAbsent?calcFinal(scoreArr,e.roomId,e):{finalScore:null};
    const ded=DB.deductions[ek]||{amount:0};
    const final=result.finalScore!==null?Math.max(0,result.finalScore-(ded.amount||0)):null;
    if(final!==null)roomGroups[e.roomId].push({ek,score:final,name:e.name,class:e.class,seat:e.seat,instName:e.instName,type:e.type});
  });
  Object.entries(roomGroups).forEach(([rId,arr])=>{
    arr.sort((a,b)=>b.score-a.score);
    // ★ 第一名須達 80 分；最高分未達標時，第一名從缺，名次往下遞補
    //   （從缺：原第1名→第2名、原第2名→第3名、原第3名落榜無名次）
    roomFirstVacant[rId]=arr.length>0&&arr[0].score<FIRST_PLACE_MIN;
    if(roomFirstVacant[rId]){
      // 遞補：從第 2 名開始發牌，故第 i 名（0-based）對應名次 i+2，只取前兩位
      arr.slice(0,2).forEach((item,i)=>{roomRankMap[rId+'_'+item.ek]=i+2;});
    } else {
      arr.slice(0,3).forEach((item,i)=>{roomRankMap[rId+'_'+item.ek]=i+1;});
    }
  });
  const rankMedal=['🥇','🥈','🥉'];

  const roomsToShow=roomId?DB.rooms.filter(r=>r.id===roomId):DB.rooms;
  let html='';

  roomsToShow.forEach(room=>{
    const roomEntries=entries.filter(e=>e.roomId===room.id)
      .slice().sort((a,b)=>(a.order||0)-(b.order||0));
    if(!roomEntries.length)return;

    const roomFields=getRoomFields(room.id);
    const jurorIds=_getRoomJurorIds(room.id);
    const jurorCount=jurorIds.length;
    const fieldColspan=jurorCount+1;

    const thBase='padding:5px 6px;font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;font-weight:500;white-space:nowrap;border:1px solid rgba(255,255,255,.15);text-align:center';
    const thLeft='padding:5px 6px;font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1px;font-weight:500;white-space:nowrap;border:1px solid rgba(255,255,255,.15);text-align:left';

    let row1='';
    row1+=`<th rowspan="2" class="st-seq" style="${thBase};min-width:32px">序</th>`;
    row1+=`<th rowspan="2" class="st-name" style="${thLeft};min-width:100px">姓名</th>`;
    row1+=`<th rowspan="2" style="${thBase};min-width:50px">班別</th>`;
    row1+=`<th rowspan="2" style="${thBase};min-width:36px">座號</th>`;
    row1+=`<th rowspan="2" style="${thLeft};min-width:80px">專長樂器</th>`;
    roomFields.forEach(f=>{
      row1+=`<th colspan="${fieldColspan}" style="${thBase};background:rgba(181,137,42,.18)">${f.label}</th>`;
    });
    row1+=`<th rowspan="2" style="${thBase}">扣分</th>`;
    row1+=`<th rowspan="2" style="${thBase};background:rgba(181,137,42,.25)">總平均</th>`;
    row1+=`<th rowspan="2" style="${thBase};min-width:100px">違規事宜</th>`;
    row1+=`<th rowspan="2" style="${thBase};min-width:36px">排名</th>`;
    // 管理員額外欄：各評審姓名（真實）
    if(showRealNames&&jurorIds.length){
      row1+=`<th colspan="${jurorIds.length}" style="${thBase};background:rgba(39,174,96,.2)">評審（真實姓名）</th>`;
    }

    let row2='';
    roomFields.forEach(()=>{
      for(let j=0;j<jurorCount;j++){row2+=`<th style="${thBase};opacity:.8">評審${j+1}</th>`;}
      row2+=`<th style="${thBase};background:rgba(181,137,42,.2)">平均</th>`;
    });
    if(showRealNames&&jurorIds.length){
      jurorIds.forEach((_,j)=>{row2+=`<th style="${thBase};background:rgba(39,174,96,.15)">J${j+1}</th>`;});
    }

    let rows='';
    roomEntries.forEach((e,ei)=>{
      const ek=e.studentId+'_'+e.type;
      const jurorData=DB.juryScores[e.roomId]?.[ek]||{};
      const scoreArr=_safeJurors(jurorData);
      const isAbsent=scoreArr.some(s=>s.absent);
      const isDQ=!!DB.disqualified?.[ek];
      const absentLabel=isDQ?'扣考':'缺考';
      const result=scoreArr.length?calcFinal(scoreArr,e.roomId,e):{finalScore:null,fS:null,fA:null,fF:null,fieldAvgs:{}};
      const ded=DB.deductions[ek]||{amount:0,reason:''};
      const finalWithDed=result.finalScore!==null?Math.max(0,result.finalScore-(ded.amount||0)):null;
      const rank=roomRankMap[room.id+'_'+ek];
      const rowBg=(ei%2===0)?'background:var(--white)':'background:var(--cream)';

      const tdBase=`padding:5px 7px;border:1px solid var(--border);font-size:12px;text-align:center;${rowBg}`;
      const tdLeft=`padding:5px 7px;border:1px solid var(--border);font-size:12px;${rowBg}`;
      const tdNum=`${tdBase};font-family:'DM Mono',monospace;font-size:11px`;

      let scoresCells='';
      roomFields.forEach(f=>{
        // ★ 取得此欄被刪頭刪尾的分數列表（用於畫橫線標示）
        const removedScores=result.detail?.[f.id]?.removed||[];
        // 為了正確處理重複分數，用「次數」追蹤已標記過幾個
        const removedCount={};
        removedScores.forEach(v=>{removedCount[v]=(removedCount[v]||0)+1;});

        jurorIds.forEach(jid=>{
          const s=jurorData[jid];
          const v=s?(s.absent?absentLabel:(s[f.id]!==undefined&&s[f.id]!=='*'?parseFloat(s[f.id]).toFixed(1):'—')):'—';
          const color=(v!=='—'&&v!=='缺考'&&v!=='扣考'&&parseFloat(v)<60)?'color:var(--red)':'';
          // ★ 判斷此分數是否被刪頭刪尾
          let trimMark='';
          if(v!=='—'&&v!=='缺考'&&v!=='扣考'){
            const numV=parseFloat(s[f.id]);
            if(removedCount[numV]>0){
              trimMark='text-decoration:line-through;text-decoration-thickness:2px;text-decoration-color:var(--rust);opacity:.55';
              removedCount[numV]--;  // 標記掉這次出現的，避免下一個重複分數又被標
            }
          }
          scoresCells+=`<td style="${tdNum};${color};${trimMark}" title="${trimMark?'此分數已被刪頭/刪尾排除，不計入平均':''}">${v}</td>`;
        });
        const avg=result.fieldAvgs?.[f.id]??null;
        const avgDisp=isAbsent?(isDQ?'扣考':'0'):(avg!==null?avg.toFixed(2):'—');
        const avgColor=avg!==null&&avg<60?'color:var(--red)':'';
        scoresCells+=`<td style="${tdNum};font-weight:700;background:rgba(181,137,42,.08);${avgColor}">${avgDisp}</td>`;
      });

      const dedAmt=ded.amount?('-'+ded.amount):'';
      const finalDisp=isAbsent?(isDQ?'扣考':'0'):(finalWithDed!==null?finalWithDed.toFixed(2):'—');
      const finalColor=finalWithDed!==null&&finalWithDed<60?'color:var(--red);font-weight:700':'font-weight:700;color:var(--gold)';
      const violation=isDQ?('扣考'+(DB.disqualified[ek]?.reason?'：'+DB.disqualified[ek].reason:'')):(ded.reason||(isAbsent?'缺考':''));
      const rankDisp=rank?rankMedal[rank-1]:'';

      // 管理員額外：評審真實姓名欄
      let jurorNameCells='';
      if(showRealNames&&jurorIds.length){
        jurorIds.forEach(jid=>{
          const name=(DB.juryScores[e.roomId]?.[ek]?.[jid]?._jurorName)||'—';
          jurorNameCells+=`<td style="${tdLeft};font-size:10px;background:rgba(39,174,96,.07)">${escHtml(name)}</td>`;
        });
      }

      rows+=`<tr>
        <td class="st-seq" style="${tdNum}">${String(e.order||ei+1).padStart(2,'0')}</td>
        <td class="st-name" style="${tdLeft};font-weight:600">${escHtml(e.name)}</td>
        <td style="${tdBase}">${escHtml(e.class||'—')}</td>
        <td style="${tdBase}">${escHtml(e.seat||'—')}</td>
        <td style="${tdLeft}">${escHtml(typeName(e.type))} ${escHtml(e.instName)}</td>
        ${scoresCells}
        <td style="${tdNum};color:var(--rust)">${dedAmt}</td>
        <td style="${tdNum};${finalColor}">${finalDisp}</td>
        <td style="${tdLeft};font-size:11px;color:var(--rust)">${escHtml(violation)}</td>
        <td style="${tdBase};font-size:16px">${rankDisp}</td>
        ${jurorNameCells}
      </tr>`;
    });

    // 前三名摘要（第一名從缺時遞補：前兩名得 🥈🥉，原第三名落榜）
    const _firstVacant=roomFirstVacant[room.id];
    const _winners=(roomGroups[room.id]||[]).slice(0,_firstVacant?2:3);
    // 從缺時 medalOffset=1（從 🥈 開始），否則 0（從 🥇 開始）
    const _medalOffset=_firstVacant?1:0;
    const top3Html=_winners.map((item,i)=>`
      <span style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;background:var(--white);border:1px solid var(--border);border-radius:20px;margin:3px 3px 3px 0">
        <span style="font-size:16px">${rankMedal[i+_medalOffset]}</span>
        <strong style="font-size:13px">${escHtml(item.name)}</strong>
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${escHtml(item.class)}·座${escHtml(item.seat)}</span>
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--steel)">${escHtml(typeName(item.type))} ${escHtml(item.instName)}</span>
        <span style="font-family:Cormorant Garamond,serif;font-size:16px;color:var(--gold);font-weight:600">${item.score.toFixed(2)}</span>
      </span>`).join('');

    html+=`
    <div style="margin-bottom:32px">
      <div style="background:var(--ink);color:var(--gold);padding:12px 18px;border-radius:var(--r) var(--r) 0 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-family:Cormorant Garamond,serif;font-size:22px;font-weight:300">${room.name}</span>
        ${room.location?`<span style="font-family:'DM Mono',monospace;font-size:9px;opacity:.6">📍 ${room.location}</span>`:''}
        <span style="font-family:'DM Mono',monospace;font-size:9px;opacity:.5;margin-left:auto">${roomEntries.length} 位出場・${jurorCount} 位評審</span>
        ${showExportBtn?`<button class="btn btn-b btn-xs" onclick="exportAdminResultsCSV(false,'${room.id}')">↓ 匯出此考場</button>`:''}
      </div>
      <div class="score-table-wrap">
        <table class="score-tbl">
          <thead>
            <tr>${row1}</tr>
            <tr>${row2}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="border:1px solid var(--border);border-top:2px solid var(--gold);border-radius:0 0 var(--r) var(--r);padding:10px 14px;background:var(--cream);display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-family:'DM Mono',monospace;font-size:8px;letter-spacing:2px;color:var(--gold);font-weight:700;flex-shrink:0">本考場名次</span>
        ${_winners.length?top3Html:'<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted)">尚無評分資料</span>'}
      </div>
      ${_firstVacant?`<div style="border:1px solid var(--border);border-top:none;border-radius:0 0 var(--r) var(--r);padding:8px 14px;background:var(--white);font-family:'DM Mono',monospace;font-size:10px;color:var(--rust);font-weight:700;letter-spacing:1px">⚠ 未達八十分，第一名從缺</div>`:''}
    </div>`;
  });

  const finalHtml=html||'<p style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:12px;padding:14px">無符合資料</p>';
  if(returnHtml)return finalHtml;
  el.innerHTML=finalHtml;
}
window.renderAdminResults=renderAdminResults;

// ★ 匯出成績總表 PDF：版面與網站「各考場成績總表」相同，可單一考場或全部考場
//   作法：以相同 HTML + CSS 開新視窗，呼叫瀏覽器列印（可選「另存為 PDF」），離線可用、版面一致
function exportAdminResultsPDF(allRooms){
  if(!requireRole('admin'))return;
  const curRoomId=document.getElementById('ar-room')?.value||'';
  const curClassF=document.getElementById('ar-class')?.value||'';
  const targetRoomId=allRooms?'':curRoomId; // 全部=空字串
  const bodyHtml=_renderResultsTable({
    allowRoles:['admin'],
    showRealNames:_showRealJurorNames,
    showExportBtn:false,            // PDF 不放匯出按鈕
    returnHtml:true,
    forceRoomId:targetRoomId,
    forceClassF:allRooms?'':curClassF,
  });
  const title=allRooms?'各考場成績總表（全部）':('成績總表 — '+(DB.rooms.find(r=>r.id===curRoomId)?.name||'目前考場'));
  _openResultsPrintWindow(title, bodyHtml);
}
window.exportAdminResultsPDF=exportAdminResultsPDF;

// 取出目前頁面的 :root CSS 變數，組成列印用樣式（確保 PDF 配色與網站一致）
function _collectRootVars(){
  const names=['--ink','--paper','--cream','--gold','--gold-l','--gold-bg','--rust','--sage','--steel','--muted','--border','--white','--shadow','--r','--red','--green','--blue','--orange'];
  const cs=getComputedStyle(document.documentElement);
  return names.map(n=>`${n}:${cs.getPropertyValue(n).trim()}`).join(';');
}

function _openResultsPrintWindow(title, bodyHtml){
  const rootVars=_collectRootVars();
  const win=window.open('','_print','width=1200,height=800');
  if(!win){showToast('瀏覽器封鎖了彈出視窗，請允許後再試','err');return;}
  // 列印用樣式：移除網站的 sticky/捲動限制，讓表格完整展開分頁列印
  const doc=`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@300;400;500;600;700&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap" rel="stylesheet">
  <style>
    :root{${rootVars}}
    *{box-sizing:border-box}
    body{margin:0;padding:18px 16px;font-family:'Noto Serif TC',serif;color:var(--ink);background:#fff}
    h1.print-title{font-family:'Cormorant Garamond','Noto Serif TC',serif;font-size:22px;font-weight:600;margin:0 0 4px}
    .print-sub{font-family:monospace;font-size:10px;color:var(--muted);margin-bottom:16px}
    .score-table-wrap{overflow:visible !important;max-height:none !important;border:1px solid var(--border);border-top:none}
    .score-tbl{border-collapse:collapse;width:100%;table-layout:auto}
    .score-tbl thead th{position:static !important;background:var(--ink) !important;color:var(--paper) !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .score-tbl .st-seq,.score-tbl .st-name,.score-tbl tbody tr td.st-seq,.score-tbl tbody tr td.st-name{position:static !important;background:inherit}
    .score-tbl thead .st-seq,.score-tbl thead .st-name{background:var(--ink) !important}
    table,tr,td,th{ -webkit-print-color-adjust:exact;print-color-adjust:exact }
    /* 每個考場區塊儘量不要被分頁切斷 */
    .score-table-wrap{page-break-inside:auto}
    tr{page-break-inside:avoid}
    thead{display:table-header-group}
    @page{size:A4 landscape;margin:10mm}
    @media print{ .no-print{display:none} }
    .print-toolbar{position:fixed;top:8px;right:12px;display:flex;gap:8px;z-index:99}
    .print-toolbar button{font-family:'Noto Serif TC',serif;font-size:13px;padding:8px 16px;border:1px solid var(--gold);background:var(--gold);color:#fff;border-radius:4px;cursor:pointer}
    .print-toolbar button.sec{background:#fff;color:var(--ink);border-color:var(--border)}
  </style></head>
  <body>
    <div class="print-toolbar no-print">
      <button onclick="window.print()">🖨 列印／存成 PDF</button>
      <button class="sec" onclick="window.close()">關閉</button>
    </div>
    <h1 class="print-title">${title}</h1>
    <div class="print-sub">${new Date().toLocaleString('zh-TW')}　音樂術科評量系統</div>
    ${bodyHtml}
  </body></html>`;
  win.document.open();
  win.document.write(doc);
  win.document.close();
  // 等內容渲染後自動跳出列印對話框
  win.focus();
  setTimeout(()=>{ try{ win.print(); }catch(e){} }, 600);
}

function exportAdminResultsCSV(allRooms,forceRoomId){
  if(ST.role!=='admin')return;
  const roomId=forceRoomId||(allRooms?'':(document.getElementById('ar-room')?.value||''));
  const classF=allRooms?'':(document.getElementById('ar-class')?.value||'');
  const entries=_buildAdminResultsData(roomId,classF);
  if(!entries.length){showToast('無資料可匯出','err');return;}

  if(DB._jurorOrderCache)DB._jurorOrderCache={};
  const _getRoomJurorIds=(rId)=>{
    if(!DB._jurorOrderCache)DB._jurorOrderCache={};
    if(!DB._jurorOrderCache[rId]){
      // ★ 問題1：只列出「實際有評分內容」的評審，過濾幽靈
      const validIds=new Set();
      const fieldList=(typeof getRoomFields==='function'?getRoomFields(rId):[{id:'scale'},{id:'assigned'},{id:'free'}]).map(f=>f.id);
      Object.values(DB.juryScores[rId]||{}).forEach(ed=>{
        Object.entries(ed||{}).forEach(([k,data])=>{
          if(k.startsWith('_'))return;
          if(!data||typeof data!=='object')return;
          // ★ 必須「有實際分數或評語」才納入（光有姓名不算，因為刪除分數後姓名可能殘留）
          // ★ 條件：有姓名 OR 有實際分數 OR 有評語 才算有效評審
          //   有姓名但沒分數的：可能是剛登入未打分的評審，仍需顯示在欄位（顯示「未評」）
          //   光是 null 或無姓名無分數的幽靈才會被過濾
          const SYS_KEYS=new Set(['comment','absent']);
          const hasName=data._jurorName&&String(data._jurorName).trim();
          const hasScore=Object.keys(data).some(fk=>{
            if(fk.startsWith('_')||SYS_KEYS.has(fk))return false;
            const v=data[fk];
            return v!==undefined&&v!==''&&v!==null&&v!=='*';
          });
          const hasComment=data.comment&&String(data.comment).trim();
          if(hasName||hasScore||hasComment)validIds.add(k);
        });
      });
      DB._jurorOrderCache[rId]=[...validIds].sort();
    }
    return DB._jurorOrderCache[rId];
  };

  // 前三名
  const roomRankMap={};
  const roomGroups={};
  entries.forEach(e=>{
    if(!roomGroups[e.roomId])roomGroups[e.roomId]=[];
    const ek=e.studentId+'_'+e.type;
    const jd=DB.juryScores[e.roomId]?.[ek]||{};
    const sa=Object.values(jd);
    const isAbsent=sa.some(s=>s.absent);
    const r=sa.length&&!isAbsent?calcFinal(sa,e.roomId,e):{finalScore:null};
    const ded=DB.deductions[ek]||{amount:0};
    const fin=r.finalScore!==null?Math.max(0,r.finalScore-(ded.amount||0)):null;
    if(fin!==null)roomGroups[e.roomId].push({ek,score:fin});
  });
  // ★ 第一名須達 80 分；最高分未達標時，第一名從缺，名次往下遞補
  const FIRST_PLACE_MIN=80;
  const roomFirstVacant={};
  Object.entries(roomGroups).forEach(([rId,arr])=>{
    arr.sort((a,b)=>b.score-a.score);
    roomFirstVacant[rId]=arr.length>0&&arr[0].score<FIRST_PLACE_MIN;
    if(roomFirstVacant[rId]){
      arr.slice(0,2).forEach((item,i)=>{roomRankMap[rId+'_'+item.ek]=i+2;});
    } else {
      arr.slice(0,3).forEach((item,i)=>{roomRankMap[rId+'_'+item.ek]=i+1;});
    }
  });
  entries.slice().sort((a,b)=>(a.order||0)-(b.order||0)).forEach((e,i)=>{
    const ek=e.studentId+'_'+e.type;
    const rId=e.roomId;
    const jd=DB.juryScores[rId]?.[ek]||{};
    const jurorIds=_getRoomJurorIds(rId);
    const sa=Object.values(jd);
    const isAbsent=sa.some(s=>s.absent);
    const result=sa.length?calcFinal(sa,rId,e):{finalScore:null,fS:null,fA:null,fF:null,fieldAvgs:{}};
    const ded=DB.deductions[ek]||{amount:0,reason:''};
    const finalWithDed=result.finalScore!==null?Math.max(0,result.finalScore-(ded.amount||0)):null;
    const rank=roomRankMap[rId+'_'+ek];
    const rankLabel={1:'第一名',2:'第二名',3:'第三名'}[rank]||'';
    const roomFields=getRoomFields(rId);

    const row={'序':String(e.order||i+1).padStart(2,'0'),'考場':e.roomName,'班別':e.class,'座號':e.seat,'姓名':e.name,'修別':typeName(e.type),'樂器':e.instName};
    // 各科目各評審
    roomFields.forEach(f=>{
      // ★ 取得此欄被刪頭刪尾的分數列表（CSV 標示「85.0(削)」）
      const removedScores=result.detail?.[f.id]?.removed||[];
      const removedCount={};
      removedScores.forEach(v=>{removedCount[v]=(removedCount[v]||0)+1;});

      jurorIds.forEach((jid,ji)=>{
        const s=jd[jid];
        let v='';
        if(s){
          if(s.absent){v=0;}
          else if(s[f.id]!==undefined&&s[f.id]!=='*'){
            const numV=parseFloat(s[f.id]);
            // ★ 標示被刪頭刪尾的分數
            if(removedCount[numV]>0){
              v=numV.toFixed(1)+'(削)';
              removedCount[numV]--;
            } else {
              v=numV;
            }
          }
        }
        row[`${f.label}_評審${ji+1}`]=v;
      });
      const avg=result.fieldAvgs?.[f.id]??null;
      row[`${f.label}_平均`]=isAbsent?0:(avg!==null?avg.toFixed(2):'');
    });
    row['扣分']=ded.amount||0;
    row['扣分原因']=ded.reason||'';
    row['總平均']=isAbsent?0:(finalWithDed!==null?finalWithDed.toFixed(2):'');
    row['排名']=rankLabel;
    rows.push(row);
  });

  const fname=(classF?classF+'_':'')+(roomId?(DB.rooms.find(r=>r.id===roomId)?.name||'')+'_':'全考場_')+'成績總表';
  exportCSV(rows,fname);
  showToast('已匯出 CSV ✓','ok');
}
window.exportAdminResultsCSV=exportAdminResultsCSV;
// ★ 共用：格式化考場日期時間顯示
function _fmtRoomDatetime(room){
  const weekdays=['日','一','二','三','四','五','六'];
  const fmt=(iso)=>{
    if(!iso)return null;
    const d=new Date(iso);
    if(isNaN(d))return null;
    const wk=weekdays[d.getDay()];
    const mo=String(d.getMonth()+1).padStart(2,'0');
    const da=String(d.getDate()).padStart(2,'0');
    const hr=String(d.getHours()).padStart(2,'0');
    const mn=String(d.getMinutes()).padStart(2,'0');
    return d.getFullYear()+'／'+mo+'／'+da+'（'+wk+'）'+hr+':'+mn;
  };
  const s=fmt(room.dateStart);
  const e=fmt(room.dateEnd);
  if(s&&e)return '📅 '+s+' ～ '+e;
  if(s)return '📅 '+s;
  return null;
}

function renderTeaSchedulePage(){
  const msgDiv=document.getElementById('tea-schedule-access-msg');
  const contentDiv=document.getElementById('tea-schedule-content');
  if(!msgDiv||!contentDiv)return;
  const hasAccess=DB.config.teacherAccess['tea-schedule']!==false;
  if(!hasAccess){
    msgDiv.style.display='block';contentDiv.style.display='none';
    const txt=document.getElementById('tea-schedule-msg-text');
    const msg=DB.config.teacherScheduleClosedMsg||DB.config.pages['schedule']?.announce||'考試排程尚未開放查看，請等候管理員公告。';
    if(txt)txt.textContent=msg;
    return;
  }
  msgDiv.style.display='none';contentDiv.style.display='block';
  const btnContainer=document.getElementById('tea-schedule-room-btns');
  if(btnContainer){
    btnContainer.innerHTML='<button class="btn btn-p btn-sm" onclick="teaSchSelectRoom(\'\',this)">全部考場</button>'+
      DB.rooms.map(r=>`<button class="btn btn-s btn-sm" onclick="teaSchSelectRoom('${r.id}',this)">${r.name}</button>`).join('');
  }
  teaSchSelectRoom('',null);
}
window.renderTeaSchedulePage=renderTeaSchedulePage;

let _teaSchActiveRoom='';
function teaSchSelectRoom(roomId,btn){
  _teaSchActiveRoom=roomId;
  // highlight button
  const bc=document.getElementById('tea-schedule-room-btns');
  if(bc){bc.querySelectorAll('button').forEach(b=>{b.className='btn btn-s btn-sm';});if(btn){btn.className='btn btn-p btn-sm';} else {const first=bc.querySelector('button');if(first)first.className='btn btn-p btn-sm';}}
  // 顯示考場時間資訊
  const _infoDiv=document.getElementById('tea-schedule-room-info');
  const _infoText=document.getElementById('tea-schedule-room-info-text');
  if(_infoDiv&&_infoText){
    const _snap2=DB.savedScheduleSnapshot||{};
    const _hasSnap2=Object.values(_snap2).some(arr=>arr&&arr.length>0);
    if(roomId){
      const _r=DB.rooms.find(r=>r.id===roomId);
      if(_r){
        const dt=_fmtRoomDatetime(_r);
        const loc=_r.location?'📍 '+_r.location:'';
        const lines=[dt,loc].filter(Boolean);
        if(lines.length){_infoText.innerHTML='<strong>'+escHtml(_r.name)+'</strong>　'+lines.map(l=>escHtml(l)).join('　');_infoDiv.style.display='block';}
        else{_infoDiv.style.display='none';}
      } else {_infoDiv.style.display='none';}
    } else {
      const _activeRooms=_hasSnap2?DB.rooms.filter(r=>(_snap2[r.id]||[]).length>0):DB.rooms;
      const lines=_activeRooms.map(r=>{const dt=_fmtRoomDatetime(r);return dt?('<strong>'+escHtml(r.name)+'</strong>　'+escHtml(dt)+(r.location?'　📍 '+escHtml(r.location):'')):'';}).filter(Boolean);
      if(lines.length){_infoText.innerHTML=lines.join('<br>');_infoDiv.style.display='block';}
      else{_infoDiv.style.display='none';}
    }
  }

  const tbody=document.getElementById('tea-sched-tbody');if(!tbody)return;

  // ★ Bug2 修正：優先使用已存檔的排程快照，讓各考場篩選正確反映管理員設定的排程
  const snap=DB.savedScheduleSnapshot||{};
  const hasSnap=Object.values(snap).some(arr=>arr&&arr.length>0);
  let entries=[];
  if(hasSnap){
    if(roomId){
      // 單一考場：直接取該考場快照，依序號排序
      entries=(snap[roomId]||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0));
      entries.forEach((e,i)=>{
        const room=DB.rooms.find(r=>r.id===roomId);
        e._roomName=e.roomName||room?.name||roomId;
        e._roomLoc=e.roomLocation||room?.location||'';
        e._displayOrder=e.order||i+1;
      });
    } else {
      // 全部考場：依考場順序合併，每個考場序號獨立
      DB.rooms.forEach(r=>{
        (snap[r.id]||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0)).forEach(e=>{
          entries.push({...e,_roomName:e.roomName||r.name,_roomLoc:e.roomLocation||r.location||'',_displayOrder:e.order||0});
        });
      });
      // 未在任何 DB.rooms 的快照也補上
      Object.keys(snap).forEach(rid=>{
        if(DB.rooms.find(r=>r.id===rid))return;
        (snap[rid]||[]).forEach(e=>{entries.push({...e,_roomName:e.roomName||rid,_roomLoc:e.roomLocation||'',_displayOrder:e.order||0});});
      });
    }
  } else {
    // 快照不存在時 fallback 到記憶體排程
    entries=getScheduleEntries();
    if(roomId)entries=entries.filter(e=>e.roomId===roomId);
    entries.forEach(e=>{e._roomName=e.roomName;e._roomLoc=e.roomLocation||'';e._displayOrder=e.order||0;});
  }

  tbody.innerHTML=entries.map(e=>{
    const {ac,at,fc,ft}=_getEntryRep(e);
    return `<tr>
    <td style="font-family:'DM Mono',monospace;color:var(--ink);font-weight:600">${e._displayOrder}</td>
    <td style="color:var(--ink)">${escHtml(e._roomName)}</td>
    <td style="color:var(--ink);font-family:'DM Mono',monospace;font-size:11px">${escHtml(e._roomLoc||'—')}</td>
    <td style="color:var(--ink)">${escHtml(e.class)}</td>
    <td style="color:var(--ink);font-weight:600">${escHtml(e.name)}${_dqBadgeHtml(e.studentId,e.type)}</td>
    <td style="color:var(--ink)">${escHtml(e.instName)}</td>
    <td>${typeBadge(e.type)}</td>
    <td style="font-size:12px;color:var(--ink)">${ac?escHtml(ac)+' — <em>'+escHtml(at)+'</em>':'—'}</td>
    <td style="font-size:12px;color:var(--ink)">${fc?escHtml(fc)+' — <em>'+escHtml(ft)+'</em>':'—'}</td>
  </tr>`;}).join('')||'<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:20px;font-family:\'DM Mono\',monospace;font-size:12px">查無資料（請確認管理員已存檔排程）</td></tr>';
}
window.teaSchSelectRoom=teaSchSelectRoom;

// ════════════════════════════════════════════════
// STATS
// ════════════════════════════════════════════════
function updateStats(){
  const stus=students();const done=stus.filter(s=>s.repDone).length;
  document.getElementById('stat-s').textContent=stus.length;
  document.getElementById('stat-r').textContent=done;
  document.getElementById('stat-t').textContent=teachers().length;
  // ★ 每次更新統計時同步更新連動警告
  if(ST.role==='admin'){_renderAdminLinkageWarnings();renderAdminInstChangeNotices();}
}

// ════════════════════════════════════════════════
// ★ 需求1：學生樂器異動通知渲染
// ════════════════════════════════════════════════
function renderAdminInstChangeNotices(){
  const panel=document.getElementById('admin-inst-change-panel');
  if(!panel)return;
  const notices=Object.values(DB.repInstChanges||{}).filter(n=>!n.read);
  if(!notices.length){panel.innerHTML='';return;}
  panel.innerHTML=`<div style="background:#fff3cd;border:1px solid #ffc107;border-left:4px solid var(--gold);border-radius:var(--r);padding:14px 16px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <div style="font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px;color:#856404;font-weight:700">⚠ 學生樂器填報與管理員設定不符（共 ${notices.length} 筆）</div>
      <button class="btn btn-s btn-xs" onclick="markAllInstChangesRead()">全部標為已讀</button>
    </div>
    ${notices.map(n=>`
      <div style="background:#fff;border:1px solid #ffc107;border-radius:var(--r);padding:10px 12px;margin-bottom:6px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div>
          <strong>${n.studentName}</strong>
          <span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-left:6px">${n.class||''}·座${n.seat||''}</span>
          <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);margin-left:6px">${new Date(n.at).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
          <div style="margin-top:5px">
            ${(n.changes||[]).map(c=>`
              <div style="font-size:12px;margin-bottom:2px">
                <span style="font-family:'DM Mono',monospace;font-size:8px;color:var(--steel);background:var(--cream);padding:1px 6px;border-radius:10px;margin-right:4px">${c.label}</span>
                <span style="color:var(--rust)">原設定：${c.from}</span>
                <span style="margin:0 4px;color:var(--muted)">→</span>
                <span style="color:var(--sage);font-weight:600">學生填報：${c.to}</span>
              </div>`).join('')}
          </div>
        </div>
        <button class="btn btn-s btn-xs" onclick="markInstChangeRead('${n.studentId}')">已讀</button>
      </div>`).join('')}
  </div>`;
}
window.renderAdminInstChangeNotices=renderAdminInstChangeNotices;

function markInstChangeRead(studentId){
  // 找對應的 key
  const key=Object.keys(DB.repInstChanges||{}).find(k=>DB.repInstChanges[k].studentId===studentId);
  if(!key)return;
  DB.repInstChanges[key].read=true;
  fbSet('repInstChanges',key,{...DB.repInstChanges[key],read:true});
  renderAdminInstChangeNotices();
}
window.markInstChangeRead=markInstChangeRead;

function markAllInstChangesRead(){
  Object.keys(DB.repInstChanges||{}).forEach(key=>{
    if(!DB.repInstChanges[key].read){
      DB.repInstChanges[key].read=true;
      fbSet('repInstChanges',key,{...DB.repInstChanges[key],read:true});
    }
  });
  renderAdminInstChangeNotices();
  showToast('已全部標為已讀 ✓','ok');
}
window.markAllInstChangesRead=markAllInstChangesRead;

// ════════════════════════════════════════════════
// ★ 管理員連動診斷系統：主動偵測資料異常並警告
// ════════════════════════════════════════════════
function _renderAdminLinkageWarnings(){
  // 找或建立警告面板（掛在管理後台頁面頂部）
  let panel=document.getElementById('admin-linkage-warn-panel');
  if(!panel){
    const adminPg=document.getElementById('pg-admin');
    if(!adminPg)return;
    panel=document.createElement('div');
    panel.id='admin-linkage-warn-panel';
    panel.style.cssText='margin-bottom:16px';
    // 插在 pg-admin 的第一個子元素前
    adminPg.insertBefore(panel,adminPg.firstChild);
  }

  const warnings=[];
  const stus=students();
  const allClasses=DB.classes;
  const allInsts=DB.instruments.items;
  const allCats=DB.instruments.categories;

  // ① 學生班級不在班級列表中
  const badClass=stus.filter(s=>s.class&&!allClasses.includes(s.class));
  if(badClass.length){
    warnings.push({lvl:'err',msg:`⚠️ 有 ${badClass.length} 名學生的班級（${[...new Set(badClass.map(s=>s.class))].join('、')}）不在班級列表中，可能導致排程/篩選異常`,list:badClass.map(s=>s.name).slice(0,5)});
  }

  // ② 學生樂器 ID 不在樂器列表中
  const badInst=[];
  stus.forEach(s=>{
    ['major','minor','elective'].forEach(t=>{
      if(s[t]&&!allInsts.find(i=>i.id===s[t])){
        badInst.push({name:s.name,type:t,instId:s[t]});
      }
    });
  });
  if(badInst.length){
    warnings.push({lvl:'err',msg:`⚠️ 有 ${badInst.length} 筆學生樂器 ID 已失效（樂器可能已被刪除），將影響排程出場`,list:badInst.map(x=>`${x.name}(${x.type})`).slice(0,5)});
  }

  // ③ 樂器沒有對應大項（cat 失效）
  const badCatInst=allInsts.filter(i=>i.cat&&!allCats.find(c=>c.id===i.cat));
  if(badCatInst.length){
    warnings.push({lvl:'warn',msg:`⚠️ 有 ${badCatInst.length} 個樂器的大項類別已失效：${badCatInst.map(i=>i.name).join('、')}`,list:[]});
  }

  // ④ 考場沒有分配到任何學生
  if(DB.rooms.length>1){
    DB.rooms.forEach(room=>{
      const hasStu=stus.some(s=>{
        const rc=room.catMap||room.allowedCats||[];
        if(!rc.length)return true; // 無限制
        return ['major','minor','elective'].some(t=>{
          if(!s[t])return false;
          const inst=allInsts.find(i=>i.id===s[t]);
          return inst&&rc.includes(inst.cat);
        });
      });
      if(!hasStu&&room.allowedCats?.length){
        warnings.push({lvl:'info',msg:`ℹ️ 考場「${room.name}」目前無任何符合條件的學生（請確認樂器大項設定）`,list:[]});
      }
    });
  }

  // ⑤ 有學生已填曲目但樂器失效
  const repDoneNoInst=stus.filter(s=>s.repDone&&['major','minor','elective'].some(t=>s[t]&&!allInsts.find(i=>i.id===s[t])));
  if(repDoneNoInst.length){
    warnings.push({lvl:'err',msg:`⚠️ ${repDoneNoInst.length} 名學生已完成曲目填寫，但其樂器資料失效，成績與排程可能錯誤`,list:repDoneNoInst.map(s=>s.name).slice(0,5)});
  }

  // ⑥ 手動加入名單中有學生已不存在於系統
  const missingExtra=SCH_STATE.extraEntries.filter(ex=>!DB.users.find(u=>u.id===ex.studentId));
  if(missingExtra.length){
    warnings.push({lvl:'err',msg:`⚠️ 排程中有 ${missingExtra.length} 筆手動加入的學生已不存在（帳號可能已刪除），建議重新產生排程`,list:[]});
  }

  // 渲染
  if(!warnings.length){
    panel.innerHTML='';
    return;
  }

  panel.innerHTML=`<div style="margin-bottom:12px">
    <div style="font-family:DM Mono,monospace;font-size:9px;letter-spacing:2px;color:var(--rust);text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:6px">
      <span>⚑</span> 系統連動警告（${warnings.length} 項）
      <button onclick="this.closest('#admin-linkage-warn-panel').querySelectorAll('.warn-item').forEach(e=>e.style.display=e.style.display==='none'?'':'none')" style="margin-left:auto;font-family:DM Mono,monospace;font-size:8px;padding:2px 8px;border:1px solid var(--rust);background:none;border-radius:3px;cursor:pointer;color:var(--rust)">展開/收合</button>
    </div>
    ${warnings.map(w=>`
      <div class="warn-item" style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;margin-bottom:6px;border-radius:3px;border-left:3px solid ${w.lvl==='err'?'var(--rust)':w.lvl==='warn'?'var(--orange)':'var(--steel)'};background:${w.lvl==='err'?'#fff5f5':w.lvl==='warn'?'#fffbf0':'#f0f5ff'}">
        <div style="flex:1;font-family:DM Mono,monospace;font-size:10px;color:var(--ink);line-height:1.7">
          ${w.msg}
          ${w.list.length?`<span style="color:var(--muted)">（${w.list.join('、')}${w.list.length>=5?' …等':''}）</span>`:''}
        </div>
      </div>`).join('')}
  </div>`;
}

// ════════════════════════════════════════════════
// DRAG & DROP
// ════════════════════════════════════════════════
function setupDrag(el,container){
  el.addEventListener('dragstart',e=>{el.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
  el.addEventListener('dragend',()=>{
    el.classList.remove('dragging');
    // ★ 修正：拖曳結束後，記錄當前 DOM 順序到 SCH_STATE.manualOrder
    _saveManualOrder(container);
  });
  el.addEventListener('dragover',e=>{e.preventDefault();const after=getDragAfter(container,e.clientY);const dr=container.querySelector('.dragging');if(after)container.insertBefore(dr,after);else container.appendChild(dr);renumberItems(container);});
}
// ★ 新增：把當前畫面上的順序記錄到 SCH_STATE.manualOrder（陣列：[entryKey1, entryKey2, ...]）
function _saveManualOrder(container){
  if(!container)return;
  if(typeof SCH_STATE==='undefined'||!SCH_STATE)return;
  const items=[...container.querySelectorAll('.exam-item')];
  if(!items.length)return;
  const order=[];
  items.forEach(item=>{
    // 從按鈕的 onclick 解析 studentId 和 type
    const removeBtn=item.querySelector('button[onclick^="schRemoveEntry"]');
    if(removeBtn){
      const m=removeBtn.getAttribute('onclick').match(/schRemoveEntry\('([^']+)'\)/);
      if(m)order.push(m[1]); // entryKey = studentId_type
    }
  });
  SCH_STATE.manualOrder=order;
  if(_SCH_ROOM_STATES[SCH_STATE.roomId]){
    _SCH_ROOM_STATES[SCH_STATE.roomId].manualOrder=order;
  }
  console.log('[schedule] 已記錄手動排序',order.length,'筆，記得按「儲存排程」才會生效');
}
function getDragAfter(container,y){
  return [...container.querySelectorAll('.exam-item:not(.dragging)')].reduce((cl,el)=>{
    const box=el.getBoundingClientRect();const offset=y-box.top-box.height/2;
    return offset<0&&offset>cl.offset?{offset,element:el}:cl;
  },{offset:Number.NEGATIVE_INFINITY}).element;
}
function renumberItems(container){container.querySelectorAll('.ei-num').forEach((el,i)=>el.textContent=String(i+1).padStart(2,'0'));}

// ════════════════════════════════════════════════
// NUMPAD
// ════════════════════════════════════════════════
function openNP(targetId,label,callback){
  // ★ 修正 #FE2：防止重複開啟
  const overlay=document.getElementById('np-overlay');
  if(overlay?.classList.contains('on'))return;
  ST.npTarget=targetId;
  ST.npVal=document.getElementById(targetId)?.value||'';
  ST.npCallback=callback;
  document.getElementById('np-lbl').textContent=label;
  document.getElementById('np-disp').textContent=ST.npVal||'—';
  overlay?.classList.add('on');
}
function npBg(e){if(e.target===document.getElementById('np-overlay'))document.getElementById('np-overlay').classList.remove('on');}
function npKey(k){if(k==='.'&&ST.npVal.includes('.'))return;if(ST.npVal.length>=5)return;ST.npVal+=k;document.getElementById('np-disp').textContent=ST.npVal;}
function npDel(){ST.npVal=ST.npVal.slice(0,-1);document.getElementById('np-disp').textContent=ST.npVal||'—';}
function npConfirm(){
  if(ST.npVal==='*'){
    // ★ #6 星號表示此項不評，儲存為字串 '*'
    const inp=document.getElementById(ST.npTarget);if(inp){inp.value='*';inp.style.color='var(--orange)';}
    if(ST.npCallback)ST.npCallback('*');
  } else {
    const val=parseFloat(ST.npVal);
    // ★ 硬上限：所有分數一律不得超過 95 分（直接擋下，不進審核）
    const HARD_CAP=DB.config.hardCap||95;
    if(!isNaN(val)&&val>HARD_CAP){
      showToast('分數不得超過 '+HARD_CAP+' 分，請重新輸入','err');
      ST.npVal='';
      document.getElementById('np-disp').textContent='—';
      return;
    }
    if(!isNaN(val)&&val>=0&&val<=HARD_CAP){
      // ★ 先寫入分數（立刻生效）
      const inp=document.getElementById(ST.npTarget);if(inp){inp.value=val;inp.style.color='';}
      if(ST.npCallback)ST.npCallback(val);
      // ★ 現場評分超過該生年級分數上限：背景送審 + 請評審填理由（暫以上限計分）
      const isJuryCell=typeof ST.npTarget==='string'&&ST.npTarget.startsWith('js-');
      if(isJuryCell && ST.role!=='admin'){
        const m=ST.npTarget.match(/^js-(.+)-(\d+)$/);
        if(m){
          const field=m[1];
          const i=parseInt(m[2]);
          const roomId=ST.juryRoom?.id||(ST._adminJuryRoomId||DB.rooms[0]?.id||'');
          const entries=getJuryEntries();
          const e=entries[i];
          const cap=_scoreCapForEntry(e);
          if(e&&roomId&&val>cap){
            const entryKey=e.studentId+'_'+e.type;
            const jurorId=ST.juryId||ST.user?.id||'admin';
            const pendingId='jury_'+roomId+'_'+entryKey+'_'+jurorId+'_'+field;
            const existing=DB.pendingApprovals?.[pendingId];
            // 已有相同分數的待審紀錄 → 跳過避免重複打擾
            if(!(existing && existing.status==='pending' && existing.score===val)){
              // 關閉 numpad 後再開理由視窗
              document.getElementById('np-overlay').classList.remove('on');ST.npVal='';
              openHighScoreReasonModal({
                kind:'jury',
                score:val,
                cap:cap,
                roomId:roomId,
                entryKey:entryKey,
                jurorId:jurorId,
                field:field,
                entryIndex:i,
                pendingId:pendingId,
                targetId:ST.npTarget,
              });
              return;
            }
          }
        }
      }
    }
  }
  document.getElementById('np-overlay').classList.remove('on');ST.npVal='';
}
// ★ #6 評審可直接在分數格輸入 * 表示此項不評
function npStar(){
  ST.npVal='*';
  document.getElementById('np-disp').textContent='*';
}
window.npStar=npStar;


// ════════════════════════════════════════════════
// HIGH SCORE APPROVAL — 90分以上需審核
// ════════════════════════════════════════════════
// 暫存待送出的審核資料（reason modal 確認後送出）
let _hsReasonCtx=null;
// ★ 理由 modal 關閉後要執行的後續動作（例如：跳下一位、結束 wizard）
let _hsAfterReason=null;

// ★ 在 juryScores 上標記「此欄分數待審，暫以上限計分」並寫回 Firebase
function _markJuryPendingCap(roomId,entryKey,jurorId,field,cap){
  if(!DB.juryScores[roomId])DB.juryScores[roomId]={};
  if(!DB.juryScores[roomId][entryKey])DB.juryScores[roomId][entryKey]={};
  if(!DB.juryScores[roomId][entryKey][jurorId])DB.juryScores[roomId][entryKey][jurorId]={};
  // ★ 確保 _jurorName 存在，避免被自動清理視為無姓名記錄
  if(!DB.juryScores[roomId][entryKey][jurorId]._jurorName){
    const _jn=ST.juryName||ST.user?.name||'';
    if(_jn)DB.juryScores[roomId][entryKey][jurorId]._jurorName=_jn;
  }
  DB.juryScores[roomId][entryKey][jurorId][field+'_pendingCap']=cap;
  const patch={};patch[jurorId]={...DB.juryScores[roomId][entryKey][jurorId]};
  if(window._FB)window._FB._set('juryScores/'+roomId+'/entries/'+entryKey,patch);
}
window._markJuryPendingCap=_markJuryPendingCap;

// 開啟理由輸入彈窗
function openHighScoreReasonModal(ctx){
  _hsReasonCtx=ctx;
  // 顯示分數與情境
  const lblScore=document.getElementById('hs-reason-score');
  const lblTitle=document.getElementById('hs-reason-title');
  const lblTarget=document.getElementById('hs-reason-target');
  if(lblScore)lblScore.textContent=ctx.score;
  if(lblTitle)lblTitle.textContent=ctx.kind==='teacher'?'平時評量分數達 90 分（含）以上':'現場評分超過年級評分上限';
  const capEl=document.getElementById('hs-reason-cap');
  if(capEl)capEl.textContent=(ctx.cap!=null?ctx.cap:'');
  const descEl=document.getElementById('hs-reason-desc');
  if(descEl){
    if(ctx.kind==='teacher'){
      descEl.innerHTML='您給予的分數達 90 分（含）以上（分數已儲存）。<br>依本系統規定，達 90 分（含）以上的分數需向管理員<strong>提供具體理由說明</strong>，請於下方填寫您給予此分數的理由：';
    } else {
      descEl.innerHTML='您給予的分數超過該生年級的評分上限（分數已暫存）。<br>依本系統規定，超過上限的分數需向管理員<strong>提供具體理由說明</strong>並經審核通過，否則此項將暫以 <strong>'+(ctx.cap!=null?ctx.cap:'')+'</strong> 分（該年級上限）計分，請於下方填寫您給予此分數的理由：';
    }
  }
  // 描述對象（學生姓名）
  let targetTxt='';
  if(ctx.kind==='teacher'){
    const s=DB.users.find(u=>u.id===ctx.sid);
    if(s)targetTxt=`學生：${s.name}（${s.class}·座${s.seat}）／${typeName(ctx.scoreType)}`;
  } else {
    const entries=getJuryEntries();
    const e=entries[ctx.entryIndex];
    if(e)targetTxt=`學生：${e.name}（${e.class}·座${e.seat}）／${typeName(e.type)} — 欄位：${ctx.field}`;
  }
  if(lblTarget)lblTarget.textContent=targetTxt;
  document.getElementById('hs-reason-text').value='';
  document.getElementById('hs-reason-err').textContent='';
  openOverlay('hs-reason-modal');
  setTimeout(()=>{document.getElementById('hs-reason-text')?.focus();},100);
}
window.openHighScoreReasonModal=openHighScoreReasonModal;

// 取消理由輸入（不填理由，但分數已生效 — 仍登記一筆待審紀錄）
function closeHighScoreReasonModal(){
  // ★ 若有 ctx 但教師選擇不填，仍登記一筆「未填理由」的待審紀錄
  //   讓管理員能看到並做事後審核
  if(_hsReasonCtx){
    const ctx=_hsReasonCtx;
    // 只在尚無此紀錄時才登記（避免覆寫已有理由）
    const exist=DB.pendingApprovals?.[ctx.pendingId];
    if(!(exist && exist.status==='pending' && exist.score===ctx.score)){
      const submittedBy=ST.user?.id||ST.juryId||'unknown';
      const submittedByName=ST.user?.name||ST.juryName||'未知';
      const record={
        kind:ctx.kind,
        score:ctx.score,
        reason:'（未填寫理由）',
        status:'pending',
        submittedBy:submittedBy,
        submittedByName:submittedByName,
        submittedAt:new Date().toISOString(),
        reviewedAt:null,
        reviewedBy:null,
      };
      if(ctx.kind==='teacher'){
        record.sid=ctx.sid;
        record.scoreType=ctx.scoreType;
        record.comment=ctx.comment||'';
      } else {
        record.roomId=ctx.roomId;
        record.entryKey=ctx.entryKey;
        record.jurorId=ctx.jurorId;
        record.field=ctx.field;
        record.cap=ctx.cap;
      }
      DB.pendingApprovals[ctx.pendingId]=record;
      fbSet('pendingApprovals',ctx.pendingId,record);
      if(ctx.kind==='jury')_markJuryPendingCap(ctx.roomId,ctx.entryKey,ctx.jurorId,ctx.field,ctx.cap);
    }
  }
  closeOverlay('hs-reason-modal');
  _hsReasonCtx=null;
  // ★ 執行後續動作（跳下一位 / 結束 wizard）
  if(typeof _hsAfterReason==='function'){
    const fn=_hsAfterReason;
    _hsAfterReason=null;
    setTimeout(fn,50);
  }
}
window.closeHighScoreReasonModal=closeHighScoreReasonModal;

// 確認送出審核
function submitHighScoreReason(){
  if(!_hsReasonCtx){closeOverlay('hs-reason-modal');return;}
  const reason=document.getElementById('hs-reason-text').value.trim();
  if(reason.length<5){
    document.getElementById('hs-reason-err').textContent='請填寫至少 5 個字的具體理由';
    return;
  }
  const ctx=_hsReasonCtx;
  const submittedBy=ST.user?.id||ST.juryId||'unknown';
  const submittedByName=ST.user?.name||ST.juryName||'未知';
  const now=new Date().toISOString();
  const record={
    kind:ctx.kind,
    score:ctx.score,
    reason:reason,
    status:'pending',
    submittedBy:submittedBy,
    submittedByName:submittedByName,
    submittedAt:now,
    reviewedAt:null,
    reviewedBy:null,
  };
  if(ctx.kind==='teacher'){
    record.sid=ctx.sid;
    record.scoreType=ctx.scoreType;
    record.comment=ctx.comment||'';
  } else {
    record.roomId=ctx.roomId;
    record.entryKey=ctx.entryKey;
    record.jurorId=ctx.jurorId;
    record.field=ctx.field;
    record.cap=ctx.cap;
  }
  DB.pendingApprovals[ctx.pendingId]=record;
  fbSet('pendingApprovals',ctx.pendingId,record);
  if(ctx.kind==='jury')_markJuryPendingCap(ctx.roomId,ctx.entryKey,ctx.jurorId,ctx.field,ctx.cap);
  closeOverlay('hs-reason-modal');
  _hsReasonCtx=null;
  // ★ 分數已暫存，平均計算將暫以上限計分，待管理員審核
  showToast('已送出，待管理員審核期間將暫以上限計分 ✓','ok');
  // ★ 執行後續動作（例如跳下一位學生、結束 wizard）
  if(typeof _hsAfterReason==='function'){
    const fn=_hsAfterReason;
    _hsAfterReason=null;
    setTimeout(fn,50); // 讓 modal 先收乾淨再執行後續
  }
}
window.submitHighScoreReason=submitHighScoreReason;

// 管理員：核准（同意此分數 — 分數已生效，僅標記狀態）
function approvePendingScore(pendingId){
  const rec=DB.pendingApprovals?.[pendingId];
  if(!rec){showToast('找不到審核紀錄','err');return;}
  if(rec.status!=='pending'){showToast('此紀錄已處理','warn');return;}
  rec.status='approved';
  rec.reviewedAt=new Date().toISOString();
  rec.reviewedBy=ST.user?.id||'admin';
  rec.reviewedByName=ST.user?.name||'管理員';
  fbSet('pendingApprovals',pendingId,rec);
  // ★ 分數已在打分當下寫入，這裡只標記為已同意
  //   但為安全起見，若實際分數已被改動（例如被本人重打），則同步回原核准分數
  if(rec.kind==='teacher'){
    const cur=DB.teacherComments[rec.sid]?.[rec.scoreType]?.score;
    if(cur!==rec.score){
      if(!DB.teacherComments[rec.sid])DB.teacherComments[rec.sid]={};
      DB.teacherComments[rec.sid][rec.scoreType]={
        score:rec.score,
        comment:DB.teacherComments[rec.sid][rec.scoreType]?.comment||rec.comment||'',
      };
      fbSet('teacherComments',rec.sid,{...DB.teacherComments[rec.sid]});
      const s=DB.users.find(u=>u.id===rec.sid);
      if(s){
        const types=['major','minor','elective'].filter(k=>s[k]);
        s.teaDone=types.some(k=>DB.teacherComments[rec.sid]?.[k]?.score!==undefined);
        fbSet('users',s.id,s);
      }
    }
  } else if(rec.kind==='jury'){
    if(!DB.juryScores[rec.roomId])DB.juryScores[rec.roomId]={};
    if(!DB.juryScores[rec.roomId][rec.entryKey])DB.juryScores[rec.roomId][rec.entryKey]={};
    if(!DB.juryScores[rec.roomId][rec.entryKey][rec.jurorId])DB.juryScores[rec.roomId][rec.entryKey][rec.jurorId]={};
    const s=DB.juryScores[rec.roomId][rec.entryKey][rec.jurorId];
    s[rec.field]=rec.score;
    delete s[rec.field+'_skip'];
    // ★ 審核通過：解除「暫以上限計分」，恢復評審原始分數
    delete s[rec.field+'_pendingCap'];
    s._localUpdatedAt=Date.now();
    const patch={};patch[rec.jurorId]={...s};
    if(window._FB)window._FB._set('juryScores/'+rec.roomId+'/entries/'+rec.entryKey,patch);
  }
  showToast('已同意，採用評審原始分數 ✓','ok');
  renderPendingApprovalsPage();
}
window.approvePendingScore=approvePendingScore;

// 管理員：拒絕（不同意，給 89 分上限）
function rejectPendingScore(pendingId){
  const rec=DB.pendingApprovals?.[pendingId];
  if(!rec){showToast('找不到審核紀錄','err');return;}
  if(rec.status!=='pending'){showToast('此紀錄已處理','warn');return;}
  if(!confirm('確定拒絕此分數？\n系統將自動以該生年級評分上限（'+(rec.cap??89)+' 分）寫入。')){return;}
  rec.status='rejected';
  rec.reviewedAt=new Date().toISOString();
  rec.reviewedBy=ST.user?.id||'admin';
  rec.reviewedByName=ST.user?.name||'管理員';
  rec.finalScore=rec.cap??89; // 強制改為年級評分上限
  fbSet('pendingApprovals',pendingId,rec);
  // 將 89 分寫入對應集合
  if(rec.kind==='teacher'){
    if(!DB.teacherComments[rec.sid])DB.teacherComments[rec.sid]={};
    DB.teacherComments[rec.sid][rec.scoreType]={score:89,comment:rec.comment||''};
    fbSet('teacherComments',rec.sid,{...DB.teacherComments[rec.sid]});
    const s=DB.users.find(u=>u.id===rec.sid);
    if(s){
      const types=['major','minor','elective'].filter(k=>s[k]);
      s.teaDone=types.some(k=>DB.teacherComments[rec.sid]?.[k]?.score!==undefined);
      fbSet('users',s.id,s);
    }
  } else if(rec.kind==='jury'){
    if(!DB.juryScores[rec.roomId])DB.juryScores[rec.roomId]={};
    if(!DB.juryScores[rec.roomId][rec.entryKey])DB.juryScores[rec.roomId][rec.entryKey]={};
    if(!DB.juryScores[rec.roomId][rec.entryKey][rec.jurorId])DB.juryScores[rec.roomId][rec.entryKey][rec.jurorId]={};
    const s=DB.juryScores[rec.roomId][rec.entryKey][rec.jurorId];
    const cap=rec.cap??89;
    s[rec.field]=cap;
    delete s[rec.field+'_skip'];
    delete s[rec.field+'_pendingCap'];
    s._localUpdatedAt=Date.now();
    const patch={};patch[rec.jurorId]={...s};
    if(window._FB)window._FB._set('juryScores/'+rec.roomId+'/entries/'+rec.entryKey,patch);
  }
  showToast('已拒絕，已自動改為 '+(rec.cap??89)+' 分（年級上限）','warn');
  renderPendingApprovalsPage();
}
window.rejectPendingScore=rejectPendingScore;

// 管理員：刪除已處理紀錄
function deletePendingApproval(pendingId){
  if(!confirm('確定刪除此審核紀錄？（僅刪除歷史紀錄，不影響已寫入的分數）'))return;
  delete DB.pendingApprovals[pendingId];
  fbDelete('pendingApprovals',pendingId);
  renderPendingApprovalsPage();
  showToast('已刪除','ok');
}
window.deletePendingApproval=deletePendingApproval;

// 取得單筆審核紀錄的描述（學生資訊、評分者、修別等）
function _getApprovalDesc(rec){
  if(rec.kind==='teacher'){
    const s=DB.users.find(u=>u.id===rec.sid);
    const stuName=s?`${s.name}（${s.class}·座${s.seat}）`:rec.sid;
    return {
      typeLabel:'平時評量',
      stuName:stuName,
      detail:`修別：${typeName(rec.scoreType)}`+(s&&s[rec.scoreType]?`（${iname(s[rec.scoreType])}）`:''),
    };
  } else {
    const sid=rec.entryKey?rec.entryKey.split('_')[0]:'';
    const s=DB.users.find(u=>u.id===sid);
    const stuName=s?`${s.name}（${s.class}·座${s.seat}）`:sid;
    const room=DB.rooms.find(r=>r.id===rec.roomId);
    const roomName=room?room.name:rec.roomId;
    return {
      typeLabel:'現場評分',
      stuName:stuName,
      detail:`考場：${roomName} ／ 欄位：${rec.field}`,
    };
  }
}

// ★ 掃描既有資料庫中所有 90+ 分的紀錄，回填為待審
//   解決「設定此功能前已存在的 90+ 分」問題
function scanExistingHighScores(){
  if(!confirm('將掃描所有已存在的分數，把 90 分（含）以上的紀錄回填為待審。\n\n（已有審核紀錄的不會被覆寫；此操作會新增多筆 Firebase 寫入）\n\n確定繼續？'))return;
  let teacherFound=0, juryFound=0, teacherSkipped=0, jurySkipped=0;
  const now=new Date().toISOString();
  const tasks=[];

  // 1) 掃描 teacherComments
  Object.entries(DB.teacherComments||{}).forEach(([sid,types])=>{
    if(!types||typeof types!=='object')return;
    Object.entries(types).forEach(([typeKey,data])=>{
      if(!data||typeof data!=='object')return;
      const score=parseFloat(data.score);
      if(isNaN(score)||score<90)return;
      const pendingId='tea_'+sid+'_'+typeKey;
      // 已有紀錄 → 跳過
      if(DB.pendingApprovals?.[pendingId]){teacherSkipped++;return;}
      // 找教師 — 從學生資料反推
      const stu=DB.users.find(u=>u.id===sid);
      let submittedBy='unknown', submittedByName='（系統回填）';
      if(stu&&stu.class){
        // 試著找該班的指派教師
        const teacher=DB.users.find(u=>u.role==='teacher'&&Array.isArray(u.assignedClasses)&&u.assignedClasses.includes(stu.class));
        if(teacher){submittedBy=teacher.id;submittedByName=teacher.name||'（系統回填）';}
      }
      const rec={
        kind:'teacher',
        score:score,
        reason:'（系統回填 — 此分數於審核機制建立前已存在）',
        status:'pending',
        submittedBy:submittedBy,
        submittedByName:submittedByName,
        submittedAt:now,
        reviewedAt:null,
        reviewedBy:null,
        sid:sid,
        scoreType:typeKey,
        comment:data.comment||'',
        _backfilled:true,
      };
      DB.pendingApprovals[pendingId]=rec;
      tasks.push(()=>fbSet('pendingApprovals',pendingId,rec));
      teacherFound++;
    });
  });

  // 2) 掃描 juryScores
  //    結構：DB.juryScores[roomId][entryKey][jurorId][field]
  const scoreFields=['s1','s2','s3','s4','s5','s6','final','total']; // 可能的分數欄位
  Object.entries(DB.juryScores||{}).forEach(([roomId,entries])=>{
    if(!entries||typeof entries!=='object')return;
    Object.entries(entries).forEach(([entryKey,jurors])=>{
      if(!jurors||typeof jurors!=='object')return;
      Object.entries(jurors).forEach(([jurorId,scores])=>{
        if(!scores||typeof scores!=='object'||jurorId.startsWith('_'))return;
        Object.entries(scores).forEach(([field,val])=>{
          if(field.startsWith('_')||field.endsWith('_skip')||field==='comment')return;
          const score=parseFloat(val);
          if(isNaN(score)||score<90)return;
          const pendingId='jury_'+roomId+'_'+entryKey+'_'+jurorId+'_'+field;
          if(DB.pendingApprovals?.[pendingId]){jurySkipped++;return;}
          // 找評審名稱
          let submittedByName='（系統回填）';
          const juror=DB.users.find(u=>u.id===jurorId);
          if(juror)submittedByName=juror.name||juror.id;
          const rec={
            kind:'jury',
            score:score,
            reason:'（系統回填 — 此分數於審核機制建立前已存在）',
            status:'pending',
            submittedBy:jurorId,
            submittedByName:submittedByName,
            submittedAt:now,
            reviewedAt:null,
            reviewedBy:null,
            roomId:roomId,
            entryKey:entryKey,
            jurorId:jurorId,
            field:field,
            _backfilled:true,
          };
          DB.pendingApprovals[pendingId]=rec;
          tasks.push(()=>fbSet('pendingApprovals',pendingId,rec));
          juryFound++;
        });
      });
    });
  });

  // 批次寫入 Firebase
  Promise.all(tasks.map(t=>t())).then(()=>{
    const msg=`掃描完成 ✓\n\n平時評量 90+ 分：新增 ${teacherFound} 筆（跳過 ${teacherSkipped} 筆已存在）\n現場評分 90+ 分：新增 ${juryFound} 筆（跳過 ${jurySkipped} 筆已存在）`;
    alert(msg);
    renderPendingApprovalsPage();
  }).catch(e=>{
    console.error('[scanExistingHighScores]',e);
    showToast('部分項目寫入失敗，請查看 console','err');
    renderPendingApprovalsPage();
  });
}
window.scanExistingHighScores=scanExistingHighScores;

// ★ 修正既有超過硬上限的分數：現場評分 + 平時成績，一律改為硬上限值
async function fixOverHardCapScores(){
  if(!requireRole('admin'))return;
  const HARD=DB.config.hardCap||95;
  if(!confirm('將掃描所有現場評分與平時成績，把超過 '+HARD+' 分的分數一律改為 '+HARD+' 分。\n\n此操作會直接寫回資料庫且無法復原，確定執行？'))return;

  showToast('掃描中...','sync');
  const isNum=v=>v!==''&&v!=='*'&&v!=null&&!isNaN(parseFloat(v));
  let juryFixed=0, teaFixed=0, writeFail=0;

  // ① 現場評分 juryScores[roomId][entryKey][jurorId][fieldId]
  for(const roomId of Object.keys(DB.juryScores||{})){
    const fieldIds=getRoomFields(roomId).map(f=>f.id);
    const entries=DB.juryScores[roomId]||{};
    for(const entryKey of Object.keys(entries)){
      const jurors=entries[entryKey]||{};
      let changedThisEntry=false;
      const patch={};
      for(const jid of Object.keys(jurors)){
        if(jid.startsWith('_'))continue;
        const s=jurors[jid];
        if(!s||typeof s!=='object')continue;
        let changed=false;
        fieldIds.forEach(fid=>{
          if(isNum(s[fid])&&parseFloat(s[fid])>HARD){s[fid]=HARD;changed=true;juryFixed++;}
        });
        if(changed){
          s._localUpdatedAt=Date.now();
          patch[jid]={...s};
          changedThisEntry=true;
        }
      }
      if(changedThisEntry){
        try{
          const ok=window._FB?await window._FB._set('juryScores/'+roomId+'/entries/'+entryKey,patch):false;
          if(!ok)writeFail++;
        }catch(e){console.warn('[fixOverHardCap jury]',entryKey,e);writeFail++;}
      }
    }
  }

  // ② 平時成績 teacherComments[studentId][type].score
  for(const sid of Object.keys(DB.teacherComments||{})){
    const rec=DB.teacherComments[sid]||{};
    let changed=false;
    ['major','minor','elective'].forEach(t=>{
      const tc=rec[t];
      if(tc&&isNum(tc.score)&&parseFloat(tc.score)>HARD){tc.score=HARD;changed=true;teaFixed++;}
    });
    if(changed){
      try{ fbSet('teacherComments',sid,{...rec}); }
      catch(e){console.warn('[fixOverHardCap tea]',sid,e);writeFail++;}
    }
  }

  // 清掉相關待審紀錄（分數已被硬性下修，審核已無意義）
  Object.keys(DB.pendingApprovals||{}).forEach(pid=>{
    const r=DB.pendingApprovals[pid];
    if(r&&r.status==='pending'&&isNum(r.score)&&parseFloat(r.score)>HARD){
      r.status='rejected';r.finalScore=HARD;r.reviewedAt=new Date().toISOString();r.reviewedBy='system(hardcap)';
      try{fbSet('pendingApprovals',pid,r);}catch(e){}
    }
  });

  if(DB._jurorOrderCache)DB._jurorOrderCache={};
  renderResults();
  if(typeof renderPendingApprovalsPage==='function')renderPendingApprovalsPage();
  const total=juryFixed+teaFixed;
  if(total===0){
    showToast('掃描完成：沒有發現超過 '+HARD+' 分的分數 ✓','ok');
  }else{
    showToast('已修正 '+total+' 筆（現場 '+juryFixed+'、平時 '+teaFixed+'）改為 '+HARD+' 分'+(writeFail?'，'+writeFail+' 筆同步失敗':' ✓'), writeFail?'warn':'ok');
  }
}
window.fixOverHardCapScores=fixOverHardCapScores;

// 渲染管理員審核頁
function renderPendingApprovalsPage(){
  const tab=document.getElementById('at-approvals');
  if(!tab)return;
  const all=Object.entries(DB.pendingApprovals||{});
  const pending=all.filter(([id,r])=>r.status==='pending');
  const handled=all.filter(([id,r])=>r.status!=='pending').sort((a,b)=>(b[1].reviewedAt||'').localeCompare(a[1].reviewedAt||''));
  // 更新 tab 標籤上的待審數量
  const tabBtn=document.getElementById('admin-tab-approvals');
  if(tabBtn){
    const badge=pending.length>0?` <span class="approval-badge">${pending.length}</span>`:'';
    tabBtn.innerHTML='📋 分數審核'+badge;
  }
  const fmtTime=iso=>{if(!iso)return '';try{const d=new Date(iso);return d.toLocaleString('zh-TW',{hour12:false});}catch(e){return iso;}};
  // 建立分頁內容
  const renderRow=([id,r])=>{
    const desc=_getApprovalDesc(r);
    const scoreColor=r.status==='rejected'?'var(--rust)':(r.status==='approved'?'var(--sage)':'var(--gold)');
    const statusBadge=r.status==='pending'
      ?'<span class="appr-st appr-pending">⏳ 待審核</span>'
      :(r.status==='approved'
        ?'<span class="appr-st appr-ok">✓ 已同意</span>'
        :`<span class="appr-st appr-no">✗ 已拒絕（${r.cap??89}分上限）</span>`);
    const reviewInfo=r.status!=='pending'
      ?`<div class="appr-review">${statusBadge} <span class="appr-meta">由 ${r.reviewedByName||r.reviewedBy||'-'} 於 ${fmtTime(r.reviewedAt)}</span></div>`
      :`<div class="appr-review">${statusBadge}</div>`;
    const actions=r.status==='pending'
      ?`<div class="appr-acts">
          <button class="btn btn-g btn-sm" onclick="approvePendingScore('${id}')">✓ 同意（維持原分數）</button>
          <button class="btn btn-d btn-sm" onclick="rejectPendingScore('${id}')">✗ 不同意（改為 ${r.kind==='jury'?(r.cap??89):89} 分）</button>
        </div>`
      :`<div class="appr-acts"><button class="btn btn-s btn-sm" onclick="deletePendingApproval('${id}')">🗑 刪除紀錄</button></div>`;
    return `<div class="appr-card ${r.status}">
      <div class="appr-head">
        <div>
          <span class="appr-type">${desc.typeLabel}</span>
          <strong class="appr-stu">${desc.stuName}</strong>
        </div>
        <div class="appr-score" style="color:${scoreColor}">${r.score}<span class="appr-score-u">分</span></div>
      </div>
      <div class="appr-detail">${desc.detail}</div>
      <div class="appr-reason"><span class="appr-reason-l">提交理由：</span>${(r.reason||'').replace(/</g,'&lt;')}</div>
      <div class="appr-meta">提交者：${r.submittedByName||r.submittedBy||'-'} ／ ${fmtTime(r.submittedAt)}</div>
      ${reviewInfo}
      ${actions}
    </div>`;
  };
  const pendingHTML=pending.length
    ? pending.map(renderRow).join('')
    : '<div class="appr-empty">目前沒有待審核的分數</div>';
  const handledHTML=handled.length
    ? handled.map(renderRow).join('')
    : '<div class="appr-empty">尚無已處理紀錄</div>';
  tab.innerHTML=`
    <div class="card">
      <div class="card-t">📋 分數審核 — 待審核（${pending.length}）</div>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px;line-height:1.7">超過軟上限的分數會在此列出由您事後審核：<br>• <strong>現場評分</strong>超過該生年級上限（高一 ${DB.config.scoreCaps?.[1]??85} / 高二 ${DB.config.scoreCaps?.[2]??87} / 高三 ${DB.config.scoreCaps?.[3]??89} 分）→ 暫以年級上限計分，待審核。<br>• <strong>平時成績</strong>達 90 分（含）以上 → 分數已生效，列此事後審核。<br>同意 → 採用原分數；不同意 → 自動改為該項上限。<br>另外，所有分數一律不得超過 <strong>${DB.config.hardCap||95}</strong> 分（硬上限，輸入時直接擋下，不會進入審核）。<br><span style="color:var(--orange);font-size:12px">※ 教師與評審不會收到審核結果通知，請在所有評分結束後再統一處理。</span></p>
      <div style="background:var(--cream);border:1px dashed var(--gold);border-radius:var(--r);padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="font-size:12px;color:var(--muted);line-height:1.6">
          <strong style="color:var(--ink)">🔍 掃描既有 90+ 分紀錄</strong><br>
          若此審核機制建立前已有教師/評審給予 90 分（含）以上的分數，可點此按鈕掃描並回填至待審清單。
        </div>
        <button class="btn btn-p btn-sm" onclick="scanExistingHighScores()" style="white-space:nowrap">🔍 掃描既有 90+ 分</button>
      </div>
      <div style="background:#fff4f4;border:1px dashed var(--red);border-radius:var(--r);padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="font-size:12px;color:var(--muted);line-height:1.6">
          <strong style="color:var(--red)">⚠ 修正既有超過 ${DB.config.hardCap||95} 分的分數</strong><br>
          硬上限機制建立前若已有分數超過 ${DB.config.hardCap||95} 分（現場評分＋平時成績），可點此一次掃描並全部改為 ${DB.config.hardCap||95} 分。
        </div>
        <button class="btn btn-d btn-sm" onclick="fixOverHardCapScores()" style="white-space:nowrap">⚠ 修正超過 ${DB.config.hardCap||95} 分</button>
      </div>
      <div class="appr-list">${pendingHTML}</div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="card-t">歷史紀錄 — 已處理（${handled.length}）</div>
      <div class="appr-list">${handledHTML}</div>
    </div>
  `;
}
window.renderPendingApprovalsPage=renderPendingApprovalsPage;


// ════════════════════════════════════════════════
// TEACHER SUB-TAB SWITCHING
// ════════════════════════════════════════════════
function switchTeaSubTab(key,el){
  document.querySelectorAll('#tea-sub-tabs .tab').forEach(t=>t.classList.remove('on'));
  if(el)el.classList.add('on');
  const overviewDiv=document.getElementById('tea-overview');
  const wizardDiv=document.getElementById('tea-wizard');
  const signupDiv=document.getElementById('tea-jury-signup');
  if(overviewDiv)overviewDiv.style.display=(key==='assess'?'block':'none');
  if(wizardDiv)wizardDiv.style.display='none';
  if(signupDiv)signupDiv.style.display=(key==='signup'?'block':'none');
  if(key==='signup')renderJurySignupPage();
}
window.switchTeaSubTab=switchTeaSubTab;

function updateJurySignupTabVisibility(){
  const tab=document.getElementById('tsub-signup');
  if(!tab)return;
  const accVal=DB.config.teacherAccess?.['jury-signup'];
  // admin 永遠看得到；teacher 依設定；false = 隱藏
  if(ST.role==='admin'){tab.style.display='';return;}
  if(accVal===false){
    tab.style.display='none';
    // 若目前正顯示報名區，切回平時評量
    if(document.getElementById('tea-jury-signup')?.style.display==='block'){
      const assessTab=document.getElementById('tsub-assess');
      switchTeaSubTab('assess',assessTab);
    }
  } else {
    tab.style.display='';
  }
}
window.updateJurySignupTabVisibility=updateJurySignupTabVisibility;

// ════════════════════════════════════════════════
// JURY SIGNUP — TEACHER SIDE
// ════════════════════════════════════════════════

function fmtRoomDt(r){
  const _WD=['日','一','二','三','四','五','六'];
  const fmt=dt=>{
    if(!dt)return '';
    const d=new Date(dt);if(isNaN(d))return dt;
    const wd=_WD[d.getDay()];
    const y=d.getFullYear();
    const mm=String(d.getMonth()+1).padStart(2,'0');
    const dd2=String(d.getDate()).padStart(2,'0');
    const hh=String(d.getHours()).padStart(2,'0');
    const mi=String(d.getMinutes()).padStart(2,'0');
    return `${y}/${mm}/${dd2}（${wd}）${hh}:${mi}`;
  };
  const fmtTimeOnly=dt=>{
    if(!dt)return '';
    const d=new Date(dt);if(isNaN(d))return dt;
    return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  };
  if(r.dateStart&&r.dateEnd){
    const ds=new Date(r.dateStart),de=new Date(r.dateEnd);
    const sameDay=!isNaN(ds)&&!isNaN(de)&&ds.getFullYear()===de.getFullYear()&&ds.getMonth()===de.getMonth()&&ds.getDate()===de.getDate();
    if(sameDay)return fmt(r.dateStart)+' ～ '+fmtTimeOnly(r.dateEnd);
    return fmt(r.dateStart)+' ～ '+fmt(r.dateEnd);
  }
  if(r.dateStart)return fmt(r.dateStart);
  return '日期待定';
}

// ★ 送出後：渲染已報名的考場確認摘要
function _renderJsupSubmittedSummary(tid){
  const summaryEl=document.getElementById('jsup-submitted-summary');
  const formEl=document.getElementById('jsup-form-area');
  if(!summaryEl||!formEl)return;

  const existing=DB.jurySignup[tid]||{};
  if(!existing._submitted){
    summaryEl.style.display='none';
    formEl.style.display='block';
    return;
  }

  formEl.style.display='none';
  summaryEl.style.display='block';

  const opts=DB.config.jurySignupOptions||[];
  const submittedAt=existing._submittedAt
    ?new Date(existing._submittedAt).toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
    :'';

  // 只取有選擇選項的考場
  const selectedRooms=DB.rooms.filter(r=>existing[r.id]?.optId);
  const skippedRooms=DB.rooms.filter(r=>!existing[r.id]?.optId);

  const roomCards=selectedRooms.map(r=>{
    const rd=existing[r.id]||{};
    const opt=opts.find(o=>o.id===rd.optId);
    const optLabel=opt?.label||rd.optId||'—';
    const isAttend=opt?.isAttend;
    const isSub=opt?.isSub;

    // 狀態顏色
    const statusColor=isAttend?'var(--sage)':isSub?'var(--rust)':'var(--orange)';
    const statusBg=isAttend?'rgba(61,92,56,.08)':isSub?'rgba(139,51,34,.08)':'rgba(202,111,30,.08)';
    const statusIcon=isAttend?'✅':isSub?'🔄':'📌';

    // 考場日期時間
    const dtStr=fmtRoomDt(r);

    // 額外資訊
    let extraHtml='';
    if(isAttend&&rd.phone){
      extraHtml+=`<div style="margin-top:6px;font-size:12px;color:var(--muted)">📱 聯絡電話：<strong style="color:var(--ink)">${rd.phone}</strong></div>`;
    }
    if(isSub){
      if(rd.subName) extraHtml+=`<div style="margin-top:6px;font-size:12px;color:var(--muted)">代評老師：<strong style="color:var(--ink)">${rd.subName}</strong></div>`;
      if(rd.subPhone) extraHtml+=`<div style="margin-top:2px;font-size:12px;color:var(--muted)">代評手機：<strong style="color:var(--ink)">${rd.subPhone}</strong></div>`;
      if(rd.subRoomId){
        const subRoom=DB.rooms.find(rr=>rr.id===rd.subRoomId);
        if(subRoom) extraHtml+=`<div style="margin-top:2px;font-size:12px;color:var(--muted)">代評考場：<strong style="color:var(--ink)">${subRoom.name}</strong></div>`;
      }
    }
    if(rd.optText){
      extraHtml+=`<div style="margin-top:6px;font-size:12px;color:var(--muted)">說明：${rd.optText}</div>`;
    }

    return `<div style="border:1px solid var(--border);border-left:4px solid ${statusColor};border-radius:var(--r);padding:14px 16px;background:${statusBg}">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">
        <div>
          <span style="font-size:14px;font-weight:700;color:var(--ink)">${r.name}</span>
          ${r.location?`<span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-left:8px">📍 ${r.location}</span>`:''}
        </div>
        <span style="font-family:'DM Mono',monospace;font-size:9px;font-weight:700;color:${statusColor};background:${statusBg};border:1px solid ${statusColor};padding:2px 10px;border-radius:20px">${statusIcon} ${optLabel}</span>
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted)">🗓 ${dtStr}</div>
      ${extraHtml}
    </div>`;
  }).join('');

  // 未填考場列表（若有）
  const skippedHtml=skippedRooms.length
    ?`<div style="margin-top:12px;padding:10px 14px;background:var(--cream);border-radius:var(--r);border:1px solid var(--border)">
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:6px">以下考場未填寫狀態（略過）</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${skippedRooms.map(r=>`<span style="font-family:'DM Mono',monospace;font-size:9px;padding:2px 10px;border:1px solid var(--border);border-radius:20px;background:var(--white);color:var(--muted)">${r.name}</span>`).join('')}</div>
      </div>`
    :'';

  // 全域補充說明
  const globalNoteHtml=existing._globalNote
    ?`<div style="margin-top:12px;padding:10px 14px;background:var(--cream);border-radius:var(--r);border:1px solid var(--border)">
        <div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:4px">補充說明</div>
        <div style="font-size:13px;line-height:1.8;color:var(--ink)">${existing._globalNote}</div>
      </div>`
    :'';

  summaryEl.innerHTML=`
    <div style="background:#f0faf2;border:2px solid var(--sage);border-radius:var(--r);padding:18px 20px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <span style="font-size:22px">✅</span>
        <div>
          <div style="font-family:'DM Mono',monospace;font-size:11px;font-weight:700;color:var(--sage);letter-spacing:1px">報名已確認送出</div>
          ${submittedAt?`<div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);margin-top:2px">送出時間：${submittedAt}</div>`:''}
        </div>
        <button class="btn btn-s btn-sm" style="margin-left:auto" onclick="_jsupReopenForm()">✏ 修改報名內容</button>
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--sage);margin-bottom:10px">
        您已報名的考場：<strong style="font-size:13px;color:var(--gold)">${selectedRooms.length}</strong> / 共 ${DB.rooms.length} 個考場
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${roomCards||'<div style="font-size:13px;color:var(--muted)">尚無勾選任何考場</div>'}
      </div>
      ${skippedHtml}
      ${globalNoteHtml}
    </div>`;
}
window._renderJsupSubmittedSummary=_renderJsupSubmittedSummary;

// 允許教師修改已送出的報名（重新開啟填報區）
function _jsupReopenForm(){
  const summaryEl=document.getElementById('jsup-submitted-summary');
  const formEl=document.getElementById('jsup-form-area');
  if(summaryEl)summaryEl.style.display='none';
  if(formEl)formEl.style.display='block';
  showToast('您可以修改後重新送出報名','');
}
window._jsupReopenForm=_jsupReopenForm;

function renderJurySignupPage(){
  // 說明文字
  const noteEl=document.getElementById('jsup-note-text');
  if(noteEl)noteEl.textContent=DB.config.jurySignupNote||'';

  const tid=ST.user?.id;
  const existing=DB.jurySignup[tid]||{};
  const opts=DB.config.jurySignupOptions||[];

  // ★ 已送出時顯示確認摘要，隱藏填報區
  _renderJsupSubmittedSummary(tid);
  if(existing._submitted)return; // 已送出則不渲染填報區內容

  // 已送出狀態
  const statusEl=document.getElementById('jsup-submit-status');
  if(statusEl){
    if(existing._submitted){
      const d=existing._submittedAt?new Date(existing._submittedAt).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
      statusEl.innerHTML=`<span style="color:var(--sage)">✓ 已送出 ${d}</span>`;
    }else if(existing._draft){
      statusEl.innerHTML=`<span style="color:var(--orange)">草稿已暫存</span>`;
    }else{
      statusEl.innerHTML=`<span style="color:var(--muted)">尚未填寫</span>`;
    }
  }

  // ── ① 考場資訊卡片 ──
  const infoGrid=document.getElementById('jsup-info-grid');
  if(infoGrid){
    infoGrid.innerHTML=DB.rooms.map(r=>{
      const fmtDtStart=dt=>{if(!dt)return '';const d=new Date(dt);return isNaN(d)?dt:d.toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});};
      const fmtTime=dt=>{if(!dt)return '';const d=new Date(dt);return isNaN(d)?dt:d.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'});};
      const dateStr=r.dateStart?fmtDtStart(r.dateStart):'日期待定';
      const timeStr=r.dateStart?(fmtTime(r.dateStart)+(r.dateEnd?' ～ '+fmtTime(r.dateEnd):'')):'';
      return `<div class="jsup-info-card">
        <div class="jsup-info-h">
          <div class="jsup-info-name">${r.name}</div>
          ${r.location?`<div class="jsup-info-loc">📍 ${r.location}</div>`:''}
        </div>
        <div class="jsup-info-b">
          <div class="jsup-info-dt-label">考試日期</div>
          <div class="jsup-info-dt">${dateStr}</div>
          ${timeStr?`<div class="jsup-info-dt-label" style="margin-top:6px">考試時間</div><div class="jsup-info-dt">${timeStr}</div>`:''}
        </div>
      </div>`;
    }).join('');
  }

  // ── ② 選項填報列 ──
  const rowsBody=document.getElementById('jsup-rows-body');
  if(!rowsBody)return;

  rowsBody.innerHTML=DB.rooms.map(r=>{
    const rd=existing[r.id]||{};
    const chosenOpt=rd.optId||'';

    // 選項按鈕列
    const optBtns=opts.map(opt=>{
      let cls='jsup-opt-btn';
      if(chosenOpt===opt.id){
        cls+=(opt.isAttend?' active-attend':opt.isSub?' active-sub':' active-other');
      }
      return `<button class="${cls}" id="jsup-optbtn-${r.id}-${opt.id}" onclick="jsupPickOpt('${r.id}','${opt.id}')">${opt.label}</button>`;
    }).join('');

    // 展開的額外欄位（依選項類型）
    const chosenOptObj=opts.find(o=>o.id===chosenOpt);
    let expandHtml='';
    if(chosenOpt&&chosenOptObj){
      if(chosenOptObj.isAttend){
        // 確認參加 → 填手機號
        expandHtml=`<div class="jsup-expand" id="jsup-expand-${r.id}">
          <div style="font-family:DM Mono,monospace;font-size:9px;color:var(--sage);letter-spacing:1px;margin-bottom:8px">✓ 確認參加 — 請留下您的手機號碼</div>
          <div class="fr" style="margin:0">
            <div class="fg" style="max-width:240px">
              <label>手機號碼（必填）</label>
              <input type="tel" id="jsup-phone-${r.id}" value="${rd.phone||''}" placeholder="09XX-XXX-XXX" oninput="jsupDraftSave()">
            </div>
          </div>
        </div>`;
      }else if(chosenOptObj.isSub){
        // 代評 → 填代評老師資訊
        const subRoomOpts=DB.rooms.map(rr=>`<option value="${rr.id}" ${rd.subRoomId===rr.id?'selected':''}>${rr.name}　${fmtRoomDt(rr)}</option>`).join('');
        expandHtml=`<div class="jsup-expand" id="jsup-expand-${r.id}">
          <div style="font-family:DM Mono,monospace;font-size:9px;color:var(--rust);letter-spacing:1px;margin-bottom:10px">⚡ 請填寫代評老師資訊</div>
          <div class="fr" style="margin:0;flex-wrap:wrap;gap:10px">
            <div class="fg" style="min-width:150px;flex:1">
              <label>代評老師姓名（必填）</label>
              <input type="text" id="jsup-subname-${r.id}" value="${rd.subName||''}" placeholder="代評老師姓名" oninput="jsupDraftSave()">
            </div>
            <div class="fg" style="min-width:150px;flex:1">
              <label>代評老師手機號（必填）</label>
              <input type="tel" id="jsup-subphone-${r.id}" value="${rd.subPhone||''}" placeholder="09XX-XXX-XXX" oninput="jsupDraftSave()">
            </div>
          </div>
          <div class="fg" style="margin-top:10px">
            <label>代評老師負責的考場（必選）</label>
            <select id="jsup-subroom-${r.id}" onchange="jsupDraftSave()">
              <option value="">— 請選考場 —</option>
              ${subRoomOpts}
            </select>
          </div>
        </div>`;
      }else if(chosenOptObj.hasText){
        // 有附加說明欄
        expandHtml=`<div class="jsup-expand" id="jsup-expand-${r.id}">
          <div class="fg" style="margin:0">
            <label>請填寫說明</label>
            <textarea id="jsup-opttext-${r.id}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--r);font-size:13px;min-height:56px;outline:none;resize:vertical;background:var(--paper)" oninput="jsupDraftSave()">${rd.optText||''}</textarea>
          </div>
        </div>`;
      }
    }

    // 狀態badge
    const badgeCls=!chosenOpt?'jsup-status-none':(chosenOptObj?.isAttend?'jsup-status-attend':chosenOptObj?.isSub?'jsup-status-sub':'jsup-status-other');
    const badgeLabel=!chosenOpt?'尚未選擇':(chosenOptObj?.label||chosenOpt);

    return `<div class="jsup-row" id="jsup-row-${r.id}">
      <div class="jsup-row-head">
        <span class="jsup-row-name">${r.name}</span>
        <span class="jsup-row-dt">🗓 ${fmtRoomDt(r)}</span>
        <span class="jsup-status-badge ${badgeCls}" id="jsup-badge-${r.id}" style="margin-left:auto">${badgeLabel}</span>
      </div>
      <div class="jsup-row-opts">${optBtns}</div>
      ${expandHtml}
    </div>`;
  }).join('');

  // 全域補充說明
  const gnote=document.getElementById('jsup-global-note');
  if(gnote)gnote.value=existing._globalNote||'';
}
window.renderJurySignupPage=renderJurySignupPage;

// 點選選項按鈕
function jsupPickOpt(roomId,optId){
  const opts=DB.config.jurySignupOptions||[];
  const opt=opts.find(o=>o.id===optId);
  if(!opt)return;
  const tid=ST.user?.id;
  if(!DB.jurySignup[tid])DB.jurySignup[tid]={};
  if(!DB.jurySignup[tid][roomId])DB.jurySignup[tid][roomId]={};

  // 若已選同一選項，取消（toggle）
  const wasChosen=DB.jurySignup[tid][roomId].optId===optId;
  DB.jurySignup[tid][roomId].optId=wasChosen?'':optId;

  // 更新按鈕樣式
  opts.forEach(o=>{
    const btn=document.getElementById(`jsup-optbtn-${roomId}-${o.id}`);
    if(!btn)return;
    btn.className='jsup-opt-btn';
    if(!wasChosen&&o.id===optId){
      btn.className+=(o.isAttend?' active-attend':o.isSub?' active-sub':' active-other');
    }
  });

  // 更新badge
  const badge=document.getElementById(`jsup-badge-${roomId}`);
  if(badge){
    const cur=wasChosen?null:opt;
    badge.textContent=cur?cur.label:'尚未選擇';
    badge.className='jsup-status-badge '+(cur?(cur.isAttend?'jsup-status-attend':cur.isSub?'jsup-status-sub':'jsup-status-other'):'jsup-status-none');
  }

  // 展開/收起額外欄
  const row=document.getElementById(`jsup-row-${roomId}`);
  const oldExpand=document.getElementById(`jsup-expand-${roomId}`);
  if(oldExpand)oldExpand.remove();

  const newOptId=wasChosen?'':optId;
  const newOpt=wasChosen?null:opt;
  if(newOpt){
    let expandHtml='';
    const rd=DB.jurySignup[tid][roomId]||{};
    if(newOpt.isAttend){
      expandHtml=`<div class="jsup-expand" id="jsup-expand-${roomId}">
        <div style="font-family:DM Mono,monospace;font-size:9px;color:var(--sage);letter-spacing:1px;margin-bottom:8px">✓ 確認參加 — 請留下您的手機號碼</div>
        <div class="fr" style="margin:0">
          <div class="fg" style="max-width:240px">
            <label>手機號碼（必填）</label>
            <input type="tel" id="jsup-phone-${roomId}" value="${rd.phone||''}" placeholder="09XX-XXX-XXX" oninput="jsupDraftSave()">
          </div>
        </div>
      </div>`;
    }else if(newOpt.isSub){
      const subRoomOpts=DB.rooms.map(rr=>`<option value="${rr.id}" ${rd.subRoomId===rr.id?'selected':''}>${rr.name}　${fmtRoomDt(rr)}</option>`).join('');
      expandHtml=`<div class="jsup-expand" id="jsup-expand-${roomId}">
        <div style="font-family:DM Mono,monospace;font-size:9px;color:var(--rust);letter-spacing:1px;margin-bottom:10px">⚡ 請填寫代評老師資訊</div>
        <div class="fr" style="margin:0;flex-wrap:wrap;gap:10px">
          <div class="fg" style="min-width:150px;flex:1">
            <label>代評老師姓名（必填）</label>
            <input type="text" id="jsup-subname-${roomId}" value="${rd.subName||''}" placeholder="代評老師姓名" oninput="jsupDraftSave()">
          </div>
          <div class="fg" style="min-width:150px;flex:1">
            <label>代評老師手機號（必填）</label>
            <input type="tel" id="jsup-subphone-${roomId}" value="${rd.subPhone||''}" placeholder="09XX-XXX-XXX" oninput="jsupDraftSave()">
          </div>
        </div>
        <div class="fg" style="margin-top:10px">
          <label>代評老師負責的考場（必選）</label>
          <select id="jsup-subroom-${roomId}" onchange="jsupDraftSave()">
            <option value="">— 請選考場 —</option>
            ${DB.rooms.map(rr=>`<option value="${rr.id}">${rr.name}　${fmtRoomDt(rr)}</option>`).join('')}
          </select>
        </div>
      </div>`;
    }else if(newOpt.hasText){
      expandHtml=`<div class="jsup-expand" id="jsup-expand-${roomId}">
        <div class="fg" style="margin:0">
          <label>請填寫說明</label>
          <textarea id="jsup-opttext-${roomId}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--r);font-size:13px;min-height:56px;outline:none;resize:vertical;background:var(--paper)" oninput="jsupDraftSave()"></textarea>
        </div>
      </div>`;
    }
    if(expandHtml&&row){
      row.insertAdjacentHTML('beforeend',expandHtml);
    }
  }

  jsupDraftSave();
}
window.jsupPickOpt=jsupPickOpt;

// 收集單一考場資料
function jsupCollectRoom(roomId){
  const opts=DB.config.jurySignupOptions||[];
  const tid=ST.user?.id;
  const cur=(DB.jurySignup[tid]||{})[roomId]||{};
  const optId=cur.optId||'';
  const opt=opts.find(o=>o.id===optId);
  const d={optId};
  if(opt?.isAttend) d.phone=document.getElementById(`jsup-phone-${roomId}`)?.value||'';
  if(opt?.isSub){
    d.subName=document.getElementById(`jsup-subname-${roomId}`)?.value||'';
    d.subPhone=document.getElementById(`jsup-subphone-${roomId}`)?.value||'';
    d.subRoomId=document.getElementById(`jsup-subroom-${roomId}`)?.value||'';
  }
  if(opt?.hasText) d.optText=document.getElementById(`jsup-opttext-${roomId}`)?.value||'';
  return d;
}

// 自動暫存（oninput 觸發）— ★ 修正 #F7：加 debounce 避免每按鍵都跑 forEach
let _jsupDebounce=null;
function jsupDraftSave(){
  if(_jsupDebounce)clearTimeout(_jsupDebounce);
  _jsupDebounce=setTimeout(()=>{
    const tid=ST.user?.id;if(!tid)return;
    if(!DB.jurySignup[tid])DB.jurySignup[tid]={};
    DB.rooms.forEach(r=>{DB.jurySignup[tid][r.id]=jsupCollectRoom(r.id);});
    DB.jurySignup[tid]._globalNote=document.getElementById('jsup-global-note')?.value||'';
  },300);
}
window.jsupDraftSave=jsupDraftSave;

// 暫時儲存（手動）
function saveJurySignupDraft(){
  // ★ 修正 #E2：防重複
  if(window._savingJsupDraft)return;
  window._savingJsupDraft=true;
  setTimeout(()=>{window._savingJsupDraft=false;},1500);
  const tid=ST.user?.id;if(!tid)return;
  jsupDraftSave();
  if(!DB.jurySignup[tid])DB.jurySignup[tid]={};
  DB.jurySignup[tid]._draft=true;
  DB.jurySignup[tid]._submitted=false;
  fbSet('jurySignup',tid,DB.jurySignup[tid]);
  const statusEl=document.getElementById('jsup-submit-status');
  if(statusEl)statusEl.innerHTML=`<span style="color:var(--orange)">草稿已暫存</span>`;
  showToast('草稿已暫存 ✓','ok');
}
window.saveJurySignupDraft=saveJurySignupDraft;

// 送出報名
function submitJurySignup(){
  // ★ 修正 #E2：防重複送出
  if(window._submittingJurySignup)return;
  window._submittingJurySignup=true;
  setTimeout(()=>{window._submittingJurySignup=false;},3000);
  const tid=ST.user?.id;if(!tid)return;
  jsupDraftSave();
  const opts=DB.config.jurySignupOptions||[];
  const errors=[];
  // ★ Bug4 修正：只需至少勾選一場，未選的考場允許跳過，不強制每場都需選擇
  let hasAtLeastOne=false;
  DB.rooms.forEach(r=>{
    const rd=(DB.jurySignup[tid]||{})[r.id]||{};
    if(!rd.optId)return; // 未選此考場 → 跳過，不報錯
    hasAtLeastOne=true;
    const opt=opts.find(o=>o.id===rd.optId);
    if(opt?.isAttend&&!rd.phone) errors.push(`「${r.name}」請填寫您的手機號碼`);
    if(opt?.isSub){
      if(!rd.subName) errors.push(`「${r.name}」請填寫代評老師姓名`);
      if(!rd.subPhone) errors.push(`「${r.name}」請填寫代評老師手機號`);
      if(!rd.subRoomId) errors.push(`「${r.name}」請選擇代評老師負責的考場`);
    }
  });
  if(!hasAtLeastOne){window._submittingJurySignup=false;showToast('請至少選擇一個考場的出席狀態','err');return;}
  if(errors.length){window._submittingJurySignup=false;showToast(errors[0],'err');return;}
  DB.jurySignup[tid]._submitted=true;
  DB.jurySignup[tid]._draft=false;
  DB.jurySignup[tid]._submittedAt=new Date().toISOString();
  DB.jurySignup[tid]._teacherName=ST.user?.name||'';
  fbSet('jurySignup',tid,DB.jurySignup[tid]);
  const statusEl=document.getElementById('jsup-submit-status');
  if(statusEl)statusEl.innerHTML=`<span style="color:var(--sage)">✓ 已送出 ${new Date().toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>`;
  // ★ 顯示已送出確認摘要
  _renderJsupSubmittedSummary(tid);
  showToast('報名已送出 ✓','ok');
}
window.submitJurySignup=submitJurySignup;

// ════════════════════════════════════════════════
// JURY SIGNUP — ADMIN SIDE
// ════════════════════════════════════════════════

function renderJsupAdminPanel(){
  const inp=document.getElementById('jsup-note-inp');
  if(inp)inp.value=DB.config.jurySignupNote||'';
  renderJsupOptsList();
  const rf=document.getElementById('jsup-admin-room-filter');
  if(rf){
    const prev=rf.value;
    while(rf.options.length>1)rf.remove(1);
    DB.rooms.forEach(r=>rf.appendChild(new Option(r.name,r.id)));
    if(DB.rooms.find(r=>r.id===prev))rf.value=prev;
  }
  renderJsupAdminTable();
}
window.renderJsupAdminPanel=renderJsupAdminPanel;

function renderJsupOptsList(){
  const el=document.getElementById('jsup-opts-list');if(!el)return;
  const opts=DB.config.jurySignupOptions||[];
  el.innerHTML=opts.length?opts.map((opt,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--r);margin-bottom:6px;background:var(--white);flex-wrap:wrap">
      <div style="flex:1;min-width:120px">
        <input id="jsup-label-${i}" type="text" value="${opt.label}" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:var(--r);font-size:13px;outline:none;background:var(--paper)" oninput="jsupUpdateOptLabel(${i},this.value)">
      </div>
      <label style="display:flex;align-items:center;gap:4px;font-family:DM Mono,monospace;font-size:8px;color:var(--sage);cursor:pointer;white-space:nowrap">
        <input type="checkbox" ${opt.isAttend?'checked':''} onchange="jsupUpdateOptFlag(${i},'isAttend',this.checked)" style="accent-color:var(--sage)">確認參加類型
      </label>
      <label style="display:flex;align-items:center;gap:4px;font-family:DM Mono,monospace;font-size:8px;color:var(--rust);cursor:pointer;white-space:nowrap">
        <input type="checkbox" ${opt.isSub?'checked':''} onchange="jsupUpdateOptFlag(${i},'isSub',this.checked)" style="accent-color:var(--rust)">代評類型
      </label>
      <label style="display:flex;align-items:center;gap:4px;font-family:DM Mono,monospace;font-size:8px;color:var(--blue);cursor:pointer;white-space:nowrap">
        <input type="checkbox" ${opt.hasText?'checked':''} onchange="jsupUpdateOptFlag(${i},'hasText',this.checked)" style="accent-color:var(--blue)">附加說明欄
      </label>
      <button class="btn btn-d btn-xs" onclick="jsupDelOption(${i})">刪除</button>
    </div>`).join('')
    :'<p style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);padding:8px 0">尚無選項，請新增</p>';
}
window.renderJsupOptsList=renderJsupOptsList;

function addJsupOption(){
  if(!DB.config.jurySignupOptions)DB.config.jurySignupOptions=[];
  DB.config.jurySignupOptions.push({id:'opt_'+Date.now(),label:'新選項',isAttend:false,isSub:false,hasText:false});
  renderJsupOptsList();
  // 標記有未儲存變更
  _jsupMarkDirty();
  showToast('已新增選項，請按「💾 儲存選項」存檔','');
}
window.addJsupOption=addJsupOption;

function _jsupMarkDirty(){
  const btn=document.querySelector('[onclick="saveJsupOptions()"]');
  if(btn){btn.style.background='var(--rust)';btn.textContent='💾 儲存選項（未存檔）';}
}
function _jsupClearDirty(){
  const btn=document.querySelector('[onclick="saveJsupOptions()"]');
  if(btn){btn.style.background='';btn.textContent='💾 儲存選項';}
}

function saveJsupOptions(){
  // 從畫面上讀取最新輸入值（防止 onchange 未觸發的情況）
  const opts=DB.config.jurySignupOptions||[];
  opts.forEach((opt,i)=>{
    const inp=document.getElementById('jsup-label-'+i);
    if(inp)opt.label=inp.value;
  });
  fbSet('jurySignupConfig','main',{note:DB.config.jurySignupNote||'',options:opts});
  _jsupClearDirty();
  showToast('選項已儲存 ✓','ok');
}
window.saveJsupOptions=saveJsupOptions;
function jsupUpdateOptLabel(i,v){if(DB.config.jurySignupOptions[i])DB.config.jurySignupOptions[i].label=v;_jsupMarkDirty();}
window.jsupUpdateOptLabel=jsupUpdateOptLabel;
function jsupUpdateOptFlag(i,flag,v){if(DB.config.jurySignupOptions[i])DB.config.jurySignupOptions[i][flag]=v;_jsupMarkDirty();}
window.jsupUpdateOptFlag=jsupUpdateOptFlag;
function jsupDelOption(i){DB.config.jurySignupOptions.splice(i,1);renderJsupOptsList();fbSet('jurySignupConfig','main',{note:DB.config.jurySignupNote||'',options:DB.config.jurySignupOptions});showToast('選項已刪除並儲存 ✓','ok');}
window.jsupDelOption=jsupDelOption;

function saveJurySignupConfig(){
  const note=document.getElementById('jsup-note-inp')?.value||'';
  DB.config.jurySignupNote=note;
  fbSet('jurySignupConfig','main',{note,options:DB.config.jurySignupOptions});
  showToast('設定已儲存 ✓','ok');
  const noteEl=document.getElementById('jsup-note-text');
  if(noteEl)noteEl.textContent=note;
}
window.saveJurySignupConfig=saveJurySignupConfig;

function renderJsupAdminTable(){
  const roomFilter=document.getElementById('jsup-admin-room-filter')?.value||'';
  const opts=DB.config.jurySignupOptions||[];
  const teaList=teachers();

  // ── 考場分組摘要 ──
  const summaryEl=document.getElementById('jsup-admin-summary');
  if(summaryEl){
    const roomStats={};
    DB.rooms.forEach(r=>roomStats[r.id]={name:r.name,dt:fmtRoomDt(r),attend:[],sub:[],other:[],none:[]});
    teaList.forEach(t=>{
      const su=DB.jurySignup[t.id]||{};
      DB.rooms.forEach(r=>{
        const rd=su[r.id]||{};
        if(!rd.optId){roomStats[r.id].none.push(t.name);return;}
        const opt=opts.find(o=>o.id===rd.optId);
        if(opt?.isAttend) roomStats[r.id].attend.push(t.name);
        else if(opt?.isSub) roomStats[r.id].sub.push(t.name);
        else roomStats[r.id].other.push(t.name);
      });
    });
    const shownRooms=DB.rooms.filter(r=>!roomFilter||r.id===roomFilter);
    summaryEl.innerHTML=`<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:4px">`+
      shownRooms.map(r=>{
        const s=roomStats[r.id];
        return `<div style="border:1px solid var(--border);border-radius:var(--r);overflow:hidden;min-width:240px;flex:1">
          <div style="background:var(--ink);padding:9px 14px">
            <div style="font-family:DM Mono,monospace;font-size:9px;letter-spacing:2px;color:var(--gold)">${r.name}</div>
            <div style="font-family:DM Mono,monospace;font-size:8px;color:rgba(255,255,255,.4);margin-top:2px">🗓 ${s.dt}</div>
          </div>
          <div style="padding:12px 14px;background:var(--white);display:flex;flex-direction:column;gap:8px">
            <div>
              <div style="font-family:DM Mono,monospace;font-size:8px;color:var(--sage);letter-spacing:1px;margin-bottom:3px">✓ 確認參加（${s.attend.length} 人）</div>
              <div style="font-size:12px;color:var(--ink);line-height:1.8">${s.attend.length?s.attend.join('、'):'—'}</div>
            </div>
            <div>
              <div style="font-family:DM Mono,monospace;font-size:8px;color:var(--rust);letter-spacing:1px;margin-bottom:3px">⚡ 代評（${s.sub.length} 人）</div>
              <div style="font-size:12px;color:var(--ink);line-height:1.8">${s.sub.length?s.sub.join('、'):'—'}</div>
            </div>
            ${s.other.length?`<div>
              <div style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted);letter-spacing:1px;margin-bottom:3px">○ 其他（${s.other.length} 人）</div>
              <div style="font-size:12px;color:var(--muted);line-height:1.8">${s.other.join('、')}</div>
            </div>`:''}
            <div>
              <div style="font-family:DM Mono,monospace;font-size:8px;color:var(--border);letter-spacing:1px;margin-bottom:3px">□ 尚未填報（${s.none.length} 人）</div>
              <div style="font-size:12px;color:var(--muted);line-height:1.8">${s.none.length?s.none.join('、'):'—'}</div>
            </div>
          </div>
        </div>`;
      }).join('')+'</div>';
  }

  // ── 明細表格（橫向：教師為列、考場為欄）──
  const tbody=document.getElementById('jsup-admin-tbody');if(!tbody)return;
  const thead=tbody.parentElement?.querySelector('thead');

  // ★ 篩選後要顯示的考場欄位
  const shownRooms=roomFilter?DB.rooms.filter(r=>r.id===roomFilter):DB.rooms;

  // ★ 重建 thead：教師 / 參與狀態 / 各考場 / 備註
  if(thead){
    thead.innerHTML=`<tr>
      <th style="min-width:90px;position:sticky;left:0;background:var(--ink);color:var(--gold);z-index:2">教師</th>
      <th style="min-width:90px">指導學生數</th>
      <th style="min-width:100px">參與狀態</th>
      ${shownRooms.map(r=>`<th style="min-width:200px;font-size:11px">${r.name}</th>`).join('')}
      <th style="min-width:140px">備註</th>
      <th style="min-width:110px">送出時間</th>
    </tr>`;
  }

  // ★ 每位教師一列
  const rows=[];
  teaList.forEach(t=>{
    const su=DB.jurySignup[t.id]||{};
    const stuCount=(DB.teacherStudents[t.id]||[]).length;
    const submitted=su._submitted;

    // ─ 計算「整體參與狀態」摘要 ─
    let attendCount=0,subCount=0,otherCount=0,noneCount=0;
    shownRooms.forEach(r=>{
      const rd=su[r.id]||{};
      if(!rd.optId){noneCount++;return;}
      const opt=opts.find(o=>o.id===rd.optId);
      if(opt?.isAttend)attendCount++;
      else if(opt?.isSub)subCount++;
      else otherCount++;
    });
    let overallStatus='';
    if(attendCount){overallStatus=`<span class="jsup-status-badge jsup-status-attend">出席 ${attendCount}</span>`;}
    if(subCount){overallStatus+=`<span class="jsup-status-badge jsup-status-sub" style="margin-left:4px">代評 ${subCount}</span>`;}
    if(otherCount){overallStatus+=`<span class="jsup-status-badge jsup-status-other" style="margin-left:4px">其他 ${otherCount}</span>`;}
    if(!overallStatus){overallStatus=`<span class="jsup-status-badge jsup-status-none">未填報</span>`;}

    // ─ 渲染各考場欄位 ─
    const roomCells=shownRooms.map(r=>{
      const rd=su[r.id]||{};
      if(!rd.optId){
        return `<td style="font-size:11px;color:var(--muted);text-align:center">—</td>`;
      }
      const opt=opts.find(o=>o.id===rd.optId);
      // 出席：顯示「本人出席」+ 教師電話
      if(opt?.isAttend){
        const phone=rd.phone||t.phone||'';
        return `<td style="font-size:12px;background:#f0f5ed">
          <div style="color:var(--sage);font-weight:600">✓ 本人出席</div>
          ${phone?`<div style="font-family:DM Mono,monospace;font-size:10px;color:var(--muted);margin-top:2px">📞 ${phone}</div>`:''}
        </td>`;
      }
      // 找代評：顯示代評姓名 + 電話
      if(opt?.isSub){
        const subName=rd.subName||'(未填代評姓名)';
        const subPhone=rd.subPhone||'';
        const subRoomLabel=rd.subRoomId?` → ${DB.rooms.find(rr=>rr.id===rd.subRoomId)?.name||rd.subRoomId}`:'';
        return `<td style="font-size:12px;background:#fef9e7">
          <div style="color:var(--rust);font-weight:600">⚡ 代評：${subName}</div>
          ${subPhone?`<div style="font-family:DM Mono,monospace;font-size:10px;color:var(--muted);margin-top:2px">📞 ${subPhone}</div>`:''}
          ${subRoomLabel?`<div style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted);margin-top:1px">${subRoomLabel}</div>`:''}
        </td>`;
      }
      // 其他選項（如「學生僅一人，免評」）
      return `<td style="font-size:11px;color:var(--muted)">
        <span style="font-weight:600;color:var(--steel)">○ ${opt?.label||rd.optId}</span>
      </td>`;
    }).join('');

    rows.push(`<tr>
      <td style="position:sticky;left:0;background:var(--white);z-index:1;box-shadow:2px 0 4px -2px rgba(0,0,0,.06)">
        <strong>${t.name}</strong>
        ${submitted?'<div style="font-family:\'DM Mono\',monospace;font-size:7px;color:var(--sage);border:1px solid var(--sage);border-radius:10px;padding:1px 5px;display:inline-block;margin-top:2px">✓送出</div>':''}
      </td>
      <td style="text-align:center;font-family:DM Mono,monospace;font-size:12px">${stuCount}</td>
      <td>${overallStatus}</td>
      ${roomCells}
      <td style="font-size:11px;color:var(--muted);max-width:160px">${su._globalNote||'—'}</td>
      <td style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted);white-space:nowrap">${su._submittedAt?new Date(su._submittedAt).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'}</td>
    </tr>`);
  });

  const totalCols=3+shownRooms.length+2;
  tbody.innerHTML=rows.join('')||`<tr><td colspan="${totalCols}" style="text-align:center;padding:20px;color:var(--muted);font-family:DM Mono,monospace;font-size:11px">尚無教師填報資料</td></tr>`;
}
window.renderJsupAdminTable=renderJsupAdminTable;

function exportJsupCSV(){
  const opts=DB.config.jurySignupOptions||[];
  const rows=[];
  teachers().forEach(t=>{
    const su=DB.jurySignup[t.id]||{};
    const stuCount=(DB.teacherStudents[t.id]||[]).length;
    DB.rooms.forEach(r=>{
      const rd=su[r.id]||{};
      const opt=opts.find(o=>o.id===rd.optId);
      rows.push({
        '教師姓名':t.name,'帳號':t.account,'指導學生數':stuCount,
        '考場':r.name,'考場日期時間':fmtRoomDt(r),
        '狀態':!rd.optId?'未填報':(opt?.label||rd.optId),
        '手機號碼':opt?.isAttend?(rd.phone||''):'',
        '代評老師姓名':opt?.isSub?(rd.subName||''):'',
        '代評老師手機':opt?.isSub?(rd.subPhone||''):'',
        '代評負責考場':opt?.isSub&&rd.subRoomId?DB.rooms.find(rr=>rr.id===rd.subRoomId)?.name||'':'',
        '補充說明':su._globalNote||'',
        '已送出':su._submitted?'是':'否',
        '送出時間':su._submittedAt?new Date(su._submittedAt).toLocaleString('zh-TW'):'',
      });
    });
  });
  exportCSV(rows,'期末考評分報名');
}
window.exportJsupCSV=exportJsupCSV;

// ★ 橫向格式 CSV：教師為列，每考場為欄（與後台表格顯示一致）
function exportJsupCSVWide(){
  const opts=DB.config.jurySignupOptions||[];
  const rows=[];
  teachers().forEach(t=>{
    const su=DB.jurySignup[t.id]||{};
    const stuCount=(DB.teacherStudents[t.id]||[]).length;
    const row={
      '教師姓名':t.name,
      '帳號':t.account||'',
      '指導學生數':stuCount,
    };
    // 各考場欄位
    DB.rooms.forEach(r=>{
      const rd=su[r.id]||{};
      const opt=opts.find(o=>o.id===rd.optId);
      let cell='—';
      if(rd.optId){
        if(opt?.isAttend){
          const phone=rd.phone||t.phone||'';
          cell=`本人出席${phone?` (${phone})`:''}`;
        } else if(opt?.isSub){
          const subName=rd.subName||'(未填)';
          const subPhone=rd.subPhone||'';
          cell=`代評：${subName}${subPhone?` (${subPhone})`:''}`;
        } else {
          cell=opt?.label||rd.optId;
        }
      } else {
        cell='未填報';
      }
      row[r.name]=cell;
    });
    row['備註']=su._globalNote||'';
    row['已送出']=su._submitted?'是':'否';
    row['送出時間']=su._submittedAt?new Date(su._submittedAt).toLocaleString('zh-TW'):'';
    rows.push(row);
  });
  exportCSV(rows,'期末考評分報名_橫向格式');
}
window.exportJsupCSVWide=exportJsupCSVWide;

// ════════════════════════════════════════════════
// ADMIN TABS
// ════════════════════════════════════════════════
function swAdminTab(key,el){
  document.querySelectorAll('#admin-tabs .tab').forEach(t=>t.classList.remove('on'));
  document.querySelectorAll('#pg-admin .tc').forEach(t=>{if(t.id.startsWith('at-'))t.classList.remove('on');});
  el.classList.add('on');document.getElementById('at-'+key)?.classList.add('on');
  if(key==='jurysignup')renderJsupAdminPanel();
  if(key==='approvals')renderPendingApprovalsPage(); // ★ 90分審核頁
  // ★ 切換到內容設定 tab 時初始化富文字編輯器
  if(key==='content'){setTimeout(erInitAdminEditors,50);setTimeout(aprRender,80);}
}
function swUserTab(key,el){
  document.querySelectorAll('#user-sub-tabs .tab').forEach(t=>t.classList.remove('on'));
  document.querySelectorAll('#at-users .tc').forEach(t=>{if(t.id.startsWith('ut-'))t.classList.remove('on');});
  el.classList.add('on');document.getElementById('ut-'+key)?.classList.add('on');
}

// ════════════════════════════════════════════════
// UI HELPERS
// ════════════════════════════════════════════════
function openOverlay(id){document.getElementById(id)?.classList.add('on');}
function closeOverlay(id){document.getElementById(id)?.classList.remove('on');}
// overlay listeners handled in attachListeners above

function showToast(msg,type=''){
  const t=document.getElementById('toast');t.textContent=msg;t.className='toast on '+type;
  clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('on'),3000);
}
function showSyncStatus(state,text){
  const el=document.getElementById('sync');const dot=document.getElementById('sy-dot');
  document.getElementById('sy-txt').textContent=text;
  dot.className='sy-dot '+({sync:'sy-sync',ok:'sy-ok',pend:'sy-pend'}[state]||'');
  el.classList.add('on');clearTimeout(el._t);
  if(state==='ok')el._t=setTimeout(()=>el.classList.remove('on'),2500);
}
// online handler 已整合至 Firebase enablePersistence 區塊，避免重複綁定
window.addEventListener('offline',()=>{ST.isOnline=false;document.getElementById('off-bar').classList.add('show');});

// ════════════════════════════════════════════════
// EXPOSE FUNCTIONS TO GLOBAL SCOPE (needed for onclick= in HTML)
// ════════════════════════════════════════════════
const _expose = [
  'doLogin','doJuryDirectLogin','saveFirstPassword','doJuryLogin','doLogout','openChPwd','doChangePassword','fbSet','fbDelete','fbLoad','fbSaveInstruments',
  'closeOverlay','openOverlay','showToast',
  'filterRepInst','toggleElective','previewRep','backToRepForm','submitRep','editRep','renderRepDoneInfo','renderRepPage',
  'doLookup','clearLookup',
  'openTeaModal','swTeaTab','saveTeaComment','teaWizStart','teaWizPickClass','teaWizPickStu','teaWizPickType','teaWizBack','teaWizSaveAndNext','teaWizSubmitAll','teaWizOpenDirect','openTeaStuModal','tsmFilterClass','saveTeaStu','teaWizNameSearch','teaWizS1NameSearch',
  'checkJuryBeforeSubmit','submitJuryAll','confirmSubmitJury','midSaveJury','toggleAbsent','saveJCell',
  'generateSchedule','exportScheduleCSV','exportScheduleXLSX','exportAllRoomsXLSX','exportSchedulePDF','exportAllRoomsPDF','publishSchedule','schResetFilters','schResetToRoomDefaults','schSaveSchedule','schLoadSchedule','schInitSortBar','schAddExcludeRule','schRemoveExcludeRule','renderSchExcludeUI','schToggleSortKey','openDisqModal','saveDisq','removeDisq','importDisqCSV','exportDisqCSV','downloadDisqSample','renderDisqList','onSchRoomChange','schRoomCatToggle','schRoomInstToggle','openSchAddModal','schAddSearch','schAddEntry','schRestoreEntry','schRemoveEntry','schAddCurrentFilter',
  'openAddDisqIndividual','adimSearch','adimSelect','saveDisqIndividual',
  'renderTeaSchedulePage','teaSchSelectRoom','renderLiveResults','renderTeaJuryComments','renderAdminResults','exportAdminResultsCSV','renderDeleteJurorBar','deleteJurorFromRoom',
  'swAdminTab','swUserTab',
  'showAddUser','editUser','resetUserPwd','deleteUser','bulkDeleteUsers','toggleAllCheck','updateBulkBar','importCSV','downloadSample','importTeaStudentsCSV','downloadTeaStudentsSample','sortTeaList','adminStuFilterClass',
  'addCategory','renameCategory','delCategory','addInstrument','renameInst','delInst',
  'renderInstList',
  'openStuRoomModal','saveStuRoomModal','addRoom','editRoom','delRoom','revealCode','addRoomField','removeRoomField','saveRoomFields','renderRoomFields','rfAddRule','rfRemoveRule','rfReadRulesFromDOM',
  'addClass','renameClass','delClass',
  'saveTiming','saveAnnounce','saveBulletin','renderBulletin','saveWeights','addTrim','saveTrimRules','fbSaveConfig',
  'setAccess','saveRepHint','saveTyText','clearData','saveTeaScheduleMsg',
  'publishResults','unpublishResults','renderAdminInstChangeNotices','markInstChangeRead','markAllInstChangesRead','updateDelJurorList','deleteJurorScores','cleanGhostJurors','adminPublishSnapshot',
  'erShowTab','erAdminTab','erCmd','erInsertTable','erInsertImage','erSave','erInitAdminEditors',
  'switchExamRulesTab','switchErAdminTab','saveExamRules','renderExamRulesPage','initExamRulesEditor','erExec','erMarkDirty','erHandleTab','erInsertTable','erInsertImage',
  'npKey','npDel','npConfirm','npBg','npStar',
  'openNP',
  'schSelectRoom','schSeatDir','schApplySort','schInitRoomTabs','schInitSortUI',
  'saveInstRestrict','saveRepConfirmMsg','savePendingMsgs','showPendingPage',
  'renderInstRestrictUI','renderSchCatUI',
  'exportTeaOverviewCSV','renderTeaTable','openTeaSelfAddPanel','tsaSearch','adminCommentInit','adminCommentSave','adminCommentLoadStudent','adminCommentLoadType','adminCommentFromImage','adminCommentImportCSV','adminCommentDownloadSample',
  'doInvigLogin','invigSelectRoom','toggleBlackSign','toggleLivePlay','saveScaleKey','renderInvigPage',
  'saveJRemark','saveJRemarkText',
  'switchTeaSubTab','updateJurySignupTabVisibility','teaCheckAllDone','teaInlineToggle','teaInlineEdit','teaInlineSave','renderJurySignupPage','adminJurySelectRoom','initJuryAdminRoomBar','jsupPickOpt','jsupDraftSave','saveJurySignupDraft','submitJurySignup','_renderJsupSubmittedSummary','_jsupReopenForm',
  'renderJsupAdminPanel','renderJsupOptsList','addJsupOption','jsupUpdateOptLabel','jsupUpdateOptFlag','jsupDelOption','saveJurySignupConfig','saveJsupOptions','renderJsupAdminTable','exportJsupCSV',
];
// ★ 安全暴露到 window（不用 eval，改用函數名對照表）
const _fnMap = {doLogin,doJuryDirectLogin,saveFirstPassword,doJuryLogin,doLogout,openChPwd,doChangePassword,fbSet,fbDelete,fbLoad,fbSaveInstruments,closeOverlay,openOverlay,showToast,filterRepInst,toggleElective,previewRep,backToRepForm,submitRep,editRep,renderRepDoneInfo,renderRepPage,doLookup,clearLookup,openTeaModal,swTeaTab,saveTeaComment,teaWizStart,teaWizPickClass,teaWizPickStu,teaWizPickType,teaWizBack,teaWizSaveAndNext,teaWizSubmitAll,teaWizOpenDirect,openTeaStuModal,tsmFilterClass,saveTeaStu,teaWizNameSearch,teaWizS1NameSearch,checkJuryBeforeSubmit,submitJuryAll,confirmSubmitJury,midSaveJury,toggleAbsent,saveJCell,generateSchedule,exportScheduleCSV,exportScheduleXLSX,exportAllRoomsXLSX,exportSchedulePDF,exportAllRoomsPDF,publishSchedule,schResetFilters,schResetToRoomDefaults,schSaveSchedule,schLoadSchedule,schInitSortBar,schAddExcludeRule,schRemoveExcludeRule,renderSchExcludeUI,openDisqModal,saveDisq,removeDisq,importDisqCSV,exportDisqCSV,downloadDisqSample,renderDisqList,onSchRoomChange,schRoomCatToggle,schRoomInstToggle,openSchAddModal,schAddSearch,schAddEntry,schRestoreEntry,schRemoveEntry,schAddCurrentFilter,openAddDisqIndividual,adimSearch,adimSelect,saveDisqIndividual,renderTeaSchedulePage,teaSchSelectRoom,renderLiveResults,renderTeaJuryComments,renderAdminResults,exportAdminResultsCSV,renderDeleteJurorBar,deleteJurorFromRoom,adminJurySelectRoom,initJuryAdminRoomBar,openExportSummaryModal,doExportSummary,swAdminTab,swUserTab,showAddUser,editUser,resetUserPwd,deleteUser,bulkDeleteUsers,toggleAllCheck,updateBulkBar,importCSV,downloadSample,importTeaStudentsCSV,downloadTeaStudentsSample,sortTeaList,adminStuFilterClass,addCategory,renameCategory,delCategory,addInstrument,renameInst,delInst,renderInstList,openStuRoomModal,saveStuRoomModal,addRoom,editRoom,delRoom,revealCode,addRoomField,removeRoomField,saveRoomFields,renderRoomFields,rfAddRule,rfRemoveRule,rfReadRulesFromDOM,addClass,renameClass,delClass,saveTiming,saveAnnounce,saveBulletin,renderBulletin,saveWeights,addTrim,saveTrimRules,fbSaveConfig,setAccess,saveRepHint,saveTyText,clearData,saveTeaScheduleMsg,publishResults,unpublishResults,renderAdminInstChangeNotices,markInstChangeRead,markAllInstChangesRead,updateDelJurorList,deleteJurorScores,cleanGhostJurors,adminPublishSnapshot,renderResults,editJuryScores,exportResultsCSV,toggleJurorNames,toggleRemarkFilter,setResultView,erShowTab,erAdminTab,erCmd,erInsertTable,erInsertImage,erSave,erInitAdminEditors,npKey,npDel,npConfirm,npBg,npStar,openNP,schSelectRoom,schSeatDir,schApplySort,schInitRoomTabs,schInitSortUI,saveInstRestrict,saveRepConfirmMsg,savePendingMsgs,showPendingPage,renderInstRestrictUI,renderSchCatUI,exportTeaOverviewCSV,renderTeaTable,openTeaSelfAddPanel,tsaSearch,adminCommentInit,adminCommentSave,adminCommentLoadStudent,adminCommentLoadType,adminCommentFromImage,adminCommentImportCSV,adminCommentDownloadSample,doInvigLogin,invigSelectRoom,toggleBlackSign,toggleLivePlay,saveScaleKey,renderInvigPage,saveJRemark,saveJRemarkText,switchTeaSubTab,updateJurySignupTabVisibility,teaCheckAllDone,teaInlineToggle,teaInlineEdit,teaInlineSave,renderJurySignupPage,jsupPickOpt,jsupDraftSave,saveJurySignupDraft,submitJurySignup,_renderJsupSubmittedSummary,_jsupReopenForm,renderJsupAdminPanel,renderJsupOptsList,addJsupOption,jsupUpdateOptLabel,jsupUpdateOptFlag,jsupDelOption,saveJurySignupConfig,saveJsupOptions,renderJsupAdminTable,exportJsupCSV,exportJsupCSVWide};
Object.keys(_fnMap).forEach(function(name){ window[name] = _fnMap[name]; });

// ★ 頁面載入後立即從 Firebase 同步 users，讓登入時帳密是最新狀態
(window._fbAuthReady||Promise.resolve()).then(function(){
  preloadUsersForLogin();
  // ★ 修正 #L4：管理員 session 恢復統一在 launchApp 內處理（line ~2625），此處只觸發 launchApp
  if(window._pendingAdminRestore){
    document.getElementById('login-screen').classList.add('gone');
    document.getElementById('app').classList.add('on');
    const sess=window._pendingAdminRestore;
    // 不在這裡清空，由 launchApp 內的 done callback 統一清空並還原 ST.user
    ST.user={id:sess.id,name:'...',role:'admin'};ST.role='admin';
    document.getElementById('role-pill').textContent='管理員・教師';
    document.getElementById('tb-uname').textContent='載入中...';
    launchApp();
  }
});

} // end __init__

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', __init__);
} else {
  __init__();
}

})();
