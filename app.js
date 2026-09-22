/* ===================== S6 Block Panel — offline local-storage app ===================== */
const DB_KEY = 's6_db_v1';
let DB = null;
let charts = {};

/* ---------- default data ---------- */
function defaultDB(){
  return {
    auth: { username: 'dariosh', password: '09010934619' },
    session: false,
    units: [],        // {id, unitNumber, ownerName, ownerPhone, tenantName, tenantPhone, hasTenant, charge}
    transactions: [], // {id, unitNumber, party, kind: debt|deposit, category: unit|repair, description, date, amount, paid}
    fundBalance: 0,
    futurePlans: [],  // {id, title, amount, description, date}
    lastBackupMonth: null,
    backups: []        // {month, takenAt, snapshot}
  };
}

function loadDB(){
  try{
    const raw = localStorage.getItem(DB_KEY);
    DB = raw ? JSON.parse(raw) : defaultDB();
    if(!DB.auth) DB.auth = defaultDB().auth;
    if(!DB.units) DB.units = [];
    if(!DB.transactions) DB.transactions = [];
    if(!DB.futurePlans) DB.futurePlans = [];
    if(typeof DB.fundBalance !== 'number') DB.fundBalance = 0;
    if(!DB.backups) DB.backups = [];
  }catch(e){ DB = defaultDB(); }
  saveDB();
}
function saveDB(){ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

/* ---------- number / date helpers ---------- */
function fmt(n){
  n = Math.round(Number(n)||0);
  return n.toLocaleString('en-US');
}
function toman(n){ return fmt(n)+' تومان'; }

function gregorianToJalali(gy, gm, gd){
  const g_d_m = [0,31,59,90,120,151,181,212,243,273,304,334];
  let jy = (gy <= 1600) ? 0 : 979;
  gy -= (gy <= 1600) ? 621 : 1600;
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = (365*gy) + (Math.floor((gy2+3)/4)) - (Math.floor((gy2+99)/100)) + (Math.floor((gy2+399)/400)) - 80 + gd + g_d_m[gm-1];
  jy += 33*Math.floor(days/12053);
  days %= 12053;
  jy += 4*Math.floor(days/1461);
  days %= 1461;
  if (days > 365){ jy += Math.floor((days-1)/365); days = (days-1)%365; }
  let jm, jd;
  if (days < 186){ jm = 1 + Math.floor(days/31); jd = 1 + (days%31); }
  else{ jm = 7 + Math.floor((days-186)/30); jd = 1 + ((days-186)%30); }
  return [jy, jm, jd];
}
const JMONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
function todayJalaliStr(){
  const d = new Date();
  const [jy,jm,jd] = gregorianToJalali(d.getFullYear(), d.getMonth()+1, d.getDate());
  return `${jd} ${JMONTHS[jm-1]} ${jy}`;
}
function jalaliMonthKey(){
  const d = new Date();
  const [jy,jm] = gregorianToJalali(d.getFullYear(), d.getMonth()+1, d.getDate());
  return `${jy}-${String(jm).padStart(2,'0')}`;
}

/* ---------- toast ---------- */
function toast(msg, type){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' '+type : '');
  setTimeout(()=>{ t.className='toast'; }, 2400);
}

/* ---------- LOGIN ---------- */
function toggleCredPanel(){
  document.getElementById('credPanel').classList.toggle('show');
}
function doLogin(){
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const err = document.getElementById('loginErr');
  if(u === DB.auth.username && p === DB.auth.password){
    DB.session = true; saveDB();
    err.textContent='';
    enterApp();
  }else{
    err.textContent = 'نام کاربری یا رمز عبور اشتباه است';
  }
}
function changeCreds(){
  const cu = document.getElementById('curUser').value.trim();
  const cp = document.getElementById('curPass').value;
  const nu = document.getElementById('newUser').value.trim();
  const np = document.getElementById('newPass').value;
  if(cu !== DB.auth.username || cp !== DB.auth.password){
    toast('نام کاربری یا رمز فعلی اشتباه است', 'err'); return;
  }
  if(nu) DB.auth.username = nu;
  if(np) DB.auth.password = np;
  saveDB();
  toast('تغییرات ذخیره شد', 'ok');
  document.getElementById('credPanel').classList.remove('show');
  ['curUser','curPass','newUser','newPass'].forEach(id=>document.getElementById(id).value='');
}
function secureLogout(){
  DB.session = false; saveDB();
  location.reload();
}
function enterApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('todayJalali').textContent = todayJalaliStr();
  checkMonthlyBackup();
  go('dashboard');
}

