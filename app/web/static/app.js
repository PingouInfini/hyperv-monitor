// ---- NAVIGATION ----
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.matches('a.tab')) {
    e.preventDefault();
    document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('a.tab').forEach(tb => tb.classList.remove('active'));
    document.getElementById(t.dataset.target).classList.add('active');
    t.classList.add('active');

    // Au changement d'onglet, on relance la recherche courante pour appliquer le filtre au bon endroit
    document.getElementById('global-search').dispatchEvent(new Event('input'));
  }
});

// ---- UTILS ----
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

function fmtDate(s) {
  if (!s) return 'Jamais';
  const d = new Date(s);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getProgressColor(pct) {
  if (pct > 90) return 'danger';
  if (pct > 75) return 'warn';
  return '';
}

// ---- LOAD VMS (Style Dozzle) ----
async function loadVMs() {
  const data = await fetchJSON('/api/vms');
  const tbody = document.getElementById('vms-body');
  tbody.innerHTML = '';

  data.forEach(vm => {
    // Statut basé sur Hyper-V (Running = UP, sinon DOWN)
    const isUp = vm.state === 'Running';
    const statusHtml = `<span class="status-dot ${isUp ? 'up' : 'down'}" title="${vm.state}"></span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${statusHtml} &nbsp; ${vm.name}</td>
      <td>${vm.guest_hostname || '<span class="text-muted">—</span>'}</td>
      <td>${vm.ip || '<span class="text-muted">—</span>'}</td>
      <td>${vm.ram_mb ? vm.ram_mb : '—'}</td>
      <td>${vm.total_vhd_gb ? vm.total_vhd_gb : '—'}</td>
      <td>${vm.total_vhd_file_gb ? vm.total_vhd_file_gb : '—'}</td>
      <td class="host-name" data-host-id="${vm.host_id}"></td>
      <td class="text-muted">${fmtDate(vm.last_seen)}</td>
    `;
    tbody.appendChild(tr);
  });

  const hosts = await fetchJSON('/api/hosts');
  const hostMap = {};
  hosts.forEach(h => hostMap[h.id] = h.name);
  document.querySelectorAll('#vms-body .host-name').forEach(td => {
    const hid = parseInt(td.dataset.hostId, 10);
    td.textContent = hostMap[hid] || hid;
  });

  if (window._dt) window._dt.destroy();
  // Configuration 100 lignes par page, dom caché pour la recherche native
  window._dt = new DataTable('#vms-table', {
    responsive: true,
    pageLength: 100,
    language: { lengthMenu: "Afficher _MENU_ VMs par page", info: "_START_ à _END_ sur _TOTAL_ VMs", infoEmpty: "Aucune VM" }
  });
}

// ---- LOAD HOSTS (Style Beszel) ----
async function loadHosts() {
  const hosts = await fetchJSON('/api/hosts');
  const grid = document.getElementById('hosts-grid');
  grid.innerHTML = '';

  for (const h of hosts) {
    const detail = await fetchJSON('/api/hosts/' + h.id);
    const vms = detail.vms || [];

    // Tri : Allumées d'abord
    vms.sort((a, b) => (b.state === 'Running' ? 1 : 0) - (a.state === 'Running' ? 1 : 0));

    const vmsHtml = vms.map(vm => {
      const isUp = vm.state === 'Running';
      return `
        <div class="vm-row" data-vm-name="${vm.name.toLowerCase()}">
          <div class="vm-info">
            <span class="status-dot ${isUp ? 'up' : 'down'}"></span>
            <span class="vm-name">${vm.name}</span>
          </div>
          <span class="vm-ip">${vm.ip || vm.state}</span>
        </div>
      `;
    }).join('');

    // Calculs pourcentages
    const cpuPct = h.cpu_usage_pct || 0;

    let memPct = 0; let memStr = 'N/A';
    if (h.total_mem_mb && h.free_mem_mb) {
      const usedMem = h.total_mem_mb - h.free_mem_mb;
      memPct = Math.round((usedMem / h.total_mem_mb) * 100);
      memStr = `${Math.round(usedMem/1024)}/${Math.round(h.total_mem_mb/1024)} GB`;
    }

    let diskPct = 0; let diskStr = 'N/A';
    if (h.total_disk_gb && h.free_disk_gb) {
      const usedDisk = h.total_disk_gb - h.free_disk_gb;
      diskPct = Math.round((usedDisk / h.total_disk_gb) * 100);
      diskStr = `${Math.round(usedDisk)}/${Math.round(h.total_disk_gb)} GB`;
    }

    const card = document.createElement('div');
    card.className = 'host-card';
    card.dataset.hostName = h.name.toLowerCase();

    card.innerHTML = `
      <button class="btn-trash" onclick="openDeleteModal(${h.id}, '${h.ip || h.name}')" title="Supprimer l'hôte">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
      <div class="host-header">
        <div>
          <h3>🖥️ ${h.name}</h3>
          <div class="host-meta">${h.ip || 'IP Inconnue'} • Vu: ${fmtDate(h.last_seen)}</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-header"><span>CPU</span><span class="stat-val">${cpuPct}%</span></div>
          <div class="progress-bg"><div class="progress-fill ${getProgressColor(cpuPct)}" style="width: ${cpuPct}%"></div></div>
        </div>
        <div class="stat-item">
          <div class="stat-header"><span>RAM</span><span class="stat-val">${memStr}</span></div>
          <div class="progress-bg"><div class="progress-fill ${getProgressColor(memPct)}" style="width: ${memPct}%"></div></div>
        </div>
        <div class="stat-item">
          <div class="stat-header"><span>DISK</span><span class="stat-val">${diskStr}</span></div>
          <div class="progress-bg"><div class="progress-fill ${getProgressColor(diskPct)}" style="width: ${diskPct}%"></div></div>
        </div>
      </div>

      <div class="vm-list">
        ${vmsHtml || '<div class="vm-row" style="justify-content: center; color: var(--text-muted);">Aucune VM</div>'}
      </div>
    `;
    grid.appendChild(card);
  }
}

// ---- RECHERCHE UNIFIÉE ----
document.getElementById('global-search').addEventListener('input', (e) => {
  const val = e.target.value.toLowerCase();

  // 1. Filtrer le tableau DataTables (Onglet VMs)
  if (window._dt) {
    window._dt.search(val).draw();
  }

  // 2. Filtrer les cartes (Onglet Hosts)
  document.querySelectorAll('.host-card').forEach(card => {
    const hostName = card.dataset.hostName;
    const hostMatch = hostName.includes(val);
    let hasVisibleVm = false;

    card.querySelectorAll('.vm-row').forEach(row => {
      const vmName = row.dataset.vmName;
      if (!vmName) return; // Sécurité si "Aucune VM"

      // Si la VM matche la recherche OU si l'hôte matche (dans ce cas on affiche toutes les VMs de cet hôte)
      if (vmName.includes(val) || hostMatch) {
        row.style.display = '';
        hasVisibleVm = true;
      } else {
        row.style.display = 'none';
      }
    });

    // On affiche la carte si l'hôte matche OU si au moins une de ses VM matche
    if (hostMatch || hasVisibleVm) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });
});

// ---- SUPPRESSION HOST ----
function openDeleteModal(hostId, hostIpOrName) {
  document.getElementById('delete-host-id').value = hostId;
  document.getElementById('delete-target-ip').value = hostIpOrName;
  document.getElementById('delete-target-ip-display').textContent = hostIpOrName;
  document.getElementById('delete-confirm-input').value = '';
  document.getElementById('confirm-delete-btn').disabled = true;
  document.getElementById('delete-modal').setAttribute('open', '');
}

function closeModal() {
  document.getElementById('delete-modal').removeAttribute('open');
}

document.getElementById('delete-confirm-input').addEventListener('input', (e) => {
  const target = document.getElementById('delete-target-ip').value;
  document.getElementById('confirm-delete-btn').disabled = (e.target.value !== target);
});

document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
  const hostId = document.getElementById('delete-host-id').value;
  try {
    await fetch(`/api/hosts/${hostId}`, { method: 'DELETE' });
    closeModal();
    // On retire visuellement la carte immédiatement
    await loadHosts();
    await loadVMs();
  } catch (e) {
    console.error("Erreur de suppression", e);
  }
});

// ---- ACTUALISATION ----
document.getElementById('refresh-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = 'Actualisation...';
  try { await fetch('/api/refresh', { method: 'POST' }); } catch (e) {}
  await Promise.all([loadVMs(), loadHosts()]);
  // Réappliquer la recherche si le champ n'est pas vide
  document.getElementById('global-search').dispatchEvent(new Event('input'));
  btn.removeAttribute('aria-busy');
  btn.textContent = '↻ Actualiser';
});

window.addEventListener('load', async () => {
  await Promise.all([loadVMs(), loadHosts()]);
});