// ---- ETAT GLOBAL ----
window.tagColors = {};
window.activeTags = new Set(); // Stocke les tags cliqués pour le filtrage

// ---- NAVIGATION ----
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.matches('a.tab')) {
    e.preventDefault();
    document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('a.tab').forEach(tb => tb.classList.remove('active'));
    document.getElementById(t.dataset.target).classList.add('active');
    t.classList.add('active');

    // Au changement d'onglet, on réapplique les filtres
    applyFilters();
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
  let dateString = s;
  if (!dateString.endsWith('Z') && !dateString.includes('+')) dateString += 'Z';
  return new Date(dateString).toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getProgressColor(pct) {
  if (pct > 90) return 'danger';
  if (pct > 75) return 'warn';
  return '';
}

// ---- NAVIGATION CROISÉE (FOCUS) ----
window.focusVM = function(vmName) {
  document.getElementById('tab-vms').click();
  const search = document.getElementById('global-search');
  const clearBtn = document.getElementById('clear-search-btn');

  search.value = vmName;
  clearBtn.style.display = 'flex'; // Affiche la croix car le champ n'est plus vide
  applyFilters();

  setTimeout(() => {
    const tr = document.querySelector('#vms-body tr');
    if (tr && !tr.querySelector('.dataTables_empty')) {
      tr.classList.add('highlight-target');
      setTimeout(() => tr.classList.remove('highlight-target'), 2000);
    }
  }, 100);
};

window.focusHost = function(hostName) {
  document.getElementById('tab-hosts').click();
  const search = document.getElementById('global-search');
  const clearBtn = document.getElementById('clear-search-btn');

  search.value = '';
  clearBtn.style.display = 'none';
  applyFilters();

  setTimeout(() => {
    const card = document.querySelector(`.host-card[data-host-name="${hostName.toLowerCase()}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('highlight-target');
      setTimeout(() => card.classList.remove('highlight-target'), 2000);
    }
  }, 100);
};

// ---- LOAD VMS (Anti-Blink) ----
async function loadVMs() {
  const [data, hosts] = await Promise.all([
    fetchJSON('/api/vms'),
    fetchJSON('/api/hosts')
  ]);

  const hostMap = {};
  hosts.forEach(h => hostMap[h.id] = h.name);

  const trsHtml = data.map(vm => {
    const isUp = vm.state === 'Running';
    const statusHtml = `<span class="status-dot ${isUp ? 'up' : 'down'}" title="${vm.state}"></span>`;
    const validIp = vm.ip && vm.ip !== '{}' && vm.ip !== 'null';
    const displayIp = validIp ? (isUp ? vm.ip : `<i class="text-muted">${vm.ip}</i>`) : '<span class="text-muted">—</span>';
    const hName = hostMap[vm.host_id] || vm.host_id;

    return `
      <tr>
        <td>${statusHtml} &nbsp; ${vm.name}</td>
        <td>${vm.guest_hostname || '<span class="text-muted">—</span>'}</td>
        <td>${displayIp}</td>
        <td>${vm.fqdn || '<span class="text-muted">—</span>'}</td>
        <td>${vm.ram_mb ? vm.ram_mb : '—'}</td>
        <td>${vm.total_vhd_gb ? vm.total_vhd_gb : '—'}</td>
        <td>${vm.total_vhd_file_gb ? vm.total_vhd_file_gb : '—'}</td>
        <td><span class="link-text" onclick="focusHost('${hName}')" title="Voir la carte de cet hôte">${hName}</span></td>
        <td class="text-muted">${fmtDate(vm.last_seen)}</td>
      </tr>
    `;
  }).join('');

  const tbody = document.getElementById('vms-body');
  if (window._dt) window._dt.destroy();
  tbody.innerHTML = trsHtml;

  window._dt = new DataTable('#vms-table', {
    responsive: true,
    pageLength: 100,
    dom: 't<"dt-bottom"ip>',
    language: { info: "_START_ à _END_ sur _TOTAL_ VMs", infoEmpty: "Aucune VM" }
  });

  applyFilters();
}

// ---- LOAD HOSTS (Anti-Blink) ----
async function loadHosts() {
  const hosts = await fetchJSON('/api/hosts');
  const detailsPromises = hosts.map(h => fetchJSON('/api/hosts/' + h.id));
  const detailsData = await Promise.all(detailsPromises);

  const fragment = document.createDocumentFragment();

  hosts.forEach((h, index) => {
    const detail = detailsData[index];
    const vms = detail.vms || [];
    vms.sort((a, b) => (b.state === 'Running' ? 1 : 0) - (a.state === 'Running' ? 1 : 0));

    const vmsHtml = vms.map(vm => {
      const isUp = vm.state === 'Running';
      const validIp = vm.ip && vm.ip !== '{}' && vm.ip !== 'null';
      let displayIp = validIp ? vm.ip : vm.state;
      if (!isUp && validIp) displayIp = `<i>${vm.ip}</i>`;

      return `
        <div class="vm-row clickable" data-vm-name="${vm.name.toLowerCase()}" data-vm-ip="${validIp ? vm.ip.toLowerCase() : ''}" onclick="focusVM('${vm.name}')">
          <div class="vm-info">
            <span class="status-dot ${isUp ? 'up' : 'down'}"></span>
            <span class="vm-name">${vm.name}</span>
          </div>
          <span class="vm-ip">${displayIp}</span>
        </div>
      `;
    }).join('');

    let tagsHtml = '';
    if (h.tags && h.tags.length > 0) {
      tagsHtml = '<div class="host-tags">';
      h.tags.forEach(t => {
        const colorDef = window.tagColors[t] || { bg: '#334155', text: '#f8fafc' };
        tagsHtml += `<span class="tag-badge" data-tag="${t}" style="background-color: ${colorDef.bg}; color: ${colorDef.text};">${t}</span>`;
      });
      tagsHtml += '</div>';
    }

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
      <button class="btn-trash" data-host-id="${h.id}" data-host-target="${h.ip || h.name}" title="Supprimer l'hôte">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
      <div class="host-header">
        <div>
          <h3>🖥️ ${h.name}</h3>
          ${tagsHtml} <div class="host-meta">${h.ip || 'IP Inconnue'} • Vu: ${fmtDate(h.last_seen)}</div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-item"><div class="stat-header"><span>CPU</span></div><div class="stat-header"><span class="stat-val">${cpuPct}%</span></div><div class="progress-bg"><div class="progress-fill ${getProgressColor(cpuPct)}" style="width: ${cpuPct}%"></div></div></div>
        <div class="stat-item"><div class="stat-header"><span>RAM</span></div><div class="stat-header"><span class="stat-val">${memStr}</span></div><div class="progress-bg"><div class="progress-fill ${getProgressColor(memPct)}" style="width: ${memPct}%"></div></div></div>
        <div class="stat-item"><div class="stat-header"><span>DISK</span></div><div class="stat-header"><span class="stat-val">${diskStr}</span></div><div class="progress-bg"><div class="progress-fill ${getProgressColor(diskPct)}" style="width: ${diskPct}%"></div></div></div>
      </div>
      <div class="vm-list">
        ${vmsHtml || '<div class="vm-row" style="justify-content: center; color: var(--text-muted);">Aucune VM</div>'}
      </div>
    `;
    fragment.appendChild(card);
  });

  const grid = document.getElementById('hosts-grid');
  grid.innerHTML = '';
  grid.appendChild(fragment);

  applyFilters();
}

// ---- LOGIQUE DE FILTRAGE UNIFIÉE (Recherche + Tags) ----
function applyFilters() {
  const val = document.getElementById('global-search').value.toLowerCase();
  const grid = document.getElementById('hosts-grid');
  const hasTagFilters = window.activeTags.size > 0;

  if (hasTagFilters) grid.classList.add('filtering-tags');
  else grid.classList.remove('filtering-tags');

  if (window._dt) {
    window._dt.search(val, false, false).draw();
  }

  document.querySelectorAll('.host-card').forEach(card => {
    const hostName = card.dataset.hostName;
    const hostMatchSearch = hostName.includes(val);
    let hasVisibleVm = false;

    const cardTags = Array.from(card.querySelectorAll('.tag-badge')).map(t => t.dataset.tag);
    let hostMatchTags = true;
    if (hasTagFilters) {
      hostMatchTags = Array.from(window.activeTags).every(t => cardTags.includes(t));
    }

    card.querySelectorAll('.vm-row').forEach(row => {
      const vmName = (row.dataset.vmName || "").toLowerCase();
      const vmIp = (row.dataset.vmIp || "").toLowerCase();

      if (vmName.includes(val) || vmIp.includes(val) || hostMatchSearch) {
        row.style.display = '';
        hasVisibleVm = true;
      } else {
        row.style.display = 'none';
      }
    });

    if (hostMatchTags && (hostMatchSearch || hasVisibleVm)) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }

    card.querySelectorAll('.tag-badge').forEach(badge => {
      if (window.activeTags.has(badge.dataset.tag)) {
        badge.classList.add('active');
      } else {
        badge.classList.remove('active');
      }
    });
  });
}

// ---- RECHERCHE UNIFIÉE & CROIX ----
const searchInput = document.getElementById('global-search');
const clearSearchBtn = document.getElementById('clear-search-btn');

searchInput.addEventListener('input', (e) => {
  clearSearchBtn.style.display = e.target.value.length > 0 ? 'flex' : 'none';
  applyFilters();
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  clearSearchBtn.style.display = 'none';
  searchInput.focus();
  applyFilters();
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    clearSearchBtn.click();
  }
});

