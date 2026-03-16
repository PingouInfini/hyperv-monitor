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
        # PowerShell script minifié SANS accents pour éviter les erreurs d'encodage WinRM
        ps = r'''
$ProgressPreference='SilentlyContinue'
$ErrorActionPreference='SilentlyContinue'
$hostName=(Get-ComputerInfo -Property CsName).CsName
$hostIP=(Get-NetIPAddress -AddressFamily IPv4|?{$_.IPAddress -notlike '169.*' -and $_.IPAddress -notlike '127.*'}|Select -First 1 -ExpandProperty IPAddress)
$cpu=Get-CimInstance Win32_Processor|Measure -Property LoadPercentage -Average
$cpuUsage=if($cpu.Average){[int]$cpu.Average}else{0}
$os=Get-CimInstance Win32_OperatingSystem
$freeMemMB=[int]($os.FreePhysicalMemory/1024)
$totalMemMB=[int]($os.TotalVisibleMemorySize/1024)
$fixed=Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3"|Select DeviceID,FreeSpace,Size
$freeDiskGB=[math]::Round((($fixed|Measure -Property FreeSpace -Sum).Sum)/1GB,2)
$totalDiskGB=[math]::Round((($fixed|Measure -Property Size -Sum).Sum)/1GB,2)
$vms=Get-VM|%{
 $vm=$_
 $safeName=$vm.Name -replace '\[','*' -replace '\]','*'
 $ip=$null
 try{$adp=Get-VMNetworkAdapter -VMName $safeName;$ip=$adp.IPAddresses|?{$_ -match '^\d{1,3}(\.\d{1,3}){3}$' -and $_ -notlike '169.*'}|Select -First 1}catch{}
 $vmHost=$null;$vmDom=$null;$vmDns=@()
 try{$kvp=Get-VMIntegrationService -VMName $safeName|?{$_.Name -match 'Key-Value|change de paires'};if($kvp -and $kvp.Enabled){$items=Get-VMKeyValuePair -VMName $safeName -Source Guest;$vmHost=($items|?{$_.Name -eq "HostName"}).Value;$vmDom=($items|?{$_.Name -eq "DomainName" -or $_.Name -eq "FullyQualifiedDomainName"}).Value;$vmDns=($items|?{$_.Name -eq "NameServer"}).Value -split ','}}catch{}
 if(-not $vmHost -and $ip){try{$vmHost=[System.Net.Dns]::GetHostEntry($ip).HostName}catch{}}
 $vhdInfo=@()
 try{$vhdInfo=Get-VMHardDiskDrive -VMName $safeName|%{ $vhd=Get-VHD -Path $_.Path;[pscustomobject]@{Path=$vhd.Path;Size=[int64]$vhd.Size;FileSize=[int64]$vhd.FileSize}}}catch{}
 $totVhd=if($vhdInfo){[math]::Round((($vhdInfo|Measure -Property Size -Sum).Sum)/1GB,2)}else{$null}
 $totVhdFile=if($vhdInfo){[math]::Round((($vhdInfo|Measure -Property FileSize -Sum).Sum)/1GB,2)}else{$null}
 [pscustomobject]@{name=$vm.Name;state=$vm.State.ToString();vm_hostname=$vmHost;vm_domain=$vmDom;dns_servers=$vmDns;ip=$ip;ram_mb=[int]($vm.MemoryStartup/1MB);total_vhd_gb=$totVhd;total_vhd_file_gb=$totVhdFile}
}
[pscustomobject]@{host_name=$hostName;host_ip=$hostIP;host_cpu_pct=$cpuUsage;host_free_mem_mb=$freeMemMB;host_total_mem_mb=$totalMemMB;host_free_disk_gb=$freeDiskGB;host_total_disk_gb=$totalDiskGB;vms=$vms}|ConvertTo-Json -Depth 6
'''
        return self._run_ps_json(ps)


def demo_parse():
    # Helper for unit tests; not used in production path
    pass
