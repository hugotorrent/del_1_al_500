/* =====================
   RIFA.JS — Panel principal
   ===================== */
(function () {
  'use strict';

  // ——— Autenticación ———
  const token = localStorage.getItem('rifa_token');
  const nombre = localStorage.getItem('rifa_nombre');
  const role = localStorage.getItem('rifa_role');

  if (!token || !nombre) {
    window.location.replace('/');
    return;
  }

  // ——— Estado local ———
  const numeros = new Map(); // numero (int) → objeto completo
  let currentFilter = 'all';
  let searchValue = '';
  let selectedNumero = null;
  const selectedNumeros = new Set();
  let multiSelectMode = false;
  let toastTimer = null;

  // ——— Referencias DOM ———
  const loadingOverlay = document.getElementById('loadingOverlay');
  const numerosGrid = document.getElementById('numerosGrid');
  const emptyState = document.getElementById('emptyState');

  const headerUserName = document.getElementById('headerUserName');
  const adminBadge = document.getElementById('adminBadge');
  const roleBadgeText = document.getElementById('roleBadgeText');
  const logoutBtn = document.getElementById('logoutBtn');

  const selectionBar = document.getElementById('selectionBar');
  const selectionCount = document.getElementById('selectionCount');
  const clearSelectionBtn = document.getElementById('clearSelectionBtn');
  const markSelectedBtn = document.getElementById('markSelectedBtn');
  const toggleMultiSelectBtn = document.getElementById('toggleMultiSelectBtn');

  const statVendidos = document.getElementById('statVendidos');
  const statDisponibles = document.getElementById('statDisponibles');
  const progressFill = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');

  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  const searchInput = document.getElementById('searchInput');
  const filterBtns = document.querySelectorAll('.filter-btn');

  // Modales
  const marcarModal = document.getElementById('marcarModal');
  const infoModal = document.getElementById('infoModal');
  const modalNumero = document.getElementById('modalNumero');
  const compradorInput = document.getElementById('compradorInput');
  const marcarCancelBtn = document.getElementById('marcarCancelBtn');
  const marcarConfirmBtn = document.getElementById('marcarConfirmBtn');

  const infoModalNumero = document.getElementById('infoModalNumero');
  const infoModalSubtitle = document.getElementById('infoModalSubtitle');
  const infoComprador = document.getElementById('infoComprador');
  const infoVendedor = document.getElementById('infoVendedor');
  const infoFecha = document.getElementById('infoFecha');
  const infoCancelBtn = document.getElementById('infoCancelBtn');
  const infoUnmarkBtn = document.getElementById('infoUnmarkBtn');

  const toast = document.getElementById('toast');

  // ——— Setup header ———
  headerUserName.textContent = nombre;
  if (role === 'admin') {
    adminBadge.hidden = false;
    roleBadgeText.textContent = 'Admin';
  } else if (role === 'vendedor') {
    adminBadge.hidden = false;
    roleBadgeText.textContent = 'moralito';
  }

  // ——— Socket.io ———
  const socket = io({ auth: { token } });

  socket.on('connect', () => {
    setConnectionStatus(true);
  });

  socket.on('disconnect', () => {
    setConnectionStatus(false);
  });

  socket.on('connect_error', (err) => {
    console.error('Socket error:', err.message);
    if (err.message === 'Token inválido' || err.message === 'Token requerido') {
      logout();
    }
    setConnectionStatus(false);
  });

  socket.on('estado_inicial', (data) => {
    data.forEach((n) => numeros.set(n.numero, n));
    renderGrid();
    updateStats();
    hideLoading();
  });

  socket.on('numero_actualizado', (n) => {
    numeros.set(n.numero, n);
    updateCell(n);
    updateStats();
  });

  socket.on('error_operacion', (data) => {
    showToast(data.mensaje, 'error');
  });

  // ——— Render de la grilla ———
  function renderGrid() {
    numerosGrid.innerHTML = '';
    for (let i = 1; i <= 500; i++) {
      const cell = createCell(i);
      numerosGrid.appendChild(cell);
    }
    applyFilters();
  }

  function createCell(num) {
    const data = numeros.get(num) || { numero: num, vendido: false };
    const cell = document.createElement('button');
    cell.id = `num-${num}`;
    cell.className = 'numero-cell' + (data.vendido ? ' vendido' : '') + (role === 'admin' ? ' admin-mode' : '');
    if (selectedNumeros.has(num)) cell.classList.add('selected');
    cell.textContent = num;
    cell.setAttribute('aria-label', `Número ${num} — ${data.vendido ? 'vendido a ' + data.comprador : 'disponible'}`);
    cell.setAttribute('data-num', num);
    cell.setAttribute('data-vendido', data.vendido ? '1' : '0');

    cell.addEventListener('click', () => handleCellClick(num));
    return cell;
  }

  function updateCell(data) {
    const cell = document.getElementById(`num-${data.numero}`);
    if (!cell) return;

    cell.classList.toggle('vendido', data.vendido);
    cell.classList.toggle('selected', selectedNumeros.has(data.numero));
    cell.setAttribute('data-vendido', data.vendido ? '1' : '0');
    cell.setAttribute('aria-label', `Número ${data.numero} — ${data.vendido ? 'vendido a ' + data.comprador : 'disponible'}`);

    if (data.vendido && selectedNumeros.has(data.numero)) {
      selectedNumeros.delete(data.numero);
      updateSelectionBar();
    }

    // Animación
    cell.classList.remove('just-updated');
    void cell.offsetWidth; // force reflow
    cell.classList.add('just-updated');
    cell.addEventListener('animationend', () => cell.classList.remove('just-updated'), { once: true });

    applyFilters();
  }

  // ——— Filtros ———
  function applyFilters() {
    let visibleCount = 0;

    document.querySelectorAll('.numero-cell').forEach((cell) => {
      const num = parseInt(cell.getAttribute('data-num'));
      const vendido = cell.getAttribute('data-vendido') === '1';

      let visible = true;

      if (searchValue) {
        visible = String(num).includes(searchValue);
      } else {
        if (currentFilter === 'available') visible = !vendido;
        if (currentFilter === 'sold') visible = vendido;
      }

      cell.classList.toggle('hidden', !visible);
      if (visible) visibleCount++;
    });

    emptyState.classList.toggle('show', visibleCount === 0);
  }

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter = btn.getAttribute('data-filter');
      searchValue = '';
      searchInput.value = '';

      filterBtns.forEach((b) => {
        b.className = 'filter-btn';
      });

      if (currentFilter === 'all') btn.classList.add('active-all');
      else if (currentFilter === 'available') btn.classList.add('active-available');
      else if (currentFilter === 'sold') btn.classList.add('active-sold');

      applyFilters();
    });
  });

  searchInput.addEventListener('input', (e) => {
    searchValue = e.target.value.trim();
    if (searchValue) {
      filterBtns.forEach((b) => b.className = 'filter-btn');
      currentFilter = 'all';
    }
    applyFilters();
  });

  // ——— Estadísticas ———
  function updateStats() {
    let vendidos = 0;
    numeros.forEach((n) => { if (n.vendido) vendidos++; });
    const disponibles = 500 - vendidos;
    const pct = Math.round((vendidos / 500) * 100);

    statVendidos.textContent = vendidos;
    statDisponibles.textContent = disponibles;
    progressFill.style.width = pct + '%';
    progressLabel.textContent = `${pct}% vendido`;
  }

  // ——— Manejo de clic en celda ———
  function handleCellClick(num) {
    const data = numeros.get(num);
    if (!data) return;

    if (data.vendido) {
      openInfoModal(data);
    } else if (multiSelectMode) {
      toggleNumeroSelection(num);
    } else {
      openMarcarModalSingle(num);
    }
  }

  function toggleNumeroSelection(num) {
    if (selectedNumeros.has(num)) {
      selectedNumeros.delete(num);
    } else {
      selectedNumeros.add(num);
    }
    updateSelectionBar();
    const cell = document.getElementById(`num-${num}`);
    if (cell) cell.classList.toggle('selected', selectedNumeros.has(num));
  }

  function updateSelectionBar() {
    const count = selectedNumeros.size;
    if (count > 0) {
      selectionBar.hidden = false;
      selectionCount.textContent = count;
      markSelectedBtn.textContent = count === 1 ? 'Marcar seleccionado' : 'Marcar seleccionados';
    } else {
      selectionBar.hidden = true;
    }
  }

  function clearSelection() {
    selectedNumeros.clear();
    document.querySelectorAll('.numero-cell.selected').forEach((cell) => {
      cell.classList.remove('selected');
    });
    updateSelectionBar();
  }

  function setMultiSelectMode(enabled) {
    multiSelectMode = enabled;
    toggleMultiSelectBtn.classList.toggle('active-multi', enabled);
    toggleMultiSelectBtn.textContent = enabled ? 'Modo selección múltiple' : 'Seleccionar varios';
    if (!enabled) clearSelection();
  }

  function openMarcarModal() {
    if (selectedNumeros.size === 0) return;
    selectedNumero = null;
    if (selectedNumeros.size === 1) {
      modalNumero.textContent = [...selectedNumeros][0];
    } else {
      modalNumero.textContent = `${selectedNumeros.size} números`;
    }
    compradorInput.value = '';
    marcarModal.classList.add('show');
    setTimeout(() => compradorInput.focus(), 300);
  }

  function closeMarcarModal() {
    marcarModal.classList.remove('show');
    selectedNumero = null;
  }

  marcarCancelBtn.addEventListener('click', closeMarcarModal);
  marcarModal.addEventListener('click', (e) => {
    if (e.target === marcarModal) closeMarcarModal();
  });

  marcarConfirmBtn.addEventListener('click', () => {
    const comprador = compradorInput.value.trim();
    if (!comprador || comprador.length < 2) {
      compradorInput.style.borderColor = 'var(--sold)';
      compradorInput.focus();
      setTimeout(() => { compradorInput.style.borderColor = ''; }, 1500);
      return;
    }

    const numerosSeleccionados = [...selectedNumeros];
    socket.emit('marcar_numero', { numeros: numerosSeleccionados, comprador });
    closeMarcarModal();
    clearSelection();
    showToast(`${numerosSeleccionados.length === 1 ? `Número ${numerosSeleccionados[0]}` : `${numerosSeleccionados.length} números`} marcado ✓`, 'success');
  });

  compradorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') marcarConfirmBtn.click();
    if (e.key === 'Escape') closeMarcarModal();
  });

  // ——— Modal: info número vendido ———
  function openInfoModal(data) {
    selectedNumero = data.numero;
    infoModalNumero.textContent = data.numero;
    infoComprador.textContent = data.comprador || '—';
    infoVendedor.textContent = data.vendedor || '—';
    infoFecha.textContent = data.fechaVenta
      ? new Date(data.fechaVenta).toLocaleString('es-AR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
      : '—';

    if (role === 'admin') {
      infoUnmarkBtn.hidden = false;
      infoModalSubtitle.textContent = 'Podés desmarcar este número como administrador';
    } else {
      infoUnmarkBtn.hidden = true;
      infoModalSubtitle.textContent = 'Este número ya fue vendido';
    }

    infoModal.classList.add('show');
  }

  function closeInfoModal() {
    infoModal.classList.remove('show');
    selectedNumero = null;
  }

  infoCancelBtn.addEventListener('click', closeInfoModal);
  infoModal.addEventListener('click', (e) => {
    if (e.target === infoModal) closeInfoModal();
  });

  clearSelectionBtn.addEventListener('click', clearSelection);
  markSelectedBtn.addEventListener('click', openMarcarModal);
  toggleMultiSelectBtn.addEventListener('click', () => setMultiSelectMode(!multiSelectMode));

  infoUnmarkBtn.addEventListener('click', () => {
    if (!selectedNumero) return;
    socket.emit('desmarcar_numero', { numero: selectedNumero });
    closeInfoModal();
    showToast(`Número ${selectedNumero} desmarcado`, 'info');
  });

  // ——— Toast ———
  function showToast(msg, type = 'info') {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.className = `toast ${type} show`;
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }

  // ——— Connection status ———
  function setConnectionStatus(connected) {
    statusDot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
    statusText.className = `status-text ${connected ? 'connected' : 'disconnected'}`;
    statusText.textContent = connected ? 'En vivo' : 'Desconectado';
  }

  // ——— Loading ———
  function hideLoading() {
    loadingOverlay.classList.add('hide');
    setTimeout(() => { loadingOverlay.style.display = 'none'; }, 400);
  }

  // ——— Logout ———
  function logout() {
    localStorage.removeItem('rifa_token');
    localStorage.removeItem('rifa_nombre');
    localStorage.removeItem('rifa_role');
    window.location.replace('/');
  }

  logoutBtn.addEventListener('click', logout);

  // ——— Cerrar modales con Escape ———
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMarcarModal();
      closeInfoModal();
    }
  });
})();