// ---- FILTRAGE PAR CLIC SUR TAG ----
document.addEventListener('click', (e) => {
  const badge = e.target.closest('.tag-badge');
  if (badge) {
    const tag = badge.dataset.tag;
    if (window.activeTags.has(tag)) {
      window.activeTags.delete(tag);
    } else {
      window.activeTags.add(tag);
    }
    applyFilters();
  }
});

// ---- SUPPRESSION HOST ----
document.addEventListener('click', (e) => {
  const trashBtn = e.target.closest('.btn-trash');
  if (trashBtn) {
    openDeleteModal(trashBtn.dataset.hostId, trashBtn.dataset.hostTarget);
  }
});

function openDeleteModal(hostId, hostIpOrName) {
  document.getElementById('delete-host-id').value = hostId;
  document.getElementById('delete-target-ip').value = hostIpOrName;
  document.getElementById('delete-target-ip-display').textContent = hostIpOrName;
  document.getElementById('delete-confirm-input').value = '';
  document.getElementById('confirm-delete-btn').disabled = true;

  const modal = document.getElementById('delete-modal');
  if (modal.showModal) modal.showModal();
  else modal.setAttribute('open', '');
}

function closeModal() {
  const modal = document.getElementById('delete-modal');
  if (modal.close) modal.close();
  else modal.removeAttribute('open');
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
    await Promise.all([loadHosts(), loadVMs()]);
  } catch (e) {
    console.error("Erreur de suppression", e);
  }
});

// ---- ACTUALISATION MANUELLE ----
document.getElementById('refresh-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const icon = btn.querySelector('.refresh-icon');
  const text = btn.querySelector('span');

  btn.disabled = true;
  icon.classList.add('spin');
  text.textContent = 'Actualisation...';

  try {
    await fetch('/api/refresh', { method: 'POST' });
  } catch (err) {
    console.error("Erreur lors de l'actualisation", err);
  }

  await Promise.all([loadVMs(), loadHosts()]);

  btn.disabled = false;
  icon.classList.remove('spin');
  text.textContent = 'Actualiser';
});

// ---- INITIALISATION ----
window.addEventListener('load', async () => {
  try { window.tagColors = await fetchJSON('/api/config/tags'); } catch(e) {}
  await Promise.all([loadVMs(), loadHosts()]);

  setInterval(async () => {
    await Promise.all([loadVMs(), loadHosts()]);
  }, 60000);
});