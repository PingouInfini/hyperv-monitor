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

  // On s'assure que la date est interprétée comme de l'UTC
  // Si Python renvoie "2026-04-01T10:00:00" sans fuseau, on ajoute le 'Z'
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
  // 1. Basculer sur l'onglet VMs
  document.getElementById('tab-vms').click();

  // 2. Remplir la barre de recherche globale pour isoler la VM
  const search = document.getElementById('global-search');
  search.value = vmName;
  applyFilters();

  // 3. Appliquer la surbrillance sur la ligne du tableau
  setTimeout(() => {
    // DataTables réécrit le DOM, on prend la première ligne du corps
    const tr = document.querySelector('#vms-body tr');
    if (tr && !tr.querySelector('.dataTables_empty')) {
      tr.classList.add('highlight-target');
      setTimeout(() => tr.classList.remove('highlight-target'), 2000);
    }
  }, 100);
};

window.focusHost = function(hostName) {
  // 1. Basculer sur l'onglet Hosts
  document.getElementById('tab-hosts').click();

  // 2. Vider la barre de recherche pour être sûr de voir l'hôte
  const search = document.getElementById('global-search');
  search.value = '';
  applyFilters();

  // 3. Scroller vers la carte et la mettre en surbrillance
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
  // On fetch TOUT en parallèle avant de toucher au DOM
  const [data, hosts] = await Promise.all([
    fetchJSON('/api/vms'),
    fetchJSON('/api/hosts')
  ]);

  const hostMap = {};
  hosts.forEach(h => hostMap[h.id] = h.name);

  // Construction du HTML en mémoire
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

  // Remplacement synchronisé du DOM
  const tbody = document.getElementById('vms-body');
  if (window._dt) window._dt.destroy();
  tbody.innerHTML = trsHtml;

  window._dt = new DataTable('#vms-table', {
    responsive: true,
    pageLength: 100,
    dom: 't<"dt-bottom"ip>',
    language: { info: "_START_ à _END_ sur _TOTAL_ VMs", infoEmpty: "Aucune VM" }
  });

  // Si on est dans l'onglet VM au rafraichissement, appliquer la recherche DataTables
  applyFilters();
}

// ---- LOAD HOSTS (Anti-Blink) ----
async function loadHosts() {
  const hosts = await fetchJSON('/api/hosts');

  // Fetcher tous les détails en parallèle pour éviter le clignotement de la grille
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
        // On ajoute data-tag pour le ciblage JS
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
  // Échange instantané = zéro blink
  grid.innerHTML = '';
  grid.appendChild(fragment);

  // Une fois les cartes chargées, on réapplique les filtres et les tags actifs
  applyFilters();
}

// ---- LOGIQUE DE FILTRAGE UNIFIÉE (Recherche + Tags) ----
function applyFilters() {
  const val = document.getElementById('global-search').value.toLowerCase();
  const grid = document.getElementById('hosts-grid');
  const hasTagFilters = window.activeTags.size > 0;

  // 1. Appliquer une classe globale pour styliser les tags inactifs si un filtre est actif
  if (hasTagFilters) grid.classList.add('filtering-tags');
  else grid.classList.remove('filtering-tags');

  // 2. DataTables (Onglet VMs) - La recherche textuelle s'applique toujours
  if (window._dt) {
    window._dt.search(val, false, false).draw();
  }

  // 3. Cartes (Onglet Hosts)
  document.querySelectorAll('.host-card').forEach(card => {
    const hostName = card.dataset.hostName;
    const hostMatchSearch = hostName.includes(val);
    let hasVisibleVm = false;

    // Vérification des tags de la carte
    const cardTags = Array.from(card.querySelectorAll('.tag-badge')).map(t => t.dataset.tag);
    // L'hôte doit posséder TOUS les tags sélectionnés (intersection)
    let hostMatchTags = true;
    if (hasTagFilters) {
      hostMatchTags = Array.from(window.activeTags).every(t => cardTags.includes(t));
    }

    // Gestion de la recherche textuelle sur les VMs
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

    // Affichage de la carte : valide les tags ET (valide la recherche ou contient une VM cherchée)
    if (hostMatchTags && (hostMatchSearch || hasVisibleVm)) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }

    // Mise à jour visuelle des tags dans cette carte
    card.querySelectorAll('.tag-badge').forEach(badge => {
      if (window.activeTags.has(badge.dataset.tag)) {
        badge.classList.add('active');
      } else {
        badge.classList.remove('active');
      }
    });
  });
}

// Events listener pour le champ de recherche
document.getElementById('global-search').addEventListener('input', applyFilters);
document.getElementById('global-search').addEventListener('search', applyFilters);

// Event listener (Délégation) pour les clics sur les tags
document.addEventListener('click', (e) => {
  const badge = e.target.closest('.tag-badge');
  if (badge) {
    const tag = badge.dataset.tag;
    // Ajoute ou supprime le tag du Set global
    if (window.activeTags.has(tag)) {
      window.activeTags.delete(tag);
    } else {
      window.activeTags.add(tag);
    }
    // Relance le calcul des affichages
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
  const btn = e.target;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = 'Actualisation...';
  try { await fetch('/api/refresh', { method: 'POST' }); } catch (e) {}
  await Promise.all([loadVMs(), loadHosts()]);
  btn.removeAttribute('aria-busy');
  btn.textContent = '↻ Actualiser';
});

// ---- INITIALISATION ----
window.addEventListener('load', async () => {
  try { window.tagColors = await fetchJSON('/api/config/tags'); } catch(e) {}
  await Promise.all([loadVMs(), loadHosts()]);

  // Actualisation silencieuse sans flash (Grâce aux Promise.all + Fragment DOM)
  setInterval(async () => {
    await Promise.all([loadVMs(), loadHosts()]);
  }, 60000);
});