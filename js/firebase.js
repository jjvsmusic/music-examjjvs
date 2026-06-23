
// ══════════════════════════════════════════════
// Firebase 設定（REST API 模式，不載入任何外部 script）
// ══════════════════════════════════════════════
(function(){
  const PROJECT = 'musicexamjjvs';
  const API_KEY = 'AIzaSyBf6ApINYaNblGk6NScUy48MwjjrUNB_Lk';
  const FS_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
  const AUTH_BASE = 'https://identitytoolkit.googleapis.com/v1';

  // ── token 管理 ──
  let _idToken = null;
  let _tokenExpiry = 0;
  let _tokenPromise = null; // ★ 修正 #A4：並發鎖
  async function _getToken(){
    if(_idToken && Date.now() < _tokenExpiry - 60000) return _idToken;
    // ★ 修正 #A4：若已有正在進行的 token request，直接 await 同一個
    if(_tokenPromise) return _tokenPromise;
    _tokenPromise = (async()=>{
      const withTimeout = (promise, ms) => Promise.race([
        promise,
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),ms))
      ]);
      try {
        let refreshToken = null;
        try { refreshToken = localStorage.getItem('_fbRefreshToken'); } catch(e){}

        if(refreshToken){
          const r = await withTimeout(fetch(`${AUTH_BASE}/token?key=${API_KEY}`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({grant_type:'refresh_token', refresh_token: refreshToken})
          }), 8000);
          if(r.ok){
            const d = await r.json();
            _idToken = d.id_token;
            _tokenExpiry = Date.now() + (parseInt(d.expires_in)||3600)*1000;
            try { localStorage.setItem('_fbRefreshToken', d.refresh_token); } catch(e){}
            return _idToken;
          }
        }
        const r2 = await withTimeout(fetch(`${AUTH_BASE}/accounts:signUp?key=${API_KEY}`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({returnSecureToken:true})
        }), 8000);
        if(r2.ok){
          const d2 = await r2.json();
          _idToken = d2.idToken;
          _tokenExpiry = Date.now() + (parseInt(d2.expiresIn)||3600)*1000;
          try { localStorage.setItem('_fbRefreshToken', d2.refreshToken); } catch(e){}
          window._fbUid = d2.localId;
          return _idToken;
        }
      } catch(e){
        console.warn('[FB-REST] token 取得失敗:', e.message);
      }
      return null;
    })().finally(()=>{_tokenPromise=null;});
    return _tokenPromise;
  }

  // ── Firestore 值轉換：JS → Firestore 格式 ──
  function _toFS(val){
    if(val === null || val === undefined) return {nullValue: null};
    if(typeof val === 'boolean') return {booleanValue: val};
    if(typeof val === 'number') return Number.isInteger(val) ? {integerValue: String(val)} : {doubleValue: val};
    if(typeof val === 'string') return {stringValue: val};
    if(Array.isArray(val)) return {arrayValue:{values: val.map(_toFS)}};
    if(val instanceof Date) return {timestampValue: val.toISOString()};
    if(typeof val === 'object'){
      const fields = {};
      Object.keys(val).forEach(k => { fields[k] = _toFS(val[k]); });
      return {mapValue:{fields}};
    }
    return {stringValue: String(val)};
  }

  // ── Firestore 值轉換：Firestore → JS ──
  function _fromFS(fval){
    if(!fval) return null;
    if('nullValue' in fval) return null;
    if('booleanValue' in fval) return fval.booleanValue;
    if('integerValue' in fval) return parseInt(fval.integerValue);
    if('doubleValue' in fval) return fval.doubleValue;
    if('stringValue' in fval) return fval.stringValue;
    if('timestampValue' in fval) return fval.timestampValue;
    if('arrayValue' in fval) return (fval.arrayValue.values||[]).map(_fromFS);
    if('mapValue' in fval){
      const obj = {};
      Object.keys(fval.mapValue.fields||{}).forEach(k => { obj[k] = _fromFS(fval.mapValue.fields[k]); });
      return obj;
    }
    return null;
  }

  // ── 文件轉換 ──
  function _docToObj(doc){
    const obj = {id: doc.name.split('/').pop()};
    Object.keys(doc.fields||{}).forEach(k => { obj[k] = _fromFS(doc.fields[k]); });
    return obj;
  }

  // ── REST helpers ──
  async function _fsGet(path){
    const token = await _getToken();
    const headers = token ? {Authorization:'Bearer '+token} : {};
    const r = await fetch(`${FS_BASE}/${path}`, {headers});
    if(!r.ok) return null;
    return r.json();
  }

  async function _fsList(col){
    const token = await _getToken();
    const headers = token ? {Authorization:'Bearer '+token} : {};
    const results = [];
    let pageToken = null;
    do {
      const url = `${FS_BASE}/${col}?pageSize=300${pageToken?'&pageToken='+pageToken:''}`;
      const r = await fetch(url, {headers});
      if(!r.ok) break;
      const d = await r.json();
      (d.documents||[]).forEach(doc => results.push(_docToObj(doc)));
      pageToken = d.nextPageToken || null;
    } while(pageToken);
    return results;
  }

  // ★ 取得單一文件
  async function _fsGet(path){
    const token = await _getToken();
    const headers = token ? {Authorization:'Bearer '+token} : {};
    try {
      const r = await fetch(`${FS_BASE}/${path}`, {headers});
      if(!r.ok) return null;
      const doc = await r.json();
      if(!doc.fields) return null;
      const obj={};
      Object.keys(doc.fields).forEach(k=>{obj[k]=_fromFS(doc.fields[k]);});
      return obj;
    } catch(e) { return null; }
  }

  // ★ 修正：Firestore updateMask.fieldPaths 規定欄位名稱必須符合 [a-zA-Z_][a-zA-Z0-9_]*
  //   否則整個請求會回 400 Bad Request（例如評審 ID 含中文姓名：JN_r123_王小明）
  //   不符合此格式的欄位名稱需用反引號包起來，並跳脫反引號/反斜線
  function _escapeFieldPath(name){
    if(/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(name)) return name;
    return '`' + String(name).replace(/\\/g,'\\\\').replace(/`/g,'\\`') + '`';
  }

  async function _fsSet(path, data){
    const token = await _getToken();
    const headers = {'Content-Type':'application/json', ...(token?{Authorization:'Bearer '+token}:{})};
    const keys = Object.keys(data);
    const needsEscape = keys.some(k=>!/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(k));
    // ★ 含陣列值時，updateMask 合併在某些情況下不可靠，一律改用「讀取-合併-整份寫回」
    const hasArray = keys.some(k=>Array.isArray(data[k]));

    if(needsEscape || hasArray){
      // ★ 修正：欄位名稱含中文（如評審姓名 JN_xxx_王小明）時，updateMask.fieldPaths
      //   的反引號跳脫在 Firestore REST API 上不可靠，改用「讀取整份文件 → 本機合併 → 整份寫回」
      //   避免寫入到跟原欄位不同的路徑、造成重新整理後改動消失的問題。
      const existing = await _fsGet(path) || {};
      const merged = {...existing};
      keys.forEach(k => { merged[k] = data[k]; });
      const fields = {};
      Object.keys(merged).forEach(k => { fields[k] = _toFS(merged[k]); });
      const r = await fetch(`${FS_BASE}/${path}`, {
        method: 'PATCH', // 無 updateMask -> 整份覆寫（已在上面合併過舊欄位，等同 merge）
        headers,
        body: JSON.stringify({fields})
      });
      return r.ok;
    }

    // ★ 修正 R1：用 updateMask 做真 merge（否則 PATCH 整個取代會清掉其他欄位）
    const fields = {};
    const mask = [];
    keys.forEach(k => {
      fields[k] = _toFS(data[k]);
      mask.push(_escapeFieldPath(k));
    });
    // 構造帶 updateMask.fieldPaths 的 URL
    const maskQuery = mask.map(p=>'updateMask.fieldPaths='+encodeURIComponent(p)).join('&');
    const url = `${FS_BASE}/${path}?${maskQuery}`;
    const r = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({fields})
    });
    return r.ok;
  }

  async function _fsDelete(path){
    const token = await _getToken();
    const headers = token ? {Authorization:'Bearer '+token} : {};
    const r = await fetch(`${FS_BASE}/${path}`, {method:'DELETE', headers});
    return r.ok;
  }

  // ── window._FB 相容層（讓現有程式碼能繼續用） ──
  // ★ 修正 R2：db 不能為 null（很多函式直接 const {db}=window._FB; db.collection(...)）
  //    提供 collection 介面相容於 SDK
  const _restDb = {
    collection: function(col){ return {
      doc: function(docId){ return {
        id: docId,
        set: function(data, opts){ return _fsSet(col+'/'+docId, data); },
        get: function(){ return _fsGet(col+'/'+docId).then(d => d ? {exists:true, data:()=>_docToObj(d), id:docId} : {exists:false, data:()=>({}), id:docId}); },
        update: function(data){ return _fsSet(col+'/'+docId, data); },
        delete: function(){ return _fsDelete(col+'/'+docId); },
        collection: function(subCol){ return {
          doc: function(subId){ return {
            id: subId,
            set: function(data, opts){ return _fsSet(col+'/'+docId+'/'+subCol+'/'+subId, data); },
            get: function(){ return _fsGet(col+'/'+docId+'/'+subCol+'/'+subId).then(d => d ? {exists:true, data:()=>_docToObj(d)} : {exists:false, data:()=>({})}); },
            delete: function(){ return _fsDelete(col+'/'+docId+'/'+subCol+'/'+subId); },
          };},
          get: function(){ return _fsList(col+'/'+docId+'/'+subCol).then(docs=>({
            size: docs.length,
            forEach: fn => docs.forEach(d=>fn({id:d.id, ref:{
              delete: ()=>_fsDelete(col+'/'+docId+'/'+subCol+'/'+d.id),
              collection: ()=>({}) // not implemented
            }, data:()=>d}))
          })); },
        };}
      };},
      get: function(){ return _fsList(col).then(docs=>({
        size: docs.length,
        forEach: fn => docs.forEach(d=>fn({id:d.id, ref:{
          delete: ()=>_fsDelete(col+'/'+d.id),
          collection: subCol=>({get: ()=>_fsList(col+'/'+d.id+'/'+subCol)})
        }, data:()=>d}))
      })); }
    };}
  };

  window._FB = {
    db: _restDb, // ★ 修正 R2：提供相容物件而非 null
    _rest: true,
    serverTimestamp: () => new Date().toISOString(),

    // 舊版相容（兩參數版本）
    collection: function(_, col){ return _restDb.collection(col); },

    // list collection
    _list: _fsList,
    _get: _fsGet,
    _set: _fsSet,
    _delete: _fsDelete,
  };

  // ★ 修正 #F2：全域 timer registry，避免重複註冊與洩漏
  window._pollTimers = window._pollTimers || {};
  // 單一 visibilitychange listener 管理所有 polls
  if(!window._visListenerInstalled){
    window._visListenerInstalled = true;
    document.addEventListener('visibilitychange',()=>{
      Object.values(window._pollTimers||{}).forEach(t=>{
        if(document.hidden){
          if(t.id){clearInterval(t.id);t.id=null;}
        } else {
          if(!t.id&&t.fn){t.id=setInterval(t.fn,t.interval);t.fn();}
        }
      });
    });
  }

  // ★ 離線化方案：liveExam 輪詢已停用（原本每 6 秒輪詢，每天造成 ~72 萬次讀取）
  window._startLiveExamListener = function(){ /* disabled — offline mode */ };

  window._startJuryListener = function(){
    if(!window._FB)return;
    // ★ 修正：ST 定義在另一個 IIFE 內，須透過 window.ST 訪問
    const ST=window.ST;
    if(!ST)return; // 未登入時略過
    // ★ 改進 C：評審角色完全停用輪詢（評審只需要評自己的，不需看別人即時分數）
    if(ST.role==='jury')return;
    // 學生、監考也不需要
    if(ST.role==='student'||ST.role==='invigilator')return;
    // 只剩下 admin（看成績彙整 / 評審頁）
    if(window._pollTimers.jury){return;}
    async function pollJury(){
      if(document.hidden)return;
      const resultsOn=document.getElementById('pg-results')?.classList.contains('on');
      const juryOn=document.getElementById('pg-jury')?.classList.contains('on');
      // 沒在看相關頁面就跳過
      if(!resultsOn&&!juryOn)return;
      // ★ 改進 A：管理員只讀「目前查看的考場」(result-room 下拉值，或 jury-admin 選的考場)
      let targetRoomId='';
      if(resultsOn){
        targetRoomId=document.getElementById('result-room')?.value||'';
      } else if(juryOn){
        targetRoomId=ST._adminJuryRoomId||'';
      }
      // 都沒選的話，預設拿第一個考場（不再讀全部）
      if(!targetRoomId&&window.DB?.rooms?.length){
        targetRoomId=window.DB.rooms[0].id;
      }
      if(!targetRoomId)return;
      try{
        const docs=await _fsList('juryScores/'+targetRoomId+'/entries');
        if(!window.DB.juryScores[targetRoomId])window.DB.juryScores[targetRoomId]={};
        let changed=false;
        docs.forEach(d=>{
          const {id,...rest}=d;
          if(JSON.stringify(window.DB.juryScores[targetRoomId][id])!==JSON.stringify(rest)){
            window.DB.juryScores[targetRoomId][id]=rest;
            changed=true;
          }
        });
        if(changed){
          if(resultsOn&&typeof renderResults==='function')renderResults();
          if(juryOn&&typeof renderJuryTable==='function')renderJuryTable();
        }
      }catch(e){}
    }
    // ★ 拉長到 60 秒（管理員看彙整不需要那麼即時）
    const interval=60000;
    pollJury();
    window._pollTimers.jury={fn:pollJury,interval,id:setInterval(pollJury,interval)};
  };

  // ★ 局部更新監考表格
  window._patchInvigLive = function(){
    const roomId=ST.invigRoom?.id;if(!roomId)return;
    const liveState=DB.liveExam[roomId]||{};
    const liveKey=liveState.playing||'';
    const liveScaleKey=liveState.scaleKey||'';
    let entries;
    if(DB.savedScheduleSnapshot[roomId]&&DB.savedScheduleSnapshot[roomId].length){
      entries=DB.savedScheduleSnapshot[roomId];
    } else {
      entries=getScheduleEntries().filter(e=>e.roomId===roomId);
    }
    if(!entries.length)return;
    entries.forEach((e,i)=>{
      const entryKey=e.studentId+'_'+e.type;
      const isLive=liveKey===entryKey;
      const row=document.getElementById('iv-row-'+i);
      const playBtn=document.getElementById('iv-play-'+i);
      const scaleInp=document.getElementById('iv-scale-'+i);
      if(!row)return;
      const isBlack=!!(DB.blackSign[roomId]?.[entryKey]);
      row.style.background=isBlack?'rgba(139,105,20,0.13)':isLive?'rgba(36,113,163,0.10)':'';
      if(playBtn){
        playBtn.className='playing-btn '+(isLive?'playing':'idle');
        playBtn.textContent=isLive?'🎵 演奏中（點擊結束）':'▶ 點此開始演奏';
      }
      if(scaleInp){
        scaleInp.disabled=!isLive;
        scaleInp.title=isLive?'':'請先點擊演奏中';
        if(document.activeElement!==scaleInp){
          scaleInp.value=isLive?liveScaleKey:'';
        }
      }
    });
  };

  // _fbAuthReady：REST 模式下直接 resolve
  window._fbAuthReady = _getToken().then(t => {
    console.log('[FB-REST] 認證完成, token:', t?'OK':'無');
    return t;
  }).catch(() => Promise.resolve(null));

  console.log('[FB-REST] Firebase REST 模式已啟動 ✓');
})();

