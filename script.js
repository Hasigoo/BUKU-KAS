(() => {
  "use strict";

  const cfg = window.SUPABASE_CONFIG || {};
  const hasConfig = cfg.url && cfg.key &&
    !cfg.url.includes("PROJECT-ANDA") &&
    !cfg.key.includes("ISI_PUBLISHABLE");

  const supabase = hasConfig
    ? window.supabase.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;

  const LS_PROD = "sijunjuang_produksi_v2";
  const LS_KEU = "sijunjuang_keuangan_v2";
  const LS_PENDING = "sijunjuang_pending_v2";
  const LS_META = "sijunjuang_meta_v2";
  let produksi = loadLS(LS_PROD, []);
  let keuangan = loadLS(LS_KEU, []);
  let pending = loadLS(LS_PENDING, []);
  let currentUser = null;
  let role = "viewer";
  let localMode = false;
  let chartProd = null, chartKeu = null;

  const $ = id => document.getElementById(id);
  const today = () => new Date().toISOString().slice(0,10);
  const money = n => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n)||0);
  const num = n => Number(n)||0;
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : "id-"+Date.now()+"-"+Math.random().toString(16).slice(2);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  function loadLS(k, fallback){ try{return JSON.parse(localStorage.getItem(k)) ?? fallback}catch{return fallback} }
  function saveLS(){ localStorage.setItem(LS_PROD,JSON.stringify(produksi)); localStorage.setItem(LS_KEU,JSON.stringify(keuangan)); localStorage.setItem(LS_PENDING,JSON.stringify(pending)); localStorage.setItem(LS_META,JSON.stringify({lastLocalSave:new Date().toISOString()})); updateHome(); }

  function setMsg(id,text,error=true){ const e=$(id); if(!e)return; e.textContent=text||""; e.style.color=error?"#b91c1c":"#166534"; }

  function updateConnection(){
    const online = navigator.onLine && !!supabase;
    const b=$("connectionBadge");
    b.textContent = online ? "Online" : "Offline";
    b.className = "badge " + (online ? "online":"offline");
    $("homeOnline").textContent = online ? "Online" : "Offline";
  }

  function updateHome(){
    $("homeProduksi").textContent = produksi.length;
    $("homeKeuangan").textContent = keuangan.length;
    $("localCounts").textContent = `${produksi.length} produksi / ${keuangan.length} transaksi`;
    $("homeRole").textContent = localMode ? "Viewer lokal" : role.toUpperCase();
    const meta=loadLS(LS_META,{});
    $("syncText").textContent = meta.lastSync ? "Sinkron terakhir: "+new Date(meta.lastSync).toLocaleString("id-ID") : "Belum sinkron";
  }

  function showApp(){
    $("loginView").classList.add("hidden");
    $("mainView").classList.remove("hidden");
    $("btnLogout").classList.toggle("hidden", localMode);
    $("userBadge").textContent = localMode ? "Viewer Lokal" : `${role.toUpperCase()} • ${currentUser?.email||""}`;
    $("adminProduksiForm").classList.toggle("hidden", role !== "admin" || localMode);
    $("adminKeuanganForm").classList.toggle("hidden", role !== "admin" || localMode);
    updateHome(); renderAll();
  }

  function showLogin(){
    $("mainView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    $("btnLogout").classList.add("hidden");
    $("userBadge").textContent="Belum login";
  }

  function navigate(page){
    document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
    const target=$("page-"+page) || $("page-home");
    target.classList.remove("hidden");
    document.querySelectorAll(".nav").forEach(n=>n.classList.toggle("active",n.dataset.page===page));
    if(page==="grafik") renderCharts();
    if(page==="laporan") renderReport();
  }

  document.querySelectorAll(".nav").forEach(n=>n.addEventListener("click",()=>navigate(n.dataset.page)));
  document.querySelectorAll("[data-page]").forEach(n=>n.addEventListener("click",()=>navigate(n.dataset.page)));

  async function login(){
    if(!supabase){ setMsg("loginMsg","Isi config.js terlebih dahulu."); return; }
    const email=$("loginEmail").value.trim(), password=$("loginPassword").value;
    if(!email||!password){setMsg("loginMsg","Email dan password wajib diisi.");return}
    setMsg("loginMsg","Memproses...",false);
    const {data,error}=await supabase.auth.signInWithPassword({email,password});
    if(error){setMsg("loginMsg",error.message);return}
    currentUser=data.user;
    await loadRole();
    localMode=false;
    await pullOnline();
    showApp();
  }

  async function loadRole(){
    role="viewer";
    if(!currentUser||!supabase)return;
    const {data,error}=await supabase.from("profiles").select("role").eq("id",currentUser.id).maybeSingle();
    if(!error && data?.role) role=data.role;
  }

  async function logout(){
    if(supabase) await supabase.auth.signOut({scope:"local"});
    currentUser=null; localMode=false; role="viewer"; showLogin();
  }

  async function boot(){
    updateConnection();
    window.addEventListener("online",()=>{updateConnection(); if(currentUser&&!localMode) syncAll()});
    window.addEventListener("offline",updateConnection);
    $("btnLogin").onclick=login;
    $("btnLogout").onclick=logout;
    $("btnLocalView").onclick=()=>{localMode=true;role="viewer";showApp()};
    $("btnSync").onclick=syncAll;
    $("btnSyncHome").onclick=syncAll;
    $("btnLocalSave").onclick=()=>{saveLS();setMsg("backupMsg","Cache lokal disimpan.","false")};
    $("btnLocalClear").onclick=()=>{if(confirm("Hapus cache lokal di perangkat ini? Database online tidak ikut terhapus.")){produksi=[];keuangan=[];pending=[];saveLS();renderAll()}};
    $("btnBackup").onclick=downloadBackup;
    $("restoreFile").addEventListener("change",restoreBackup);
    $("btnPassword").onclick=changePassword;
    $("btnTestDb").onclick=testDb;
    $("produksiForm").addEventListener("submit",saveProduksi);
    $("keuanganForm").addEventListener("submit",saveKeuangan);
    $("btnProdBatal").onclick=resetProdForm;
    $("btnKeuBatal").onclick=resetKeuForm;
    $("prodSearch").oninput=renderProduksi;
    $("keuSearch").oninput=renderKeuangan;
    $("btnProdExcel").onclick=()=>exportExcel("produksi");
    $("btnKeuExcel").onclick=()=>exportExcel("keuangan");
    $("btnProdPrint").onclick=()=>printTable("Produksi");
    $("btnKeuPrint").onclick=()=>printTable("Keuangan");
    $("btnFilter").onclick=renderReport;
    $("btnFilterReset").onclick=()=>{$("filterDari").value="";$("filterSampai").value="";renderReport()};

    if(supabase){
      const {data}=await supabase.auth.getSession();
      if(data?.session?.user){
        currentUser=data.session.user;
        await loadRole();
        localMode=false;
        await pullOnline();
        showApp();
      } else showLogin();

      supabase.auth.onAuthStateChange(async (event,session)=>{
        if(event==="SIGNED_OUT"){currentUser=null;localMode=false;showLogin()}
        if(session?.user && event==="SIGNED_IN"){currentUser=session.user;await loadRole();showApp()}
      });
      setupRealtime();
    } else {
      showLogin();
    }
    renderAll();
  }

  async function pullOnline(){
    if(!supabase || !navigator.onLine || !currentUser) return;
    setMsg("backupMsg","Mengambil database online...",false);
    const [p,k]=await Promise.all([
      supabase.from("produksi").select("*").order("tanggal",{ascending:false}),
      supabase.from("keuangan").select("*").order("tanggal",{ascending:false})
    ]);
    if(p.error || k.error){
      setMsg("backupMsg",(p.error||k.error).message);
      return;
    }
    produksi=(p.data||[]).map(normalizeProd);
    keuangan=(k.data||[]).map(normalizeKeu);
    pending=[];
    saveLS();
    localStorage.setItem(LS_META,JSON.stringify({lastSync:new Date().toISOString()}));
    updateHome();renderAll();
    setMsg("backupMsg","Database online berhasil dimuat.","false");
  }

  function normalizeProd(x){return {id:x.id,tanggal:x.tanggal,nama_barang:x.nama_barang,produksi_kg:num(x.produksi_kg),terjual_kg:num(x.terjual_kg),keterangan:x.keterangan||"",updated_at:x.updated_at||new Date().toISOString()}}
  function normalizeKeu(x){return {id:x.id,tanggal:x.tanggal,jenis:x.jenis,kategori:x.kategori,jumlah:num(x.jumlah),keterangan:x.keterangan||"",updated_at:x.updated_at||new Date().toISOString()}}

  async function saveOnline(table,row){
    if(!supabase || !currentUser || localMode || !navigator.onLine){pending.push({table,action:"upsert",row});saveLS();return}
    const {error}=await supabase.from(table).upsert(row,{onConflict:"id"});
    if(error){pending.push({table,action:"upsert",row});saveLS();throw error}
  }

  async function deleteOnline(table,id){
    if(!supabase || !currentUser || localMode || !navigator.onLine){pending.push({table,action:"delete",id});saveLS();return}
    const {error}=await supabase.from(table).delete().eq("id",id);
    if(error){pending.push({table,action:"delete",id});saveLS();throw error}
  }

  async function syncAll(){
    if(!supabase || !currentUser || localMode){setMsg("backupMsg","Login online sebagai admin/viewer untuk sinkronisasi.");return}
    if(!navigator.onLine){setMsg("backupMsg","Internet sedang offline. Cache lokal tetap bisa digunakan.");return}
    try{
      setMsg("backupMsg","Mengirim perubahan lokal...",false);
      const ops=[...pending]; pending=[];
      for(const op of ops){
        if(role!=="admin" && op.action!=="noop") continue;
        if(op.action==="upsert"){const {error}=await supabase.from(op.table).upsert(op.row,{onConflict:"id"});if(error)throw error}
        if(op.action==="delete"){const {error}=await supabase.from(op.table).delete().eq("id",op.id);if(error)throw error}
      }
      saveLS();
      await pullOnline();
    }catch(e){
      setMsg("backupMsg","Sinkronisasi gagal: "+e.message);
      saveLS();
    }
  }

  async function saveProduksi(ev){
    ev.preventDefault(); if(role!=="admin"||localMode)return;
    const id=$("prodId").value||uid();
    const row={id,tanggal:$("prodTanggal").value,nama_barang:$("prodNama").value.trim(),produksi_kg:num($("prodJumlah").value),terjual_kg:num($("prodTerjual").value),keterangan:$("prodKet").value.trim(),updated_at:new Date().toISOString()};
    if(row.terjual_kg>row.produksi_kg){alert("Terjual tidak boleh lebih besar dari produksi.");return}
    const i=produksi.findIndex(x=>x.id===id); if(i>=0)produksi[i]=row;else produksi.push(row);
    saveLS(); resetProdForm(); renderAll();
    try{await saveOnline("produksi",row)}catch(e){alert("Data disimpan lokal, tetapi gagal dikirim online: "+e.message)}
  }

  async function saveKeuangan(ev){
    ev.preventDefault(); if(role!=="admin"||localMode)return;
    const id=$("keuId").value||uid();
    const row={id,tanggal:$("keuTanggal").value,jenis:$("keuJenis").value,kategori:$("keuKategori").value.trim(),jumlah:num($("keuJumlah").value),keterangan:$("keuKet").value.trim(),updated_at:new Date().toISOString()};
    const i=keuangan.findIndex(x=>x.id===id);if(i>=0)keuangan[i]=row;else keuangan.push(row);
    saveLS();resetKeuForm();renderAll();
    try{await saveOnline("keuangan",row)}catch(e){alert("Data disimpan lokal, tetapi gagal dikirim online: "+e.message)}
  }

  window.editProduksi= id => {
    const r=produksi.find(x=>x.id===id);if(!r)return;
    $("prodId").value=r.id;$("prodTanggal").value=r.tanggal;$("prodNama").value=r.nama_barang;$("prodJumlah").value=r.produksi_kg;$("prodTerjual").value=r.terjual_kg;$("prodKet").value=r.keterangan;
    navigate("produksi");window.scrollTo({top:0,behavior:"smooth"});
  };
  window.delProduksi=async id=>{
    if(role!=="admin"||localMode||!confirm("Hapus data produksi ini?"))return;
    produksi=produksi.filter(x=>x.id!==id);saveLS();renderAll();
    try{await deleteOnline("produksi",id)}catch(e){alert("Penghapusan tersimpan lokal dan akan dicoba lagi saat sinkron: "+e.message)}
  };
  window.editKeuangan=id=>{
    const r=keuangan.find(x=>x.id===id);if(!r)return;
    $("keuId").value=r.id;$("keuTanggal").value=r.tanggal;$("keuJenis").value=r.jenis;$("keuKategori").value=r.kategori;$("keuJumlah").value=r.jumlah;$("keuKet").value=r.keterangan;
    navigate("keuangan");window.scrollTo({top:0,behavior:"smooth"});
  };
  window.delKeuangan=async id=>{
    if(role!=="admin"||localMode||!confirm("Hapus transaksi ini?"))return;
    keuangan=keuangan.filter(x=>x.id!==id);saveLS();renderAll();
    try{await deleteOnline("keuangan",id)}catch(e){alert("Penghapusan tersimpan lokal dan akan dicoba lagi saat sinkron: "+e.message)}
  };

  function resetProdForm(){ $("prodId").value="";$("prodTanggal").value=today();$("prodNama").value="";$("prodJumlah").value="";$("prodTerjual").value="0";$("prodKet").value="" }
  function resetKeuForm(){ $("keuId").value="";$("keuTanggal").value=today();$("keuJenis").value="masuk";$("keuKategori").value="";$("keuJumlah").value="";$("keuKet").value="" }

  function renderProduksi(){
    const q=$("prodSearch").value.toLowerCase();
    const rows=produksi.filter(r=>(r.nama_barang+" "+r.keterangan).toLowerCase().includes(q)).sort((a,b)=>b.tanggal.localeCompare(a.tanggal));
    $("prodTable").innerHTML=rows.map(r=>`<tr><td>${esc(r.tanggal)}</td><td>${esc(r.nama_barang)}</td><td>${r.produksi_kg.toLocaleString("id-ID")} kg</td><td>${r.terjual_kg.toLocaleString("id-ID")} kg</td><td>${(r.produksi_kg-r.terjual_kg).toLocaleString("id-ID")} kg</td><td>${esc(r.keterangan)}</td><td>${role==="admin"&&!localMode?`<button class="action-btn edit" onclick="editProduksi('${r.id}')">Edit</button><button class="action-btn delete" onclick="delProduksi('${r.id}')">Hapus</button>`:"Lihat"}</td></tr>`).join("")||`<tr><td colspan="7">Belum ada data.</td></tr>`;
  }

  function renderKeuangan(){
    const q=$("keuSearch").value.toLowerCase();
    const rows=keuangan.filter(r=>(r.kategori+" "+r.keterangan).toLowerCase().includes(q)).sort((a,b)=>b.tanggal.localeCompare(a.tanggal));
    $("keuTable").innerHTML=rows.map(r=>`<tr><td>${esc(r.tanggal)}</td><td>${r.jenis==="masuk"?"Pemasukan":"Pengeluaran"}</td><td>${esc(r.kategori)}</td><td>${money(r.jumlah)}</td><td>${esc(r.keterangan)}</td><td>${role==="admin"&&!localMode?`<button class="action-btn edit" onclick="editKeuangan('${r.id}')">Edit</button><button class="action-btn delete" onclick="delKeuangan('${r.id}')">Hapus</button>`:"Lihat"}</td></tr>`).join("")||`<tr><td colspan="6">Belum ada transaksi.</td></tr>`;
  }

  function totals(ps=produksi,ks=keuangan){
    const prod=ps.reduce((s,r)=>s+num(r.produksi_kg),0), ter=ps.reduce((s,r)=>s+num(r.terjual_kg),0);
    const masuk=ks.filter(r=>r.jenis==="masuk").reduce((s,r)=>s+num(r.jumlah),0);
    const keluar=ks.filter(r=>r.jenis==="keluar").reduce((s,r)=>s+num(r.jumlah),0);
    return {prod,ter,stok:prod-ter,masuk,keluar,saldo:masuk-keluar};
  }

  function renderDashboard(){
    const t=totals();$("dProduksi").textContent=t.prod.toLocaleString("id-ID")+" kg";$("dTerjual").textContent=t.ter.toLocaleString("id-ID")+" kg";$("dStok").textContent=t.stok.toLocaleString("id-ID")+" kg";$("dMasuk").textContent=money(t.masuk);$("dKeluar").textContent=money(t.keluar);$("dSaldo").textContent=money(t.saldo);
  }

  function renderReport(){
    const a=$("filterDari").value,b=$("filterSampai").value;
    const p=produksi.filter(r=>(!a||r.tanggal>=a)&&(!b||r.tanggal<=b)),k=keuangan.filter(r=>(!a||r.tanggal>=a)&&(!b||r.tanggal<=b)),t=totals(p,k);
    $("rProduksi").textContent=t.prod.toLocaleString("id-ID")+" kg";$("rTerjual").textContent=t.ter.toLocaleString("id-ID")+" kg";$("rMasuk").textContent=money(t.masuk);$("rKeluar").textContent=money(t.keluar);
  }

  function renderCharts(){
    const map={};produksi.forEach(r=>map[r.tanggal]=(map[r.tanggal]||0)+num(r.produksi_kg));
    const labels=Object.keys(map).sort();
    if(chartProd)chartProd.destroy();
    chartProd=new Chart($("chartProduksi"),{type:"line",data:{labels,datasets:[{label:"Produksi kg",data:labels.map(x=>map[x]),tension:.25}]},options:{responsive:true,maintainAspectRatio:false}});
    const km={};keuangan.forEach(r=>{km[r.tanggal]??={masuk:0,keluar:0};km[r.tanggal][r.jenis]+=num(r.jumlah)});
    const kl=Object.keys(km).sort();
    if(chartKeu)chartKeu.destroy();
    chartKeu=new Chart($("chartKeuangan"),{type:"bar",data:{labels:kl,datasets:[{label:"Masuk",data:kl.map(x=>km[x].masuk)},{label:"Keluar",data:kl.map(x=>km[x].keluar)}]},options:{responsive:true,maintainAspectRatio:false}});
  }

  function renderAll(){updateConnection();updateHome();renderProduksi();renderKeuangan();renderDashboard();renderReport();if(!$("page-grafik").classList.contains("hidden"))renderCharts();}

  function downloadBackup(){
    const blob=new Blob([JSON.stringify({version:2,exported_at:new Date().toISOString(),produksi,keuangan},null,2)],{type:"application/json"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="backup-sijunjuang-"+today()+".json";a.click();URL.revokeObjectURL(a.href);
  }

  function restoreBackup(ev){
    const file=ev.target.files[0];if(!file)return;
    const reader=new FileReader();reader.onload=()=>{try{const d=JSON.parse(reader.result);if(!Array.isArray(d.produksi)||!Array.isArray(d.keuangan))throw new Error("Format backup tidak valid.");produksi=d.produksi.map(normalizeProd);keuangan=d.keuangan.map(normalizeKeu);saveLS();renderAll();setMsg("backupMsg","Backup berhasil dipulihkan ke perangkat.","false")}catch(e){setMsg("backupMsg",e.message)}};reader.readAsText(file);ev.target.value="";
  }

  async function changePassword(){
    if(!supabase||!currentUser){alert("Harus login online.");return}
    const p=$("newPassword").value;if(p.length<6){alert("Password minimal 6 karakter.");return}
    const {error}=await supabase.auth.updateUser({password:p});
    alert(error?error.message:"Password berhasil diubah.");$("newPassword").value="";
  }

  async function testDb(){
    if(!supabase){$("dbInfo").textContent="config.js belum diisi.";return}
    const {error}=await supabase.from("produksi").select("id").limit(1);
    $("dbInfo").textContent=error?"Gagal: "+error.message:"Koneksi database berhasil.";
  }

  function exportExcel(kind){
    if(!window.XLSX){alert("Library Excel belum termuat.");return}
    const data=kind==="produksi"?produksi.map(r=>({Tanggal:r.tanggal,Barang:r.nama_barang,Produksi_Kg:r.produksi_kg,Terjual_Kg:r.terjual_kg,Stok_Kg:r.produksi_kg-r.terjual_kg,Keterangan:r.keterangan})):keuangan.map(r=>({Tanggal:r.tanggal,Jenis:r.jenis,Kategori:r.kategori,Jumlah:r.jumlah,Keterangan:r.keterangan}));
    const wb=XLSX.utils.book_new(),ws=XLSX.utils.json_to_sheet(data);XLSX.utils.book_append_sheet(wb,ws,kind==="produksi"?"Produksi":"Keuangan");XLSX.writeFile(wb,"Buku-Kas-Sijunjuang-"+kind+"-"+today()+".xlsx");
  }

  function printTable(title){
    const page=title==="Produksi"?$("prodTable").closest("table").outerHTML:$("keuTable").closest("table").outerHTML;
    const w=window.open("","_blank");w.document.write(`<html><head><title>${title}</title><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:7px;text-align:left}</style></head><body><h2>${title} - Buku Kas Tambang Sijunjuang</h2>${page}</body></html>`);w.document.close();w.print();
  }

  function setupRealtime(){
    if(!supabase)return;
    supabase.channel("sijunjuang-live")
      .on("postgres_changes",{event:"*",schema:"public",table:"produksi"},()=>pullOnline())
      .on("postgres_changes",{event:"*",schema:"public",table:"keuangan"},()=>pullOnline())
      .subscribe();
  }

  resetProdForm();resetKeuForm();boot();
})();