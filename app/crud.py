from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import datetime

from . import models

def upsert_host(db: Session, name: str, ip: str | None, free_disk_gb: float | None, free_mem_mb: int | None,
                cpu_usage_pct: int | None = None, total_disk_gb: float | None = None, total_mem_mb: int | None = None) -> models.Host:
    host = db.execute(select(models.Host).where(models.Host.name == name)).scalar_one_or_none()
    if host is None:
        host = models.Host(name=name)
        db.add(host)
    host.ip = ip
    host.free_disk_gb = free_disk_gb
    host.free_mem_mb = free_mem_mb
    host.cpu_usage_pct = cpu_usage_pct
    host.total_disk_gb = total_disk_gb
    host.total_mem_mb = total_mem_mb
    host.last_seen = datetime.utcnow()
    db.commit()
    db.refresh(host)
    return host

def upsert_vm(db: Session, host_id: int, name: str, ip: str | None, guest_hostname: str | None,
              ram_mb: int | None, total_vhd_gb: float | None, total_vhd_file_gb: float | None,
              state: str | None = None) -> models.VM:
    vm = db.execute(select(models.VM).where(models.VM.host_id == host_id, models.VM.name == name)).scalar_one_or_none()
    if vm is None:
        vm = models.VM(host_id=host_id, name=name)
        db.add(vm)

    # Ne met à jour l'IP que si on en a détecté une nouvelle
    if ip is not None:
        vm.ip = ip

    vm.guest_hostname = guest_hostname
    vm.ram_mb = ram_mb
    vm.total_vhd_gb = total_vhd_gb
    vm.total_vhd_file_gb = total_vhd_file_gb
    vm.last_seen = datetime.utcnow()
    vm.state = state
    db.commit()
    db.refresh(vm)
    return vm