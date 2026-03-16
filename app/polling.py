import asyncio
import json
import logging
import os
from typing import List

from sqlalchemy import select

from . import models
from .config import settings
from .crud import upsert_host, upsert_vm
from .db import SessionLocal
from .hyperv.client import HyperVClient, WinRMConfig

# --- Logger setup ---
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=getattr(logging, LOG_LEVEL, logging.INFO),
)
logger = logging.getLogger(__name__)


def get_client(host: str) -> HyperVClient:
    cfg = WinRMConfig(
        username=settings.winrm_username,
        password=settings.winrm_password,
        use_ssl=settings.winrm_use_ssl,
        port=settings.winrm_port,
        verify_ssl=settings.winrm_verify_ssl,
    )
    return HyperVClient(host, cfg)


def collect_once_sync(hosts: List[str] | None = None):
    """Version synchrone : appelée dans un thread via asyncio.to_thread"""
    if hosts is None:
        hosts = settings.hosts
    for h in hosts:
        logger.debug(f"Collecting metrics from host {h}...")
        try:
            client = get_client(h)
            data = client.collect()
            logger.debug(f"Successfully connected to {h}")
        except Exception as e:
            logger.error(f"Failed to collect from host {h}: {e}")
            # On échec, on persiste au moins le host avec valeurs nulles
            db = SessionLocal()
            try:
                upsert_host(db, h, ip=None, free_disk_gb=None, free_mem_mb=None)
            finally:
                db.close()
            continue

        db = SessionLocal()
        try:
            host_row = upsert_host(
                db,
                name=data.get("host_name"),
                ip=data.get("host_ip"),
                free_disk_gb=data.get("host_free_disk_gb"),
                free_mem_mb=data.get("host_free_mem_mb"),
                cpu_usage_pct=data.get("host_cpu_pct"),
                total_disk_gb=data.get("host_total_disk_gb"),
                total_mem_mb=data.get("host_total_mem_mb"),
            )
            vms = data.get("vms", [])
            seen_names = set()
            if vms:
                logger.debug(f"Host {h}: found {len(vms)} VMs")

                for vm in vms:
                    ip = vm.get("ip")
                    if isinstance(ip, dict):
                        ip = json.dumps(ip)

                    name = vm.get("name")
                    seen_names.add(name)

                    logger.debug(f"Processing VM '{vm.get('name')}' on host {h}")
                    upsert_vm(
                        db,
                        host_id=host_row.id,
                        name=name,
                        ip=ip,
                        guest_hostname=vm.get("vm_hostname"),
                        ram_mb=vm.get("ram_mb"),
                        total_vhd_gb=vm.get("total_vhd_gb"),
                        total_vhd_file_gb=vm.get("total_vhd_file_gb"),
                        state=vm.get("state"),
                    )

            # --- suppression des VMs disparues ---
            if seen_names:
                q = select(models.VM).where(models.VM.host_id == host_row.id)
                db_vms = db.execute(q).scalars().all()
                for db_vm in db_vms:
                    if db_vm.name not in seen_names:
                        logger.info(f"Removing VM '{db_vm.name}' (no longer present on host {h})")
                        db.delete(db_vm)

            db.commit()
        finally:
            db.close()


async def collect_once(hosts: List[str] | None = None):
    """Version asynchrone : exécute la collecte synchrone dans un thread"""
    await asyncio.to_thread(collect_once_sync, hosts)


async def polling_loop():
    logger.info("Starting polling loop...")
    # Première collecte immédiate
    await collect_once()
    # Boucle infinie
    while True:
        await asyncio.sleep(max(1, settings.poll_minutes) * 60)
        await collect_once()
