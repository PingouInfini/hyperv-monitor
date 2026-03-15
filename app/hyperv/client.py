from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Dict

import winrm  # pywinrm


@dataclass
class WinRMConfig:
    username: str
    password: str
    use_ssl: bool = False
    port: int = 5985
    verify_ssl: bool = False


class HyperVClient:
    def __init__(self, host: str, cfg: WinRMConfig):
        self.host = host
        self.cfg = cfg
        protocol = "https" if cfg.use_ssl else "http"
        self.url = f"{protocol}://{host}:{cfg.port}/wsman"
        self.session = winrm.Session(
            self.url,
            auth=(cfg.username, cfg.password),
            server_cert_validation=("validate" if cfg.verify_ssl else "ignore"),
            transport='credssp',
        )

    def _run_ps_json(self, script: str) -> Dict[str, Any]:
        r = self.session.run_ps(script)
        if r.status_code != 0:
            raise RuntimeError(f"PowerShell error ({r.status_code}): {r.std_err.decode(errors='ignore')}")
        raw = r.std_out.decode(errors="ignore").strip()
        # Strip any BOM or stray text, keep last JSON object if multiple
        m = re.findall(r'\{.*\}|\[.*\]', raw, re.S)
        text = raw if not m else m[-1]
        return json.loads(text) if text else {}

    def collect(self) -> Dict[str, Any]:
        # PowerShell script executed remotely; returns a JSON document
        ps = r'''
$ProgressPreference = 'SilentlyContinue'

# Host name
$hostName = (Get-ComputerInfo -Property CsName).CsName

# Host IP
$hostIP = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -notlike '127.*' } |
    Select-Object -First 1 -ExpandProperty IPAddress)

# Free memory (MB)
$os = Get-CimInstance Win32_OperatingSystem
$freeMemMB = [int]($os.FreePhysicalMemory / 1024)

# Free disk (GB) - sum of fixed drives
$fixed = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, FreeSpace, Size
$freeDiskGB = [math]::Round((($fixed | Measure-Object -Property FreeSpace -Sum).Sum) / 1GB, 2)

# VMs
$vms = Get-VM | ForEach-Object {
    $vm = $_

    # On remplace [ et ] par * uniquement pour les commandes Hyper-V
    $safeName = $vm.Name -replace '\[','*' -replace '\]','*'

    $ip = $null
    try {
        $adp = Get-VMNetworkAdapter -VMName $safeName
        $ip = $adp.IPAddresses | Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' -and $_ -notlike '169.*' } | Select-Object -First 1
    } catch { $ip = $null }

    # Récupération du hostname invité via KVP Exchange
    $vmHostName = $null
    $vmDomain = $null
    $vmDns = @()
    try {
        $kvp = Get-VMIntegrationService -VMName $safeName -Name "Échange de paires clé-valeur"
        if ($kvp.Enabled) {
            $kvpItems = Get-VMKeyValuePair -VMName $safeName -Source Guest
            $vmHostName = ($kvpItems | Where-Object { $_.Name -eq "HostName" }).Value
            $vmDomain   = ($kvpItems | Where-Object { $_.Name -eq "DomainName" -or $_.Name -eq "FullyQualifiedDomainName" }).Value
            $vmDns      = ($kvpItems | Where-Object { $_.Name -eq "NameServer" }).Value -split ','
        }
    } catch { }

    if (-not $vmHostName -and $ip) {
        try {
            $vmHostName = [System.Net.Dns]::GetHostEntry($ip).HostName
        } catch { }
    }

    $vhdInfo = @()
    try {
        $vhdInfo = Get-VMHardDiskDrive -VMName $safeName | ForEach-Object {
            $vhd = Get-VHD -Path $_.Path
            [pscustomobject]@{
                Path = $vhd.Path
                SizeBytes = [int64]$vhd.Size
                FileSizeBytes = [int64]$vhd.FileSize
            }
        }
    } catch { $vhdInfo = @() }

    $totalVhdGB = if ($vhdInfo) { [math]::Round((($vhdInfo | Measure-Object -Property SizeBytes -Sum).Sum) / 1GB, 2) } else { $null }
    $totalVhdFileGB = if ($vhdInfo) { [math]::Round((($vhdInfo | Measure-Object -Property FileSizeBytes -Sum).Sum) / 1GB, 2) } else { $null }

    [pscustomobject]@{
        name = $vm.Name
        vm_hostname = $vmHostName
        vm_domain   = $vmDomain
        dns_servers = $vmDns
        ip = $ip
        ram_mb = [int]($vm.MemoryStartup / 1MB)
        total_vhd_gb = $totalVhdGB
        total_vhd_file_gb = $totalVhdFileGB
    }
}

$result = [pscustomobject]@{
    host_name = $hostName
    host_ip = $hostIP
    host_free_mem_mb = $freeMemMB
    host_free_disk_gb = $freeDiskGB
    vms = $vms
}

$result | ConvertTo-Json -Depth 6
'''
        return self._run_ps_json(ps)


def demo_parse():
    # Helper for unit tests; not used in production path
    pass
