let cameras=[], layout=16, currentPage=0, hlsPlayers=[], editingId=null, draggedCameraId=null;
const $=id=>document.getElementById(id);
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function streamUrl(id){return `${location.protocol}//${location.hostname}:8888/${encodeURIComponent(id)}/index.m3u8`;}
function stopPlayers(){hlsPlayers.forEach(p=>{try{p.destroy()}catch(e){}});hlsPlayers=[];document.querySelectorAll(".camera video").forEach(v=>{try{v.pause();v.removeAttribute("src");v.load()}catch(e){}});}
async function api(path,opts={}){const r=await fetch(path,{headers:{"Content-Type":"application/json"},...opts});const d=await r.json().catch(()=>({detail:"Unexpected server response"}));if(!r.ok)throw new Error(d.detail||"Request failed");return d;}
async function load(){try{cameras=await api("/api/cameras");$("cameraCount").textContent=`${cameras.length} cameras`;renderGrid();renderTable();const h=await api("/api/health");$("systemState").textContent=h.mediamtx==="running"?"MediaMTX Online":"MediaMTX Offline";}catch(e){$("systemState").textContent="API unavailable";console.error(e)}}
function renderPagination(totalPages, activeCount){
  const pager=$("pagination");
  const hasPages=activeCount>layout;
  pager.classList.toggle("hidden",!hasPages);
  $("prevPageBtn").disabled=currentPage<=0;
  $("nextPageBtn").disabled=currentPage>=totalPages-1;
  $("pageInfo").textContent=`Page ${currentPage+1} / ${totalPages} · ${activeCount} cameras`;
}
function renderGrid(){
  stopPlayers();
  const grid=$("grid");
  grid.className=`camera-grid grid-${layout}`;
  grid.innerHTML="";
  const active=cameras.filter(c=>c.enabled);
  const totalPages=Math.max(1,Math.ceil(active.length/layout));
  if(currentPage>=totalPages)currentPage=totalPages-1;
  if(currentPage<0)currentPage=0;
  const startIndex=currentPage*layout;
  const visible=active.slice(startIndex,startIndex+layout);
  renderPagination(totalPages,active.length);

  for(let i=0;i<layout;i++){
    const c=visible[i];
    const el=document.createElement("div");
    el.className="camera";
    if(c){
      el.dataset.cameraId=c.id;
      el.draggable=true;
      el.classList.add("draggable-camera");
      el.innerHTML=`<div class="cam-top"><span>${escapeHtml(c.name)}</span><span>CH ${String(c.channel).padStart(2,"0")}</span></div><video muted autoplay playsinline></video><div class="placeholder"><div class="cam-icon">▣</div><span>Connecting stream…</span></div><div class="cam-bottom"><span>${escapeHtml(c.nvr_name)}</span><span class="cam-live">● LIVE</span></div><div class="drag-handle" title="Tarik ikon ini untuk memindahkan kamera" aria-label="Drag camera">⠿</div>`;
      el.title="Drag untuk pindah posisi · Double-click untuk fullscreen";
      el.addEventListener("dblclick",()=>{const v=el.querySelector("video");if(v.requestFullscreen)v.requestFullscreen()});
      const dragHandle=el.querySelector(".drag-handle");
      dragHandle.draggable=true;
      dragHandle.addEventListener("dragstart",e=>{
        draggedCameraId=c.id;
        e.dataTransfer.effectAllowed="move";
        e.dataTransfer.setData("text/plain",c.id);
        el.classList.add("dragging");
      });
      dragHandle.addEventListener("dragend",()=>{
        draggedCameraId=null;
        grid.querySelectorAll(".camera").forEach(x=>x.classList.remove("dragging","drag-over"));
      });
      el.addEventListener("dragover",e=>{
        if(draggedCameraId && draggedCameraId!==c.id){
          e.preventDefault();
          e.dataTransfer.dropEffect="move";
          el.classList.add("drag-over");
        }
      });
      el.addEventListener("dragleave",e=>{
        if(!el.contains(e.relatedTarget))el.classList.remove("drag-over");
      });
      el.addEventListener("drop",async e=>{
        if(!draggedCameraId && !e.dataTransfer.getData("text/plain"))return;
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove("drag-over");
        const fromId=e.dataTransfer.getData("text/plain")||draggedCameraId;
        const toId=c.id;
        if(!fromId||fromId===toId)return;
        await moveCamera(fromId,toId);
      });
    }else{
      const channelNumber=startIndex+i+1;
      el.innerHTML=`<div class="placeholder"><div class="cam-icon">▣</div><span>CH ${String(channelNumber).padStart(2,"0")}</span><span>Not configured</span></div>`;
    }
    grid.appendChild(el);
    if(c){
      const video=el.querySelector("video"),placeholder=el.querySelector(".placeholder");
      const url=streamUrl(c.id);
      if(video.canPlayType("application/vnd.apple.mpegurl")){
        video.src=url;
        video.addEventListener("playing",()=>placeholder.style.display="none",{once:true});
        video.play().catch(()=>{});
      }else if(window.Hls&&Hls.isSupported()){
        const h=new Hls({liveSyncDurationCount:2,enableWorker:true});
        hlsPlayers.push(h);
        h.loadSource(url);
        h.attachMedia(video);
        h.on(Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{}));
        h.on(Hls.Events.ERROR,(event,data)=>{
          if(data.fatal)placeholder.querySelector("span").textContent="Stream unavailable / check RTSP";
        });
        video.addEventListener("playing",()=>placeholder.style.display="none",{once:true});
      }else{
        placeholder.querySelector("span").textContent="Browser tidak mendukung HLS";
      }
    }
  }
}
async function moveCamera(fromId,toId){
  const active=cameras.filter(c=>c.enabled);
  const from=active.findIndex(c=>c.id===fromId), to=active.findIndex(c=>c.id===toId);
  if(from<0||to<0||from===to)return;
  const [picked]=active.splice(from,1);
  active.splice(to,0,picked);
  const disabled=cameras.filter(c=>!c.enabled);
  const next=[...active,...disabled];
  try{
    const result=await api("/api/cameras/reorder",{method:"POST",body:JSON.stringify({ids:next.map(c=>c.id)})});
    cameras=result.cameras;
    renderGrid();renderTable();
  }catch(err){alert("Gagal menyimpan urutan kamera: "+err.message);}
}
function renderTable(){const box=$("cameraTable");if(!cameras.length){box.innerHTML='<p style="color:#91a1b5">Belum ada kamera. Klik Add Camera untuk memulai.</p>';return;}box.innerHTML=`<table><thead><tr><th>Camera</th><th>NVR</th><th>Channel</th><th>RTSP URL</th><th>Action</th></tr></thead><tbody>${cameras.map(c=>`<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.nvr_name)}</td><td>${c.channel}</td><td class="url" title="${escapeHtml(c.rtsp_url)}">${escapeHtml(c.rtsp_url)}</td><td><button class="table-action" data-edit="${c.id}">Edit</button> &nbsp; <button class="table-action" data-delete="${c.id}">Delete</button></td></tr>`).join("")}</tbody></table>`;box.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{if(confirm("Hapus kamera ini?")){await api(`/api/cameras/${b.dataset.delete}`,{method:"DELETE"});load()}});box.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openModal(cameras.find(c=>c.id===b.dataset.edit)));}
async function exportCameras(){
  try{
    const response=await fetch("/api/cameras/export");
    if(!response.ok)throw new Error("Export gagal: HTTP "+response.status);
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download="garuda-cctv-backup-"+new Date().toISOString().slice(0,10)+".json";
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }catch(err){alert(err.message);}
}
function chooseImport(){ $("importFile").click(); }
async function importCamerasFile(file){
  try{
    const text=await file.text();
    const backup=JSON.parse(text);
    const imported=Array.isArray(backup)?backup:backup.cameras;
    if(!Array.isArray(imported))throw new Error("Format file tidak sesuai. Gunakan backup JSON Garuda CCTV.");
    if(imported.length>512)throw new Error("Maksimal 512 kamera per file import.");
    const modeInput=prompt("Pilih mode import:\nKetik REPLACE untuk mengganti seluruh data kamera.\nKetik MERGE untuk menggabungkan / memperbarui kamera berdasarkan nama.\n\nDisarankan export backup terlebih dahulu.","MERGE");
    if(modeInput===null)return;
    const mode=modeInput.trim().toLowerCase();
    if(!["replace","merge"].includes(mode))throw new Error("Mode harus REPLACE atau MERGE.");
    if(mode==="replace"&&!confirm("REPLACE akan mengganti seluruh daftar kamera saat ini. Lanjutkan?"))return;
    const result=await api("/api/cameras/import",{method:"POST",body:JSON.stringify({mode,cameras:imported})});
    alert(`Import berhasil. ${result.imported} kamera diproses; total ${result.total} kamera.\nMediaMTX: ${result.mediamtx}`);
    await load();
  }catch(err){alert("Import gagal: "+err.message);}
  finally{$("importFile").value="";}
}
function openModal(cam=null){editingId=cam?.id||null;$("cameraForm").reset();$("formTitle").textContent=cam?"Edit Camera":"Add Camera";if(cam){for(const k of ["name","nvr_name","channel","rtsp_url"])$("cameraForm").elements[k].value=cam[k];$("cameraForm").elements.enabled.checked=cam.enabled;}$("formError").textContent="";$("modal").classList.remove("hidden");}
function closeModal(){$("modal").classList.add("hidden");}
$("cameraForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const body={name:f.get("name"),nvr_name:f.get("nvr_name")||"NVR 1",channel:Number(f.get("channel")),rtsp_url:f.get("rtsp_url"),enabled:$("cameraForm").elements.enabled.checked};try{await api(editingId?`/api/cameras/${editingId}`:"/api/cameras",{method:editingId?"PUT":"POST",body:JSON.stringify(body)});closeModal();await load();}catch(err){$("formError").textContent=err.message;}};
document.querySelectorAll("[data-layout]").forEach(b=>b.onclick=()=>{layout=Number(b.dataset.layout);currentPage=0;document.querySelectorAll(".layout-btn").forEach(x=>x.classList.toggle("selected",x===b));renderGrid()});
$("prevPageBtn").onclick=()=>{if(currentPage>0){currentPage--;renderGrid();}};
$("nextPageBtn").onclick=()=>{const count=cameras.filter(c=>c.enabled).length;const pages=Math.max(1,Math.ceil(count/layout));if(currentPage<pages-1){currentPage++;renderGrid();}};
function showManager(show){$("grid").classList.toggle("hidden",show);$("manager").classList.toggle("hidden",!show);document.querySelector(".toolbar").classList.toggle("hidden",show);}
$("manageNav").onclick=()=>showManager(true);document.querySelector(".nav.active").onclick=()=>showManager(false);
$("addBtn").onclick=$("addBtn2").onclick=()=>openModal();$("closeModal").onclick=$("cancelBtn").onclick=closeModal;
$("refreshBtn").onclick=load;
["exportBtn","exportBtn2"].forEach(id=>{if($(id))$(id).onclick=exportCameras;});
["importBtn","importBtn2"].forEach(id=>{if($(id))$(id).onclick=chooseImport;});
$("importFile").addEventListener("change",e=>{const file=e.target.files?.[0];if(file)importCamerasFile(file);});
setInterval(()=>$("clock").textContent=new Date().toLocaleString("id-ID"),1000);load();setInterval(load,30000);
