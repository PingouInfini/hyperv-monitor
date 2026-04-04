import ssl
from typing import Any, Dict
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
from .base import BaseClient

class ESXiClient(BaseClient):
    def collect(self) -> Dict[str, Any]:
        context = ssl._create_unverified_context()
        si = None  # Initialisation à None pour éviter une erreur dans le finally si SmartConnect échoue

        try:
            # Connexion à l'ESXi
            si = SmartConnect(
                host=self.host_ip,
                user=self.config.username,
                pwd=self.config.password,
                sslContext=context
            )

            content = si.RetrieveContent()
            host_system = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.HostSystem], True
            ).view[0]

            summary = host_system.summary
            stats = summary.quickStats
            hw = summary.hardware

            host_cpu_pct = round((stats.overallCpuUsage / (hw.cpuMhz * hw.numCpuCores)) * 100, 1) if hw.cpuMhz else 0
            total_mem_mb = int(hw.memorySize / 1048576)
            free_mem_mb = total_mem_mb - int(stats.overallMemoryUsage)

            vms_data = []
            container = content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True)

            for vm in container.view:
                state = "Running" if vm.runtime.powerState == vim.VirtualMachine.PowerState.poweredOn else "Stopped"

                # Récupération de la taille des disques
                total_vhd_gb = 0
                if vm.layoutEx and vm.layoutEx.file:
                    for f in vm.layoutEx.file:
                        if f.type == 'diskDescriptor' or f.type == 'diskExtent':
                            total_vhd_gb += f.size
                total_vhd_gb = round(total_vhd_gb / 1073741824, 2)

                vms_data.append({
                    "name": vm.name,
                    "state": state,
                    "ip": vm.guest.ipAddress if vm.guest else None,
                    "guest_hostname": vm.guest.hostName if vm.guest else None,
                    "ram_mb": vm.config.hardware.memoryMB if vm.config else 0,
                    "total_vhd_gb": total_vhd_gb
                })

            # Le dictionnaire est entièrement évalué ici, PENDANT que la session est active.
            return {
                "host_name": host_system.name,
                "host_ip": self.host_ip,
                "tags": self.config.tags,
                "host_cpu_pct": host_cpu_pct,
                "host_free_mem_mb": free_mem_mb,
                "host_total_mem_mb": total_mem_mb,
                "vms": vms_data
            }

        finally:
            # La déconnexion s'exécute de façon garantie après le return ou en cas d'exception
            if si:
                Disconnect(si)