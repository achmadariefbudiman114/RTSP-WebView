from __future__ import annotations
import json, os, re, subprocess, threading, time
from pathlib import Path
from typing import Optional, Literal
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
STATIC = ROOT / "static"
CONFIG = ROOT / "mediamtx.yml"
CAMERAS_FILE = DATA / "cameras.json"
MEDIAMTX_EXE = ROOT / "mediamtx.exe"
DATA.mkdir(exist_ok=True)
LOCK = threading.RLock()
mediamtx_process: Optional[subprocess.Popen] = None

DEFAULT_CONFIG = {
    "logLevel": "info",
    "rtsp": True,
    "rtspAddress": ":8554",
    "hls": True,
    "hlsAddress": ":8888",
    "hlsVariant": "fmp4",
    "hlsSegmentCount": 7,
    "hlsSegmentDuration": "1s",
    "webrtc": True,
    "webrtcAddress": ":8889",
    "webrtcLocalUDPAddress": ":8189",
    "paths": {}
}

def load_cameras():
    if not CAMERAS_FILE.exists():
        CAMERAS_FILE.write_text("[]", encoding="utf-8")
    try:
        return json.loads(CAMERAS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []

def save_cameras(cameras):
    CAMERAS_FILE.write_text(json.dumps(cameras, indent=2), encoding="utf-8")

def safe_id(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_-]", "-", value.strip().lower())
    value = re.sub(r"-+", "-", value).strip("-")
    if not value:
        raise HTTPException(400, "Nama kamera harus memiliki karakter huruf/angka.")
    return value[:48]

def write_mediamtx_config():
    cams = load_cameras()
    cfg = dict(DEFAULT_CONFIG)
    cfg["paths"] = {}
    for cam in cams:
        # MediaMTX pulls the NVR RTSP stream only when a viewer requests it.
        cfg["paths"][cam["id"]] = {
            "source": cam["rtsp_url"],
            "sourceOnDemand": True,
            "sourceOnDemandStartTimeout": "15s",
            "sourceOnDemandCloseAfter": "30s"
        }
    # Write the small MediaMTX YAML config directly. This avoids requiring
    # PyYAML (and a C++ compiler) on Windows/Python 3.14.
    lines = [
        "logLevel: info",
        "rtsp: yes",
        'rtspAddress: ":8554"',
        "hls: yes",
        'hlsAddress: ":8888"',
        "hlsVariant: fmp4",
        "hlsSegmentCount: 7",
        'hlsSegmentDuration: "1s"',
        "webrtc: yes",
        'webrtcAddress: ":8889"',
        'webrtcLocalUDPAddress: ":8189"',
        "paths:"
    ]
    for cam in cams:
        lines.append(f"  {cam['id']}:")
        # JSON string syntax is valid for YAML double-quoted scalar values.
        lines.append(f"    source: {json.dumps(cam['rtsp_url'])}")
        lines.append("    sourceOnDemand: yes")
        lines.append('    sourceOnDemandStartTimeout: "15s"')
        lines.append('    sourceOnDemandCloseAfter: "30s"')
    if not cams:
        lines.append("  all:")
        lines.append("    source: publisher")
    CONFIG.write_text("\n".join(lines) + "\n", encoding="utf-8")

def stop_mediamtx():
    global mediamtx_process
    if mediamtx_process and mediamtx_process.poll() is None:
        mediamtx_process.terminate()
        try:
            mediamtx_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            mediamtx_process.kill()
    mediamtx_process = None

def start_mediamtx():
    global mediamtx_process
    if not MEDIAMTX_EXE.exists():
        return False, "mediamtx.exe belum ditemukan. Jalankan install.ps1 atau letakkan mediamtx.exe di folder aplikasi."
    write_mediamtx_config()
    stop_mediamtx()
    mediamtx_process = subprocess.Popen(
        [str(MEDIAMTX_EXE), str(CONFIG)],
        cwd=str(ROOT),
        stdout=open(DATA / "mediamtx.log", "a", encoding="utf-8"),
        stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
    )
    time.sleep(0.7)
    if mediamtx_process.poll() is not None:
        return False, "MediaMTX berhenti saat startup. Periksa data/mediamtx.log dan port yang digunakan."
    return True, "MediaMTX berjalan."

class CameraIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    nvr_name: str = Field(default="NVR 1", max_length=80)
    channel: int = Field(default=1, ge=1, le=256)
    rtsp_url: str = Field(min_length=10, max_length=2000)
    enabled: bool = True

class CameraOrderIn(BaseModel):
    ids: list[str]

class CameraImportIn(BaseModel):
    mode: Literal["replace", "merge"] = "replace"
    cameras: list[CameraIn]

app = FastAPI(title="CCTV RTSP Gateway", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC), name="static")

@app.on_event("startup")
def startup():
    with LOCK:
        write_mediamtx_config()
        start_mediamtx()