/* ---------- drawer ---------- */
function openDrawer(){ document.getElementById('drawer').classList.add('open'); document.getElementById('overlay').classList.add('show'); }
function closeDrawer(){ document.getElementById('drawer').classList.remove('open'); document.getElementById('overlay').classList.remove('show'); }

/* ---------- router ---------- */
function go(view){
  closeDrawer();
  const el = document.getElementById('pageContent');
  el.classList.remove('page'); void el.offsetWidth; el.classList.add('page');
  const renderers = {
    dashboard: renderDashboard, units: renderUnits, txn: renderTxn, bulk: renderBulk,
    sync: renderSync, reports: renderReports, editdebt: renderEditDebt, future: renderFuture
  };
  (renderers[view]||renderDashboard)();
}

/* ---------- shared computed values ---------- */
function unitLabel(u){ return `واحد ${u.unitNumber}`; }
function findUnit(num){ return DB.units.find(u=>String(u.unitNumber)===String(num)); }
function sumBy(kind){ return DB.transactions.filter(t=>t.kind===kind && !t.paid).reduce((s,t)=>s+Number(t.amount),0); }

/* ===================== DASHBOARD ===================== */
function renderDashboard(){
  const totalDeposits = DB.transactions.filter(t=>t.kind==='deposit').reduce((s,t)=>s+Number(t.amount),0);
  const openDebts = DB.transactions.filter(t=>t.kind==='debt' && !t.paid).reduce((s,t)=>s+Number(t.amount),0);

  document.getElementById('pageContent').innerHTML = `
    <div class="hero">
      <svg class="bld" width="100%" height="100%" viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice">
        <rect x="40" y="10" width="90" height="150" fill="#fff"/>
        <rect x="150" y="40" width="70" height="120" fill="#fff"/>
        <rect x="240" y="0" width="100" height="160" fill="#fff"/>
        ${Array.from({length:40}).map((_,i)=>`<rect x="${50+ (i%6)*13}" y="${20+Math.floor(i/6)*22}" width="8" height="12" fill="#0F3D91"/>`).join('')}
      </svg>
      <h2>موجودی صندوق بلوک S6</h2>
      <div class="balance">${fmt(DB.fundBalance)}<small>تومان</small></div>
    </div>

    <div class="grid2">
      <div class="card">
        <h3>واریزی‌ها به تفکیک واحد <button onclick="downloadChart('chartDeposits')">دانلود</button></h3>
        <canvas id="chartDeposits"></canvas>
      </div>
      <div class="card">
        <h3>بدهی‌ها (مالک/مستاجر) <button onclick="downloadChart('chartDebts')">دانلود</button></h3>
        <canvas id="chartDebts"></canvas>
      </div>
    </div>

    <div class="grid2">
      <div class="card"><h3>مجموع واریزی‌ها</h3><div style="font-size:20px;font-weight:800;color:var(--green)">${toman(totalDeposits)}</div></div>
      <div class="card"><h3>مجموع بدهی‌های باز</h3><div style="font-size:20px;font-weight:800;color:var(--red)">${toman(openDebts)}</div></div>
    </div>
  `;

  buildDepositsChart();
  buildDebtsChart();
}

function chartColors(n){
  const palette = ['#1D5FD6','#F5B301','#E11D2E','#1E9E5A','#0F3D91','#7C3AED','#0EA5E9','#F97316'];
  return Array.from({length:n}, (_,i)=>palette[i%palette.length]);
}

