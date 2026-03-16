from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Float, UniqueConstraint
from sqlalchemy.orm import relationship, Mapped, mapped_column
from datetime import datetime
from .db import Base

class Host(Base):
    __tablename__ = "hosts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, index=True)  # hostname cible (env HOSTS)
    ip: Mapped[str | None] = mapped_column(String, nullable=True)
    free_disk_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    free_mem_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cpu_usage_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_disk_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_mem_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)

    vms: Mapped[list["VM"]] = relationship("VM", back_populates="host", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("name", name="uq_host_name"),)

class VM(Base):
    __tablename__ = "vms"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("hosts.id"))
    name: Mapped[str] = mapped_column(String, index=True)
    guest_hostname: Mapped[str | None] = mapped_column(String, nullable=True)
    ip: Mapped[str | None] = mapped_column(String, nullable=True)
    ram_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_vhd_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_vhd_file_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    state: Mapped[str | None] = mapped_column(String, nullable=True) # Ex: 'Running', 'Off'

    host: Mapped["Host"] = relationship("Host", back_populates="vms")
    __table_args__ = (UniqueConstraint("host_id", "name", name="uq_vm_per_host"),)