@app.on_event("shutdown")
def shutdown():
    stop_mediamtx()

@app.get("/")
def home():
    return FileResponse(STATIC / "index.html")

@app.get("/api/health")
def health():
    running = mediamtx_process is not None and mediamtx_process.poll() is None
    return {"api": "online", "mediamtx": "running" if running else "stopped"}

@app.get("/api/cameras")
def cameras():
    return load_cameras()

@app.get("/api/cameras/export")
def export_cameras():
    # Export contains RTSP URLs and therefore NVR credentials. Treat it as a secret backup.
    return JSONResponse(
        content={
            "format": "garuda-cctv-camera-backup",
            "version": 1,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "cameras": load_cameras()
        },
        headers={"Content-Disposition": 'attachment; filename="garuda-cctv-backup.json"'}
    )

@app.post("/api/cameras/import")
def import_cameras(payload: CameraImportIn):
    with LOCK:
        imported = []
        seen = set()
        for cam in payload.cameras:
            cid = safe_id(cam.name)
            if cid in seen:
                raise HTTPException(400, f"Nama kamera duplikat dalam file import: {cam.name}")
            if not cam.rtsp_url.lower().startswith("rtsp://"):
                raise HTTPException(400, f"RTSP URL tidak valid untuk kamera: {cam.name}")
            seen.add(cid)
            imported.append({"id": cid, **cam.model_dump()})

        current = load_cameras()
        if payload.mode == "replace":
            # Keep a timestamped copy before replacing current configuration.
            if current:
                backup = DATA / f"cameras-before-import-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
                backup.write_text(json.dumps(current, indent=2), encoding="utf-8")
            final_cameras = imported
        else:
            # Merge by camera ID: imported records update matching cameras and append new ones.
            by_id = {cam["id"]: dict(cam) for cam in current}
            order = [cam["id"] for cam in current]
            for cam in imported:
                if cam["id"] not in by_id:
                    order.append(cam["id"])
                by_id[cam["id"]] = cam
            final_cameras = [by_id[cid] for cid in order]

        save_cameras(final_cameras)
        ok, msg = start_mediamtx()
        return {
            "imported": len(imported),
            "total": len(final_cameras),
            "mode": payload.mode,
            "mediamtx": msg,
            "warning": None if ok else msg
        }

@app.post("/api/cameras")
def add_camera(cam: CameraIn):
    with LOCK:
        cams = load_cameras()
        cid = safe_id(cam.name)
        if any(c["id"] == cid for c in cams):
            raise HTTPException(409, "Nama kamera sudah digunakan.")
        item = {"id": cid, **cam.model_dump()}
        cams.append(item)
        save_cameras(cams)
        ok, msg = start_mediamtx()
        return {"camera": item, "mediamtx": msg, "warning": None if ok else msg}

@app.put("/api/cameras/{camera_id}")
def update_camera(camera_id: str, cam: CameraIn):
    with LOCK:
        cams = load_cameras()
        found = next((c for c in cams if c["id"] == camera_id), None)
        if not found:
            raise HTTPException(404, "Kamera tidak ditemukan.")
        new_id = safe_id(cam.name)
        if new_id != camera_id and any(c["id"] == new_id for c in cams):
            raise HTTPException(409, "Nama kamera sudah digunakan.")
        found.update({"id": new_id, **cam.model_dump()})
        save_cameras(cams)
        ok, msg = start_mediamtx()
        return {"camera": found, "mediamtx": msg, "warning": None if ok else msg}

@app.post("/api/cameras/reorder")
def reorder_cameras(order: CameraOrderIn):
    with LOCK:
        cams = load_cameras()
        current_ids = [c["id"] for c in cams]
        requested_ids = order.ids
        if len(requested_ids) != len(current_ids) or set(requested_ids) != set(current_ids):
            raise HTTPException(400, "Urutan kamera tidak valid.")
        by_id = {c["id"]: c for c in cams}
        reordered = [by_id[cid] for cid in requested_ids]
        save_cameras(reordered)
        # MediaMTX paths are unchanged; no restart is required.
        return {"cameras": reordered, "message": "Urutan kamera berhasil disimpan."}


@app.delete("/api/cameras/{camera_id}")
def delete_camera(camera_id: str):
    with LOCK:
        cams = load_cameras()
        new_cams = [c for c in cams if c["id"] != camera_id]
        if len(new_cams) == len(cams):
            raise HTTPException(404, "Kamera tidak ditemukan.")
        save_cameras(new_cams)
        ok, msg = start_mediamtx()
        return {"deleted": camera_id, "mediamtx": msg, "warning": None if ok else msg}

@app.post("/api/mediamtx/restart")
def restart():
    with LOCK:
        ok, msg = start_mediamtx()
        if not ok:
            raise HTTPException(503, msg)
        return {"message": msg}