function buildDepositsChart(){
  const byUnit = {};
  DB.transactions.filter(t=>t.kind==='deposit').forEach(t=>{ byUnit[t.unitNumber] = (byUnit[t.unitNumber]||0) + Number(t.amount); });
  const labels = Object.keys(byUnit).map(u=>`واحد ${u}`);
  const data = Object.values(byUnit);
  if(charts.deposits) charts.deposits.destroy();
  const ctx = document.getElementById('chartDeposits');
  if(!data.length){ ctx.parentElement.insertAdjacentHTML('beforeend','<div class="empty-state">هنوز واریزی ثبت نشده</div>'); return; }
  charts.deposits = new Chart(ctx, { type:'pie', data:{ labels, datasets:[{ data, backgroundColor:chartColors(data.length) }] },
    options:{ plugins:{ legend:{ position:'bottom', labels:{ font:{family:'Vazirmatn'}, boxWidth:12 } } }, animation:{ animateScale:true, duration:900 } } });
}
function buildDebtsChart(){
  const ownerSum = DB.transactions.filter(t=>t.kind==='debt' && t.party==='owner' && !t.paid).reduce((s,t)=>s+Number(t.amount),0);
  const tenantSum = DB.transactions.filter(t=>t.kind==='debt' && t.party==='tenant' && !t.paid).reduce((s,t)=>s+Number(t.amount),0);
  if(charts.debts) charts.debts.destroy();
  const ctx = document.getElementById('chartDebts');
  if(!ownerSum && !tenantSum){ ctx.parentElement.insertAdjacentHTML('beforeend','<div class="empty-state">بدهی باز ثبت نشده</div>'); return; }
  charts.debts = new Chart(ctx, { type:'pie', data:{ labels:['بدهی مالکین','بدهی مستاجرین'], datasets:[{ data:[ownerSum,tenantSum], backgroundColor:['#0F3D91','#E11D2E'] }] },
    options:{ plugins:{ legend:{ position:'bottom', labels:{ font:{family:'Vazirmatn'}, boxWidth:12 } } }, animation:{ animateScale:true, duration:900 } } });
}
function downloadChart(id){
  const canvas = document.getElementById(id);
  if(!canvas){ toast('نموداری برای دانلود وجود ندارد','err'); return; }
  const link = document.createElement('a');
  link.download = id+'.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/* ===================== UNITS ===================== */
function renderUnits(){
  document.getElementById('pageContent').innerHTML = `
    <h2 class="page-title">ثبت واحدها</h2>
    <div class="card" style="margin-bottom:16px;">
      <div class="form-grid">
        <div class="field"><label class="small">شماره واحد</label><input id="uNum" type="text"></div>
        <div class="field"><label class="small">شارژ مختص به واحد (تومان)</label><input id="uCharge" type="number"></div>
        <div class="field"><label class="small">نام مالک</label><input id="uOwnerName" type="text"></div>
        <div class="field"><label class="small">شماره تلفن مالک</label><input id="uOwnerPhone" type="text"></div>
        <div class="field full">
          <label class="small">آیا واحد مستاجر دارد؟</label>
          <div class="seg">
            <button type="button" id="hasTenantYes" onclick="setHasTenant(true)">بله</button>
            <button type="button" id="hasTenantNo" onclick="setHasTenant(false)">خیر</button>
          </div>
        </div>
        <div class="field" id="tNameWrap"><label class="small">نام مستاجر</label><input id="uTenantName" type="text"></div>
        <div class="field" id="tPhoneWrap"><label class="small">شماره تلفن مستاجر</label><input id="uTenantPhone" type="text"></div>
      </div>
      <div class="actions-row"><button class="btn btn-primary" onclick="saveUnit()">ذخیره واحد</button></div>
    </div>
    <div class="table-wrap"><table class="list-table" id="unitsTable"></table></div>
  `;
  setHasTenant(true);
  renderUnitsTable();
}
let _hasTenant = true;
function setHasTenant(v){
  _hasTenant = v;
  document.getElementById('hasTenantYes').className = v ? 'active' : '';
  document.getElementById('hasTenantNo').className = !v ? 'active' : '';
  document.getElementById('tNameWrap').style.display = v ? 'block':'none';
  document.getElementById('tPhoneWrap').style.display = v ? 'block':'none';
}
function saveUnit(){
  const num = document.getElementById('uNum').value.trim();
  if(!num){ toast('شماره واحد را وارد کنید','err'); return; }
  const unit = {
    id: uid(), unitNumber:num,
    charge: Number(document.getElementById('uCharge').value)||0,
    ownerName: document.getElementById('uOwnerName').value.trim(),
    ownerPhone: document.getElementById('uOwnerPhone').value.trim(),
    hasTenant: _hasTenant,
    tenantName: _hasTenant ? document.getElementById('uTenantName').value.trim() : '',
    tenantPhone: _hasTenant ? document.getElementById('uTenantPhone').value.trim() : ''
  };
  const existingIdx = DB.units.findIndex(u=>String(u.unitNumber)===String(num));
  if(existingIdx>-1) DB.units[existingIdx] = {...DB.units[existingIdx], ...unit, id:DB.units[existingIdx].id};
  else DB.units.push(unit);
  saveDB(); toast('واحد ذخیره شد','ok'); renderUnits();
}
function renderUnitsTable(){
  const wrap = document.getElementById('unitsTable');
  if(!DB.units.length){ wrap.parentElement.innerHTML = '<div class="empty-state">هنوز واحدی ثبت نشده</div>'; return; }
  wrap.innerHTML = `<tr><th>واحد</th><th>مالک</th><th>تلفن مالک</th><th>مستاجر</th><th>تلفن مستاجر</th><th>شارژ</th><th></th></tr>` +
    DB.units.map(u=>`<tr>
      <td>${u.unitNumber}</td><td>${u.ownerName||'-'}</td><td>${u.ownerPhone||'-'}</td>
      <td>${u.hasTenant? (u.tenantName||'-') : 'ندارد'}</td><td>${u.hasTenant? (u.tenantPhone||'-') : '-'}</td>
      <td>${fmt(u.charge)}</td>
      <td><button class="mini-btn del" onclick="deleteUnit('${u.id}')">حذف</button></td>
    </tr>`).join('');
}
function deleteUnit(id){
  DB.units = DB.units.filter(u=>u.id!==id); saveDB(); renderUnits(); toast('واحد حذف شد');
}

/* ===================== DEBT / DEPOSIT ===================== */
let _txnKind='debt', _txnCategory='unit', _txnParty='owner';
function renderTxn(){
  document.getElementById('pageContent').innerHTML = `
    <h2 class="page-title">ثبت بدهی / واریزی</h2>
    <div class="card">
      <label class="small">نوع تراکنش</label>
      <div class="seg">
        <button id="kindDebt" onclick="setTxnKind('debt')">بدهی</button>
        <button id="kindDeposit" onclick="setTxnKind('deposit')">واریزی</button>
      </div>
      <label class="small" style="margin-top:10px;">دسته‌بندی</label>
      <div class="seg">
        <button id="catUnit" onclick="setTxnCategory('unit')">مربوط به واحد</button>
        <button id="catRepair" onclick="setTxnCategory('repair')">هزینه تعمیرات بلوک</button>
      </div>
      <div id="unitFields">
        <div class="form-grid" style="margin-top:12px;">
          <div class="field"><label class="small">شماره واحد</label><input id="tUnit" list="unitList" type="text"></div>
          <datalist id="unitList">${DB.units.map(u=>`<option value="${u.unitNumber}">`).join('')}</datalist>
          <div class="field">
            <label class="small">مالک یا مستاجر</label>
            <div class="seg">
              <button type="button" id="partyOwner" onclick="setTxnParty('owner')">مالک</button>
              <button type="button" id="partyTenant" onclick="setTxnParty('tenant')">مستاجر</button>
            </div>
          </div>
        </div>
      </div>
      <div class="form-grid" style="margin-top:12px;">
        <div class="field"><label class="small">مبلغ (تومان)</label><input id="tAmount" type="number"></div>
        <div class="field"><label class="small">تاریخ</label><input id="tDate" type="text" value="${todayJalaliStr()}"></div>
        <div class="field full"><label class="small">توضیحات</label><textarea id="tDesc" rows="2" style="width:100%;padding:12px;border-radius:12px;border:1.5px solid var(--line);background:#F8FAFF;"></textarea></div>
      </div>
      <div class="actions-row"><button class="btn btn-primary" onclick="saveTxn()">ثبت تراکنش</button></div>
    </div>
  `;
  setTxnKind('debt'); setTxnCategory('unit'); setTxnParty('owner');
}
function setTxnKind(k){
  _txnKind=k;
  document.getElementById('kindDebt').className = k==='debt' ? 'active red':'';
  document.getElementById('kindDeposit').className = k==='deposit' ? 'active green':'';
}
function setTxnCategory(c){
  _txnCategory=c;
  document.getElementById('catUnit').className = c==='unit' ? 'active':'';
  document.getElementById('catRepair').className = c==='repair' ? 'active yellow':'';
  document.getElementById('unitFields').style.display = c==='unit' ? 'block':'none';
}
function setTxnParty(p){
  _txnParty=p;
  document.getElementById('partyOwner').className = p==='owner'?'active':'';
  document.getElementById('partyTenant').className = p==='tenant'?'active':'';
}
function saveTxn(){
  const amount = Number(document.getElementById('tAmount').value);
  if(!amount){ toast('مبلغ را وارد کنید','err'); return; }
  const t = {
    id: uid(), kind:_txnKind, category:_txnCategory,
    unitNumber: _txnCategory==='unit' ? document.getElementById('tUnit').value.trim() : '',
    party: _txnCategory==='unit' ? _txnParty : 'repair',
    amount, date: document.getElementById('tDate').value.trim() || todayJalaliStr(),
    description: document.getElementById('tDesc').value.trim(),
    paid:false
  };
  DB.transactions.push(t);
  DB.fundBalance += (t.kind==='deposit' ? amount : 0) - (t.category==='repair' ? amount : 0);
  saveDB(); toast('تراکنش ثبت شد','ok'); renderTxn();
}

/* ===================== BULK CHARGE ===================== */
function renderBulk(){
  document.getElementById('pageContent').innerHTML = `
    <h2 class="page-title">ثبت شارژ گروهی</h2>
    <div class="card" style="margin-bottom:14px;">
      <h3>شارژ گروهی بر اساس مبلغ ثبت‌شده هر واحد</h3>
      <div class="field"><label class="small">تاریخ</label><input id="bulkDate1" type="text" value="${todayJalaliStr()}"></div>
      <div class="field"><label class="small">توضیحات</label><input id="bulkDesc1" type="text" placeholder="مثلاً شارژ ماهانه ${JMONTHS[gregorianToJalali(new Date().getFullYear(),new Date().getMonth()+1,new Date().getDate())[1]-1]}"></div>
      <div class="actions-row"><button class="btn btn-primary" onclick="runBulkStandard()">ثبت شارژ برای همه واحدها</button></div>
      <p style="font-size:11.5px;color:var(--ink-soft);margin-top:8px;">برای واحدهایی که مستاجر دارند، بدهی برای مستاجر و برای واحدهایی که مستاجر ندارند، بدهی برای مالک ثبت می‌شود.</p>
    </div>
    <div class="card">
      <h3>شارژ گروهی با مبلغ دلخواه</h3>
      <div class="form-grid">
        <div class="field"><label class="small">مبلغ برای هر واحد (تومان)</label><input id="bulkAmount2" type="number"></div>
        <div class="field"><label class="small">تاریخ</label><input id="bulkDate2" type="text" value="${todayJalaliStr()}"></div>
        <div class="field full"><label class="small">توضیحات</label><input id="bulkDesc2" type="text"></div>
      </div>
      <div class="actions-row"><button class="btn btn-primary" onclick="runBulkCustom()">ثبت شارژ دلخواه برای همه واحدها</button></div>
    </div>
  `;
}
function runBulkStandard(){
  if(!DB.units.length){ toast('ابتدا واحدها را ثبت کنید','err'); return; }
  const date = document.getElementById('bulkDate1').value.trim() || todayJalaliStr();
  const desc = document.getElementById('bulkDesc1').value.trim() || 'شارژ گروهی';
  DB.units.forEach(u=>{
    if(!u.charge) return;
    DB.transactions.push({ id:uid(), kind:'debt', category:'unit', unitNumber:u.unitNumber,
      party: u.hasTenant ? 'tenant':'owner', amount:u.charge, date, description:desc, paid:false });
  });
  saveDB(); toast('شارژ گروهی ثبت شد','ok');
}
function runBulkCustom(){
  if(!DB.units.length){ toast('ابتدا واحدها را ثبت کنید','err'); return; }
  const amount = Number(document.getElementById('bulkAmount2').value);
  if(!amount){ toast('مبلغ را وارد کنید','err'); return; }
  const date = document.getElementById('bulkDate2').value.trim() || todayJalaliStr();
  const desc = document.getElementById('bulkDesc2').value.trim() || 'شارژ گروهی دلخواه';
  DB.units.forEach(u=>{
    DB.transactions.push({ id:uid(), kind:'debt', category:'unit', unitNumber:u.unitNumber,
      party: u.hasTenant ? 'tenant':'owner', amount, date, description:desc, paid:false });
  });
  saveDB(); toast('شارژ گروهی دلخواه ثبت شد','ok');
}

/* ===================== SYNC FUND BALANCE ===================== */
function renderSync(){
  document.getElementById('pageContent').innerHTML = `
    <h2 class="page-title">همگام‌سازی موجودی صندوق</h2>
    <div class="card">
      <p style="font-size:13px;color:var(--ink-soft);margin-bottom:10px;">موجودی فعلی سیستم: <b>${toman(DB.fundBalance)}</b></p>
      <div class="field"><label class="small">موجودی واقعی صندوق (تومان)</label><input id="syncAmount" type="number"></div>
      <div class="actions-row"><button class="btn btn-primary" onclick="doSync()">به‌روزرسانی موجودی</button></div>
    </div>
  `;
}
function doSync(){
  const v = Number(document.getElementById('syncAmount').value);
  if(isNaN(v)){ toast('مقدار معتبر وارد کنید','err'); return; }
  DB.fundBalance = v; saveDB(); toast('موجودی صندوق به‌روزرسانی شد','ok'); renderSync();
}

/* ===================== REPORTS ===================== */
function renderReports(){
  document.getElementById('pageContent').innerHTML = `
    <h2 class="page-title">گزارش‌گیری</h2>
    <div class="filters">
      <select id="fUnit"><option value="">همه واحدها</option>${[...new Set(DB.units.map(u=>u.unitNumber))].map(n=>`<option value="${n}">واحد ${n}</option>`).join('')}</select>
      <select id="fParty"><option value="">مالک/مستاجر</option><option value="owner">مالک</option><option value="tenant">مستاجر</option></select>
      <select id="fCategory"><option value="">بیلان/تعمیرات</option><option value="unit">بیلان واحدها</option><option value="repair">تعمیرات بلوک</option></select>
      <input id="fSearch" type="text" placeholder="جستجوی متن...">
      <button class="btn btn-primary" onclick="renderReportTable()" style="padding:9px 16px;">اعمال فیلتر</button>
    </div>
    <div class="table-wrap"><table class="list-table" id="reportTable"></table></div>
    <div class="actions-row">
      <button class="btn btn-primary" onclick="exportReportPDF()">دانلود PDF</button>
      <button class="btn btn-primary" style="background:linear-gradient(135deg,var(--yellow),#c98e00);color:#5a3d00;" onclick="exportReportJPEG()">دانلود JPEG</button>
    </div>
  `;
  renderReportTable();
}
function filteredTxns(){
  const unit = document.getElementById('fUnit')?.value || '';
  const party = document.getElementById('fParty')?.value || '';
  const cat = document.getElementById('fCategory')?.value || '';
  const search = (document.getElementById('fSearch')?.value || '').trim().toLowerCase();
  return DB.transactions.filter(t=>{
    if(unit && String(t.unitNumber)!==String(unit)) return false;
    if(party && t.party!==party) return false;
    if(cat && t.category!==cat) return false;
    if(search){
      const hay = `${t.unitNumber} ${t.description} ${t.date} ${t.amount}`.toLowerCase();
      if(!hay.includes(search)) return false;
    }
    return true;
  }).sort((a,b)=> (b.date||'').localeCompare(a.date||''));
}
function rowClass(t){
  if(t.category==='repair') return 'repair';
  return t.kind==='debt' ? 'debt' : 'deposit';
}
function renderReportTable(){
  const rows = filteredTxns();
  const table = document.getElementById('reportTable');
  if(!rows.length){ table.parentElement.innerHTML = '<div class="empty-state">موردی یافت نشد</div>'; return; }
  table.innerHTML = `<tr><th>تاریخ</th><th>واحد</th><th>مالک/مستاجر</th><th>نوع</th><th>مبلغ</th><th>توضیحات</th><th>وضعیت</th></tr>` +
    rows.map(t=>`<tr class="${rowClass(t)} ${t.paid?'paid':''}">
      <td>${t.date}</td><td>${t.unitNumber||'-'}</td>
      <td>${t.category==='repair' ? 'تعمیرات بلوک' : (t.party==='owner'?'مالک':'مستاجر')}</td>
      <td class="tag">${t.category==='repair' ? 'تعمیرات' : (t.kind==='debt'?'بدهی':'واریزی')}</td>
      <td>${fmt(t.amount)}</td><td>${t.description||'-'}</td>
      <td>${t.paid ? 'پرداخت شد' : (t.kind==='debt' ? 'باز' : '-')}</td>
    </tr>`).join('');
}
function exportReportPDF(){
  const el = document.getElementById('reportTable');
  if(!el || !el.rows || !el.rows.length){ toast('چیزی برای دانلود نیست','err'); return; }
  html2canvas(el, {scale:2, backgroundColor:'#ffffff'}).then(canvas=>{
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({orientation:'p', unit:'pt', format:'a4'});
    const imgW = 555, imgH = canvas.height * (imgW/canvas.width);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 20, 20, imgW, imgH);
    pdf.save('گزارش-بلوک-S6.pdf');
    toast('PDF دانلود شد','ok');
  }).catch(()=>toast('خطا در ساخت PDF','err'));
}
function exportReportJPEG(){
  const el = document.getElementById('reportTable');
  if(!el || !el.rows || !el.rows.length){ toast('چیزی برای دانلود نیست','err'); return; }
  html2canvas(el, {scale:2, backgroundColor:'#ffffff'}).then(canvas=>{
    const link = document.createElement('a');
    link.download = 'گزارش-بلوک-S6.jpg';
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
    toast('JPEG دانلود شد','ok');
  }).catch(()=>toast('خطا در ساخت تصویر','err'));
}

