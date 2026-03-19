from fastapi import FastAPI, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from sqlalchemy import select, delete

from .db import Base, engine, SessionLocal
from . import models, schemas
from .polling import polling_loop, collect_once

import asyncio

app = FastAPI(title="Hyper-V Monitor")

# DB init
Base.metadata.create_all(bind=engine)

# Static & templates
app.mount("/static", StaticFiles(directory="app/web/static"), name="static")
templates = Jinja2Templates(directory="app/web/templates")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.on_event("startup")
async def startup_event():
    # Lancer la boucle de polling en tâche de fond
    asyncio.create_task(polling_loop())

# ---- API ----

@app.get("/api/hosts", response_model=list[schemas.HostBase])
def api_hosts(db: Session = Depends(get_db)):
    rows = db.execute(select(models.Host)).scalars().all()
    return rows

@app.get("/api/hosts/{host_id}", response_model=schemas.HostWithVMs)
def api_host_detail(host_id: int, db: Session = Depends(get_db)):
    host = db.get(models.Host, host_id)
    if not host:
        return {"id": host_id, "name": "unknown", "vms": []}
    # Force load vms
    _ = host.vms
    return host

@app.get("/api/vms", response_model=list[schemas.VMBase])
def api_vms(db: Session = Depends(get_db)):
    rows = db.execute(select(models.VM)).scalars().all()
    return rows

@app.get("/api/vms/{vm_id}", response_model=schemas.VMBase)
def api_vm_detail(vm_id: int, db: Session = Depends(get_db)):
    vm = db.get(models.VM, vm_id)
    return vm

@app.delete("/api/hosts/{host_id}")
def delete_host(host_id: int, db: Session = Depends(get_db)):
    host = db.execute(select(models.Host).where(models.Host.id == host_id)).scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host introuvable")

    # Suppression en cascade : on supprime les VMs d'abord pour éviter l'erreur d'intégrité SQL
    db.execute(delete(models.VM).where(models.VM.host_id == host_id))
    db.delete(host)
    db.commit()
    return {"status": "ok"}

@app.post("/api/refresh")
async def refresh_data():
    # On force la collecte et on ATTEND la fin avant de répondre au front-end
    await collect_once()
    return {"status": "ok"}

# ---- UI ----

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=27888, reload=True)