/* ===================== EDIT DEBT ===================== */
function renderEditDebt(){
  const openDebts = DB.transactions.filter(t=>t.kind==='debt' && !t.paid).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  document.getElementById('pageContent').innerHTML = `
    <h2 class="page-title">ویرایش بدهی</h2>
    <div class="table-wrap"><table class="list-table" id="debtTable">
      ${!openDebts.length ? '' : `<tr><th>تاریخ</th><th>واحد</th><th>مالک/مستاجر</th><th>مبلغ</th><th>توضیحات</th><th></th></tr>` +
        openDebts.map(t=>`<tr class="debt">
          <td>${t.date}</td><td>${t.unitNumber||'-'}</td>
          <td>${t.category==='repair'?'تعمیرات بلوک':(t.party==='owner'?'مالک':'مستاجر')}</td>
          <td>${fmt(t.amount)}</td><td>${t.description||'-'}</td>
          <td><button class="mini-btn paid" onclick="markPaid('${t.id}')">پرداخت شد</button></td>
        </tr>`).join('')}
    </table></div>
    ${!openDebts.length ? '<div class="empty-state">بدهی بازی وجود ندارد</div>' : ''}
  `;
}
function markPaid(id){
  const t = DB.transactions.find(x=>x.id===id);
  if(!t) return;
  t.paid = true;
  saveDB(); toast('به‌عنوان پرداخت‌شده ثبت شد','ok'); renderEditDebt();
}

/* ===================== FUTURE PLANS ===================== */
function renderFuture(){
  document.getElementById('pageContent').innerHTML = `
    <h2 class="page-title">مدیریت برنامه‌های آینده</h2>
    <p style="font-size:11.5px;color:var(--ink-soft);margin-bottom:12px;">این بخش مستقل است و هیچ تاثیری روی موجودی صندوق یا گزارش‌گیری ندارد.</p>
    <div class="card" style="margin-bottom:16px;">
      <div class="form-grid">
        <div class="field"><label class="small">عنوان برنامه</label><input id="fpTitle" type="text"></div>
        <div class="field"><label class="small">هزینه تخمینی (تومان)</label><input id="fpAmount" type="number"></div>
        <div class="field"><label class="small">تاریخ</label><input id="fpDate" type="text" value="${todayJalaliStr()}"></div>
        <div class="field full"><label class="small">توضیحات</label><input id="fpDesc" type="text"></div>
      </div>
      <div class="actions-row"><button class="btn btn-primary" onclick="saveFuturePlan()">افزودن برنامه</button></div>
    </div>
    <div class="table-wrap"><table class="list-table" id="futureTable"></table></div>
  `;
  renderFutureTable();
}
function saveFuturePlan(){
  const title = document.getElementById('fpTitle').value.trim();
  if(!title){ toast('عنوان را وارد کنید','err'); return; }
  DB.futurePlans.push({ id:uid(), title, amount:Number(document.getElementById('fpAmount').value)||0,
    date: document.getElementById('fpDate').value.trim()||todayJalaliStr(), description: document.getElementById('fpDesc').value.trim() });
  saveDB(); toast('برنامه اضافه شد','ok'); renderFuture();
}
function renderFutureTable(){
  const wrap = document.getElementById('futureTable');
  if(!DB.futurePlans.length){ wrap.parentElement.innerHTML='<div class="empty-state">برنامه‌ای ثبت نشده</div>'; return; }
  wrap.innerHTML = `<tr><th>تاریخ</th><th>عنوان</th><th>هزینه تخمینی</th><th>توضیحات</th><th></th></tr>` +
    DB.futurePlans.map(f=>`<tr><td>${f.date}</td><td>${f.title}</td><td>${fmt(f.amount)}</td><td>${f.description||'-'}</td>
      <td><button class="mini-btn del" onclick="deleteFuture('${f.id}')">حذف</button></td></tr>`).join('');
}
function deleteFuture(id){ DB.futurePlans = DB.futurePlans.filter(f=>f.id!==id); saveDB(); renderFuture(); }

/* ===================== MONTHLY BACKUP ===================== */
function checkMonthlyBackup(){
  const mKey = jalaliMonthKey();
  if(DB.lastBackupMonth === mKey) return;
  const snapshot = JSON.stringify(DB);
  DB.backups.push({ month: mKey, takenAt: todayJalaliStr(), snapshot });
  if(DB.backups.length > 12) DB.backups.shift();
  DB.lastBackupMonth = mKey;
  saveDB();
  try{
    const blob = new Blob([snapshot], {type:'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `پشتیبان-بلوک-S6-${mKey}.json`;
    link.click();
    toast('بک‌آپ ماهانه ذخیره شد','ok');
  }catch(e){}
}

/* ---------- boot ---------- */
loadDB();
if(DB.session){ enterApp(); }
